import { describe, it, expect } from 'vitest'
import { createRules } from '../src/intercept-rules.js'
import { makeState, makePhaseRecord, makeStateWithConfig, VALID_CONFIG_MAP, mockClassification } from './helpers.js'
import type { PipelineState } from '../src/schema.js'

describe('Rule 2: NO_PHASE_ADVANCE_WITHOUT_GATE — loopType-aware', () => {
  const rules = createRules()
  const rule2 = rules.find(r => r.id === 'NO_PHASE_ADVANCE_WITHOUT_GATE')!

  it('should allow followup phase deliverable without ralphCompleted', () => {
    // AC-12: followup phases skip ralphCompleted check
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7) as PipelineState
    state.currentPhase = 6
    state.phases = {
      6: makePhaseRecord(6, { ralphCompleted: false, userApproved: true }),
    }
    const classification = mockClassification('phase_deliverable', 7)

    const result = rule2.evaluate('write', 'src/feature.ts', classification, state)
    // Will FAIL: current code checks !rec.ralphCompleted unconditionally
    expect(result.blocked).toBe(false)
  })

  it('should block ralph phase deliverable without ralphCompleted', () => {
    // AC-12: ralph phases still require ralphCompleted
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7) as PipelineState
    state.currentPhase = 5
    state.phases = {
      5: makePhaseRecord(5, { ralphCompleted: false, userApproved: true }),
    }
    const classification = mockClassification('phase_deliverable', 6)

    const result = rule2.evaluate('write', 'src/feature.ts', classification, state)
    expect(result.blocked).toBe(true)
  })

  it('should allow ralph phase deliverable with ralphCompleted and userApproved', () => {
    // AC-12: ralph happy path — both gates passed
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7) as PipelineState
    state.currentPhase = 5
    state.phases = {
      5: makePhaseRecord(5, { ralphCompleted: true, userApproved: true }),
    }
    const classification = mockClassification('phase_deliverable', 6)

    const result = rule2.evaluate('write', 'src/feature.ts', classification, state)
    // This PASSES with current code — tests the new code path works same
    expect(result.blocked).toBe(false)
  })

  it('should still require userApproved for followup deliverable', () => {
    // AC-12: followup still gates on userApproved even without ralphCompleted
    const state = makeStateWithConfig(VALID_CONFIG_MAP, 7) as PipelineState
    state.currentPhase = 6
    state.phases = {
      6: makePhaseRecord(6, { ralphCompleted: false, userApproved: false }),
    }
    const classification = mockClassification('phase_deliverable', 7)

    const result = rule2.evaluate('write', 'src/feature.ts', classification, state)
    expect(result.blocked).toBe(true)
  })

  it('should require ralphCompleted for legacy state without loopPhaseMap', () => {
    // AC-12: legacy state (no loopPhaseMap) falls back to ralph rules
    const state = makeState({ currentPhase: 5 }) as PipelineState
    state.phases = {
      5: makePhaseRecord(5, { ralphCompleted: false, userApproved: true }),
    }
    const classification = mockClassification('phase_deliverable', 6)

    const result = rule2.evaluate('write', 'src/feature.ts', classification, state)
    // Regression: must continue to block — legacy state has no loopPhaseMap,
    // new code must fall back to ralph rules (require ralphCompleted)
    expect(result.blocked).toBe(true)
  })
})
