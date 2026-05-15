/**
 * Watchdog configuration loader.
 * Loads .opencode/watchdog.jsonc with fallback defaults.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface WatchdogConfig {
  phaseDeliverables: Record<number, string[]>
  ignorePatterns: string[]
  monitoredTools: string[]
}

/** Built-in fallback patterns — used when config file is missing or broken. */
export const FALLBACK_PATTERNS: Record<number, string[]> = {
  1: ['requirements*.md', 'product-design*.md', 'user-stories*.md', 'prd*.md'],
  2: ['technical*.md', 'architecture*.md', 'design-doc*.md', 'api-design*.md'],
  3: ['test-plan*.md', 'test-strategy*.md', 'test-cases*.md'],
  4: ['implementation-notes*.md'],
  5: ['deployment-checklist*.md', 'release-notes*.md'],
}

/** Default tools to monitor for file writes. */
export const DEFAULT_MONITORED_TOOLS = ['edit', 'write']

/** Strip single-line (//) and multi-line block comments from JSON string. */
function stripJsonComments(jsonc: string): string {
  return jsonc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
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
        if (Number.isNaN(phase)) continue
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

      // Guard: empty monitoredTools would disable all interception — fall back to defaults
      if (monitoredTools.length === 0) {
        logger.warn('watchdog.jsonc has empty monitoredTools — falling back to defaults', configPath)
        monitoredTools.push(...DEFAULT_MONITORED_TOOLS)
      }

      logger.info('Loaded watchdog.jsonc: %d phases, %d ignore patterns, %d monitored tools',
        Object.keys(phaseDeliverables).length, ignorePatterns.length, monitoredTools.length)

      return { phaseDeliverables, ignorePatterns, monitoredTools }
    }

    logger.warn('watchdog.jsonc missing phaseDeliverables — using built-in defaults', configPath)
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  } catch (err) {
    logger.warn('Failed to load watchdog.jsonc: %s — using built-in defaults', String(err))
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  }
}
