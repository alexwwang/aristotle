export interface ContestedIssueState {
  issue_id: string
  severity: 'C' | 'H' | 'M' | 'P' | 'L' | 'I'
  description: string
  location: string
  first_contested_round: number
  dispute_rounds: number
  grounds_same_as_prior: boolean
  consecutive_same_grounds_count: number
  escalated_at_round: number | null
  rationale_history: string[]
}

export type ContestedIssueNextAction = 'continue_dispute' | 'escalate_to_user' | 'auto_accept'

export function resolveContestedIssue(issue: ContestedIssueState): ContestedIssueNextAction {
  if (issue.dispute_rounds < 2) {
    return 'continue_dispute'
  }
  if (issue.escalated_at_round !== null) {
    return 'continue_dispute'
  }
  if (issue.severity === 'P' && !issue.grounds_same_as_prior) {
    return 'continue_dispute'
  }
  if (issue.severity === 'P' && issue.consecutive_same_grounds_count < 2) {
    return 'continue_dispute'
  }
  if (
    issue.dispute_rounds >= 2 &&
    (issue.severity === 'C' || issue.severity === 'H' || issue.severity === 'M') &&
    issue.escalated_at_round === null
  ) {
    return 'escalate_to_user'
  }
  if (issue.severity === 'P' && issue.consecutive_same_grounds_count >= 2) {
    return 'auto_accept'
  }
  if (issue.severity === 'L' || issue.severity === 'I') {
    return 'auto_accept'
  }
  return 'continue_dispute'
}

export function removeContestedIssue(issues: ContestedIssueState[], issueId: string): ContestedIssueState[] {
  return issues.filter(i => i.issue_id !== issueId)
}

export function incrementDisputeRounds(issue: ContestedIssueState): ContestedIssueState {
  return { ...issue, dispute_rounds: issue.dispute_rounds + 1 }
}

export interface EscalationDossier {
  finding: { id: string; severity: string; description: string; location: string }
  agent_rationale: string
  rejection_rationale: string
  evidence: string[]
  recommendation: string
}

export function buildEscalationDossier(issue: ContestedIssueState, agentRationale: string, rejectionRationale: string): EscalationDossier {
  return {
    finding: {
      id: issue.issue_id,
      severity: issue.severity,
      description: issue.description,
      location: issue.location,
    },
    agent_rationale: agentRationale,
    rejection_rationale: rejectionRationale,
    evidence: issue.rationale_history,
    recommendation: `Review ${issue.severity}-severity finding ${issue.issue_id}: ${issue.description}. Disputed for ${issue.dispute_rounds} rounds without resolution.`,
  }
}

export function normalizeGroundsForComparison(grounds: string): string {
  return grounds.trim().replace(/\s+/g, ' ')
}
