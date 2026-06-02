# Test Plan: Bridge Plugin (Phase 1)

**From**: `aristotle-bridge-technical-design_260423.md` §4–§8
**Scope**: 7 TypeScript modules (~440 LOC), 3 MCP tools, SKILL.md behavior changes
**Testing framework**: Vitest + TypeScript

---

## Test Coverage Matrix

### Unit Tests — WorkflowStore (`workflow-store.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 1 | Disk persistence on register | `should_persist_workflow_to_disk_on_register` | After register(), file exists on disk with correct JSON |
| 2 | Disk persistence on load | `should_load_workflows_from_disk_on_construction` | Pre-existing JSON file → workflows Map populated |
| 3 | Corrupted disk file | `should_start_with_empty_store_on_corrupted_disk_file` | Malformed JSON → empty store, no throw |
| 3b | Valid non-array JSON | `should_start_with_empty_store_on_non_array_json` | `{}` on disk → empty store, no throw |
| 4 | Missing disk file | `should_start_with_empty_store_on_missing_disk_file` | No file → empty store |
| 5 | Capacity eviction — completed only | `should_evict_oldest_completed_when_full` | 50 workflows, register new → oldest completed evicted |
| 6 | Capacity eviction — no running eviction | `should_not_evict_running_workflows` | 50 running workflows → register returns false |
| 7 | Capacity eviction order | `should_evict_by_startedAt_ascending` | Multiple completed: oldest startedAt evicted first |
| 7b | Evict all non-running statuses | `should_evict_error_undone_and_cancelled_workflows` | Mixed error/undone/cancelled → all evictable, oldest first |
| 8 | saveToDisk failure graceful | `should_log_error_and_continue_on_disk_write_failure` | writeFileSync throws → logged, in-memory state intact |
| 9 | cancel() marks cancelled | `should_mark_workflow_as_cancelled` | cancel(id) → status === 'cancelled' |
| 10 | cancel() persists | `should_persist_cancelled_status_to_disk` | cancel() → disk file shows cancelled |
| 11 | getActive() returns running | `should_return_only_running_workflows` | 2 running + 1 completed → getActive() returns 2 |
| 11b | getActive() empty | `should_return_empty_active_list_when_no_running_workflows` | 0 running → {active: []} |
| 12 | findByWorkflowId | `should_find_workflow_by_workflow_id` | Exact match returns WorkflowState |
| 13 | findBySession | `should_find_workflow_by_session_id` | Match by sessionId |
| 14 | retrieve — running | `should_return_running_status_for_running_workflow` | retrieve(id) → {status: 'running'} |
| 15 | retrieve — completed | `should_return_completed_result` | retrieve(id) → {status: 'completed', result: '...'} |
| 15b | retrieve — completed no result | `should_return_empty_string_result_when_completed_without_result` | markCompleted without result → retrieve returns {status:'completed', result:''} |
| 16 | retrieve — error | `should_return_error_status` | retrieve(id) → {status: 'error', error: '...'} |
| 17 | retrieve — not found | `should_return_error_for_unknown_workflow` | retrieve("missing") → {error: 'Workflow not found'} |
| 17b | retrieve — undone | `should_return_undone_status` | retrieve(id) → {status: 'undone'} |
| 17c | retrieve — cancelled | `should_return_cancelled_status` | retrieve(id) → {status: 'cancelled'} |
| 18 | markCompleted | `should_mark_completed_with_result` | markCompleted(id, "output") → status 'completed', result set |
| 19 | markError | `should_mark_error_with_message` | markError(id, "msg") → status 'error', error set |
| 20 | markUndone preserved | `should_mark_undone_status` | markUndone(id) → status 'undone' (reserved for Python sync) |
| 20b | register() overwrite | `should_overwrite_on_duplicate_workflow_id` | register same workflowId twice → second data wins, disk updated |
| 20c | saveToDisk atomic write | `should_write_via_tmp_and_rename` | saveToDisk creates .tmp then renames (mirrors SnapshotExtractor pattern) |

### Unit Tests — SnapshotExtractor (`snapshot-extractor.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 21 | Extract produces valid snapshot | `should_produce_valid_snapshot_json` | extract() writes {version:1, source, session_id, extracted_at, focus, total_messages, messages[]} |
| 22 | 4000 char content truncation | `should_truncate_message_content_at_4000_chars` | Message > 4000 chars → content sliced at exactly 4000 (no suffix) |
| 23 | 200 message limit | `should_limit_messages_to_200` | 250 messages → snapshot has 200 |
| 24 | Atomic write (tmp+rename) | `should_write_via_tmp_file_and_rename` | Verify tmpPath written before rename |
| 25 | snapshotExists — true | `should_return_true_when_snapshot_exists` | File present → true |
| 26 | snapshotExists — false | `should_return_false_when_snapshot_missing` | No file → false |
| 27 | Custom sessionsDir | `should_use_custom_sessions_dir` | Constructor param overrides default path |
| 28 | Filter user/assistant only | `should_filter_to_user_and_assistant_roles` | Messages with role 'tool' excluded |
| 28b | Missing parts on message | `should_handle_message_with_missing_parts_gracefully` | Message with parts:undefined → skipped, no crash |
| 29 | Empty session | `should_handle_empty_session_gracefully` | No messages → snapshot with total_messages=0 |
| 29b | Custom focusHint | `should_use_custom_focusHint_in_snapshot` | focusHint parameter reflected in snapshot output |
| 29c | Limit capped at 200 | `should_cap_limit_at_200_even_when_higher` | limit: 300 → effective cap 200 |

### Unit Tests — extractLastAssistantText (`utils.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 30 | {info, parts} format | `should_extract_text_from_info_parts_format` | Last assistant message with parts: [{type:'text', text:'...'}] |
| 31 | Skip tool-call only | `should_skip_pure_tool_call_messages` | Assistant with only tool_use parts → returns previous text assistant |
| 32 | No assistant text found | `should_return_sentinel_when_no_assistant_text` | All user/tool messages → '[ARISTOTLE_BRIDGE:no_text_output]' |
| 33 | Mixed messages | `should_find_last_assistant_with_text` | user→assistant→user→assistant → returns last assistant text |
| 34 | Empty parts array | `should_skip_assistant_message_with_empty_parts` | assistant with parts:[] followed by earlier assistant with text → returns earlier text |
| 34b | Multiple text parts joined | `should_join_multiple_text_parts_with_newline` | assistant with 2+ text parts → joined with '\n' |
| 34c | Whitespace-only text | `should_skip_assistant_message_with_whitespace_only_text` | text is "   " after trim → empty, skipped → returns earlier or sentinel |

### Unit Tests — IdleEventHandler (`idle-handler.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 35 | Skip cancelled | `should_skip_cancelled_workflow` | wf.status === 'cancelled' → no API call |
| 36 | Skip completed | `should_skip_completed_workflow` | wf.status === 'completed' → no API call |
| 37 | Normal result collection | `should_collect_result_from_completed_session` | running → fetch messages → markCompleted with extracted text |
| 38 | Error during message fetch | `should_handle_message_fetch_error_gracefully` | client throws → workflow marked error in store, no crash |
| 39 | Unknown session | `should_skip_unknown_session` | findBySession returns undefined → no API call |
| 40 | Skip undone | `should_skip_undone_workflow` | wf.status === 'undone' → no API call |
| 40b | Skip error | `should_skip_error_workflow` | wf.status === 'error' → no API call (completes the 4-status guard) |

### Unit Tests — api-probe (`api-probe.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 41 | promptAsync available | `should_return_promptAsync_when_api_available` | Successful probe → 'promptAsync' |
| 42 | promptAsync unavailable | `should_return_null_when_promptAsync_fails` | promptAsync throws → null |
| 43 | Session cleanup on success | `should_delete_probe_session_on_success` | Verify session.delete called |
| 44 | Session cleanup on failure | `should_delete_probe_session_on_failure` | Verify session.delete called even on throw |
| 44b | Probe create failure | `should_propagate_error_when_probe_session_create_fails` | client.session.create throws → error propagates (plugin fails to load) |

### Unit Tests — aristotle_abort tool logic (`index.test.ts` — tool tests)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 45 | Cancel running workflow | `should_cancel_running_workflow` | running → abort + cancel → {status:'cancelled'} |
| 46 | Idempotent on cancelled | `should_return_cancelled_for_already_cancelled_workflow` | cancelled → {status:'cancelled', workflow_id} (no abort call) |
| 47 | Return terminal status | `should_return_current_status_for_completed_workflow` | completed → {status:'completed', workflow_id} |
| 48 | Return terminal status for error | `should_return_current_status_for_error_workflow` | error → {status:'error', workflow_id} |
| 48b | Return terminal status for undone | `should_return_current_status_for_undone_workflow` | undone → {status:'undone', workflow_id} |
| 49 | Workflow not found | `should_return_error_for_unknown_workflow_id` | Missing → {error: 'Workflow not found'} |
| 50 | Abort call failure | `should_succeed_even_if_abort_api_fails` | session.abort throws → swallowed, still cancelled |

### Integration Tests — executor.launch (`executor.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 51 | Full launch flow | `should_create_session_promptAsync_and_register` | Verify create→register→promptAsync order, correct return shape |
| 52 | Snapshot conditional extract | `should_extract_snapshot_when_targetSessionId_and_not_exists` | targetSessionId set + no snapshot → extract called |
| 53 | Snapshot skip if exists | `should_skip_snapshot_when_already_exists` | snapshotExists returns true → extract not called |
| 54 | Snapshot failure non-blocking | `should_continue_launch_when_snapshot_extraction_fails` | extract throws → warned, launch continues |
| 55 | No targetSessionId | `should_skip_snapshot_when_no_target_session_id` | targetSessionId undefined → no extractor created |
| 56 | Store full rejection | `should_reject_and_abort_session_when_store_full` | 50 running → abort session, return error |
| 57 | promptAsync failure | `should_abort_session_and_mark_error_on_promptAsync_failure` | promptAsync throws → session aborted, store marked error |
| 58 | Snake→camel mapping | `should_map_snake_case_params_to_camel_case_launch_args` | tool receives {workflow_id, o_prompt, target_session_id} → executor gets {workflowId, oPrompt, targetSessionId} |
| 58b | Fire-o tool handler mapping | `should_fire_o_tool_handler_map_params_to_executor_launch` | Calls index.ts tool handler directly, verifies snake→camel at handler level |
| 59 | Agent default "R" | `should_default_agent_to_R_when_not_provided` | agent undefined → executor receives "R" |
| 60 | Register before promptAsync | `should_register_to_store_before_promptAsync` | Crash between register and promptAsync → reconciliation knows about session |
| 61 | session.create failure | `should_propagate_error_when_session_create_fails` | client.session.create throws → error bubbles up to tool handler |
| 62 | Re-register overwrites | `should_overwrite_existing_workflow_on_re_register` | register same ID twice → second write wins, disk updated |

### Integration Tests — reconcileOnStartup (`workflow-store.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 63 | Recover completed workflow | `should_mark_running_as_completed_if_assistant_exists` | Running + assistant message → markCompleted |
| 63b | No assistant output | `should_leave_running_when_no_assistant_message_found` | Running + only user messages → status stays 'running' |
| 63c | Empty messages | `should_leave_running_when_session_has_no_messages` | Running + API returns {data:[]} → status stays 'running' |
| 64 | Mark error for missing session | `should_mark_error_for_deleted_session` | Running + API throws → markError |
| 65 | Skip non-running | `should_skip_non_running_workflows_during_reconciliation` | Completed entries → no API call |
| 66 | Batch concurrency | `should_reconcile_in_batches_of_5` | 12 running → 3 batches (5+5+2) |
| 67 | Partial failure | `should_continue_on_individual_reconciliation_failure` | One batch item throws → others still processed |

### Integration Tests — aristotle_check no-arg mode (`index.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 68 | No-arg returns active | `should_return_all_running_workflows_when_no_workflow_id` | 3 running + 2 completed → active list has 3 |
| 69 | With-id delegates to retrieve | `should_delegate_to_retrieve_when_workflow_id_provided` | check("id") → same as retrieve("id") |

### Integration Tests — Plugin lifecycle (`index.test.ts`)

| # | Acceptance Criterion | Test Name | Description |
|---|---------------------|-----------|-------------|
| 70 | Plugin registers tools | `should_register_fire_o_check_abort_tools` | apiMode = promptAsync → 3 tools returned |
| 71 | Plugin disabled on null apiMode | `should_return_empty_tools_when_promptAsync_unavailable` | apiMode = null → {} returned |
| 72 | Dispatch idle event | `should_dispatch_session_idle_to_idle_handler` | event.type === 'session.idle' + string sessionID → idleHandler.handle called |
| 73 | Ignore non-idle events | `should_ignore_non_idle_events` | event.type === 'session.created' → idleHandler not called |
| 74 | Ignore non-string sessionID | `should_ignore_idle_event_without_string_sessionID` | sessionID is number → idleHandler not called |
| 74b | Ignore undefined sessionID | `should_ignore_idle_event_when_sessionID_is_undefined` | sessionID is undefined → idleHandler not called |
| 75 | .bridge-active marker created | `should_create_bridge_active_marker_on_startup` | Marker file exists, content parses to {pid: process.pid, startedAt: <recent timestamp>} |
| 75b | Stale marker overwrite | `should_overwrite_stale_marker_on_startup` | Pre-existing marker from crashed process → new process overwrites with own PID |
| 76 | Cleanup on exit | `should_remove_marker_on_exit` | process.emit('exit') → marker deleted |
| 77 | Cleanup on SIGTERM | `should_remove_marker_on_SIGTERM` | process.emit('SIGTERM') → marker deleted |
| 78 | Cleanup on SIGINT | `should_remove_marker_on_SIGINT` | process.emit('SIGINT') → marker deleted |
| 79 | Cleanup on SIGHUP | `should_remove_marker_on_SIGHUP` | process.emit('SIGHUP') → marker deleted |

---

## Edge Cases & Error Paths

| Case | Test # | Expected |
|------|--------|----------|
| Disk full during saveToDisk | T-8 | Error logged, in-memory intact |
| Concurrent snapshot writes (Phase 0 + Bridge) | T-53 | snapshotExists check → skip |
| WorkflowStore full (50 running) | T-6/56 | New register rejected |
| aristotle_abort on cancelled workflow | T-46 | Idempotent: {status:'cancelled'} |
| aristotle_abort on completed workflow | T-47 | {status:'completed', workflow_id} |
| Idle event for cancelled workflow | T-35 | Skip, no result collection |
| promptAsync failure mid-launch | T-57 | Session aborted, store marked error |
| Probe session leak on failure | T-44 | session.delete in finally block |
| Corrupted store file on disk | T-3 | Empty store, no crash |
| Empty session (no messages) | T-29 | Valid snapshot with 0 messages |
| Very long message (>4000 chars) | T-22 | Hard truncated at 4000 chars (no suffix) |
| Very many messages (>200) | T-23 | Capped at 200 |

---

## Test Data

- **WorkflowState fixtures**: Factory function `createWorkflow(overrides?)` producing valid WorkflowState objects
- **Mock OpencodeClient**: Vitest mock with `session.create`, `session.promptAsync`, `session.abort`, `session.messages`, `session.delete` — all stubbed
- **Temp directory**: `vi.stubGlobal` or `os.tmpdir()` for isolated WorkflowStore and SnapshotExtractor tests
- **Message fixtures**: `{info: {role: 'user'|'assistant'}, parts: [{type:'text', text:'...'}]}` — matching OpenCode SDK message format
- **Disk isolation**: Each test creates a unique temp dir; cleanup in afterEach

---

## Dependencies Between Tests

- T-51–62 (executor) depend on WorkflowStore and SnapshotExtractor being tested independently (T-1–20c, T-21–29c)
- T-63–67 (reconciliation) depend on WorkflowStore unit tests passing
- T-68–69 (check integration) depend on WorkflowStore unit tests passing
- T-70–79 (plugin lifecycle + event dispatch + marker) depend on api-probe tests (T-41–44b)
- All unit test groups can run in parallel (WorkflowStore, SnapshotExtractor, utils, idle-handler, api-probe)
- Integration tests can run in parallel with each other but after their unit dependencies

---

## Open Questions

- **SDK mock fidelity**: OpenCode SDK types may not have official mock utilities — will use manual Vitest `vi.fn()` mocks
- **Atomic write testability**: `writeFileSync` + `renameSync` atomic write — need to mock `fs` to verify tmp→rename sequence (T-24, T-20c)
- **Process signal tests**: `process.emit('SIGTERM')` in test — may need `process.removeAllListeners` in afterEach to prevent test interference (T-76–79)
