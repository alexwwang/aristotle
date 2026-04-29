# Aristotle Bridge Plugin Testing Documentation

Run: `cd plugins/aristotle-bridge && bunx vitest run`

## Overview

| File | Tests | Coverage |
|------|-------|----------|
| utils.test.ts | 7 | extractLastAssistantText |
| api-probe.test.ts | 5 | detectApiMode |
| snapshot-extractor.test.ts | 12 | SnapshotExtractor |
| workflow-store.test.ts | 35 | WorkflowStore |
| idle-handler.test.ts | 7 | IdleEventHandler |
| executor.test.ts | 12 | AsyncTaskExecutor |
| index.test.ts | 22 | AristotleBridgePlugin |
| **Total** | **100** | |

---

## utils.test.ts (7 tests)

| Test | Coverage |
|------|----------|
| should_extract_text_from_info_parts_format | Basic extraction |
| should_skip_pure_tool_call_messages | Pure tool_call returns sentinel |
| should_return_sentinel_when_no_assistant_text | No assistant returns sentinel |
| should_find_last_assistant_with_text | Reverse traversal, last match |
| should_skip_assistant_message_with_empty_parts | Empty parts skip |
| should_join_multiple_text_parts_with_newline | Multi text parts joined with newline |
| should_skip_assistant_message_with_whitespace_only_text | Whitespace-only skip |

## api-probe.test.ts (5 tests)

| Test | Coverage |
|------|----------|
| should_return_promptAsync_when_api_available | API available returns 'promptAsync' |
| should_return_null_when_promptAsync_fails | API unavailable returns null |
| should_delete_probe_session_on_success | Cleanup on success |
| should_delete_probe_session_on_failure | Cleanup on failure |
| should_propagate_error_when_probe_session_create_fails | session.create failure throws |

## snapshot-extractor.test.ts (12 tests)

| Test | Coverage |
|------|----------|
| should_produce_valid_snapshot_json | JSON schema (v1, source=bridge-plugin-sdk) |
| should_truncate_message_content_at_4000_chars | Single message 4000 char truncation |
| should_limit_messages_to_200 | Total message count 200 cap |
| should_write_via_tmp_file_and_rename | Atomic write (.tmp + rename) |
| should_return_true_when_snapshot_exists | snapshotExists check |
| should_return_false_when_snapshot_missing | Missing returns false |
| should_use_custom_sessions_dir | Custom directory |
| should_filter_to_user_and_assistant_roles | Only user/assistant kept |
| should_handle_message_with_missing_parts_gracefully | Missing parts no crash |
| should_handle_empty_session_gracefully | Empty session |
| should_use_custom_focusHint_in_snapshot | focusHint written |
| should_cap_limit_at_200_even_when_higher | Limit cap at 200 |

## workflow-store.test.ts (35 tests)

28 unit + 7 reconcileOnStartup integration

### Disk Persistence (7)
| Test | Coverage |
|------|----------|
| should_persist_workflow_to_disk_on_register | Write |
| should_load_workflows_from_disk_on_construction | Read |
| should_start_with_empty_store_on_corrupted_disk_file | Corrupted file tolerance |
| should_start_with_empty_store_on_non_array_json | Non-array tolerance |
| should_start_with_empty_store_on_missing_disk_file | Missing file tolerance |
| should_log_error_and_continue_on_disk_write_failure | Write failure no crash |
| should_write_via_tmp_and_rename | Atomic write |

### Capacity Eviction (4)
| Test | Coverage |
|------|----------|
| should_evict_oldest_completed_when_full | Evict oldest completed |
| should_not_evict_running_workflows | Never evict running |
| should_evict_by_startedAt_ascending | Evict by time ascending |
| should_evict_error_undone_and_cancelled_workflows | Evict error/undone/cancelled |

### State Management (5)
| Test | Coverage |
|------|----------|
| should_mark_workflow_as_cancelled | Cancel mark |
| should_persist_cancelled_status_to_disk | Cancel persistence |
| should_mark_completed_with_result | Completed + result |
| should_mark_error_with_message | Error + message |
| should_mark_undone_status | Undone mark |

### Queries (7)
| Test | Coverage |
|------|----------|
| should_find_workflow_by_workflow_id | Find by workflowId |
| should_find_workflow_by_session_id | Find by sessionId |
| should_return_only_running_workflows | getActive filter |
| should_return_empty_active_list_when_no_running_workflows | Empty active |
| should_return_running/completed/error/undone/cancelled_status | Retrieve polymorphic |
| should_return_error_for_unknown_workflow | Unknown ID |
| should_overwrite_on_duplicate_workflow_id | Duplicate ID overwrite |

### reconcileOnStartup (7)
| Test | Coverage |
|------|----------|
| should_mark_running_as_completed_if_assistant_exists | Has assistant -> completed |
| should_leave_running_when_no_assistant_message_found | No assistant -> keep running |
| should_leave_running_when_session_has_no_messages | No messages -> keep running |
| should_mark_error_for_deleted_session | Session 404 -> error |
| should_skip_non_running_workflows_during_reconciliation | Skip non-running |
| should_reconcile_in_batches_of_5 | Batch-5 concurrency |
| should_continue_on_individual_reconciliation_failure | Single failure no batch impact |

## idle-handler.test.ts (7 tests)

| Test | Coverage |
|------|----------|
| should_skip_cancelled_workflow | Skip cancelled |
| should_skip_completed_workflow | Skip completed |
| should_collect_result_from_completed_session | running -> messages -> markCompleted |
| should_handle_message_fetch_error_gracefully | API error -> markError |
| should_skip_unknown_session | Unregistered session -> skip |
| should_skip_undone_workflow | Skip undone |
| should_skip_error_workflow | Skip error |

## executor.test.ts (12 tests)

| Test | Coverage |
|------|----------|
| should_create_session_promptAsync_and_register | Full launch flow |
| should_extract_snapshot_when_targetSessionId_and_not_exists | Extract snapshot when targetSessionId present |
| should_skip_snapshot_when_already_exists | Skip when snapshot exists |
| should_continue_launch_when_snapshot_extraction_fails | Snapshot failure non-blocking |
| should_skip_snapshot_when_no_target_session_id | Skip without targetSessionId |
| should_reject_and_abort_session_when_store_full | Store full -> reject + abort |
| should_abort_session_and_mark_error_on_promptAsync_failure | promptAsync fail + abort + markError |
| should_map_snake_case_params_to_camel_case_launch_args | camelCase param mapping |
| should_default_agent_to_R_when_not_provided | Agent defaults to 'R' |
| should_register_to_store_before_promptAsync | Crash safety: register before promptAsync |
| should_return_error_when_session_create_fails | session.create fail returns structured error |
| should_overwrite_existing_workflow_on_re_register | Duplicate workflowId overwrite |

## index.test.ts (22 tests)

### Tool Registration (2)
| Test | Coverage |
|------|----------|
| should_register_fire_o_check_abort_tools | 3 tools registered |
| should_return_empty_tools_when_promptAsync_unavailable | API unavailable returns empty |

### Event Dispatch (4)
| Test | Coverage |
|------|----------|
| should_dispatch_session_idle_to_idle_handler | session.idle -> idleHandler |
| should_ignore_non_idle_events | Non-idle events ignored |
| should_ignore_idle_event_without_string_sessionID | Non-string sessionID ignored |
| should_ignore_idle_event_when_sessionID_is_undefined | Undefined ignored |

### Marker Lifecycle (5)
| Test | Coverage |
|------|----------|
| should_create_bridge_active_marker_on_startup | Create .bridge-active |
| should_overwrite_stale_marker_on_startup | Overwrite stale marker |
| should_remove_marker_on_exit/SIGTERM/SIGINT/SIGHUP | Cleanup on exit/signals |

### aristotle_check (2)
| Test | Coverage |
|------|----------|
| should_return_all_running_workflows_when_no_workflow_id | No args -> getActive |
| should_delegate_to_retrieve_when_workflow_id_provided | With args -> retrieve |

### aristotle_abort (5)
| Test | Coverage |
|------|----------|
| should_cancel_running_workflow | running -> abort + cancel |
| should_return_cancelled_for_already_cancelled_workflow | Idempotent: already cancelled |
| should_return_current_status_for_completed/error/undone_workflow | Terminal state returns current |
| should_return_error_for_unknown_workflow_id | Unknown workflow |
| should_succeed_even_if_abort_api_fails | API failure still cancels |

### aristotle_fire_o (1)
| Test | Coverage |
|------|----------|
| should_fire_o_tool_handler_map_params_to_executor_launch | Param mapping snake->camel |

---

## Phase 5 Ralph Loop Review Record

| Round | Found | Fixed |
|-------|-------|-------|
| R1 | 3H + 5M + 6L | sessionsDir fallback, marker renamed .bridge-active, source field, loadFromDisk validation, store typed, removed redundant normalize |
| R2 | 1M + 2L | executor session.create try/catch |
| R3 | CLEAN (0 issues) | -- |
| R4 | CLEAN (0 issues) | -- |
