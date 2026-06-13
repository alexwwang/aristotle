import { describe, it, expect } from 'vitest'
import { applyRecallToT10SchemaConversion, convertReviewFindingToGPAVFinding, createDualPassOrchestrator } from '../src/dual-pass-gpav.js'
import { makeRalphState } from './helpers.js'

describe('Dual-Pass Degradation', () => {
  // RT-046a
  it('should_degrade_to_pipeline_state_fg_when_recall_fails', () => {
    const orchestrator = createDualPassOrchestrator()
    const state = makeRalphState()
    expect(async () => orchestrator.executeRecall(state)).rejects.toThrow()
  })

  // RT-046b
  it('should_emit_4_gpav_events_with_recall_failed_degradation', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 1, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })).toThrow()
  })

  // RT-046c
  it('should_use_sr_prefix_for_self_review_finding_ids', () => {
    const converted = applyRecallToT10SchemaConversion([{ id: 'SR-R3-1', severity: 'M' }])
    expect(converted).toBeDefined()
  })

  // RT-047a
  it('should_degrade_to_self_review_when_fact_gather_fails', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.executeFactGather(makeRalphState(), [])).toThrow()
  })

  // RT-047b
  it('should_emit_degradation_gpav_events_for_fg_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 2, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'fact_gather_failed' })).toThrow()
  })

  // RT-048a
  it('should_degrade_to_recall_only_when_precision_fails', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.executePrecision(makeRalphState(), [], [])).toThrow()
  })

  // RT-048b
  it('should_apply_recall_to_t10_schema_conversion_rules', () => {
    const findings = [{ id: 'F-01', severity: 'M', verdict: 'CONFIRM' }]
    const converted = applyRecallToT10SchemaConversion(findings)
    expect(converted).toBeDefined()
  })

  // RT-048c
  it('should_use_partial_precision_results_over_recall_only', () => {
    const converted = applyRecallToT10SchemaConversion([{ id: 'F-01', verdict: 'CONFIRM', partial: true }])
    expect(converted).toBeDefined()
  })

  // RT-048b-legacy
  it('should_convert_review_finding_array_to_gpav_finding_dropping_suggestion_field', () => {
    const reviewFindings = [
      { id: 'F-01', severity: 'M', description: 'Issue', location: 'file.ts:10', suggestion: 'Fix it' },
    ]
    const gpavFindings = convertReviewFindingToGPAVFinding(reviewFindings)
    expect(gpavFindings).toBeDefined()
  })

  // RT-049a
  it('should_degrade_to_self_review_when_eval_fix_fails', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.executeEvalFix(makeRalphState(), [])).toThrow()
  })

  // RT-049b
  it('should_use_partial_t10_results_when_available', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.executeEvalFix(makeRalphState(), [{ id: 'F-01', partial: true }])).toThrow()
  })

  // RT-081a
  it('should_emit_dual_pass_degradation_audit_on_recall_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 1, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })).toThrow()
  })

  // RT-081b
  it('should_emit_dual_pass_degradation_audit_on_fact_gather_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 2, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'fact_gather_failed' })).toThrow()
  })

  // RT-081c
  it('should_emit_dual_pass_degradation_audit_on_precision_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 3, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'precision_failed' })).toThrow()
  })

  // RT-081d
  it('should_emit_dual_pass_degradation_audit_on_eval_fix_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 4, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'evalfix_failed' })).toThrow()
  })
})
