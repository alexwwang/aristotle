# Phase 3 — Module C: Articulation Validation

**Version**: 1.0
**Split From**: Phase3-TestPlan.md
**Source Design**: Phase2-ActiveMonitoring.md §8, §5.5a
**Dependencies**: Phase3-Shared.md (mock conventions, dependency graph)

---

## Components Under Test

| File | Tier | Status |
|------|------|--------|
| `packages/watchdog/src/articulation.ts` | 2 | **NEW** |
| `packages/watchdog/src/transitions.ts` | 3 | **Updated** (why_articulation case) |
| `packages/watchdog/src/checkpoint.ts` | 4 | **Updated** (articulation + degradation + ownership) |

## Test Files

| File | Tests |
|------|-------|
| `test/articulation.test.ts` | 8 tests |
| `test/checkpoint-phase2.test.ts` | 22 tests |

**IMPORTANT**: `checkpoint-phase2.test.ts` adds NEW test blocks only. Existing Phase 1 tests in `checkpoint.test.ts` are NOT modified.

---

## Articulation Validator Tests (articulation.test.ts)

### TC-C-01: All 3 dimensions pass

**Source**: §8.8
**Priority**: Key
**Input**: Text with protect/guard/prevent + risk/edge case + because/effective
**Expected**: {verified: true, dimensions: {all true}}
**Covers**: AC-5, §8.2

### TC-C-02: Missing what_it_protects

**Source**: §8.8
**Input**: Text with risks and approach but no protection keywords
**Expected**: {verified: false, missingDimension: 'what_it_protects', dimensions: {false,true,true}}
**Covers**: AC-5, §8.2

### TC-C-03: Missing key_risks

**Source**: §8.8
**Input**: Text with protection and approach but no risk keywords
**Expected**: {verified: false, missingDimension: 'key_risks', dimensions: {true,false,true}}
**Covers**: AC-5, §8.2

### TC-C-04: Missing why_approach_works

**Source**: §8.8
**Input**: Text with protection and risks but no approach keywords
**Expected**: {verified: false, missingDimension: 'why_approach_works', dimensions: {true,true,false}}
**Covers**: AC-5, §8.2

### TC-C-05: Text too short (< 50 chars)

**Source**: §8.8
**Input**: "I will write tests for this."
**Expected**: {verified: false, all dimensions false, missingDimension: 'what_it_protects'}
**Covers**: §8.2

### TC-C-06: Empty string

**Source**: §8.8
**Input**: ""
**Expected**: Same as TC-C-05
**Covers**: §8.2

### TC-C-07: All dimensions missing

**Source**: §8.8
**Input**: Long text about weather/gardening (no matching keywords)
**Expected**: {verified: false, all dimensions false, missingDimension: 'what_it_protects'}
**Covers**: §8.2

### TC-C-08: Minimum length boundary (exactly 50 chars)

**Source**: §8.8
**Input**: "a".repeat(50)
**Expected**: Length check passes (50 < 50 is false), proceeds to keywords
**Covers**: §8.2

---

## Degradation Tests (checkpoint-phase2.test.ts)

### TC-C-09: Degradation -- 3 consecutive failures -> degraded

**Source**: §8.8
**Priority**: Key
**Input**: Three why_articulation calls, all failing
**Expected**: Third: ok=false, violation contains "escalated to Ralph review", articulationDegraded=true
**Covers**: AC-7, §8.3

### TC-C-10: Degradation -- success resets counter

**Source**: §8.8
**Priority**: Key
**Input**: 2 failures, then success
**Expected**: Third call: ok=true, articulationVerified=true
**Covers**: AC-5, §8.3

### TC-C-11: Degradation -- persists as historical marker

**Source**: §8.8
**Priority**: Key
**Preconditions**: articulationDegraded already true
**Input**: New successful articulation
**Expected**: ok=true, articulationVerified=true, articulationDegraded stays true
**Covers**: AC-7, §8.4

### TC-C-12: Degradation -- restart loses counter

**Source**: §8.8
**Priority**: Peripheral
**Input**: Fresh CheckpointHandler after 2 prior failures
**Expected**: First failure on new handler: NOT degraded (counter=1)
**Covers**: AC-5, §8.3

---

## Transitions Tests (checkpoint-phase2.test.ts)

### TC-C-13: transitions -- why_articulation valid preconditions

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition('why_articulation', {phase:1, articulation:'text'}, state)
**Expected**: {valid: true}
**Covers**: §8.4

### TC-C-14: transitions -- why_articulation wrong phase

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition with phase != currentPhase
**Expected**: {valid: false, violation: 'Phase mismatch'}
**Covers**: §8.4

### TC-C-15: transitions -- phaseStatus not active

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition with phaseStatus='idle'
**Expected**: {valid: false, violation: 'Phase not active'}
**Covers**: §8.4

### TC-C-16: transitions -- phase not entered

**Source**: §8.8
**Priority**: Key
**Input**: validateTransition with phases[phase] missing
**Expected**: {valid: false, violation: 'Phase X not found'}
**Covers**: §8.4

### TC-C-17: applyTransition('why_articulation') sets articulation fields (C-2 fix)

**Source**: §8.4, §8.8
**Priority**: Key
**Input**: `applyTransition('why_articulation', {_articulationVerified: true, _articulationDimensions: {...}}, state)`
**Expected**: Resulting state has `articulationAttempted=true`, `articulationVerified=true`, `articulationDimensions` set, `articulationDegraded` unchanged
**Covers**: §8.4 pure state mutation

### TC-C-18: applyTransition('why_articulation') preserves pre-existing degradation (C-2 fix)

**Source**: §8.4, §8.8
**Priority**: Key
**Preconditions**: State has `articulationDegraded=true` from prior failures
**Input**: `applyTransition('why_articulation', {_articulationVerified: true, ...}, state)`
**Expected**: `articulationDegraded` remains true (OR semantics — never un-sets)
**Covers**: §8.4 degradation preservation

---

## Checkpoint Articulation Tests (checkpoint-phase2.test.ts)

### TC-C-19: checkpoint -- why_articulation ok=true

**Source**: §8.8
**Priority**: Key
**Input**: Good articulation text
**Expected**: ok=true, state has articulationVerified=true, audit PASS
**Covers**: AC-5, §8.5

### TC-C-20: checkpoint -- why_articulation ok=false with guidance

**Source**: §8.8
**Priority**: Key
**Input**: Poor articulation text
**Expected**: ok=false, guidance present, violation contains "incomplete", audit PASS
**Covers**: AC-5, §8.5

### TC-C-21: checkpoint -- degraded note after 3 failures

**Source**: §8.8
**Priority**: Key
**Preconditions**: 2 prior failures
**Expected**: ok=false, violation contains "escalated to Ralph review", articulationDegraded=true
**Covers**: AC-7, §8.5

### TC-C-22: checkpoint -- re-validation after failure

**Source**: §8.8
**Priority**: Key
**Preconditions**: Previous failure (articulationAttempted=true, articulationVerified=false)
**Input**: Good text
**Expected**: ok=true, articulationVerified=true
**Covers**: AC-5, §8.5

### TC-C-23: checkpoint -- phase_enter resets failure counter

**Source**: §8.5 (M-5 fix)
**Priority**: Key
**Input**: phase_enter(2) after 2 failures in phase 1
**Expected**: First articulation for phase 2: NOT degraded
**Covers**: M-5, §8.5

### TC-C-24: pipeline_start clears articulation failure counter (H-5 fix)

**Source**: §8.3, §8.5 (M-3 fix)
**Priority**: Key
**Input**: Create handler, trigger 2 failures, then pipeline_start for new run
**Expected**: Next failure in same phase does NOT trigger degradation (counter was reset by pipeline_start)
**Covers**: M-3 fix, §8.3

### TC-C-25: pipeline_start sets ownerSessionId (H-1 fix)

**Source**: §5.5a
**Priority**: Key
**Input**: `applyTransition('pipeline_start', {description: 'x', _runId: 'r1', _projectId: 'p1', _ownerSessionId: 'sess-orch'}, null)`
**Expected**: `newState.ownerSessionId === 'sess-orch'`
**Covers**: §5.5a L2 defense positive path

---

## AC-2 Enforcement Tests (checkpoint-phase2.test.ts, moved from Module A — H-3 fix)

### TC-C-26: AC-2 -- round complete with matching observation

**Source**: §6.7
**Priority**: Key
**Preconditions**: findObservations returns 1 entry for round 2; observer.isDegraded returns false
**Input**: `handler.handle('ralph_round_complete', '{phase:1,round:2,tally:{C:0,H:0,M:0,L:0,I:0}}', CONTEXT)`
**Expected**: Returns ok=true
**Covers**: AC-2, §6.4

### TC-C-27: AC-2 -- round complete without observation

**Source**: §6.7
**Priority**: Key
**Preconditions**: findObservations returns []; observer.isDegraded returns false
**Input**: Same as TC-C-26
**Expected**: Returns ok=false, violation='Round 2 completed without a reviewer subagent'
**Covers**: AC-2, §6.4

### TC-C-28: AC-2 -- observer degraded, skip check

**Source**: §6.7
**Priority**: Key
**Preconditions**: observer.isDegraded returns true
**Input**: Same as TC-C-26
**Expected**: Returns ok=true, warning logged about AC-2 skip
**Covers**: AC-2 degradation, §6.4

### TC-C-29: AC-2 -- observation for wrong round

**Source**: §6.7
**Priority**: Key
**Preconditions**: findObservations for round 2 returns []; round 3 has observation
**Input**: `handler.handle('ralph_round_complete', '{phase:1,round:2,...}', CONTEXT)`
**Expected**: Returns ok=false (round mismatch)
**Covers**: AC-2, §6.4

## Ownership Tests (checkpoint-phase2.test.ts, moved from Module B — M-3 fix)

### TC-C-30: Phase 1 state (no ownerSessionId) -> check skipped

**Source**: §7.8 #38
**Priority**: Key
**Preconditions**: State without ownerSessionId
**Expected**: Returns ok=true
**Covers**: Migration safety, §5.5a

---

## Cross-Module Integration Tests (in integration-phase2.test.ts)

### TC-I-01: Full pipeline with observations

**Source**: §21.4
**Priority**: Key
**Expected**: All 5 phases complete; all AC-2 checks pass; observations present
**Covers**: Full flow

### TC-I-02: Articulation full cycle

**Source**: §21.4
**Priority**: Key
**Expected**: Bad -> ok=false with guidance; good -> ok=true; state mutations correct
**Covers**: AC-5, AC-6

### TC-I-11: Observer crash -> AC-2 skip -> round completes (L-3 fix)

**Source**: §6.4, §11
**Priority**: Key
**Expected**: Observer throws during Task observation → degradation flag set → CheckpointHandler reads flag → AC-2 skipped → round completes ok=true
**Covers**: AC-2 degradation cross-module flow

---

## Phase 1 Migration Notes

**C-1 fix**: All 4 articulation fields in `PhaseRecord` are optional (`?: boolean`). Phase 1 test suite compiles and passes unchanged. Zero Phase 1 files need modification.

**Constructor change**: `CheckpointHandler` constructor gains optional `cache` and `observer` params. Phase 1 tests continue using 2-param constructor. No Phase 1 file changes needed.
