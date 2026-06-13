import { describe, it, expect } from 'vitest'
import { checkPausedTimeout } from '../src/pause-timeout-enforcer.js'
import { PAUSE_TIMEOUT_MS } from '../src/constants.js'
import { makeState } from './helpers.js'

const BUFFER_MS = 60_000
const RECENT_MS = 10_000

describe('PauseTimeoutEnforcer', () => {
  // #37
  it('should flag paused pipeline exceeding PAUSE_TIMEOUT_MS', () => {
    const past = new Date(Date.now() - PAUSE_TIMEOUT_MS - BUFFER_MS).toISOString()
    const state = makeState({
      phaseStatus: 'paused' as any,
      pausedAt: past,
    } as any)
    const result = checkPausedTimeout(state)
    expect(result.timedOut).toBe(true)
  })

  // #38
  it('should not flag paused pipeline within timeout window', () => {
    const recent = new Date(Date.now() - RECENT_MS).toISOString()
    const state = makeState({
      phaseStatus: 'paused' as any,
      pausedAt: recent,
    } as any)
    const result = checkPausedTimeout(state)
    expect(result.timedOut).toBe(false)
  })

  // #39
  it('should not auto resume pipeline awaiting approval when timeout exceeded', () => {
    const past = new Date(Date.now() - PAUSE_TIMEOUT_MS - BUFFER_MS).toISOString()
    const state = makeState({
      phaseStatus: 'awaiting_approval' as any,
      pausedAt: past,
    } as any)
    const result = checkPausedTimeout(state)
    expect(result.timedOut).toBe(false)
  })

  // #95
  it('should return elapsedMs exceeding PAUSE_TIMEOUT_MS on timeout', () => {
    const past = new Date(Date.now() - PAUSE_TIMEOUT_MS - BUFFER_MS).toISOString()
    const state = makeState({
      phaseStatus: 'paused' as any,
      pausedAt: past,
      runId: 'run-123',
    } as any)
    const result = checkPausedTimeout(state)
    expect(result.elapsedMs).toBeGreaterThan(PAUSE_TIMEOUT_MS)
  })
})
