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
 * 8. If event is phase_complete(finalPhase) → clearActiveRun + archiveRun
 */
import { randomUUID } from 'node:crypto'
import type { PipelineStore } from './pipeline-store.js'

type Phase1Store = PipelineStore & {
  getUnresolvedViolations?: (projectId: string, runId: string, severity?: string, filter?: Record<string, unknown>) => Array<{ violation: string; severity: string; resolved: boolean; timestamp: string }>
  resolveViolations?: (projectId: string, runId: string, timestamps: string[]) => void
}

/**
 * Normalize severity strings from TDD protocol notation to wire format.
 * Maps: M₁→M, M₂→P (Unicode subscripts) and M1→M, M2→P (ASCII fallback).
 * Applied to both severity and original fields in ralph_round_finding.
 */
export function normalizeSeverities(event: string, payload: Record<string, unknown>): void {
  if (event !== 'ralph_round_finding') return
  const findings = payload.findings as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(findings)) return
  const map: Record<string, string> = {
    '\u004D\u2081': 'M', '\u004D\u2082': 'P', // M₁→M, M₂→P (Unicode)
    'M1': 'M', 'M2': 'P',                     // ASCII fallback
  }
  for (const f of findings) {
    if (f && typeof f === 'object') {
      if (typeof f.severity === 'string' && map[f.severity]) f.severity = map[f.severity]
      if (typeof f.original === 'string' && map[f.original]) f.original = map[f.original]
    }
  }
}
import type {
  CheckpointResult,
  CheckpointOk,
  CheckpointViolation,
  CheckpointRecovery,
  CheckpointEvent,
  PipelineState,
  PipelineStateSummary,
  AuditLogEntry,
  PhaseRecord,
  ActiveRun,
} from './schema.js'
import { hasOwner } from './schema.js'
import { validateTransition, applyTransition, NO_ACTIVE_RUN } from './transitions.js'
import { OBS_TYPE_REVIEWER_SPAWNED } from './schema.js'
import { computeProjectId } from './project-id.js'
import { validateArticulation } from './articulation.js'
import { ARTICULATION_MAX_FAILURES, MAX_RALPH_ROUNDS, BUSINESS_CODE_PHASE } from './constants.js'
import type { PipelineStateCache } from './state-cache.js'
import type { Observer } from './observer.js'
import type { Logger } from '@opencode-ai/core/logger'
import type { LoopConfigResult } from './loop-config.js'
import { callIntervention, type InterventionBatchPayload, type InterventionBatchResult } from './intervention-bridge.js'

export class CheckpointHandler {
  private articulationFailures = new Map<number, number>()
  private readonly _applyTransition: typeof applyTransition
  private _pnRateLimit = new Map<string, number[]>()
  private static readonly PN_RATE_WINDOW_MS = 5000
  private static readonly PN_RATE_MAX_IN_WINDOW = 10

  constructor(
    private store: PipelineStore,
    private staleThresholdMs: number,
    private loopConfig?: LoopConfigResult,
    private cache?: PipelineStateCache,
    private observer?: Observer,
    private logger?: Logger,
    private mcpProjectDir?: string,
    transitionFn?: typeof applyTransition,
  ) {
    this._applyTransition = transitionFn ?? applyTransition
  }

  /**
   * Process a checkpoint event. async for framework contract
   * (ToolDefinition.execute returns Promise<string>) and future
   * StateStore async migration. Internal operations are currently sync.
   */
  async handle(
    event: CheckpointEvent | 'TEST_RUN_COMPLETE',
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

      // ── 1a. TEST_RUN_COMPLETE — audit-only event (Phase 2, AC-4) ─────────
    // Note (F-01): Checkpoint-domain audit entries intentionally omit severity when
    // the event is informational (no violation). Only Observer-domain entries always
    // set severity. Consumers should treat missing severity as "no issue" (informational).
    if (event === 'TEST_RUN_COMPLETE') {
      const testResult = payload.test_result as Record<string, unknown> | undefined
      if (!testResult || typeof testResult !== 'object') {
        return JSON.stringify({
          ok: false,
          violation: 'test_result is required when event=TEST_RUN_COMPLETE',
          guidance: 'Provide test_result with pass, fail, and optional error_summary fields.',
        })
      }
      const pass = testResult.pass
      const fail = testResult.fail
      if (typeof pass !== 'number' || typeof fail !== 'number' ||
          !Number.isInteger(pass) || !Number.isInteger(fail) ||
          !Number.isFinite(pass) || !Number.isFinite(fail) ||
          pass < 0 || fail < 0) {
        return JSON.stringify({
          ok: false,
          violation: 'test_result.pass and test_result.fail must be non-negative integers',
          guidance: 'Both pass and fail must be non-negative finite integers.',
        })
      }
      const trState = this.cache?.get()
      if (!trState) {
        return JSON.stringify({
          ok: false,
          violation: 'No active pipeline state',
          guidance: 'Cannot submit test results without an active pipeline.',
        })
      }
      const trRun = this.store.getActiveRun(trState.projectId)
      if (!trRun) {
        return JSON.stringify({
          ok: false,
          violation: 'No active run',
          guidance: 'Cannot submit test results without an active run.',
        })
      }
      const trSeverity: 'warn' | undefined = (pass + fail === 0 || fail > 0) ? 'warn' : undefined
      this.store.appendAudit(trRun.projectId, trRun.runId, {
        timestamp: now,
        runId: trRun.runId,
        projectId: trRun.projectId,
        sessionId,
        event: 'TEST_RUN_COMPLETE',
        phase: trState.currentPhase,
        decision: 'PASS',
        severity: trSeverity,
        pass,
        fail,
        error_summary: (testResult.error_summary as string) ?? '',
      })
      return JSON.stringify({ ok: true, state: summarizeState(trState) } satisfies CheckpointOk)
    }

    // ── 2. Find active run ────────────────────────────────────────────
    const activeRun = this.store.getActiveRun(projectId)

    // ── 3. Read current state (M6: read once, reuse for stale + validation)
    const currentState: PipelineState | null =
      activeRun ? (this.store.readState(projectId, activeRun.runId) ?? null) : null

    // ── 4. Ownership check (§5.5a Layer 2+3 defense — MUST run before stale check) ──
    //    Non-owner sessions must never see recovery prompts or advance state.
    //    Corrupted state (activeRun exists but currentState is null): fail-closed,
    //    reject non-pipeline_start events since ownership cannot be verified.
    if (event !== 'pipeline_start' && activeRun && !currentState) {
      // Audit BLOCK for corrupted state
      const entry: AuditLogEntry = {
        timestamp: now,
        runId: activeRun.runId,
        projectId,
        sessionId,
        event,
        phase: 0,
        decision: 'BLOCK',
        violation: `Pipeline state file is missing or corrupted for run ${activeRun.runId}.`,
      }
      this.store.appendAudit(projectId, activeRun.runId, entry)

      return JSON.stringify({
        ok: false,
        violation: 'Pipeline state file is missing or corrupted. Cannot verify ownership.',
        guidance: 'Only pipeline_start can proceed when state is corrupted. Call pipeline_start to recover.',
      })
    }
    // Security boundary: ownership check only applies to states with ownerSessionId.
    // Phase 1 legacy states (pre-v2 migration, no ownerSessionId) are implicitly owned
    // by the first session to interact. To establish explicit ownership, call pipeline_start.
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
      // C-2: single-pipeline constraint with PN-aware status checks
      if (activeRun && currentState) {
        const status = currentState.phaseStatus
        const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled'])
        if (status === 'paused') {
          return JSON.stringify({
            ok: false,
            violation: 'Pipeline is paused. Call pipeline_unpause to resumeFromPause before starting a new pipeline.',
            guidance: 'Use pipeline_unpause to resume the paused pipeline, or wait for auto-resume.',
          })
        }
        if (status === 'awaiting_approval') {
          return JSON.stringify({
            ok: false,
            violation: 'Pipeline is awaiting_approval. Complete the current phase approval before starting a new pipeline.',
            guidance: 'Use user_approval to approve the current phase first.',
          })
        }
        if (status === 'suspended') {
          payload._parentRunId = activeRun.runId
          payload._parentDepth = currentState.depth ?? 0
          payload._parentProjectId = projectId
        } else if (TERMINAL_STATUSES.has(status) || (status === 'idle' && !hasOwner(currentState)) || payload.force) {
        } else {
          if (!isStale(currentState.lastCheckpointAt, this.staleThresholdMs)) {
            return JSON.stringify({
              ok: false,
              violation: 'A pipeline is already active for this project.',
              guidance: 'Only one pipeline per project is allowed. Complete or cancel the current pipeline first.',
            })
          }
          if (hasOwner(currentState) && currentState.ownerSessionId !== sessionId) {
            return JSON.stringify({
              ok: false,
              violation: 'A stale pipeline exists but belongs to another session.',
              guidance: 'Only the orchestrator can restart a stale pipeline. Sub-agents cannot create new pipelines.',
            })
          }
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
      // Tech Solution §D.2: inject loopConfig into pipeline_start payload
      // Security: always overwrite these fields to prevent payload injection.
      // When loopConfig is undefined (legacy), inject safe defaults (empty map + totalPhases fallback).
      payload._loopPhaseMap = this.loopConfig?.loopPhaseMap ?? {}
      payload._maxPhase = this.loopConfig?.maxPhase
    }
    payload._now = now
    payload._sessionId = sessionId

    // ── 7a. Unknown event detection ────────────────────────────────
    const KNOWN_EVENTS = new Set<CheckpointEvent | 'TEST_RUN_COMPLETE'>([
      'pipeline_start', 'phase_enter', 'ralph_loop_start', 'ralph_round_complete',
      'ralph_round_finding', 'ralph_terminate', 'test_evidence', 'user_approval',
      'phase_complete', 'why_articulation',
      'pipeline_suspend', 'pipeline_resume', 'pipeline_pause', 'pipeline_unpause',
      'd2_complete', 'phase_fail', 'TEST_RUN_COMPLETE',
    ])
    if (!KNOWN_EVENTS.has(event as CheckpointEvent | 'TEST_RUN_COMPLETE')) {
      this.logger?.warn(`unsupported/unknown checkpoint event: ${event}`)
      return JSON.stringify({
        ok: false,
        violation: `unsupported/unknown event: ${event}`,
        guidance: `Event '${event}' is not a recognized checkpoint event.`,
      } satisfies CheckpointViolation)
    }

    // ── 7b. Rate-limit PN events ───────────────────────────────────
    const PN_RATE_EVENTS = new Set(['pipeline_suspend', 'pipeline_resume', 'pipeline_pause', 'pipeline_unpause'])
    if (PN_RATE_EVENTS.has(event)) {
      const now2 = Date.now()
      const timestamps = this._pnRateLimit.get(projectId) ?? []
      const recent = timestamps.filter(t => now2 - t < CheckpointHandler.PN_RATE_WINDOW_MS)
      if (recent.length >= CheckpointHandler.PN_RATE_MAX_IN_WINDOW) {
        this.logger?.warn(`rate-limit throttling for project ${projectId}: too many PN events in window`)
        return JSON.stringify({ ok: true, throttled: true })
      }
      recent.push(now2)
      this._pnRateLimit.set(projectId, recent)
    }

    // ── 7c. Route PN (pipeline nesting) events before validateTransition ──
    const pnResult = this._routePNEvent(event, payload, projectId, activeRun)
    if (pnResult !== null) return pnResult

    // ── 8. Normalize severities (Phase 2.3) ──────────────────────────
    normalizeSeverities(event, payload)

    // ── 9. Validate transition ────────────────────────────────────────
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
        payload._articulationFailureCount = 0
      } else {
        const failures = this.getFailureCount(phase, currentState) + 1
        this.articulationFailures.set(phase, failures)
        payload._articulationFailureCount = failures
        if (failures >= ARTICULATION_MAX_FAILURES) {
          payload._articulationDegraded = true
        }
        articulationViolated = true
      }
    }

    // ── 9b2. RALPH_ROUNDS safety net on ralph_round_complete (F-26) ─────
    if (event === 'ralph_round_complete' && activeRun && currentState?.ralph) {
      const round = payload.round as number
      if (round >= MAX_RALPH_ROUNDS) {
        this.store.appendAudit(projectId, activeRun.runId, {
          timestamp: now,
          runId: activeRun.runId,
          projectId,
          sessionId,
          event: 'RALPH_ROUNDS_EXCEEDED',
          phase: currentState.currentPhase,
          round,
          decision: 'WARN',
          severity: 'warn',
          violation: `Ralph Loop reached maximum rounds limit (${MAX_RALPH_ROUNDS}) on round_complete`,
        })
        return JSON.stringify({
          ok: false,
          violation: `Ralph Loop reached maximum rounds (${MAX_RALPH_ROUNDS}). Pipeline run terminated.`,
          guidance: `The Ralph Loop reached ${round} rounds (limit: ${MAX_RALPH_ROUNDS}). Start a fresh pipeline.`,
        } satisfies CheckpointViolation)
      }
    }

    // ── 10. AC-2 enforcement on ralph_round_complete (Phase 2) ────────
    if (event === 'ralph_round_complete' && activeRun && this.observer) {
      const round = payload.round as number
      const skipAC2 = this.observer.isDegraded(projectId, activeRun.runId, round)
      if (skipAC2) {
        // Spec §6.4: log warning when AC-2 is skipped due to observer degradation
        this.logger?.warn('[TDD Watchdog] AC-2 skipped: observer was degraded during round %d for pipeline %s/%s', round, projectId, activeRun.runId)
      } else {
        const observations = await this.store.findObservations(projectId, activeRun.runId, { type: OBS_TYPE_REVIEWER_SPAWNED, round })
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

    // ── 9b. RALPH_ROUNDS safety net (Phase 2, AC-6) ───────────────────────
    // Order: must fire before §9c (TEST_RUN_REQUESTED) and §10a (violation gate).
    // Early return prevents downstream audit entries and gate checks.
    if (event === 'phase_complete' && activeRun && currentState?.ralph) {
      if (currentState.ralph.round >= MAX_RALPH_ROUNDS) {
        this.store.appendAudit(projectId, activeRun.runId, {
          timestamp: now,
          runId: activeRun.runId,
          projectId,
          sessionId,
          event: 'RALPH_ROUNDS_EXCEEDED',
          phase: currentState.currentPhase,
          decision: 'WARN',
          severity: 'warn',
          violation: `Ralph Loop reached maximum rounds limit (${MAX_RALPH_ROUNDS})`,
        })
        return JSON.stringify({
          ok: false,
          violation: `Ralph Loop reached maximum rounds (${MAX_RALPH_ROUNDS}). Pipeline run terminated.`,
          guidance: `The Ralph Loop reached ${currentState.ralph.round} rounds (limit: ${MAX_RALPH_ROUNDS}). Start a fresh pipeline.`,
        } satisfies CheckpointViolation)
      }
    }

    // ── 9c. TEST_RUN_REQUESTED for business code phase (Phase 2, AC-1) ──
    if (event === 'phase_complete' && activeRun && currentState?.currentPhase === BUSINESS_CODE_PHASE) {
      this.store.appendAudit(projectId, activeRun.runId, {
        timestamp: now,
        runId: activeRun.runId,
        projectId,
        sessionId,
        event: 'TEST_RUN_REQUESTED',
        phase: currentState.currentPhase,
        decision: 'PASS',
        severity: 'warn',
      })
    }

    // ── 10a. Phase 1 violation gate (§3.1 AC-8) ──────────────────────────
    //    For phase_complete events, check unresolved block violations BEFORE
    //    applyTransition. Fail-closed: if getUnresolvedViolations throws, block.
    if (event === 'phase_complete' && activeRun) {
      const gateStore = this.store as Phase1Store

      if (typeof gateStore.getUnresolvedViolations === 'function') {
        try {
          const blockViolations = gateStore.getUnresolvedViolations(projectId, activeRun.runId, 'block')
          if (blockViolations.length > 0) {
            const descriptions = blockViolations.map(v => v.violation)
            this.store.appendAudit(projectId, activeRun.runId, {
              timestamp: now, runId: activeRun.runId, projectId, sessionId,
              event, phase: currentState?.currentPhase ?? 0,
              decision: 'BLOCK',
              violation: `Violation gate: ${blockViolations.length} unresolved block violation(s)`,
            })
            return JSON.stringify({
              ok: false,
              violation: `Violation gate: ${blockViolations.length} unresolved block violation(s) must be fixed before phase can complete.`,
              violations: descriptions,
              guidance: `Fix the following violations before completing this phase: ${descriptions.join('; ')}`,
            })
          }
        } catch {
          return JSON.stringify({
            ok: false,
            violation: 'Violation gate: unable to check unresolved violations (storage error). Fail-closed: phase completion blocked.',
            guidance: 'The violation storage is temporarily unavailable. Retry or investigate the storage issue.',
          })
        }
      }
    }

    // ── 10b. TS→Python intervention bridge (v0.2.0) ────────────────────
    //    After the §10a hard-gate passes, dispatch a best-effort advisory
    //    call to the Python intervention engine for phase_complete and
    //    ralph_round_complete events. Python may surface additional context
    //    (KI doc state, compliance signals) the TS watchdog cannot see.
    //    GUARDED: only fires when mcpProjectDir is non-empty.
    //    FAULT-TOLERANT: any error → interventionResult stays null.
    let interventionResult: InterventionBatchResult | null = null
    if (
      (event === 'phase_complete' || event === 'ralph_round_complete') &&
      activeRun &&
      this.mcpProjectDir &&
      currentState
    ) {
      const gateStore10b = this.store as Phase1Store
      const allViolations = typeof gateStore10b.getUnresolvedViolations === 'function'
        ? gateStore10b.getUnresolvedViolations(projectId, activeRun.runId)
        : []
      if (allViolations.length > 0) {
        const phaseNow = currentState.currentPhase ?? 0
        const bridgePayload: InterventionBatchPayload = {
          context: {
            project_id: projectId,
            run_id: activeRun.runId,
            phase: phaseNow,
            current_phase: phaseNow,
          },
          violations: allViolations.map(v => ({
            signal: 'violation-gate-block',
            context: {
              phase: phaseNow,
              run_id: activeRun.runId,
              description: v.violation,
              severity: v.severity,
            },
            affected_file_paths: [],
          })),
        }
        this.logger?.debug('intervention-bridge: dispatching %d violations', allViolations.length)
        const bridgeResponse = await callIntervention(bridgePayload, this.mcpProjectDir)
        if (bridgeResponse.error) {
          this.logger?.debug('intervention-bridge: returned error: %s', bridgeResponse.error)
        } else if (
          bridgeResponse.failed > 0 ||
          bridgeResponse.results.some(r => r.action === 'blocked')
        ) {
          this.logger?.debug(
            'intervention-bridge: %d failed, %d blocked',
            bridgeResponse.failed,
            bridgeResponse.results.filter(r => r.action === 'blocked').length,
          )
          interventionResult = bridgeResponse
        }
      }
    }

    // ── 11. Apply transition (M3: defensive try/catch) ─────────────────
    let newState: PipelineState
    try {
      newState = this._applyTransition(event, payload, currentState)
    } catch (err) {
      this.logger?.error('applyTransition threw for event %s: %s', event, String(err))
      return JSON.stringify({
        ok: false,
        violation: `Internal state error: ${String(err)}`,
        guidance: 'This is an unexpected error. Start a fresh pipeline with pipeline_start.',
      } satisfies CheckpointViolation)
    }
    const runId = newState.runId

    // ── 11a. Reset articulation counters (after successful transition) ──
    if (event === 'phase_enter' && typeof payload.phase === 'number') {
      this.articulationFailures.delete(payload.phase)
    }
    if (event === 'pipeline_start') {
      this.articulationFailures.clear()
    }

    // ── 11b. pipeline_start PN-aware post-processing ──
    if (event === 'pipeline_start') {
      if (payload._parentRunId) {
        newState.depth = ((payload._parentDepth as number) ?? 0) + 1
        newState.parentRunId = payload._parentRunId as string
        newState.parentPipelineProjectId = payload._parentProjectId as string
      }
    }

    // ── 11c. Pre-write invariant: ownerSessionId MUST-PRESERVE (R6 M-2) ──
    // If the current state has an owner, the new state MUST also have one.
    // This assertion fires BEFORE writeState to prevent disk contamination.
    if (hasOwner(currentState) && !hasOwner(newState)) {
      throw new Error(
        `BUG: ownerSessionId lost during ${event} transition. ` +
        `This is a programming error — please report. ` +
        `Owner was: ${currentState.ownerSessionId}`,
      )
    }

    this.store.writeState(projectId, runId, newState)
    this.cache?.update(newState)

    // For pipeline_start: register active run AFTER state is persisted
    if (event === 'pipeline_start') {
      if (activeRun && payload.force) {
        this.store.removeRegressionCounter?.(activeRun.runId)
        while (this.store.popSuspended(projectId)) { /* drain orphaned stack */ }
      }
      this.store.setActiveRun(projectId, {
        runId,
        projectId,
        startedAt: now,
      })
      this.store.createRegressionCounter?.(runId)
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
      auditEntry.severity = 'warn'
      auditEntry.violation = `Articulation incomplete: ${articulationResult?.missingDimension ?? 'unknown'} missing.`
    }
    if (payload.round !== undefined) {
      auditEntry.round = payload.round as number
    }
    this.store.appendAudit(projectId, runId, auditEntry)

    // ── 12. phase_complete(final) → clearActiveRun + archiveRun ──────
    // Tech Solution §D.2 Change 2: effectiveMax = maxPhase ?? totalPhases
    if (event === 'phase_complete') {
      const gateStore = this.store as Phase1Store
      if (typeof gateStore.resolveViolations === 'function' && typeof gateStore.getUnresolvedViolations === 'function') {
        const blockRemaining = gateStore.getUnresolvedViolations(projectId, runId, 'block')
        const warnRemaining = gateStore.getUnresolvedViolations(projectId, runId, 'warn')
        const allRemaining = [...blockRemaining, ...warnRemaining]
        gateStore.resolveViolations(projectId, runId, allRemaining.map(v => v.timestamp))
      }

      const effectiveMax = newState.maxPhase ?? newState.totalPhases
      if (payload.phase === effectiveMax) {
        this.store.archiveRun(projectId, runId)
        this.store.clearActiveRun(projectId)
        this.cache?.clear()
        this.observer?.clearDegradation(projectId, runId)
      }
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

    if (interventionResult) {
      const augmented: { ok: true; state: PipelineStateSummary; intervention_result: InterventionBatchResult } = {
        ok: true,
        state: summarizeState(newState),
        intervention_result: interventionResult,
      }
      return JSON.stringify(augmented)
    }

    return JSON.stringify({
      ok: true,
      state: summarizeState(newState),
    } satisfies CheckpointOk)
  }

  private _routePNEvent(
    event: string,
    payload: Record<string, unknown>,
    projectId: string,
    activeRun: ActiveRun | null,
  ): string | null {
    const PN_EVENTS = new Set(['pipeline_suspend', 'pipeline_resume', 'pipeline_pause', 'pipeline_unpause'])
    if (!PN_EVENTS.has(event)) return null

    const now = payload._now as string
    const effectiveProjectId = activeRun?.projectId ?? projectId

    if (event === 'pipeline_suspend') {
      const reason = payload.reason as string | undefined
      if (!reason || reason.length === 0) {
        if (activeRun) {
          this.store.appendAudit(effectiveProjectId, activeRun.runId, {
            timestamp: now, runId: activeRun.runId, projectId: effectiveProjectId,
            sessionId: (payload._sessionId as string) || '',
            event: 'pipeline_suspend', phase: 0, decision: 'BLOCK',
            violation: 'Missing required field: reason',
          })
        }
        return JSON.stringify({ ok: false, violation: 'Missing required field: reason in payload' })
      }
      this.store.suspendActive(effectiveProjectId, reason)
      const runId = activeRun?.runId ?? ''
      this.store.appendAudit(effectiveProjectId, runId, {
        timestamp: now, runId, projectId: effectiveProjectId,
        sessionId: (payload._sessionId as string) || '',
        event: 'pipeline_suspend', phase: 0, decision: 'PASS',
      })
      return JSON.stringify({ ok: true })
    }

    if (event === 'pipeline_resume') {
      const childRunId = (payload.child_run_id ?? payload.childRunId) as string | undefined
      if (!childRunId) {
        return JSON.stringify({ ok: false, violation: 'Missing required field: child_run_id in payload' })
      }
      this.store.resumeSuspended(effectiveProjectId, childRunId)
      const runId = activeRun?.runId ?? ''
      this.store.appendAudit(effectiveProjectId, runId, {
        timestamp: now, runId, projectId: effectiveProjectId,
        sessionId: (payload._sessionId as string) || '',
        event: 'pipeline_resume', phase: 0, decision: 'PASS',
      })
      return JSON.stringify({ ok: true })
    }

    if (event === 'pipeline_pause') {
      const reason = payload.reason as string | undefined
      if (!reason || reason.length === 0) {
        if (activeRun) {
          this.store.appendAudit(effectiveProjectId, activeRun.runId, {
            timestamp: now, runId: activeRun.runId, projectId: effectiveProjectId,
            sessionId: (payload._sessionId as string) || '',
            event: 'pipeline_pause', phase: 0, decision: 'BLOCK',
            violation: 'Missing required field: reason',
          })
        }
        return JSON.stringify({ ok: false, violation: 'Missing required field: reason in payload' })
      }
      this.store.pauseActive(effectiveProjectId)
      const runId = activeRun?.runId ?? ''
      this.store.appendAudit(effectiveProjectId, runId, {
        timestamp: now, runId, projectId: effectiveProjectId,
        sessionId: (payload._sessionId as string) || '',
        event: 'pipeline_pause', phase: 0, decision: 'PASS',
      })
      return JSON.stringify({ ok: true })
    }

    if (event === 'pipeline_unpause') {
      this.store.resumeFromPause(effectiveProjectId)
      const runId = activeRun?.runId ?? ''
      this.store.appendAudit(effectiveProjectId, runId, {
        timestamp: now, runId, projectId: effectiveProjectId,
        sessionId: (payload._sessionId as string) || '',
        event: 'pipeline_unpause', phase: 0, decision: 'PASS',
      })
      return JSON.stringify({ ok: true })
    }

    return null
  }

  private getFailureCount(phase: number, currentState: PipelineState | null): number {
    let count = this.articulationFailures.get(phase)
    if (count === undefined) {
      const phaseRec = currentState?.phases?.[phase] as PhaseRecord | undefined
      // M2 fix: prefer persisted failure count from PhaseRecord for accurate recovery after restart
      if (phaseRec?.articulationFailures !== undefined && phaseRec.articulationFailures > 0) {
        count = phaseRec.articulationFailures
      } else if (phaseRec?.articulationAttempted && !phaseRec?.articulationVerified) {
        // Legacy fallback: no persisted count, unknown actual count.
        // Return 0 to start fresh — safer to require an extra articulation than to skip degradation gate.
        count = 0
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
  if (ms < 0) return '<1s' // KI-13: clock skew guard
  if (ms < 1000) return '<1s'
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  const seconds = Math.floor((ms % (60 * 1000)) / 1000)
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
  if (minutes > 0) return `${minutes}m${seconds > 0 ? ` ${seconds}s` : ''}`
  return `${seconds}s`
}

function formatPhaseStatus(status: string): string {
  const map: Record<string, string> = {
    idle: 'idle',
    active: 'active',
    ralph_loop: 'Ralph loop',
    awaiting_approval: 'awaiting approval',
    complete: 'complete',
    suspended: 'suspended (child pipeline running)',
    paused: 'paused (awaiting intervention)',
    failed: 'failed',
    cancelled: 'cancelled',
  }
  return map[status] ?? status
}
