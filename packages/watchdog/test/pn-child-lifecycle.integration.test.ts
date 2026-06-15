import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState, PendingPause } from '../src/schema.js'
import { makeState, makeSuspendedPipeline, makeSuspendedStack, makeNestingState } from './helpers.js'

// NOTE: Mock-based integration tests (Red Phase). True component-interaction tests deferred to Green Phase.
// F-001: replaced 18 expect(true).toBe(false) stubs with real SUT invocations.
// Tests still fail in Red Phase because PipelineStore methods throw 'Not implemented'.



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

describe('child lifecycle integration - pipeline nesting', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.readLog.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  // F-014: ensure fake timers never leak across tests.
  afterEach(() => {
    vi.useRealTimers()
  })

  // #76
  it.each(['ralph_loop', 'active'])('should reject resume when child status is %s', (childStatus) => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childState = makeNestingState({ runId: 'child-456', phaseStatus: childStatus })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childState
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    // P-002 (H): broaden regex to include 'ralph_loop' — child state uses
    // phaseStatus='ralph_loop', so the impl error message likely includes it.
    expect(() => store.resumeSuspended('proj-1', 'child-456')).toThrow(/child.*active|active.*child|ralph_loop/i)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', decision: 'BLOCK' }),
    )
  })

  // #77 — F-003 (H): spec requires testing grandchild nesting: child should be
  // 'suspended' with a grandchild entry in its own suspended_stack, NOT ralph_loop.
  it('should reject resume when child has unfinished nested work', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const grandchild = makeSuspendedPipeline({ runId: 'grandchild-789', depth: 1 })
    const childState = makeNestingState({
      runId: 'child-456', phaseStatus: 'suspended', currentPhase: 3,
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childState
      if (key.endsWith('/child-456/suspended-stack')) return makeSuspendedStack([grandchild])
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    expect(() => store.resumeSuspended('proj-1', 'child-456')).toThrow(/grandchild|suspended_stack|nested/i)
    // P-003 (H): spec #77 requires CRITICAL log for grandchild rejection.
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
    )
  })

  // #78
  it('should reject resume when child state missing and session active', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return null
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.getSessionInfo = vi.fn().mockReturnValue({ status: 'active' })
    expect(() => store.resumeSuspended('proj-1', 'child-456')).toThrow(/session.*active|active.*session/i)
    // P-003 (H): spec #78 requires CRITICAL 'CHILD_SESSION_INFO_FAILED' log.
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringMatching(/CRITICAL|CHILD_SESSION_INFO_FAILED/i),
    )
  })

  // #79
  it('should proceed with resume when child state missing and session inactive', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = makeNestingState({
      runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return null
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.getSessionInfo = vi.fn().mockReturnValue({ status: 'inactive' })
    const result = store.resumeSuspended('proj-1', 'child-456')
    expect(result.phaseStatus).toBe('ralph_loop')
    // P-003 (H): spec #79 requires WARNING log when treating missing child as failure.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/child.*fail|session.*inactive|WARNING/i),
    )
  })

  // #80
  it('should handle child pipeline failure', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childFailedState = makeNestingState({
      runId: 'child-456', phaseStatus: 'failed', currentPhase: 4,
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childFailedState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        childRunId: 'child-456',
        failurePhase: expect.any(Number),
        failureReason: expect.any(String),
        quarantinedFiles: expect.any(Array),
        violationTypes: expect.any(Array),
      }),
    )
  })

  // #81
  it('should handle child partial completion', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    // F-015: spec #81 says 'child completed some phases before failing' → status is 'failed'.
    const childPartialState = makeNestingState({
      runId: 'child-456', phaseStatus: 'failed', currentPhase: 3,
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childPartialState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'phase_fail' }),
    )
    // P-010 (M): spec #81 requires "child's partial work preserved" — verify
    // the appendLog entry includes the child's completed phase (currentPhase=3).
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'phase_fail',
        childRunId: 'child-456',
        failurePhase: 3,
      }),
    )
  })

  // (Supplemental — stack entry linkage; NOT #90. See new #90 display test below.)
  it('should preserve nested parent-child linkage in stack entries', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'A', depth: 0 }),
      makeSuspendedPipeline({ runId: 'B', depth: 1, parentRunId: 'A', childRunId: 'child-B' }),
      makeSuspendedPipeline({ runId: 'C', depth: 2, parentRunId: 'B', childRunId: 'child-C' }),
    ]
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(3)
    expect(stack.entries[0].runId).toBe('A')
    expect(stack.entries[1].parentRunId).toBe('A')
    expect(stack.entries[2].parentRunId).toBe('B')
  })

  // #90
  // F-005: spec #90 requires display rendering with phase+status per level,
  // not just stack linkage. The test above was mislabeled #90.
  it('should display nested pipeline tree in status output with phase and status per level', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'A', depth: 0, suspendedPhase: 3 }),
      makeSuspendedPipeline({ runId: 'B', depth: 1, parentRunId: 'A', childRunId: 'child-B', suspendedPhase: 5 }),
      makeSuspendedPipeline({ runId: 'C', depth: 2, parentRunId: 'B', childRunId: 'child-C', suspendedPhase: 7 }),
    ]
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'C', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    const output = store.formatNestedStatus('proj-1')
    expect(output).toContain('A')
    expect(output).toContain('B')
    expect(output).toContain('C')
    expect(output).toMatch(/phase.*3\b/i)
    expect(output).toMatch(/phase.*5\b/i)
    expect(output).toMatch(/phase.*7\b/i)
    // F-008 (MODIFY H): hierarchy indicator proves parent→child→grandchild lineage rendering.
    expect(output).toMatch(/→|->|↳/)
    // TODO(Phase5): add per-level status assertion once SuspendedPipeline.status field lands
  })

  // #112
  // F-054: use spec-defined trigger types instead of generic HIGH/LOW.
  // F-033: add suspendedAt for temporal reference + negative assertion (compliance not applied).
  it('should query DEFERRED_PAUSE audit entries on resume and apply highest-priority deferred trigger', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', suspendedAt: '2025-12-31T23:59:00Z' }),
    }
    const deferredEntries = [
      // F-112 (L): add violation_type to entry 1 for symmetry with entry 2 —
      // PendingPause schema requires violation_type on all entries.
      { event: 'DEFERRED_PAUSE', trigger_type: 'compliance', violation_type: 'compliance', reason: 'compliance', timestamp: '2026-01-01T00:01:00Z' },
      // P-008 (M): align with PendingPause schema — violation_type (not trigger_type).
      { event: 'DEFERRED_PAUSE', trigger_type: 'UNFIXED_ISSUES', violation_type: 'UNFIXED_ISSUES', reason: 'unfixed', timestamp: '2026-01-01T00:00:00Z' },
    ]
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    mockStateStore.readLogSafe.mockReturnValue(deferredEntries)
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ pending_pause: expect.objectContaining({ violation_type: 'UNFIXED_ISSUES' }) }),
    )
    // F-033: verify compliance entry was NOT applied (lower priority than UNFIXED_ISSUES)
    expect(mockStateStore.write).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pending_pause: expect.objectContaining({ reason: 'compliance' }),
      }),
    )
  })

  // #122
  // F-014: add setSystemTime for deterministic behavior; afterEach handles cleanup.
  // F-013: handle both sync and async SUT architectures — Green Phase may
  // implement resumeSuspended as async (awaiting internal retry), which would
  // deadlock with frozen fake timers. This test works for both shapes.
  it('should retry session info once on exception then proceed on second failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return null
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    let callCount = 0
    // P-009 (M): capture timestamps to verify spec-required 1s delay between
    // the initial attempt and the retry.
    const callTimestamps: number[] = []
    store.getSessionInfo = vi.fn().mockImplementation(() => {
      callTimestamps.push(Date.now())
      callCount++
      if (callCount === 1) throw new Error('transient')
      return { status: 'inactive' }
    })
    const result = store.resumeSuspended('proj-1', 'child-456')
    if (result instanceof Promise) {
      await vi.advanceTimersByTimeAsync(5000)
    } else {
      vi.advanceTimersByTime(5000)
    }
    // F-011: single 5000ms advance covers both the initial check and the retry.
    // The old 999+1 split was brittle — it assumed a specific retry interval (1s)
    // which couples the test to an implementation detail.
    expect(store.getSessionInfo).toHaveBeenCalledTimes(2)
    // P-009 (M): spec #122 requires "1s delay" between attempts.
    const elapsedBetweenCalls = callTimestamps[1]! - callTimestamps[0]!
    expect(elapsedBetweenCalls).toBeGreaterThanOrEqual(1000)
    expect(elapsedBetweenCalls).toBeLessThanOrEqual(2000)
  })

  // #122 — persistent failure variant
  // F-122b (M): apply F-013 async-handling pattern from first #122 variant
  // (L295-328) — Green Phase may implement resumeSuspended as async, which
  // would deadlock with frozen fake timers unless we branch on Promise result.
  it('#122 — child failure path when session check fails persistently', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.getSessionInfo = vi.fn().mockImplementation(() => { throw new Error('persistent') })
    // F-001: invoke the SUT so getSessionInfo mock and warn fire — without this
    // call the mock is dead code and the test fails for the wrong reason.
    const result = store.resumeSuspended('proj-1', 'child-456')
    if (result instanceof Promise) {
      await vi.advanceTimersByTimeAsync(2000)
    } else {
      vi.advanceTimersByTime(2000)
    }
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/child.*fail|session.*unknown|treat.*child/i),
    )
    // F-013: enforce 'retry once' contract — max 2 getSessionInfo calls
    // (1 initial check + 1 retry). Implementation must not retry indefinitely.
    expect(store.getSessionInfo).toHaveBeenCalledTimes(2)
  })

  // #126
  it('should apply pending pause pattern cycle intervention on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' }),
      // F-007: align trigger types to spec enums. F-013: typed — no `as any`.
      pending_pause: { reason: 'pattern_cycle', violation_type: 'REGRESSION', files: ['src/a.ts'] } satisfies PendingPause,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          // F-040 (H): anchored regex — fixture uses reason='pattern_cycle', must NOT match FILE_SPLIT_NEEDED.
          interventionType: expect.stringMatching(/^PATTERN_CYCLE$/i),
        }),
      }),
    )
  })

  // #127
  it('should apply pending pause file split intervention on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' }),
      // F-006: spec SpecialViolationType is FILE_SPLIT_NEEDED, reason is file_too_large.
      // F-013: typed as PendingPause — no `as any`.
      pending_pause: { reason: 'file_too_large', violation_type: 'FILE_SPLIT_NEEDED', files: ['src/big.ts'] } satisfies PendingPause,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          // F-040 (H): anchored regex — fixture uses violation_type='FILE_SPLIT_NEEDED'.
          interventionType: expect.stringMatching(/^FILE_SPLIT_NEEDED$/i),
        }),
      }),
    )
  })

  // #140
  it('should apply pending pause when preSuspendStatus is awaiting_approval on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'awaiting_approval' }),
      // F-007: trigger values illustrative (not exercising trigger dispatch).
      pending_pause: { reason: 'pattern_cycle', violation_type: 'REGRESSION', files: [] } satisfies PendingPause,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          // F-040 (H): anchored regex — fixture uses reason='pattern_cycle'.
          interventionType: expect.stringMatching(/^PATTERN_CYCLE$/i),
        }),
      }),
    )
    expect(mockStateStore.write).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ pending_pause: undefined }))
  })

  // #142
  // F-014: REMOVED `store.handleConcurrentPauseTrigger = vi.fn()` override — let the
  // method throw 'Not implemented' so Red Phase failure points at the call site,
  // not at downstream assertions on write that never ran.
  // F-011: spec #142 requires verifying child_pause_timer_started_at, parent
  // pending_pause absence, and parent status remains suspended.
  it('should pause active child directly instead of setting pending_pause when concurrent pause trigger fires during suspension', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
    const childState = makeNestingState({ runId: 'child-456', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/child-456/state')) return childState
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    // P-014: spec #142 says "PATTERN_CYCLE violation fires on C" — use the
    // spec-defined trigger type, not a generic placeholder.
    store.handleConcurrentPauseTrigger('proj-1', 'PATTERN_CYCLE')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runId: 'child-456', phaseStatus: 'paused' }),
    )
    // F-011: child has pause timer started
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('child-456'),
      expect.objectContaining({
        phaseStatus: 'paused',
        child_pause_timer_started_at: expect.any(String),
      }),
    )
    // F-011: parent pending_pause is NOT set
    const parentWrites = mockStateStore.write.mock.calls.filter(
      ([key]) => key.includes('parent-123')
    )
    // F-007: length guard — without this, forEach over [] is a vacuous pass
    // (all assertions inside are never run, false-green risk).
    expect(parentWrites.length).toBeGreaterThan(0)
    parentWrites.forEach(([, value]) => {
      expect((value as any).pending_pause).toBeUndefined()
    })
    // F-011: parent status remains suspended
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('parent-123'),
      expect.objectContaining({ phaseStatus: 'suspended' }),
    )
  })

  // #151
  // F-014: REMOVED `store.handleConcurrentPauseTrigger = vi.fn()` override — see #142.
  // F-015: strengthen assertion — spec requires PATTERN_CYCLE reason, violation_type, files.
  it('should set pending_pause when pause trigger fires during suspension with no child', () => {
    const parentState = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    // P-015: spec #151 says "PATTERN_CYCLE violation fires" — use the
    // spec-defined trigger type, not a generic placeholder.
    store.handleConcurrentPauseTrigger('proj-1', 'PATTERN_CYCLE')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pending_pause: expect.objectContaining({
          reason: 'PATTERN_CYCLE',
          violation_type: expect.any(String),
          files: expect.any(Array),
        }),
      }),
    )
    // F-015: no child was spawned
    expect(mockStateStore.write).not.toHaveBeenCalledWith(
      expect.stringContaining('child-'),
      expect.anything(),
    )
  })

  // #152
  // F-008 (MODIFY): SPEC-AMBIGUITY — spec #152 says 'DEFERRED_PAUSE entries
  // ignored (not consumed)'. Unclear if 'ignored' means (a) no action at all,
  // or (b) logged as phase_fail then skipped. Test currently asserts (b) by
  // requiring phase_fail audit log. Revisit after spec clarification — do NOT
  // change assertion until spec intent is confirmed. Tracked as spec gap.
  it('should apply pending_pause and ignore deferred_pause when both exist on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' }),
      pending_pause: { reason: 'pending_pause', violation_type: 'REGRESSION', files: ['src/a.ts'] } satisfies PendingPause,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    mockStateStore.readLogSafe.mockReturnValue([
      { event: 'DEFERRED_PAUSE', trigger_type: 'compliance', reason: 'DEFERRED', timestamp: '2026-01-01T00:00:00Z' },
    ])
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused' }),
    )
    // F-007: DEFERRED_PAUSE entries must survive resumeSuspended — verify no
    // write call removed/replaced audit log entries, and the DEFERRED_PAUSE
    // audit entry was preserved (not silently cleared by implementation).
    expect(mockStateStore.write).not.toHaveBeenCalledWith(
      expect.stringMatching(/log|audit/i),
      expect.anything(),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'phase_fail',
        metadata: expect.objectContaining({ code: 'DEFERRED_PAUSE' }),
      }),
    )
  })

  // #154 — F-057: parameterized for both 'failed' AND 'cancelled' terminal statuses.
  // F-023: handlePhaseFail argument aligned with fixture runId ('child-456').
  // F-014: REMOVED `store.handlePhaseFail = vi.fn()` override — see #142.
  it.each(['failed', 'cancelled'])(
    'should clean up suspended stack when pipeline has reached %s status',
    (terminalStatus) => {
      const entries = [
        makeSuspendedPipeline({ runId: 'A', depth: 0, childRunId: 'B' }),
        makeSuspendedPipeline({ runId: 'B', depth: 1, childRunId: 'child-456' }),
      ]
      const state = makeNestingState({ runId: 'child-456', phaseStatus: terminalStatus })
      mockStateStore.read.mockImplementation((key: string) => {
        if (key.endsWith('/state')) return state
        if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
        return null
      })
      store.handlePhaseFail('proj-1', 'child-456')
      expect(mockStateStore.write).toHaveBeenCalledWith(
        expect.stringMatching(/suspended-stack/),
        expect.objectContaining({ entries: expect.arrayContaining([
          expect.objectContaining({ runId: 'A' }),
        ]) }),
      )
      // F-008: parent must NOT be auto-resumed after child cleanup — verify no
      // write transitions parent back to ralph_loop/active (would cause double-exec).
      expect(mockStateStore.write).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          runId: 'A',
          phaseStatus: expect.stringMatching(/ralph_loop|active/),
        }),
      )
    },
  )

  // #156
  // F-014: REMOVED `store.handlePhaseFail = vi.fn()` override — see #142.
  it('should cancel active child pipeline when suspended parent transitions to failed', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
    const childState = makeNestingState({ runId: 'child-456', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/child-456/state')) return childState
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.handlePhaseFail('proj-1', 'parent-123')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runId: 'child-456', phaseStatus: 'cancelled' }),
    )
    // F-009: audit entries required for BOTH parent phase_fail AND child CHILD_CANCELLED.
    // Without both, implementation can skip audit logging entirely (compliance gap).
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'phase_fail', runId: 'parent-123' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        runId: 'child-456',
        metadata: expect.objectContaining({ code: 'CHILD_CANCELLED' }),
      }),
    )
    expect(mockStateStore.write).toHaveBeenCalledWith(expect.stringMatching(/suspended-stack/), expect.objectContaining({ entries: expect.any(Array) }))
  })

  // #159
  // F-014: REMOVED `store.handleConcurrentPauseTrigger = vi.fn()` override — see #142.
  // F-032: spec #159 requires verifying intermediate pipelines' pending_pause
  // undefined and status suspended (not just grandchild paused).
  // F-003: verify active grandchild is NOT on the suspended stack (only
  // grandparent/parent/child are suspended). Active runner must not appear in
  // stack entries — otherwise fixture is self-contradictory.
  it('should recurse through suspended chain to pause active grandchild', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'grandparent', depth: 0 }),
      makeSuspendedPipeline({ runId: 'parent', depth: 1, parentRunId: 'grandparent', childRunId: 'child' }),
      makeSuspendedPipeline({ runId: 'child', depth: 2, parentRunId: 'parent', childRunId: 'grandchild' }),
    ]
    // F-003: grandchild must not appear as a stack entry — it is the active runner.
    expect(entries.some(e => e.runId === 'grandchild')).toBe(false)
    const grandchildState = makeNestingState({ runId: 'grandchild', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/grandchild/state')) return grandchildState
      if (key.endsWith('/active')) return { runId: 'grandchild', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    // P-016: spec uses PATTERN_CYCLE as the canonical trigger type for
    // concurrent pause scenarios — use it instead of a generic placeholder.
    store.handleConcurrentPauseTrigger('proj-1', 'PATTERN_CYCLE')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runId: 'grandchild', phaseStatus: 'paused' }),
    )
    // F-032: grandchild has pause timer
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('grandchild'),
      expect.objectContaining({
        phaseStatus: 'paused',
        child_pause_timer_started_at: expect.any(String),
      }),
    )
    // F-032: parent and child pending_pause remains undefined, status suspended
    for (const runId of ['parent', 'child']) {
      const writes = mockStateStore.write.mock.calls.filter(
        ([key]) => key.includes(runId)
      )
      // F-007: length guard — see #142 above. forEach over [] is vacuous.
      expect(writes.length).toBeGreaterThan(0)
      writes.forEach(([, value]) => {
        expect((value as any).pending_pause).toBeUndefined()
        expect((value as any).phaseStatus).toBe('suspended')
      })
    }
  })
})
