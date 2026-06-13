export interface T9Result {
  confirmed_findings: T9ConfirmedFinding[]
  halt_reason?: string
  error?: string
  status?: 'timeout'
  completed_findings?: T9ConfirmedFinding[]
  pending_count?: number
}

export interface T9ConfirmedFinding {
  id: string
  adjusted_severity: string
  original_severity?: string
  description: string
  location: string
  verdict: 'CONFIRM' | 'DOWNGRADE' | 'REJECT'
  verdict_reason: string
  note?: string
}

export function runT9PrecisionFilter(params: {
  raw_findings: Record<string, unknown>[]
  location_map: Record<string, { line_ranges?: number[][]; exists?: boolean }>
  review_scope: { in_scope: string[]; out_of_scope: string[] }
}): T9Result {
  throw new Error('runT9PrecisionFilter not implemented')
}
