/**
 * PromptScanner — scans reviewer prompts for prohibited injection patterns.
 * Phase 2.1: RPS (Reviewer Prompt Sanitization)
 *
 * Pure function — no I/O, no side effects. Testable in isolation.
 */

export interface PatternMatch {
  /** The regex source that matched */
  pattern: string
  /** The actual text that matched */
  match: string
}

export interface SanitizeResult {
  flagged: boolean
  matchedPatterns: PatternMatch[]
}

/**
 * Default prohibited patterns — reviewer prompts should not contain:
 * - Early stop rules / gate pass conditions
 * - Cumulative tallies from previous rounds
 * - Prior-round findings
 * - Expected results framing
 */
export const DEFAULT_PROHIBITED_PATTERNS: RegExp[] = [
  /consecutive.*zero/is,
  /early.?stop/is,
  /gate.?pass/is,
  /\bround\s+\d+.*\bfound\b/is,
  /running.?total/is,
  /previous.*review.*(?:found|identified)/is,
  /fix.?list/is,
  /\bR\d+.*(?:found|identified|fixed)/is,
  /should.?find.?no\b/is,
  /\bverify.?that.*\bno\b/is,
]

/**
 * Scan a prompt string for prohibited patterns.
 * Returns one match per matching pattern so the audit log captures which rules fired.
 */
export function scanPrompt(
  prompt: string,
  patterns: RegExp[] = DEFAULT_PROHIBITED_PATTERNS,
): SanitizeResult {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { flagged: false, matchedPatterns: [] }
  }

  const matchedPatterns: PatternMatch[] = []
  for (const pattern of patterns) {
    const match = prompt.match(pattern)
    if (match) {
      matchedPatterns.push({ pattern: pattern.source, match: match[0] })
    }
  }

  return { flagged: matchedPatterns.length > 0, matchedPatterns }
}
