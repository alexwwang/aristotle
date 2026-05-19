/** Watchdog checkpoint event types — the public API contract with tdd-pipeline SKILL.md */
export type CheckpointEvent =
  | 'pipeline_start'
  | 'phase_enter'
  | 'ralph_loop_start'
  | 'ralph_round_complete'
  | 'ralph_round_finding'    // Phase 2.1: GPAV — submit structured findings per round
  | 'ralph_terminate'
  | 'test_evidence'          // @deprecated (v1.8) still accepted, no longer gates
  | 'user_approval'
  | 'phase_complete'
  | 'why_articulation'

/** State machine version for forward-compatible reads */
export const SCHEMA_VERSION = 3

export interface PipelineState {
  version: typeof SCHEMA_VERSION
  projectId: string
  runId: string
  startedAt: string                // ISO 8601
  description: string              // from pipeline_start payload

  currentPhase: number                   // 0 = initialized, awaiting first phase_enter
  phaseStatus: PhaseStatus
  totalPhases: number                    // from pipeline_start payload (default 5 for backward compat)

  phases: Record<number, PhaseRecord>
  ralph: RalphLoopState | null

  /** @deprecated (v1.8) No longer gates behavior. Kept for backward compat. */
  testEvidenceConfirmed: boolean
  lastCheckpointAt: string         // ISO 8601, for stale detection
  /** Owning session ID. Mandatory for Phase 2+ pipelines (enforced by CheckpointHandler).
   *  Absent for Phase 1 legacy states — use `hasOwner()` guard before accessing. */
  ownerSessionId?: string
}

/** Phase 2+ pipeline state with guaranteed ownerSessionId. */
export interface OwnedPipelineState extends PipelineState {
  ownerSessionId: string
}

/** Type guard: narrows PipelineState to OwnedPipelineState when ownerSessionId is present. */
export function hasOwner(state: PipelineState | null): state is OwnedPipelineState {
  return state !== null && typeof state.ownerSessionId === 'string' && state.ownerSessionId.length > 0
}

export type PhaseStatus = 'idle' | 'active' | 'ralph_loop' | 'awaiting_approval' | 'complete'

export interface PhaseRecord {
  phase: number
  enteredAt: string                // ISO 8601
  ralphCompleted: boolean
  ralphTermination: RalphTermination | null
  userApproved: boolean
  approvedAt: string | null
  articulationAttempted: boolean
  articulationVerified: boolean
  articulationDegraded: boolean
  articulationFailures: number
  articulationDimensions?: {
    what_it_protects: boolean
    key_risks: boolean
    why_approach_works: boolean
  }
}

export type RalphTermination = 'early_stop' | 'gate_pass' | 'max_rounds' | 'escalated'

export interface RalphLoopState {
  phase: number
  round: number                    // 1-based
  consecutiveZero: number          // consecutive rounds with zero C/H/M (L excluded)
  tallyHistory: RoundTally[]
  openContested: ContestedIssue[]
  escalated: boolean
  escalatedAt: string | null
  termination: RalphTermination | null
  // Phase 2.1: GPAV — authoritative per-round counts from ralph_round_finding
  roundRecords: RoundRecord[]
  autoValidated: boolean           // true after first ralph_round_finding submission
}

export interface RoundTally {
  round: number
  C: number
  H: number
  M: number
  L: number
  I: number
  timestamp: string
}

export interface ContestedIssue {
  id: string                       // e.g. "M-2"
  firstContestedRound: number
  disputeRounds: number
  description: string
}

/** Phase 2.1: GPAV — authoritative per-round finding counts */
export interface RoundRecord {
  round: number
  counts: { C: number; H: number; M: number; L: number; I: number }
  submittedAt: string
}

/** Phase 2.1: GPAV — structured finding submitted by agent */
export interface FindingSubmission {
  severity: 'C' | 'H' | 'M' | 'L' | 'I'
  description: string
  /** Original severity from reviewer — set when agent relabels */
  original?: 'C' | 'H' | 'M' | 'L' | 'I'
  /** Required when severity is lower than original (downgrade) */
  downgrade_reason?: string
}

/** Active run index — one per project */
export interface ActiveRun {
  runId: string
  projectId: string
  startedAt: string
}

/** Project index — tracks all projects that have ever had watchdog data */
export interface ProjectIndex {
  projectIds: string[]
}

/** Checkpoint tool return types */
export interface CheckpointOk {
  ok: true
  state: PipelineStateSummary
}

export interface CheckpointViolation {
  ok: false
  violation: string
  guidance: string
}

export interface CheckpointRecovery {
  ok: false
  recovery: true
  staleState: PipelineStateSummary
  message: string
}

export type CheckpointResult = CheckpointOk | CheckpointViolation | CheckpointRecovery

export interface PipelineStateSummary {
  phase: number
  phaseStatus: PhaseStatus
  ralphRound: number | null
  runId: string
}

/** Audit log entry */
export interface AuditLogEntry {
  timestamp: string
  runId: string
  projectId: string
  sessionId: string
  event: CheckpointEvent | 'INTERCEPT' | 'PROMPT_INJECTION_DETECTED'
  phase: number
  round?: number
  decision: 'PASS' | 'BLOCK' | 'WARN'
  violation?: string
}

// ── Phase 2: Observation types ─────────────────────────────────────────

export interface ObservationEntry {
  timestamp: string
  type: string
  tool: string
  callID: string
  round?: number
  metadata?: Record<string, unknown>
}

// ── Phase 2: Articulation dimensions ───────────────────────────────────

export type ArticulationDimension = 'what_it_protects' | 'key_risks' | 'why_approach_works'

// ── Phase 2: Observation type constants ────────────────────────────────

export const OBS_TYPE_REVIEWER_SPAWNED = '_reviewer_spawned' as const
export const OBS_TYPE_OBSERVER_DEGRADED = '_observer_degraded' as const
export const OBS_TYPE_PROMPT_INJECTION = '_prompt_injection' as const
