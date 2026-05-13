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
import { validateTransition, applyTransition } from './transitions.js'
import { computeProjectId } from './project-id.js'

export class CheckpointHandler {
  constructor(
    private store: PipelineStore,
    private staleThresholdMs: number,
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

    // ── 4. Stale check (§4.3, §7.2) ───────────────────────────────────
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

    // ── 5. Inject metadata into payload ───────────────────────────────
    if (event === 'pipeline_start') {
      payload._runId = randomUUID()
      payload._projectId = projectId
    }
    payload._now = now

    // ── 6. Validate transition ────────────────────────────────────────
    const validation = validateTransition(event, payload, currentState)

    if (!validation.valid) {
      // M1: When activeRun exists but state file is missing/corrupted, give specific message
      if (activeRun && currentState === null && validation.violation === 'No active pipeline run for this project.') {
        return JSON.stringify({
          ok: false,
          violation: `Pipeline state file missing or corrupted for run ${activeRun.runId}.`,
          guidance: 'Start a fresh pipeline with pipeline_start to archive the broken run.',
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

    // ── 7. Apply transition (M3: defensive try/catch) ──────────────────
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

    // For pipeline_start: register active run AFTER state is persisted
    if (event === 'pipeline_start') {
      this.store.setActiveRun(projectId, {
        runId,
        projectId,
        startedAt: now,
      })
    }

    // Audit PASS
    const auditEntry: AuditLogEntry = {
      timestamp: now,
      runId,
      projectId,
      sessionId,
      event,
      phase: newState.currentPhase,
      decision: 'PASS',
    }
    if (payload.round !== undefined) {
      auditEntry.round = payload.round as number
    }
    this.store.appendAudit(projectId, runId, auditEntry)

    // ── 8. phase_complete(5) → clearActiveRun + archiveRun ────────────
    if (event === 'phase_complete' && payload.phase === 5) {
      this.store.clearActiveRun(projectId)
      this.store.archiveRun(projectId, runId)
    }

    return JSON.stringify({
      ok: true,
      state: summarizeState(newState),
    } satisfies CheckpointOk)
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
