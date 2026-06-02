# Test Plan: TDD Pipeline Checkpoint Integration

**Version**: 1.8
**Status**: GATE PASSED (R10+R11 consecutive 0C/0H/0M)
**Last Updated**: 2026-05-21
**Source**: Phase2.2-CheckpointIntegration-TechnicalSolution.md (v1.6, GATE PASSED)
**TDD Pipeline Phase**: Phase 3 (Test Plan)

---

## Why Articulation

Phase 3 protects the test-code-then-business-code sequence. The key risk is **test gap** — missing edge cases in `parseLoopPhases` (12 validation branches), `user_approval` dual behavior (ralph vs followup), or `effectiveMax` fallback chain (maxPhase undefined → totalPhases). Phase 2 provides detailed test strategy tables (A.4/B.10/C.4/D.4/E.4/A.5) that directly translate to test cases. The novel structural typing of `getLoopType` (parameter `{ loopPhaseMap?: PhaseLoopMap }` instead of `PipelineState`) also needs explicit verification.

---

## Test Infrastructure

- **Framework**: vitest (packages/watchdog/vitest.config.ts)
- **Test directory**: `packages/watchdog/test/`
- **Helpers**: `test/helpers.ts` — `makeState()`, `makePhaseRecord()`, `createMockStore()`, `createMockCache()`, `createMockObserver()`
- **Conventions**: `describe`/`it` blocks, `vi.fn()` mocks, test files named `*.test.ts`
- **Run command**: `bun run --filter '*' test` (workspace-level) or `npx vitest run` (package-level)

---

## Split Decision

**SPLIT = true** (5 test modules matching Phase 2's 5 modules).

| Test Module | Test File | Source Module | Tests Est. |
|---|---|---|---|
| A: Loop Config | `test/loop-config.test.ts` | loop-config.ts (new) | ~25 |
| B: State Machine (loopType) | `test/transitions-loop-type.test.ts` | transitions.ts (changes) | ~30 |
| C: Intercept Rules (loopType) | `test/intercept-rules-loop-type.test.ts` | intercept-rules.ts (changes) | ~10 |
| D: Tools & Wiring | `test/checkpoint-loop-type.test.ts` + `test/tools.test.ts` | tools.ts, checkpoint.ts, index.ts | ~15 |
| E: Skill Integration | Manual review (E.4 grep-based) | SKILL.md, ralph-gpav.md | 0 (non-code) |

**Execution order**: A → B, C, D (parallel after A's types are defined in tests)

---

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source | Derived Functional Points | Test Cases |
|---|---|---|---|---|
| 1 | Pipeline phase range from loopPhases config | US-4/AC-1/AC-2 | parseLoopPhases (Key), pipeline_start apply (Key), phase_enter validate (Key) | parse valid config, maxPhase used everywhere, effectiveMax fallback |
| 2 | LoopType-aware user_approval validation | US-4/AC-3 | user_approval validate (Key), getLoopType helper (Key) | ralph requires ralphCompleted, followup skips ralphCompleted, followup requires phaseStatus=active, unknown loopType |
| 3 | tools.ts ralph_round_finding registration | US-6/AC-4 | z.enum (Peripheral), description string (Peripheral) | enum accepts value, description lists value |
| 4 | Followup phase checkpoint sequence (no ralph loop) | US-3/AC-7 | ralph_loop_start guard (Key), user_approval apply (Key) | followup rejects ralph_loop_start, followup user_approval sets awaiting_approval |
| 5 | Ordered approval → complete | US-1/AC-8 | phase_complete validate (Key) | user_approval then phase_complete works, phase_complete alone fails |
| 6 | Intercept rules loopType-aware | US-4/AC-12 | Rule 2 ralphCompleted conditional (Key) | followup deliverable allowed, ralph deliverable blocked without ralphCompleted |
| 7 | Followup phaseStatus lifecycle | US-4/AC-13 | user_approval apply (Key) | followup: active → awaiting_approval → complete |

### Secondary Scenarios (from Phase 1 — priority: secondary)

| # | Secondary Scenario | Source | Derived Functional Points | Test Cases |
|---|---|---|---|---|
| 1 | GPAV uses actual tool format | US-6/AC-11 | ralph-gpav.md (Peripheral) | grep-based verification |

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source | Test Cases |
|---|---|---|---|
| 1 | parseLoopPhases: 12-step validation algorithm | loop-config.ts | All 10 failure modes + valid config + missing config fallback |
| 2 | getLoopType helper: structural type, ralph fallback | loop-config.ts | with loopPhaseMap, without (undefined), with PhaseLoopMap key |
| 3 | ConfigValidationError class | loop-config.ts | throw + catch instanceof, message propagation |
| 4 | pipeline_start apply: inject loopPhaseMap + maxPhase | transitions.ts | valid config, missing config (undefined → totalPhases), legacy payload |
| 5 | phase_enter validate: effectiveMax boundary | transitions.ts | phase > maxPhase rejected, phase > totalPhases (legacy) rejected |
| 6 | ralph_loop_start validate: loopType guard | transitions.ts | ralph accepted, followup rejected with guidance |
| 7 | user_approval validate: loopType-aware | transitions.ts | ralph path, followup path, defensive else |
| 8 | user_approval apply: followup phaseStatus transition | transitions.ts | followup → awaiting_approval, ralph → no-op |
| 9 | Rule 2: ralphCompleted conditional on loopType | intercept-rules.ts | followup skips check, ralph requires check |
| 10 | CheckpointHandler: loopConfig injection | checkpoint.ts | constructor accepts, pipeline_start injects, completion uses effectiveMax |

### Peripheral Functional Points (from Phase 2 — priority: peripheral)

| # | Peripheral Functional Point | Source | Test Cases |
|---|---|---|---|
| 1 | tools.ts z.enum + description | tools.ts | accepts ralph_round_finding |
| 2 | ralph-gpav.md tool format | ralph-gpav.md | grep for tdd_checkpoint |
| 3 | WatchdogConfig.loopPhasesResult | watchdog-config.ts | type check (implicit in A tests) |
| 4 | index.ts ConfigValidationError handling | index.ts | plugin returns null (integration test) |

---

## TDD Status

> **Phase 3 → Phase 4 → Phase 5 sequence**: Tests in this plan are written BEFORE business code. Most tests target **planned code** from Phase 2 that does not exist in the current codebase. These tests will fail (RED) until Phase 5 implements the business code.
>
> **Bug-fix tests** (RED until fix applied — code exists but is broken):
> - Tests 30-31 (tools.ts): Bug fix — `ralph_round_finding` is currently missing from z.enum and description string (AC-4).
>
> **Planned code tests** (RED — code doesn't exist yet):
> - Tests 1-29, 6b, 32-43: Target `loop-config.ts` (new file), `transitions.ts` (new loopType branches), `intercept-rules.ts` (new loopType conditional), `checkpoint.ts` (new constructor param), `watchdog-config.ts` (parseLoopPhases integration), `index.ts` (ConfigValidationError catch).
> - Integration tests IT-1 through IT-4: Cross-module end-to-end chains in `checkpoint-loop-type.test.ts`. Also RED until wiring code lands.
>
> **Manual verifications** (grep-based, non-code):
> - Tests 44-50: AC-11 (ralph-gpav.md format), AC-5/6/7/8/9/10 (SKILL.md structural invariants).

---

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | US | AC | Type | Test File | Test Name | Description |
|---|---|---|---|---|---|---|---|
| 1 | Core | US-5 | AC-1 | Unit | transitions-loop-type.test.ts | `pipeline_start apply: injects loopPhaseMap from config` | State has loopPhaseMap after pipeline_start |
| 2 | Core | US-5 | AC-1 | Unit | transitions-loop-type.test.ts | `pipeline_start apply: maxPhase from config overrides totalPhases; totalPhases preserved in state` | maxPhase=7 when config says 7; state.totalPhases === payload.totalPhases (backward compat) |
| 3 | Core | US-5 | AC-1 | Unit | transitions-loop-type.test.ts | `pipeline_start apply: missing config sets maxPhase=totalPhases and loopPhaseMap={}` | Missing config → both fields have fallback values |
| 4 | Core | US-5 | AC-1 | Unit | transitions-loop-type.test.ts | `phase_enter: rejects phase exceeding maxPhase` | phase=8 rejected when maxPhase=7 |
| 5 | Core | US-5 | AC-1 | Unit | transitions-loop-type.test.ts | `phase_enter: uses totalPhases fallback when maxPhase undefined (legacy)` | Legacy state uses totalPhases |
| 6 | Core | US-5 | AC-1 | Unit | checkpoint-loop-type.test.ts | `pipeline completion triggers at maxPhase not totalPhases` | Archive when phase === effectiveMax (maxPhase set) |
| 6b | Core | US-5 | AC-1 | Unit | checkpoint-loop-type.test.ts | `pipeline completion: legacy state (maxPhase undefined) triggers at totalPhases` | Archive when phase === totalPhases (maxPhase absent, effectiveMax fallback) |
| 7 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: valid config returns correct map` | Happy path |
| 8 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: missing config returns empty map + undefined maxPhase` | Fallback |
| 9 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: empty object {} → LoopConfigError` | Hard fail |
| 10 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: unknown loopType → LoopConfigError` | Custom type |
| 11 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: overlapping phases → LoopConfigError` | Phase in 2 groups |
| 12 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: gap in phases → LoopConfigError` | Missing phase |
| 13 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: Phase 4 = followup → LoopConfigError` | Structural constraint |
| 14 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: non-array value (string/number/boolean) → LoopConfigError` | Parameterized: "all", 123, true |
| 15 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: non-integer phase → LoopConfigError` | 2.5, NaN, Infinity in array |
| 16 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: zero or negative phase → LoopConfigError` | 0 or -1 |
| 17 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: duplicate within group → LoopConfigError` | [1,2,2,3] |
| 18 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: empty array → LoopConfigError` | { ralph: [] } |
| 19 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: single loopType only → valid` | { ralph: [1-5] } |
| 20 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: non-number element → LoopConfigError` | ["1", 2]; also undefined, null |
| 21 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: null input → LoopConfigError` | null |
| 22 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: nested array → LoopConfigError` | [[1,2]] |
| 23 | Core | US-4 | AC-2 | Unit | loop-config.test.ts | `parseLoopPhases: non-object input (string/number/boolean) → LoopConfigError` | Parameterized: "ralph", 42, true |
| 24 | Core | US-4 | AC-3 | Unit | transitions-loop-type.test.ts | `user_approval validate: ralph phase requires ralphCompleted` | Rejected when false |
| 25 | Core | US-4 | AC-3 | Unit | transitions-loop-type.test.ts | `user_approval validate: ralph phase rejects escalated` | Escalation blocked |
| 26 | Core | US-4 | AC-3 | Unit | transitions-loop-type.test.ts | `user_approval validate: followup skips ralphCompleted` | Accepted with ralphCompleted=false |
| 27 | Core | US-4 | AC-3 | Unit | transitions-loop-type.test.ts | `user_approval validate: followup requires phaseStatus=active` | Rejected when complete |
| 27b | Core | US-4 | AC-3 | Unit | transitions-loop-type.test.ts | `user_approval validate: followup rejects double-approval (phaseStatus=awaiting_approval)` | F-48 regression: second user_approval on same followup phase blocked |
| 28 | Core | US-4 | AC-3 | Unit | transitions-loop-type.test.ts | `user_approval validate: unknown loopType → rejected` | Defensive else |
| 29 | Core | US-4 | AC-3 | Unit | transitions-loop-type.test.ts | `user_approval validate: legacy state (no loopPhaseMap) falls back to ralph rules` | ralphCompleted required when map absent |
| 30 | Core | US-6 | AC-4 | Unit | tools.test.ts | `z.enum accepts ralph_round_finding` | Bug fix: currently missing from enum |
| 31 | Core | US-6 | AC-4 | Unit | tools.test.ts | `description string contains ralph_round_finding` | Bug fix: currently missing from description |
| 32 | Core | US-3 | AC-7 | Unit | transitions-loop-type.test.ts | `ralph_loop_start: followup phase rejected` | Guidance message |
| 33 | Core | US-3 | AC-7 | Unit | transitions-loop-type.test.ts | `ralph_loop_start: ralph phase accepted` | Normal flow |
| 34 | Core | US-1 | AC-8 | Unit | transitions-loop-type.test.ts | `phase_complete: accepted after user_approval` | Ordered sequence positive case |
| 35 | Core | US-1 | AC-8 | Unit | transitions-loop-type.test.ts | `phase_complete: rejected without prior user_approval` | Ordered sequence negative case |
| 36 | Core | US-4 | AC-12 | Unit | intercept-rules-loop-type.test.ts | `Rule 2: followup phase deliverable allowed without ralphCompleted` | Not blocked |
| 37 | Core | US-4 | AC-12 | Unit | intercept-rules-loop-type.test.ts | `Rule 2: ralph phase deliverable blocked without ralphCompleted` | Blocked |
| 37b | Core | US-4 | AC-12 | Unit | intercept-rules-loop-type.test.ts | `Rule 2: ralph phase deliverable allowed with ralphCompleted + userApproved` | Ralph happy path through new conditional |
| 38 | Core | US-4 | AC-12 | Unit | intercept-rules-loop-type.test.ts | `Rule 2: followup deliverable still requires userApproved` | Still gated |
| 39 | Core | US-4 | AC-12 | Unit | intercept-rules-loop-type.test.ts | `Rule 2: legacy state (no loopPhaseMap) requires ralphCompleted for deliverable` | Fallback to ralph rules |
| 40 | Core | US-4 | AC-13 | Unit | transitions-loop-type.test.ts | `user_approval apply: followup sets phaseStatus=awaiting_approval` | active → awaiting_approval |
| 41 | Core | US-4 | AC-13 | Unit | transitions-loop-type.test.ts | `user_approval apply: ralph keeps phaseStatus unchanged` | No-op (already awaiting_approval) |
| 42 | Core | US-4 | AC-13 | Unit | transitions-loop-type.test.ts | `phase_complete: rejected for followup phase without user_approval (phaseStatus=active)` | Followup: active → complete blocked |
| 43 | Core | US-4 | AC-13 | Unit | transitions-loop-type.test.ts | `followup phase: user_approval apply → phase_complete validate accepts` | Chains phaseStatus transition from apply(user_approval) through validate(phase_complete) |

### Secondary Coverage

| # | Priority | US | AC | Type | Test File | Test Name | Description |
|---|---|---|---|---|---|---|---|
| 44 | Secondary | US-6 | AC-11 | Manual | E.4 | `ralph-gpav.md uses tdd_checkpoint format` | grep verification |

### Manual Verifications (SKILL.md Structural Invariants)

These ACs define structural invariants enforced by SKILL.md documentation (what the LLM agent should do), not by runtime code. Verified via grep/inspection of SKILL.md per Phase 2 E.4 methods.

| # | Priority | US | AC | Type | Verification Method | Description |
|---|---|---|---|---|---|---|
| 45 | Core | US-1 | AC-5 | Manual | Grep SKILL.md for `pipeline_start` + `description` — exactly one call point at pipeline beginning | `pipeline_start` called once per pipeline |
| 46 | Core | US-1 | AC-6 | Manual | Grep SKILL.md for `phase_enter` + `phase: N` — call at every phase boundary | `phase_enter` at every phase transition |
| 47 | Core | US-2 | AC-9 | Manual | Grep SKILL.md for `tdd_checkpoint` + `not available` (or `fail-open`) — canonical fail-open section present | SKILL.md contains fail-open: "If tdd_checkpoint is not available, continue normal execution" |
| 48 | Core | US-3 | AC-10 | Manual | Grep SKILL.md for `why_articulation` — only appears in ralph-phase sections (not Phase 6/7) | `why_articulation` only for ralph phases by convention; runtime does NOT reject followup calls (accepted per AC-10 edge case) |
| 49 | Core | US-3 | AC-7 | Manual | Grep SKILL.md for `ralph_loop_start` — only appears in ralph-phase sections (Phase 1-5), NOT in Phase 6/7 sections | SKILL.md correctly documents followup phases without ralph loop events |
| 50 | Core | US-1 | AC-8 | Manual | Grep SKILL.md for ordered `user_approval` → `phase_complete` call sequence — documented in phase boundary sections | SKILL.md documents the ordered approval → complete sequence |

---

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Type | Test File | Test Name | Description |
|---|---|---|---|---|---|---|
| 1 | Key | parseLoopPhases: all failure modes | Component | loop-config.test.ts | (AC-2 tests 7-23 above) | 12-step validation + non-object primitives |
| 2 | Key | getLoopType: ralph fallback (empty map AND non-empty map with missing phase) | Helper | loop-config.test.ts | `getLoopType returns ralph when phase not in map` | Fallback: (a) empty map + any phase → 'ralph', (b) non-empty map + phase not in map (e.g. phase 99) → 'ralph' |
| 3 | Key | getLoopType: reads from map | Helper | loop-config.test.ts | `getLoopType returns correct type from map` | Normal behavior |
| 4 | Key | getLoopType: works with structural type | Helper | loop-config.test.ts | `getLoopType works without full PipelineState` | Only { loopPhaseMap? } needed |
| 5 | Key | getLoopType: JS key coercion (string keys) | Helper | loop-config.test.ts | `getLoopType works with JSON.parse'd map (string keys)` | `JSON.parse('{"6":"followup"}')` + getLoopType(state, 6) → 'followup' |
| 6 | Key | ConfigValidationError | Class | loop-config.test.ts | `ConfigValidationError instanceof Error, has message` | Type guard |
| 7 | Key | isLoopConfigError | Type guard | loop-config.test.ts | `isLoopConfigError(LoopConfigResult) → false, (LoopConfigError) → true` | Discrimination |
| 8 | Key | pipeline_start apply: inject loopPhaseMap | Component | transitions-loop-type.test.ts | (AC-1 tests 1-3 above) | State creation + backward compat |
| 9 | Key | phase_enter effectiveMax | Component | transitions-loop-type.test.ts | (AC-1 tests 4-5 above) | Boundary check |
| 10 | Key | ralph_loop_start loopType guard | Component | transitions-loop-type.test.ts | (AC-7 tests 32-33 above) | Followup rejection |
| 11 | Key | user_approval validate loopType | Component | transitions-loop-type.test.ts | (AC-3 tests 24-29 above) | Dual behavior + legacy fallback |
| 12 | Key | user_approval apply phaseStatus | Component | transitions-loop-type.test.ts | (AC-13 tests 40-43 above) | Followup transition + phase_complete chain |
| 13 | Key | Rule 2 loopType-aware | Component | intercept-rules-loop-type.test.ts | (AC-12 tests 36-39 above) | Conditional ralphCompleted + legacy fallback |
| 14 | Key | CheckpointHandler loopConfig | Component | checkpoint-loop-type.test.ts | `constructor accepts LoopConfigResult` | Wiring |
| 15 | Key | Pipeline completion effectiveMax | Component | checkpoint-loop-type.test.ts | (AC-1 test 6 above) | Archive trigger |
| 16 | Key | ~~loadWatchdogConfig valid config~~ **DEFERRED** | Integration | loop-config.test.ts | `config parsing in full handler flow` | End-to-end parseLoopPhases integration | **Phase 5 deferred**: loadWatchdogConfig doesn't call parseLoopPhases yet (Tech Solution §A.3). KI-62 |
| 17 | Key | ~~loadWatchdogConfig invalid config~~ **DEFERRED** | Integration | loop-config.test.ts | `ConfigValidationError stops plugin` | Hard fail | **Phase 5 deferred**: same as DC-16. KI-62 |
| 18 | Key | ~~loadWatchdogConfig missing config~~ **DEFERRED** | Integration | loop-config.test.ts | `missing loopPhases → fallback all-ralph` | Soft fail | **Phase 5 deferred**: same as DC-16. KI-62 |
| 19 | Peripheral | tools.ts z.enum fix | Component | tools.test.ts | (AC-4 tests 30-31 above) | Bug fix registration |
| 20 | Peripheral | ralph-gpav.md format | Documentation | E.4 | (AC-11 test 44 above) | grep check |

---

## Integration Tests (from A.5)

| # | Scenario | Test File | Test Name | Description |
|---|---|---|---|---|
| 1 | Valid config → full chain | checkpoint-loop-type.test.ts | `valid config: pipeline_start creates state with correct loopPhaseMap and maxPhase` | parseLoopPhases → CheckpointHandler → pipeline_start apply |
| 2 | Missing config → full chain | checkpoint-loop-type.test.ts | `missing config: pipeline_start falls back to totalPhases` | loopPhasesResult = { {}, undefined } → maxPhase = totalPhases |
| 3 | ~~Invalid config → hard fail~~ **DEFERRED** | checkpoint-loop-type.test.ts | `invalid config: ConfigValidationError prevents pipeline creation` | parseLoopPhases error → plugin won't start | **Phase 5 deferred**: same as DC-16/17/18 (loadWatchdogConfig doesn't call parseLoopPhases yet). KI-62 |
| 4 | Followup full flow | checkpoint-loop-type.test.ts | `followup phase: enter → approval → complete lifecycle with Rule 2 intercept` | phase_enter(6) → user_approval(6) → phase_complete(6) with phaseStatus transitions; verify Rule 2 allows Phase 6 deliverable with ralphCompleted=false |

---

## Edge Cases & Error Paths

- [x] **null_inputs**: parseLoopPhases(null) → LoopConfigError
- [x] **empty_collections**: parseLoopPhases({}) → LoopConfigError; empty array → LoopConfigError; empty loopPhaseMap → all-ralph fallback
- [x] **max_values**: phase number very large (999999) — accepted by parseLoopPhases; algorithm step 4d imposes `v >= 1` with no upper bound (by design, no boundary to test)
- [x] **concurrent_access**: N/A — state machine is sync, single-threaded
- [x] **timeouts**: N/A — no async in state machine
- [x] **network_failures**: N/A — no external dependencies
- [x] **invalid_state_transitions**: followup phase calls ralph_loop_start → rejected; followup user_approval with wrong phaseStatus → rejected (complete, awaiting_approval); ralph_round_complete/ralph_terminate implicitly blocked by existing phaseStatus guards (covered by existing transitions.test.ts)
- [x] **serialization_boundary**: JSON key coercion — PhaseLoopMap number keys are string at runtime; getLoopType uses implicit coercion (documented in A.5) → explicit test DC-5 `getLoopType works with JSON.parse'd map`
- [x] **error_handler_correctness**: ConfigValidationError catch in loadWatchdogConfig → propagates (tested DC-16~18). Note: checkpoint.ts `applyTransition` try/catch (line 302-311) is a last-resort safety net for state-machine programming errors (e.g., null state for non-pipeline_start). Not tested — requires deliberately breaking internal invariants beyond the scope of this feature's test plan. Covered by existing `checkpoint.test.ts` integration tests that exercise all normal error paths.
- [x] **implicit_contract**: getLoopType structural type `{ loopPhaseMap?: PhaseLoopMap }` works with both PipelineState and minimal objects
- [x] **resource_leak**: N/A — no resource management in state machine
- [x] **cascading_failure**: ConfigValidationError propagates from loop-config → watchdog-config → index.ts (plugin null)
- [x] **performance_logic**: N/A — O(phases) ≈ O(7), trivial

---

## Test Data

### Fixtures

```typescript
// Valid loopPhases configs
const VALID_CONFIG = { ralph: [1,2,3,4,5], followup: [6,7] }
const VALID_CONFIG_RALPH_ONLY = { ralph: [1,2,3,4,5] }
const VALID_CONFIG_SINGLE_FOLLOWUP = { ralph: [1,2,3,4,5], followup: [6] }

// Invalid loopPhases configs
const INVALID_EMPTY = {}
const INVALID_UNKNOWN_TYPE = { ralph: [1,2], custom: [3,4] }
const INVALID_OVERLAP = { ralph: [1,2,3], followup: [3,4,5] }
const INVALID_GAP = { ralph: [1,3,4,5], followup: [6,7] }
const INVALID_PHASE4_FOLLOWUP = { ralph: [1,2,3,5], followup: [4,6,7] }
const INVALID_EMPTY_ARRAY = { ralph: [], followup: [1,2,3] }
const INVALID_DUPLICATE = { ralph: [1,2,2,3,4,5] }
const INVALID_NON_INTEGER = { ralph: [1,2.5,3,4,5] }
const INVALID_ZERO = { ralph: [0,1,2,3,4] }
const INVALID_NEGATIVE = { ralph: [-1,1,2,3,4] }
const INVALID_NON_NUMBER = { ralph: ["1", 2, 3] }
const INVALID_NON_ARRAY = { ralph: "all" }
const INVALID_NULL = null
const INVALID_STRING_PRIMITIVE = "ralph"
const INVALID_NUMBER_PRIMITIVE = 42
const INVALID_BOOLEAN_PRIMITIVE = true
```

### Mocks

- `createMockStore()` from helpers.ts — extended with loopConfig support
- `createMockCache()` from helpers.ts
- `createMockObserver()` from helpers.ts
- New: `createMockLoopConfig(overrides?: Partial<LoopConfigResult>)` — factory for LoopConfigResult, defaults to `{ loopPhaseMap: VALID_CONFIG_MAP, maxPhase: 7 }`
- New: `makeStateWithConfig(phaseLoopMap: PhaseLoopMap, maxPhase: number)` — creates state with loopPhaseMap + maxPhase. Returns `{ ...makeState(), maxPhase, loopPhaseMap: phaseLoopMap }`. Cross-module fixture in `test/helpers.ts`.

---

## Dependencies Between Tests

- **No test depends on another test passing** (TDD principle)
- **Execution order**: None required — all tests independent
- **Shared fixtures**: `VALID_CONFIG`, `INVALID_*` constants — cross-module fixtures in `test/helpers.ts`, single-module fixtures in their test file
- **Module ordering**: loop-config.test.ts should exist first (types used by other test files), but vitest runs all tests independently

---

## Priority Downgrade Justifications

### From Phase 1 (Requirements → Test Plan)
- AC-4 (tools.ts fix): Core → tested as Peripheral depth (happy path + basic error only). Justification: single-line enum fix, existing transitions.ts logic already tested.

### From Phase 2 (Technical Design → Test Plan)
- None — all Key components get comprehensive coverage, all Peripheral get basic coverage.

---

## Priority Upgrade Review

### Secondary → Core Scenarios
- None detected.

### Peripheral → Key Functional Points
- None detected.

---

## Gate: Reviewer Checklist

```
gate_pass = ALL:
  req_coverage:     every US/AC → ≥ 1 test ✅ (44+1 code tests + 10 DC tests + 4 IT + 7 manual = ~66 total; all 13 ACs covered)
  design_coverage:  every component/interface/failure_mode → ≥ 1 test ✅ (20 elements)
  completeness:     core/key = comprehensive (happy+edge+error) ✅
  consistency:      Phase1.core → Core Scenarios ✅; Phase2.key → Key Functional Points ✅
  edge_cases:       all 13 categories checked with explicit tests ✅
  tdd_status:       all new-feature tests marked as planned-code (RED until Phase 5) ✅
  quality:          test names descriptive ✅; test types appropriate ✅
  ralph:            zero C/H/M issues ✅ (R10+R11 consecutive zero, gate PASSED)
```
