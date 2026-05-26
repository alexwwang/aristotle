# Known Issues — Phase 4 Test Code

## Active KI Entries

### KI-01: TestPreRollbackCommit misplaced in rollback_engine test file
- **Raised-in**: R6
- **Re-raised-in**: R7, R8, R9, R10, R11, R12, R13, R14
- **Severity**: P (Proposal)
- **File**: `tests/test_rollback_engine.py::TestPreRollbackCommit`
- **Description**: Test name says "preserve Phase 5 work via pre-rollback commit" but RollbackEngine doesn't handle pre-commits — that's InterventionCoordinator's responsibility. Test uses weak `isinstance(result, RollbackResult)` assertion.
- **Why deferred**: Test plan row 50 explicitly places this test in rollback_engine.py. Behavior is tested more thoroughly in integration test (row 51). Not a correctness issue — test name is misleading but test still drives correct stub behavior.
- **Plan**: Consider renaming to `test_should_dispatch_rollback_for_v4_from_phase5_context` during Phase 5 Green phase.

### KI-02: Weak isinstance assertions in 3 PromptValidator/KiDocManager tests
- **Raised-in**: R8
- **Re-raised-in**: R9, R10, R11, R12, R13, R14
- **Severity**: L (Low)
- **Files**:
  - `tests/test_prompt_validator.py::TestLongPromptTruncation` — `isinstance(result, ValidationResult)`
  - `tests/test_prompt_validator.py::TestPartialCodeBlock` — `isinstance(result, ValidationResult)`
  - `tests/test_ki_doc_manager.py::TestKiDocOutdatedDetection` — `isinstance(result, bool)`
- **Description**: These 3 tests only assert type, not specific behavioral values. During TDD Red phase these assertions are unreachable (stubs raise NotImplementedError). Once implemented, tests would pass regardless of actual return value.
- **Why deferred**: TDD Red phase — assertions are unreachable. Will strengthen in Phase 5 Green phase when stubs are implemented.
- **Plan**: Add explicit `assert result.is_valid is True/False` and `assert result.matches == []` during Green phase.

### KI-03: TestFP7IndividualWords tests "skip" — vacuously true
- **Raised-in**: R12
- **Re-raised-in**: R13, R14
- **Severity**: L (Low)
- **File**: `tests/test_prompt_validator.py::TestFP7IndividualWords`
- **Description**: Test asserts "skip" isn't flagged as FP-7, but "skip" doesn't appear in any FP-7 pattern. Test intent is correct but input doesn't exercise the boundary condition.
- **Why deferred**: Low severity — test is vacuously true but doesn't test wrong behavior.
- **Plan**: Change input to an actual FP-7 word fragment like "only" to test word boundary protection.

### KI-04: V-6 (MISSING_TEST) target_phase not explicitly asserted in plan building
- **Raised-in**: R11
- **Re-raised-in**: R12, R13, R14
- **Severity**: P (Proposal)
- **File**: `tests/test_intervention_coordinator.py::TestPlanBuilding`
- **Description**: V-6 plan building test asserts `auto_fix` and `is_destructive` but doesn't verify `target_phase == 4` or `needs_rollback`. Other plan tests check more fields.
- **Why deferred**: 3 of 4 plan fields tested, missing field is implied by design. Low risk.
- **Plan**: Add `assert plan.target_phase == 4` and `assert plan.needs_rollback is True` during Phase 5.

### KI-05: Mock PatternMatch category uses "stop_condition" instead of "FP-1"
- **Raised-in**: R12
- **Re-raised-in**: R13, R14
- **Severity**: I (Info)
- **File**: `tests/test_intervention_coordinator.py::TestSyncMode`
- **Description**: SyncMode test mock uses `category="stop_condition"` instead of design's FP-1..FP-7 scheme. No functional impact — test only checks TDDViolationError is raised.
- **Why deferred**: Informational — mock data cosmetic issue.
- **Plan**: Update mock to `category="FP-1"` during Phase 5 for consistency.

### KI-06: E2E preserve-on-rollback test doesn't verify git history post-condition
- **Raised-in**: R13
- **Severity**: L (Low)
- **File**: `tests/test_intervention_integration.py::TestE2EPreserveCommittedWork`
- **Description**: Test only asserts TDDViolationError is raised. Doesn't verify Phase 5 commit remains in git history after rollback — the key post-condition per test plan integration scenario 4.
- **Why deferred**: TDD Red phase — assertion unreachable. Will add post-condition check in Green phase.
- **Plan**: Add `git log` assertion after TDDViolationError during Phase 5.

### KI-07: E2E rollback failure test name misleading
- **Raised-in**: R12
- **Re-raised-in**: R13
- **Severity**: P (Proposal)
- **File**: `tests/test_intervention_integration.py::TestE2ERollbackFailure`
- **Description**: Test uses "nonexistent.py" which succeeds (untracked + doesn't exist = graceful success). Name says "failure" but tests a success path.
- **Why deferred**: Test verifies graceful handling, which IS the intended behavior. Name is misleading but behavior is correct.
- **Plan**: Rename to `test_should_end_to_end_handle_nonexistent_file_gracefully` or use a file that genuinely fails.

### KI-08: MODIFIED_TEST SYNC mode test uses phase=4 instead of phase=5
- **Raised-in**: R11
- **Severity**: P (Proposal)
- **File**: `tests/test_intervention_coordinator.py::TestSyncMode`
- **Description**: `("MODIFIED_TEST", "src/mod.py", 4, {})` — MODIFIED_TEST is a Phase 5 violation by design. Using phase=4 is semantically misleading, though `_build_plan` ignores event phase for V-5.
- **Why deferred**: No functional impact — `_build_plan` hardcodes target_phase=5 regardless.
- **Plan**: Change to `phase=5` for semantic accuracy during Phase 5.

### KI-09: V-9 routing test has incomplete assertions
- **Raised-in**: R13
- **Severity**: L (Low)
- **File**: `tests/test_intervention_coordinator.py::test_should_route_v9_ki_doc_outdated_to_auto_append`
- **Description**: Test plan row 19b expects verification of ensure_updated → record_intervention → commit → TDDViolationError. Test only asserts ensure_updated.called and TDDViolationError.
- **Why deferred**: Missing assertions for record_intervention and ensure_committed. Non-blocking for Red phase.
- **Plan**: Add missing assertions during Phase 5.

### KI-10: Design pseudocode missing multi-file rollback logic for affected_file_paths
- **Raised-in**: R16
- **Severity**: P (Proposal)
- **Description**: Test plan row 74 requires multi-file partial failure handling via `affected_file_paths`. RollbackEngine design pseudocode only shows single `affected_file_path` processing. Phase 5 implementation must add multi-file iteration and partial failure aggregation to RollbackEngine.
- **Why deferred**: Design gap tracked in Open Questions #11/#12. Implementation concern for Phase 5, not Phase 4 test correctness.
- **Plan**: Update Phase 2 design pseudocode in Phase 5 to include `for path in event.affected_file_paths` iteration with partial_failure tracking.

### KI-11: FP-7 ZH "只检查" pattern untested
- **Raised-in**: R16
- **Severity**: L (Low)
- **File**: `tests/test_prompt_validator.py::TestFP7ZH`
- **Description**: Design specifies ZH FP-7 pattern `只检查[\w\u4e00-\u9fff]+` but test only covers "不要审查", "限制范围", "跳过审查". Missing "只检查" variant.
- **Why deferred**: Low severity — 3 of 4 ZH patterns tested.
- **Plan**: Add "只检查导入部分" to phrase list during Phase 5.

### KI-12: Test plan design coverage matrix test name mismatch
- **Raised-in**: R16
- **Severity**: P (Proposal)
- **File**: `docs/03-intervention-test-plan.md` row 23
- **Description**: Matrix references `should_only_trigger_prompt_validation_for_invalid_review_prompt` but actual test is `should_dispatch_to_prompt_validator_only_for_v13`.
- **Why deferred**: Traceability gap only, no correctness impact.
- **Plan**: Update test plan to match actual test name.

## Resolved KI Entries

### KI-RESOLVED-01: Hardcoded sys.path.insert with absolute path
- **Raised-in**: R6
- **Re-raised-in**: R7, R8, R9, R10, R11, R12, R13, R14
- **Resolved-in**: Pre-R15 (commit a806382)
- **Resolution**: Replaced with `os.path.join(os.path.dirname(__file__), "..", "src")` in all 6 test files.

### KI-RESOLVED-02: Multi-file partial rollback test used space-separated path string
- **Raised-in**: R11 (as H), R12, R13, R14 (as M)
- **Resolved-in**: Pre-R15 (commit a806382)
- **Resolution**: Added `affected_file_paths: List[str]` field to ViolationEvent. Updated test to use explicit list instead of space-separated string.

## KI Re-evaluation History

| Round | Action | Notes |
|-------|--------|-------|
| R15 | Initial creation | All deferred P/L findings from R6-R14 cataloged |
| R16 | KI re-eval (R15+1) | Added KI-10 (design gap), KI-11 (FP-7 ZH), KI-12 (name mismatch). All 9 existing KI confirmed correct severity. |
