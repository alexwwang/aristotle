# Test Plan: Phase 0 — Core Extraction

**Version**: 2.4
**Status**: Implemented
**Parent Document**: TestPlan-opencode-agent-platform.md
**Technical Design**: Phase0-Core-Extraction.md v3.6
**Last Updated**: 2026-05-11

---

## Overview

Phase 0 将 `plugins/aristotle-bridge/` 中的共享基础设施提取到 `packages/core/`，Aristotle 业务逻辑移入 `packages/reflection/`。

**唯一不变量**：零行为变更。所有现有测试覆盖的行为在新代码中必须等价复现。新模块的测试覆盖所有新建接口。

**迁移分类说明**（v2.0 修正）：
- **纯迁移**：只改 import 路径，测试逻辑不变（WorkflowStore 45、Utils 7、API Probe 5、Config aristotle 14 = 71 个）
- **机械性改造**：import 路径 + 构造函数调用签名变更，断言逻辑不变（Idle-handler 41 个）
- **拆分重写**：接口形状变化，测试针对新接口重写，验证等价行为（Executor core 4 + Executor aristotle 14 + SnapshotExtractor aristotle 12 + Index/role entry 23 = 53 个）
- **新建测试**：全新模块的全新测试（Logger 11、StateStore 23、ConfigResolver 14、SessionExtractor 13、Plugin Registration 18、Utils +5、Tools 10、Config aristotle +1、Static 3、Plugin smoke 1 = 99 个）

---

## Test Organization

| Suite | Location | Source | Count |
|-------|----------|--------|-------|
| Logger (new) | `packages/core/test/logger.test.ts` | 新建 | 11 |
| Utils (migrated + new) | `packages/core/test/utils.test.ts` | 7 migrated + 5 new | 12 |
| StateStore (new) | `packages/core/test/state-store.test.ts` | 新建 | 23 |
| WorkflowStore (migrated) | `packages/core/test/workflow-store.test.ts` | 45 纯迁移 | 45 |
| ConfigResolver (new) | `packages/core/test/config.test.ts` | 新建 | 14 |
| SessionExtractor (new) | `packages/core/test/extractor.test.ts` | 新建 | 13 |
| Executor core (split) | `packages/core/test/executor.test.ts` | 4 拆分重写 | 4 |
| API Probe (migrated) | `packages/core/test/api-probe.test.ts` | 5 纯迁移 | 5 |
| Plugin Registration (new) | `packages/core/test/registration.test.ts` | 新建 | 18 |
| Config aristotle (migrated+new) | `packages/reflection/test/config.test.ts` | 14 migrated + 1 new | 15 |
| Idle-handler (adapted) | `packages/reflection/test/idle-handler.test.ts` | 41 机械性改造 | 41 |
| Executor aristotle (rewrite) | `packages/reflection/test/executor.test.ts` | 14 拆分重写 | 14 |
| Snapshot-extractor (rewrite) | `packages/reflection/test/snapshot-extractor.test.ts` | 12 拆分重写 | 12 |
| Index/role entry (rewrite) | `packages/reflection/test/index.test.ts` | 23 拆分重写 | 23 |
| Tools (new) | `packages/reflection/test/tools.test.ts` | 新建 | 10 |
| Static assertions | `test.sh` extension | 新建 | 3 |
| Plugin smoke test (new) | `plugin/test/index.test.ts` | 新建 | 1 |
| **Total** | | | **~264** |

---

## Core Scenarios & Key Functional Points

### Core Scenario 1: Zero Behavior Change

**Source**: PRD Phase 0 goal + Phase 0 design §7 strategy

所有 162 个现有测试迁移后逻辑不变，全部通过。

**Derived Functional Points**:
- Migrated test import paths update correctly (peripheral)
- External plugin interface shape preserved (key)

### Core Scenario 2: Core Module API Correctness

**Source**: TechSpec §2.1–2.6 + Phase 0 §3.2

所有新建 core 模块（Logger、Utils、StateStore、ConfigResolver、SessionExtractor、Executor、PluginRegistration）的公开 API 行为正确。

**Derived Functional Points**:
- StateStore atomic write & crash recovery (key)
- ConfigResolver generic resolution chain (key)
- assemblePlugin multi-role dispatch (key)
- SessionExtractor generic extraction (key)
- Logger layered env var (peripheral)
- Utils sentinel configurability (peripheral)

### Core Scenario 3: Dependency Injection Integrity

**Source**: Phase 0 §4.3

Core 模块不 import config，所有配置值通过构造参数注入。

**Derived Functional Points**:
- Static assertion SA-03 verifies no core→role imports (key)

---

## Design Coverage Matrix (Phase 2 → Tests)

### Logger (`packages/core/src/logger.ts`)

Phase 0 §3.2.1: `createLogger(prefix, envVar)` 工厂。分层 env var：模块 env > 全局 env > 默认 warn。

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| LG-01 | `should_output_debug_when_env_set_to_debug` | 设置 `AGENT_PLATFORM_LOG=debug`，debug/info/warn/error 全部输出 | Unit |
| LG-02 | `should_suppress_debug_when_env_set_to_warn` | 设置 `AGENT_PLATFORM_LOG=warn`，debug/info 不输出 | Unit |
| LG-03 | `should_use_module_env_over_global_env` | 模块 env `WORKFLOW_LOG=error` 优先于 `AGENT_PLATFORM_LOG=debug` | Unit |
| LG-04 | `should_fallback_to_global_env_when_module_env_unset` | 无模块 env，使用 `AGENT_PLATFORM_LOG=info` | Unit |
| LG-05 | `should_default_to_warn_when_no_env_set` | 无任何 env，只输出 warn/error | Unit |
| LG-06 | `should_prefix_with_module_name` | `createLogger('workflow', ...)` 输出前缀 `[workflow:debug]` | Unit |
| LG-07 | `should_output_to_stderr_not_stdout` | 所有日志写入 stderr，不污染 stdout | Unit |
| LG-08 | `should_handle_unknown_level_gracefully` | env 设为 `foo`，回退到 warn | Unit |
| LG-09 | `should_not_interfere_between_independent_loggers` | 两个不同 prefix 的 logger 互不影响 | Unit |
| LG-10 | `should_preserve_backward_compat_with_ARISTOTLE_LOG` | 设置 `ARISTOTLE_LOG=debug`，Aristotle 模块 logger 仍输出 debug | Unit |
| LG-11 | `should_treat_empty_string_env_as_unsets` | `AGENT_PLATFORM_LOG=` (空字符串) 回退到 warn。要求设计用 `||` 而非 `??`（`??` 不跳过空字符串） | Unit |

### Utils (`packages/core/src/utils.ts`)

Phase 0 §3.2.2: `extractLastAssistantText` sentinel 改为可选参数，默认值保持 `[ARISTOTLE_BRIDGE:no_text_output]`。

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| UT-01 | `should_extract_text_from_info_parts_format` | 从 assistant 消息提取文本 | Unit (migrated) |
| UT-02 | `should_skip_pure_tool_call_messages` | 无 text part 返回 sentinel | Unit (migrated) |
| UT-03 | `should_return_sentinel_when_no_assistant_text` | 无 assistant 消息返回 sentinel | Unit (migrated) |
| UT-04 | `should_find_last_assistant_with_text` | 多条 assistant 消息取最后一条 | Unit (migrated) |
| UT-05 | `should_skip_assistant_message_with_empty_parts` | parts 为空跳过 | Unit (migrated) |
| UT-06 | `should_join_multiple_text_parts_with_newline` | 多 text part 用 `\n` 连接 | Unit (migrated) |
| UT-07 | `should_skip_assistant_message_with_whitespace_only_text` | 纯空白文本返回 sentinel | Unit (migrated) |
| UT-08 | `should_use_custom_sentinel_when_provided` | 传入自定义 sentinel `'CUSTOM'`，无文本时返回 `'CUSTOM'` | Unit (new) |
| UT-09 | `should_use_default_sentinel_when_not_provided` | 不传 sentinel，使用默认 `[ARISTOTLE_BRIDGE:no_text_output]` | Unit (new) |
| UT-10 | `should_allow_empty_string_sentinel` | 传入 `''` 作为 sentinel，无文本时返回空字符串 | Unit (new) |
| UT-11 | `should_handle_message_with_null_parts` | `msg.parts === null` 或 `undefined` 时跳过该消息不崩溃，返回 sentinel 或更早的有效文本 | Unit (new) |
| UT-12 | `should_handle_null_or_undefined_messages_array` | `extractLastAssistantText(null)` 或 `extractLastAssistantText(undefined)` 返回 sentinel 不崩溃 | Unit (new) |

### StateStore (`packages/core/src/store/state-store.ts`)

Phase 0 §3.2.5: 原子读写、JSONL 追加、key→路径映射。

继承自总 TestPlan P0-2（SS-01 到 SS-15），此处不再重复。

**补充**（§3.2.5 `list()` 方法在 P0-2 中未覆盖，需新增）：

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| SS-16 | `should_list_json_and_jsonl_files_matching_prefix` | `list("watchdog/proj1")` 返回目录下所有 `.json` 和 `.jsonl` 文件的 key | Unit (new) |
| SS-17 | `should_list_ignore_tmp_and_subdirs` | `list()` 忽略 `.tmp` 文件和子目录，只返回 `.json`/`.jsonl` | Unit (new) |
| SS-18 | `should_list_return_empty_for_nonexistent_dir` | 前缀目录不存在时返回 `[]` | Unit (new) |
| SS-19 | `should_list_treat_trailing_slash_as_idempotent` | `list("foo/")` 等同于 `list("foo")` | Unit (new) |
| SS-20 | `should_reject_path_traversal_in_key` | key 含 `../` 时抛错或返回空，不写入 baseDir 之外 | Unit (new) |
| SS-21 | `should_reject_path_traversal_in_list_prefix` | `list("foo/../../..")` 抛错或返回空，不遍历 baseDir 之外 | Unit (new) |
| SS-22 | `should_log_error_and_not_crash_on_write_failure` | `writeFileSync` 抛 EACCES → logger.error() → 不 throw（设计与测试对齐要求 try/catch） | Unit (new) |
| SS-23 | `should_log_error_and_not_crash_on_appendLog_failure` | `appendFileSync` 抛 EACCES/ENOSPC → logger.error() → 不 throw（DC-05 错误吞没对齐） | Unit (new) |

### WorkflowStore (`packages/core/src/store/workflow-store.ts`)

Phase 0 §3.2.3: 从旧代码提取，内部实现不变，logger prefix 变更。

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| WS-01–WS-45 | _(全部 45 个现有测试迁移)_ | 迁移自 `workflow-store.test.ts`，只改 import 路径和日志 prefix 断言 | Unit (migrated) |

**迁移注意事项**：
- 日志 prefix 断言：`[aristotle:...]` → `[workflow:...]`
- import 路径：`'../src/workflow-store.js'` → `'@opencode-ai/core/store/workflow-store'`
- 测试逻辑不变

### ConfigResolver (`packages/core/src/config.ts`)

Phase 0 §3.2.6: 通用 `createConfigResolver<T>()` 机制，返回 `ConfigResolver<T>` 对象。

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| CR-01 | `should_resolve_from_file_first` | 配置文件值 > env var > default | Unit |
| CR-02 | `should_resolve_from_env_when_no_file` | 无文件时从 env var 读取 | Unit |
| CR-03 | `should_resolve_from_default_when_nothing_set` | 无文件无 env 时使用 default | Unit |
| CR-04 | `should_cache_result_after_first_resolve` | 第二次 `resolve()` 返回缓存 | Unit |
| CR-05 | `should_clear_cache_and_re_resolve` | `clearCache()` 后重新解析 | Unit |
| CR-06 | `should_handle_null_config_path` | `configPath` 返回 null 时跳过文件 | Unit |
| CR-07 | `should_handle_corrupted_config_file` | 配置文件 JSON 损坏时 fallback | Unit |
| CR-08 | `should_support_generic_type` | 用自定义 interface 验证泛化能力 | Unit |
| CR-09 | `should_invalidate_cache_on_resolver_error` | resolver 抛异常时 cache 置 null，不返回部分结果 | Unit |
| CR-10 | `should_handle_missing_env_var_gracefully` | envMappings 引用不存在的 env var，envVal 为 undefined | Unit |
| CR-11 | `should_respect_field_order_with_cross_field_dep` | `mcp_dir` resolver 通过 `configResolver.resolve().sessions_dir` 读取已解析值 | Unit |
| CR-12 | `should_not_recurse_infinitely_on_cross_field` | eager cache allocation 保证递归安全 | Unit |
| CR-13 | `should_resolve_successfully_after_error_recovery` | resolver 抛异常 → cache null → 修复 env → 再次 resolve 成功 | Unit |
| CR-14 | `should_treat_empty_string_env_as_falsy` | env var 设为 `''` 空字符串时走 `||` fallback 链，不当作有效值 | Unit |

### SessionExtractor (`packages/core/src/session/extractor.ts`)

Phase 0 §3.2.7: 通用 session 数据读取，角色过滤、截断、自定义文件名。

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| SE-01 | `should_extract_messages_from_session` | 调用 client.session.messages 并返回结构化结果 | Unit |
| SE-02 | `should_filter_by_roles` | `options.roles = ['assistant']` 只返回 assistant 消息 | Unit |
| SE-03 | `should_apply_limit` | `options.limit = 10` 只返回前 10 条 | Unit |
| SE-04 | `should_truncate_content_to_max_length` | `options.maxContentLength = 100` 截断长文本 | Unit |
| SE-05 | `should_apply_custom_transform` | `options.transform` 函数应用于每条消息 | Unit |
| SE-06 | `should_use_key_as_filename_suffix` | `isCached(sid, 'workflow-1')` 检查 `{sid}_workflow-1.json` | Unit |
| SE-07 | `should_use_default_filename_when_no_key` | `isCached(sid)` 检查 `{sid}.json` | Unit |
| SE-08 | `should_return_extracted_at_timestamp` | 返回的 `extractedAt` 是 ISO 8601 格式 | Unit |
| SE-09 | `should_handle_empty_session` | session 无消息时返回空 messages 数组 | Unit |
| SE-10 | `should_return_cached_data_without_api_call` | 已有缓存文件时 `extract()` 跳过 API 调用，直接返回缓存数据 | Unit |
| SE-11 | `should_handle_undefined_baseDir_gracefully` | 无 baseDir 时 `isCached`/`cachePath` 返回 null/false，不崩溃 | Unit |
| SE-12 | `should_refetch_when_cache_file_corrupted` | 缓存文件存在但 JSON 损坏时跳过缓存，重新调用 API | Unit |
| SE-13 | `should_enforce_200_message_hard_limit_on_double_execution` | `limit: 200` 传入 core extractor 后，即使 API 返回 >200 条消息，结果也应截断为 200 条（SC-04：snapshot-extractor.ts:21-32 隐含契约） | Unit |

**注意**：core SessionExtractor 返回 `{ messages, sessionId, extractedAt }`（原始数据），不负责业务格式化。`isCached`/`cachePath` 提供缓存查询能力，`extract()` 在缓存命中时跳过 API 调用。文件写入由 Aristotle 包装层 (SnapshotExtractor) 处理。

### Executor Core (`packages/core/src/executor/index.ts`)

Phase 0 §3.2.8: 纯 sub-session 创建 + promptAsync。

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| EX-01 | `should_create_session_promptAsync_and_return_running` | 创建 session + promptAsync，返回 `{ sessionId, status: 'running' }` | Unit (split) |
| EX-02 | `should_return_error_when_session_create_fails` | client.session.create 抛异常 → try/catch → 返回 `{ status: 'error' }` | Unit (split) |
| EX-03 | `should_abort_and_return_error_when_promptAsync_fails` | client.session.promptAsync 抛异常 → abort session → 返回 `{ status: 'error' }`（不含 store.markError，那是 Aristotle 层的） | Unit (split) |
| EX-04 | `should_invoke_onSessionCreated_callback_before_promptAsync` | `onSessionCreated(sessionId)` 回调在 promptAsync 之前调用，用于 crash-safety pre-registration（DC-02） | Unit (split) |

### Plugin Registration (`packages/core/src/plugin/registration.ts`)

Phase 0 §3.2.9: RoleRegistration 接口 + assemblePlugin。

继承自总 TestPlan P0-3（PR-01 到 PR-13），此处不再重复。

**补充**（Phase 0 设计中新增的验证点）：

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| PR-14 | `should_return_empty_object_when_all_roles_null` | `assemblePlugin(ctx, [null, null])` 返回 `{}` | Unit |
| PR-15 | `should_unwrap_event_event_before_dispatching_idle` | `event.event ?? event` 解包后传给 onIdle | Unit |
| PR-16 | `should_pass_ctx_client_to_onIdle` | onIdle 收到 `ctx.client` 作为第二参数 | Unit |
| PR-17 | `should_return_empty_object_when_roles_array_empty` | `assemblePlugin(ctx, [])` 返回 `{}`（与 `[null, null]` 不同的空路径） | Unit |
| PR-18 | `should_filter_undefined_in_roles_array` | `assemblePlugin(ctx, [undefined])` 不崩溃，过滤 undefined 等价于 `[]` | Unit |

---

## Aristotle Role Tests

### Config (`packages/reflection/test/config.ts`)

14 个现有测试。idle-handler.test.ts 中的 3 个 detectMcpDir 测试是 config.test.ts 测试的**重复**（相同函数、相同断言逻辑），迁移时从 idle-handler **删除**而非**新增**到 config。

| ID | Test Name | Source | Type |
|----|-----------|--------|------|
| AC-01 | `should read config from file` | config.test.ts:39 | Unit (migrated) |
| AC-02 | `should use env vars when no config file exists` | config.test.ts:54 | Unit (migrated) |
| AC-03 | `should prefer config file over env vars` | config.test.ts:65 | Unit (migrated) |
| AC-04 | `should fallback to defaults when no config and no env vars` | config.test.ts:82 | Unit (migrated) |
| AC-05 | `should walk up from sessions dir and find pyproject.toml + aristotle_mcp` | config.test.ts:90 | Unit (migrated) |
| AC-06 | `should detect sibling aristotle dir` | config.test.ts:109 | Unit (migrated) |
| AC-07 | `should fallback to default when nothing is found` | config.test.ts:145 | Unit (migrated) |
| AC-08 | `should use ARISTOTLE_PROJECT_DIR env fallback` | config.test.ts:128 | Unit (migrated) |
| AC-09 | `should cache config and clear cache on demand` | config.test.ts:154 | Unit (migrated) |
| AC-10 | `should fallback gracefully when config file is corrupted` | config.test.ts:179 | Unit (migrated) |
| AC-11 | `should fallback gracefully when readFileSync throws` | config.test.ts:190 | Unit (migrated) |
| AC-12 | `should use ARISTOTLE_CONFIG env var as config file path` | config.test.ts:205 | Unit (migrated) |
| AC-13 | `should warn when ARISTOTLE_CONFIG points to nonexistent file` | config.test.ts:222 | Unit (migrated) |
| AC-14 | `should auto-detect sessions_dir when config only has mcp_dir` | config.test.ts:237 | Unit (migrated) |
| AC-15 | `should clearConfigCache_reexport_works_standalone` | 验证 `clearConfigCache()` 独立调用不丢失 `this`，正确清除缓存 | Unit (new) |

**迁移注意**：`clearConfigCache` 改为 re-export `() => configResolver.clearCache()`（箭头函数包装，避免 `this` 绑定丢失）。现有测试调用 `clearConfigCache()` 无参数的行为保持一致。需新增测试验证 re-export 的独立调用（AC-15）。

### Idle-handler (`packages/reflection/test/idle-handler.test.ts`)

41 个测试（44 - 3 个 detectMcpDir 重复删除）。

**分类：机械性改造**（非纯迁移）。构造函数签名从 `(client, store, executor, sessionsDir)` 变为 `(client, store, executor, { sessionsDir, mcpDir })`。全部 41 个测试的构造调用需改为 options 对象形式，但断言逻辑不变。

### Executor aristotle (`packages/reflection/test/executor.test.ts`)

**分类：拆分重写**（非纯迁移）。12 个测试针对新 `AristotleExecutor` 类编写。`AristotleExecutor` 是包装层：委托 sub-session 创建给 core `AsyncTaskExecutor`，自己管快照注入和 WorkflowStore 注册。测试需 mock `core.AsyncTaskExecutor` + `SnapshotExtractor` + `WorkflowStore`，验证包装逻辑正确。

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| AE-01 | `should_extract_snapshot_when_targetSessionId` | 快照注入逻辑 | Unit (rewrite) |
| AE-02 | `should_reuse_snapshot_when_exists_for_this_workflow` | 快照复用逻辑 | Unit (rewrite) |
| AE-03 | `should_continue_launch_when_snapshot_extraction_fails` | 快照提取容错 | Unit (rewrite) |
| AE-04 | `should_skip_snapshot_when_no_target_session_id` | 快照条件跳过 | Unit (rewrite) |
| AE-05 | `should_reject_and_abort_session_when_store_full` | WorkflowStore 容量检查 | Unit (rewrite) |
| AE-06 | `should_map_snake_case_params_to_camel_case_launch_args` | Aristotle 专属参数映射 | Unit (rewrite) |
| AE-07 | `should_default_agent_to_R_when_not_provided` | Aristotle R/C 链默认值 | Unit (rewrite) |
| AE-08 | `should_register_to_store_before_promptAsync` | WorkflowStore 注册时序 | Unit (rewrite) |
| AE-09 | `should_overwrite_existing_workflow_on_re_register` | WorkflowStore 重复注册 | Unit (rewrite) |
| AE-10 | `should_return_error_when_core_launch_fails` | core `AsyncTaskExecutor.launch()` 返回 `{ status: 'error' }` → AristotleExecutor 传播错误到 tool 层，不 throw | Unit (rewrite) |
| AE-11 | `should_default_target_session_id_to_context_sessionID` | 无 target_session_id 时使用 tool context 的 sessionID | Unit (rewrite) |
| AE-12 | `should_pass_resolved_mcpDir_to_idle_handler` | 验证 `config.mcp_dir` 正确传入 `IdleEventHandler` 的 `options.mcpDir` | Unit (rewrite) |
| AE-13 | `should_abort_session_when_store_register_fails` | `store.register()` 抛异常时 rollback（abort session），返回 `{ status: 'error' }`（SC-01：executor.ts:59-78 隐含契约） | Unit (rewrite) |
| AE-14 | `should_not_block_launch_when_snapshot_extraction_times_out` | 快照提取超时（10s）不阻塞 launch，继续执行（SC-02：executor.ts:26-32 隐含契约） | Unit (rewrite) |

### Snapshot-extractor aristotle (`packages/reflection/test/snapshot-extractor.test.ts`)

**分类：拆分重写**（非纯迁移）。12 个测试针对新 Aristotle `SnapshotExtractor` 包装层编写。包装层调用 core `SessionExtractor.extract()` 获取原始数据，再包装为 Aristotle 专有格式（`version`, `focus`, `source` 字段），使用 `StateStore` 做原子写文件。测试验证包装层正确添加格式字段、文件路径命名、原子写行为。

### Index/role entry (`packages/reflection/test/index.test.ts`)

**分类：拆分重写**（非纯迁移）。23 个测试针对 `createAristotleRole()` 函数编写。旧测试调用 `AristotleBridgePlugin(ctx)` → `{ tool, event }`，新测试调用 `createAristotleRole(ctx)` → `RoleRegistration | null`。接口形状不同（`tool`→`tools`, 新增 `onIdle`），但行为等价。

**关键测试映射**：
- 旧 `should_return_empty_tools_when_promptAsync_unavailable` → 新 `should_return_null_when_api_probe_fails`（`createAristotleRole` 返回 null）
- 旧 `should_create_bridge_active_marker_on_startup` → 新测试验证 marker 创建在 `createAristotleRole` 内
- 旧 tool dispatch 测试 → 由 `assemblePlugin` + `createAristotleRole` 组合后的 plugin 对象验证

### Tools (`packages/reflection/src/tools.ts`)

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| TL-01 | `should_fire_o_create_session_and_return_workflow_id` | `aristotle_fire_o` 创建 session + 返回 workflow_id | Unit (new) |
| TL-02 | `should_fire_o_reject_when_store_full` | store 已满时拒绝新 workflow | Unit (new) |
| TL-03 | `should_check_return_status_for_existing_workflow` | `aristotle_check` 返回 workflow 状态 | Unit (new) |
| TL-04 | `should_check_return_not_found_for_unknown_workflow` | `aristotle_check` 对不存在的 workflow 返回 not_found | Unit (new) |
| TL-05 | `should_abort_cancel_running_workflow` | `aristotle_abort` 取消 running 状态的 workflow | Unit (new) |
| TL-06 | `should_abort_handle_chain_pending_specially` | `aristotle_abort` 对 chain_pending 有独立处理逻辑 | Unit (new) |
| TL-07 | `should_abort_skip_non_running_workflows` | 已完成/已取消的 workflow 不再 abort | Unit (new) |
| TL-08 | `should_abort_return_error_for_unknown_workflow` | `store.findByWorkflowId` 返回 undefined，返回 `{ error: 'Workflow not found' }` | Unit (new) |
| TL-09 | `should_abort_return_chain_broken_without_cancelling` | `chain_broken` 状态返回 `{ status: 'chain_broken', error }` 不调用 cancel | Unit (new) |
| TL-10 | `should_abort_succeed_even_if_session_abort_fails` | session abort API 抛异常，store.cancel 仍调用，返回 cancelled | Unit (new) |

---

## Plugin Smoke Test (Phase 0)

### Plugin Entry (`plugin/test/index.test.ts`)

| ID | Test Name | Description | Type |
|----|-----------|-------------|------|
| PS-01 | `should_call_assemblePlugin_with_aristotle_role` | Mock `createAristotleRole` 返回 RoleRegistration，验证 `assemblePlugin` 被正确调用 | Unit (new) |

---

继承自总 TestPlan P0-4，Phase 0 scope：

| Assert ID | What it checks | How |
|-----------|---------------|-----|
| SA-03 | `packages/core` does not import from `packages/aristotle` or `packages/watchdog` | grep both patterns in core src returns empty |
| SA-04 | `packages/core` is listed as dependency in aristotle `package.json` | Check `packages/reflection/package.json` contains `"@opencode-ai/core"` |
| SA-05 | Monorepo workspace config lists all packages | root `package.json` lists workspaces |

---

## Migration Verification Protocol

### Pre-migration Baseline (Step 0)

```
vitest run --reporter=verbose plugins/aristotle-bridge/test/ 2>&1 | tee baseline-vitest.txt
```

### Post-migration Diff Check (Step 14)

**纯迁移文件**（只允许 import 路径变更）：
- workflow-store.test.ts、utils.test.ts、api-probe.test.ts、config.test.ts(aristotle)

每个纯迁移测试文件与原始文件 diff，确认：
- ✅ `import` 路径变更
- ✅ 日志 prefix 断言变更（workflow-store only）
- ❌ 无任何断言逻辑修改
- ❌ 无任何 `expect` 值修改
- ❌ 无任何 `describe`/`it` 结构修改

**机械性改造文件**（import 路径 + 构造函数签名变更）：
- idle-handler.test.ts：构造调用从 `(client, store, executor, sessionsDir)` → `(client, store, executor, { sessionsDir, mcpDir })`
- 允许：import 路径 + 构造函数参数格式变更
- 不允许：断言逻辑、expect 值、describe/it 结构变更

**拆分重写文件**（接口变化，测试针对新接口重写）：
- executor.test.ts：旧 `AsyncTaskExecutor` 拆分为 core `AsyncTaskExecutor` + aristotle `AristotleExecutor`
- snapshot-extractor.test.ts：旧 `SnapshotExtractor` 拆分为 core `SessionExtractor` + aristotle 包装层
- index.test.ts：旧 `AristotleBridgePlugin(ctx)` → 新 `createAristotleRole(ctx)`，接口形状完全不同
- **验证方式**：逐行为比较新旧测试覆盖的**行为分支**，确认每个旧测试的分支在新测试中有等价覆盖

### Interface Shape Verification (Step 14)

```typescript
// 比较新旧 plugin 导出形状
const oldPlugin = await import('plugins/aristotle-bridge/src/index.ts')
const newPlugin = assemblePlugin(ctx, [await createAristotleRole(ctx)])

assert(Object.keys(oldPlugin.tool).length === Object.keys(newPlugin.tool).length)
assert(Object.keys(oldPlugin.tool).every(k => k in newPlugin.tool))
assert(typeof oldPlugin.event === typeof newPlugin.event)
```

---

## Test Data & Mocks

### Shared Mock Patterns

```typescript
// Mock OpenCode client
const mockClient = {
  session: {
    create: vi.fn(),
    promptAsync: vi.fn(),
    abort: vi.fn(),
    messages: vi.fn(),
  },
}

// Mock config environment
function withEnv(vars: Record<string, string>, fn: () => void) {
  const original = { ...process.env }
  Object.assign(process.env, vars)
  try { fn() } finally { process.env = original }
}
```

### Test Isolation

- 所有 StateStore/WorkflowStore 测试使用 `os.tmpdir()` 隔离目录
- 每个测试用 `beforeEach` 创建新临时目录，`afterEach` 清理
- ConfigResolver 测试每个用例调用 `clearCache()`
- Logger 测试每个用例重置 process.env

---

## Dependencies Between Tests

**无测试间依赖。** 每个测试独立运行。

执行顺序约束：
- StateStore 测试可以全部并行（每个测试用独立临时目录）
- ConfigResolver 测试需要串行（共享 process.env，但有 clearCache 隔离）
- 迁移测试需要等对应模块实现完成后才能运行

---

## Edge Cases & Error Paths

| Category | Module | Scenario |
|----------|--------|----------|
| Crash recovery | StateStore | `.tmp` 文件残留（SS-08, SS-09） |
| Disk failure | StateStore | writeFileSync EACCES（SS-15） |
| Corrupted data | StateStore | 损坏 JSON 文件（SS-14） |
| Path traversal | StateStore | key 含 `../`（SS-20）、list prefix 含 `../`（SS-21） |
| Cache invalidation | ConfigResolver | resolver 抛异常后 cache 清空（CR-09） |
| Recursion safety | ConfigResolver | 跨字段依赖递归调用（CR-12） |
| Empty env var | ConfigResolver | env 设为空字符串走 fallback（CR-14） |
| Empty env var | Logger | env 设为空字符串回退 warn（LG-11） |
| Null parts | Utils | `msg.parts === null/undefined` 不崩溃（UT-11） |
| Empty input | SessionExtractor | session 无消息（SE-09）、undefined baseDir（SE-11） |
| Null role | PluginRegistration | 全 null 角色列表（PR-14）、undefined 角色（PR-18） |
| Event unwrapping | PluginRegistration | `event.event ?? event` 解包（PR-15） |
| Handler error | PluginRegistration | onToolBefore/onIdle 抛异常（PR-10, PR-12） |
| Abort states | Tools | chain_pending vs running 处理差异（TL-06） |
| Abort recovery | Tools | chain_broken 不调用 cancel（TL-09）、abort API 失败仍成功（TL-10） |
| This binding | Config aristotle | clearConfigCache re-export 独立调用不丢失 this（AC-15） |
| Null messages array | Utils | `extractLastAssistantText(null/undefined)` 不崩溃（UT-12） |
| Write error | StateStore | writeFileSync 失败不 throw（SS-22 + DC-05） |
| Corrupted cache | SessionExtractor | 缓存文件损坏时重新 API 调用（SE-12 + DC-06） |
| Core launch fail | Executor aristotle | core launch 返回 error → AristotleExecutor 传播不 throw（AE-10） |
| Crash safety | Executor aristotle | store.register 必须在 promptAsync 前（DC-02） |
| Callback timing | Executor core | onSessionCreated 在 promptAsync 前调用（EX-04） |
| Register rollback | Executor aristotle | store.register 失败时 abort session（AE-13） |
| Snapshot timeout | Executor aristotle | 快照提取超时不阻塞 launch（AE-14） |
| Append failure | StateStore | appendFileSync 失败不 throw（SS-23 + DC-05） |
| Message cap | SessionExtractor | 200 消息硬上限双重执行（SE-13） |

---

## Priority Downgrade Justifications

无。Phase 0 所有模块都是 key priority（核心提取的每个模块都需要完整测试覆盖）。

---

## Acceptance Criteria

Phase 0 Gate Pass 条件（全部 AND）：

1. **Core 新测试**：packages/core/ 下全部 145 新测试通过
2. **Aristotle 测试**：packages/reflection/ 下全部 115 测试通过（14 纯迁移 + 41 机械改造 + 35 拆分重写 + 14 executor 重写 + 1 new config re-export + 10 new tools）3. **Static assertions**：SA-03, SA-04, SA-05 通过
4. **Plugin smoke test**：PS-01 通过
5. **行为等价验证**：每个旧测试的行为分支在新测试中有等价覆盖（见 Migration Verification Protocol）
6. **Interface shape**：`assemblePlugin(ctx, [createAristotleRole(ctx)])` 产出的 plugin 对象与旧 plugin 导出逐字段一致
7. **External tests**：pytest (~390) + static (103) + regression (64) + e2e (2) 全部通过
8. **Build**：`bun build plugin/index.ts` → `dist/index.js`
9. **Smoke test**：OpenCode 加载新插件，Aristotle 功能正常

---

## Required Design Corrections (v3.5 → v3.6) — ✅ Applied

以下问题由 Oracle-K26 第三次审核发现，已同步修正技术设计文档至 v3.6：

| ID | 问题 | 设计修正 |
|----|------|----------|
| DC-01 | Core executor `launch()` 应 try/catch 错误并返回 `{ status: 'error' }`，不是 throw | §3.2.8 添加 try/catch + error 返回 |
| DC-02 | `store.register()` 必须在 `promptAsync` **之前**调用（crash-safety） | §3.2.8 Core executor 接受 `onSessionCreated?: (sessionId: string) => void` 回调，Aristotle 用它做 pre-promptAsync 注册 |
| DC-03 | Logger `??` 应改为 `||`（空字符串 env var 处理） | §3.2.1 `process.env[envVar] \|\| process.env.AGENT_PLATFORM_LOG \|\| 'warn'` |
| DC-04 | ConfigResolver 字段排序依赖需文档化 | §3.2.6 添加约束说明：跨字段依赖的字段必须列在被依赖字段之后 |
| DC-05 | StateStore `write()`/`appendLog()` 需要 try/catch 错误吞没 | §3.2.5 添加错误处理：write/appendLog 失败时 `logger.error()` 不 throw |
| DC-06 | SessionExtractor 损坏缓存文件行为 | §3.2.7 `extract()` 遇损坏缓存时跳过缓存，重新调用 API |

---

## Review History

### Round 1 (v1.0 → v1.1)

**Reviewer**: oracle-ds4f (independent)
**Result**: REVISION_NEEDED → All findings accepted and applied

| Finding | Severity | Description | Resolution |
|---------|----------|-------------|------------|
| C-01 | Critical | Config aristotle 计数错误（14+3=17），3 个 idle-handler detectMcpDir 测试是 config.test.ts 的重复，应删除非新增 | ✅ 改为 14，修正来源引用为 config.test.ts |
| C-02 | Critical | Plugin Registration 计数错误（13），应为 17（13 继承 + 3 补充 + 1 空数组） | ✅ 改为 17，新增 PR-17 |
| M-01 | Major | Static assertions 计数错误（5），Phase 0 scope 只有 SA-03/04/05 = 3 | ✅ 改为 3 |
| M-02 | Major | Acceptance criteria 子计数错误 | ✅ 更新为 Core ~128 / Aristotle ~109 |
| M-03 | Major | 缺少 assemblePlugin(ctx, []) 空数组测试 | ✅ 新增 PR-17 |
| M-04 | Major | TL 缺少 chain_broken 和 abort-fails 分支测试 | ✅ 新增 TL-09, TL-10 |
| M-05 | Major | 缺少 plugin/index.ts 冒烟测试 | ✅ 新增 PS-01 |
| L-01 | Minor | 总计偏差（~241 基于错误分布，修正后仍 ~241） | ✅ 保持 ~241 |
| L-02 | Minor | AC-06/07/08 来源标注为 idle-handler，实际应为 config.test.ts | ✅ 修正来源 |
| L-03 | Minor | SessionExtractor 缺少缓存命中测试 | ✅ 新增 SE-10 |
| L-04 | Minor | CR-09 缺少错误恢复后重试测试 | ✅ 新增 CR-13 |

### Round 2 (v1.1 → v1.2)

**Reviewer**: oracle-ds4f (independent)
**Result**: REVISION_NEEDED → All findings accepted and applied

| Finding | Severity | Description | Resolution |
|---------|----------|-------------|------------|
| M-01 | Major | TL-08 描述不准确（"workflowIds" 批量），abort 工具只接受单个 `workflow_id` | ✅ TL-08 重定义为 not-found 测试 |
| M-02 | Major | 缺少 `aristotle_abort` 对未知 workflow 返回 `{ error: 'Workflow not found' }` 的测试 | ✅ TL-08 重定义覆盖此分支 |

### Round 4 (v1.2 → v1.3) — Oracle-K26 Independent Review

**Reviewer**: oracle-K26 (independent, different model)
**Result**: REVISION_NEEDED → All findings accepted and applied

| Finding | Severity | Description | Resolution |
|---------|----------|-------------|------------|
| C-01 | Critical | StateStore `list()` 方法零测试覆盖（P0-2 SS-01~15 未覆盖 list） | ✅ 新增 SS-16~19（4 个 list 测试） |
| M-01 | Major | 跨文档不一致：Phase 0 设计 §Step 12 仍写 "config.test.ts（17 个测试）"应为 14 | ✅ 标注为跨文档修正项（需同步更新 Phase0-Core-Extraction.md） |
| M-02 | Major | executor.test.ts 拆分违反"diff 只改 import"原则（EX-01 测试内容必须变） | ✅ 迁移验证协议新增例外说明 |
| L-01 | Minor | grep 误报细节未文档化（emit('exit') 匹配 it(') | ✅ 已知，不影响计数 |
| L-02 | Minor | `shouldLog` 原语未直接测试（LG-08 间接覆盖） | 接受为已知限制 |

**跨文档修正提醒**：Phase0-Core-Extraction.md §Step 12 行 `config.test.ts（17 个测试）` 应修正为 `config.test.ts（14 个测试）`。已在 v3.4 中修正。§Step 4 和 Verification Checklist 的 SS-01~15 已修正为 SS-01~19。

### Round 5 (v1.3 → v1.4) — Oracle Verification of K26 Fixes

**Reviewer**: oracle (same model, fresh session)
**Result**: REVISION_NEEDED → All findings accepted and applied

| Finding | Severity | Description | Resolution |
|---------|----------|-------------|------------|
| M-01 | Major | 设计文档 Step 4 和 Verification Checklist 仍写 SS-01~15（应为 SS-01~19） | ✅ Phase0-Core-Extraction.md 已修正（Step 4 + Checklist + PR 范围） |
| L-01 | Minor | TestPlan line 6 引用 v3.3（设计文档已升至 v3.4） | ✅ 更新为 v3.4 |

### Round 7 (v1.4 → v2.0) — Oracle-K26 Second Independent Review

**Reviewer**: Oracle-K26 (same model, fresh session, deeper analysis)
**Result**: REVISION_NEEDED → Major framework revision

**框架性问题**（改变测试分类体系）：

| Finding | Severity | Description | Resolution |
|---------|----------|-------------|------------|
| C-01 | Critical | `clearConfigCache` re-export `this` 绑定丢失陷阱 | ✅ 设计改为箭头函数包装 + 新增 AC-15 |
| C-02 | Critical | EX-03 也违反 diff-only 规则（`store.markError` 断言） | ✅ 迁移协议拆分为三类（纯迁移/机械改造/拆分重写） |
| C-03 | Critical | idle-handler 构造函数签名变更影响全部 41 个测试 | ✅ 归类为"机械性改造"，非纯迁移 |
| C-04 | Critical | `createAristotleRole` null-return 无映射测试 | ✅ index.test.ts 归类为"拆分重写"，新增 null-return 测试 |
| M-01 | Major | 23 index 测试是重写不是迁移（接口形状完全不同） | ✅ 全文修正分类体系 |
| M-02 | Major | AristotleExecutor 包装层无直接测试 | ✅ 新增 AE-01~09 拆分重写测试表 |
| M-03 | Major | SnapshotExtractor 包装层无直接测试 | ✅ 归类为拆分重写，明确测试目标 |
| M-04 | Major | StateStore key 路径遍历安全 | ✅ 新增 SS-20, SS-21 |
| M-05 | Major | `extractLastAssistantText` null parts 崩溃 | ✅ 新增 UT-11 |
| M-06 | Major | Logger 空字符串 env var = debug-all | ✅ 新增 LG-11 |
| M-07 | Major→Minor | `createAristotleRole` partial failure 资源泄漏 | 降级为 Minor（旧代码同样问题） |
| M-08 | Major | Acceptance criterion "109 迁移" 措辞不准确 | ✅ 修正分类说明 |
| L-01 | Minor | SessionExtractor undefined baseDir 行为未指定 | ✅ 新增 SE-11 |
| L-02 | Minor | StateStore `list('')` 行为未指定 | SS-20 隐含覆盖 |
| L-03 | Minor | `extractLastAssistantText(null)` 崩溃 | UT-11 扩展覆盖 |
| L-04 | Minor | ConfigResolver empty-string env vs undefined | ✅ 新增 CR-14 |
| L-05 | Minor | `assemblePlugin` undefined in roles array | ✅ 新增 PR-18 |

**总计新增测试**：+LG-11, +UT-11, +SS-20/21, +CR-14, +SE-11, +PR-18, +AC-15 = 8 个新测试
**总计数变更**：245 → 253（+8）

### Round 10 (v2.1 → v2.2) — Oracle-K26 Third Review

**Reviewer**: Oracle-K26 (third independent review, source-code verified)
**Result**: REVISION_NEEDED → All findings accepted

**设计级问题**（需同步修正技术设计 v3.5→v3.6）：

| Finding | Severity | Description | Resolution |
|---------|----------|-------------|------------|
| C-01 | Critical | Core executor 错误处理语义矛盾：设计无 try/catch 但测试期望 return error | ✅ DC-01：设计修正 core executor try/catch |
| C-02 | Critical | **Crash-safety regression**：store.register 从 promptAsync 前移到后 | ✅ DC-02：设计新增 `onSessionCreated` 回调 |
| C-03 | Critical | Logger `??` 不跳过空字符串，与 LG-11 测试矛盾 | ✅ DC-03：设计改 `??` 为 `||` |
| C-04 | Critical | ConfigResolver 字段排序依赖未文档化 | ✅ DC-04：设计添加排序约束说明 |
| M-01 | Major | AristotleExecutor 错误传播链断裂（throw vs return） | ✅ AE-10 新增 core launch 失败传播测试 |
| M-02 | Major | `target_session_id` 默认值 Tools 测试缺失 | ✅ AE-11 新增 |
| M-03 | Major | `extractLastAssistantText(null)` 实际未覆盖 | ✅ UT-12 新增 |
| M-04 | Major | `mcpDir` 注入路径未显式测试 | ✅ AE-12 新增 |
| M-05 | Major | StateStore SS-15 错误吞没设计与测试矛盾 | ✅ SS-22 新增 + DC-05 设计修正 |
| M-06 | Major | SessionExtractor 损坏缓存文件行为未指定 | ✅ SE-12 新增 + DC-06 设计修正 |

**源码验证结果**（全部确认）：
- executor.ts `store.markError`：✅ 确认在 promptAsync catch 中调用
- idle-handler.ts 构造函数：✅ 确认 4 位置参数，第 4 个是 sessionsDir
- snapshot-extractor.ts 原子写：✅ 确认 tmp+rename
- index.ts abort 分支：✅ 确认 6 个分支
- workflow-store.ts logger prefix：✅ 确认 `[aristotle:...]`
- executor.ts store.register 时序：✅ 确认在 promptAsync 之前（line 60-68，含注释 "crash safety"）

**总计新增测试**：+UT-12, +SS-22, +SE-12, +AE-10/11/12 = 6 个新测试
**总计数变更**：253 → 259（+6）

### Round 13 (v2.3 → v2.4) — Three-Dimension Parallel Review

**Reviewer**: Council (multi-model) + Oracle-K26 (DC verification) + Explorer (source-code contract scan)
**Result**: REVISION_NEEDED → All findings accepted

**维度 A：Council 设计-测试语义对齐**（doubao + GLM-4 + kimi-for-coding）：

| Finding | Severity | Description | Resolution |
|---------|----------|-------------|------------|
| C-01 | Major | `onSessionCreated` core 回调无直接测试 | ✅ 新增 EX-04 |
| M-01 | Minor | `appendLog()` 错误路径未测试 | ✅ 新增 SS-23 |
| M-02 | Minor | `ctx.config` 运行时覆盖无显式测试 | 接受为已知限制（通过 Index 间接覆盖） |
| I-01 | Info | 设计文本仍写 `??` | 已知，v3.6 修正 |
| I-02 | Info | `configPath` string 形式未测试 | 降级为 Info（Phase 0 不用） |

**维度 B：K26 DC-01~DC-06 验证**：

| DC | 状态 | 新缺口 |
|----|------|--------|
| DC-01 | ✅ 完整 | abort 也 throws 时未测 → 降级为 Info |
| DC-02 | ⚠️ 部分 | **core 级 `onSessionCreated` 无测试** → ✅ 新增 EX-04 |
| DC-03 | ✅ 完整 | — |
| DC-04 | ✅ 完整 | — |
| DC-05 | ⚠️ 部分 | **appendLog 错误路径未测** → ✅ 新增 SS-23 |
| DC-06 | ✅ 完整 | — |

**维度 C：Explorer 源码隐含契约扫描**（61 个隐含契约 → 筛选后 5 个 Phase 0 必须覆盖）：

| Finding | Source | Description | Resolution |
|---------|--------|-------------|------------|
| SC-01 | executor.ts:59-78 | `store.register` 失败时 rollback（abort session） | ✅ 新增 AE-13 |
| SC-02 | executor.ts:26-32 | 快照提取 10s 超时不阻塞 launch | ✅ 新增 AE-14 |
| SC-03 | executor.ts:70-78 | Store full 错误消息含 max 50 | 已有 AE-05，确认覆盖 |
| SC-04 | snapshot-extractor.ts:21-32 | 200 消息硬上限双重执行 | ✅ 新增 SE-13 |
| SC-05 | idle-handler.ts:291-292 | abort trigger 先删后处理（竞态防护） | 不新增（旧代码等同覆盖） |
| SC-06 | index.ts:124-130 | 非字符串 sessionID 静默跳过 | PR-13 已覆盖 |

**总计新增测试**：+EX-04, +SS-23, +AE-13, +AE-14, +SE-13 = 5 个新测试
**总计数变更**：259 → 264（+5）
