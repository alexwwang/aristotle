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

describe('PipelineStore - Stack Operations', () => {
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
    // F-003: in-memory Map bridge so writes persist across reads. Without this,
    // getSuspendedStack reads from the same blanket null mock as pushSuspended,
    // making the assertion unable to distinguish 'implementation works' from
    // 'implementation no-ops returning empty' (false-positive risk).
    const memStore = createMemStoreBridge(mockStateStore)
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
    // P-004: in-memory Map bridge so pushSuspended writes persist for
    // getSuspendedStack reads. Without it, reads return null and the
    // entries.toHaveLength(1) assertion fails for the wrong reason.
    const memStore = createMemStoreBridge(mockStateStore)
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
    // F-004: explicit /active branch BEFORE catch-all — without it, the catch-all
    // returns makeSuspendedStack for /active keys, causing type confusion.
    // F-019 (M): scope /state key with runId — generic suffix matching is fragile
    // when tests use multiple runIds; more-specific keys before generic suffixes.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      if (key.endsWith('/run-123/state')) return activeState
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
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
    // F-004: explicit /active branch BEFORE catch-all — see #3 above.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      // F-032: narrow key match from '/state' to '/run-123/state' — generic
      // suffix matching is fragile when the implementation probes multiple runIds.
      if (key.endsWith('/run-123/state')) return activeState
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow('depth')
    // F-023: stronger than regex-based negative matcher — suspendActive should
    // throw BEFORE any state mutation, so no write should have occurred at all.
    expect(mockStateStore.write).not.toHaveBeenCalled()
  })

  // F-036 (L): boundary complement to #3/#4 — depth=8 with 8 stack entries is the
  // last acceptable depth (new_child_depth=9 < MAX_DEPTH=10). Catches off-by-one.
  it('should accept canSuspend at depth=8 with 8 stack entries (boundary just below MAX_DEPTH)', () => {
    const entries = Array.from({ length: 8 }, (_, i) => makeSuspendedPipeline({ depth: i }))
    const activeState = makeNestingState({ depth: 8, phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      if (key.endsWith('/run-123/state')) return activeState
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    const result = store.canSuspend('proj-1')
    expect(result).toBe(true)
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
    const parentState = makeNestingState({ depth: 3, phaseStatus: 'ralph_loop', runId: 'parent-123' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      // P-012: scope /state to active runId — generic suffix match causes
      // type confusion when the impl probes other /state keys.
      if (key.endsWith('/parent-123/state')) return parentState
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
    // F-002: explicit /active and /state branches — without them, the blanket
    // null read causes suspendActive to fail with 'no active pipeline' before
    // reaching the write-order code path under test (wrong failure reason).
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      // P-013: scope /state to active runId — see P-012 rationale.
      if (key.endsWith('/run-123/state')) return makeNestingState({ phaseStatus: 'ralph_loop' })
      return null
    })
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
    // F-022 (M): verify recovery audit was emitted — mirrors #24 pattern at L456-461.
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ code: 'ORPHANED_SUSPEND_RECOVERY' }),
      }),
    )
  })

  // #10
  it('should detect no orphan when active pipeline matches stack top', () => {
    const entry = makeSuspendedPipeline({ depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      // F-010 (M): explicit /suspended-stack branch — was catch-all return of
      // makeSuspendedStack, which also returned a stack for /state, /audit, etc.
      // Same fix pattern as #28 (L270-273 above).
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).toBeNull()
  })
  }) // describe('Stack Operations')

  // #96
  it('should reject suspendActive when pipeline status is already suspended with error message', () => {
    const state = makeNestingState({ phaseStatus: 'suspended' })
    mockStateStore.read.mockReturnValue(state)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow(/already suspended/i)
    expect(mockStateStore.write).not.toHaveBeenCalled()
  })

  // #97
  it('should reject suspendActive when no active pipeline exists', () => {
    mockStateStore.read.mockReturnValue(null)
    expect(() => store.suspendActive('proj-1', 'test_modification')).toThrow(/no active pipeline/i)
    // P-006: verify no stack modification — spec #97 requires "no stack modification".
    expect(mockStateStore.write).not.toHaveBeenCalled()
  })

  // #150
  it('should default depth to 0 when field missing from stored state', () => {
    // F-027: use depth: 5 (not the default 0) before stripping — if depth
    // defaults to 0, omitting it and asserting 0 is a tautology. Setting 5
    // ensures the test actually verifies the missing-field defaulting path.
    const { depth: _omitted, ...rest } = makeNestingState({ depth: 5 })
    mockStateStore.read.mockReturnValue(rest)
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
