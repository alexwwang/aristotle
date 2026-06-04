# Test Plan: KI Doc Tools

## Core Scenarios & Key Functional Points

### Core Scenarios (from Phase 1 — priority: core)

| # | Core Scenario | Source (AC) | Derived Functional Points | Test Cases |
|---|--------------|-------------|--------------------------|------------|
| 1 | Write intervention KI entry | AC-1, AC-8 | write_ki_doc (intervention) | append entry, validate format |
| 2 | Write assessment KI entry | AC-1, AC-8 | write_ki_doc (assessment) | phase/next_phase/status fields |
| 3 | Write merge KI entry | AC-1, AC-8 | write_ki_doc (merge) | multi-violation summary |
| 4 | Read KI docs | AC-1, AC-8 | read_ki_docs | read all, read with filter |
| 5 | Freshness check | AC-1 | read_ki_docs (freshness) | ensure_updated timestamp comparison |

### Key Functional Points (from Phase 2 — priority: key)

| # | Key Functional Point | Source | Test Cases |
|---|---------------------|--------|------------|
| 1 | KiDocManager.record_intervention → write_ki_doc | Migration map | violation/timestamp/file/phase fields |
| 2 | KiDocManager.ensure_assessment → write_ki_doc | Migration map | creates doc when status empty, appends otherwise |
| 3 | KiDocManager.ensure_updated → read_ki_docs | Migration map | timestamp parsing, freshness boolean |
| 4 | KiDocManager.record_merge → write_ki_doc | Migration map | violations list, phase, requirement |
| 5 | _parse_newest_timestamp | Internal | regex extraction of ISO timestamps |
| 6 | Doc auto-creation | _append helper | creates file with header if missing |

### Peripheral Functional Points

| # | Peripheral Functional Point | Source | Test Cases |
|---|----------------------------|--------|------------|
| 1 | Default header `# Review Records` | _DEFAULT_HEADER | header present on new doc |

## Requirements Coverage Matrix (Phase 1 → Tests)

| # | Priority | AC | Test Type | Test File | Test Name | Description |
|---|----------|----|-----------|-----------|-----------|-------------|
| 1 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_write_intervention_entry` | write_ki_doc creates intervention entry with violation, timestamp, file, phase |
| 2 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_write_assessment_entry` | write_ki_doc creates assessment with phase transition and status |
| 2.1 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_create_assessment_when_status_empty` | ensure_assessment with status='' creates new doc (vs append when status non-empty). Tests the conditional branch: status empty → doc creation with header, status non-empty → append to existing doc. |
| 3 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_write_merge_entry` | write_ki_doc creates merged intervention with violations list |
| 4 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_read_all_ki_docs` | read_ki_docs returns all entries |
| 4.1 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_return_empty_list_for_nonexistent_ki_doc` | read_ki_docs on nonexistent file returns empty list (no error) |
| 5 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_read_ki_docs_with_filter` | read_ki_docs filters by type/phase. Tests single-field filters AND multi-field AND-combination (e.g., `{type: 'intervention', phase: 4}`) |
| 5.1 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_filter_ki_docs_by_since_timestamp` | Filter `{since: '2026-06-02T12:00:00+08:00'}` excludes entries before timestamp, includes entries at/after |
| 6 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_check_freshness` | read_ki_docs returns freshness status via ensure_updated logic. Tests both fresh (True) and stale (False) outcomes. **Freshness threshold**: KI_FRESHNESS_THRESHOLD = 24 hours (86400 seconds). A doc is stale when `(now - newest_timestamp) > KI_FRESHNESS_THRESHOLD`. |
| 6.1 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_return_stale_when_doc_is_old` | Existing doc with parseable timestamp older than KI_FRESHNESS_THRESHOLD (24h) → ensure_updated returns False |
| 7 | Core | AC-8 | Unit | test_mcp_ki_doc.py | `should_create_doc_with_header_if_missing` | Auto-creates file with # Review Records header |
| 8 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_create_parent_directory_if_missing` | mkdir -p on write |
| 9 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_return_success_on_write` | write_ki_doc returns success dict |
| 10 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_return_none_on_io_error` | IOError during write returns {"success": false, "error": "I/O error: ..."} |
| 11 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_parse_newest_timestamp` | _parse_newest_timestamp extracts latest ISO timestamp |
| 12 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_treat_nonexistent_doc_as_fresh` | ensure_updated returns True for missing file. Note: This is by design—no prior assessment data means no staleness concern, treated as fresh. A missing file during assessment is a valid "no prior data" state and does NOT mask errors. |
| 13 | Core | AC-1 | Integration | test_mcp_ki_doc.py | `should_round_trip_write_and_read` | Write entry → read back → content matches |
| 14 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_include_rollback_info_in_intervention` | rollback_result fields in entry |
| 15 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_include_forbidden_patterns_in_intervention` | validation_result matches in entry |
| 16 | Core | AC-9 | Unit | test_mcp_ki_doc.py | `should_write_audit_entry_on_ki_doc_write` | write_ki_doc writes McpAuditEntry |
| 17 | Core | AC-9 | Unit | test_mcp_ki_doc.py | `should_write_audit_entry_on_ki_doc_read` | read_ki_docs writes McpAuditEntry |
| 18 | Core | AC-1 | Unit | test_mcp_ki_doc.py | `should_handle_empty_events_list_in_merge_entry` | write_ki_doc with empty ViolationEvents list produces valid entry |
| 19 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_reject_invalid_entry_type` | write_ki_doc with entry_type='invalid_type' returns validation error, only intervention/assessment/merge accepted |
| 20 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_treat_malformed_doc_as_fresh` | When file exists but has no parseable timestamps, ensure_updated returns True (treat as fresh/unknown state) |
| 21 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_handle_large_violation_list_in_merge_entry` | Verify performance and correctness with 100+ ViolationEvents |
| 22 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_handle_non_utf8_content_gracefully` | Verify read_ki_docs returns appropriate error for non-decodable content |
| 23 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_return_empty_list_when_filter_matches_no_entries` | Filter with no matching entries returns empty list without errors |
| 24 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_reject_entry_with_missing_required_fields` | Validates and rejects malformed entries with missing required fields |
| 25 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_append_to_corrupted_file` | Attempting to append to a file with corrupted existing content returns `{success: false, error: "corrupted file: unable to parse existing content"}` without modifying the file |
| 26 | Medium | AC-1 | Unit | test_mcp_ki_doc.py | `should_handle_non_utf8_encodable_content` | write_ki_doc with content containing surrogate characters raises encoding error gracefully |

## Design Coverage Matrix (Phase 2 → Tests)

| # | Priority | Design Element | Element Type | Test Type | Test Name | Description |
|---|----------|---------------|-------------|-----------|-----------|-------------|
| 1 | Key | KiDocManager.record_intervention | Method | Unit | `should_write_intervention_entry` | 4-param signature migrated |
| 2 | Key | KiDocManager.ensure_assessment | Method | Unit | `should_write_assessment_entry` | status='' creates doc |
| 3 | Key | KiDocManager.ensure_updated | Method | Unit | `should_check_freshness` | Timestamp comparison |
| 4 | Key | KiDocManager.record_merge | Method | Unit | `should_write_merge_entry` | Events list + context |
| 5 | Key | _parse_newest_timestamp | Internal | Unit | `should_parse_newest_timestamp` | Regex on file content |
| 6 | Key | _append helper | Internal | Unit | `should_create_doc_with_header_if_missing` | Auto-create behavior |

## Edge Cases & Error Paths

- [x] null_inputs — None ki_doc_path
- [x] empty_collections — empty events list for merge entry
- [x] max_values — very long violation_type string
- [ ] concurrent_access — N/A (single-agent). Note: Single-agent per ADR-007 means concurrent write protection is not required. If multi-agent support is added, append-during-read atomicity must be addressed.
- [ ] timeouts — N/A (synchronous file I/O)
- [x] network_failures — I/O error on write (permission denied)
- [x] invalid_state_transitions — write to read-only file
- [x] serialization_boundary — special characters in violation_type, file paths with spaces
- [x] error_handler_correctness — IOError caught, logged, returns None/false
- [x] implicit_contract — append-only (never overwrite existing content)
- [ ] resource_leak — N/A
- [ ] cascading_failure — N/A (single operation)
- [ ] performance_logic — N/A

## Test Data

- **KI doc path**: `tmp_path / "ki-docs" / "review.md"`
- **ViolationEvent schema**: `{violation_type: string (required), affected_file_path: string (required), timestamp: string ISO 8601 (required), context: dict (optional, free-form key-value)}`
  - **Note**: ViolationEvent entries without optional context field are tested as edge cases
- **ViolationEvent**: `{"violation_type": "SKIP_RED_PHASE", "affected_file_path": "src/main.py", "timestamp": "2026-06-02T10:00:00+08:00", "context": {"phase": 4}}`
- **Assessment params**: `phase=4, next_phase=5, status="PASS", issues=["slow test"]`
- **Merge events**: list of 3 ViolationEvents
- **Filter schema**: Filter is a dict with optional keys: `{type: str (intervention|assessment|merge), phase: int, violation_type: str, since: str (ISO 8601 timestamp)}`. All fields optional; multiple fields AND-combined. String fields use case-sensitive exact match. Example: `{"type": "intervention", "phase": 4}` returns only Phase 4 intervention entries.
- **Freshness threshold**: KI_FRESHNESS_THRESHOLD = 24 hours (86400 seconds). Used by ensure_updated logic in read_ki_docs.
- **Boundary condition**: Extreme single-entry size tested as edge case

## Dependencies Between Tests

- No test depends on another test
- All use fresh `tmp_path` for KI doc location