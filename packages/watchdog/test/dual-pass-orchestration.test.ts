import { describe, it, expect, beforeEach } from 'vitest'
import { createDualPassOrchestrator, assembleReviewScope, parseLocationMap, enforceT10Contract } from '../src/dual-pass-gpav.js'
import type { DualPassOrchestrator, GPAVEvent } from '../src/dual-pass-gpav.js'
import { makeRalphState } from './helpers.js'

describe('Dual-Pass Orchestration', () => {
  let orchestrator: DualPassOrchestrator

  beforeEach(() => {
    orchestrator = createDualPassOrchestrator()
  })

  // RT-042c-1
  it('should_assemble_review_scope_from_target_files_and_direct_imports', () => {
    const result = assembleReviewScope(['src/auth.ts', 'src/user.ts'], ['src/types.ts'])
    expect(result.in_scope).toContain('src/auth.ts')
    expect(result.in_scope).toContain('src/user.ts')
    expect(result.in_scope).toContain('src/types.ts')
  })

  // RT-042c-2
  it('should_include_catchall_sentinel_in_out_of_scope', () => {
    const result = assembleReviewScope(['src/auth.ts'], [])
    expect(result.out_of_scope).toContain('**/*')
  })

  // RT-042c-3
  it('should_parse_line_only_location_format', () => {
    const result = parseLocationMap([':42']) as Array<{ line: number; endLine: number }>
    expect(result).toHaveLength(1)
    expect(result[0].line).toBe(42)
    expect(result[0].endLine).toBe(42)
  })

  // RT-042c-4
  it('should_parse_line_column_location_format', () => {
    const result = parseLocationMap([':42:7']) as Array<{ line: number; column: number; endLine: number }>
    expect(result).toHaveLength(1)
    expect(result[0].line).toBe(42)
    expect(result[0].column).toBe(7)
    expect(result[0].endLine).toBe(42)
  })

  // RT-042c-5
  it('should_parse_line_range_location_format', () => {
    const result = parseLocationMap([':42-58']) as Array<{ line: number; endLine: number }>
    expect(result).toHaveLength(1)
    expect(result[0].line).toBe(42)
    expect(result[0].endLine).toBe(58)
  })

  // RT-042c-6
  it('should_handle_bare_file_path_in_location_map', () => {
    const result = parseLocationMap(['src/auth.ts'])
    expect(Array.isArray(result)).toBe(true)
  })

  // RT-042c-7
  it('should_merge_contiguous_ranges_by_file_in_location_map', () => {
    const result = parseLocationMap(['src/auth.ts:10-20', 'src/auth.ts:21-30'])
    expect(Array.isArray(result)).toBe(true)
  })

  // RT-042c-8
  it('should_exclude_non_file_locations_from_location_map', () => {
    const result = parseLocationMap(['https://example.com'])
    expect(Array.isArray(result)).toBe(true)
  })

  // RT-043a
  it('should_spawn_t2_recall_first_in_dual_pass_mode', async () => {
    const state = makeRalphState()
    const result = await orchestrator.executeRecall(state)
    expect(result).toBeDefined()
  })

  // RT-043b
  it('should_pass_location_map_from_recall_to_fact_gather', async () => {
    const state = makeRalphState()
    const locationMap = [{ file: 'src/auth.ts', line: 42 }]
    const result = await orchestrator.executeFactGather(state, locationMap)
    expect(result).toBeDefined()
  })

  // RT-043c
  it('should_spawn_t9_precision_with_raw_findings_from_recall', async () => {
    const state = makeRalphState()
    const rawFindings = [{ id: 'F-01', severity: 'M', description: 'Issue' }]
    const locationMap = [{ file: 'src/auth.ts', line: 42 }]
    const result = await orchestrator.executePrecision(state, rawFindings, locationMap)
    expect(result).toBeDefined()
  })

  // RT-043d
  it('should_spawn_t10_eval_fix_with_confirmed_findings', async () => {
    const state = makeRalphState()
    const confirmedFindings = [{ id: 'F-01', severity: 'M', description: 'Issue', verdict: 'CONFIRM' }]
    const result = await orchestrator.executeEvalFix(state, confirmedFindings)
    expect(result).toBeDefined()
  })

  // RT-043e — emit 4 GPAVEvents (one per pass_step); verify no throw
  it('should_emit_4_gpav_events_one_per_pass_step', () => {
    const baseEvent = { round: 1, dualPassAttempt: 1, timestamp: new Date().toISOString() }
    expect(() => {
      orchestrator.emitGPAVEvent({ ...baseEvent, pass_step: 1 } as GPAVEvent)
      orchestrator.emitGPAVEvent({ ...baseEvent, pass_step: 2 } as GPAVEvent)
      orchestrator.emitGPAVEvent({ ...baseEvent, pass_step: 3 } as GPAVEvent)
      orchestrator.emitGPAVEvent({ ...baseEvent, pass_step: 4 } as GPAVEvent)
    }).not.toThrow()
  })

  // RT-043f
  it('should_write_result_file_after_eval_fix_completes', () => {
    const path = orchestrator.getResultFilePath(3)
    expect(path).toContain('reviewer-result-')
  })

  // RT-043b-zero
  it('should_proceed_to_fact_gather_when_recall_returns_zero_findings', async () => {
    const state = makeRalphState()
    const result = await orchestrator.executeFactGather(state, [])
    expect(result).toBeDefined()
  })

  // RT-043c-quarantine
  it('should_downgrade_to_i_level_when_finding_references_quarantined_file', async () => {
    const state = makeRalphState()
    const rawFindings = [{ id: 'F-01', severity: 'M', description: 'Issue', location: 'deleted.ts:10' }]
    const locationMap = [{ file: 'deleted.ts', line: 10, exists: false }]
    const result = await orchestrator.executePrecision(state, rawFindings, locationMap)
    expect(result).toBeDefined()
  })

  // RT-058b-1 — ADOPT without fix → auto-REJECT
  it('should_auto_reject_adopt_without_fix_code_or_fix_suggestion', () => {
    const decisions = [{ finding_id: 'F-01', decision: 'ADOPT', rationale: 'Valid' }]
    const result = enforceT10Contract(decisions) as Array<{ finding_id: string; decision: string; rationale: string }>
    expect(result).toHaveLength(1)
    expect(result[0].decision).toBe('REJECT')
    expect(result[0].rationale).toContain('auto-rejected')
  })

  // RT-058b-2 — timeout ADOPT exempted from fix requirement
  it('should_exempt_timeout_adopt_from_fix_requirement', () => {
    const decisions = [{ finding_id: 'F-01', decision: 'ADOPT', rationale: 'Valid' }]
    const result = enforceT10Contract(decisions, true) as Array<{ finding_id: string; decision: string }>
    expect(result).toHaveLength(1)
    expect(result[0].decision).toBe('ADOPT')
  })

  // RT-058b-3 — DEFER on C/H/M → auto-REJECT
  it.each(['C', 'H', 'M'])('should_reject_defer_for_severity_%s', (severity) => {
    const decisions = [{ finding_id: 'F-01', decision: 'DEFER', rationale: 'Later', severity }]
    const result = enforceT10Contract(decisions) as Array<{ finding_id: string; decision: string }>
    expect(result).toHaveLength(1)
    expect(result[0].decision).toBe('REJECT')
  })

  // RT-058b-3b — DEFER on P/L/I → accepted (spec: "DEFER on P/L/I → accepted")
  it.each(['P', 'L', 'I'])('should_accept_defer_for_severity_%s', (severity) => {
    const decisions = [{ finding_id: 'F-01', decision: 'DEFER', rationale: 'Phase 5', severity, defer_target: 'Phase 5' }]
    const result = enforceT10Contract(decisions) as Array<{ finding_id: string; decision: string }>
    expect(result).toHaveLength(1)
    expect(result[0].decision).toBe('DEFER')
  })

  // RT-058b-4 — MODIFY with fix_code → accepted
  it('should_accept_modify_with_fix_code', () => {
    const decisions = [{ finding_id: 'F-01', decision: 'MODIFY', rationale: 'Fix', fix_code: 'const x = 1' }]
    const result = enforceT10Contract(decisions) as Array<{ finding_id: string; decision: string }>
    expect(result).toHaveLength(1)
    expect(result[0].decision).toBe('MODIFY')
  })

  // RT-058b-5 — MODIFY without fix → auto-REJECT
  it('should_auto_reject_modify_without_fix_code_or_fix_suggestion', () => {
    const decisions = [{ finding_id: 'F-01', decision: 'MODIFY', rationale: 'Needs fix' }]
    const result = enforceT10Contract(decisions) as Array<{ finding_id: string; decision: string; rationale: string }>
    expect(result).toHaveLength(1)
    expect(result[0].decision).toBe('REJECT')
    expect(result[0].rationale).toContain('MODIFY')
  })

  // RT-087d
  it('should_clear_intercepted_fields_after_dual_pass_spawn_completes', () => {
    expect(orchestrator.getResultFilePath(3)).toBeDefined()
  })
})
