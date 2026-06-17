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
  const { raw_findings, location_map, review_scope } = params

  if (raw_findings.length === 0) {
    return { confirmed_findings: [] }
  }

  const inScope: Record<string, unknown>[] = []
  for (const f of raw_findings) {
    const file = extractFilePath(asString(f.location) ?? '')
    if (!isOutOfScope(file, review_scope.out_of_scope)) {
      inScope.push(f)
    }
  }

  if (inScope.length === 0) {
    return { confirmed_findings: [] }
  }

  if (inScope.length >= 2 && Object.keys(location_map).length === 0) {
    return {
      confirmed_findings: [],
      halt_reason: 'empty_location_map',
      error: 'Cannot validate findings without location_map',
    }
  }

  const confirmed_findings: T9ConfirmedFinding[] = []
  for (const f of inScope) {
    const result = evaluateFinding(f, location_map)
    if (result.verdict !== 'REJECT') {
      confirmed_findings.push(result)
    }
  }

  return { confirmed_findings }
}

function evaluateFinding(
  f: Record<string, unknown>,
  location_map: Record<string, { line_ranges?: number[][]; exists?: boolean }>,
): T9ConfirmedFinding {
  const id = asString(f.id) ?? ''
  const severity = asString(f.severity) ?? 'I'
  const description = asString(f.description) ?? ''
  const rawLocation = asString(f.location)

  if (!rawLocation) {
    return {
      id,
      adjusted_severity: 'I',
      original_severity: severity,
      description,
      location: '',
      verdict: 'DOWNGRADE',
      verdict_reason: 'location not provided',
      note: 'location not provided',
    }
  }

  const file = extractFilePath(rawLocation)

  if (!(file in location_map)) {
    return {
      id,
      adjusted_severity: 'I',
      original_severity: severity,
      description,
      location: rawLocation,
      verdict: 'DOWNGRADE',
      verdict_reason: 'location not in location_map',
      note: 'location not in location_map',
    }
  }

  const entry = location_map[file]

  if (entry.exists === false) {
    return {
      id,
      adjusted_severity: 'I',
      original_severity: severity,
      description,
      location: rawLocation,
      verdict: 'DOWNGRADE',
      verdict_reason: 'file does not exist',
      note: 'file does not exist',
    }
  }

  return {
    id,
    adjusted_severity: severity,
    description,
    location: rawLocation,
    verdict: 'CONFIRM',
    verdict_reason: 'location confirmed',
  }
}

function extractFilePath(location: string): string {
  const match = location.match(/^(.+):\d+/)
  return match ? match[1] : location
}

function isOutOfScope(file: string, outOfScope: string[]): boolean {
  return outOfScope.some(pattern => file === pattern || file.startsWith(pattern))
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
