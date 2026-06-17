import { existsSync } from 'node:fs'

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

const CRITICAL_SEVERITIES = new Set(['C', 'H', 'M'])

export function processT10Decisions(params: {
  decisions: T10Decision[]
  current_phase: number
  severityMap: Record<string, string>
}): T10Result {
  const results: T10Decision[] = []

  for (const d of params.decisions) {
    const result: T10Decision = { ...d }
    const severity = params.severityMap[d.finding_id] ?? 'I'

    if (d.decision === 'DEFER' && CRITICAL_SEVERITIES.has(severity)) {
      console.warn(
        `DEFER on C/H/M finding [${d.finding_id}] auto-rejected — severity requires immediate action.`,
      )
      result.decision = 'REJECT'
      result.rationale = (d.rationale ?? '') + ' [auto-rejected: severity requires immediate action]'
    } else if ((d.decision === 'ADOPT' || d.decision === 'MODIFY') && !hasFix(d)) {
      result.decision = 'REJECT'
      result.rationale = (d.rationale ?? '') + ' [auto-rejected: no fix provided]'
    } else if (
      (d.decision === 'ADOPT' || d.decision === 'MODIFY') &&
      d.fix_code &&
      !isUnifiedDiff(d.fix_code) &&
      !d.original_code
    ) {
      result.decision = 'REJECT'
      result.rationale = (d.rationale ?? '') + ' [auto-rejected: original_code required for inline snippet]'
    } else if (result.decision === 'DEFER') {
      result.defer_target = validateDeferTarget(d.defer_target, params.current_phase)
    }

    if (result.fix_suggestion) {
      result.fix_suggestion = checkFileExistence(result.fix_suggestion)
    }

    results.push(result)
  }

  return { decisions: results }
}

export function validateDeferTarget(
  deferTarget: string | null | undefined,
  currentPhase: number,
): string {
  const fallback = `Phase ${Math.min(currentPhase + 1, 8)}`

  if (!deferTarget) {
    return fallback
  }

  const match = deferTarget.match(/Phase\s*(\d+)(?:\s+Round\s*(\d+))?/i)
  if (!match) {
    return fallback
  }

  const phaseNum = parseInt(match[1], 10)
  if (phaseNum < 1 || phaseNum > 8) {
    return fallback
  }

  if (match[2] !== undefined) {
    const roundNum = parseInt(match[2], 10)
    if (roundNum >= 1) {
      return `Phase ${phaseNum} Round ${roundNum}`
    }
  }

  return `Phase ${phaseNum}`
}

function hasFix(d: T10Decision): boolean {
  return !!(d.fix_code || d.fix_suggestion)
}

function isUnifiedDiff(code: string): boolean {
  return code.startsWith('---') || code.startsWith('+++') || code.includes('@@')
}

function checkFileExistence(suggestion: string): string {
  const filePaths = suggestion.match(/[\w/.-]+\.\w+/g)
  if (!filePaths) return suggestion
  for (const p of filePaths) {
    if (!existsSync(p)) {
      return `${suggestion} [file does not exist: ${p}]`
    }
  }
  return suggestion
}
