import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import { CheckpointHandler } from '../src/checkpoint.js'
import { STALE_THRESHOLD_MS } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState } from './helpers.js'

// NOTE: Mock-based integration tests (Red Phase). True component-interaction tests deferred to Green Phase.
// F-001: replaced 22 expect(true).toBe(false) stubs with real SUT invocations.
// Tests still fail in Red Phase because PipelineStore methods throw 'Not implemented'.

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
  })

  // #68 — merged into #70 (identical fixture: childRunId undefined).
  // See #70 below for the merged test covering "crash before child started".

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

  // #70 — covers #68 (crash before child started, childRunId undefined).
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
  it('should preserve pending_pause through crash recovery and apply on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const stateWithPause = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' }),
      pending_pause: { reason: 'PENDING', violation_type: 'REGRESSION', files: ['src/a.ts'] } as any,
    }
    const memStore = new Map<string, any>()
    memStore.set('proj-1/parent-123/state', stateWithPause)
    memStore.set('proj-1/suspended-stack', makeSuspendedStack([entry]))
    mockStateStore.read.mockImplementation((key: string) => memStore.get(key) ?? null)
    mockStateStore.write.mockImplementation((key: string, value: any) => {
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
    const oldTimestamp = new Date('2026-06-14T11:29:00Z').toISOString()
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
    const mockRegressionCounter = { reset: vi.fn(), per_cycle_count: 0 }
    store.createRegressionCounter = vi.fn().mockReturnValue(mockRegressionCounter)
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockRegressionCounter.reset).toHaveBeenCalledTimes(1)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', regression_counter_reset: true }),
    )
  })

  // #119
  it('should reset regression counter per_cycle on pipeline unpause', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'paused', prePauseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    store.resumeFromPause('proj-1')
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
    store.resumeFromPause('proj-1')
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
        if (key.includes('hash1')) return { runId: 'child-456', data: 'matched' }
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
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ quarantineSuccess: true }),
    )
  })

  // #130
  it('should resume child pause timer from stored timestamp when <30 min elapsed after crash', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const recentTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString()
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
  })

  // #147
  // F-004: removed tautological startPipeline stub + assertions on that stub's
  // configured return value. The detectOrphanedSuspend coverage is valid; the
  // startPipeline fresh-run behavior should be tested separately in Green Phase.
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

  // #149
  it('should use stack_length as authoritative depth during crash recovery when depth_field_diverges', () => {
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
    store.detectOrphanedSuspend('proj-1')
    vi.clearAllMocks()
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
    expect('child_pause_timer_started_at' in writtenState).toBe(false)
  })
})
