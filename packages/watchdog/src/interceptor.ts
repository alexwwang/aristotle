import { resolve } from 'node:path'
import type { InterceptRule } from './intercept-rules.js'
import type { PipelineStateCache } from './state-cache.js'
import type { PipelineStore } from './pipeline-store.js'
import type { FileClassification } from './file-classifier.js'
import type { PipelineState, AuditLogEntry } from './schema.js'
import type { Logger } from '@opencode-ai/core/logger'

/**
 * Thrown when the interceptor blocks a tool call due to a TDD invariant violation.
 * This is an EXPECTED throw — the tool is intentionally blocked.
 */
export class WatchdogInterceptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchdogInterceptError'
  }
}

export interface InterceptorConfig {
  worktreeRoot: string
  monitoredTools: string[]
  phaseDeliverables: Record<number, string[]>
  ignorePatterns: string[]
}

/**
 * File write interceptor — evaluates TDD rules before tool execution.
 * Bound to RoleRegistration.onToolBefore.
 */
export class Interceptor {
  private _monitoredTools: Set<string>

  constructor(
    private _cache: PipelineStateCache,
    private _config: InterceptorConfig,
    private _pathExtractor: (tool: string, args: unknown) => string | null,
    private _fileClassifier: (path: string, patterns: Record<number, string[]>, ignore: string[]) => FileClassification,
    private _rules: InterceptRule[],
    private _store?: PipelineStore,
    private _logger?: Logger,
  ) {
    this._monitoredTools = new Set(_config.monitoredTools)
  }

  async handle(tool: string, args: unknown, sessionID: string, callID: string): Promise<void> {
    try {
      // 1. Check if tool is in monitoredTools → if not, return silently
      if (!this._monitoredTools.has(tool)) {
        return
      }

      // 2. Get state from cache → if null, return silently
      const state: PipelineState | null = this._cache.get()
      if (!state) {
        return
      }

      // 3. Extract file path via pathExtractor
      const rawPath = this._pathExtractor(tool, args)
      if (!rawPath) {
        this._logger?.warn('Interceptor: %s call missing target path — allowing write (safe degradation)', tool)
        return
      }

      // 4. Resolve to absolute path (C-6) — relative paths like ./src/foo.ts
      //    would bypass /src/ regex in classifier without this step.
      const worktreeRoot = this._config.worktreeRoot
      const filePath = worktreeRoot ? resolve(worktreeRoot, rawPath) : rawPath

      // 5. Classify file via fileClassifier
      const classification = this._fileClassifier(
        filePath,
        this._config.phaseDeliverables,
        this._config.ignorePatterns,
      )

      // 6. Run rules in order → first blocked rule wins
      for (const rule of this._rules) {
        const result = rule.evaluate(tool, filePath, classification, state)
        if (result?.blocked) {
          // M1 fix: persist interception audit before throwing
          if (this._store) {
            try {
              const auditEntry: AuditLogEntry = {
                timestamp: new Date().toISOString(),
                runId: state.runId,
                projectId: state.projectId,
                sessionId: sessionID,
                event: 'INTERCEPT',
                phase: state.currentPhase,
                decision: 'BLOCK',
                violation: result.reason || 'Blocked by TDD Watchdog rule',
              }
              this._store.appendAudit(state.projectId, state.runId, auditEntry)
            } catch (auditErr) {
              this._logger?.error('Failed to write intercept audit: %s', String(auditErr))
            }
          }
          throw new WatchdogInterceptError(
            result.reason || 'Blocked by TDD Watchdog rule',
          )
        }
      }

      // 7. If no rule blocked → return silently
      return
    } catch (err) {
      // Re-throw known intentional errors
      if (err instanceof WatchdogInterceptError) {
        throw err
      }
      // On unexpected error → log then throw plain Error with TDD Watchdog prefix
      this._logger?.error('Interceptor unexpected error: %s', String(err))
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(
        `⛔ [TDD Watchdog] Unexpected error during interception: ${message}. Please restart the pipeline.`,
      )
    }
  }
}
