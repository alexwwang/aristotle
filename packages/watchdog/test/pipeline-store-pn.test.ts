import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { SuspendedPipeline, SuspendedStack, PipelineState, ChildFailureContext, PendingPause, ReviewerTakeoverState } from '../src/schema.js'
import { MAX_DEPTH } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'

import { makeState } from './helpers.js'

// Local factories (makeSuspendedPipeline / makeSuspendedStack / makeNestingState) are defined
// here because helpers.ts does not yet expose them and no other test file reuses them.
// When Phase 5 lands integration tests, promote these to helpers.ts for shared use.
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

function makeSuspendedStack(entries: SuspendedPipeline[]): SuspendedStack {
  return { entries }
}

function makeNestingState(overrides?: Partial<PipelineState>): PipelineState {
  return makeState({
    currentPhase: 5,
    phaseStatus: 'ralph_loop',
    depth: 0,
    suspendedReason: undefined,
    suspendedAt: undefined,
    suspendedPhase: undefined,
    preSuspendStatus: undefined,
    prePauseStatus: undefined,
    ...overrides,
  })
}

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
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

function createStore(): PipelineStore {
  // F-012: remove `as any` — mockStateStore already uses `satisfies StateStore`.
  return new PipelineStore(mockStateStore, mockLogger as Logger)
}

describe('PipelineStore - Pipeline Nesting', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  describe('Stack Operations', () => {
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
    // F-007: spec #1 explicitly lists suspendedAt as required — verify it is set
    // and is a valid ISO date string so Green Phase cannot omit it.
    expect(stack.entries[0].suspendedAt).toBeDefined()
    expect(new Date(stack.entries[0].suspendedAt!).getTime()).not.toBeNaN()
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
    const activeState = makeNestingState({ depth: 9, phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return activeState
      return makeSuspendedStack(entries)
    })
    const result = store.canSuspend('proj-1')
    expect(result).toBe(false)
  })

  // #4
  it('should reject via suspendActive before state change when depth exceeds MAX_DEPTH', () => {
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < MAX_DEPTH - 1; i++) {
      entries.push(makeSuspendedPipeline({ depth: i }))
    }
    const activeState = makeNestingState({ depth: 9, phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return activeState
      return makeSuspendedStack(entries)
    })
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow('depth')
    // F-011: verify no stack mutation occurred before the throw (replaces
    // circular length assertion that read from the same mock).
    expect(mockStateStore.write).not.toHaveBeenCalledWith(
      expect.stringMatching(/suspended-stack|\/stack/), expect.anything())
  })

  // #5
  it('should detect depth metric divergence and use parent.depth+1 (not stack.length+1)', () => {
    // F-003: divergent scenario — stack.length=9 (buggy path: 9+1=10 >= MAX_DEPTH → false)
    // vs parent.depth=3 (correct path: 3+1=4 < MAX_DEPTH → true). A correct impl returns
    // true; a buggy impl returns false. Only a divergent scenario can distinguish them.
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < 9; i++) {
      entries.push(makeSuspendedPipeline({ runId: `run-${i}`, depth: i }))
    }
    expect(entries).toHaveLength(9)
    const parentState = makeNestingState({ depth: 3, phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      if (key.endsWith('/state')) return parentState
      if (key.endsWith('/active')) return { runId: 'parent-123', projectId: 'proj-1' }
      return null
    })
    const result = store.canSuspend('proj-1')
    const warnCalls = mockLogger.warn.mock.calls
    const divergenceCall = warnCalls.find(c => typeof c[0] === 'string' && c[0].includes('DEPTH_METRIC_DIVERGENCE'))
    expect(divergenceCall).toBeDefined()
    expect(divergenceCall![0]).toContain('stack.length=9')
    expect(divergenceCall![0]).toContain('parent.depth=3')
    expect(result).toBe(true)
  })

  // #6
  it('should persist stack before state to prevent deadlock', () => {
    // F-031: flexible key matching — don't hardcode exact key format.
    const writeOrder: string[] = []
    mockStateStore.write.mockImplementation((key: string) => {
      writeOrder.push(key)
    })
    store.suspendActive('proj-1', 'test_modification')
    expect(writeOrder.length).toBeGreaterThanOrEqual(2)
    const stackWriteIdx = writeOrder.findIndex(k => k.includes('suspended-stack') || k.includes('/stack'))
    const stateWriteIdx = writeOrder.findIndex(k => k.endsWith('/state'))
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
  // F-001: verify meaningful orphan detection — assert actual SuspendedPipeline fields,
  // NOT phaseStatus (which doesn't exist on SuspendedPipeline type — tautological assertion).
  // F-017: explicit key matching — catch-all `return makeSuspendedStack([entry])` masks
  // wrong-project reads and pollutes cross-test state. Only return stack for
  // /suspended-stack keys; return null otherwise.
  it('should detect orphaned suspend when stack exists but no active pipeline', () => {
    const entry = makeSuspendedPipeline({ depth: 0, runId: 'orphan-run' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(result?.runId).toBe('orphan-run')
    expect(result?.depth).toBe(0)
    // Verify recovery state write occurred — orphan detection triggers state recovery
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'active' }),
    )
  })

  // #10
  it('should detect no orphan when active pipeline matches stack top', () => {
    const entry = makeSuspendedPipeline({ depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).toBeNull()
  })
  }) // describe('Stack Operations')

  describe('Suspend Flow', () => {
  // #11
  it('should set status to suspended and save preSuspendStatus', () => {
    const state = makeNestingState({ phaseStatus: 'ralph_loop' })
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
  // F-011: pass quarantine hook via constructor and verify hook is called
  // after state persistence (write). Constructor hook param exists in Red Phase.
  it('should call quarantine hook after state persistence', () => {
    const quarantineHook = vi.fn().mockReturnValue(true)
    const storeWithHook = new PipelineStore(mockStateStore as any, mockLogger as any, { quarantineHook })
    const state = makeNestingState()
    mockStateStore.read.mockReturnValue(state)
    storeWithHook.suspendActive('proj-1', 'test_modification')
    expect(quarantineHook).toHaveBeenCalled()
    // F-008: spec #13 requires hook fires after ALL writes complete — verify
    // against the LAST write call, not the first (resilient to multi-write impl).
    const writeOrders = mockStateStore.write.mock.invocationCallOrder
    expect(writeOrders.length).toBeGreaterThan(0)
    const lastWriteOrder = writeOrders[writeOrders.length - 1]
    const hookOrder = quarantineHook.mock.invocationCallOrder[0]
    expect(hookOrder).toBeGreaterThan(lastWriteOrder)
  })

  // #14
  it('should set childRunId on suspended entry after child pipeline starts', () => {
    const entry = makeSuspendedPipeline()
    store.pushSuspended('proj-1', entry)
    store.setChildRunId('proj-1', 'run-123', 'child-456')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries[0].childRunId).toBe('child-456')
  })

  // #87 (covered by #15): format suspend message with phase number and reason
  // #15
  it('should notify user of suspend with phase and reason', () => {
    const msg = store.formatSuspendMessage(5, 'test_modification')
    expect(msg).toContain('Phase 5')
    expect(msg).toContain('test_modification')
    expect(msg).toContain('Child pipeline may now be started')
  })

  // #16
  it('should pause active pipeline and save prePauseStatus', () => {
    const state = makeNestingState({ phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    store.pauseActive('proj-1')
    // F-006: key-filtered lookup — resilient to preliminary writes (audit log, etc.)
    const stateWrite = mockStateStore.write.mock.calls.find(
      ([k]: [string]) => k.endsWith('/state'),
    )
    expect(stateWrite).toBeDefined()
    const writtenState = stateWrite![1] as PipelineState
    expect(writtenState.phaseStatus).toBe('paused')
    expect(writtenState.prePauseStatus).toBe('ralph_loop')
    expect(writtenState.pausedAt).toEqual(expect.any(String))
    expect(new Date(writtenState.pausedAt!).getTime()).not.toBeNaN()
  })

  // #17
  it('should resume pipeline from paused state', () => {
    const state = makeNestingState({ phaseStatus: 'paused', prePauseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    const result = store.resumeFromPause('proj-1')
    expect(result.phaseStatus).toBe('ralph_loop')
    expect(result.prePauseStatus).toBeUndefined()
  })
  }) // describe('Suspend Flow')

  describe('Resume Flow', () => {
  // #18
  it('should restore parent status from preSuspendStatus', () => {
    const state = makeNestingState({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
    const entry = makeSuspendedPipeline({ childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
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
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    expect(() => store.resumeSuspended('proj-1', 'wrong-id')).toThrow(/child_run_id/i)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', decision: 'BLOCK' }),
    )
    // Spec #19: stack NOT popped on rejection — verify entry remains
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('run-123')
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
  }) // describe('Resume Flow')

  describe('Orphaned Detection', () => {
  // #24
  it('should auto resume topmost pipeline when stack has entries but no active', () => {
    const entry = makeSuspendedPipeline({ runId: 'run-001', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/state')) return makeNestingState({
        phaseStatus: 'suspended',
        preSuspendStatus: 'ralph_loop',
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
      if (key.endsWith('/active')) return null
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
      if (key.endsWith('/active')) return null
      return makeSuspendedStack([entry])
    })
    mockStateStore.list.mockReturnValue(['quarantine/metadata-abc.json'])
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(mockStateStore.list).toHaveBeenCalledWith(expect.stringContaining('quarantine'))
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('orphaned'),
    )
    // F-019: spec #26 requires BOTH quarantine dir check AND git status check.
    // Verify incomplete-state detection ran (logged git.status or incomplete.state).
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringMatching(/git.status|incomplete.state/i),
    )
  })

  // #27
  it('should skip verification for orphaned suspend with undefined childRunId', () => {
    const entry = makeSuspendedPipeline({ childRunId: undefined })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #28
  it('should silently pop stale stack entry when childRunId matches active', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'run-active' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-active' }
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('STALE_STACK_ENTRY_CLEANUP'),
    )
  })

  // #29
  // F-017: explicit key matching — see #9 above.
  it('should update parent to preSuspendStatus when stack popped but state still suspended', () => {
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return makeNestingState({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
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
    // F-017: explicit key matching — see #9 above.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/state')) return makeNestingState({
        phaseStatus: 'suspended',
        preSuspendStatus: undefined,
      })
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
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
      if (key.endsWith('/active')) return null
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #32
  // F-010: set preSuspendStatus:'ralph_loop' explicitly so the assertion on
  // phaseStatus:'ralph_loop' is self-consistent (not relying on quarantine path).
  it('should complete state update when quarantineSuccess false during inconsistency', () => {
    const entry = makeSuspendedPipeline({ quarantineSuccess: false })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return makeNestingState({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ code: 'QUARANTINE_HOOK_FAILED_SUSPEND', phase: expect.any(Number) }) }),
    )
  })

  // #32b
  // F-010: set preSuspendStatus:'ralph_loop' explicitly (same rationale as #32).
  it('should complete state update when quarantineSuccess true during inconsistency', () => {
    const entry = makeSuspendedPipeline({ quarantineSuccess: true })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return makeNestingState({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
    expect(mockStateStore.appendLog).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ code: 'QUARANTINE_HOOK_FAILED_SUSPEND' }) }),
    )
  })
  }) // describe('Orphaned Detection')

  describe('Reviewer Takeover Cleanup', () => {
  // #33
  it('should clear stale reviewer takeover state on suspend', () => {
    const state = {
      ...makeNestingState({ currentPhase: 5 }),
      // F-011: typed as ReviewerTakeoverState — no `as any`.
      reviewerTakeover: {
        round: 1, interceptAt: 'phase-5',
        t1SessionId: 'ses-t1', t2SessionId: 'ses-t2', resultFile: '/tmp/result.json',
        cleanupToken: 'tok-1', spawnPhase: 't2_running',
      } satisfies ReviewerTakeoverState,
    }
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_STALE_CLEANUP'),
    )
    // F-018: verify no substantive reviewerTakeover value in any write call
    // (convention-agnostic: works whether impl sets undefined or deletes key).
    const hasSubstantiveTakeover = mockStateStore.write.mock.calls.some(
      ([, s]: [string, Record<string, unknown>]) =>
        s && s.reviewerTakeover !== undefined && s.reviewerTakeover !== null)
    expect(hasSubstantiveTakeover).toBe(false)
  })

  // #34
  // F-029: use vi.spyOn on prototype instead of direct instance assignment for robustness.
  it('should defer reviewer takeover cleanup if t2 still running', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0, childRunId: 'child-456' })
    const mockState = {
      ...makeNestingState({ phaseStatus: 'suspended' }),
      // F-011: typed as ReviewerTakeoverState — no `as any`.
      reviewerTakeover: {
        round: 1, interceptAt: 'phase-5',
        t2SessionId: 'ses-t2-001', resultFile: '/tmp/result.json', cleanupToken: 'tok-1',
      } satisfies ReviewerTakeoverState,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return mockState
      return makeSuspendedStack([entry])
    })
    // F-003: direct vi.fn() assignment (not vi.spyOn) — getSessionInfo has no
    // source stub in Red Phase; spyOn on a non-existent method throws at setup.
    store.getSessionInfo = vi.fn().mockReturnValue({ status: 'active' })
    store.resumeSuspended('proj-1', 'child-456')
    expect(store.getSessionInfo).toHaveBeenCalledWith('ses-t2-001')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_DEFERRED'),
    )
  })

  // #35
  it('should delete stale reviewer result file during cleanup', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return {
        ...makeNestingState({ phaseStatus: 'suspended' }),
        reviewerTakeover: { t2SessionId: 'ses-t2-done', resultFile: '/tmp/stale-result.json', cleanupToken: 'tok-1', spawnPhase: '5' },
      }
      return makeSuspendedStack([entry])
    })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_STALE_CLEANUP'),
    )
    // F-033: verify the stale result file path appears in cleanup logging
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/stale-result.json'),
    )
  })

  // #36
  it('should handle race condition when reviewer result file deleted during polling', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0, childRunId: 'child-456' })
    let detectionDone = false
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) {
        const takeover = {
          ...makeNestingState({ phaseStatus: 'suspended' }),
          reviewerTakeover: { t2SessionId: 'ses-t2-done', resultFile: '/tmp/gone-result.json', cleanupToken: 'tok-1' },
        }
        if (!detectionDone) {
          detectionDone = true
          return takeover
        }
        return { ...takeover, reviewerTakeover: null }
      }
      return makeSuspendedStack([entry])
    })
    // F-029: explicit no-throw guarantee — cleanup continues despite race condition.
    expect(() => store.resumeSuspended('proj-1', 'child-456')).not.toThrow()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_RESULT_FILE_RACE'),
    )
  })
  }) // describe('Reviewer Takeover Cleanup')

  // #88
  // F-012: use word-boundary match to avoid coincidental match on 'incomplete'.
  it('should format resume message with child status and depth', () => {
    const msg = store.formatResumeMessage('complete', 0)
    expect(msg).toMatch(/\bcomplete\b/i)
    expect(msg).not.toMatch(/incomplete/i)
    expect(msg).toMatch(/depth.*0/i)
  })

  // #89
  // F-013: add phase/depth/metadata to AuditEntry schema assertion.
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
        phase: expect.any(Number),
        depth: expect.any(Number),
        metadata: expect.any(Object),
      }),
    )
  })

  // #91 — verifies write serialization and ordering; true concurrent access
  // testing requires async pushSuspended (future enhancement)
  // F-008: renamed to accurately reflect that this verifies sequential
  // serialization, not concurrent access.
  // F-023: PARTIAL — sequential writes tested. Concurrent access test deferred to Green Phase
  // when pushSuspended becomes async. See F-023.
  it('should serialize sequential stack writes with deterministic ordering (concurrent test deferred to async pushSuspended)', () => {
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
  // F-052: include metadata count and verify entry count matches stored metadata.
  it('should validate stack integrity on every read', () => {
    const entries = [
      makeSuspendedPipeline({ depth: 7 }),
      makeSuspendedPipeline({ depth: 3 }),
    ]
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return { entries, metadata: { count: 2 } }
      return null
    })
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(2)
    // F-006: verify insertion-order preservation (LIFO semantics) — entries
    // are returned in stored order (depth 7 first, depth 3 second), NOT sorted.
    expect(stack.entries[0].depth).toBe(7)
    expect(stack.entries[1].depth).toBe(3)
  })

  // #96
  it('should reject suspendActive when pipeline status is already suspended with error message', () => {
    const state = makeNestingState({ phaseStatus: 'suspended' })
    mockStateStore.read.mockReturnValue(state)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow(/already suspended/i)
  })

  // #97
  it('should reject suspendActive when no active pipeline exists', () => {
    mockStateStore.read.mockReturnValue(null)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow(/no active pipeline/i)
  })

  // #100
  // F-047: define named type for regression record fixture to avoid inline assertion.
  it('should deep copy parentRegressionHistory isolating child from parent mutations', () => {
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

  // #101
  it('should preserve pending_pause=null on PipelineState through suspendActive', () => {
    const state = { ...makeNestingState(), pending_pause: null }
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    // F-006: key-filtered lookup — resilient to preliminary writes (audit log, etc.)
    const stateWrite = mockStateStore.write.mock.calls.find(
      ([k]: [string]) => k.endsWith('/state'),
    )
    expect(stateWrite).toBeDefined()
    const writtenState = stateWrite![1]
    expect('pending_pause' in writtenState).toBe(true)
    expect(writtenState.pending_pause).toBeNull()
  })

  // #101 (cont.) — pending_pause=undefined preserved equivalently
  // F-014: assert behavioral equivalence with null variant (null or undefined,
  // not a substantive value).
  it('should preserve pending_pause=undefined on PipelineState through suspendActive', () => {
    const state = { ...makeNestingState(), pending_pause: undefined }
    mockStateStore.read.mockReturnValue(state)
    store.suspendActive('proj-1', 'test_modification')
    // F-006: key-filtered lookup — same pattern as null variant above.
    const stateWrite = mockStateStore.write.mock.calls.find(
      ([k]: [string]) => k.endsWith('/state'),
    )
    expect(stateWrite).toBeDefined()
    const writtenState = stateWrite![1]
    expect('pending_pause' in writtenState).toBe(true)
    expect(writtenState.pending_pause == null).toBe(true)
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
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childFailedState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/state')) return makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended' })
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
  // F-010: spec #104 requires a SINGLE notification containing all three pieces
  // (child-started + parent-123 + child-456) — not three fragmented logs.
  it('should emit child-started notification when childRunId is set on suspended parent', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0 })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    store.setChildRunId('proj-1', 'parent-123', 'child-456')
    // Capture all info calls containing 'child-started' and verify at least one
    // also contains both parent-123 AND child-456 (single combined notification).
    const childStartCalls = mockLogger.info.mock.calls.filter(
      (call: unknown[]) => {
        const msg = call?.[0]
        return typeof msg === 'string' && msg.includes('child-started')
      },
    )
    expect(childStartCalls.length).toBeGreaterThan(0)
    expect(
      childStartCalls.some((call: unknown[]) => {
        const msg = call?.[0]
        return typeof msg === 'string'
          && msg.includes('parent-123')
          && msg.includes('child-456')
      }),
    ).toBe(true)
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
    expect('pending_pause' in writtenState).toBe(true)
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

  // #116
  it.each([0, 9])('should reject orphaned recovery when suspendedPhase=%i outside 1-8 range', (invalidPhase) => {
    const entry = makeSuspendedPipeline({ suspendedPhase: invalidPhase })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      return makeSuspendedStack([entry])
    })
    // F-010: call detectOrphanedSuspend exactly once — multiple invocations
    // cause side effects (appendLog) to fire twice, making log assertions ambiguous.
    let thrownError: Error | undefined
    try {
      store.detectOrphanedSuspend('proj-1')
    } catch (e) {
      thrownError = e as Error
    }
    expect(thrownError).toBeDefined()
    expect(thrownError!.message).toMatch(/INVALID_PHASE/)
    expect(thrownError!.message).toContain(String(invalidPhase))
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      // 'INVALID_PHASE_RECOVERY' is not a CheckpointEvent — carry via metadata.code.
      expect.objectContaining({ event: 'pipeline_resume', metadata: expect.objectContaining({ code: 'INVALID_PHASE_RECOVERY', phase: invalidPhase }) }),
    )
  })

  // #116b — Multi-entry stop-iteration sub-test (AC-PN5)
  it('should stop iteration at topmost entry with invalid phase, leaving lower entries untouched', () => {
    const entryA = makeSuspendedPipeline({ runId: 'A', depth: 0, suspendedPhase: 5 })
    const entryB = makeSuspendedPipeline({ runId: 'B', depth: 1, suspendedPhase: 9 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      return makeSuspendedStack([entryA, entryB])
    })
    expect(() => store.detectOrphanedSuspend('proj-1')).toThrow(new RegExp('INVALID_PHASE.*9'))
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume', metadata: expect.objectContaining({ code: 'INVALID_PHASE_RECOVERY', phase: 9 }) }),
    )
    const stackWrites = mockStateStore.write.mock.calls.filter(
      ([key]: [string]) => key.endsWith('/suspended-stack'),
    )
    expect(stackWrites).toHaveLength(0)
    // F-024: verify entry A remains intact after the throw
    const postStack = store.getSuspendedStack('proj-1')
    const entryAResult = postStack.entries.find(e => e.runId === 'A')
    expect(entryAResult).toBeDefined()
    expect(entryAResult!.depth).toBe(0)
    expect(entryAResult!.suspendedPhase).toBe(5)
  })

  // #117
  it('should default to active when preSuspendStatus is terminal status during orphaned recovery', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/state')) return makeNestingState({
        phaseStatus: 'suspended',
        preSuspendStatus: 'failed',
      })
      return makeSuspendedStack([entry])
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'active' }),
    )
    // F-048: verify warning includes the TERMINAL_STATUS_RECOVERY_DEFAULT code
    // and the original terminal status value ('failed').
    // F-012: spec #117 ambiguous on combined-vs-separate warn calls — accept either
    // by joining all warn messages and matching both substrings against the union.
    const warnCalls = mockLogger.warn.mock.calls
      .map((call: unknown[]) => (typeof call?.[0] === 'string' ? call[0] : ''))
      .join('\n')
    expect(warnCalls).toMatch(/TERMINAL_STATUS_RECOVERY_DEFAULT/)
    expect(warnCalls).toMatch(/failed/)
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

  // #144
  it('should reject suspendActive when pipeline status is paused', () => {
    const state = makeNestingState({ phaseStatus: 'paused' })
    mockStateStore.read.mockReturnValue(state)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow(/paused/i)
    expect(mockStateStore.write).not.toHaveBeenCalled()
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

  // #128b — direct PipelineStore-level guard (supplements transitions-pn.test.ts:130 proxy).
  it('should reject resumeFromPause when status is not paused', () => {
    const state = makeNestingState({ phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockReturnValue(state)
    expect(() => store.resumeFromPause('proj-1')).toThrow(/not paused/i)
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
    expect(msg).toContain('Phase 5')
    expect(msg).toContain('orphaned suspend')
    expect(msg).toContain('crash recovery')
    // F-036: verify additional spec-required substrings
    expect(msg).toContain('child pipeline was never started')
    expect(msg).toContain('Phase continues from pre-suspend state')
  })
})
