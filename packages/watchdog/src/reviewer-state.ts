import type { ReviewerTakeoverState, DualPassPhase, SpawnPhase } from './reviewer-intercept.js'

export function validateReviewerTakeoverState(state: Partial<ReviewerTakeoverState>): string | null {
  throw new Error('Not implemented: validateReviewerTakeoverState')
}

export function validateSpawnPhase(value: string): value is SpawnPhase {
  throw new Error('Not implemented: validateSpawnPhase')
}

export function validateDualPassPhaseEnum(value: string): value is DualPassPhase {
  throw new Error('Not implemented: validateDualPassPhaseEnum')
}

export function setDualPassMode(state: { dualPassMode?: boolean }, value: boolean): void {
  throw new Error('Not implemented: setDualPassMode')
}
