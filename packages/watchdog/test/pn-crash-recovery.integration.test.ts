import { describe, it, expect, vi, beforeEach } from 'vitest'
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

  // #68
  it('should recover orphaned suspend after crash between suspend and child start', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: undefined })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
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

  // #70
  it('should handle crash during suspend stack pushed but child never started', () => {
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
      expect.objectContaining({ phaseStatus: expect.not.stringContaining('suspended') }),
    )
  })

  // #73
  it('should handle no parent state found at all after crash', () => {
    mockStateStore.read.mockReturnValue(null)
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).toBeNull()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
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
  it('should recover from storage corruption with manual intervention fallback', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, suspendedPhase: 99 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    expect(() => store.detectOrphanedSuspend('proj-1')).toThrow(/INVALID_PHASE|corrupt/i)
  })

  // #105
  it('should preserve pending_pause through crash recovery and apply on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const stateWithPause = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' }),
      pending_pause: { reason: 'PENDING', violation_type: 'REGRESSION', files: ['src/a.ts'] } as any,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return stateWithPause
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      if (key.endsWith('/active')) return null
      return null
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
  it('should preserve child_pause_timer_started_at through crash recovery and fire escalation if >30 min', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const oldTimestamp = new Date(Date.now() - 31 * 60 * 1000).toISOString()
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
    // F-038: verify pause-timeout audit entry was emitted
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pause_timeout', metadata: { code: 'ESCALATION_FIRED' } }),
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
    store.resumeSuspended('proj-1', 'child-456')
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
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ commitGuardFailures: 0 }),
    )
  })

  // #121
  it('should reset commit guard failures on pipeline unpause', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'paused', prePauseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    store.resumeFromPause('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ commitGuardFailures: 0 }),
    )
  })

  // #123
  it('should reconcile quarantine metadata on crash recovery', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456', quarantineSuccess: undefined })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    mockStateStore.list.mockReturnValue([
      'quarantine/metadata-hash1.json',
      'quarantine/metadata-hash2.json',
    ])
    store.detectOrphanedSuspend('proj-1')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unmatched metadata'),
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
  it('should call RegressionCounter.remove for abandoned runId on force=true pipeline_start', () => {
    const handler = new CheckpointHandler(store, STALE_THRESHOLD_MS, undefined, undefined, undefined, mockLogger)
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'abandoned-run', projectId: 'proj-1' }
      if (key.endsWith('/abandoned-run/state')) return makeNestingState({ runId: 'abandoned-run' })
      return null
    })
    store.getRegressionCounter = vi.fn().mockReturnValue({ per_cycle_count: 3, total_count: 7 })
    handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'force restart', force: true }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    expect(store.removeRegressionCounter).toHaveBeenCalledWith('abandoned-run')
  })

  // #147
  it('should allow fresh pipeline_start after orphaned recovery discards corrupted stack', () => {
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    const recoveryResult = store.detectOrphanedSuspend('proj-1')
    expect(recoveryResult).toBeNull()
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      return null
    })
    store.resumeFromPause = vi.fn()
    const startResult = store.startPipeline('proj-1', { description: 'fresh' })
    expect(startResult.depth).toBe(0)
    expect(startResult.runId).not.toBe('abandoned-run')
    expect(store.createRegressionCounter).toHaveBeenCalledWith(startResult.runId)
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
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ child_pause_timer_started_at: expect.any(String) }),
    )
  })
})
