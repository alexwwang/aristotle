import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkPausedTimeout, formatPhaseStatus } from '../src/pause-timeout-enforcer.js'
import { PAUSE_TIMEOUT_MS } from '../src/constants.js'
import { makeState } from './helpers.js'

const BUFFER_MS = 60_000 // Safety margin beyond PAUSE_TIMEOUT_MS to prevent wall-clock flakiness
const RECENT_MS = 10_000 // Well within timeout window (10s < 30min) for negative-test stability

describe('PauseTimeoutEnforcer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // #37
  it('should flag paused pipeline exceeding PAUSE_TIMEOUT_MS', () => {
    const past = new Date(Date.now() - PAUSE_TIMEOUT_MS - BUFFER_MS).toISOString()
    const state = makeState({
      phaseStatus: 'paused',
      pausedAt: past,
    })
    const result = checkPausedTimeout(state)
    expect(result.timedOut).toBe(true)
  })

  // #38
  it('should not flag paused pipeline within timeout window', () => {
    const recent = new Date(Date.now() - RECENT_MS).toISOString()
    const state = makeState({
      phaseStatus: 'paused',
      pausedAt: recent,
    })
    const result = checkPausedTimeout(state)
    expect(result.timedOut).toBe(false)
  })

  // #39
  // P-006: spec #39 also requires getActiveRun-level warning and no-auto-resume — integration test deferred
  it('should not flag timeout for awaiting_approval status (unit)', () => {
    const past = new Date(Date.now() - PAUSE_TIMEOUT_MS - BUFFER_MS).toISOString()
    // pausedAt intentionally set; verifier ignores it when status != paused
    const state = makeState({
      phaseStatus: 'awaiting_approval',
      pausedAt: past,
    })
    const result = checkPausedTimeout(state)
    expect(result.timedOut).toBe(false)
  })

  // #95
  it('should log diagnostic info on timeout detection', () => {
    const past = new Date(Date.now() - PAUSE_TIMEOUT_MS - BUFFER_MS).toISOString()
    const state = makeState({
      phaseStatus: 'paused',
      pausedAt: past,
      runId: 'run-123',
    })
    const result = checkPausedTimeout(state)
    expect(result.timedOut).toBe(true)
    expect(result.elapsedMs).toBeGreaterThan(PAUSE_TIMEOUT_MS)
    expect(result.pausedAt).toBeDefined()
    expect(result.runId).toBe('run-123')
  })

  // #155 — R38 F-006: moved from checkpoint-handler-pn.test.ts
  it('should return correct display strings for new statuses', () => {
    expect(formatPhaseStatus('suspended')).toBe('suspended')
    expect(formatPhaseStatus('paused')).toBe('paused')
    expect(formatPhaseStatus('failed')).toBe('failed')
    expect(formatPhaseStatus('cancelled')).toBe('cancelled')
    expect(formatPhaseStatus('unknown_status')).toBe('unknown_status')
  })
})
