import type { FileClassification } from './file-classifier.js'
import type { PipelineState } from './schema.js'
import { TEST_CODE_PHASE } from './constants.js'

// Deviation from TechSpec §3.2.1: spec defines applies()/check() two-phase design.
// Implementation uses single evaluate() method returning { blocked, reason }.
// Rationale: with only 2 rules, the separation overhead outweighs the benefit.
// The Interceptor pre-filters by tool and state before invoking rules,
// so the fast-path rejection that applies() provides is already handled upstream.

export interface InterceptRule {
  id: string
  evaluate(tool: string, filePath: string, classification: FileClassification, state: PipelineState): { blocked: boolean; reason?: string }
}

export function createRules(): InterceptRule[] {
  return [
    // Rule 1 (AC-3): Business Code Gate (v1.8)
    // TEST_CODE_PHASE + business_code → unconditional block (test phase writes test files only)
    // Phase 5+ + business_code + TEST_CODE_PHASE gate not passed → blocked
    {
      id: 'NO_BUSINESS_CODE_BEFORE_PHASE5',
      evaluate(_tool: string, _path: string, classification: FileClassification, state: PipelineState) {
        if (
          state.currentPhase >= TEST_CODE_PHASE &&
          classification.category === 'business_code'
        ) {
          if (
            state.currentPhase === TEST_CODE_PHASE ||
            !state.phases?.[TEST_CODE_PHASE]?.ralphCompleted ||
            !state.phases?.[TEST_CODE_PHASE]?.userApproved
          ) {
          const testPhaseRec = state.phases?.[TEST_CODE_PHASE]
          const testPhaseStatus = !testPhaseRec
            ? `Phase ${TEST_CODE_PHASE} not yet entered — complete earlier phases first`
            : !testPhaseRec.ralphCompleted
              ? `Phase ${TEST_CODE_PHASE} Ralph loop incomplete`
              : `Phase ${TEST_CODE_PHASE} awaiting user approval`
          return {
            blocked: true,
            reason:
              `⛔ [TDD Watchdog] Phase ${state.currentPhase} violation: business code write blocked. ${testPhaseStatus}. Business code (src/) must not be written during Phase ${TEST_CODE_PHASE} (Test Code). Phase ${TEST_CODE_PHASE} writes test files only — stubs and mocks belong in test directories.`,
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

        // Phase deliverable for next phase
        if (
          classification.category === 'phase_deliverable' &&
          classification.phase === currentPhase + 1
        ) {
          if (!rec || !rec.ralphCompleted || !rec.userApproved) {
            const status = !rec
              ? 'phase not entered'
              : rec.ralphCompleted
                ? 'awaiting user approval'
                : 'Ralph loop incomplete'
            return {
              blocked: true,
              reason: `⛔ [TDD Watchdog] Phase transition blocked: Phase ${currentPhase} Ralph loop gate has not been passed (status: ${status}). Complete the Ralph loop and obtain user approval before starting Phase ${currentPhase + 1}.`,
            }
          }
        }

        return { blocked: false }
      },
    },
  ]
}
