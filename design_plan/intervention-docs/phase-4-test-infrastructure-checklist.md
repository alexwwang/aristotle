# Phase 4 Test Infrastructure Checklist

> **Status**: Active — mandatory gate before Ralph review loop starts.  
> **Source**: Checkpoint Integration Phase 4 retrospective (R10–R31, 22 review rounds).  
> **Problem**: Ralph loop failed to converge because structural infrastructure issues were repeatedly re-discovered by independent reviewers. These issues were not business logic errors but test environment setup gaps that should have been caught before the review loop began.

---

## 1. Problem Statement

During the Checkpoint Integration Phase 4 TDD review (R10–R31), the Ralph loop ran **22 rounds** but could not reach the stop condition ("2 consecutive rounds with zero new C/H/M findings"). The root cause was not insufficient review quality — it was **structural test infrastructure gaps** that every independent reviewer correctly identified:

| Issue | Times Re-discovered | Category |
|-------|-------------------|----------|
| CheckpointHandler constructor signature mismatch (KI-63) | Every round | Constructor |
| PipelineState missing optional fields (KI-65) | ~60% of rounds | Schema |
| INVALID_EMPTY_ARRAY fixture design debate | ~40% of rounds | Fixture |
| IT-2 missing maxPhase assertion | 1 round | Assertions |
| IT-3 missing DEFERRED annotation in test plan | 2 rounds | Plan sync |
| mockClassification duplicated across test files | 3 rounds | DRY |

**Key insight**: These are **not business logic errors**. They are test environment completeness issues. The Ralph loop is designed to find test correctness problems, not infrastructure gaps. Running a Ralph loop before verifying infrastructure is like running tests before ensuring they compile.

---

## 2. Mechanism

### Why these issues recur

The Ralph loop uses **independent reviewers** (clean context, no prior findings). This means:

1. Each reviewer independently discovers the same infrastructure gap
2. The gap gets reported as M or L severity
3. The reviewer cannot know it was already reported and documented in a KI
4. The stop condition requires zero M/L, so documented KIs don't help
5. The loop never converges

### Why these issues exist

Phase 4 TDD creates tests **before** business code. The tests target a **planned API** that doesn't exist yet. Without explicit infrastructure checks:

- **Schema gaps**: Tests access fields (`loopPhaseMap`, `maxPhase`) not yet defined in the type system
- **Constructor gaps**: Tests instantiate classes with parameters not yet accepted
- **Assertion gaps**: Tests verify some but not all output fields
- **DRY gaps**: Helpers copy-pasted across files instead of shared
- **Fixture gaps**: Fixtures trigger multiple validation errors, reducing discriminatory power
- **Plan drift**: Code changes (removing tests, renaming) not reflected in test plan

### Why Phase 4 stubs didn't cover this

Phase 4 creates **function stubs** (e.g., `parseLoopPhases` throws STUB). But stubs only cover **new functions**. They don't cover:
- **Schema changes** (adding optional fields to existing interfaces)
- **Constructor changes** (adding parameters to existing classes)
- **Helper infrastructure** (shared test utilities)

These are **structural prerequisites** that make tests compilable and runnable — not business logic.

---

## 3. Solution: Test Infrastructure Checklist

Add a mandatory checklist **between test code completion and Ralph review start**. This checklist catches structural issues that would otherwise cycle through the review loop.

### Checklist

```
Phase 4 Test Infrastructure Checklist
═══════════════════════════════════════

□ Schema: Every field accessed by tests exists in the type definition
  - For each test file, grep for property access (result.X, state.X, writtenState.X)
  - Verify each accessed property is defined in the corresponding interface/type
  - If not: add optional field to schema (minimal stub — undefined by default)

□ Constructor: Every class instantiated by tests accepts the test's arguments
  - For each `new ClassName(...)` call, count positional arguments
  - Compare against current constructor signature
  - If mismatch: add parameter to constructor (optional, ignored — minimal stub)

□ Assertions: Each test verifies all relevant output fields for its claim
  - For each test, list what the test claims to verify (from test name + plan)
  - Check that assertions cover all fields mentioned in the claim
  - If missing: add assertion for the uncovered field

□ DRY: Cross-file helpers are extracted to shared helpers.ts
  - Grep for identical function definitions across test files
  - Extract duplicates to helpers.ts, import in consuming files

□ Fixture: Each fixture triggers exactly one validation error
  - For each invalid fixture, trace through the validation algorithm
  - Count how many distinct errors the fixture would trigger
  - If >1: redesign fixture to trigger only the target error
  - Document intentional deviations (e.g., for discriminatory power)

□ Plan sync: Test code changes are reflected in the test plan
  - After test code is finalized, diff against test plan
  - Verify every test in code maps to a plan entry
  - Verify every plan entry maps to a test (or is marked DEFERRED)
  - Update plan for: renamed tests, removed tests, added tests, fixture changes
```

### When to run

```
Phase 4 flow:

1. Write stubs (new functions throw STUB)
2. Write test code
3. ★ Run Test Infrastructure Checklist ← NEW
4. Run Ralph review loop
5. Gate pass
```

### Expected impact

Based on the Checkpoint Integration experience:

| Metric | Without Checklist | With Checklist |
|--------|------------------|----------------|
| Ralph rounds to converge | 22+ (didn't converge) | ~4–6 (estimated) |
| Rounds wasted on infrastructure | ~15 | 0 |
| Reviewer re-discoveries of same issue | 3–22 per issue | 0 |
| False confidence from "consecutive zero" claims | 2 incidents | 0 |

---

## 4. Implementation Notes

### Schema stubs are not business logic

Adding `loopPhaseMap?: PhaseLoopMap` and `maxPhase?: number` to `PipelineState` is a **type-level stub**, equivalent to adding a `throw new Error('STUB')` function body. The fields are optional and default to `undefined`. No runtime behavior changes. Tests that access these fields will now:
- **Compile**: TypeScript accepts the property access
- **Fail at assertion**: `undefined !== expectedValue` → clean RED

### Constructor stubs are not business logic

Adding `loopConfig?: LoopConfigResult` as a constructor parameter that is stored but never read is a **structural stub**. The constructor accepts the parameter (tests compile), but `handle()` doesn't use it yet (tests still RED at assertion). The existing code path is unchanged — the parameter is simply ignored.

### Fixture design principle

A fixture should have **exactly one reason to fail**. If a fixture `{ ralph: [], followup: [1,2,3] }` is meant to test "empty array rejection" (step 4c), it should not also trigger "gap in phases" (step 4e) or "missing ralph phases" (step 4f). A discriminating fixture like `{ ralph: [1,2,3,4,5,6,7], followup: [] }` isolates the empty-array error because ralph covers all phases — no gap, no missing phases.

However, this principle can conflict with the test plan's specified fixtures. When deviating for discriminatory power, **document the deviation and rationale**.

---

## 5. History

| Date | Project | Phase | Issue | Rounds Lost |
|------|---------|-------|-------|-------------|
| 2026-05-21 | Checkpoint Integration | Phase 4 | KI-63: Constructor mismatch | ~15 |
| 2026-05-21 | Checkpoint Integration | Phase 4 | KI-65: Missing schema fields | ~8 |
| 2026-05-21 | Checkpoint Integration | Phase 4 | Fixture discriminatory power debate | ~4 |
| 2026-05-21 | Checkpoint Integration | Phase 4 | IT-2 missing assertion | 1 |
| 2026-05-21 | Checkpoint Integration | Phase 4 | IT-3 plan drift | 2 |
| 2026-05-21 | Checkpoint Integration | Phase 4 | mockClassification DRY | 3 |

**Total rounds lost to infrastructure**: ~33 review-round equivalents across the R10–R31 span.
