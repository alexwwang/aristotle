# Aristotle 质量保障体系实施方案

**状态**: 方案设计（30 轮审查完成，含范围质疑）
**版本**: 1.46
**日期**: 2026-06-01
**修订**: 2026-06-01 — v1.46 R13 Ralph review fixes：3 项修复（1H + 1M + 1L 全部 fixed，2 rejected）。主要修复 getUnresolvedViolations auto-resolve 伪代码签名不一致、observer.ts 前向行引用标注、init_repo 工具命名修正。详见附录 LL。

---

## 1. 当前状态（已完成的重构）

### 1.1 目录结构整理
```
✅ intervention/          — 从 auto-reflection-feature 重命名
✅ aristotle_mcp/         — MCP 服务器（20 工具）
✅ packages/watchdog/     — TypeScript 运行时流程守卫
✅ scripts/               — 安装/测试/部署脚本集中管理
✅ tests/                 — 测试目录（e2e/gates/regression）
✅ local-assets 分支      — 设计文档隔离存放
```

### 1.2 版本标记
```
✅ aristotle_mcp: v1.0.0
✅ intervention: v0.1.0（待裁剪合并，Phase 4 处理）
✅ README/CHANGELOG 已更新
```

### 1.3 关键架构决策（已确认）
- ✅ TypeScript Watchdog 是**唯一运行时流程守卫**
- ✅ 语义审查复用 **TDD Ralph Loop**（Reviewer subagent）
- ✅ intervention/ 将合并到 aristotle_mcp/（操作层统一入口）
- ✅ 质量验证分两层：机械验证（同步）+ 流程验证（异步）

---

## 2. 目标架构

### 2.1 总体架构

```
用户指令 → OpenCode → LLM 执行
                │
                ▼
        ┌───────────────┐
        │  Watchdog     │  ← 流程合规监视（TypeScript）
        │  ├── Interceptor（onToolBefore）— 同步拦截（path/state 级）
        │  ├── Observer（onToolAfter）— 结果观察 + 内容验证
        │  └── Checkpoint — 状态转换验证 + 审计日志门控
        └───────┬───────┘
                │ 触发审查
                ▼
        ┌───────────────┐
        │  Ralph Loop   │  ← 产出质量审查（TDD 内置）
        │  ├── 代码质量（C/H/M）
        │  ├── 语义正确性（S）← 新增
        │  ├── 业务逻辑一致性（B）← 新增
        │  └── 上下文适配性（A）← 新增
        └───────┬───────┘
                │ 审查结果
                ▼
        ┌───────────────┐
        │  Aristotle MCP│  ← 规则管理与操作执行（Python，无状态）
        │  ├── 规则生命周期 + 工作流编排（20 工具）
         │  ├── KI (Known Issues) 文档管理（新增）← write_ki_doc, read_ki_docs（⏳ Phase 4）
         │  ├── Git 回滚（新增）← create_rollback_point, rollback_to_checkpoint（⏳ Phase 4）
        │   └── 规则生成（扩展）
        └───────────────┘
```

#### 2.1.1 完整数据流

```
LLM 执行 → Watchdog 拦截/观察
              │
              ├─ Interceptor: 同步门控（path/state 判断，<5ms）
              │   ├─ AC-3: 业务代码写入门控
              │   └─ AC-12: 阶段门控
              │
              ├─ Observer: 事后验证（内容/结果检查，<20ms）
              │   ├─ 文件写入语法验证（JSON/TS/YAML）
              │   ├─ Bash 命令退出码检查
              │   └─ 违规记录 → 审计日志
              │
> ⚠️ 当前 Observer 实现（Phase 0）仅处理 Task 工具观察和 prompt 注入扫描。语法验证和 Bash 结果检查为 Phase 1 新增。
              └─ Checkpoint: 阶段转换门控
                  ├─ 检查审计日志中的未修复违规
                  ├─ 阻止有违规的阶段推进
                  └─ 在 Phase 5（Business Code）完成时记录测试运行请求（TEST_RUN_REQUESTED）
                    
Ralph Loop Reviewer:
              │
              ├─ C/H/M finding → 审计日志（代码质量）
              ├─ S/B/A finding → 审计日志（语义质量）
              ├─ 检查测试执行证据（TEST_RUN_REQUESTED vs TEST_RUN_COMPLETE）
              │
              └─ 需要操作 → Aristotle MCP
                            │
                            ├─ 规则写入/查询（_tools_rules.py）
                            ├─ KI 文档读写（_tools_ki.py）← 新增
                            ├─ 回滚点创建/回滚（git_ops.py）← 新增
                             └─ 工作流编排（6 MCP 工具 + 3 Bridge 方法）

KI (Known Issues) 文档流: Reviewer 发现 recurring pattern → MCP write_ki_doc → 下次 Reviewer 可查询（⏳ 待实现，Phase 4）
回滚流: Watchdog 检测到严重违规 → MCP create_rollback_point → 用户确认后 rollback_to_checkpoint（⏳ 待实现，Phase 4）
```

### 2.2 职责边界（黄金法则）

| 系统 | 职责 | 绝对不做的 |
|------|------|-----------|
| **Watchdog** | 流程合规：阶段顺序、门控检查、工具拦截、审计日志记录 | 代码质量审查、语义分析、直接运行测试 |
| **Ralph Loop** | 产出质量：代码审查、语义验证、逻辑检查、测试证据验证 | 规则管理、Git 操作、流程拦截 |
| **Aristotle MCP** | 操作执行：规则管理、⏳ KI 管理（Phase 4）、⏳ Git 回滚（Phase 4）、工作流编排（全部无状态） | 代码审查、流程拦截、语义分析、维护会话状态 |

---

## 3. 实施阶段

### §3.0 Interface & Type Registry

 > 本节为所有接口和类型的**唯一真相源（single source of truth）**。
 > 其他章节引用接口时使用 "→ 见 §3.0.X" 交叉引用，不重复定义。

> **⚠️ Phase 1 目标状态说明**：本文档 §3.0–§3.0.6 描述的是 Phase 1 实施目标。标注为"Phase 1 target"的接口、常量、API 和辅助函数在设计文档中完整定义，但**尚未在当前代码库中实现**。当前代码库仅包含基础架构（Observer、CheckpointHandler、PipelineStore 基础方法）。每个小节头部均有实现状态标注。实现者应以此为规范，以代码库为起点。

#### §3.0.1 Core Audit Types

##### AuditLogEntry

`packages/watchdog/src/schema.ts` 扩展接口（Phase 1 目标）：

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

注意：`severity` 在 AuditLogEntry 中为 `'warn' | 'block'`（门控行为），与 FindingSeverity（C/H/M/P/L/I，审查评级）是不同概念。`decision`（'PASS'/'BLOCK'/'WARN'，大写）和 `severity`（'block'/'warn'，小写）表达相关但不同的语义：decision 是本次操作的审计决策，severity 是门控阻止级别。

**Migration Note**: Phase 1 扩展现有 AuditLogEntry，非替换。保留 `decision` 字段不变；Observer 专用事件通过扩展 event 联合类型添加（`'OBSERVER_TIMEOUT' | 'COMMAND_FAILED' | 'SYNTAX_ERROR_POST_WRITE'`）；Observer 审计条目使用 `severity` 作为扩展字段（仅 Observer 生成的条目携带）。建议定义 `ObserverAuditEntry extends AuditLogEntry` 类型。⚠️ **runId/projectId 冗余说明**：当前 appendAudit 3-param 签名 `(projectId, runId, entry)` 中 entry 内也包含 runId/projectId（schema.ts:185-186），存在冗余。Phase 1 保留此冗余以兼容现有代码，Phase 4 可考虑从 entry 中移除（breaking change，需独立论证）。

**⚠️ AuditLogEntry 接口差异说明**：文档展示的接口为 Phase 1 目标扩展。当前实现（`schema.ts`）`event` 为联合类型（非 `string`），`timestamp` 为 ISO string（非 Unix ms），`phase` 为必填。Phase 1 新增的 Observer 事件通过扩展 event 联合类型实现，`severity` 为新增字段（非替代 `decision`），`resolved`/`resolvedAt` 为新增字段。完整迁移对照参见 Migration Note（上文）。

**Phase 1 新增字段（含 command）**：COMMAND_FAILED 条目写入时自动设置 command 字段（normalizeCommand 解析结果），用于 getUnresolvedViolations commandPattern 精确匹配（→ §3.0.2）。

**AuditLogEntry.event Phase 分期**：
- **Pre-Phase 存量事件**：`INTERCEPT`（Interceptor 拦截事件）、`PROMPT_INJECTION_DETECTED`（prompt 注入检测事件）— 现有 Interceptor 功能已产生，不在本次 Phase 扩展范围内。
- **Phase 1 审计事件**：`COMMAND_FAILED`、`SYNTAX_ERROR_POST_WRITE`、`OBSERVER_TIMEOUT`（Observer 超时）、`OBSERVER_TIMEOUT_DEGRADED`（降级事件）、`FILE_TOO_LARGE_FOR_CHECK`（大文件跳过检查）、`FORCE_RESOLVED`（手动解决违规）、`TIMEOUT_RESOLVED`（Observer 超时自动/手动恢复事件）、`DEGRADATION_MODE_ACTIVATED`（插件 API 降级）、`AUDIT_ROTATION_LIMIT_EXCEEDED`（轮转上限超出；type definition: Phase 1; runtime trigger: Phase 3+ 延迟实施）

⚠️ DEGRADATION_MODE_ACTIVATED 可在任何 Phase 的 Watchdog 初始化阶段触发（不仅限于标注 Phase）。Phase 1 仅需将其纳入事件联合类型。DEGRADATION_MODE_ACTIVATED: Watchdog 初始化时可能触发（不限 Phase），具体触发路径见 §3.2.2 降级检测。Phase 1 实现需在 event 联合类型中包含此值，触发逻辑不限 Phase。⚠️ Phase 1 实际触发可能性：Phase 1 不实现 read_audit_log 工具注册（Phase 2 产出物），因此 DEGRADATION_MODE_ACTIVATED 在 Phase 1 仅作为类型定义存在，不会实际触发。Phase 2 实现工具注册时开始可能触发。
- **Phase 2 审计事件**：`TEST_RUN_REQUESTED`、`TEST_RUN_COMPLETE`（测试运行请求/完成）
- **Phase 2 事件占位形式**：Phase 2 实现时扩展 event 联合类型包含 `TEST_RUN_REQUESTED | TEST_RUN_COMPLETE`（§3.2.2 产出物）。
- Phase 3（待定）：`REVIEWER_SPAWNED` — Reviewer 派发事件

##### CheckpointEvent

CheckpointEvent 联合类型（含 Phase 1/4 扩展）：
// ⚠️ Phase 1/4 扩展事件 — 当前 schema.ts CheckpointEvent 有 10 个值（不含 resolve_timeout/force_resolve_violation/pipeline_reset）

- **Phase 1 扩展**：新增 `resolve_timeout`（Observer 超时恢复事件）和 `force_resolve_violation`（手动解决违规事件）。这两个事件通过 `tdd_checkpoint` 工具调用，属于 pipeline 状态机范畴。其余 CheckpointEvent 值保持不变（phase_complete、ralph_round_finding 等）。
  - `resolve_timeout`：payload 需含 `reason: string`（必填）；precondition：state 存在且 phaseStatus 为 active 或 ralph_loop（ralph_loop 阶段也可能触发 Observer 超时，resolve_timeout 应能覆盖）；action（纯状态变更）：重置 state.observerTimeoutCount = 0。// ⚠️ 注：awaiting_approval 状态下 Observer 仍可触发（如 approval 期间的 tool call），但 resolve_timeout 语义上仅在 active/ralph_loop 中有效。若在 awaiting_approval 触发，validateTransition 应返回 false（Observer timeout 不影响 approval 流程）。// ⚠️ resolve_timeout/force_resolve_violation 使用 lowercase_with_underscore 因为它们通过 tdd_checkpoint 作为 CheckpointEvent 值 dispatch（遵循 CheckpointEvent 历史遗留命名约定），而非 Observer 直接写入的 SCREAMING_SNAKE_CASE 审计事件applyTransition 仅负责 PipelineState 纯函数变更（返回新 state），不执行 I/O。I/O 操作（resolveViolations、appendAudit 写入 TIMEOUT_RESOLVED）由 CheckpointHandler.handle() 在 applyTransition 返回后执行（与现有 checkpoint.ts L393 模式一致：applyTransition → writeState → appendAudit）。⚠️ 不在 applyTransition 内调用 appendAudit()——违反 transitions.ts L797-799 纯函数契约（"Pure function — caller is responsible for persistence"）。// 不携带 severity 字段（L137：severity 为 Observer 专用，CheckpointEvent 触发的审计事件省略此字段）。applyTransition 同步更新：transitions.ts 必须添加 resolve_timeout case（validateTransition + applyTransition 同步更新，仅更新 validateTransition 而不更新 applyTransition 会导致运行时 throw）。
  - `force_resolve_violation`：payload 需含 `violation_type: string`（必填，如 'COMMAND_FAILED'）和 `reason: string`（必填）；precondition：state 存在 + sessionId 匹配 state.ownerSessionId；action（纯状态变更）：无 PipelineState 变更（force_resolve_violation 不修改 PipelineState 字段）。I/O 操作由 CheckpointHandler.handle() 在 applyTransition 返回后执行：resolveViolations 标记指定违规为 resolved + 记录 force_resolved_reason。⚠️ 不在 applyTransition 内执行 resolveViolations——违反纯函数契约。ownerSessionId 为 optional 字段。若 ownerSessionId 为 undefined（pipeline run 无 owner），force_resolve_violation 被拒绝。applyTransition 同步更新要求同 resolve_timeout。
  - ⚠️ transitions.ts validateTransition 和 applyTransition 必须同步添加对应 case。applyTransition 仅负责纯状态变更（返回新 PipelineState），I/O 操作（resolveViolations、appendAudit）在 CheckpointHandler.handle() 中执行。
  - ⚠️ transitions.ts new-case 完整列表：resolve_timeout、force_resolve_violation、pipeline_reset（Phase 4 占位）各需 NEW validateTransition + applyTransition case。遗漏任一 case 将导致运行时 throw（applyTransition default 为 `throw new Error(...)`）。
     - `resolve_timeout` 执行流程（遵循 CheckpointHandler 分离模式）：
       1. applyTransition（纯函数）：重置 state.observerTimeoutCount = 0，返回新 PipelineState
       2. CheckpointHandler.handle()（I/O 层）：
           a. getUnresolvedViolations(projectId, runId, 'block', { event: 'OBSERVER_TIMEOUT' }) → 获取未恢复的 OBSERVER_TIMEOUT 条目。⚠️ 若返回空数组（无实际 OBSERVER_TIMEOUT 违规），resolveViolations 为 no-op，但仍写入 TIMEOUT_RESOLVED 审计事件。此为可接受行为——提供操作审计追踪（记录 resolve_timeout 被调用但无违规需恢复）。若需避免无意义审计条目，可在 getUnresolvedViolations 返回空时跳过后续步骤（非强制优化）。
          b. resolveViolations(projectId, runId, timestamps) → 标记 resolved + 记录 resolvedAt
          c. appendAudit(...) → 写入 TIMEOUT_RESOLVED 审计事件（decision='PASS'，不携带 severity）
       3. writeState → 持久化新 PipelineState
      
       此分离确保 applyTransition 保持纯函数契约（transitions.ts L797-799）。⚠️ 执行顺序说明：resolve_timeout 的 writeState 在 I/O 之后（与现有 checkpoint.ts L393 模式 applyTransition→writeState→appendAudit 不同）。原因：resolveViolations 需要基于当前 state 的审计数据操作，先执行 I/O 再持久化更合理。风险：若 I/O 成功但 writeState 失败，审计日志显示 TIMEOUT_RESOLVED 但 state 中 observerTimeoutCount 未重置（下次 Checkpoint 可通过幂等 resolve_timeout 修正）。// 兜底恢复：auto-resolve 成功时也应重置 observerTimeoutCount（作为 writeState 失败的兜底），确保计数器在后续操作中恢复。
// ⚠️ 审计条目数量：resolve_timeout 产生两条审计条目——(1) 标准审计条目（event='resolve_timeout', decision='PASS'）由 CheckpointHandler L393 模式自动写入，(2) TIMEOUT_RESOLVED 由 I/O 层显式写入。两条条目共存，前者记录事件发生，后者记录语义恢复。force_resolve_violation 同理（标准条目 + FORCE_RESOLVED）。若需抑制标准条目，CheckpointHandler 需特殊处理跳过 L393 appendAudit。
    - `force_resolve_violation` applyTransition：action（纯状态变更）= 无 PipelineState 字段变更。I/O 操作（resolveViolations 标记指定类型 block 级违规为 resolved + 记录 force_resolved_reason）在 CheckpointHandler.handle() 中执行。
  - ⚠️ ownerSessionId 为 optional 字段 (schema.ts L49 `string | undefined`)。若 ownerSessionId 为 undefined（pipeline run 无 owner），force_resolve_violation 被拒绝。确保 pipeline_start 时始终设置 ownerSessionId。
- **Phase 4 CheckpointEvent 扩展（类型占位）**：`pipeline_reset` — 用于回滚后重置 PipelineState。payload 需含 `checkpoint_hash: string`（必填）；precondition：state 存在；action：重置 PipelineState（phase→1, phaseStatus→idle, round→0, observerTimeoutCount→0, auditEntryCount→0）。注：phase→1 而非 phase→0，因为 phase=0 是 pre-init 哨兵值。详见 §3.4.1。

##### CheckpointGateResult

```typescript
{ blocked: boolean; reason?: string; violations?: string[] }
```

**与 CheckpointResult 的关系**：CheckpointGateResult 是 CheckpointHandler 门控检查的内部返回类型，与 `schema.ts` 的 CheckpointResult（tdd_checkpoint 工具的返回类型）不同。门控检查先执行，通过后才构造 CheckpointResult 返回给调用方。

##### McpAuditEntry & McpAuditEvent

**`McpAuditEntry` 接口定义**（Phase 4 新增）：

```typescript
{ event: McpAuditEvent; timestamp: string; details: Record<string, unknown>; source: 'mcp' }
```

**`McpAuditEvent`** = `'GUARD_BYPASSED' | 'ROLLBACK_EXECUTED' | 'STASH_CLEANUP_PERFORMED'` — MCP 侧审计事件联合类型：新增值追加到此联合类型，不使用 `| string` 扩展。初始值集如上，遵循 SCREAMING_SNAKE_CASE 命名规范。

- `GUARD_BYPASSED`：`skip_guard: true` 调用 commit_rule 时记录
- `ROLLBACK_EXECUTED`：rollback_to_checkpoint 成功执行时记录
- `STASH_CLEANUP_PERFORMED`：cleanup_rollback_stashes 执行清理时记录
- 与 AuditLogEntry.event 使用相同命名规范（SCREAMING_SNAKE_CASE），但 `source: 'mcp'` 区分来源
- `timestamp` 为 ISO 8601 字符串
- `details` 包含事件特定数据（如 GUARD_BYPASSED 的参数信息）

#### §3.0.2 PipelineStore API

> **⚠️ Phase 1 target APIs**: getUnresolvedViolations, resolveViolations 为 Phase 1 新增方法，当前 pipeline-store.ts 不包含这些方法。appendAudit 的 FIFO 检查和 evictionNeeded 逻辑为 Phase 1 目标行为，当前实现为简单的 appendLog wrapper。

##### appendAudit(projectId: string, runId: string, entry: AuditLogEntry): void

**合并行为规范**：
- 同步方法（void 返回），调用时不带 await（与现有 checkpoint.ts 代码风格一致，V4）。⚠️ 注：现有 observer.ts L121 使用 `await this.store.appendAudit(...)` 对 void 函数 await——虽 JS 允许（await 非 Promise 自动包装），但语义上无意义。Phase 1 实现应移除不必要的 await 以保持风格一致。// ⚠️ appendAudit 为同步 void（无需 await）；appendObservation 为 async Promise<void>（需 await）。Phase 1 实现需移除 observer.ts 中 appendAudit 的多余 await。// Phase 1 行动项：observer.ts L121: 移除 appendAudit 上不必要的 await（函数为同步 void）
- FIFO 检查：写入前检查 `state.auditEntryCount`（O(1) 内存计数器），达到 5000 时设置 `evictionNeeded` 标记。Checkpoint 淘汰完成后更新计数器：`state.auditEntryCount -= evictedCount`（见 §3.2.2）。⚠️ auditEntryCount 应在 appendAudit 写入成功后递增（非写入前），避免写入失败导致计数器偏高。推荐模式：先 write → 成功后 count++。
// ⚠️ Phase 1 target behavior — 当前 appendAudit 为简单 appendLog wrapper，无 FIFO 检查
- `timestamp`：由调用方提供 via `new Date().toISOString()`，appendAudit 不自动填充
- 冗余说明：projectId/runId 出现在参数和 entry 中（兼容现有 schema）
- **错误处理策略**：StateStore 写入失败时 console.error + 返回（不 throw）。原因：(1) appendAudit 为 void 同步方法，抛出异常会导致 Observer handle() 在 20ms 超时保护外崩溃；(2) 审计条目丢失可通过日志告警发现，不影响核心 pipeline 状态机。若需更强保证，可在失败时设置 state-level degraded 标志供后续 Checkpoint 检查。
- 迁移：Phase 1 新增的 optional 字段（severity, resolved, resolvedAt, evicted, force_resolved_reason）在旧条目中为 undefined，无需显式默认值。getUnresolvedViolations 使用 `resolved !== true` 语义正确处理 undefined 情况。⏳ Phase 2+ 运行时检查：当 audit key 数量达到上限（10 个）时，写入 `AUDIT_ROTATION_LIMIT_EXCEEDED` 审计事件（decision='WARN', severity='warn'），包含当前 key 数量和总条目数。
- ⚠️ 若 Phase 2 改为 async，需重新评估 Observer 20ms 超时保护

**AUDIT_ROTATION_LIMIT_EXCEEDED 触发**（⏳ Phase 2+ 运行时检查）：当 audit key 数量达到 10 个上限时，appendAudit 写入 `AUDIT_ROTATION_LIMIT_EXCEEDED` 事件（decision='WARN', severity='warn'），包含当前 key 数量和总条目数。此检查在 appendAudit 内部执行（写入新 key 之前检测 key 数量）。Phase 1 不实现此检查——仅定义常量值。

##### getUnresolvedViolations(projectId: string, runId: string, severity: 'warn' | 'block', filter?: { tool?: string; filePath?: string; event?: string; commandPattern?: string }): Array\<AuditLogEntry & { _sourceKey: string }\>

**合并行为规范**：
// ⚠️ projectId/runId 定位 audit key 路径（watchdog/${projectId}/${runId}/audit*）。与 resolveViolations 签名风格一致。
- 仅返回 `resolved !== true` 的条目
- severity 严格相等匹配；severity=undefined 条目（非 Observer 生成）被排除（设计意图：只有 Observer 条目参与门控决策）
- filter 参数：可选，支持 tool/filePath/event/commandPattern 组合过滤。多字段组合为 **AND 语义**（所有指定字段必须同时匹配）。未指定的字段不做过滤。
  - ⚠️ 设计约定：severity 字段同时作为 Observer-origin 标记——undefined severity = 不参与门控决策，无论 decision 值。这确保 CheckpointHandler 生成的条目（如 phase_complete、TIMEOUT_RESOLVED）不会被误纳入门控逻辑。
  - `commandPattern`：用于 COMMAND_FAILED 场景精确匹配（auto-resolve 等场景共用），按 normalizeCommand 后的命令字符串精确匹配（===）。⚠️ 匹配机制：COMMAND_FAILED 条目需在 AuditLogEntry 新增 `command?: string` 索引字段存储 normalizeCommand 后的命令字符串。getUnresolvedViolations 内部按此字段精确匹配（===）。若 Phase 1 不添加此字段，则 commandPattern 回退为全量匹配（解析 violation 字符串提取命令，但不可靠）。建议：Phase 1 为 COMMAND_FAILED 条目添加 command 字段。
  - `filePath`：用于 SYNTAX_ERROR_POST_WRITE 场景精确匹配（auto-resolve 等场景共用）
  - `event`：用于 OBSERVER_TIMEOUT 场景精确匹配（auto-resolve 等场景共用）
- 轮转：扫描所有 audit* key 前缀（audit + audit-2 到 audit-10，最大 10 个 key）
- Scope：通过 appendAudit 3-param 签名隐式限定为当前 run（无需额外 scope 参数）
- 冷启动：索引为空是正确行为——无历史违规可查询，符合"无证据则无违规"原则
- 使用内存索引（O(1)），同步调用，无需 await
// ⚠️ 索引实现：(a) 结构 Map<severity, Map<event, AuditLogEntry[]>>（推荐），(b) 懒加载：首次查询时构建，appendAudit 时增量更新，resolveViolations/FIFO eviction 时全量重建，(c) Phase 1 可降级为 O(n) 全扫描（n ≤ 5000），P99 <5ms 可接受。
- 返回类型：每条附带 `_sourceKey`（标识条目所在 audit key），resolveViolations 据此定位条目

##### resolveViolations(projectId: string, runId: string, timestamps: string[]): void

**合并行为规范**：
- 按 `_sourceKey` 分组，再在每个 audit key 内 read-modify-write
- Upsert 语义：更新 `resolved: true` + `resolvedAt`（存在则更新，不存在则忽略）
- 使用 timestamp（ISO 8601 字符串数组）作为条目定位键，与 getUnresolvedViolations 返回的 `AuditLogEntry.timestamp` 直接对应。⚠️ 低风险：ISO 8601 毫秒精度在 JS 单线程下通常唯一。极端场景下同一毫秒内产生两条审计条目可能导致 resolveViolations 误标记同时间戳的条目。风险可接受（需同一毫秒 + 其中一条需 resolve 而另一条不需）。若需更强唯一性保证，可在 Phase 4+ 考虑添加自增 sequenceId 字段。
- 单线程安全：JS 单线程无跨进程并发风险。StateStore write 保证原子性（单次 write 覆盖整个 key 值）
- // FIFO 淘汰计数器更新在 appendAudit 中执行（evictionNeeded 判断），不在 resolveViolations 中。

#### §3.0.3 PipelineState & Schema Types

##### PipelineState（Phase 1 Extensions）

**Phase 1 扩展字段**（需同步更新 `packages/watchdog/src/schema.ts` PipelineState 接口）：// Phase 1 实现需更新文件：schema.ts（PipelineState 新字段）、transitions.ts（applyTransition phase_complete reset + resolve_timeout/force_resolve_violation 新 case）、state-cache.ts（无需改动，使用 same-reference pattern）、pipeline-store.ts（readState() 添加 Phase 1 新字段默认值迁移）
// ⚠️ Phase 1 new fields — observerTimeoutCount, auditEntryCount, evictionNeeded 不在当前 schema.ts PipelineState 中
- `observerTimeoutCount: number` — OBSERVER_TIMEOUT 连续计数器（初始 0，每次 OBSERVER_TIMEOUT +1）。重置触发条件：
  - (1) auto-resolve：后续 Observer 成功执行时重置为 0
  - (2) resolve_timeout：CheckpointEvent 触发时重置为 0
  - (3) phase_complete：阶段推进成功时重置为 0 // Phase 1 扩展 action：重置 state.observerTimeoutCount = 0（§3.0.3 L271, §4.2 L460）。⚠️ Phase 1 实现：transitions.ts phase_complete applyTransition 返回值必须显式包含 observerTimeoutCount: 0（spread operator 会保留旧值）
  - (4) pipeline_reset（Phase 4）：重置所有 PipelineState 字段包括 observerTimeoutCount = 0
  - **持久化策略**：Observer handle() 直接修改内存 state 后不显式调用 writeState。变更通过下一次 CheckpointHandler.handle() 的 writeState 调用持久化。⚠️ **前置条件**：PipelineStateCache.get() 必须返回同一对象引用（非深拷贝）。Observer 通过 `const state = this.cache.get()` 获取引用后直接修改 state.observerTimeoutCount 等字段，若 cache 返回副本则变更静默丢失。若未来 cache 实现改为返回副本，需同步修改 Observer 为 `cache.update(state)` 模式。// ⚠️ readState() 在首次加载时可能通过 migration 返回新对象（spread operator），但迁移仅执行一次。后续 get() 调用返回同一 _memoryState 引用。// ⚠️ 此前提条件仅适用于 single-agent 模式。multi-agent 模式下 state-cache.ts 每次 get() 从磁盘重新读取（返回新对象），Observer 直接修改不生效。Phase 1 仅支持 single-agent 模式。若需 multi-agent 支持，Observer 不得直接修改 state，需改为显式 writeState 或通过 Checkpoint 事件触发更新。⚠️ 已知限制：若进程在 Observer 修改后、下一个 Checkpoint 之前崩溃，observerTimeoutCount 变更丢失（计数器回退到上次 Checkpoint 时的值）。影响评估：丢失后计数器从较低值开始，最坏情况多一次超时才触发降级，可接受。若需更强持久化保证，可在 Observer handle() finally 块中调用 writeState（但会增加 20ms 超时预算外的 I/O 开销）。
- `auditEntryCount: number` — 审计日志条目计数器（初始 0，appendAudit 时 +1）。持久化策略同 observerTimeoutCount（随下一次 Checkpoint writeState 持久化）。崩溃丢失影响：计数器偏低，FIFO 淘汰延迟触发，可接受。
- `evictionNeeded: boolean` — FIFO 淘汰标记（auditEntryCount ≥ 5000 时设为 true，Checkpoint 执行淘汰后重置为 false）

**Phase 1 迁移默认值**：PipelineState 加载时补充默认值：`state.observerTimeoutCount = state.observerTimeoutCount ?? 0; state.auditEntryCount = state.auditEntryCount ?? 0; state.evictionNeeded = state.evictionNeeded ?? false;` // ⚠️ 迁移默认值添加位置：pipeline-store.ts readState() 函数，JSON.parse 之后、return 之前。代码模式：`state.observerTimeoutCount = state.observerTimeoutCount ?? 0;`

⚠️ **PipelineState 字段来源**：
- **基础字段**（`currentPhase`, `phaseStatus`, `ralph` 嵌套对象, `ownerSessionId`）：定义在 schema.ts
- `currentPhase: number`（**非** `phase`）— schema.ts L30
- `round` 为 `ralph.round` 子字段（schema.ts L86），非 PipelineState 直接字段
- `sessionId` 仅存在于 `AuditLogEntry`，非 PipelineState 字段
- `activeRun` 为独立接口（schema.ts L142-147），非 PipelineState 字段
- Phase 1 扩展字段（`observerTimeoutCount`, `auditEntryCount`, `evictionNeeded`）为设计目标，不在当前 schema.ts 中

##### FindingSubmission

⚠️ 仅显示 Phase 3（Schema v5）扩展的 severity 联合类型。完整接口见 `packages/watchdog/src/schema.ts`（含 description、original、downgrade_reason 等不变字段）。

```typescript
severity: 'C' | 'H' | 'M' | 'P' | 'L' | 'I' | 'S' | 'B' | 'A'  // Schema v5 目标（当期仅 C/H/M/P/L/I）
```

**[TEST_EVIDENCE] description 前缀约定**：Reviewer 报告 TEST_EVIDENCE 相关 finding 时必须在 description 开头标注 `[TEST_EVIDENCE]`。M→H 升级判定逻辑：检查前轮 RoundRecord.findings 数组中查找 severity='M' 且 description 含 `[TEST_EVIDENCE]` 前缀的条目，若有且本轮 TEST_RUN_COMPLETE 仍不存在，升级为 H 级 finding。

##### RoundRecord

⚠️ 仅显示 Phase 3（Schema v5）扩展的 counts 类型。完整接口见 `packages/watchdog/src/schema.ts`（含 round: number、submittedAt: string 等不变字段）。

```typescript
counts: { C: number; H: number; M: number; P: number; L: number; I: number; S: number; B: number; A: number }  // Schema v5 目标（当期 counts 不含 S/B/A）
```

##### ActiveRun

`PipelineStore.getActiveRun(projectId)` 返回类型：

```typescript
interface ActiveRun {
  runId: string;
  projectId: string;
  startedAt: string;    // checkpoint.ts setActiveRun 必填（⚠️ 文件引用修正：原引用 pipeline-store.ts L370-374 不正确，实际位于 checkpoint.ts）
}
```

用于 Checkpoint 和 Observer 获取当前活跃 run 信息。

##### tdd_checkpoint 工具扩展签名

```typescript
tdd_checkpoint(event: string, test_result?: { pass: number; fail: number; error_summary: string }): { success: boolean; error?: string } | void  // ⚠️ TEST_RUN_COMPLETE case 返回 {success, error?}，其余 CheckpointEvent 返回 void
// ⚠️ Phase 2 target MCP wrapper interface — 当前 CheckpointHandler.handle() 返回 JSON.stringify(CheckpointResult) = {ok, state} | {ok, violation, guidance}
// ⚠️ 当 event='TEST_RUN_COMPLETE' 时，test_result 参数必填
// ⚠️ tdd_checkpoint 通过 string 参数同时 dispatch CheckpointEvent（pipeline 状态机）和 AuditLogEntry.event（纯审计写入）。Phase 2 扩展了 TEST_RUN_COMPLETE 等 AuditEvent。
```

#### §3.0.4 Observer Helpers

> **⚠️ Phase 1 new file — rule-config.ts 不存在。所有辅助函数（extractExitCode, quickSyntaxCheck, yamlSyntaxCheck, matchPattern, normalizeCommand, ObserverTimeoutError）为 Phase 1 新增。**

##### extractExitCode(output: string): number

从 Bash 工具 output 中解析退出码。格式：`output` 最后行含 `Exit code: N` 或 process exit signal。实现：正则 `/exit code: (\d+)/i` 提取。⚠️ **Fallback 策略统一为 1（fail-safe）**：所有未匹配路径均返回 1（而非 0），确保未知退出状态被标记为失败。若 Phase 1 上线后发现 fail-safe 导致过多误报，可切换为 fallback=0（fail-open）收集数据。Phase 1 默认使用 fallback=1。

##### quickSyntaxCheck(content: string): { ok: boolean; error?: string }

TypeScript 语法快速检查。依赖 `typescript` compiler API（`createSourceFile` + `SyntaxKind` 遍历）。返回 `{ ok: true }` 或 `{ ok: false, error: '行 X: 语法错误描述' }`。⚠️ 评估轻量替代方案（如 `acorn` ~100KB 做纯语法解析）以减少生产环境依赖体积。Phase 1 决策：先仅支持 JSON/YAML 验证（零新运行时依赖），TypeScript 验证延后至 Phase 2 评估。Phase 1 从依赖列表中移除 `typescript` 运行时依赖（保留为 devDependency 用于测试）。

##### yamlSyntaxCheck(content: string): { ok: boolean; error?: string }

YAML 语法检查。依赖 `js-yaml` 库（`yaml.load(content, { schema: yaml.JSON_SCHEMA })` 包裹 try/catch）。⚠️ **必须使用 JSON_SCHEMA**（非默认 DEFAULT_SCHEMA），因为 DEFAULT_SCHEMA 支持 `!!js/function` 等 JS-specific 类型，存在任意代码执行风险。返回格式同上。

##### matchPattern(command: string, pattern: string): boolean

Bash 命令名与 ignoreCommands glob 模式匹配。依赖 `minimatch` 库（`minimatch(command, pattern)`）。用于 COMMAND_RESULT_CHECK 的 ignoreCommands 过滤。

##### normalizeCommand(command: string): string

统一命令字符串格式（trim 首尾空白 → 连续空白压缩为单空格）。⚠️ **所有命令匹配路径**（auto-resolve 精确匹配、ignoreCommands glob 匹配）必须先调用此函数，确保匹配一致性。

##### ObserverTimeoutError

```typescript
class ObserverTimeoutError extends Error { constructor() { super('Observer timeout'); this.name = 'ObserverTimeoutError'; } }
```

模块级定义（与 Observer 类同级），支持跨方法 instanceof 检查。不在 handle() 方法体内，避免每次调用重新创建类。

#### §3.0.5 Configuration Types

> **⚠️ Phase 1 new file — rule-config.ts 不存在。RuleConfig/RulesFile/RuleConfigLoader 为 Phase 1 新增。**

##### RuleConfig

`packages/watchdog/src/rule-config.ts`（Phase 1 新建）：

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

##### RulesFile

```typescript
interface RulesFile {
  version: 1;
  rules: Record<string, RuleConfig>;
  // observer 顶层字段已移除，统一通过 rules.X.enabled 控制
}
```

##### RuleConfigLoader

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

#### §3.0.6 Constants Registry

> ⚠️ 标注 "Phase 1 target" 的常量值为设计目标。当前 constants.ts 实际值可能不同。Phase 列表示计划实施阶段。

| Constant | Value | Phase | Location for context |
|----------|-------|-------|---------------------|
| Observer timeout | 20ms | P1 | §3.1.1 handle() |
| Interceptor timeout | 5ms | P1 | §3.1.3 |
| Checkpoint check timeout | 50ms | P1 | §3.1.1 |
| Reviewer timeout | 60s | P1 | §4.2 |
| OBSERVER_TIMEOUT degradation threshold | ≥3 | P1 | §3.1.1 |
| Audit FIFO limit | 5000 entries | P1 | §3.2.2 |
| Audit rotation limit | 10 keys | P1 | §3.0.2 |
| Audit key size limit | 10MB | P1 | §3.2.2 |
| File size check limit | 100KB | P1 | §3.1.1 |
| MCP audit JSONL line limit | 4KB | P4 | §3.4.3 |
| error_summary truncation | 500 chars | P4 | §3.4.3 |
| MAX_RALPH_ROUNDS | 20 (Phase 2 target; current code: 10) | P2 | §3.2.1 |（影响：constants.ts + transitions.ts（validateTallyTermination 中 MAX_RALPH_ROUNDS 比较逻辑，ralph_terminate 中状态转换触发））。⚠️ resolve_timeout、force_resolve_violation、pipeline_reset 三个新增 CheckpointEvent 各需 transitions.ts 中 NEW validateTransition + applyTransition case（见 §3.0.1 CheckpointEvent 注释）。
| Current MCP tool count | 20 | — | Pre-merge |
| Post-merge MCP tool count | 25 | P4 | §3.4.3 |
| New tools in Phase 4 | 5 | P4 | §3.4.3 |
| Stash warning threshold | 5 | P4 | §3.4.1 |
| Stash hard limit | 10 | P4 | §3.4.1 |
| Test evidence SLA | 30-90s | P2 | §3.2.1 |
| Audit retention after archive | 7 days | P2+ | §3.2.2 |
| BUSINESS_CODE_PHASE | 5 (Phase 2 target; current code: TEST_CODE_PHASE=4, 不同概念) | P2 | §3.2.1 |
| SCHEMA_VERSION target | 5 | P3 | §3.3.2 |
| SEV_ORDER severity priority mapping | S=8, C=5, B/H=4, M=3, P=2, L=1, A/I=0 | P3 | §3.3.2 |
| VALID_SEVERITIES set | C/H/M/P/L/I/S/B/A | P3 | §3.3.2 |
| Untracked files check threshold | 100MB | P4 | §3.4.1 |
| Stash cleanup keep count | 3 | P4 | §3.4.1 |

**当前代码库已有常量**（constants.ts 实际值）：
`MIN_GATE_ROUNDS=5`, `EARLY_STOP_CONSECUTIVE=2`, `STALE_THRESHOLD_MS=4h`, `TEST_CODE_PHASE=4`, `ARTICULATION_MAX_FAILURES=3`, `SESSION_BUFFER_MAX_SIZE=1000`, `MAX_TRACKED_SESSIONS=50`, `MAX_FINDINGS_PER_ROUND=50`, `MAX_FINDING_DESCRIPTION_LENGTH=2000`, `MAX_DOWNGRADE_REASON_LENGTH=1000`

## 4. 架构设计原则

### 4.1 单一职责原则
- **Watchdog 只做流程**：阶段顺序、门控、拦截、审计日志。不直接运行测试。
- **Ralph Loop 只做审查**：代码质量、语义、逻辑、测试证据验证。不操作规则或 Git。
- **Aristotle MCP 只做操作**：规则管理、KI、回滚（全部无状态）。不做审查或拦截。
- **工具名称约定**：OpenCode 注册的工具名使用首字母大写（如 `Write`、`Bash`、`Task`）。Observer handle() 中 tool 参数已按此约定传递，无需大小写转换。

### 4.2 同步 vs 异步分层
```
同步（<5ms）         同步（Observer <20ms）    异步（Reviewer 60s）
    │                    │                         │
    ▼                    ▼                         ▼
┌──────────┐       ┌──────────┐            ┌──────────┐
│Interceptor│       │ Observer  │            │ Reviewer │
│path/state│       │语法验证   │            │ 语义审查 │
│门控判断   │       │Bash 结果  │            │ S/B/A    │
└──────────┘       │审计日志   │            │测试证据  │
   Watchdog        └──────────┘            └──────────┘
                       Watchdog              Ralph Loop
```

#### 超时与性能预算

> ⚠️ 以下超时预算为 Phase 1 实施目标 — 当前代码无超时保护机制。

**术语定义**：fail-open = 检查失败时放行（安全性让步于可用性）；fail-closed = 检查失败时阻止（可用性让步于安全性）；fail-open for current call, fail-closed at gate = 当前操作放行（fail-open），但违规记录在审计日志中，后续 Checkpoint 阶段推进时阻止（fail-closed）。Observer 和 Reviewer 采用此模式。

| 层 | 操作 | 最大耗时 | 超时行为 |
|----|------|----------|----------|
| 同步 | Interceptor evaluate() | 5ms | 超时 → 跳过规则（fail-open） |
| 同步 | Observer handle() | 20ms | 超时 → 记录 `OBSERVER_TIMEOUT` 审计事件（severity=block，连续 ≥3 次后降级为 severity=warn，见下方降级说明）+ 记录警告，不阻塞当前操作。fail-open for current call, fail-closed at gate（见防御闭环设计）。 |
| 异步 | Checkpoint 审计日志检查 | 50ms | 超时 → 阻止阶段推进（fail-closed） |
| 异步 | Reviewer subagent 审查 | 60s | 超时 → 报告 H 级 finding |
| 异步 | 测试运行（主 Agent 执行） | Reviewer 检查周期 | Reviewer 下轮发现 TEST_RUN_REQUESTED 无 TEST_RUN_COMPLETE → H 级 finding |

**防御闭环设计**：Observer 超时时写入 `OBSERVER_TIMEOUT` 审计事件（severity=block）。Checkpoint 在阶段推进时检查审计日志中的 `OBSERVER_TIMEOUT` 事件。若存在未恢复的 Observer 超时，阻止阶段推进（fail-closed）。这填补了"Observer 超时 → 无违规记录 → Checkpoint 放行"的 bypass 路径。

**OBSERVER_TIMEOUT 解决路径**：(1) 后续 Observer 成功执行时自动 resolve 前次 OBSERVER_TIMEOUT（在 handle() 开头检查是否存在未恢复的 OBSERVER_TIMEOUT 并标记 resolved）；(2) 若整个阶段无后续调用，OBSERVER_TIMEOUT 保持 block 状态并阻止阶段推进。开发者需：(1) 重新执行工具调用以触发 Observer 成功执行（自动 resolve），或 (2) 标记阶段为 failed（记录未解决违规原因）。OBSERVER_TIMEOUT 不提供"推进即恢复"路径——fail-closed at gate 原则要求显式恢复。(3) **低成本恢复路径（Phase 1 新增）**：`tdd_checkpoint(event='resolve_timeout', reason='GC pause 或瞬时负载')` — 显式恢复 OBSERVER_TIMEOUT，附带原因说明（写入审计日志），比标记 failed 轻量，比无意义操作更可审计。**(4) 连续超时自动降级（非解决路径，仅降低严重性，Phase 1 新增）**：若同一 pipeline run 中 OBSERVER_TIMEOUT 连续出现 ≥3 次，Observer 自身在写入第 3 次 OBSERVER_TIMEOUT 时递增计数器 `observerTimeoutCount` 至 3，发现 ≥3 后自动将本次 severity 降级为 `'warn'`（不再阻止阶段推进），同时额外写入 `OBSERVER_TIMEOUT_DEGRADED` 审计事件。⚠️ 降级时机与代码一致：计数器在 ≥3 检查前递增（1st→count=1→block，2nd→count=2→block，3rd→count=3→warn+degraded）。Checkpoint phase_complete 不参与降级判断——仅负责在阶段推进成功时重置 observerTimeoutCount = 0。

```typescript
// OBSERVER_TIMEOUT_DEGRADED 降级计数器方案
// 计数器存储在 PipelineState 新增字段 `observerTimeoutCount: number`
// 每次写入 OBSERVER_TIMEOUT 审计事件时递增
// ⚠️ 降级检查时机：Observer handle() 写入 OBSERVER_TIMEOUT 时检查 observerTimeoutCount。
// 若 observerTimeoutCount ≥ 3，本次 OBSERVER_TIMEOUT severity 改为 'warn'，同时额外写入 OBSERVER_TIMEOUT_DEGRADED。
// Checkpoint phase_complete 不参与降级判断——仅负责在阶段推进成功时重置 observerTimeoutCount = 0。
// 降级时同时写入 OBSERVER_TIMEOUT_DEGRADED 审计事件：
//   this.store.appendAudit(projectId, runId, {
//     event: 'OBSERVER_TIMEOUT_DEGRADED',
//     decision: 'WARN',
//     severity: 'warn',
//     violation: `Observer 连续 ${state.observerTimeoutCount} 次超时，降级为 warn（不再阻止阶段推进）`,
//     sessionId: sessionID,
//     phase,
//     timestamp: new Date().toISOString(),
//   });
// PipelineState 扩展字段：observerTimeoutCount: number（初始 0）
// transitions.ts applyTransition('resolve_timeout') 重置 observerTimeoutCount = 0
```

⚠️ 降级计数器持久化：observerTimeoutCount 存储在 PipelineState 中，通过 StateStore 持久化。进程重启后从磁盘恢复 PipelineState 时计数器保留。跨 pipeline run 不继承（每个 run 初始为 0）。

**PipelineState Phase 1 扩展字段** → 完整定义见 §3.0.3

**设计原则**：
- 同步操作必须极快（<5ms），否则会阻塞 OpenCode 主循环
- 异步操作有宽松超时，但必须有超时保护
- fail-open 用于非关键检查（语法验证、观察器）
- fail-closed 用于关键门控（阶段推进）

### 4.3 错误处理策略
```
机械错误（语法、命令失败）    → Observer 记录审计日志 → Checkpoint 阻止阶段推进
流程错误（阶段提前推进）      → Interceptor 同步阻止，返回指导信息
测试失败（无测试证据）        → Reviewer 报告 H 级 finding → 阻止通过
语义问题（S/B/A）             → Reviewer 异步审查，返回 findings
```

### 4.4 事后验证模式

Watchdog 的质量检查分为两种模式：

| 模式 | 时机 | 能力 | 适用场景 |
|------|------|------|----------|
| **事前拦截** | Interceptor (onToolBefore) | 基于 path/state 判断，无法读取文件内容 | 阶段门控、代码类型拦截 |
| **事后验证** | Observer (onToolAfter) | 读取 args.content 和 output，做深度检查 | 语法验证、命令结果检查 |
| **审计门控** | Checkpoint (phase_complete) | 检查审计日志中的未修复违规 | 阶段推进阻止 |

**审计日志管理策略**：每个 pipeline run 使用独立审计日志；Checkpoint 阶段推进时将违规标记为 resolved；`getUnresolvedViolations()` 仅查询当前阶段未解决条目，避免日志无限增长影响查询性能。行为规范见 §3.0.2。

**违规解决机制**：`getUnresolvedViolations(severity, filter?)` 行为规范见 §3.0.2。设计意图：省略 filter 时返回所有匹配 severity 的未解决条目。Checkpoint 阶段推进成功时，自动将当前阶段所有 block 级违规标记为 `resolved: true`（upsert 语义）。Checkpoint phase_complete 自动 resolve 伪代码：`this.store.resolveViolations(projectId, runId, unresolved.map(v => v.timestamp))`。对于 OBSERVER_TIMEOUT：后续 Observer 成功执行（无超时）自动 resolve 前次 OBSERVER_TIMEOUT（在 handle() 中 recordTaskAndScan 之后、_handleObservations（Promise.race）之前检查是否存在未恢复的 OBSERVER_TIMEOUT 并标记 resolved）。

**COMMAND_FAILED / SYNTAX_ERROR_POST_WRITE / OBSERVER_TIMEOUT 自动恢复**：auto-resolve 过滤维度和 commandPattern 精确匹配行为见 §3.0.2。设计决策：normalizeCommand 统一 trim + 连续空白压缩为单空格，因此 `pytest -x` 和 `pytest  -x`（多余空格）匹配为同一命令。但 `pytest -x` 和 `pytest -v` 是不同命令（参数不同），各自维护独立违规状态。SYNTAX_ERROR_POST_WRITE 的 auto-resolve 使用 `{ tool: 'Write', filePath }` 过滤（无 commandPattern）。OBSERVER_TIMEOUT 自动恢复使用 `{ event: 'OBSERVER_TIMEOUT' }` 过滤，成功后重置 observerTimeoutCount。详见 §3.1.1 auto-resolve 代码。

**跨 key 违规追踪实现策略**：`resolveViolations` 的 key 分组、_sourceKey 定位、timestamp 匹配策略见 §3.0.2。设计决策：使用 `timestamps: string[]`（ISO 8601 字符串数组）作为条目定位键，与 getUnresolvedViolations 返回的 `AuditLogEntry.timestamp` 字段直接对应。调用方通过 `violations.map(v => v.timestamp)` 提取。

`getUnresolvedViolations` 行为规范（仅返回 `resolved !== true` 的条目）见 §3.0.2。

`resolveViolations` 并发安全：行为规范见 §3.0.2。设计补充：若 appendAudit 和 resolveViolations 在同一微任务队列中交替调用，StateStore 的 write 操作需保证原子性（单次 write 覆盖整个 key 值，非行级追加）。Phase 1 实现约束：resolveViolations 在 Observer handle() 内同步调用，与 appendAudit 无交错。

**severity=undefined 过滤语义**：行为规范见 §3.0.2。设计意图：只有 Observer 条目（显式设置 severity）参与门控决策。

**手动解决路径（Phase 1 新增）**：对于无法通过 auto-resolve 恢复的 block 级违规（如环境问题导致命令始终失败），提供 `tdd_checkpoint(event='force_resolve_violation', violation_type='COMMAND_FAILED', reason='...')` 逃生路径。该事件将指定类型的 block 级违规标记为 resolved 并记录 `force_resolved_reason` 字段到审计日志。强制解决不会降级违规严重性——审计日志保留完整违规记录 + 强制解决原因。Checkpoint 在阶段推进时检查强制解决的违规，写入 `FORCE_RESOLVED` 审计事件（severity='warn'）。⚠️ **权限控制**：`force_resolve_violation` 调用必须携带 `sessionId` 与 pipeline run 的 `ownerSessionId`（schema.ts:49 PipelineState 字段）匹配（由 CheckpointHandler 验证），防止跨会话静默清除违规记录。

### 4.5 规则配置机制

#### 配置文件
位置：`.watchdog/rules.json`（项目级）或 `~/.watchdog/rules.json`（用户级）

**与现有配置的关系**：`rule-config.ts`（Phase 1 新建）管理 Observer/Checkpoint 行为规则，从 `.watchdog/rules.json` 加载。`watchdog-config.ts`（现有）管理 Watchdog 整体配置（phase 序列、观察模式等），从 `.opencode/watchdog.jsonc` 加载。两者职责不重叠、文件不冲突。长期目标（Phase 5+）：合并为统一配置。

**RuleConfig 接口规范**（`packages/watchdog/src/rule-config.ts`，Phase 1 新建）→ 完整定义（RuleConfig interface + RulesFile interface + RuleConfigLoader class）见 §3.0.5

默认值策略：文件不存在 → 使用内置默认值（不打印警告）；文件格式错误 → 使用默认值 + 打印警告。

```json
{
  "version": 1,
  "rules": {
    "SYNTAX_CHECK_POST_WRITE": {
      "enabled": true,
      "severity": "block",
      "extensions": [".json", ".yaml", ".yml"]  // Phase 1 仅支持 JSON/YAML 验证。Phase 2 实现 TypeScript 验证时添加 ".ts", ".tsx"
    },
    "COMMAND_RESULT_CHECK": {
      "enabled": true,
      "severity": "warn",
      "ignoreExitCodes": [130],  // 130=SIGINT。注：exit code 1 不在默认忽略列表——它是命令失败的最常见错误码（构建失败、运行时错误等），不应默认忽略。仅对 grep/diff/test 等预期非零退出的命令，通过 ignoreCommands 模式排除或用户手动配置 ignoreExitCodes。
      "ignoreCommands": ["git log *", "man *"]  // ⚠️ 默认值使用 "git log *"（含空格）替代 "git log*"，避免匹配 "git logout" 等不相关命令。matchPattern 匹配完整命令字符串。若 glob 匹配粒度不足，建议实现命令名提取（split on first space）后再匹配。
    },
    "TEST_EVIDENCE_CHECK": {
      "enabled": true,
      "severity": "block"
      // Phase 2: Checkpoint 在 phase_complete 时检查此规则配置决定测试证据缺失时的严重性
    },
    // Interceptor 规则也通过 RuleConfig 配置 enabled/severity，但 Interceptor 不读取文件内容，配置仅控制规则启用/禁用
    "AC-3_BUSINESS_CODE_GATE": {
      "enabled": true,
      "severity": "block"
    },
    "AC-12_PHASE_GATE": {
      "enabled": true,
      "severity": "block"
    }
  }
  // observer 行为由各规则的 enabled 字段控制，无需顶层开关
}
```

#### 优先级
1. 项目级 `.watchdog/rules.json`（最高）
2. 用户级 `~/.watchdog/rules.json`
3. 内置默认值（最低）

#### 规则启用/禁用
- `enabled: false` → 规则跳过，不执行
- `severity: "warn"` → 记录但不阻止
- `severity: "block"` → 记录并阻止

#### 模式匹配语法
`ignoreCommands` 使用 glob 模式（`*` 匹配任意字符序列，`?` 匹配单个字符），实现使用 `minimatch` 库。

#### 配置校验
- Watchdog 启动时读取并校验 rules.json
- schema 不匹配 → 使用默认值 + 打印警告
- 运行时重新加载：不支持自动重载。手动触发：调用 `RuleConfigLoader.invalidateCache()` 后下次 `load()` 调用重新读磁盘（需通过 OpenCode 命令入口暴露）。当前阶段（Phase 1-2）不支持热重载，需重启 OpenCode 会话。未来可扩展 `reload_config` CheckpointEvent（当前未列入任何 Phase 产出物）。未配置命令入口前，需重启 OpenCode 会话。
- 缓存策略：Watchdog 启动时加载一次并缓存至内存，Observer handle() 内多次调用 `RuleConfigLoader.load()` 读缓存不读磁盘。⚠️ **缓存失效**：Phase 1-2 缓存无 mtime 校验——配置文件修改后需重启 OpenCode 会话才能生效。Phase 4 可扩展为每次 load() 检查 mtime（stat fs 操作，<1ms 开销）并按需失效。⚠️ **多项目假设**：static cache 假设单 OpenCode 实例对应单项目。若 OpenCode 支持多项目实例，需改为实例级 Map<projectId, RulesFile>。

---

## 5. 关键里程碑

| 里程碑 | 预期时间 | 验收标准 | 量化门槛 |
|--------|----------|----------|----------|
| M1: 机械验证上线 | Phase 1 结束 | Bash 失败检出 ≥95%，误拦截 ≤5%，语法拦截 100% | 通过 e2e + 回归测试 |
| M2: 测试门控上线 | Phase 2 结束 | 测试请求记录 100%，Reviewer 检出 100% | 通过 e2e + 集成测试 |
| ~~M3: 语义审查上线~~ | ~~Phase 3~~ | ~~S/B/A 提交正常~~ | ~~待定 — 非当期范围~~ |
| M3: intervention 合并 | Phase 4 结束 | 保留测试全通过，目录已清除，25 工具 | pytest + ls |
| M3-前置: Phase 4 新工具接口规格 | Phase 4 开始前 | 5 个新工具接口规格（参数名/类型/必填、返回值结构、错误码）补充到本文档 | 文档审查 |
| M4: 文档完善 | Phase 5 结束 | 6 份文档完成，README 一致 | 文档审查 |

### 时间估算

**当期主线（Phase 1→2→4→5）**：

| Phase | 乐观 | 预期 | 悲观 | 说明 |
|-------|------|------|------|------|
| Phase 1 | 1 周 | 2 周 | 3 周 | Observer 增强较简单，但性能测试可能需要调优 |
| Phase 2 | 1 周 | 2 周 | 4 周 | Checkpoint 测试门控需要与 Ralph Loop 集成 |
| Phase 4 | 1 周 | 2 周 | 3 周 | 合并较直接，但测试迁移可能有问题 |
| Phase 5 | 1 周 | 1 周 | 2 周 | 文档编写，风险低 |
| **当期总计** | **4 周** | **7 周** | **12 周** | 预期值基于中等经验水平 |

**延后（Phase 3 — 待独立需求文档论证）**：

| Phase | 乐观 | 预期 | 悲观 | 说明 |
|-------|------|------|------|------|
| Phase 3 | 2 周 | 3 周 | 5 周 | Schema 迁移 + tdd-pipeline skill 同步（需独立论证） |

**关键路径**: Phase 1 → Phase 2 → Phase 4（顺序依赖，Phase 4 可与 Phase 2 部分并行（并行范围：intervention 代码审查 + 测试迁移准备 + 新工具接口规格设计。非并行：新 MCP 工具实现需 Phase 2 审计日志基础设施就绪后开始））
**Phase 3 重新激活条件**: 现有 C/H/M 无法充分表达质量问题 + 有明确用户场景驱动

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Watchdog 规则误拦截 | 中 | 高 | 规则可配置（C-2 fix）、有禁用开关、渐进 rollout。注意：修改 rules.json 后需重启会话或调用手动重载。 |
| Observer 语法检查超时 | 低 | 中 | 20ms 超时保护，超时 fail-open |
| 测试证据检查被绕过 | 中 | 高 | Reviewer 每轮检查审计日志，主 Agent 无法跳过 |
| Reviewer 审查过严 | 中 | 中 | S/B/A severity 分级、配置化检查项 |
| Schema 迁移破坏旧数据 | 低 | 高 | 向后兼容测试（5 个用例）、v4 文件只读不改 |
| intervention 合并破坏现有功能 | 低 | 高 | 有状态模块删除（不合并）、保留测试、渐进迁移 |
| tdd-pipeline skill 不同步 | 中 | 中 | Phase 3 明确列出 3 个需更新的文件 |
| 文档过时 | 高 | 中 | 文档与代码同版本、Phase 5 专门验收 |
| 测试结果伪造 | 低 | 高 | TEST_RUN_COMPLETE 由主 Agent 通过 Watchdog 注册的 `tdd_checkpoint` OpenCode 工具写入，理论上可伪造。缓解：Reviewer 不仅检查事件存在性，还校验测试结果的结构化字段（pass/fail/error_summary）。长期方案：测试框架输出哈希校验。 |

---

## 7. 总结

**当期主线（Phase 1→2→4→5，预期 7 周）**：

```
当前:                               当期目标:
├─ Watchdog (2 Interceptor 规则)    ├─ Watchdog (2 Interceptor + 2 Observer 检查 + 审计日志门控)
├─ Ralph Loop (C/H/M/P/L/I)        ├─ Ralph Loop (+ 测试证据检查，severity 不变)
├─ Aristotle MCP (20 工具)         ├─ Aristotle MCP (25 工具，含 KI 文档 + Git 回滚 + stash 清理，全部无状态)
└─ intervention/ (孤立，有状态)     └─ intervention/ (删除，有状态模块不合并)
```

**延后（Phase 3，待独立需求文档）**：

```
未来目标（需论证）:
└─ Ralph Loop (+ S/B/A 语义审查维度，用现有 severity 标注)
   └─ Schema 迁移（25+ 处改动）需独立 Phase 需求文档
```

**核心目标**：
1. ✅ LLM 明显错误（语法、命令失败）→ **Observer 记录 → Checkpoint 阻止**
2. ✅ LLM 测试未执行 → **Reviewer 检查审计日志 → H 级 finding → 阻止通过**
3. ⏳ LLM 语义/逻辑错误 → **Reviewer 审查维度扩展（用 C/H/M 标注）** — Schema 扩展待定
4. ✅ 操作统一入口 → **Aristotle MCP 25 工具（全部无状态）**
5. ✅ 规则可配置 → **`.watchdog/rules.json` 项目级/用户级**
6. ✅ 文档完善 → **6 份核心文档**

**当期工期：预期 7 周（Phase 1→2→4→5）。Phase 3 待定。**

---

## 附录 A: Pass 1 Review 修改记录

**Pass 1 Fixes 应用于 v1.0 → v1.1**，12 个 findings 全部修复：

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| C-1 | Critical | 每个 Phase 增加量化验收标准表 | 3.1-3.5, 5 |
| C-2 | Critical | 新增 Section 4.5 规则配置机制 | 4.5 |
| H-2 | High | Phase 3 完全重写（调度、Schema、Prompt、Skill 同步） | 3.3 |
| M-1 | Medium | 语法检查从 Interceptor 移到 Observer | 3.1, 4.4 |
| M-2 | Medium | 测试运行改为 Checkpoint 审计日志检查 | 3.2 |
| M-3 | Medium | intervention 合并前增加状态模型统一策略 | 3.4 |
| M-4 | Medium | Schema v4→v5 迁移方案 + 5 个测试用例 | 3.3 |
| M-5 | Medium | 同步/异步超时具体值表 | 4.2 |
| L-1 | Low | 文档命名统一为 `{系统名}-{类型}.md` | 3.5 |
| L-2 | Low | Phase 时间改为三点估算 | 5 |
| I-1 | Info | 架构图补充 KI/回滚数据流 | 2.1 |
| I-2 | Info | MCP 工具数修正为 26 | 3.4 |

## 附录 B: Pass 2 Independent Review 修改记录

**Pass 2 由 Oracle 独立审查（session: ses_18f00ac6effeXWjpTgvKDjNHES）**

### Pass 2 自审（v1.1 → v1.2，4 findings，已在 Oracle 审查前应用）

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| Self-1 | Medium | A (Acceptable) 维度检查项从 4 补足到 5（+团队能力/维护成本），满足 ≥5 验收标准 | 3.3.3, 3.3.4 |
| Self-2 | Low | "新增 3 工具" 标题数字修正为 "新增 4 工具" | 3.4.3 |
| Self-3 | Info | 架构图 "规则生命周期（22 工具）" 与 "工作流编排（7 工具）" 合并（7 是 22 的子集） | 2.1 |
| Self-4 | Info | Schema 迁移措辞精确化："内存中升级，磁盘上只读不改" | 3.3.2 |

### Pass 2 Oracle 独立审查（v1.2 → v1.3，5 findings）

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| P2-1 | Medium | Observer 代码示例补充 YAML 验证分支（与 §4.5 config 的 extensions 对齐） | 3.1.1 |
| P2-2 | Low | "30s 硬限制"改为"Reviewer 检查周期"（Watchdog 不运行测试，超时由 Reviewer 审计日志检查间接生效） | 3.2.3, 4.2 |
| P2-3 | Low | 添加本附录 B（Pass 2 修改记录，此前缺失） | 附录 B |
| P2-4 | Info | `commit_rule_with_guard` 在合并表中标注为增强 commit_rule（非新工具） | 3.4.1 |
| P2-5 | Info | "243 测试"改为"intervention 保留模块的测试（以实际迁移时计数为准）" | 3.4.4 |

**Pass 2 结论**: PASS WITH MINOR NOTES。5 个 findings 全部非阻塞，已修复。

## 附录 C: Pass 2 第二轮独立审查修改记录

**第二轮独立审查由 Sisyphus-Junior (deep category) 执行（session: ses_18ee02c6effeSZfh54I7s3xz5O）**

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F1 | Medium | MCP 当前工具数从 22 修正为 20（实际验证 `mcp._tool_manager._tools` = 20） | 1.1, 2.1, 3.4.3 |
| F2 | Low | `violation_filter.py` 修正为 `watchdog.py`（ViolationFilter 19 行实际在 watchdog.py 中） | 3.4.2 |
| F3 | Low | `fire_o` 标注为 Bridge Plugin 方法（非 MCP 工具），解释 20 vs 22 差异 | 3.4.3 |
| F4 | Medium | 工具计数全文修正：22→20 当前，26→24 合并后 | 3.4.3, 3.4.5, 3.5.1, 5, 7 |
| F5 | Info | Pass 2 自审 4 findings 补充记录到附录 B（此前缺失） | 附录 B |
| F6 | Info | 版本状态更新为 "两轮独立审查完成" | Header |

**第二轮独立审查结论**: PASS WITH MINOR NOTES。6 个 findings 全部非阻塞，已修复。核心发现是工具计数事实性错误（F1+F4），根因是未对照运行中 MCP 服务器验证。

## 附录 D: Pass 2 第三轮独立审查修改记录

**第三轮独立审查由 Sisyphus-Junior (deep category) 执行（session: ses_18dd8cfa3ffeG7u2AkqD1GDA3g）**

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| NF-1 | Medium | 工具清单重写：移除 3 个 Bridge Plugin 方法（fire_o, check_workflow, abort_workflow），添加 on_undo，分类列出，精确 20 个 MCP 工具 | 3.4.3 |
| NF-2 | Low | 删除列表中去重：watchdog.py 和 violation_filter.py 是同一文件，合并为一条 | 3.4.2 |
| NF-3 | Info | 数据流图 "7 工具" 更新为 "6 MCP 工具 + 3 Bridge 方法" | 2.1.1 |
| NF-4 | Info | 附录 A 历史记录保留原样（26 是当时修正值，后被 F4 再修正为 24，作为历史记录不加注脚） | 附录 A |

**第三轮独立审查结论**: PASS WITH MINOR NOTES。4 个 findings 全部非阻塞，已修复。核心发现是工具清单与实际 `mcp.tool()` 注册不一致（F1 修正了数字但未修正枚举列表）。

## 附录 E: Pass 5 独立审查修改记录（v1.4 → v1.5）

**Pass 5 由 Sisyphus-Junior (deep category) 执行（session: ses_18983da17ffeYX0wB4TutkxGZO）**

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F5-01 | Critical | SEV_ORDER 保留现有 C:5/H:4/M:3/P:2/L:1/I:0 不变，S=8 插入最高，B=4 与 H 同级；添加审计说明 | 3.3.2 |
| F5-02 | Critical | 新增 `VALID_SEVERITIES` Set 更新代码示例，含 S/B/A | 3.3.2 |
| F5-03 | High | `FindingSubmission.severity` 联合类型显式扩展为含 S/B/A 的 9 值联合 | 3.3.2 |
| F5-04 | High | `RoundRecord.counts` 类型扩展含 S/B/A + transitions.ts 初始化更新 | 3.3.2 |
| F5-05 | Medium | `getUnresolvedViolations(severity: 'block')` 改为 `getUnresolvedViolations('block')`（TypeScript 位置参数） | 3.1.1 |
| F5-06 | Medium | `readState()` 迁移改为补缺失字段模式（不改 version），与 pipeline-store.ts 实际模式对齐 | 3.3.2 |
| F5-07 | Medium | git_ops.py 合并表增加"追加到现有文件，不修改已有函数"说明 + 新增 Git 操作列表 | 3.4.1 |
| F5-08 | Medium | RuleGenerator 从"合并到 MCP"改为"删除"，消除表/列表矛盾（模板生成由 Reviewer prompt 替代） | 3.4.0 |
| F5-09 | Medium | Observer handle() 移除 `return { warning }` 返回值（实际接口为 Promise<void>），改为纯审计日志记录 | 3.1.1 |
| F5-10 | Medium | 语法检查从 `Write \|\| Edit` 收窄为仅 `Write`（Edit 的 newString 是片段，语法检查不可靠）；属性名修正为 filePath | 3.1.1 |
| F5-11 | Low | intervention 删除列表补充 `committer.py`（31 行，功能被 commit_rule 覆盖） | 3.4.2 |
| F5-12 | Low | 新增 consecutiveZero 行为规范：S/B 重置（等同 C/H/M），A 不重置（等同 P/L/I） | 3.3.2 |
| F5-13 | Low | 误报率验收标准补样本量："≥30 个 S/B/A findings，不足 30 时全量" | 3.3.7 |
| F5-14 | Info | RuleConfig 类明确位置：`packages/watchdog/src/rule-config.ts` | 3.1.2 |
| F5-15 | Info | Phase 3/4 并行开发但合并顺序建议：Phase 3 先入 main | 5 |

**Pass 5 结论**: 15 findings（2C + 2H + 6M + 3L + 2I）全部修复。核心发现是 Phase 3 S/B/A severity 集成方案不完整 — VALID_SEVERITIES Set、FindingSubmission 联合类型、RoundRecord.counts 类型、SEV_ORDER 重编号影响均未在原始代码示例中体现。根因是 schema 迁移设计时只考虑了顶层类型别名，未追踪所有消费该类型的下游接口。

## 附录 F: Pass 6 TDD Ralph Review Loop 审查修改记录（v1.6 → v1.7）

**Pass 6 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Pipeline Ralph Review Loop — Recall Pass（Oracle 独立扫描 30 findings）→ Fact-Gathering（主代理代码验证 19 项事实）→ Precision Filter（Oracle 过滤至 22 confirmed findings）→ 主代理评估修复。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | Medium | Observer/Checkpoint 代码示例添加"⚠️ 拟实现代码，非当前实现"标注 | 3.1.1 |
| F-02 | Medium | Checkpoint 门控增强代码示例添加拟实现标注 | 3.1.1 |
| F-03 | Medium | 新增 CheckpointEvent 类型扩展产出物（observer_timeout, test_run_requested, test_run_complete, command_failed, syntax_error_post_write） | 3.1.2, 3.2.2 |
| F-04 | Medium | P99 性能阈值验收标准补充测试框架（vitest benchmark）、样本量（1000 次）、环境规格（Node.js 20.x, Apple M1） | 3.1.3 |
| F-05 | Medium | §3.4.0 合并前置条件表补充 intervention_types.py（删除）和 __init__.py（删除） | 3.4.0 |
| F-07 | Medium | 误拦截率验收标准补充"合法操作"白名单定义 | 3.1.3 |
| F-09 | **High** | CommitGuard 从"增强到现有工具"改为"拆分处理"：自动提交功能删除（有状态依赖，与 MCP 无状态原则冲突），仅保留 schema 校验内联到 commit_rule | 3.4.0, 3.4.1 |
| F-10 | Low | 4 个新 MCP 工具添加注：接口规格在 Phase 4 前补充 | 3.4.3 |
| F-11 | Low | skip_guard 参数明确默认值 false | 3.4.3 |
| F-12 | **High** | Observer fail-open/fail-closed 防御闭环设计：Observer 超时时写入 observer_timeout 审计事件（severity=block），Checkpoint 检查该事件阻止推进 | 4.2 |
| F-13 | Medium | RuleConfig 添加完整接口规范（RuleConfig interface + RulesFile interface + RuleConfigLoader class）+ 默认值策略 | 4.5 |
| F-15 | Medium | Schema 迁移代码示例从 fs.readFileSync 修正为 this.stateStore.read()（与实际 pipeline-store.ts 对齐） | 3.3.2 |
| F-16 | Low | MCP 工具数验收标准补充自动化断言命令 | 3.4.5 |
| F-18 | Medium | rollback_to_checkpoint 补充 stash 失败处理（阻止 rollback）、使用 --include-untracked、stash 堆积管理（上限 5 个） | 3.4.1 |
| F-19 | Low | committer.py 删除理由修正为"schema 校验逻辑将内联增强到 MCP commit_rule" | 3.4.2 |
| F-20 | **High** | RollbackEngine 合并策略明确为"简化合并"：MCP 只提供通用 git reset，violation-specific 策略由 Watchdog TypeScript 侧组合实现。补充影响分析（TDD 安全网影响可接受） | 3.4.0, 3.4.1 |
| F-21 | Info | intervention 版本标注从"待合并"改为"待裁剪合并，Phase 4 处理" | 1.1 |
| F-25 | **High** | Phase 2 审计日志查询集成路径定义：(1) Watchdog 暴露 readAuditLog 方法 (2) 主 Agent 在派发 Reviewer 前查询并注入 prompt (3) 备选：文件路径约定。作为 Phase 2 前置依赖 | 3.2.2 |
| F-28 | Low | Bridge Plugin 方法列表同时标注实际注册名和简称 | 3.4.3 |
| F-29 | Low | tdd-pipeline 同步风险缓解：同一维护者仓库，不阻塞当期主线 | 3.3.5 |
| F-08 | Low | KI/回滚数据流添加"⏳ 待实现，Phase 4"标注 | 2.1.1 |

**Pass 6 结论**: 22 findings（4H + 12M + 5L + 1I）全部修复。核心发现集中在两个结构性缺陷：

1. **无状态化边界不清**（F-09, F-20）：CommitGuard 和 RollbackEngine 的有状态依赖未在合并方案中显式处理。修复：明确标注自动提交/精确回滚为"删除"或"由 TypeScript 侧承担"，MCP 只保留无状态操作。

2. **跨系统集成点缺失**（F-12, F-25）：Observer fail-open 与 Checkpoint fail-closed 之间存在 bypass 路径；Phase 2 测试门控依赖 Watchdog→Reviewer 数据桥接，但集成接口完全未定义。修复：添加 observer_timeout 审计事件闭环设计；定义审计日志查询集成路径。

根因：前 5 轮审查聚焦于工具计数、Schema 兼容、代码示例等局部准确性，未系统审查跨系统职责边界和数据流完整性。TDD Ralph Review Loop 的双通道（Recall+Precision）+ 代码事实验证方法有效覆盖了这一盲区。

## 附录 G: Pass 7 Round 2 TDD Ralph Review Loop 修改记录（v1.7 → v1.8）

**Pass 7 Round 2 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Pipeline Ralph Review Loop Round 2 — Recall（27 findings）→ Fact-Gathering（25 verified facts）→ Precision Filter（20 confirmed，合并 7）→ 主代理评估（19 ADOPT, 0 REJECT）→ 全部修复。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| G1/F-27 | **High** | CheckpointEvent 与 AuditLogEntry 严格分离；审计事件统一 SCREAMING_SNAKE_CASE；明确 Phase 1/2 分期策略 | 3.1.2, 3.2.2 |
| F-28 | **High** | Observer 统一标注为"同步"（§4.2 架构图） | 4.2 |
| F-29 | **High** | RuleConfig.load() → RuleConfigLoader.load()（与 §4.5 接口一致） | 3.1.1 |
| G2/F-32 | **High** | 审计日志端到端机制定义：写入者（tdd_checkpoint）、存储（PipelineStore）、读取（OpenCode 自定义工具注册）、跨语言桥接、选型标准 | 3.2.2 |
| F-31 | Medium | Observer handle() 添加超时保护代码示例（Promise.race + OBSERVER_TIMEOUT 事件） | 3.1.1 |
| F-36 | Medium | §3.4.5 新增 AC-7：commit_rule 行为兼容验证 | 3.4.5 |
| F-37 | Medium | 明确 CommitGuard 与 AutoCommitter 共用同一 validate_schema 函数 | 3.4.2 |
| F-38 | Medium | 性能预算添加输入规模约束（≤100KB），超出跳过并记录 warn | 3.1.3 |
| G3/F-39 | Medium | 新增辅助函数规范：extractExitCode、quickSyntaxCheck、yamlSyntaxCheck | 3.1.1 |
| G4/F-41 | Low | 删除 InterventionCoordinator 重复行；§3.4.0 添加"完整列表见 §3.4.2" | 3.4.0 |
| F-42 | Medium | "审查周期"量化为 60 秒 SLA | 3.2.3 |
| F-43 | Medium | AC-2 移除 CommitGuard 测试引用，指向 AC-7 | 3.4.5 |
| F-44 | Medium | stash 堆积改为"返回警告（非错误）" | 3.4.1 |
| F-45 | Low | §2.1 KI/回滚行添加 Phase 4 标注 | 2.1 |
| F-46 | Low | TEST_EVIDENCE_CHECK 添加消费者说明注释 | 4.5 |
| F-47 | Low | AC-3/AC-12 RuleConfig 添加说明注释 | 4.5 |
| F-48 | Low | 空白文件 trim() 检查 + 注释更新 | 3.1.1 |
| F-52 | Info | S/B/A → C/H/M 映射表 | 3.3.3 |
| F-53 | Info | §3.4.1 表格单元格提取为独立段落 | 3.4.1 |

**Pass 7 Round 2 结论**: 20 findings（4H + 11M + 4L + 1I）全部修复。核心发现：
1. **类型边界模糊**（G1/F-27）：CheckpointEvent 与 AuditLogEntry 混淆导致事件大小写混乱和分期策略不清。
2. **端到端机制空白**（G2/F-32）：审计日志从写入到读取的完整链路未定义，Phase 2 核心功能的实现路径缺失。
3. **标注不一致**（F-28, F-29）：同步/异步属性和类名在不同章节间自相矛盾。

## 附录 H: Pass 8 TDD Ralph Review Loop Round 3 修改记录（v1.8 → v1.9）

**Pass 8 Round 3 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Pipeline Ralph Review Loop Round 3 — Recall → Fact-Gathering → Precision Filter → 主代理评估 → 全部修复。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | Observer 文件写入语法验证改用 config.extensions 过滤（取代硬编码后缀检查），合并 100KB 文件大小检查（F-02），统一 content?.trim() 为单次前置守卫 | 3.1.1 |
| F-02 | **High** | 合并入 F-01：100KB 文件大小检查，超出跳过并记录 warn 级审计事件 FILE_TOO_LARGE_FOR_CHECK | 3.1.1 |
| F-03 | **High** | 新增 AuditLogEntry 接口定义（packages/watchdog/src/schema.ts），含 event/severity/violation 及 Phase 2 扩展字段（phase/timestamp/pass/fail/error_summary）。明确 severity 与 FindingSeverity 的概念区分 | 3.1.2 |
| F-04 | **High** | Phase 3 S/B/A 提交格式明确当期使用 C/H/M（参见 §3.3.3 映射表），S/B/A 在 Schema v5 迁移后启用。AC-2 标注依赖 Schema v5，AC-3 误报率标注依赖 Schema v5 | 3.3.4, 3.3.7 |
| F-05 | **High** | Phase 2 产出物新增 read_audit_log OpenCode 自定义工具注册 + 降级方案 runId 传递机制（文件路径约定） | 3.2.2 |
| F-06 | Medium | BUSINESS_CODE_PHASE 常量注释明确值为 5、来源为 watchdog/src/constants.ts、Watchdog 使用 TDD pipeline phase 编号 | 3.2.1 |
| F-07 | Medium | skip_guard 安全约束：每次调用自动写入审计日志（GUARD_BYPASSED），CI/CD 环境变量 ARISTOTLE_CI=true 时默认 true | 3.4.3 |
| F-08 | **High** | fail-open/fail-closed 术语精确化：新增 "fail-open for current call, fail-closed at gate" 定义。Observer 超时行为描述更新为引用防御闭环设计 | 4.2 |
| F-09 | Medium | Phase 1 新增运行时依赖列表：typescript（需确认是否从 devDependency 移至 dependencies）、js-yaml、minimatch | 3.1.2 |
| F-10 | Medium | SLA 从 60 秒修正为 90 秒，取上限而非中位数作为基准 | 3.2.3 |
| F-11 | Medium | Ralph Loop 边界条件修正：无 round cap，持续迭代直到所有 finding 解决。强制终止时 Checkpoint 保留未解决违规记录 | 3.2.1 |
| F-12 | Medium | 新增 matchPattern 辅助函数规范：依赖 minimatch 库，用于 COMMAND_RESULT_CHECK 的 ignoreCommands 过滤 | 3.1.1 |
| F-14 | Medium | AC-4 自动化断言添加内部 API 依赖风险提示 + 降级方案（mcp CLI tools/list JSON-RPC） | 3.4.5 |
| F-15 | Medium | RulesFile 接口移除冗余 observer 顶层字段（统一通过 rules.X.enabled 控制）。默认 JSON 移除 observer section，添加注释说明 | 4.5 |
| F-16 | Medium | 违规解决机制定义：getUnresolvedViolations 查询未标记 resolved 条目，Checkpoint 阶段推进成功时自动标记 resolved: true | 4.4 |
| F-18 | Medium | 审计日志生命周期：归档后保留 7 天，单个文件最大 10MB 自动轮转 | 3.2.2 |
| F-20 | Medium | 精确回滚实现路径标注为 Phase 4+ 设计：Watchdog → rollback_to_checkpoint → write_rule 组合调用 | 3.4.1 |
| F-22 | Medium | 运行时重载从"不支持"改为"不支持自动重载，手动触发 invalidateCache"。风险缓解表更新需重启会话或手动重载提示 | 4.5, 6 |
| F-23 | Medium | 4 个新工具接口规格标注为 Phase 4 TDD 前置任务，强调先有接口规格才能编写测试 | 3.4.3 |
| F-24 | Low | Reviewer 测试证据检查添加时间窗口说明：首次无 TEST_RUN_COMPLETE 报告 M 级，下一轮仍未完成升级为 H 级 | 3.2.1 |
| F-30 | Low | __init__.py 描述从"版本标记"修正为"包初始化（随目录整体删除）" | 3.4.2 |
| F-33 | Low | Phase 2/4 并行范围明确：并行（代码审查+测试迁移准备+接口规格设计），非并行（新工具实现需 Phase 2 审计日志就绪） | 5 |
| F-34 | Low | 风险表新增测试结果伪造风险行：低概率高影响，缓解为 Reviewer 校验结构化字段，长期方案测试框架输出哈希校验 | 6 |

**Pass 8 Round 3 结论**: 23 findings（5H + 13M + 4L + 1I）全部修复。核心发现：

1. **配置驱动 vs 硬编码**（F-01）：Observer 语法验证使用硬编码后缀检查，与 §4.5 配置机制矛盾。修复：改用 config.extensions 过滤，同时合并文件大小检查。

2. **接口定义缺失**（F-03）：AuditLogEntry 作为核心数据结构未在文档中定义接口，导致 severity 概念与 FindingSeverity 混淆。修复：添加完整接口定义并明确概念区分。

3. **当期/未来边界模糊**（F-04）：Phase 3 S/B/A 提交格式未明确当期使用 C/H/M 替代，AC 验收标准隐含依赖未实施的 Schema v5。修复：显式标注当期替代方案和依赖关系。

## 附录 I: Pass 9 TDD Ralph Review Loop Round 4 修改记录（v1.9 → v1.10）

**Pass 9 Round 4 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Pipeline Ralph Review Loop Round 4 — Recall → Fact-Gathering → Precision Filter → 主代理评估 → 全部修复。

**根因集群**: RC-1 (DesignDoc-Impl Divergence) — 8 findings where design doc describes interfaces/methods/paths that don't match actual code。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | AuditLogEntry 接口添加 Migration Note：Phase 1 扩展非替换，保留 decision 字段，建议 ObserverAuditEntry extends AuditLogEntry 类型 | 3.1.2 |
| F-02 | **High** | 所有 appendAudit 调用从单参数对象改为 3-param 签名 `(projectId, runId, entry)`。Observer 中通过 `this.cache.get()` 获取 PipelineState（非 `getActiveRun()`），Checkpoint 中通过 `this.store.getActiveRun(projectId)` 获取 ActiveRun（需 null guard） | 3.1.1, 3.2.1 |
| F-03 | **High** | `getUnresolvedViolations` 标注为 Phase 1 需新增到 PipelineStore 的方法（实现说明 + 添加到 §3.1.2 产出物列表） | 3.1.1, 3.1.2 |
| F-13 | **High** | commit_rule 审计日志从跨进程写入 Watchdog StateStore 改为 MCP 侧自维护 `.aristotle/audit.jsonl`，Watchdog Phase 4 通过 `readMcpAuditLog()` 聚合 | 3.4.3 |
| F-04 | Medium | BUSINESS_CODE_PHASE 注释从"定义于 constants.ts"改为"// TODO: Phase 2 新增到 watchdog/src/constants.ts" | 3.2.1 |
| F-05 | Medium | .ts 文件验证扩展为 `.ts` + `.tsx`，添加 TSX 兼容注释 | 3.1.1 |
| F-07 | Medium | 审计日志存储路径从 `.watchdog/audit/{runId}.jsonl` 改为 StateStore 抽象层 `watchdog/${projectId}/${runId}/audit` | 3.2.2 |
| F-08 | Medium | `recordTaskAndScan` 标注为拟提取的私有方法，封装现有调用序列 | 3.1.1 |
| F-12 | Medium | B:H 同 SEV_ORDER 值澄清：处理优先级相同，按发现顺序处理，用 finding.category 路由 | 3.3.2 |
| F-25 | Medium | AuditLogEntry 接口添加 `resolved?: boolean` 和 `resolvedAt?: string` 字段 | 3.1.2 |
| F-09 | Low | 审计日志 TTL 标注为 Phase 2+ 运维特性，当前无限增长 | 3.2.2 |
| F-10 | Low | 降级方案 runId 传递改用 StateStore 已知 key `watchdog/${projectId}/active`，无需额外文件 | 3.2.2 |
| F-14 | Low | consecutiveZero 测试证据时间窗口说明：TEST_RUN_REQUESTED 存在但 TEST_RUN_COMPLETE 未写入时视为 pending H 级 | 3.2.1 |
| F-19 | Low | quickSyntaxCheck 添加轻量替代方案评估建议（acorn ~100KB），Phase 1 可先仅支持 JSON/YAML | 3.1.1 |
| F-21 | Low | RuleConfigLoader static cache 添加单项目假设说明 | 4.5 |
| F-26 | Low | tdd_checkpoint 从"MCP 工具"修正为"Watchdog 注册的 OpenCode 工具" | 3.2.2 |

**Pass 9 Round 4 结论**: 16 findings（4H + 6M + 6L）全部修复。核心发现：

1. **AuditLogEntry 接口分歧**（F-01, F-25）：文档定义的 severity/event 字段与实际 schema.ts 的 decision 字段不一致，且缺少违规解决机制所需的 resolved 字段。修复：添加 Migration Note 明确扩展策略 + 补充 resolved/resolvedAt 字段。

2. **API 签名不匹配**（F-02, F-03）：所有 appendAudit 调用使用单参数形式，但实际签名为 3 参数；getUnresolvedViolations 引用不存在的方法。修复：全部改为 3-param + 标注为需新增方法。

3. **跨进程边界**（F-13）：MCP Python 侧直接写入 Watchdog TypeScript 侧 StateStore 的机制未定义。修复：改为 MCP 侧自维护审计日志 + Phase 4 聚合方法。

4. **路径/类型不一致**（F-04, F-05, F-07, F-08）：多处代码示例引用不存在的常量定义位置、缺少 .tsx 验证分支、存储路径与实际不符、方法未标注为拟提取。修复：逐一标注 TODO/拟提取/实际路径。

## 附录 J: Pass 10 TDD Ralph Review Loop Round 5 修改记录（v1.10 → v1.11）

**Pass 10 Round 5 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Pipeline Ralph Review Loop Round 5 — Recall → Fact-Gathering → Precision Filter → 主代理评估 → 全部修复。

**根因集群**: RC-1 (DesignDoc-Impl Divergence，持续), RC-2 (Timeout Deadlock，新增), RC-3 (Severity Enum Confusion)。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | `v.message` → `v.violation`（AuditLogEntry 接口字段名修正） | 3.1.1 |
| F-03 | **High** | OBSERVER_TIMEOUT 死锁解决路径：后续 Observer 成功自动 resolve + Checkpoint 推进本身作为恢复信号；违规解决机制更新为 upsert 语义 | 4.2, 4.4 |
| F-04 | **High** | §3.3.1 调用流程添加"⚠️ Schema v5 目标，当期使用 C/H/M"标注 | 3.3.1 |
| F-05 | **High** | `function readState(...)` 移除 `function` 关键字，改为类方法声明 | 3.3.2 |
| F-06 | Medium | `readMcpAuditLog()` 添加接口定义说明（Phase 4 新增，返回 `Promise<McpAuditEntry[]>`） | 3.4.3 |
| F-09 | Medium | 职责边界表 KI 管理和 Git 回滚添加"⏳ Phase 4"标注 | 2.2 |
| F-11 | Medium | `finding.category` 改为"Schema v5 扩展 FindingSubmission 添加 category 字段"，当期不区分 | 3.3.2 |
| F-13 | Medium | CI 环境下 `skip_guard` 默认改为 false（CI 应验证而非跳过） | 3.4.3 |
| F-16 | Medium | 降级方案添加运行时自动检测机制 + `DEGRADATION_MODE_ACTIVATED` 审计事件 | 3.2.2 |
| F-26 | Medium | RuleConfigLoader reload 添加 Phase 1-2 不支持热重载说明 + Phase 4 入口 | 4.5 |
| F-07 | Low | 未知扩展名行为注释：通过 extensions 过滤后不验证，需同时添加验证分支 | 3.1.1 |
| F-08 | Low | TEST_RUN_COMPLETE 工具类型从"MCP 工具"修正为"Watchdog 注册的 tdd_checkpoint OpenCode 工具" | 6 |
| F-12 | Low | 违规解决从"追加 OR 更新"改为明确 upsert 语义（更新原条目 resolved: true + resolvedAt） | 4.4 |
| F-15 | Low | AuditLogEntry 接口差异说明：文档目标 vs 当前实现（event 联合类型、timestamp ISO string、phase 必填） | 3.1.2 |

**Pass 10 Round 5 结论**: 14 findings（4H + 6M + 4L）全部修复。核心发现：

1. **OBSERVER_TIMEOUT 死锁**（F-03）：防御闭环设计中 Checkpoint 阻止推进与违规仅在"成功推进时"解决形成循环依赖。修复：添加 Observer 成功自动 resolve 路径 + Checkpoint 推进作为恢复信号的双重解决机制。

2. **Severity 枚举矛盾**（F-04）：§3.3.1 调用流程使用 S/B/A 但 §3.3.4 明确"当期使用 C/H/M"。修复：在 §3.3.1 添加目标/当期标注。

3. **接口/字段名不匹配**（F-01, F-05）：代码示例使用不存在的字段名 (`message` vs `violation`) 和不合适的函数声明形式。修复：对齐实际接口定义。

## 附录 K: Pass 11 TDD Ralph Review Loop Round 6 修改记录（v1.11 → v1.12）

**Pass 11 Round 6 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Pipeline Ralph Review Loop Round 6 — Recall → Fact-Gathering → Precision Filter → 主代理评估 → 全部修复。

**根因集群**: RC-4 (Violation Resolution Deadlock — COMMAND_FAILED/SYNTAX_ERROR_POST_WRITE 无恢复路径), RC-2 (Timeout Deadlock 残留 — OBSERVER_TIMEOUT 推进即恢复与 fail-closed at gate 矛盾), RC-5 (Interface Gap — tdd_checkpoint 缺少 test_result 参数定义)。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | COMMAND_FAILED/SYNTAX_ERROR_POST_WRITE 违规解决死锁：新增自动恢复路径（后续同命令/同文件成功时自动 resolve 前次 block 级违规）。Observer handle() 开头添加 auto-resolve 注释 | 4.4, 3.1.1 |
| F-02 | **High** | OBSERVER_TIMEOUT 移除"推进即恢复"路径，改为 fail-closed at gate 原则：OBSERVER_TIMEOUT 保持 block 阻止推进，开发者需重新执行或标记 failed | 4.2 |
| F-03 | **High** | tdd_checkpoint 扩展接口定义：`test_result?: { pass, fail, error_summary }` 参数，event='TEST_RUN_COMPLETE' 时必填。§3.2.3 新增 AC-5 | 3.2.2, 3.2.3 |
| F-04 | Medium | McpAuditEntry 接口定义：`{ event, timestamp, details, source: 'mcp' }` | 3.4.3 |
| F-05 | Medium | 双审计日志聚合策略：Phase 1-3 门控基于 Watchdog 侧日志，MCP 侧仅追溯，Phase 4 聚合查询 | 3.4.3 |
| F-06 | Medium | REVIEWER_SPAWNED 审计事件添加到 Phase 3 待定事件列表 | 3.1.2 |
| F-10 | Medium | CheckpointGateResult 接口定义：`{ blocked, reason?, violations? }` | 3.1.2 |
| F-12 | Medium | 审计日志轮转时 getUnresolvedViolations 扫描所有 audit* key 前缀 | 4.4 |
| F-13 | Medium | 降级方案 runId 传递：pipeline_status 扩展返回 runId 或 StateStore 文件路径读取或 tdd_checkpoint 响应附带 | 3.2.2 |
| F-14 | Medium | MCP 侧审计日志并发安全：append-only JSONL 原子写入，容忍末尾不完整行，不使用文件锁 | 3.4.3 |
| F-17 | Medium | AC-3 白名单扩展：预期非零退出码命令（grep/diff/test）通过 ignoreExitCodes 排除 | 3.1.3 |
| F-08 | Low | extractExitCode fallback=1 为 fail-safe 默认值，覆盖率不足时改用 fallback=0 | 3.1.1 |
| F-09 | Low | quickSyntaxCheck Phase 1 决策：仅支持 JSON/YAML，TypeScript 延后 Phase 2，移除 typescript 运行时依赖 | 3.1.1 |
| F-16 | Low | Phase 3 AC 分为两组：当期可执行（AC-1, AC-4）和 Schema v5 迁移后（AC-2, AC-3, AC-5） | 3.3.7 |
| F-18 | Low | commit_rule 调用方影响分析：正常流程无影响，直接 MCP 调用需 skip_guard=true | 3.4.3 |
| F-19 | Low | Observer setTimeout 精度说明：非精确计时，AC-5 P99 测量实际执行时间 | 3.1.1 |
| F-20 | Low | Phase 2 Checkpoint 代码添加 TEST_EVIDENCE_CHECK 配置读取 | 3.2.1 |
| F-21 | Low | stash 硬上限：超过 10 个阻止 rollback | 3.4.1 |
| F-22 | Low | AC-5 P99 范围澄清：统计所有场景，≤100KB 场景单独记录 | 3.1.3 |
| F-25 | Low | 降级检测方法：try/catch registerTool + StateStore degraded key 暴露 | 3.2.2 |

**Pass 11 Round 6 结论**: 21 findings（3H + 9M + 9L）全部修复。核心发现：

1. **违规解决死锁**（F-01）：COMMAND_FAILED 和 SYNTAX_ERROR_POST_WRITE 的 block 级违规仅在 Checkpoint 成功推进时 resolve，但 Checkpoint 被这些违规阻止推进 → 死锁。修复：新增"后续同命令/同文件成功时自动 resolve"路径。

2. **OBSERVER_TIMEOUT 矛盾**（F-02）："推进即恢复"与 fail-closed at gate 原则矛盾——若允许推进恢复，则 block 语义失效。修复：移除推进即恢复路径，OBSERVER_TIMEOUT 只能通过显式恢复（重新执行成功）或标记 failed 解决。

3. **tdd_checkpoint 接口缺口**（F-03）：Phase 2 需要 TEST_RUN_COMPLETE 携带测试结果，但 tdd_checkpoint 接口未定义 test_result 参数。修复：新增扩展接口定义和 AC-5 验收标准。

## 附录 L: Pass 12 TDD Ralph Review Loop Round 7 修改记录（v1.12 → v1.13）

**Pass 12 Round 7 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Pipeline Ralph Review Loop Round 7 — Recall → Fact-Gathering → Precision Filter → 主代理评估 → 全部修复。

**根因集群**: RC-1 (DesignDoc-Impl Divergence — 持续 4 轮，Observer 代码示例与 schema.ts 实际接口不一致), RC-6 (Phase Boundary Confusion — Phase 1/2/3 职责边界模糊导致依赖矛盾)。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | Observer 代码示例全面更新：(1) 添加 Phase 1 目标接口说明头（decision+severity 双字段策略、event 联合类型扩展、timestamp/sessionId/phase 来源说明）(2) 所有 6 处 appendAudit 调用添加 decision、severity、sessionId、phase 字段 (3) getActiveRun() 解构添加 phase | 3.1.1 |
| F-02 | **High** | typescript 依赖矛盾修复：(1) §3.1.2 依赖列表中 typescript 改为~~strikethrough~~ + Phase 1 决策说明 (2) .ts/.tsx 验证分支包裹 `[Phase 2]` 注释 + "Phase 1 仅实现上方 .json 和 .yaml/.yml 分支" | 3.1.1, 3.1.2 |
| F-05 | Medium | rule-config.ts vs watchdog-config.ts 关系说明：两者职责不重叠、文件不冲突，长期目标 Phase 5+ 合并 | 4.5 |
| F-06 | Medium | ObserverTimeoutError 自定义错误类替代 `e.message === 'Observer timeout'` 字符串匹配 | 3.1.1 |
| F-07 | Medium | CheckpointEvent 联合类型扩展占位：Phase 2 添加 `'TEST_RUN_REQUESTED' | 'TEST_RUN_COMPLETE'` | 3.2.2 |
| F-08 | Medium | auto-resolve 伪代码：`getUnresolvedViolations` + `resolveViolations` 调用序列 | 3.1.1 |
| F-10 | Medium | S/B/A 映射判定规则：显式枚举 S→C/H、B→H/M、A→L/I 的判定条件 | 3.3.3 |
| F-11 | Medium | ignoreExitCodes 默认值从 `[130]` 改为 `[1, 130]` + 注释说明 | 4.5 | ⚠️ 已被 v1.18 §4.5 L1043 覆盖——exit code 1 不应默认忽略（是最常见失败码），保持 [130]。此条为历史记录。 |
| F-12 | Medium | 降级检测 try/catch 缩窄至 `TypeError | NotImplementedError`，非 API 异常向上抛出 | 3.2.2 |
| F-13 | Medium | 审计日志轮转上限：最大 10 个 key，超出写入 `AUDIT_ROTATION_LIMIT_EXCEEDED` | 4.4 |
| F-14 | Medium | skip_guard Phase 4 安全增强：`GUARD_BYPASSED` 可选纳入门控决策（warn 级 finding） | 3.4.3 |
| F-15 | Medium | TEST_EVIDENCE_CHECK severity 消费说明：block→H 级 finding，warn→M 级 finding | 3.2.1 |
| F-17 | Medium | 工具名称大小写约定：OpenCode 工具名首字母大写，Observer 无需转换 | 4.1 |
| F-18 | Medium | 同命令匹配精确字符串语义：`args.command` 完整字符串匹配，参数变体视为不同命令 | 4.4 |
| F-19 | Medium | JSONL 单行 4KB PIPE_BUF 限制：error_summary 截断 500 字符，超限标记 `truncated: true` | 3.4.3 |
| F-09 | Low | 测试迁移说明：删除模块测试直接删除，保留模块测试迁移至 watchdog/tests 或 MCP 侧 | 3.4.4 |
| F-16 | Low | Phase 2 事件占位形式：Phase 1 扩展 event 联合类型（类型先行，逻辑 Phase 2） | 3.1.2 |
| F-20 | Low | readState 迁移风格注释：与现有 P 字段迁移一致（schema.ts readState L157） | 3.3.2 |
| F-21 | Low | CheckpointGateResult vs CheckpointResult 关系说明：内部返回类型 vs 工具返回类型 | 3.1.2 |
| F-22 | Low | 数据流 TEST_RUN_REQUESTED 条件化：仅在 Phase 5（Business Code）完成时记录 | 2.1.1 |
| F-23 | Low | timestamp 类型从 `number` 改为 `string`（ISO 8601，与 schema.ts 一致） | 3.1.2 |
| F-24 | Low | AC-5 P99 验收标准改为"≤100KB 场景 P99 <20ms（主验收标准）"，所有场景作为辅助指标 | 3.1.3 |
| F-25 | Low | REVIEWER_SPAWNED 添加"⏳ Phase 3 待定，当前跳过此步骤" | 3.3.1 |
| F-29 | Low | ~~extractExitCode fallback 策略变更：先 fallback=0（fail-open）收集数据，≥95% 命中率后切换 fallback=1~~ ⚠️ 已被 v1.18 F-14 覆盖——Phase 1 统一 fallback=1（fail-safe）。此条为历史记录。 | 3.1.1 |
| F-28 | Info | reload_config 从"Phase 4 可通过 tdd_checkpoint"改为"未来可扩展，当前未列入任何 Phase 产出物" | 4.5 |
| F-32 | Info | Phase 3 AC 表格顶部添加"⚠️ 标注项目仅 Schema v5 后可验证，未标注为当期可执行" | 3.3.7 |

**Pass 12 Round 7 结论**: 24 findings（2H + 13M + 9L）全部修复。核心发现：

1. **Observer 代码示例与实际接口持续分歧**（F-01，RC-1 第 4 轮）：前 3 轮修复仅添加 prose notes 而未更新代码示例本身。本次直接更新所有 6 处 appendAudit 调用，添加 decision/severity/sessionId/phase 字段，并在代码块顶部添加 Phase 1 目标接口说明头。

2. **Phase 边界混淆导致依赖矛盾**（F-02，RC-6）：§3.1.2 依赖列表中 typescript 被列为 Phase 1 运行时依赖，但 §3.1.1 quickSyntaxCheck 和 F-09 修改已明确 Phase 1 不引入 typescript。修复：用 strikethrough 标记 + 决策说明。

3. **防御编程不足**（F-06, F-12, F-19）：字符串匹配错误类型（F-06）、过宽的 catch-all（F-12）、无大小限制的 JSONL 写入（F-19）。修复：分别改用 instanceof 检查、缩窄 catch 范围、添加 PIPE_BUF 限制。

## 附录 M: Pass 13 TDD Ralph Review Loop Round 5 (Gate R5) 修改记录（v1.20 → v1.21）

**Pass 13 Gate Round 5 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: TDD Ralph Review Loop Gate Round 5 — Recall → Fact-Gathering → Precision Filter → 主代理评估 → 全部修复。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | 5处 Observer appendAudit 代码示例补充必填 timestamp 字段 | 3.1.1 |
| F-02 | **High** | Phase 2 TEST_RUN_REQUESTED 补充 timestamp + sessionId | 3.2.1 |
| F-03 | **High** | auto-resolve 拆分为两个独立调用（COMMAND_FAILED 按 tool/filePath，OBSERVER_TIMEOUT 按 event） | 3.1.1 |
| F-04 | **High** | resolve_timeout/force_resolve_violation 补充 applyTransition case 定义（仅 validateTransition 会导致运行时 throw） | 3.1.2 |
| F-05 | **High** | OBSERVER_TIMEOUT_DEGRADED 补充代码示例 + 计数器方案（PipelineState.observerTimeoutCount） | 4.2 |
| F-06 | **High** | resolve_timeout precondition 扩展覆盖 ralph_loop phaseStatus | 3.1.2 |
| F-07 | Medium | Phase 2 appendAudit 移除 await（sync void 方法） | 3.2.1 |
| F-08 | Medium | getUnresolvedViolations pipeline scope 说明（通过 3-param 签名隐式限定 + 冷启动空索引为正确行为） | 3.1.2 |
| F-09 | Medium | severity=undefined 过滤语义定义（仅匹配显式设置 severity 的 Observer 条目） | 4.4 |
| F-10 | Medium | auto-resolve 执行位置澄清（recordTaskAndScan 之后、_handleObservations 之前，Path 3 位置） | 3.1.1 |
| F-11 | Medium | FIFO 计数器初始化策略（PipelineState.auditEntryCount，初始 0，appendAudit 递增） | 3.2.2 |
| F-12 | Low | Bash/Write 分支改为 else if（消除 fall-through 歧义） | 3.1.1 |
| F-13 | Medium | DEGRADED 计数器持久化说明（PipelineState 持久化，进程重启保留，跨 run 不继承） | 4.2 |
| F-14 | Low | ObserverTimeoutError 缩进修正（模块级定义，无缩进） | 3.1.1 |
| F-15 | Low | _handleObservations 参数补全类型注解 (tool: string, callID: string) | 3.1.1 |
| F-16 | Low | FILE_TOO_LARGE_FOR_CHECK 添加 config.enabled 依赖说明 | 3.1.1 |
| F-17 | Low | a.command as string 添加运行时类型守卫建议 | 3.1.1 |
| F-18 | Low | a.filePath as string 添加运行时类型守卫建议 | 3.1.1 |
| F-19 | Info | resolve_timeout 命名规则确认（lowercase_with_underscore，CheckpointEvent 历史遗留约定，已符合） | — |
| F-20 | Info | 头注释密度（设计意图，保持不变） | — |

**Pass 13 Gate Round 5 结论**: 20 findings（6H+6M+6L+2I）全部修复。核心发现：

1. **必填字段遗漏**（F-01, F-02）：6 处 appendAudit 代码示例缺少 timestamp 必填字段。实现者照抄会产出无效 AuditLogEntry。根因：前 7 轮修复聚焦于 API 签名（3-param）和字段语义（severity vs decision），未系统性检查所有代码示例的字段完整性。

2. **状态机覆盖缺口**（F-03, F-04, F-05, F-06）：auto-resolve 未区分不同事件类型的过滤维度；validateTransition/applyTransition 更新不同步；OBSERVER_TIMEOUT_DEGRADED 缺少实现指导；resolve_timeout precondition 过窄。根因：前轮修复添加了新机制（降级、手动解决）但未补全完整的实现路径。

## 附录 N: Pass 14 TDD Ralph Review Loop Round 6 (Gate R6) 修改记录（v1.21 → v1.22）

**Pass 14 Gate Round 6 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: Recall (30 raw) → Precision Filter (19 confirmed, 12 rejected) → 主代理评估 → 全部 ADOPT。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-06 | **High** | setTimeout clearTimeout 添加（finally 块中清理，防止 event loop 引用泄漏） | 3.1.1 |
| F-01 | Medium | AuditLogEntry 接口补充 runId + projectId 必填字段 | 3.1.2 |
| F-02 | Medium | Phase 2 TEST_RUN_REQUESTED 补充 runId + projectId | 3.2.1 |
| F-04 | Medium | OBSERVER_TIMEOUT_DEGRADED 降级检查时机澄清（Observer 自身检查，非 Checkpoint） | 4.2 |
| F-07 | Medium | this.timeoutCount → state.observerTimeoutCount 命名统一 | 4.2 |
| F-09 | Medium | Phase 2 sessionID 来源说明（CheckpointHandler 第三个参数） | 3.2.1 |
| F-10 | Medium | PipelineState Phase 1 扩展字段正式定义（observerTimeoutCount/auditEntryCount/evictionNeeded） | 4.2 |
| F-13 | Medium | 降级检测 shorthand 改为完整 3-param appendAudit 调用 | 3.2.2 |
| F-16 | Medium | Auto-resolve 执行位置与超时保护关系澄清（Promise.race 之外） | 3.1.1 |
| F-18 | Medium | force_resolve_violation precondition 处理 ownerSessionId 可选字段 | 3.1.2 |
| F-03 | Low | JSON catch clause 添加 unknown type guard | 3.1.1 |
| F-08 | Low | Auto-resolve projectId/runId 来源补充 | 3.1.1 |
| F-12 | Low | CheckpointGateResult violations filter 排除 undefined | 3.1.1 |
| F-15 | Low | resolveViolations timestamp+_sourceKey 双重定位说明 | 4.4 |
| F-20 | Low | ObserverTimeoutError 模块级分隔注释 | 3.1.1 |
| F-23 | Low | yamlSyntaxCheck result.error fallback 建议 | 3.1.1 |
| F-24 | Low | normalizeCommand "精确匹配"语义澄清 | 4.4 |
| F-25 | Low | FIFO 5000 条与 10MB 轮转关系说明 | 3.2.2 |
| F-27 | Low | resolveViolations JSONL 并发安全说明（JS 单线程无跨进程风险） | 4.4 |

**Pass 14 Gate Round 6 结论**: 19 findings (1H+9M+9L) 全部修复。核心发现：

1. **setTimeout 资源泄漏**（F-06）：超时保护的 setTimeout 在 Promise.race 完成后未清理，保持 event loop 引用并浪费 macrotask/定时器资源。修复：添加 finally { clearTimeout(timeoutId) }。

2. **接口定义完整性**（F-01, F-02, F-10）：AuditLogEntry 缺少 runId/projectId 必填字段；PipelineState 新增字段仅有 prose 描述无正式接口定义。修复：补全接口字段 + 添加 PipelineState 扩展字段正式定义。

3. **降级机制时序矛盾**（F-04）：OBSERVER_TIMEOUT_DEGRADED 的触发描述在 prose（"第4次起"）和实现方案（"Checkpoint时检查"）之间矛盾。修复：明确 Observer 自身在写入 OBSERVER_TIMEOUT 时检查计数器，Checkpoint 仅负责重置。

## 附录 O: Pass 15 TDD Ralph Review Loop Round 7 (Gate R7) 修改记录（v1.22 → v1.23）

**Pass 15 Gate Round 7 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: Recall (18 raw) → Precision Filter (17 confirmed, 1 rejected) → 主代理评估 → 全部 ADOPT。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-21 | Medium | Bash/Write brace mismatch 修复（移除 Bash 块过早关闭的 }） | 3.1.1 |
| F-22 | Medium | AuditLogEntry 接口补充 evicted?: boolean 字段 | 3.1.2 |
| F-23 | Medium | AuditLogEntry 接口补充 force_resolved_reason?: string 字段 | 3.1.2 |
| F-24 | Medium | OBSERVER_TIMEOUT handler 补充 observerTimeoutCount 递增 + 降级检查 | 3.1.1 |
| F-25 | Medium | Auto-resolve 成功后重置 observerTimeoutCount | 3.1.1 |
| F-26 | Medium | Phase 1 审计事件 prose 列表补全（含 DEGRADED/FORCE_RESOLVED/DEGRADATION_MODE） | 3.1.2 |
| F-28 | Medium | Phase 4 rollback PipelineState 一致性说明 | 3.4.1 |
| F-29 | Medium | DEGRADATION_MODE_ACTIVATED 哨兵值文档化 | 3.2.2 |
| F-31 | Medium | Stash 清理机制（cleanup_rollback_stashes 工具） | 3.4.1 |
| F-32 | Medium | resolve_timeout 审计事件从 FORCE_RESOLVED 改为 TIMEOUT_RESOLVED（区分两种解决路径） | 3.1.2 |
| F-30 | Low | Auto-resolve 变量名统一 | 3.1.1 |
| F-33 | Low | getUnresolvedViolations 移除误导性 await | 3.1.1 |
| F-34 | Low | Auto-resolve 位置描述与代码对齐 | 4.4 |
| F-35 | Low | Extensions filter 未验证类型静默跳过说明 | 3.1.1 |
| F-36 | Low | Phase 字段一致性检查 | 3.1.1 |
| F-37 | Low | OBSERVER_TIMEOUT 解决路径编号修正 | 4.2 |
| F-38 | Low | FIFO 计数器持久化说明 | 3.2.2 |

**Pass 15 Gate Round 7 结论**: 17 findings (0H+10M+7L) 全部修复。核心发现：

1. **代码示例结构错误**（F-21）：Bash 块过早关闭导致 else-if 孤立，实现者照抄会产生语法错误。修复：移除多余的 }。

2. **接口定义不完整**（F-22, F-23, F-24）：evicted/force_resolved_reason 字段在 prose 中引用但接口定义缺失；OBSERVER_TIMEOUT handler 未展示核心计数器逻辑。修复：补全接口字段 + 在 handler 代码中添加计数器递增和降级检查。

3. **审计事件可追溯性**（F-32）：resolve_timeout 和 force_resolve_violation 共用 FORCE_RESOLVED 事件，无法区分自动恢复和手动强制解决。修复：resolve_timeout 改用 TIMEOUT_RESOLVED 事件。

## 附录 P: Pass 16 TDD Ralph Review Loop Round 8 (Gate R8) 修改记录（v1.23 → v1.24）

**Pass 16 Gate Round 8 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: Recall → Precision Filter (17 raw, 9 confirmed adopted) → 主代理评估 → 全部 ADOPT。

**9 项采纳 findings（F-01..F-14 范围内）**：

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | cleanup_rollback_stashes 为第 25 个工具，AC-4 及全文工具计数从 24 修正为 25（含新增 5 工具列表、M3 里程碑、MCP 工具参考文档、总结架构图） | 3.4.3, 3.4.5, 3.5.1, 5, 7 |
| F-02 | Medium | OBSERVER_TIMEOUT 降级 prose "第4次" 修正为 "第3次"，与代码 `observerTimeoutCount >= 3` 递增逻辑一致（1st→count=1→block, 2nd→count=2→block, 3rd→count=3→warn+degraded） | 4.2 |
| F-03 | Medium | `pipeline_reset` CheckpointEvent 前向引用：§3.4.1 新增 Phase 4 前向引用段落 + CheckpointEvent 扩展列表添加 `pipeline_reset` 条目（含 payload/precondition/action 描述，标注 `// Phase 4`） | 3.4.1, 3.1.2 |
| F-04 | Medium | Phase 1 审计事件 prose 列表补充 `TIMEOUT_RESOLVED`（Observer 超时自动/手动恢复事件） | 3.1.2 |
| F-05 | Medium | resolveViolations 参数类型统一：§4.4 prose `entries` 改为 `timestamps`（与代码签名 `resolveViolations(projectId, runId, timestamps: string[])` 一致），添加参数类型选择说明 | 4.4 |
| F-10 | Medium | Write 块 `content` null reference 风险：在 `const content = a.content as string` 后添加 `if (content == null) return;` early-return guard + 注释说明 | 3.1.1 |
| F-11 | Low | AuditLogEntry event 联合类型添加 `'REVIEWER_SPAWNED'`（Phase 3 占位），同步更新 CheckpointEvent 扩展说明 | 3.1.2 |
| F-13 | Low | Bash 块代码缩进统一：6 处不一致缩进修正为标准 2-space 递进（if/const/appendAudit 内部对齐） | 3.1.1 |
| F-14 | Medium | McpAuditEntry.event 从 `string` 改为 `McpAuditEvent` 枚举类型（初始值集：GUARD_BYPASSED, ROLLBACK_EXECUTED, STASH_CLEANUP_PERFORMED，可扩展） | 3.4.3 |

**Pass 16 Gate Round 8 结论**: 9 findings（1H+5M+0L+2M→M, 1L）全部修复。核心发现：

1. **工具计数遗漏**（F-01）：F-31 添加了 cleanup_rollback_stashes 工具但未更新合并后工具总数（仍为 24），导致 AC-4 自动化断言会失败。修复：全文统一更新为 25。

2. **prose-code 不一致**（F-02, F-05）：降级时机 prose "第4次" 与代码 >=3 检查不符；resolveViolations 参数名 prose 用 `entries` 而代码用 `timestamps`。修复：统一 prose 与代码表述。

3. **前向引用缺失**（F-03, F-11）：pipeline_reset 在 §3.4.1 引用但未在 CheckpointEvent 扩展列表中占位；REVIEWER_SPAWNED 在 §3.3.1 使用但未在 event 联合类型中声明。修复：添加带 Phase 标注的占位条目。

## 附录 Q: Pass 17 TDD Ralph Review Loop Round 9 (Gate R9) 修改记录（v1.24 → v1.25）

**Pass 17 Gate Round 9 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: Recall → Precision Filter (16 raw, 16 confirmed adopted) → 主代理评估 → 全部 ADOPT。

**16 项采纳 findings（F-01..F-16）**：

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | getUnresolvedViolations 新增 `commandPattern?: string` 过滤字段；auto-resolve 伪代码拆分 COMMAND_FAILED（按 tool:'Bash' + commandPattern）和 SYNTAX_ERROR_POST_WRITE（按 tool:'Write' + filePath）为独立调用；§4.4 prose 更新 commandPattern 过滤说明 | 3.1.1, 3.1.2, 4.4 |
| F-02 | Medium | Bash 伪代码补充 `if (exitCode !== 0)` 闭合花括号 `}` + `// close exitCode check` 注释 | 3.1.1 |
| F-03 | Medium | AuditLogEntry 接口 pass/fail/error_summary 字段添加运行时校验/discriminated union 说明注释 | 3.1.2 |
| F-04 | Medium | resolve_timeout applyTransition "若需要" 替换为具体条件：不推进 phase，仅记录 TIMEOUT_RESOLVED 审计事件 | 3.1.2 |
| F-05 | Medium | McpAuditEvent 移除 `\| string` 尾部扩展，改为显式联合类型追加新值 | 3.4.3 |
| F-06 | Medium | Ralph Loop 边界条件添加 MAX_RALPH_ROUNDS 安全网（默认 20，超出 PipelineState 转为 failed） | 3.2.1 |
| F-07 | Medium | Reviewer M→H 升级判定逻辑：检查前轮 RoundRecord 含 M 级 TEST_EVIDENCE finding 且本轮仍无 TEST_RUN_COMPLETE 时升级为 H 级 | 3.2.1 |
| F-08 | Medium | DEGRADATION_MODE_ACTIVATED 无活跃 pipeline 时通过 console.warn() 记录进程日志，后续 pipeline 启动时 Observer 检查 this.degraded 标志补写审计日志 | 3.2.2 |
| F-09 | Medium | OBSERVER_TIMEOUT auto-resolve 添加设计决策注释：仅处理 block 级事件，warn 级保留为历史记录 | 3.1.1 |
| F-10 | Medium | Checkpoint phase_complete 自动 resolve 补充伪代码：`this.store.resolveViolations(projectId, runId, unresolved.map(v => v.timestamp))` | 4.4 |
| F-11 | Low | SCREAMING_SNAKE_CASE 命名约定限定为 Observer/审计事件，CheckpointEvent 保持 lowercase_with_underscore（历史遗留） | 3.1.2 |
| F-12 | Low | `content?.trim()` 移除冗余可选链（content non-null 由 L304 guard 保证） | 3.1.1 |
| F-13 | Low | 架构图 L66 Git 回滚行缩进修正（移除多余前导空格，与 L65 对齐） | 2.1 |
| F-14 | Low | 哨兵值（sessionId='', phase=0）不回溯更新，审计消费者按 phase>0 过滤门控决策条目 | 3.2.2 |
| F-15 | Low | AC-4 添加备用验证命令：`uv run python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools))"` | 3.4.5 |
| F-16 | Low | FIFO 淘汰计数器更新为 `state.auditEntryCount -= evictedCount`（而非重置为 0） | 3.2.2 |

**Pass 17 Gate Round 9 结论**: 16 findings（1H+9M+6L）全部修复。核心发现：

1. **auto-resolve 过滤维度不完整**（F-01）：getUnresolvedViolations 缺少 commandPattern 字段，导致 COMMAND_FAILED 无法按命令字符串精确匹配。auto-resolve 伪代码将 COMMAND_FAILED 和 SYNTAX_ERROR_POST_WRITE 混为同一调用。修复：新增 commandPattern 字段 + 拆分为独立调用。

2. **代码结构错误**（F-02）：Bash 伪代码 `if (exitCode !== 0)` 块缺少闭合花括号，导致 else-if 分支结构错误。修复：补充闭合花括号 + 注释。

3. **类型安全缺口**（F-03, F-05）：TEST_RUN_COMPLETE 必填字段未在接口中强制；McpAuditEvent 使用 `| string` 尾部扩展破坏联合类型穷举检查。修复：添加运行时校验说明 + 移除 `| string`。

## 附录 R: Pass 18 TDD Ralph Review Loop Round 10 (Gate R10) 修改记录（v1.25 → v1.26）

**Pass 18 Gate Round 10 由 Sisyphus (orchestrator) + Oracle (Recall) + Oracle (Precision) 三代理双通道审查执行**

**审查方法**: Recall → Precision Filter (16 raw, 15 confirmed adopted, 1 rejected) → 主代理评估 → 全部 ADOPT（F-14 REJECTED）。

**15 项采纳 findings（F-01..F-16，F-14 REJECTED）**：

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | Low | 移除 OBSERVER_TIMEOUT auto-resolve 重复注释块（L170-175 第二次出现的 2 行注释） | 3.1.1 |
| F-02 | **High** | M→H 升级判定逻辑改用 description '[TEST_EVIDENCE]' 前缀标识（非 type 字段），Reviewer prompt 要求在 description 开头标注前缀 | 3.2.1 |
| F-03 | Medium | Observer 超时后防写入机制：设置 this._timedOut 标志，_handleObservations 内 appendAudit 前检查，handle() 开头重置 | 3.1.1 |
| F-04 | Medium | 总结"当前"列 Aristotle MCP 从 "25 工具" 修正为 "20 工具"（当前状态） | 7 |
| F-05 | Low | Phase 4 注 "4 个新工具" 修正为 "5 个新工具"（含 cleanup_rollback_stashes） | 3.4.3 |
| F-06 | Medium | getUnresolvedViolations prose 补充可选 filter 参数说明（按 tool/filePath/event/commandPattern 组合过滤） | 4.4 |
| F-07 | Medium | 总结当期目标 "25 工具 + KI + 回滚 + stash 清理" 改为 "25 工具，含 KI 文档 + Git 回滚 + stash 清理，全部无状态" | 7 |
| F-08 | Medium | pipeline_reset 从 Phase 1 扩展列表移至独立子项 "Phase 4 CheckpointEvent 扩展（类型占位）"，详见 §3.4.1 | 3.1.2 |
| F-09 | Medium | resolve_timeout applyTransition 补充 else case：存在其他未解决 block 级违规时 phaseStatus 保持不变 | 3.1.2 |
| F-10 | Medium | observerTimeoutCount 重置路径补充第 3 条：pipeline_reset（Phase 4）重置所有 PipelineState 字段 | 4.2 |
| F-11 | **High** | PipelineState Phase 1 字段迁移：加载时补充 observerTimeoutCount/auditEntryCount/evictionNeeded 默认值 | 4.2 |
| F-12 | Low | 审计轮转 key 命名修正："audit-1 到 audit-10" → "audit + audit-2 到 audit-10" | 4.4 |
| F-13 | Low | content guard 注释行号修正："L304 guard" → "L310 guard" | 3.1.1 |
| F-14 | — | **REJECTED** — 已有充分覆盖，跳过 | — |
| F-15 | Low | Phase 2 验收标准新增 AC-6：read_audit_log 工具注册验证 | 3.2.3 |
| F-16 | Low | readState 迁移代码添加类方法注释 `// PipelineStore 类方法（与现有 readState 位置一致）` | 3.3.2 |

**Pass 18 Gate Round 10 结论**: 15 findings 采纳（2H+8M+5L），1 REJECTED。核心发现：

1. **M→H 升级逻辑引用不存在字段**（F-02）：升级判定使用 `type` 字段但 FindingSubmission 无此字段。修复：改用 description '[TEST_EVIDENCE]' 前缀约定（无需 schema 变更）。

2. **PipelineState 字段迁移缺失**（F-11）：Phase 1 新增 observerTimeoutCount/auditEntryCount/evictionNeeded 字段未定义旧状态加载时的默认值补充逻辑，导致 `undefined + 1 = NaN`。修复：添加 Phase 1 迁移默认值说明。

3. **总结当前状态不准确**（F-04, F-07）："当前"列显示 25 工具（实际 20），"当期目标"格式误导为 25+3=28。修复：修正当前值 + 改写格式消除歧义。

## 附录 S: v1.27 结构重构记录

**版本**: v1.26 → v1.27
**日期**: 2026-05-31
**类型**: 结构重构（无内容删除，所有信息保留）

### 重构目标

将分散在多个章节中的接口/类型定义合并到新的 §3.0 "Interface & Type Registry" 作为唯一真相源（single source of truth），原章节改为交叉引用。

### 变更摘要

| 变更 | 描述 |
|------|------|
| **新增 §3.0** | Interface & Type Registry — 包含 §3.0.1（Core Audit Types）至 §3.0.6（Constants Registry）共 6 个子节 |
| **§3.1.2** | AuditLogEntry 接口定义 → "完整定义见 §3.0.1"；CheckpointGateResult → "完整定义见 §3.0.1"；PipelineStore 方法 → "完整签名与行为见 §3.0.2"。保留 Phase 1 产出物列表和 CheckpointEvent 扩展设计说明 |
| **§4.2** | PipelineState Phase 1 扩展字段 → "完整定义见 §3.0.3"。保留降级计数器方案和持久化说明 |
| **§4.4** | getUnresolvedViolations/resolveViolations 行为重描述 → "行为规范见 §3.0.2"。保留设计决策（auto-resolve 拆分、FIFO 策略、轮转命名、跨 key 追踪设计理由） |
| **§4.5** | RuleConfig/RulesFile/RuleConfigLoader 接口定义 → "完整定义见 §3.0.5"。保留默认值策略、优先级、配置校验 prose |
| **§3.4.3** | McpAuditEntry/McpAuditEvent → "完整定义见 §3.0.1"。保留 Phase 4 上下文和双审计日志聚合策略 |
| **Appendix S** | 新增本附录，记录结构重构变更 |

### §3.0 内容来源映射

| §3.0 子节 | 内容来源 |
|-----------|----------|
| §3.0.1 Core Audit Types | AuditLogEntry（§3.1.2）、CheckpointEvent（§3.1.2）、CheckpointGateResult（§3.1.2）、McpAuditEntry/McpAuditEvent（§3.4.3） |
| §3.0.2 PipelineStore API | appendAudit（§3.1.1 L150/L178、§3.1.2、§3.2.2）、getUnresolvedViolations（§3.1.1、§3.1.2、§4.4）、resolveViolations（§4.4） |
| §3.0.3 PipelineState & Schema | PipelineState（§4.2）、FindingSubmission（§3.3.2）、RoundRecord（§3.3.2）、ActiveRun（§3.2.1） |
| §3.0.4 Observer Helpers | extractExitCode/quickSyntaxCheck/yamlSyntaxCheck/matchPattern/normalizeCommand/ObserverTimeoutError（§3.1.1） |
| §3.0.5 Configuration Types | RuleConfig/RulesFile/RuleConfigLoader（§4.5） |
| §3.0.6 Constants Registry | 跨章节常量汇总表 |

### 验证

- 所有 appendices（A 至 S）保持完整未修改
- §3.1 至 §3.5 章节编号未改变（§3.0 为新增）
- 无内容删除——所有接口定义、行为描述、设计决策均保留在 §3.0 或以交叉引用方式指向 §3.0

## 附录 T: v1.28 R11 Ralph Review 修改记录

**版本**: v1.27 → v1.28
**日期**: 2026-05-31
**类型**: R11 Ralph review fixes — §3.0 结构重构后残留重复定义修复

### 修改概要

**审查方法**: R11 Ralph review — 19 confirmed findings（3H + 10M + 6L），全部 ADOPT。

| Fix ID | Severity | 修改内容 | 影响章节 |
|--------|----------|----------|----------|
| F-01 | **High** | §3.1.1 辅助函数规范（6 个函数完整签名）替换为交叉引用 → §3.0.4 | 3.1.1 |
| F-16 | **High** | §3.1.1 ObserverTimeoutError 内联类定义替换为 stub + 交叉引用 → §3.0.4 | 3.1.1 |
| F-17 | **High** | §3.1.2 Phase 1 审计事件完整枚举替换为交叉引用 → §3.0.1；§3.1.1 event 联合类型注释替换为交叉引用 | 3.1.1, 3.1.2 |
| F-02 | Medium | §3.0.1 CheckpointEvent 补充完整 payload/precondition/action + applyTransition case（从 §3.1.2 迁移）；§3.1.2 替换为交叉引用 + 实现上下文保留 | 3.0.1, 3.1.2 |
| F-03 | Medium | §3.0.3 observerTimeoutCount 重置触发条件补充 auto-resolve 路径 | 3.0.3 |
| F-04 | Medium | §3.3.2 新增 FindingSubmission/RoundRecord 交叉引用 → §3.0.3；§3.0.6 新增 SEV_ORDER、VALID_SEVERITIES、Untracked files check threshold、Stash cleanup keep count 常量 | 3.3.2, 3.0.6 |
| F-05 | Medium | §3.0.1 resolve_timeout action 补充 TIMEOUT_RESOLVED 审计事件写入位置 | 3.0.1 |
| F-06 | Medium | §3.0.2 appendAudit 行为规范补充 AUDIT_ROTATION_LIMIT_EXCEEDED 写入触发 | 3.0.2 |
| F-07 | Medium | §3.0.3 新增 tdd_checkpoint 工具扩展签名定义；§3.2.2 内联定义替换为交叉引用 → §3.0.3 | 3.0.3, 3.2.2 |
| F-08 | Medium | §4.4 auto-resolve 标题补充 OBSERVER_TIMEOUT；新增 OBSERVER_TIMEOUT auto-resolve 描述 | 4.4 |
| F-09 | Medium | §3.0.3 ActiveRun 从 prose 替换为 TypeScript interface 定义 | 3.0.3 |
| F-18 | Medium | §3.0.3 新增 PipelineState 基础字段位置说明（仅显示 Phase 1 扩展字段） | 3.0.3 |
| F-10 | Low | §3.0.2 appendAudit 迁移注释更新为 undefined 语义正确性说明 | 3.0.2 |
| F-11 | Low | §3.0.2 resolveViolations FIFO 计数器注释移至 appendAudit（交叉引用 §3.2.2） | 3.0.2 |
| F-12 | Low | §3.0.2 getUnresolvedViolations severity 参数类型从 `string` 改为 `'warn' | 'block'` | 3.0.2 |
| F-13 | Low | §3.0.6 Constants Registry 新增 4 个缺失常量（SEV_ORDER, VALID_SEVERITIES, Untracked threshold, Stash keep count） | 3.0.6 |
| F-14 | Low | §3.0.1 Phase 1 审计事件列表后新增 DEGRADATION_MODE_ACTIVATED 跨 Phase 触发说明 | 3.0.1 |
| F-15 | Low | §3.1.1 Bash/Write 互斥分支注释改为明确 brace 闭合标注 | 3.1.1 |
| F-19 | Low | §3.0.2 filter 字段描述从"X 自动恢复专用"改为"用于 X 场景精确匹配（auto-resolve 等）" | 3.0.2 |

### 根因分析

§3.0 结构重构（v1.27）将接口/类型定义迁移到唯一真相源，但部分章节保留的完整定义未被替换为交叉引用。这导致同一信息在文档中存在 2-3 处副本，增加了维护不一致风险。

### 验证

- 所有 appendices（A 至 S）保持完整未修改
- 新增 Appendix T 记录 R11 修改
- §3.0 至 §3.5 章节编号未改变
- 无内容删除——重复定义替换为交叉引用，规范完整性增强（ActiveRun TypeScript interface、tdd_checkpoint 签名、SEV_ORDER/VALID_SEVERITIES 常量等）

---

## Appendix U: R12 Ralph Review 修改记录（v1.29）

**审查轮次**: R12
**日期**: 2026-05-31
**Findings 总数**: 10（10 adopted，0 rejected）

### 修改明细

| # | 严重度 | Finding 描述 | 修改位置 | 修改内容 |
|---|--------|-------------|----------|----------|
| F-01 | **High** | §3.1.1 Bash/Write brace mismatch — L568 多余 `}` 导致 if/else-if 结构断裂 | §3.1.1 L568 | 移除多余 `}`，替换为注释 `// ⚠️ Bash 分支到此结束，下方 else if (Write) 与 Bash 互斥`，使 `} else if` 正确闭合 Bash 分支并开启 Write 分支 |
| F-02 | **High** | §3.0.1 resolve_timeout action 中 severity='block' 违反 Observer-only 规则（L137） | §3.0.1 L173 | 移除 severity='block'，添加注释说明 CheckpointEvent 触发的审计事件不携带 severity 字段（severity 为 Observer 专用） |
| F-03 | **Medium** | §3.1.1 OBSERVER_TIMEOUT auto-resolve 调用编号错误（"调用 2"应为"调用 3"） | §3.1.1 L438 | 将 "调用 2" 更正为 "调用 3" |
| F-04 | **Medium** | §3.1.1 auto-resolve 伪代码实际位于 recordTaskAndScan 之后，但前置展示无标注 | §3.1.1 L430-445 | 在 auto-resolve 伪代码前添加位置标注注释，说明实际执行位置在 L464 recordTaskAndScan 之后 |
| F-05 | **Medium** | §3.0.1 Phase 1 事件列表缺少 Pre-Phase 存量事件说明 | §3.0.1 L160 | 在 Phase 1 事件列表前新增 Pre-Phase 存量事件条目（INTERCEPT、PROMPT_INJECTION_DETECTED），注明不在本次 Phase 扩展范围内 |
| F-06 | **Medium** | §3.0.6 Audit retention Phase 标记为 P1，应为 P2+（Phase 2+ 才实现 archive） | §3.0.6 L383 | 将 Phase 列从 "P1" 改为 "P2+" |
| F-07 | **Medium** | §3.0.2 commandPattern 匹配机制未说明底层实现需求 | §3.0.2 L224 | 添加匹配机制说明：需在 AuditLogEntry 新增 `command?: string` 索引字段，以及不添加时的回退策略和 Phase 1 建议 |
| F-08 | **Low** | §3.0.6 Audit rotation limit 交叉引用指向不存在的 §4.4 | §3.0.6 L371 | 将 "§4.4" 修正为 "§3.0.2" |
| F-09 | **Low** | §3.0.3 tdd_checkpoint 工具扩展签名缺少子节标题（#### 而非 #####） | §3.0.3 L281 | 将 `#### tdd_checkpoint 工具扩展签名` 改为 `##### tdd_checkpoint 工具扩展签名`，与同层其他工具签名一致 |
| F-10 | **Low** | §3.4.3 readMcpAuditLog 接口定义未交叉引用 McpAuditEntry/McpAuditEvent 类型 | §3.4.3 L1219 | 添加交叉引用 "→ McpAuditEntry/McpAuditEvent 类型定义见 §3.0.1" |

### 验证

- 所有 appendices（A 至 T）保持完整未修改
- 新增 Appendix U 记录 R12 修改
- §3.0 至 §3.5 章节编号未改变
- 无内容删除——仅修正、补充和标注

---

## Appendix V: R13 Ralph Review 修改记录（v1.30）

**审查轮次**: R13
**日期**: 2026-05-31
**Findings 总数**: 4（4 adopted，0 rejected）

### 修改明细

| # | 严重度 | Finding 描述 | 修改位置 | 修改内容 |
|---|--------|-------------|----------|----------|
| F-01 | **High** | §3.0.3 ActiveRun 缺少 `startedAt: string` 字段 | §3.0.3 ActiveRun interface | 添加 `startedAt: string` 字段（⚠️ 文件引用修正：原引用 pipeline-store.ts L370-374 不正确，实际位于 checkpoint.ts），调整字段顺序与 schema.ts 一致（runId 首位） |
| F-02 | **Medium** | §3.0.6 L371-373 vs §3.2.2 L815 — Audit rotation/key-size limits Phase 分配冲突 | §3.2.2 L815 | 替换简略 Phase 标注为详细 Phase 分期说明，明确 Phase 1 定义常量值但运行时检查为 Phase 2+，消除与 §3.0.6 P1 标记的矛盾 |
| F-03 | **Medium** | §3.0.3 FindingSubmission partial interface 缺少 disclaimer | §3.0.3 FindingSubmission | 添加 PipelineState 同风格的 disclaimer，说明仅显示 Phase 3 扩展的 severity 联合类型，完整接口见 schema.ts |
| F-04 | **Medium** | §3.0.3 RoundRecord partial interface 缺少 disclaimer | §3.0.3 RoundRecord | 添加 PipelineState 同风格的 disclaimer，说明仅显示 Phase 3 扩展的 counts 类型，完整接口见 schema.ts |

### 验证

- 所有 appendices（A 至 U）保持完整未修改
- 新增 Appendix V 记录 R13 修改
- §3.0 至 §3.5 章节编号未改变
- 无内容删除——仅修正、补充和标注

---

## Appendix W: R14 Ralph Review 修改记录（v1.31）

**审查轮次**: R14
**日期**: 2026-05-31
**Findings 总数**: 19（15 adopted，4 rejected）

### 修改明细

| # | 严重度 | Finding 描述 | 修改位置 | 修改内容 |
|---|--------|-------------|----------|----------|
| F-01 | **High** | §3.1.1 辅助函数规范与 §3.0.4 重复 | §3.1.1 L664 | 已有交叉引用（R12 已修复），确认无需变更 |
| F-02 | **High** | §3.0.1 vs §3.1.2 CheckpointEvent 行为规范分散 | §3.0.1 L174, §3.1.2 L707 | resolve_timeout/force_resolve_violation 的 applyTransition 同步更新要求和 ownerSessionId 说明归入 §3.0.1；§3.1.2 替换为交叉引用 |
| F-03 | **Medium** | §3.0.3 observerTimeoutCount 重置触发不完整 | §3.0.3 L247 | 补充 OBSERVER_TIMEOUT 被 auto-resolve 后重置为 0 的说明 |
| F-04 | **Medium** | §3.3.2 FindingSubmission/RoundRecord/SEV_ORDER/VALID_SEVERITIES 重复无交叉引用 | §3.3.2 L881, L927 | 添加 FindingSubmission/RoundRecord 交叉引用注释；标注 SEV_ORDER/VALID_SEVERITIES 未包含在 §3.0.6 中 |
| F-05 | **Medium** | §3.0.1 TIMEOUT_RESOLVED 审计事件写入位置未标注 | §3.0.1 L174 | 添加写入位置说明：transitions.ts applyTransition('resolve_timeout') case 内调用 appendAudit() |
| F-06 | **Medium** | §3.0.2 缺少 AUDIT_ROTATION_LIMIT_EXCEEDED 触发描述 | §3.0.2 L217 | 新增 AUDIT_ROTATION_LIMIT_EXCEEDED 触发条件与写入位置说明 |
| F-07 | **Medium** | §3.2.2 tdd_checkpoint 扩展接口交叉引用缺失 | §3.2.2 L805 | 已有交叉引用（→ 完整定义见 §3.0.3），确认无需变更 |
| F-08 | **Medium** | §4.4 auto-resolve 标题遗漏 OBSERVER_TIMEOUT | §4.4 L1382 | 已包含 OBSERVER_TIMEOUT（R13 或更早修复），确认无需变更 |
| F-10 | **Medium** | §3.0.2 appendAudit 迁移注释 optional 字段描述不准确 | §3.0.2 L216 | 将 optional 字段描述从"无需显式默认值"细化为列举具体字段名（severity, resolved, resolvedAt, evicted, force_resolved_reason），明确 undefined 语义正确性 |
| F-11 | **Medium** | §3.0.2 resolveViolations 中 FIFO 计数器更新位置描述不当 | §3.0.2 L234 | 添加注释：FIFO 淘汰计数器更新在 appendAudit 中执行，不在 resolveViolations 中 |
| F-14 | **Low** | §3.0.1 DEGRADATION_MODE_ACTIVATED Phase 标注模糊 | §3.0.1 L164 | 补充触发路径说明（不限 Phase，Watchdog 初始化时可能触发） |
| F-16 | **Low** | §3.1.1 ObserverTimeoutError 内联类定义重复 §3.0.4 | §3.1.1 L534-535 | 替换为注释引用：ObserverTimeoutError 定义见 §3.0.4（模块级定义，与 Observer 类同级） |
| F-17 | **Low** | §3.1.2 Phase 1 audit events list 三重重复 | §3.1.2 L703 | 已有交叉引用（→ 完整事件清单见 §3.0.1），确认无需变更 |
| F-18 | **Low** | §3.0.3 pipeline_reset 引用字段未在 §3.0.3 定义 | §3.0.3 L253 | 补充 PipelineState 基础字段说明（phase, phaseStatus, round, sessionId, ownerSessionId, activeRun 定义在 schema.ts），pipeline_reset 重置说明 |
| F-19 | **Low** | §3.0.2 filter 字段描述"专用"不准确 | §3.0.2 L225-227 | commandPattern/filePath/event 描述从"X 自动恢复专用"改为"用于 X 场景精确匹配（auto-resolve 等场景共用）" |

### 拒绝的 Findings

| # | 原因 | 说明 |
|---|------|------|
| F-09 | dup-of-R13 | §3.0.6 Audit retention Phase 标记已在 R13 (F-02) 中修正，无需重复修复 |
| F-12 | already-correct | 指出的问题在当前版本中已正确描述，无需修改 |
| F-13 | already-in-registry | 相关常量已在 §3.0.6 常量注册表中注册，无需补充 |
| F-15 | stylistic | 纯风格偏好建议，不影响文档准确性或完整性，不做修改 |

### 验证

- 所有 appendices（A 至 V）保持完整未修改
- 新增 Appendix W 记录 R14 修改
- §3.0 至 §3.5 章节编号未改变
- 无内容删除——仅修正、补充和标注

---

## Appendix X: R15 Ralph Review 修复记录

**审查轮次**: R15（基于 v1.31）
**日期**: 2026-05-31
**审查范围**: §3.0 至 §3.5

### 采纳的 Findings

| # | 严重性 | 描述 | 位置 | 修复措施 |
|---|--------|------|------|----------|
| F-01 | **Medium** | §3.0.6 L395 SEV_ORDER constants table omits L=1 | §3.0.6 L395 | SEV_ORDER 值列补充 `L=1`，从 `S=8, C=5, B/H=4, M=3, P=2, A/I=0` 更新为 `S=8, C=5, B/H=4, M=3, P=2, L=1, A/I=0` |
| F-02 | **High** | §3.0.1 L130-151 AuditLogEntry interface missing `command?: string` field | §3.0.1 L142 | 在 `force_resolved_reason` 后新增 `command?: string` 字段（normalizeCommand 后的命令字符串，COMMAND_FAILED 条目专用，Phase 1 新增）；在 AuditLogEntry 差异说明后新增 Phase 1 command 字段说明段落 |
| F-03 | **High** | §3.0.1 L174 resolve_timeout action missing observerTimeoutCount reset | §3.0.1 L177 | resolve_timeout action 描述补充 `+ 重置 state.observerTimeoutCount = 0`；resolve_timeout applyTransition 说明补充内部执行顺序：resolve audit entries → reset observerTimeoutCount → write TIMEOUT_RESOLVED → update phaseStatus |
| F-04 | **Medium** | §3.1.1 L534 _timedOut prose/pseudocode mismatch | §3.1.1 L537 | 在超时后防写入机制注释后新增伪代码省略声明，明确实现时必须在 catch 块设置 _timedOut=true、_handleObservations 每个 appendAudit 前检查、handle() 开头重置 |

### 拒绝的 Findings

无（0 rejected）。

### 验证

- 所有 appendices（A 至 W）保持完整未修改
- 新增 Appendix X 记录 R15 修改
- §3.0 至 §3.5 章节编号未改变
- 无内容删除——仅修正、补充和标注

---

## Appendix Y：R17 Ralph Review Fixes（v1.33）

### 审查轮次

R17（2026-05-31），2 项确认 findings（F-01..F-02），2 adopted，0 rejected。

### 确认的 Findings

| # | 严重性 | 描述 | 位置 | 修复措施 |
|---|--------|------|------|----------|
| F-01 | **High** | §3.0.1 resolve_timeout/force_resolve_violation prescribe I/O inside pure applyTransition — violates transitions.ts pure-function contract | §3.0.1 L177-181 | resolve_timeout action 改为纯状态变更（仅重置 observerTimeoutCount=0）；force_resolve_violation action 改为无 PipelineState 变更；I/O 操作（resolveViolations、appendAudit）移至 CheckpointHandler.handle() 执行；新增执行流程步骤（applyTransition → CheckpointHandler I/O → writeState），与 checkpoint.ts L393 模式一致 |
| F-02 | **Medium** | §4.2 performance table says severity=block for OBSERVER_TIMEOUT but degradation case produces severity=warn | §4.2 L1325 | 表格行补充"连续 ≥3 次后降级为 severity=warn，见下方降级说明"，与 §4.2 OBSERVER_TIMEOUT 解决路径段落中的降级描述一致 |

### 拒绝的 Findings

无（0 rejected）。

### 验证

- 所有 appendices（A 至 X）保持完整未修改
- 新增 Appendix Y 记录 R17 修改
- §3.0 至 §3.5 章节编号未改变
- 无内容删除——仅修正、补充和标注

---

## Appendix Z：R18 Ralph Review Fixes（v1.34）

### 审查轮次

R18（2026-05-31），独立 Oracle Recall Pass → Precision Filter → 主代理评估。25 项原始发现，24 项通过精确过滤，13 项采纳修复，11 项确认但仅文档标注（低严重性/已接受的设计取舍），1 项拒绝。

### 采纳修复的 Findings（13 项）

| # | 严重性 | 描述 | 位置 | 修复措施 |
|---|--------|------|------|----------|
| F-01 | **High** | Observer 直接修改 PipelineState（observerTimeoutCount, auditEntryCount）但无显式 writeState 调用——崩溃时数据丢失 | §3.0.3 PipelineState | 添加持久化策略说明：Observer 变更通过下一次 Checkpoint writeState 持久化。显式文档化已知限制（崩溃丢失影响有限——计数器偏低，可接受） |
| F-02 | **High** | PipelineState 基础字段名文档矛盾：§3.0.3 说 `phase`，代码示例用 `state.currentPhase` | §3.0.3 L267 | 修正 §3.0.3 为 `currentPhase`，添加说明：schema.ts 字段名 `currentPhase: number`，代码解构为 `phase` 局部变量供 AuditLogEntry 使用 |
| F-03 | **Medium** | AuditLogEntry runId/projectId 必填但 §3.1.1 代码示例省略、§3.2.1 包含——风格不一致 | §3.0.1 AuditLogEntry L133-134 | 添加代码示例约定注释：Observer 示例省略（由 3-param 签名隐式提供），Checkpoint 示例包含，两种风格均可 |
| F-04 | **Medium** | L624 注释说"静默跳过"但 L626 代码提供 fallback 默认值——注释与代码矛盾 | §3.1.1 L624-626 | 修正注释为"fallback 到默认扩展名列表"，删除过时的"建议 fallback"注释 |
| F-05 | **Medium** | §3.0.2 描述 AUDIT_ROTATION_LIMIT_EXCEEDED 运行时行为但无 Phase 2+ 标注——与 §3.2.2 矛盾 | §3.0.2 L227, L230 | 添加 ⏳ Phase 2+ 运行时检查标注，明确 Phase 1 仅定义常量值 |
| F-07 | **Medium** | resolve_timeout 执行顺序（applyTransition→I/O→writeState）与现有模式（applyTransition→writeState→appendAudit）不同，但注释声称一致 | §3.0.1 L188 | 删除"与所有现有 case 一致"的误导性注释，添加执行顺序差异说明及理由 |
| F-08 | **Medium** | resolve_timeout precondition 未检查是否存在实际 OBSERVER_TIMEOUT 违规——可能产生无意义审计条目 | §3.0.1 L183 | 添加空结果处理说明：getUnresolvedViolations 返回空时仍写入 TIMEOUT_RESOLVED（提供操作审计追踪），标注为可接受行为 |
| F-09 | **Medium** | Phase 4 新工具接口规格前置依赖未在 §5 里程碑中追踪 | §5 里程碑表 | 添加 M3-前置 里程碑行：Phase 4 新工具接口规格 |
| F-10 | **Medium** | appendAudit void 返回无错误处理策略 + 现有代码 await void 函数 | §3.0.2 L220 | 添加错误处理策略：StateStore 写入失败 console.error + 返回（不 throw）；标注 await-on-void 应移除 |
| F-11 | **Medium** | getUnresolvedViolations filter 组合语义（AND/OR）未明确 | §3.0.2 L237 | 添加显式说明：多字段组合为 AND 语义 |
| F-12 | **Low** | resolveViolations 使用 timestamp 定位——ISO 8601 毫秒精度碰撞风险 | §3.0.2 L253 | 添加低风险说明注释，标注 Phase 4+ 可选 sequenceId 增强 |
| F-14 | **Low** | observerTimeoutCount 重置触发条件嵌套括号结构难读 | §3.0.3 L262 | 重构为 (1)(2)(3)(4) 明确列表格式 |
| F-22 | **Low** | DEGRADATION_MODE_ACTIVATED 列为 Phase 1 事件但实际不会触发（依赖 Phase 2 工具注册） | §3.0.1 L167 | 添加 Phase 1 不会实际触发的说明 |

### 确认但仅标注的 Findings（11 项，低/信息级或已接受的设计取舍）

| # | 严重性 | 描述 | 决策 |
|---|--------|------|------|
| F-06 | **Medium** | DEGRADATION_MODE_ACTIVATED 哨兵值 sessionId='', phase=0 绕过必填语义 | 已接受——哨兵值通过注释充分说明，消费者按 phase>0 过滤 |
| F-13 | **Medium** | command 字段存储原始命令，Watchdog StateStore 未提及 gitignore | 部分修复——添加 .watchdog/ gitignore 提示。Phase 2 脱敏计划已有 |
| F-18 | **Medium** | §3.2.1 Checkpoint 代码引用 sessionID 但未显示函数签名 | 修复——添加函数签名注释上下文 |
| F-19 | **Medium** | AC-3 测试未说明 ignoreExitCodes 配置 | 修复——添加测试环境配置说明 |
| F-24 | **Medium** | consecutiveZero 与 TEST_EVIDENCE 交互——暗示特殊逻辑但常规计数已覆盖 | 修复——重写注释说明常规 severity 计数已覆盖 |
| F-15 | **Low** | Stash 清理 git 历史检查性能未说明 | 已接受——Phase 4 细节，实现时补充 |
| F-16 | **Low** | ignoreCommands 默认值 glob 匹配行为不清 | 已接受——已文档化 minimatch 行为 |
| F-17 | **Low** | 审计 key 命名跳过 audit-1 | 已接受——已文档化，与 StateStore 现有约定一致 |
| F-20 | **Low** | Phase 3 AC-3 样本量（30）在待定状态下不可行 | 已接受——AC 已标注依赖 Schema v5，Phase 3 待定 |
| F-23 | **Info** | AuditLogEntry 接口定义注释密度过高 | 已接受——信息完整性优先于排版美观 |
| F-25 | **Low** | pipeline_reset payload 需 checkpoint_hash 但 §3.4.1 未提及传递 | 已接受——Phase 4 前置任务中定义 |

### 拒绝的 Findings（1 项）

| # | 严重性 | 描述 | 拒绝原因 |
|---|--------|------|----------|
| F-21 | **Low** | §3.0.6 SEV_ORDER 合并显示 B/H=4 与 §3.3.2 独立定义不一致 | VF-SEV_ORDER-in-registry 确认合并显示与独立定义一致（B=4, H=4），无误 |

### 验证

- 所有 appendices（A 至 Y）保持完整未修改
- 新增 Appendix Z 记录 R18 修改
- §3.0 至 §3.5 章节编号未改变
- 版本号更新至 v1.34

## Appendix AA：R19 Ralph Review Fixes（v1.35）

### 审查轮次

R19（2026-05-31），拆分文档并行 Oracle Recall Pass × 4 sub-documents → 主代理评估。48 项原始发现（9H, 23M, 13L, 3I），全部通过精确过滤，21 项采纳修复，24 项确认但仅标注，3 项信息级。

### 拆分审核策略

Round 1 (R18) 对完整文档审核后，将文档拆分为 6 个子文档（qa-base, qa-phase1, qa-phase2, qa-phase3, qa-phase4, qa-phase5）。Round 2 对其中 4 个有实质内容的子文档分别派发独立 Oracle Reviewer 并行审核（Phase 3 deferred 和 Phase 5 仅 33 行，跳过）。

| Sub-doc | Lines | H | M | L | I | Total |
|---------|-------|---|---|---|---|-------|
| qa-base.md | 1521 | 3 | 5 | 3 | 1 | 12 |
| qa-phase1.md | 340 | 2 | 6 | 4 | 1 | 13 |
| qa-phase2.md | 110 | 2 | 5 | 3 | 0 | 10 |
| qa-phase4.md | 149 | 2 | 7 | 3 | 1 | 13 |
| **Total** | | **9** | **23** | **13** | **3** | **48** |

### 采纳修复的 Findings（21 项）

| # | 严重性 | 描述 | 位置 | 修复措施 |
|---|--------|------|------|----------|
| H-01 | **High** | AuditLogEntry 缺少 `tool` 和 `filePath` 字段——auto-resolve 过滤无法匹配 | §3.0.1 AuditLogEntry | 新增 `tool?: string` 和 `filePath?: string` 可选字段，文档化 Observer 生成条目携带规则 |
| H-02 | **High** | COMMAND_FAILED/SYNTAX_ERROR_POST_WRITE/FILE_TOO_LARGE_FOR_CHECK appendAudit 调用未填充 tool/filePath | §3.1.1 Observer 代码 | 所有 4 个 appendAudit 调用添加 `tool` 和 `filePath` 字段赋值 |
| H-03 | **High** | Auto-resolve 在 Observer 20ms 超时保护之外执行，resolveViolations O(n) 可能超预算 | §3.1.1 auto-resolve + §4.2 | 添加 ≤5ms 子预算安全上限；>100 条目时跳过 resolveViolations |
| H-04 | **High** | resolveViolations 存储机制未说明——append-only JSONL 无法更新条目 | §3.0.2 resolveViolations | 添加实现说明：readLogSafe→内存修改→stateStore.write()（非 appendLog） |
| H-05 | **High** | PipelineState 引用共享前提条件未文档化 | §3.0.3 持久化策略 | 添加显式前提条件：cache.get() 必须返回同一对象引用（非深拷贝） |
| H-06 | **High** | M→H 升级依赖 Ralph Loop 编排器注入 RoundRecord.findings，但此前置依赖未说明 | §3.2.1 TEST_EVIDENCE 升级 | 添加前置依赖说明：Ralph Loop 编排器需支持结构化 finding 注入 |
| H-07 | **High** | TEST_RUN_COMPLETE CheckpointHandler case 缺失——纯审计写入路径无代码示例 | §3.2.1 CheckpointHandler | 新增 TEST_RUN_COMPLETE case 代码块：参数校验 + 运行时类型检查 + pass/fail 校验 + appendAudit |
| H-08 | **High** | rollback_engine.py 和 ki_doc_manager.py 缺失于 §3.4.2 删除清单 | §3.4.2 删除内容 | 添加 2 个"合并后删除"条目，区分纯删除和迁移后删除 |
| H-09 | **High** | pipeline_reset 与 rollback_to_checkpoint 仅"建议"关联，未强制执行 | §3.4.1 PipelineState 一致性 | 改为强制执行策略：返回标志 + Observer 自动检测 + AC 验收 |
| M-01 | **Medium** | getUnresolvedViolations O(1) 声明缺少索引实现规格 | §3.0.2 getUnresolvedViolations | 添加索引结构、构建时机、失效策略说明 |
| M-02 | **Medium** | OBSERVER_TIMEOUT_DEGRADED warn 事件无限积累无清理路径 | §4.2 OBSERVER_TIMEOUT | 添加 information-only 标注，明确 archiveRun 为唯一清理路径 |
| M-03 | **Medium** | Auto-resolve 伪代码变量 `a` scope 错误 | §3.1.1 auto-resolve | 添加 scope 分离说明和 `arArgs` 命名约定 |
| M-04 | **Medium** | _timedOut 标志仅在注释中描述，无代码占位 | §3.1.1 _handleObservations | 添加 `if (this._timedOut) return;` 代码占位符 |
| M-05 | **Medium** | Auto-resolve 伪代码"前置展示"导致位置误导 | §3.1.1 auto-resolve | 更新位置说明，添加 `/* === AUTO-RESOLVE === */` 标记 |
| M-06 | **Medium** | normalizeCommand 在 COMMAND_FAILED 路径重复调用 | §3.1.1 COMMAND_FAILED | 添加 `const normalizedCmd` 计算一次复用 |
| M-07 | **Medium** | MAX_RALPH_ROUNDS 安全网规格不足 | §3.2.1 consecutiveZero | 复用 PipelineState.round，添加 failed 状态 transition 说明 |
| M-08 | **Medium** | TEST_RUN_REQUESTED 写入顺序未说明 | §3.2.1 CheckpointHandler | 添加设计决策注释：在 gate check 前写入，测试应在 gate 结果前运行 |
| M-09 | **Medium** | cleanup_rollback_stashes 未出现在 §3.4.1 合并表格 | §3.4.1 合并内容 | 新增第 4 行：Stash 清理功能 |
| M-10 | **Medium** | 5 个新工具接口规格无 AC 验证 | §3.4.5 验收标准 | 新增 AC-8：接口规格完整性 |
| M-11 | **Medium** | MCP 审计日志行为无 AC 验证 | §3.4.5 验收标准 | 新增 AC-9：MCP 审计日志完整性 |
| M-12 | **Medium** | pipeline_reset CheckpointEvent 无 AC | §3.4.5 验收标准 | 新增 AC-10：pipeline_reset 行为验证 |

### 确认但仅标注的 Findings（24 项）

| Sub-doc | # | 严重性 | 描述 | 决策 |
|---------|---|--------|------|------|
| base | M-05 | **Medium** | TEST_RUN_COMPLETE pass/fail enforcement 未提交方案 | 已接受——TEST_RUN_COMPLETE case 已添加运行时校验 |
| base | M-06 | **Medium** | resolve_timeout 执行顺序差异无代码示例 | 已接受——R18 已添加差异说明 |
| base | M-07 | **Medium** | appendAudit 无 event 值运行时校验 | 已接受——TypeScript 编译时检查 + pipeline-store.ts 无校验行为一致 |
| phase1 | M-04 | **Medium** | extractExitCode fallback=1 可能超 5% 误拦率 | 已接受——文档已充分说明 fallback 策略 |
| phase1 | M-08 | **Medium** | AC-5 100KB 为字符数非字节数 | 已接受——文档 L618-619 已有详尽说明 |
| phase2 | M-04 | **Medium** | TEST_EVIDENCE 检测依赖 LLM prompt 遵从 | 已接受——设计 spec 层面无需程序化 fallback |
| phase2 | M-05 | **Medium** | pass=0/fail=0 边缘情况 | 已接受——TEST_RUN_COMPLETE case 已添加 pass+fail=0 注释 |
| phase2 | M-06 | **Medium** | Reviewer 超时与 TEST_EVIDENCE 交互 | 已接受——MAX_RALPH_ROUNDS 兜底 |
| phase4 | M-06 | **Medium** | readMcpAuditLog 文件发现机制未定义 | 已接受——Phase 4 前置接口规格中定义 |
| phase4 | M-07 | **Medium** | init_repo .gitignore 修改未在合并表格追踪 | 已接受——添加追踪说明 |
| phase4 | M-08 | **Medium** | AC-5 无状态验证仅代码审查 | 已接受——AC 可在实现阶段补充自动化 lint |
| base | L-01 | **Low** | command 字段存储敏感数据 | 已接受——Phase 2 脱敏计划已有 |
| base | L-02 | **Low** | phase vs currentPhase 命名不一致 | 已接受——R18 已文档化解构映射 |
| base | L-03 | **Low** | McpAuditEntry 联合类型缺乏扩展协议 | 已接受——Phase 4 细节 |
| phase1 | L-01 | **Low** | a.command 类型守卫仅注释 | 已接受——文档已标注实现时添加 |
| phase1 | L-02 | **Low** | a.filePath/a.content 类型守卫 | 已接受——文档已标注 |
| phase1 | L-03 | **Low** | AC-3 测试配置与生产默认值不同 | 已接受——测试配置文档化 |
| phase1 | L-04 | **Low** | Promise.race 无法中断同步 CPU 工作 | 已接受——文档 L94 已说明 |
| phase2 | L-01 | **Low** | read_audit_log 工具接口未定义 | 已接受——Phase 4 前置任务 |
| phase2 | L-02 | **Low** | AC #5 错误行为未定义 | 已接受——TEST_RUN_COMPLETE case 已定义返回格式 |
| phase2 | L-03 | **Low** | degradation fallback chain 无优先级 | 已接受——Phase 4 细节 |
| phase4 | L-01 | **Low** | Stash 清理 git ancestry 性能 | 已接受——Phase 4 实现时补充 |
| phase4 | L-02 | **Low** | cleanup_rollback_stashes 测试计划缺失 | 已接受——新增测试类目添加到 §3.4.4 |
| phase4 | L-03 | **Low** | CI 环境变量描述位置不当 | 已接受——低优先级排版问题 |
| base | I-01 | **Info** | 18 轮审核文档已充分验证 | 信息级，无行动 |
| phase1 | I-01 | **Info** | AC 纯 WHAT 无 HOW 泄漏 | 信息级，无行动 |
| phase4 | I-01 | **Info** | commit_rule 签名变更未标注 | 信息级，可 Phase 4 实现时标注 |

### 停止条件检查

- Round 2 (R19) 有 9H + 23M > 0 → **NOT CLEAN**
- 连续 clean 轮次: 0
- 需要 Round 3 继续

### 版本更新

- v1.34 → v1.35
- 新增 Appendix AA 记录 R19 修改

## Appendix BB：R20 Ralph Review Fixes（v1.36）

### 审查轮次

R20（2026-05-31），拆分文档并行 Oracle Recall Pass × 4 sub-documents（Round 3）。35 项原始发现（4H, 12M, 15L, 4I），19 项采纳修复，12 项确认但仅标注，4 项信息级。

### 收敛趋势

| Round | H | M | L | I | Total | Fixed |
|-------|---|---|---|---|-------|-------|
| R18 (Round 1) | - | - | - | - | 25 | 13 |
| R19 (Round 2) | 9 | 23 | 13 | 3 | 48 | 21 |
| R20 (Round 3) | 4 | 12 | 15 | 4 | 35 | 19 |

### 采纳修复的 Findings（19 项）

| # | 严重性 | 描述 | 位置 | 修复措施 |
|---|--------|------|------|----------|
| H1 | **High** | SYNTAX_ERROR_POST_WRITE auto-resolve 缺少 resolveViolations 调用 | §3.1.1 auto-resolve 调用 2 | 添加 resolveViolations 调用；添加 tool==='Write' 条件守卫 |
| H2 | **High** | AUDIT_ROTATION_LIMIT_EXCEEDED 携带 severity='warn' 违反 Observer-only 约束 | §3.0.1 severity 字段注释 | 扩展 severity 注释为 'Observer 和 appendAudit 内部检查生成的条目携带' |
| H3 | **High** | resolve_timeout 可能产生双重审计条目（标准 + TIMEOUT_RESOLVED） | §3.0.1 resolve_timeout 流程 | 添加双重条目说明注释 |
| H4 | **High** | multi-agent 模式 PipelineStateCache.get() 返回新对象，Observer 修改丢失 | §3.0.3 持久化策略 | 添加 single-agent-only 前提条件说明 |
| M1 | **Medium** | Auto-resolve 需要 tool 类型条件守卫 | §3.1.1 auto-resolve 三个调用 | 调用 1 添加 if(tool==='Bash')，调用 2 添加 if(tool==='Write') |
| M2 | **Medium** | Auto-resolve 伪代码仍使用 `a.command`（scope 错误） | §3.1.1 auto-resolve | 更新为 `arArgs.command` 和 `arArgs.filePath` |
| M3 | **Medium** | phase_complete CheckpointEvent 定义缺少 observerTimeoutCount 重置 | §3.0.1 CheckpointEvent | 添加 Phase 1 扩展 action 注释 |
| M4 | **Medium** | resolve_timeout writeState 失败后无恢复路径 | §3.0.1 resolve_timeout | 添加 auto-resolve 兜底恢复说明 |
| M5 | **Medium** | TEST_RUN_COMPLETE 是审计事件不是 CheckpointEvent | §3.2.1 CheckpointHandler | 添加 dual-type dispatch 说明注释 |
| M6 | **Medium** | tdd_checkpoint 返回类型 void 与 TEST_RUN_COMPLETE {success} 矛盾 | §3.0.3 tdd_checkpoint 签名 | 更新返回类型为 `{success, error?} | void` |
| M7 | **Medium** | KiDocManager 方法到 MCP 工具映射未说明 | §3.4.1 合并表格 | 添加调用方职责说明注释 |
| M8 | **Medium** | committer.py 行引用错误（L12-28 → L5-31） | §3.4.2 删除列表 | 修正行引用 + 标注 net-new 功能增强 |
| M9 | **Medium** | CI skip_guard 描述矛盾 | §3.4.3 CI 段落 | 改为 ARISTOTLE_CI=true 时 skip_guard 不可用 |
| L1 | **Low** | Appendix R F-19 命名错误（应为 lowercase 非 SCREAMING_SNAKE_CASE） | Appendix R | 修正描述 |
| L2 | **Low** | _timedOut 守卫缺失于 Write 分支 3 个 appendAudit 调用 | §3.1.1 Write branch | 添加 if(this._timedOut) return 守卫 |
| L3 | **Low** | AUTO-RESOLVE 位置标记实际不存在 | §3.1.1 recordTaskAndScan 之后 | 添加 `/* === AUTO-RESOLVE (runs here) === */` 标记 |
| L4 | **Low** | YAML 错误消息未使用 fallback | §3.1.1 YAML SYNTAX_ERROR | 添加 `?? '未知 YAML 语法错误'` fallback |
| L5 | **Low** | NaN 通过 typeof 检查（typeof NaN === 'number'） | §3.2.1 TEST_RUN_COMPLETE | 添加 Number.isFinite 检查 |
| L6 | **Low** | Two different error_summary limits 未区分 | §3.4.3 审计日志 | 添加两者独立作用于不同数据路径的说明 |

### 确认但仅标注的 Findings（12 项）

| Sub-doc | # | 严重性 | 描述 | 决策 |
|---------|---|--------|------|------|
| base | M-F05 | **Medium** | resolveViolations I/O 预算与 ≤5ms 子预算冲突 | 已接受——R19 已添加子预算说明和 >100 条目跳过机制 |
| base | M-F06 | **Medium** | OBSERVER_TIMEOUT_DEGRAGED 出现在 getUnresolvedViolations('warn') | 已接受——design choice，消费者按 event 区分 |
| base | L-F08 | **Low** | _timedOut 并发 handle() 竞争 | 已接受——JS 单线程 + Observer 单实例假设 |
| base | L-F10 | **Low** | resolve_timeout 无 ownerSessionId 检查 | 已接受——恢复操作非绕过，TIMEOUT_RESOLVED 审计追踪 |
| phase1 | L-F07 | **Low** | a.command 类型守卫仅注释 | 已接受——文档已标注实现时添加 |
| phase2 | M-F03 | **Medium** | M→H 升级慢回退（MAX_RALPH_ROUNDS=20） | 已接受——20 轮 safety net 可接受 |
| phase2 | L-F06 | **Low** | TEST_RUN_COMPLETE 无 phase guard | 已接受——by design，孤立条目不影响门控 |
| phase2 | I-F08 | **Info** | 多 TEST_RUN_REQUESTED 配对 | 信息级——Reviewer 按 timestamp 匹配最新 |
| phase2 | I-F09 | **Info** | state vs trState 不同访问模式 | 信息级——cache.get() 返回同一引用 |
| phase2 | I-F10 | **Info** | consecutiveZero 交互正确 | 信息级——确认设计正确 |
| phase4 | L-F05 | **Low** | Stash 清理算法仅按时间 | 已接受——Phase 4 实现时改进 |
| phase4 | I-F08 | **Info** | commit_rule 双来源增强 | 信息级——文档已说明 |

### 停止条件检查

- Round 3 (R20) 有 4H + 12M > 0 → **NOT CLEAN**
- 连续 clean 轮次: 0
- 需要 Round 4 继续

### 版本更新

- v1.35 → v1.36
- 新增 Appendix BB 记录 R20 修改

## Appendix CC：R21 Ralph Review Fixes（v1.37）

### 审查轮次

R21（2026-05-31），拆分文档并行 Oracle Recall Pass × 4 sub-documents（Round 4）。43 项原始发现（1H, 11M, 29L, 2I），12 项采纳修复，31 项确认但仅标注。

### 收敛趋势（C+H+M only）

| Round | C+H | M | Total C/H/M | Fixed |
|-------|-----|---|-------------|-------|
| R19 | 9 | 23 | 32 | 21 |
| R20 | 4 | 12 | 16 | 19 |
| R21 | 1 | 11 | 12 | 12 |

### 采纳修复的 Findings（12 项）

| # | 严重性 | 描述 | 位置 | 修复措施 |
|---|--------|------|------|----------|
| H1 | **High** | §3.2.1 降级检测逻辑为 ~1200 字符内联注释墙 | §3.2.1 degradation | 添加结构化注释 + 建议提取为 _checkDegradation 私有方法 |
| M1 | **Medium** | getUnresolvedViolations 签名缺少 projectId/runId 参数 | §3.0.2 | 签名添加 projectId, runId 参数 |
| M2 | **Medium** | TEST_RUN_COMPLETE 使用 trState 与 phase_complete 使用 state 不一致 | §3.2.1 | 添加 shared-reference invariant 说明注释 |
| M3 | **Medium** | ralphRoundCount 新增 vs 复用 PipelineState.round 自相矛盾 | §3.2.1 | 删除过时新增建议 |
| M4 | **Medium** | error_summary 类型未校验 | §3.2.1 TEST_RUN_COMPLETE | 添加 trusted input 说明 |
| M5 | **Medium** | read_audit_log 接口规格 + 传递机制未定义 | §3.2.2 | 添加接口签名 + 注入 Reviewer prompt 机制 |
| M6 | **Medium** | §3.4 合并表格被 `// 注：` 注释中断（Markdown 解析错误） | §3.4.0-3.4.1 | 改为 `> **注**：` blockquote 格式 |
| M7 | **Medium** | commit_rule 行为变更段落过于密集 | §3.4.3 | 拆分为带标题的子段落 |
| M8 | **Medium** | git ls-files 命令在文件名含空格时不安全 | §3.4.1 | 使用 `-z` null 分隔 + `xargs -0` |
| M9 | **Medium** | KiDocManager 方法映射实现细节延迟未标注 | §3.4.1 | 添加延迟到 Phase 4 实现的明确说明 |
| L1 | **Low** | _timedOut set（catch 块）和 reset（handle 开头）缺失于伪代码 | §3.1.1 | 添加 `this._timedOut = true/false` |
| L2 | **Low** | filePath/content 类型守卫未实现 + "发见"笔误 | §3.1.1 + §3.2.1 | 添加 typeof 守卫 + 修正笔误 |

### 停止条件检查

- Round 4 (R21) 有 1H + 11M > 0 → **NOT CLEAN**
- 连续 clean 轮次: 0
- C+H+M 趋势: 32 → 16 → 12 → 需要 Round 5

### 版本更新

- v1.36 → v1.37
- 新增 Appendix CC 记录 R21 修改

---

## Appendix DD: Round 5 Fix Record (v1.37 → v1.38)

| # | Severity | Location | Fix Description | Status |
|---|----------|----------|-----------------|--------|
| H1 | HIGH | §3.1 Observer | _timedOut 并发安全：添加平台串行契约注释 | ✅ Fixed |
| M1 | MEDIUM | §3.0.3 | PipelineState 字段列表修正（移除 sessionId/activeRun/round，标注来源） | ✅ Fixed |
| M2 | MEDIUM | §3.0.1 | resolve_timeout 调用签名同步为 4-param | ✅ Fixed |
| M3 | MEDIUM | §3.1 | 移除已实现守卫的过时 TODO 注释 | ✅ Fixed |
| M4 | MEDIUM | §3.1 | normalizeCommand 添加 a.command 类型守卫 | ✅ Fixed |
| M5 | MEDIUM | §3.1 | auto-resolve 耗时描述统一：典型<1ms，上限≤5ms，涉及文件 I/O | ✅ Fixed |
| M6 | MEDIUM | §3.2 | "无 round cap" 修正为"无自然终止 round cap" | ✅ Fixed |
| M7 | MEDIUM | §3.2 | "下次 run 可继续" 明确为审计日志上下文（非 resume） | ✅ Fixed |
| M8 | MEDIUM | §3.2 | 移除重复的 MAX_RALPH_ROUNDS 安全网悬挂句 | ✅ Fixed |
| M9 | MEDIUM | §3.2 | Phase 1 前置依赖从 Phase 2 产出物分离为独立子节 | ✅ Fixed |
| M10 | MEDIUM | §3.2 | degradation 伪代码提取为独立代码块 | ✅ Fixed |
| M11 | MEDIUM | §3.2 | Observer degraded 检查添加 §3.1 交叉引用 | ✅ Fixed |
| M12 | MEDIUM | §3.4.1 | orphaned table rows 重构为命名子表 | ✅ Fixed |
| M13 | MEDIUM | §3.4.0 | blockquote 移至表后，保持表格连续 | ✅ Fixed |
| M14 | MEDIUM | §3.4 | PIPE_BUF 引用替换为平台无关实用限制说明 | ✅ Fixed |

**Round 5 Totals**: 1H + 14M + 12L + 4I = 31 findings → 15 fixed (all C/H/M)

---

## Appendix EE: Round 6 Fix Record (v1.38 → v1.39)

**Systemic fix**: Added "Phase 1 target — not yet implemented" annotations across §3.0–§3.0.6 to clarify current-vs-target state. This addresses 11 H-level findings of the same class (doc describes features not yet in codebase).

| # | Severity | Location | Fix Description | Status |
|---|----------|----------|-----------------|--------|
| H1 | HIGH | §3.0 header | Added Phase 1 目标状态说明 blockquote | ✅ Fixed |
| H2 | HIGH | §3.0.1 AuditLogEntry | Added "Phase 1 target events" annotation + 11 `// Phase 1 new` field markers | ✅ Fixed |
| H3 | HIGH | §3.0.1 CheckpointEvent | Added Phase 1/4 扩展事件 annotation | ✅ Fixed |
| H4 | HIGH | §3.0.2 PipelineStore | Added "Phase 1 target APIs" header note | ✅ Fixed |
| H5 | HIGH | §3.0.3 PipelineState | Added "Phase 1 new fields" annotation | ✅ Fixed |
| H6 | HIGH | §3.0.2 PipelineStore | resolve_timeout/force_resolve_violation annotated as Phase 1 target | ✅ Fixed |
| H7 | HIGH | §3.1 | _timedOut stale disclaimer replaced with accurate line references | ✅ Fixed |
| H8 | HIGH | §3.1 | >100 entries skip guard added before 3 resolveViolations calls | ✅ Fixed |
| H9 | HIGH | §3.1 | Auto-resolve wrapped in try/catch (runs outside Promise.race) | ✅ Fixed |
| H10 | HIGH | §3.2 | AUDIT_ROTATION_LIMIT_EXCEEDED → RALPH_ROUNDS_EXCEEDED (wrong event name) | ✅ Fixed |
| H11 | HIGH | §3.2 | Undefined §3.1 cross-reference replaced with inline PIPELINE_DEGRADED spec | ✅ Fixed |
| M1 | MEDIUM | §3.0.6 | MAX_RALPH_ROUNDS: 20→"Phase 2 target; current code: 10" | ✅ Fixed |
| M2 | MEDIUM | §3.0.6 | BUSINESS_CODE_PHASE: added "Phase 2 target; current: TEST_CODE_PHASE=4" | ✅ Fixed |
| M3 | MEDIUM | §3.0.6 | Added current codebase constants block | ✅ Fixed |
| M4 | MEDIUM | §3.0.3 tdd_checkpoint | Added Phase 2 target MCP wrapper annotation | ✅ Fixed |
| M5 | MEDIUM | §3.0.3 | Dense L278 paragraph restructured to bullet list | ✅ Fixed |
| M6 | MEDIUM | §3.0.3 tdd_checkpoint | Added dual dispatch note | ✅ Fixed |
| M7 | MEDIUM | §3.0.4 | Added "Phase 1 new file" header note | ✅ Fixed |
| M8 | MEDIUM | §3.0.5 | Added "Phase 1 new file" header note | ✅ Fixed |
| M9 | MEDIUM | §3.0.2 appendAudit | Added FIFO Phase 1 target behavior annotation | ✅ Fixed |
| M10 | MEDIUM | §2.1 | Added Observer Phase 0 capability note | ✅ Fixed |
| M11 | MEDIUM | §4.2 | Added performance budget Phase 1 target note | ✅ Fixed |
| M12 | MEDIUM | §3.1 | Auto-resolve Path branching note added | ✅ Fixed |
| M13 | MEDIUM | §3.1 | Performance budget notes consolidated to single block | ✅ Fixed |
| M14 | MEDIUM | §3.1 | resolveViolations inline signature added | ✅ Fixed |
| M15 | MEDIUM | §3.1 | archiveRun → §3.0.2 PipelineStore.archiveRun() reference | ✅ Fixed |
| M16 | MEDIUM | §3.1 | observerTimeoutCount reset race note added | ✅ Fixed |
| M17 | MEDIUM | §3.1 | PASS reference in filter comment corrected | ✅ Fixed |
| M18 | MEDIUM | §3.2 | `run` variable hoisted before MAX_RALPH_ROUNDS check | ✅ Fixed |
| M19 | MEDIUM | §3.2 | testEvidenceSeverity dead code explained (Reviewer loads independently) | ✅ Fixed |
| M20 | MEDIUM | §3.2 | [TEST_EVIDENCE] prefix convention formalized in 产出物 | ✅ Fixed |
| M21 | MEDIUM | §3.2 | "Phase 2+ 运维特性" → "Phase 3+ 延迟实施运维特性" | ✅ Fixed |
| M22 | MEDIUM | §3.2 | MAX_RALPH_ROUNDS safety net formatted as fenced code block | ✅ Fixed |
| M23 | MEDIUM | §3.2 | tdd_checkpoint dual dispatch parenthetical added | ✅ Fixed |
| M24 | MEDIUM | §3.4.2 | committer.py line range description clarified | ✅ Fixed |
| M25 | MEDIUM | §3.4.1 | Stash gap between 5-10 documented | ✅ Fixed |

**Round 6 Totals**: 11H + 22M + 12L + 6I = 51 findings → 36 fixed (all C/H/M)
**Systemic class**: 11/11 H-level findings were "Phase 1 target not annotated as such" — resolved with unified annotation approach rather than 11 individual fixes.

---

## Appendix FF: Round 7 Fix Record (v1.39 → v1.40)

| # | Severity | Location | Fix Description | Status |
|---|----------|----------|-----------------|--------|
| H1 | HIGH | §3.0.1 | resolve_timeout naming convention: added explicit CheckpointEvent legacy convention note | ✅ Fixed |
| H2 | HIGH | §3.2 | Commented-out MAX_RALPH_ROUNDS: state.round → state.ralph?.round | ✅ Fixed |
| H3 | HIGH | §3.4 | Trailing parenthesis typo ）)→ ） | ✅ Fixed |
| M1 | MEDIUM | §3.0.3 | PipelineStateCache migration reference note added | ✅ Fixed |
| M2 | MEDIUM | §3.0.3 | phase_complete applyTransition observerTimeoutCount reset implementation note | ✅ Fixed |
| M3 | MEDIUM | §3.0.6 | MAX_RALPH_ROUNDS transitions.ts impact annotation | ✅ Fixed |
| M4 | MEDIUM | §3.0.1 | PROMPT_INJECTION_DETECTED severity backward-compatibility note | ✅ Fixed |
| M5 | MEDIUM | §3.0.2 | appendAudit vs appendObservation await distinction note | ✅ Fixed |
| M6 | MEDIUM | §3.0.3 | Phase 1 implementation file list completeness | ✅ Fixed |
| M7 | MEDIUM | §3.1 | Empty content check moved before extensions computation | ✅ Fixed |
| M8 | MEDIUM | §3.2 | run hoisting scope ambiguity note | ✅ Fixed |
| M9 | MEDIUM | §3.0.1 | AUDIT_ROTATION_LIMIT_EXCEEDED Phase annotation (type: P1, runtime: P3+) | ✅ Fixed |
| M10 | MEDIUM | §3.2 | Nested code fence rendering fix | ✅ Fixed |
| M11 | MEDIUM | §3.2 | "PipelineState.round" → "PipelineState.ralph.round" comment fix | ✅ Fixed |
| M12 | MEDIUM | §3.2 | Cross-reference convention note + §3.1→qa-base.md clarification | ✅ Fixed |
| M13 | MEDIUM | §3.2 | Missing pass=0/fail=0 AC test case added | ✅ Fixed |
| M14 | MEDIUM | §3.4 | `//` notes converted to `>` blockquote format | ✅ Fixed |
| M15 | MEDIUM | §3.4.5 | AC-8/9/10 merged into table format | ✅ Fixed |
| M16 | MEDIUM | §3.4 | ARISTOTLE_CI cross-reference added | ✅ Fixed |
| M17 | MEDIUM | §3.4 | 5 new tools spec owner + review gate note added | ✅ Fixed |

**Round 7 Totals**: 3H + 20M + 14L + 8I = 45 findings → 20 fixed (all C/H/M, 3 rejected)

---

## Appendix GG: R8 Fix Record (Round 25 Recall — v1.40→v1.41)

**Summary**: 25 项修复（4H + 21M 全部 fixed，2 rejected）

### Rejected Items

| ID | Severity | Sub-doc | Description | Rejection Reason |
|----|----------|---------|-------------|------------------|
| B-F02 | HIGH | qa-base | same-reference invariant confidence | Rejected: same-reference holds, confidence 0.75, doc note accurate |
| B-F11 | MEDIUM | qa-base | auto-resolve block severity edge case | Rejected: low risk, affects auto-resolve not blocking, confidence 0.65 |

### Accepted Fixes

| ID | Severity | Category | Sub-doc | Description | Status |
|----|----------|----------|---------|-------------|--------|
| B-F01 | HIGH | new-case annotation | qa-base | §3.0.1 + §3.0.6: transitions.ts new-case annotation for resolve_timeout/force_resolve_violation/pipeline_reset | ✅ Fixed |
| P1-F01 | HIGH | control flow | qa-phase1 | §3.1: auto-resolve >100 guard `return` exits handle() entirely → changed to let flow continue to _handleObservations | ✅ Fixed |
| P2-F01 | HIGH | type mismatch | qa-phase2 | §3.2.2: state.runId → this.store.getActiveRun(state.projectId)?.runId ?? 'unknown' + null-safety note | ✅ Fixed |
| P4-F05 | HIGH | fallback strategy | qa-phase4 | §3.4.2: pipeline_reset no Watchdog fallback → added MCP handler direct trigger + known limitation | ✅ Fixed |
| B-F03 | MEDIUM | Phase 1 checklist | qa-base | §3.0.2: observer.ts L121 await removal added as Phase 1 action item | ✅ Fixed |
| B-F04 | MEDIUM | design decision | qa-base | §3.0.1: PROMPT_INJECTION_DETECTED severity → concrete "Phase 1 不补全" decision with rationale | ✅ Fixed |
| B-F05 | MEDIUM | file list | qa-base | §3.0.3: pipeline-store.ts added to Phase 1 implementation file list | ✅ Fixed |
| B-F06 | MEDIUM | counter timing | qa-base | §3.0.2: auditEntryCount increment timing note (post-write) | ✅ Fixed |
| B-F07 | MEDIUM | precondition | qa-base | §3.0.1: resolve_timeout awaiting_approval precondition note | ✅ Fixed |
| B-F08 | MEDIUM | design note | qa-base | §3.0.2: severity dual-purpose design note (undefined severity = not gated) | ✅ Fixed |
| B-F09 | MEDIUM | specificity | qa-base | §3.0.6: MAX_RALPH_ROUNDS transitions.ts impact annotation made specific | ✅ Fixed |
| B-F10 | MEDIUM | migration location | qa-base | §3.0.3: explicit migration defaults implementation location in pipeline-store.ts readState() | ✅ Fixed |
| P1-F02 | MEDIUM | stale reference | qa-phase1 | §3.1: stale line reference L310→L237 | ✅ Fixed |
| P1-F03 | MEDIUM | stale reference | qa-phase1 | §3.1: stale line reference L152→L184 | ✅ Fixed |
| P1-F04 | MEDIUM | formatting | qa-phase1 | §3.1: normalized inconsistent indentation in _handleObservations pseudocode | ✅ Fixed |
| P2-F02 | MEDIUM | clarification | qa-phase2 | §3.2.1: M→H escalation default behavior clarification (severity='warn' scenario) | ✅ Fixed |
| P2-F03 | MEDIUM | test cases | qa-phase2 | §3.2.3 AC #5: added NaN/Infinity boundary test cases | ✅ Fixed |
| P2-F04 | MEDIUM | reset mechanism | qa-phase2 | §3.2.2: auditEntryCount reset mechanism note (pipeline_start vs phase_complete) | ✅ Fixed |
| P4-F01 | MEDIUM | formatting | qa-phase4 | §3.4.2: blockquote extracted from list item to standalone | ✅ Fixed |
| P4-F02 | MEDIUM | reference update | qa-phase4 | §3.4.2: "以 // Phase 4" → "以 blockquote 注释「Phase 4」" | ✅ Fixed |
| P4-F03 | MEDIUM | verification | qa-phase4 | §3.4.2: committer.py line range verified (5-31 accurate, confirmed) | ✅ Fixed |
| P4-F04 | MEDIUM | clarity | qa-phase4 | §3.4.0: CommitGuard.validate_schema() = AutoCommitter.validate_schema() explicit statement | ✅ Fixed |
| P4-F06 | MEDIUM | misuse fix | qa-phase4 | §3.4.2: write_rule → file system operations (git checkout/direct write) | ✅ Fixed |
| P4-F12 | MEDIUM | dynamic count | qa-phase4 | §3.4.2: "删除其余 7 个" → "删除其余 stash（count - 3 个）" | ✅ Fixed |
| P4-F13 | MEDIUM | table formatting | qa-phase4 | §3.4.5 AC table: removed leading space from `| 4 |` row | ✅ Fixed |

23 findings (1M + 13L + 9I) confirmed but only annotated — not shown for brevity. Full list available in R8 Oracle Recall raw output.

**R8 tally**: 50 findings (0C + 5H + 23M + 13L + 9I) → 25 accepted (4H + 21M fixed) + 2 rejected. C+H+M convergence: 32→16→12→15→33→23→28. Clean-round counter: 0.

---

## Appendix HH: R9 Fix Record (Round 26 Recall — v1.41→v1.42)

**Summary**: 18 项修复（2H + 16M 全部 fixed）

### Accepted Fixes

| ID | Severity | Category | Sub-doc | Description | Status |
|----|----------|----------|---------|-------------|--------|
| B-F01 | MEDIUM | completeness | qa-base | Appendix GG: 添加 23 findings confirmed-but-annotated 汇总行 | ✅ Fixed |
| B-F02 | MEDIUM | tally correction | qa-base | Appendix GG tally: 23M→22M（21 accepted + 1 rejected = 22M） | ✅ Fixed |
| P1-F01 | HIGH | control flow | qa-phase1 | §3.1: auto-resolve >100 guard `if`→`else if`（三处），防止 >100 时 resolveViolations 仍执行 | ✅ Fixed |
| P1-F02 | MEDIUM | stale reference | qa-phase1 | §3.1: scope `a` 在 _handleObservations 内定义行引用 L184→L186 | ✅ Fixed |
| P1-F03 | MEDIUM | naming consistency | qa-phase1 | §3.1: `const arState` → `const state`，统一变量命名 | ✅ Fixed |
| P1-F04 | MEDIUM | section clarity | qa-phase1 | §3.1: 添加 `// --- Observer 私有方法 ---` section break，明确 _handleObservations 为类内方法 | ✅ Fixed |
| P2-F01 | MEDIUM | validation gap | qa-phase2 | §3.2: TEST_RUN_COMPLETE 添加 `!Number.isInteger(pass)` 验证 + AC #5 添加 pass=1.5→error 边界用例 | ✅ Fixed |
| P2-F02 | MEDIUM | code clarity | qa-phase2 | §3.2: trState/state same-reference invariant 注释说明 | ✅ Fixed |
| P2-F03 | MEDIUM | correctness | qa-phase2 | §3.2: severity fallback `evidenceConfig.severity \|\| 'block'` → `?? 'block'` | ✅ Fixed |
| P2-F04 | MEDIUM | type safety | qa-phase2 | §3.2: CheckpointHandler.handle() event 参数类型应扩展为 `CheckpointEvent \| AuditEvent` + exhaustiveness check 注释 | ✅ Fixed |
| P2-F05 | MEDIUM | persistence | qa-phase2 | §3.2: auditEntryCount write-frequency 澄清（内存状态，checkpoint 边界同步写入，崩溃恢复偏差说明） | ✅ Fixed |
| P2-F06 | MEDIUM | increment mechanism | qa-phase2 | §3.2: ralph.round 递增机制说明（Ralph Loop 编排器递增，CheckpointHandler 仅读取） | ✅ Fixed |
| P2-F07 | MEDIUM | sentinel improvement | qa-phase2 | §3.2: runId fallback `'unknown'` → `'__no_active_run__'`，避免与合法 runId 冲突 | ✅ Fixed |
| P2-F08 | MEDIUM | crash semantics | qa-phase2 | §3.2: 崩溃恢复语义说明（run-restart 非 run-resume，pipeline_start 重置计数器） | ✅ Fixed |
| P4-F01 | HIGH | factual error | qa-phase4 | §3.4.0: CommitGuard.validate_schema() 不存在纠正——校验逻辑来自 AutoCommitter.validate_schema()（committer.py:13-31），非 CommitGuard 自身方法 | ✅ Fixed |
| P4-F02 | MEDIUM | reference precision | qa-phase4 | §3.4.2: committer.py L12-31 从 "AutoCommitter.validate_schema 方法" → "AutoCommitter class（含 validate_schema 方法）" | ✅ Fixed |
| P4-F03 | MEDIUM | reference clarity | qa-phase4 | §3.4.1: "rollback_to_checkpoint 的 MCP handler" → "rollback_to_checkpoint 的 tool 实现（aristotle_mcp/server.py 中对应 handler）" | ✅ Fixed |
| P4-F04 | MEDIUM | consistency | qa-phase4 | §3.4.1: "Phase 4+ 设计" → "Phase 4 Watchdog 实现阶段定义"，统一 Phase 4 引用 | ✅ Fixed |

**R9 tally**: 42 findings (0C + 2H + 16M + 17L + 7I) → 18 accepted (2H + 16M fixed). C+H+M convergence: 32→16→12→15→33→23→28→18. Clean-round counter: 0.

---

## Appendix II: R10 Fix Record (Round 27 Recall — v1.42→v1.43)

13 项修复（0C + 0H + 13M 全部 fixed，10 rejected as confirmations）

*注：P4-F03 (H) rejected: document already self-identifies as Phase 4 blocking gate, no action needed.*

### Accepted Fixes

| ID | Severity | Category | Sub-doc | Description | Status |
|----|----------|----------|---------|-------------|--------|
| B-F02 | MEDIUM | line reference | qa-base | §3.0.1: observer.ts:111-116 → observer.ts L110-121（full coverage of audit entry creation + appendAudit call） | ✅ Fixed |
| B-F05 | MEDIUM | off-by-one | qa-base | §3.0.1: schema.ts:185-186 → schema.ts:184-185（runId is L184, projectId is L185） | ✅ Fixed |
| P1-1 | MEDIUM | stale reference | qa-phase1 | §3.1: L237 guard → L238 typeof guard（content is string, type-narrowed） | ✅ Fixed |
| P1-2 | MEDIUM | reference clarity | qa-phase1 | §3.1: external line references L459/L547/L606/L650/L680/L708 添加 (observer.ts) 前缀 + 双引用（observer.ts:L547 / 本文档:L143） | ✅ Fixed |
| P2-1 | MEDIUM | undefined reference | qa-phase2 | §3.2.2: 移除 V11 标签（未定义），改为直接描述 JSONL 行追加顺序保证 | ✅ Fixed |
| P2-2 | MEDIUM | redundancy | qa-phase2 | §3.2: L49 getActiveRun() 冗余注释——当 MAX_RALPH_ROUNDS safety net 启用时外层 `run` 已在 scope 中 | ✅ Fixed |
| P2-3 | MEDIUM | priority ordering | qa-phase2 | §3.2.2: runId 获取优先级排序（StateStore key → tdd_checkpoint response → pipeline_status MCP → StateStore 文件） | ✅ Fixed |
| P2-4 | MEDIUM | phase guard | qa-phase2 | §3.2: TEST_RUN_COMPLETE 不检查 currentPhase 设计选择注释 + 严格门控可选代码 | ✅ Fixed |
| P2-5 | MEDIUM | attribution | qa-phase2 | §3.2: AC #5 Number.isInteger() 拦截归因纠正（Number.isFinite() 对整数是冗余的） | ✅ Fixed |
| P2-6 | MEDIUM | dead variable | qa-phase2 | §3.2: testEvidenceSeverity 死变量注释（CheckpointHandler 不使用此变量做门控） | ✅ Fixed |
| P4-1 | MEDIUM | clarity | qa-phase4 | §3.4.0: CommitGuard schema 校验说明更明确（CommitGuard 类不定义 validate_schema 方法，逻辑来自 AutoCommitter） | ✅ Fixed |
| P4-4 | MEDIUM | annotation | qa-phase4 | §3.4.1: _tools_ki.py 标注为 Phase 4 新建文件；git_ops.py 标注 Phase 4 扩展 | ✅ Fixed |
| P4-8 | MEDIUM | accuracy | qa-phase4 | §3.4.0: CommitGuard 描述更新——ensure_committed 依赖 PipelineContext 有状态数据，schema 校验来自 AutoCommitter（committer.py） | ✅ Fixed |

### Rejected Items (Brief)

- **B-F01/F03/F06/F07/F10/F11/F12/F15/F17** (M, qa-base): Confirmations — existing descriptions accurate, no change needed.
- **P4-F03** (H, qa-phase4): Self-identified gate — document already self-identifies as Phase 4 blocking gate.

**R10 tally**: 48 findings (0C + 1H + 22M + 12L + 13I) → 13 accepted (0C + 0H + 13M fixed) + 10 rejected (9M confirmations + 1H self-identified gate). C+H+M convergence: 32→16→12→15→33→23→28→18→13. Clean-round counter: 0.

---

## Appendix JJ: R11 Fix Record (Round 28 Recall — v1.43→v1.44)

**Summary**: 8 项修复（1H + 7M 全部 fixed，37 rejected as design/style/confirmations）

### Accepted Fixes

| ID | Severity | Category | Sub-doc | Description | Status |
|----|----------|----------|---------|-------------|--------|
| B-F01 | HIGH | off-by-one | qa-base | §3.0.1: schema.ts AuditLogEntry 行引用全部 off-by-one（timestamp L183→L184, runId L184→L185, projectId L185→L186；Migration Note 184-185→185-186；L480 184-185→185-186） | ✅ Fixed |
| B-F02 | MEDIUM | out-of-range | qa-base | §3.0.1: pipeline-store.ts L417 引用超出文件范围（306 行），改为 L201（appendAudit 签名实际位置） | ✅ Fixed |
| B-F03 | MEDIUM | tally arithmetic | qa-appendix | Appendix II R10 tally 算术不一致：19M+22L+6I→22M+12L+13I，rejected 11→10（9M confirmations + 1H self-identified gate） | ✅ Fixed |
| B-F04 | MEDIUM | tally correction | qa-appendix | Appendix GG tally R9 B-F02 错误修改 23M→22M，还原为原始正确值 23M（21 accepted + 1 rejected + 1 annotated = 23M）；同步修正 14L→13L 使总和 = 50 | ✅ Fixed |
| P1-4 | MEDIUM | justification | qa-phase1 | §3.1: clearTimeout 原因纠正——未清理 setTimeout 不触发 unhandled rejection（Promise 已 settle），而是保持 event loop 引用并浪费 macrotask/定时器资源 | ✅ Fixed |
| P2-M03 | MEDIUM | dead variable | qa-phase2 | §3.2: testEvidenceSeverity 死变量赋值移除，转为纯注释块说明 severity 配置语义 | ✅ Fixed |
| P2-M05 | MEDIUM | persistence mismatch | qa-phase2 | §3.2: 降级状态持久化描述纠正——代码仅使用 this.degraded 实例变量（非 StateStore key），通过审计事件提供可观测性，init-time try/catch 恢复 | ✅ Fixed |
| P4-4 | MEDIUM | fallback command | qa-phase4 | §3.4 AC-4: fallback JSON-RPC pipe 命令无效（MCP stdio 需 initialize 握手），替换为 `uv run python -c` 直接导入 mcp 对象读取工具数 | ✅ Fixed |

**R11 tally**: 45 findings (1C + 6H + 21M + 11L + 6I) → 8 accepted (1H + 7M fixed) + 37 rejected (design suggestions, style improvements, confirmations). C+H+M convergence: 32→16→12→15→33→23→28→18→13→8. Clean-round counter: 0.

---

## Appendix KK: R12 Fix Record (Round 29 Recall — v1.44→v1.45)

**Summary**: 7 项修复（0C + 1H + 5M + 1L 全部 fixed，44 rejected as design/style/confirmations）

### Accepted Fixes

| # | ID | Severity | Sub-doc | Description | Status |
|---|-----|----------|---------|-------------|--------|
| 1 | B-F01 | MEDIUM | qa-base | Appendix II header "11 rejected" → "10 rejected"（实际 rejected 为 10 项） | ✅ Fixed |
| 2 | B-F02 | MEDIUM | qa-base | Appendix II tally "0C + 1H + 12M" → "0C + 0H + 13M"（accepted table 含 13 条全 MEDIUM，无 H） | ✅ Fixed |
| 3 | B-F03 | LOW | qa-base | pipeline-store.ts L370-374 → checkpoint.ts 文件引用纠正（§3.0.3 L323 + Appendix R8 table L2481） | ✅ Fixed |
| 4 | P1-001 | MEDIUM | qa-phase1 | "microtask" → "macrotask/定时器资源"（setTimeout 为宏任务，非 microtask；§3.1 L574 + Appendix R6 table L2219 + Appendix JJ L3067） | ✅ Fixed |
| 5 | P1-013 | MEDIUM | qa-phase1 | getUnresolvedViolations 缺失 projectId/runId 参数（§3.1 L788 添加 3-param 签名调用） | ✅ Fixed |
| 6 | P2-F01 | HIGH | qa-phase2 | warn severity 矛盾消解：L881 "不阻止推进" vs L882 "连续升级 H"——统一为"不直接阻止，连续时 Reviewer 独立升级" | ✅ Fixed |
| 7 | P4-01 | MEDIUM | qa-phase4 | AC-4 降级方案 JSON-RPC pipe 不可用（需 initialize 握手），标注为不可用并保留 print 备用验证 | ✅ Fixed |

**R12 tally**: 51 findings (0C + 4H + 21M + 16L + 10I) → 7 accepted (0C + 1H + 5M + 1L fixed) + 44 rejected (design suggestions, style improvements, confirmations, "consider" items). C+H+M convergence: 32→16→12→15→33→23→28→18→13→8→7. Clean-round counter: 0.

---

## Appendix LL: R13 Fix Record (Round 30 Recall — v1.45→v1.46)

**Summary**: 3 项修复（0C + 1H + 1M + 1L 全部 fixed，2 rejected as classification preference）
**Clean sub-docs**: qa-base (0 findings), qa-phase2 (0 findings)

### Accepted Fixes

| # | ID | Severity | Sub-doc | Description | Status |
|---|-----|----------|---------|-------------|--------|
| 1 | P1-F1 | HIGH | qa-phase1 | getUnresolvedViolations auto-resolve 伪代码（L498/510/521）使用 2-param 签名 `(severity, filter)`，与 §3.0.2 定义的 3-param 签名 `(projectId, runId, severity, filter?)` 不一致 | ✅ Fixed |
| 2 | P1-F2 | MEDIUM | qa-phase1 | observer.ts:L547/L606/L650/L680/L708/L459 为 Phase 1 target 行号，非当前代码（当前 253 行），添加 "Phase 1 target" 标注 | ✅ Fixed |
| 3 | P4-F2 | LOW | qa-phase4 | 工具清单 "init_repo" → "init_repo_tool"（MCP 注册名） | ✅ Fixed |

**R13 tally**: 5 findings (1C + 2H + 1M + 1L + 0I) → 3 accepted (0C + 1H + 1M + 1L fixed) + 2 rejected (classification preference). C+H+M convergence: 32→16→12→15→33→23→28→18→13→8→7→2. Clean-round counter: 0.
