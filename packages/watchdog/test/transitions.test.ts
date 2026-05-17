import { describe, it, expect } from 'vitest'
import { validateTransition, applyTransition } from '../src/transitions.js'
import { SCHEMA_VERSION } from '../src/schema.js'
import type { PipelineState, RalphLoopState, PhaseRecord } from '../src/schema.js'
import { MAX_RALPH_ROUNDS, MIN_GATE_ROUNDS, EARLY_STOP_CONSECUTIVE } from '../src/constants.js'

function makeState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    version: SCHEMA_VERSION,
    projectId: 'abc12345',
    runId: 'run-001',
    startedAt: '2026-01-01T00:00:00.000Z',
    description: 'test feature',
    currentPhase: 0,
    phaseStatus: 'idle',
    phases: {},
    ralph: null,
    testEvidenceConfirmed: false,
    lastCheckpointAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeRalphState(
  overrides: Partial<PipelineState> = {},
  ralphOverrides: Partial<RalphLoopState> = {},
): PipelineState {
  const baseRalph: RalphLoopState = {
    phase: 1,
    round: 1,
    consecutiveZero: 0,
    tallyHistory: [
      { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
    ],
    openContested: [],
    escalated: false,
    escalatedAt: null,
    termination: null,
    ...ralphOverrides,
  }

  return makeState({
    currentPhase: 1,
    phaseStatus: 'ralph_loop',
    ralph: baseRalph,
    phases: {
      1: {
        phase: 1,
        enteredAt: '2026-01-01T00:00:00.000Z',
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
    ...overrides,
  })
}

const NOW = '2026-01-01T00:00:00.000Z'

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { _now: NOW, ...overrides }
}

// ── Part A: Payload validation ──────────────────────────────────────────────

describe('payload validation', () => {
  it('rejects pipeline_start with missing description', () => {
    const result = validateTransition('pipeline_start', basePayload(), makeState())
    expect(result.valid).toBe(false)
    if (!result.valid) {
      // §9 spec: "Missing required field"
      expect(result.violation).toBe('Missing required field')
    }
  })

  it('rejects pipeline_start with empty string description', () => {
    const result = validateTransition('pipeline_start', basePayload({ description: '' }), makeState())
    expect(result.valid).toBe(false)
    if (!result.valid) {
      // §9 spec: same category as missing — "Missing required field"
      expect(result.violation).toBe('Missing required field')
    }
  })

  it('rejects phase_enter with phase=0', () => {
    const result = validateTransition('phase_enter', basePayload({ phase: 0 }), makeState())
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid phase number')
    }
  })

  it('rejects phase_enter with phase=6', () => {
    const result = validateTransition('phase_enter', basePayload({ phase: 6 }), makeState())
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid phase number')
    }
  })

  it('rejects phase_enter with phase=1.5', () => {
    const result = validateTransition('phase_enter', basePayload({ phase: 1.5 }), makeState())
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid phase number')
    }
  })

  it('rejects ralph_round_complete with missing tally', () => {
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2 }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toMatch(/^Invalid tally/)
    }
  })

  it('rejects ralph_round_complete with tally.C="abc"', () => {
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2, tally: { C: 'abc', H: 0, M: 0, L: 0, I: 0 } }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      // §9 spec: "Invalid tally field type"
      expect(result.violation).toBe('Invalid tally field type')
    }
  })

  it('rejects ralph_round_complete with tally missing M field', () => {
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2, tally: { C: 0, H: 0, L: 0, I: 0 } }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      // §9 spec: "Missing required field"
      expect(result.violation).toBe('Missing required field')
    }
  })

  it('rejects ralph_round_complete with round=-1', () => {
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: -1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid round number')
    }
  })

  it('rejects ralph_round_complete with round=0.5', () => {
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 0.5, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid round number')
    }
  })

  it('rejects ralph_terminate with invalid termination type', () => {
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'invalid' }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid termination type')
    }
  })

  it('rejects test_evidence with phase=3', () => {
    const result = validateTransition(
      'test_evidence',
      basePayload({ phase: 3, evidence_file: 'evidence.md' }),
      makeState({ currentPhase: 4 }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid phase for test evidence')
    }
  })

  it('rejects test_evidence with missing evidence_file', () => {
    const result = validateTransition(
      'test_evidence',
      basePayload({ phase: 4 }),
      makeState({ currentPhase: 4 }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Missing or invalid evidence_file')
    }
  })
})

// ── Part B: State precondition tests ────────────────────────────────────────

describe('state preconditions', () => {
  it('rejects phase_enter(1) when state is null', () => {
    const result = validateTransition('phase_enter', basePayload({ phase: 1 }), null)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('No active pipeline run for this project.')
    }
  })

  it('rejects phase_enter(1) when phaseStatus is active (pipeline already started)', () => {
    const result = validateTransition(
      'phase_enter',
      basePayload({ phase: 1 }),
      makeState({ phaseStatus: 'active' }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      // §9 spec: "Pipeline already active"
      expect(result.violation).toBe('Pipeline already active')
    }
  })

  it('rejects phase_enter(2) when phase 1 is not userApproved', () => {
    const result = validateTransition(
      'phase_enter',
      basePayload({ phase: 2 }),
      makeState({
        phaseStatus: 'complete',
        phases: {
        1: {
          phase: 1,
          enteredAt: NOW,
          ralphCompleted: true,
          ralphTermination: 'gate_pass',
          userApproved: false,
          approvedAt: null,
          articulationAttempted: false,
          articulationVerified: false,
          articulationDegraded: false,
          articulationFailures: 0,
        },
        },
      }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Phase 1 not yet complete')
    }
  })

  it('rejects phase_enter(2) when phase 1 approved but phaseStatus != complete', () => {
    const result = validateTransition(
      'phase_enter',
      basePayload({ phase: 2 }),
      makeState({
        phaseStatus: 'awaiting_approval',
        phases: {
          1: {
            phase: 1,
            enteredAt: NOW,
            ralphCompleted: true,
            ralphTermination: 'gate_pass',
            userApproved: true,
            approvedAt: NOW,
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
          },
        },
      }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Previous phase not completed')
    }
  })

  it('allows phase_enter(5) without testEvidenceConfirmed (v1.8: gate is Ralph loop only)', () => {
    const result = validateTransition(
      'phase_enter',
      basePayload({ phase: 5 }),
      makeState({
        phaseStatus: 'complete',
        testEvidenceConfirmed: false,
        phases: {
          4: {
            phase: 4,
            enteredAt: NOW,
            ralphCompleted: true,
            ralphTermination: 'gate_pass',
            userApproved: true,
            approvedAt: NOW,
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
          },
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('rejects ralph_loop_start when currentPhase != phase', () => {
    const result = validateTransition(
      'ralph_loop_start',
      basePayload({ phase: 2 }),
      makeState({ currentPhase: 1, phaseStatus: 'active' }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Phase mismatch')
    }
  })

  it('rejects ralph_loop_start when phaseStatus != active', () => {
    const result = validateTransition(
      'ralph_loop_start',
      basePayload({ phase: 1 }),
      makeState({ currentPhase: 1, phaseStatus: 'idle' }),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Phase not active')
    }
  })

  it('rejects ralph_round_complete when round skips', () => {
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 3, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Round skipping not allowed')
    }
  })

  it('rejects ralph_round_complete when openContested non-empty but no contested_resolutions', () => {
    const state = makeRalphState({}, {
      openContested: [
        { id: 'M-1', firstContestedRound: 1, disputeRounds: 0, description: 'issue' },
      ],
    })
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
      state,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Missing contested_resolutions')
    }
  })

  it('rejects ralph_terminate(gate_pass) when round < MIN_GATE_ROUNDS', () => {
    const state = makeRalphState({}, {
      round: MIN_GATE_ROUNDS - 1,
      tallyHistory: [
        { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'gate_pass' }),
      state,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Insufficient rounds for gate pass')
    }
  })

  it('rejects ralph_terminate(gate_pass) when last tally has C > 0', () => {
    const state = makeRalphState({}, {
      round: MIN_GATE_ROUNDS,
      tallyHistory: [
        { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'gate_pass' }),
      state,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Unresolved issues remain')
    }
  })

  it('rejects ralph_terminate(early_stop) when consecutiveZero < EARLY_STOP_CONSECUTIVE', () => {
    const state = makeRalphState({}, {
      round: 2,
      consecutiveZero: EARLY_STOP_CONSECUTIVE - 1,
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'early_stop' }),
      state,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Insufficient consecutive zero rounds')
    }
  })

  it('rejects ralph_terminate(max_rounds) when round < MAX_RALPH_ROUNDS', () => {
    const state = makeRalphState({}, {
      round: MAX_RALPH_ROUNDS - 1,
      tallyHistory: [
        { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'max_rounds' }),
      state,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Insufficient rounds for max_rounds termination')
    }
  })

  it('rejects ralph_terminate(max_rounds) when last tally C+H+M = 0', () => {
    const state = makeRalphState({}, {
      round: MAX_RALPH_ROUNDS,
      tallyHistory: [
        { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'max_rounds' }),
      state,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('No unresolved issues')
    }
  })

  it('rejects user_approval when ralph not completed', () => {
    const result = validateTransition(
      'user_approval',
      basePayload({ phase: 1 }),
      makeRalphState(),
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Ralph loop not completed')
    }
  })

  // ── M5: ralphTermination === 'escalated' also blocks user_approval ─────
  it('rejects user_approval when ralphTermination is escalated (even if ralph.escalated is false)', () => {
    const state = makeRalphState({}, {
      termination: 'gate_pass',
    })
    // ralphCompleted but ralphTermination === 'escalated' on the phase record
    const phases = {
      ...state.phases,
      1: { ...state.phases[1], ralphCompleted: true, ralphTermination: 'escalated' as const },
    }
    const result = validateTransition(
      'user_approval',
      basePayload({ phase: 1 }),
      { ...state, phases, phaseStatus: 'awaiting_approval', ralph: { ...state.ralph!, escalated: false } },
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Ralph loop escalated')
    }
  })

  it('rejects phase_complete when not user-approved', () => {
    const state = makeRalphState({}, {
      termination: 'gate_pass',
    })
    // Update phase record to have ralphCompleted but not userApproved
    const phases = {
      ...state.phases,
      1: { ...state.phases[1], ralphCompleted: true },
    }
    const result = validateTransition(
      'phase_complete',
      basePayload({ phase: 1 }),
      { ...state, phases, phaseStatus: 'awaiting_approval' },
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Phase not user-approved')
    }
  })

  it('rejects phase_complete when phaseStatus != awaiting_approval', () => {
    const state = makeRalphState({}, {
      termination: 'gate_pass',
    })
    const phases = {
      ...state.phases,
      1: { ...state.phases[1], ralphCompleted: true, userApproved: true, approvedAt: NOW },
    }
    const result = validateTransition(
      'phase_complete',
      basePayload({ phase: 1 }),
      { ...state, phases, phaseStatus: 'ralph_loop' },
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Phase not awaiting approval')
    }
  })
})

// ── Part C: Happy path tests ────────────────────────────────────────────────

describe('happy path', () => {
  it('accepts pipeline_start even with existing state', () => {
    const result = validateTransition(
      'pipeline_start',
      basePayload({ description: 'new run' }),
      makeState(),
    )
    expect(result.valid).toBe(true)
  })

  it('accepts phase_enter(1) when phaseStatus is idle', () => {
    const result = validateTransition(
      'phase_enter',
      basePayload({ phase: 1 }),
      makeState({ phaseStatus: 'idle' }),
    )
    expect(result.valid).toBe(true)
  })

  it('accepts phase_enter(2) when phase 1 is userApproved and phaseStatus is complete', () => {
    const result = validateTransition(
      'phase_enter',
      basePayload({ phase: 2 }),
      makeState({
        phaseStatus: 'complete',
        phases: {
          1: {
            phase: 1,
            enteredAt: NOW,
            ralphCompleted: true,
            ralphTermination: 'gate_pass',
            userApproved: true,
            approvedAt: NOW,
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
          },
        },
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('accepts ralph_loop_start when currentPhase matches and phaseStatus is active', () => {
    const result = validateTransition(
      'ralph_loop_start',
      basePayload({ phase: 1 }),
      makeState({ currentPhase: 1, phaseStatus: 'active' }),
    )
    expect(result.valid).toBe(true)
  })

  it('accepts ralph_round_complete with correct round sequence', () => {
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
      makeRalphState(),
    )
    expect(result.valid).toBe(true)
  })

  it('accepts ralph_terminate(gate_pass) when round >= MIN_GATE_ROUNDS and last tally C+H+M = 0', () => {
    const state = makeRalphState({}, {
      round: MIN_GATE_ROUNDS,
      tallyHistory: [
        { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'gate_pass' }),
      state,
    )
    expect(result.valid).toBe(true)
  })

  it('accepts ralph_terminate(early_stop) when consecutiveZero >= EARLY_STOP_CONSECUTIVE', () => {
    const state = makeRalphState({}, {
      round: 2,
      consecutiveZero: EARLY_STOP_CONSECUTIVE,
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'early_stop' }),
      state,
    )
    expect(result.valid).toBe(true)
  })

  it('accepts ralph_terminate(max_rounds) when round >= MAX_RALPH_ROUNDS and last tally C+H+M > 0', () => {
    const state = makeRalphState({}, {
      round: MAX_RALPH_ROUNDS,
      tallyHistory: [
        { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
    })
    const result = validateTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'max_rounds' }),
      state,
    )
    expect(result.valid).toBe(true)
  })

  it('accepts test_evidence when currentPhase >= 4', () => {
    const result = validateTransition(
      'test_evidence',
      basePayload({ phase: 4, evidence_file: 'evidence.md' }),
      makeState({ currentPhase: 4 }),
    )
    expect(result.valid).toBe(true)
  })

  it('accepts user_approval when ralphCompleted is true', () => {
    const state = makeRalphState({}, {
      termination: 'gate_pass',
    })
    const phases = {
      ...state.phases,
      1: { ...state.phases[1], ralphCompleted: true },
    }
    const result = validateTransition(
      'user_approval',
      basePayload({ phase: 1 }),
      { ...state, phases, phaseStatus: 'awaiting_approval' },
    )
    expect(result.valid).toBe(true)
  })

  it('accepts phase_complete when userApproved and phaseStatus is awaiting_approval', () => {
    const state = makeRalphState({}, {
      termination: 'gate_pass',
    })
    const phases = {
      ...state.phases,
      1: {
        ...state.phases[1],
        ralphCompleted: true,
        userApproved: true,
        approvedAt: NOW,
      },
    }
    const result = validateTransition(
      'phase_complete',
      basePayload({ phase: 1 }),
      { ...state, phases, phaseStatus: 'awaiting_approval' },
    )
    expect(result.valid).toBe(true)
  })
})

// ── Part D: applyTransition state mutation tests ────────────────────────────

describe('applyTransition', () => {
  it('pipeline_start creates state with currentPhase=0, phaseStatus=idle, uses _runId and _now', () => {
    const newState = applyTransition(
      'pipeline_start',
      basePayload({ description: 'test desc', _runId: 'run-xyz', _projectId: 'proj-123' }),
      null,
    )
    expect(newState.currentPhase).toBe(0)
    expect(newState.phaseStatus).toBe('idle')
    expect(newState.runId).toBe('run-xyz')
    expect(newState.projectId).toBe('proj-123')
    expect(newState.description).toBe('test desc')
    expect(newState.startedAt).toBe(NOW)
    expect(newState.lastCheckpointAt).toBe(NOW)
    expect(newState.ralph).toBeNull()
    expect(newState.testEvidenceConfirmed).toBe(false)
    expect(newState.phases).toEqual({})
  })

  it('phase_enter(1) sets currentPhase=1, phaseStatus=active, creates PhaseRecord', () => {
    const state = makeState({ phaseStatus: 'idle' })
    const newState = applyTransition('phase_enter', basePayload({ phase: 1 }), state)
    expect(newState.currentPhase).toBe(1)
    expect(newState.phaseStatus).toBe('active')
    expect(newState.phases[1]).toEqual({
      phase: 1,
      enteredAt: NOW,
      ralphCompleted: false,
      ralphTermination: null,
      userApproved: false,
      approvedAt: null,
        articulationAttempted: false,
        articulationVerified: false,
        articulationDegraded: false,
        articulationFailures: 0,
    })
    expect(newState.lastCheckpointAt).toBe(NOW)
  })

  it('ralph_loop_start sets phaseStatus=ralph_loop and creates RalphLoopState with round=0', () => {
    const state = makeState({ currentPhase: 1, phaseStatus: 'active' })
    const newState = applyTransition('ralph_loop_start', basePayload({ phase: 1 }), state)
    expect(newState.phaseStatus).toBe('ralph_loop')
    expect(newState.ralph).not.toBeNull()
    expect(newState.ralph!.round).toBe(0)
    expect(newState.ralph!.consecutiveZero).toBe(0)
    expect(newState.ralph!.tallyHistory).toEqual([])
    expect(newState.ralph!.openContested).toEqual([])
    expect(newState.ralph!.escalated).toBe(false)
    expect(newState.lastCheckpointAt).toBe(NOW)
  })

  it('ralph_round_complete increments round, appends tally, updates consecutiveZero', () => {
    const state = makeRalphState()
    const newState = applyTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 1, I: 0 } }),
      state,
    )
    expect(newState.ralph!.round).toBe(2)
    expect(newState.ralph!.tallyHistory).toHaveLength(2)
    expect(newState.ralph!.tallyHistory[1]).toEqual({
      round: 2,
      C: 0,
      H: 0,
      M: 0,
      L: 1,
      I: 0,
      timestamp: NOW,
    })
    expect(newState.ralph!.consecutiveZero).toBe(1)
    expect(newState.lastCheckpointAt).toBe(NOW)
  })

  it('ralph_round_complete with C+H+M=0 increments consecutiveZero, with C>0 resets to 0', () => {
    const state1 = makeRalphState({}, { consecutiveZero: 1 })
    const newState1 = applyTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 1, I: 0 } }),
      state1,
    )
    expect(newState1.ralph!.consecutiveZero).toBe(2)

    const state2 = makeRalphState({}, { consecutiveZero: 2 })
    const newState2 = applyTransition(
      'ralph_round_complete',
      basePayload({ phase: 1, round: 2, tally: { C: 1, H: 0, M: 0, L: 0, I: 0 } }),
      state2,
    )
    expect(newState2.ralph!.consecutiveZero).toBe(0)
  })

  it('ralph_round_complete handles contested_resolutions: accepted removes, re_raised increments disputeRounds', () => {
    const state = makeRalphState({}, {
      openContested: [
        { id: 'M-1', firstContestedRound: 1, disputeRounds: 0, description: 'issue one' },
        { id: 'M-2', firstContestedRound: 1, disputeRounds: 1, description: 'issue two' },
      ],
    })
    const newState = applyTransition(
      'ralph_round_complete',
      basePayload({
        phase: 1,
        round: 2,
        tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
        contested_resolutions: [
          { id: 'M-1', action: 'accepted' },
          { id: 'M-2', action: 're_raised' },
        ],
      }),
      state,
    )
    expect(newState.ralph!.openContested).toHaveLength(1)
    expect(newState.ralph!.openContested[0].id).toBe('M-2')
    expect(newState.ralph!.openContested[0].disputeRounds).toBe(2)
  })

  it('ralph_round_complete carries forward unmentioned contested issues (disputeRounds +1)', () => {
    const state = makeRalphState({}, {
      openContested: [
        { id: 'M-1', firstContestedRound: 1, disputeRounds: 0, description: 'issue one' },
        { id: 'M-2', firstContestedRound: 1, disputeRounds: 2, description: 'issue two' },
      ],
    })
    const newState = applyTransition(
      'ralph_round_complete',
      basePayload({
        phase: 1,
        round: 2,
        tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
        contested_resolutions: [{ id: 'M-1', action: 'accepted' }],
      }),
      state,
    )
    expect(newState.ralph!.openContested).toHaveLength(1)
    expect(newState.ralph!.openContested[0].id).toBe('M-2')
    expect(newState.ralph!.openContested[0].disputeRounds).toBe(3)
  })

  it('ralph_round_complete adds new_contested issues', () => {
    const state = makeRalphState()
    const newState = applyTransition(
      'ralph_round_complete',
      basePayload({
        phase: 1,
        round: 2,
        tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
        new_contested: [
          { id: 'M-3', description: 'new issue' },
        ],
      }),
      state,
    )
    expect(newState.ralph!.openContested).toHaveLength(1)
    expect(newState.ralph!.openContested[0]).toEqual({
      id: 'M-3',
      firstContestedRound: 2,
      disputeRounds: 0,
      description: 'new issue',
    })
  })

  it('ralph_terminate sets phaseStatus=awaiting_approval, ralphCompleted=true, ralphTermination', () => {
    const state = makeRalphState()
    const newState = applyTransition(
      'ralph_terminate',
      basePayload({ phase: 1, termination: 'gate_pass' }),
      state,
    )
    expect(newState.phaseStatus).toBe('awaiting_approval')
    expect(newState.ralph!.termination).toBe('gate_pass')
    expect(newState.phases[1].ralphCompleted).toBe(true)
    expect(newState.phases[1].ralphTermination).toBe('gate_pass')
    expect(newState.lastCheckpointAt).toBe(NOW)
  })

  it('test_evidence sets testEvidenceConfirmed=true', () => {
    const state = makeState({ currentPhase: 4 })
    const newState = applyTransition(
      'test_evidence',
      basePayload({ phase: 4, evidence_file: 'evidence.md' }),
      state,
    )
    expect(newState.testEvidenceConfirmed).toBe(true)
    expect(newState.lastCheckpointAt).toBe(NOW)
  })

  it('user_approval sets userApproved=true and approvedAt=now', () => {
    const state = makeState({
      currentPhase: 1,
      phases: {
        1: {
          phase: 1,
          enteredAt: NOW,
          ralphCompleted: true,
          ralphTermination: 'gate_pass',
          userApproved: true,
          approvedAt: NOW,
          articulationAttempted: false,
          articulationVerified: false,
          articulationDegraded: false,
          articulationFailures: 0,
        },
      },
    })
    const newState = applyTransition('user_approval', basePayload({ phase: 1 }), state)
    expect(newState.phases[1].userApproved).toBe(true)
    expect(newState.phases[1].approvedAt).toBe(NOW)
    expect(newState.lastCheckpointAt).toBe(NOW)
  })

  it('phase_complete sets phaseStatus=complete and ralph=null', () => {
    const state = makeState({
      currentPhase: 1,
      phaseStatus: 'awaiting_approval',
      ralph: { phase: 1, round: 5, consecutiveZero: 0, tallyHistory: [], openContested: [], escalated: false, escalatedAt: null, termination: 'gate_pass' },
      phases: {
          1: {
            phase: 1,
            enteredAt: NOW,
            ralphCompleted: true,
            ralphTermination: 'gate_pass',
            userApproved: true,
            approvedAt: NOW,
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
          },
      },
    })
    const newState = applyTransition('phase_complete', basePayload({ phase: 1 }), state)
    expect(newState.phaseStatus).toBe('complete')
    expect(newState.ralph).toBeNull()
    expect(newState.lastCheckpointAt).toBe(NOW)
  })
})

// ── Part E: Full pipeline happy path ────────────────────────────────────────

describe('full pipeline flow', () => {
  it('runs the complete 5-phase pipeline with correct state at each step', () => {
    let state: PipelineState | null = null

    // 1. pipeline_start
    state = applyTransition(
      'pipeline_start',
      basePayload({ description: 'full pipeline test', _runId: 'run-full', _projectId: 'proj-full' }),
      null,
    )
    expect(state.currentPhase).toBe(0)
    expect(state.phaseStatus).toBe('idle')
    expect(state.runId).toBe('run-full')

    // Helper to run a phase through ralph loop, approval, and completion
    function runPhase(
      phase: number,
      rounds: number,
      termination: 'gate_pass' | 'early_stop' | 'max_rounds',
      finalTally: { C: number; H: number; M: number; L: number; I: number },
    ) {
      // phase_enter
      state = applyTransition('phase_enter', basePayload({ phase }), state)
      expect(state!.currentPhase).toBe(phase)
      expect(state!.phaseStatus).toBe('active')
      expect(state!.phases[phase]).toBeDefined()
      expect(state!.phases[phase].enteredAt).toBe(NOW)

      // ralph_loop_start
      state = applyTransition('ralph_loop_start', basePayload({ phase }), state)
      expect(state!.phaseStatus).toBe('ralph_loop')
      expect(state!.ralph).not.toBeNull()
      expect(state!.ralph!.round).toBe(0)

      // ralph rounds
      for (let r = 1; r <= rounds; r++) {
        const isLast = r === rounds
        const tally = isLast
          ? finalTally
          : { C: 0, H: 0, M: 0, L: 0, I: 0 }
        state = applyTransition(
          'ralph_round_complete',
          basePayload({ phase, round: r, tally }),
          state,
        )
        expect(state!.ralph!.round).toBe(r)
        expect(state!.ralph!.tallyHistory).toHaveLength(r)
      }

      // ralph_terminate
      state = applyTransition(
        'ralph_terminate',
        basePayload({ phase, termination }),
        state,
      )
      expect(state!.phaseStatus).toBe('awaiting_approval')
      expect(state!.ralph!.termination).toBe(termination)
      expect(state!.phases[phase].ralphCompleted).toBe(true)

      // If phase 4, submit test evidence before approval
      if (phase === 4) {
        state = applyTransition(
          'test_evidence',
          basePayload({ phase: 4, evidence_file: 'test-evidence.md' }),
          state,
        )
        expect(state!.testEvidenceConfirmed).toBe(true)
      }

      // user_approval
      state = applyTransition('user_approval', basePayload({ phase }), state)
      expect(state!.phases[phase].userApproved).toBe(true)
      expect(state!.phases[phase].approvedAt).toBe(NOW)

      // phase_complete
      state = applyTransition('phase_complete', basePayload({ phase }), state)
      expect(state!.phaseStatus).toBe('complete')
      expect(state!.ralph).toBeNull()
    }

    // Phase 1: gate_pass after 5 rounds
    runPhase(1, MIN_GATE_ROUNDS, 'gate_pass', { C: 0, H: 0, M: 0, L: 0, I: 0 })

    // Phase 2: early_stop after 2 rounds
    runPhase(2, EARLY_STOP_CONSECUTIVE, 'early_stop', { C: 0, H: 0, M: 0, L: 0, I: 0 })

    // Phase 3: max_rounds after 10 rounds (last tally must have C+H+M > 0)
    runPhase(3, MAX_RALPH_ROUNDS, 'max_rounds', { C: 1, H: 0, M: 0, L: 0, I: 0 })

    // Phase 4: gate_pass after 5 rounds + test evidence
    runPhase(4, MIN_GATE_ROUNDS, 'gate_pass', { C: 0, H: 0, M: 0, L: 0, I: 0 })
    expect(state!.testEvidenceConfirmed).toBe(true)

    // Phase 5: gate_pass after 5 rounds
    runPhase(5, MIN_GATE_ROUNDS, 'gate_pass', { C: 0, H: 0, M: 0, L: 0, I: 0 })

    // Final state assertions
    expect(state!.currentPhase).toBe(5)
    expect(state!.phaseStatus).toBe('complete')
    expect(Object.keys(state!.phases)).toHaveLength(5)
    for (let p = 1; p <= 5; p++) {
      expect(state!.phases[p].userApproved).toBe(true)
      expect(state!.phases[p].ralphCompleted).toBe(true)
    }
    expect(state!.ralph).toBeNull()
    expect(state!.testEvidenceConfirmed).toBe(true)
  })

  // ── M5: currentPhase guard for user_approval and phase_complete ──

  // ── SC-4: phase_enter initializes articulation fields with defaults ───
  describe('SC-4: phase_enter PhaseRecord includes articulation defaults (§8.4)', () => {
    it('phase_enter(1) creates PhaseRecord with articulationAttempted=false', () => {
      const state = makeState({ currentPhase: 0, phaseStatus: 'idle' })
      const next = applyTransition('phase_enter', { phase: 1, _now: NOW }, state)
      const rec = next.phases[1]
      expect(rec).toHaveProperty('articulationAttempted', false)
    })

    it('phase_enter(1) creates PhaseRecord with articulationVerified=false', () => {
      const state = makeState({ currentPhase: 0, phaseStatus: 'idle' })
      const next = applyTransition('phase_enter', { phase: 1, _now: NOW }, state)
      const rec = next.phases[1]
      expect(rec).toHaveProperty('articulationVerified', false)
    })

    it('phase_enter(1) creates PhaseRecord with articulationDegraded=false', () => {
      const state = makeState({ currentPhase: 0, phaseStatus: 'idle' })
      const next = applyTransition('phase_enter', { phase: 1, _now: NOW }, state)
      const rec = next.phases[1]
      expect(rec).toHaveProperty('articulationDegraded', false)
    })
  })

  describe('currentPhase guard (M5)', () => {
    it('user_approval rejects when phase does not match currentPhase', () => {
      const state = makeState({
        currentPhase: 3,
        phaseStatus: 'awaiting_approval',
        phases: {
          3: { phase: 3, enteredAt: NOW, ralphCompleted: true, ralphTermination: 'gate_pass', userApproved: false, approvedAt: null, articulationAttempted: false, articulationVerified: false, articulationDegraded: false, articulationFailures: 0 },
          1: { phase: 1, enteredAt: NOW, ralphCompleted: true, ralphTermination: 'gate_pass', userApproved: true, approvedAt: NOW, articulationAttempted: false, articulationVerified: false, articulationDegraded: false, articulationFailures: 0 },
        },
      })
      const result = validateTransition('user_approval', { phase: 1 }, state)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.violation).toMatch(/wrong phase.*current is 3.*got 1/i)
      }
    })

    it('phase_complete rejects when phase does not match currentPhase', () => {
      const state = makeState({
        currentPhase: 3,
        phaseStatus: 'awaiting_approval',
        phases: {
          3: { phase: 3, enteredAt: NOW, ralphCompleted: true, ralphTermination: 'gate_pass', userApproved: true, approvedAt: NOW, articulationAttempted: false, articulationVerified: false, articulationDegraded: false, articulationFailures: 0 },
          1: { phase: 1, enteredAt: NOW, ralphCompleted: true, ralphTermination: 'gate_pass', userApproved: true, approvedAt: NOW, articulationAttempted: false, articulationVerified: false, articulationDegraded: false, articulationFailures: 0 },
        },
      })
      const result = validateTransition('phase_complete', { phase: 1 }, state)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.violation).toMatch(/wrong phase.*current is 3.*got 1/i)
      }
    })
  })
})
