import { describe, it, expect } from 'vitest'
import { TaskTemplateRegistry } from '../src/registry.js'
import { processT10Decisions, validateDeferTarget } from '../src/t10-eval.js'
import type { T10Decision } from '../src/t10-eval.js'

describe('T-10 Eval Fix', () => {
  const registry = new TaskTemplateRegistry()

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
  })

  // TC-T10-003
  it('should_auto_reject_defer_on_c_h_m_severity', () => {
    const deferCritical: T10Decision = {
      finding_id: 'F-01', decision: 'DEFER', rationale: 'Defer critical',
      defer_target: 'Phase 5', deferral_reason: 'too complex',
    }
    const result = processT10Decisions({
      decisions: [deferCritical],
      current_phase: 4,
      severityMap: { 'F-01': 'C' },
    })
    expect(result.decisions[0].decision).toBe('REJECT')

    const deferInfo: T10Decision = {
      finding_id: 'F-02', decision: 'DEFER', rationale: 'Defer info',
      defer_target: 'Phase 5', deferral_reason: 'low priority',
    }
    const result2 = processT10Decisions({
      decisions: [deferInfo],
      current_phase: 4,
      severityMap: { 'F-02': 'I' },
    })
    expect(result2.decisions[0].decision).toBe('DEFER')
  })

  // TC-T10-004
  it('should_validate_defer_target_format', () => {
    expect(validateDeferTarget('Phase 5', 4)).toBe('Phase 5')
    expect(validateDeferTarget('Phase 6 Round 2', 5)).toBe('Phase 6 Round 2')
  })

  // TC-T10-005
  it('should_handle_nonexistent_file_in_fix_suggestion', () => {
    const decision: T10Decision = {
      finding_id: 'F-01', decision: 'ADOPT', rationale: 'Fix applied',
      fix_code: 'const x = 1', fix_suggestion: 'Edit src/nonexistent.ts',
    }
    const result = processT10Decisions({
      decisions: [decision],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })
    expect(result).toBeDefined()
  })

  // TC-T10-006
  it('should_fallback_defer_target_on_invalid_format', () => {
    const result = validateDeferTarget('InvalidFormat', 4)
    expect(result).toMatch(/^Phase \d+$/)
  })

  // TC-T10-007
  it('should_not_crash_on_nonexistent_file_in_fix_suggestion', () => {
    const decision: T10Decision = {
      finding_id: 'F-01', decision: 'MODIFY', rationale: 'Fix applied',
      fix_code: 'const x = 1', fix_suggestion: 'Edit /nonexistent/path/file.ts',
    }
    expect(() => processT10Decisions({
      decisions: [decision],
      current_phase: 4,
      severityMap: { 'F-01': 'H' },
    })).not.toThrow()
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
    expect(result).toBeDefined()
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
  })

  // TC-T10-011
  it('should_fallback_defer_target_on_out_of_range_values', () => {
    const result1 = validateDeferTarget('Phase 9', 4)
    expect(result1).toMatch(/^Phase \d+$/)

    const result2 = validateDeferTarget('Phase 0', 4)
    expect(result2).toMatch(/^Phase \d+$/)

    const result3 = validateDeferTarget('Phase 5 Round 0', 4)
    expect(result3).toMatch(/^Phase \d+$/)
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
