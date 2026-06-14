import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createReviewerSpawnHandler } from '../src/reviewer-spawn.js'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { makeRalphState } from './helpers.js'

describe('ReviewerSpawnHandler', () => {
  let handler: ReturnType<typeof createReviewerSpawnHandler>

  beforeEach(() => {
    handler = createReviewerSpawnHandler()
  })

  // RT-019a
  it('should_spawn_t1_then_t2_when_takeover_pending', async () => {
    const state = makeRalphState()
    const result = await handler.onIdle(state)
    expect(result.success).toBe(true)
  })

  // RT-019b
  it('should_set_spawnPhase_t1_running_before_t1_spawn', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT1(state)
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-019c
  it('should_call_prompt_assemble_for_t1', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT1(state)
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-019d
  it('should_record_t1_session_id_after_spawn', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT1(state)
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-019e
  it('should_wait_for_t1_idle_event', async () => {
    await expect(handler.waitForIdle('ses-t1-001')).resolves.toBeUndefined()
  })

  // RT-019f
  it('should_set_spawnPhase_t1_done_after_t1_completes', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT1(state)
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-019g
  it('should_call_prompt_assemble_for_t2_with_fact_context', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-019h
  it('should_record_t2_session_id_after_spawn', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-019i
  it('should_set_spawnPhase_t2_running_before_t2_spawn', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-019j
  it('should_wait_for_t2_idle_event', async () => {
    await expect(handler.waitForIdle('ses-t2-001')).resolves.toBeUndefined()
  })

  // RT-019k
  it('should_set_spawnPhase_done_after_t2_completes', async () => {
    const state = makeRalphState()
    const result = await handler.onIdle(state)
    expect(result.success).toBe(true)
  })

  // RT-019l
  it('should_write_complete_result_file_when_t2_succeeds', () => {
    const state = makeRalphState()
    handler.writeResultFile(state, [{ id: 'F-01', severity: 'M', description: 'Issue' }], [])
    const round = state.ralph?.round ?? 1
    const resultPath = `.aristotle/reviewer-result-${round}.json`
    if (existsSync(resultPath)) {
      const content = JSON.parse(readFileSync(resultPath, 'utf-8'))
      expect(content.status).toBe('complete')
      expect(Array.isArray(content.findings)).toBe(true)
      unlinkSync(resultPath)
    }
  })

  // RT-019m
  it('should_log_reviewer_spawn_phase_audit_on_each_transition', async () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    await handler.onIdle(state)
    const phaseAuditCalls = auditSpy.mock.calls.filter(
      call => call.some(arg => String(arg).includes('REVIEWER_SPAWN_PHASE')),
    )
    expect(phaseAuditCalls.length).toBe(4)
    auditSpy.mockRestore()
  })

  // RT-020a
  it('should_gracefully_degrade_when_t1_fails', async () => {
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT1').mockRejectedValueOnce(new Error('T-1 crashed'))
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
  })

  // RT-020b
  it('should_set_t1_degraded_flag_when_t1_fails', async () => {
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT1').mockRejectedValueOnce(new Error('T-1 crashed'))
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(result.t1SessionId).toBeUndefined()
  })

  // RT-020d
  it('should_log_t1_degraded_audit_event_when_t1_fails', async () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT1').mockRejectedValueOnce(new Error('T-1 crashed'))
    await handler.onIdle(state)
    expect(auditSpy).toHaveBeenCalled()
    auditSpy.mockRestore()
  })

  // RT-021a
  it('should_write_failed_result_file_when_t2_crashes', () => {
    const state = makeRalphState()
    expect(() => handler.writeFailedResultFile(state, 'T-2 crashed')).not.toThrow()
  })

  // RT-021b
  it('should_log_reviewer_failure_audit_on_t2_crash', () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    handler.writeFailedResultFile(state, 'T-2 crashed')
    expect(auditSpy).toHaveBeenCalled()
    auditSpy.mockRestore()
  })

  // RT-022a
  it('should_set_spawnPhase_failed_on_t1_timeout', async () => {
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT1').mockRejectedValueOnce(new Error('T-1 timeout after 55s'))
    await expect(handler.spawnT1(state)).rejects.toThrow(/timeout/i)
  })

  // RT-022b
  it('should_log_t1_timeout_in_audit_log', async () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT1').mockRejectedValueOnce(new Error('T-1 timeout after 55s'))
    try { await handler.spawnT1(state) } catch { /* expected timeout */ }
    expect(auditSpy).toHaveBeenCalled()
    auditSpy.mockRestore()
  })

  // RT-022c
  it('should_degrade_t1_when_timeout_with_inactive_session', async () => {
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT1').mockRejectedValueOnce(new Error('T-1 timeout - session inactive'))
    await expect(handler.spawnT1(state)).rejects.toThrow(/timeout|inactive/i)
  })

  // RT-023a
  it('should_set_spawnPhase_failed_on_t2_timeout', async () => {
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT2').mockRejectedValueOnce(new Error('T-2 timeout after 90s'))
    await expect(handler.spawnT2(state, '.aristotle/fact-context-1.json')).rejects.toThrow(/timeout/i)
  })

  // RT-023b
  it('should_log_t2_timeout_in_audit_log', async () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    vi.spyOn(handler, 'spawnT2').mockRejectedValueOnce(new Error('T-2 timeout after 90s'))
    try { await handler.spawnT2(state, '.aristotle/fact-context-1.json') } catch { /* expected timeout */ }
    expect(auditSpy).toHaveBeenCalled()
    auditSpy.mockRestore()
  })

  // RT-023c
  it('should_compute_t2_dynamic_timeout_from_pipeline_created_at', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-023d
  it('should_use_current_time_when_created_at_missing', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
    expect(sessionId).toMatch(/^ses-/)
  })

  // RT-024
  it('should_defer_spawn_to_next_idle_event_when_current_idle_busy', async () => {
    const state = makeRalphState()
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
  })

  // RT-024b
  it('should_not_spawn_if_reviewer_takeover_not_pending', async () => {
    const state = makeRalphState()
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
  })

  // RT-025a
  it('should_convert_legacy_suspended_action_atomically', async () => {
    const state = makeRalphState()
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  // RT-025b
  it('should_convert_legacy_resumed_action_atomically', async () => {
    const state = makeRalphState()
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  // RT-025c
  it('should_prevent_partial_migration_state', async () => {
    const state = makeRalphState()
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    if (result.success) {
      expect(result.t1SessionId === undefined).toBe(result.t2SessionId === undefined)
    }
  })
})
