import type {
  CheckpointEvent,
  ContestedIssue,
  FindingSubmission,
  PhaseRecord,
  PipelineState,
  RalphTermination,
  RoundRecord,
  RoundTally,
} from './schema.js'
import { SCHEMA_VERSION } from './schema.js'
import { getLoopType } from './loop-config.js'
import type { PhaseLoopMap } from './loop-config.js'
import {
  EARLY_STOP_CONSECUTIVE,
  MAX_DOWNGRADE_REASON_LENGTH,
  MAX_FINDING_DESCRIPTION_LENGTH,
  MAX_FINDINGS_PER_ROUND,
  MAX_RALPH_ROUNDS,
  MIN_GATE_ROUNDS,
  TEST_CODE_PHASE,
} from './constants.js'

export interface TransitionResult {
  valid: true
  warning?: string
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

function checkTally(tally: unknown): { ok: boolean; errorType?: 'missing' | 'type' } {
  if (tally === undefined) {
    return { ok: false, errorType: 'missing' }
  }
  if (typeof tally !== 'object' || tally === null) {
    return { ok: false, errorType: 'type' }
  }
  const t = tally as Record<string, unknown>
  for (const key of ['C', 'H', 'M', 'P', 'L', 'I']) {
    if (!(key in t)) {
      return { ok: false, errorType: 'missing' }
    }
    if (!isNonNegativeInt(t[key])) {
      return { ok: false, errorType: 'type' }
    }
  }
  return { ok: true }
}

/** Severity ordering: C=5 > H=4 > M=3 > P=2 > L=1 > I=0. P=Proposal (quality-tier, does not reset consecutive-zero). Returns true when a is less severe than b. */
const SEV_ORDER: Record<string, number> = { C: 5, H: 4, M: 3, P: 2, L: 1, I: 0 }
const VALID_SEVERITIES = new Set(['C', 'H', 'M', 'P', 'L', 'I'])
function severityLt(a: string, b: string): boolean {
  return (SEV_ORDER[a] ?? 0) < (SEV_ORDER[b] ?? 0)
}

export const NO_ACTIVE_RUN = 'No active pipeline run for this project.' as const
const START_FIRST =
  "Start a pipeline first by calling tdd_checkpoint with event='pipeline_start'." as const

/**
 * Tally-based termination validation (legacy + KI-24 fallback).
 * Used when GPAV roundRecords are unavailable — checks tallyHistory and consecutiveZero.
 */
function validateTallyTermination(
  termination: RalphTermination,
  ralph: { round: number; tallyHistory: RoundTally[]; consecutiveZero: number },
): ValidationResult {
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
      if (payload.totalPhases !== undefined) {
        if (!isInt(payload.totalPhases) || payload.totalPhases < 1) {
          return fail(
            'Invalid totalPhases',
            'totalPhases must be a positive integer.',
          )
        }
      }
      break
    }

    case 'phase_enter': {
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail(
          'Invalid phase number',
          'phase_enter requires phase to be a positive integer.',
        )
      }
      break
    }

    case 'ralph_loop_start': {
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail(
          'Invalid phase',
          'ralph_loop_start requires phase to be a positive integer.',
        )
      }
      break
    }

    case 'ralph_round_complete': {
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail(
          'Invalid phase',
          'ralph_round_complete requires phase to be a positive integer.',
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
        if (tc.errorType === 'type') {
          return fail(
            'Invalid tally field type',
            'ralph_round_complete requires tally with C, H, M, P, L, I as non-negative integers.',
          )
        }
        return fail(
          'Missing required field',
          'ralph_round_complete requires tally with C, H, M, P, L, I as non-negative integers.',
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
          if (cr.action === 'escalated') {
            return fail(
              'Escalation not yet implemented',
              'The escalated action is reserved for a future phase. Use accepted or re_raised.',
            )
          }
          if (!['accepted', 're_raised'].includes(cr.action as string)) {
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
        // Check for duplicate IDs within new_contested
        const ncIds = (payload.new_contested as Array<Record<string, unknown>>).map(i => i.id)
        if (new Set(ncIds).size !== ncIds.length) {
          const dupes = ncIds.filter((id, i) => ncIds.indexOf(id) !== i)
          return fail(
            'Duplicate contested ID',
            `new_contested contains duplicate id(s): ${[...new Set(dupes)].join(', ')}.`,
          )
        }
        // Check for conflicts with existing openContested IDs
        if (state?.ralph?.openContested) {
          const existingIds = new Set(state.ralph.openContested.map(i => i.id))
          for (const ncId of ncIds) {
            if (existingIds.has(ncId as string)) {
              return fail(
                'Duplicate contested ID',
                `new_contested id '${ncId}' conflicts with an existing open contested issue.`,
              )
            }
          }
        }
      }
      break
    }

    case 'ralph_terminate': {
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail(
          'Invalid phase',
          'ralph_terminate requires phase to be a positive integer.',
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
      if (payload.phase !== TEST_CODE_PHASE) {
        return fail(
          'Invalid phase for test evidence',
          `test_evidence requires phase to be ${TEST_CODE_PHASE}.`,
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
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail(
          'Invalid phase',
          'user_approval requires phase to be a positive integer.',
        )
      }
      break
    }

    case 'phase_complete': {
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail(
          'Invalid phase',
          'phase_complete requires phase to be a positive integer.',
        )
      }
      break
    }

    case 'why_articulation': {
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail(
          'Invalid phase',
          'why_articulation requires phase to be a positive integer.',
        )
      }
      if (!isNonEmptyString(payload.articulation)) {
        return fail(
          'Missing or invalid articulation',
          'why_articulation requires a non-empty string articulation field.',
        )
      }
      break
    }

    case 'ralph_round_finding': {
      if (!isInt(payload.phase) || payload.phase < 1) {
        return fail('Invalid phase', 'ralph_round_finding requires phase to be a positive integer.')
      }
      if (!isInt(payload.round) || payload.round < 1) {
        return fail('Invalid round', 'ralph_round_finding requires round to be a positive integer.')
      }
      if (!Array.isArray(payload.findings) || (payload.findings as unknown[]).length === 0) {
        return fail('Missing findings', 'ralph_round_finding requires a non-empty findings array.')
      }
      if ((payload.findings as unknown[]).length > MAX_FINDINGS_PER_ROUND) {
        return fail('Too many findings', `ralph_round_finding accepts at most ${MAX_FINDINGS_PER_ROUND} findings per round, got ${(payload.findings as unknown[]).length}.`)
      }
      // Validate each finding structure
      const validSeverities = VALID_SEVERITIES
      for (let i = 0; i < (payload.findings as unknown[]).length; i++) {
        const f = (payload.findings as Record<string, unknown>[])[i]
        if (!f || typeof f !== 'object') {
          return fail(`Invalid finding at index ${i}`, 'Each finding must be an object.')
        }
        if (!validSeverities.has(f.severity as string)) {
          return fail(`Invalid severity at index ${i}`, `Finding severity must be one of C/H/M/P/L/I, got "${f.severity}".`)
        }
        if (typeof f.description !== 'string' || (f.description as string).length === 0) {
          return fail(`Missing description at index ${i}`, 'Each finding must have a non-empty description.')
        }
        if ((f.description as string).length > MAX_FINDING_DESCRIPTION_LENGTH) {
          return fail(`Description too long at index ${i}`, `Finding description must be at most ${MAX_FINDING_DESCRIPTION_LENGTH} characters, got ${(f.description as string).length}.`)
        }
        if (f.original !== undefined) {
          if (!validSeverities.has(f.original as string)) {
            return fail(`Invalid original severity at index ${i}`, `Original severity must be one of C/H/M/P/L/I, got "${f.original}".`)
          }
          if (severityLt(f.severity as string, f.original as string)) {
            if (typeof f.downgrade_reason !== 'string' || (f.downgrade_reason as string).trim().length === 0) {
              return fail(`Missing downgrade_reason at index ${i}`, `Severity downgrade from ${f.original} to ${f.severity} requires a downgrade_reason.`)
            }
            if ((f.downgrade_reason as string).length > MAX_DOWNGRADE_REASON_LENGTH) {
              return fail(`Downgrade reason too long at index ${i}`, `downgrade_reason must be at most ${MAX_DOWNGRADE_REASON_LENGTH} characters, got ${(f.downgrade_reason as string).length}.`)
            }
          }
        }
      }
      break
    }

    default: {
      return fail('Unknown event', `Unrecognized event type: ${event}`)
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
      if (phase <= state.currentPhase) {
        return fail(
          'Phase regression not allowed',
          `Cannot enter phase ${phase}: pipeline is already at phase ${state.currentPhase}. Phase transitions must be monotonically forward.`,
        )
      }
      // Tech Solution §D.2 Change 2: effectiveMax = maxPhase ?? totalPhases
      const effectiveMax = state.maxPhase ?? state.totalPhases
      if (phase > effectiveMax) {
        return fail(
          'Phase exceeds pipeline total',
          `Phase ${phase} exceeds pipeline total of ${effectiveMax} phases.`,
        )
      }
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
      // v1.8: Removed testEvidenceConfirmed check for phase 5.
      // Phase gate is now solely Ralph loop completion + user approval,
      // which is enforced by the userApproved check above.
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
      // Tech Solution §D.2: reject ralph_loop_start for followup phases
      const loopType = getLoopType(state, payload.phase as number)
      if (loopType === 'followup') {
        return fail(
          'Followup phase — no Ralph loop',
          `Phase ${payload.phase} is a followup phase and does not require a Ralph loop. Proceed directly to user_approval.`,
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
      if (state.ralph.openContested.length > 0 &&
        (payload.contested_resolutions == null || !Array.isArray(payload.contested_resolutions) || payload.contested_resolutions.length === 0)) {
        return fail(
          'Missing contested_resolutions',
          'There are open contested issues that must be resolved in this round.',
        )
      }
      if (state.ralph.openContested.length > 0 && Array.isArray(payload.contested_resolutions) && payload.contested_resolutions.length > 0) {
        const openIds = new Set(state.ralph.openContested.map(i => i.id))
        const provided = payload.contested_resolutions as Array<Record<string, unknown>>
        const matchingIds = provided.filter(r => openIds.has(r.id as string))
        if (matchingIds.length === 0) {
          return fail(
            'Invalid contested_resolutions',
            'None of the provided contested_resolutions match any open contested issue. Open issues: ' + [...openIds].join(', '),
          )
        }
      }
      // Phase 2.1 GPAV: mixed path explicitly rejected — when autoValidated,
      // ralph_round_complete is forbidden. Agent must use ralph_terminate instead.
      if (state.ralph.autoValidated) {
        return fail(
          'GPAV active — ralph_round_complete forbidden',
          'GPAV mode is active. Use ralph_round_finding to submit findings and ralph_terminate to complete. ralph_round_complete is only available in legacy mode (autoValidated=false).',
        )
      }
      return ok()
    }

    case 'ralph_round_finding': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      if (state.currentPhase !== payload.phase) {
        return fail(
          'Phase mismatch',
          `ralph_round_finding must target the current phase (${state.currentPhase}).`,
        )
      }
      if (state.phaseStatus !== 'ralph_loop') {
        return fail(
          'Not in ralph loop',
          'ralph_round_finding can only be called when phase status is ralph_loop.',
        )
      }
      if (state.ralph === null) {
        return fail(
          'Ralph loop not initialized',
          'ralph_round_finding requires ralph loop to be started first.',
        )
      }
      const round = payload.round as number
      if (round !== state.ralph.round + 1) {
        return fail(
          'Round mismatch',
          `Expected round ${state.ralph.round + 1}, got ${round}.`,
        )
      }
      // Note: findings structural validation is in the payload section (M-7 compliance)
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

      // Phase 2.1 GPAV: use roundRecords as authoritative source when autoValidated
      // Only consider completed rounds (round <= ralph.round). Uncommitted findings
      // (submitted via ralph_round_finding but not yet closed by ralph_round_complete)
      // are excluded to prevent gate_pass bypass.
      if (ralph.autoValidated && ralph.roundRecords.length > 0) {
        const completedRecords = ralph.roundRecords.filter(r => r.round <= ralph.round)
        if (completedRecords.length > 0) {
          // Compute consecutiveZero from completed records with strict definition: C=H=M=0, P/L excluded
          let strictConsecutive = 0
          for (let i = completedRecords.length - 1; i >= 0; i--) {
            const c = completedRecords[i].counts
            if (c.C === 0 && c.H === 0 && c.M === 0) {
              strictConsecutive++
            } else {
              break
            }
          }

          if (termination === 'gate_pass') {
            if (ralph.round < MIN_GATE_ROUNDS) {
              return fail(
                'Insufficient rounds for gate pass',
                `Gate pass requires at least ${MIN_GATE_ROUNDS} rounds. Current: ${ralph.round}.`,
              )
            }
            const lastRec = completedRecords[completedRecords.length - 1]
            if (!lastRec || lastRec.counts.C + lastRec.counts.H + lastRec.counts.M > 0) {
              return fail(
                'Unresolved issues remain (GPAV)',
                'Gate pass requires the last completed round to have C=H=M=0 per Watchdog records.',
              )
            }
          } else if (termination === 'early_stop') {
            if (strictConsecutive < EARLY_STOP_CONSECUTIVE) {
              return fail(
                'Insufficient consecutive zero rounds (GPAV)',
                `Early stop requires at least ${EARLY_STOP_CONSECUTIVE} consecutive completed rounds with C=H=M=0. Current: ${strictConsecutive}.`,
              )
            }
          } else if (termination === 'max_rounds') {
            if (ralph.round < MAX_RALPH_ROUNDS) {
              return fail(
                'Insufficient rounds for max_rounds termination',
                `max_rounds termination requires at least ${MAX_RALPH_ROUNDS} rounds. Current: ${ralph.round}.`,
              )
            }
            const lastRec = completedRecords[completedRecords.length - 1]
            if (!lastRec || lastRec.counts.C + lastRec.counts.H + lastRec.counts.M === 0) {
              return fail(
                'No unresolved issues (GPAV)',
                'max_rounds termination requires the last completed round to have C+H+M > 0 per Watchdog records.',
              )
            }
          }
        } else {
          // [KI-24] Fallback: autoValidated but completedRecords empty — use shared tally validation.
          // See KnownIssues-Watchdog.md KI-24 for rationale.
          return validateTallyTermination(termination, ralph)
        }
      } else {
        // Legacy mode — use shared tally validation
        return validateTallyTermination(termination, ralph)
      }
      return ok()
    }

    case 'test_evidence': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      if (state.currentPhase < TEST_CODE_PHASE) {
        return fail(
          'Invalid phase for test evidence',
          `test_evidence requires the pipeline to be at phase ${TEST_CODE_PHASE} or later (currently at phase ${state.currentPhase}).`,
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
      // Tech Solution §D.2: loopType-aware validation
      const loopType = getLoopType(state, phase)
      if (loopType === 'ralph') {
        // Ralph phases: require ralphCompleted + no escalation
        if (!rec.ralphCompleted) {
          return fail(
            'Ralph loop not completed',
            `user_approval requires phase ${phase} ralph loop to be completed first.`,
          )
        }
        if (state.ralph?.escalated || rec.ralphTermination === 'escalated') {
          return fail(
            'Ralph loop escalated',
            `user_approval requires phase ${phase} ralph loop to have resolved without escalation. Current round was escalated.`,
          )
        }
      } else if (loopType === 'followup') {
        // Followup phases: skip ralphCompleted check, require phaseStatus=active
        if (state.phaseStatus !== 'active') {
          return fail(
            'Phase not active',
            `user_approval for followup phase ${phase} requires phase status to be active.`,
          )
        }
      } else {
        // Defensive: unknown loopType rejected
        return fail(
          'Unknown loop type',
          `Phase ${phase} has unknown loop type "${loopType}". Expected 'ralph' or 'followup'.`,
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

    case 'why_articulation': {
      if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
      const phase = payload.phase as number
      if (phase !== state.currentPhase) {
        return fail(
          'Phase mismatch',
          `why_articulation must target the current phase (${state.currentPhase}).`,
        )
      }
      if (state.phaseStatus !== 'active') {
        return fail(
          'Phase not active',
          'why_articulation can only be called when phase status is active.',
        )
      }
      const rec = state.phases[phase]
      if (!rec) {
        return fail(
          `Phase ${phase} not found`,
          `why_articulation requires phase ${phase} to have been entered.`,
        )
      }
      return ok()
    }

    default: {
      return fail('Unknown event', `Unrecognized event type: ${event}`)
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
      const totalPhases = typeof payload.totalPhases === 'number' && payload.totalPhases >= 1
        ? Math.floor(payload.totalPhases)
        : 5  // backward compat default
      // Tech Solution §D.2: inject loopPhaseMap/maxPhase from config
      const loopPhaseMap = (payload._loopPhaseMap as PhaseLoopMap | undefined) ?? {}
      const maxPhase = (payload._maxPhase as number | undefined) ?? totalPhases
      return {
        version: SCHEMA_VERSION,
        projectId: payload._projectId as string,
        runId: payload._runId as string,
        startedAt: now,
        description: payload.description as string,
        currentPhase: 0,
        phaseStatus: 'idle',
        totalPhases,
        loopPhaseMap,
        maxPhase,
        phases: {},
        ralph: null,
        testEvidenceConfirmed: false,
        lastCheckpointAt: now,
        ownerSessionId:
          payload._ownerSessionId !== undefined
            ? (payload._ownerSessionId as string)
            : undefined,
      }
    }

    case 'phase_enter': {
      if (state === null) {
        throw new Error('BUG: state must not be null for phase_enter')
      }
      const phase = payload.phase as number
      if (phase <= state.currentPhase) {
        throw new Error(`BUG: phase regression from ${state.currentPhase} to ${phase} — validateTransition should have caught this`)
      }
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
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
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
          roundRecords: [],
          autoValidated: false,
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
        P: number
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
        P: tally.P,
        L: tally.L,
        I: tally.I,
        timestamp: now,
      }

      // NOTE: consecutiveZero uses the legacy definition (C+H+M=0, P/L excluded).
      // Legacy path only — GPAV mode blocks ralph_round_complete at validate,
      // so this apply branch is unreachable when autoValidated=true.
      // ralph_terminate recomputes from roundRecords using the strict definition
      // (C+H+M=0, P/L excluded) when autoValidated=true.
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
          // re_raised or escalated: treat as re_raised in Phase 2
          // Phase 3 TODO (see KI-17/KI-49): when action === 'escalated',
          //   set state.ralph.escalated = true
          //   and state.ralph.escalatedAt = now to activate the user_approval safety gate.
          //   Also update RalphTermination handling in ralph_terminate validate.
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

    case 'ralph_round_finding': {
      if (state === null) {
        throw new Error('BUG: state must not be null for ralph_round_finding')
      }
      if (state.ralph === null) {
        throw new Error('BUG: ralph must not be null for ralph_round_finding')
      }
      const round = payload.round as number
      const findings = payload.findings as FindingSubmission[]

      // Compute counts from findings
      const counts = { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }
      for (const f of findings) {
        counts[f.severity]++
      }

      // Find or create round record
      // NOTE (KI-32): The merge branch (existingIdx >= 0) is currently unreachable through
      // validate→apply because validate enforces round === ralph.round + 1 (monotonic advance).
      // This is intentional — merge logic is pre-built for future multi-submit-per-round use
      // cases. When needed, relax validate to allow round === ralph.round in GPAV mode.
      const existingIdx = state.ralph.roundRecords.findIndex(r => r.round === round)
      let newRoundRecords: RoundRecord[]
      if (existingIdx >= 0) {
        // Append to existing record (multiple finding submissions per round)
        const existing = state.ralph.roundRecords[existingIdx]
        const merged = {
          ...existing,
          counts: {
            C: existing.counts.C + counts.C,
            H: existing.counts.H + counts.H,
            M: existing.counts.M + counts.M,
            P: existing.counts.P + counts.P,
            L: existing.counts.L + counts.L,
            I: existing.counts.I + counts.I,
          },
        }
        newRoundRecords = [...state.ralph.roundRecords]
        newRoundRecords[existingIdx] = merged
      } else {
        newRoundRecords = [
          ...state.ralph.roundRecords,
          { round, counts, submittedAt: now },
        ]
      }

      return {
        ...state,
        ralph: {
          ...state.ralph,
          round: Math.max(state.ralph.round, round),
          roundRecords: newRoundRecords,
          autoValidated: true,
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
      const loopType = getLoopType(state, phase)
      // Followup: transition from active → awaiting_approval
      // Ralph: phaseStatus is already 'awaiting_approval' (set by ralph_terminate)
      const newPhaseStatus = loopType === 'followup' ? 'awaiting_approval' : state.phaseStatus
      return {
        ...state,
        phaseStatus: newPhaseStatus,
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

    case 'why_articulation': {
      if (state === null) {
        throw new Error('BUG: state must not be null for why_articulation')
      }
      const phase = payload.phase as number
      const existingRec = state.phases[phase]
      const articulationVerified = payload._articulationVerified === true
      const articulationDimensions = articulationVerified
        ? (payload._articulationDimensions as PhaseRecord['articulationDimensions'])
        : undefined

      return {
        ...state,
        phases: {
          ...state.phases,
          [phase]: {
            ...existingRec,
            articulationAttempted: true,
            articulationVerified: articulationVerified || existingRec.articulationVerified,
            articulationDimensions,
            articulationDegraded:
              existingRec.articulationDegraded === true ||
              payload._articulationDegraded === true,
            // Note: _articulationFailureCount is always provided by CheckpointHandler.
            // The fallback to existingRec.articulationFailures exists only for type safety.
            articulationFailures:
              (payload._articulationFailureCount as number | undefined)
                ?? (existingRec.articulationFailures ?? 0),
          },
        },
        lastCheckpointAt: now,
      }
    }

    default: {
      // Should never reach here if validateTransition runs first
      throw new Error(`BUG: applyTransition received unrecognized event: ${event}`)
    }
  }
}

// Phase 3: pipeline nesting transition validation
//
// Valid transition table for pipeline nesting state machine.
// The table encodes which (fromStatus, toStatus) pairs are legal.
// States: idle, active, ralph_loop, awaiting_approval, complete, suspended, paused, failed, cancelled.
//
// Key semantics:
// - active/ralph_loop/awaiting_approval can transition to suspended (child pipeline)
// - active/ralph_loop can transition to paused (user intervention)
// - suspended can resume to preSuspendStatus (active or ralph_loop)
// - paused can resume to prePauseStatus (active or ralph_loop)
// - ralph_loop/active/awaiting_approval/suspended can fail (phase_fail)
// - active/ralph_loop/suspended can be cancelled
// - idle/complete/paused CANNOT be cancelled (no active work to cancel, or paused needs user first)
const NESTING_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  active: new Set(['suspended', 'paused', 'failed', 'cancelled']),
  ralph_loop: new Set(['suspended', 'paused', 'failed', 'cancelled']),
  awaiting_approval: new Set(['suspended', 'failed']),
  suspended: new Set(['active', 'ralph_loop', 'failed', 'cancelled']),
  paused: new Set(['active', 'ralph_loop']),
}

export function validateNestingTransition(
  fromStatus: string,
  toStatus: string,
): ValidationResult {
  // #54 special case: undefined/invalid fromStatus → 'active' is a recovery
  // scenario where preSuspendStatus is missing or corrupt. Default to 'active'
  // with a warning so callers can log the recovery.
  if (fromStatus === undefined || fromStatus === null) {
    if (toStatus === 'active' || toStatus === 'ralph_loop') {
      return {
        valid: true,
        warning: 'preSuspendStatus invalid or missing, defaulting to active',
      }
    }
    return fail(
      'Invalid source status',
      `Cannot transition from undefined to ${toStatus}.`,
    )
  }

  const allowed = NESTING_TRANSITIONS[fromStatus]
  if (allowed && allowed.has(toStatus)) {
    return ok()
  }

  return fail(
    'Invalid nesting transition',
    `Cannot transition from '${fromStatus}' to '${toStatus}'.`,
  )
}
