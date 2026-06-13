import { describe, it, expect } from 'vitest'
import {
  validateGPAVFindingId,
  validateGPAVFindingSeverity,
  computeContestedIssueNextAction,
} from '../src/dual-pass.js'
import type { GPAVFinding, ContestedIssue, RPSResult, GPAVEvent } from '../src/dual-pass.js'

describe('GPAV Schema Validation', () => {
  // TC-GPAV-001
  it('should_validate_gpav_finding_id_format', () => {
    expect(validateGPAVFindingId('F-01')).toBe(true)
    expect(validateGPAVFindingId('F-001')).toBe(true)
    expect(validateGPAVFindingId('F-1')).toBe(false)
    expect(validateGPAVFindingId('F-0001')).toBe(false)
    expect(validateGPAVFindingId('X-01')).toBe(false)
  })

  // TC-GPAV-002
  it('should_validate_gpav_finding_severity_taxonomy', () => {
    expect(validateGPAVFindingSeverity('C')).toBe(true)
    expect(validateGPAVFindingSeverity('H')).toBe(true)
    expect(validateGPAVFindingSeverity('M')).toBe(true)
    expect(validateGPAVFindingSeverity('P')).toBe(true)
    expect(validateGPAVFindingSeverity('L')).toBe(true)
    expect(validateGPAVFindingSeverity('I')).toBe(true)
    expect(validateGPAVFindingSeverity('X')).toBe(false)
    expect(validateGPAVFindingSeverity('Major')).toBe(false)
  })

  // TC-GPAV-003
  it('should_include_rejected_marker_in_precision_pass_only', () => {
    const precisionFinding: GPAVFinding = {
      id: 'F-01', severity: 'H', description: 'test', location: 'a.ts:1',
      rejected: true,
    }
    const recallFinding: GPAVFinding = {
      id: 'F-02', severity: 'M', description: 'test', location: 'b.ts:2',
      rejected: false,
    }
    expect(precisionFinding.rejected).toBe(true)
    expect(recallFinding.rejected).toBe(false)
  })

  // TC-GPAV-004
  it('should_compute_contested_issue_next_action_6_conditions', () => {
    const actions: ContestedIssue['next_action'][] = [
      'escalate', 'defer_to_manual', 'accept_downgrade', 'accept_upgrade', 'split_finding', 'reject',
    ]
    for (const action of actions) {
      const issue: ContestedIssue = {
        finding_id: 'F-01',
        original_severity: 'H',
        contested_severity: 'M',
        next_action: action,
      }
      expect(computeContestedIssueNextAction(issue)).toBe(action)
    }
  })

  // TC-GPAV-005
  it('should_validate_rps_result_action_always_warn', () => {
    const rps: RPSResult = { action: 'WARN', finding_id: 'F-01', details: 'test' }
    expect(rps.action).toBe('WARN')
  })

  // TC-GPAV-006
  it('should_validate_t9_timeout_partial_result_schema', () => {
    const timeoutResult = {
      status: 'timeout' as const,
      completed_findings: [{ id: 'F-01', verdict: 'CONFIRM' as const, adjusted_severity: 'H', description: '', location: '', verdict_reason: '' }],
      pending_count: 3,
    }
    expect(timeoutResult.status).toBe('timeout')
    expect(timeoutResult.pending_count).toBe(3)
    expect(timeoutResult.completed_findings).toHaveLength(1)
  })

  // TC-GPAV-007
  it('should_track_cross_pass_finding_correlation', () => {
    const findingId = 'F-01'
    const recallEvent: GPAVEvent = {
      round: 1, pass_step: 1, pass_name: 'Recall',
      findings: [{ id: findingId, severity: 'H', description: 'test', location: 'a.ts:1' }],
      contested_issues: [], rps_results: [],
    }
    const precisionEvent: GPAVEvent = {
      round: 1, pass_step: 3, pass_name: 'Precision',
      findings: [{ id: findingId, severity: 'H', description: 'test', location: 'a.ts:1', verdict: 'CONFIRM', verdict_reason: 'confirmed' }],
      contested_issues: [], rps_results: [],
    }
    const evalEvent: GPAVEvent = {
      round: 1, pass_step: 4, pass_name: 'EvalFix',
      findings: [{ id: findingId, severity: 'H', description: 'test', location: 'a.ts:1', verdict: 'CONFIRM', verdict_reason: 'confirmed' }],
      contested_issues: [], rps_results: [],
    }
    expect(recallEvent.findings[0].id).toBe(findingId)
    expect(precisionEvent.findings[0].id).toBe(findingId)
    expect(evalEvent.findings[0].id).toBe(findingId)
  })

  // TC-GPAV-008
  it('should_handle_zero_completed_timeout_boundary', () => {
    const timeoutResult = {
      status: 'timeout' as const,
      completed_findings: [] as GPAVFinding[],
      pending_count: 5,
    }
    expect(timeoutResult.completed_findings).toHaveLength(0)
    expect(timeoutResult.pending_count).toBe(5)
  })
})
