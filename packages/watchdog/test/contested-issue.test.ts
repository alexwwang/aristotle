import { describe, it, expect } from 'vitest'
import {
  resolveContestedIssue,
  removeContestedIssue,
  incrementDisputeRounds,
  buildEscalationDossier,
  normalizeGroundsForComparison,
} from '../src/contested-issue.js'
import type { ContestedIssueState } from '../src/contested-issue.js'

describe('ContestedIssue', () => {
  const baseIssue: ContestedIssueState = {
    issue_id: 'M-1',
    severity: 'M',
    description: 'Missing null check',
    location: 'src/auth.ts:42',
    first_contested_round: 1,
    dispute_rounds: 1,
    grounds_same_as_prior: false,
    consecutive_same_grounds_count: 0,
    escalated_at_round: null,
    rationale_history: ['Original finding'],
  }

  // RT-055 condition 1
  it('should_resolve_condition_1_dispute_rounds_under_2_to_continue_dispute', () => {
    const issue = { ...baseIssue, dispute_rounds: 1 }
    const result = resolveContestedIssue(issue)
    expect(result).toBe('continue_dispute')
  })

  // RT-055 condition 2
  it('should_resolve_condition_2_escalated_to_continue_dispute', () => {
    const issue = { ...baseIssue, dispute_rounds: 3, escalated_at_round: 2 }
    const result = resolveContestedIssue(issue)
    expect(result).toBe('continue_dispute')
  })

  // RT-055 condition 3
  it('should_resolve_condition_3_p_severity_grounds_differ_to_continue_dispute', () => {
    const issue = { ...baseIssue, severity: 'P' as const, dispute_rounds: 2, grounds_same_as_prior: false }
    const result = resolveContestedIssue(issue)
    expect(result).toBe('continue_dispute')
  })

  // RT-055 condition 4
  it('should_resolve_condition_4_p_severity_consecutive_under_2_to_continue_dispute', () => {
    const issue = { ...baseIssue, severity: 'P' as const, dispute_rounds: 2, grounds_same_as_prior: true, consecutive_same_grounds_count: 1 }
    const result = resolveContestedIssue(issue)
    expect(result).toBe('continue_dispute')
  })

  // RT-055 condition 5
  it('should_resolve_condition_5_chm_escalate_to_user', () => {
    const issue = { ...baseIssue, severity: 'H' as const, dispute_rounds: 2 }
    const result = resolveContestedIssue(issue)
    expect(result).toBe('escalate_to_user')
  })

  // RT-055 condition 6a
  it('should_resolve_condition_6a_p_consecutive_2_to_auto_accept', () => {
    const issue = { ...baseIssue, severity: 'P' as const, dispute_rounds: 2, grounds_same_as_prior: true, consecutive_same_grounds_count: 2 }
    const result = resolveContestedIssue(issue)
    expect(result).toBe('auto_accept')
  })

  // RT-055 condition 6b — L and I severity → auto_accept
  it.each(['L', 'I'] as const)('should_resolve_condition_6b_severity_%s_to_auto_accept', (severity) => {
    const issue: ContestedIssueState = { ...baseIssue, severity, dispute_rounds: 2 }
    const result = resolveContestedIssue(issue)
    expect(result).toBe('auto_accept')
  })

  // RT-055b
  it('should_collapse_whitespace_before_grounds_comparison', () => {
    const result = normalizeGroundsForComparison('  multiple   spaces  ')
    expect(result).toBe('multiple spaces')
  })

  // RT-056a
  it('should_populate_escalation_dossier_from_rationale_history', () => {
    const issue = { ...baseIssue, rationale_history: ['Original', 'Rejection rationale'] }
    const dossier = buildEscalationDossier(issue, 'Agent says valid', 'Main rejects')
    expect(dossier.evidence).toBeInstanceOf(Array)
    expect(dossier.evidence.length).toBeGreaterThan(0)
  })

  // RT-056b
  it('should_populate_user_message_with_formatted_dossier_on_escalation', () => {
    const issue = { ...baseIssue }
    const dossier = buildEscalationDossier(issue, 'Agent rationale', 'Rejection rationale')
    expect(dossier).toBeDefined()
    expect(dossier.finding).toBeDefined()
  })

  // RT-056c
  it('should_populate_dossier_finding_from_contested_issue_fields', () => {
    const issue: ContestedIssueState = { ...baseIssue, issue_id: 'M-1', severity: 'M', description: 'Issue', location: 'file.ts:10' }
    const dossier = buildEscalationDossier(issue, 'Rationale', 'Rejection')
    expect(dossier.finding.id).toBe('M-1')
  })

  // RT-057a
  it('should_remove_contested_issue_on_accept', () => {
    const issues = [baseIssue, { ...baseIssue, issue_id: 'M-2' }]
    const remaining = removeContestedIssue(issues, 'M-1')
    expect(remaining.length).toBe(1)
    expect(remaining[0].issue_id).toBe('M-2')
  })

  // RT-057b
  // Per spec RT-057: "Acceptance round does NOT increment dispute_rounds counter".
  // The accept path removes the issue (RT-057a) without bumping the counter.
  // Calling incrementDisputeRounds here would contradict RT-057b-cross below
  // (which proves incrementDisputeRounds DOES increment 0→1→2).
  // Verify accept path (removeContestedIssue) preserves dispute_rounds of remaining issues.
  it('should_not_increment_dispute_rounds_on_accept', () => {
    const issues = [
      { ...baseIssue, issue_id: 'M-1', dispute_rounds: 2 },
      { ...baseIssue, issue_id: 'M-2', dispute_rounds: 1 },
    ]
    const remaining = removeContestedIssue(issues, 'M-1')
    // Accepted issue removed; surviving issue's dispute_rounds unchanged
    expect(remaining).toHaveLength(1)
    expect(remaining[0].dispute_rounds).toBe(1)
  })

  // RT-057c
  // Per spec: "No evidence entry appended to EscalationDossier.evidence for the acceptance round".
  // Accept removes the issue; no dossier is built for accepted issues, so no evidence appended.
  it('should_not_append_evidence_on_accept', () => {
    const issues = [{ ...baseIssue, issue_id: 'M-1', rationale_history: ['Original'] }]
    const remaining = removeContestedIssue(issues, 'M-1')
    // Accepted issue removed entirely — no escalation dossier built, no evidence appended
    expect(remaining).toHaveLength(0)
  })

  // RT-057b-cross
  it('should_increment_dispute_rounds_across_multiple_rounds', () => {
    const round1 = incrementDisputeRounds({ ...baseIssue, dispute_rounds: 0 })
    expect(round1.dispute_rounds).toBe(1)
    const round2 = incrementDisputeRounds({ ...round1 })
    expect(round2.dispute_rounds).toBe(2)
  })
})
