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
    totalPhases: 5,
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
    roundRecords: [],
    autoValidated: false,
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

  it('accepts phase_enter with phase=6 (dynamic phase count)', () => {
    const state = {
      ...makeState({ totalPhases: 7 }),
      currentPhase: 5,
      phaseStatus: 'complete' as const,
      phases: {
        ...makeState().phases,
        5: {
          phase: 5,
          enteredAt: '2025-01-01T00:00:00Z',
          ralphCompleted: true,
          ralphTermination: 'gate_pass' as const,
          userApproved: true,
          approvedAt: '2025-01-01T01:00:00Z',
          articulationAttempted: false,
          articulationVerified: false,
          articulationDegraded: false,
          articulationFailures: 0,
        },
      },
    }
    const result = validateTransition('phase_enter', basePayload({ phase: 6 }), state)
    expect(result.valid).toBe(true)
  })

  it('rejects phase_enter with phase exceeding totalPhases', () => {
    const result = validateTransition('phase_enter', basePayload({ phase: 6 }), makeState())
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Phase exceeds pipeline total')
      expect(result.guidance).toContain('exceeds pipeline total of 5')
    }
  })

  it('rejects phase_enter with phase=-1', () => {
    const result = validateTransition('phase_enter', basePayload({ phase: -1 }), makeState())
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
      expect(result.violation).toMatch(/^(Invalid tally|Missing required field)/)
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

  it('rejects ralph_round_complete with empty contested_resolutions when openContested is non-empty', () => {
    const state = makeRalphState({}, {
      openContested: [
        { id: 'M-1', firstContestedRound: 1, disputeRounds: 0, description: 'issue' },
      ],
    })
    const result = validateTransition(
      'ralph_round_complete',
      basePayload({
        phase: 1, round: 2,
        tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
        contested_resolutions: [],
      }),
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

  it('pipeline_start with totalPhases stores it in state', () => {
    const newState = applyTransition(
      'pipeline_start',
      basePayload({ description: '7-phase project', _runId: 'run-7p', _projectId: 'proj-7p', totalPhases: 7 }),
      null,
    )
    expect(newState.totalPhases).toBe(7)
  })

  it('pipeline_start without totalPhases defaults to 5', () => {
    const newState = applyTransition(
      'pipeline_start',
      basePayload({ description: 'legacy project', _runId: 'run-5p', _projectId: 'proj-5p' }),
      null,
    )
    expect(newState.totalPhases).toBe(5)
  })

  it('pipeline_start with non-integer totalPhases is rejected in validation', () => {
    const result = validateTransition(
      'pipeline_start',
      { description: 'bad totalPhases', totalPhases: 'abc' },
      null,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid totalPhases')
    }
  })

  it('pipeline_start with totalPhases=0 is rejected in validation', () => {
    const result = validateTransition(
      'pipeline_start',
      { description: 'zero phases', totalPhases: 0 },
      null,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid totalPhases')
    }
  })

  it('pipeline_start with totalPhases=-1 is rejected in validation', () => {
    const result = validateTransition(
      'pipeline_start',
      { description: 'negative phases', totalPhases: -1 },
      null,
    )
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Invalid totalPhases')
    }
  })

  it('pipeline_start with totalPhases=1 creates single-phase pipeline', () => {
    const newState = applyTransition(
      'pipeline_start',
      basePayload({ description: 'single phase', _runId: 'run-f', _projectId: 'proj-f', totalPhases: 1 }),
      null,
    )
    expect(newState.totalPhases).toBe(1)
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
  it('runs the complete 5-phase pipeline (default totalPhases) with correct state at each step', () => {
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

  // ── Regression: why_articulation failure preserves existing articulationVerified ──
  describe('why_articulation preserves verified state on failure', () => {
    it('failed articulation retry does NOT regress articulationVerified from true to false', () => {
      const state = makeState({
        currentPhase: 1,
        phaseStatus: 'active',
        phases: {
          1: {
            phase: 1,
            enteredAt: NOW,
            ralphCompleted: false,
            ralphTermination: null,
            userApproved: false,
            approvedAt: null,
            articulationAttempted: true,
            articulationVerified: true,
            articulationDegraded: false,
            articulationFailures: 0,
          },
        },
      })
      // Simulate a failed retry — _articulationVerified is absent (undefined)
      const result = applyTransition('why_articulation', {
        phase: 1,
        articulation_text: 'Bad text',
        _articulationVerified: undefined,
        _articulationDimensions: { what_it_protects: false, key_risks: false, why_approach_works: false },
        _articulationDegraded: false,
        _articulationFailureCount: 1,
        _now: NOW,
      }, state)
      // articulationVerified MUST be preserved from the existing PhaseRecord
      expect(result.phases[1].articulationVerified).toBe(true)
    })

    it('new_contested rejects IDs that conflict with existing openContested', () => {
      const state = makeState({
        currentPhase: 1,
        phaseStatus: 'ralph_loop',
        ralph: {
          phase: 1,
          round: 2,
          consecutiveZero: 0,
          tallyHistory: [{ round: 1, C: 0, H: 0, M: 0, L: 0, I: 0 }],
          openContested: [{ id: 'issue-42', description: 'existing issue', firstContestedRound: 1, disputeRounds: 0 }],
          escalated: false,
          escalatedAt: null,
          termination: null,
        },
        phases: {
          1: {
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
          },
        },
      })
      const result = validateTransition('ralph_round_complete', {
        phase: 1,
        round: 3,
        tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
        contested_resolutions: [],
        new_contested: [{ id: 'issue-42', description: 'duplicate ID' }],
      }, state)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.guidance).toMatch(/conflicts with an existing open contested issue/)
      }
    })
  })
})

// ── Part F: Phase 2.1 GPAV (Gate Pass Auto-Validation) ────────────────────────

describe('Phase 2.1 GPAV — ralph_round_finding', () => {
  it('TC-G-01: accepts valid findings for current round', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        { severity: 'M', description: 'code quality issue' },
      ],
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-02: rejects findings without ralph loop', () => {
    const state = makeState({ currentPhase: 1, phaseStatus: 'active' })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 1,
      findings: [{ severity: 'M', description: 'issue' }],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Not in ralph loop')
    }
  })

  it('TC-G-03: rejects findings with wrong phase', () => {
    const state = makeRalphState({ currentPhase: 1 }, { phase: 1, round: 2 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 2, round: 3,
      findings: [{ severity: 'M', description: 'issue' }],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Phase mismatch')
    }
  })

  it('TC-G-04: rejects findings with wrong round', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 5,  // should be 2
      findings: [{ severity: 'M', description: 'issue' }],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Round mismatch')
    }
  })

  it('TC-G-05: rejects findings with invalid severity', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'X', description: 'issue' }],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Invalid severity')
    }
  })

  it('TC-G-06: rejects downgrade without reason (AC-G5)', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        { severity: 'M', description: 'downgraded from H', original: 'H' },
      ],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('downgrade_reason')
    }
  })

  it('TC-G-07: accepts downgrade with reason (AC-G5)', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        {
          severity: 'M', description: 'downgraded from H',
          original: 'H', downgrade_reason: 'false positive — test covers this',
        },
      ],
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-07b: accepts upgrade without reason (C→C is no change)', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        { severity: 'H', description: 'kept at H', original: 'H' },
      ],
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-07c: accepts upgrade (M→H) without reason', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        { severity: 'H', description: 'upgraded from M', original: 'M' },
      ],
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-08: rejects empty findings array', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Missing findings')
    }
  })

  it('TC-G-09: rejects finding with missing description', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'M' }],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Missing description')
    }
  })

  it('TC-G-10: rejects finding with empty description', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'M', description: '' }],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Missing description')
    }
  })
})

describe('Phase 2.1 GPAV — ralph_round_finding apply', () => {
  it('TC-G-11: accumulates counts and sets autoValidated=true', () => {
    const state = makeRalphState({}, { round: 1 })
    const newState = applyTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        { severity: 'M', description: 'issue 1' },
        { severity: 'L', description: 'issue 2' },
        { severity: 'I', description: 'info 1' },
      ],
    }), state)
    expect(newState.ralph!.autoValidated).toBe(true)
    expect(newState.ralph!.roundRecords).toHaveLength(1)
    expect(newState.ralph!.roundRecords[0].round).toBe(2)
    expect(newState.ralph!.roundRecords[0].counts).toEqual({ C: 0, H: 0, M: 1, L: 1, I: 1 })
  })

  it('TC-G-12: merges multiple submissions for same round', () => {
    const state = makeRalphState({}, {
      round: 1,
      roundRecords: [{ round: 2, counts: { C: 0, H: 0, M: 1, L: 0, I: 0 }, submittedAt: NOW }],
      autoValidated: true,
    })
    const newState = applyTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'L', description: 'another issue' }],
    }), state)
    expect(newState.ralph!.roundRecords).toHaveLength(1)
    expect(newState.ralph!.roundRecords[0].counts).toEqual({ C: 0, H: 0, M: 1, L: 1, I: 0 })
  })

  it('TC-G-13: adds new round record when round changes', () => {
    const state = makeRalphState({}, {
      round: 2,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
      ],
      autoValidated: true,
    })
    const newState = applyTransition('ralph_round_finding', basePayload({
      phase: 1, round: 3,
      findings: [{ severity: 'M', description: 'found issue' }],
    }), state)
    expect(newState.ralph!.roundRecords).toHaveLength(3)
    expect(newState.ralph!.roundRecords[2].round).toBe(3)
    expect(newState.ralph!.roundRecords[2].counts.M).toBe(1)
  })
})

describe('Phase 2.1 GPAV — ralph_round_complete with autoValidated', () => {
  it('TC-G-14: rejects when no roundRecord for round', () => {
    const state = makeRalphState({}, {
      round: 1,
      autoValidated: true,
      roundRecords: [],
    })
    const result = validateTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('No findings submitted for round')
    }
  })

  it('TC-G-15: accepts when roundRecord matches tally', () => {
    const state = makeRalphState({}, {
      round: 1,
      autoValidated: true,
      roundRecords: [{ round: 2, counts: { C: 0, H: 0, M: 1, L: 0, I: 0 }, submittedAt: NOW }],
    })
    const result = validateTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 0, M: 1, L: 0, I: 0 },
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-16: rejects when agent tally mismatches Watchdog records', () => {
    const state = makeRalphState({}, {
      round: 1,
      autoValidated: true,
      roundRecords: [{ round: 2, counts: { C: 0, H: 0, M: 1, L: 0, I: 0 }, submittedAt: NOW }],
    })
    const result = validateTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },  // agent claims 0M but WD recorded 1M
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Tally mismatch')
    }
  })

  it('TC-G-17: legacy mode (autoValidated=false) ignores roundRecords', () => {
    const state = makeRalphState({}, {
      round: 1,
      autoValidated: false,
      roundRecords: [],
    })
    const result = validateTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), state)
    expect(result.valid).toBe(true)
  })
})

describe('Phase 2.1 GPAV — ralph_terminate with autoValidated', () => {
  it('TC-G-18: early_stop with 2 strict consecutive zeros (AC-G2)', () => {
    const state = makeRalphState({}, {
      round: 6,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 1, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-19: early_stop rejected when L=1 in last round (AC-G2 strict)', () => {
    const state = makeRalphState({}, {
      round: 6,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, L: 1, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('consecutive zero rounds')
    }
  })

  it('TC-G-20: gate_pass with zero C/H/M/L in last record', () => {
    const state = makeRalphState({}, {
      round: 5,
      autoValidated: true,
      tallyHistory: [
        { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 2, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 3, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 4, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 5, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
      roundRecords: [
        { round: 1, counts: { C: 1, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 4, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 5, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-21: gate_pass rejected when L>0 in last record (GPAV strict)', () => {
    const state = makeRalphState({}, {
      round: 5,
      autoValidated: true,
      tallyHistory: [
        { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 2, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 3, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 4, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 5, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 4, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 5, counts: { C: 0, H: 0, M: 0, L: 1, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Unresolved issues remain (GPAV)')
    }
  })

  it('TC-G-22: legacy mode uses tallyHistory (unchanged behavior)', () => {
    const state = makeRalphState({}, {
      round: 5,
      autoValidated: false,
      tallyHistory: [
        { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 2, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 3, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 4, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 5, C: 0, H: 0, M: 0, L: 1, I: 0, timestamp: NOW },
      ],
    })
    // Legacy mode: L=1 is fine for gate_pass (only checks C+H+M)
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-23: max_rounds with GPAV checks C+H+M+L>0', () => {
    const state = makeRalphState({}, {
      round: 10,
      autoValidated: true,
      tallyHistory: Array.from({ length: 10 }, (_, i) => ({
        round: i + 1, C: 0, H: 0, M: 0, L: 1, I: 0, timestamp: NOW,
      })),
      roundRecords: Array.from({ length: 10 }, (_, i) => ({
        round: i + 1, counts: { C: 0, H: 0, M: 0, L: 1, I: 0 }, submittedAt: NOW,
      })),
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'max_rounds',
    }), state)
    expect(result.valid).toBe(true)
  })

  it('TC-G-24: max_rounds rejected when all zero in GPAV mode', () => {
    const state = makeRalphState({}, {
      round: 10,
      autoValidated: true,
      tallyHistory: Array.from({ length: 10 }, (_, i) => ({
        round: i + 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW,
      })),
      roundRecords: Array.from({ length: 10 }, (_, i) => ({
        round: i + 1, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW,
      })),
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'max_rounds',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('No unresolved issues (GPAV)')
    }
  })
})

describe('Phase 2.1 GPAV — migration', () => {
  it('TC-G-25: ralph_loop_start creates empty roundRecords and autoValidated=false', () => {
    const state = applyTransition('ralph_loop_start', basePayload({ phase: 1 }),
      makeState({ currentPhase: 1, phaseStatus: 'active', phases: { 1: { phase: 1, enteredAt: NOW, ralphCompleted: false, ralphTermination: null, userApproved: false, approvedAt: null, articulationAttempted: false, articulationVerified: false, articulationDegraded: false, articulationFailures: 0 } } }))
    expect(state.ralph).not.toBeNull()
    expect(state.ralph!.roundRecords).toEqual([])
    expect(state.ralph!.autoValidated).toBe(false)
  })

  it('TC-G-33: gate_pass rejects when uncommitted clean round masks dirty completed round (H-1 regression)', () => {
    // Exploit: round 5 has C=1, but agent submitted round 6 findings (clean) without
    // completing round 6. Without the fix, terminate would see round 6's clean record
    // and accept gate_pass despite round 5 having unresolved issues.
    const state = makeRalphState({}, {
      round: 5,
      autoValidated: true,
      tallyHistory: [
        { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 2, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 3, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 4, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 5, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 4, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 5, counts: { C: 1, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        // Uncommitted round 6 — submitted via ralph_round_finding but not yet completed
        { round: 6, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Unresolved issues remain (GPAV)')
    }
  })

  it('TC-G-34: early_stop ignores uncommitted round in consecutive count (H-1 regression)', () => {
    // Rounds 4-5 are completed and clean. Round 6 submitted but not completed.
    // strictConsecutive should be 2 (rounds 4-5), not 3 (rounds 4-6).
    const state = makeRalphState({}, {
      round: 5,
      autoValidated: true,
      tallyHistory: [
        { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 2, C: 0, H: 0, M: 1, L: 0, I: 0, timestamp: NOW },
        { round: 3, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 4, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
        { round: 5, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: NOW },
      ],
      roundRecords: [
        { round: 1, counts: { C: 1, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 1, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 4, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 5, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
        // Uncommitted round 6 — should not inflate count
        { round: 6, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    // Completed rounds 3-5: 3 consecutive zeros → passes (>= 2)
    expect(result.valid).toBe(true)
  })
})

describe('Phase 2.1 GPAV — edge cases', () => {
  it('TC-G-26: rejects ralph_round_finding with null state', () => {
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 1,
      findings: [{ severity: 'M', description: 'issue' }],
    }), null)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('No active pipeline run for this project.')
    }
  })

  it('TC-G-27: rejects ralph_round_finding with findings=null', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: null,
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Missing findings')
    }
  })

  it('TC-G-28: rejects ralph_round_finding with findings=string', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: 'not an array',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toBe('Missing findings')
    }
  })

  it('TC-G-29: rejects ralph_round_finding with findings containing null element', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [null],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Invalid finding at index 0')
    }
  })

  it('TC-G-30: rejects ralph_round_finding with findings containing number', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [42],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('Invalid finding at index 0')
    }
  })

  it('TC-G-30b: accepts findings for round 1 when ralph.round=0', () => {
    const state = makeRalphState({}, { round: 0, tallyHistory: [] })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 1,
      findings: [{ severity: 'I', description: 'info' }],
    }), state)
    expect(result.valid).toBe(true)
  })
})

describe('Phase 2.1 GPAV — full pipeline flow (M-2)', () => {
  it('TC-G-31: complete GPAV pipeline — findings → rounds → gate_pass', () => {
    const phaseRec = {
      phase: 1, enteredAt: NOW, ralphCompleted: false, ralphTermination: null,
      userApproved: false, approvedAt: null, articulationAttempted: false,
      articulationVerified: false, articulationDegraded: false, articulationFailures: 0,
    }

    // pipeline_start
    let state = applyTransition('pipeline_start', basePayload({
      description: 'GPAV test', _projectId: 'test', _runId: 'run-gpav',
    }), null)
    expect(state.phaseStatus).toBe('idle')

    // phase_enter(1)
    state = applyTransition('phase_enter', basePayload({ phase: 1 }), state)
    expect(state.phaseStatus).toBe('active')

    // ralph_loop_start
    state = applyTransition('ralph_loop_start', basePayload({ phase: 1 }), state)
    expect(state.phaseStatus).toBe('ralph_loop')
    expect(state.ralph!.autoValidated).toBe(false)
    expect(state.ralph!.roundRecords).toEqual([])

    // Round 1: submit findings + complete
    state = applyTransition('ralph_round_finding', basePayload({
      phase: 1, round: 1,
      findings: [{ severity: 'M', description: 'code quality issue' }],
    }), state)
    expect(state.ralph!.autoValidated).toBe(true)
    expect(state.ralph!.roundRecords).toHaveLength(1)
    expect(state.ralph!.roundRecords[0].counts.M).toBe(1)

    state = applyTransition('ralph_round_complete', basePayload({
      phase: 1, round: 1,
      tally: { C: 0, H: 0, M: 1, L: 0, I: 0 },
    }), state)
    expect(state.ralph!.round).toBe(1)

    // Round 2: submit findings + complete (2x M this time)
    state = applyTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        { severity: 'M', description: 'issue A' },
        { severity: 'M', description: 'issue B' },
      ],
    }), state)
    expect(state.ralph!.roundRecords).toHaveLength(2)

    state = applyTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 0, M: 2, L: 0, I: 0 },
    }), state)

    // Rounds 3-5: zero findings each
    for (let r = 3; r <= 5; r++) {
      state = applyTransition('ralph_round_finding', basePayload({
        phase: 1, round: r,
        findings: [{ severity: 'I', description: 'clean round' }],
      }), state)
      state = applyTransition('ralph_round_complete', basePayload({
        phase: 1, round: r,
        tally: { C: 0, H: 0, M: 0, L: 0, I: 1 },
      }), state)
    }
    expect(state.ralph!.round).toBe(5)
    expect(state.ralph!.roundRecords).toHaveLength(5)
    // Rounds 3-5: C=H=M=L=0, I=1 → strict consecutive = 3

    // ralph_terminate(gate_pass)
    state = applyTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(state.phaseStatus).toBe('awaiting_approval')
    expect(state.ralph!.termination).toBe('gate_pass')

    // user_approval
    state = applyTransition('user_approval', basePayload({ phase: 1 }), state)
    expect(state.phases[1].userApproved).toBe(true)

    // phase_complete
    state = applyTransition('phase_complete', basePayload({ phase: 1 }), state)
    expect(state.phaseStatus).toBe('complete')
    expect(state.ralph).toBeNull()
  })

  it('TC-G-32: GPAV early_stop with 2 consecutive strict zero rounds', () => {
    const phaseRec = {
      phase: 1, enteredAt: NOW, ralphCompleted: false, ralphTermination: null,
      userApproved: false, approvedAt: null, articulationAttempted: false,
      articulationVerified: false, articulationDegraded: false, articulationFailures: 0,
    }

    let state = applyTransition('pipeline_start', basePayload({
      description: 'GPAV early_stop test', _projectId: 'test', _runId: 'run-gpav-es',
    }), null)
    state = applyTransition('phase_enter', basePayload({ phase: 1 }), state)
    state = applyTransition('ralph_loop_start', basePayload({ phase: 1 }), state)

    // Rounds 1-2: have issues
    for (let r = 1; r <= 2; r++) {
      state = applyTransition('ralph_round_finding', basePayload({
        phase: 1, round: r,
        findings: [{ severity: 'M', description: 'issue' }],
      }), state)
      state = applyTransition('ralph_round_complete', basePayload({
        phase: 1, round: r,
        tally: { C: 0, H: 0, M: 1, L: 0, I: 0 },
      }), state)
    }

    // Rounds 3-4: zero (C=H=M=L=0, only I findings)
    for (let r = 3; r <= 4; r++) {
      state = applyTransition('ralph_round_finding', basePayload({
        phase: 1, round: r,
        findings: [{ severity: 'I', description: 'clean' }],
      }), state)
      state = applyTransition('ralph_round_complete', basePayload({
        phase: 1, round: r,
        tally: { C: 0, H: 0, M: 0, L: 0, I: 1 },
      }), state)
    }

    // Verify early_stop passes (2 consecutive strict zeros)
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    expect(result.valid).toBe(true)
  })
})
