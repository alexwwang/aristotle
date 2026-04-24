# Aristotle Bridge 插件测试文档

运行: `cd plugins/aristotle-bridge && bunx vitest run`

## 总览

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| utils.test.ts | 7 | extractLastAssistantText |
| api-probe.test.ts | 5 | detectApiMode |
| snapshot-extractor.test.ts | 12 | SnapshotExtractor |
| workflow-store.test.ts | 35 | WorkflowStore |
| idle-handler.test.ts | 7 | IdleEventHandler |
| executor.test.ts | 12 | AsyncTaskExecutor |
| index.test.ts | 22 | AristotleBridgePlugin |
| **合计** | **100** | |

---

## utils.test.ts (7 tests)

| 测试名 | 覆盖 |
|--------|------|
| should_extract_text_from_info_parts_format | 基本提取 |
| should_skip_pure_tool_call_messages | 纯 tool_call 返回 sentinel |
| should_return_sentinel_when_no_assistant_text | 无 assistant 返回 sentinel |
| should_find_last_assistant_with_text | 反向遍历取最后一条 |
| should_skip_assistant_message_with_empty_parts | 空 parts 跳过 |
| should_join_multiple_text_parts_with_newline | 多 text parts 换行拼接 |
| should_skip_assistant_message_with_whitespace_only_text | 纯空白跳过 |

## api-probe.test.ts (5 tests)

| 测试名 | 覆盖 |
|--------|------|
| should_return_promptAsync_when_api_available | API 可用返回 'promptAsync' |
| should_return_null_when_promptAsync_fails | API 不可用返回 null |
| should_delete_probe_session_on_success | 成功时清理 probe session |
| should_delete_probe_session_on_failure | 失败时清理 probe session |
| should_propagate_error_when_probe_session_create_fails | session.create 失败抛出 |

## snapshot-extractor.test.ts (12 tests)

| 测试名 | 覆盖 |
|--------|------|
| should_produce_valid_snapshot_json | JSON schema (version=1, source=bridge-plugin-sdk) |
| should_truncate_message_content_at_4000_chars | 单条消息 4000 字符截断 |
| should_limit_messages_to_200 | 总消息数 200 上限 |
| should_write_via_tmp_file_and_rename | 原子写入 (.tmp + rename) |
| should_return_true_when_snapshot_exists | snapshotExists 检查 |
| should_return_false_when_snapshot_missing | 不存在返回 false |
| should_use_custom_sessions_dir | 自定义目录 |
| should_filter_to_user_and_assistant_roles | 只保留 user/assistant |
| should_handle_message_with_missing_parts_gracefully | 缺 parts 不崩溃 |
| should_handle_empty_session_gracefully | 空会话 |
| should_use_custom_focusHint_in_snapshot | focusHint 写入 |
| should_cap_limit_at_200_even_when_higher | limit 上限 200 |

## workflow-store.test.ts (35 tests)

28 个单元测试 + 7 个 reconcileOnStartup 集成测试

### 磁盘持久化 (7)

| 测试名 | 覆盖 |
|--------|------|
| should_persist_workflow_to_disk_on_register | 写入 |
| should_load_workflows_from_disk_on_construction | 读取 |
| should_start_with_empty_store_on_corrupted_disk_file | 损坏文件容错 |
| should_start_with_empty_store_on_non_array_json | 非数组容错 |
| should_start_with_empty_store_on_missing_disk_file | 缺文件容错 |
| should_log_error_and_continue_on_disk_write_failure | 写入失败不崩溃 |
| should_write_via_tmp_and_rename | 原子写入 |

### 容量淘汰 (4)

| 测试名 | 覆盖 |
|--------|------|
| should_evict_oldest_completed_when_full | 淘汰最旧已完成 |
| should_not_evict_running_workflows | 不淘汰 running |
| should_evict_by_startedAt_ascending | 按时间升序淘汰 |
| should_evict_error_undone_and_cancelled_workflows | 淘汰 error/undone/cancelled |

### 状态管理 (5)

| 测试名 | 覆盖 |
|--------|------|
| should_mark_workflow_as_cancelled | cancel 标记 |
| should_persist_cancelled_status_to_disk | cancel 持久化 |
| should_mark_completed_with_result | completed + result |
| should_mark_error_with_message | error + message |
| should_mark_undone_status | undone 标记 |

### 查询 (7)

| 测试名 | 覆盖 |
|--------|------|
| should_find_workflow_by_workflow_id | 按 workflowId 查找 |
| should_find_workflow_by_session_id | 按 sessionId 查找 |
| should_return_only_running_workflows | getActive 过滤 |
| should_return_empty_active_list_when_no_running_workflows | 空 active |
| should_return_running/completed/error/undone/cancelled_status | retrieve 多态 |
| should_return_error_for_unknown_workflow | 未知 ID |
| should_overwrite_on_duplicate_workflow_id | 重复 ID 覆盖 |

### reconcileOnStartup (7)

| 测试名 | 覆盖 |
|--------|------|
| should_mark_running_as_completed_if_assistant_exists | 有 assistant -> completed |
| should_leave_running_when_no_assistant_message_found | 无 assistant -> 保持 running |
| should_leave_running_when_session_has_no_messages | 无消息 -> 保持 running |
| should_mark_error_for_deleted_session | session 404 -> error |
| should_skip_non_running_workflows_during_reconciliation | 跳过非 running |
| should_reconcile_in_batches_of_5 | batch-5 并发 |
| should_continue_on_individual_reconciliation_failure | 单条失败不影响批次 |

## idle-handler.test.ts (7 tests)

| 测试名 | 覆盖 |
|--------|------|
| should_skip_cancelled_workflow | 跳过 cancelled |
| should_skip_completed_workflow | 跳过 completed |
| should_collect_result_from_completed_session | running -> messages -> markCompleted |
| should_handle_message_fetch_error_gracefully | API 错误 -> markError |
| should_skip_unknown_session | 未注册 session -> 跳过 |
| should_skip_undone_workflow | 跳过 undone |
| should_skip_error_workflow | 跳过 error |

## executor.test.ts (12 tests)

| 测试名 | 覆盖 |
|--------|------|
| should_create_session_promptAsync_and_register | 完整启动流程 |
| should_extract_snapshot_when_targetSessionId_and_not_exists | 有 targetSessionId 时提取 snapshot |
| should_skip_snapshot_when_already_exists | snapshot 已存在时跳过 |
| should_continue_launch_when_snapshot_extraction_fails | snapshot 失败不阻塞 |
| should_skip_snapshot_when_no_target_session_id | 无 targetSessionId 跳过 |
| should_reject_and_abort_session_when_store_full | store 满时拒绝 + abort |
| should_abort_session_and_mark_error_on_promptAsync_failure | promptAsync 失败 + abort + markError |
| should_map_snake_case_params_to_camel_case_launch_args | camelCase 参数映射 |
| should_default_agent_to_R_when_not_provided | agent 默认 'R' |
| should_register_to_store_before_promptAsync | crash safety: register 在 promptAsync 前 |
| should_return_error_when_session_create_fails | session.create 失败返回结构化错误 |
| should_overwrite_existing_workflow_on_re_register | 重复 workflowId 覆盖 |

## index.test.ts (22 tests)

### 工具注册 (2)

| 测试名 | 覆盖 |
|--------|------|
| should_register_fire_o_check_abort_tools | 3 个工具注册 |
| should_return_empty_tools_when_promptAsync_unavailable | API 不可用返回空 |

### 事件分发 (4)

| 测试名 | 覆盖 |
|--------|------|
| should_dispatch_session_idle_to_idle_handler | session.idle -> idleHandler |
| should_ignore_non_idle_events | 非 idle 事件忽略 |
| should_ignore_idle_event_without_string_sessionID | sessionID 非字符串忽略 |
| should_ignore_idle_event_when_sessionID_is_undefined | undefined 忽略 |

### Marker 生命周期 (5)

| 测试名 | 覆盖 |
|--------|------|
| should_create_bridge_active_marker_on_startup | 创建 .bridge-active |
| should_overwrite_stale_marker_on_startup | 覆盖旧 marker |
| should_remove_marker_on_exit | exit 清理 |
| should_remove_marker_on_SIGTERM/SIGINT/SIGHUP | 信号清理 |

### aristotle_check (2)

| 测试名 | 覆盖 |
|--------|------|
| should_return_all_running_workflows_when_no_workflow_id | 无参 -> getActive |
| should_delegate_to_retrieve_when_workflow_id_provided | 有参 -> retrieve |

### aristotle_abort (5)

| 测试名 | 覆盖 |
|--------|------|
| should_cancel_running_workflow | running -> abort + cancel |
| should_return_cancelled_for_already_cancelled_workflow | 幂等: 已 cancelled |
| should_return_current_status_for_completed/error/undone_workflow | 终态返回当前状态 |
| should_return_error_for_unknown_workflow_id | 未知 workflow |
| should_succeed_even_if_abort_api_fails | API 失败仍 cancel |

### aristotle_fire_o (1)

| 测试名 | 覆盖 |
|--------|------|
| should_fire_o_tool_handler_map_params_to_executor_launch | 参数映射 snake->camel |

---

## Phase 5 Ralph Loop 审核记录

| 轮次 | 发现 | 修复 |
|------|------|------|
| R1 | 3H + 5M + 6L | sessionsDir fallback、marker 改名 .bridge-active、source 字段修正、loadFromDisk 验证、store 类型化、去除冗余 normalize |
| R2 | 1M + 2L | executor session.create 加 try/catch |
| R3 | CLEAN (0 issues) | -- |
| R4 | CLEAN (0 issues) | -- |
