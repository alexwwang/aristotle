import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import { CheckpointHandler } from '../src/checkpoint.js'
import { STALE_THRESHOLD_MS } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState, PendingPause } from '../src/schema.js'
import { makeState, makeSuspendedPipeline, makeSuspendedStack, makeNestingState } from './helpers.js'

// NOTE: Mock-based integration tests (Red Phase). True component-interaction tests deferred to Green Phase.
// F-001: replaced 22 expect(true).toBe(false) stubs with real SUT invocations.
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

describe('crash recovery integration - pipeline nesting', () => {
  let store: PipelineStore

  // F-016: Spec coverage matrix correction — the following specs are PARTIAL,
  // not fully covered. Do NOT mark as covered in spec-coverage-matrix.md:
  //   #68  → PARTIAL (uses same fixture as #70, needs distinct scenario)
  //   #147 → PARTIAL (force=false branch not yet tested; see TODO at test site)
  //   #149 → PARTIAL (quarantineSuccess=undefined during suspend not yet tested)

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.readLog.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  // F-022: ensure fake timers never leak across tests.
  afterEach(() => {
    vi.useRealTimers()
  })

  // #67
  it('should recover suspended stack from crash', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      if (key.endsWith('/active')) return null
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(mockStateStore.write).toHaveBeenCalled()
    // P-006 (M): field-level assertions — verify recovered state matches
    // the persisted stack entry (runId, depth, phaseStatus).
    expect(result?.runId).toBe('parent-123')
    expect(result?.depth).toBe(0)
  })

  // #68-supplemental — F-029 (P): distinct from #70: childRunId is set in stack but child state
  // file is missing (vs #70 where childRunId is undefined). Tests dangling-reference detection.
  it('#68 — should handle childRunId set but child state file missing', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return null
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(mockStateStore.write).toHaveBeenCalled()
    // F-008: verify the implementation actually attempted to read child-456's state
    // (dangling-reference detection requires probing the child state file).
    expect(mockStateStore.read).toHaveBeenCalledWith(expect.stringContaining('child-456'))
  })

  // #69
  it('should pop stale stack entry if resume crashed after state persist', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'parent-123', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringMatching(/suspended-stack/),
      expect.objectContaining({ entries: expect.any(Array) }),
    )
  })

  // #70 — covers #68 (canonical) (crash before child started, childRunId undefined).
  it('#70 — should detect orphaned suspend when child not yet started', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: undefined })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('orphaned'),
    )
  })

  // #71
  it('should handle crash during resume state persisted but stack not popped', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/active')) return { runId: 'parent-123', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringMatching(/suspended-stack/),
      expect.objectContaining({ entries: [] }),
    )
  })

  // #72
  it('should handle crash during resume stack popped but state not persisted', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
    // P-002: spec #72 requires recovery event logged for audit trail
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: expect.stringMatching(/recovery|resume|crash.*recovery|STACK_POPPED/i),
      }),
    )
  })

  // #73
  it('should handle no parent state found at all after crash', () => {
    mockStateStore.read.mockReturnValue(null)
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).toBeNull()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringMatching(/CRITICAL.*(no.*parent.*state|state.*found|manual.*intervention)/i),
    )
    expect(mockStateStore.write).not.toHaveBeenCalled()
  })

  // #74
  it('should handle state persisted without stack', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
    // F-039: strengthen assertion with objectContaining
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ entries: expect.any(Array) }),
    )
    // P-003: distinguish recovery path — CRITICAL must NOT be logged
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/CRITICAL/i),
    )
  })

  // #75
  it('should handle crash between stack push and state persist', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return null
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #94
  // F-004: rewrite — old test duplicated #116 (phase validation). Spec #94
  // requires completely corrupted (unparseable) stack JSON, not phase=99.
  it('should log CRITICAL and create empty stack when stack JSON is completely corrupted', () => {
    const corruptedRaw = '{"runId":"parent-123", depth: BROKEN'
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return corruptedRaw
      return null
    })

    expect(() => store.detectOrphanedSuspend('proj-1')).toThrow(/corrupt|CRITICAL/i)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
    )
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(corruptedRaw),
    )
    // F-005: SuspendedStack schema is { entries: SuspendedPipeline[] }, not bare [].
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('/suspended-stack'),
      { entries: [] },
    )
  })

  // #105
  // F-026: use in-memory Map so writes persist across read calls (was fixed
  // mockImplementation that ignored writes — not a true integration test).
  // F-019: align memStore keys with implementation-generated format. The impl
  // writes 'watchdog/proj-1/...' but the test was setting 'proj-1/...' keys —
  // making all mocked data unreachable and the test a tautology. Use
  // prefix-tolerant read so both formats resolve to the same memStore entry.
  it('should preserve pending_pause through crash recovery and apply on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    // F-011: typed via satisfies PendingPause — no `as any`.
    const stateWithPause = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' }),
      pending_pause: { reason: 'PENDING', violation_type: 'REGRESSION', files: ['src/a.ts'] } satisfies PendingPause,
    }
    const memStore = new Map<string, unknown>()
    memStore.set('watchdog/proj-1/parent-123/state', stateWithPause)
    memStore.set('watchdog/proj-1/suspended-stack', makeSuspendedStack([entry]))
    mockStateStore.read.mockImplementation((key: string) => {
      const shortKey = key.replace(/^watchdog\//, '')
      return (memStore.get(key) ?? memStore.get(shortKey) ?? null) as unknown
    })
    mockStateStore.write.mockImplementation((key: string, value: unknown) => {
      memStore.set(key, value)
    })

    const restartedStore = new PipelineStore(mockStateStore, mockLogger)
    restartedStore.detectOrphanedSuspend('proj-1')
    const result = restartedStore.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused' }),
    )
  })

  // #106
  // F-022: use fake timers + deterministic timestamp (was Date.now() — fragile under CI delays).
  it('should preserve child_pause_timer_started_at through crash recovery and fire escalation if >30 min', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const oldTimestamp = new Date('2026-06-14T10:30:00Z').toISOString()
    const state = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' }),
      child_pause_timer_started_at: oldTimestamp,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/escalat|timeout|30.*min/i),
    )
    // F-038: verify escalation fires pause-timeout — parent transitions to 'paused'
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused' }),
    )
    // F-004: spec L695 canonical event name is 'pause_timeout_escalation', not 'pause_timeout'.
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pause_timeout_escalation', metadata: expect.objectContaining({ code: 'ESCALATION_FIRED' }) }),
    )
    // P-004: verify timer was PRESERVED through recovery in the paused-state write
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused', child_pause_timer_started_at: oldTimestamp }),
    )
  })

  // #118
  it('should reset regression counter per_cycle on pipeline resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    // F-005: spec says resumeSuspended resets the EXISTING counter via
    // getRegressionCounter().reset() — NOT by creating a new counter.
    // Mocking createRegressionCounter inverts the contract and lets Green Phase
    // implementations delete-and-recreate counters without detection.
    const existingCounter = { per_cycle_count: 3, reset: vi.fn() }
    store.getRegressionCounter = vi.fn().mockReturnValue(existingCounter)
    store.createRegressionCounter = vi.fn()
    store.resumeSuspended('proj-1', 'child-456')
    expect(existingCounter.reset).toHaveBeenCalledTimes(1)
    expect(existingCounter.reset).toHaveBeenCalledWith()
    expect(store.createRegressionCounter).not.toHaveBeenCalled()
    // F-043 (M): verify getRegressionCounter was called with the CORRECT runId
    // (parent-123, the parent being resumed — NOT child-456).
    expect(store.getRegressionCounter).toHaveBeenCalledWith('parent-123')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', regression_counter_reset: true }),
    )
  })

  // #119
  it('should reset regression counter per_cycle on pipeline unpause', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'paused', prePauseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    // P-013: verify the actual counter reset, not just the audit log entry.
    // Mirrors #118's pattern — mock getRegressionCounter so the test proves
    // reset() was invoked, not merely that the log entry was written.
    const existingCounter = { per_cycle_count: 3, reset: vi.fn() }
    store.getRegressionCounter = vi.fn().mockReturnValue(existingCounter)
    store.createRegressionCounter = vi.fn()
    store.resumeFromPause('proj-1')
    expect(existingCounter.reset).toHaveBeenCalledTimes(1)
    expect(existingCounter.reset).toHaveBeenCalledWith()
    expect(store.createRegressionCounter).not.toHaveBeenCalled()
    expect(store.getRegressionCounter).toHaveBeenCalledWith('parent-123')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_unpause', regression_counter_reset: true }),
    )
  })

  // #120
  it('should reset commit guard failures on pipeline resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const mockCommitGuard = { clearFailures: vi.fn() }
    Object.assign(store, { commitGuard: mockCommitGuard })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockCommitGuard.clearFailures).toHaveBeenCalledTimes(1)
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
  })

  // #121
  it('should reset commit guard failures on pipeline unpause', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'paused', prePauseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    // F-004: inject commitGuard mock BEFORE resumeFromPause, then assert
    // clearFailures was called exactly once. Without this assertion, Green Phase
    // can skip the clearFailures() call entirely and the test still passes.
    const mockCommitGuard = { clearFailures: vi.fn() }
    Object.assign(store, { commitGuard: mockCommitGuard })
    store.resumeFromPause('proj-1')
    expect(mockCommitGuard.clearFailures).toHaveBeenCalledTimes(1)
    // F-002: commitGuardFailures is owned by CommitGuard, not PipelineState (spec L256).
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
  })

  // #123
  // F-027: restructure metadata with runId fields and test
  // matched/unmatched/missing matrix (was single-entry, no runId association).
  it('should reconcile quarantine metadata with stack entries by runId', () => {
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([
        makeSuspendedPipeline({ runId: 'parent-123', childRunId: 'child-456' }),
        makeSuspendedPipeline({ runId: 'parent-456' }),
      ])
      if (key.includes('metadata')) {
        if (key.includes('hash1')) return { runId: 'parent-123', data: 'matched' }
        if (key.includes('hash2')) return { runId: 'orphan-789', data: 'unmatched' }
        if (key.includes('hash3')) return { runId: 'ghost-000', data: 'no-stack' }
      }
      if (key.endsWith('/active')) return null
      return null
    })
    mockStateStore.list.mockReturnValue([
      'metadata-hash1.json', 'metadata-hash2.json', 'metadata-hash3.json',
    ])

    store.detectOrphanedSuspend('proj-1')

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unmatched metadata'),
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('missing metadata'),
    )
    // P-018 (M): verify matched metadata (hash1/child-456) was preserved —
    // the impl should NOT warn about entries that match stack runIds.
    // P-005: scoped to metadata warnings only — parent-123 could appear in other legitimate warnings.
    const metadataWarningsWithParent = mockLogger.warn.mock.calls.filter(
      ([msg]: [string]) =>
        typeof msg === 'string' &&
        msg.includes('parent-123') &&
        (msg.includes('unmatched') || msg.includes('missing'))
    )
    expect(metadataWarningsWithParent).toHaveLength(0)
    // P-010 (M-13): removed quarantineSuccess:true write assertion — spec #123
    // only specifies metadata matching + WARN logging. Over-specifying risks
    // false failures if the impl doesn't write quarantineSuccess in this path.
  })

  // #130
  // P-005 (H): use fake timers + deterministic timestamp — wall-clock
  // dependence makes this test flaky under CI stalls.
  it('should resume child pause timer from stored timestamp when <30 min elapsed after crash', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const recentTimestamp = new Date('2026-06-14T11:50:00Z').toISOString()
    const state = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' }),
      child_pause_timer_started_at: recentTimestamp,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ child_pause_timer_started_at: recentTimestamp }),
    )
    // P-006: spec #130 — escalation must NOT fire when <30 min elapsed
    expect(mockStateStore.appendLog).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pause_timeout_escalation' }),
    )
  })

  // #139
  // F-001: make callback async + await handler.handle so the assertion runs
  // after the Promise resolves (not synchronously before).
  // F-002: assign removeRegressionCounter as vi.fn() — no source stub exists.
  it('should call RegressionCounter.remove for abandoned runId on force=true pipeline_start', async () => {
    const handler = new CheckpointHandler(store, STALE_THRESHOLD_MS, undefined, undefined, undefined, mockLogger)
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'abandoned-run', projectId: 'proj-1' }
      if (key.endsWith('/abandoned-run/state')) return makeNestingState({ runId: 'abandoned-run' })
      // P-016: spec #139 says 'Given orphaned suspended pipeline' — add
      // suspended-stack mock so orphaned entries exist for cleanup.
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([
        makeSuspendedPipeline({ runId: 'abandoned-run', depth: 0 }),
      ])
      return null
    })
    store.getRegressionCounter = vi.fn().mockReturnValue({ per_cycle_count: 3, total_count: 7 })
    store.removeRegressionCounter = vi.fn()
    await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'force restart', force: true }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    expect(store.removeRegressionCounter).toHaveBeenCalledWith('abandoned-run')
    // F-010: verify a fresh counter was created for the new run — but NOT for
    // the abandoned runId (would indicate the impl is re-creating the leak).
    // NOTE: 'no longer in memory' check intentionally omitted — vi.fn() mocks
    // don't reflect removeRegressionCounter side effects on getRegressionCounter.
    expect(store.createRegressionCounter).toHaveBeenCalled()
    expect(store.createRegressionCounter).not.toHaveBeenCalledWith('abandoned-run')
  })

  // P-004 (H): spec #147 and #149 dropped without replacement. Adding it.todo
  // stubs so coverage tracking shows the gap and Green Phase has explicit hooks.
  // #147: should allow fresh pipeline_start after orphaned recovery discards corrupted stack
  it.todo('#147 — should allow fresh pipeline_start after orphaned recovery discards corrupted stack')

  // #149: should use stack_length as authoritative depth during crash recovery when depth_field_diverges
  it.todo('#149 — should use stack_length as authoritative depth during crash recovery when depth_field_diverges')

  // (formerly annotated as #147) — covers corrupted-stack detection only (NOT the
  // fresh pipeline_start continuation required by #147).
  it('[unit] orphaned recovery detects corrupted stack and logs CRITICAL', () => {
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return '{ broken json :::'
      return null
    })
    expect(() => store.detectOrphanedSuspend('proj-1')).toThrow(/corrupt|CRITICAL/i)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
    )
  })

  // (formerly annotated as #149) — covers canSuspend divergence detection (NOT
  // crash-recovery stack_length authoritative depth required by #149).
  it('canSuspend detects depth metric divergence during crash recovery', () => {
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < 9; i++) {
      entries.push(makeSuspendedPipeline({ runId: `run-${i}`, depth: i }))
    }
    entries.push(makeSuspendedPipeline({ runId: 'run-corrupt', depth: 5 }))
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    const result = store.canSuspend('proj-1')
    expect(result).toBe(true)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('DEPTH_METRIC_DIVERGENCE'),
    )
  })

  // #160
  it('should clear child_pause_timer_started_at on pipeline resume from pause', () => {
    const state = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'paused', prePauseStatus: 'ralph_loop' }),
      child_pause_timer_started_at: new Date().toISOString(),
    }
    mockStateStore.read.mockReturnValue(state)
    store.resumeFromPause('proj-1')
    // F-014: expect.not.objectContaining passes even if key was never written.
    // Verify the field was actively cleared via read-back of the actual written state.
    const stateWrite = mockStateStore.write.mock.calls.find(
      ([key]: [string]) => key.endsWith('/state'),
    )
    expect(stateWrite).toBeDefined()
    const writtenState = stateWrite![1]
    expect(writtenState.child_pause_timer_started_at).toBeUndefined()
  })
})
