import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState } from './helpers.js'

// F-001: replaced 22 expect(true).toBe(false) stubs with real SUT invocations.
// Tests still fail in Red Phase because PipelineStore methods throw 'Not implemented'.

function makeSuspendedPipeline(overrides?: Partial<SuspendedPipeline>): SuspendedPipeline {
  return {
    runId: 'parent-123',
    suspendedAt: '2026-06-06T12:00:00Z',
    suspendedPhase: 5,
    depth: 0,
    suspendedReason: 'test_modification',
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
      return null
    })
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('parent-123')
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
    expect(mockStateStore.write).toHaveBeenCalled()
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
    const state = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' }),
      pending_pause: { reason: 'PATTERN_CYCLE', violation_type: 'REGRESSION', files: ['src/a.ts'] } as any,
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
      expect.objectContaining({ pending_pause: expect.objectContaining({ reason: 'PATTERN_CYCLE' }) }),
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
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ quarantineSuccess: expect.any(Boolean) }),
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
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'abandoned-run', projectId: 'proj-1' }
      if (key.endsWith('/abandoned-run/state')) return makeNestingState({ runId: 'abandoned-run' })
      return null
    })
    store.resumeSuspended('proj-1', 'child-456', true)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: expect.stringContaining('REGRESSION_COUNTER'), action: 'remove' }),
    )
  })

  // #147
  it('should allow fresh pipeline_start after orphaned recovery discards corrupted stack', () => {
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).toBeNull()
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
    const result = store.canSuspend('proj-1')
    expect(result).toBe(true)
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
