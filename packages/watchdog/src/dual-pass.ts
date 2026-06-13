export interface DualPassConfig {
  maxRounds: number
  recallTimeout: number
  precisionTimeout: number
  evalFixTimeout: number
}

export interface DualPassResult {
  events: GPAVEvent[]
  degradation?: string
  originatingReason?: string
}

export interface GPAVEvent {
  round: number
  pass_step: number
  pass_name: string
  findings: GPAVFinding[]
  contested_issues: ContestedIssue[]
  rps_results: RPSResult[]
  degradation?: string
}

export interface GPAVFinding {
  id: string
  severity: 'C' | 'H' | 'M' | 'P' | 'L' | 'I'
  original_severity?: string
  description: string
  location: string
  verdict?: 'CONFIRM' | 'DOWNGRADE' | 'REJECT'
  verdict_reason?: string
  rejected?: boolean
  note?: string
}

export interface ContestedIssue {
  finding_id: string
  original_severity: string
  contested_severity: string
  next_action: 'escalate' | 'defer_to_manual' | 'accept_downgrade' | 'accept_upgrade' | 'split_finding' | 'reject'
}

export interface RPSResult {
  action: string
  finding_id: string
  details: string
}

export function runDualPass(config: DualPassConfig, findings: GPAVFinding[]): DualPassResult {
  throw new Error('runDualPass not implemented')
}

export function validateGPAVFindingId(id: string): boolean {
  throw new Error('validateGPAVFindingId not implemented')
}

export function validateGPAVFindingSeverity(severity: string): boolean {
  throw new Error('validateGPAVFindingSeverity not implemented')
}

export function computeContestedIssueNextAction(issue: ContestedIssue): string {
  throw new Error('computeContestedIssueNextAction not implemented')
}
