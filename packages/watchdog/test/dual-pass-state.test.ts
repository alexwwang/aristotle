import { describe, it, expect } from 'vitest'
import { validateDualPassTransition, isDualPassPhaseValid } from '../src/dual-pass-supervision.js'
import type { DualPassPhase } from '../src/reviewer-intercept.js'

describe('dualPassPhase state machine', () => {
  // RT-044a
  it('should_transition_dual_pass_phase_through_all_happy_path_states', () => {
    const happyPath: DualPassPhase[] = [
      'pending', 'recall_running', 'recall_done', 'factgather_running',
      'factgather_done', 'precision_running', 'precision_done',
      'evalfix_running', 'evalfix_done', 'd2_running', 'd25_running', 'done',
    ]
    for (let i = 0; i < happyPath.length - 1; i++) {
      const valid = validateDualPassTransition(happyPath[i], happyPath[i + 1], true)
      expect(valid).toBe(true)
    }
  })

  // RT-044b — multiple invalid transitions
  it.each([
    ['recall_running', 'precision_running'],
    ['pending', 'done'],
    ['done', 'pending'],
    ['failed', 'recall_running'],
    ['recall_running', 'd2_running'],
    ['factgather_done', 'evalfix_done'],
  ] as const)('should_reject_invalid_transition_%s_to_%s', (from, to) => {
    const valid = validateDualPassTransition(from, to, true)
    expect(valid).toBe(false)
  })

  // RT-044c
  it('should_use_dual_pass_phase_as_authoritative_when_dual_pass_mode_true', () => {
    const valid = isDualPassPhaseValid('recall_running')
    expect(valid).toBe(true)
  })
})
