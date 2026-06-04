# Pseudocode Reference — §3.0 Interfaces

**Source**: quality-assurance-implementation-plan.md v1.46
**Purpose**: Implementation reference — not part of the technical plan spec.

## Code Block 1: L133-159
**Context**: `packages/watchdog/src/schema.ts` 扩展接口（Phase 1 目标）：

```typescript
interface AuditLogEntry {
  // ⚠️ Phase 1 target events — current schema.ts only has CheckpointEvent | 'INTERCEPT' | 'PROMPT_INJECTION_DETECTED'
  event: CheckpointEvent | 'INTERCEPT' | 'PROMPT_INJECTION_DETECTED' | 'COMMAND_FAILED' | 'SYNTAX_ERROR_POST_WRITE' | 'OBSERVER_TIMEOUT' | 'OBSERVER_TIMEOUT_DEGRADED' | 'FILE_TOO_LARGE_FOR_CHECK' | 'FORCE_RESOLVED' | 'TIMEOUT_RESOLVED' | 'DEGRADATION_MODE_ACTIVATED' | 'AUDIT_ROTATION_LIMIT_EXCEEDED' | 'REVIEWER_SPAWNED';  // Phase 3: REVIEWER_SPAWNED — Reviewer 派发事件（§3.3.1）。命名分区：CheckpointEvent 值保持 lowercase_with_underscore（历史遗留，如 pipeline_start、phase_complete），Observer/Checkpoint 生成的新审计事件统一使用 SCREAMING_SNAKE_CASE（如 COMMAND_FAILED、FORCE_RESOLVED）。CheckpointEvent 需同步扩展以包含 'resolve_timeout'、'force_resolve_violation' 和 'pipeline_reset'（§4.4 新增的 tdd_checkpoint 事件，pipeline_reset 为 Phase 4 占位）。TIMEOUT_RESOLVED 与 FORCE_RESOLVED 区分：TIMEOUT_RESOLVED 由 resolve_timeout 自动恢复触发，FORCE_RESOLVED 由 force_resolve_violation 手动强制解决触发。
  runId: string;                    // 运行 ID（必填，与 schema.ts L185 一致）。⚠️ 与 appendAudit 3-param 签名冗余（L201），保留以兼容现有 schema。代码示例约定：Observer 代码示例省略 entry 内的 runId/projectId（由 3-param 签名参数隐式提供），Checkpoint 代码示例包含完整字段——两种风格均可，实现时保持一致即可。
  projectId: string;                // 项目 ID（必填，与 schema.ts L186 一致）。⚠️ 同上，与 3-param 签名冗余。
  decision: 'PASS' | 'BLOCK' | 'WARN';  // 审计决策（必填，兼容现有 schema.ts）
  sessionId: string;  // 会话 ID（从 handle() 参数 sessionID 传入）
  severity?: 'warn' | 'block';  // Phase 1 new — Observer entries only。Observer 和 appendAudit 内部检查生成的条目携带（非普通 CheckpointEvent 审计条目）。⚠️ 现有 PROMPT_INJECTION_DETECTED 审计条目（Phase 0 Observer）不携带 severity；Phase 1 不补全（design choice：非 Observer 门控条目，不影响 phase_complete 门控）。如需追溯，可通过 event type 过滤 PROMPT_INJECTION_DETECTED 条目。
  violation?: string;              // 违规描述（COMMAND_FAILED, SYNTAX_ERROR_POST_WRITE, OBSERVER_TIMEOUT）。// violation 是 undefined 的决策情况：PASS 决策时 undefined，JSON 序列化时省略该键
  resolved?: boolean;              // Phase 1 new — 违规解决机制标记
  resolvedAt?: string;             // Phase 1 new — ISO timestamp of resolution
  evicted?: boolean;               // Phase 1 new — FIFO eviction marker。被淘汰的条目标记为 true，不参与门控检查。appendAudit 写入时默认 false/undefined。
  force_resolved_reason?: string;  // Phase 1 new — 强制解决原因（§4.4）。仅 force_resolve_violation 事件填充。普通 resolve 不设置此字段。
  command?: string;               // Phase 1 new — Bash observation。normalizeCommand 后的命令字符串（COMMAND_FAILED 条目专用）
  tool?: string;                  // Phase 1 new — 触发工具名称。仅 Observer 生成的条目携带：'Bash'（COMMAND_FAILED）或 'Write'（SYNTAX_ERROR_POST_WRITE, FILE_TOO_LARGE_FOR_CHECK）。getUnresolvedViolations filter.tool 匹配此字段。非 Observer 条目省略此字段（undefined 不参与 tool 过滤）。
  filePath?: string;              // Phase 1 new — Write observation。触发文件路径。仅 Write 工具相关条目携带（SYNTAX_ERROR_POST_WRITE, FILE_TOO_LARGE_FOR_CHECK）。getUnresolvedViolations filter.filePath 匹配此字段。用于 auto-resolve 精确定位特定文件的违规条目。
  // Phase 2 扩展字段
  phase: number;                   // 触发时的 pipeline phase（必填 number，与 schema.ts 当前定义一致）。⚠️ 不可改为 optional——所有消费者依赖 phase 非空假设，改为 optional 属 Breaking Change。
  round?: number;                  // Ralph 循环轮次（Checkpoint 条目使用）
  timestamp: string;              // ISO 8601（必填 string，与 schema.ts L184 一致）。⚠️ 不可改为 optional——所有消费者依赖 timestamp 非空假设。由调用方手动提供（new Date().toISOString()），appendAudit 不自动填充——与 observer.ts L110-121 模式一致。
  pass?: number;                   // Phase 1 new — Phase 2 test gate。测试通过数（TEST_RUN_COMPLETE 时必填）
  fail?: number;                   // Phase 1 new — Phase 2 test gate。测试失败数（TEST_RUN_COMPLETE 时必填）
  error_summary?: string;          // Phase 1 new — 错误摘要（TEST_RUN_COMPLETE 时必填）
  // ⚠️ pass/fail/error_summary 为 optional（多数事件无需），但 TEST_RUN_COMPLETE 事件要求全部必填。实现时使用运行时校验或 discriminated union。
}
```

## Code Block 2: L204-206
**Context**: ##### CheckpointGateResult

```typescript
{ blocked: boolean; reason?: string; violations?: string[] }
```

## Code Block 3: L214-216
**Context**: **`McpAuditEntry` 接口定义**（Phase 4 新增）：

```typescript
{ event: McpAuditEvent; timestamp: string; details: Record<string, unknown>; source: 'mcp' }
```

## Code Block 4: L301-303
**Context**: ⚠️ 仅显示 Phase 3（Schema v5）扩展的 severity 联合类型。完整接口见 `packages/watchdog/src/schema.ts`（含 description、original、downgrade_reason 等不变字段）。

```typescript
severity: 'C' | 'H' | 'M' | 'P' | 'L' | 'I' | 'S' | 'B' | 'A'  // Schema v5 目标（当期仅 C/H/M/P/L/I）
```

## Code Block 5: L311-313
**Context**: ⚠️ 仅显示 Phase 3（Schema v5）扩展的 counts 类型。完整接口见 `packages/watchdog/src/schema.ts`（含 round: number、submittedAt: string 等不变字段）。

```typescript
counts: { C: number; H: number; M: number; P: number; L: number; I: number; S: number; B: number; A: number }  // Schema v5 目标（当期 counts 不含 S/B/A）
```

## Code Block 6: L319-325
**Context**: `PipelineStore.getActiveRun(projectId)` 返回类型：

```typescript
interface ActiveRun {
  runId: string;
  projectId: string;
  startedAt: string;    // checkpoint.ts setActiveRun 必填（⚠️ 文件引用修正：原引用 pipeline-store.ts L370-374 不正确，实际位于 checkpoint.ts）
}
```

## Code Block 7: L331-336
**Context**: ##### tdd_checkpoint 工具扩展签名

```typescript
tdd_checkpoint(event: string, test_result?: { pass: number; fail: number; error_summary: string }): { success: boolean; error?: string } | void  // ⚠️ TEST_RUN_COMPLETE case 返回 {success, error?}，其余 CheckpointEvent 返回 void
// ⚠️ Phase 2 target MCP wrapper interface — 当前 CheckpointHandler.handle() 返回 JSON.stringify(CheckpointResult) = {ok, state} | {ok, violation, guidance}
// ⚠️ 当 event='TEST_RUN_COMPLETE' 时，test_result 参数必填
// ⚠️ tdd_checkpoint 通过 string 参数同时 dispatch CheckpointEvent（pipeline 状态机）和 AuditLogEntry.event（纯审计写入）。Phase 2 扩展了 TEST_RUN_COMPLETE 等 AuditEvent。
```

## Code Block 8: L364-366
**Context**: ##### ObserverTimeoutError

```typescript
class ObserverTimeoutError extends Error { constructor() { super('Observer timeout'); this.name = 'ObserverTimeoutError'; } }
```

## Code Block 9: L378-388
**Context**: `packages/watchdog/src/rule-config.ts`（Phase 1 新建）：

```typescript
interface RuleConfig {
  enabled: boolean;
  severity: 'warn' | 'block';
  // COMMAND_RESULT_CHECK specific
  ignoreExitCodes?: number[];
  ignoreCommands?: string[];  // glob patterns
  // SYNTAX_CHECK_POST_WRITE specific
  extensions?: string[];
}
```

## Code Block 10: L392-398
**Context**: ##### RulesFile

```typescript
interface RulesFile {
  version: 1;
  rules: Record<string, RuleConfig>;
  // observer 顶层字段已移除，统一通过 rules.X.enabled 控制
}
```

## Code Block 11: L402-413
**Context**: ##### RuleConfigLoader

```typescript
class RuleConfigLoader {
  private static cache: RulesFile | null = null;  // ⚠️ @single-project 约束：假设 Watchdog 运行在单项目上下文（一个 OpenCode 实例 = 一个项目）。若支持多项目，缓存需改为 `Map<projectId, RulesFile>`。
  private static cacheKey: string | null = null;

  /** Load rules from file (cached per file path). Returns default if file missing. */
  static load(ruleName: string): RuleConfig;

  /** Force reload (for testing). */
  static invalidateCache(): void;
}
```
