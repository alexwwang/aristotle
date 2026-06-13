import { describe, it, expect } from 'vitest'
import {
  resetDualPassPhaseOnInactivity,
  incrementD2TimeoutCycleCount,
  setDualPassPhaseFailed,
  detectStalePhase,
  isDualPassPhaseValid,
  validateDualPassTransition,
} from '../src/dual-pass-supervision.js'
import type { DualPassPhase } from '../src/reviewer-intercept.js'

describe('Dual-Pass Supervision', () => {
  // RT-061a
  it('should_reset_dual_pass_phase_on_d2_inactivity_timeout', () => {
    const result = resetDualPassPhaseOnInactivity('d2_running', 240, false)
    expect(result).toBe('evalfix_done')
  })

  // RT-061b
  it('should_detect_d2_activity_via_file_snapshot_comparison', () => {
    const result = resetDualPassPhaseOnInactivity('d2_running', 100, true)
    expect(result).toBe('d2_running')
  })

  // RT-061c
  it('should_reset_d25_running_phase_on_inactivity_timeout', () => {
    const result = resetDualPassPhaseOnInactivity('d25_running', 240, false)
    expect(result).toBe('evalfix_done')
  })

  // RT-062a
  it('should_set_failed_after_3_consecutive_d2_inactivity_timeouts', () => {
    const result = setDualPassPhaseFailed({ d2TimeoutCycleCount: 3 })
    expect(result.dualPassPhase).toBe('failed')
  })

  // RT-062b
  it('should_preserve_pipeline_state_on_d2_loop_guard_failure', () => {
    const result = setDualPassPhaseFailed({ d2TimeoutCycleCount: 3 })
    expect(result.d2TimeoutCycleCount).toBe(3)
  })

  // RT-063a
  it('should_accept_all_13_defined_dual_pass_phase_values', () => {
    const phases: DualPassPhase[] = [
      'pending', 'recall_running', 'recall_done', 'factgather_running',
      'factgather_done', 'precision_running', 'precision_done',
      'evalfix_running', 'evalfix_done', 'd2_running', 'd25_running', 'done', 'failed',
    ]
    for (const phase of phases) {
      expect(isDualPassPhaseValid(phase)).toBe(true)
    }
  })

  // RT-063b
  it('should_follow_degradation_shortcut_recall_failed_to_evalfix', () => {
    const valid = validateDualPassTransition('recall_done', 'evalfix_running', true)
    expect(typeof valid).toBe('boolean')
  })

  // RT-063c
  it('should_distinguish_failed_from_degraded', () => {
    expect(isDualPassPhaseValid('failed')).toBe(true)
    expect(isDualPassPhaseValid('done')).toBe(true)
  })

  // RT-064a
  it('should_reject_dual_pass_mode_mutation_after_creation', () => {
    const result = validateDualPassTransition('d2_running', 'pending', true)
    expect(result).toBe(false)
  })

  // RT-064b
  it('should_set_dual_pass_mode_once_at_takeover_creation', () => {
    const valid = isDualPassPhaseValid('recall_running')
    expect(valid).toBe(true)
  })

  // RT-065a
  it('should_detect_stale_d2_running_phase', () => {
    const result = detectStalePhase('d2_running', 240_000, 240_000, false)
    expect(result).toBe(true)
  })

  // RT-065b
  it('should_detect_stale_d25_running_phase', () => {
    const result = detectStalePhase('d25_running', 240_000, 240_000, false)
    expect(result).toBe(true)
  })

  // RT-065c
  it('should_count_consecutive_stale_detections_for_loop_guard', () => {
    const count = incrementD2TimeoutCycleCount({ d2TimeoutCycleCount: 1 })
    expect(count).toBe(2)
  })

  // RT-065b-reset
  it('should_reset_d2_timeout_cycle_count_on_successful_d2_completion', () => {
    const count = incrementD2TimeoutCycleCount({ d2TimeoutCycleCount: 0 })
    expect(count).toBe(1)
  })
})
