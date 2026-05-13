import type {
  CheckpointEvent,
  ContestedIssue,
  PipelineState,
  RalphTermination,
  RoundTally,
} from './schema.js'
import { SCHEMA_VERSION } from './schema.js'
import {
  EARLY_STOP_CONSECUTIVE,
  MAX_RALPH_ROUNDS,
  MIN_GATE_ROUNDS,
} from './constants.js'

export interface TransitionResult {
  valid: true
}

export interface TransitionViolation {
  valid: false
  violation: string
  guidance: string
}

export type ValidationResult = TransitionResult | TransitionViolation

function ok(): ValidationResult {
  return { valid: true }
}

function fail(violation: string, guidance: string): ValidationResult {
  return { valid: false, violation, guidance }
}

function isInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isInteger(val)
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0
}

function isNonNegativeInt(val: unknown): boolean {
  return isInt(val) && val >= 0
}

function checkTally(tally: unknown): { ok: boolean; msg?: string } {
  if (typeof tally !== 'object' || tally === null) {
    return { ok: false, msg: 'tally must be an object' }
  }
  const t = tally as Record<string, unknown>
  for (const key of ['C', 'H', 'M', 'L', 'I']) {
    if (!(key in t)) {
      return { ok: false, msg: `tally missing required field '${key}'` }
    }
    if (!isNonNegativeInt(t[key])) {
      return { ok: false, msg: `tally.${key} must be a non-negative integer` }
    }
  }
  return { ok: true }
}

const NO_ACTIVE_RUN = 'No active pipeline run for this project.' as const
const START_FIRST =
  "Start a pipeline first by calling tdd_checkpoint with event='pipeline_start'." as const

/**
 * Validate a state transition WITHOUT mutating state.
 * Pure function — no I/O, no side effects.
 *
 * M-7: Validates all payload fields against event-specific schemas first
 * (type checks, range checks, required fields), then checks state preconditions.
 * Invalid payloads return violation before state is examined.
 */
export function validateTransition(
  event: CheckpointEvent,
  payload: Record<string, unknown>,
  state: PipelineState | null,
): ValidationResult {
  // ── Payload validation first (M-7) ──────────────────────────────
  switch (event) {
    case 'pipeline_start': {
      if (!isNonEmptyString(payload.description)) {
        return fail(
          'Missing required field',
          'pipeline_start requires a non-empty string description field.',
        )
      }
      break
    }

    case 'phase_enter': {
      if (!isInt(payload.phase) || payload.phase < 1 || payload.phase > 5) {
        return fail(
          'Invalid phase number',
          'phase_enter requires phase to be an integer between 1 and 5.',
        )
      }
      break
    }

    case 'ralph_loop_start': {
      if (!isInt(payload.phase)) {
        return fail(
          'Invalid phase',
          'ralph_loop_start requires phase to be an integer.',
        )
      }
      break
    }

    case 'ralph_round_complete': {
      if (!isInt(payload.phase)) {
        return fail(
          'Invalid phase',
          'ralph_round_complete requires phase to be an integer.',
        )
      }
      if (!isInt(payload.round) || payload.round < 1) {
        return fail(
          'Invalid round number',
          'ralph_round_complete requires round to be an integer >= 1.',
        )
      }
      const tc = checkTally(payload.tally)
      if (!tc.ok) {
        if (tc.msg?.includes('must be')) {
          return fail(
            'Invalid tally field type',
            'ralph_round_complete requires tally with C, H, M, L, I as non-negative integers.',
          )
        }
        return fail(
          'Missing required field',
          'ralph_round_complete requires tally with C, H, M, L, I as non-negative integers.',
        )
      }
      if (payload.contested_resolutions !== undefined) {
        if (!Array.isArray(payload.contested_resolutions)) {
          return fail(
            'Invalid contested_resolutions',
            'contested_resolutions must be an array.',
          )
        }
        for (const item of payload.contested_resolutions) {
          if (typeof item !== 'object' || item === null) {
            return fail(
              'Invalid contested_resolutions item',
              'Each contested_resolution must be an object with id and action fields.',
            )
          }
          const cr = item as Record<string, unknown>
          if (!isNonEmptyString(cr.id)) {
            return fail(
              'Invalid contested_resolutions item',
              'Each contested_resolution must have a non-empty string id.',
            )
          }
          if (!['accepted', 're_raised', 'escalated'].includes(cr.action as string)) {
            return fail(
              'Invalid contested_resolutions action',
              'contested_resolution action must be one of: accepted, re_raised, escalated.',
            )
          }
        }
      }
      if (payload.new_contested !== undefined) {
        if (!Array.isArray(payload.new_contested)) {
          return fail(
            'Invalid new_contested',
            'new_contested must be an array.',
          )
        }
        for (const item of payload.new_contested) {
          if (typeof item !== 'object' || item === null) {
            return fail(
              'Invalid new_contested item',
              'Each new_contested item must be an object with id and description fields.',
            )
          }
          const nc = item as Record<string, unknown>
          if (!isNonEmptyString(nc.id)) {
            return fail(
              'Invalid new_contested item',
              'Each new_contested item must have a non-empty string id.',
            )
          }
          if (!isNonEmptyString(nc.description)) {
            return fail(
              'Invalid new_contested item',
              'Each new_contested item must have a non-empty string description.',
            )
          }
        }
      }
      break
    }

    case 'ralph_terminate': {
      if (!isInt(payload.phase)) {
        return fail(
          'Invalid phase',
          'ralph_terminate requires phase to be an integer.',
        )
      }
      if (!['gate_pass', 'early_stop', 'max_rounds'].includes(payload.termination as string)) {
        return fail(
          'Invalid termination type',
          'ralph_terminate requires termination to be one of: gate_pass, early_stop, max_rounds.',
        )
      }
      break
    }

    case 'test_evidence': {
      if (payload.phase !== 4) {
        return fail(
          'Invalid phase for test evidence',
          'test_evidence requires phase to be 4.',
        )
      }
      if (!isNonEmptyString(payload.evidence_file)) {
        return fail(
          'Missing or invalid evidence_file',
          'test_evidence requires a non-empty string evidence_file field.',
        )
      }
      break
    }

    case 'user_approval': {
      if (!isInt(payload.phase)) {
        return fail(
          'Invalid phase',
          'user_approval requires phase to be an integer.',
        )
      }
      break
    }

    case 'phase_complete': {
      if (!isInt(payload.phase)) {
        return fail(
          'Invalid phase',
          'phase_complete requires phase to be an integer.',
        )
      }
      break
    }
  }

  // ── State precondition checks ───────────────────────────────────
  switch (event) {
    case 'pipeline_start': {
      // Always succeeds — caller handles archiving.
      return ok()
    }

    case 'phase_enter': {
      if (state === null) {
        return fail(NO_ACTIVE_RUN, START_FIRST)
      }
      const phase = payload.phase as number
      if (phase === 1) {
        if (state.phaseStatus !== 'idle') {
          return fail(
            'Pipeline already active',
            'Phase 1 can only be entered when pipeline status is idle.',
          )
        }
      } else {
        const prev = phase - 1
        const prevRec = state.phases[prev]
        if (!prevRec || !prevRec.userApproved) {
          return fail(
            `Phase ${prev} not yet complete`,
            `Phase ${phase} cannot be entered until phase ${prev} is user-approved.`,
          )
        }
        if (state.phaseStatus !== 'complete') {
          return fail(
            'Previous phase not completed',
            `Phase ${phase} cannot be entered until the previous phase is marked complete.`,
          )
        }
      }
      if (phase === 5 && !state.testEvidenceConfirmed) {
        return fail(
          'Test evidence not confirmed',
          'Phase 5 cannot be entered until test evidence is confirmed.',
        )
      }
      return ok()
    }

    case 'ralph_loop_start': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      if (state.currentPhase !== payload.phase) {
        return fail(
          'Phase mismatch',
          `ralph_loop_start must target the current phase (${state.currentPhase}).`,
        )
      }
      if (state.phaseStatus !== 'active') {
        return fail(
          'Phase not active',
          'ralph_loop_start can only be called when phase status is active.',
        )
      }
      return ok()
    }

    case 'ralph_round_complete': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      if (state.currentPhase !== payload.phase) {
        return fail(
          'Phase mismatch',
          `ralph_round_complete must target the current phase (${state.currentPhase}).`,
        )
      }
      if (state.phaseStatus !== 'ralph_loop') {
        return fail(
          'Not in ralph loop',
          'ralph_round_complete can only be called when phase status is ralph_loop.',
        )
      }
      if (state.ralph === null) {
        return fail(
          'Ralph loop not initialized',
          'ralph_round_complete requires ralph loop to be started first.',
        )
      }
      if (payload.round !== state.ralph.round + 1) {
        return fail(
          'Round skipping not allowed',
          `Expected round ${state.ralph.round + 1}, got ${payload.round}.`,
        )
      }
      if (state.ralph.openContested.length > 0 && payload.contested_resolutions === undefined) {
        return fail(
          'Missing contested_resolutions',
          'There are open contested issues that must be resolved in this round.',
        )
      }
      return ok()
    }

    case 'ralph_terminate': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      if (state.currentPhase !== payload.phase) {
        return fail(
          'Phase mismatch',
          `ralph_terminate must target the current phase (${state.currentPhase}).`,
        )
      }
      if (state.phaseStatus !== 'ralph_loop') {
        return fail(
          'Not in ralph loop',
          'ralph_terminate can only be called when phase status is ralph_loop.',
        )
      }
      if (state.ralph === null) {
        return fail(
          'Ralph loop not initialized',
          'ralph_terminate requires ralph loop to be started first.',
        )
      }
      const termination = payload.termination as RalphTermination
      const ralph = state.ralph
      if (termination === 'gate_pass') {
        if (ralph.round < MIN_GATE_ROUNDS) {
          return fail(
            'Insufficient rounds for gate pass',
            `Gate pass requires at least ${MIN_GATE_ROUNDS} rounds. Current: ${ralph.round}.`,
          )
        }
        const last = ralph.tallyHistory[ralph.tallyHistory.length - 1]
        if (!last || last.C + last.H + last.M > 0) {
          return fail(
            'Unresolved issues remain',
            'Gate pass requires the last tally to have C+H+M equal to 0.',
          )
        }
      } else if (termination === 'early_stop') {
        if (ralph.consecutiveZero < EARLY_STOP_CONSECUTIVE) {
          return fail(
            'Insufficient consecutive zero rounds',
            `Early stop requires at least ${EARLY_STOP_CONSECUTIVE} consecutive zero rounds. Current: ${ralph.consecutiveZero}.`,
          )
        }
      } else if (termination === 'max_rounds') {
        if (ralph.round < MAX_RALPH_ROUNDS) {
          return fail(
            'Insufficient rounds for max_rounds termination',
            `max_rounds termination requires at least ${MAX_RALPH_ROUNDS} rounds. Current: ${ralph.round}.`,
          )
        }
        const last = ralph.tallyHistory[ralph.tallyHistory.length - 1]
        if (!last || last.C + last.H + last.M === 0) {
          return fail(
            'No unresolved issues',
            'max_rounds termination requires the last tally to have C+H+M greater than 0.',
          )
        }
      }
      return ok()
    }

    case 'test_evidence': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      if (state.currentPhase < 4) {
        return fail(
          'Invalid phase for test evidence',
          'test_evidence can only be submitted in phase 4 or later.',
        )
      }
      return ok()
    }

    case 'user_approval': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      const phase = payload.phase as number
      if (phase !== state.currentPhase) {
        return fail(
          `Wrong phase: current is ${state.currentPhase}, got ${phase}`,
          `user_approval must target the current phase (${state.currentPhase}).`,
        )
      }
      const rec = state.phases[phase]
      if (!rec) {
        return fail(
          `Phase ${phase} not found`,
          `user_approval requires phase ${phase} to have been entered.`,
        )
      }
      if (!rec.ralphCompleted) {
        return fail(
          'Ralph loop not completed',
          `user_approval requires phase ${phase} ralph loop to be completed first.`,
        )
      }
      return ok()
    }

    case 'phase_complete': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      const phase = payload.phase as number
      if (phase !== state.currentPhase) {
        return fail(
          `Wrong phase: current is ${state.currentPhase}, got ${phase}`,
          `phase_complete must target the current phase (${state.currentPhase}).`,
        )
      }
      const rec = state.phases[phase]
      if (!rec) {
        return fail(
          `Phase ${phase} not found`,
          `phase_complete requires phase ${phase} to have been entered.`,
        )
      }
      if (!rec.userApproved) {
        return fail(
          'Phase not user-approved',
          `phase_complete requires phase ${phase} to be user-approved first.`,
        )
      }
      if (state.phaseStatus !== 'awaiting_approval') {
        return fail(
          'Phase not awaiting approval',
          'phase_complete can only be called when phase status is awaiting_approval.',
        )
      }
      return ok()
    }
  }
}

/**
 * Apply a validated transition, returning new state.
 * MUST only be called after validateTransition returns { valid: true }.
 * Pure function — caller is responsible for persistence.
 *
 * M-13: For pipeline_start, caller (CheckpointHandler) generates the runId
 * externally and passes it via payload._runId. This keeps applyTransition
 * pure and testable. All other events are naturally pure.
 *
 * M-17: Same pattern for timestamps. Caller injects current ISO timestamp
 * via payload._now. applyTransition uses payload._now for all timestamp
 * fields (lastCheckpointAt, enteredAt, approvedAt, RoundTally.timestamp, startedAt).
 * This keeps applyTransition deterministic for testing.
 */
export function applyTransition(
  event: CheckpointEvent,
  payload: Record<string, unknown>,
  state: PipelineState | null,
): PipelineState {
  const now =
    typeof payload._now === 'string' ? payload._now : new Date().toISOString()

  switch (event) {
    case 'pipeline_start': {
      return {
        version: SCHEMA_VERSION,
        projectId: payload._projectId as string,
        runId: payload._runId as string,
        startedAt: now,
        description: payload.description as string,
        currentPhase: 0,
        phaseStatus: 'idle',
        phases: {},
        ralph: null,
        testEvidenceConfirmed: false,
        lastCheckpointAt: now,
      }
    }

    case 'phase_enter': {
      if (state === null) {
        throw new Error('BUG: state must not be null for phase_enter')
      }
      const phase = payload.phase as number
      return {
        ...state,
        currentPhase: phase as PipelineState['currentPhase'],
        phaseStatus: 'active',
        phases: {
          ...state.phases,
          [phase]: {
            phase,
            enteredAt: now,
            ralphCompleted: false,
            ralphTermination: null,
            userApproved: false,
            approvedAt: null,
          },
        },
        lastCheckpointAt: now,
      }
    }

    case 'ralph_loop_start': {
      if (state === null) {
        throw new Error('BUG: state must not be null for ralph_loop_start')
      }
      const phase = payload.phase as number
      return {
        ...state,
        phaseStatus: 'ralph_loop',
        ralph: {
          phase,
          round: 0,
          consecutiveZero: 0,
          tallyHistory: [],
          openContested: [],
          escalated: false,
          escalatedAt: null,
          termination: null,
        },
        lastCheckpointAt: now,
      }
    }

    case 'ralph_round_complete': {
      if (state === null) {
        throw new Error('BUG: state must not be null for ralph_round_complete')
      }
      if (state.ralph === null) {
        throw new Error('BUG: ralph must not be null for ralph_round_complete')
      }
      const phase = payload.phase as number
      const round = payload.round as number
      const tally = payload.tally as {
        C: number
        H: number
        M: number
        L: number
        I: number
      }
      const contestedResolutions = payload.contested_resolutions as
        | Array<{ id: string; action: string }>
        | undefined
      const newContested = payload.new_contested as
        | Array<{ id: string; description: string }>
        | undefined

      const roundTally: RoundTally = {
        round,
        C: tally.C,
        H: tally.H,
        M: tally.M,
        L: tally.L,
        I: tally.I,
        timestamp: now,
      }

      const chmZero = tally.C + tally.H + tally.M === 0
      const newConsecutiveZero = chmZero
        ? state.ralph.consecutiveZero + 1
        : 0

      // Process contested issues (M-18)
      const resolvedIds = new Set(
        contestedResolutions?.map((r) => r.id) ?? [],
      )
      const newOpenContested: ContestedIssue[] = []

      for (const issue of state.ralph.openContested) {
        if (resolvedIds.has(issue.id)) {
          const action = contestedResolutions!.find(
            (r) => r.id === issue.id,
          )!.action
          if (action === 'accepted') {
            // Remove from openContested
            continue
          }
          // re_raised or escalated: treat as re_raised in Phase 1
          newOpenContested.push({
            ...issue,
            disputeRounds: issue.disputeRounds + 1,
          })
        } else {
          // Not mentioned: increment disputeRounds by 1 (M-6)
          newOpenContested.push({
            ...issue,
            disputeRounds: issue.disputeRounds + 1,
          })
        }
      }

      // Add new contested issues
      if (newContested) {
        for (const nc of newContested) {
          newOpenContested.push({
            id: nc.id,
            firstContestedRound: round,
            disputeRounds: 0,
            description: nc.description,
          })
        }
      }

      return {
        ...state,
        ralph: {
          ...state.ralph,
          round,
          consecutiveZero: newConsecutiveZero,
          tallyHistory: [...state.ralph.tallyHistory, roundTally],
          openContested: newOpenContested,
        },
        lastCheckpointAt: now,
      }
    }

    case 'ralph_terminate': {
      if (state === null) {
        throw new Error('BUG: state must not be null for ralph_terminate')
      }
      if (state.ralph === null) {
        throw new Error('BUG: ralph must not be null for ralph_terminate')
      }
      const phase = payload.phase as number
      const termination = payload.termination as RalphTermination
      return {
        ...state,
        phaseStatus: 'awaiting_approval',
        ralph: {
          ...state.ralph,
          termination,
        },
        phases: {
          ...state.phases,
          [phase]: {
            ...state.phases[phase],
            ralphCompleted: true,
            ralphTermination: termination,
          },
        },
        lastCheckpointAt: now,
      }
    }

    case 'test_evidence': {
      if (state === null) {
        throw new Error('BUG: state must not be null for test_evidence')
      }
      return {
        ...state,
        testEvidenceConfirmed: true,
        lastCheckpointAt: now,
      }
    }

    case 'user_approval': {
      if (state === null) {
        throw new Error('BUG: state must not be null for user_approval')
      }
      const phase = payload.phase as number
      return {
        ...state,
        phases: {
          ...state.phases,
          [phase]: {
            ...state.phases[phase],
            userApproved: true,
            approvedAt: now,
          },
        },
        lastCheckpointAt: now,
      }
    }

    case 'phase_complete': {
      if (state === null) {
        throw new Error('BUG: state must not be null for phase_complete')
      }
      return {
        ...state,
        phaseStatus: 'complete',
        ralph: null,
        lastCheckpointAt: now,
      }
    }
  }
}
