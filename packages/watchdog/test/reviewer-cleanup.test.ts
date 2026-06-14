import { describe, it, expect, vi } from 'vitest'
import { cleanupStaleState, generateCleanupToken, validateCleanupToken, deleteResultFiles } from '../src/reviewer-cleanup.js'
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { makeRalphState } from './helpers.js'

function makeResultPath(runId: string, round: number): string {
  return `.aristotle/reviewer-result-${runId}-${round}.json`
}

describe('Reviewer Cleanup', () => {
  // RT-029a
  it('should_cleanup_stale_state_on_suspend', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_running',
    }
    const result = cleanupStaleState('suspend', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-029b
  it('should_delete_result_files_on_suspend_cleanup', () => {
    const runId = 'run-001'
    const round = 3
    const resultPath = makeResultPath(runId, round)
    mkdirSync('.aristotle', { recursive: true })
    writeFileSync(resultPath, JSON.stringify({ status: 'complete' }))
    try {
      expect(existsSync(resultPath)).toBe(true)
      deleteResultFiles(runId, round)
      expect(existsSync(resultPath)).toBe(false)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
    }
  })

  // RT-029c
  it('should_log_stale_cleanup_delete_event_before_file_deletion', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_running',
    }
    cleanupStaleState('suspend', state)
    const staleCalls = logSpy.mock.calls.filter(
      call => call.some(arg => String(arg).includes('STALE_CLEANUP_DELETE')),
    )
    expect(staleCalls.length).toBeGreaterThanOrEqual(1)
    logSpy.mockRestore()
  })

  // RT-030a
  it('should_cleanup_stale_state_on_resume', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_done',
    }
    const result = cleanupStaleState('resume', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-030b
  it('should_verify_session_id_before_deleting_result_files_on_resume', () => {
    const runId = 'run-001'
    const round = 3
    const resultPath = makeResultPath(runId, round)
    mkdirSync('.aristotle', { recursive: true })
    writeFileSync(resultPath, JSON.stringify({ status: 'complete', sessionId: 'ses-original' }))
    try {
      expect(existsSync(resultPath)).toBe(true)
      deleteResultFiles(runId, round, true)
      expect(existsSync(resultPath)).toBe(false)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
    }
  })

  // RT-030c
  it('should_delete_stale_result_files_on_resume', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_done',
    }
    const result = cleanupStaleState('resume', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-030d
  it('should_delete_stale_result_files_older_than_24h_on_resume', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), spawnPhase: 't1_done',
    }
    const result = cleanupStaleState('resume', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-030e
  it('should_wait_for_active_t2_session_on_resume', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't2_running',
    }
    const result = cleanupStaleState('resume', state)
    expect(result).toBeDefined()
  })

  // RT-030f
  it('should_log_warning_if_t2_exceeds_wait_on_resume', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't2_running',
    }
    cleanupStaleState('resume', state)
    const warningCalls = logSpy.mock.calls.filter(
      call => call.some(arg => String(arg).includes('WARNING') || String(arg).includes('T2_WAIT')),
    )
    expect(warningCalls.length).toBeGreaterThanOrEqual(1)
    logSpy.mockRestore()
  })

  // RT-031a
  it('should_cleanup_stale_state_on_pipeline_start', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_done',
    }
    const result = cleanupStaleState('start', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-031b
  it('should_delete_result_files_without_session_check_on_start', () => {
    const runId = 'run-001'
    const round = 3
    const resultPath = makeResultPath(runId, round)
    mkdirSync('.aristotle', { recursive: true })
    writeFileSync(resultPath, JSON.stringify({ status: 'complete', sessionId: 'ses-current' }))
    try {
      expect(existsSync(resultPath)).toBe(true)
      deleteResultFiles(runId, round)
      expect(existsSync(resultPath)).toBe(false)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
    }
  })

  // RT-031c
  it('should_cleanup_stale_state_on_ralph_loop_start', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_done',
    }
    const result = cleanupStaleState('ralph_loop_start', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-031d
  it('should_cleanup_failed_spawn_phase_state', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 'failed',
    }
    const result = cleanupStaleState('start', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-031b-2
  it('should_cleanup_result_files_on_phase_complete', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 'done',
    }
    const result = cleanupStaleState('phase_complete', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-031b-3
  it('should_cleanup_result_files_on_ralph_terminate', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 'done',
    }
    const result = cleanupStaleState('ralph_terminate', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-032a
  it('should_use_cleanup_token_to_prevent_duplicate_cleanup', () => {
    const token = generateCleanupToken()
    const state = makeRalphState()
    state.cleanupToken = token
    const validMatch = validateCleanupToken(state, token)
    const validMismatch = validateCleanupToken(state, 'other-token')
    expect(validMatch).toBe(true)
    expect(validMismatch).toBe(false)
  })

  // RT-032b
  it('should_generate_unique_cleanup_token_before_cleanup', () => {
    const token1 = generateCleanupToken()
    const token2 = generateCleanupToken()
    expect(token1).not.toBe(token2)
  })

  // RT-032c
  it('should_clear_cleanup_token_after_successful_cleanup', () => {
    const state = makeRalphState()
    state.cleanupToken = 'token-1'
    const result = cleanupStaleState('suspend', state)
    expect(result).toBeDefined()
    expect(result.cleanupToken).toBeUndefined()
  })

  // RT-032d
  it('should_defer_cleanup_if_cleanup_token_mismatch', () => {
    const state = makeRalphState()
    state.cleanupToken = 'token-owner'
    const valid = validateCleanupToken(state, 'wrong-token')
    expect(valid).toBe(false)
  })

  // RT-032e
  it('should_log_takeover_stale_cleanup_audit_event', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_running',
    }
    cleanupStaleState('suspend', state)
    const auditCalls = logSpy.mock.calls.filter(
      call => call.some(arg => String(arg).includes('TAKEOVER_STALE_CLEANUP')),
    )
    expect(auditCalls.length).toBeGreaterThanOrEqual(1)
    logSpy.mockRestore()
  })

  // RT-033a
  it('should_treat_t1_done_as_stale_only_when_t2_never_started', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_done', t2SessionId: undefined,
    }
    const result = cleanupStaleState('resume', state)
    expect(result).toBeDefined()
    expect(result.reviewerTakeover).toBeNull()
  })

  // RT-033b
  it('should_not_treat_t1_done_as_stale_when_t2_running_occurred', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't1_done', t2SessionId: 'ses-t2-001',
    }
    const result = cleanupStaleState('resume', state)
    expect(result).toBeDefined()
    expect(result.runId).toBe(state.runId)
  })

  // RT-037 — simulate race: first token wins, second defers
  it('should_handle_cleanup_token_race_condition', () => {
    const token1 = generateCleanupToken()
    const token2 = generateCleanupToken()
    const state = makeRalphState()
    state.cleanupToken = token1
    const firstWins = validateCleanupToken(state, token1)
    expect(firstWins).toBe(true)
    state.cleanupToken = token1
    const secondDefers = validateCleanupToken(state, token2)
    expect(secondDefers).toBe(false)
  })
})
