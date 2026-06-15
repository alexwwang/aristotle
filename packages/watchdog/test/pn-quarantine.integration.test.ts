import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState, makeSuspendedPipeline, makeSuspendedStack, makeNestingState } from './helpers.js'

// NOTE: Mock-based integration tests (Red Phase). True component-interaction tests deferred to Green Phase.
// F-001: replaced 5 expect(true).toBe(false) stubs with real SUT invocations.



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

describe('quarantine integration - pipeline nesting', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.resetAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.readLog.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = createStore()
  })

  // #60
  it('should set quarantineSuccess false if quarantine hook fails', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      if (key.endsWith('/active')) return { runId: 'parent-123', projectId: 'proj-1' }
      return null
    })
    // P-001 (H): PipelineStore constructor only accepts (stateStore, logger) — the
    // 3rd `{ quarantineHook }` arg is silently ignored at runtime, so the hook would
    // never fire when Phase 5 implements suspendActive. Inject via test-only side
    // channel so the hook is actually reachable.
    const storeFail = new PipelineStore(mockStateStore, mockLogger)
    ;(storeFail as any).__testQuarantineHook = vi.fn().mockImplementation(() => { throw new Error('hook failed') })
    storeFail.suspendActive('proj-1', 'test_modification')
    // F-008: quarantineSuccess lives on SuspendedPipeline entries (inside the stack),
    // not on top-level PipelineState (schema L286 vs L29-85).
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('/suspended-stack'),
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ quarantineSuccess: false }),
        ]),
      }),
    )
    // P-008: spec #60 — log QUARANTINE_HOOK_FAILED_SUSPEND
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/QUARANTINE_HOOK_FAILED_SUSPEND|quarantine.*hook.*fail/i),
    )
  })
  // #61
  it('should proceed with resume when quarantineSuccess false', () => {
    const entry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456', quarantineSuccess: false,
    })
    const parentState = makeNestingState({
      runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result = store.resumeSuspended('proj-1', 'child-456')
    expect(result.phaseStatus).toBe('ralph_loop')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('RESUME_WARNING_QUARANTINE_FAILED'),
    )
  })

  // #62
  it('should handle partial quarantine during orphaned suspend', () => {
    const entry = makeSuspendedPipeline({
      runId: 'parent-123', depth: 0, childRunId: 'child-456', quarantineSuccess: undefined,
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    mockStateStore.list.mockReturnValue(['quarantine/in-progress.json'])
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    // F-008: quarantineSuccess is on the stack entry, not PipelineState.
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('/suspended-stack'),
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ quarantineSuccess: false }),
        ]),
      }),
    )
  })

  // #103
  it('should enumerate quarantine files via list_quarantine during child failure resume with fallback on I/O error', () => {
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
    mockStateStore.list.mockReturnValue(['.quarantine/file1.ts', '.quarantine/file2.ts'])
    store.resumeSuspended('proj-1', 'child-456')
    // F-017: match mock return values exactly — no spec mandates basename extraction.
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        quarantinedFiles: expect.arrayContaining(['.quarantine/file1.ts', '.quarantine/file2.ts']),
      }),
    )
  })

  // #148
  it('should proceed with child start when quarantine hook crashes returning undefined', () => {
    const state = makeNestingState({ runId: 'parent-123', phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return state
      return null
    })
    // P-001 (H): inject hook via test-only side channel — see #60 above.
    const storeCrash = new PipelineStore(mockStateStore, mockLogger)
    ;(storeCrash as any).__testQuarantineHook = vi.fn().mockReturnValue(undefined)
    storeCrash.suspendActive('proj-1', 'test_modification')
    const stackWrite = mockStateStore.write.mock.calls.find(
      ([key]: [string]) => key.endsWith('/suspended-stack')
    )
    expect(stackWrite).toBeDefined()
    const stackEntry = (stackWrite![1] as SuspendedStack).entries[0]
    expect('quarantineSuccess' in stackEntry).toBe(true)
    expect(stackEntry.quarantineSuccess).toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('quarantine'),
    )
  })

  // #103 — I/O error fallback variant
  it('#103 — fallback to empty array on list() I/O error', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childFailedState = makeNestingState({ runId: 'child-456', phaseStatus: 'failed', currentPhase: 4 })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/child-456/state')) return childFailedState
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    mockStateStore.list.mockImplementationOnce(() => { throw new Error('EIO') })
    store.resumeSuspended('proj-1', 'child-456')
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ quarantinedFiles: [] }),
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/quarantine.*list|list.*fail|fallback/i),
    )
  })
})
