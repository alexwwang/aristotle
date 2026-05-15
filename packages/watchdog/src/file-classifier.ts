/**
 * File classification for TDD pipeline interception.
 * Maps absolute paths to categories using priority-ordered rules.
 */
export interface FileClassification {
  category: string
  phase?: number
}

/**
 * Convert a simple glob pattern to a case-insensitive regex.
 * Supports: * (any chars), ? (single char), everything else literal.
 * Pattern is anchored to start and end of filename.
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
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
  for (const ignore of ignorePatterns) {
    const hasPathSep = ignore.includes('/') || ignore.includes('\\')
    const re = globToRegex(ignore)
    if (hasPathSep ? re.test(lower) : re.test(basename)) {
      return { category: 'unknown' }
    }
  }

  // Rule 1: test directories and test filenames
  const testDirPattern = /[\\/](__tests__|test|tests|spec)[\\/]/
  if (testDirPattern.test(lower)) {
    return { category: 'test_file' }
  }
  // Rule 1b: test filenames (*.test.*, *.spec.*, *_test.*)
  const testFilePattern = /[._](test|spec)\.[a-z]+$|_test\.[a-z]+$|^test_[a-z]+\.[a-z]+$/i
  if (testFilePattern.test(basename)) {
    return { category: 'test_file' }
  }

  // Rule 2: source directories (src, lib, app)
  if (
    lower.includes('/src/') ||
    lower.includes('/lib/') ||
    lower.includes('/app/') ||
    lower.includes('\\src\\') ||
    lower.includes('\\lib\\') ||
    lower.includes('\\app\\')
  ) {
    return { category: 'business_code' }
  }

  // Rule 3: deliverable filename patterns (config-driven)
  for (const [phaseStr, patterns] of Object.entries(deliverablePatterns)) {
    const phase = Number(phaseStr)
    for (const pattern of patterns) {
      const re = globToRegex(pattern)
      if (re.test(basename)) {
        return { category: 'phase_deliverable', phase }
      }
    }
  }

  // Default
  return { category: 'unknown' }
}
