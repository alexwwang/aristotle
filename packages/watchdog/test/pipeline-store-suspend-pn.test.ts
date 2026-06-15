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

describe('PipelineStore - Suspend Flow', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

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
  // P-001 (H): constructor ignores 3rd arg — inject hook via test-only side channel.
  it('should call quarantine hook after state persistence', () => {
    const quarantineHook = vi.fn().mockReturnValue(true)
    const storeWithHook = new PipelineStore(mockStateStore, mockLogger)
    ;(storeWithHook as any).__testQuarantineHook = quarantineHook
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
    // P-005: in-memory Map bridge so pushSuspended write persists for
    // getSuspendedStack read. Without it, entries[0].childRunId throws
    // because the stack is empty.
    const memStore = createMemStoreBridge(mockStateStore)
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
    // P-006: in-memory Map bridge so pushSuspended writes persist for
    // getSuspendedStack reads. Without it, entries.toHaveLength(2) fails
    // because reads return null. (Concurrent access deferral F-023 remains.)
    const memStore = createMemStoreBridge(mockStateStore)
    const entry = makeSuspendedPipeline()
    store.pushSuspended('proj-1', entry)
    store.pushSuspended('proj-1', makeSuspendedPipeline({ runId: 'run-456' }))
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(2)
    expect(stack.entries[0].runId).toBe(entry.runId)
    expect(stack.entries[1].runId).toBe('run-456')
    expect(mockStateStore.write).toHaveBeenCalledTimes(2)
  })

  // #92 — F-014 (M): renamed to reflect actual behavior. Verifies getSuspendedStack
  // returns entries in insertion order (not sorted). 'Integrity' here means count
  // metadata matches entries.length; depth-order is NOT validated (LIFO insertion
  // is tested in popSuspended #2).
  it('should preserve insertion order of suspended entries on read', () => {
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
    // verify insertion-order READ (LIFO is verified by popSuspended tests in #2)
    expect(stack.entries[0].depth).toBe(7)
    expect(stack.entries[1].depth).toBe(3)
  })

  // R47 F-2: spec #92 requires metadata.count validation — mismatch test
  it('should warn when entry count does not match stored metadata', () => {
    const entries = [
      makeSuspendedPipeline({ depth: 0 }),
      makeSuspendedPipeline({ depth: 1 }),
      makeSuspendedPipeline({ depth: 2 }),
    ]
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return { entries, metadata: { count: 2 } }
      return null
    })
    store.getSuspendedStack('proj-1')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/count.*mismatch|integrity|metadata/i),
    )
  })

  // #101
  it('should preserve pending_pause=null on PipelineState through suspendActive', () => {
    const state = { ...makeNestingState(), pending_pause: null }
    // P-007 (M): explicit branches — was catch-all mockReturnValue(state).
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      if (key.endsWith('/state')) return state
      return null
    })
    store.suspendActive('proj-1', 'test_modification')
    // F-006: key-filtered lookup — resilient to preliminary writes (audit log, etc.)
    const stateWrite = mockStateStore.write.mock.calls.find(
      ([k]: [string]) => k.endsWith('/state'),
    )
    expect(stateWrite).toBeDefined()
    const writtenState = stateWrite![1]
    expect(writtenState.pending_pause == null).toBe(true)
    // F-041 (H): verify audit-log fallback was emitted for pending_pause=null.
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ code: 'PENDING_PAUSE_FALLBACK' }),
      }),
    )
  })

  // #101 (cont.) — pending_pause=undefined preserved equivalently
  // F-014: assert behavioral equivalence with null variant (null or undefined,
  // not a substantive value).
  // F-011: removed `expect('pending_pause' in writtenState).toBe(true)` —
  // over-specifies internal representation. JSON serialization treats undefined
  // and null identically, so asserting key presence contradicts spec semantics.
  // Behavioral assertion (== null) is sufficient and still fails in Red Phase.
  it('should preserve pending_pause=undefined on PipelineState through suspendActive', () => {
    const state = { ...makeNestingState(), pending_pause: undefined }
    // P-007 (M): explicit branches — was catch-all mockReturnValue(state).
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      if (key.endsWith('/state')) return state
      return null
    })
    store.suspendActive('proj-1', 'test_modification')
    // F-006: key-filtered lookup — same pattern as null variant above.
    const stateWrite = mockStateStore.write.mock.calls.find(
      ([k]: [string]) => k.endsWith('/state'),
    )
    expect(stateWrite).toBeDefined()
    const writtenState = stateWrite![1]
    expect(writtenState.pending_pause == null).toBe(true)
    // F-041 (H): verify audit-log fallback emitted equivalently for pending_pause=undefined.
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ code: 'PENDING_PAUSE_FALLBACK' }),
      }),
    )
  })

  // #104
  // F-010: spec #104 requires a SINGLE notification containing all three pieces
  // (child-started + parent-123 + child-456) — not three fragmented logs.
  // F-002 (PARTIAL): spec #104 trigger is pipeline_start → CheckpointHandler →
  // setChildRunId flow, NOT direct store.setChildRunId(). Rewrite deferred to
  // Green Phase when CheckpointHandler pipeline_start wiring lands. Until then
  // this test exercises the wrong API surface (direct atomic setter).
  // TODO(spec#104): replace direct setter with pipeline_start flow once Phase 5 lands
  it('should emit child-started notification when childRunId is set on suspended parent [PARTIAL: F-002 wrong API]', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0 })
    mockStateStore.read.mockReturnValue(makeSuspendedStack([entry]))
    // F-002 PARTIAL: direct setter bypasses pipeline_start → CheckpointHandler flow
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

  // #144
  it('should reject suspendActive when pipeline status is paused', () => {
    const state = makeNestingState({ phaseStatus: 'paused' })
    mockStateStore.read.mockReturnValue(state)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow(/paused/i)
    expect(mockStateStore.write).not.toHaveBeenCalled()
    // P-007: spec #144 requires "audit entry logged" on paused rejection.
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: expect.stringMatching(/^(?!.*unpause)(?!.*escalat).*pause/i) }),
    )
  })

})
