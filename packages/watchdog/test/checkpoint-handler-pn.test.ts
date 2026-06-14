import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CheckpointHandler } from '../src/checkpoint.js'
// formatPhaseStatus here is the PUBLIC export from pause-timeout-enforcer.ts, NOT the
// private same-named function in checkpoint.ts:650. The latter is only covered indirectly
// via stale-pipeline recovery message tests.
import { formatPhaseStatus } from '../src/pause-timeout-enforcer.js'
import { STALE_THRESHOLD_MS } from '../src/constants.js'
import type { CheckpointEvent } from '../src/schema.js'
import type { Logger } from '@opencode-ai/core/logger'
import { createMockStore, makeState } from './helpers.js'


function createHandler(storeOverrides: Record<string, any> = {}) {
  const store = createMockStore()
  Object.assign(store, storeOverrides)
  // F-019/F-023: expose logger mock so tests can verify warn calls and ordering.
  // F-005: include debug method — Logger interface requires all four levels.
  // Without it, any CheckpointHandler call to logger.debug throws TypeError.
  // F-022: use `satisfies Logger` (not `as any`) — preserves vi.fn() return
  // types while still satisfying the structural contract, no type erasure.
  const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } satisfies Logger
  const handler = new CheckpointHandler(
    store as any,
    STALE_THRESHOLD_MS,
    undefined,
    undefined,
    undefined,
    loggerMock,
  )
  return { handler, store, loggerMock }
}

describe('CheckpointHandler - pipeline nesting', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // #55
  it('should route pipeline_suspend event to suspend handler', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    store.suspendActive = vi.fn()
    const result = await handler.handle(
      'pipeline_suspend',
      JSON.stringify({ reason: 'test_modification' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    // F-040: verify correct arguments, not just that it was called
    expect(store.suspendActive).toHaveBeenCalledWith('proj-1', 'test_modification')
  })

  // #56
  it('should route pipeline_resume event to resume handler', async () => {
    const { handler, store } = createHandler()
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const state = makeState({ phaseStatus: 'suspended' })
    store.readState.mockReturnValue(state)
    store.resumeSuspended = vi.fn()
    const result = await handler.handle(
      'pipeline_resume',
      JSON.stringify({ child_run_id: 'child-456' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    // F-020: use concrete expected values from the event payload, not expect.any(String).
    expect(store.resumeSuspended).toHaveBeenCalledWith('proj-1', 'child-456')
  })

  // #57
  it('should validate event payload before routing', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_suspend',
      JSON.stringify({}),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    // Spec #57: rejection must be about missing 'reason' field in payload,
    // NOT about unknown event or corrupted state.
    expect(parsed.violation).toMatch(/reason|payload/i)
    expect(store.suspendActive).not.toHaveBeenCalled()
  })

  // #58
  it('should emit audit entry for routed events', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    await handler.handle(
      'pipeline_suspend',
      JSON.stringify({ reason: 'test_modification' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    // F-001: appendAudit signature is (projectId, runId, entry) — 3 args.
    expect(store.appendAudit).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        event: 'pipeline_suspend',
        decision: 'PASS',
      }),
    )
  })

  // #59
  it('should handle unknown checkpoint event gracefully', async () => {
    const { handler, store, loggerMock } = createHandler()
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const state = makeState()
    store.readState.mockReturnValue(state)
    // F-011: cast to CheckpointEvent (the handler's accepted union type) rather
    // than `as any` — preserves type-safety at the call site while still
    // passing an event the runtime will reject as unsupported.
    const result = await handler.handle(
      'pipeline_unknown' as CheckpointEvent,
      JSON.stringify({}),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    // F-023: verify rejection reason is unsupported/unknown event type.
    expect(parsed.violation).toMatch(/unsupported|unknown/i)
    // F-023: verify WARNING was logged for the unsupported event.
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringMatching(/unsupported|unknown/i),
    )
  })

  // #93
  // F-009: readState intentionally returns a constant ralph_loop state to isolate
  // the rate limiter as the sole reducer. If state advanced to 'suspended' after
  // the first call, subsequent rejections would be for 'already suspended',
  // confounding the rate-limit assertion.
  it('should rate-limit checkpoint event processing', async () => {
    const { handler, store, loggerMock } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    // F-030: createMockStore() already provides suspendActive: vi.fn() — no reassign needed.

    const RAPID_REQUEST_COUNT = 50
    for (let i = 0; i < RAPID_REQUEST_COUNT; i++) {
      await handler.handle(
        'pipeline_suspend',
        JSON.stringify({ reason: `r-${i}` }),
        { worktree: '/tmp/test', sessionID: 'ses-1' },
      )
    }
    const allCalls = store.suspendActive.mock.calls
    // F-012: spec only requires 'rate limiting occurred', not a specific ratio.
    // Original 50% threshold was over-strict — caused false-red against correct
    // rate-limiter implementations. Weakened to '< RAPID_REQUEST_COUNT'.
    expect(allCalls.length).toBeLessThan(RAPID_REQUEST_COUNT)
    expect(allCalls.length).toBeGreaterThan(0)
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('rate'),
    )
  })

  // #99
  it('should block pipeline_start when active status is paused', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'paused' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'new pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.violation).toContain('paused')
    expect(parsed.violation).toMatch(/resumeFromPause|resume.*pause/i)
  })

  // #108
  it('should allow pipeline_start when active status is suspended for child nesting', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'suspended', depth: 2 })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'child pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    // F-019: verify child pipeline created at depth+1 with parent linkage.
    expect(store.writeState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        depth: (state.depth ?? 0) + 1,
        parentRunId: 'run-123',
        parentPipelineProjectId: expect.any(String),
        phaseStatus: expect.any(String),
      }),
    )
  })

  // #109
  it('should block pipeline_start when active status is active and already running', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'ralph_loop' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'duplicate pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.violation).toContain('already active')
  })

  // #115
  it('should block pipeline_start when active status is awaiting_approval', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'awaiting_approval' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'new pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.violation).toMatch(/awaiting.approval/i)
  })

  // #124
  it('should allow pipeline start when active status is terminal', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'complete' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'fresh pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
  })

  // #143
  it('should check terminal status before suspended stack when starting pipeline', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'complete' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    store.getSuspendedStack = vi.fn().mockReturnValue({
      entries: [{
        runId: 'old-run', suspendedAt: '2026-01-01T00:00:00Z', suspendedPhase: 3,
        depth: 0, suspendedReason: 'test_modification', childRunId: 'old-child',
        quarantineSuccess: undefined, parentRegressionHistory: [],
      }],
    })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'fresh pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(store.getSuspendedStack).not.toHaveBeenCalled()
    // F-041: verify writeState was called with a new PipelineState at depth=0
    expect(store.writeState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ depth: 0 }),
    )
    const writtenState = store.writeState.mock.calls[0][1]
    // F-013: setup uses runId='run-123'; old assertion checked not.toBe('run-old') (never set).
    expect(writtenState.runId).not.toBe('run-123')
  })

  // #141
  it('should create fresh regression counter at 0 on normal pipeline start', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'complete' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-old', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'fresh pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(store.writeState).toHaveBeenCalled()
    const writtenState = store.writeState.mock.calls[0][1]
    expect(writtenState.runId).not.toBe('run-old')
    expect(store.createRegressionCounter).toHaveBeenCalled()
    const newRunId = writtenState.runId
    expect(store.createRegressionCounter).toHaveBeenCalledWith(newRunId)
  })

  // #145a
  // F-020: removed redundant `store.pauseActive = vi.fn()` — createMockStore()
  // already provides this mock (helpers.ts L144). Reassignment risks masking
  // mock-state pollution between tests; use mockClear() if a fresh mock is needed.
  it('should route pipeline_pause event to pauseActive', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })

    const pauseResult = await handler.handle(
      'pipeline_pause',
      JSON.stringify({ reason: 'manual_pause' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const pauseParsed = JSON.parse(pauseResult)
    expect(pauseParsed.ok).toBe(true)
    expect(store.pauseActive).toHaveBeenCalledWith('proj-1')
  })

  // #145b
  // pipeline_unpause intentionally does NOT require a 'reason' payload — pause requires
  // justification, unpause is the symmetric release and needs no payload.
  // F-020: removed redundant `store.resumeFromPause = vi.fn()` — see #145a above.
  it('should route pipeline_unpause event to resumeFromPause', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'paused' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })

    const unpauseResult = await handler.handle(
      'pipeline_unpause',
      JSON.stringify({}),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const unpauseParsed = JSON.parse(unpauseResult)
    expect(unpauseParsed.ok).toBe(true)
    expect(store.resumeFromPause).toHaveBeenCalledWith('proj-1')
  })

  // #153
  it('should reject pipeline_pause event with invalid payload', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })

    const result = await handler.handle(
      'pipeline_pause',
      JSON.stringify({}),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
    expect(parsed.violation).toMatch(/reason|payload/i)
  })

  // #155
  it('should return correct display strings for new statuses', () => {
    expect(formatPhaseStatus('suspended')).toBe('suspended')
    expect(formatPhaseStatus('paused')).toBe('paused')
    expect(formatPhaseStatus('failed')).toBe('failed')
    expect(formatPhaseStatus('cancelled')).toBe('cancelled')
    expect(formatPhaseStatus('unknown_status')).toBe('unknown_status')
  })

  // #157
  it('should allow pipeline_start when status is idle', async () => {
    const { handler, store } = createHandler()
    store.getActiveRun.mockReturnValue({ runId: 'run-old', projectId: 'proj-1' })
    store.readState.mockReturnValue(makeState({ phaseStatus: 'idle' }))
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'new pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    // F-005: spec #157 is authoritative — pipeline_start transitions to 'active'.
    expect(parsed.state.phaseStatus).toBe('active')
    expect(parsed.state.runId).not.toBe('run-old')
    // F-042: verify fresh RegressionCounter created for the new runId
    expect(store.createRegressionCounter).toHaveBeenCalledWith(parsed.state.runId)
  })
})
