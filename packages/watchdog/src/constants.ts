export const MAX_RALPH_ROUNDS = 10
export const MIN_GATE_ROUNDS = 5
export const EARLY_STOP_CONSECUTIVE = 2
export const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000  // 4 hours

/**
 * The phase where only test files may be written (no business code).
 * This is a tdd-pipeline domain constraint: Phase 4 = Test Code in all pipeline sizes.
 * Business code writes in Phase 5+ require this phase's gate to be passed first.
 */
export const TEST_CODE_PHASE = 4

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
