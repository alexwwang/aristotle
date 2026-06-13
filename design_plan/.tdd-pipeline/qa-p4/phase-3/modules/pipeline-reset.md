# Test Plan: Pipeline Reset

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (AC) | Derived Functional Points | Test Cases |
|---|--------------|-------------|--------------------------|------------|
| 1 | Watchdog Observer triggers pipeline_reset | AC-10 | rollback_to_checkpoint returns pipeline_reset_required=true, Observer auto-calls tdd_checkpoint | Layer 1 happy path, state cleared, phase reset to 1 |
| 2 | MCP handler triggers pipeline_reset when Watchdog down | AC-10 | Fallback layer when Watchdog not running | Layer 2 direct trigger, same state reset |
| 3 | pipeline_start resets state as final fallback | AC-10 | Last resort reset on next pipeline start | Layer 3 reset, initialization cleanup |
| 4 | force_resolve_violation manual trigger | §3.0.3a | Agent manually resolves violation with timestamp | Manual resolution, audit entry written |
| 5 | resolve_timeout auto-correction | §3.0.3a | Idempotent correction when audit shows resolved but state outdated | Auto-sync, no duplicate operations |

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source (Component/Interface) | Test Cases |
|---|---------------------|------------------------------|------------|
| 1 | Layer 1: Watchdog Observer detection | rollback_to_checkpoint return value | Observer reads pipeline_reset_required, calls tdd_checkpoint |
| 2 | Layer 2: MCP handler direct trigger | Fallback chain when Watchdog not running | MCP handler invokes pipeline_reset directly |
| 3 | Layer 3: pipeline_start cleanup | Final fallback, initialization reset | pipeline_start resets state if dirty |
| 4 | State reset completeness | PipelineState consistency | observerTimeoutCount=0, auditEntryCount=0, phase=1 |
| 5 | force_resolve_violation timestamp matching | §3.0.3a P4 triggers | Resolves specific violation, writes force_resolved_reason |
| 6 | resolve_timeout idempotency | §3.0.3a P4 triggers | Multiple calls safe, state fixed after first call |
| 7 | Fallback chain ordering | AC-10 constraint | Layer 1 tried first, then Layer 2, then Layer 3 |
| 8 | Concurrent reset handling | Race condition scenario | Multiple reset requests handled safely |
| 9 | Reset when already reset | Idempotency check | No-op when state already clean |

### Peripheral Functional Points

| # | Peripheral Functional Point | Source | Test Cases |
|---|----------------------------|--------|------------|
| 1 | rollback_to_checkpoint return value | rollback-tools | Returns pipeline_reset_required boolean correctly |
| 2 | Watchdog status detection | Fallback chain logic | Detects if Watchdog is running or not |
| 3 | pipeline_start dirty state detection | Initialization logic | Detects state needs reset on startup |

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | AC | Test Type | Test File | Test Name | Description |
|---|----------|----|-----------|-----------|-----------|-------------|
| 1 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_reset_state_via_layer1_watchdog` | rollback_to_checkpoint returns true, Observer calls tdd_checkpoint |
| 2 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_clear_observer_timeout_count` | observerTimeoutCount reset to 0 after reset |
| 3 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_clear_audit_entry_count` | auditEntryCount reset to 0 after reset |
| 4 | Core | AC-10, §3.0.3a | Unit | test_pipeline_reset.py | `should_reset_phase_to_1` | PipelineState phase reset to 1 after reset. **Source of truth**: §3.0.3a PipelineState — `phase` field resets to 1. TDD pipeline phase 编号从 1 开始（known-issues.md §3.2: "phase=0 表示 pipeline 未启动，TDD pipeline phase 编号从 1 开始"）。pipeline_reset 重置到 phase=1（第一个可操作阶段），NOT phase=0（pre-init 哨兵值）。与 §3.0.3a "回退到 phase 1" 一致。 |
| 5 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_reset_eviction_needed_flag` | After pipeline_reset, evictionNeeded is explicitly set to false regardless of prior state |
| 6 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_trigger_layer2_when_watchdog_down` | MCP handler directly triggers when Watchdog not running |
| 7 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_trigger_layer3_on_next_pipeline_start` | pipeline_start resets state as final fallback |
| 8 | Core | AC-10 | Integration | test_pipeline_reset.py | `should_execute_fallback_chain_in_order` | Layer 1 → Layer 2 → Layer 3 sequence verified. **Note**: Layer 1 (Watchdog Observer) test uses mocked Observer — mock simulates Observer receiving pipeline_reset_required=true and calling tdd_checkpoint. Real Watchdog is TypeScript-side and out of scope for Python MCP unit tests. |
| 9 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_handle_force_resolve_violation_manual_trigger` | Agent manually resolves violation with timestamp |
| 9.1 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_return_error_for_force_resolve_with_nonexistent_timestamp` | force_resolve_violation with timestamp matching no existing violation returns `{success: false, error: "no matching violation"}`. **Note**: If timestamp matches multiple violations (same-millisecond edge case per KI-031), force_resolve_violation resolves ALL matching violations following resolveViolations batch semantics (§3.0.2). Test should verify count of resolved violations matches the number sharing that timestamp. |
| 10 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_write_force_resolved_reason_to_audit` | Manual resolution records reason in audit |
| 11 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_auto_correct_with_resolve_timeout` | Idempotent correction when audit ahead of state |
| 12 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_be_idempotent_on_multiple_resolve_timeout_calls` | Repeated calls safe, no duplicate operations |
| 13 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_handle_concurrent_reset_requests_safely` | Multiple simultaneous resets handled correctly |
| 14 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_be_noop_when_state_already_reset` | Reset when already reset has no effect |
| 15 | Core | AC-9 | Unit | test_pipeline_reset.py | `should_write_audit_entry_on_pipeline_reset` | pipeline_reset writes McpAuditEntry. **Schema**: assert entry fields per §3.0.7 — timestamp valid ISO 8601, tool=='pipeline_reset', result=='success', runId present (string), params present (dict). |
| 16 | Core | AC-9 | Unit | test_pipeline_reset.py | `should_write_audit_entry_on_force_resolve_violation` | force_resolve_violation writes McpAuditEntry. **Schema**: assert entry fields per §3.0.7 — timestamp valid ISO 8601, tool=='force_resolve_violation', result=='success', runId present (string), params present (dict with violation timestamp). |
| 17 | Core | AC-9 | Unit | test_pipeline_reset.py | `should_write_audit_entry_on_resolve_timeout` | resolve_timeout auto-correction writes McpAuditEntry. **Schema**: assert entry fields per §3.0.7 — timestamp valid ISO 8601, tool=='resolve_timeout', result=='success', runId present (string), params present (dict). |
| 17.1 | Core | AC-9 | Unit | test_pipeline_reset.py | `should_write_error_audit_entry_on_force_resolve_failure` | force_resolve_violation with nonexistent timestamp writes McpAuditEntry with result='error'. **Schema**: assert entry fields per §3.0.7 — timestamp valid ISO 8601, tool=='force_resolve_violation', result=='error', runId present (string), error field present (string containing "no matching violation"). Follows error-audit pattern from rollback-tools test #18.1. |
| 17.2 | Core | AC-9 | Unit | test_pipeline_reset.py | `should_write_error_audit_entry_on_resolve_timeout_failure` | resolve_timeout when correction fails writes McpAuditEntry with result='error'. **Schema**: assert entry fields per §3.0.7 — timestamp valid ISO 8601, tool=='resolve_timeout', result=='error', runId present (string), error field present (string). Follows error-audit pattern from rollback-tools test #18.1. |
| 15.1 | Core | AC-9 | Unit | test_pipeline_reset.py | `should_use_correct_tool_names_in_audit_entries` | Verify audit entries use tool names matching the actual MCP tool registration: 'pipeline_reset', 'force_resolve_violation', 'resolve_timeout'. These are the tool names as registered in server.py, which may differ from the Python function names in _tools_pipeline_reset.py. |
| 18 | High | AC-10 | Integration | test_pipeline_reset.py | `should_handle_gracefully_when_all_fallback_layers_fail` | System state consistent when Layer 1, 2, and 3 all fail. Returns partial results with error flags for failed layers, does not raise exception |
| 19 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_not_correct_when_audit_does_not_show_resolved` | Guard condition prevents false positive correction |
| 20 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_reset_partially_dirty_state` | Reset works when some counters dirty but phase is already 1 |
| 21 | Medium | AC-10, rollback-tools §3.0.3 | Unit | test_pipeline_reset.py | `should_not_reset_when_pipeline_reset_required_false` | When rollback_to_checkpoint returns `pipeline_reset_required=false`, pipeline_reset does NOT modify PipelineState (idempotent no-op). State before and after the call is identical. **Interface reference**: rollback_to_checkpoint return value contract defined in rollback-tools.md (pipeline_reset_required boolean field per §3.0.3). |
| 22 | High | AC-10 | Integration | test_pipeline_reset.py | `should_trigger_layer2_integration_reset` | Layer 2 path integration test |
| 23 | High | AC-10 | Integration | test_pipeline_reset.py | `should_trigger_layer3_integration_reset` | Layer 3 path integration test |
| 24 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_handle_tdd_checkpoint_callback_failure` | tdd_checkpoint callback failure handled gracefully and error logged |
| 25 | Core | AC-10 | Unit | test_pipeline_reset.py | `should_handle_watchdog_error_response` | When Watchdog Observer is running but returns error, fallback chain proceeds to Layer 2 |
| 26 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_not_reset_phasestatus_or_round_fields` | Python-side pipeline_reset does NOT reset phaseStatus or round fields — these are managed by the TypeScript Watchdog state machine. Test verifies these fields retain their pre-reset values after pipeline_reset. Only §3.0.3 fields (observerTimeoutCount, auditEntryCount, evictionNeeded, phase) are reset. |
| 26.1 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_not_reset_when_phase_is_zero` | pipeline_reset with phase=0 (pipeline not started) is a no-op. Phase=0 is the pre-init sentinel value; resetting it would be incorrect. Verify no state changes occur. |
| 26.2 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_handle_missing_optional_fields_in_state` | PipelineState with optional fields missing (e.g., no evictionNeeded key) does not crash during reset. Missing fields are treated as default values. |
| 26.3 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_return_partial_result_schema_on_partial_failure` | ~~**REMOVED**~~ — contradicts atomic state replacement contract (see edge case 'partial_state_reset_failure': all fields reset together atomically; individual failure → entire operation fails). No partial-failure return schema needed. Row retained for traceability; no test implementation needed. |
| 27 | Medium | AC-9 | Unit | test_pipeline_reset.py | `should_correlate_runid_with_active_run_in_audit_entry` | Verify audit entry runId matches the runId parameter passed to pipeline_reset/force_resolve/resolve_timeout. Ensures traceability from audit log back to originating run. |
| 28 | Medium | AC-9 | Unit | test_pipeline_reset.py | `should_complete_reset_even_if_audit_write_fails` | pipeline_reset completes successfully even when McpAuditEntry write to audit.jsonl fails (e.g., permission denied). Reset result is independent of audit logging success. **AC-9 tradeoff**: This test prioritizes operational continuity over audit completeness — a failed audit write means this reset operation will have no audit trail. **Fallback behavior**: When audit write fails, implementation SHOULD log the failure to stderr (Python `logging.error`) as a best-effort fallback. Phase 4 implementation should verify stderr logging occurs on audit write failure. |
| 29 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_handle_null_rollback_return_gracefully` | When rollback_to_checkpoint returns None (e.g., stash not found), pipeline_reset does not crash. Verify graceful error return with appropriate error message. |
| 30 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_handle_invalid_rollback_return_schema` | When rollback_to_checkpoint returns dict without pipeline_reset_required key, pipeline_reset does not crash. Treat as pipeline_reset_required=false (conservative default). |
| 31 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_return_error_for_force_resolve_with_missing_timestamp` | force_resolve_violation called without timestamp parameter returns validation error {success: false, error: "timestamp required"} |
| 32 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_return_error_for_force_resolve_with_empty_timestamp` | force_resolve_violation called with timestamp="" returns validation error {success: false, error: "timestamp required"} |
| 33 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_return_error_for_resolve_timeout_with_no_active_run` | resolve_timeout when no active run exists (no in-progress pipeline) returns {success: false, error: "no active run"} |
| 34 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_return_error_for_force_resolve_on_already_resolved` | force_resolve_violation on a violation that is already resolved returns {success: false, error: "violation already resolved"} |
| 35 | High | AC-10 | Unit | test_pipeline_reset.py | `should_handle_missing_pipeline_state_gracefully` | pipeline_reset when PipelineState is None/absent (no state file exists) returns graceful result without crash. Treats missing state as already-clean (no-op) or creates default clean state. |
| 36 | Medium | AC-10 | Unit | test_pipeline_reset.py | `should_reset_successfully_with_corrupted_pipeline_state_file` | pipeline-state.json contains invalid JSON (e.g., `{invalid json`). _read_pipeline_state catches json.JSONDecodeError and returns CLEAN_STATE copy. pipeline_reset proceeds as if state is clean — returns success with reset=true (fallback-to-clean means reset was effective). Verifies no exception raised and result indicates successful reset. Follows pattern from test_mcp_server_reflection.py test_complete_corrupted_state_file (L315). |
| 36.1 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_return_error_for_force_resolve_with_invalid_timestamp_format` | force_resolve_violation with malformed timestamp string (e.g., "not-a-date", "2026-13-45", negative number) returns validation error `{success: false, error: "invalid timestamp format"}`. Complements tests #31 (missing) and #32 (empty) — covers the invalid-format dimension. Parameterized: `["not-a-date", "2026-13-45", -1, "yesterday"]` |
| 36.2 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_be_noop_on_resolve_timeout_when_state_already_clean` | resolve_timeout when PipelineState is already clean (observerTimeoutCount=0, no corrections needed) returns success with no-op indication. Distinct from test #14 (pipeline_reset no-op) and test #33 (no active run) — this tests resolve_timeout specifically when run is active but state is already clean. |
| 36.3 | Core | AC-9 | Unit | test_pipeline_reset.py | `should_write_audit_entry_on_layer3_pipeline_start_reset` | pipeline_start (Layer 3) reset writes McpAuditEntry with tool=='pipeline_reset'. **Schema**: assert entry fields per §3.0.7 — timestamp valid ISO 8601, tool=='pipeline_reset', result=='success', runId present (string), params present (dict with layer='3'). Complements tests #15 (Layer 1 audit) and #16 (Layer 2 implicit — via force_resolve). |
| 37 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_return_error_for_force_resolve_with_missing_reason` | force_resolve_violation called without reason parameter returns validation error {success: false, error: "reason required"}. Complements tests #31-32 (timestamp validation). |
| 37.1 | Medium | §3.0.3a | Unit | test_pipeline_reset.py | `should_return_error_for_force_resolve_with_empty_reason` | force_resolve_violation called with reason="" returns validation error {success: false, error: "reason required"}. Complements test #37 (missing reason). |

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test File | Test Name | Description |
|---|----------|---------------|-------------|-----------|-----------|-----------|-------------|
| 1 | Key | Watchdog Observer detection | Component | Unit | test_pipeline_reset.py | `should_reset_state_via_layer1_watchdog` | Observer reads rollback return value |
| 2 | Key | MCP handler direct trigger | Component | Unit | test_pipeline_reset.py | `should_trigger_layer2_when_watchdog_down` | Fallback mechanism when Watchdog unavailable |
| 3 | Key | pipeline_start cleanup | Component | Unit | test_pipeline_reset.py | `should_trigger_layer3_on_next_pipeline_start` | Initialization-side reset |
| 4 | Key | State reset completeness | State Transition | Unit | test_pipeline_reset.py | `should_clear_observer_timeout_count` | All counters cleared |
| 5 | Key | Fallback chain ordering | Constraint | Integration | test_pipeline_reset.py | `should_execute_fallback_chain_in_order` | Priority sequence enforced |
| 6 | Key | force_resolve_violation interface | Interface | Unit | test_pipeline_reset.py | `should_handle_force_resolve_violation_manual_trigger` | Timestamp-based resolution |
| 7 | Key | resolve_timeout idempotency | Constraint | Unit | test_pipeline_reset.py | `should_be_idempotent_on_multiple_resolve_timeout_calls` | Safe re-execution |
| 8 | Key | Concurrent reset safety | Concurrency | Unit | test_pipeline_reset.py | `should_handle_concurrent_reset_requests_safely` | Race condition handling. Note: Concurrency test labeled Unit because it validates lock/serialization logic via mocks; true concurrency testing requires integration environment. |

## Edge Cases & Error Paths

- [x] null_inputs — rollback_to_checkpoint returns None or invalid return value; force_resolve_violation with missing/empty reason (tests #37, #37.1)
- [x] empty_collections — PipelineState with zero values already clean
- [x] max_values — observerTimeoutCount at maximum threshold before reset
- [x] concurrent_access — Tested via mock (see test #12 note); single-agent per ADR-007, but pipeline-reset explicitly tests serialization logic for rapid sequential tool calls. **ADR-007 exclusion**: concurrent audit-write interleaving (two pipeline_reset calls writing to audit.jsonl simultaneously) is out of scope. Single-agent model guarantees sequential execution. If multi-agent support is added, audit.jsonl append atomicity must be addressed.
- [x] timeouts — Watchdog timeout during reset operation
- [x] network_failures — MCP handler unavailable, falls back to Layer 3
- [x] invalid_state_transitions — Attempt to reset from invalid state
- [x] serialization_boundary — State serialization during reset
- [x] error_handler_correctness — Reset failure does not corrupt state
- [x] implicit_contract — Fallback chain ensures at least one layer succeeds
- [x] resource_leak — No dangling state references after reset
- [x] cascading_failure — All 3 layers fail scenario handled gracefully
- [x] corrupted_state_file — pipeline-state.json contains invalid JSON; _read_pipeline_state catches json.JSONDecodeError and falls back to CLEAN_STATE
- [ ] performance_logic — N/A for Phase 3 (no timing requirement in spec)
- [x] partial_state_reset_failure — Handled by atomic state replacement (all fields reset together). If individual field reset fails, the entire operation fails and returns error. Test #26.3 removed — contradicts atomic contract. |
- [x] evictionNeeded_only_dirty_state — Covered by test #5 should_reset_eviction_needed_flag |

## Test Data

- **Fixtures**: `tmp_repo` for rollback_to_checkpoint mocking, `mock_pipeline_state` for state manipulation
- **Mock return values**: `{"pipeline_reset_required": true}` for rollback_to_checkpoint success
- **Dirty state**: `{"observerTimeoutCount": 5, "auditEntryCount": 100, "evictionNeeded": true, "phase": 3}`
- **Partially dirty state**: `{"observerTimeoutCount": 0, "auditEntryCount": 5, "evictionNeeded": true, "phase": 1}`
- **Clean state**: `{"observerTimeoutCount": 0, "auditEntryCount": 0, "evictionNeeded": false, "phase": 1}`
- **Field alignment**: Fixtures match PipelineState schema (§3.0.3): observerTimeoutCount, auditEntryCount, evictionNeeded, phase. **Clarification**: `phase` is referenced by §3.0.3a ("回退到 phase 1") as an existing PipelineState field for reset behavior. It is part of the broader pipeline state managed by the Watchdog state machine. The §3.0.3 PipelineState table explicitly lists phase among the reset-target fields. The `phaseStatus` and `round` fields are part of the broader pipeline state but are NOT explicitly listed in the §3.0.3 PipelineState table — they belong to the TDD pipeline state machine managed by the Watchdog (TypeScript side). The Python-side pipeline_reset only resets the fields defined in §3.0.3. Test #26 (`should_not_reset_phasestatus_or_round_fields`) explicitly verifies these fields are NOT reset during Python-side pipeline_reset.
- **Violation timestamp**: ISO 8601 string for force_resolve_violation
- **Run ID**: Valid run ID for audit log correlation
- **Corrupted state file**: Write raw invalid JSON string to `.aristotle/pipeline-state.json` (e.g., `{invalid json`)

## Dependencies Between Tests

- Tests for Layer 2 and Layer 3 assume Layer 1 has failed (independent test setup)
- All state reset tests start from dirty state (fixture setup, no inter-test dependency)
- Integration tests for fallback chain use isolated scenarios, no sequential dependency