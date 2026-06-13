import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CheckpointHandler } from '../src/checkpoint.js'
import { formatPhaseStatus, PAUSE_TIMEOUT_MS } from '../src/pause-timeout-enforcer.js'
import { createMockStore, makeState } from './helpers.js'


function createHandler(storeOverrides: Record<string, any> = {}) {
  const store = createMockStore()
  Object.assign(store, storeOverrides)
  const handler = new CheckpointHandler(
    store as any,
    PAUSE_TIMEOUT_MS,
    undefined,
    undefined,
    undefined,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
  )
  return { handler, store }
}

describe('CheckpointHandler - pipeline nesting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // #55
  it('should route pipeline_suspend event to suspend handler', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' as any })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    store.suspendActive = vi.fn()
    const result = await handler.handle(
      'pipeline_suspend' as any,
      JSON.stringify({ reason: 'test_modification' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(store.suspendActive).toHaveBeenCalled()
  })

  // #56
  it('should route pipeline_resume event to resume handler', async () => {
    const { handler, store } = createHandler()
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const state = makeState({ phaseStatus: 'suspended' as any })
    store.readState.mockReturnValue(state)
    store.resumeSuspended = vi.fn()
    const result = await handler.handle(
      'pipeline_resume' as any,
      JSON.stringify({ child_run_id: 'child-456' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(store.resumeSuspended).toHaveBeenCalled()
  })

  // #57
  it('should validate event payload before routing', async () => {
    const { handler, store } = createHandler()
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_suspend' as any,
      JSON.stringify({}),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
  })

  // #58
  it('should emit audit entry for routed events', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' as any })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    await handler.handle(
      'pipeline_suspend' as any,
      JSON.stringify({ reason: 'test_modification' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    expect(store.appendAudit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'pipeline_suspend' as any }),
    )
  })

  // #59
  it('should handle unknown checkpoint event gracefully', async () => {
    const { handler, store } = createHandler()
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const state = makeState()
    store.readState.mockReturnValue(state)
    const result = await handler.handle(
      'pipeline_unknown' as any,
      JSON.stringify({}),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
  })

  // #93
  it('should rate-limit checkpoint event processing', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' as any })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    store.suspendActive = vi.fn()

    const results: string[] = []
    const RAPID_REQUEST_COUNT = 5
    for (let i = 0; i < RAPID_REQUEST_COUNT; i++) {
      const r = await handler.handle(
        'pipeline_suspend' as any,
        JSON.stringify({ reason: 'test_modification' }),
        { worktree: '/tmp/test', sessionID: 'ses-1' },
      )
      results.push(r)
    }
    // At least one should be rate-limited
    const parsed = results.map(r => JSON.parse(r))
    const rateLimited = parsed.filter(r => r.ok === false)
    expect(rateLimited.length).toBeGreaterThan(0)
  })

  // #99
  it('should block pipeline_start when active status is paused', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'paused' as any })
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
  })

  // #108
  it('should allow pipeline_start when active status is suspended for child nesting', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'suspended' as any })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'child pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
  })

  // #109
  it('should block pipeline_start when active status is active and already running', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'ralph_loop' as any, lastCheckpointAt: new Date().toISOString() })
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
    const state = makeState({ phaseStatus: 'awaiting_approval' as any })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'new pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
  })

  // #124
  it('should allow pipeline start when active status is terminal', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ phaseStatus: 'complete' as any })
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

  // #141
  it('should create fresh regression counter at 0 on normal pipeline start', async () => {
    const { handler, store } = createHandler()
    store.getActiveRun.mockReturnValue(null)
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'fresh pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(parsed.regressionCounter).toBe(0)
  })

  // #145
  it('should route pipeline_pause event to pauseActive', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' as any })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })
    store.pauseActive = vi.fn()

    const result = await handler.handle(
      'pipeline_pause' as any,
      JSON.stringify({ reason: 'manual_pause' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(store.pauseActive).toHaveBeenCalledWith('proj-1')
  })

  // #153
  it('should reject pipeline_pause event with invalid payload', async () => {
    const { handler, store } = createHandler()
    const state = makeState({ currentPhase: 5, phaseStatus: 'ralph_loop' as any })
    store.readState.mockReturnValue(state)
    store.getActiveRun.mockReturnValue({ runId: 'run-123', projectId: 'proj-1' })

    const result = await handler.handle(
      'pipeline_pause' as any,
      JSON.stringify({}),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(false)
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
    store.getActiveRun.mockReturnValue(null)
    const result = await handler.handle(
      'pipeline_start',
      JSON.stringify({ description: 'new pipeline' }),
      { worktree: '/tmp/test', sessionID: 'ses-1' },
    )
    const parsed = JSON.parse(result)
    expect(parsed.ok).toBe(true)
    expect(parsed.state.phaseStatus).toBe('idle')
  })
})
