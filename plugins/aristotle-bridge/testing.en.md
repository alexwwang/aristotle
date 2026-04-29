# Aristotle Bridge Plugin Testing Documentation

Run: `cd plugins/aristotle-bridge && bunx vitest run`

## Overview

| File | Tests | Coverage |
|------|-------|----------|
| utils.test.ts | 7 | extractLastAssistantText |
| api-probe.test.ts | 5 | detectApiMode |
| snapshot-extractor.test.ts | 12 | SnapshotExtractor |
| workflow-store.test.ts | 45 | WorkflowStore |
| idle-handler.test.ts | 44 | IdleEventHandler |
| executor.test.ts | 12 | AsyncTaskExecutor |
| index.test.ts | 23 | AristotleBridgePlugin |
| **Total** | **148** | |

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
| should_return_null_when_promptAsync_missing | promptAsync missing returns null |
| should_return_null_when_session_missing | session missing returns null |
| should_return_null_when_client_null | client null returns null |
| should_not_call_promptAsync_only_check_existence | Only checks typeof, does not call |

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

## workflow-store.test.ts (45 tests)

28 unit + 17 reconcileOnStartup integration

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

### Queries (12)
| Test | Coverage |
|------|----------|
| should_return_only_running_workflows | getActive filter |
| should_return_empty_active_list_when_no_running_workflows | Empty active |
| should_find_workflow_by_workflow_id | Find by workflowId |
| should_find_workflow_by_session_id | Find by sessionId |
| should_return_running_status_for_running_workflow | Retrieve running status |
| should_return_completed_result | Retrieve completed with result |
| should_return_empty_string_result_when_completed_without_result | Retrieve completed with empty result |
| should_return_error_status | Retrieve error status |
| should_return_error_for_unknown_workflow | Unknown ID |
| should_return_undone_status | Retrieve undone status |
| should_return_cancelled_status | Retrieve cancelled status |
| should_overwrite_on_duplicate_workflow_id | Duplicate ID overwrite |

### reconcileOnStartup (17)
| Test | Coverage |
|------|----------|
| should_mark_running_as_completed_if_assistant_exists | Has assistant -> completed |
| should_leave_running_when_no_assistant_message_found | No assistant -> error |
| should_leave_running_when_session_has_no_messages | No messages -> error |
| should_mark_error_for_deleted_session | Session 404 -> error |
| should_skip_non_running_workflows_during_reconciliation | Skip non-running |
| should_reconcile_in_batches_of_5 | Batch-5 concurrency |
| should_continue_on_individual_reconciliation_failure | Single failure no batch impact |
| should_skip_workflows_from_other_instance_during_reconcile | Instance isolation: skip other |
| should_stamp_instanceId_on_register | Stamp instanceId on register |
| should_overwrite_caller_instanceId_on_register | Overwrite spoofed instanceId |
| should_skip_old_workflows_without_instanceId_during_reconcile | Skip legacy no-instanceId workflows |
| should_not_touch_chain_pending_from_other_instance | Instance isolation: chain_pending |
| should_not_log_chain_broken_from_other_instance | Instance isolation: chain_broken |
| should_mark_error_on_reconcile_timeout | Timeout -> error |
| should_mark_error_on_malformed_api_response | Malformed response -> error |
| should_preserve_other_instance_entries_on_saveToDisk | Multi-instance disk merge |
| should_evict_other_instance_completed_workflows_when_at_capacity | Cross-instance capacity eviction |

## idle-handler.test.ts (44 tests)

### IdleEventHandler — Skip guards (5)
| Test | Coverage |
|------|----------|
| should_skip_cancelled_workflow | Skip cancelled |
| should_skip_completed_workflow | Skip completed |
| should_skip_undone_workflow | Skip undone |
| should_skip_error_workflow | Skip error |
| should_skip_unknown_session | Unregistered session -> skip |

### IdleEventHandler — R→C Chain driving (9)
| Test | Coverage |
|------|----------|
| should_mark_completed_for_non_chain_agent | Non-chain agent fallback: markCompleted |
| should_drive_R_to_C_chain | R agent: fire_sub -> launch C |
| should_mark_chain_broken_on_subprocess_error | Subprocess stderr -> chain_broken |
| should_mark_chain_broken_on_workflow_id_mismatch | Mismatched workflow_id -> chain_broken |
| should_mark_chain_broken_on_executor_launch_error_status | Launch returns error -> chain_broken |
| should_mark_chain_broken_on_executor_launch_throw | Launch throws -> chain_broken |
| should_mark_completed_on_done_action | R done action -> markCompleted |
| should_mark_chain_broken_on_notify_action | R notify action -> chain_broken |
| should_mark_chain_broken_on_unexpected_action | Unknown action -> chain_broken |

### IdleEventHandler — C completion (5)
| Test | Coverage |
|------|----------|
| should_complete_on_C_done | C done action -> markCompleted |
| should_mark_chain_broken_on_C_notify | C notify action -> chain_broken |
| should_handle_C_fire_sub_rereflect | C fire_sub R -> re-launch R |
| should_mark_chain_broken_on_C_launch_error_status | C launch error -> chain_broken |
| should_mark_chain_broken_when_error_after_chain_pending | Error after chain_pending -> chain_broken |

### IdleEventHandler — Error handling (2)
| Test | Coverage |
|------|----------|
| should_preserve_cancelled_when_abort_race | Abort race: preserve cancelled |
| should_mark_error_for_non_chain_failure | Non-chain fetch error -> markError |

### IdleEventHandler — resolveMcpProjectDir (3)
| Test | Coverage |
|------|----------|
| should_use_env_var_when_set | ARISTOTLE_MCP_DIR priority |
| should_fallback_to_cwd_when_no_env | Fallback to process.cwd() |
| should_fallback_to_aristotle_project_dir_env | Fallback to ARISTOTLE_PROJECT_DIR |

### IdleEventHandler — callMCP error parsing (2)
| Test | Coverage |
|------|----------|
| should_parse_stdout_error_on_nonzero_exit | Nonzero exit: parse stdout JSON error |
| should_return_node_error_when_no_stdout | Spawn error: return node error message |

### IdleEventHandler — Trigger file — reflect (5)
| Test | Coverage |
|------|----------|
| should_ignore_when_no_trigger_file | No .trigger-reflect.json -> skip |
| should_process_trigger_and_launch_R | Parse trigger -> orchestrate_start -> launch R |
| should_delete_trigger_on_parse_error | Invalid JSON -> delete trigger |
| should_delete_trigger_on_subprocess_error | Subprocess error -> delete trigger |
| should_delete_trigger_on_R_launch_failure | R launch failure -> delete trigger |

### IdleEventHandler — Trigger file — abort (9)
| Test | Coverage |
|------|----------|
| should_abort_all_active_workflows | Empty trigger -> abort all active |
| should_abort_specific_workflow_ids_only | Filtered trigger -> abort specific IDs |
| should_skip_non_running_workflows | Skip completed/error in active list |
| should_delete_trigger_file_after_processing | Always delete after processing |
| should_delete_trigger_file_on_parse_error | Invalid JSON -> delete trigger |
| should_call_session_abort_for_each_workflow | Call session.abort per workflow |
| should_cancel_without_abort_when_sessionId_missing | Missing sessionId -> cancel only |
| should_not_cancel_when_no_active_workflows | Empty active -> no-op |
| should_continue_cancelling_when_one_fails | Partial failure tolerance |

### IdleEventHandler — notifyParent (4)
| Test | Coverage |
|------|----------|
| should_notify_parent_on_R_done | R done -> notify parent |
| should_notify_parent_on_C_done | C done -> notify parent (review prompt) |
| should_not_notify_when_parentSessionId_empty | Empty parent -> skip notify |
| should_not_throw_when_notify_fails | Notify failure is best-effort |

## executor.test.ts (12 tests)

| Test | Coverage |
|------|----------|
| should_create_session_promptAsync_and_register | Full launch flow |
| should_extract_snapshot_when_targetSessionId | Extract snapshot when targetSessionId present |
| should_reuse_snapshot_when_exists_for_this_workflow | Reuse snapshot when exists for this workflowId |
| should_continue_launch_when_snapshot_extraction_fails | Snapshot failure non-blocking |
| should_skip_snapshot_when_no_target_session_id | Skip without targetSessionId |
| should_reject_and_abort_session_when_store_full | Store full -> reject + abort |
| should_abort_session_and_mark_error_on_promptAsync_failure | promptAsync fail + abort + markError |
| should_map_snake_case_params_to_camel_case_launch_args | camelCase param mapping |
| should_default_agent_to_R_when_not_provided | Agent defaults to 'R' |
| should_register_to_store_before_promptAsync | Crash safety: register before promptAsync |
| should_return_error_when_session_create_fails | session.create fail returns structured error |
| should_overwrite_existing_workflow_on_re_register | Duplicate workflowId overwrite |

## index.test.ts (23 tests)

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

### Marker Lifecycle (6)
| Test | Coverage |
|------|----------|
| should_create_bridge_active_marker_on_startup | Create .bridge-active |
| should_overwrite_stale_marker_on_startup | Overwrite stale marker |
| should_remove_marker_on_exit | Cleanup on exit |
| should_remove_marker_on_SIGTERM | Cleanup on SIGTERM |
| should_remove_marker_on_SIGINT | Cleanup on SIGINT |
| should_remove_marker_on_SIGHUP | Cleanup on SIGHUP |

### aristotle_check (2)
| Test | Coverage |
|------|----------|
| should_return_all_running_workflows_when_no_workflow_id | No args -> getActive |
| should_delegate_to_retrieve_when_workflow_id_provided | With args -> retrieve |

### aristotle_abort (7)
| Test | Coverage |
|------|----------|
| should_cancel_running_workflow | running -> abort + cancel |
| should_return_cancelled_for_already_cancelled_workflow | Idempotent: already cancelled |
| should_return_current_status_for_completed_workflow | Terminal: completed returns current |
| should_return_current_status_for_error_workflow | Terminal: error returns current |
| should_return_current_status_for_undone_workflow | Terminal: undone returns current |
| should_return_error_for_unknown_workflow_id | Unknown workflow |
| should_succeed_even_if_abort_api_fails | API failure still cancels |

### aristotle_fire_o (2)
| Test | Coverage |
|------|----------|
| should_default_target_session_id_to_tool_context_sessionID_when_empty | Empty target_session_id defaults to tool context sessionID |
| should_use_explicit_target_session_id_when_provided | Explicit target_session_id used when provided |

---

## Phase 5 Ralph Loop Review Record

| Round | Found | Fixed |
|-------|-------|-------|
| R1 | 3H + 5M + 6L | sessionsDir fallback, marker renamed .bridge-active, source field, loadFromDisk validation, store typed, removed redundant normalize |
| R2 | 1M + 2L | executor session.create try/catch |
| R3 | CLEAN (0 issues) | -- |
| R4 | CLEAN (0 issues) | -- |
