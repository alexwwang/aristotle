import { describe, it, expect } from 'vitest'
import { validateTransition, applyTransition } from '../src/transitions.js'
import {
  makeState,
  makePhaseRecord,
  makeStateWithConfig,
  VALID_CONFIG_MAP,
} from './helpers.js'

// ─── pipeline_start apply ────────────────────────────────────────────────

describe('pipeline_start apply — loopConfig injection', () => {
  it('should inject loopPhaseMap from config', () => {
    const state = null as any
    const payload = {
      description: 'test pipeline',
      totalPhases: 7,
      _loopPhaseMap: VALID_CONFIG_MAP,
      _maxPhase: 7,
    }
    const result = applyTransition('pipeline_start', payload, state)
    expect(result.loopPhaseMap).toEqual(VALID_CONFIG_MAP)
  })

  it('should set maxPhase from config and preserve totalPhases', () => {
    const state = null as any
    const payload = {
      description: 'test',
      totalPhases: 5,
      _loopPhaseMap: VALID_CONFIG_MAP,
      _maxPhase: 7,
    }
    const result = applyTransition('pipeline_start', payload, state)
    expect(result.maxPhase).toBe(7)
    expect(result.totalPhases).toBe(5)
  })

  it('should set maxPhase=totalPhases and loopPhaseMap={} when config missing', () => {
    const state = null as any
    const payload = { description: 'test', totalPhases: 5 }
    const result = applyTransition('pipeline_start', payload, state)
    // No _loopPhaseMap/_maxPhase in payload → apply uses totalPhases as fallback
    expect(result.maxPhase).toBe(5)
    expect(result.loopPhaseMap).toEqual({})
  })
})

// ─── phase_enter validate ────────────────────────────────────────────────

describe('phase_enter validate — effectiveMax boundary', () => {
  it('should reject phase exceeding maxPhase (not totalPhases)', () => {
    // totalPhases=9, maxPhase=7 — proves code uses maxPhase not totalPhases
    // State: phase 7 complete, attempting phase 8
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.totalPhases = 9 // DIFFERENT from maxPhase to ensure discriminatory power
    state.currentPhase = 7
    state.phaseStatus = 'complete'
    state.phases[7] = makePhaseRecord(7, { ralphCompleted: true, userApproved: true, approvedAt: 'now' })
    const result = validateTransition('phase_enter', { phase: 8 }, state)
    // phase 8 ≤ totalPhases(9) → old code accepts; 8 > maxPhase(7) → new code rejects
    expect(result.valid).toBe(false)
  })

  // LEGACY BACKWARD-COMPAT: GREEN with both old and new code. Verifies that when maxPhase
  // is absent, effectiveMax falls back to totalPhases. Discriminatory power for the
  // effectiveMax change is in test #4 above (line 51: totalPhases=9, maxPhase=7, phase=8).
  it('should use totalPhases fallback when maxPhase undefined (legacy)', () => {
    const state = makeState({ currentPhase: 3, phaseStatus: 'active' })
    // Legacy: no maxPhase, totalPhases=5
    const result = validateTransition('phase_enter', { phase: 6 }, state)
    expect(result.valid).toBe(false)
  })
})

// ─── user_approval validate ──────────────────────────────────────────────

describe('user_approval validate — loopType-aware', () => {
  it('should require ralphCompleted for ralph phase', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 1
    state.phaseStatus = 'active'
    state.phases = { 1: makePhaseRecord(1, { ralphCompleted: false }) }
    const result = validateTransition('user_approval', { phase: 1 }, state)
    expect(result.valid).toBe(false)
  })

  it('should reject escalated for ralph phase', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 1
    state.phaseStatus = 'active'
    state.ralph = { phase: 1, round: 1, consecutiveZero: 0, tallyHistory: [], openContested: [], escalated: true, escalatedAt: 'now', termination: null, roundRecords: [], autoValidated: false }
    state.phases = { 1: makePhaseRecord(1, { ralphCompleted: true, ralphTermination: 'escalated' }) }
    const result = validateTransition('user_approval', { phase: 1 }, state)
    expect(result.valid).toBe(false)
  })

  it('should skip ralphCompleted check for followup phase', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 6
    state.phaseStatus = 'active'
    state.phases = { 6: makePhaseRecord(6, { ralphCompleted: false }) }
    const result = validateTransition('user_approval', { phase: 6 }, state)
    // Will FAIL: current code unconditionally checks ralphCompleted
    expect(result.valid).toBe(true)
  })

  // REGRESSION GUARD: This test is GREEN with current code (ralphCompleted=false triggers
  // unconditional rejection at L715). It verifies BACKWARD COMPATIBILITY — the new code's
  // phaseStatus guard must produce the same rejection. Discriminatory power for the NEW code
  // path comes from test #26 (line 94: followup with phaseStatus='active', ralphCompleted=false).
  it('should require phaseStatus=active for followup', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 6
    state.phaseStatus = 'complete'
    state.phases = { 6: makePhaseRecord(6, { ralphCompleted: false }) }
    const result = validateTransition('user_approval', { phase: 6 }, state)
    expect(result.valid).toBe(false)
  })

  // REGRESSION GUARD: GREEN with current code (ralphCompleted=false rejects). After Phase 5,
  // the new code's phaseStatus guard must produce the same result. F-48 regression protection.
  it('should reject double-approval for followup (phaseStatus=awaiting_approval)', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 6
    state.phaseStatus = 'awaiting_approval'
    state.phases = { 6: makePhaseRecord(6, { ralphCompleted: false }) }
    const result = validateTransition('user_approval', { phase: 6 }, state)
    // Current code: rejects because ralphCompleted=false (unconditional check)
    // New code: skips ralphCompleted for followup, then rejects because phaseStatus=awaiting_approval
    expect(result.valid).toBe(false)
  })

  it('should reject unknown loopType', () => {
    const customMap = { 1: 'custom' as any }
    const state = makeStateWithConfig(customMap, 1)
    state.currentPhase = 1
    state.phaseStatus = 'active'
    state.phases = { 1: makePhaseRecord(1, { ralphCompleted: true }) }
    const result = validateTransition('user_approval', { phase: 1 }, state)
    // Defensive else: unknown type rejected
    expect(result.valid).toBe(false)
  })

  it('should fall back to ralph rules when no loopPhaseMap', () => {
    const state = makeState({ currentPhase: 1, phaseStatus: 'active' })
    state.phases = { 1: makePhaseRecord(1, { ralphCompleted: false }) }
    const result = validateTransition('user_approval', { phase: 1 }, state)
    // Legacy: no loopPhaseMap → ralph rules → requires ralphCompleted
    expect(result.valid).toBe(false)
  })
})

// ─── ralph_loop_start validate ───────────────────────────────────────────

describe('ralph_loop_start validate — loopType guard', () => {
  it('should reject followup phase with guidance', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 6
    state.phaseStatus = 'active'
    const result = validateTransition('ralph_loop_start', { phase: 6 }, state)
    // Will FAIL: current code has no loopType guard
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.guidance).toContain('followup')
    }
  })

  it('should accept ralph phase', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 1
    state.phaseStatus = 'active'
    const result = validateTransition('ralph_loop_start', { phase: 1 }, state)
    expect(result.valid).toBe(true)
  })
})

// ─── phase_complete validate ─────────────────────────────────────────────

describe('phase_complete validate — ordered sequence', () => {
  it('should accept after user_approval', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 1
    state.phaseStatus = 'awaiting_approval'
    state.phases = { 1: makePhaseRecord(1, { ralphCompleted: true, userApproved: true, approvedAt: 'now' }) }
    const result = validateTransition('phase_complete', { phase: 1 }, state)
    expect(result.valid).toBe(true)
  })

  it('should reject without prior user_approval', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 1
    state.phaseStatus = 'awaiting_approval'
    state.phases = { 1: makePhaseRecord(1, { ralphCompleted: true, userApproved: false }) }
    const result = validateTransition('phase_complete', { phase: 1 }, state)
    expect(result.valid).toBe(false)
  })
})

// ─── user_approval apply ─────────────────────────────────────────────────

describe('user_approval apply — followup phaseStatus transition', () => {
  it('should set phaseStatus=awaiting_approval for followup', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 6
    state.phaseStatus = 'active'
    state.phases = { 6: makePhaseRecord(6, { ralphCompleted: false }) }
    const result = applyTransition('user_approval', { phase: 6 }, state)
    // Will FAIL: current apply doesn't check loopType or change phaseStatus
    expect(result.phaseStatus).toBe('awaiting_approval')
  })

  // BY-DESIGN NO-OP: Ralph phases always have phaseStatus='awaiting_approval' at
  // user_approval time (set by ralph_terminate, per Tech Solution B.7 invariant).
  // The apply intentionally skips phaseStatus mutation for ralph — same value in/out.
  // Discriminatory power: if Phase 5 accidentally sets phaseStatus='active' for ralph,
  // this test catches it. Zero discrimination against CURRENT code (also no-op) is
  // acceptable — ralph behavior is unchanged by the loopType feature.
  it('should keep phaseStatus unchanged for ralph', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 1
    state.phaseStatus = 'awaiting_approval'
    state.phases = { 1: makePhaseRecord(1, { ralphCompleted: true }) }
    const result = applyTransition('user_approval', { phase: 1 }, state)
    // Ralph: phaseStatus stays 'awaiting_approval' (set by ralph_terminate)
    expect(result.phaseStatus).toBe('awaiting_approval')
    // Also verify the apply didn't accidentally change other core state
    expect(result.currentPhase).toBe(1)
    expect(result.phases[1].userApproved).toBe(true)
  })

  it('should reject phase_complete for followup without user_approval (phaseStatus=active)', () => {
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 6
    state.phaseStatus = 'active'
    state.phases = { 6: makePhaseRecord(6, { ralphCompleted: false, userApproved: false }) }
    const result = validateTransition('phase_complete', { phase: 6 }, state)
    // Followup: active → complete blocked (no user_approval applied yet)
    expect(result.valid).toBe(false)
  })

  it('should accept phase_complete after user_approval apply for followup', () => {
    // Chain: apply user_approval → then validate phase_complete on the new state
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7)
    state.currentPhase = 6
    state.phaseStatus = 'active'
    state.phases = { 6: makePhaseRecord(6, { ralphCompleted: false }) }
    // Apply user_approval first
    const afterApproval = applyTransition('user_approval', { phase: 6 }, state)
    // Then validate phase_complete on the new state
    const result = validateTransition('phase_complete', { phase: 6 }, afterApproval)
    // Will FAIL: current apply doesn't set phaseStatus to awaiting_approval for followup
    expect(result.valid).toBe(true)
  })
})
