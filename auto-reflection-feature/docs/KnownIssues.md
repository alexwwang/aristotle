# Known Issues — Phase 4 Test Code

## Active KI Entries

### KI-03: TestFP7IndividualWords tests "skip" — vacuously true
- **Raised-in**: R12
- **Re-raised-in**: R13, R14
- **Severity**: L (Low)
- **File**: `tests/test_prompt_validator.py::TestFP7IndividualWords`
- **Description**: Test asserts "skip" isn't flagged as FP-7, but "skip" doesn't appear in any FP-7 pattern. Test intent is correct but input doesn't exercise the boundary condition.
- **Why deferred**: Low severity — test is vacuously true but doesn't test wrong behavior.
- **Plan**: Change input to an actual FP-7 word fragment like "only" to test word boundary protection.

### KI-05: Mock PatternMatch category uses "stop_condition" instead of "FP-1"
- **Raised-in**: R12
- **Re-raised-in**: R13, R14
- **Severity**: I (Info)
- **File**: `tests/test_intervention_coordinator.py::TestSyncMode`
- **Description**: SyncMode test mock uses `category="stop_condition"` instead of design's FP-1..FP-7 scheme. No functional impact — test only checks TDDViolationError is raised.
- **Why deferred**: Informational — mock data cosmetic issue.
- **Plan**: Update mock to `category="FP-1"` for consistency.

### KI-06: E2E preserve-on-rollback test doesn't verify git history post-condition
- **Raised-in**: R13
- **Severity**: L (Low)
- **File**: `tests/test_intervention_integration.py::TestE2EPreserveCommittedWork`
- **Description**: Test only asserts TDDViolationError is raised. Doesn't verify Phase 5 commit remains in git history after rollback — the key post-condition per test plan integration scenario 4.
- **Why deferred**: Requires actual git history assertion infrastructure. Low risk — pre-rollback commit is tested in unit tests.
- **Plan**: Add `git log` assertion during v2.

### KI-10: Design pseudocode missing multi-file rollback logic for affected_file_paths
- **Raised-in**: R16
- **Severity**: P (Proposal)
- **Description**: Test plan row 74 requires multi-file partial failure handling via `affected_file_paths`. RollbackEngine design pseudocode only shows single `affected_file_path` processing. Implementation exists but design doc not updated.
- **Why deferred**: Documentation-only gap. Code implementation is complete and tested.
- **Plan**: Update Phase 2 design pseudocode to match implementation.

### KI-12: Test plan design coverage matrix test name mismatch
- **Raised-in**: R16
- **Severity**: P (Proposal)
- **File**: `docs/03-intervention-test-plan.md` row 23
- **Description**: Matrix references `should_only_trigger_prompt_validation_for_invalid_review_prompt` but actual test is `should_dispatch_to_prompt_validator_only_for_v13`.
- **Why deferred**: Traceability gap only, no correctness impact.
- **Plan**: Update test plan to match actual test name.

### KI-13: _validate_path("") returns True for empty string
- **Raised-in**: Phase 5 R3 (Oracle)
- **Re-raised-in**: R4, R5
- **Severity**: L (Low)
- **Description**: `RollbackEngine._validate_path("")` returns True because `os.path.normpath(os.path.join(repo_root, ""))` equals `repo_root`. However, this edge case is unreachable — all callers guard with `if event.affected_file_path` (empty string is falsy in Python).
- **Why deferred**: Unreachable in production. Defense-in-depth only.
- **Plan**: No action needed.

### KI-14: No exception handling for git subprocess FileNotFoundError
- **Raised-in**: Phase 5 R4 (Oracle)
- **Re-raised-in**: R5
- **Severity**: I (Info)
- **Description**: CommitGuard and RollbackEngine call `subprocess.run(["git", ...])` without try/except for `FileNotFoundError`. If git is not installed, these calls would crash with an unhandled exception rather than raising a clean `TDDViolationError`.
- **Why deferred**: Git unavailable = broken environment. The entire system depends on git. Adding FileNotFoundError handling for every subprocess call adds complexity with no practical benefit.
- **Plan**: No action needed.

### KI-15: PatternMatch.line_number based on stripped text, not original prompt
- **Raised-in**: Phase 5 R5 (Oracle)
- **Severity**: I (Info)
- **Description**: `PatternMatch.line_number` is computed from text after code blocks, inline code, quoted text, and headings are stripped. The line number doesn't correspond to the original prompt's line numbers.
- **Why deferred**: The field is stored but never displayed to users — ki doc entry only renders `category:pattern`. No functional impact.
- **Plan**: If line numbers are ever surfaced to users, recompute from original prompt with offset tracking.

### KI-16: No test coverage for git FileNotFoundError
- **Raised-in**: Phase 5 R5 (Oracle)
- **Severity**: I (Info)
- **Description**: No test for the scenario where `subprocess.run(["git", ...])` raises `FileNotFoundError`. Related to KI-14.
- **Why deferred**: Testing git unavailability requires mocking `subprocess.run` globally, which is fragile. The behavior (crash) is acceptable for broken environments.
- **Plan**: No action needed.

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

### KI-RESOLVED-03: CommitGuard hash from git commit stdout instead of git rev-parse
- **Raised-in**: Phase 5 R0 (Oracle)
- **Resolved-in**: Phase 5 R0 fix
- **Resolution**: Added 3rd subprocess call `git rev-parse --short HEAD` after commit. Updated test mocks to provide 3 side_effect entries.

### KI-RESOLVED-04: Coordinator pre-rollback git add without path validation
- **Raised-in**: Phase 5 R0 (Oracle, H-1)
- **Resolved-in**: Phase 5 R0 fix
- **Resolution**: Added `self.rollback_engine._validate_path(event.affected_file_path)` check before `git add` in coordinator step 6.

### KI-RESOLVED-05: REGRESSION plan conditionally set auto_fix=True, contradicts design spec
- **Raised-in**: Phase 5 R0 (Oracle, H-2)
- **Resolved-in**: Phase 5 R0 fix
- **Resolution**: REGRESSION plan now always uses `auto_fix=False, needs_rollback=False, is_destructive=False`, matching design spec.

### KI-RESOLVED-06: Pre-rollback commit condition deviated from design spec
- **Raised-in**: Phase 5 R0 (Oracle, H-3)
- **Resolved-in**: Phase 5 R0 fix
- **Resolution**: Split into two conditions: pre-rollback commit uses `plan.is_destructive or plan.target_phase < current_phase` (design spec), rollback execution uses `plan.auto_fix and plan.needs_rollback`.

## KI Re-evaluation History

| Round | Action | Notes |
|-------|--------|-------|
| R15 | Initial creation | All deferred P/L findings from R6-R14 cataloged |
| R16 | KI re-eval (R15+1) | Added KI-10 (design gap), KI-11 (FP-7 ZH), KI-12 (name mismatch). All 9 existing KI confirmed correct severity. |
