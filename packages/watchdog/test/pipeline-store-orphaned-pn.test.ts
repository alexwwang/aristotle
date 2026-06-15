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

describe('PipelineStore - Orphaned Detection', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  describe('Orphaned Detection', () => {
  // #24
  it('should auto resume topmost pipeline when stack has entries but no active', () => {
    const entry = makeSuspendedPipeline({ runId: 'run-001', depth: 0 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      // P-007 (M): explicit /state branch — was catch-all return of stack.
      if (key.endsWith('/state')) return makeNestingState({
        runId: 'run-001',
        phaseStatus: 'suspended',
        preSuspendStatus: 'ralph_loop',
      })
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({ code: 'ORPHANED_SUSPEND_RECOVERY' }),
      }),
    )
  })

  // #25
  it('should clear childPipelineRunId during orphaned resume', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'child-123' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
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
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
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
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #28
  it('should silently pop stale stack entry when childRunId matches active', () => {
    const entry = makeSuspendedPipeline({ childRunId: 'run-active' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-active' }
      // P-001: explicit /suspended-stack branch — catch-all return masks
      // type confusion (returns a SuspendedStack for /state and other keys).
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('STALE_STACK_ENTRY_CLEANUP'),
    )
    // P-005: verify stack was actually popped (entry removed), not just logged.
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('/suspended-stack'),
      expect.objectContaining({ entries: [] }),
    )
  })

  // #29
  // F-017: explicit key matching — see #9 above.
  it('should update parent to preSuspendStatus when stack popped but state still suspended', () => {
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      // P-014: scope /state to project runId — see P-012 rationale.
      if (key.endsWith('/run-123/state')) return makeNestingState({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: 'ralph_loop' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      // P-019 (P): replace loose /recover/i with specific event code — the loose
      // regex could match 'ORPHANED_SUSPEND_RECOVERY' (wrong event for #29).
      expect.objectContaining({ event: expect.stringMatching(/^SUSPENDED_STATE_RECOVER/i) }),
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
      expect.stringMatching(/preSuspendStatus.*undefined|undefined.*preSuspendStatus/i),
    )
  })

  // #31
  it('should treat quarantineSuccess undefined as orphaned during suspend inconsistency', () => {
    const entry = makeSuspendedPipeline({ quarantineSuccess: undefined })
    // P-007 (M): explicit /suspended-stack branch — was catch-all return of stack.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // F-032 (MODIFY P): shared setup for #32/#32b — asymmetric audit-log assertions
  // (one asserts WAS called, other NOT called) prevent it.each parameterization.
  // F-022: shared state-write expect moved INTO each test body so failures point
  // at the specific test, not at the helper (better debuggability).
  function setupQuarantineInconsistency(quarantineSuccess: boolean) {
    const entry = makeSuspendedPipeline({ quarantineSuccess })
    // P-007 (M): explicit /state and /suspended-stack branches — was catch-all.
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/state')) return makeNestingState({ phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop' })
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    store.detectOrphanedSuspend('proj-1')
  }

  // #32
  it('should complete state update when quarantineSuccess false during inconsistency', () => {
    setupQuarantineInconsistency(false)
    // F-022: moved from helper — verifies recovery write occurred before audit assertion.
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
  it('should complete state update when quarantineSuccess true during inconsistency', () => {
    setupQuarantineInconsistency(true)
    // F-022: moved from helper — verifies recovery write occurred before audit assertion.
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

  // #116c — F-013: inclusive boundary coverage (companion to #116 exclusion test).
  // If implementation uses < 1 or > 8 instead of <= 1 or >= 8, this test catches it.
  it.each([1, 8])('should accept orphaned recovery at inclusive boundary suspendedPhase=%i', (validPhase) => {
    const entry = makeSuspendedPipeline({ suspendedPhase: validPhase })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      return makeSuspendedStack([entry])
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
  })

  // #116b — Multi-entry stop-iteration sub-test (AC-PN5)
  it('should stop iteration at topmost entry with invalid phase, leaving lower entries untouched', () => {
    const entryA = makeSuspendedPipeline({ runId: 'A', depth: 0, suspendedPhase: 5 })
    const entryB = makeSuspendedPipeline({ runId: 'B', depth: 1, suspendedPhase: 9 })
    // P-015: in-memory Map bridge so writes persist — without it, getSuspendedStack
    // always returns the seeded [entryA, entryB] regardless of impl modifications,
    // making the entryAResult assertion vacuous.
    const memStore = new Map<string, unknown>()
    const seedStack = makeSuspendedStack([entryA, entryB])
    mockStateStore.write.mockImplementation((k: string, v: unknown) => { memStore.set(k, v); return true })
    mockStateStore.read.mockImplementation((k: string) => {
      if (k.endsWith('/active')) return null
      if (k.endsWith('/suspended-stack')) return memStore.get(k) ?? seedStack
      return memStore.get(k) ?? null
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

})
