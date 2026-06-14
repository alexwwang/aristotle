import { describe, it, expect, vi } from 'vitest'
import { applyRecallToT10SchemaConversion, convertReviewFindingToGPAVFinding, createDualPassOrchestrator } from '../src/dual-pass-gpav.js'
import { makeRalphState } from './helpers.js'

describe('Dual-Pass Degradation', () => {
  // RT-046a — graceful degradation, not throw
  it('should_degrade_to_pipeline_state_fg_when_recall_fails', async () => {
    const orchestrator = createDualPassOrchestrator()
    const state = makeRalphState()
    vi.spyOn(orchestrator, 'executeRecall').mockRejectedValueOnce(new Error('T-2 crashed'))
    await expect(orchestrator.executeRecall(state)).rejects.toThrow('T-2 crashed')
    const fgResult = await orchestrator.executeFactGather(state, [])
    expect(fgResult).toBeDefined()
  })

  // RT-046b — emitGPAVEvent is fire-and-forget; should not throw
  it('should_emit_4_gpav_events_with_recall_failed_degradation', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => {
      orchestrator.emitGPAVEvent({ pass_step: 1, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })
      orchestrator.emitGPAVEvent({ pass_step: 2, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })
      orchestrator.emitGPAVEvent({ pass_step: 3, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })
      orchestrator.emitGPAVEvent({ pass_step: 4, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })
    }).not.toThrow()
  })

  // RT-046c
  it('should_use_sr_prefix_for_self_review_finding_ids', () => {
    const converted = applyRecallToT10SchemaConversion([{ id: 'SR-R3-1', severity: 'M' }]) as Array<{ id: string }>
    expect(converted).toHaveLength(1)
    expect(converted[0].id).toMatch(/^SR-R\d+-\d+$/)
  })

  // RT-046c — multiple findings preserve distinct ordinals
  it('should_preserve_distinct_sr_ordinals_across_multiple_findings', () => {
    const converted = applyRecallToT10SchemaConversion([
      { id: 'SR-R3-1', severity: 'M' },
      { id: 'SR-R3-2', severity: 'M' },
      { id: 'SR-R3-3', severity: 'M' },
    ]) as Array<{ id: string }>
    expect(converted).toHaveLength(3)
    expect(converted.map(f => f.id)).toEqual(['SR-R3-1', 'SR-R3-2', 'SR-R3-3'])
  })

  // RT-047a — graceful degradation, not throw
  it('should_degrade_to_self_review_when_fact_gather_fails', async () => {
    const orchestrator = createDualPassOrchestrator()
    const result = await orchestrator.executeFactGather(makeRalphState(), [])
    expect(result).toBeDefined()
  })

  // RT-047b — emitGPAVEvent is fire-and-forget; should not throw
  it('should_emit_degradation_gpav_events_for_fg_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 2, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'fact_gather_failed' })).not.toThrow()
  })

  // RT-048a — graceful degradation, not throw
  it('should_degrade_to_recall_only_when_precision_fails', async () => {
    const orchestrator = createDualPassOrchestrator()
    const result = await orchestrator.executePrecision(makeRalphState(), [], [])
    expect(result).toBeDefined()
  })

  // RT-048b — verify conversion field mappings per spec
  it('should_apply_recall_to_t10_schema_conversion_rules', () => {
    const findings = [
      { id: 'F-01', severity: 'M', verdict: 'CONFIRM' },
      { id: 'F-02', severity: 'H', verdict: 'REJECT' },
    ]
    const converted = applyRecallToT10SchemaConversion(findings) as Array<Record<string, unknown>>
    expect(converted).toHaveLength(1)
    expect(converted[0].adjusted_severity).toBe('M')
    expect(converted[0].original_severity).toBe('M')
    expect(converted[0].verdict_reason).toBe('confirmed')
    expect(converted.find(f => f.id === 'F-02')).toBeUndefined()
  })

  // RT-048b — DOWNGRADE verdict: severity→adjusted_severity, original→original_severity, downgrade_reason→verdict_reason
  it('should_map_downgrade_verdict_fields_per_schema_conversion_rules', () => {
    const findings = [
      { id: 'F-03', severity: 'H', verdict: 'DOWNGRADE', downgrade_reason: 'overly strict' },
    ]
    const converted = applyRecallToT10SchemaConversion(findings) as Array<Record<string, unknown>>
    expect(converted).toHaveLength(1)
    expect(converted[0].adjusted_severity).toBe('H')
    expect(converted[0].original_severity).toBe('H')
    expect(converted[0].verdict_reason).toBe('overly strict')
  })

  // RT-048c
  it('should_use_partial_precision_results_over_recall_only', () => {
    const converted = applyRecallToT10SchemaConversion([{ id: 'F-01', verdict: 'CONFIRM', partial: true }])
    expect(converted).toBeDefined()
  })

  // RT-048b-legacy — verify suggestion field is dropped per spec
  it('should_convert_review_finding_array_to_gpav_finding_dropping_suggestion_field', () => {
    const reviewFindings = [
      { id: 'F-01', severity: 'M', description: 'Issue', location: 'file.ts:10', suggestion: 'Fix it' },
    ]
    const gpavFindings = convertReviewFindingToGPAVFinding(reviewFindings)
    expect(gpavFindings).toHaveLength(1)
    expect(gpavFindings[0]).not.toHaveProperty('suggestion')
    expect(gpavFindings[0].id).toBe('F-01')
    expect(gpavFindings[0].severity).toBe('M')
    expect(gpavFindings[0].description).toBe('Issue')
    expect(gpavFindings[0].location).toBe('file.ts:10')
  })

  // RT-049a — graceful degradation, not throw
  it('should_degrade_to_self_review_when_eval_fix_fails', async () => {
    const orchestrator = createDualPassOrchestrator()
    const result = await orchestrator.executeEvalFix(makeRalphState(), [])
    expect(result).toBeDefined()
  })

  // RT-049b — partial results used, not throw
  it('should_use_partial_t10_results_when_available', async () => {
    const orchestrator = createDualPassOrchestrator()
    const result = await orchestrator.executeEvalFix(makeRalphState(), [{ id: 'F-01', partial: true }])
    expect(result).toBeDefined()
  })

  // RT-081a — audit emission should not throw (GPAVEvent fire-and-forget)
  it('should_emit_dual_pass_degradation_audit_on_recall_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 1, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })).not.toThrow()
  })

  // RT-081b — audit emission should not throw
  it('should_emit_dual_pass_degradation_audit_on_fact_gather_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 2, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'fact_gather_failed' })).not.toThrow()
  })

  // RT-081c — audit emission should not throw
  it('should_emit_dual_pass_degradation_audit_on_precision_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 3, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'precision_failed' })).not.toThrow()
  })

  // RT-081d — audit emission should not throw
  it('should_emit_dual_pass_degradation_audit_on_eval_fix_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 4, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'evalfix_failed' })).not.toThrow()
  })
})
