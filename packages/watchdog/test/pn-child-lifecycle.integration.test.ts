import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState } from './helpers.js'

// NOTE: Mock-based integration tests (Red Phase). True component-interaction tests deferred to Green Phase.
// F-001: replaced 18 expect(true).toBe(false) stubs with real SUT invocations.
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

describe('child lifecycle integration - pipeline nesting', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.readLog.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  // #76
  it('should reject resume when child status is active', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childState = makeNestingState({ runId: 'child-456', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childState
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    expect(() => store.resumeSuspended('proj-1', 'child-456')).toThrow(/child.*active|active.*child/i)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', decision: 'BLOCK' }),
    )
  })

  // #77
  it('should reject resume when child has unfinished work', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childState = makeNestingState({
      runId: 'child-456', phaseStatus: 'ralph_loop', currentPhase: 3,
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    expect(() => store.resumeSuspended('proj-1', 'child-456')).toThrow(/unfinished|incomplete/i)
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
      }),
    )
  })

  // #81
  it('should handle child partial completion', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childPartialState = makeNestingState({
      runId: 'child-456', phaseStatus: 'complete', currentPhase: 3,
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
      expect.objectContaining({ event: expect.stringContaining('PARTIAL') }),
    )
  })

  // #90
  it('should display nested pipeline tree in status output', () => {
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

  // #112
  it('should query DEFERRED_PAUSE audit entries on resume and apply highest-priority deferred trigger', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
    const deferredEntries = [
      { event: 'DEFERRED_PAUSE', trigger_type: 'LOW', reason: 'PATTERN_CYCLE', timestamp: '2026-01-01T00:00:00Z' },
      { event: 'DEFERRED_PAUSE', trigger_type: 'HIGH', reason: 'FILE_SPLIT', timestamp: '2026-01-01T00:01:00Z' },
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
      expect.objectContaining({ pending_pause: expect.objectContaining({ reason: 'FILE_SPLIT' }) }),
    )
  })

  // #122
  it('should retry session info once on exception then proceed on second failure', () => {
    vi.useFakeTimers()
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return null
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    let callCount = 0
    store.getSessionInfo = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) throw new Error('transient')
      return { status: 'inactive' }
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(store.getSessionInfo).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(999)
    expect(store.getSessionInfo).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(store.getSessionInfo).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  // #126
  it('should apply pending pause pattern cycle intervention on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' }),
      pending_pause: { reason: 'PATTERN_CYCLE', violation_type: 'REGRESSION', files: ['src/a.ts'] } as any,
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
  })

  // #127
  it('should apply pending pause file split intervention on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' }),
      pending_pause: { reason: 'FILE_SPLIT', violation_type: 'SCOPE', files: ['src/big.ts'] } as any,
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
  })

  // #140
  it('should apply pending pause when preSuspendStatus is awaiting_approval on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'awaiting_approval' }),
      pending_pause: { reason: 'MANUAL', violation_type: 'PROCESS', files: [] } as any,
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
  })

  // #142
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
    store.handleConcurrentPauseTrigger('proj-1', 'concurrent_trigger')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runId: 'child-456', phaseStatus: 'paused' }),
    )
  })

  // #151
  it('should set pending_pause when pause trigger fires during suspension with no child', () => {
    const parentState = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    store.handleConcurrentPauseTrigger('proj-1', 'pause_trigger')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ pending_pause: expect.objectContaining({ reason: expect.any(String) }) }),
    )
  })

  // #152
  it('should apply pending_pause and ignore deferred_pause when both exist on resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const parentState = {
      ...makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' }),
      pending_pause: { reason: 'PENDING', violation_type: 'REGRESSION', files: ['src/a.ts'] } as any,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    mockStateStore.readLogSafe.mockReturnValue([
      { event: 'DEFERRED_PAUSE', trigger_type: 'LOW', reason: 'DEFERRED', timestamp: '2026-01-01T00:00:00Z' },
    ])
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused' }),
    )
  })

  // #154
  it('should clean up suspended stack when pipeline transitions to failed or cancelled', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'A', depth: 0 }),
      makeSuspendedPipeline({ runId: 'B', depth: 1 }),
    ]
    const state = makeNestingState({ runId: 'A', phaseStatus: 'failed' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return state
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    store.handlePhaseFail('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringMatching(/suspended-stack/),
      expect.objectContaining({ entries: expect.any(Array) }),
    )
  })

  // #156
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
    store.handlePhaseFail('proj-1', 'child-456')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runId: 'child-456', phaseStatus: 'cancelled' }),
    )
  })

  // #159
  it('should recurse through suspended chain to pause active grandchild', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'grandparent', depth: 0 }),
      makeSuspendedPipeline({ runId: 'parent', depth: 1, parentRunId: 'grandparent', childRunId: 'child' }),
      makeSuspendedPipeline({ runId: 'child', depth: 2, parentRunId: 'parent', childRunId: 'grandchild' }),
    ]
    const grandchildState = makeNestingState({ runId: 'grandchild', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/grandchild/state')) return grandchildState
      if (key.endsWith('/active')) return { runId: 'grandchild', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    store.handleConcurrentPauseTrigger('proj-1', 'recursive_trigger')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runId: 'grandchild', phaseStatus: 'paused' }),
    )
  })
})
