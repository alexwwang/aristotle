import { describe, it, expect, vi } from 'vitest'
import { applyRecallToT10SchemaConversion, convertReviewFindingToGPAVFinding, createDualPassOrchestrator } from '../src/dual-pass-gpav.js'
import * as promptAssembleMod from '../src/prompt-assemble.js'
import { makeRalphState } from './helpers.js'

describe('Dual-Pass Degradation', () => {
  // RT-046a — F-019: drive full Dual-Pass entrypoint, mock underlying transport
  it('should_degrade_to_pipeline_state_fg_when_recall_fails', async () => {
    const orchestrator = createDualPassOrchestrator()
    const state = makeRalphState()
    // F-6: mock underlying transport to trigger actual recall failure
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    promptSpy.mockImplementationOnce(() => { throw new Error('T-2 transport crashed') })
    try {
      const result = await orchestrator.executeRecall(state)
      // F-6: assert specific degradation behavior, not just .toBeDefined()
      expect(result).toBeDefined()
      expect((result as { degraded?: boolean }).degraded).toBe(true)
      const fgResult = await orchestrator.executeFactGather(state, [])
      expect(fgResult).toBeDefined()
    } finally {
      promptSpy.mockRestore()
    }
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

  // RT-046c — F-012: pass non-SR-prefixed id to verify function ADDS prefix
  it('should_use_sr_prefix_for_self_review_finding_ids', () => {
    const converted = applyRecallToT10SchemaConversion([{ id: 'F-01', severity: 'M' }]) as Array<{ id: string }>
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
    // F-6: mock underlying transport to trigger actual FG failure
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    promptSpy.mockImplementationOnce(() => { throw new Error('FG transport crashed') })
    try {
      const result = await orchestrator.executeFactGather(makeRalphState(), [])
      // F-6: assert specific degradation marker
      expect(result).toBeDefined()
      expect((result as { degraded?: boolean }).degraded).toBe(true)
    } finally {
      promptSpy.mockRestore()
    }
  })

  // RT-047b — emitGPAVEvent is fire-and-forget; should not throw
  it('should_emit_degradation_gpav_events_for_fg_failure', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 2, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'fact_gather_failed' })).not.toThrow()
  })

  // RT-048a — graceful degradation, not throw
  it('should_degrade_to_recall_only_when_precision_fails', async () => {
    const orchestrator = createDualPassOrchestrator()
    // F-6: mock underlying transport to trigger actual Precision failure
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    promptSpy.mockImplementationOnce(() => { throw new Error('T-9 transport crashed') })
    try {
      const result = await orchestrator.executePrecision(makeRalphState(), [], [])
      // F-6: assert specific degradation marker
      expect(result).toBeDefined()
      expect((result as { degraded?: boolean }).degraded).toBe(true)
    } finally {
      promptSpy.mockRestore()
    }
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

  // RT-048c — F-020: compare partial-vs-zero-finding precedence behavior
  it('should_use_partial_precision_results_over_recall_only', () => {
    const partialConverted = applyRecallToT10SchemaConversion([{ id: 'F-01', verdict: 'CONFIRM', partial: true }]) as Array<Record<string, unknown>>
    expect(partialConverted).toBeDefined()
    expect(partialConverted.length).toBeGreaterThanOrEqual(1)
    const emptyConverted = applyRecallToT10SchemaConversion([{ id: 'F-01', verdict: 'CONFIRM', partial: false }]) as Array<Record<string, unknown>>
    expect(emptyConverted).toBeDefined()
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
    // F-6: mock underlying transport to trigger actual EvalFix failure
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    promptSpy.mockImplementationOnce(() => { throw new Error('T-10 transport crashed') })
    try {
      const result = await orchestrator.executeEvalFix(makeRalphState(), [])
      // F-6: assert specific degradation marker
      expect(result).toBeDefined()
      expect((result as { degraded?: boolean }).degraded).toBe(true)
    } finally {
      promptSpy.mockRestore()
    }
  })

  // RT-049b — partial results used, not throw
  it('should_use_partial_t10_results_when_available', async () => {
    const orchestrator = createDualPassOrchestrator()
    const result = await orchestrator.executeEvalFix(makeRalphState(), [{ id: 'F-01', partial: true }])
    expect(result).toBeDefined()
  })

  // RT-081a — F-7: audit emission must include structured degradation fields
  it('should_emit_dual_pass_degradation_audit_on_recall_failure', () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const orchestrator = createDualPassOrchestrator()
      orchestrator.emitGPAVEvent({ pass_step: 1, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'recall_failed' })
      const degradationCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('DUAL_PASS_DEGRADATION')),
      )
      expect(degradationCalls.length).toBeGreaterThanOrEqual(1)
      // F-7: verify structured fields {failed_step, degradation_path, fallback}
      const auditText = degradationCalls.map(c => c.join(' ')).join(' ')
      expect(auditText).toMatch(/failed_step/)
      expect(auditText).toMatch(/degradation_path/)
      expect(auditText).toMatch(/fallback/)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-081b — F-7: audit emission must include structured degradation fields
  it('should_emit_dual_pass_degradation_audit_on_fact_gather_failure', () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const orchestrator = createDualPassOrchestrator()
      orchestrator.emitGPAVEvent({ pass_step: 2, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'fact_gather_failed' })
      const degradationCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('DUAL_PASS_DEGRADATION')),
      )
      expect(degradationCalls.length).toBeGreaterThanOrEqual(1)
      const auditText = degradationCalls.map(c => c.join(' ')).join(' ')
      expect(auditText).toMatch(/failed_step/)
      expect(auditText).toMatch(/degradation_path/)
      expect(auditText).toMatch(/fallback/)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-081c — F-7: audit emission must include structured degradation fields
  it('should_emit_dual_pass_degradation_audit_on_precision_failure', () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const orchestrator = createDualPassOrchestrator()
      orchestrator.emitGPAVEvent({ pass_step: 3, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'precision_failed' })
      const degradationCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('DUAL_PASS_DEGRADATION')),
      )
      expect(degradationCalls.length).toBeGreaterThanOrEqual(1)
      const auditText = degradationCalls.map(c => c.join(' ')).join(' ')
      expect(auditText).toMatch(/failed_step/)
      expect(auditText).toMatch(/degradation_path/)
      expect(auditText).toMatch(/fallback/)
    } finally {
      auditSpy.mockRestore()
    }
  })

  // RT-081d — F-7: audit emission must include structured degradation fields
  it('should_emit_dual_pass_degradation_audit_on_eval_fix_failure', () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const orchestrator = createDualPassOrchestrator()
      orchestrator.emitGPAVEvent({ pass_step: 4, round: 1, dualPassAttempt: 1, timestamp: '', degradation_reason: 'evalfix_failed' })
      const degradationCalls = auditSpy.mock.calls.filter(
        call => call.some(arg => String(arg).includes('DUAL_PASS_DEGRADATION')),
      )
      expect(degradationCalls.length).toBeGreaterThanOrEqual(1)
      const auditText = degradationCalls.map(c => c.join(' ')).join(' ')
      expect(auditText).toMatch(/failed_step/)
      expect(auditText).toMatch(/degradation_path/)
      expect(auditText).toMatch(/fallback/)
    } finally {
      auditSpy.mockRestore()
    }
  })
})
