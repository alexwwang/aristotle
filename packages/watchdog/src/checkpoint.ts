/**
 * CheckpointHandler — orchestrates tdd_checkpoint tool calls.
 *
 * Design: Phase1-Watchdog-StateMachine.md §2.2 + §4
 *
 * Flow (§2.2 checkpoint.ts):
 * 1. Resolve projectId from context.worktree
 * 2. Find active run (or null for pipeline_start)
 * 3. If stale run AND event != 'pipeline_start' → return recovery prompt
 * 4. Read current state (or null)
 * 5. Validate transition
 * 6. If invalid → audit BLOCK + return violation
 * 7. Apply transition → write state → audit PASS + return ok
 * 8. If event is phase_complete(5) → clearActiveRun + archiveRun
 */
import { randomUUID } from 'node:crypto'
import type { PipelineStore } from './pipeline-store.js'
import type {
  CheckpointResult,
  CheckpointOk,
  CheckpointViolation,
  CheckpointRecovery,
  CheckpointEvent,
  PipelineState,
  PipelineStateSummary,
  AuditLogEntry,
} from './schema.js'
import { hasOwner } from './schema.js'
import { validateTransition, applyTransition, NO_ACTIVE_RUN } from './transitions.js'
import { computeProjectId } from './project-id.js'
import { validateArticulation } from './articulation.js'
import { ARTICULATION_MAX_FAILURES } from './constants.js'
import type { PipelineStateCache } from './state-cache.js'
import type { Observer } from './observer.js'

export class CheckpointHandler {
  private articulationFailures = new Map<number, number>()

  constructor(
    private store: PipelineStore,
    private staleThresholdMs: number,
    private cache?: PipelineStateCache,
    private observer?: Observer,
  ) {}

  async handle(
    event: CheckpointEvent,
    payloadJson: string,
    context: { worktree: string; sessionID: string },
  ): Promise<string> {
    const projectId = computeProjectId(context.worktree)
    const sessionId = context.sessionID
    const now = new Date().toISOString()

    // ── 1. Parse payload ──────────────────────────────────────────────
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(payloadJson)
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new Error('not an object')
      }
    } catch {
      return JSON.stringify({
        ok: false,
        violation: 'Invalid JSON payload',
        guidance: 'The payload must be a valid JSON object.',
      } satisfies CheckpointViolation)
    }

    // ── 2. Find active run ────────────────────────────────────────────
    const activeRun = this.store.getActiveRun(projectId)

    // ── 3. Read current state (M6: read once, reuse for stale + validation)
    const currentState: PipelineState | null =
      activeRun ? (this.store.readState(projectId, activeRun.runId) ?? null) : null

    // ── 4. Ownership check (§5.5a Layer 2+3 defense — MUST run before stale check) ──
    //    Non-owner sessions must never see recovery prompts or advance state.
    if (event !== 'pipeline_start' && activeRun && hasOwner(currentState)) {
      if (currentState.ownerSessionId !== sessionId) {
        const entry: AuditLogEntry = {
          timestamp: now,
          runId: activeRun.runId,
          projectId,
          sessionId,
          event,
          phase: currentState.currentPhase,
          decision: 'BLOCK',
          violation: `owner_mismatch: session ${sessionId} vs owner ${currentState.ownerSessionId}`,
        }
        this.store.appendAudit(projectId, activeRun.runId, entry)
        return JSON.stringify({
          ok: false,
          violation: 'Checkpoint rejected: this pipeline belongs to another session.',
          guidance: 'Sub-agents cannot advance pipeline state. Complete your assigned task and report results to the orchestrator. Do NOT attempt to create a new pipeline or retry this call.',
        } satisfies CheckpointViolation)
      }
    }

    // ── 5. Stale check (§4.3, §7.2) ───────────────────────────────────
    //    H-5: pipeline_start bypasses stale check (escape hatch)
    if (activeRun && event !== 'pipeline_start') {
      if (currentState && isStale(currentState.lastCheckpointAt, this.staleThresholdMs)) {
        const summary = summarizeState(currentState)
        const elapsed = formatElapsed(Date.now() - new Date(currentState.lastCheckpointAt).getTime())
        return JSON.stringify({
          ok: false,
          recovery: true,
          staleState: summary,
          message: `Found stale pipeline run from ${elapsed} ago. Last activity: Phase ${summary.phase} ${formatPhaseStatus(summary.phaseStatus)}${summary.ralphRound ? ` round ${summary.ralphRound}` : ''}. Options: (1) continue from where you left off — call phase_enter or ralph_round_complete as appropriate, (2) start fresh — call pipeline_start to archive this run and begin a new one.`,
        } satisfies CheckpointRecovery)
      }
    }

    // ── 5. Reset articulation counters ────────────────────────────────
    if (event === 'phase_enter' && typeof payload.phase === 'number') {
      this.articulationFailures.delete(payload.phase)
    }
    if (event === 'pipeline_start') {
      this.articulationFailures.clear()
    }

    // ── 6. Inject metadata into payload ───────────────────────────────
    if (event === 'pipeline_start') {
      // M-4: reject empty sessionID
      if (!sessionId) {
        return JSON.stringify({
          ok: false,
          violation: 'Session ID is empty — cannot create pipeline without a valid session.',
          guidance: 'Ensure the session context provides a valid sessionID.',
        })
      }
      // C-2: single-pipeline constraint
      //      Non-stale: reject unconditionally. Stale: only owner may restart.
      //      Corrupted/missing state: fail-closed — reject (cannot verify ownership).
      if (activeRun && currentState) {
        if (!isStale(currentState.lastCheckpointAt, this.staleThresholdMs)) {
          // Non-stale active pipeline — reject any new pipeline_start
          return JSON.stringify({
            ok: false,
            violation: 'A pipeline is already active for this project.',
            guidance: 'Only one pipeline per project is allowed. Complete or cancel the current pipeline first.',
          })
        }
        // Stale pipeline — only the owner may restart
        if (hasOwner(currentState) && currentState.ownerSessionId !== sessionId) {
          return JSON.stringify({
            ok: false,
            violation: 'A stale pipeline exists but belongs to another session.',
            guidance: 'Only the orchestrator can restart a stale pipeline. Sub-agents cannot create new pipelines.',
          })
        }
      }
      if (activeRun && !currentState) {
        // Corrupted state: active run exists but state file missing/unreadable.
        // Fail-closed: cannot verify ownership, so reject pipeline_start.
        return JSON.stringify({
          ok: false,
          violation: 'An active pipeline run exists but its state is missing or corrupted. Cannot verify ownership.',
          guidance: 'Remove the stale run metadata manually, or investigate the state storage.',
        })
      }
      payload._runId = randomUUID()
      payload._projectId = projectId
      // C-1: inject ownerSessionId
      payload._ownerSessionId = sessionId
    }
    payload._now = now

    // ── 8. Validate transition ────────────────────────────────────────
    const validation = validateTransition(event, payload, currentState)

    if (!validation.valid) {
      // M1: When activeRun exists but state file is missing/corrupted, give specific message
      if (activeRun && currentState === null && validation.violation === NO_ACTIVE_RUN) {
        // Audit BLOCK for corrupted-state detection
        const entry: AuditLogEntry = {
          timestamp: now,
          runId: activeRun.runId,
          projectId,
          sessionId,
          event,
          phase: 0,
          decision: 'BLOCK',
          violation: `Pipeline state file missing or corrupted for run ${activeRun.runId}.`,
        }
        this.store.appendAudit(projectId, activeRun.runId, entry)

        return JSON.stringify({
          ok: false,
          violation: `Pipeline state file missing or corrupted for run ${activeRun.runId}.`,
          guidance: 'Start a fresh pipeline with pipeline_start to begin a new run. The previous run index entry will be overwritten.',
        } satisfies CheckpointViolation)
      }

      // Audit BLOCK
      if (activeRun) {
        const entry: AuditLogEntry = {
          timestamp: now,
          runId: activeRun.runId,
          projectId,
          sessionId,
          event,
          phase: (payload.phase as number) ?? currentState?.currentPhase ?? 0,
          decision: 'BLOCK',
          violation: validation.violation,
        }
        this.store.appendAudit(projectId, activeRun.runId, entry)
      }

      return JSON.stringify({
        ok: false,
        violation: validation.violation,
        guidance: validation.guidance,
      } satisfies CheckpointViolation)
    }

    // ── 9. Articulation validation (Phase 2) ──────────────────────────
    let articulationViolated = false
    let articulationResult: ReturnType<typeof validateArticulation> | null = null

    if (event === 'why_articulation') {
      const text = payload.articulation as string
      articulationResult = validateArticulation(text)
      const phase = payload.phase as number

      if (articulationResult.verified) {
        this.articulationFailures.delete(phase)
        payload._articulationVerified = true
        payload._articulationDimensions = articulationResult.dimensions
      } else {
        const failures = this.getFailureCount(phase, currentState) + 1
        this.articulationFailures.set(phase, failures)
        if (failures >= ARTICULATION_MAX_FAILURES) {
          payload._articulationDegraded = true
        }
        articulationViolated = true
      }
    }

    // ── 10. AC-2 enforcement on ralph_round_complete (Phase 2) ────────
    if (event === 'ralph_round_complete' && activeRun && this.observer) {
      const round = payload.round as number
      const skipAC2 = this.observer.isDegraded(projectId, activeRun.runId, round)
      if (!skipAC2) {
        const observations = await this.store.findObservations(projectId, activeRun.runId, { type: '_reviewer_spawned', round })
        if (!observations || observations.length === 0) {
          const entry: AuditLogEntry = {
            timestamp: now,
            runId: activeRun.runId,
            projectId,
            sessionId,
            event,
            phase: currentState?.currentPhase ?? 0,
            round,
            decision: 'BLOCK',
            violation: `Round ${round} completed without a reviewer subagent observation.`,
          }
          this.store.appendAudit(projectId, activeRun.runId, entry)
          return JSON.stringify({
            ok: false,
            violation: `Round ${round} completed without a reviewer subagent observation.`,
            guidance: 'Each Ralph round must spawn at least one reviewer subagent. Ensure the Task tool is called during the round.',
          } satisfies CheckpointViolation)
        }
      }
    }

    // ── 11. Apply transition (M3: defensive try/catch) ─────────────────
    let newState: PipelineState
    try {
      newState = applyTransition(event, payload, currentState)
    } catch (err) {
      return JSON.stringify({
        ok: false,
        violation: `Internal state error: ${String(err)}`,
        guidance: 'This is an unexpected error. Start a fresh pipeline with pipeline_start.',
      } satisfies CheckpointViolation)
    }
    const runId = newState.runId

    // Write state FIRST (M10: before setActiveRun to avoid partial-write window)
    this.store.writeState(projectId, runId, newState)
    this.cache?.update(newState)

    // For pipeline_start: register active run AFTER state is persisted
    if (event === 'pipeline_start') {
      this.store.setActiveRun(projectId, {
        runId,
        projectId,
        startedAt: now,
      })
    }

    // Audit — PASS unless articulation was violated
    const auditEntry: AuditLogEntry = {
      timestamp: now,
      runId,
      projectId,
      sessionId,
      event,
      phase: newState.currentPhase,
      decision: 'PASS',
    }
    if (articulationViolated) {
      auditEntry.violation = `Articulation incomplete: ${articulationResult?.missingDimension ?? 'unknown'} missing.`
    }
    if (payload.round !== undefined) {
      auditEntry.round = payload.round as number
    }
    this.store.appendAudit(projectId, runId, auditEntry)

    // ── 12. phase_complete(5) → clearActiveRun + archiveRun ───────────
    if (event === 'phase_complete' && payload.phase === 5) {
      this.store.clearActiveRun(projectId)
      this.store.archiveRun(projectId, runId)
      this.cache?.clear()
      this.observer?.clearDegradation(projectId, runId)
    }

    // ── 13. Articulation violation return ─────────────────────────────
    if (articulationViolated) {
      const missing = articulationResult!.missingDimension ?? 'unknown'
      const failures = this.articulationFailures.get(payload.phase as number) ?? 1
      if (failures >= ARTICULATION_MAX_FAILURES) {
        return JSON.stringify({
          ok: false,
          violation: `Articulation incomplete: ${missing} missing. This phase has been escalated to Ralph review.`,
          guidance: `Your articulation must cover all three dimensions: what_it_protects, key_risks, why_approach_works. This phase has had ${failures} consecutive failures and is now degraded.`,
        } satisfies CheckpointViolation)
      }
      return JSON.stringify({
        ok: false,
        violation: `Articulation incomplete: ${missing} missing.`,
        guidance: `Your articulation must cover all three dimensions: what_it_protects, key_risks, why_approach_works. Missing: ${missing}.`,
      } satisfies CheckpointViolation)
    }

    return JSON.stringify({
      ok: true,
      state: summarizeState(newState),
    } satisfies CheckpointOk)
  }

  private getFailureCount(phase: number, currentState: PipelineState | null): number {
    let count = this.articulationFailures.get(phase)
    if (count === undefined) {
      const phaseRec = currentState?.phases?.[phase] as { articulationAttempted?: boolean; articulationVerified?: boolean } | undefined
      if (phaseRec?.articulationAttempted && !phaseRec?.articulationVerified) {
        count = 1
      } else {
        count = 0
      }
      this.articulationFailures.set(phase, count)
    }
    return count
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isStale(lastCheckpointAt: string, thresholdMs: number): boolean {
  const elapsed = Date.now() - new Date(lastCheckpointAt).getTime()
  return elapsed > thresholdMs
}

function summarizeState(state: PipelineState): PipelineStateSummary {
  return {
    phase: state.currentPhase,
    phaseStatus: state.phaseStatus,
    ralphRound: state.ralph?.round ?? null,
    runId: state.runId,
  }
}

function formatElapsed(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  return `${minutes}m`
}

function formatPhaseStatus(status: string): string {
  const map: Record<string, string> = {
    idle: 'idle',
    active: 'active',
    ralph_loop: 'Ralph loop',
    awaiting_approval: 'awaiting approval',
    complete: 'complete',
  }
  return map[status] ?? status
}
