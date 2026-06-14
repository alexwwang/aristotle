import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState } from './helpers.js'

// NOTE: Mock-based integration tests (Red Phase). True component-interaction tests deferred to Green Phase.
// F-001: replaced 5 expect(true).toBe(false) stubs with real SUT invocations.

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
      return null
    })
    const storeFail = new PipelineStore(mockStateStore, mockLogger, {
      quarantineHook: vi.fn().mockImplementation(() => { throw new Error('hook failed') }),
    })
    storeFail.suspendActive('proj-1', 'test_modification')
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ quarantineSuccess: false }),
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
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ quarantineSuccess: expect.any(Boolean) }),
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
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        quarantinedFiles: expect.arrayContaining(['file1.ts', 'file2.ts']),
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
    const storeCrash = new PipelineStore(mockStateStore, mockLogger, {
      quarantineHook: vi.fn().mockReturnValue(undefined),
    })
    storeCrash.suspendActive('proj-1', 'test_modification')
    const writtenState = mockStateStore.write.mock.calls[0][1]
    // F-046: check key exists explicitly — objectContaining with undefined
    // may match objects where the key is absent entirely.
    expect('quarantineSuccess' in writtenState).toBe(true)
    expect(writtenState.quarantineSuccess).toBeUndefined()
  })
})
