# Test Plan: Rollback Tools

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (AC) | Derived Functional Points | Test Cases |
|---|--------------|-------------|--------------------------|------------|
| 1 | Create rollback point | AC-1 | create_rollback_point, git stash with prefix | stash created, prefixed, hash returned |
| 2 | Rollback to checkpoint | AC-1, AC-10 | rollback_to_checkpoint, git stash apply | restore state, pipeline_reset_required flag |
| 3 | Cleanup rollback stashes | AC-1 | cleanup_rollback_stashes, prune logic | keep N, remove oldest |
| 4 | Prefix filtering | AC-1 | Only `aristotle-rollback:` stashes managed | non-prefixed stashes untouched |
| 5 | Stash safety thresholds | AC-1 | warning≥5, hard≥10 | warning returned, rollback blocked |

**Note: AC-3 (intervention/ directory deletion) is tested in integration.md tests #5-7. Rollback operations that restore checkpoints implicitly validate directory state.**

### Key Functional Points (from Phase 2 — priority: key)

**Note: Phase 1 spec §3.0.4 uses 'git reset --hard' as a generic description of rollback behavior. The actual implementation uses git stash exclusively (see ADR-007). Tests verify stash-based behavior.**

| # | Key Functional Point | Source | Test Cases |
|---|---------------------|--------|------------|
| 1 | git stash with prefix | RollbackEngine → create_rollback_point | stash message contains prefix |
| 2 | git stash apply | RollbackEngine → rollback_to_checkpoint | correct stash applied by name |
| 3 | validate_path | RollbackEngine.validate_path | path traversal blocked, relative path ok. Note: validate_path applies to path parameters in general, not to stash-name-based rollback operations. |
| 4 | pipeline_reset_required flag | §3.0.3a | flag true on successful rollback |
| 5 | Untracked files warning | UNTRACKED_FILES_THRESHOLD | >100MB returns warning dict |
| 6 | Stash count thresholds | STASH_WARNING/HARD_LIMIT | warning at 5, block at 10 |
| 7 | Cleanup keep count | STASH_CLEANUP_KEEP = 3 | keeps 3 most recent |

### Peripheral Functional Points

| # | Peripheral Functional Point | Source | Test Cases |
|---|----------------------------|--------|------------|
| 1 | Stash listing | helper for cleanup | list only prefixed stashes |

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | AC | Test Type | Test File | Test Name | Description |
|---|----------|----|-----------|-----------|-----------|-------------|
| 1 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_create_stash_with_prefix` | create_rollback_point creates aristotle-rollback: prefixed stash |
| 2 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_return_stash_ref_on_create` | Returns stash reference/hash |
| 3 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_rollback_to_named_checkpoint` | rollback_to_checkpoint restores from named stash |
| 4 | High | AC-1 | Integration | test_mcp_rollback.py | `should_verify_restored_state_matches_checkpoint` | Verify actual file content after rollback, not just return flag |
| 5 | Core | AC-10 | Unit | test_mcp_rollback.py | `should_return_pipeline_reset_required_on_rollback` | Flag set to true |
| 6 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_cleanup_oldest_stashes` | cleanup_rollback_stashes keeps N most recent |
| 7 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_only_manage_prefixed_stashes` | Non-prefixed stashes never touched |
| 8 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_warn_at_stash_threshold_warning` | warning returned when stash count ≥ 5 |
| 9 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_block_at_stash_hard_limit` | create blocked when stash count ≥ 10 |
| 10 | Core | Constraint | Unit | test_mcp_rollback.py | `should_warn_on_large_untracked_files` | Warning when untracked > 100MB AND rollback still proceeds successfully |
| 11 | High | Constraint | Integration | test_mcp_rollback.py | `should_proceed_with_rollback_after_untracked_warning` | Verify rollback executes after warning about large untracked files |
| 12 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_validate_path_blocks_traversal` | Blocks both leading ../ and mid-path foo/../../etc/passwd patterns |
| 13 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_accept_valid_relative_path` | validate_path allows valid relative paths |
| 14 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_accept_absolute_path_within_repo` | validate_path allows absolute paths within repo |
| 15 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_reject_symlink_escape` | validate_path rejects symlinks pointing outside repo |
| 16 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_fail_gracefully_on_stash_create_error` | git stash failure returns error |
| 17 | High | AC-1 | Unit | test_mcp_rollback.py | `should_handle_stash_with_no_changes` | Returns success/no-op when working tree is clean (no stash created). **Note**: `git stash` returns error on clean tree; implementation catches this and returns synthetic success `{success: true, message: "no changes to stash"}`. |
| 17.1 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_reject_empty_checkpoint_name` | create_rollback_point with name="" returns validation error |
| 18 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_fail_gracefully_on_stash_apply_error` | git stash apply failure returns error |
| 19 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_handle_empty_stash_list_on_cleanup` | cleanup with no stashes succeeds |
| 20 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_succeed_when_keep_count_exceeds_available_stashes` | Verify no error when keep > available |
| 20.1 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_reject_negative_or_non_integer_keep` | cleanup_rollback_stashes with keep=-1, keep=1.5, or keep="three" returns validation error |
| 21 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_handle_rollback_to_nonexistent_checkpoint` | Error for unknown checkpoint name |
| 22 | Core | AC-1 | Integration | test_mcp_rollback.py | `should_complete_create_rollback_cleanup_lifecycle` | Full create→rollback→cleanup flow |
| 23 | Core | AC-9 | Unit | test_mcp_rollback.py | `should_write_audit_entry_on_rollback_create` | create_rollback_point writes McpAuditEntry |
| 24 | Core | AC-9 | Unit | test_mcp_rollback.py | `should_write_audit_entry_on_rollback_to_checkpoint` | rollback_to_checkpoint writes McpAuditEntry |
| 25 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_preserve_stash_on_apply_failure` | Failed stash apply does not remove the stash entry. Implementation uses `git stash apply` (not `git stash pop`) to preserve stash on failure. Conditional `git stash drop` only on successful apply. |
| 26 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_handle_stash_apply_merge_conflict` | Merge conflict during stash apply: returns error dict with `{success: false, error: "merge conflict", conflict_files: [...]}`, stash entry preserved in stash list, working tree files left in conflicted state. Stash is always preserved on conflict; user must manually resolve conflicts. |
| 27 | Core | AC-9 | Unit | test_mcp_rollback.py | `should_write_audit_entry_on_cleanup_rollback_stashes` | cleanup_rollback_stashes writes McpAuditEntry |
| 28 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_handle_special_characters_in_checkpoint_name` | Verify names with spaces, unicode, shell-unsafe characters. **Security**: All subprocess.run calls MUST use list-form args (never shell=True) to prevent command injection via checkpoint names. Test with: `'test;echo pwned'`, `'test$(whoami)'`, `'test`id`'`. |
| 29 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_handle_duplicate_checkpoint_name` | Creating two checkpoints with same name: implementation achieves last-write-wins by first dropping any existing stash with the same name (`git stash drop`), then creating a new stash (`git stash push`). Second call overwrites the first. **Design decision**: last-write-wins is an implementation choice not specified in Phase 1/2 docs; documented here as the agreed behavior for Phase 4. Implementation mechanism: explicit `drop` + `push` sequence, NOT relying on git stash overwriting (which it doesn't). |
| 30 | Medium | AC-1 | Integration | test_mcp_rollback.py | `should_handle_guard_block_then_rollback_interaction` | When CommitGuard blocks a commit, rollback_to_checkpoint should work correctly |
| 31 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_handle_externally_removed_stash` | Stash referenced by name no longer exists in git stash list — returns clear error |
| 32 | Medium | AC-1 | Unit | test_mcp_rollback.py | `should_succeed_stash_apply_with_modified_working_directory` | Modified (non-conflicting) files in working tree don't prevent stash apply |
| 33 | Core | AC-1 | Unit | test_mcp_rollback.py | `should_delete_all_stashes_when_keep_zero` | cleanup_rollback_stashes(keep=0) removes all prefixed stashes |

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test Name | Description |
|---|----------|---------------|-------------|-----------|-----------|-------------|
| 1 | Key | RollbackEngine.rollback | Component | Unit | `should_rollback_to_named_checkpoint` | Simplified generic reset only |
| 2 | Key | RollbackEngine.validate_path | Component | Unit | `should_validate_path_blocks_traversal` | Path safety |
| 3 | Key | STASH_WARNING_THRESHOLD | Constant | Unit | `should_warn_at_stash_threshold_warning` | Count ≥ 5 |
| 4 | Key | STASH_HARD_LIMIT | Constant | Unit | `should_block_at_stash_hard_limit` | Count ≥ 10 |
| 5 | Key | UNTRACKED_FILES_THRESHOLD | Constant | Unit | `should_warn_on_large_untracked_files` | > 100MB |
| 6 | Key | STASH_CLEANUP_KEEP | Constant | Unit | `should_cleanup_oldest_stashes` | Keep 3 |
| 7 | Key | pipeline_reset_required | Interface field | Unit | `should_return_pipeline_reset_required_on_rollback` | Flag in return dict |

## Edge Cases & Error Paths

- [x] null_inputs — None checkpoint name
- [x] empty_collections — empty stash list on cleanup
- [x] max_values — exactly 10 stashes (hard limit boundary)
- [ ] concurrent_access — N/A (single-agent)
- [ ] timeouts — N/A (git operations synchronous)
- [x] network_failures — git command failure (not a git repo)
- [x] invalid_state_transitions — rollback to nonexistent checkpoint
- [x] serialization_boundary — N/A (git handles binary). Note: binary file stash handling via git internals.
- [x] error_handler_correctness — stash failure returns error dict, doesn't raise
- [x] implicit_contract — prefix format must match exactly for stash management
- [ ] resource_leak — N/A
- [x] cascading_failure — rollback failure doesn't delete stash (test #25: should_preserve_stash_on_apply_failure)
- [ ] performance_logic — N/A (stash operations are git-native)

## Test Data

- **Implementation constraint**: All subprocess.run calls MUST use list-form args (never shell=True) to prevent command injection via user-provided checkpoint names. This is a security requirement verified by test #28.
- **Mock git stash list**: `"aristotle-rollback:checkpoint-1@{0}: test\naristotle-rollback:checkpoint-2@{1}: test\nother-stash@{2}: misc"`
- **Large untracked file**: mock `du` output > 100MB
- **tmp_repo fixture**: provides initialized git repo with `tmp_repo` fixture
- **Minimum git version**: 2.0+ (stash list format @{N} stable since git 2.0)
- **Stash name format**: Follows git stash conventions: `aristotle-rollback:checkpoint-<name>` where `<name>` is user-provided. **Design decision**: The `checkpoint-` sub-prefix is a test plan refinement beyond the spec's `aristotle-rollback:` prefix (from 05-phase4-merge.md). Spec reconciliation: 01-interfaces.md §3.0.4 should update stash name format to include `checkpoint-` during Phase 4. Tests assert the full format including sub-prefix.

## Dependencies Between Tests

- No test depends on another test
- All use fresh `tmp_repo` fixture
- Git operations use real subprocess in tmp_repo (not mocked) for integration fidelity; unit tests for threshold logic mock subprocess.run. Tests using real git: #1-4, #6-7, #10, #13-16, #22-28, #30, #32. Tests using mocked subprocess: #5, #8-9, #11-12, #17-21, #29, #31, #33.

## Open Questions

- None. Stash name format confirmed: `aristotle-rollback:checkpoint-<name>` where `<name>` is user-provided. The `checkpoint-` sub-prefix is a test plan design decision (see Test Data section for reconciliation note).

---

**Note: Per 05-phase4-merge.md line 22, "git reset --hard" is mentioned as the generic rollback mechanism. The implementation uses stash-based operations (create_rollback_point/rollback_to_checkpoint) exclusively — `git stash apply` restores state (NOT `git stash pop` and NOT `git reset --hard`). `git stash apply` preserves the stash entry on failure; `git stash pop` drops it unconditionally. This is a design clarification: rollback_to_checkpoint = `git stash apply` + conditional `git stash drop` on success. No git reset --hard tests are needed.**

**Traceability note for RollbackEngine "2 generic handlers"**: The Phase 1 spec (05-phase4-merge.md line 22) references "2 个通用处理器". Handler 1 = `validate_path()` (tested in tests #12-15). Handler 2 = generic rollback mechanism, now implemented as stash-based `create_rollback_point`/`rollback_to_checkpoint` lifecycle (tested in tests #1-4, #22). Both handlers have complete test coverage.
