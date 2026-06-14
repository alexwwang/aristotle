import { describe, it, expect } from 'vitest'
import type { PipelineState } from '../src/schema.js'
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

  // RT-080a — positive: valid state accepted (negative cases below cover validation)
  it('should_accept_valid_reviewer_takeover_state', () => {
    const error = validateReviewerTakeoverState({ round: 3, interceptAt: '2026-01-01T00:00:00Z', spawnPhase: 'pending' })
    expect(error).toBeNull()
  })

  // RT-080a — negative: missing round
  it('should_reject_state_with_missing_round', () => {
    const error = validateReviewerTakeoverState({ interceptAt: '2026-01-01T00:00:00Z', spawnPhase: 'pending' })
    expect(error).not.toBeNull()
    expect(error ?? '').toMatch(/round/i)
  })

  // RT-080a — negative: missing interceptAt
  it('should_reject_state_with_missing_intercept_at', () => {
    const error = validateReviewerTakeoverState({ round: 3, spawnPhase: 'pending' })
    expect(error).not.toBeNull()
    expect(error ?? '').toMatch(/interceptAt|intercept_at/i)
  })

  // RT-080a — negative: missing spawnPhase
  it('should_reject_state_with_missing_spawn_phase', () => {
    const error = validateReviewerTakeoverState({ round: 3, interceptAt: '2026-01-01T00:00:00Z' })
    expect(error).not.toBeNull()
    expect(error ?? '').toMatch(/spawnPhase|spawn_phase/i)
  })

  // RT-080a — negative: round wrong types expanded (F-037)
  it.each([
    ['string', 'three'],
    ['null', null],
    ['undefined', undefined],
    ['float', 1.5],
    ['boolean', true],
    ['negative', -1],
    ['object', {}],
    ['array', []],
  ])('should_reject_state_with_non_integer_round_%s', (_label, badRound) => {
    const error = validateReviewerTakeoverState(JSON.parse(JSON.stringify({ round: badRound, interceptAt: '2026-01-01T00:00:00Z', spawnPhase: 'pending' })))
    expect(error).not.toBeNull()
    expect(error ?? '').toMatch(/round.*number|number.*round|round.*integer|integer.*round|round.*positive|positive.*round/i)
  })

  // RT-080a — interceptAt format validation (F-038)
  it.each([
    ['number', 1234567890],
    ['non-date-string', 'not-a-date'],
  ])('should_reject_state_with_invalid_intercept_at_format_%s', (_label, badInterceptAt) => {
    const error = validateReviewerTakeoverState({ round: 3, interceptAt: badInterceptAt as unknown as string, spawnPhase: 'pending' })
    expect(error).not.toBeNull()
    expect(error ?? '').toMatch(/interceptAt|intercept_at|date|ISO/i)
  })

  // RT-080b — all valid spawnPhase enum values
  it.each([
    'pending',
    't1_running',
    't1_done',
    't2_running',
    'done',
    'failed',
  ])('should_accept_valid_spawn_phase_%s', (phase) => {
    expect(validateSpawnPhase(phase)).toBe(true)
  })

  // RT-080b — invalid spawnPhase values
  it.each([
    'invalid_phase',
    '',
    'PENDING',
    'pending ',
    't3_running',
  ])('should_reject_invalid_spawn_phase_%j', (phase) => {
    expect(validateSpawnPhase(phase)).toBe(false)
  })

  // RT-080c — all 13 valid dualPassPhase enum values
  it.each([
    'pending',
    'recall_running',
    'recall_done',
    'factgather_running',
    'factgather_done',
    'precision_running',
    'precision_done',
    'evalfix_running',
    'evalfix_done',
    'd2_running',
    'd25_running',
    'done',
    'failed',
  ])('should_accept_valid_dual_pass_phase_%s', (phase) => {
    expect(validateDualPassPhaseEnum(phase)).toBe(true)
  })

  // RT-080c — invalid dualPassPhase values
  it.each([
    'invalid',
    '',
    'RECALL_RUNNING',
    'recall_running ',
    't3_running',
  ])('should_reject_invalid_dual_pass_phase_%j', (phase) => {
    expect(validateDualPassPhaseEnum(phase)).toBe(false)
  })

  // RT-080 integration: dualPassMode=true requires dualPassPhase (F-040)
  describe('integrated dualPassMode + dualPassPhase validation', () => {
    it('should_reject_state_with_dualPassMode_true_but_missing_dualPassPhase', () => {
      const error = validateReviewerTakeoverState({ round: 3, interceptAt: '2026-01-01T00:00:00Z', spawnPhase: 'pending', dualPassMode: true })
      expect(error).not.toBeNull()
      expect(error ?? '').toMatch(/dualPassPhase|dual_pass_phase/i)
    })

    it('should_accept_state_with_dualPassMode_true_and_valid_dualPassPhase', () => {
      const error = validateReviewerTakeoverState({ round: 3, interceptAt: '2026-01-01T00:00:00Z', spawnPhase: 'pending', dualPassMode: true, dualPassPhase: 'recall_running' })
      expect(error).toBeNull()
    })

    it('should_accept_state_with_dualPassMode_false_without_dualPassPhase', () => {
      const error = validateReviewerTakeoverState({ round: 3, interceptAt: '2026-01-01T00:00:00Z', spawnPhase: 'pending', dualPassMode: false })
      expect(error).toBeNull()
    })
  })
})
