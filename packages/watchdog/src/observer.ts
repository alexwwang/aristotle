/**
 * Observer — observes tool execution via onToolAfter hook.
 * Design: Phase2-ActiveMonitoring.md §6.2
 */
import type { PipelineStateCache } from './state-cache.js'
import type { SessionBuffer } from './session-buffer.js'
import type { PipelineStore } from './pipeline-store.js'
import type { Logger } from '@opencode-ai/core/logger'
import { OBS_TYPE_REVIEWER_SPAWNED, OBS_TYPE_OBSERVER_DEGRADED } from './schema.js'

export class Observer {
  private cache: PipelineStateCache
  private sessionBuffer: SessionBuffer
  private store: PipelineStore
  private logger?: Logger

  /**
   * Tracks rounds where observer failed — AC-2 should not enforce violations
   * for these rounds because observations may be incomplete.
   * Key: `${projectId}/${runId}`, Value: set of degraded round numbers.
   */
  private degradedRounds = new Map<string, Set<number>>()

  /** Tracks runs where observer failed outside round context. */
  private degradedRuns = new Set<string>()

  /**
   * Tracks pipelines where handleDegradation itself failed.
   * Key: `${projectId}/${runId}`. When set, isDegraded() returns true for that pipeline.
   * This ensures AC-2 is skipped defensively only for the affected pipeline,
   * not globally across all projects.
   */
  private handlerFailedPipelines = new Set<string>()

  constructor(cache: PipelineStateCache, sessionBuffer: SessionBuffer, store: PipelineStore, logger?: Logger) {
    this.cache = cache
    this.sessionBuffer = sessionBuffer
    this.store = store
    this.logger = logger
  }

  /**
   * Check if observations for a given pipeline may be incomplete.
   * If round is provided, checks that specific round.
   * If round is omitted, returns true if any round (or the run itself) is degraded.
   */
  isDegraded(projectId: string, runId: string, round?: number): boolean {
    const key = `${projectId}/${runId}`
    // L3 fix: if handleDegradation failed for this pipeline, treat as degraded
    if (this.handlerFailedPipelines.has(key)) return true
    if (this.degradedRuns.has(key)) return true
    const rounds = this.degradedRounds.get(key)
    if (round === undefined) {
      return rounds !== undefined && rounds.size > 0
    }
    return rounds?.has(round) ?? false
  }

  /** Clear degradation data for a completed pipeline run. */
  clearDegradation(projectId: string, runId: string): void {
    const key = `${projectId}/${runId}`
    this.degradedRounds.delete(key)
    this.degradedRuns.delete(key)
    this.handlerFailedPipelines.delete(key)
  }

  /**
   * onToolAfter handler — called for EVERY tool execution.
   */
  async handle(
    tool: string,
    args: unknown,
    output: unknown,
    sessionID: string,
    callID: string,
  ): Promise<void> {
    try {
      // AC-10: Record ALL tool calls when no pipeline exists (SessionBuffer)
      // Path 1 (ralph_loop observation) only applies to Task tool
      const state = this.cache.get()

      if (state && state.phaseStatus === 'ralph_loop' && tool === 'Task') {
        // Path 1: Active pipeline in ralph_loop — structured observation
        const round = (state.ralph?.round ?? 0) + 1
        const entry = {
          timestamp: new Date().toISOString(),
          type: OBS_TYPE_REVIEWER_SPAWNED,
          tool,
          callID,
          round,
          metadata: { sessionId: sessionID },
        }
        await this.store.appendObservation(state.projectId, state.runId, entry)
        this.logger?.debug('recorded %s for round %d (pipeline %s/%s)', OBS_TYPE_REVIEWER_SPAWNED, round, state.projectId, state.runId)
        return
      }

      if (!state) {
        // Path 2: No active pipeline — session buffer
        if (this.cache.hadFailedLoad) {
          this.logger?.warn('Observer: cache load previously failed — observation recorded to session buffer only')
        }
        this.sessionBuffer.record(sessionID, {
          tool,
          callID,
          timestamp: new Date().toISOString(),
        })
        return
      }

      // Path 3: Active pipeline but not ralph_loop → no-op
      return
    } catch (err) {
      // Spec §6.2: log original error before degradation handling
      this.logger?.warn('Observer error (suppressed): %s', String(err))
      // Dual-channel degradation recovery
      await this.handleDegradation(tool, callID, sessionID, err)
    }
  }

  /** Handle degradation when observer encounters an error. */
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

        // Channel 1: in-memory flag (hot path)
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

        // Channel 2: persisted degradation event (cold path)
        const errorMessage = originalError instanceof Error ? originalError.message : String(originalError)
        await this.store.appendObservation(state.projectId, state.runId, {
          timestamp: new Date().toISOString(),
          type: OBS_TYPE_OBSERVER_DEGRADED,
          tool,
          callID,
          round: degradedRound,
          metadata: { error: errorMessage, sessionId: sessionID },
        })
      }
    } catch {
      // L3 fix: handleDegradation itself failed — mark the current pipeline.
      // If cache.get() also fails here, we mark the last-known pipeline as degraded.
      // Scoped per-pipeline to avoid disabling AC-2 for unrelated projects.
      try {
        const state = this.cache.get()
        if (state) {
          this.handlerFailedPipelines.add(`${state.projectId}/${state.runId}`)
          this.logger?.error('Observer handleDegradation failed for pipeline %s/%s', state.projectId, state.runId)
        } else {
          // No state available — cannot determine which pipeline to mark
          this.logger?.error('Observer handleDegradation failed — no state available, cannot mark pipeline')
        }
      } catch {
        // Double-fault: even cache.get() failed. Nothing we can do.
        this.logger?.error('Observer handleDegradation double-fault')
      }
    }
  }
}
