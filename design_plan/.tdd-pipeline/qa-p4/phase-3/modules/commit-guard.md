# Test Plan: Commit Guard

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (AC) | Derived Functional Points | Test Cases |
|---|--------------|-------------|--------------------------|------------|
| 1 | Guard blocks non-staging rule from commit | AC-7 | Status check before commit | guard blocks pending/verified/rejected, passes staging |
| 2 | Guard validates frontmatter schema | AC-7 | AutoCommitter.validate_schema inlined | category required, confidence 0.0-1.0, error_summary ≤200 chars |
| 3 | Guard passes valid staging rule | AC-7 | Guard success path | valid staging rule commits successfully |
| 4 | skip_guard parameter bypasses guard | AC-7 | skip_guard=True skips checks | skip_guard allows commit of non-staging or invalid schema |
| 5 | ARISTOTLE_CI env var disables skip_guard | AC-7 | CI enforcement | skip_guard=True ignored when ARISTOTLE_CI=true |

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source (Component/Interface) | Test Cases |
|---|---------------------|------------------------------|------------|
| 1 | Status check before commit | CommitGuard.ensure_committed | verify status is "staging" before proceeding |
| 2 | Category required validation | AutoCommitter.validate_schema | error when category missing |
| 3 | Confidence numeric validation | AutoCommitter.validate_schema | error when confidence non-numeric |
| 4 | Confidence range validation | AutoCommitter.validate_schema | error when confidence <0.0 or >1.0 |
| 5 | Error summary length validation | AutoCommitter.validate_schema | error when error_summary >200 chars |
| 6 | skip_guard bypass logic | AC-7 spec | skip_guard=True skips status and schema checks |
| 7 | CI env override logic | AC-7 spec | ARISTOTLE_CI=true forces guard even with skip_guard=True |
| 8 | Backward compatibility | AC-7 spec | commit_rule without skip_guard parameter works as before |
| 9 | Confidence boundary values | AutoCommitter.validate_schema | 0.0 and 1.0 pass, -0.1 and 1.1 fail |

### Peripheral Functional Points

| # | Peripheral Functional Point | Source | Test Cases |
|---|----------------------------|--------|------------|
| 1 | Audit log entry on guard block | Cross-cutting #3 | McpAuditEntry written when guard blocks commit |

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | AC | Test Type | Test File | Test Name | Description |
|---|----------|----|-----------|-----------|-----------|-------------|
| 1 | Core | AC-7 | Unit | test_commit_guard.py | `should_block_non_staging_rule_from_commit` | Guard returns error when status != "staging" |
| 2 | Core | AC-7 | Unit | test_commit_guard.py | `should_allow_staging_rule_to_commit` | Guard proceeds when status == "staging" |
| 3 | Core | AC-7 | Unit | test_commit_guard.py | `should_block_when_category_missing` | Schema validation error on missing category |
| 4 | Core | AC-7 | Unit | test_commit_guard.py | `should_block_when_confidence_non_numeric` | Schema validation error on non-numeric confidence |
| 5 | Core | AC-7 | Unit | test_commit_guard.py | `should_block_when_confidence_below_zero` | Schema validation error when confidence < 0.0 |
| 6 | High | AC-7 | Unit | test_commit_guard.py | `should_return_error_on_malformed_frontmatter` | YAML parse failure returns graceful error |
| 6.1 | Medium | AC-7 | Unit | test_commit_guard.py | `should_block_commit_on_file_without_frontmatter` | Markdown file with content but no YAML frontmatter delimiters (`---`) returns guard error: no status field to validate |
| 7 | Core | AC-7 | Unit | test_commit_guard.py | `should_block_when_confidence_above_one` | Schema validation error when confidence > 1.0 |
| 8 | Core | AC-7 | Unit | test_commit_guard.py | `should_block_when_error_summary_too_long` | Schema validation error when error_summary > 200 chars |
| 9 | Core | AC-7 | Unit | test_commit_guard.py | `should_pass_valid_staging_rule` | Valid staging rule passes both checks and commits (actual git commit is verified, not just guard approval) |
| 10 | High | AC-7 | Unit | test_commit_guard.py | `should_return_error_when_rule_file_does_not_exist` | Verify graceful error, not FileNotFoundError |
| 11 | Core | AC-7 | Unit | test_commit_guard.py | `should_bypass_guard_with_skip_guard_true` | skip_guard=True allows non-staging or invalid schema |
| 12 | Core | AC-7 | Unit | test_commit_guard.py | `should_enforce_guard_in_ci_even_with_skip_guard` | ARISTOTLE_CI=true ignores skip_guard=True. Edge cases for ARISTOTLE_CI env var (false, empty string, garbage values, unset) covered by tests #27–30. |
| 13 | Core | AC-7 | Unit | test_commit_guard.py | `should_accept_confidence_boundary_zero` | confidence = 0.0 is valid. Note: Integer confidence (1) is a type coercion edge case from YAML int, expected to be accepted as valid. |
| 14 | Core | AC-7 | Unit | test_commit_guard.py | `should_accept_confidence_boundary_one` | confidence = 1.0 is valid. Note: Integer confidence (1) is a type coercion edge case from YAML int, expected to be accepted as valid. |
| 15 | Core | AC-7 | Unit | test_commit_guard.py | `should_reject_confidence_negative` | confidence = -0.1 is invalid |
| 16 | Core | AC-7 | Unit | test_commit_guard.py | `should_reject_confidence_above_one` | confidence = 1.1 is invalid |
| 17 | Medium | AC-7 | Unit | test_commit_guard.py | `should_block_verified_rule_from_commit` | Specifically test verified status |
| 18 | Medium | AC-7 | Unit | test_commit_guard.py | `should_block_rejected_rule_from_commit` | Specifically test rejected status |
| 19 | Core | AC-7 | Unit | test_commit_guard.py | `should_work_without_skip_guard_parameter` | Backward compatibility: commit_rule works without skip_guard |
| 20 | Core | AC-7 | Integration | test_commit_guard.py | `should_write_audit_log_entry_on_guard_block` | Guard block writes McpAuditEntry |
| 21 | Core | AC-7 | Unit | test_commit_guard.py | `should_accept_error_summary_at_exact_200_chars` | error_summary of exactly 200 chars passes validation |
| 22 | Core | AC-9 | Integration | test_commit_guard.py | `should_write_audit_entry_on_guard_pass` | Successful guard pass and commit writes McpAuditEntry with result="success" |
| 23 | Medium | AC-7 | Unit | test_commit_guard.py | `should_report_first_validation_failure_when_multiple_issues` | Verify error message identifies first failed check when both status and schema are invalid. Note: Exploratory test - behavior not explicitly specified in current ACs, to be confirmed during Phase 4 implementation. |
| 24 | Medium | AC-7 | Unit | test_commit_guard.py | `should_block_commit_on_already_verified_rule` | commit_rule called on file with status='verified' is rejected — guard blocks non-staging files |
| 25 | Medium | AC-7 | Unit | test_commit_guard.py | `should_accept_integer_confidence_from_yaml` | YAML `confidence: 1` (int) is accepted as valid — type coercion from int to float is handled gracefully |
| 26 | Medium | AC-7 | Unit | test_commit_guard.py | `should_reject_confidence_none` | YAML `confidence:` (no value, parses as None in Python) returns validation error — non-numeric |
| 27 | Medium | AC-7 | Unit | test_commit_guard.py | `should_handle_aristotle_ci_false_value` | ARISTOTLE_CI=false does NOT enable CI enforcement (string comparison: only "true" enables) |
| 28 | Medium | AC-7 | Unit | test_commit_guard.py | `should_handle_aristotle_ci_empty_string` | ARISTOTLE_CI="" does NOT enable CI enforcement |
| 29 | Medium | AC-7 | Unit | test_commit_guard.py | `should_handle_aristotle_ci_garbage_value` | ARISTOTLE_CI=yes/1/random does NOT enable CI enforcement (only exact string "true") |
| 30 | Medium | AC-7 | Unit | test_commit_guard.py | `should_not_enforce_ci_when_aristotle_ci_unset` | ARISTOTLE_CI not present in environment (unset, not empty string) does not enable CI enforcement |

---

**Note: Tests #15/#16 mirror #5/#6 from Phase 1 → Tests matrix; retained for Phase 2 → Tests matrix traceability. This redundancy is intentional for coverage completeness.**

**Note per ADR-016: CommitGuard does not define validate_schema — schema validation logic comes from AutoCommitter. Tests #3-8 validate the integrated commit_rule behavior which combines guard status check + AutoCommitter schema validation. Test names reference the observable behavior, not the internal component ownership.**

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test File | Test Name | Description |
|---|----------|---------------|-------------|-----------|-----------|-----------|-------------|
| 1 | Key | Status check | Constraint | Unit | test_commit_guard.py | `should_block_non_staging_rule_from_commit` | Verify status == "staging" before commit |
| 2 | Key | Category required | Constraint | Unit | test_commit_guard.py | `should_block_when_category_missing` | Category field must be present |
| 3 | Key | Confidence numeric | Constraint | Unit | test_commit_guard.py | `should_block_when_confidence_non_numeric` | Confidence must be int or float |
| 4 | Key | Confidence range | Constraint | Unit | test_commit_guard.py | `should_block_when_confidence_below_zero` | Confidence >= 0.0 |
| 5 | Key | Confidence range | Constraint | Unit | test_commit_guard.py | `should_block_when_confidence_above_one` | Confidence <= 1.0 |
| 6 | Key | Error summary length | Constraint | Unit | test_commit_guard.py | `should_block_when_error_summary_too_long` | error_summary <= 200 chars |
| 7 | Key | skip_guard bypass | Interface | Unit | test_commit_guard.py | `should_bypass_guard_with_skip_guard_true` | skip_guard=True parameter skips checks |
| 8 | Key | CI env override | Constraint | Unit | test_commit_guard.py | `should_enforce_guard_in_ci_even_with_skip_guard` | ARISTOTLE_CI=true forces guard |
| 9 | Key | Backward compatibility | Interface | Unit | test_commit_guard.py | `should_work_without_skip_guard_parameter` | Existing calls without skip_guard work |
| 10 | Key | Confidence boundaries | Constraint | Unit | test_commit_guard.py | `should_accept_confidence_boundary_zero` | 0.0 is valid boundary |
| 11 | Key | Confidence boundaries | Constraint | Unit | test_commit_guard.py | `should_accept_confidence_boundary_one` | 1.0 is valid boundary |
| 12 | High | Status variants | Constraint | Unit | test_commit_guard.py | `should_block_verified_rule_from_commit` | Verify verified status blocks commit |
| 13 | High | Status variants | Constraint | Unit | test_commit_guard.py | `should_block_rejected_rule_from_commit` | Verify rejected status blocks commit |

## Edge Cases & Error Paths

- [x] null_inputs — file_path is None or empty string
- [x] empty_collections — frontmatter dict empty or missing fields
- [x] max_values — confidence exactly 0.0, exactly 1.0, error_summary exactly 200 chars
- [ ] concurrent_access — N/A for Phase 4 (single-agent, ADR-007)
- [x] timeouts — N/A (synchronous git operations, ADR-005)
- [x] network_failures — git command failure on commit (git repo corrupted)
- [x] invalid_state_transitions — commit_rule on already-verified rule
- [x] serialization_boundary — confidence at boundary floats (0.000001, 0.999999)
- [x] error_handler_correctness — Guard block returns graceful error dict, not exception
- [x] implicit_contract — Guard writes audit entry when blocking commit (cross-cutting #3)
- [ ] resource_leak — N/A (no file handles held across guard logic)
- [x] cascading_failure — Schema validation error doesn't corrupt rule file
- [ ] performance_logic — N/A (single check per commit)
- [x] file_not_found — Rule file does not exist (graceful error, not FileNotFoundError)
- [x] malformed_frontmatter — YAML parse failure returns graceful error
- [x] status_variants — Verified and rejected status blocks commit

**Note: Edge case confidence=None is now covered by test #26. Expected behavior: validation error (non-numeric).**

## Test Data

- **Fixtures**: `tmp_repo` for git repository with rule files, `monkeypatch` for env vars
- **Mock rule file**: valid staging rule with all required fields (category, confidence, error_summary)
- **Invalid rule files**:
  - Missing category field
  - Non-numeric confidence (string)
  - confidence = -0.1
  - confidence = 1.1
  - error_summary = 201 chars
  - Malformed frontmatter (invalid YAML)
  - Nonexistent file path
- **Status variants**: pending, staging, verified, rejected
- **Env var mocks**: ARISTOTLE_CI set to "true", "false", "", "yes", "1", "random", or unset. Only exact string "true" enables CI enforcement.
- **Boundary values**: confidence 0.0, 0.000001, 0.999999, 1.0, error_summary 200 chars

---

**Note: error_summary (commit guard) has 200-char limit per commit-guard schema; McpAuditEntry.error field has 500-char limit per §3.0.7. These are separate fields with separate limits.**

## Dependencies Between Tests

- No test depends on another test passing
- All tests use fresh `tmp_repo` via fixture
- Env var tests use `monkeypatch.setenv` and `monkeypatch.delenv` for isolation