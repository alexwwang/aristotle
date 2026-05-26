# Test Plan: Watchdog Intervention for TDD Pipeline

> **Version**: v1.6
> **Status**: v1.6 — Ralph Loop R4 in progress (latest PF: 0C/1H/2M/2L)
> **Branch**: feature/watchdog-intervention
> **Phase**: 3 (Test Plan)
> **Based on**: intervention-requirements-v1.md (v1.4), 02-intervention-technical-solution.md (v1.7)
> **Date**: 2026-05-26
> **Changelog v1.6**: Align with spec v1.7 — ZH bare patterns/AC-I19 (was lookaround), dynamic target_phase/AC-I8 (was hardcoded), REGRESSION instruction/AC-I9 clarified, dual field model (affected_file_paths), 6 new test rows (#77-82), factory updated, R0 Precision Filter fixes (F-01 OQ stale, F-03 unreachable path, F-04 AC-I20 trace, F-05 dupe changelog, F-07 empty prompt trace), R1 Precision Filter fixes (F-01 V-9 integration test #8, F-02 full instruction text, F-03 dual field precedence test #79b), R2 Precision Filter fixes (F-01 OQ status column + IMPL-ACTION markers, F-02 V-5 dynamic target_phase, F-03 V-9/V-11 sample data, F-05 Scenario 21 table fix, F-06 test #20b rename)
> **Changelog v1.5**: R4 fixes — 0C/0H/3M from Precision Filter (F-34 Design Coverage renumber, F-36 V-9 auto-append description, F-39 _handle_merged commit-only path)
> **Changelog v1.3**: R3 fixes — 0C/0H/2M from Precision Filter (F-32 _handle_merged partial-merge trace, F-33 same-priority tie-breaking trace)
> **Changelog v1.2**: R2 fixes — 1H/4M from Precision Filter (F-25 pre-rollback commit failure, F-26 V-9 coordinator test, F-29 git add failure, F-30 CommitGuard untracked ambiguity, F-27 _is_valid_event coverage)
> **Changelog v1.1**: R1 fixes — 1H/12M from Precision Filter (F-01 V-7 flaky test, F-02 V-13 missing prompt, F-03 partial code block, F-04 V-5 scope note, F-05/F-06 untraced tests, F-08 ISO 8601 regex, F-09 leading-dash, F-11 req_number, F-12 V-7 baseline, F-13 V-2/V-3 plans, F-14 test count, F-15 V-7 integration, F-24 empty round_results)

---

## Why Articulation

Phase 3 protects the alignment between test coverage and requirements. The Watchdog Intervention feature has 13 violation types, 22 acceptance criteria, and 5 components with 10 documented failure modes. Without a structured test plan, tests could miss critical intervention paths — a skipped rollback test means V-4 could delete implementation without a safety net, or V-5 could restore the wrong test version.

Core risks this phase addresses:

1. **Coverage gaps**: 13 violation types × multiple code paths each. Missing any means an intervention path is untested.
2. **Priority inversion**: All 10 user stories are Core and 4 of 5 components are Key — every test scenario needs comprehensive depth (happy + edge + error). Only CommitGuard is Peripheral.
3. **Merge Rule complexity**: V-8/V-9/V-10/V-11/V-12 interact in a specific execution order. Incorrect ordering means commits happen after ki doc updates (data loss risk) or assessment runs before commit (incomplete data).
4. **Cross-component data flow**: InterventionResult aggregates results from multiple sub-components. Each field must be tested for both success and failure propagation.

Approach: One test file per component (5 files) plus one integration test file for cross-component flows. Every AC traced to ≥1 test case. Every failure mode traced to ≥1 test case. All 13 edge case categories audited.

---

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

All 10 user stories are Core. No secondary stories exist.

| # | Core Scenario | Source (User Story/AC) | Derived Functional Points | Test Cases |
|---|--------------|------------------------|--------------------------|------------|
| 1 | Block LLM when Ralph Loop skipped (Phase 1-3) | US-I1 (Core) / AC-I1 | InterventionCoordinator._build_plan (V-1), _is_valid_event | happy: SKIP_REVIEW detected and pipeline blocked; edge: 0 rounds = skip; error: missing phase in context |
| 2 | Block LLM when Ralph Loop insufficient rounds | US-I1 (Core) / AC-I2 | InterventionCoordinator._build_plan (V-2) | happy: <2 consecutive ZERO_C_H_M blocked; edge: exactly 2 consecutive = pass; error: 1 round ZERO + 1 round with M = blocked |
| 3 | Block LLM when unfixed issues remain | US-I1 (Core) / AC-I3 | InterventionCoordinator._build_plan (V-3) | happy: C/H/M > 0 blocked with count; edge: M=1, C=0, H=0 = blocked; error: context missing issues field |
| 4 | Rollback to current phase on process violation | US-I1 (Core) / AC-I4 | InterventionCoordinator._build_plan (V-1..V-3) | happy: Phase 2 violation → stay at Phase 2; edge: Phase 1 violation → stay at Phase 1; error: phase out of range |
| 5 | Delete implementation file when test not written first (Phase 4) | US-I2 (Core) / AC-I5 | RollbackEngine._delete_implementation | happy: tracked file git rm; happy: untracked file os.remove; edge: file already deleted; error: path validation failure |
| 6 | Restore modified test from git (Phase 5) | US-I3 (Core) / AC-I6 | RollbackEngine._restore_test | happy: tracked file restored from boundary_commit_hash; happy: HEAD fallback when boundary_commit_hash is None; edge: untracked file → skip; error: git checkout failure |
| 7 | Detect missing test and require LLM to write it | US-I4 (Core) / AC-I7 | InterventionCoordinator._build_plan (V-6) | happy: MISSING_TEST blocked, no auto-fix; edge: system does NOT create skeleton; error: affected_file_path missing |
| 8 | SKIP_RED_PHASE rollback targets Phase from event context (dynamic) | US-I2 (Core) / AC-I8 | InterventionCoordinator._build_plan (V-4) | happy: target_phase = event.context.get("phase", 4) (dynamic, not hardcoded); edge: already at target phase; note: no phase in context → rejected by _is_valid_event (not a _build_plan concern) |
| 9 | Regression rollback targets Phase 5 | US-I7 (Core) / AC-I9 | RollbackEngine.rollback (V-7), InterventionCoordinator._build_plan | happy: Phase 5 end tests pass → Phase 6 fail → rollback to Phase 5; edge: all Phase 6 failures treated as regression in MVP (including flaky false positives, per Phase 1 Constraint); error: no phase5_test_results in context |
| 10 | REGRESSION target_phase = 5 | US-I7 (Core) / AC-I10 | InterventionCoordinator._build_plan (V-7) | happy: target_phase = 5 |
| 11 | Auto-update ki document on every intervention | US-I5 (Core) / AC-I11 | KiDocManager.record_intervention | happy: entry appended with violation_type, target_phase, auto_fix_applied, timestamp; edge: multiple interventions = multiple entries; error: file not found → create with header |
| 12 | Update ki document on Ralph Loop round end | US-I5 (Core) / AC-I12 | KiDocManager.record_intervention (round context) | happy: round results recorded; edge: Round 1 fails = still recorded |
| 13 | Detect ki document outdated and auto-append | US-I5 (Core) / AC-I20 | KiDocManager.ensure_updated, record_intervention | happy: outdated → append missing record; edge: up-to-date → return True; error: corrupt timestamp in ki doc |
| 14 | Block pipeline at stage boundary when ki assessment missing | US-I9 (Core) / AC-I13 | KiDocManager.ensure_assessment, InterventionCoordinator._compute_assessment | happy: no assessment → auto-execute; edge: empty assessment = MISSING_KI_ASSESSMENT; error: assessment with status field only = valid |
| 15 | Auto-commit phase completion with non-empty diff | US-I6 (Core) / AC-I14 | CommitGuard.ensure_committed | happy: dirty state → committed with correct message; edge: empty diff → skip, log; error: git commit failure |
| 16 | Auto-commit Ralph Loop round with non-empty diff | US-I6 (Core) / AC-I15 | CommitGuard.ensure_committed (with loop_round) | happy: message includes [Loop N]; edge: loop_round = None → no loop tag |
| 17 | Auto-commit all uncommitted at phase boundary | US-I6 (Core) / AC-I16 | CommitGuard.ensure_committed | happy: tracked staged + tracked unstaged → all committed (untracked excluded by design); error: git index locked |
| 18 | SYNC mode blocks immediately, no human override | US-I8 (Core) / AC-I21 | InterventionCoordinator.intervene | happy: any V-1..V-13 → TDDViolationError raised; edge: multiple violations → handle by priority; error: unknown type → log warning, no block |
| 19 | Validate Ralph Loop prompts for forbidden content (bilingual) | US-I10 (Core) / AC-I17 | PromptValidator.validate | happy: clean prompt → valid; happy: single EN match → invalid; edge: code block content → exempt; error: empty prompt → valid |
| 20 | Report matched pattern details for invalid prompts | US-I10 (Core) / AC-I18 | PromptValidator.validate → PatternMatch fields | happy: report includes category, pattern, line_number, language; edge: multiple matches → report all |
| 21 | Chinese forbidden pattern detection using bare patterns (no lookaround) | US-I10 (Core) / AC-I19 | PromptValidator.validate (ZH_COMPILED) | happy: ZH pattern detected via bare regex (no lookaround, no word-boundary); edge: mixed EN+ZH → both strategies; error: false positive in code block (exempt context handles this) |
| 22 | Phase 5→4 rollback preserves Phase 5 work via auto-commit | US-I2 (Core) / AC-I22 | InterventionCoordinator.intervene (pre-rollback commit), RollbackEngine | happy: Phase 5 work committed before rollback; edge: untracked file staged with git add; error: commit fails → still proceed with rollback |

> **Note on Core Scenario 21 error case**: Missing 'prompt' key returns empty string → valid → Watchdog false positive; this is by design as prompt key presence is Watchdog's responsibility. ZH uses bare patterns (no lookaround, no \b) per spec v1.7 deviation AC-I19 — lookaround caused false negatives due to CJK character adjacency.

### Key Functional Points (from Phase 2 — priority: key)

4 components are Key. Comprehensive testing required (happy + edge + error).

| # | Key Functional Point | Source (Component/Interface/Failure Mode) | Test Cases |
|---|---------------------|------------------------------------------|------------|
| 1 | InterventionCoordinator.intervene() — event validation and routing | Component: InterventionCoordinator (Key) | happy: valid event routes correctly; edge: missing violation_type → return silently; error: missing affected_file_path for behavioral violation → return silently |
| 2 | InterventionCoordinator.intervene() — unknown type handling | Component: InterventionCoordinator (Key) | happy: unknown type → log warning, no block; edge: type name similar to valid (typo) |
| 3 | InterventionCoordinator.intervene() — prompt validation dispatch | Component: InterventionCoordinator (Key) | happy: V-13 triggers PromptValidator; edge: V-13 with clean prompt → return (false positive); error: V-13 with missing prompt in context |
| 4 | InterventionCoordinator.intervene() — plan building for all 13 types | Component: InterventionCoordinator (Key) | happy: each V-1..V-13 maps to correct InterventionPlan; edge: V-4 target_phase=4, V-5 target_phase=5; error: unknown type → fallback plan |
| 5 | InterventionCoordinator.intervene() — pre-rollback commit | Component: InterventionCoordinator (Key) | happy: destructive plan triggers commit; happy: phase rollback triggers commit; edge: non-destructive, non-rollback → no pre-commit |
| 6 | InterventionCoordinator.intervene() — rollback execution | Component: InterventionCoordinator (Key) | happy: plan.auto_fix && plan.needs_rollback → RollbackEngine called; edge: auto_fix=True but needs_rollback=False → no rollback |
| 7 | InterventionCoordinator.intervene() — TDDViolationError raising | Component: InterventionCoordinator (Key) | happy: InterventionResult populated correctly; edge: rollback_result=None fields |
| 8 | InterventionCoordinator.intervene_batch() — empty list | Component: InterventionCoordinator (Key) | happy: empty list → return silently |
| 9 | InterventionCoordinator.intervene_batch() — priority sorting | Component: InterventionCoordinator (Key) | happy: P1 before P2 before P3; edge: same priority → first-in-list wins |
| 10 | InterventionCoordinator.intervene_batch() — mergeable vs non-mergeable classification | Component: InterventionCoordinator (Key) | happy: V-4 (non-mergeable) handled first; edge: only mergeable events → _handle_merged |
| 11 | InterventionCoordinator._handle_merged() — V-10/11→V-12→V-8/9 ordering | Component: InterventionCoordinator (Key) | happy: commit → assessment → ki doc update; edge: missing V-12 in merge set → skip assessment step |
| 12 | InterventionCoordinator._handle_merged() — single merged ki doc entry | Component: InterventionCoordinator (Key) | happy: multiple events → one ki doc entry; edge: no ki events in merge set → skip ki step |
| 13 | InterventionCoordinator._compute_assessment() — FAIL/CONDITIONAL/PASS | Component: InterventionCoordinator (Key) | happy: C>0 → FAIL; happy: H>0 → FAIL; happy: M>0 → CONDITIONAL; happy: all 0 → PASS; edge: empty round_results; error: missing metadata |
| 14 | InterventionCoordinator._is_valid_event() — validation rules | Component: InterventionCoordinator (Key) | happy: complete event → valid; edge: process violations don't need affected_file_path; error: missing phase in context |
| 15 | PromptValidator.validate() — clean prompt | Component: PromptValidator (Key) | happy: no forbidden content → is_valid=True, matches=[] |
| 16 | PromptValidator.validate() — EN pattern detection (FP-1..FP-7) | Component: PromptValidator (Key) | happy: at least 1 pattern per FP category detected; edge: case insensitive matching |
| 17 | PromptValidator.validate() — ZH pattern detection (FP-1..FP-7) | Component: PromptValidator (Key) | happy: at least 1 ZH pattern per category; edge: bare patterns match correctly in CJK-adjacent text (no word boundary needed) |
| 18 | PromptValidator.validate() — mixed EN+ZH prompt | Component: PromptValidator (Key) | happy: both EN and ZH patterns detected with correct language tag |
| 19 | PromptValidator.validate() — exempt contexts | Component: PromptValidator (Key) | happy: pattern in triple backtick → exempt; happy: pattern in inline code → exempt; happy: pattern in quoted text → exempt; happy: pattern in heading → exempt; edge: partially in code block |
| 20 | PromptValidator — PatternMatch fields | Component: PromptValidator (Key) | happy: category (FP-1..FP-7), pattern text, line_number, language (en/zh) all populated |
| 21 | RollbackEngine._delete_implementation() — tracked file | Component: RollbackEngine (Key) | happy: git rm -f succeeds; error: git rm fails → RollbackResult(success=False) |
| 22 | RollbackEngine._delete_implementation() — untracked file | Component: RollbackEngine (Key) | happy: os.remove succeeds; edge: file already gone → still succeeds |
| 23 | RollbackEngine._restore_test() — tracked + boundary_commit_hash | Component: RollbackEngine (Key) | happy: git checkout boundary_hash -- file; edge: boundary_commit_hash=None → HEAD fallback |
| 24 | RollbackEngine._restore_test() — untracked file | Component: RollbackEngine (Key) | happy: returns RollbackResult(success=False, "skip (untracked)") |
| 25 | RollbackEngine._validate_path() — path traversal prevention | Component: RollbackEngine (Key) | happy: valid path → True; edge: ../etc/passwd → False; edge: absolute path → False if outside repo; error: git unavailable → False |
| 26 | RollbackEngine._is_tracked() — git ls-files | Component: RollbackEngine (Key) | happy: tracked → True; happy: untracked → False; error: git fails → False |
| 27 | KiDocManager.record_intervention() — entry format | Component: KiDocManager (Key) | happy: correct markdown format appended; edge: file not found → create with header |
| 28 | KiDocManager.ensure_assessment() — PASS/CONDITIONAL/FAIL | Component: KiDocManager (Key) | happy: each status written with priority_counts; edge: empty issues list for PASS |
| 29 | KiDocManager.ensure_updated() — timestamp comparison | Component: KiDocManager (Key) | happy: up-to-date → True; happy: outdated → False; edge: no timestamps in file → None |
| 30 | KiDocManager.record_merge() — single merged entry | Component: KiDocManager (Key) | happy: multiple events → one entry listing all combined actions |
| 31 | KiDocManager._parse_newest_timestamp() — ISO 8601 extraction | Component: KiDocManager (Key) | happy: extracts latest timestamp; edge: multiple timestamps → takes last; error: file not found → None |

### Peripheral Functional Points (from Phase 2 — priority: peripheral)

1 component is Peripheral. Basic testing required (happy + primary error).

| # | Peripheral Functional Point | Source (Component/Interface/Failure Mode) | Test Cases |
|---|----------------------------|------------------------------------------|------------|
| 1 | CommitGuard.ensure_committed() — clean state skip | Component: CommitGuard (Peripheral) | happy: clean repo → skip, log |
| 2 | CommitGuard.ensure_committed() — dirty state commit | Component: CommitGuard (Peripheral) | happy: dirty → committed with correct message format |
| 3 | CommitGuard.ensure_committed() — commit failure | Component: CommitGuard (Peripheral) | error: git commit fails → CommitResult(success=False) |
| 4 | CommitGuard._build_message() — with/without loop_round | Component: CommitGuard (Peripheral) | happy: loop_round=3 → "req: PHASE-N [Loop 3] auto-commit"; happy: loop_round=None → no loop tag |
| 5 | CommitGuard._is_clean() — staged + unstaged check | Component: CommitGuard (Peripheral) | happy: dirty (staged changes) → False; happy: dirty (unstaged changes) → False; happy: clean → True |

---

## Requirements Coverage Matrix (Phase 1 → Tests)

_Traces Phase 1 user stories and acceptance criteria to test cases. For Phase 2 design element traceability, see Design Coverage Matrix below._

| # | Priority | User Story | Acceptance Criterion | Test Type | Test File | Test Name | Description |
|---|----------|-----------|---------------------|-----------|-----------|-----------|-------------|
| 1 | Core | US-I1 | AC-I1 | Unit | `test_intervention_coordinator.py` | `should_block_pipeline_when_review_skipped` | Phase 1-3 completes with no Ralph Loop record → SKIP_REVIEW raised, pipeline blocked |
| 2 | Core | US-I1 | AC-I1 | Unit | `test_intervention_coordinator.py` | `should_treat_zero_rounds_as_skip_review` | Ralph Loop ran 0 rounds = skip |
| 3 | Core | US-I1 | AC-I2 | Unit | `test_intervention_coordinator.py` | `should_block_pipeline_when_insufficient_review_rounds` | < 2 consecutive ZERO_C_H_M → INSUFFICIENT_REVIEW raised |
| 4 | Core | US-I1 | AC-I2 | Unit | `test_intervention_coordinator.py` | `should_pass_when_exactly_two_consecutive_zero_chm` | Exactly 2 consecutive rounds of ZERO_C_H_M → no violation |
| 5 | Core | US-I1 | AC-I3 | Unit | `test_intervention_coordinator.py` | `should_block_pipeline_when_unfixed_issues_remain` | C/H/M > 0 → UNFIXED_ISSUES raised with issue count |
| 6 | Core | US-I1 | AC-I3 | Unit | `test_intervention_coordinator.py` | `should_block_when_m_equals_one_even_if_c_h_zero` | M=1, C=0, H=0 → blocked |
| 7 | Core | US-I1 | AC-I4 | Unit | `test_intervention_coordinator.py` | `should_rollback_to_current_phase_on_process_violation` | Phase 2 violation → stay at Phase 2, retry review |
| 8 | Core | US-I1 | AC-I4 | Unit | `test_intervention_coordinator.py` | `should_preserve_committed_work_on_rollback` | Already committed Phase 2 work remains in git history |
| 9 | Core | US-I2 | AC-I5 | Unit | `test_rollback_engine.py` | `should_delete_tracked_implementation_file_via_git_rm` | Phase 4 detects impl file with no failing test → git rm -f |
| 10 | Core | US-I2 | AC-I5 | Unit | `test_rollback_engine.py` | `should_delete_untracked_implementation_file_via_os_remove` | Untracked impl file → os.remove |
| 11 | Core | US-I2 | AC-I5 | Unit | `test_rollback_engine.py` | `should_fail_delete_when_path_validation_fails` | Invalid path → RollbackResult(success=False) |
| 12 | Core | US-I3 | AC-I6 | Unit | `test_rollback_engine.py` | `should_restore_test_from_boundary_commit_hash` | Tracked test file → git checkout boundary_hash -- file |
| 13 | Core | US-I3 | AC-I6 | Unit | `test_rollback_engine.py` | `should_fallback_to_head_when_boundary_commit_hash_none` | boundary_commit_hash=None → git checkout HEAD -- file |
| 14 | Core | US-I3 | AC-I6 | Unit | `test_rollback_engine.py` | `should_skip_restore_for_untracked_test_file` | Untracked file → RollbackResult(success=False, "skip (untracked)") |
| 15 | Core | US-I3 | AC-I6 | Unit | `test_rollback_engine.py` | `should_fail_restore_when_git_checkout_fails` | git checkout returns non-zero → RollbackResult(success=False) |
| 16 | Core | US-I4 | AC-I7 | Unit | `test_intervention_coordinator.py` | `should_block_pipeline_when_test_missing_for_implementation` | Impl file with no corresponding test → MISSING_TEST, no auto-fix (parametrized for Phase 4 and Phase 5 event contexts per AC-I7 "Phase 4/5 detects"; dynamic target_phase via event.context.get("phase", 4)) |
| 17 | Core | US-I4 | AC-I7 | Unit | `test_intervention_coordinator.py` | `should_not_create_test_skeleton_for_missing_test` | V-6 plan has auto_fix=False, instruction requires LLM |
| 18 | Core | US-I2 | AC-I8 | Unit | `test_intervention_coordinator.py` | `should_target_phase_from_event_context_for_skip_red_phase` | SKIP_RED_PHASE plan.target_phase = event.context.get("phase", 4) — dynamic per spec v1.7 deviation AC-I8 |
| 19 | Core | US-I7 | AC-I9 | Unit | `test_intervention_coordinator.py` | `should_rollback_to_phase_5_on_regression` | Phase 5 tests pass → Phase 6 fail → rollback Phase 5 |
| 20 | Core | US-I7 | AC-I9 | Unit | `test_intervention_coordinator.py` | `should_mark_failure_range_on_regression` | REGRESSION plan marks failure range, no auto-fix, instruction: "Regression detected — return to Phase 5 and fix the failing implementation" per spec v1.7 |
| 20b | Core | US-I7 | AC-I9 | Unit | `test_intervention_coordinator.py` | `should_treat_all_phase6_failures_as_regression_mvp_limitation` | MVP treats all Phase 6 failures as regression per Phase 1 Constraint (flaky false positives acknowledged) — known limitation, not an AC behavioral expectation |
| 21 | Core | US-I7 | AC-I10 | Unit | `test_intervention_coordinator.py` | `should_target_phase_5_for_regression_rollback` | REGRESSION plan.target_phase = 5 |
| 21b | Core | US-I7 | AC-I9 | Unit | `test_intervention_coordinator.py` | `should_raise_regression_without_auto_fix_when_no_baseline` | phase5_test_results=None → V-7 plan built with instruction noting no baseline |
| 22 | Core | US-I5 | AC-I11 | Unit | `test_ki_doc_manager.py` | `should_append_intervention_entry_to_ki_doc` | Intervention → ki doc updated with violation_type, target_phase, auto_fix_applied, timestamp |
| 23 | Core | US-I5 | AC-I11 | Unit | `test_ki_doc_manager.py` | `should_create_ki_doc_with_header_when_not_found` | File not found → create with header, then append |
| 24 | Core | US-I5 | AC-I11 | Unit | `test_ki_doc_manager.py` | `should_append_multiple_entries_for_multiple_interventions` | Multiple interventions = multiple entries |
| 25 | Core | US-I5 | AC-I12 | Unit | `test_ki_doc_manager.py` | `should_record_round_results_in_ki_doc` | Ralph Loop round end → ki doc updated with C/H/M counts |
| 26 | Core | US-I5 | AC-I12 | Unit | `test_ki_doc_manager.py` | `should_record_failed_round_results` | Round 1 fails → still recorded |
| 27 | Core | US-I5 | AC-I20 | Unit | `test_ki_doc_manager.py` | `should_detect_outdated_ki_doc_by_timestamp` | Newest ki entry timestamp < intervention timestamp → KI_DOC_OUTDATED |
| 28 | Core | US-I5 | AC-I20 | Unit | `test_ki_doc_manager.py` | `should_auto_append_missing_record_for_outdated_ki_doc` | Outdated → auto-append missing intervention record |
| 29 | Core | US-I5 | AC-I20 | Unit | `test_ki_doc_manager.py` | `should_use_structured_timestamp_not_file_mtime` | Timestamp from ISO 8601 field in ki entry, not file mtime |
| 29b | Core | US-I5 | AC-I20 | Unit | `test_intervention_coordinator.py` | `should_route_v9_ki_doc_outdated_to_auto_append` | Coordinator receives KI_DOC_OUTDATED → ensure_updated() called → auto-append missing record → record_intervention → commit → TDDViolationError |
| 30 | Core | US-I9 | AC-I13 | Unit | `test_ki_doc_manager.py` | `should_block_pipeline_when_ki_assessment_missing` | No assessment record → MISSING_KI_ASSESSMENT, auto-execute |
| 31 | Core | US-I9 | AC-I13 | Unit | `test_ki_doc_manager.py` | `should_treat_empty_assessment_as_missing` | Completely empty = MISSING_KI_ASSESSMENT |
| 32 | Core | US-I9 | AC-I13 | Unit | `test_ki_doc_manager.py` | `should_treat_status_only_assessment_as_valid` | Assessment with at least status field = valid |
| 33 | Core | US-I6 | AC-I14 | Unit | `test_commit_guard.py` | `should_auto_commit_phase_completion_with_non_empty_diff` | Phase done + dirty → committed with "req: PHASE-N summary" |
| 34 | Core | US-I6 | AC-I14 | Unit | `test_commit_guard.py` | `should_skip_commit_when_empty_diff` | Clean state → skip, log |
| 35 | Core | US-I6 | AC-I15 | Unit | `test_commit_guard.py` | `should_auto_commit_loop_round_with_non_empty_diff` | Loop round done + dirty → committed with "req: PHASE-N [Loop N] summary" |
| 36 | Core | US-I6 | AC-I15 | Unit | `test_commit_guard.py` | `should_omit_loop_tag_when_loop_round_none` | loop_round=None → no [Loop N] in message |
| 37 | Core | US-I6 | AC-I16 | Unit | `test_commit_guard.py` | `should_auto_commit_all_uncommitted_at_boundary` | Tracked staged + tracked unstaged → all committed (untracked files excluded by design — handled by pre-rollback git add <file> path) |
| 38 | Core | US-I8 | AC-I21 | Unit | `test_intervention_coordinator.py` | `should_raise_tdd_violation_error_for_any_violation` | Any V-1..V-13 → TDDViolationError raised immediately |
| 39 | Core | US-I8 | AC-I21 | Unit | `test_intervention_coordinator.py` | `should_handle_multiple_violations_by_priority` | Multiple violations → P1 handled first |
| 40 | Core | US-I10 | AC-I17 | Unit | `test_prompt_validator.py` | `should_flag_prompt_with_forbidden_en_patterns` | 1+ EN match → is_valid=False |
| 41 | Core | US-I10 | AC-I17 | Unit | `test_prompt_validator.py` | `should_exempt_patterns_in_code_blocks` | Pattern inside triple backtick → exempt |
| 42 | Core | US-I10 | AC-I17 | Unit | `test_prompt_validator.py` | `should_exempt_patterns_in_inline_code` | Pattern inside single backtick → exempt |
| 43 | Core | US-I10 | AC-I17 | Unit | `test_prompt_validator.py` | `should_exempt_patterns_in_quoted_reference_context` | Pattern in quoted text → exempt |
| 44 | Core | US-I10 | AC-I17 | Unit | `test_prompt_validator.py` | `should_exempt_patterns_in_markdown_headings` | Pattern in heading → exempt |
| 44b | Core | US-I10 | AC-I17 | Unit | `test_prompt_validator.py` | `should_handle_pattern_partially_inside_code_block` | Forbidden phrase starting inside code block and ending outside → code block regex strips entire block, no match on remainder |
| 45 | Core | US-I10 | AC-I17 | Unit | `test_prompt_validator.py` | `should_pass_clean_prompt` | No forbidden content → is_valid=True, matches=[] |
| 46 | Core | US-I10 | AC-I18 | Unit | `test_prompt_validator.py` | `should_report_matched_pattern_details` | Match includes category, pattern text, line_number |
| 47 | Core | US-I10 | AC-I18 | Unit | `test_prompt_validator.py` | `should_report_all_matches_when_multiple` | Multiple matches → report all with details |
| 48 | Core | US-I10 | AC-I19 | Unit | `test_prompt_validator.py` | `should_detect_chinese_forbidden_patterns_via_bare_regex` | ZH patterns detected via bare regex (no lookaround, no \b), per spec v1.7 deviation AC-I19 |
| 49 | Core | US-I10 | AC-I19 | Unit | `test_prompt_validator.py` | `should_detect_both_en_and_zh_in_mixed_prompt` | Mixed EN+ZH → both strategies, correct language tag |
| 50 | Core | US-I2 | AC-I22 | Unit | `test_rollback_engine.py` | `should_preserve_phase5_work_via_pre_rollback_commit` | Phase 5→4 rollback: Phase 5 work committed first |
| 51 | Core | US-I2 | AC-I22 | Integration | `test_intervention_integration.py` | `should_end_to_end_preserve_committed_work_on_phase_rollback` | Full lifecycle: V-6 detected in Phase 5 → commit → rollback Phase 4 |
| 52 | Core | US-I2 | AC-I22 | Unit | `test_intervention_coordinator.py` | `should_stage_untracked_file_before_rollback` | Untracked affected_file_path → git add before commit |

---

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test File | Test Name | Description |
|---|----------|---------------|-------------|-----------|-----------|-----------|-------------|
| 1 | Key | InterventionCoordinator.intervene() — event validation | Interface | Unit | `test_intervention_coordinator.py` | `should_reject_event_missing_violation_type` | Missing violation_type → return silently |
| 2 | Key | InterventionCoordinator.intervene() — unknown type | Interface | Unit | `test_intervention_coordinator.py` | `should_log_warning_and_not_block_for_unknown_violation_type` | Unknown type → log warning, no TDDViolationError |
| 3 | Key | InterventionCoordinator.intervene() — prompt validation dispatch | Interface | Unit | `test_intervention_coordinator.py` | `should_dispatch_to_prompt_validator_only_for_v13` | Only V-13 triggers PromptValidator |
| 4 | Key | InterventionCoordinator.intervene() — V-13 false positive | Interface | Unit | `test_intervention_coordinator.py` | `should_return_silently_when_v13_prompt_actually_clean` | Clean prompt on V-13 → return (false positive) |
| 4b | Key | InterventionCoordinator.intervene() — V-13 missing prompt key | Interface | Unit | `test_intervention_coordinator.py` | `should_return_silently_when_v13_prompt_key_missing` | Missing 'prompt' in context → empty string → valid → return (by design, Watchdog responsibility) |
| 5 | Key | InterventionCoordinator._build_plan() — all 13 types | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v1_skip_review_to_correct_plan` | V-1 → InterventionPlan(phase, False, False, False, "Execute Ralph Loop Review") |
| 5b | Key | InterventionCoordinator._build_plan() — V-2 | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v2_insufficient_review_to_no_auto_fix_plan` | V-2 → InterventionPlan(phase, False, False, False, "Continue Ralph Loop until 2 consecutive ZERO_C_H_M") |
| 5c | Key | InterventionCoordinator._build_plan() — V-3 | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v3_unfixed_issues_to_no_auto_fix_plan` | V-3 → InterventionPlan(phase, False, False, False, "Fix issues before proceeding") |
| 6 | Key | InterventionCoordinator._build_plan() — V-4 dynamic target_phase | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v4_skip_red_phase_to_destructive_plan` | V-4 → InterventionPlan(event.context.get("phase", 4), True, True, True, ...) — dynamic per spec v1.7 deviation AC-I8 |
| 7 | Key | InterventionCoordinator._build_plan() — V-5 dynamic target_phase | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v5_modified_test_to_destructive_plan` | V-5 → InterventionPlan(event.context.get("phase", 5), True, True, True, ...) — dynamic per Phase 2 _build_plan; note: no phase in context → rejected by _is_valid_event (same as V-4, fallback 5 unreachable) |
| 7b | Key | InterventionCoordinator._build_plan() — V-6 MISSING_TEST | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v6_missing_test_to_no_auto_fix_plan` | V-6 → InterventionPlan(event.context.get("phase", 4), False, False, False, "Write test for this module first") — auto_fix=False, no rollback, dynamic target_phase (see also Req tests #16, #17) |
| 8 | Key | InterventionCoordinator._build_plan() — V-7 REGRESSION | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v7_regression_to_phase5_plan` | V-7 → InterventionPlan(5, False, False, False, "Regression detected — return to Phase 5 and fix the failing implementation") per spec v1.7 |
| 9 | Key | InterventionCoordinator._build_plan() — all 13 types | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v8_v9_v10_v11_v12_to_auto_fix_plans` | Compliance/assessment → auto_fix=True, non-destructive |
| 10 | Key | InterventionCoordinator._build_plan() — all 13 types | Interface | Unit | `test_intervention_coordinator.py` | `should_map_v13_to_non_auto_fix_plan` | V-13 → auto_fix=False, instruction to reconstruct prompt |
| 11 | Key | InterventionCoordinator._build_plan() — fallback | Interface | Unit | `test_intervention_coordinator.py` | `should_return_fallback_plan_for_unknown_type` | Unknown → InterventionPlan with "Unknown" instruction |
| 12 | Key | InterventionCoordinator.intervene_batch() — priority sorting | Interface | Unit | `test_intervention_coordinator.py` | `should_sort_events_by_priority_before_handling` | P1 events handled before P4 events |
| 13 | Key | InterventionCoordinator.intervene_batch() — non-mergeable first | Interface | Unit | `test_intervention_coordinator.py` | `should_handle_non_mergeable_events_before_mergeable` | V-4 (P1) handled before V-10 (P4) |
| 14 | Key | InterventionCoordinator.intervene_batch() — same-priority tie-breaking | Interface | Unit | `test_intervention_coordinator.py` | `should_handle_same_priority_events_in_list_order` | Two P4 events → first-in-list processed first |
| 15 | Key | InterventionCoordinator.intervene_batch() — empty list | Interface | Unit | `test_intervention_coordinator.py` | `should_return_silently_for_empty_event_list` | Empty list → no action |
| 16 | Key | InterventionCoordinator.intervene_batch() — performance | Interface | Unit | `test_intervention_coordinator.py` | `should_handle_many_violations_in_batch_efficiently` | Batch with many events sorted and handled in <100ms |
| 17 | Key | InterventionCoordinator._handle_merged() — ordering | Interface | Unit | `test_intervention_coordinator.py` | `should_execute_commit_before_assessment_before_ki_update` | V-10/V-11 → V-12 → V-8/V-9 ordering enforced |
| 18 | Key | InterventionCoordinator._handle_merged() — partial merge (no V-12) | Interface | Unit | `test_intervention_coordinator.py` | `should_skip_assessment_step_when_v12_missing_from_merge_set` | Merge set with V-10/V-11 but no V-12 → commit + ki doc update only, assessment step skipped |
| 19 | Key | InterventionCoordinator._handle_merged() — single ki entry | Interface | Unit | `test_intervention_coordinator.py` | `should_write_single_merged_ki_entry_for_combined_events` | Multiple events → one ki doc entry |
| 19a | Key | InterventionCoordinator._handle_merged() — commit-only merge (V-10/V-11 only) | Interface | Unit | `test_intervention_coordinator.py` | `should_commit_and_record_ki_for_v10_v11_only_merge` | V-10 + V-11 with no V-8/V-9/V-12 → ensure_committed called, ki doc records merged commit action, no assessment step |
| 19b | Key | InterventionCoordinator.intervene() — V-9 routing | Interface | Unit | `test_intervention_coordinator.py` | `should_route_v9_ki_doc_outdated_to_auto_append` | Standalone V-9 event → auto_fix plan → ki_doc.ensure_updated() called (appends missing record if outdated) → record_intervention called → commit → TDDViolationError |
| 20 | Key | InterventionCoordinator._compute_assessment() — FAIL | Interface | Unit | `test_intervention_coordinator.py` | `should_derive_fail_when_c_or_h_greater_than_zero` | C>0 or H>0 → status="FAIL" |
| 20b | Key | InterventionCoordinator._compute_assessment() — CONDITIONAL | Interface | Unit | `test_intervention_coordinator.py` | `should_derive_conditional_when_m_greater_than_zero` | M>0, C=0, H=0 → status="CONDITIONAL" |
| 20c | Key | InterventionCoordinator._compute_assessment() — PASS | Interface | Unit | `test_intervention_coordinator.py` | `should_derive_pass_when_all_zero` | C=0, H=0, M=0 → status="PASS" |
| 20d | Key | InterventionCoordinator._compute_assessment() — empty round_results | Interface | Unit | `test_intervention_coordinator.py` | `should_derive_pass_when_round_results_empty` | Empty round_results → defaults to all zeros → PASS (by design: no rounds = no issues) |
| 20e | Key | InterventionCoordinator._compute_assessment() — priority_counts | Interface | Unit | `test_intervention_coordinator.py` | `should_populate_priority_counts_dict_in_assessment` | P0=C, P1=H, P2=M, P3=P_count, P4=L_count |
| 21 | Key | InterventionCoordinator._is_valid_event() — no affected_file_path for process | Interface | Unit | `test_intervention_coordinator.py` | `should_accept_process_violations_without_affected_file_path` | V-1..V-3, V-8..V-13 valid without affected_file_path (9 exempted types — parametrized) |
| 22 | Key | InterventionCoordinator._is_valid_event() — missing phase | Interface | Unit | `test_intervention_coordinator.py` | `should_reject_event_missing_phase_in_context` | No "phase" key in context → invalid |
| 23 | Key | InterventionCoordinator._needs_prompt_validation() | Interface | Unit | `test_intervention_coordinator.py` | `should_only_trigger_prompt_validation_for_invalid_review_prompt` | Only V-13 returns True |
| 24 | Key | InterventionCoordinator.intervene() — pre-rollback for destructive | Interface | Unit | `test_intervention_coordinator.py` | `should_trigger_pre_rollback_commit_for_destructive_plan` | is_destructive=True → ensure_committed called before rollback |
| 25 | Key | InterventionCoordinator.intervene() — pre-rollback for phase rollback | Interface | Unit | `test_intervention_coordinator.py` | `should_trigger_pre_rollback_commit_for_phase_rollback` | target_phase < current_phase → ensure_committed called |
| 26 | Key | InterventionCoordinator.intervene() — post-intervention commit | Interface | Unit | `test_intervention_coordinator.py` | `should_commit_after_intervention_completes` | ensure_committed called after ki doc update |
| 26b | Key | InterventionCoordinator.intervene() — cascading failure | Failure Mode | Unit | `test_intervention_coordinator.py` | `should_update_ki_doc_even_when_rollback_fails` | Rollback failure → ki doc still updated (coordinator continues to step 7) |
| 26c | Key | InterventionCoordinator.intervene() — pre-rollback commit failure | Failure Mode | Unit | `test_intervention_coordinator.py` | `should_proceed_with_rollback_when_pre_commit_fails` | Destructive plan → ensure_committed returns success=False → rollback still executes → TDDViolationError raised with auto_fix_applied reflecting rollback result |
| 26d | Key | InterventionCoordinator.intervene() — git add failure before rollback | Failure Mode | Unit | `test_intervention_coordinator.py` | `should_handle_git_add_failure_gracefully_before_rollback` | git add fails → log warning → proceed with rollback → TDDViolationError notes staging failure |
| 27 | Key | PromptValidator — FP-1 EN patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp1_en_stop_condition_patterns` | "stop condition", "gate pass", "2 consecutive rounds" |
| 28 | Key | PromptValidator — FP-2 EN patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp2_en_cumulative_tally_patterns` | "cumulative tally", "running total", "total C" |
| 29 | Key | PromptValidator — FP-3 EN patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp3_en_prior_round_patterns` | "prior round", "previous round", "last round" |
| 30 | Key | PromptValidator — FP-4 EN patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp4_en_fix_list_patterns` | "fix list", "fixes applied", "addressed items" |
| 31 | Key | PromptValidator — FP-5 EN patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp5_en_round_count_patterns` | "round N", "round count", "this is round" |
| 32 | Key | PromptValidator — FP-6 EN patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp6_en_loop_state_patterns` | "loop state", "gate status", "pass/fail status" |
| 33 | Key | PromptValidator — FP-7 EN phrase matching | Component | Unit | `test_prompt_validator.py` | `should_detect_fp7_en_scope_limiting_phrases` | "only check X", "limit scope to", "do not review" |
| 34 | Key | PromptValidator — FP-7 EN individual words NOT matched | Component | Unit | `test_prompt_validator.py` | `should_not_flag_individual_words_for_fp7` | "skip" alone → NOT a violation |
| 35 | Key | PromptValidator — FP-1 ZH patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp1_zh_stop_condition_patterns` | "停止条件", "连续2轮", "审查达标" |
| 36 | Key | PromptValidator — FP-2 ZH patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp2_zh_cumulative_tally_patterns` | "累计计数", "总C数" |
| 37 | Key | PromptValidator — FP-3 ZH patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp3_zh_prior_round_patterns` | "上一轮", "前一轮", "上轮发现" |
| 38 | Key | PromptValidator — FP-4 ZH patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp4_zh_fix_list_patterns` | "修复列表", "已修复", "已解决" |
| 39 | Key | PromptValidator — FP-5 ZH patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp5_zh_round_count_patterns` | "第3轮", "第几轮", "当前轮次" |
| 40 | Key | PromptValidator — FP-6 ZH patterns | Component | Unit | `test_prompt_validator.py` | `should_detect_fp6_zh_loop_state_patterns` | "循环状态", "审查状态", "是否通过" |
| 41 | Key | PromptValidator — FP-7 ZH phrase matching | Component | Unit | `test_prompt_validator.py` | `should_detect_fp7_zh_scope_limiting_patterns` | "不要审查", "限制范围", "跳过审查" |
| 42 | Key | PromptValidator — case insensitive EN | Component | Unit | `test_prompt_validator.py` | `should_match_en_patterns_case_insensitively` | "STOP CONDITION" = "stop condition" |
| 43 | Key | PromptValidator — PatternMatch fields populated | Component | Unit | `test_prompt_validator.py` | `should_populate_pattern_match_with_category_pattern_line_language` | Verify all 4 fields |
| 44 | Key | RollbackEngine.rollback() — V-4 dispatch | Component | Unit | `test_rollback_engine.py` | `should_dispatch_to_delete_implementation_for_v4` | SKIP_RED_PHASE → _delete_implementation |
| 45 | Key | RollbackEngine.rollback() — V-5 dispatch | Component | Unit | `test_rollback_engine.py` | `should_dispatch_to_restore_test_for_v5` | MODIFIED_TEST → _restore_test |
| 46 | Key | RollbackEngine.rollback() — no handler | Component | Unit | `test_rollback_engine.py` | `should_return_noop_for_non_rollback_violation` | V-1 → RollbackResult(True, "no-op") |
| 47 | Key | RollbackEngine._validate_path() — path traversal | Component | Unit | `test_rollback_engine.py` | `should_reject_path_traversal_attempt` | "../etc/passwd" → False |
| 48 | Key | RollbackEngine._validate_path() — absolute path outside repo | Component | Unit | `test_rollback_engine.py` | `should_reject_absolute_path_outside_repo` | "/etc/passwd" → False |
| 49 | Key | RollbackEngine._validate_path() — git unavailable | Component | Unit | `test_rollback_engine.py` | `should_return_false_when_git_unavailable_for_path_validation` | git rev-parse fails → False |
| 49b | Key | RollbackEngine._validate_path() — leading dash | Component | Unit | `test_rollback_engine.py` | `should_reject_path_starting_with_dash` | "-rf /" → False (git argument injection prevention) |
| 50 | Key | RollbackEngine._is_tracked() — tracked | Component | Unit | `test_rollback_engine.py` | `should_return_true_for_tracked_file` | git ls-files returns path → True |
| 51 | Key | RollbackEngine._is_tracked() — untracked | Component | Unit | `test_rollback_engine.py` | `should_return_false_for_untracked_file` | git ls-files returns empty → False |
| 52 | Key | RollbackEngine._is_tracked() — git failure | Component | Unit | `test_rollback_engine.py` | `should_return_false_when_git_ls_files_fails` | git command fails → False |
| 53 | Key | KiDocManager._parse_newest_timestamp() — extraction | Component | Unit | `test_ki_doc_manager.py` | `should_extract_iso8601_timestamp_from_ki_doc` | Parses "**Timestamp**: 2026-05-25T14:30:00+08:00" |
| 54 | Key | KiDocManager._parse_newest_timestamp() — multiple | Component | Unit | `test_ki_doc_manager.py` | `should_return_latest_timestamp_when_multiple_present` | Multiple entries → last timestamp |
| 55 | Key | KiDocManager._parse_newest_timestamp() — file not found | Component | Unit | `test_ki_doc_manager.py` | `should_return_none_when_ki_doc_not_found` | File missing → None |
| 55b | Key | KiDocManager._parse_newest_timestamp() — timezone variants | Component | Unit | `test_ki_doc_manager.py` | `should_parse_iso8601_with_z_and_compact_timezones` | Regex matches Z suffix and +HHMM compact timezone (requires Phase 2 regex update) |
| 56 | Key | KiDocManager.record_merge() — single entry | Component | Unit | `test_ki_doc_manager.py` | `should_write_single_merged_entry_documenting_all_combined_actions` | Multiple events → one entry with all violation types |
| 57 | Key | KiDocManager._append() — file creation | Component | Unit | `test_ki_doc_manager.py` | `should_create_parent_directories_when_missing` | Parent dirs don't exist → mkdir -p |
| 57b | Key | KiDocManager._parse_newest_timestamp() — corrupt data | Component | Unit | `test_ki_doc_manager.py` | `should_return_none_for_corrupt_timestamp_in_ki_doc` | Malformed/non-ISO timestamp data → regex returns None, no crash |
| 58 | Peripheral | CommitGuard.ensure_committed() — clean skip | Component | Unit | `test_commit_guard.py` | `should_skip_commit_when_repo_clean` | _is_clean() → True → CommitResult("skip") |
| 59 | Peripheral | CommitGuard.ensure_committed() — dirty commit | Component | Unit | `test_commit_guard.py` | `should_commit_when_repo_dirty` | _is_clean() → False → git add -u + git commit with req_number prefix in message |
| 59b | Peripheral | CommitGuard._build_message() — req_number prefix | Component | Unit | `test_commit_guard.py` | `should_include_req_number_in_commit_message` | Message starts with context.req_number (e.g., "INT-001: PHASE-4-RED auto-commit") |
| 60 | Peripheral | CommitGuard.ensure_committed() — failure | Component | Unit | `test_commit_guard.py` | `should_return_failure_when_git_commit_fails` | git commit returns non-zero → CommitResult(success=False) |
| 61 | Peripheral | CommitGuard._build_message() — with loop_round | Component | Unit | `test_commit_guard.py` | `should_include_loop_round_in_commit_message` | loop_round=3 → "[Loop 3]" in message |
| 62 | Peripheral | CommitGuard._build_message() — without loop_round | Component | Unit | `test_commit_guard.py` | `should_omit_loop_tag_when_no_loop_round` | loop_round=None → no [Loop N] |
| 63 | Peripheral | CommitGuard._is_clean() — staged dirty | Component | Unit | `test_commit_guard.py` | `should_detect_staged_changes_as_dirty` | git diff --cached --quiet returns 1 → False |
| 64 | Peripheral | CommitGuard._is_clean() — unstaged dirty | Component | Unit | `test_commit_guard.py` | `should_detect_unstaged_changes_as_dirty` | git diff --quiet returns 1 → False |
| 65 | Key | Git checkout/rm fails (rollback) | Failure Mode | Unit | `test_rollback_engine.py` | `should_return_failure_result_when_git_rm_fails` | git rm returns non-zero → RollbackResult(success=False) with stderr |
| 66 | Key | Git checkout/rm fails (rollback) | Failure Mode | Unit | `test_rollback_engine.py` | `should_return_failure_result_when_git_checkout_fails` | git checkout returns non-zero → RollbackResult(success=False) with stderr |
| 67 | Peripheral | Ki doc write fails | Failure Mode | Unit | `test_ki_doc_manager.py` | `should_handle_ki_doc_write_failure_gracefully` | I/O error on write → log error, continue |
| 68 | Peripheral | Prompt too long for regex | Failure Mode | Unit | `test_prompt_validator.py` | `should_truncate_very_long_prompt_and_log` | 10KB+ prompt → truncated, log warning |
| 69 | Key | Multiple violations same event | Failure Mode | Unit | `test_intervention_coordinator.py` | `should_handle_highest_priority_violation_first_in_batch` | P1 + P4 events → handle P1 only |
| 70 | Peripheral | Unknown violation_type | Failure Mode | Unit | `test_intervention_coordinator.py` | `should_log_warning_and_not_block_for_unknown_violation_type` | Unknown type → log, no block (same test as Design row #2, traced from Failure Mode dimension) |
| 71 | Peripheral | Empty diff at boundary | Failure Mode | Unit | `test_commit_guard.py` | `should_skip_commit_and_log_when_empty_diff` | Clean repo → skip, log |
| 72 | Key | Git unavailable | Failure Mode | Unit | `test_rollback_engine.py` | `should_return_failure_when_git_unavailable` | All git commands fail → appropriate error handling |
| 73 | Key | Git unavailable | Failure Mode | Unit | `test_intervention_coordinator.py` | `should_raise_without_auto_fix_when_git_unavailable` | Git down → TDDViolationError with auto_fix_applied=False |
| 74 | Key | Partial rollback failure | Failure Mode | Unit | `test_rollback_engine.py` | `should_set_partial_failure_flag_on_partial_rollback` | Some files succeed, some fail → partial_failure=True |
| 75 | Key | Path validation failure | Failure Mode | Unit | `test_rollback_engine.py` | `should_reject_and_log_on_path_validation_failure` | Invalid path → RollbackResult(success=False), log warning |
| 76 | Peripheral | Git index locked | Failure Mode | Unit | `test_commit_guard.py` | `should_handle_git_index_locked_gracefully` | Index locked → immediate failure (no retry in MVP) |
| 77 | Key | Multi-file pre-rollback via affected_file_paths | Component | Unit | `test_intervention_coordinator.py` | `should_stage_all_affected_file_paths_before_rollback` | affected_file_paths=["a.py","b.py"] → all staged via git add before rollback |
| 78 | Key | Multi-file rollback via affected_file_paths | Component | Unit | `test_rollback_engine.py` | `should_rollback_all_files_in_affected_file_paths` | affected_file_paths=["a.py","b.py"] → each file rolled back independently |
| 79 | Key | affected_file_paths fallback to affected_file_path | Component | Unit | `test_rollback_engine.py` | `should_fallback_to_single_file_when_affected_file_paths_empty` | affected_file_paths=[] → uses affected_file_path (singular) |
| 79b | Key | Dual field precedence: affected_file_paths wins over affected_file_path | Component | Unit | `test_rollback_engine.py` | `should_use_affected_file_paths_when_both_populated` | Both fields non-empty: affected_file_paths=["a.py","b.py"] + affected_file_path="c.py" → only a.py, b.py processed, c.py ignored |
| 80 | Key | Multi-file all-fail rollback | Component | Unit | `test_rollback_engine.py` | `should_report_all_failures_in_multi_file_rollback` | All files in affected_file_paths fail → partial_failure=False, all errors reported |
| 81 | Key | KiDocManager record_merge IOError protection | Failure Mode | Unit | `test_ki_doc_manager.py` | `should_handle_ioerror_on_record_merge` | IOError during record_merge → log error, continue gracefully |
| 82 | Key | KiDocManager ensure_assessment IOError protection | Failure Mode | Unit | `test_ki_doc_manager.py` | `should_handle_ioerror_on_ensure_assessment` | IOError during ensure_assessment → log error, continue gracefully |

---

## Edge Cases & Error Paths

Checklist (verify each category is covered — find the analogous risk if category seems inapplicable):

- [x] **null_inputs** — None/null ViolationEvent, empty strings
  - `should_reject_event_missing_violation_type` — violation_type=None/empty → return silently
  - `should_reject_event_missing_phase_in_context` — context without "phase" key → invalid
  - `should_accept_process_violations_without_affected_file_path` — affected_file_path="" for V-1/V-2/V-3 → valid
  - `should_return_none_when_ki_doc_not_found` — file path doesn't exist → None
  - `should_pass_clean_prompt` — empty string → valid (no forbidden content); also parametrized with clean non-empty prompt

- [x] **empty_collections** — empty events list in intervene_batch, no round_results
  - `should_return_silently_for_empty_event_list` — intervene_batch([]) → no action
  - `should_derive_pass_when_all_zero` — empty round_results → PASS
  - `should_return_noop_for_non_rollback_violation` — no handler in handlers dict → no-op RollbackResult

- [x] **max_values** — very long prompts (10KB+), many violations in batch
  - `should_truncate_very_long_prompt_and_log` — 10KB+ prompt truncated
  - `should_sort_events_by_priority_before_handling` — large batch sorted correctly (performance test)
  - `should_handle_many_violations_in_batch_efficiently` — batch with many events (integration performance)

- [x] **concurrent_access** — N/A for MVP (SYNC mode, single-threaded)
  - **Analogous risk**: Shared state in PipelineContext if pipeline were parallelized. Mitigated by SYNC mode constraint. No test needed, documented as known N/A.
  - Future risk: If v2 adds async mode, concurrent ki doc writes would need serialization.

- [x] **timeouts** — git command timeout, file I/O timeout
  - `should_return_failure_when_git_unavailable` — git command hangs/fails → appropriate handling
  - `should_handle_ki_doc_write_failure_gracefully` — file I/O failure → best-effort
  - **Analogous risk**: subprocess.run default timeout not set; if git hangs, intervention blocks indefinitely. Mitigated by SYNC mode (LLM blocked anyway). Document as open question.

- [x] **network_failures** — git unavailable, file I/O errors, encoding corruption
  - `should_return_failure_when_git_unavailable` — git rev-parse/ls-files/checkout fails
  - `should_return_false_when_git_unavailable_for_path_validation` — _validate_path handles git failure
  - `should_return_false_when_git_ls_files_fails` — _is_tracked handles git failure
  - `should_raise_without_auto_fix_when_git_unavailable` — coordinator handles git failure
  - Encoding corruption: `_parse_newest_timestamp` regex-based, handles malformed input by returning None

- [x] **invalid_state_transitions** — intervention called at wrong phase, out-of-order calls
  - `should_reject_event_missing_phase_in_context` — no phase → invalid
  - `should_trigger_pre_rollback_commit_for_phase_rollback` — target_phase < current_phase → pre-commit
  - `should_execute_commit_before_assessment_before_ki_update` — merge rule ordering enforced
  - Phase mismatch: V-4 (Phase 4 only) event at Phase 2 → plan still built with target_phase=4, but coordinator doesn't validate phase-appropriateness (documented as open question)

- [x] **serialization_boundary** — ISO 8601 timestamp parsing, path separators (os.sep)
  - `should_extract_iso8601_timestamp_from_ki_doc` — ISO 8601 parsing correctness
  - `should_return_latest_timestamp_when_multiple_present` — multiple ISO 8601 values
  - Path separators: `_validate_path` uses `os.path.normpath` and `os.sep` for cross-platform safety

- [x] **error_handler_correctness** — git rm/checkout failure handling, commit failure
  - `should_return_failure_result_when_git_rm_fails` — stderr captured in RollbackResult
  - `should_return_failure_result_when_git_checkout_fails` — stderr captured in RollbackResult
  - `should_return_failure_when_git_commit_fails` — stderr captured in CommitResult
  - `should_set_partial_failure_flag_on_partial_rollback` — partial failure tracked
  - No catch blocks swallow errors silently: all failures propagate via result objects

- [x] **implicit_contract** — ViolationEvent.context dict shape, PipelineContext boundary_commit_hash may be None
  - `should_fallback_to_head_when_boundary_commit_hash_none` — None → "HEAD" fallback
  - `should_accept_process_violations_without_affected_file_path` — context shape varies by violation type
  - `should_return_none_when_ki_doc_not_found` — file may not exist on first call
  - ViolationEvent.context expected keys: "phase" (required), "prompt" (V-13), "round_results" (assessment)

- [x] **resource_leak** — file handles in KiDocManager._append(), subprocess pipes
  - KiDocManager._append() uses `with open()` context manager → no leak
  - subprocess.run with capture_output=True → pipes auto-closed
  - No explicit test needed; code uses context managers. Documented as verified-by-code-review.

- [x] **cascading_failure** — rollback fails → does ki doc still update? commit fails → does intervention proceed?
  - `should_update_ki_doc_even_when_rollback_fails` — rollback failure → ki doc still updated (coordinator continues)
  - `should_commit_after_intervention_completes` — post-intervention commit attempt
  - `should_raise_without_auto_fix_when_git_unavailable` — commit failure → intervention still blocks pipeline
  - Integration test: `should_end_to_end_handle_rollback_failure_gracefully` — full lifecycle with rollback failure

- [x] **performance_logic** — PromptValidator regex on long prompt, intervene_batch with many events
  - `should_truncate_very_long_prompt_and_log` — 10KB+ prompt → truncation
  - `should_handle_many_violations_in_batch_efficiently` — batch with many events performance
  - Pre-compiled regex patterns (EN_COMPILED, ZH_COMPILED at class level) — no re-compilation per call

---

## Test Data

### Fixtures

| Fixture | Scope | Description | Used In |
|---------|-------|-------------|---------|
| `violation_event_factory` | Function | Factory producing ViolationEvent with configurable violation_type, affected_file_path, context | All component tests |
| `pipeline_context_factory` | Function | Factory producing PipelineContext with configurable current_phase, loop_round, boundary_commit_hash, phase5_test_results, metadata | Coordinator, RollbackEngine, CommitGuard tests |
| `temp_git_repo` | Function | Creates temporary git repo with `tmp_path`, initial commit, and tracked/untracked files | RollbackEngine, CommitGuard tests |
| `temp_ki_doc` | Function | Creates temporary ki doc file at `tmp_path` with optional pre-existing entries | KiDocManager tests |
| `clean_prompt` | Function | Returns a valid Ralph Loop prompt with no forbidden content | PromptValidator tests |
| `dirty_prompt_en` | Function | Returns prompt containing known EN forbidden patterns from FP-1..FP-7 | PromptValidator tests |
| `dirty_prompt_zh` | Function | Returns prompt containing known ZH forbidden patterns from FP-1..FP-7 | PromptValidator tests |
| `mixed_prompt` | Function | Returns prompt with both EN and ZH forbidden content | PromptValidator tests |
| `code_block_prompt` | Function | Returns prompt with forbidden patterns inside code blocks, inline code, quotes, headings | PromptValidator exempt context tests |

### Mocks

| Mock Target | Strategy | Description | Used In |
|-------------|----------|-------------|---------|
| `subprocess.run` | `unittest.mock.patch` | Mock all git CLI calls; return configurable returncodes, stdout, stderr | RollbackEngine, CommitGuard, InterventionCoordinator (pre-rollback git add) |
| `os.remove` | `unittest.mock.patch` | Mock file deletion for untracked file tests | RollbackEngine |
| `Path.write_text` / `Path.read_text` | `unittest.mock.patch` | Mock file I/O for ki doc failure tests | KiDocManager |
| `builtins.open` | `unittest.mock.patch` | Mock file open for write failure simulation | KiDocManager |

### Factory Definitions (behavioral specifications)

**`violation_event_factory(violation_type, affected_file_path=None, affected_file_paths=None, context=None, timestamp=None)`**
- Returns ViolationEvent with given type
- Default context: `{"phase": 4}` for behavioral, `{"phase": 2}` for process
- Default timestamp: current UTC ISO 8601
- Default affected_file_path: `""` for process violations, `"src/module.py"` for behavioral
- Default affected_file_paths: `[]` (empty list); when non-empty, takes precedence over affected_file_path for multi-file operations per spec v1.7 dual field model

**`pipeline_context_factory(current_phase=4, req_number="INT-001", loop_round=None, stage="phase_boundary", boundary_commit_hash=None, phase5_test_results=None, metadata=None)`**
- Returns PipelineContext with given parameters
- Default metadata: `{"round_results": []}`

**`temp_git_repo(tmp_path, files=None)`**
- Initializes git repo at `tmp_path`
- Creates and commits initial files if provided
- Returns `(repo_path, tracked_files, untracked_files)`

### Test Data Constants

```python
SAMPLE_VIOLATION_EVENTS = {
    "V1_skip_review": ViolationEvent("SKIP_REVIEW", "", "...", {"phase": 2}),
    "V4_skip_red": ViolationEvent("SKIP_RED_PHASE", "src/module.py", "...", {"phase": 4}),
    "V5_modified_test": ViolationEvent("MODIFIED_TEST", "tests/test_module_test.py", "...", {"phase": 5}),
    "V6_missing_test": ViolationEvent("MISSING_TEST", "src/new_module.py", "...", {"phase": 5}),
    "V7_regression": ViolationEvent("REGRESSION", "src/module.py", "...", {"phase": 6}),
    "V8_missing_ki": ViolationEvent("MISSING_KI_DOC", "", "...", {"phase": 3}),
    "V9_ki_doc_outdated": ViolationEvent("KI_DOC_OUTDATED", "", "...", {"phase": 3}),
    "V10_uncommitted": ViolationEvent("UNCOMMITTED_PHASE", "docs/doc.md", "...", {"phase": 3}),
    "V11_uncommitted_review": ViolationEvent("UNCOMMITTED_REVIEW", "docs/review.md", "...", {"phase": 2}),
    "V12_missing_assessment": ViolationEvent("MISSING_KI_ASSESSMENT", "", "...", {"phase": 2}),
    "V13_invalid_prompt": ViolationEvent("INVALID_REVIEW_PROMPT", "", "...", {"phase": 2, "prompt": "..."}),
}

FORBIDDEN_EN_SAMPLES = {
    "FP-1": "Make sure to check the stop condition before proceeding.",
    "FP-2": "Here is the cumulative tally of issues found.",
    "FP-3": "In the prior round, we found 3 issues.",
    "FP-4": "The fix list includes items 1 through 5.",
    "FP-5": "This is round 4 of the review loop.",
    "FP-6": "Current loop state: gate status is open.",
    "FP-7": "Only check the imports section of the file.",
}

FORBIDDEN_ZH_SAMPLES = {
    "FP-1": "请检查停止条件是否满足。",
    "FP-2": "累计计数显示共有5个问题。",
    "FP-3": "上一轮发现了3个问题。",
    "FP-4": "修复列表包含5个项目。",
    "FP-5": "这是第3轮审查。",
    "FP-6": "当前循环状态为进行中。",
    "FP-7": "不要审查这个文件。",
}

CLEAN_PROMPT = "Review the following code changes for correctness and style. Check for edge cases in error handling."
```

---

## Dependencies Between Tests

- No test may depend on another test passing (TDD principle: each test is independent).
- **Execution-order constraints** (fixture initialization only, not test dependencies):
  - `temp_git_repo` fixture must initialize git repo before RollbackEngine and CommitGuard tests run (handled by pytest fixture scoping).
  - `temp_ki_doc` fixture must create file before KiDocManager tests run.
  - Tests in `test_intervention_integration.py` should NOT run in parallel with component tests (they share `subprocess.run` mock scope).
  - All test files are independent and can run in parallel with each other.

---

## Open Questions

> **Status legend**: OPEN = unresolved question | RESOLVED = answered with test/code evidence | IMPL-ACTION = design decision made, implementation phase must apply the fix | DESIGN-FIX = Phase 2 design doc must be updated before implementation

| # | Status | Question | Resolution |
|---|--------|----------|------------|
| 1 | OPEN | Phase-appropriateness validation: Should InterventionCoordinator reject V-4 (Phase 4 only) events at Phase 2? | Current design: coordinator builds plan regardless of current_phase. V-4 plan uses `event.context.get("phase", 4)` (dynamic per spec v1.7). If called at Phase 2 with context.phase=4, rollback target would be Phase 4 which is forward (no pre-rollback). This is a Watchdog responsibility (should not fire V-4 at Phase 2). Document as known limitation, not a test gap. |
| 2 | OPEN | subprocess.run timeout: Should git commands have explicit timeouts? | Current design: no timeout. In SYNC mode, LLM is blocked anyway. If git hangs, intervention hangs. Mitigated by container timeout. Recommend adding 30s timeout in implementation but not blocking test plan. |
| 3 | OPEN | PromptValidator truncation threshold: Confirm 10KB | Phase 2 specifies 10KB truncation for long prompts. Test should verify truncation behavior at threshold boundary (9999 bytes = no truncate, 10241 bytes = truncate). |
| 4 | OPEN | KiDocManager file creation: parent directory creation depth | Design uses `mkdir(parents=True, exist_ok=True)`. Test should verify deeply nested paths work (e.g., `a/b/c/ki-doc.md`). |
| 5 | RESOLVED | V-7 regression: How are phase5_test_results populated? | Resolution: When phase5_test_results is None/empty, coordinator builds V-7 plan (target_phase=5, auto_fix=False) but cannot determine which tests regressed. Plan instruction includes "no baseline available". Test: `should_raise_regression_without_auto_fix_when_no_baseline`. |
| 6 | RESOLVED | Integration test scope: real git or mocked? | Integration tests (`test_intervention_integration.py`) use real git operations in `tmp_path`. Unit tests mock subprocess.run. This split ensures integration tests catch real git edge cases. |
| 7 | RESOLVED | V-5 detection scope (assertion-only vs refactoring) | Detection is Watchdog/ViolationFilter responsibility, not InterventionCoordinator. The intervention layer receives V-5 events after detection. V-5 scope tests belong in Watchdog test plan, documented here as out of scope. |
| 8 | IMPL-ACTION | KiDocManager timestamp regex timezone coverage | Current Phase 2 regex only matches +HH:MM. Must extend to support Z and +HHMM in implementation phase. Test #55b (`should_parse_iso8601_with_z_and_compact_timezones`) verifies the fix once implemented. |
| 9 | IMPL-ACTION | RollbackEngine._validate_path leading-dash check | Implementation must add `filepath.startswith('-')` check. Test #49b (`should_reject_path_starting_with_dash`) verifies the security fix once implemented. |
| 10 | RESOLVED | CommitGuard untracked file handling at phase boundary | CommitGuard uses git add -u (tracked only). Untracked files are NOT committed at phase boundaries by default. Pre-rollback path handles untracked files via git add <specific_file>. This is intentional to avoid committing unrelated untracked files. |
| 11 | IMPL-ACTION | V-9 standalone auto-fix: ensure_updated() not in Phase 2 intervene() pseudocode | Test 19b expects intervene() to call ensure_updated() for V-9, appending the missing record per AC-I20. Phase 2 pseudocode only shows record_intervention(). **Action**: Implementation must add ensure_updated() call between steps 4 and 6 for V-9 specifically. Phase 2 design document should be updated accordingly. |
| 12 | DESIGN-FIX | _handle_merged V-10/V-11 only: record_merge not called | Phase 1 Merge Rule requires single ki doc entry for ALL merged violations. Phase 2 _handle_merged only calls record_merge when V-8/V-9 events exist. Test 19a expects ki doc recording for V-10/V-11 only merges. **Fix**: Phase 2 design must be updated — move `record_merge` call outside the `ki_events` conditional so ALL merged sets produce a ki doc entry, not just those containing V-8/V-9. Implementation then follows updated pseudocode. |
| 13 | RESOLVED | Spec v1.7 deviation AC-I19: ZH bare patterns | Test plan aligned — all ZH pattern tests expect bare regex matching (no lookaround, no \b). 30 ZH tests in test_prompt_validator.py cover FP-1..FP-7. See Core Scenario 21 and Key Functional Point 17. |
| 14 | RESOLVED | Spec v1.7 deviation AC-I8: Dynamic target_phase | Test plan aligned — V-4 plan uses event.context.get("phase", 4) instead of hardcoded 4. See Core Scenario 8 and test #18. |
| 15 | RESOLVED | Spec v1.7 deviation AC-I9: REGRESSION instruction strengthened | Test plan aligned — V-7 plan instruction is "Regression detected — return to Phase 5 and fix the failing implementation". See test #20 and Design row #8. |
| 16 | RESOLVED | Spec v1.7: Dual field model (affected_file_path + affected_file_paths) | Test plan aligned — new tests #77-80 cover multi-file pre-rollback, multi-file rollback, fallback to singular, and all-fail case. Factory definition updated with affected_file_paths parameter. |

---

## Priority Downgrade Justifications

### From Phase 1 (Requirements → Test Plan)

No downgrades. All 10 user stories are Core and remain Core in the test plan. Every Core scenario receives comprehensive testing (happy + edge + error).

### From Phase 2 (Technical Design → Test Plan)

No downgrades. All 4 Key components (InterventionCoordinator, PromptValidator, RollbackEngine, KiDocManager) remain Key with comprehensive testing. CommitGuard (Peripheral) receives basic testing (happy + primary error).

---

## Priority Upgrade Review

### Secondary → Core Scenarios

No secondary scenarios exist in Phase 1. All 10 user stories are Core. No upgrades detected.

### Peripheral → Key Functional Points

No peripheral-to-key upgrades detected. CommitGuard remains Peripheral with basic testing. No scope creep identified.

---

## Test File Summary

> **Note on test counts**: The Requirements Coverage Matrix and Design Coverage Matrix trace different dimensions (ACs vs design elements). Many matrix rows map to the same test function verified from different angles. The counts below reflect unique test functions.

| Test File | Component | Priority | Estimated Test Count |
|-----------|-----------|----------|---------------------|
| `test_intervention_coordinator.py` | InterventionCoordinator | Key | ~45 |
| `test_prompt_validator.py` | PromptValidator | Key | ~30 |
| `test_rollback_engine.py` | RollbackEngine | Key | ~26 |
| `test_ki_doc_manager.py` | KiDocManager | Key | ~18 |
| `test_commit_guard.py` | CommitGuard | Peripheral | ~12 |
| `test_intervention_integration.py` | Cross-component flows | — | ~8 |
| **Total** | | | **~138+** |

> **Actual test count (Phase 5 implementation)**: 164 tests across 6 files. The difference from estimated ~138 reflects additional edge cases discovered during implementation (multi-file rollback, IOError protection, ZH bare pattern expansion).

### Integration Test Scenarios (`test_intervention_integration.py`)

| # | Test Name | Description | Components Covered |
|---|-----------|-------------|-------------------|
| 1 | `should_end_to_end_block_pipeline_on_skip_red_phase` | Full lifecycle: V-4 event → plan → pre-commit → rollback (git rm) → ki doc update → post-commit → TDDViolationError | Coordinator, RollbackEngine, KiDocManager, CommitGuard |
| 2 | `should_end_to_end_restore_modified_test_from_git` | Full lifecycle: V-5 event → pre-commit → git checkout → ki doc → commit → TDDViolationError | Coordinator, RollbackEngine, KiDocManager, CommitGuard |
| 3 | `should_end_to_end_handle_merged_violations_in_correct_order` | V-10 + V-12 + V-8 at same boundary → commit → assessment → ki doc update → single TDDViolationError | Coordinator, CommitGuard, KiDocManager |
| 4 | `should_end_to_end_preserve_committed_work_on_phase_rollback` | V-6 detected in Phase 5 → commit Phase 5 work → rollback to Phase 4 → Phase 5 work in git history | Coordinator, RollbackEngine, CommitGuard |
| 5 | `should_end_to_end_handle_rollback_failure_gracefully` | V-4 with git rm failure → RollbackResult(success=False) → ki doc still updated → TDDViolationError with auto_fix_applied=False | Coordinator, RollbackEngine, KiDocManager |
| 6 | `should_end_to_end_validate_prompt_and_block_with_details` | V-13 with forbidden EN+ZH content → PromptValidator → multiple PatternMatches → ki doc PROMPT-VALIDATION entry → TDDViolationError | Coordinator, PromptValidator, KiDocManager |
| 7 | `should_end_to_end_rollback_to_phase5_on_regression` | Phase 5 tests pass → Phase 6 detects regression → rollback to Phase 5 → ki doc updated → TDDViolationError | Coordinator, RollbackEngine, KiDocManager, CommitGuard |
| 8 | `should_end_to_end_auto_append_outdated_ki_doc_for_v9` | V-9 KI_DOC_OUTDATED → ensure_updated() auto-appends missing record → record_intervention → commit → TDDViolationError | Coordinator, KiDocManager, CommitGuard |

---

## Violation Type Coverage Summary

| Code | Violation Type | Test File(s) | Test Count |
|------|---------------|-------------|------------|
| V-1 | SKIP_REVIEW | `test_intervention_coordinator.py` | 2 |
| V-2 | INSUFFICIENT_REVIEW | `test_intervention_coordinator.py` | 2 |
| V-3 | UNFIXED_ISSUES | `test_intervention_coordinator.py` | 2 |
| V-4 | SKIP_RED_PHASE | `test_intervention_coordinator.py`, `test_rollback_engine.py`, `test_intervention_integration.py` | 5 |
| V-5 | MODIFIED_TEST | `test_intervention_coordinator.py`, `test_rollback_engine.py`, `test_intervention_integration.py` | 6 |
| V-6 | MISSING_TEST | `test_intervention_coordinator.py` | 3 |
| V-7 | REGRESSION | `test_intervention_coordinator.py`, `test_intervention_integration.py` | 5 |
| V-8 | MISSING_KI_DOC | `test_intervention_coordinator.py`, `test_ki_doc_manager.py`, `test_intervention_integration.py` | 4 |
| V-9 | KI_DOC_OUTDATED | `test_intervention_coordinator.py`, `test_ki_doc_manager.py`, `test_intervention_integration.py` | 5 |
| V-10 | UNCOMMITTED_PHASE | `test_commit_guard.py`, `test_intervention_integration.py` | 3 |
| V-11 | UNCOMMITTED_REVIEW | `test_commit_guard.py` | 2 |
| V-12 | MISSING_KI_ASSESSMENT | `test_ki_doc_manager.py`, `test_intervention_coordinator.py` | 4 |
| V-13 | INVALID_REVIEW_PROMPT | `test_prompt_validator.py`, `test_intervention_coordinator.py`, `test_intervention_integration.py` | 15+ |

---

*Document created: 2026-05-25*
*Version: v1.6*
*Phase: 3 (Test Plan)*
*Next: Ralph Loop Review R2*
