import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import { CheckpointHandler } from '../src/checkpoint.js'
import { MAX_DEPTH, STALE_THRESHOLD_MS } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState } from './helpers.js'

// NOTE: This file uses mock-based E2E patterns (Red Phase). True integration tests
// with in-memory StateStore are deferred to Green Phase. See F-013.
// F-001: replaced 5 expect(true).toBe(false) stubs with real SUT invocations.

// F-021: factory includes ALL SuspendedPipeline fields explicitly (including
// childDepth, parentPipelineProjectId as undefined defaults) for cross-file consistency.
function makeSuspendedPipeline(overrides?: Partial<SuspendedPipeline>): SuspendedPipeline {
  return {
    runId: 'parent-123',
    suspendedAt: '2026-06-06T12:00:00Z',
    suspendedPhase: 5,
    depth: 0,
    childDepth: undefined,
    parentRunId: undefined,
    parentPipelineProjectId: undefined,
    suspendedReason: 'test_modification',
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

const mockStateStore: StateStore = {
  read: vi.fn(),
  write: vi.fn(),
  appendLog: vi.fn(),
  readLog: vi.fn().mockReturnValue([]),
  readLogSafe: vi.fn().mockReturnValue([]),
  list: vi.fn().mockReturnValue([]),
}

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

describe('pipeline nesting - e2e', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.clearAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.readLog.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = new PipelineStore(mockStateStore, mockLogger)
  })

  // #82
  // F-023: mutable `resumed` flag switches all reads at once. Acceptable in
  // Red Phase (methods throw on first read). Green Phase should use
  // mockImplementationOnce for sequential read control.
  it('should complete full nested pipeline flow suspend child resume', () => {
    const parentActive = makeNestingState({ runId: 'parent-123', phaseStatus: 'ralph_loop', depth: 0, currentPhase: 5 })
    const parentSuspended = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop', depth: 0, currentPhase: 5 })
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    let resumed = false
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return resumed ? parentSuspended : parentActive
      if (key.endsWith('/active')) return resumed ? null : { runId: 'parent-123', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return resumed ? makeSuspendedStack([entry]) : makeSuspendedStack([])
      return null
    })
    store.suspendActive('proj-1', 'child_nesting')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('parent-123')
    store.setChildRunId('proj-1', 'parent-123', 'child-456')
    resumed = true
    const result = store.resumeSuspended('proj-1', 'child-456')
    expect(result.phaseStatus).toBe('ralph_loop')
    expect(result.depth).toBe(0)
    expect(result.currentPhase).toBe(5)
    const postStack = store.getSuspendedStack('proj-1')
    expect(postStack.entries).toHaveLength(0)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_suspend' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume' }),
    )
  })

  // #83
  it('should handle child pipeline failure during nested execution', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childFailedState = makeNestingState({
      runId: 'child-456', phaseStatus: 'failed', currentPhase: 4,
    })
    const parentState = makeNestingState({
      runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/child-456/state')) return childFailedState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    const postStack = store.getSuspendedStack('proj-1')
    expect(postStack.entries).toHaveLength(0)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        childRunId: 'child-456',
        failurePhase: expect.any(Number),
        failureReason: expect.any(String),
        quarantinedFiles: expect.any(Array),
      }),
    )
    // F-024: spec #83 requires child's partial work committed/recorded in parent state.
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('parent-123'),
      expect.objectContaining({
        lastCompletedChildPhase: expect.any(Number),
      }),
    )
  })

  // #84
  it('should enforce maximum nesting depth across full flow', () => {
    expect(MAX_DEPTH).toBe(10)
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < MAX_DEPTH - 1; i++) {
      entries.push(makeSuspendedPipeline({ runId: `run-${i}`, depth: i }))
    }
    const activeState = makeNestingState({ depth: MAX_DEPTH - 1, phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return activeState
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    expect(() => store.suspendActive('proj-1', 'depth_exceed')).toThrow(/depth/i)
    expect(mockStateStore.write).not.toHaveBeenCalled()
  })

  // #85
  it('should recover from crash during nested execution', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(result?.runId).toBe('parent-123')
    // F-049: verify recovered state has correct depth, phaseStatus, and audit entries
    expect(result?.depth).toBe(0)
    expect(result?.phaseStatus).not.toBe('suspended')
    // F-025: tighten event name — 'recover' matches any substring; use 'ORPHANED'.
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: expect.stringContaining('ORPHANED') }),
    )
  })

  // #86
  it('should handle force mode on pipeline start with orphaned entries', async () => {
    const handler = new CheckpointHandler(store, STALE_THRESHOLD_MS, undefined, undefined, undefined, mockLogger)
    const entries = [
      makeSuspendedPipeline({ runId: 'orphaned-1', depth: 0 }),
      makeSuspendedPipeline({ runId: 'orphaned-2', depth: 1 }),
    ]
    const state = makeNestingState({ runId: 'orphaned-1', phaseStatus: 'suspended' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return state
      if (key.endsWith('/active')) return { runId: 'orphaned-1', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'force start', force: true }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    // F-050: verify stack discarded and fresh pipeline started at depth=0
    expect(parsed.ok).toBe(true)
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ depth: 0 }),
    )
  })
})
