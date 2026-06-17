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

const PASS_NAMES = ['Recall', 'Fact-Gather', 'Precision', 'Eval-Fix']

export function runDualPass(config: DualPassConfig, findings: GPAVFinding[]): DualPassResult {
  const events: GPAVEvent[] = []
  let originatingReason: string | undefined
  const recallDegraded = config.recallTimeout === 0
  const precisionDegraded = config.precisionTimeout === 0
  const evalFixDegraded = config.evalFixTimeout === 0

  for (let step = 1; step <= 4; step++) {
    const event: GPAVEvent = {
      round: 1,
      pass_step: step,
      pass_name: PASS_NAMES[step - 1],
      findings: [],
      contested_issues: [],
      rps_results: [],
    }

    if (step === 1 && recallDegraded) {
      event.degradation = 'recall_failed'
      originatingReason = 'recall_failed'
    } else if (step === 2) {
      event.degradation = 'main-agent-self-review'
      if (!originatingReason) originatingReason = 'fact_gather_failed'
    } else if (step === 3 && precisionDegraded) {
      event.degradation = 'recall_only'
      if (!originatingReason) originatingReason = 'precision_failed'
    } else if (step === 3 && !precisionDegraded) {
      event.findings = findings
    } else if (step === 4 && evalFixDegraded) {
      event.degradation = 'confirmed_findings'
      if (!originatingReason) originatingReason = 'evalfix_failed'
    } else if (step === 4 && !evalFixDegraded) {
      event.findings = findings
    }

    if (recallDegraded && step > 1) {
      event.degradation = event.degradation ?? 'recall_failed'
    }

    events.push(event)
  }

  return { events, originatingReason }
}

export function validateGPAVFindingId(id: string): boolean {
  return /^F-\d{2,3}$/.test(id) || /^SR-R\d+-\d+$/.test(id)
}

export function validateGPAVFindingSeverity(severity: string): boolean {
  return ['C', 'H', 'M', 'P', 'L', 'I'].includes(severity)
}

const SEV_RANK: Record<string, number> = { I: 0, L: 1, P: 2, M: 3, H: 4, C: 5 }

export function computeContestedIssueNextAction(issue: ContestedIssue): string {
  const origRank = SEV_RANK[issue.original_severity] ?? 3
  const contestedRank = SEV_RANK[issue.contested_severity] ?? 3
  if (origRank === contestedRank) {
    return 'escalate'
  }
  if (contestedRank < origRank) {
    return 'accept_downgrade'
  }
  return 'accept_upgrade'
}
