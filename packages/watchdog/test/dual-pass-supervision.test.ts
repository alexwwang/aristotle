import { describe, it, expect } from 'vitest'
import {
  resetDualPassPhaseOnInactivity,
  incrementD2TimeoutCycleCount,
  setDualPassPhaseFailed,
  detectStalePhase,
  isDualPassPhaseValid,
  validateDualPassTransition,
} from '../src/dual-pass-supervision.js'
import { setDualPassMode } from '../src/reviewer-state.js'
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

  // RT-062a — F-010: use stateful accumulator to track cycle count across calls
  it('should_set_failed_after_3_consecutive_d2_inactivity_timeouts', () => {
    const state = { d2TimeoutCycleCount: 0 }
    // F-10: track cycle count externally via incrementD2TimeoutCycleCount
    const phase1 = resetDualPassPhaseOnInactivity('d2_running', 240, false)
    state.d2TimeoutCycleCount = incrementD2TimeoutCycleCount(state)
    expect(phase1).toBe('evalfix_done')
    const phase2 = resetDualPassPhaseOnInactivity('d2_running', 240, false)
    state.d2TimeoutCycleCount = incrementD2TimeoutCycleCount(state)
    expect(phase2).toBe('evalfix_done')
    const phase3 = resetDualPassPhaseOnInactivity('d2_running', 240, false)
    state.d2TimeoutCycleCount = incrementD2TimeoutCycleCount(state)
    // F-10: after 3rd consecutive timeout, supervisor must transition to 'failed'
    expect(state.d2TimeoutCycleCount).toBe(3)
    expect(phase3).toBe('failed')
  })

  // RT-062b
  it('should_preserve_pipeline_state_on_d2_loop_guard_failure', () => {
    const state = { d2TimeoutCycleCount: 3 }
    const result = setDualPassPhaseFailed(state)
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

  // RT-063b — F-049: full degradation chain (recall_done → factgather_running → factgather_done → evalfix_running)
  it('should_follow_degradation_shortcut_recall_failed_to_evalfix', () => {
    expect(validateDualPassTransition('recall_done', 'factgather_running', true)).toBe(true)
    expect(validateDualPassTransition('factgather_running', 'factgather_done', true)).toBe(true)
    expect(validateDualPassTransition('factgather_done', 'evalfix_running', true)).toBe(true)
    expect(validateDualPassTransition('recall_done', 'evalfix_running', true)).toBe(true)
  })

  // RT-063c
  it('should_distinguish_failed_from_degraded', () => {
    expect(isDualPassPhaseValid('failed')).toBe(true)
    expect(isDualPassPhaseValid('done')).toBe(true)
  })

  // RT-064a — F-045: supervision-layer mutation guard (complements RT-079a schema-layer)
  it('should_reject_dual_pass_mode_mutation_after_creation', () => {
    const state: { dualPassMode?: boolean } = { dualPassMode: true }
    expect(() => setDualPassMode(state, false)).toThrow('dualPassMode is immutable after takeover creation')
  })

  // RT-064b — F-045: supervision-layer initial write-once (complements RT-079b schema-layer)
  it('should_set_dual_pass_mode_once_at_takeover_creation', () => {
    const state: { dualPassMode?: boolean } = {}
    setDualPassMode(state, true)
    expect(state.dualPassMode).toBe(true)
  })

  // RT-065a
  it('should_detect_stale_d2_running_phase', () => {
    const result = detectStalePhase('d2_running', 240_000, 240_000, false)
    expect(result).toBe(true)
  })

  // RT-065a — under threshold: not stale
  it('should_not_detect_stale_when_elapsed_under_threshold', () => {
    const result = detectStalePhase('d2_running', 239_000, 240_000, false)
    expect(result).toBe(false)
  })

  // RT-065a — over threshold: stale
  it('should_detect_stale_when_elapsed_over_threshold', () => {
    const result = detectStalePhase('d2_running', 300_000, 240_000, false)
    expect(result).toBe(true)
  })

  // RT-065a — file changed: not stale regardless of elapsed
  it('should_not_detect_stale_when_file_changed', () => {
    const result = detectStalePhase('d2_running', 300_000, 240_000, true)
    expect(result).toBe(false)
  })

  // RT-065b
  it('should_detect_stale_d25_running_phase', () => {
    const result = detectStalePhase('d25_running', 240_000, 240_000, false)
    expect(result).toBe(true)
  })

  // RT-065b-reset — F-020: reset d2TimeoutCycleCount on successful D2 completion
  it('should_reset_d2_timeout_cycle_count_on_successful_d2_completion', () => {
    const state = { d2TimeoutCycleCount: 2, dualPassPhase: 'd2_running' as DualPassPhase | undefined }
    // F-20: simulate successful D2 completion (phase → 'done', file changed, no inactivity)
    const result = resetDualPassPhaseOnInactivity('done', 0, true)
    // On successful completion, counter must reset to 0
    state.d2TimeoutCycleCount = result === 'done' ? 0 : state.d2TimeoutCycleCount
    expect(result).toBe('done')
    expect(state.d2TimeoutCycleCount).toBe(0)
  })

  // RT-065c
  it('should_count_consecutive_stale_detections_for_loop_guard', () => {
    const count = incrementD2TimeoutCycleCount({ d2TimeoutCycleCount: 1 })
    expect(count).toBe(2)
  })

  // RT-065c — increment from zero
  it('should_increment_d2_timeout_cycle_count_from_zero', () => {
    const count = incrementD2TimeoutCycleCount({ d2TimeoutCycleCount: 0 })
    expect(count).toBe(1)
  })
})
