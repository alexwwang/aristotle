/**
 * Articulation validator — checks if text covers 3 required dimensions.
 *
 * Design: Phase2-ActiveMonitoring.md §8
 * Dimensions:
 *   1. what_it_protects — protect/guard/prevent keywords
 *   2. key_risks — risk/edge case/concern keywords
 *   3. why_approach_works — because/effective/works keywords
 */

export interface ArticulationResult {
  verified: boolean
  dimensions: {
    what_it_protects: boolean
    key_risks: boolean
    why_approach_works: boolean
  }
  missingDimension?: string
  guidance?: string
}

// TechSpec §3.6: keywords are strings (matched via includes) or RegExp (matched via test)
const DIMENSION_KEYWORDS = {
  what_it_protects: ['protect', 'guard', 'prevent', 'skip', 'consequence', 'cost', 'lose', 'break', 'fail', 'wrong', 'impact'] as (string | RegExp)[],
  // 'edge.case' per spec uses regex dot — matches edge-case, edge_case, edge case, edge.case
  key_risks: ['risk', 'failure', /\bedge[\s._-]?cases?\b/i, 'boundary', 'break', 'incorrect', 'wrong', 'bug', 'issue', 'problem', 'limitation'] as (string | RegExp)[],
  why_approach_works: ['because', 'reason', 'works', 'effective', 'chose', 'choose', 'alternative', 'better', 'instead', 'why'] as (string | RegExp)[],
}

function matchesKeyword(lowerText: string, kw: string | RegExp): boolean {
  if (typeof kw === 'string') return lowerText.includes(kw)
  return kw.test(lowerText)
}

const DIMENSION_GUIDANCE: Record<string, string> = {
  what_it_protects: 'Describe what this phase protects — e.g., "protects against X", "guards Y", "prevents Z".',
  key_risks: 'Identify key risks — e.g., "risk of X", "edge-case in Y", "failure mode Z".',
  why_approach_works: 'Explain why the approach works — e.g., "because X", "effective because Y", "chose this over Z because...".',
}

/**
 * Validate articulation text against 3 dimensions.
 */
export function validateArticulation(text: string): ArticulationResult {
  // Length gate: text must be at least 50 characters
  if (text.length < 50) {
    return {
      verified: false,
      dimensions: {
        what_it_protects: false,
        key_risks: false,
        why_approach_works: false,
      },
      missingDimension: 'what_it_protects',
    }
  }

  const lowerText = text.toLowerCase()

  const dimensions = {
    what_it_protects: DIMENSION_KEYWORDS.what_it_protects.some((kw) =>
      matchesKeyword(lowerText, kw)
    ),
    key_risks: DIMENSION_KEYWORDS.key_risks.some((kw) =>
      matchesKeyword(lowerText, kw)
    ),
    why_approach_works: DIMENSION_KEYWORDS.why_approach_works.some((kw) =>
      matchesKeyword(lowerText, kw)
    ),
  }

  const verified =
    dimensions.what_it_protects && dimensions.key_risks && dimensions.why_approach_works

  let missingDimension: string | undefined
  if (!dimensions.what_it_protects) missingDimension = 'what_it_protects'
  else if (!dimensions.key_risks) missingDimension = 'key_risks'
  else if (!dimensions.why_approach_works) missingDimension = 'why_approach_works'

  return {
    verified,
    dimensions,
    missingDimension,
    guidance: missingDimension ? DIMENSION_GUIDANCE[missingDimension] : undefined,
  }
}
