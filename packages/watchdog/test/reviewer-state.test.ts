import { describe, it, expect } from 'vitest'
import {
  validateReviewerTakeoverState,
  validateSpawnPhase,
  validateDualPassPhaseEnum,
  setDualPassMode,
} from '../src/reviewer-state.js'

describe('ReviewerTakeoverState validation', () => {
  // RT-079a
  it('should_reject_dual_pass_mode_mutation_at_schema_setter_level', () => {
    const state: { dualPassMode?: boolean } = { dualPassMode: true }
    expect(() => setDualPassMode(state, false)).toThrow('dualPassMode is immutable after takeover creation')
  })

  // RT-079b
  it('should_allow_dual_pass_mode_set_once_on_creation', () => {
    const state: { dualPassMode?: boolean } = {}
    setDualPassMode(state, true)
    expect(state.dualPassMode).toBe(true)
  })

  // RT-080a
  it('should_validate_required_fields_in_reviewer_takeover_state', () => {
    const error = validateReviewerTakeoverState({ round: 3, interceptAt: '2026-01-01T00:00:00Z', spawnPhase: 'pending' })
    expect(error).toBeNull()
  })

  // RT-080b
  it('should_validate_spawn_phase_enum_values', () => {
    expect(validateSpawnPhase('pending')).toBe(true)
    expect(validateSpawnPhase('invalid_phase')).toBe(false)
  })

  // RT-080c
  it('should_validate_dual_pass_phase_enum_values_when_dual_pass_mode', () => {
    expect(validateDualPassPhaseEnum('recall_running')).toBe(true)
    expect(validateDualPassPhaseEnum('invalid')).toBe(false)
  })
})
