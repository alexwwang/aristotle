import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { SuspendedPipeline, SuspendedStack, PipelineState, ChildFailureContext } from '../src/schema.js'

import { makeState } from './helpers.js'

function makeSuspendedPipeline(overrides?: Partial<SuspendedPipeline>): SuspendedPipeline {
  return {
    runId: 'run-123',
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

const MAX_DEPTH = 10
const PARTIAL_STACK_SIZE = 7

function makeSuspendedStack(entries: SuspendedPipeline[]): SuspendedStack {
  return { entries }
}

function makeNestingState(overrides?: Partial<PipelineState>): PipelineState {
  return makeState({
    currentPhase: 5,
    phaseStatus: 'ralph_loop' as PipelineState['phaseStatus'],
    depth: 0,
    suspendedReason: undefined,
    suspendedAt: undefined,
    suspendedPhase: undefined,
    preSuspendStatus: undefined,
    prePauseStatus: undefined,
    ...overrides,
  })
}

const mockStateStore = {
  read: vi.fn(),
  write: vi.fn(),
  appendLog: vi.fn(),
  readLogSafe: vi.fn().mockReturnValue([]),
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

function createStore(): PipelineStore {
  return new PipelineStore(mockStateStore as any, mockLogger as any)
}

describe('PipelineStore - Pipeline Nesting', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    store = createStore()
  })

  // #1
  it('should push entry to suspended stack when suspending active pipeline', () => {
    mockStateStore.read.mockReturnValue(null)
    const entry = makeSuspendedPipeline()
    store.pushSuspended('proj-1', entry)
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('run-123')
    expect(stack.entries[0].suspendedPhase).toBe(5)
    expect(stack.entries[0].depth).toBe(0)
    expect(stack.entries[0].suspendedReason).toBe('test_modification')
  })

  // #2
  it('should pop topmost entry from suspended stack when resuming', () => {
    const entryA = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    const entryB = makeSuspendedPipeline({ runId: 'B', depth: 1 })
    store.pushSuspended('proj-1', entryA)
    store.pushSuspended('proj-1', entryB)
    const popped = store.popSuspended('proj-1')
    expect(popped!.runId).toBe('B')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('A')
  })

  // #3
  it('should reject via canSuspend when new child depth exceeds MAX_DEPTH', () => {
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < MAX_DEPTH - 1; i++) {
      entries.push(makeSuspendedPipeline({ depth: i }))
    }
    mockStateStore.read.mockReturnValue(makeSuspendedStack(entries))
    const result = store.canSuspend('proj-1')
    expect(result).toBe(false)
  })

  // #4
  it('should reject via suspendActive before state change when depth exceeds MAX_DEPTH', () => {
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < MAX_DEPTH - 1; i++) {
      entries.push(makeSuspendedPipeline({ depth: i }))
    }
    mockStateStore.read.mockReturnValue(makeSuspendedStack(entries))
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow('depth')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(MAX_DEPTH - 1)
  })

  // #5
  it('should detect depth metric divergence and use computed depth', () => {
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < PARTIAL_STACK_SIZE; i++) {
      entries.push(makeSuspendedPipeline({ runId: `run-${i}`, depth: i }))
    }
    entries.push(makeSuspendedPipeline({ runId: 'run-corrupt', depth: 5 }))
    mockStateStore.read.mockReturnValue(makeSuspendedStack(entries))
    const result = store.canSuspend('proj-1')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('DEPTH_METRIC_DIVERGENCE'),
    )
    // Spec #5: computed depth = parent.depth+1 = 6; new_child_depth = 7 < MAX_DEPTH=10 → can suspend
    expect(result).toBe(true)
  })

  // #6
  it('should persist stack before state to prevent deadlock', () => {
    const writeOrder: string[] = []
    mockStateStore.write.mockImplementation((_key: string) => {
      writeOrder.push(_key)
    })
    const entry = makeSuspendedPipeline()
    store.pushSuspended('proj-1', entry)
    store.suspendActive('proj-1', 'test_modification')
    expect(writeOrder.length).toBeGreaterThanOrEqual(2)
    const stackWriteIdx = writeOrder.findIndex(k => k.includes('suspended') || k.includes('stack'))
    const stateWriteIdx = writeOrder.findIndex(k => k.includes('state') || k.includes('active'))
    expect(stackWriteIdx).toBeGreaterThanOrEqual(0)
    expect(stateWriteIdx).toBeGreaterThanOrEqual(0)
    expect(stackWriteIdx).toBeLessThan(stateWriteIdx)
  })

  // #7
  it('should get suspended stack from persistent storage', () => {
    const stack = makeSuspendedStack([makeSuspendedPipeline()])
    mockStateStore.read.mockReturnValue(stack)
    const result = store.getSuspendedStack('proj-1')
    expect(result.entries).toHaveLength(1)
  })

  // #8
  it('should return empty stack when no suspended stack exists', () => {
    mockStateStore.read.mockReturnValue(null)
    const result = store.getSuspendedStack('proj-1')
    expect(result.entries).toHaveLength(0)
  })

  // #9
  it('should detect orphaned suspend when stack exists but no active pipeline', () => {
    const entry = makeSuspendedPipeline({ depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #10
  it('should detect no orphan when active pipeline matches stack top', () => {
    const entry = makeSuspendedPipeline({ depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return { runId: 'run-123', projectId: 'proj-1' }
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).toBeNull()
  })

  // #11
  it('should set status to suspended and save preSuspendStatus', () => {
    const state = makeNestingState({ phaseStatus: 'ralph_loop' as any })
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' }),
    )
  })

  // #12
  it('should emit pipeline_suspend audit entry on success', () => {
    const state = makeNestingState()
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_suspend', decision: 'PASS' }),
    )
  })

  // #13
  it('should call quarantine hook after state persistence', () => {
    const state = makeNestingState()
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    expect(mockStateStore.write).toHaveBeenCalledBefore(mockLogger.info)
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('QUARANTINE'),
    )
  })

  // #14
  it('should set childRunId on suspended entry after child pipeline starts', () => {
    const entry = makeSuspendedPipeline()
    store.pushSuspended('proj-1', entry)
    store.setChildRunId('proj-1', 'run-123', 'child-456')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries[0].childRunId).toBe('child-456')
  })

  // #15
  it('should notify user of suspend with phase and reason', () => {
    const msg = store.formatSuspendMessage(5, 'test_modification')
    expect(msg).toContain('Phase 5')
    expect(msg).toContain('test_modification')
    expect(msg).toContain('Child pipeline may now be started')
  })

  // #16
  it('should pause active pipeline and save prePauseStatus', () => {
    const state = makeNestingState({ phaseStatus: 'ralph_loop' as any })
    mockStateStore.read.mockReturnValue(state)
    store.pauseActive('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'paused', prePauseStatus: 'ralph_loop' }),
    )
  })

  // #17
  it('should resume pipeline from paused state', () => {
    const state = makeNestingState({ phaseStatus: 'paused' as any, prePauseStatus: 'ralph_loop' as any })
    mockStateStore.read.mockReturnValue(state)
    const result = store.resumeFromPause('proj-1')
    expect(result.phaseStatus).toBe('ralph_loop')
  })

  // #18
  it('should restore parent status from preSuspendStatus', () => {
    const state = makeNestingState({ phaseStatus: 'suspended' as any, preSuspendStatus: 'ralph_loop' as any })
    mockStateStore.read.mockReturnValue(state)
    const result = store.resumeSuspended('proj-1', 'child-456')
    expect(result.phaseStatus).toBe('ralph_loop')
  })

  // #19
  it('should verify child runId matches topmost entry', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    expect(() => store.resumeSuspended('proj-1', 'wrong-id')).toThrow('child_run_id')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume' as any, decision: 'BLOCK' }),
    )
    // Spec #19: stack NOT popped on rejection — verify entry remains
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('run-123')
  })

  // #20
  it('should reject resume when intermediate pipelines exist', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'A', depth: 0 }),
      makeSuspendedPipeline({ runId: 'B', depth: 1 }),
    ]
    mockStateStore.read.mockReturnValue(makeSuspendedStack(entries))
    expect(() => store.resumeSuspended('proj-1', 'child-456')).toThrow('Intermediate pipelines exist')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'RESUME_GUARD_FAILURE' as any }),
    )
  })

  // #21
  it('should emit pipeline_resume audit entry on success', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    store.resumeSuspended('proj-1', 'child-123')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', decision: 'PASS' }),
    )
  })

  // #22
  it('should set childPipelineRunId on parent state before restore', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    store.resumeSuspended('proj-1', 'child-123')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ childPipelineRunId: 'child-123' }),
    )
  })

  // #23
  it('should clear suspended stack entry after successful resume', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    store.resumeSuspended('proj-1', 'child-123')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(0)
  })

  // #24
  it('should auto resume topmost pipeline when stack has entries but no active', () => {
    const entry = makeSuspendedPipeline({ depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      if (key.includes('state')) return makeNestingState({
        phaseStatus: 'suspended' as any,
        preSuspendStatus: 'ralph_loop' as any,
      })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
  })

  // #25
  it('should clear childPipelineRunId during orphaned resume', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ childPipelineRunId: undefined }),
    )
  })

  // #26
  it('should check quarantine dir and git status during orphaned detection', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('orphaned'),
    )
  })

  // #27
  it('should skip verification for orphaned suspend with undefined childRunId', () => {
    const entry = makeSuspendedPipeline({ childRunId: undefined })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #28
  it('should silently pop stale stack entry when childRunId matches active', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'run-active' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return { runId: 'run-active' }
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('STALE_STACK_ENTRY_CLEANUP'),
    )
  })

  // #29
  it('should update parent to preSuspendStatus when stack popped but state still suspended', () => {
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('state')) return makeNestingState({ phaseStatus: 'suspended' as any, preSuspendStatus: 'ralph_loop' as any })
      return makeSuspendedStack([])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
  })

  // #30
  it('should default preSuspendStatus to active when invalid during corruption recovery', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      if (key.includes('state')) return makeNestingState({
        phaseStatus: 'suspended' as any,
        preSuspendStatus: undefined,
      })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'active' }),
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('preSuspendStatus'),
    )
  })

  // #31
  it('should treat quarantineSuccess undefined as orphaned during suspend inconsistency', () => {
    const entry = makeSuspendedPipeline({ quarantineSuccess: undefined })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #32
  it('should complete state update when quarantineSuccess false during inconsistency', () => {
    const entry = makeSuspendedPipeline({ quarantineSuccess: false })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return makeNestingState({ phaseStatus: 'suspended' as any })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
  })

  // #32b
  it('should complete state update when quarantineSuccess true during inconsistency', () => {
    const entry = makeSuspendedPipeline({ quarantineSuccess: true })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return makeNestingState({ phaseStatus: 'suspended' as any })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
  })

  // #33
  it('should clear stale reviewer takeover state on suspend', () => {
    const state = {
      ...makeNestingState({ currentPhase: 5 }),
      reviewerTakeover: {
        t1SessionId: 'ses-t1', t2SessionId: 'ses-t2', resultFile: '/tmp/result.json',
        cleanupToken: 'tok-1', spawnPhase: '5',
      } as any,
    }
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_STALE_CLEANUP'),
    )
  })

  // #34
  it('should defer reviewer takeover cleanup if t2 still running', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('state')) return {
        ...makeNestingState({ phaseStatus: 'suspended' as any }),
        reviewerTakeover: { t2SessionId: 'ses-t2-active', resultFile: '/tmp/result.json', cleanupToken: 'tok-1' },
      }
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_DEFERRED'),
    )
  })

  // #35
  it('should delete stale reviewer result file during cleanup', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('state')) return {
        ...makeNestingState({ phaseStatus: 'suspended' as any }),
        reviewerTakeover: { t2SessionId: 'ses-t2-done', resultFile: '/tmp/stale-result.json', cleanupToken: 'tok-1', spawnPhase: '5' },
      }
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_STALE_CLEANUP'),
    )
  })

  // #36
  it('should handle race condition when reviewer result file deleted during polling', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('state')) return {
        ...makeNestingState({ phaseStatus: 'suspended' as any }),
        reviewerTakeover: { t2SessionId: 'ses-t2-done', resultFile: '/tmp/gone-result.json', cleanupToken: 'tok-1' },
      }
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_RESULT_FILE_RACE'),
    )
  })

  // #88
  it('should format resume message with child status and depth', () => {
    const msg = store.formatResumeMessage('complete', 0)
    expect(msg).toContain('complete')
    expect(msg).toMatch(/depth.*0/i)
  })

  // #89
  it('should emit audit entry with consistent schema for suspend', () => {
    const state = makeNestingState()
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'pipeline_suspend',
        decision: 'PASS',
        timestamp: expect.any(String),
        runId: 'run-123',
      }),
    )
  })

  // #91
  it('should handle concurrent stack access with serialized writes', () => {
    const entry = makeSuspendedPipeline()
    store.pushSuspended('proj-1', entry)
    store.pushSuspended('proj-1', makeSuspendedPipeline({ runId: 'run-456' }))
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(2)
    expect(stack.entries[0].runId).toBe(entry.runId)
    expect(stack.entries[1].runId).toBe('run-456')
    expect(mockStateStore.write).toHaveBeenCalledTimes(2)
  })

  // #92
  it('should validate stack integrity on every read', () => {
    const entries = [
      makeSuspendedPipeline({ depth: 7 }),
      makeSuspendedPipeline({ depth: 3 }),
    ]
    mockStateStore.read.mockReturnValue(makeSuspendedStack(entries))
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(2)
    expect(stack.entries[0].depth).toBeLessThan(stack.entries[1].depth)
  })

  // #96
  it('should reject suspendActive when pipeline status is already suspended with error message', () => {
    const state = makeNestingState({ phaseStatus: 'suspended' as any })
    mockStateStore.read.mockReturnValue(state)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow('Pipeline is already suspended')
  })

  // #97
  it('should reject suspendActive when no active pipeline exists', () => {
    mockStateStore.read.mockReturnValue(null)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow('No active pipeline to suspend')
  })

  // #100
  it('should deep copy parentRegressionHistory isolating child from parent mutations', () => {
    const history = [{ violation: 'V1', events: [{ id: 1 }] }]
    const entry = makeSuspendedPipeline({ parentRegressionHistory: history })
    store.pushSuspended('proj-1', entry)
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries[0].parentRegressionHistory).not.toBe(history)
    history[0].events[0].id = 999
    expect(stack.entries[0].parentRegressionHistory[0].events[0].id).not.toBe(999)
  })

  // #101
  it('should map InterventionResult.pendingPause to PipelineState.pending_pause with null-undefined equivalence', () => {
    const state = { ...makeNestingState(), pendingPause: null }
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    const writtenState = mockStateStore.write.mock.calls[0][1]
    expect('pending_pause' in writtenState).toBe(true)
    expect(writtenState.pending_pause).toBeNull()
  })

  // #102
  it('should validate ChildFailureContext on child failure resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        childRunId: expect.any(String),
        failurePhase: expect.any(Number),
        failureReason: expect.any(String),
        quarantinedFiles: expect.any(Array),
        violationTypes: expect.any(Array),
      }),
    )
  })

  // #104
  it('should emit child-started notification when childRunId is set on suspended parent', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0 })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    store.setChildRunId('proj-1', 'parent-123', 'child-456')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('child-started'),
    )
  })

  // #110
  it('should cancel child and resume parent via force=true on pipeline_resume', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return { runId: 'child-456', projectId: 'proj-1' }
      return makeSuspendedStack([entry])
    })
    const result = store.resumeSuspended('proj-1', 'child-456', true)
    expect(result.phaseStatus).toBe('active')
  })

  // #111
  it('should clear pending_pause on parent when force-resume cancels child', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.includes('state')) return makeNestingState({
        phaseStatus: 'suspended' as any,
        pending_pause: { reason: 'PATTERN_CYCLE', violation_type: 'REGRESSION', files: ['src/test.ts'] } as any,
      })
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456', true)
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ pending_pause: undefined }),
    )
  })

  // #114
  it('should create DEFERRED_PAUSE audit entries with correct schema', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0 })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    store.suspendActive('proj-1', 'test_modification')
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

  // #116
  it('should reject orphaned recovery when suspendedPhase outside 1-8 range', () => {
    const entry = makeSuspendedPipeline({ suspendedPhase: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entry])
    })
    expect(() => store.detectOrphanedSuspend('proj-1')).toThrow('INVALID_PHASE')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'INVALID_PHASE_RECOVERY' as any }),
    )
  })

  // #116b — Multi-entry stop-iteration sub-test (AC-PN5)
  it('should stop iteration at topmost entry with invalid phase, leaving lower entries untouched', () => {
    const entryA = makeSuspendedPipeline({ runId: 'A', depth: 0, suspendedPhase: 5 })
    const entryB = makeSuspendedPipeline({ runId: 'B', depth: 1, suspendedPhase: 9 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      return makeSuspendedStack([entryA, entryB])
    })
    expect(() => store.detectOrphanedSuspend('proj-1')).toThrow('INVALID_PHASE')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'INVALID_PHASE_RECOVERY' as any }),
    )
    // Spec #116b: A (depth=0) remains on stack untouched
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(2)
    expect(stack.entries.find(e => e.runId === 'A')).toBeDefined()
  })

  // #117
  it('should default to active when preSuspendStatus is terminal status during orphaned recovery', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.includes('active')) return null
      if (key.includes('state')) return makeNestingState({
        phaseStatus: 'suspended' as any,
        preSuspendStatus: 'failed' as any,
      })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'active' }),
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TERMINAL_STATUS_RECOVERY_DEFAULT'),
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
    expect(msg).toContain('child-456')
    expect(msg).toContain('ralph_loop_timeout')
  })



  // #144
  it('should reject suspendActive when pipeline status is paused', () => {
    const state = makeNestingState({ phaseStatus: 'paused' as any })
    mockStateStore.read.mockReturnValue(state)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow('paused')
  })

  // #146
  it('should emit pipeline_unpause CheckpointEvent on resumeFromPause', () => {
    const state = makeNestingState({ phaseStatus: 'paused' as any, prePauseStatus: 'ralph_loop' as any })
    mockStateStore.read.mockReturnValue(state)
    store.resumeFromPause('proj-1')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_unpause', decision: 'PASS' }),
    )
  })

  // #150
  it('should default depth to 0 when field missing from stored state', () => {
    const rawState = { ...makeNestingState() }
    delete (rawState as any).depth
    mockStateStore.read.mockReturnValue(rawState)
    const result = store.readState('proj-1', 'run-123')
    expect(result?.depth).toBe(0)
  })

  // #158
  it('should format orphaned recovery notification with crash recovery wording', () => {
    const msg = store.formatOrphanedRecoveryNotification(5, 2)
    expect(msg).toContain('orphaned suspend')
    expect(msg).toContain('crash recovery')
  })
})
