import type { ReviewerTakeoverState, DualPassPhase, SpawnPhase } from './reviewer-intercept.js'

const VALID_SPAWN_PHASES = new Set<SpawnPhase>([
  'pending', 't1_running', 't1_done', 't2_running', 'done', 'failed',
])

const VALID_DUAL_PASS_PHASES = new Set<DualPassPhase>([
  'pending', 'recall_running', 'recall_done',
  'factgather_running', 'factgather_done',
  'precision_running', 'precision_done',
  'evalfix_running', 'evalfix_done',
  'd2_running', 'd25_running', 'done', 'failed',
])

export function validateReviewerTakeoverState(state: Partial<ReviewerTakeoverState>): string | null {
  if (typeof state.round !== 'number' || !Number.isInteger(state.round) || state.round < 0) {
    return 'round must be a non-negative integer'
  }
  if (typeof state.interceptAt !== 'string' || isNaN(Date.parse(state.interceptAt))) {
    return 'interceptAt must be a valid ISO date string'
  }
  if (typeof state.spawnPhase !== 'string' || state.spawnPhase.length === 0) {
    return 'spawnPhase is required'
  }
  if (state.dualPassMode === true && !state.dualPassPhase) {
    return 'dualPassPhase is required when dualPassMode is true'
  }
  return null
}

export function validateSpawnPhase(value: string): value is SpawnPhase {
  return VALID_SPAWN_PHASES.has(value as SpawnPhase)
}

export function validateDualPassPhaseEnum(value: string): value is DualPassPhase {
  return VALID_DUAL_PASS_PHASES.has(value as DualPassPhase)
}

export function setDualPassMode(state: { dualPassMode?: boolean }, value: boolean): void {
  if (state.dualPassMode !== undefined) {
    throw new Error('dualPassMode is immutable after takeover creation')
  }
  state.dualPassMode = value
}
