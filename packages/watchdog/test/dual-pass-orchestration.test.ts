import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createDualPassOrchestrator, assembleReviewScope, parseLocationMap, enforceT10Contract } from '../src/dual-pass-gpav.js'
import type { DualPassOrchestrator, GPAVEvent } from '../src/dual-pass-gpav.js'
import * as promptAssembleMod from '../src/prompt-assemble.js'
import { existsSync, readFileSync, unlinkSync } from 'fs'
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
    const result = parseLocationMap([':42'])
    expect(result).toHaveLength(1)
    expect((result[0] as { line: number; endLine: number }).line).toBe(42)
    expect((result[0] as { line: number; endLine: number }).endLine).toBe(42)
  })

  // RT-042c-4
  it('should_parse_line_column_location_format', () => {
    const result = parseLocationMap([':42:7'])
    expect(result).toHaveLength(1)
    expect((result[0] as { line: number; column: number; endLine: number }).line).toBe(42)
    expect((result[0] as { line: number; column: number; endLine: number }).column).toBe(7)
    expect((result[0] as { line: number; column: number; endLine: number }).endLine).toBe(42)
  })

  // RT-042c-5
  it('should_parse_line_range_location_format', () => {
    const result = parseLocationMap([':42-58'])
    expect(result).toHaveLength(1)
    expect((result[0] as { line: number; endLine: number }).line).toBe(42)
    expect((result[0] as { line: number; endLine: number }).endLine).toBe(58)
  })

  // RT-042c-6
  it('should_handle_bare_file_path_in_location_map', () => {
    const result = parseLocationMap(['src/auth.ts'])
    expect(result).toHaveLength(1)
    expect((result[0] as { file: string; line: number | null }).file).toBe('src/auth.ts')
    expect((result[0] as { file: string; line: number | null }).line).toBeNull()
  })

  // RT-042c-7
  it('should_merge_contiguous_ranges_by_file_in_location_map', () => {
    const result = parseLocationMap(['src/auth.ts:10-20', 'src/auth.ts:21-30'])
    expect(result).toHaveLength(1)
    expect((result[0] as { file: string; line: number; endLine: number }).file).toBe('src/auth.ts')
    expect((result[0] as { file: string; line: number; endLine: number }).line).toBe(10)
    expect((result[0] as { file: string; line: number; endLine: number }).endLine).toBe(30)
  })

  // RT-042c-8
  it('should_exclude_non_file_locations_from_location_map', () => {
    const result = parseLocationMap(['https://example.com'])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  // RT-043a
  it('should_spawn_t2_recall_first_in_dual_pass_mode', async () => {
    const state = makeRalphState()
    // F-8: verify T-2 is spawned first by checking promptAssemble call order
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    try {
      await orchestrator.executeRecall(state)
      expect(promptSpy).toHaveBeenCalled()
      // F-8: first spawn call must use T-2 (recall) template
      expect(promptSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ templateId: 'T-2' }))
    } finally {
      promptSpy.mockRestore()
    }
  })

  // RT-043b
  // F-4: Red Phase — the JSON.stringify string-containment assertion below is an
  // approximation. Green Phase should instead locate the FG spawn call args on
  // promptAssemble.mock.calls and assert structured access on location_map.
  it('should_pass_location_map_from_recall_to_fact_gather', async () => {
    const state = makeRalphState()
    const locationMap = [{ file: 'src/auth.ts', line: 42 }]
    // F-8: verify location_map is forwarded to the FG spawn call arguments
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    try {
      await orchestrator.executeFactGather(state, locationMap)
      expect(promptSpy).toHaveBeenCalled()
      const fgCall = promptSpy.mock.calls.find(
        c => (c[0] as { templateId?: string }).templateId === 'T-9' || (c[0] as { templateId?: string }).templateId === 'FG',
      )
      // F-8: at least one call must carry the location_map payload
      const allCallsText = JSON.stringify(promptSpy.mock.calls)
      expect(allCallsText).toContain('src/auth.ts')
    } finally {
      promptSpy.mockRestore()
    }
  })

  // RT-043c
  // F-4: Red Phase — string-containment on JSON.stringify is an approximation.
  // Green Phase should verify structured parameter access on promptAssemble call args.
  it('should_spawn_t9_precision_with_raw_findings_from_recall', async () => {
    const state = makeRalphState()
    const rawFindings = [{ id: 'F-01', severity: 'M', description: 'Issue' }]
    const locationMap = [{ file: 'src/auth.ts', line: 42 }]
    // F-8: verify raw_findings are forwarded to the Precision spawn call
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    try {
      await orchestrator.executePrecision(state, rawFindings, locationMap)
      expect(promptSpy).toHaveBeenCalled()
      // F-8: Precision call must carry the raw_findings payload
      const allCallsText = JSON.stringify(promptSpy.mock.calls)
      expect(allCallsText).toContain('F-01')
    } finally {
      promptSpy.mockRestore()
    }
  })

  // RT-043d
  // F-4: Red Phase — string-containment on JSON.stringify is an approximation.
  // Green Phase should verify structured parameter access on promptAssemble call args.
  it('should_spawn_t10_eval_fix_with_confirmed_findings', async () => {
    const state = makeRalphState()
    const confirmedFindings = [{ id: 'F-01', severity: 'M', description: 'Issue', verdict: 'CONFIRM' }]
    // F-8: verify confirmed_findings are forwarded to the EvalFix spawn call
    const promptSpy = vi.spyOn(promptAssembleMod, 'promptAssemble')
    try {
      await orchestrator.executeEvalFix(state, confirmedFindings)
      expect(promptSpy).toHaveBeenCalled()
      // F-8: EvalFix call must carry the confirmed_findings payload
      const allCallsText = JSON.stringify(promptSpy.mock.calls)
      expect(allCallsText).toContain('F-01')
      expect(allCallsText).toContain('CONFIRM')
    } finally {
      promptSpy.mockRestore()
    }
  })

  // RT-043e — F-014: drive full Dual-Pass pipeline, verify 4 GPAVEvents per round
  it('should_emit_4_gpav_events_one_per_pass_step', async () => {
    const emitSpy = vi.spyOn(orchestrator, 'emitGPAVEvent')
    const state = makeRalphState()
    await orchestrator.executeRecall(state)
    await orchestrator.executeFactGather(state, [])
    await orchestrator.executePrecision(state, [], [])
    await orchestrator.executeEvalFix(state, [])
    expect(emitSpy).toHaveBeenCalledTimes(4)
    const steps = emitSpy.mock.calls.map(call => (call[0] as GPAVEvent).pass_step)
    expect(steps).toEqual([1, 2, 3, 4])
  })

  // RT-043f
  it('should_write_result_file_after_eval_fix_completes', async () => {
    const state = makeRalphState()
    await orchestrator.executeEvalFix(state, [])
    const round = state.ralph?.round ?? 1
    const path = orchestrator.getResultFilePath(round)
    expect(path).toContain('reviewer-result-')
    try {
      const content = JSON.parse(readFileSync(path, 'utf-8'))
      expect(content.status).toBe('complete')
      expect(Array.isArray(content.findings)).toBe(true)
    } finally {
      if (existsSync(path)) unlinkSync(path)
    }
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
    const result = await orchestrator.executePrecision(state, rawFindings, locationMap) as { findings?: Array<{ adjusted_severity?: string; verdict_reason?: string }> }
    expect(result).toBeDefined()
    const finding = result.findings?.[0]
    expect(finding?.adjusted_severity).toBe('I')
    expect(finding?.verdict_reason ?? '').toMatch(/quarantined|no longer exists/i)
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

  // RT-058b-3c — DEFER with invalid defer_target format → auto-REJECT (spec: should_auto_reject_defer_with_invalid_defer_target_format)
  it.each(['', 'next time', 'invalid format'])('should_auto_reject_defer_with_invalid_defer_target_%s', (deferTarget) => {
    const decisions = [{ finding_id: 'F-01', decision: 'DEFER', rationale: 'Defer', severity: 'P', defer_target: deferTarget }]
    const result = enforceT10Contract(decisions) as Array<{ finding_id: string; decision: string; rationale: string }>
    expect(result).toHaveLength(1)
    expect(result[0].decision).toBe('REJECT')
  })

  // RT-058b-3c-positive — valid 'Phase N' / 'Phase N Round M' defer_target → accepted
  it.each(['Phase 5', 'Phase 3 Round 2', 'Phase 7 Round 1'])('should_accept_defer_with_valid_defer_target_%s', (deferTarget) => {
    const decisions = [{ finding_id: 'F-01', decision: 'DEFER', rationale: 'Defer', severity: 'P', defer_target: deferTarget }]
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
  it('should_clear_intercepted_fields_after_dual_pass_spawn_completes', async () => {
    const state = makeRalphState()
    // F-25: cleanup triggers on dualPassPhase='done', not spawnPhase='t2_running'
    state.reviewerTakeover = {
      round: 1, interceptAt: new Date().toISOString(),
      spawnPhase: 'done', dualPassPhase: 'done',
      interceptedPrompt: 'prompt-data', interceptedDescription: 'desc-data',
    }
    // Establish state reference in orchestrator before emitting event
    await orchestrator.executeEvalFix(state, [])
    orchestrator.emitGPAVEvent({
      pass_step: 4, round: state.ralph?.round ?? 1, dualPassAttempt: 1,
      timestamp: new Date().toISOString(),
    })
    expect(state.reviewerTakeover?.interceptedPrompt).toBeFalsy()
    expect(state.reviewerTakeover?.interceptedDescription).toBeFalsy()
  })
})
