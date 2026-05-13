/**
 * Watchdog role entry point.
 *
 * Design: Phase1-Watchdog-StateMachine.md §2.2 index.ts
 *
 * Creates and wires the watchdog role:
 * 1. Resolve config (same sessionsDir as aristotle)
 * 2. Create dependencies (DI — no direct config import)
 * 3. Run crash recovery (informational logging only)
 * 4. Create tools
 * 5. Return RoleRegistration
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import type { RoleRegistration } from '@opencode-ai/core/plugin/registration'
import { createStateStore } from '@opencode-ai/core/store/state-store'
import { createLogger } from '@opencode-ai/core/logger'
import { PipelineStore } from './pipeline-store.js'
import { CheckpointHandler } from './checkpoint.js'
import { createWatchdogTools } from './tools.js'
import { STALE_THRESHOLD_MS } from './constants.js'

const DEFAULT_SESSIONS_DIR = join(homedir(), '.config', 'opencode', 'aristotle-sessions')
const CONFIG_PATH = join(homedir(), '.config', 'opencode', 'aristotle-config.json')

/** Read sessions_dir from aristotle-config.json (mirrors reflection/config.ts) */
function readConfigSessionsDir(): string | null {
  try {
    if (existsSync(CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      return config.sessions_dir ?? null
    }
  } catch { /* ignore parse errors */ }
  return null
}

export async function createWatchdogRole(ctx: any): Promise<RoleRegistration | null> {
  // 1. Resolve config — reuse the same sessionsDir as aristotle
  //    Priority: plugin config > config file > env var > default path (mirrors reflection/config.ts)
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir
    ?? readConfigSessionsDir()
    ?? process.env.ARISTOTLE_SESSIONS_DIR
    ?? DEFAULT_SESSIONS_DIR

  // Ensure sessions directory exists (mirrors reflection/src/index.ts)
  mkdirSync(sessionsDir, { recursive: true })

  // 2. Create dependencies (DI)
  const logger = createLogger('watchdog', 'AGENT_PLATFORM_LOG')
  const stateStore = createStateStore(sessionsDir, logger)
  const store = new PipelineStore(stateStore, logger)
  const checkpointHandler = new CheckpointHandler(store, STALE_THRESHOLD_MS)

  // 3. Crash recovery — informational scan (§7.1)
  //    Scan all projects with active runs, log warnings for stale ones.
  //    No state mutation, no in-memory flags — stale check happens on each checkpoint call.
  try {
    const projectIds = store.getProjectIds()
    for (const projectId of projectIds) {
      const activeRun = store.getActiveRun(projectId)
      if (activeRun) {
        const state = store.readState(projectId, activeRun.runId)
        if (state) {
          const elapsed = Date.now() - new Date(state.lastCheckpointAt).getTime()
          if (elapsed > STALE_THRESHOLD_MS) {
            logger.warn(
              'Found stale watchdog run for project %s: phase %d, last checkpoint %dms ago',
              projectId,
              state.currentPhase,
              elapsed,
            )
          }
        }
      }
    }
  } catch (err) {
    logger.warn('Crash recovery scan failed: %s', String(err))
  }

  // 4. Create tools
  const tools = createWatchdogTools({ checkpointHandler })

  // 5. Return RoleRegistration
  return { tools }
}
