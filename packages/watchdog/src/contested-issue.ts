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
  throw new Error('Not implemented: resolveContestedIssue')
}

export function removeContestedIssue(issues: ContestedIssueState[], issueId: string): ContestedIssueState[] {
  throw new Error('Not implemented: removeContestedIssue')
}

export function incrementDisputeRounds(issue: ContestedIssueState): ContestedIssueState {
  throw new Error('Not implemented: incrementDisputeRounds')
}

export interface EscalationDossier {
  finding: { id: string; severity: string; description: string; location: string }
  agent_rationale: string
  rejection_rationale: string
  evidence: string[]
  recommendation: string
}

export function buildEscalationDossier(issue: ContestedIssueState, agentRationale: string, rejectionRationale: string): EscalationDossier {
  throw new Error('Not implemented: buildEscalationDossier')
}

export function normalizeGroundsForComparison(grounds: string): string {
  throw new Error('Not implemented: normalizeGroundsForComparison')
}
