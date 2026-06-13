export interface T10Decision {
  finding_id: string
  decision: 'ADOPT' | 'REJECT' | 'MODIFY' | 'DEFER'
  rationale: string | null
  fix_code?: string | null
  original_code?: string | null
  fix_suggestion?: string | null
  defer_target?: string | null
  deferral_reason?: string | null
}

export interface T10Result {
  decisions: T10Decision[]
  status?: 'timeout'
  pending_count?: number
}

export function processT10Decisions(params: {
  decisions: T10Decision[]
  current_phase: number
  severityMap: Record<string, string>
}): T10Result {
  throw new Error('processT10Decisions not implemented')
}

export function validateDeferTarget(deferTarget: string | null | undefined, currentPhase: number): string {
  throw new Error('validateDeferTarget not implemented')
}
