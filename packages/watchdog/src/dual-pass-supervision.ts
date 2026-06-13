import type { DualPassPhase } from './reviewer-intercept.js'

export function resetDualPassPhaseOnInactivity(
  currentPhase: DualPassPhase,
  inactiveSeconds: number,
  fileStateChanged: boolean,
): DualPassPhase {
  throw new Error('Not implemented: resetDualPassPhaseOnInactivity')
}

export function incrementD2TimeoutCycleCount(state: { d2TimeoutCycleCount: number }): number {
  throw new Error('Not implemented: incrementD2TimeoutCycleCount')
}

export function setDualPassPhaseFailed(state: { d2TimeoutCycleCount: number }): { dualPassPhase: 'failed'; d2TimeoutCycleCount: number } {
  throw new Error('Not implemented: setDualPassPhaseFailed')
}

export function detectStalePhase(
  phase: DualPassPhase,
  elapsedMs: number,
  thresholdMs: number,
  fileChanged: boolean,
): boolean {
  throw new Error('Not implemented: detectStalePhase')
}

export function isDualPassPhaseValid(value: string): value is DualPassPhase {
  throw new Error('Not implemented: isDualPassPhaseValid')
}

export function validateDualPassTransition(from: DualPassPhase, to: DualPassPhase, dualPassMode: boolean): boolean {
  throw new Error('Not implemented: validateDualPassTransition')
}
