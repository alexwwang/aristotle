/**
 * Observer — observes tool execution via onToolAfter hook.
 * Design: Phase2-ActiveMonitoring.md §6.2
 */
import type { PipelineStateCache } from './state-cache.js'
import type { SessionBuffer } from './session-buffer.js'
import { OBS_TYPE_REVIEWER_SPAWNED, OBS_TYPE_OBSERVER_DEGRADED } from './schema.js'

export class Observer {
  private cache: PipelineStateCache
  private sessionBuffer: SessionBuffer
  private store: any

  /**
   * Tracks rounds where observer failed — AC-2 should not enforce violations
   * for these rounds because observations may be incomplete.
   * Key: `${projectId}/${runId}`, Value: set of degraded round numbers.
   */
  private degradedRounds = new Map<string, Set<number>>()

  /** Tracks runs where observer failed outside round context. */
  private degradedRuns = new Set<string>()

  constructor(cache: PipelineStateCache, sessionBuffer: SessionBuffer, store: any) {
    this.cache = cache
    this.sessionBuffer = sessionBuffer
    this.store = store
  }

  /**
   * Check if observations for a given pipeline may be incomplete.
   * If round is provided, checks that specific round.
   * If round is omitted, returns true if any round (or the run itself) is degraded.
   */
  isDegraded(projectId: string, runId: string, round?: number): boolean {
    const key = `${projectId}/${runId}`
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
  }

  /**
   * onToolAfter handler — called for EVERY tool execution.
   */
  async handle(
    tool: string,
    args: any,
    output: string,
    sessionID: string,
    callID: string,
  ): Promise<void> {
    try {
      // Only process Task tool calls
      if (tool !== 'Task') {
        return
      }

      const state = await this.cache.get()

      if (state && state.phaseStatus === 'ralph_loop') {
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
        return
      }

      if (!state) {
        // Path 2: No active pipeline — session buffer
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
      const state = await this.cache.get()
      if (state) {
        const key = `${state.projectId}/${state.runId}`
        const degradedRound = state.phaseStatus === 'ralph_loop'
          ? (state.ralph?.round ?? 0) + 1
          : undefined

        // Channel 1: in-memory flag (hot path)
        if (degradedRound !== undefined) {
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
      // Degradation tracking itself failed — nothing more we can do.
    }
  }
}
