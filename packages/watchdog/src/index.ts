/**
 * Watchdog role entry point.
 *
 * Design: Phase2-ActiveMonitoring.md §5.4
 *
 * Creates and wires the watchdog role:
 * 1. Resolve config (same sessionsDir as aristotle)
 * 2. Resolve worktree root
 * 3. Create logger
 * 4. Load watchdog config (phase deliverable patterns)
 * 5. Create remaining dependencies (store, stateStore)
 * 6. Create shared infrastructure (cache, session buffer)
 * 7. Create Module B interceptor + Module A observer
 * 8. Create checkpoint handler
 * 9. Run crash recovery (informational logging only)
 * 10. Create tools (tdd_checkpoint, wired to cache)
 * 11. Return RoleRegistration with onToolBefore / onToolAfter
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
import { PipelineStateCache } from './state-cache.js'
import { SessionBuffer } from './session-buffer.js'
import { Interceptor } from './interceptor.js'
import { Observer } from './observer.js'
import { loadWatchdogConfig } from './watchdog-config.js'
import { extractFilePath } from './path-extractor.js'
import { classifyFile } from './file-classifier.js'
import { detectMultiAgent } from './multi-agent.js'
import { createRules } from './intercept-rules.js'
import { STALE_THRESHOLD_MS, SESSION_BUFFER_MAX_SIZE } from './constants.js'

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
  // 1. Resolve config
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir
    ?? readConfigSessionsDir()
    ?? process.env.ARISTOTLE_SESSIONS_DIR
    ?? DEFAULT_SESSIONS_DIR
  mkdirSync(sessionsDir, { recursive: true })

  // 2. Resolve worktree root for path normalization
  const worktreeRoot: string = ctx.worktree ?? process.cwd()

  // 3. Create logger
  const logger = createLogger('watchdog', 'AGENT_PLATFORM_LOG')

  // 4. Load watchdog config (§7.4.1)
  const watchdogConfig = loadWatchdogConfig(worktreeRoot, logger)

  // 5. Create remaining core dependencies
  const stateStore = createStateStore(sessionsDir, logger)
  const store = new PipelineStore(stateStore, logger)

  // 6. Create shared infrastructure
  const multiAgent = detectMultiAgent(ctx)
  const cache = new PipelineStateCache(store, logger, worktreeRoot, multiAgent)
  const sessionBuffer = new SessionBuffer(SESSION_BUFFER_MAX_SIZE)

  // 7. Create Module B interceptor + Module A observer
  const rules = createRules(watchdogConfig)
  const interceptor = new Interceptor(
    cache,
    watchdogConfig,
    extractFilePath,
    classifyFile,
    rules,
  )
  const observer = new Observer(cache, sessionBuffer, store)

  // 8. Create checkpoint handler (wires cache + observer)
  const checkpointHandler = new CheckpointHandler(store, STALE_THRESHOLD_MS, cache, observer)

  // 9. Crash recovery — informational scan
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

  // 10. Create tools
  const tools = createWatchdogTools({ checkpointHandler })

  // 11. Return RoleRegistration with hooks
  return {
    tools,
    onToolBefore: interceptor.handle.bind(interceptor),
    onToolAfter: async (tool, args, output, sessionId, callID) => {
      await observer.handle(tool, args, typeof output === 'string' ? output : JSON.stringify(output), sessionId, callID)
    },
  }
}
