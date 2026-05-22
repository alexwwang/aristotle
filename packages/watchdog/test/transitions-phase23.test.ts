import { describe, it, expect } from 'vitest'
import { validateTransition, applyTransition } from '../src/transitions.js'
import { normalizeSeverities } from '../src/checkpoint.js'
import { SCHEMA_VERSION } from '../src/schema.js'
import type { PipelineState, RalphLoopState } from '../src/schema.js'
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
      { round: 1, C: 1, H: 0, M: 0, P: 0, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
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

describe('Phase 2.3 — P Severity Addition', () => {
  // ── TC-03: ralph_round_finding with severity 'P' accepted ─────────────────
  it('TC-03 (AC-1): ralph_round_finding with severity P accepted', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'P', description: 'suggestion' }],
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-04: ralph_round_finding with severity 'M' still accepted ───────────
  it('TC-04 (AC-3): ralph_round_finding with severity M still accepted', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'M', description: 'medium issue' }],
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-05: severity 'M₂' normalized to P and accepted ─────────────────────
  it("TC-05 (AC-2): severity 'M₂' (Unicode) normalized to P and accepted", () => {
    const state = makeRalphState({}, { round: 1 })
    const payload = {
      phase: 1, round: 2,
      findings: [{ severity: '\u004D\u2082', description: 'suggestion' }],
    }
    normalizeSeverities('ralph_round_finding', payload)
    const vResult = validateTransition('ralph_round_finding', basePayload(payload), state)
    expect(vResult.valid).toBe(true)

    const newState = applyTransition('ralph_round_finding', basePayload(payload), state)
    expect(newState.ralph!.roundRecords[0].counts.P).toBe(1)
  })

  // ── TC-06: severity 'M2' (ASCII) normalized to P ──────────────────────────
  it("TC-06 (AC-2): severity 'M2' (ASCII) normalized to P", () => {
    const state = makeRalphState({}, { round: 1 })
    const payload = {
      phase: 1, round: 2,
      findings: [{ severity: 'M2', description: 'suggestion' }],
    }
    normalizeSeverities('ralph_round_finding', payload)
    const vResult = validateTransition('ralph_round_finding', basePayload(payload), state)
    expect(vResult.valid).toBe(true)

    const newState = applyTransition('ralph_round_finding', basePayload(payload), state)
    expect(newState.ralph!.roundRecords[0].counts.P).toBe(1)
  })

  // ── TC-07: severity 'M₁' (Unicode) normalized to M ────────────────────────
  it("TC-07 (AC-2): severity 'M₁' (Unicode) normalized to M", () => {
    const state = makeRalphState({}, { round: 1 })
    const payload = {
      phase: 1, round: 2,
      findings: [{ severity: '\u004D\u2081', description: 'medium issue' }],
    }
    normalizeSeverities('ralph_round_finding', payload)
    const vResult = validateTransition('ralph_round_finding', basePayload(payload), state)
    expect(vResult.valid).toBe(true)

    const newState = applyTransition('ralph_round_finding', basePayload(payload), state)
    const counts = newState.ralph!.roundRecords[0].counts
    expect(counts.M).toBe(1)
    expect(counts.P).toBe(0)
  })

  // ── TC-08: severity 'M1' (ASCII) normalized to M ──────────────────────────
  it("TC-08 (AC-2): severity 'M1' (ASCII) normalized to M", () => {
    const state = makeRalphState({}, { round: 1 })
    const payload = {
      phase: 1, round: 2,
      findings: [{ severity: 'M1', description: 'medium issue' }],
    }
    normalizeSeverities('ralph_round_finding', payload)
    const vResult = validateTransition('ralph_round_finding', basePayload(payload), state)
    expect(vResult.valid).toBe(true)

    const newState = applyTransition('ralph_round_finding', basePayload(payload), state)
    expect(newState.ralph!.roundRecords[0].counts.M).toBe(1)
  })

  // ── TC-09: original field also normalized (validate-only) ────────────────
  it("TC-09 (AC-2): original field 'M₁' normalized to M for validSeverities (M→P downgrade w/ reason accepted)", () => {
    const state = makeRalphState({}, { round: 1 })
    const payload = {
      phase: 1, round: 2,
      findings: [{ severity: 'P', original: '\u004D\u2081', downgrade_reason: 'reclassified', description: 'suggestion' }],
    }
    normalizeSeverities('ralph_round_finding', payload)
    const result = validateTransition('ralph_round_finding', basePayload(payload), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-11: M finding resets strictConsecutive counter via GPAV path ──────
  it('TC-11 (AC-5): M finding in latest round resets strictConsecutive (early_stop rejected)', () => {
    // Setup: 2 prior zero-C/H/M rounds (would normally permit early_stop),
    // then a 3rd round with M=1 that breaks the streak.
    const state = makeRalphState({}, {
      round: 3,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 1, P: 0, L: 0, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      // strictConsecutive computed from tail: round 3 has M=1 → break immediately, count=0
      expect(result.violation).toContain('consecutive')
    }
  })

  // ── TC-26: original 'M₂' normalized through full apply pipeline ──────────
  it("TC-26 (AC-2): original 'M₂' normalized end-to-end (validate + apply), counts.P incremented", () => {
    const state = makeRalphState({}, { round: 1 })
    const payload = {
      phase: 1, round: 2,
      findings: [{ severity: '\u004D\u2082', original: '\u004D\u2082', description: 'suggestion' }],
    }
    normalizeSeverities('ralph_round_finding', payload)
    const vResult = validateTransition('ralph_round_finding', basePayload(payload), state)
    expect(vResult.valid).toBe(true)
    const newState = applyTransition('ralph_round_finding', basePayload(payload), state)
    expect(newState.ralph!.roundRecords[0].counts.P).toBe(1)
    expect(newState.ralph!.roundRecords[0].counts.M).toBe(0)
  })

  // ── TC-12: gate_pass with C=0,H=0,M=0,P=2,L=3 accepted ────────────────────
  it('TC-12 (AC-6): gate_pass with C=0,H=0,M=0,P=2,L=3 accepted', () => {
    const state = makeRalphState({}, {
      round: MIN_GATE_ROUNDS,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, P: 0, L: 1, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, P: 0, L: 1, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 0, P: 0, L: 1, I: 0 }, submittedAt: NOW },
        { round: 4, counts: { C: 0, H: 0, M: 0, P: 0, L: 1, I: 0 }, submittedAt: NOW },
        { round: 5, counts: { C: 0, H: 0, M: 0, P: 2, L: 3, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-13: max_rounds with C=0,H=0,M=0,P=3,L=2 rejected ───────────────────
  it('TC-13 (AC-7): max_rounds with C=0,H=0,M=0,P=3,L=2 rejected', () => {
    const state = makeRalphState({}, {
      round: MAX_RALPH_ROUNDS,
      autoValidated: true,
      roundRecords: [
        ...Array.from({ length: MAX_RALPH_ROUNDS - 1 }, (_, i) => ({
          round: i + 1,
          counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 },
          submittedAt: NOW,
        })),
        {
          round: MAX_RALPH_ROUNDS,
          counts: { C: 0, H: 0, M: 0, P: 3, L: 2, I: 0 },
          submittedAt: NOW,
        },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'max_rounds',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('No unresolved issues')
    }
  })

  // ── TC-14: early_stop with 2 consecutive zero-C/H/M rounds accepted ───────
  it('TC-14 (AC-8): early_stop with 2 consecutive zero-C/H/M rounds accepted', () => {
    const state = makeRalphState({}, {
      round: 2,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, P: 3, L: 2, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, P: 3, L: 2, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-15: gate_pass with M=1,P=0 rejected ────────────────────────────────
  it('TC-15: gate_pass with M=1,P=0 rejected', () => {
    const state = makeRalphState({}, {
      round: MIN_GATE_ROUNDS,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 4, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 5, counts: { C: 0, H: 0, M: 1, P: 0, L: 0, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(result.valid).toBe(false)
  })

  // ── TC-16: 2 M + 1 P → counts {M:2, P:1} ──────────────────────────────────
  it('TC-16 (AC-9): 2 M + 1 P counts correctly', () => {
    const state = makeRalphState({}, { round: 1 })
    const newState = applyTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [
        { severity: 'M', description: 'a' },
        { severity: 'M', description: 'b' },
        { severity: 'P', description: 'c' },
      ],
    }), state)
    expect(newState.ralph!.roundRecords[0].counts).toEqual({ C: 0, H: 0, M: 2, P: 1, L: 0, I: 0 })
  })

  // ── TC-17: M→P without downgrade_reason rejected ──────────────────────────
  it('TC-17 (AC-10): M→P without downgrade_reason rejected', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'P', original: 'M', description: 'test' }],
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation).toContain('downgrade_reason')
    }
  })

  // ── TC-18: M→P with downgrade_reason accepted ─────────────────────────────
  it('TC-18 (AC-11): M→P with downgrade_reason accepted', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'P', original: 'M', downgrade_reason: 'reclassified', description: 'test' }],
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-19: H→P without downgrade_reason rejected ──────────────────────────
  it('TC-19: H→P without downgrade_reason rejected', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'P', original: 'H', description: 'test' }],
    }), state)
    expect(result.valid).toBe(false)
  })

  // ── TC-20: P→M without downgrade_reason accepted (upgrade) ────────────────
  it('TC-20: P→M without downgrade_reason accepted (upgrade)', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'M', original: 'P', description: 'test' }],
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-24: ralph_round_complete with zero P-level findings → P:0 stored ──
  it('TC-24 (AC-14): ralph_round_complete with P:0 preserves all six counts', () => {
    const state = makeRalphState({}, {
      autoValidated: false,
      round: 1,
    })
    const newState = applyTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 1, M: 2, P: 0, L: 0, I: 0 },
    }), state)
    const lastTally = newState.ralph!.tallyHistory[newState.ralph!.tallyHistory.length - 1]
    expect(lastTally.P).toBe(0)
    expect(lastTally.M).toBe(2)
  })

  // ── TC-29: ralph_round_complete payload without P key → rejected ──────────
  it('TC-29 (AC-16): ralph_round_complete payload missing P key is rejected', () => {
    const state = makeRalphState({}, {
      autoValidated: false,
      round: 1,
    })
    const result = validateTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 1, M: 2, L: 0, I: 0 },
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation.toLowerCase()).toMatch(/tally|missing|format/)
    }
  })

  // ── TC-25: Full pipeline with Unicode 'M₂' → stored as ASCII 'P' ──────────
  it('TC-25 (AC-15): Full pipeline with Unicode M₂ stored as ASCII P', () => {
    const state = makeRalphState({}, { round: 1 })
    const payload = {
      phase: 1, round: 2,
      findings: [{ severity: '\u004D\u2082', description: 'suggestion' }],
    }
    normalizeSeverities('ralph_round_finding', payload)
    const newState = applyTransition('ralph_round_finding', basePayload(payload), state)
    const rr = newState.ralph!.roundRecords[0]
    expect(rr.counts.P).toBe(1)
    expect(Object.keys(rr.counts)).not.toContain('\u004D\u2082')
    expect(rr.counts.M).toBe(0)
  })

  // ── TC-27: Unknown severity 'X' rejected ──────────────────────────────────
  it("TC-27: Unknown severity 'X' rejected", () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'X', description: 'test' }],
    }), state)
    expect(result.valid).toBe(false)
  })

  // ── TC-28: P with empty description rejected ──────────────────────────────
  it('TC-28: P with empty description rejected', () => {
    const state = makeRalphState({}, { round: 1 })
    const result = validateTransition('ralph_round_finding', basePayload({
      phase: 1, round: 2,
      findings: [{ severity: 'P', description: '' }],
    }), state)
    expect(result.valid).toBe(false)
  })

  // ── TC-31: P-only round → consecutive counter still increments ─────────────
  it('TC-31 (AC-4): P-only round increments strictConsecutive (early_stop accepted after 2 such rounds)', () => {
    const state = makeRalphState({}, {
      round: 2,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, P: 3, L: 2, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, P: 2, L: 0, I: 1 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-32: Mixed C=1, P=2 round → counter resets (C>0) ─────────────────────
  it('TC-32 (AC-5): Mixed findings with C=1 reset strictConsecutive', () => {
    const state = makeRalphState({}, {
      round: 3,
      autoValidated: true,
      roundRecords: [
        { round: 1, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 2, counts: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }, submittedAt: NOW },
        { round: 3, counts: { C: 1, H: 0, M: 0, P: 2, L: 0, I: 0 }, submittedAt: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'early_stop',
    }), state)
    expect(result.valid).toBe(false)
  })

  // ── TC-33: ralph_round_complete forbidden in GPAV mode ─────────────────────
  it('TC-33 (AC-14 negative): ralph_round_complete with autoValidated=true is rejected', () => {
    const state = makeRalphState({}, { round: 1, autoValidated: true })
    const result = validateTransition('ralph_round_complete', basePayload({
      phase: 1,
      round: 2,
      tally: { C: 0, H: 0, M: 0, P: 1, L: 0, I: 0 },
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation.toLowerCase()).toMatch(/gpav|forbidden|autovalidated/)
    }
  })

  // ── TC-34: KI-24 fallback path excludes L/P from zero-checks ───────────────
  it('TC-34 (AC-6/F-18 regression): KI-24 fallback path correctly excludes L and P from gate_pass zero-check', () => {
    const state = makeRalphState({}, {
      round: MIN_GATE_ROUNDS,
      autoValidated: true,
      roundRecords: [],
      tallyHistory: [
        { round: 1, C: 0, H: 0, M: 0, P: 2, L: 3, I: 0, timestamp: NOW },
        { round: 2, C: 0, H: 0, M: 0, P: 1, L: 2, I: 0, timestamp: NOW },
        { round: 3, C: 0, H: 0, M: 0, P: 3, L: 1, I: 0, timestamp: NOW },
        { round: 4, C: 0, H: 0, M: 0, P: 2, L: 2, I: 0, timestamp: NOW },
        { round: 5, C: 0, H: 0, M: 0, P: 1, L: 3, I: 0, timestamp: NOW },
      ],
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'gate_pass',
    }), state)
    expect(result.valid).toBe(true)
  })

  // ── TC-35: Legacy path — single P-only round increments consecutiveZero ──
  it('TC-35 (AC-4): Legacy ralph_round_complete with P-only tally increments consecutiveZero (does NOT reset)', () => {
    // Setup: non-GPAV (autoValidated=false), consecutiveZero=1 from a prior zero round.
    // Submit a P-only round via ralph_round_complete and verify counter increments to 2.
    const state = makeRalphState({}, {
      round: 1,
      autoValidated: false,
      consecutiveZero: 1,
    })
    const newState = applyTransition('ralph_round_complete', basePayload({
      phase: 1, round: 2,
      tally: { C: 0, H: 0, M: 0, P: 3, L: 2, I: 0 },
    }), state)
    expect(newState.ralph!.consecutiveZero).toBe(2)
  })

  // ── TC-36: KI-24 fallback path — max_rounds correctly rejects when all clean ─
  it('TC-36 (F-4 regression): KI-24 fallback with C=H=M=0 but P/L>0 → max_rounds rejected as "No unresolved issues"', () => {
    // Setup: autoValidated=true, empty roundRecords forces fallback to tallyHistory.
    // Last tallyHistory entry has C=H=M=0 (clean) but P>0 L>0.
    // max_rounds should be REJECTED because there are no unresolved C/H/M (wrong termination type).
    const state = makeRalphState({}, {
      round: MAX_RALPH_ROUNDS,
      autoValidated: true,
      roundRecords: [],
      tallyHistory: Array.from({ length: MAX_RALPH_ROUNDS }, (_, i) => ({
        round: i + 1, C: 0, H: 0, M: 0, P: 2, L: 1, I: 0, timestamp: NOW,
      })),
    })
    const result = validateTransition('ralph_terminate', basePayload({
      phase: 1, termination: 'max_rounds',
    }), state)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.violation.toLowerCase()).toMatch(/unresolved|resolved/)
    }
  })

  // ── TC-37: normalizeSeverities is no-op for non-ralph_round_finding events ─
  it('TC-37 (F-2 guard): normalizeSeverities skips non-ralph_round_finding events', () => {
    const payload = {
      phase: 1, round: 1,
      tally: { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 },
      findings: [{ severity: '\u004D\u2082', description: 'should not be normalized' }],
    }
    const original = JSON.parse(JSON.stringify(payload))
    normalizeSeverities('ralph_round_complete', payload)
    expect(payload).toEqual(original)
  })
})
