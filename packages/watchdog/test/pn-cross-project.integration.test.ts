import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import { MAX_DEPTH } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState, makeSuspendedPipeline, makeSuspendedStack, makeNestingState } from './helpers.js'

// F-001: replaced 5 expect(true).toBe(false) stubs with real SUT invocations.



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

  // #63 (part 1 — stack resolution)
  // F-015: setup DIFFERENT stacks per project (proj-X local empty vs proj-Y parent populated)
  // — verifies implementation actually loads the parent project's stack, not just the local one.
  // P-016 (M): split #63 into two tests — the original used mockClear mid-test
  // (L131) to split pre-clear and post-clear assertion phases. Test smell.
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

  // #63 (part 2 — resume chain walk)
  // P-016 (M): extracted from the original #63 test — verifies the cross-project
  // chain walk during resumeSuspended (proj-X → proj-Y stack consultation).
  // Spec #63: "When pipeline_resume called from project X. Then load
  // B.parentPipelineProjectId, access Y's stack, verify B.runId matches
  // A.childRunId."
  it('should walk cross-project chain during resumeSuspended', () => {
    const parentEntry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456',
      parentPipelineProjectId: 'proj-Y',
    })
    const childState = makeNestingState({
      runId: 'child-456',
      projectId: 'proj-X',
      parentPipelineProjectId: 'proj-Y',
      parentRunId: 'parent-123',
      phaseStatus: 'complete',
    })
    const parentState = makeNestingState({
      runId: 'parent-123',
      projectId: 'proj-Y',
      phaseStatus: 'suspended',
      preSuspendStatus: 'ralph_loop',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key === 'proj-Y/suspended-stack' || key.endsWith('/proj-Y/suspended-stack')) {
        return makeSuspendedStack([parentEntry])
      }
      if (key === 'proj-X/suspended-stack' || key.endsWith('/proj-X/suspended-stack')) {
        return makeSuspendedStack([])
      }
      if (key.endsWith('/child-456/state')) return childState
      if (key.endsWith('/parent-123/state')) return parentState
      return null
    })
    store.resumeSuspended('proj-X', 'child-456')
    // Verify cross-project chain walk: proj-Y's stack was consulted during resume
    expect(mockStateStore.read).toHaveBeenCalledWith(expect.stringContaining('proj-Y'))
    // Verify parent restoration write occurred in proj-Y's key space
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('proj-Y'),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
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
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ code: expect.stringMatching(/CRITICAL|RESOLUTION_FAILURE/i) }),
      }),
    )
    // P-007: spec #64 — DO NOT pop stack on resolution failure
    expect(mockStateStore.write).not.toHaveBeenCalledWith(
      expect.stringContaining('/suspended-stack'),
      expect.objectContaining({ entries: [] }),
    )
  })

  // #65
  // F-028: differentiate from #64 — mock throws ETIMEDOUT (slow I/O timeout).
  // F-042 (MODIFY M): PARTIAL(#65) — timeout simulated via error throw, not
  // elapsed-time measurement. True timeout test (fake timers +
  // CROSS_PROJECT_RESOLUTION_TIMEOUT_MS import) deferred to Green Phase.
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
    // P-017 (M): spec #65 requires error mentioning "manual intervention" —
    // single throw assertion with combined regex (avoids double-call state drift).
    expect(() => store.resumeSuspended('proj-slow', 'child-456')).toThrow(/timeout|manual.intervention/i)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ code: expect.stringMatching(/CRITICAL|RESOLUTION_FAILURE/i) }),
      }),
    )
  })

  // #66
  // P-004 (M): spec #66 tests child state creation via suspendActive, not resume.
  it('should use parent projectId for cross project child pipelines', () => {
    const activeState = makeNestingState({ runId: 'parent-123', projectId: 'proj-parent', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'parent-123', projectId: 'proj-parent' }
      if (key.endsWith('/parent-123/state')) return activeState
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    store.suspendActive('proj-parent', 'cross_project_child')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('proj-parent'),
      expect.objectContaining({ parentPipelineProjectId: 'proj-parent' }),
    )
    // P-010: spec #66 — verify child state creation with cross-project references
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringMatching(/child.*state/i),
      expect.objectContaining({
        parentPipelineProjectId: 'proj-parent',
        parentRunId: 'parent-123',
        depth: 1,
      }),
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
    // F-129 (L): runId must match the /active pointer at L238 ('child-run') —
    // was defaulting to 'parent-123' from makeNestingState, causing fixture
    // mismatch between active pointer and state runId.
    const childActiveState = makeNestingState({
      runId: 'child-run',
      depth: MAX_DEPTH,
      phaseStatus: 'ralph_loop',
      parentPipelineProjectId: 'proj-Y',
      projectId: 'proj-X',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      // P-011: add /active mock return so suspendActive can detect the active
      // pipeline before checking depth. Without it, the expected /depth/i
      // throw may not match if the impl checks active status first.
      if (key.endsWith('/active')) return { runId: 'child-run', projectId: 'proj-X' }
      if (key.endsWith('/state')) return childActiveState
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
