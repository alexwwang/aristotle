import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { SuspendedPipeline, SuspendedStack, PipelineState, ChildFailureContext, PendingPause, ReviewerTakeoverState } from '../src/schema.js'
import { MAX_DEPTH } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'

import { makeState, makeSuspendedPipeline, makeSuspendedStack, makeNestingState, createMemStoreBridge } from './helpers.js'

// F-043: typed StateStore mock for compile-time method coverage.
// F-001: use `satisfies StateStore` (not `: StateStore`) to preserve vi.fn()
// return types while still satisfying the structural contract.
const mockStateStore = {
  read: vi.fn(),
  write: vi.fn(),
  appendLog: vi.fn(),
  readLog: vi.fn().mockReturnValue([]),
  readLogSafe: vi.fn().mockReturnValue([]),
  list: vi.fn().mockReturnValue([]),
} satisfies StateStore

// F-006: add debug method — Logger interface requires all four levels.
// Without it, any PipelineStore call to this.logger.debug throws TypeError.
// F-022: use `satisfies Logger` (not `as Logger`) — preserves vi.fn() return
// types while still satisfying the structural contract, no type erasure.
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} satisfies Logger

function createStore(): PipelineStore {
  // F-012: remove `as any` — mockStateStore already uses `satisfies StateStore`.
  // F-022: mockLogger already satisfies Logger — no cast needed.
  return new PipelineStore(mockStateStore, mockLogger)
}

describe('PipelineStore - Resume Flow', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  describe('Resume Flow', () => {
  // #18
  it('should restore parent status from preSuspendStatus', () => {
    const state = makeNestingState({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
    const entry = makeSuspendedPipeline({ childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      // P-012: explicit /active branch — catch-all return of full PipelineState
      // for /active masks type confusion (should be {runId, projectId} pointer).
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      return state
    })
    const result = store.resumeSuspended('proj-1', 'child-456')
    expect(result.phaseStatus).toBe('ralph_loop')
    expect(result.suspendedAt).toBeUndefined()
    expect(result.suspendedPhase).toBeUndefined()
    expect(result.suspendedReason).toBeUndefined()
  })

  // #19
  it('should verify child runId matches topmost entry', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    // P-002 (M): in-memory Map bridge so popSuspended writes persist —
    // without this, getSuspendedStack re-reads the same mock fixture
    // and the "stack NOT popped" assertion at L437-439 is vacuous.
    const memStore = createMemStoreBridge(mockStateStore, { 'proj-1/suspended-stack': makeSuspendedStack([entry]) })
    expect(() => store.resumeSuspended('proj-1', 'wrong-id')).toThrow(/child_run_id/i)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', decision: 'BLOCK' }),
    )
    // Spec #19: stack NOT popped on rejection — verify entry remains
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('run-123')
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/ERROR.*child_run_id|child_run_id.*mismatch|RESUME.*BLOCK/i))
  })

  // #20
  // F-003: added entry C(d=2) above B so B is intermediate and the rejection
  // triggers for the correct reason (entry above the matching one).
  it('should reject resume when intermediate pipelines exist', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'A', depth: 0 }),
      makeSuspendedPipeline({ runId: 'B', depth: 1, childRunId: 'child-456' }),
      makeSuspendedPipeline({ runId: 'C', depth: 2, childRunId: 'child-789' }),
    ]
    mockStateStore.read.mockReturnValue(makeSuspendedStack(entries))
    expect(() => store.resumeSuspended('proj-1', 'child-456')).toThrow(/intermediate pipelines exist/i)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      // 'RESUME_GUARD_FAILURE' is not a CheckpointEvent — carry via metadata.code.
      // F-010: wrap metadata in expect.objectContaining so future fields don't break tests.
      expect.objectContaining({ event: 'pipeline_resume', metadata: expect.objectContaining({ code: 'RESUME_GUARD_FAILURE' }) }),
    )
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/CRITICAL.*RESUME_GUARD_FAILURE|RESUME_GUARD_FAILURE.*CRITICAL/i))
  })

  // #21
  it('should emit pipeline_resume audit entry on success', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    // F-020-023 (M): explicit /suspended-stack branch — blanket mockReturnValue
    // returned a stack for ALL reads including /state and /active.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-123')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      // F-004: tightened — audit entry must include childStatus and depth
      expect.objectContaining({
        event: 'pipeline_resume',
        decision: 'PASS',
        childStatus: expect.any(String),
        depth: expect.any(Number),
      }),
    )
  })

  // #22
  it('should set childPipelineRunId on parent state before restore', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    // F-020-023 (M): explicit /suspended-stack branch — blanket mockReturnValue
    // returned a stack for ALL reads including /state and /active.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-123')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ childPipelineRunId: 'child-123' }),
    )
  })

  // #23
  it('should clear suspended stack entry after successful resume', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    // F-020-023 (M): explicit /suspended-stack branch — blanket mockReturnValue
    // returned a stack for ALL reads including /state and /active.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-123')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(0)
  })
  }) // describe('Resume Flow')

  // #88
  // F-012: use word-boundary match to avoid coincidental match on 'incomplete'.
  it('should format resume message with child status and depth', () => {
    const msg = store.formatResumeMessage('complete', 0)
    expect(msg).toMatch(/\bcomplete\b/i)
    expect(msg).toMatch(/depth.*0/i)
  })

  // #100
  // F-047: define named type for regression record fixture to avoid inline assertion.
  it('should deep copy parentRegressionHistory isolating child from parent mutations', () => {
    // P-007: in-memory Map bridge so pushSuspended write persists for
    // getSuspendedStack read. Without it, entries[0] throws because
    // the stack is empty, making the deep-copy assertion vacuous.
    const memStore = createMemStoreBridge(mockStateStore)
    interface RegressionViolationEvent { file: string; line: number; expected: string; actual: string }
    interface RegressionRecord { violation: string; violationEvents: RegressionViolationEvent[]; timestamp: string }
    const history: RegressionRecord[] = [{
      violation: 'PATTERN_VIOLATION',
      violationEvents: [{ file: 'a.ts', line: 10, expected: 'foo', actual: 'bar' }],
      timestamp: '2026-06-14T12:00:00Z',
    }]
    const entry = makeSuspendedPipeline({ parentRegressionHistory: history })
    store.pushSuspended('proj-1', entry)
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries[0].parentRegressionHistory).not.toBe(history)
    const original = history[0].violationEvents[0]!
    const stackEntry = stack.entries[0]!
    const copiedEntry = stackEntry.parentRegressionHistory![0] as RegressionRecord
    const copied = copiedEntry.violationEvents[0]!
    expect(copied).not.toBe(original)
    original.line = 999
    expect(copied.line).not.toBe(999)
  })

  // #102
  it('should validate ChildFailureContext on child failure resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childFailedState = makeNestingState({
      runId: 'child-456',
      phaseStatus: 'failed',
      currentPhase: 4,
    })
    // F-030: mock only at mockStateStore.read level — no double-mocking via store.readState.
    // P-009: explicit /suspended-stack branch — catch-all return of makeSuspendedStack
    // masks type confusion (returns a stack for /audit, /observations, etc.).
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childFailedState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/state')) return makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        childRunId: 'child-456',
        failurePhase: 4,
        failureReason: expect.any(String),
        quarantinedFiles: expect.any(Array),
        violationTypes: expect.any(Array),
      }),
    )
  })

  // #110
  it('should cancel child and resume parent via force=true on pipeline_resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = makeNestingState({
      runId: 'parent-123',
      phaseStatus: 'suspended',
      preSuspendStatus: 'active',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/state')) return makeNestingState({ runId: 'child-456', phaseStatus: 'ralph_loop' })
      return makeSuspendedStack([entry])
    })
    const result = store.resumeSuspended('proj-1', 'child-456', true)
    expect(result.phaseStatus).toBe('active')
    // F-034: verify child state was written as cancelled
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('child-456'),
      expect.objectContaining({ phaseStatus: 'cancelled' }),
    )
    // F-034: verify force-resume audit entry
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', metadata: expect.objectContaining({ code: 'FORCE_RESUME' }) }),
    )
  })

  // #111
  it('should clear pending_pause on parent when force-resume cancels child', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/parent-123/state')) return makeNestingState({
        phaseStatus: 'suspended',
        // F-002: set preSuspendStatus explicitly so the phaseStatus:'ralph_loop'
        // assertion below is self-consistent — without this, makeNestingState
        // defaults preSuspendStatus to undefined and Green Phase would set 'active'.
        preSuspendStatus: 'ralph_loop',
        // F-013: typed as PendingPause — no `as any`.
        pending_pause: { reason: 'pattern_cycle', violation_type: 'REGRESSION', files: ['src/test.ts'] } satisfies PendingPause,
      })
      if (key.endsWith('/state')) return makeNestingState({ runId: 'child-456', phaseStatus: 'ralph_loop' })
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456', true)
    // F-015: filter write calls by parent state key (resilient to write ordering).
    const parentWrite = mockStateStore.write.mock.calls.find(
      ([key]: [string]) => key.endsWith('/parent-123/state'),
    )
    expect(parentWrite).toBeDefined()
    const writtenState = parentWrite![1]
    // F-111 (M): removed `expect('pending_pause' in writtenState).toBe(true)` —
    // same over-specification removed at L981 for the null variant. JSON
    // serialization treats undefined and absent identically; the behavioral
    // assertion below (toBeUndefined) is sufficient.
    expect(writtenState.pending_pause).toBeUndefined()
    // F-035: verify no pause applied — phaseStatus should not be 'paused'
    expect(writtenState.phaseStatus).not.toBe('paused')
    expect(writtenState.phaseStatus).toBe('ralph_loop')
  })

  // #114
  // F-004: pre-populate pending_pause + child pipeline so DEFERRED_PAUSE trigger
  // path is exercised. Original fixture had no trigger condition.
  it('should create DEFERRED_PAUSE audit entries with correct schema', () => {
    const parentState = {
      ...makeNestingState({ phaseStatus: 'suspended' }),
      pending_pause: {
        reason: 'PATTERN_CYCLE',
        violation_type: 'REGRESSION',
        files: ['src/a.ts'],
      } satisfies PendingPause,
    }
    const entry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return parentState
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: expect.stringContaining('DEFERRED_PAUSE'),
        trigger_type: expect.any(String),
        reason: expect.any(String),
        violation_type: expect.any(String),
        files: expect.any(Array),
        timestamp: expect.any(String),
        runId: expect.any(String),
      }),
    )
  })

  // #125
  it('should format child failure message on resume', () => {
    const ctx: ChildFailureContext = {
      childRunId: 'child-456',
      failurePhase: 4,
      failureReason: 'ralph_loop_timeout',
      quarantinedFiles: [],
      violationTypes: [],
    }
    const msg = store.formatChildFailureMessage(ctx, 5, 0)
    expect(msg).toContain('Phase 5')
    expect(msg).toMatch(/depth.*0/i)
    expect(msg).toContain('child-456')
    expect(msg).toContain('ralph_loop_timeout')
  })

  // #146
  it('should emit pipeline_unpause CheckpointEvent on resumeFromPause', () => {
    const state = makeNestingState({ phaseStatus: 'paused', prePauseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    store.resumeFromPause('proj-1')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'pipeline_unpause',
        decision: 'PASS',
        phase: expect.any(Number),
        depth: expect.any(Number),
        regression_counter_reset: true,
      }),
    )
  })

  // #128b — direct PipelineStore-level guard (supplements transitions-pn.test.ts:133 proxy).
  it('should reject resumeFromPause when status is not paused', () => {
    const state = makeNestingState({ phaseStatus: 'ralph_loop' })
    // P-007 (M): explicit /state branch — was catch-all mockReturnValue(state).
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return state
      return null
    })
    expect(() => store.resumeFromPause('proj-1')).toThrow(/not paused/i)
    // P-010: verify no partial state change before rejection.
    expect(mockStateStore.write).not.toHaveBeenCalled()
  })

})
