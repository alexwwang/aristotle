import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import { MAX_DEPTH } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState } from './helpers.js'

// F-001: replaced 5 expect(true).toBe(false) stubs with real SUT invocations.

function makeSuspendedPipeline(overrides?: Partial<SuspendedPipeline>): SuspendedPipeline {
  return {
    runId: 'parent-123',
    suspendedAt: '2026-06-06T12:00:00Z',
    suspendedPhase: 5,
    depth: 0,
    suspendedReason: 'test_modification',
    // F-004: include all optional SuspendedPipeline fields as explicit undefined defaults
    // for consistency with the other 5 test files (silent type-widening risk otherwise).
    childDepth: undefined,
    parentRunId: undefined,
    parentPipelineProjectId: undefined,
    childRunId: undefined,
    quarantineSuccess: undefined,
    parentRegressionHistory: [],
    ...overrides,
  }
}

function makeSuspendedStack(entries: SuspendedPipeline[]): SuspendedStack {
  return { entries }
}

function makeNestingState(overrides?: Partial<PipelineState>): PipelineState {
  return makeState({
    currentPhase: 5,
    phaseStatus: 'ralph_loop',
    depth: 0,
    projectId: 'proj-1',
    runId: 'parent-123',
    ...overrides,
  })
}

const mockStateStore = {
  read: vi.fn(),
  write: vi.fn(),
  appendLog: vi.fn(),
  readLog: vi.fn().mockReturnValue([]),
  readLogSafe: vi.fn().mockReturnValue([]),
  list: vi.fn().mockReturnValue([]),
} satisfies StateStore

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

function createStore(): PipelineStore {
  return new PipelineStore(mockStateStore, mockLogger)
}

describe('cross-project integration - pipeline nesting', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.readLog.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  // #63
  // F-015: setup DIFFERENT stacks per project (proj-X local empty vs proj-Y parent populated)
  // — verifies implementation actually loads the parent project's stack, not just the local one.
  it('should resolve cross project parent suspended stack', () => {
    const parentEntry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456',
      parentPipelineProjectId: 'proj-Y',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      // Parent project (proj-Y) has the suspended stack
      if (key === 'proj-Y/suspended-stack' || key.endsWith('/proj-Y/suspended-stack')) {
        return makeSuspendedStack([parentEntry])
      }
      // Child project (proj-X) has empty/no stack
      if (key === 'proj-X/suspended-stack' || key.endsWith('/proj-X/suspended-stack')) {
        return makeSuspendedStack([])
      }
      return null
    })
    const stack = store.getSuspendedStack('proj-Y')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].parentPipelineProjectId).toBe('proj-Y')
    expect(stack.entries[0].childRunId).toBe('child-456')
    // Verify parent project's stack was actually read (cross-project resolution occurred)
    expect(mockStateStore.read).toHaveBeenCalledWith(expect.stringContaining('proj-Y'))
  })

  // #64
  // F-028: differentiate from #65 — mock returns null (no readable parent state).
  it('should reject resume if cross project resolution fails', () => {
    const entry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456',
      parentPipelineProjectId: 'proj-unreachable',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      // parent state in proj-unreachable is null — resolution failure
      return null
    })
    expect(() => store.resumeSuspended('proj-unreachable', 'child-456')).toThrow(/cross.project|resolution/i)
  })

  // #65
  // F-028: differentiate from #64 — mock throws ETIMEDOUT (slow I/O timeout).
  it('should reject resume when cross project resolution times out', () => {
    const entry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456',
      parentPipelineProjectId: 'proj-slow',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      if (key.endsWith('/active')) return null
      if (key.includes('proj-slow')) throw new Error('ETIMEDOUT: connection timed out')
      return null
    })
    expect(() => store.resumeSuspended('proj-slow', 'child-456')).toThrow(/timeout/i)
  })

  // #66
  // F-016: strengthen assertion — verify parentPipelineProjectId field, not just any Object.
  it('should use parent projectId for cross project child pipelines', () => {
    const entry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456',
      parentPipelineProjectId: 'proj-parent',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-parent', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('proj-parent'),
      expect.objectContaining({ parentPipelineProjectId: 'proj-parent' }),
    )
  })

  // #129
  // F-016: setup two project contexts (proj-X child + proj-Y parent) with the PARENT's
  // stack populated — the previous setup returned the same entries for proj-1 regardless
  // of context, so it never proved cross-project depth resolution.
  it('should reject cross-project child suspend when depth exceeds MAX_DEPTH', () => {
    expect(MAX_DEPTH).toBe(10)
    // Parent project (proj-Y) already at MAX_DEPTH entries
    const parentEntries: SuspendedPipeline[] = []
    for (let i = 0; i < MAX_DEPTH; i++) {
      parentEntries.push(makeSuspendedPipeline({ runId: `parent-run-${i}`, depth: i }))
    }
    // Child project (proj-X) active state — references proj-Y as parent
    const childActiveState = makeNestingState({
      depth: MAX_DEPTH,
      phaseStatus: 'ralph_loop',
      parentPipelineProjectId: 'proj-Y',
      projectId: 'proj-X',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/proj-X/state') || key.endsWith('/state')) return childActiveState
      if (key === 'proj-Y/suspended-stack' || key.endsWith('/proj-Y/suspended-stack')) {
        return makeSuspendedStack(parentEntries)
      }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    expect(() => store.suspendActive('proj-X', 'cross_project_suspend')).toThrow(/depth/i)
    // Verify parent project's stack was loaded for depth computation
    expect(mockStateStore.read).toHaveBeenCalledWith(expect.stringContaining('proj-Y'))
  })
})
