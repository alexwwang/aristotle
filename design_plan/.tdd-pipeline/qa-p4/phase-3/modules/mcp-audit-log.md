# Test Plan: MCP Audit Log

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (AC) | Derived Functional Points | Test Cases |
|---|--------------|-------------|--------------------------|------------|
| 1 | Append audit entry to JSONL | AC-9 | McpAuditEntry writer, .aristotle/audit.jsonl | happy path append, read back, JSON format |
| 2 | 4KB line limit enforcement | AC-9 | Truncation logic | entry exceeding 4KB truncated, field-level truncation |
| 3 | error field 500-char truncation | AC-9 | Field truncation (ERROR_SUMMARY_TRUNCATION applies to `error` field per §3.0.7) | long error field capped at 500 chars |
| 4 | .gitignore on init_repo | AC-9 | init_repo integration | .aristotle/audit.jsonl in .gitignore after init |

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source (Component/Interface) | Test Cases |
|---|---------------------|------------------------------|------------|
| 1 | McpAuditEntry type validation | §3.0.7 McpAuditEntry | required fields present, types correct |
| 2 | Append-only JSONL writer | audit.jsonl write logic | append mode, no overwrite, newline delimiter |
| 3 | 4KB line truncation | MCP_AUDIT_JSONL_LINE_LIMIT constant | exact 4KB boundary, just under, just over |
| 4 | 500-char error field truncation | ERROR_SUMMARY_TRUNCATION constant | 500 chars exact, 501 chars, multi-byte chars |
| 5 | .gitignore creation | init_repo integration | adds audit.jsonl to .gitignore, idempotent |

### Peripheral Functional Points

| # | Peripheral Functional Point | Source | Test Cases |
|---|----------------------------|--------|------------|
| 1 | truncated flag on entry | §3.0.7 truncated field | flag set when truncation occurs |

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | AC | Test Type | Test File | Test Name | Description |
|---|----------|----|-----------|-----------|-----------|-------------|
| 1 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_append_entry_to_jsonl` | Valid entry appended, readable as JSON |
| 2 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_enforce_4kb_line_limit` | Entry >4KB truncated with flag. **Post-condition**: verify actual output line in audit.jsonl is ≤4096 bytes after truncation (len(line.encode('utf-8')) <= 4096). |
| 3 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_truncate_error_field_at_500_chars` | `error` field capped at 500 chars. Note: ERROR_SUMMARY_TRUNCATION constant applies to the McpAuditEntry `error` field (§3.0.7 schema field name). The constant name and spec text ("error_summary 截断") use legacy naming from pre-merge frontmatter; the actual schema field is `error`. This naming is preserved for backward compatibility and documented here to prevent confusion. |
| 4 | Core | AC-9 | Integration | test_mcp_audit_log.py | `should_add_audit_jsonl_to_gitignore_on_init` | init_repo creates .gitignore entry |
| 5 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_validate_mcp_audit_entry_fields` | Required fields (timestamp, tool, params, result, runId) always present and typed. Optional fields (error, truncated) present when applicable. |
| 6 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_append_in_append_mode` | Multiple entries, no overwrite |
| 7 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_set_truncated_flag_when_truncated` | truncated=true on truncation |
| 8 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_not_set_truncated_flag_when_under_limit` | truncated=false when no truncation |
| 9 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_handle_multi_byte_chars_in_truncation` | Unicode chars truncated correctly |
| 10 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_create_directory_if_missing` | .aristotle/ created on first write |
| 11 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_return_success_on_append` | Writer returns success dict |
| 12 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_populate_error_field_on_error_result` | result='error' populates error field with description |
| 13 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_reject_invalid_result_value` | result only accepts 'success' or 'error' |
| 14 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_handle_none_params_gracefully` | None params dict returns graceful error, not crash |
| 15 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_reject_entry_without_runid` | Entry with runId=None/missing is rejected with validation error |
| 16 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_reject_entry_with_empty_tool_name` | Entry with tool='' or tool=None is rejected |
| 17 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_handle_4kb_boundary_cases` | Parameterized: 4095-byte (pass), 4096-byte (pass), 4097-byte (truncated). Boundary values tested via parameterized fixture: [4095, 4096, 4097] bytes |
| 18 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_not_duplicate_gitignore_entry_on_repeated_init` | Calling init_repo twice does not duplicate .gitignore entry |
| 19 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_allow_error_result_without_error_field` | result='error' with error=None/empty is accepted (spec says error is optional `string?`) |
| 20 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_read_existing_audit_entries` | Read audit.jsonl and return parsed entries with correct field values, in write order (chronological) |
| 20.2 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_return_entries_in_chronological_order` | Multiple entries appended in sequence are returned in the same order — no reordering |
| 20.1 | Core | AC-9 | Unit | test_mcp_audit_log.py | `should_return_empty_list_for_empty_audit_file` | audit.jsonl exists but contains 0 entries — returns empty list without error |
| 21 | Medium | AC-9 | Unit | test_mcp_audit_log.py | `should_handle_corrupted_jsonl_gracefully` | Opening audit.jsonl with malformed JSON lines skips bad entries, logs warning, and processes valid entries |
| 22 | Medium | AC-9 | Unit | test_mcp_audit_log.py | `should_validate_audit_entry_content_values` | Verify tool name, params, result, and timestamp contain expected values (not just structure) |

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test File | Test Name | Description |
|---|----------|---------------|-------------|-----------|-----------|-----------|-------------|
| 1 | Key | McpAuditEntry | Interface | Unit | test_mcp_audit_log.py | `should_validate_mcp_audit_entry_fields` | timestamp, tool, params, result, runId required |
| 2 | Key | 4KB line limit | Constraint | Unit | test_mcp_audit_log.py | `should_enforce_4kb_line_limit` | Byte-level check. Note: MCP_AUDIT_JSONL_LINE_LIMIT and ERROR_SUMMARY_TRUNCATION constants from P3 should be verified importable in Phase 4. |
| 3 | Key | 500-char truncation | Constraint | Unit | test_mcp_audit_log.py | `should_truncate_error_field_at_500_chars` | Char-level check on `error` field. Note: MCP_AUDIT_JSONL_LINE_LIMIT and ERROR_SUMMARY_TRUNCATION constants from P3 should be verified importable in Phase 4. |
| 4 | Key | .gitignore integration | Component | Integration | test_mcp_audit_log.py | `should_add_audit_jsonl_to_gitignore_on_init` | init_repo side effect |

## Edge Cases & Error Paths

- [x] null_inputs — None params passed to writer
- [x] empty_collections — empty params dict
- [x] max_values — exactly 4KB line, exactly 500 chars. 4KB boundary: 4095-byte entry (just under), 4096-byte entry (exact limit), 4097-byte entry (just over)
- [ ] concurrent_access — N/A for Phase 4 (single-agent, ADR-007)
- [x] timeouts — N/A (synchronous write, ADR-005)
- [x] network_failures — file I/O error on write (permission denied)
- [x] invalid_state_transitions — write to non-existent directory
- [x] serialization_boundary — multi-byte char truncation at 500 chars
- [x] error_handler_correctness — I/O error returns graceful failure, not crash
- [x] implicit_contract — append-only means no delete/update operations
- [ ] resource_leak — N/A (single file handle per write)
- [x] cascading_failure — write failure doesn't corrupt existing entries
- [ ] performance_logic — N/A (single-line append)

**Note: Edge case where .aristotle/ exists as a file (not directory) — should detect this and return clear error or handle gracefully. Not covered in Phase 4 tests.**

## Known Limitations

- JSONL file grows unbounded in Phase 4. No rotation mechanism. If file size becomes a concern, add MAX_AUDIT_JSONL_FILE_SIZE constant and rotation logic in a future phase.
- `.aristotle/` path collision: if `.aristotle/` exists as a regular file (not directory), write operations will fail. Not tested in Phase 4. Expected behavior: return clear error message (e.g., "Not a directory"). Tracked as open edge case for future implementation.

## Test Data

- **Fixtures**: `tmp_path` for `.aristotle/audit.jsonl` location
- **Mock params**: `{"timestamp": "2026-06-02T10:00:00+08:00", "tool": "commit_rule", "params": {"file_path": "test.md"}, "result": "success", "runId": "run_123"}`
- **Error mock params**: `{"timestamp": "2026-06-02T10:00:00+08:00", "tool": "commit_rule", "params": {"file_path": "bad.md"}, "result": "error", "error": "file not found", "runId": "run_123"}`
- **Long string**: 600-char `error` field for truncation test
- **4KB entry**: params dict with large nested values to exceed 4096 bytes. 4KB entry constructed as: `params={'padding': 'x' * (4096 - overhead_bytes)}` where overhead_bytes is the JSON envelope size. Exact construction via helper function in Phase 4.

## Dependencies Between Tests

- No test depends on another test passing
- All tests use fresh `tmp_path` via `tmp_repo` fixture
