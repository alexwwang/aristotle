import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createReviewerSpawnHandler } from '../src/reviewer-spawn.js'
import type { ReviewerSpawnResult } from '../src/reviewer-spawn.js'
import type { PipelineState } from '../src/schema.js'
import { existsSync, readFileSync, unlinkSync, mkdirSync } from 'fs'
import * as promptAssembleMod from '../src/prompt-assemble.js'
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
    const spy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    spy.mockImplementationOnce(() => {
      expect(state.reviewerTakeover?.spawnPhase).toBe('t1_running')
      return { action: 'execute_internal' } as any
    })
    try {
      const sessionId = await handler.spawnT1(state)
      expect(sessionId).toMatch(/^ses-/)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  // RT-019c
  it('should_call_prompt_assemble_for_t1', async () => {
    const state = makeRalphState()
    const spy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    try {
      const sessionId = await handler.spawnT1(state)
      expect(sessionId).toMatch(/^ses-/)
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'T-1' }))
    } finally {
      spy.mockRestore()
    }
  })

  // RT-019d
  it('should_record_t1_session_id_after_spawn', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT1(state)
    expect(sessionId).toMatch(/^ses-/)
    expect(state.reviewerTakeover?.t1SessionId).toBe(sessionId)
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
    expect(state.reviewerTakeover?.spawnPhase).toBe('t1_done')
  })

  // RT-019g
  it('should_call_prompt_assemble_for_t2_with_fact_context', async () => {
    const state = makeRalphState()
    const spy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    try {
      const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
      expect(sessionId).toMatch(/^ses-/)
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'T-2' }))
    } finally {
      spy.mockRestore()
    }
  })

  // RT-019h
  it('should_record_t2_session_id_after_spawn', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
    expect(sessionId).toMatch(/^ses-/)
    expect(state.reviewerTakeover?.t2SessionId).toBe(sessionId)
  })

  // RT-019i
  it('should_set_spawnPhase_t2_running_before_t2_spawn', async () => {
    const state = makeRalphState()
    const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
    expect(sessionId).toMatch(/^ses-/)
    expect(state.reviewerTakeover?.spawnPhase).toBe('t2_running')
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
    expect(state.reviewerTakeover?.spawnPhase).toBe('done')
  })

  // RT-019l
  it('should_write_complete_result_file_when_t2_succeeds', () => {
    const state = makeRalphState()
    handler.writeResultFile(state, [{ id: 'F-01', severity: 'M', description: 'Issue' }], [])
    const round = state.ralph?.round ?? 1
    const resultPath = `.aristotle/reviewer-result-${round}.json`
    try {
      expect(existsSync(resultPath)).toBe(true)
      const content = JSON.parse(readFileSync(resultPath, 'utf-8'))
      expect(content.status).toBe('complete')
      expect(Array.isArray(content.findings)).toBe(true)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
    }
  })

  // RT-019m
  it('should_log_reviewer_spawn_phase_audit_on_each_transition', async () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const state = makeRalphState()
      await handler.onIdle(state)
      const phaseAuditCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('REVIEWER_SPAWN_PHASE')),
      )
      expect(phaseAuditCalls.length).toBe(4)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-020a
  it('should_gracefully_degrade_when_t1_fails', async () => {
    const state = makeRalphState()
    // F-9: mock underlying transport, not the spawnT1 method under test
    vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
      throw new Error('T-1 crashed')
    })
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
  })

  // RT-020b
  it('should_set_t1_degraded_flag_when_t1_fails', async () => {
    const state = makeRalphState()
    // F-9: mock underlying transport so real spawnT1 runs and real error-handling executes
    vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
      throw new Error('T-1 crashed')
    })
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(result.t1Degraded).toBe(true)
    expect(result.t1SessionId).toBeUndefined()
    expect(result.t2SessionId).toBeDefined()
  })

  // RT-020d
  it('should_log_t1_degraded_audit_event_when_t1_fails', async () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const state = makeRalphState()
      // F-9: mock underlying transport so real spawnT1 runs and triggers degradation audit
      vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
        throw new Error('T-1 crashed')
      })
      await handler.onIdle(state)
      const degradedCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('REVIEWER_T1_DEGRADED')),
      )
      expect(degradedCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-021a
  it('should_write_failed_result_file_when_t2_crashes', () => {
    const state = makeRalphState()
    handler.writeFailedResultFile(state, 'T-2 crashed')
    const round = state.ralph?.round ?? 1
    const resultPath = `.aristotle/reviewer-result-${round}.json`
    try {
      expect(existsSync(resultPath)).toBe(true)
      const content = JSON.parse(readFileSync(resultPath, 'utf-8'))
      expect(content.status).toBe('failed')
      expect(content.error).toBe('T-2 crashed')
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
    }
  })

  // RT-021b
  it('should_log_reviewer_failure_audit_on_t2_crash', () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const state = makeRalphState()
      handler.writeFailedResultFile(state, 'T-2 crashed')
      const failureCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('REVIEWER_FAILURE')),
      )
      expect(failureCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-022a
  it('should_set_spawnPhase_failed_on_t1_timeout', async () => {
    const state = makeRalphState()
    // F-9: mock underlying transport, not the spawnT1 method under test.
    // Real spawnT1 runs and its error-handling sets spawnPhase='failed'.
    vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
      throw new Error('T-1 timeout after 55s')
    })
    try {
      await handler.spawnT1(state)
      expect.fail('expected spawnT1 to reject with timeout')
    } catch (e) {
      expect(String(e)).toMatch(/timeout/i)
    }
    expect(state.reviewerTakeover?.spawnPhase).toBe('failed')
  })

  // RT-022b
  it('should_log_t1_timeout_in_audit_log', async () => {
    // F-10: fake timers removed — the transport mock throws synchronously,
    // so there is no real timer to advance. The audit log fires on the
    // caught rejection path, not on a timer tick.
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const state = makeRalphState()
      vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
        throw new Error('T-1 timeout after 55s')
      })
      try {
        await handler.spawnT1(state)
      } catch { /* expected: transport rejects on timeout */ }
      const timeoutCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('T1_TIMEOUT')),
      )
      expect(timeoutCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-022c
  it('should_degrade_t1_when_timeout_with_inactive_session', async () => {
    // F-27: set up timeout + inactive session preconditions
    const state = makeRalphState()
    state.activeSubagentSession = undefined
    // F-9: mock underlying transport to throw timeout for T-1; real onIdle runs and degrades
    vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
      throw new Error('T-1 timeout after 55s')
    })
    const result = await handler.onIdle(state)
    expect(result.success).toBe(true)
    expect(result.t1Degraded).toBe(true)
    expect(result.t2SessionId).toBeDefined()
  })

  // RT-023a
  it('should_set_spawnPhase_failed_on_t2_timeout', async () => {
    const state = makeRalphState()
    // F-9: mock underlying transport, not the spawnT2 method under test.
    vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
      throw new Error('T-2 timeout after 90s')
    })
    try {
      await handler.spawnT2(state, '.aristotle/fact-context-1.json')
      expect.fail('expected spawnT2 to reject with timeout')
    } catch (e) {
      expect(String(e)).toMatch(/timeout/i)
    }
    expect(state.reviewerTakeover?.spawnPhase).toBe('failed')
  })

  // RT-023b
  it('should_log_t2_timeout_in_audit_log', async () => {
    // F-10: fake timers removed — the transport mock throws synchronously.
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const state = makeRalphState()
      vi.spyOn(promptAssembleMod, 'promptAssemble').mockImplementationOnce(() => {
        throw new Error('T-2 timeout after 90s')
      })
      try {
        await handler.spawnT2(state, '.aristotle/fact-context-1.json')
      } catch { /* expected: transport rejects on timeout */ }
      const timeoutCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('T2_TIMEOUT')),
      )
      expect(timeoutCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-023c
  it('should_compute_t2_dynamic_timeout_from_pipeline_created_at', async () => {
    const state = makeRalphState()
    // F-8: spy on promptAssemble to capture the actual timeout_ms the handler
    // passes to T-2, rather than just recomputing Math.max locally (which only
    // tests the spec formula in isolation, not handler wiring).
    const spy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    try {
      const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
      expect(sessionId).toMatch(/^ses-/)
      expect(state.reviewerTakeover?.t2SessionId).toBe(sessionId)
      expect(spy).toHaveBeenCalled()
      const t2Call = spy.mock.calls.find(
        call => call[0]?.templateId === 'T-2',
      )
      expect(t2Call).toBeDefined()
      // F-5/F-8: spec formula is dynamic_timeout = max(30000, 300000 - elapsed_ms - 10000).
      const specMinTimeoutMs = 30000
      const specPipelineBudgetMs = 300000
      // timeout_ms is a Red Phase contract field not yet on the promptAssemble arg type.
      const t2Arg = t2Call?.[0] as { templateId: string; timeout_ms?: number } | undefined
      const passedTimeoutMs = t2Arg?.timeout_ms
      // For a fresh pipeline (elapsed≈0), the handler-computed value must fall
      // within [specMinTimeoutMs, specPipelineBudgetMs - specSafetyMarginMs].
      expect(passedTimeoutMs).toBeGreaterThanOrEqual(specMinTimeoutMs)
      expect(passedTimeoutMs).toBeLessThanOrEqual(specPipelineBudgetMs - 10000)
    } finally {
      spy.mockRestore()
    }
  })

  // RT-023d
  it('should_use_current_time_when_created_at_missing', async () => {
    // F-9: when createdAt is missing the handler must fall back to current time
    // AND emit a warning audit event so operators can detect schema drift.
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const state = makeRalphState()
      // Simulate missing createdAt. delete + cast because PipelineState.startedAt
      // is typed as string, but the handler must defensively handle absence.
      delete (state as Partial<PipelineState>).startedAt
      const sessionId = await handler.spawnT2(state, '.aristotle/fact-context-1.json')
      expect(sessionId).toMatch(/^ses-/)
      expect(state.reviewerTakeover?.t2SessionId).toBe(sessionId)
      const warningCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => {
          const s = String(arg)
          return s.includes('WARNING') && (s.includes('created_at') || s.includes('createdAt') || s.includes('CREATED_AT_MISSING'))
        }),
      )
      expect(warningCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-024
  it('should_defer_spawn_to_next_idle_event_when_current_idle_busy', async () => {
    const state = makeRalphState()
    state.activeSubagentSession = 'ses-other-active'
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(state.reviewerTakeover?.t1SessionId).toBeUndefined()
  })

  // RT-024b
  it('should_not_spawn_if_reviewer_takeover_not_pending', async () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: state.ralph?.round ?? 1,
      interceptAt: new Date().toISOString(),
      spawnPhase: 'done',
    }
    const result = await handler.onIdle(state)
    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(state.reviewerTakeover?.t1SessionId).toBeUndefined()
  })

  // RT-025a
  it('should_convert_legacy_suspended_action_atomically', () => {
    const legacy = { action: 'suspended' } as { action: string }
    const converted = handler.convertLegacyAction(legacy) as ReviewerSpawnResult & { pipelineAction?: string }
    expect(converted.pipelineAction).toBe('suspend')
    // F-29: spec requires action='blocked' (not error='blocked')
    expect(converted.action).toBe('blocked')
  })

  // RT-025b
  it('should_convert_legacy_resumed_action_atomically', () => {
    const legacy = { action: 'resumed' } as { action: string }
    const converted = handler.convertLegacyAction(legacy) as ReviewerSpawnResult & { pipelineAction?: string }
    expect(converted.pipelineAction).toBe('resume')
    expect(converted.success).toBe(true)
  })

  // RT-025c
  // F-6: original test called handler.onIdle(state) and checked t1/t2 session IDs
  // — unrelated to the spec's "prevent partial migration state" contract for
  // legacy action conversion. The real behavior: convertLegacyAction must return
  // a single object where BOTH pipelineAction AND action are set atomically
  // (no partial migration). Verify both fields on the same returned object.
  it('should_prevent_partial_migration_state', () => {
    const legacySuspended = { action: 'suspended' } as { action: string }
    const convertedSuspended = handler.convertLegacyAction(legacySuspended) as ReviewerSpawnResult & { pipelineAction?: string }
    expect(convertedSuspended.pipelineAction).toBeDefined()
    expect(convertedSuspended.action).toBeDefined()

    const legacyResumed = { action: 'resumed' } as { action: string }
    const convertedResumed = handler.convertLegacyAction(legacyResumed) as ReviewerSpawnResult & { pipelineAction?: string }
    expect(convertedResumed.pipelineAction).toBeDefined()
    expect(convertedResumed.action).toBeDefined()
  })
})
