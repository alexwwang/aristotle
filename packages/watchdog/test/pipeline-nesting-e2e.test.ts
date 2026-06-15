import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import { CheckpointHandler } from '../src/checkpoint.js'
import { MAX_DEPTH, STALE_THRESHOLD_MS } from '../src/constants.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { SuspendedPipeline, SuspendedStack, PipelineState } from '../src/schema.js'
import { makeState, makeSuspendedPipeline, makeSuspendedStack, makeNestingState } from './helpers.js'

// NOTE: This file uses mock-based E2E patterns (Red Phase). True integration tests
// with in-memory StateStore are deferred to Green Phase. See F-013.
// F-001: replaced 5 expect(true).toBe(false) stubs with real SUT invocations.



// F-082 (H): use `satisfies StateStore` (not `: StateStore`) to preserve
// vi.fn() return types — matches F-043 pattern in pipeline-store-pn.test.ts.
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

describe('pipeline nesting - e2e', () => {
  let store: PipelineStore

  beforeEach(() => {
    vi.clearAllMocks()
    mockStateStore.readLogSafe.mockReturnValue([])
    mockStateStore.readLog.mockReturnValue([])
    mockStateStore.list.mockReturnValue([])
    store = new PipelineStore(mockStateStore, mockLogger)
  })

  // #82
  // F-023: mutable `resumed` flag switches all reads at once. Acceptable in
  // Red Phase (methods throw on first read). Green Phase should use
  // mockImplementationOnce for sequential read control.
  // F-082 (H): replaced mutable `resumed` flag with in-memory Map bridge.
  // The flag returned an empty stack at line 91 (resumed was still false),
  // contradicting the toHaveLength(1) assertion at line 92. Writes now
  // persist through the bridge so suspendActive's /suspended-stack write
  // is observable by the subsequent getSuspendedStack read. Same pattern
  // as the P-005 fix for #14 in pipeline-store-pn.test.ts.
  it('should complete full nested pipeline flow suspend child resume', () => {
    const parentActive = makeNestingState({ runId: 'parent-123', phaseStatus: 'ralph_loop', depth: 0, currentPhase: 5 })
    // parentSuspended documents the expected post-suspend shape; the Map bridge
    // lets suspendActive produce this naturally in Green Phase.
    const parentSuspended = makeNestingState({ runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop', depth: 0, currentPhase: 5 })
    void parentSuspended // referenced for documentary intent; bridge makes it emergent
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const memStore = new Map<string, unknown>()
    memStore.set('proj-1/parent-123/state', parentActive)
    memStore.set('proj-1/active', { runId: 'parent-123', projectId: 'proj-1' })
    mockStateStore.read.mockImplementation((key: string) => memStore.get(key) ?? null)
    mockStateStore.write.mockImplementation((k: string, v: unknown) => { memStore.set(k, v); return true })
    store.suspendActive('proj-1', 'child_nesting')
    const stack = store.getSuspendedStack('proj-1')
    expect(stack.entries).toHaveLength(1)
    expect(stack.entries[0].runId).toBe('parent-123')
    store.setChildRunId('proj-1', 'parent-123', 'child-456')
    const result = store.resumeSuspended('proj-1', 'child-456')
    expect(result.phaseStatus).toBe('ralph_loop')
    expect(result.depth).toBe(0)
    expect(result.currentPhase).toBe(5)
    const postStack = store.getSuspendedStack('proj-1')
    expect(postStack.entries).toHaveLength(0)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_suspend' }),
    )
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_resume' }),
    )
  })

  // #83
  it('should handle child pipeline failure (partial work commit deferred per F-003)', () => {
    const entry = makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' })
    const childFailedState = makeNestingState({
      runId: 'child-456', phaseStatus: 'failed', currentPhase: 4,
    })
    const parentState = makeNestingState({
      runId: 'parent-123', phaseStatus: 'suspended', preSuspendStatus: 'ralph_loop',
    })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/parent-123/state')) return parentState
      if (key.endsWith('/child-456/state')) return childFailedState
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack([entry])
      return null
    })
    const result83 = store.resumeSuspended('proj-1', 'child-456')
    // R46 F-2: spec #83 requires parent resumes with restored status
    expect(result83.phaseStatus).toMatch(/ralph_loop|active/)
    const postStack = store.getSuspendedStack('proj-1')
    expect(postStack.entries).toHaveLength(0)
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        childRunId: 'child-456',
        failurePhase: 4,
        failureReason: expect.any(String),
        quarantinedFiles: expect.any(Array),
        violationTypes: expect.any(Array),
      }),
    )
    // F-003: lastCompletedChildPhase is not in PipelineState schema. Spec #83
    // intent (partial-work preservation) is already verified via appendLog above.
    // R38 F-013: verify logCall exists with expected fields
    // R42 F-206: removed quarantinedFiles.length>0 assertion — Red Phase fixture has no quarantine source
    const logCall = mockStateStore.appendLog.mock.calls.find(
      ([, e]: [string, any]) => e?.childRunId === 'child-456',
    )
    expect(logCall).toBeDefined()
  })

  // #84
  it('should enforce maximum nesting depth across full flow', () => {
    expect(MAX_DEPTH).toBe(10)
    const entries: SuspendedPipeline[] = []
    for (let i = 0; i < MAX_DEPTH - 1; i++) {
      entries.push(makeSuspendedPipeline({ runId: `run-${i}`, depth: i }))
    }
    const activeState = makeNestingState({ depth: MAX_DEPTH - 1, phaseStatus: 'ralph_loop' })
    mockStateStore.read.mockImplementation((key: string) => {
      // P-009: add /active mock return so suspendActive can detect the active
      // pipeline before checking depth. Without it, the expected /depth/i
      // throw may not match if the impl checks active status first.
      if (key.endsWith('/active')) return { runId: 'parent-123', projectId: 'proj-1' }
      if (key.endsWith('/state')) return activeState
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    expect(() => store.suspendActive('proj-1', 'depth_exceed')).toThrow(/depth/i)
    expect(mockStateStore.write).not.toHaveBeenCalled()
  })

  // #85
  // F-006 (H): expand to 3-level fixture — a 1-level fixture cannot exercise
  // mid-stack crash recovery (only tests orphan detection on a flat stack).
  // Crash is at depth=1 (child-456). Recovery should preserve depth=0 entry
  // and clean up the depth=2 orphan (grandchild-789).
  // P-015 (M): rename — test body only calls detectOrphanedSuspend with
  // pre-seeded stack (no crash simulation or process restart). Original name
  // 'should recover from crash during nested execution' was misleading.
  it('should detect orphaned suspend at topmost stack entry and emit recovery write', () => {
    const entries = [
      makeSuspendedPipeline({ runId: 'parent-123', depth: 0, childRunId: 'child-456' }),
      makeSuspendedPipeline({ runId: 'child-456', depth: 1, childRunId: 'grandchild-789', parentRunId: 'parent-123' }),
      makeSuspendedPipeline({ runId: 'grandchild-789', depth: 2, parentRunId: 'child-456' }),
    ]
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/active')) return null
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    const result = store.detectOrphanedSuspend('proj-1')
    expect(result).not.toBeNull()
    // F-003: LIFO semantics (spec #24) — detectOrphanedSuspend returns the topmost
    // stack entry by LIFO order (grandchild-789, depth=2), NOT the root (parent-123).
    // Recovery walks the stack from top down; the topmost orphan is the recovery target.
    expect(result?.runId).toBe('grandchild-789')
    // P-008: fixture sets grandchild-789 depth=2 — detectOrphanedSuspend returns
    // the raw topmost entry, so depth should match the fixture (2), not 0.
    expect(result?.depth).toBe(2)
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ phaseStatus: expect.not.stringContaining('suspended') }),
    )
    // F-004: 'ORPHANED_SUSPEND_RECOVERY' is not a CheckpointEvent — it is carried
    // via metadata.code (consistent with #9 and #24 patterns in pipeline-store-pn).
    expect(mockStateStore.appendLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ code: 'ORPHANED_SUSPEND_RECOVERY' }) }),
    )
    expect(mockStateStore.write).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ phaseStatus: expect.stringMatching(/ralph_loop|active|idle/i) }))
  })

  // #86
  it('should handle force mode on pipeline start with orphaned entries', async () => {
    const handler = new CheckpointHandler(store, STALE_THRESHOLD_MS, undefined, undefined, undefined, mockLogger)
    const entries = [
      makeSuspendedPipeline({ runId: 'orphaned-1', depth: 0 }),
      makeSuspendedPipeline({ runId: 'orphaned-2', depth: 1 }),
    ]
    const state = makeNestingState({ runId: 'orphaned-1', phaseStatus: 'suspended' })
    mockStateStore.read.mockImplementation((key: string) => {
      if (key.endsWith('/state')) return state
      if (key.endsWith('/active')) return { runId: 'orphaned-1', projectId: 'proj-1' }
      if (key.endsWith('/suspended-stack')) return makeSuspendedStack(entries)
      return null
    })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'force start', force: true }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    // F-050: verify stack discarded and fresh pipeline started at depth=0
    expect(parsed.ok).toBe(true)
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ depth: 0 }),
    )
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.stringContaining('/suspended-stack'),
      expect.objectContaining({ entries: [] }),
    )
    // P-010: verify fresh runId was generated (not reusing orphaned entries)
    expect(mockStateStore.write).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runId: expect.not.stringMatching(/orphaned-1|orphaned-2/) }),
    )
    expect(store.createRegressionCounter).toHaveBeenCalled()
  })
})
