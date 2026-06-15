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

describe('PipelineStore - Reviewer Takeover Cleanup', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

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
    // P-007 (M): explicit branches — was catch-all mockReturnValue(state)
    // which returns full PipelineState for /active keys (type confusion).
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return { runId: 'run-123', projectId: 'proj-1' }
      if (key.endsWith('/state')) return state
      return null
    })
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
      // P-001: add required `spawnPhase` field — schema.ts marks it as required
      // (no `?`), so `satisfies ReviewerTakeoverState` would fail compilation.
      reviewerTakeover: {
        round: 1, interceptAt: 'phase-5', spawnPhase: 't2_running',
        t2SessionId: 'ses-t2-001', resultFile: '/tmp/result.json', cleanupToken: 'tok-1',
      } satisfies ReviewerTakeoverState,
    }
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return mockState
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    // F-003: direct vi.fn() assignment (not vi.spyOn) — getSessionInfo has no
    // source stub in Red Phase; spyOn on a non-existent method throws at setup.
    store.getSessionInfo = vi.fn().mockReturnValue({ status: 'active' })
    store.resumeSuspended('proj-1', 'child-456')
    expect(store.getSessionInfo).toHaveBeenCalledWith('ses-t2-001')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_DEFERRED'),
    )
    // P-002: verify reviewerTakeover cleanup was deferred — no write should
    // clear the existing reviewerTakeover value to null/undefined.
    const cleanupWrites = mockStateStore.write.mock.calls.filter(
      ([, s]: [string, Record<string, unknown>]) =>
        s && 'reviewerTakeover' in s && s.reviewerTakeover == null,
    )
    expect(cleanupWrites).toHaveLength(0)
  })

  // #35
  it('should delete stale reviewer result file during cleanup', () => {
    const entry = makeSuspendedPipeline({ runId: 'A', depth: 0, childRunId: 'child-456' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return {
        ...makeNestingState({ phaseStatus: 'suspended' }),
        reviewerTakeover: { round: 1, interceptAt: 'phase-5', t2SessionId: 'ses-t2-done', resultFile: '/tmp/stale-result.json', cleanupToken: 'tok-1', spawnPhase: '5' },
      }
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
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
          reviewerTakeover: { round: 1, interceptAt: 'phase-5', spawnPhase: '5', t2SessionId: 'ses-t2-done', resultFile: '/tmp/gone-result.json', cleanupToken: 'tok-1' },
        }
        if (!detectionDone) {
          detectionDone = true
          return takeover
        }
        return { ...takeover, reviewerTakeover: null }
      }
      if (key.endsWith('/active')) return { runId: 'child-456', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    // F-029: explicit no-throw guarantee — cleanup continues despite race condition.
    expect(() => store.resumeSuspended('proj-1', 'child-456')).not.toThrow()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('TAKEOVER_RESULT_FILE_RACE'),
    )
    // P-003: verify cleanup continued after race detection — write should
    // have been called (cleanup not silently aborted after the race warning).
    // P-021 (P): filter to /state or /suspended-stack writes — any write counts
    // was too loose (audit/preliminary writes could pass vacuously).
    const substantiveWrite = mockStateStore.write.mock.calls.find(
      ([k]: [string]) => typeof k === 'string' && (k.endsWith('/state') || k.endsWith('/suspended-stack')),
    )
    expect(substantiveWrite).toBeDefined()
  })
  }) // describe('Reviewer Takeover Cleanup')

})
