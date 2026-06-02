# Test Plan: Phase 2.3 — P Severity Addition

**Version**: 2.16
**Status**: Phase 5 🟢 GATE PASSED (R1+R2 consecutive zero C/H/M, 479/479 tests pass, 1 line business code + defensive guards)
**Based On**: Phase2.3-P-Severity-Addition-Requirements.md (18 ACs, 12 Constraints), Phase2.3-P-Severity-Addition-TechnicalSolution.md (C1–C11)
**Phase 1 Baseline**: 430 tests passing (23 test files in packages/watchdog)

---

## Test File Structure

All Phase 2.3 tests go in new files (separate from Phase 1 baseline):
- `test/transitions-phase23.test.ts` — pure transition function tests (AC-1 through AC-11, AC-14, AC-15, AC-16)
- `test/pipeline-store-phase23.test.ts` — state persistence tests (AC-12, AC-13, AC-17)

Existing test files need adaptation (Phase 5.5):
- 188 sites across test files (primarily `transitions.test.ts`) updating M severity references to include P

> **Note**: TC numbering reflects authoring history. TC-10 was removed (redundant), TC-30 was never assigned. TC-21c/21d/21e were added during Phase 5 code review regression fixes. TC-37 was added as a defensive guard. TC-38..TC-44, TC-21g are planned Phase 4 implementations. TC-21 sub-variants (b/c/d/e) are independent `it()` blocks testing distinct corruption types; they share the TC-21 prefix because they all exercise the readState migration path. In coverage matrices, "TC-21" refers to the entire migration test family.

---

## Core Scenarios & Key Functional Points

> **Relationship**: Core Scenarios (§1) map user-facing behavior (US/AC) to test cases. Key Functional Points (§2) map technical design components (C1–C11) to test cases. Together they form a two-dimensional coverage matrix: Core Scenarios ensure all requirements are tested (horizontal completeness), Key Functional Points ensure all design elements are exercised (vertical completeness). A single TC may appear in both tables when it covers both a requirement and a design element (e.g., TC-26 covers AC-15 in Core Scenarios and C3 in Key Functional Points).

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (US/AC) | Derived Functional Points | Test Cases |
|---|--------------|----------------|--------------------------|------------|
| 1 | P severity accepted and counted | US-1 / AC-1, AC-3 | SEV_ORDER update (Key), severity validation (Key) | TC-03, TC-04 |
| 2 | Unicode/ASCII severity normalization | US-1 / AC-2 | normalizeSeverities function (Key), event-type guard (Key) | TC-05, TC-06, TC-07, TC-08, TC-09, TC-26, TC-37 (event-type guard only) |
| 3 | P/L excluded from consecutive-zero counter | US-2 / AC-4, AC-5 | Terminate validation P/L exclusion (Key) | TC-31, TC-32, TC-35, TC-11 |
| 4 | Terminate validation with P severity | US-2 / AC-6, AC-7, AC-8 | gate_pass, max_rounds, early_stop (Key) | TC-12, TC-13, TC-14, TC-15 |
| 5 | Count aggregation separates M and P | US-1 / AC-9 | RoundRecord.counts structure (Key) | TC-16 |
| 6 | Downgrade validation for M→P | US-1 / AC-10, AC-11 | SEV_ORDER downgrade check (Key) | TC-17, TC-18, TC-19, TC-20 |
| 7 | Pre-v4 state migration adds P:0 | US-3 / AC-12, AC-17 | readState migration (Key), defensive null guards (Key) | TC-21, TC-21b, TC-21c, TC-21d, TC-21e |
| 8 | Version gate for forward compatibility | US-3 / AC-13 | SCHEMA_VERSION bump + version gate (Key) | TC-22, TC-23 |
| 9 | ralph_round_complete payload with P | US-3 / AC-14, US-1 / AC-16 | Tally schema enforcement (Key) | TC-24, TC-29, TC-33 |
| 10 | End-to-end normalization pipeline | US-1 / AC-15 | Validate+apply shared normalization (Key) | TC-25, TC-26 |

### Secondary Scenarios (from Phase 1 — priority: secondary)

| # | Secondary Scenario | Source (US/AC) | Derived Functional Points | Test Cases |
|---|--------------------|----------------|--------------------------|------------|
| 1 | TDD protocol file terminology cleanup | US-1 / AC-18 | C11 grep verification (Peripheral) | Non-code verification |

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source (Component/Interface/Failure Mode) | Test Cases |
|---|---------------------|------------------------------------------|------------|
| 1 | SEV_ORDER + validSeverities include P | C1: Schema Types (Key) | TC-01, TC-02, TC-03, TC-04 |
| 2 | normalizeSeverities function with event-type guard | C2: Normalization (Key) | TC-05, TC-06, TC-07, TC-08, TC-09, TC-37 |
| 3 | ralph_round_finding validate+apply normalization | C3: Validate/Apply (Key) | TC-25, TC-26 |
| 4 | ralph_round_complete validates P in tally schema | C4: Tally Schema (Key) | TC-29, TC-16 |
| 5 | ralph_terminate excludes P/L from zero-checks | C5: Terminate Validation (Key) | TC-12, TC-13, TC-14, TC-31, TC-32, TC-34, TC-35, TC-36 |
| 6 | Downgrade_reason required for M→P/H→P | C6: Downgrade Logic (Key) | TC-17, TC-18, TC-19, TC-20, TC-38 |
| 7 | P counted separately in roundRecords | C7: Apply Counting (Key) | TC-16 |
| 8 | readState migrates pre-v4 data with P:0 + null guards | C8: Migration (Key) | TC-21, TC-21b, TC-21c, TC-21d, TC-21e |
| 9 | SCHEMA_VERSION bump to 4 + version gate | C9: Version Bump (Key) | TC-22, TC-23 |

### Peripheral Functional Points (from Phase 2 — priority: peripheral)

| # | Peripheral Functional Point | Source (Component/Interface/Failure Mode) | Test Cases |
|---|----------------------------|------------------------------------------|------------|
| 1 | Contested issue compatibility — verified by inspection | C10: Contested Issue (Peripheral) | N/A — no code changes (TechSolution §C10) |
| 2 | TDD protocol file M1/M2→M/P replacements | C11: Protocol Files (Peripheral) | Non-code verification (AC-18) |

---

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | User Story | Acceptance Criterion | Test Type | Test File | Test Name(s) | Description |
|---|----------|-----------|---------------------|-----------|-----------|-------------|-------------|
| 1 | Core | US-1 | AC-1 | Unit | transitions-phase23.test.ts | TC-03 | Severity 'P' accepted |
| 2 | Core | US-1 | AC-2 | Unit | transitions-phase23.test.ts | TC-05, TC-06 | Unicode/ASCII 'M₂'→'P' normalization |
| 3 | Core | US-1 | AC-2 | Unit | transitions-phase23.test.ts | TC-07, TC-08 | Unicode/ASCII 'M₁'→'M' normalization |
| 4 | Core | US-1 | AC-2 | Unit | transitions-phase23.test.ts | TC-09, TC-26 | Original field normalization |
| 5 | Core | US-1 | AC-3 | Unit | transitions-phase23.test.ts | TC-04 | Plain 'M' still accepted |
| 6 | Core | US-2 | AC-4 | Unit | transitions-phase23.test.ts | TC-31, TC-35 | P/L do not reset consecutive-zero |
| 7 | Core | US-2 | AC-5 | Unit | transitions-phase23.test.ts | TC-11, TC-32 | M resets consecutive-zero |
| 8 | Core | US-2 | AC-6 | Unit | transitions-phase23.test.ts | TC-12, TC-15, TC-34 | gate_pass with P/L accepted (TC-15: negative case M=1 rejected) |
| 9 | Core | US-2 | AC-7 | Unit | transitions-phase23.test.ts | TC-13, TC-36 | max_rounds rejected when C=H=M=0 |
| 10 | Core | US-2 | AC-8 | Unit | transitions-phase23.test.ts | TC-14 | early_stop with consecutive zero C/H/M accepted |
| 11 | Core | US-1 | AC-9 | Unit | transitions-phase23.test.ts | TC-01 (implicit via TC-16), TC-02 (implicit via TC-16), TC-16 | Count aggregation: M and P separate |
| 12 | Core | US-1 | AC-10 | Unit | transitions-phase23.test.ts | TC-17, TC-19, TC-38 (Phase 4 planned) | M→P/H→P without reason rejected; H→P with reason accepted |
| 13 | Core | US-1 | AC-11 | Unit | transitions-phase23.test.ts | TC-18 | M→P with reason accepted |
| 14 | Core | US-3 | AC-12 | Unit | pipeline-store-phase23.test.ts | TC-21b | readState migrates pre-v4 tallyHistory → P:0 |
| 15 | Core | US-3 | AC-13 | Unit | pipeline-store-phase23.test.ts | TC-22, TC-23 | Version gate: future rejected, current accepted |
| 16 | Core | US-3 | AC-14 | Unit | transitions-phase23.test.ts | TC-24, TC-33 | ralph_round_complete preserves P:0 (TC-24); TC-33: GPAV-mode guard — autoValidated=true blocks ralph_round_complete (prerequisite for AC-14: P:0 stored only via non-GPAV path) |
| 17 | Core | US-1 | AC-15 | Unit | transitions-phase23.test.ts | TC-25, TC-26 | End-to-end: Unicode 'M₂' stored as ASCII 'P' (TC-25 validate+apply; TC-26 original field dual-coverage) |
| 18 | Core | US-1 | AC-16 | Unit | transitions-phase23.test.ts | TC-29 | Payload missing P key rejected |
| 19 | Core | US-3 | AC-17 | Unit | pipeline-store-phase23.test.ts | TC-21, TC-21b | readState migrates pre-v4 all P fields → P:0 (TC-21: roundRecords.counts; TC-21b: tallyHistory) |
| 20 | Docs | US-1 | AC-18 | Non-code | N/A (grep) | — | Zero M1/M2/M₁/M₂ in all skill files |
| 21 | Core | US-2 | Con-5 (Constraint) | Unit | transitions-phase23.test.ts | TC-43 (Phase 4 planned) | I severity does not reset consecutiveZero (Constraint 5 regression) |

### Constraint 2 — Three Missing-P Paths Traceability

| Path | Description | Covered By |
|------|-------------|------------|
| 1. Runtime payloads | checkTally rejects tally without all 6 keys | TC-29 (AC-16) |
| 2. Disk state files | readState defensive migration adds P:0 | TC-21 (AC-17), TC-21b (AC-12) |
| 3. Historical KI re-evaluation | Goes through ralph_round_finding → must pass validSeverities check | Covered by TC-03, TC-05–TC-09 (ralph_round_finding severity validation). Not a subset of Path 1 (checkTally) — different code path. |

### Constraints Traceability Matrix (Con-* → AC → TC)

> **Note (R8-redo)**: This matrix's Con-numbering (Con-1…Con-12) is an independent functional grouping for test traceability, **not** a direct reference to Requirements Document Constraint 1–12. TechSolution declares `Con-N = Requirements Constraint N` for its own cross-reference; the mapping between this matrix's Con-numbers and Requirements Constraints is: Con-1↔Req-4, Con-2↔Req-2, Con-3↔Req-5, Con-4↔Req-4, Con-5↔Req-5, Con-6↔Req-6, Con-7↔Req-5/6, Con-8↔Req-7, Con-9↔Req-2, Con-10↔Req-3, Con-11↔Req-11, Con-12↔Req-10. Both numbering schemes are internally consistent within their respective documents.

| Constraint | Description | Primary AC(s) | Test Coverage |
|------------|-------------|---------------|---------------|
| Con-1 | SEV_ORDER includes P at rank 2 | AC-1, AC-9 | TC-03, TC-04, TC-01, TC-02, TC-16 |
| Con-2 | Missing P must not corrupt state | AC-16, AC-12, AC-17 | TC-29, TC-21, TC-21b (see Three-Path table above) |
| Con-3 | P/L excluded from terminate zero-checks | AC-6, AC-7, AC-8 | TC-12, TC-13, TC-14, TC-15, TC-31, TC-32 |
| Con-4 | Downgrade reason required for P downgrades | AC-10, AC-11 | TC-17, TC-18, TC-19, TC-20, TC-38 |
| Con-5 | P/L/I do not reset consecutiveZero | AC-4, AC-5 | TC-31, TC-32, TC-35, TC-11, TC-43 (Phase 4 planned), TC-44 (Phase 4 planned) |
| Con-6 | L not added to C+H+M check | AC-6 | TC-12, TC-13, TC-14 (implicitly — no L in violation; isolated L-only coverage deferred to TC-44 Phase 4) |
| Con-7 | AutoValidated gate (GPAV) | AC-14 | TC-33 |
| Con-8 | SCHEMA_VERSION bump to 4 | AC-13 | TC-22, TC-23 |
| Con-9 | readState defensive migration | AC-12, AC-17 | TC-21, TC-21b, TC-21c, TC-21d, TC-21e |
| Con-10 | normalizeSeverities event-type guard | AC-2 | TC-37 |
| Con-11 | Contested issue compatibility | Inspection | N/A — no code changes (TechSolution §C10) |
| Con-12 | TDD protocol file terminology | AC-18 | Non-code verification (grep) |

---

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test File | Test Name(s) | Description |
|---|----------|---------------|-------------|-----------|-----------|-------------|-------------|
| 1 | Key | C1: SEV_ORDER + validSeverities include P | Component | Unit | transitions-phase23.test.ts | TC-01 (implicit via TC-16), TC-02 (implicit via TC-16), TC-03, TC-04 | Type enforcement + severity acceptance |
| 2 | Key | C2: normalizeSeverities function | Component | Unit | transitions-phase23.test.ts | TC-05–TC-09, TC-37 | Unicode/ASCII normalization + event-type guard |
| 3 | Key | C3: ralph_round_finding validate+apply normalization | Component | Unit | transitions-phase23.test.ts | TC-25, TC-26 | End-to-end normalization through full pipeline |
| 4 | Key | C4: ralph_round_complete validates P in tally | Component | Unit | transitions-phase23.test.ts | TC-29, TC-16 | checkTally enforces all 6 keys |
| 5 | Key | C5: ralph_terminate excludes P/L from zero-checks | Component | Unit | transitions-phase23.test.ts | TC-12–TC-15, TC-31, TC-32, TC-33, TC-34–TC-36, TC-40, TC-40b | gate_pass/max_rounds/early_stop + GPAV mode guard + KI-24 fallback + legacy path |
| 6 | Key | C6: downgrade_reason required for M→P | Component | Unit | transitions-phase23.test.ts | TC-17–TC-20, TC-38 (Phase 4 planned), TC-41 (Phase 4 planned), TC-42 (Phase 4 planned) | SEV_ORDER downgrade detection (incl. multi-step H→P and C→P) |
| 7 | Key | C7: P counted in roundRecords | Component | Unit | transitions-phase23.test.ts | TC-16 | Apply path counts P separately |
| 8 | Key | C8: readState migration + null guards | Migration | Unit | pipeline-store-phase23.test.ts | TC-21, TC-21b–TC-21e, TC-21g (Phase 4 planned) | Pre-v4 P:0 migration + corruption resilience + combined migration |
| 9 | Key | C9: SCHEMA_VERSION bump + version gate + read-path invariant | Configuration | Unit | pipeline-store-phase23.test.ts | TC-22, TC-23, TC-39 (Phase 4 planned) | Future version rejected, current accepted, P values preserved |
| 10 | Peripheral | C10: Contested Issue Compatibility | Inspection | N/A | N/A | — | No code changes. Contested logic uses explicit id field, not severity filtering. P findings tracked separately. Verified by inspection at HEAD (TechSolution §C10, Constraint 11). |
| 11 | Peripheral | C11: TDD Protocol Files (15 files) | Documentation | Non-code | N/A (grep) | AC-18 | M1/M2→M/P replacements verified by grep |

---

## Test Cases

### T1. Schema Type Enforcement (AC-9, AC-14)

> TC-01 and TC-02 are compile-time TypeScript type checks. They execute as runtime assertions in
> Vitest (`expect(counts.P).toBe(1)`) that would fail to compile if the type didn't include P.
> No additional tooling (tsd, expect-type) is needed — the tests construct typed objects and assert
> their runtime values, which serves as both compile-time and runtime verification.

```
TC-01: RoundRecord.counts type includes P
  - Construct a RoundRecord with P:1
  - Expect TypeScript accepts it (compile-time)
  - Expect counts.P === 1

TC-02: RoundTally type includes P
  - Construct a RoundTally with P:0
  - Expect TypeScript accepts it
```

### T2. Severity Validation (AC-1, AC-2, AC-3)

```
TC-03 (AC-1): ralph_round_finding with severity 'P' accepted
  - State: active ralph loop, round 1 complete
  - Payload: findings: [{ severity: 'P', description: 'suggestion' }]
  - Expect: validation passes

TC-04 (AC-3): ralph_round_finding with severity 'M' still accepted
  - Same setup, severity: 'M'
  - Expect: validation passes (no change)

TC-05 (AC-2): ralph_round_finding with severity 'M₂' (Unicode U+2082) normalized to P
  - Payload: severity: 'M₂'
  - Expect: accepted, stored counts.P === 1

TC-06 (AC-2): ralph_round_finding with severity 'M2' (ASCII) normalized to P
  - Payload: severity: 'M2'
  - Expect: accepted, stored counts.P === 1

TC-07 (AC-2): ralph_round_finding with severity 'M₁' (Unicode U+2081) normalized to M
  - Payload: severity: 'M₁'
  - Expect: accepted, stored counts.M === 1

TC-08 (AC-2): ralph_round_finding with severity 'M1' (ASCII) normalized to M
  - Payload: severity: 'M1'
  - Expect: accepted, stored counts.M === 1

TC-09 (AC-2): original field also normalized — 'M₁' → M (validate-only, w/ downgrade reason)
  - Payload: { severity: 'P', original: 'M₁', downgrade_reason: 'reclassified' }
  - Expect: accepted (original normalizes to 'M'; severity stays 'P'; M→P is a downgrade allowed because reason present)
  - Note: Tests validation path only. See TC-26 for end-to-end (validate + apply).
```

### T3. Consecutive-Zero Counter (AC-5)

> AC-4 coverage provided by TC-31 and TC-35 in Edge Cases section.

```
TC-10: REMOVED — described scenario is invalid.
  Original intent (P=3 round → counter increments to 1, early_stop rejected) is redundant
  with TC-14 (which already covers strictConsecutive=2 requirement). A single-round
  early_stop attempt is structurally impossible to accept regardless of P counts.

TC-11 (AC-5): M finding in latest round resets strictConsecutive
  - State: autoValidated=true, roundRecords = [zero, zero, {M:1}] (last round breaks the streak)
  - Apply ralph_terminate(early_stop)
  - Expect: rejected with 'consecutive' violation (strictConsecutive=0 < 2 required)
```

### T4. Terminate Validation — P/L Excluded (AC-6, AC-7, AC-8)

```
TC-12 (AC-6): gate_pass with C=0,H=0,M=0,P=2,L=3 → accepted
  - State: autoValidated=true, roundRecords has last round with counts {C:0,H:0,M:0,P:2,L:3,I:0}
  - Payload: termination='gate_pass', round >= MIN_GATE_ROUNDS
  - Expect: accepted

TC-13 (AC-7): max_rounds with C=0,H=0,M=0,P=3,L=2 → rejected
  - State: autoValidated=true, roundRecords has last round with counts {C:0,H:0,M:0,P:3,L:2,I:0}
  - Payload: termination='max_rounds', round >= MAX_RALPH_ROUNDS
  - Expect: rejected ("No unresolved issues")

TC-14 (AC-8): early_stop with 2 consecutive zero-C/H/M rounds (P>0,L>0) → accepted
  - State: autoValidated=true, last 2 roundRecords both have C=0,H=0,M=0,P=3,L=2
  - Payload: termination='early_stop'
  - Expect: accepted (strictConsecutive=2)

TC-15: gate_pass with M=1,P=0 → rejected (M is defect-tier)
  - State: autoValidated=true, last roundRecord has {C:0,H:0,M:1,P:0,L:0,I:0}
  - Payload: termination='gate_pass'
  - Expect: rejected ("Unresolved issues remain")
```

### T5. Count Aggregation (AC-9)

```
TC-16 (AC-9): 2 M findings + 1 P finding → {M:2, P:1}
  - Payload: findings = [{severity:'M',...}, {severity:'M',...}, {severity:'P',...}]
  - Apply
  - Expect: roundRecords[0].counts = {C:0,H:0,M:2,P:1,L:0,I:0}
```

### T6. Downgrade Validation (AC-10, AC-11)

```
TC-17 (AC-10): M→P without downgrade_reason → rejected
  - Payload: findings: [{ severity: 'P', original: 'M', description: '...' }]
  - Expect: rejected with "downgrade_reason required"
  - Note: Code validates reason is non-empty string (typeof + length === 0 check), so both
    absent reason and empty-string reason are covered by this rejection path.

TC-18 (AC-11): M→P with downgrade_reason → accepted
  - Payload: findings: [{ severity: 'P', original: 'M', downgrade_reason: 'downgraded to proposal', description: '...' }]
  - Expect: accepted

TC-19: H→P without downgrade_reason → rejected
  - Payload: severity: 'P', original: 'H'
  - Expect: rejected (H→P is 4→2, downgrade)

TC-20: P→M without downgrade_reason → accepted (upgrade)
  - Payload: severity: 'M', original: 'P'
  - Expect: accepted (P→M is 2→3, upgrade, no reason needed)

TC-38 (AC-10 regression): H→P with downgrade_reason → accepted
  - Payload: severity: 'P', original: 'H', downgrade_reason: 'recalibrated from critical to proposal'
  - Expect: accepted (H→P is 4→2, two-step downgrade with reason — validates new SEV_ORDER gap)
  - Rationale: H→P crosses a newly inserted severity boundary (P at 2). While generic downgrade logic
    is tested by TC-17–TC-20, H→P is the only multi-step downgrade involving P and warrants explicit
    regression coverage for the new severity insertion point.
```

### T7. Read Compatibility (AC-12, AC-17)

```
TC-21 (AC-17): Old state file without P field in roundRecords.counts → migrated to P:0
  - Construct state with roundRecords[].counts missing the P key (pre-v4 shape)
  - readState
  - Expect: each roundRecords[i].counts.P === 0 (via defensive migration)

TC-21b (AC-12): Old state file without P field in tallyHistory → migrated to P:0
  - Construct state with tallyHistory[].P missing (pre-v4 RoundTally shape)
  - readState
  - Expect: tallyHistory[0].P === 0 (via defensive migration)

TC-21c (F-6 regression): readState handles corrupted roundRecords with missing counts field
   - Construct state with roundRecords[1].counts = undefined, roundRecords[2].counts = null
   - readState
   - Expect: no throw; valid entries get P:0 migration; corrupted entries preserved as-is
   - Covers: C8 null guard, defensive corruption resilience

TC-21d (F-1 regression): readState handles null tallyHistory entries
  - Construct state with tallyHistory[1] = null
  - readState
  - Expect: no throw; valid entries get P:0; null entries preserved as-is
  - Covers: C8 null guard for tallyHistory entries

TC-21e (F-2 regression): readState handles non-object roundRecord.counts (string/number primitive)
  - Construct state with roundRecords[0].counts = 'corrupted-string', roundRecords[1].counts = 42
  - readState
  - Expect: no throw; valid entries get P:0; primitives preserved as-is
  - Covers: C8 typeof check for non-object counts

TC-21g (C8 combined): readState migrates both roundRecords AND tallyHistory in single load
  - Construct pre-v4 state with BOTH roundRecords[0].counts missing P AND tallyHistory[0] missing P
  - readState
  - Expect: roundRecords[0].counts.P === 0 AND tallyHistory[0].P === 0
  - Rationale: TC-21 and TC-21b test migration in isolation. TC-21g verifies the production path
    where both structures need migration in a single readState call.
```

### T8. Version Gate (AC-13)

```
TC-22 (AC-13): State file with version > SCHEMA_VERSION → rejected
  - Write state JSON with version: 99
  - readState
  - Expect: throws Error containing "version 99 is newer"

TC-23 (AC-13): State file with version === SCHEMA_VERSION → accepted
  - Write state JSON with version: 4 (after bump)
  - readState
  - Expect: no error

TC-39 (C9 invariant): readState with valid v4 state → P values preserved unchanged
  - Construct v4 state with roundRecords[0].counts.P = 3 and tallyHistory[0].P = 2
  - readState
  - Expect: roundRecords[0].counts.P === 3 (not overwritten to 0)
  - Expect: tallyHistory[0].P === 2 (not overwritten to 0)
  - Rationale: C9 invariant guarantees P present after readState. For v4 state where P already exists,
    the migration guard `if (!('P' in t))` should skip the entry (idempotent). This test verifies the
    happy path of the read-path invariant alongside TC-23's version acceptance test.
```

### T9. ralph_round_complete Payload Format (AC-14, AC-16)

```
TC-24 (AC-14): ralph_round_complete with P:0 (zero P-level findings) → P and key counts preserved
  - State: autoValidated=false (required: TC-33 establishes autoValidated=true blocks ralph_round_complete)
  - Payload: { phase:1, round:2, tally: {C:0,H:1,M:2,P:0,L:0,I:0} }
  - Apply
  - Expect: tallyHistory[last].P === 0 (zero findings, not missing)
  - Expect: tallyHistory[last].M === 2 (unchanged)
  - Note: Test asserts P and M as the critical verification points — P:0 preservation is the new requirement; M:2 confirms existing tally fields pass through. The apply code constructs the full RoundTally from all 6 payload tally keys, so C/H/L/I preservation is guaranteed by the same code path. Phase 5 code review may add full toEqual() assertion.

TC-29 (AC-16): ralph_round_complete payload missing P key → rejected
  - Payload: { phase:1, round:2, tally: {C:0,H:1,M:2,L:0,I:0} }  // P key absent
  - Validate
  - Expect: rejected (checkTally enforces all 6 keys present)
  - Rationale: protocol requires evaluating all 6 severities; missing key = protocol violation
```

### T10. End-to-End Normalization (AC-15)

```
TC-25 (AC-15): Full pipeline with Unicode severity → stored as ASCII P
   - Setup: active ralph loop
   - Submit ralph_round_finding with severity: 'M₂' (Unicode)
   - Apply
   - Expect: roundRecords[0].counts.P === 1
   - Expect: NO 'M₂' key in roundRecords[0].counts (check Object.keys)
   - Expect: roundRecords[0].counts.M === 0

TC-26 (AC-2 + AC-15, dual-coverage): Original field also normalized through full apply pipeline
  - Submit with { severity: 'M₂', original: 'M₂' } (both Unicode)
  - Apply (validate + apply both)
  - Expect: accepted (both normalized to 'P'), roundRecords[0].counts.P === 1, counts.M === 0
  - Complements TC-09 (validation-only) by exercising apply path with original normalization.
  - Note: This TC provides dual coverage — it validates AC-2 (original field normalization) AND
    AC-15 (end-to-end normalization pipeline). The overlap is intentional: the same normalization
    mechanism handles both severity and original fields in a single pass.

TC-37 (C3 guard): normalizeSeverities is no-op for non-ralph_round_finding events
  - Event: ralph_round_complete (not ralph_round_finding)
  - Payload contains findings array with one severity 'M₂' entry + tally field
  - Call normalizeSeverities
  - Expect: payload unchanged (no normalization applied)
  - Covers: C3 event-type guard, defensive normalization boundary
```

---

## Edge Cases & Negative Tests

```
TC-27 (Constraint 2 regression): Unknown severity 'X' → rejected (existing behavior, P doesn't break it)
TC-28 (Constraint 2 regression): severity: 'P' with description: '' → rejected (existing non-empty description validation)
TC-31 (AC-4): P-only round → consecutive counter still increments
  - State: autoValidated=true, round=2, roundRecords with 2 rounds of P-only counts (round 1: P=3,L=2; round 2: P=2,I=1)
  - Terminate: ralph_terminate with termination=early_stop
  - Expect: accepted (strictConsecutive=2, P/L do not reset counter)
TC-32 (AC-5): Mixed findings with C=1 reset strictConsecutive
  - State: autoValidated=true, round=3, roundRecords with round 3 containing C=1,P=2
  - Terminate: ralph_terminate with termination=early_stop
  - Expect: rejected (C>0 resets consecutiveZero counter)
TC-33 (AC-14 negative): ralph_round_complete forbidden when autoValidated=true (GPAV mode)
   - State: autoValidated=true, round>=1
   - Payload: ralph_round_complete with tally containing P
   - Expect: rejected with violation containing 'GPAV' or 'forbidden' or 'autoValidated'
TC-34 (F-4, AC-6/AC-7 regression): KI-24 fallback path correctly excludes L/P
    - State: autoValidated=true, completedRecords empty, tallyHistory with C=H=M=0, P>0, L>0
    - Apply ralph_terminate(gate_pass): expect accepted (L/P do not block)
    - Rationale: F-18 verified fallback path excludes L/P in baseline; this test prevents regression.
    - Note: Fallback max_rounds exclusion tested separately by TC-36.
    - Lifecycle: Valid only while KI-24 fallback path exists. When GPAV is enforced from
      round 1, this TC should be removed or converted to a negative test (verify fallback is unreachable).
TC-35 (AC-4): Legacy ralph_round_complete with P-only tally does NOT reset consecutiveZero (counter continues incrementing)
   - State: autoValidated=false, consecutiveZero=1
   - Payload: ralph_round_complete tally={C:0,H:0,M:0,P:3,L:2,I:0}
   - Expect: newState.ralph.consecutiveZero === 2 (incremented because C=H=M=0, not because P is special)
   - Rationale: AC-4 requires P/L not to reset; consecutiveZero increments naturally when all defect-tier (C/H/M) counts are zero. P>0 is irrelevant to the counter.
   - Note: tallyHistory P/L value assertions are NOT included because tallyHistory storage is already verified by TC-24 (AC-14). TC-35 focuses exclusively on the consecutiveZero counter behavior.
TC-36 (F-4, AC-7 regression): KI-24 fallback max_rounds correctly excludes P/L from zero-check
  - State: autoValidated=true, roundRecords=[], tallyHistory with all entries C=H=M=0 but P>0,L>0, round=MAX_RALPH_ROUNDS
  - Apply ralph_terminate(max_rounds)
  - Expect: rejected with violation matching /unresolved|resolved/ (KI-24 fallback: max_rounds wrong termination when all resolved)
  - Rationale: Verifies fallback path's max_rounds logic excludes L/P from zero-check.
TC-40 (C5 legacy regression): Legacy gate_pass with tally C=0,H=0,M=0,P=5,L=0,I=0 → accepted
  - State: autoValidated=false (triggers legacy tallyHistory path instead of GPAV roundRecords path), tallyHistory with P-only entry
  - Apply ralph_terminate(gate_pass)
  - Expect: accepted (legacy code path `last.C + last.H + last.M > 0` = 0, P excluded by arithmetic)
  - Rationale: Primary gate_pass P-exclusion tested by TC-12. TC-40 verifies the legacy code path
    (transitions.ts ~L667) also excludes P — same logic but separate code location.
TC-40b (C5 legacy regression): Legacy max_rounds with tally C=0,H=0,M=0,P=5,L=0,I=0 → rejected
  - State: autoValidated=false (triggers legacy tallyHistory path), tallyHistory with P-only entry, round >= MAX_RALPH_ROUNDS
  - Apply ralph_terminate(max_rounds)
  - Expect: rejected ('No unresolved issues') — legacy `last.C + last.H + last.M === 0` is true
  - Rationale: Complements TC-40 (legacy gate_pass). Verifies legacy max_rounds also treats P-only
    rounds as 'clean' — P excluded by arithmetic, consistent with primary path (TC-13/TC-36).
TC-41 (C6 regression): C→P without downgrade_reason → rejected
  - Payload: severity: 'P', original: 'C' (no downgrade_reason)
  - Expect: rejected (C→P is 5→2, maximum-span downgrade, requires reason)
  - Rationale: TC-17 tests M→P (one step), TC-38 tests H→P (two steps). C→P is the maximum-span
    downgrade involving P and validates SEV_ORDER ordering at the extreme boundary.
TC-42 (C6 regression): C→P with downgrade_reason → accepted
  - Payload: severity: 'P', original: 'C', downgrade_reason: 'downgraded from critical to proposal'
  - Expect: accepted
  - Rationale: Mirror of TC-41. Completes the downgrade coverage matrix: every severity→P downgrade
    path has both reject (no reason) and accept (with reason) test cases.
TC-43 (Constraint 5 regression): I-only round does NOT reset consecutiveZero counter
  - State: autoValidated=false, consecutiveZero=1
  - Payload: ralph_round_complete tally={C:0, H:0, M:0, P:0, L:0, I:3}
  - Expect: newState.ralph.consecutiveZero === 2 (incremented because C=H=M=0; I is Observation Tier)
  - Rationale: Constraint 5 explicitly states "P/L/I do not reset" the consecutive-zero counter.
    While I (SEV_ORDER=0, Observation Tier) is structurally excluded by the C+H+M arithmetic,
    the Test Plan should provide explicit coverage for Constraint 5's complete declaration.
    This TC complements TC-35 (P-only) by testing the I tier.
    Legacy path used (autoValidated=false) because ralph_round_complete is the event that
    updates consecutiveZero; GPAV path re-computes from roundRecords which is already tested.
TC-44 (Constraint 5 regression): L-only round does NOT reset consecutiveZero counter
  - State: autoValidated=false, consecutiveZero=1
  - Payload: ralph_round_complete tally={C:0, H:0, M:0, P:0, L:3, I:0}
  - Expect: newState.ralph.consecutiveZero === 2 (incremented because C=H=M=0; L is Quality Tier)
  - Rationale: Constraint 5 explicitly states "P, L, I do not reset" the consecutive-zero counter.
    TC-31/TC-35 cover P-only, TC-43 covers I-only. TC-44 provides the missing L-only isolation test.
    If the Constraint 6 L-bug were to regress (L re-added to C+H+M check), this test would fail:
    C+H+M+L = 0+0+0+3 = 3 ≠ 0 → counter would reset to 0 instead of incrementing to 2.
    Legacy path used (autoValidated=false) consistent with TC-35 and TC-43.
```

### Edge Cases Checklist

- [x] **null_inputs** — TC-21c (roundRecords with undefined/null counts), TC-21d (null tallyHistory entries)
- [x] **empty_collections** — TC-21b (pre-v4 tallyHistory migration from empty state)
- [x] **max_values** — TC-13 (MAX_RALPH_ROUNDS boundary)
- [ ] **concurrent_access** — N/A (single-threaded state machine, no shared mutable state)
- [ ] **timeouts** — N/A (no I/O in transition functions)
- [ ] **network_failures** — N/A (no external calls in transition/persistence layer)
- [x] **invalid_state_transitions** — TC-22 (version gate rejects future state), TC-33 (GPAV mode rejects legacy tool)
- [x] **serialization_boundary** — TC-05–TC-08 (Unicode→ASCII normalization across validate/apply boundary), TC-21/21b/21c/21d/21e (disk serialization migration for pre-v4 state)
- [x] **error_handler_correctness** — TC-21c/21d/21e (readState does not throw on corrupted data, degrades gracefully)
- [x] **implicit_contract** — TC-33 (autoValidated=true implicitly forbids ralph_round_complete — contractual guard)
- [ ] **resource_leak** — N/A (no persistent resources in scope)
- [x] **cascading_failure** — TC-34/TC-36 (KI-24 fallback path isolation — fallback must not cascade L/P exclusion failures)
- [ ] **performance_logic** — N/A (no hot paths in this scope; all operations are O(n) where n ≤ MAX_RALPH_ROUNDS; readState migration iterates state once on load, no nested loops)

---

## AC-18 Verification (Non-Code)

AC-18 requires zero M1/M2/M₁/M₂ notation across all TDD Pipeline skill files. This is a documentation completeness criterion verified by grep, not a unit test.

### Verification Commands (per TechSolution C11.5)

> **Path variables**: Set before running — `SKILL_SRC` (tdd-pipeline skill source), `MIRROR_OPENCODE` (~/.config/opencode/skills/tdd-pipeline/), `MIRROR_CLAUDE` (~/.claude/skills/tdd-pipeline/).

**ASCII check** (excludes issue IDs like M-1, M-2):
```bash
grep -rEn 'M[12]([^-]|$)' $SKILL_SRC/ $MIRROR_OPENCODE/ $MIRROR_CLAUDE/
```
Expected: zero matches. The `[^-]|$` pattern excludes issue IDs (M-1, M-2) by requiring M1/M2 followed by a non-dash character or EOL. Scoped to skill files only — not project source or test files.

**Unicode check**:
```bash
grep -rEn 'M₁|M₂' $SKILL_SRC/ $MIRROR_OPENCODE/ $MIRROR_CLAUDE/
```
Expected: zero matches.

### Deployment Paths

| Role | Path |
|------|------|
| Source-of-truth | `/Users/alex/tdd-pipeline/skill/` |
| Mirror (opencode) | `/Users/alex/.config/opencode/skills/tdd-pipeline/` |
| Mirror (Claude Code) | `/Users/alex/.claude/skills/tdd-pipeline/` |

All three paths must return zero matches. Verification must be re-run after any sync operation.

---

## Test Data

- **Helpers**: `makeState()`, `makeRalphState()`, `basePayload()` defined in test files
- **Mock infrastructure**: `createMockStateStore()`, `createMockLogger()` for pipeline-store tests
- **Constants**: `SCHEMA_VERSION`, `MAX_RALPH_ROUNDS`, `MIN_GATE_ROUNDS`, `EARLY_STOP_CONSECUTIVE` imported from source
- **Timestamps**: Fixed `NOW = '2026-01-01T00:00:00.000Z'` for deterministic assertions

---

## Dependencies Between Tests

- No test may depend on another test passing (TDD principle: each test is independent)
- Execution order: tests within each file can run in any order
- No shared mutable state between test cases (all state constructed inline per test)

---

## Open Questions

- **downgrade_reason content validation**: Code enforces non-empty string (`typeof === 'string' && length > 0`). No further content validation (no min-length, no format check). This is a conscious design choice — reason is free-text metadata, not a structured field. TC-17's rejection path covers empty/absent reason; TC-18's acceptance path covers valid reason.
- **All 18 ACs covered**: 17 by unit tests, 1 by grep verification. C10 verified by inspection.

---

## Priority Downgrade Justifications

### From Phase 2 (Technical Design → Test Plan)
- C10 (Contested Issue Compatibility): Key → Peripheral — TechSolution explicitly states "No code changes required. Verified by inspection at HEAD." No test needed beyond inspection note.

---

## Priority Upgrade Review

### No upgrades
- All items remain at their original priority levels. No scope creep detected.

---

## Existing Test Adaptation (Phase 5.5 — E1)

188 sites across test files (primarily `transitions.test.ts`) need:
1. All `counts` object literals: add `P: 0`
2. All `severity: 'M'` in GPAV contexts: keep as-is (M still valid)
3. All `tallyHistory` mock constructions: add `P: 0`
4. All `RoundRecord` mock constructions: add `P: 0` to counts
5. All `toEqual` on counts objects: add `P: 0`

This is mechanical but large — estimated 30-40 minutes of careful replacement.

### Phase 5.5 Acceptance Gate

After adaptation, the Phase 1 baseline test suite must still pass with **zero test-logic modifications** (only data fixture updates allowed). Blocking criterion: all 430 baseline tests + all Phase 2.3 new tests (49 `it()` blocks: 38 transitions + 11 pipeline-store, including KI-26, R4-F26, R5-F1 regressions) must pass = **479 total passing**. Any baseline test failure after adaptation indicates a fixture update error, not a logic change.

> **Count Clarification**: The 49 `it()` blocks comprise 38 in `transitions-phase23.test.ts` (TC-03..TC-09, TC-11..TC-20, TC-24..TC-29, TC-31..TC-44, KI-26) and 11 in `pipeline-store-phase23.test.ts` (TC-21, TC-21b..TC-21e, TC-21g, TC-22, TC-23, TC-39, R4-F26, R5-F1). Note: TC-01 and TC-02 are not separate `it()` blocks — they represent compile-time type safety verified implicitly through TC-16 and other tests that construct typed objects with P fields. KI-26 is a Known Issue regression test (downgrade_reason empty string), tracked separately from TC numbering. R4-F26 and R5-F1 are Ralph Loop regression tests (source code defensive guard fixes).

> **Phase 4 Status**: ✅ All 9 planned TCs (TC-38, TC-39, TC-40, TC-40b, TC-41, TC-42, TC-43, TC-44, TC-21g) plus KI-26 regression test are now implemented. Ralph Loop added R4-F26 (primitive tallyHistory guard) and R5-F1 (null roundRecords guard) regression tests. Total: 49 it() blocks (38 transitions + 11 pipeline-store).

---

## Test Execution Report (Phase 4)

- **Feature**: Phase 2.3 — P Severity Addition
- **Date**: 2026-05-23
- **Total tests**: 49 (Phase 2.3) + 430 (baseline) = 479 total
- **Runtime failures**: 0 — all 49 Phase 2.3 tests PASS
- **Passed**: 49/49 Phase 2.3, 479/479 total
- **Structural errors**: 0

### Test Files

| File | Tests | Status |
|------|-------|--------|
| `test/transitions-phase23.test.ts` | 38 | ✅ All pass |
| `test/pipeline-store-phase23.test.ts` | 11 | ✅ All pass |

### Test Coverage by Test Plan Section

| Section | Tests | TCs Covered |
|---------|-------|-------------|
| **T2: Normalize Severities** | TC-03..TC-09 | 7 tests (M₂→P, M₁→M, P pass-through, invalid rejection) |
| **T4: Terminate GPAV** | TC-11..TC-20 | 10 tests (early_stop, gate_pass, max_rounds, downgrade paths) |
| **T5: Ralph Round Complete** | TC-24..TC-29 | 6 tests (tally P count, checkTally, state update) |
| **T6: Ralph Round Finding** | TC-31..TC-37, TC-40, TC-40b | 8 tests (GPAV submit, validate, apply, KI-24 fallback) |
| **T7: Downgrade Severity** | TC-41, TC-42 | 2 tests (M→P, H→P downgrade with reason) |
| **T8: Constraint Coverage** | TC-43, TC-44 | 2 tests (I-only no reset, L-only no reset) |
| **State Persistence** | TC-21..TC-23, TC-39, TC-21g | 6 tests (v3→v4 migration, corrupted state resilience) |
| **Regression** | KI-26, R4-F26, R5-F1 | 3 tests (downgrade_reason empty, primitive tally, null records) |
| **Compile-time** | TC-01, TC-02 | Implicit via TC-16 (TypeScript type enforcement) |

### Source Code Changes During Phase 4

Two source code defects were discovered and fixed during the Ralph Loop:

1. **R4-F26**: `pipeline-store.ts` L146-148 — tallyHistory migration guard added `typeof t === 'object'` (prevents `'P' in 42` TypeError)
2. **R5-F1**: `pipeline-store.ts` L157 — roundRecords loop added `r &&` null guard (prevents `null.counts` TypeError)

### Ralph Loop Review Summary

| Metric | Value |
|--------|-------|
| Total rounds | 9 (R1–R9) |
| Review mode | Dual-pass (Recall → Precision) |
| M-bearing rounds | 4 (R2: 3M, R4: 2M, R5: 3M, R7: 2M) |
| Source defects found | 2 |
| Gate condition | R8 + R9 consecutive zero C/H/M |
| Pre-Stop Articulation | Completed ✅ |

### No Business Code

No business logic was implemented in Phase 4. All source code changes were **defensive guard fixes** in existing migration code (`pipeline-store.ts` L146-161), not new feature implementation. Phase 5 will implement the actual business logic.

### User Approval Required

- [x] All planned tests written (49 it() blocks per Test Plan)
- [x] All tests pass (49/49 Phase 2.3, 479/479 total)
- [x] No business code (only defensive guard fixes in existing source)
- [ ] **User approval to proceed to Phase 5**
