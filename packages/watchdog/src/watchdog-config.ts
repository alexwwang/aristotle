/**
 * Watchdog configuration loader.
 * Loads .opencode/watchdog.jsonc with fallback defaults.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseLoopPhases, isLoopConfigError } from './loop-config.js'
import type { LoopConfigResult } from './loop-config.js'

export interface WatchdogConfig {
  phaseDeliverables: Record<number, string[]>
  ignorePatterns: string[]
  monitoredTools: string[]
  /** Parsed loop configuration. Undefined when loopPhases is missing (legacy).
   *  When present but invalid, loopConfig is omitted and a warning is logged. */
  loopConfig?: LoopConfigResult
}

/** Built-in fallback patterns — used when config file is missing or broken.
 *  Phase 4/5 deliverables are determined by hardcoded classifier rules
 *  (test_file / business_code), not config-driven patterns. */
export const FALLBACK_PATTERNS: Record<number, string[]> = {
  1: ['requirements*.md', 'product-design*.md', 'user-stories*.md', 'prd*.md'],
  2: ['technical*.md', 'architecture*.md', 'design-doc*.md', 'api-design*.md'],
  3: ['test-plan*.md', 'test-strategy*.md', 'test-cases*.md'],
}

/** Default tools to monitor for file writes. */
export const DEFAULT_MONITORED_TOOLS = ['edit', 'write']

/**
 * Strip single-line (//) and multi-line block comments from JSON string.
 * KI-5 fix: respects quoted strings — does not strip // or /* inside "..." values.
 */
function stripJsonComments(jsonc: string): string {
  // Process character-by-character to track string context.
  // Regex-only approaches can't correctly handle escaped quotes or nested strings.
  let inString = false
  let result = ''
  let i = 0
  while (i < jsonc.length) {
    const ch = jsonc[i]
    if (inString) {
      result += ch
      if (ch === '\\') {
        // Escaped character — consume next char too
        i++
        if (i < jsonc.length) result += jsonc[i]
      } else if (ch === '"') {
        inString = false
      }
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      result += ch
      i++
      continue
    }
    // Block comment /*
    if (ch === '/' && i + 1 < jsonc.length && jsonc[i + 1] === '*') {
      const end = jsonc.indexOf('*/', i + 2)
      i = end === -1 ? jsonc.length : end + 2
      continue
    }
    // Line comment //
    if (ch === '/' && i + 1 < jsonc.length && jsonc[i + 1] === '/') {
      const end = jsonc.indexOf('\n', i + 2)
      i = end === -1 ? jsonc.length : end + 1
      continue
    }
    result += ch
    i++
  }
  return result
}

/**
 * Load watchdog config from project worktree.
 * - File exists + valid → use it (file is source of truth)
 * - File missing → log info, use code fallback
 * - File broken (parse error) → log warning, use code fallback
 */
export function loadWatchdogConfig(worktreeRoot: string, logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void }): WatchdogConfig {
  const configPath = join(worktreeRoot, '.opencode', 'watchdog.jsonc')

  if (!existsSync(configPath)) {
    logger.info('No watchdog.jsonc found at %s — using built-in defaults', configPath)
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(stripJsonComments(raw)) as any

    // Validate structure
    if (parsed?.phaseDeliverables && typeof parsed.phaseDeliverables === 'object') {
      const phaseDeliverables: Record<number, string[]> = {}
      for (const [key, value] of Object.entries(parsed.phaseDeliverables)) {
        const phase = Number(key.replace('phase', ''))
        if (Number.isNaN(phase) || phase < 1) continue
        phaseDeliverables[phase] = Array.isArray(value)
          ? value.filter((v: unknown) => typeof v === 'string')
          : []
      }

      const ignorePatterns: string[] = Array.isArray(parsed.ignorePatterns)
        ? parsed.ignorePatterns.filter((v: unknown) => typeof v === 'string')
        : []

      const monitoredTools: string[] = Array.isArray(parsed.monitoredTools)
        ? parsed.monitoredTools.filter((v: unknown) => typeof v === 'string')
        : [...DEFAULT_MONITORED_TOOLS]

      // Empty monitoredTools is likely a misconfiguration — fallback to defaults for safety
      if (monitoredTools.length === 0) {
        logger.warn('watchdog.jsonc has empty monitoredTools — falling back to defaults', configPath)
        monitoredTools.push(...DEFAULT_MONITORED_TOOLS)
      }

      logger.info('Loaded watchdog.jsonc: %d phases, %d ignore patterns, %d monitored tools',
        Object.keys(phaseDeliverables).length, ignorePatterns.length, monitoredTools.length)

      // KI-62: parse loopPhases config if present
      const loopConfig = parseLoopPhasesFromConfig(parsed, logger)

      return { phaseDeliverables, ignorePatterns, monitoredTools, ...loopConfig }
      // Note: spread is safe — helper returns {} (no keys) or { loopConfig: LoopConfigResult }.
      // Never returns { loopConfig: undefined } — missing/invalid configs omit the key entirely.
    }

    logger.warn('watchdog.jsonc missing phaseDeliverables — using built-in defaults: %s', configPath)
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  } catch (err) {
    logger.warn('Failed to load watchdog.jsonc: %s — using built-in defaults', String(err))
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  }
}

/**
 * Parse loopPhases from raw config JSON.
 * - loopPhases present + valid → { loopConfig: LoopConfigResult }
 * - loopPhases present + invalid → log warning, return {} (soft-fail fallback)
 * - loopPhases missing/undefined → return {} (legacy, no loopConfig)
 */
function parseLoopPhasesFromConfig(
  parsed: any,
  logger: { warn: (...args: any[]) => void },
): { loopConfig?: LoopConfigResult } {
  if (parsed.loopPhases === undefined) return {}

  const result = parseLoopPhases(parsed.loopPhases)
  if (isLoopConfigError(result)) {
    logger.warn('Invalid loopPhases config — ignoring: %s', result.message)
    return {} // soft-fail: proceed without loopConfig
  }
  return { loopConfig: result }
}
