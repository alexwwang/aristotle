import type { PipelineState } from './schema.js'
import { PAUSE_TIMEOUT_MS } from './constants.js'

export interface PauseTimeoutResult {
  timedOut: boolean
  elapsedMs: number
}

export function checkPausedTimeout(state: PipelineState): PauseTimeoutResult {
  throw new Error('Not implemented: checkPausedTimeout')
}

export function formatPhaseStatus(status: string): string {
  throw new Error('Not implemented: formatPhaseStatus')
}
