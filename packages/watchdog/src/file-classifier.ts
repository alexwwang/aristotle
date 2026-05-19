/**
 * File classification for TDD pipeline interception.
 * Maps absolute paths to categories using priority-ordered rules.
 */
export type FileCategory = 'test_file' | 'business_code' | 'phase_deliverable' | 'unknown'

export interface FileClassification {
  category: FileCategory
  phase?: number
}

/**
 * Convert a simple glob pattern to a case-insensitive regex.
 * Supports: * (any chars), ? (single char), everything else literal.
 * Pattern is anchored to start and end of filename.
 */
function globToRegex(glob: string, anchored = true): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return anchored ? new RegExp(`^${escaped}$`, 'i') : new RegExp(escaped, 'i')
}

export function classifyFile(
  absolutePath: string,
  deliverablePatterns: Record<number, string[]>,
  ignorePatterns: string[] = [],
): FileClassification {
  const lower = absolutePath.toLowerCase()
  const basename = lower.split(/[\\/]/).pop() ?? ''

  // Rule 0: ignore patterns — classified as 'unknown' regardless of all other rules
  // Patterns with path separators match against full path; basename-only patterns match basename.
  // Spec §3.2.2: "global override — bypasses ALL other rules"
  for (const ignore of ignorePatterns) {
    const hasPathSep = ignore.includes('/') || ignore.includes('\\')
    const re = globToRegex(ignore, !hasPathSep)  // anchored for basename, unanchored for path patterns
    if (hasPathSep ? re.test(lower) : re.test(basename)) {
      return { category: 'unknown' }
    }
  }

  // Rule 1: test directories (spec §3.2.2 Rule 1 — hardcoded)
  const testDirPattern = /[\\/](__tests__|test|tests|spec)[\\/]/
  if (testDirPattern.test(lower)) {
    return { category: 'test_file' }
  }

  // Rule 2: test filenames (spec §3.2.2 Rule 2 — hardcoded)
  // [^\\/]+ allows multi-segment extensions (e.g., .test.integration.ts, .spec.e2e.ts)
  const testFilePattern = /[._](test|spec)\.[^\\/]+$|_test\.[^\\/]+$|^test_.*\.py$/
  if (testFilePattern.test(basename)) {
    return { category: 'test_file' }
  }

  // Rule 3: source directories (spec §3.2.2 Rule 3 — hardcoded)
  if (/[\\/](src|lib|app)[\\/]/i.test(lower)) {
    return { category: 'business_code' }
  }

  // Rule 4: deliverable filename patterns (spec §3.2.2 Rule 4 — config-driven)
  for (const [phaseStr, patterns] of Object.entries(deliverablePatterns)) {
    const phase = Number(phaseStr)
    for (const pattern of patterns) {
      const re = globToRegex(pattern)
      if (re.test(basename)) {
        return { category: 'phase_deliverable', phase }
      }
    }
  }

  // Rule 5: default — unknown (spec §3.2.2 Rule 5)
  return { category: 'unknown' }
}
