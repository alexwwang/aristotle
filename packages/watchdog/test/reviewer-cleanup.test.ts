import { describe, it, expect, vi } from 'vitest'
import { cleanupStaleState, generateCleanupToken, validateCleanupToken, deleteResultFiles } from '../src/reviewer-cleanup.js'
import type { PipelineState } from '../src/schema.js'
import { writeFileSync, existsSync, unlinkSync, mkdtempSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeRalphState } from './helpers.js'

// F-3: spec production path is `.aristotle/reviewer-result-${round}.json` (no runId).
function makeResultPath(baseDir: string, _runId: string, round: number): string {
  return join(baseDir, `reviewer-result-${round}.json`)
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
    const tmpDir = mkdtempSync(join(tmpdir(), 'rt-029b-'))
    const runId = 'run-001'
    const round = 3
    const resultPath = makeResultPath(tmpDir, runId, round)
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
  // F-5: Red Phase — this test covers only the sessionId-MISMATCH deletion path.
  // The spec also requires verifying the sessionId-MATCH preservation path
  // (file NOT deleted when sessionId matches the current session). TODO(Green
  // Phase): add a companion test that seeds a result file with a sessionId
  // matching the current state, then asserts existsSync(path) === true after
  // deleteResultFiles, exercising the retention branch.
  it('should_verify_session_id_before_deleting_result_files_on_resume', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rt-030b-'))
    const runId = 'run-001'
    const round = 3
    const resultPath = makeResultPath(tmpDir, runId, round)
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
    const tmpDir = mkdtempSync(join(tmpdir(), 'rt-030c-'))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    const runId = state.runId
    const round = 1
    const resultPath = makeResultPath(tmpDir, runId, round)
    state.reviewerTakeover = {
      round, interceptAt: new Date().toISOString(), spawnPhase: 't1_done',
      t1SessionId: 'ses-current',
    }
    writeFileSync(resultPath, JSON.stringify({ status: 'complete', sessionId: 'ses-different' }))
    try {
      expect(existsSync(resultPath)).toBe(true)
      const result = cleanupStaleState('resume', state)
      expect(result).toBeDefined()
      expect(existsSync(resultPath)).toBe(false)
      const staleCalls = logSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('STALE_CLEANUP_DELETE')),
      )
      expect(staleCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
      logSpy.mockRestore()
    }
  })

  // RT-030d
  it('should_delete_stale_result_files_older_than_24h_on_resume', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rt-030d-'))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const state = makeRalphState()
    const runId = state.runId
    const round = 1
    const resultPath = makeResultPath(tmpDir, runId, round)
    state.reviewerTakeover = {
      round, interceptAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), spawnPhase: 't1_done',
    }
    writeFileSync(resultPath, JSON.stringify({ status: 'complete', sessionId: 'ses-old' }))
    const oldTime = (Date.now() - 48 * 3600 * 1000) / 1000
    utimesSync(resultPath, oldTime, oldTime)
    try {
      expect(existsSync(resultPath)).toBe(true)
      const result = cleanupStaleState('resume', state)
      expect(result).toBeDefined()
      expect(existsSync(resultPath)).toBe(false)
      const staleCalls = logSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('STALE_CLEANUP_DELETE')),
      )
      expect(staleCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
      logSpy.mockRestore()
    }
  })

  // RT-030e
  it('should_wait_for_active_t2_session_on_resume', () => {
    const state = makeRalphState()
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't2_running',
    }
    const result = cleanupStaleState('resume', state)
    expect(result).toBeDefined()
    // F-5: cleanupStaleState is synchronous and cannot async-wait.
    // The deferral contract is observable via: reviewerTakeover is preserved
    // (NOT cleared) and a `deferred: true` marker is set so the caller knows
    // to re-enter the cleanup later. Asserting both proves the non-stale path.
    // Cast accesses the Red Phase contract field not yet on PipelineState.
    expect(result.reviewerTakeover).not.toBeNull()
    expect((result as PipelineState & { deferred?: boolean }).deferred).toBe(true)
  })

  // RT-030f
  it('should_log_warning_if_t2_exceeds_wait_on_resume', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const state = makeRalphState()
      state.reviewerTakeover = {
        round: 1, interceptAt: new Date().toISOString(), spawnPhase: 't2_running',
      }
      const result = cleanupStaleState('resume', state)
      // F-5: prove deferral happened before asserting the warning audit,
      // so the test does not pass on a stale-clearing path that also logs.
      expect((result as PipelineState & { deferred?: boolean }).deferred).toBe(true)
      expect(result.reviewerTakeover).not.toBeNull()
      const warningCalls = logSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('WARNING') || String(arg).includes('T2_WAIT')),
      )
      expect(warningCalls.length).toBeGreaterThanOrEqual(1)
    } finally {
      logSpy.mockRestore()
    }
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
    const tmpDir = mkdtempSync(join(tmpdir(), 'rt-031b-'))
    const runId = 'run-001'
    const round = 3
    const resultPath = makeResultPath(tmpDir, runId, round)
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
    const tmpDir = mkdtempSync(join(tmpdir(), 'rt-031b2-'))
    const state = makeRalphState()
    const runId = state.runId
    const round = 1
    const resultPath = makeResultPath(tmpDir, runId, round)
    state.reviewerTakeover = {
      round, interceptAt: new Date().toISOString(), spawnPhase: 'done',
    }
    writeFileSync(resultPath, JSON.stringify({ status: 'complete' }))
    try {
      expect(existsSync(resultPath)).toBe(true)
      const result = cleanupStaleState('phase_complete', state)
      expect(result).toBeDefined()
      expect(result.reviewerTakeover).toBeNull()
      expect(existsSync(resultPath)).toBe(false)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
    }
  })

  // RT-031b-3
  it('should_cleanup_result_files_on_ralph_terminate', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'rt-031b3-'))
    const state = makeRalphState()
    const runId = state.runId
    const round = 1
    const resultPath = makeResultPath(tmpDir, runId, round)
    state.reviewerTakeover = {
      round, interceptAt: new Date().toISOString(), spawnPhase: 'done',
    }
    writeFileSync(resultPath, JSON.stringify({ status: 'complete' }))
    try {
      expect(existsSync(resultPath)).toBe(true)
      const result = cleanupStaleState('ralph_terminate', state)
      expect(result).toBeDefined()
      expect(result.reviewerTakeover).toBeNull()
      expect(existsSync(resultPath)).toBe(false)
    } finally {
      if (existsSync(resultPath)) unlinkSync(resultPath)
    }
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
    // F-7: avoid trivial identity (result.runId === state.runId). The real
    // non-stale contract is: when t2SessionId was set (T-2 ran), the takeover
    // state must be preserved, proving we did NOT treat it as stale.
    expect(result.reviewerTakeover).not.toBeNull()
    expect(result.reviewerTakeover?.t2SessionId).toBe('ses-t2-001')
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
