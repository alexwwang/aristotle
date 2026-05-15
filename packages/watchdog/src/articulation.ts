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
}

const DIMENSION_KEYWORDS = {
  what_it_protects: ['protect', 'guard', 'defend', 'secure', 'safe', 'invariant'],
  key_risks: ['risk', 'edge case', 'failure', 'error', 'bug', 'regression', 'break', 'corrupt', 'race condition', 'deadlock'],
  why_approach_works: ['because', 'effective', 'ensures', 'guarantees', 'prevents', 'reliable', 'robust', 'maintain'],
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
      lowerText.includes(kw.toLowerCase())
    ),
    key_risks: DIMENSION_KEYWORDS.key_risks.some((kw) =>
      lowerText.includes(kw.toLowerCase())
    ),
    why_approach_works: DIMENSION_KEYWORDS.why_approach_works.some((kw) =>
      lowerText.includes(kw.toLowerCase())
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
  }
}
