# Test Plan: Integration

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (AC) | Derived Functional Points | Test Cases |
|---|--------------|-------------|--------------------------|------------|
| 1 | MCP tool count = 27 after merge (22 existing + 5 new) | AC-4 | Server tool registration, 22 existing + 5 new | tool count assertion, all tools callable |
| 2 | intervention/ directory deleted | AC-3 | File system validation, merge completeness | directory non-existence, all 10 files deleted |
| 3 | Import verification for new tools | AC-1 | Module imports, registration pattern | all 5 new tools importable, no import errors |
| 4 | Tool registration after init_repo | AC-4, AC-8 | init_repo integration, tool availability | tools present after repo init, registration order |
| 5 | Tools work without prior state | AC-5 | Stateless execution, no session dependency | fresh repo execution, no pre-existing data required |
| 6 | Import failure for deleted modules | AC-3 | Module removal, import error propagation | importing deleted modules raises ImportError |
| 7 | Full lifecycle E2E | AC-1, AC-4 | Cross-module integration, tool chaining | create_rollback_point → write_ki_doc → commit_rule with guard → rollback_to_checkpoint → cleanup |
| 8 | PromptValidator bilingual patterns migrated | AC-6 | Pattern verification, Ralph Loop integration | bilingual patterns exist in Reviewer prompt, no duplicates |

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source (Component/Interface) | Test Cases |
|---|---------------------|------------------------------|------------|
| 1 | Tool registration pattern | server.py register_*_tools() | all 5 new modules have register functions called |
| 2 | Directory cleanup validation | AC-3, merge strategy | intervention/ directory absent, no残留文件 |
| 3 | Stateless tool behavior | AC-5, MCP tool contracts | tool calls don't require session state, idempotent |
| 4 | Import error propagation | Python import system | deleted modules raise ImportError with clear message |
| 5 | Cross-module tool chaining | Integration E2E flow | tools can be called in sequence without errors |
| 6 | Bilingual pattern migration | PromptValidator → Ralph Loop | Reviewer prompt contains bilingual forbidden patterns |
| 7 | Interface documentation | AC-8, docstrings | all preserved modules have interface docs |

### Peripheral Functional Points

| # | Peripheral Functional Point | Source | Test Cases |
|---|----------------------------|--------|------------|
| 1 | Tool count constant | MCP_TOOL_COUNT_POST_MERGE constant | constant value matches 27 (22 existing + 5 new). Note: MCP_TOOL_COUNT_POST_MERGE=25 in Phase 1 spec was a pre-implementation estimate. Actual post-merge count is 27 (22 existing + 5 new). Phase 4 test will verify exact count at execution time. |
| 2 | Module re-export pattern | server.py re-exports | new tools re-exported for test access |

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | AC | Test Type | Test File | Test Name | Description |
|---|----------|----|-----------|-----------|-----------|-------------|
| 1 | Core | AC-1 | Integration | test_integration.py | `should_perform_full_lifecycle_e2e_flow` | create_rollback_point → write_ki_doc → commit_rule with guard → rollback_to_checkpoint (verify pipeline_reset_required=true) → cleanup_rollback_stashes |
| 2 | Core | AC-2 | Integration | test_integration.py | `should_verify_existing_test_suite_passes_post_migration` | Run pytest on existing test suite after merge; all tests pass (AC-2 execution gate) |
| 3 | Core | AC-1 | Unit | test_integration.py | `should_import_all_5_new_tools_successfully` | All new tools import without errors |
| 4 | Core | AC-1 | Unit | test_integration.py | `should_import_migrated_type_definitions` | All types from deleted intervention_types.py importable from new locations: ViolationEvent, RollbackResult, PipelineContext, InterventionRecord, PhaseState (from aristotle_mcp._tools_rollback or aristotle_mcp._tools_ki_doc). **Complete type list**: Phase 4 implementation MUST read `intervention/src/intervention_types.py` exports and verify 1:1 coverage. The 5 types listed are the minimum known set; additional types discovered during Phase 4 must be added to this test. |
| 5 | Core | AC-3 | Integration | test_integration.py | `should_verify_intervention_directory_deleted` | intervention/ directory does not exist |
| 6 | Core | AC-3 | Integration | test_integration.py | `should_fail_to_import_deleted_intervention_modules` | Importing deleted modules raises ImportError |
| 7 | Core | AC-3 | Integration | test_integration.py | `should_verify_all_10_deleted_files_absent` | All 10 intervention files deleted from file system |
| 8 | Core | AC-4 | Integration | test_integration.py | `should_assert_mcp_tool_count_equals_27` | assert count equals 27 (22 existing aristotle_* + 5 new) |
| 9 | Core | AC-4 | Integration | test_integration.py | `should_register_tools_after_init_repo` | All 27 tools available after init_repo (22 existing + 5 new) |
| 10 | Core | AC-5 | Unit | test_integration.py | `should_execute_tools_without_prior_session_state` | Fresh repo execution works without pre-existing state |
| 11 | Core | AC-5 | Unit | test_integration.py | `should_verify_no_session_state_dependency_in_tools` | Tools don't store session_id across calls. Stateless verification per tool: create_rollback_point (no session state), rollback_to_checkpoint (reads from git stash, no session state), cleanup_rollback_stashes (reads stash list, no session state), write_ki_doc (writes to filesystem, no session state), read_ki_docs (reads from filesystem, no session state) |
| 12 | Core | AC-6 | Integration | test_integration.py | `should_verify_bilingual_patterns_in_ralph_loop_reviewer` | Reviewer prompt contains bilingual forbidden patterns |
| 13 | Core | AC-6 | Unit | test_integration.py | `should_confirm_prompt_validator_module_deleted` | prompt_validator.py removed from intervention/ |
| 14 | Core | AC-8 | Unit | test_integration.py | `should_verify_all_preserved_modules_have_interface_docs` | All preserved modules have docstrings/interface docs |
| 15 | Core | AC-4 | Unit | test_integration.py | `should_verify_tool_registration_order` | Tools registered in correct order after imports |
| 16 | Core | AC-1 | Integration | test_integration.py | `should_rollback_and_restore_state_correctly` | rollback_to_checkpoint restores pre-modification state |
| 17 | Core | AC-1 | Integration | test_integration.py | `should_write_and_read_ki_doc_round_trip` | write_ki_doc creates entry, read_ki_docs retrieves it |
| 18 | High | AC-3 | Integration | test_integration.py | `should_verify_no_stale_imports_in_existing_tests` | grep existing test files for `import intervention` or `from intervention` |
| 19 | Core | AC-3 | Unit | test_integration.py | `should_verify_no_stale_imports_in_preserved_modules` | grep aristotle_mcp source for remaining `intervention` import references |
| 20 | Core | AC-1 | Integration | test_integration.py | `should_write_audit_entries_for_entire_lifecycle` | after E2E flow, verify audit.jsonl contains entries for each tool call in correct order. Verify audit entries across full lifecycle: validate McpAuditEntry schema compliance (field types, required fields), content correctness (tool name matches operation, params match call args), truncation behavior (error field ≤ 500 chars), and chronological ordering. |
| 21 | Core | AC-6 | Integration | test_integration.py | `should_verify_all_original_prompt_validator_patterns_migrated` | compare original pattern count with migrated pattern count, ensure 1:1 mapping |
| 22 | High | AC-2 | Integration | test_integration.py | **DEFERRED**: `test_preservation_under_migration` — to be implemented when Phase 4 migration code is available. Tracked in known-issues.md. **Relationship to test #2**: Test #2 covers AC-2 by running the existing test suite post-migration (execution gate). Test #22 is a supplementary fine-grained preservation test for individual migration artifacts. Test #2 alone satisfies AC-2; test #22 adds depth but is not required for the gate. |

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test File | Test Name | Description |
|---|----------|---------------|-------------|-----------|-----------|-----------|-------------|
| 1 | Key | MCP_TOOL_COUNT_POST_MERGE constant | Constant | Unit | test_integration.py | `should_assert_mcp_tool_count_equals_27` | Constant value equals 27 (22 existing + 5 new) |
| 2 | Key | Tool registration pattern | Component | Integration | test_integration.py | `should_register_tools_after_init_repo` | register_*_tools() functions called |
| 3 | Key | Merge-then-delete strategy | Process | Integration | test_integration.py | `should_verify_intervention_directory_deleted` | Directory removed after merge |
| 4 | Key | Stateless tool contracts | Constraint | Unit | test_integration.py | `should_verify_no_session_state_dependency_in_tools` | No session state stored |
| 5 | Key | E2E lifecycle flow | Component | Integration | test_integration.py | `should_perform_full_lifecycle_e2e_flow` | Cross-module tool chaining |
| 6 | Key | PromptValidator migration | Component | Integration | test_integration.py | `should_verify_bilingual_patterns_in_ralph_loop_reviewer` | Patterns moved to Ralph Loop |

## Edge Cases & Error Paths

- [x] null_inputs — None passed to tool parameters
- [x] empty_collections — Empty dict/list parameters
- [x] max_values — Tool count at exactly 27, multiple stashes at limit
- [x] concurrent_access — N/A for Phase 4 (single-agent, ADR-007)
- [x] timeouts — N/A (synchronous operations, ADR-005)
- [x] network_failures — Git operation failures during rollback/commit
- [x] invalid_state_transitions — Rollback to non-existent checkpoint
- [x] serialization_boundary — N/A (tools use JSON-serializable params)
- [x] error_handler_correctness — Import error provides clear message, tool failure doesn't crash server
- [x] implicit_contract — Tools are callable without prior setup
- [x] resource_leak — N/A (no persistent resources held)
- [x] cascading_failure — One tool failure doesn't break subsequent tool calls
- [x] performance_logic — N/A (integration tests focus on correctness, not performance)

## Test Data

- **Fixtures**: `tmp_repo` for isolated Aristotle repo, `tmp_path` for temporary file operations
- **Mock imports**: Import paths for deleted modules (intervention.rollback_engine, intervention.ki_doc_manager, etc.)
- **Tool list**: 27 tool names for count assertion (22 existing aristotle_* + 5 new rollback/ki-doc). Note: MCP_TOOL_COUNT_POST_MERGE=25 in the design spec may undercount; actual count to be verified during Phase 4 execution.
- **Deleted file list**: 10 files (rollback_engine.py, ki_doc_manager.py, committer.py, prompt_validator.py, violation_filter.py, intervention_coordinator.py, reflector.py, rule_generator.py, intervention_types.py, __init__.py)
- **E2E flow data**: Mock rule content, KI doc entry, checkpoint name for rollback
- **AC-2 scope**: Existing test suites in scope: aristotle_mcp/tests/test_mcp_server_tools.py (20 existing tool tests). Additional suites discovered during Phase 4 execution will be added here.
- **AC-2 execution gate**: AC-2 is an execution gate — Phase 3 test plan treats it as a dependency, not a test target. The integration test #2 validates the gate passes.
- **Preserved modules for AC-8 verification**: RollbackEngine (validate_path), KiDocManager (record_intervention, ensure_assessment, ensure_updated, record_merge), CommitGuard (ensure_committed → inline in commit_rule), AutoCommitter (validate_schema → inline in commit_rule). Interface docs = public docstrings on all public methods. Verify via: [m.__doc__ is not None for m in preserved_module_public_methods].
  - **Note**: CommitGuard and AutoCommitter inline references are for context only; actual classes are defined in commit-guard.md module.
- **27 tool names** (22 existing aristotle_* + 5 new): Concrete tool names from aristotle_mcp tool registration:
  1. aristotle_abort
  2. aristotle_check
  3. aristotle_check_sync_status
  4. aristotle_commit_rule
  5. aristotle_complete_reflection_record
  6. aristotle_create_reflection_record
  7. aristotle_detect_conflicts
  8. aristotle_fire_o
  9. aristotle_get_audit_decision
  10. aristotle_init_repo_tool
  11. aristotle_list_rules
  12. aristotle_on_undo
  13. aristotle_orchestrate_on_event
  14. aristotle_orchestrate_review_action
  15. aristotle_orchestrate_start
  16. aristotle_persist_draft
  17. aristotle_read_rules
  18. aristotle_reject_rule
  19. aristotle_restore_rule
  20. aristotle_stage_rule
  21. aristotle_sync_rules
  22. aristotle_write_rule
  23. create_rollback_point
  24. rollback_to_checkpoint
  25. cleanup_rollback_stashes
  26. write_ki_doc
  27. read_ki_docs
  (Note: actual count will be verified during Phase 4 execution)
- **Bilingual forbidden patterns for AC-6**: English patterns: ["total N issues so far", "Round N of M", "all issues resolved", "you may stop"]. Chinese patterns: ["累计N个问题", "第N轮", "已全部修复", "可提前结束"].
  - **Note**: These patterns are representative, not exhaustive. Additional patterns may be discovered during Phase 4 implementation.
- **Import verification**: Import tests (#3, #4) implicitly verify callability through behavior tests (#16, #17). Successful import + functional test execution confirms both importability and callability.

## Dependencies Between Tests

- No test depends on another test passing
- All tests use fresh `tmp_repo` fixture
- E2E lifecycle test is self-contained and doesn't require pre-existing state