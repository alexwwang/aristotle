import type { DualPassPhase } from './reviewer-intercept.js'

const D2_INACTIVITY_THRESHOLD_S = 240
const D2_MAX_TIMEOUT_CYCLES = 3

const VALID_DUAL_PASS_PHASES: DualPassPhase[] = [
  'pending', 'recall_running', 'recall_done',
  'factgather_running', 'factgather_done',
  'precision_running', 'precision_done',
  'evalfix_running', 'evalfix_done',
  'd2_running', 'd25_running', 'done', 'failed',
]

const PHASE_SEQUENCE: DualPassPhase[] = [
  'pending', 'recall_running', 'recall_done',
  'factgather_running', 'factgather_done',
  'precision_running', 'precision_done',
  'evalfix_running', 'evalfix_done',
  'd2_running', 'd25_running', 'done',
]

export function resetDualPassPhaseOnInactivity(
  currentPhase: DualPassPhase,
  inactiveSeconds: number,
  fileStateChanged: boolean,
  cycleCount?: number,
): DualPassPhase {
  if (fileStateChanged || inactiveSeconds < D2_INACTIVITY_THRESHOLD_S) {
    return currentPhase
  }
  if (currentPhase !== 'd2_running' && currentPhase !== 'd25_running') {
    return currentPhase
  }
  if (cycleCount !== undefined && cycleCount >= D2_MAX_TIMEOUT_CYCLES - 1) {
    return 'failed'
  }
  return 'evalfix_done'
}

export function incrementD2TimeoutCycleCount(state: { d2TimeoutCycleCount: number }): number {
  state.d2TimeoutCycleCount += 1
  return state.d2TimeoutCycleCount
}

export function setDualPassPhaseFailed(state: { d2TimeoutCycleCount: number }): { dualPassPhase: 'failed'; d2TimeoutCycleCount: number } {
  return { dualPassPhase: 'failed', d2TimeoutCycleCount: state.d2TimeoutCycleCount }
}

export function detectStalePhase(
  phase: DualPassPhase,
  elapsedMs: number,
  thresholdMs: number,
  fileChanged: boolean,
): boolean {
  if (fileChanged) return false
  if (phase !== 'd2_running' && phase !== 'd25_running') return false
  return elapsedMs >= thresholdMs
}

export function isDualPassPhaseValid(value: string): value is DualPassPhase {
  return VALID_DUAL_PASS_PHASES.includes(value as DualPassPhase)
}

const STRICT_SEQUENCE: DualPassPhase[] = [
  'pending', 'recall_running', 'recall_done',
  'factgather_running', 'factgather_done',
  'precision_running', 'precision_done',
  'evalfix_running', 'evalfix_done',
  'd2_running', 'd25_running', 'done',
]

const DEGRADATION_SHORTCUTS: ReadonlySet<string> = new Set([
  'recall_done→factgather_running',
  'factgather_running→factgather_done',
  'factgather_done→evalfix_running',
  'recall_done→evalfix_running',
])

export function validateDualPassTransition(from: DualPassPhase, to: DualPassPhase, dualPassMode: boolean): boolean {
  if (!dualPassMode) return false
  if (to === 'failed') return true
  const fromIdx = STRICT_SEQUENCE.indexOf(from)
  const toIdx = STRICT_SEQUENCE.indexOf(to)
  if (fromIdx === -1 || toIdx === -1) return false
  if (toIdx === fromIdx + 1) return true
  return DEGRADATION_SHORTCUTS.has(`${from}→${to}`)
}
