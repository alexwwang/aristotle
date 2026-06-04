# Interfaces & Type Registry — §3.0

**Version**: 1.46 | **Status**: Phase 1 target（当前代码库仅含基础架构）

## Related
- [00-overview.md](./00-overview.md) — 架构概览
- [02-phase1-observer.md](./02-phase1-observer.md) — Phase 1 实现
- [03-phase2-test-gate.md](./03-phase2-test-gate.md) — Phase 2 实现
- [adr.md](./adr.md) — 设计决策（含 severity vs FindingSeverity 语义区分 → [ADR-001](./adr.md)）
- [known-issues.md](./known-issues.md) — 已知限制
- [ref/interfaces-pseudocode.md](./ref/interfaces-pseudocode.md) — 伪代码参考

---

本节为所有接口和类型的**唯一真相源**。其他章节引用时标注 "→ §3.0.X"。

## §3.0.1 AuditLogEntry（schema.ts 扩展）

| 字段 | 类型 | 必填 | Phase | 说明 |
|------|------|------|-------|------|
| event | 见下方联合类型 | ✅ | P0/P1/P2/P3/P4 | 审计事件类型 |
| timestamp | string (ISO 8601) | ✅ | P0 | 调用方提供 `new Date().toISOString()` |
| runId | string | ✅ | P0 | 运行 ID |
| projectId | string | ✅ | P0 | 项目 ID |
| sessionId | string | ✅ | P0 | 会话 ID |
| decision | `'PASS' \| 'BLOCK' \| 'WARN'` | ✅ | P0 | 审计决策 |
| phase | number | ✅ | P0 | 触发时 pipeline phase |
| round | number | ❌ | P0 | Ralph 循环轮次 |
| severity | `'warn' \| 'block'` | ❌ | **P1** | 门控阻止级别（仅 Observer 条目） |
| violation | string | ❌ | P1 | 违规描述 |
| resolved | boolean | ❌ | P1 | 违规是否已解决 |
| resolvedAt | string | ❌ | P1 | 解决时间 ISO 8601 |
| evicted | boolean | ❌ | P1 | FIFO 淘汰标记 |
| force_resolved_reason | string | ❌ | P1 | 强制解决原因 |
| command | string | ❌ | P1 | normalizeCommand 后命令字符串 |
| tool | string | ❌ | P1 | 触发工具名 ('Bash'/'Write') |
| filePath | string | ❌ | P1 | 触发文件路径 |
| pass | number | ❌ | P2 | 测试通过数（TEST_RUN_COMPLETE 必填） |
| fail | number | ❌ | P2 | 测试失败数（TEST_RUN_COMPLETE 必填） |
| error_summary | string | ❌ | P2 | 错误摘要（TEST_RUN_COMPLETE 必填） |

**Event 联合类型扩展**：

| Phase | 新增事件 |
|-------|---------|
| P0（已有） | pipeline_start, pipeline_end, phase_complete, phase_failed, ralph_round_finding, ralph_loop_end, ralph_loop_exit, tdd_checkpoint, checkpoint_override, checkpoint_info + INTERCEPT + PROMPT_INJECTION_DETECTED |
| P1 | COMMAND_FAILED, SYNTAX_ERROR_POST_WRITE, OBSERVER_TIMEOUT, OBSERVER_TIMEOUT_DEGRADED, FILE_TOO_LARGE_FOR_CHECK, FORCE_RESOLVED, TIMEOUT_RESOLVED, DEGRADATION_MODE_ACTIVATED, AUDIT_ROTATION_LIMIT_EXCEEDED |
| P2 | TEST_RUN_REQUESTED, TEST_RUN_COMPLETE, RALPH_ROUNDS_EXCEEDED |
| P3 | REVIEWER_SPAWNED |
| P4 | resolve_timeout, force_resolve_violation, pipeline_reset（CheckpointEvent 扩展） |

### §3.0.1a Reviewer Finding Severity 映射

Phase 2 Reviewer 使用 M/H 级别评估 finding。映射关系：

| Reviewer 级别 | 审计行为 | 存储位置 |
|--------------|---------|---------|
| M（Medium） | severity='warn'，不阻止推进 | ralph_round_finding 审计条目 + RoundRecord.findings |
| H（High） | severity='block'，阻止推进 | ralph_round_finding 审计条目 + RoundRecord.findings |

M→H 升级判定：前轮 RoundRecord.findings 中 severity='M' 且 description 含 `[TEST_EVIDENCE]` 前缀的条目，若本轮 TEST_RUN_COMPLETE 仍不存在，升级为 H。

## §3.0.2 PipelineStore 新增方法

### appendAudit(projectId, runId, entry): void
同步方法。追加审计条目到当前 run 日志。→ [ADR-005](./adr.md)

### getUnresolvedViolations(projectId, runId, severity, filter?): Array<AuditLogEntry & { _sourceKey }>
查询未解决违规。severity: `'warn' | 'block'`。filter 支持 { tool?, filePath?, event?, commandPattern? } 组合（AND 语义）。

### resolveViolations(projectId, runId, timestamps): void
标记违规为已解决。timestamps 为 ISO 8601 字符串数组。

### getActiveRun(projectId): ActiveRun | null
返回当前活跃 run。

### §3.0.2a Auto-Resolve 匹配逻辑

auto-resolve 在 Observer.handle() 顶层执行（Promise.race 外），匹配规则：

| 当前成功操作 | 解析目标 | 匹配键 |
|-------------|---------|--------|
| Bash 成功（exit code = 0） | COMMAND_FAILED | (tool='Bash', command=normalizeCommand(currentCmd)) |
| Write 成功（语法检查通过） | SYNTAX_ERROR_POST_WRITE | (tool='Write', filePath=currentFilePath) |
| 任何成功 | OBSERVER_TIMEOUT | (event='OBSERVER_TIMEOUT') |

实现方式：getUnresolvedViolations → filter by tool/event/commandPattern → 提取 timestamps → resolveViolations。索引为内存 Map，key=(tool, event, command?)，value=timestamp 数组。

## §3.0.3 PipelineState & CheckpointHandler

### PipelineState 新增字段

| 字段 | 类型 | Phase | 说明 |
|------|------|-------|------|
| observerTimeoutCount | number | P1 | 连续超时计数器（≥3 降级） |
| auditEntryCount | number | P1 | 审计条目计数（FIFO 阈值检查） |
| evictionNeeded | boolean | P1 | FIFO 淘汰标记 |

### ActiveRun

| 字段 | 类型 | 说明 |
|------|------|------|
| runId | string | 运行 ID |
| projectId | string | 项目 ID |
| startedAt | string | checkpoint.ts setActiveRun 必填 |

### CheckpointGateResult

| 字段 | 类型 | 说明 |
|------|------|------|
| ok | boolean | 是否通过门控 |
| violation | string? | 未通过时的违规描述 |
| guidance | string? | 修复指导 |
| state | PipelineState | 更新后的状态 |

### CheckpointHandler

| 方法 | 签名 | 说明 |
|------|------|------|
| handle | (event: string, params?) → CheckpointGateResult | 处理 checkpoint 事件，返回门控结果 |
| validateTransition | (event: string, context: PipelineState) → boolean | 校验事件是否合法（transition table） |

### tdd_checkpoint 扩展签名

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| event | string | ✅ | CheckpointEvent 或 AuditEvent |
| test_result | { pass, fail, error_summary } | 仅 TEST_RUN_COMPLETE 时 | 测试结果。pass/fail 必须 ≥0 整数，NaN/Infinity/负数 → error |

### §3.0.3a P4 触发接口

| 事件 | 触发方式 | 参数 | 状态变更 |
|------|---------|------|---------|
| pipeline_reset | rollback_to_checkpoint 返回 pipeline_reset_required=true 时，Watchdog 自动调用 tdd_checkpoint('pipeline_reset') | 无 | 重置 PipelineState（清 observerTimeoutCount/auditEntryCount），回退到 phase 1 |
| force_resolve_violation | MCP 工具参数，Agent 手动调用 | violation timestamp | 标记违规强制解决，写入 force_resolved_reason |
| resolve_timeout | Checkpoint 幂等修正，发现 audit 显示已解决但 state 未更新时自动触发 | 无 | 修正 state 与审计一致 |

Fallback 链（pipeline_reset）：Watchdog Observer 检测 → 若 Watchdog 未运行则 MCP handler 直接触发 → 若均失败则下次 pipeline_start 时重置。

## §3.0.4 Observer Helpers（Phase 1 新文件：rule-config.ts）

| 函数 | 签名 | 说明 |
|------|------|------|
| extractExitCode | (output: string) → number | 解析 Bash 退出码。匹配 `exit code: N`，fallback=1（fail-safe） |
| quickSyntaxCheck | (content: string) → { ok, error? } | JSON 语法检查（Phase 1 仅 JSON/YAML） |
| yamlSyntaxCheck | (content: string) → { ok, error? } | YAML 安全模式检查（禁用 JS 特定类型） |
| matchPattern | (cmd, pattern) → boolean | glob 模式匹配 |
| normalizeCommand | (cmd: string) → string | 统一命令格式 |
| ObserverTimeoutError | extends Error | 超时错误类 |

## §3.0.5 Configuration Types

### RuleConfig

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 规则名 |
| severity | 'warn' \| 'block' | 门控级别 |
| enabled | boolean | 是否启用 |
| ignoreExitCodes | number[] | 忽略的退出码（COMMAND_RESULT_CHECK） |
| ignoreCommands | string[] | 忽略的命令 glob 模式（COMMAND_RESULT_CHECK） |
| maxFileSize | number | 文件大小上限字节（FILE_SIZE_CHECK） |
| extensions | string[] | 检查的文件扩展名（SYNTAX_CHECK） |
| slaSeconds | number | 检出时效阈值（TEST_EVIDENCE_CHECK） |
| maxRoundsBeforeUpgrade | number | M→H 升级前最大轮次数（TEST_EVIDENCE_CHECK） |

### Phase 1 规则

| 规则名 | severity | 检查内容 |
|--------|----------|---------|
| COMMAND_RESULT_CHECK | block | Bash exit code ≠ 0（ignoreExitCodes/ignoreCommands 白名单） |
| SYNTAX_CHECK | block | Write 后 JSON/YAML 语法验证 |
| FILE_SIZE_CHECK | block | Write 后文件大小 >100KB |

### Phase 2 规则

| 规则名 | severity | 检查内容 |
|--------|----------|---------|
| TEST_EVIDENCE_CHECK | block → warn(降级) | phase_complete 到业务代码阶段时必须有 TEST_RUN_COMPLETE。首次缺失去 M 级，连续轮次 M→H 升级 |

### RulesFile

| 字段 | 类型 | 说明 |
|------|------|------|
| version | number | 配置文件版本 |
| rules | RuleConfig[] | 规则列表 |

### RuleConfigLoader

| 方法 | 签名 | 说明 |
|------|------|------|
| load | () → RulesFile | 加载规则配置（带缓存） |
| invalidateCache | () → void | 清除缓存 |

## §3.0.6 MCP Tools（Phase 2+ 新增）

### read_audit_log

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| projectId | string | ✅ | 项目 ID |
| runId | string | ✅ | 运行 ID |
| filter | { event?, severity?, resolved?, limit? } | ❌ | 过滤条件 |
| 返回 | Array<AuditLogEntry> | | 匹配的审计条目列表（按 timestamp 倒序） |

## §3.0.7 McpAuditEntry（Phase 4 新增）

| 字段 | 类型 | 说明 |
|------|------|------|
| timestamp | string | ISO 8601 |
| tool | string | MCP 工具名 |
| params | object | 工具调用参数 |
| result | 'success' \| 'error' | 执行结果 |
| error | string? | 错误描述 |
| runId | string | 关联 Watchdog runId |
| truncated | boolean? | 截断标记 |

存储：`.aristotle/audit.jsonl`，append-only，4KB/行限制，error_summary 截断 500 字符。init_repo 时自动加 `.gitignore`。

## §3.0.8 Constants Registry

| 常量 | 当前值 | 目标值 | Phase | 说明 |
|------|--------|--------|-------|------|
| OBSERVER_TIMEOUT_MS | 20 | 20 | P1 | Observer 执行超时 |
| INTERCEPTOR_TIMEOUT_MS | — | 5 | P1 | Interceptor 超时 |
| CHECKPOINT_CHECK_TIMEOUT_MS | — | 50 | P1 | Checkpoint 检查超时 |
| REVIEWER_TIMEOUT_S | — | 60 | P1 | Reviewer 超时 |
| OBSERVER_DEGRADATION_THRESHOLD | — | ≥3 | P1 | 超时降级阈值 |
| MAX_AUDIT_ENTRIES | — | 5000 | P1 | 审计条目 FIFO 上限 |
| MAX_AUDIT_KEY_SIZE | — | 10MB | P1 | 审计 key 大小上限 |
| AUDIT_ROTATION_LIMIT | — | 10 | P1 | 审计日志轮转上限（key 数） |
| FILE_SIZE_CHECK_LIMIT | — | 100KB | P1 | 文件大小检查阈值 |
| MAX_RALPH_ROUNDS | 10 | 20 | P2 | Ralph 循环上限 |
| BUSINESS_CODE_PHASE | — | 5 | P2 | 业务代码阶段号 |
| TEST_EVIDENCE_SLA_S | — | 30-90 | P2 | 测试证据检出时效 |
| AUDIT_RETENTION_DAYS | — | 7 | P2+ | 审计日志归档保留天数 |
| MCP_TOOL_COUNT_CURRENT | 20 | 20 | — | 当前 MCP 工具数 |
| MCP_TOOL_COUNT_POST_MERGE | — | 25 | P4 | 合并后 MCP 工具数 |
| MCP_NEW_TOOLS_P4 | — | 5 | P4 | Phase 4 新增工具数 |
| MCP_AUDIT_JSONL_LINE_LIMIT | — | 4KB | P4 | 审计 JSONL 行大小限制 |
| ERROR_SUMMARY_TRUNCATION | — | 500 chars | P4 | error_summary 截断长度 |
| STASH_WARNING_THRESHOLD | — | 5 | P4 | stash 堆积告警阈值 |
| STASH_HARD_LIMIT | — | 10 | P4 | stash 硬上限 |
| STASH_CLEANUP_KEEP | — | 3 | P4 | 清理时保留数 |
| UNTRACKED_FILES_THRESHOLD | — | 100MB | P4 | 未追踪文件检查阈值 |
| SCHEMA_VERSION_TARGET | — | 5 | P3 | Schema 目标版本 |
| SEV_ORDER | — | S>B>A>H>M>L>P>I | P3 | Severity 优先级排序 |
| VALID_SEVERITIES | — | C,H,M,P,L,I,S,B,A | P3 | 合法 severity 集合 |

> 完整伪代码 → [ref/interfaces-pseudocode.md](./ref/interfaces-pseudocode.md)
