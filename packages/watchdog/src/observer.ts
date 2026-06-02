/**
 * Observer — observes tool execution via onToolAfter hook.
 * Design: Phase2-ActiveMonitoring.md §6.2, Phase 1 enhancement §3.1
 */
import type { PipelineStateCache } from './state-cache.js'
import type { SessionBuffer } from './session-buffer.js'
import type { PipelineStore } from './pipeline-store.js'
import type { Logger } from '@opencode-ai/core/logger'
import { OBS_TYPE_REVIEWER_SPAWNED, OBS_TYPE_OBSERVER_DEGRADED, OBS_TYPE_PROMPT_INJECTION } from './schema.js'
import { scanPrompt } from './prompt-scanner.js'
import type { AuditLogEntry, PipelineState } from './schema.js'
import { extractExitCode, quickSyntaxCheck, yamlSyntaxCheck, matchPattern, normalizeCommand, ObserverTimeoutError } from './rule-config.js'
import { OBSERVER_TIMEOUT_MS, TIMEOUT_DEGRADE_THRESHOLD } from './constants.js'

export interface RuleConfig {
  enabled: boolean
  severity: 'block' | 'warn'
  ignoreExitCodes?: number[]
  ignoreCommands?: string[]
  extensions?: string[]
  maxFileSize?: number
}

export interface RuleConfigLoader {
  load(ruleName: string): RuleConfig
}

export class Observer {
  private cache: PipelineStateCache
  private sessionBuffer: SessionBuffer
  private store: PipelineStore
  private logger?: Logger
  private ruleConfigLoader?: RuleConfigLoader
  private _timedOut = false

  private degradedRounds = new Map<string, Set<number>>()
  private degradedRuns = new Set<string>()
  private handlerFailedPipelines = new Set<string>()

  constructor(cache: PipelineStateCache, sessionBuffer: SessionBuffer, store: PipelineStore, logger?: Logger, ruleConfigLoader?: RuleConfigLoader) {
    this.cache = cache
    this.sessionBuffer = sessionBuffer
    this.store = store
    this.logger = logger
    this.ruleConfigLoader = ruleConfigLoader
  }

  isDegraded(projectId: string, runId: string, round?: number): boolean {
    const key = `${projectId}/${runId}`
    if (this.handlerFailedPipelines.has(key)) return true
    if (round === undefined) {
      if (this.degradedRuns.has(key)) return true
      const rounds = this.degradedRounds.get(key)
      return rounds !== undefined && rounds.size > 0
    }
    const rounds = this.degradedRounds.get(key)
    return rounds?.has(round) ?? false
  }

  clearDegradation(projectId: string, runId: string): void {
    const key = `${projectId}/${runId}`
    this.degradedRounds.delete(key)
    this.degradedRuns.delete(key)
    this.handlerFailedPipelines.delete(key)
  }

  private async scanTaskPrompt(
    tool: string,
    args: unknown,
    state: { projectId: string; runId: string; currentPhase: number },
    round: number,
    callID: string,
    sessionID: string,
  ): Promise<void> {
    try {
      const promptsToScan: string[] = []
      if (args && typeof args === 'object') {
        const a = args as Record<string, unknown>
        if (typeof a.prompt === 'string' && a.prompt.length > 0) promptsToScan.push(a.prompt)
        if (typeof a.description === 'string' && a.description.length > 0) promptsToScan.push(a.description)
      }

      if (promptsToScan.length === 0) return

      const allMatches: Array<{ pattern: string; match: string }> = []
      for (const p of promptsToScan) {
        const result = scanPrompt(p)
        if (result.flagged) allMatches.push(...result.matchedPatterns)
      }

      if (allMatches.length === 0) return

      const patterns = allMatches.map(m => `"${m.match}" (${m.pattern})`).join(', ')
      this.logger?.warn('RPS: prompt injection detected in Task call round %d: %s', round, patterns)

      const auditEntry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        runId: state.runId, projectId: state.projectId, sessionId: sessionID,
        event: 'PROMPT_INJECTION_DETECTED', phase: state.currentPhase, round,
        decision: 'WARN',
        violation: `Prohibited patterns in reviewer prompt: ${patterns}`,
      }
      await this.store.appendAudit(state.projectId, state.runId, auditEntry)

      await this.store.appendObservation(state.projectId, state.runId, {
        timestamp: new Date().toISOString(),
        type: OBS_TYPE_PROMPT_INJECTION, tool, callID, round,
        metadata: { matchedPatterns: allMatches, sessionId: sessionID },
      })
    } catch (err) {
      this.logger?.warn('RPS scan failed (suppressed): %s', String(err))
    }
  }

  async handle(
    tool: string,
    args: unknown,
    output: unknown,
    sessionID: string,
    callID: string,
  ): Promise<void> {
    try {
      this._timedOut = false
      const state = this.cache.get()

      if (state && state.phaseStatus === 'ralph_loop' && tool === 'Task') {
        const round = (state.ralph?.round ?? 0) + 1
        const entry = {
          timestamp: new Date().toISOString(),
          type: OBS_TYPE_REVIEWER_SPAWNED, tool, callID, round,
          metadata: { sessionId: sessionID },
        }
        await this.store.appendObservation(state.projectId, state.runId, entry)
        this.logger?.debug('recorded %s for round %d (pipeline %s/%s)', OBS_TYPE_REVIEWER_SPAWNED, round, state.projectId, state.runId)
        await this.scanTaskPrompt(tool, args, state, round, callID, sessionID)
        return
      }

      if (!state) {
        if (this.cache.hadFailedLoad) {
          this.logger?.warn('Observer: cache load previously failed — observation recorded to session buffer only')
        }
        this.sessionBuffer.record(sessionID, { tool, callID, timestamp: new Date().toISOString() })
        return
      }

      // Path 3: Active pipeline, not ralph_loop — Phase 1 observation
      const { projectId, runId, currentPhase: phase } = state

      // ADR-012: auto-resolve runs OUTSIDE Promise.race
      try {
        this.autoResolve(tool, args, state, sessionID)
      } catch (e) {
        this.logger?.warn('Observer auto-resolve failed (suppressed): %s', String(e))
      }

      let timeoutId: ReturnType<typeof setTimeout>
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => reject(new ObserverTimeoutError('observer timed out')), OBSERVER_TIMEOUT_MS)
      })
      try {
        await Promise.race([
          this._handleObservations(tool, args, output, sessionID, callID, state),
          timeoutPromise,
        ])
      } catch (e) {
        if (e instanceof ObserverTimeoutError) {
          this._timedOut = true
          const s = this.cache.get()
          if (!s) return
          const timeoutCount = (s.observerTimeoutCount ?? 0) + 1
          s.observerTimeoutCount = timeoutCount
          const isDegraded = timeoutCount >= TIMEOUT_DEGRADE_THRESHOLD

          this.store.appendAudit(s.projectId, s.runId, {
            timestamp: new Date().toISOString(),
            runId: s.runId, projectId: s.projectId, sessionId: sessionID,
            event: 'OBSERVER_TIMEOUT', phase: s.currentPhase,
            decision: isDegraded ? 'WARN' : 'BLOCK',
            severity: isDegraded ? 'warn' : 'block',
            violation: `Observer handle() timeout (>${OBSERVER_TIMEOUT_MS}ms)`,
          })

          if (isDegraded) {
            this.store.appendAudit(s.projectId, s.runId, {
              timestamp: new Date().toISOString(),
              runId: s.runId, projectId: s.projectId, sessionId: sessionID,
              event: 'OBSERVER_TIMEOUT_DEGRADED', phase: s.currentPhase,
              decision: 'WARN', severity: 'warn',
              violation: `Observer consecutive ${timeoutCount} timeouts, degraded to warn`,
            })
          }
          return
        }
        throw e
      } finally {
        clearTimeout(timeoutId!)
      }
    } catch (err) {
      this.logger?.warn('Observer error (suppressed): %s', String(err))
      await this.handleDegradation(tool, callID, sessionID, err)
    }
  }

  private autoResolve(tool: string, args: unknown, state: PipelineState, sessionID: string): void {
    if (!this.store.getUnresolvedViolations || !this.store.resolveViolations) return
    const { projectId, runId } = state
    const arArgs = args as Record<string, unknown>

    if (tool === 'Bash' && typeof arArgs.command === 'string') {
      const cmd = normalizeCommand(arArgs.command as string)
      this.resolveMatching(projectId, runId, state, sessionID,
        { tool: 'Bash', commandPattern: cmd },
        v => v.command === cmd, { tool: 'Bash', command: cmd })
    }

    if (tool === 'Write' && typeof arArgs.filePath === 'string') {
      const fp = arArgs.filePath as string
      this.resolveMatching(projectId, runId, state, sessionID,
        { tool: 'Write', filePath: fp },
        v => v.filePath === fp, { tool: 'Write', filePath: fp })
    }

    const hadTimeouts = this.resolveMatching(projectId, runId, state, sessionID,
      { event: 'OBSERVER_TIMEOUT' }, v => v.event === 'OBSERVER_TIMEOUT', {})
    if (hadTimeouts) state.observerTimeoutCount = 0
  }

  private resolveMatching(
    projectId: string, runId: string, state: PipelineState, sessionID: string,
    filter: Record<string, unknown>,
    matcher: (v: Record<string, unknown>) => boolean,
    auditExtra: Record<string, unknown>,
  ): boolean {
    const violations = this.store.getUnresolvedViolations!(projectId, runId, 'block', filter)
    const matching = violations.filter(matcher)
    if (matching.length > 100) {
      this.store.appendAudit(projectId, runId, {
        timestamp: new Date().toISOString(), runId, projectId, sessionId: sessionID,
        event: 'RESOLVE_SKIPPED_TOO_MANY', phase: state.currentPhase, decision: 'WARN', severity: 'warn',
        ...auditExtra,
      })
      return false
    } else if (matching.length > 0) {
      this.store.resolveViolations!(projectId, runId, matching.map(v => v.timestamp))
      return true
    }
    return false
  }

  private async _handleObservations(
    tool: string,
    args: unknown,
    output: unknown,
    sessionID: string,
    callID: string,
    state: PipelineState,
  ): Promise<void> {
    if (!args || typeof args !== 'object') return
    const a = args as Record<string, unknown>
    const { projectId, runId, currentPhase: phase } = state

    if (tool === 'Bash') {
      if (typeof a.command !== 'string') return
      const normalizedCmd = normalizeCommand(a.command as string)
      if (typeof output !== 'string') return
      const exitCode = extractExitCode(output)
      if (exitCode !== 0) {
        const config = this.ruleConfigLoader?.load('COMMAND_RESULT_CHECK') ?? { enabled: true, severity: 'block' as const, ignoreExitCodes: [], ignoreCommands: [] }
        if (config.enabled && !config.ignoreExitCodes?.includes(exitCode)
            && !config.ignoreCommands?.some(pat => matchPattern(normalizedCmd, pat))) {
          if (this._timedOut) return
          this.store.appendAudit(projectId, runId, {
            timestamp: new Date().toISOString(),
            runId, projectId, sessionId: sessionID,
            event: 'COMMAND_FAILED', phase,
            decision: config.severity === 'block' ? 'BLOCK' : 'WARN',
            severity: config.severity,
            violation: `Command exit code ${exitCode}: ${normalizedCmd}`,
            command: normalizedCmd, tool: 'Bash', resolved: false,
          })
        }
      }
    } else if (tool === 'Write') {
      if (typeof a.filePath !== 'string') return
      const filePath = a.filePath as string
      const content = (typeof a.content === 'string' ? a.content : typeof output === 'string' ? output : '') as string
      if (!content) return

      const config = this.ruleConfigLoader?.load('SYNTAX_CHECK_POST_WRITE') ?? { enabled: true, severity: 'block' as const, extensions: ['.json', '.yaml', '.yml'] }
      if (!config.enabled) return

      if (content.length > 100 * 1024) {
        if (this._timedOut) return
        this.store.appendAudit(projectId, runId, {
          timestamp: new Date().toISOString(),
          runId, projectId, sessionId: sessionID,
          event: 'FILE_TOO_LARGE_FOR_CHECK', phase,
          decision: 'WARN', severity: 'warn',
          violation: `File ${filePath} exceeds 100KB limit, skipping syntax check`,
          tool: 'Write', filePath,
        })
        return
      }

      if (!content.trim()) return

      const extensions = config.extensions?.length ? config.extensions : ['.json', '.yaml', '.yml']
      const extMatch = extensions.some(ext => filePath.endsWith(ext))
      if (!extMatch) return

      if (filePath.endsWith('.json')) {
        const result = quickSyntaxCheck(content)
        if (!result.ok) {
          if (this._timedOut) return
          this.store.appendAudit(projectId, runId, {
            timestamp: new Date().toISOString(),
            runId, projectId, sessionId: sessionID,
            event: 'SYNTAX_ERROR_POST_WRITE', phase,
            decision: 'BLOCK', severity: 'block',
            violation: `JSON syntax error: ${result.error}`,
            tool: 'Write', filePath, resolved: false,
          })
        }
      }

      if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
        const result = yamlSyntaxCheck(content)
        if (!result.ok) {
          if (this._timedOut) return
          this.store.appendAudit(projectId, runId, {
            timestamp: new Date().toISOString(),
            runId, projectId, sessionId: sessionID,
            event: 'SYNTAX_ERROR_POST_WRITE', phase,
            decision: 'BLOCK', severity: 'block',
            violation: `YAML syntax error: ${result.error ?? 'unknown'}`,
            tool: 'Write', filePath, resolved: false,
          })
        }
      }
    }
  }

  private async handleDegradation(
    tool: string,
    callID: string,
    sessionID: string,
    originalError: unknown,
  ): Promise<void> {
    try {
      const state = this.cache.get()
      if (state) {
        const key = `${state.projectId}/${state.runId}`
        const degradedRound = state.phaseStatus === 'ralph_loop'
          ? (state.ralph?.round ?? 0) + 1
          : undefined

        if (degradedRound !== undefined) {
          this.logger?.debug('observer degraded for pipeline', { key, round: degradedRound, error: originalError instanceof Error ? originalError.message : String(originalError) })
          let rounds = this.degradedRounds.get(key)
          if (!rounds) {
            rounds = new Set()
            this.degradedRounds.set(key, rounds)
          }
          rounds.add(degradedRound)
        } else {
          this.degradedRuns.add(key)
        }

        const errorMessage = originalError instanceof Error ? originalError.message : String(originalError)
        await this.store.appendObservation(state.projectId, state.runId, {
          timestamp: new Date().toISOString(),
          type: OBS_TYPE_OBSERVER_DEGRADED, tool, callID,
          round: degradedRound,
          metadata: { error: errorMessage, sessionId: sessionID },
        })
      }
    } catch {
      try {
        const state = this.cache.get()
        if (state) {
          this.handlerFailedPipelines.add(`${state.projectId}/${state.runId}`)
          this.logger?.error('Observer handleDegradation failed for pipeline %s/%s', state.projectId, state.runId)
        } else {
          this.logger?.error('Observer handleDegradation failed — no state available, cannot mark pipeline')
        }
      } catch {
        this.logger?.error('Observer handleDegradation double-fault')
      }
    }
  }
}
