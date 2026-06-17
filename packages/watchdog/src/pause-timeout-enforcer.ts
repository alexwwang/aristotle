import type { PipelineState } from './schema.js'
import { PAUSE_TIMEOUT_MS } from './constants.js'

export interface PauseTimeoutResult {
  timedOut: boolean
  elapsedMs: number
  pausedAt?: string
  runId?: string
}

export function checkPausedTimeout(state: PipelineState): PauseTimeoutResult {
  if (state.phaseStatus !== 'paused' || !state.pausedAt) {
    return { timedOut: false, elapsedMs: 0 }
  }

  const now = Date.now()
  const pausedTime = new Date(state.pausedAt).getTime()
  const elapsedMs = now - pausedTime

  if (elapsedMs > PAUSE_TIMEOUT_MS) {
    return {
      timedOut: true,
      elapsedMs,
      pausedAt: state.pausedAt,
      runId: state.runId,
    }
  }

  return { timedOut: false, elapsedMs }
}

export function formatPhaseStatus(status: string): string {
  return status
}
