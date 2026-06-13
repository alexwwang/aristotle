export const MAX_RALPH_ROUNDS = 20
export const MIN_GATE_ROUNDS = 5
export const EARLY_STOP_CONSECUTIVE = 2
export const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000  // 4 hours

/**
 * The phase where only test files may be written (no business code).
 * This is a tdd-pipeline domain constraint: Phase 4 = Test Code in all pipeline sizes.
 * Business code writes in Phase 5+ require this phase's gate to be passed first.
 */
export const TEST_CODE_PHASE = 4

/**
 * The phase where business code may be written (after test code gate passed).
 * This is a tdd-pipeline domain constraint: Phase 5 = Business Code in all pipeline sizes.
 */
export const BUSINESS_CODE_PHASE = 5

/** Max consecutive articulation failures before degradation. */
export const ARTICULATION_MAX_FAILURES = 3

/** Max entries in SessionBuffer before FIFO eviction. */
export const SESSION_BUFFER_MAX_SIZE = 1000

/** Max number of tracked sessions in SessionBuffer before oldest is evicted. */
export const MAX_TRACKED_SESSIONS = 50

/** Max number of findings per ralph_round_finding submission. */
export const MAX_FINDINGS_PER_ROUND = 50

/** Max length of a single finding description in characters. */
export const MAX_FINDING_DESCRIPTION_LENGTH = 2000

/** Max length of a downgrade_reason string in characters. */
export const MAX_DOWNGRADE_REASON_LENGTH = 1000

/** Observer timeout budget per handle() call (ms). ADR-005: sync operations only. */
export const OBSERVER_TIMEOUT_MS = 20

/** Consecutive timeout count before severity degradation. ADR-009: ≥3 triggers warn mode. */
export const TIMEOUT_DEGRADE_THRESHOLD = 3

/** Max audit log entries before FIFO eviction triggers. ADR-011: eviction at checkpoint, not append. */
export const MAX_AUDIT_ENTRIES = 5000

export const MAX_DEPTH = 10
export const PAUSE_TIMEOUT_MS = 30 * 60 * 1000
export const CROSS_PROJECT_RESOLUTION_TIMEOUT_MS = 10 * 1000
