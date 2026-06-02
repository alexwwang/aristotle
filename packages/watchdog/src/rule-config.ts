/**
 * Rule configuration helpers for Phase 1 Observer.
 *
 * Provides exit code extraction, syntax validation, command normalization,
 * pattern matching, and the ObserverTimeoutError class.
 */
import * as yaml from 'js-yaml'
import picomatch from 'picomatch'

// ── extractExitCode ──────────────────────────────────────────────────────────

/**
 * Extract exit code from Bash output string.
 * ADR-014: fallback = 1 (fail-safe) when no match found.
 */
export function extractExitCode(output: string): number {
  const match = output.match(/exit code:\s*(\d+)/i)
  if (!match) return 1
  const code = parseInt(match[1], 10)
  // Only non-negative integers; negative text patterns → fallback 1
  return code >= 0 ? code : 1
}

// ── quickSyntaxCheck ─────────────────────────────────────────────────────────

export interface SyntaxCheckResult {
  ok: boolean
  error?: string
}

/**
 * Quick JSON syntax validation.
 * Empty string → ok (no content to check).
 */
export function quickSyntaxCheck(content: string): SyntaxCheckResult {
  if (content === '') return { ok: true }
  try {
    JSON.parse(content)
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

// ── yamlSyntaxCheck ──────────────────────────────────────────────────────────

/**
 * YAML syntax validation using js-yaml with JSON_SCHEMA (safe mode).
 * Rejects JS-specific type tags like !!js/function.
 * Empty string → ok (no content to check).
 */
export function yamlSyntaxCheck(content: string): SyntaxCheckResult {
  if (content === '') return { ok: true }
  try {
    // Use loadAll for multi-document YAML (--- separator support)
    yaml.loadAll(content, undefined, { schema: yaml.JSON_SCHEMA })
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

// ── matchPattern ─────────────────────────────────────────────────────────────

/**
 * Glob pattern matching using picomatch.
 * Empty pattern → false.
 */
export function matchPattern(input: string, pattern: string): boolean {
  if (!pattern) return false
  return picomatch(pattern)(input)
}

// ── normalizeCommand ─────────────────────────────────────────────────────────

/**
 * Normalize a Bash command string:
 * - Trim whitespace
 * - Collapse multiple whitespace chars into single space
 * - Remove sudo prefix
 * - Remove env KEY=VALUE prefix
 */
export function normalizeCommand(cmd: string): string {
  if (!cmd) return ''
  let result = cmd.trim().replace(/\s+/g, ' ')
  // Remove sudo prefix
  if (result.startsWith('sudo ')) {
    result = result.slice(5).trimStart()
  }
  // Remove env KEY=VALUE prefix(es)
  const envPattern = /^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/
  while (envPattern.test(result)) {
    result = result.replace(envPattern, '')
  }
  return result
}

// ── ObserverTimeoutError ─────────────────────────────────────────────────────

/**
 * Custom error for Observer timeout events.
 * Module-level definition — supports instanceof checks across methods.
 */
export class ObserverTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ObserverTimeoutError'
  }
}
