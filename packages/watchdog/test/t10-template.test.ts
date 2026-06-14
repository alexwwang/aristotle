import { describe, it, expect, beforeEach } from 'vitest'
import { TaskTemplateRegistry } from '../src/registry.js'
import { processT10Decisions, validateDeferTarget } from '../src/t10-eval.js'
import type { T10Decision } from '../src/t10-eval.js'

describe('T-10 Eval Fix', () => {
  let registry: TaskTemplateRegistry
  beforeEach(() => {
    registry = new TaskTemplateRegistry()
  })

  // TC-T10-001
  it('should_retrieve_t10_template_with_build_subagent', () => {
    const template = registry.get_template('T-10')
    expect(template.subagent_type).toBe('build')
    expect(template.timeout).toBe(120)
    expect(template.name).toBe('eval_fix')
  })

  // TC-T10-002
  it('should_auto_reject_adopt_or_modify_without_fix', () => {
    const adoptDecision: T10Decision = {
      finding_id: 'F-01', decision: 'ADOPT', rationale: 'Valid',
      fix_code: null, fix_suggestion: null,
    }
    const result = processT10Decisions({
      decisions: [adoptDecision],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })
    expect(result.decisions[0].decision).toBe('REJECT')

    const modifyDecision: T10Decision = {
      finding_id: 'F-02', decision: 'MODIFY', rationale: 'Needs change',
      fix_code: null, fix_suggestion: null,
    }
    const result2 = processT10Decisions({
      decisions: [modifyDecision],
      current_phase: 4,
      severityMap: { 'F-02': 'M' },
    })
    expect(result2.decisions[0].decision).toBe('REJECT')

    const adoptWithFix: T10Decision[] = [
      { finding_id: 'F-03', decision: 'ADOPT', rationale: 'Fix 1', fix_suggestion: 'Edit src/a.ts' },
      { finding_id: 'F-04', decision: 'ADOPT', rationale: 'Fix 2', fix_suggestion: 'Edit src/b.ts' },
      { finding_id: 'F-05', decision: 'ADOPT', rationale: 'Fix 3', fix_suggestion: 'Edit src/c.ts' },
    ]
    const result3 = processT10Decisions({
      decisions: adoptWithFix,
      current_phase: 4,
      severityMap: { 'F-03': 'H', 'F-04': 'M', 'F-05': 'L' },
    })
    expect(result3.decisions.every(d => d.decision === 'ADOPT')).toBe(true)
  })

  // TC-T10-003
  it('should_auto_reject_defer_on_c_h_m_severity', () => {
    const rejectSeverities: Array<{ sev: string; fid: string }> = [
      { sev: 'C', fid: 'F-01' },
      { sev: 'H', fid: 'F-02' },
      { sev: 'M', fid: 'F-03' },
    ]
    for (const { sev, fid } of rejectSeverities) {
      const decision: T10Decision = {
        finding_id: fid, decision: 'DEFER', rationale: `Defer ${sev}`,
        defer_target: 'Phase 5', deferral_reason: 'complex',
      }
      const result = processT10Decisions({
        decisions: [decision],
        current_phase: 4,
        severityMap: { [fid]: sev },
      })
      expect(result.decisions[0].decision).toBe('REJECT')
    }

    const acceptSeverities: Array<{ sev: string; fid: string }> = [
      { sev: 'P', fid: 'F-04' },
      { sev: 'L', fid: 'F-05' },
      { sev: 'I', fid: 'F-06' },
    ]
    for (const { sev, fid } of acceptSeverities) {
      const decision: T10Decision = {
        finding_id: fid, decision: 'DEFER', rationale: `Defer ${sev}`,
        defer_target: 'Phase 5', deferral_reason: 'low priority',
      }
      const result = processT10Decisions({
        decisions: [decision],
        current_phase: 4,
        severityMap: { [fid]: sev },
      })
      expect(result.decisions[0].decision).toBe('DEFER')
    }
  })

  // TC-T10-004
  it('should_validate_defer_target_format', () => {
    expect(validateDeferTarget('Phase 5', 4)).toBe('Phase 5')
    expect(validateDeferTarget('Phase 6 Round 2', 5)).toBe('Phase 6 Round 2')
    expect(validateDeferTarget('Phase5', 4)).toBe('Phase 5')
    expect(validateDeferTarget('phase 5', 4)).toBe('Phase 5')
    expect(validateDeferTarget('Phase 5 Round', 4)).toBe('Phase 5')
  })

  // TC-T10-005
  it('should_handle_nonexistent_file_in_fix_suggestion', () => {
    const decision: T10Decision = {
      finding_id: 'F-01', decision: 'ADOPT', rationale: 'Fix applied',
      fix_code: 'const x = 1', fix_suggestion: 'Apply changes to src/fix-target.ts',
      original_code: 'const x = 0',
    }
    const result = processT10Decisions({
      decisions: [decision],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })
    expect(result).toBeDefined()
    expect(result.decisions).toBeDefined()
    expect(result.decisions.length).toBeGreaterThan(0)
    expect(result.decisions[0].fix_suggestion).toMatch(/nonexistent|not found|error|does not exist/i)
  })

  // TC-T10-006
  it('should_fallback_defer_target_on_invalid_format', () => {
    const result = validateDeferTarget('InvalidFormat', 4)
    expect(result).toBe('Phase 5')
  })

  // TC-T10-007
  it('should_not_crash_on_nonexistent_file_in_fix_suggestion', () => {
    const decision: T10Decision = {
      finding_id: 'F-01', decision: 'MODIFY', rationale: 'Fix applied',
      fix_code: 'const x = 1', fix_suggestion: 'Apply changes to /opt/data/fix-target.ts',
      original_code: 'const x = 0',
    }
    const outcomes: Array<ReturnType<typeof processT10Decisions>> = []
    expect(() => {
      outcomes.push(processT10Decisions({
        decisions: [decision],
        current_phase: 4,
        severityMap: { 'F-01': 'H' },
      }))
    }).not.toThrow()
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].decisions).toBeDefined()
    expect(outcomes[0].decisions[0].fix_suggestion).toMatch(/nonexistent|not found|error|does not exist/i)
  })

  // TC-T10-008
  it('should_auto_reject_defer_on_c_h_m_with_warn_log', () => {
    const deferHigh: T10Decision = {
      finding_id: 'F-01', decision: 'DEFER', rationale: 'Defer high',
      defer_target: 'Phase 5', deferral_reason: 'complex',
    }
    const result = processT10Decisions({
      decisions: [deferHigh],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })
    expect(result.decisions[0].decision).toBe('REJECT')
  })

  // TC-T10-009
  it('should_return_timeout_partial_result_with_pending_count', () => {
    const decision: T10Decision = {
      finding_id: 'F-01', decision: 'ADOPT', rationale: 'Valid but timed out',
      fix_code: null, fix_suggestion: null,
    }
    const result = processT10Decisions({
      decisions: [decision],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })
    expect(result.decisions[0].decision).toBe('ADOPT')
    expect(result.status).toBe('timeout')
    expect(typeof result.pending_count).toBe('number')
    // TODO: input lacks explicit timeout indicator — processT10Decisions API
    //  may need an is_timeout or status field to distinguish timeout scenarios
    //  from normal processing.
  })

  // TC-T10-010
  it('should_enforce_original_code_contract_for_adopt', () => {
    const inlineNoOriginal: T10Decision = {
      finding_id: 'F-01', decision: 'ADOPT', rationale: 'Fix applied',
      fix_code: 'const x = 1', original_code: null,
    }
    const result1 = processT10Decisions({
      decisions: [inlineNoOriginal],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })
    expect(result1.decisions[0].decision).toBe('REJECT')

    const diffNoOriginal: T10Decision = {
      finding_id: 'F-02', decision: 'ADOPT', rationale: 'Unified diff',
      fix_code: '--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new', original_code: null,
    }
    const result2 = processT10Decisions({
      decisions: [diffNoOriginal],
      current_phase: 4,
      severityMap: { 'F-02': 'H' },
    })
    expect(result2.decisions[0].decision).toBe('ADOPT')

    const inlineWithOriginal: T10Decision = {
      finding_id: 'F-03', decision: 'ADOPT', rationale: 'Fix with original',
      fix_code: 'const x = 1', original_code: 'const x = 0',
    }
    const result3 = processT10Decisions({
      decisions: [inlineWithOriginal],
      current_phase: 4,
      severityMap: { 'F-03': 'H' },
    })
    expect(result3.decisions[0].decision).toBe('ADOPT')

    const modifyInlineNoOriginal: T10Decision = {
      finding_id: 'F-04', decision: 'MODIFY', rationale: 'Modify inline',
      fix_code: 'const x = 1', original_code: null,
    }
    const result4 = processT10Decisions({
      decisions: [modifyInlineNoOriginal],
      current_phase: 4,
      severityMap: { 'F-04': 'M' },
    })
    expect(result4.decisions[0].decision).toBe('REJECT')

    const diffPlusNoOriginal: T10Decision = {
      finding_id: 'F-05', decision: 'ADOPT', rationale: 'Unified diff +++',
      fix_code: '+++ b/src/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new', original_code: null,
    }
    const result5 = processT10Decisions({
      decisions: [diffPlusNoOriginal],
      current_phase: 4,
      severityMap: { 'F-05': 'H' },
    })
    expect(result5.decisions[0].decision).toBe('ADOPT')
  })

  // TC-T10-011
  it.each([
    ['Phase 9', 4, 'Phase 5'],
    ['Phase 0', 4, 'Phase 5'],
    ['Phase 5 Round 0', 4, 'Phase 5'],
    ['Invalid', 8, 'Phase 8'],
    ['Invalid', 7, 'Phase 8'],
  ])('should_fallback_defer_target_on_out_of_range_values(%s, phase=%i)', (target, phase, expected) => {
    expect(validateDeferTarget(target, phase)).toBe(expected)
  })

  // TC-T10-012
  it('should_handle_null_rationale_in_auto_reject', () => {
    const decision: T10Decision = {
      finding_id: 'F-01', decision: 'ADOPT', rationale: null,
      fix_code: null, fix_suggestion: null,
    }
    const result = processT10Decisions({
      decisions: [decision],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })
    expect(result.decisions[0].rationale).not.toContain('null')
    expect(result.decisions[0].rationale).toContain('auto-rejected')
  })
})
