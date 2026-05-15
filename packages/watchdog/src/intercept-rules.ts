import type { FileClassification } from './file-classifier.js'
import type { PipelineState } from './schema.js'

export interface InterceptRule {
  id: string
  evaluate(...args: unknown[]): { blocked: boolean; reason?: string }
}

export function createRules(_config?: unknown): InterceptRule[] {
  return [
    // Rule 1 (AC-3): Test Evidence Gate
    // Phase 4, no test evidence, business code → blocked
    {
      id: 'NO_BUSINESS_CODE_BEFORE_FAILING_TESTS',
      evaluate(_tool: string, _path: string, classification: FileClassification, state: PipelineState) {
        if (
          (state.currentPhase === 4 || state.currentPhase === 5) &&
          classification.category === 'business_code'
        ) {
          if (state.testEvidenceConfirmed === false) {
            return {
              blocked: true,
              reason:
                'business code write blocked — submit test evidence first',
            }
          }
        }
        return { blocked: false }
      },
    },
    // Rule 2 (AC-4): Phase Gate
    // Phase N deliverable for phase (N+1), but phase N not ralphCompleted or not userApproved → blocked
    {
      id: 'NO_PHASE_ADVANCE_WITHOUT_GATE',
      evaluate(_tool: string, _path: string, classification: FileClassification, state: PipelineState) {
        const currentPhase = state.currentPhase
        const rec = state.phases?.[currentPhase]

        if (
          currentPhase >= 1 &&
          classification.category === 'phase_deliverable' &&
          classification.phase === currentPhase + 1
        ) {
          if (!rec || !rec.ralphCompleted || !rec.userApproved) {
            return {
              blocked: true,
              reason: `Phase transition blocked — phase ${currentPhase} must complete first`,
            }
          }
        }

        return { blocked: false }
      },
    },
  ]
}
