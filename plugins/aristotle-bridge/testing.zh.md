# Aristotle Bridge 插件测试文档

运行: `cd plugins/aristotle-bridge && bunx vitest run`

## 总览

| 文件 | 测试数 | 覆盖 |
|------|--------|------|
| utils.test.ts | 7 | extractLastAssistantText |
| api-probe.test.ts | 5 | detectApiMode |
| snapshot-extractor.test.ts | 12 | SnapshotExtractor |
| workflow-store.test.ts | 45 | WorkflowStore |
| idle-handler.test.ts | 44 | IdleEventHandler |
| executor.test.ts | 12 | AsyncTaskExecutor |
| index.test.ts | 23 | AristotleBridgePlugin |
| **合计** | **148** | |

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
| should_return_null_when_promptAsync_missing | 缺少 promptAsync 返回 null |
| should_return_null_when_session_missing | 缺少 session 返回 null |
| should_return_null_when_client_null | client 为 null 返回 null |
| should_not_call_promptAsync_only_check_existence | 仅检查 typeof，不实际调用 |

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

## workflow-store.test.ts (45 tests)

28 个单元测试 + 17 个 reconcileOnStartup 集成测试

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

### 查询 (12)

| 测试名 | 覆盖 |
|--------|------|
| should_return_only_running_workflows | getActive 过滤 |
| should_return_empty_active_list_when_no_running_workflows | 空 active |
| should_find_workflow_by_workflow_id | 按 workflowId 查找 |
| should_find_workflow_by_session_id | 按 sessionId 查找 |
| should_return_running_status_for_running_workflow | retrieve running 状态 |
| should_return_completed_result | retrieve completed 带 result |
| should_return_empty_string_result_when_completed_without_result | retrieve completed 空 result |
| should_return_error_status | retrieve error 状态 |
| should_return_error_for_unknown_workflow | 未知 ID |
| should_return_undone_status | retrieve undone 状态 |
| should_return_cancelled_status | retrieve cancelled 状态 |
| should_overwrite_on_duplicate_workflow_id | 重复 ID 覆盖 |

### reconcileOnStartup (17)

| 测试名 | 覆盖 |
|--------|------|
| should_mark_running_as_completed_if_assistant_exists | 有 assistant -> completed |
| should_leave_running_when_no_assistant_message_found | 无 assistant -> error |
| should_leave_running_when_session_has_no_messages | 无消息 -> error |
| should_mark_error_for_deleted_session | session 404 -> error |
| should_skip_non_running_workflows_during_reconciliation | 跳过非 running |
| should_reconcile_in_batches_of_5 | batch-5 并发 |
| should_continue_on_individual_reconciliation_failure | 单条失败不影响批次 |
| should_skip_workflows_from_other_instance_during_reconcile | 实例隔离：跳过其他实例 |
| should_stamp_instanceId_on_register | register 时打 instanceId 戳 |
| should_overwrite_caller_instanceId_on_register | 覆盖伪造的 instanceId |
| should_skip_old_workflows_without_instanceId_during_reconcile | 跳过无 instanceId 的老数据 |
| should_not_touch_chain_pending_from_other_instance | 实例隔离：chain_pending |
| should_not_log_chain_broken_from_other_instance | 实例隔离：chain_broken |
| should_mark_error_on_reconcile_timeout | 超时 -> error |
| should_mark_error_on_malformed_api_response | 异常响应 -> error |
| should_preserve_other_instance_entries_on_saveToDisk | 多实例磁盘合并 |
| should_evict_other_instance_completed_workflows_when_at_capacity | 跨实例容量淘汰 |

## idle-handler.test.ts (44 tests)

### IdleEventHandler — 跳过守卫 (5)

| 测试名 | 覆盖 |
|--------|------|
| should_skip_cancelled_workflow | 跳过 cancelled |
| should_skip_completed_workflow | 跳过 completed |
| should_skip_undone_workflow | 跳过 undone |
| should_skip_error_workflow | 跳过 error |
| should_skip_unknown_session | 未注册 session -> 跳过 |

### IdleEventHandler — R→C 链驱动 (9)

| 测试名 | 覆盖 |
|--------|------|
| should_mark_completed_for_non_chain_agent | 非链式 agent 回退：markCompleted |
| should_drive_R_to_C_chain | R agent：fire_sub -> 启动 C |
| should_mark_chain_broken_on_subprocess_error | 子进程 stderr -> chain_broken |
| should_mark_chain_broken_on_workflow_id_mismatch | workflow_id 不匹配 -> chain_broken |
| should_mark_chain_broken_on_executor_launch_error_status | launch 返回 error -> chain_broken |
| should_mark_chain_broken_on_executor_launch_throw | launch 抛出异常 -> chain_broken |
| should_mark_completed_on_done_action | R done 动作 -> markCompleted |
| should_mark_chain_broken_on_notify_action | R notify 动作 -> chain_broken |
| should_mark_chain_broken_on_unexpected_action | 未知动作 -> chain_broken |

### IdleEventHandler — C 完成 (5)

| 测试名 | 覆盖 |
|--------|------|
| should_complete_on_C_done | C done 动作 -> markCompleted |
| should_mark_chain_broken_on_C_notify | C notify 动作 -> chain_broken |
| should_handle_C_fire_sub_rereflect | C fire_sub R -> 重新启动 R |
| should_mark_chain_broken_on_C_launch_error_status | C launch 错误 -> chain_broken |
| should_mark_chain_broken_when_error_after_chain_pending | chain_pending 后出错 -> chain_broken |

### IdleEventHandler — 错误处理 (2)

| 测试名 | 覆盖 |
|--------|------|
| should_preserve_cancelled_when_abort_race | 中止竞态：保留 cancelled |
| should_mark_error_for_non_chain_failure | 非链式获取失败 -> markError |

### IdleEventHandler — resolveMcpProjectDir (3)

| 测试名 | 覆盖 |
|--------|------|
| should_use_env_var_when_set | ARISTOTLE_MCP_DIR 优先 |
| should_fallback_to_cwd_when_no_env | 回退到 process.cwd() |
| should_fallback_to_aristotle_project_dir_env | 回退到 ARISTOTLE_PROJECT_DIR |

### IdleEventHandler — callMCP 错误解析 (2)

| 测试名 | 覆盖 |
|--------|------|
| should_parse_stdout_error_on_nonzero_exit | 非零退出：解析 stdout JSON 错误 |
| should_return_node_error_when_no_stdout | 启动失败：返回 node 错误信息 |

### IdleEventHandler — 触发文件 — reflect (5)

| 测试名 | 覆盖 |
|--------|------|
| should_ignore_when_no_trigger_file | 无 .trigger-reflect.json -> 跳过 |
| should_process_trigger_and_launch_R | 解析触发 -> orchestrate_start -> 启动 R |
| should_delete_trigger_on_parse_error | JSON 解析错误 -> 删除触发文件 |
| should_delete_trigger_on_subprocess_error | 子进程错误 -> 删除触发文件 |
| should_delete_trigger_on_R_launch_failure | R 启动失败 -> 删除触发文件 |

### IdleEventHandler — 触发文件 — abort (9)

| 测试名 | 覆盖 |
|--------|------|
| should_abort_all_active_workflows | 空触发 -> 中止所有 active |
| should_abort_specific_workflow_ids_only | 带过滤 -> 只中止指定 ID |
| should_skip_non_running_workflows | 跳过 active 列表中的 completed/error |
| should_delete_trigger_file_after_processing | 处理后总是删除 |
| should_delete_trigger_file_on_parse_error | JSON 解析错误 -> 删除触发文件 |
| should_call_session_abort_for_each_workflow | 每个 workflow 调用 session.abort |
| should_cancel_without_abort_when_sessionId_missing | 缺少 sessionId -> 只 cancel |
| should_not_cancel_when_no_active_workflows | active 为空 -> 无操作 |
| should_continue_cancelling_when_one_fails | 部分失败容错 |

### IdleEventHandler — notifyParent (4)

| 测试名 | 覆盖 |
|--------|------|
| should_notify_parent_on_R_done | R 完成 -> 通知父会话 |
| should_notify_parent_on_C_done | C 完成 -> 通知父会话 (review 提示) |
| should_not_notify_when_parentSessionId_empty | 空父会话 -> 跳过通知 |
| should_not_throw_when_notify_fails | 通知失败为尽力而为 |

## executor.test.ts (12 tests)

| 测试名 | 覆盖 |
|--------|------|
| should_create_session_promptAsync_and_register | 完整启动流程 |
| should_extract_snapshot_when_targetSessionId | 有 targetSessionId 时提取 snapshot |
| should_reuse_snapshot_when_exists_for_this_workflow | 该 workflowId 的 snapshot 已存在时复用 |
| should_continue_launch_when_snapshot_extraction_fails | snapshot 失败不阻塞 |
| should_skip_snapshot_when_no_target_session_id | 无 targetSessionId 跳过 |
| should_reject_and_abort_session_when_store_full | store 满时拒绝 + abort |
| should_abort_session_and_mark_error_on_promptAsync_failure | promptAsync 失败 + abort + markError |
| should_map_snake_case_params_to_camel_case_launch_args | camelCase 参数映射 |
| should_default_agent_to_R_when_not_provided | agent 默认 'R' |
| should_register_to_store_before_promptAsync | crash safety: register 在 promptAsync 前 |
| should_return_error_when_session_create_fails | session.create 失败返回结构化错误 |
| should_overwrite_existing_workflow_on_re_register | 重复 workflowId 覆盖 |

## index.test.ts (23 tests)

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

### Marker 生命周期 (6)

| 测试名 | 覆盖 |
|--------|------|
| should_create_bridge_active_marker_on_startup | 创建 .bridge-active |
| should_overwrite_stale_marker_on_startup | 覆盖旧 marker |
| should_remove_marker_on_exit | exit 清理 |
| should_remove_marker_on_SIGTERM | SIGTERM 清理 |
| should_remove_marker_on_SIGINT | SIGINT 清理 |
| should_remove_marker_on_SIGHUP | SIGHUP 清理 |

### aristotle_check (2)

| 测试名 | 覆盖 |
|--------|------|
| should_return_all_running_workflows_when_no_workflow_id | 无参 -> getActive |
| should_delegate_to_retrieve_when_workflow_id_provided | 有参 -> retrieve |

### aristotle_abort (7)

| 测试名 | 覆盖 |
|--------|------|
| should_cancel_running_workflow | running -> abort + cancel |
| should_return_cancelled_for_already_cancelled_workflow | 幂等: 已 cancelled |
| should_return_current_status_for_completed_workflow | 终态 completed 返回当前状态 |
| should_return_current_status_for_error_workflow | 终态 error 返回当前状态 |
| should_return_current_status_for_undone_workflow | 终态 undone 返回当前状态 |
| should_return_error_for_unknown_workflow_id | 未知 workflow |
| should_succeed_even_if_abort_api_fails | API 失败仍 cancel |

### aristotle_fire_o (2)

| 测试名 | 覆盖 |
|--------|------|
| should_default_target_session_id_to_tool_context_sessionID_when_empty | 空 target_session_id 默认使用 tool context sessionID |
| should_use_explicit_target_session_id_when_provided | 显式 target_session_id 优先使用 |

---

## Phase 5 Ralph Loop 审核记录

| 轮次 | 发现 | 修复 |
|------|------|------|
| R1 | 3H + 5M + 6L | sessionsDir fallback、marker 改名 .bridge-active、source 字段修正、loadFromDisk 验证、store 类型化、去除冗余 normalize |
| R2 | 1M + 2L | executor session.create 加 try/catch |
| R3 | CLEAN (0 issues) | -- |
| R4 | CLEAN (0 issues) | -- |
