# Known Issues & Design Constraints — Aristotle QA Implementation Plan

**Source version**: quality-assurance-implementation-plan.md v1.46
**Reference format**: `[module_file] §section Loriginal_line`
**Total issues**: 160

## Summary by Severity
- **limitation**: 115
- **performance**: 27
- **migration**: 10
- **constraint**: 4
- **breaking-change**: 3
- **decision**: 1

## Summary by Module
- **§3.0 — Interfaces & Type Registry (01-interfaces.md)**: 51
- **§3.1 — Phase 1: Observer (02-phase1-observer.md)**: 50
- **§3.2 — Phase 2: Test Gate (03-phase2-test-gate.md)**: 23
- **§3.3 — Phase 3: Semantic Review (04-phase3-semantic.md)**: 12
- **§3.4 — Phase 4: Intervention Merge (05-phase4-merge.md)**: 9
- **§1-2, §4-7 — Overview & Principles (00-overview.md)**: 8
- **Appendices — Review Records (appendices.md)**: 7

---

## §3.0 — Interfaces & Type Registry (01-interfaces.md)

### [KI-002] `limitation` | [01-interfaces.md] §3.0 L125

> **⚠️ Phase 1 目标状态说明**：本文档 §3.0–§3.0.6 描述的是 Phase 1 实施目标。标注为"Phase 1 target"的接口、常量、API 和辅助函数在设计文档中完整定义，但**尚未在当前代码库中实现**。当前代码库仅包含基础架构（Observer、CheckpointHandler、PipelineStore 基础方法）。每个小节头部均有实现状态标注。实现者应以此为规范，以代码库为起点。

### [KI-003] `limitation` | [01-interfaces.md] §3.0 L135

// ⚠️ Phase 1 target events — current schema.ts only has CheckpointEvent | 'INTERCEPT' | 'PROMPT_INJECTION_DETECTED'

### [KI-004] `breaking-change` | [01-interfaces.md] §3.0 L137

runId: string;                    // 运行 ID（必填，与 schema.ts L185 一致）。⚠️ 与 appendAudit 3-param 签名冗余（L201），保留以兼容现有 schema。代码示例约定：Observer 代码示例省略 entry 内的 runId/projectId（由 3-param 签名参数隐式提供），Checkpoint 代码示例包含完整字段——两种风格均可，实现时保持一致即可。

### [KI-005] `limitation` | [01-interfaces.md] §3.0 L138

projectId: string;                // 项目 ID（必填，与 schema.ts L186 一致）。⚠️ 同上，与 3-param 签名冗余。

### [KI-006] `decision` | [01-interfaces.md] §3.0 L141

severity?: 'warn' | 'block';  // Phase 1 new — Observer entries only。Observer 和 appendAudit 内部检查生成的条目携带（非普通 CheckpointEvent 审计条目）。⚠️ 现有 PROMPT_INJECTION_DETECTED 审计条目（Phase 0 Observer）不携带 severity；Phase 1 不补全（design choice：非 Observer 门控条目，不影响 phase_complete 门控）。如需追溯，可通过 event type 过滤 PROMPT_INJECTIO...

### [KI-007] `breaking-change` | [01-interfaces.md] §3.0 L151

phase: number;                   // 触发时的 pipeline phase（必填 number，与 schema.ts 当前定义一致）。⚠️ 不可改为 optional——所有消费者依赖 phase 非空假设，改为 optional 属 Breaking Change。

### [KI-008] `limitation` | [01-interfaces.md] §3.0 L153

timestamp: string;              // ISO 8601（必填 string，与 schema.ts L184 一致）。⚠️ 不可改为 optional——所有消费者依赖 timestamp 非空假设。由调用方手动提供（new Date().toISOString()），appendAudit 不自动填充——与 observer.ts L110-121 模式一致。

### [KI-009] `limitation` | [01-interfaces.md] §3.0 L157

// ⚠️ pass/fail/error_summary 为 optional（多数事件无需），但 TEST_RUN_COMPLETE 事件要求全部必填。实现时使用运行时校验或 discriminated union。

### [KI-010] `migration` | [01-interfaces.md] §3.0 L163

**Migration Note**: Phase 1 扩展现有 AuditLogEntry，非替换。保留 `decision` 字段不变；Observer 专用事件通过扩展 event 联合类型添加（`'OBSERVER_TIMEOUT' | 'COMMAND_FAILED' | 'SYNTAX_ERROR_POST_WRITE'`）；Observer 审计条目使用 `severity` 作为扩展字段（仅 Observer 生成的条目携带）。建议定义 `ObserverAuditEntry extends AuditLogEntry` 类型。⚠️ **runId/projectId 冗余说明...

### [KI-011] `migration` | [01-interfaces.md] §3.0 L165

**⚠️ AuditLogEntry 接口差异说明**：文档展示的接口为 Phase 1 目标扩展。当前实现（`schema.ts`）`event` 为联合类型（非 `string`），`timestamp` 为 ISO string（非 Unix ms），`phase` 为必填。Phase 1 新增的 Observer 事件通过扩展 event 联合类型实现，`severity` 为新增字段（非替代 `decision`），`resolved`/`resolvedAt` 为新增字段。完整迁移对照参见 Migration Note（上文）。

### [KI-012] `limitation` | [01-interfaces.md] §3.0 L173

⚠️ DEGRADATION_MODE_ACTIVATED 可在任何 Phase 的 Watchdog 初始化阶段触发（不仅限于标注 Phase）。Phase 1 仅需将其纳入事件联合类型。DEGRADATION_MODE_ACTIVATED: Watchdog 初始化时可能触发（不限 Phase），具体触发路径见 §3.2.2 降级检测。Phase 1 实现需在 event 联合类型中包含此值，触发逻辑不限 Phase。⚠️ Phase 1 实际触发可能性：Phase 1 不实现 read_audit_log 工具注册（Phase 2 产出物），因此 DEGRADATION_MODE_ACT...

### [KI-013] `performance` | [01-interfaces.md] §3.0 L181

// ⚠️ Phase 1/4 扩展事件 — 当前 schema.ts CheckpointEvent 有 10 个值（不含 resolve_timeout/force_resolve_violation/pipeline_reset）

### [KI-014] `performance` | [01-interfaces.md] §3.0 L184

- `resolve_timeout`：payload 需含 `reason: string`（必填）；precondition：state 存在且 phaseStatus 为 active 或 ralph_loop（ralph_loop 阶段也可能触发 Observer 超时，resolve_timeout 应能覆盖）；action（纯状态变更）：重置 state.observerTimeoutCount = 0。// ⚠️ 注：awaiting_approval 状态下 Observer 仍可触发（如 approval 期间的 tool call），但 resolve_timeout 语义...

### [KI-015] `limitation` | [01-interfaces.md] §3.0 L185

- `force_resolve_violation`：payload 需含 `violation_type: string`（必填，如 'COMMAND_FAILED'）和 `reason: string`（必填）；precondition：state 存在 + sessionId 匹配 state.ownerSessionId；action（纯状态变更）：无 PipelineState 变更（force_resolve_violation 不修改 PipelineState 字段）。I/O 操作由 CheckpointHandler.handle() 在 applyTransition 返...

### [KI-016] `limitation` | [01-interfaces.md] §3.0 L186

- ⚠️ transitions.ts validateTransition 和 applyTransition 必须同步添加对应 case。applyTransition 仅负责纯状态变更（返回新 PipelineState），I/O 操作（resolveViolations、appendAudit）在 CheckpointHandler.handle() 中执行。

### [KI-017] `performance` | [01-interfaces.md] §3.0 L187

- ⚠️ transitions.ts new-case 完整列表：resolve_timeout、force_resolve_violation、pipeline_reset（Phase 4 占位）各需 NEW validateTransition + applyTransition case。遗漏任一 case 将导致运行时 throw（applyTransition default 为 `throw new Error(...)`）。

### [KI-018] `performance` | [01-interfaces.md] §3.0 L191

a. getUnresolvedViolations(projectId, runId, 'block', { event: 'OBSERVER_TIMEOUT' }) → 获取未恢复的 OBSERVER_TIMEOUT 条目。⚠️ 若返回空数组（无实际 OBSERVER_TIMEOUT 违规），resolveViolations 为 no-op，但仍写入 TIMEOUT_RESOLVED 审计事件。此为可接受行为——提供操作审计追踪（记录 resolve_timeout 被调用但无违规需恢复）。若需避免无意义审计条目，可在 getUnresolvedViolations 返回空时跳过后续步骤...

### [KI-019] `performance` | [01-interfaces.md] §3.0 L196

此分离确保 applyTransition 保持纯函数契约（transitions.ts L797-799）。⚠️ 执行顺序说明：resolve_timeout 的 writeState 在 I/O 之后（与现有 checkpoint.ts L393 模式 applyTransition→writeState→appendAudit 不同）。原因：resolveViolations 需要基于当前 state 的审计数据操作，先执行 I/O 再持久化更合理。风险：若 I/O 成功但 writeState 失败，审计日志显示 TIMEOUT_RESOLVED 但 state 中 observerT...

### [KI-020] `performance` | [01-interfaces.md] §3.0 L197

// ⚠️ 审计条目数量：resolve_timeout 产生两条审计条目——(1) 标准审计条目（event='resolve_timeout', decision='PASS'）由 CheckpointHandler L393 模式自动写入，(2) TIMEOUT_RESOLVED 由 I/O 层显式写入。两条条目共存，前者记录事件发生，后者记录语义恢复。force_resolve_violation 同理（标准条目 + FORCE_RESOLVED）。若需抑制标准条目，CheckpointHandler 需特殊处理跳过 L393 appendAudit。

### [KI-021] `limitation` | [01-interfaces.md] §3.0 L199

- ⚠️ ownerSessionId 为 optional 字段 (schema.ts L49 `string | undefined`)。若 ownerSessionId 为 undefined（pipeline run 无 owner），force_resolve_violation 被拒绝。确保 pipeline_start 时始终设置 ownerSessionId。

### [KI-022] `limitation` | [01-interfaces.md] §3.0 L229

> **⚠️ Phase 1 target APIs**: getUnresolvedViolations, resolveViolations 为 Phase 1 新增方法，当前 pipeline-store.ts 不包含这些方法。appendAudit 的 FIFO 检查和 evictionNeeded 逻辑为 Phase 1 目标行为，当前实现为简单的 appendLog wrapper。

### [KI-023] `limitation` | [01-interfaces.md] §3.0 L234

- 同步方法（void 返回），调用时不带 await（与现有 checkpoint.ts 代码风格一致，V4）。⚠️ 注：现有 observer.ts L121 使用 `await this.store.appendAudit(...)` 对 void 函数 await——虽 JS 允许（await 非 Promise 自动包装），但语义上无意义。Phase 1 实现应移除不必要的 await 以保持风格一致。// ⚠️ appendAudit 为同步 void（无需 await）；appendObservation 为 async Promise<void>（需 await）。Phase ...

### [KI-024] `limitation` | [01-interfaces.md] §3.0 L235

- FIFO 检查：写入前检查 `state.auditEntryCount`（O(1) 内存计数器），达到 5000 时设置 `evictionNeeded` 标记。Checkpoint 淘汰完成后更新计数器：`state.auditEntryCount -= evictedCount`（见 §3.2.2）。⚠️ auditEntryCount 应在 appendAudit 写入成功后递增（非写入前），避免写入失败导致计数器偏高。推荐模式：先 write → 成功后 count++。

### [KI-025] `limitation` | [01-interfaces.md] §3.0 L236

// ⚠️ Phase 1 target behavior — 当前 appendAudit 为简单 appendLog wrapper，无 FIFO 检查

### [KI-026] `performance` | [01-interfaces.md] §3.0 L241

- ⚠️ 若 Phase 2 改为 async，需重新评估 Observer 20ms 超时保护

### [KI-027] `limitation` | [01-interfaces.md] §3.0 L248

// ⚠️ projectId/runId 定位 audit key 路径（watchdog/${projectId}/${runId}/audit*）。与 resolveViolations 签名风格一致。

### [KI-028] `performance` | [01-interfaces.md] §3.0 L252

- ⚠️ 设计约定：severity 字段同时作为 Observer-origin 标记——undefined severity = 不参与门控决策，无论 decision 值。这确保 CheckpointHandler 生成的条目（如 phase_complete、TIMEOUT_RESOLVED）不会被误纳入门控逻辑。

### [KI-029] `limitation` | [01-interfaces.md] §3.0 L253

- `commandPattern`：用于 COMMAND_FAILED 场景精确匹配（auto-resolve 等场景共用），按 normalizeCommand 后的命令字符串精确匹配（===）。⚠️ 匹配机制：COMMAND_FAILED 条目需在 AuditLogEntry 新增 `command?: string` 索引字段存储 normalizeCommand 后的命令字符串。getUnresolvedViolations 内部按此字段精确匹配（===）。若 Phase 1 不添加此字段，则 commandPattern 回退为全量匹配（解析 violation 字符串提取命令，但...

### [KI-030] `limitation` | [01-interfaces.md] §3.0 L260

// ⚠️ 索引实现：(a) 结构 Map<severity, Map<event, AuditLogEntry[]>>（推荐），(b) 懒加载：首次查询时构建，appendAudit 时增量更新，resolveViolations/FIFO eviction 时全量重建，(c) Phase 1 可降级为 O(n) 全扫描（n ≤ 5000），P99 <5ms 可接受。

### [KI-031] `limitation` | [01-interfaces.md] §3.0 L268

- 使用 timestamp（ISO 8601 字符串数组）作为条目定位键，与 getUnresolvedViolations 返回的 `AuditLogEntry.timestamp` 直接对应。⚠️ 低风险：ISO 8601 毫秒精度在 JS 单线程下通常唯一。极端场景下同一毫秒内产生两条审计条目可能导致 resolveViolations 误标记同时间戳的条目。风险可接受（需同一毫秒 + 其中一条需 resolve 而另一条不需）。若需更强唯一性保证，可在 Phase 4+ 考虑添加自增 sequenceId 字段。

### [KI-032] `performance` | [01-interfaces.md] §3.0 L277

// ⚠️ Phase 1 new fields — observerTimeoutCount, auditEntryCount, evictionNeeded 不在当前 schema.ts PipelineState 中

### [KI-033] `performance` | [01-interfaces.md] §3.0 L281

- (3) phase_complete：阶段推进成功时重置为 0 // Phase 1 扩展 action：重置 state.observerTimeoutCount = 0（§3.0.3 L271, §4.2 L460）。⚠️ Phase 1 实现：transitions.ts phase_complete applyTransition 返回值必须显式包含 observerTimeoutCount: 0（spread operator 会保留旧值）

### [KI-034] `performance` | [01-interfaces.md] §3.0 L283

- **持久化策略**：Observer handle() 直接修改内存 state 后不显式调用 writeState。变更通过下一次 CheckpointHandler.handle() 的 writeState 调用持久化。⚠️ **前置条件**：PipelineStateCache.get() 必须返回同一对象引用（非深拷贝）。Observer 通过 `const state = this.cache.get()` 获取引用后直接修改 state.observerTimeoutCount 等字段，若 cache 返回副本则变更静默丢失。若未来 cache 实现改为返回副本，需同步修改 ...

### [KI-035] `migration` | [01-interfaces.md] §3.0 L287

**Phase 1 迁移默认值**：PipelineState 加载时补充默认值：`state.observerTimeoutCount = state.observerTimeoutCount ?? 0; state.auditEntryCount = state.auditEntryCount ?? 0; state.evictionNeeded = state.evictionNeeded ?? false;` // ⚠️ 迁移默认值添加位置：pipeline-store.ts readState() 函数，JSON.parse 之后、return 之前。代码模式：`state.obse...

### [KI-036] `limitation` | [01-interfaces.md] §3.0 L289

⚠️ **PipelineState 字段来源**：

### [KI-037] `limitation` | [01-interfaces.md] §3.0 L299

⚠️ 仅显示 Phase 3（Schema v5）扩展的 severity 联合类型。完整接口见 `packages/watchdog/src/schema.ts`（含 description、original、downgrade_reason 等不变字段）。

### [KI-038] `limitation` | [01-interfaces.md] §3.0 L309

⚠️ 仅显示 Phase 3（Schema v5）扩展的 counts 类型。完整接口见 `packages/watchdog/src/schema.ts`（含 round: number、submittedAt: string 等不变字段）。

### [KI-039] `limitation` | [01-interfaces.md] §3.0 L323

startedAt: string;    // checkpoint.ts setActiveRun 必填（⚠️ 文件引用修正：原引用 pipeline-store.ts L370-374 不正确，实际位于 checkpoint.ts）

### [KI-040] `limitation` | [01-interfaces.md] §3.0 L332

tdd_checkpoint(event: string, test_result?: { pass: number; fail: number; error_summary: string }): { success: boolean; error?: string } | void  // ⚠️ TEST_RUN_COMPLETE case 返回 {success, error?}，其余 CheckpointEvent 返回 void

### [KI-041] `limitation` | [01-interfaces.md] §3.0 L333

// ⚠️ Phase 2 target MCP wrapper interface — 当前 CheckpointHandler.handle() 返回 JSON.stringify(CheckpointResult) = {ok, state} | {ok, violation, guidance}

### [KI-042] `limitation` | [01-interfaces.md] §3.0 L334

// ⚠️ 当 event='TEST_RUN_COMPLETE' 时，test_result 参数必填

### [KI-043] `limitation` | [01-interfaces.md] §3.0 L335

// ⚠️ tdd_checkpoint 通过 string 参数同时 dispatch CheckpointEvent（pipeline 状态机）和 AuditLogEntry.event（纯审计写入）。Phase 2 扩展了 TEST_RUN_COMPLETE 等 AuditEvent。

### [KI-044] `performance` | [01-interfaces.md] §3.0 L340

> **⚠️ Phase 1 new file — rule-config.ts 不存在。所有辅助函数（extractExitCode, quickSyntaxCheck, yamlSyntaxCheck, matchPattern, normalizeCommand, ObserverTimeoutError）为 Phase 1 新增。**

### [KI-045] `limitation` | [01-interfaces.md] §3.0 L344

从 Bash 工具 output 中解析退出码。格式：`output` 最后行含 `Exit code: N` 或 process exit signal。实现：正则 `/exit code: (\d+)/i` 提取。⚠️ **Fallback 策略统一为 1（fail-safe）**：所有未匹配路径均返回 1（而非 0），确保未知退出状态被标记为失败。若 Phase 1 上线后发现 fail-safe 导致过多误报，可切换为 fallback=0（fail-open）收集数据。Phase 1 默认使用 fallback=1。

### [KI-046] `constraint` | [01-interfaces.md] §3.0 L348

TypeScript 语法快速检查。依赖 `typescript` compiler API（`createSourceFile` + `SyntaxKind` 遍历）。返回 `{ ok: true }` 或 `{ ok: false, error: '行 X: 语法错误描述' }`。⚠️ 评估轻量替代方案（如 `acorn` ~100KB 做纯语法解析）以减少生产环境依赖体积。Phase 1 决策：先仅支持 JSON/YAML 验证（零新运行时依赖），TypeScript 验证延后至 Phase 2 评估。Phase 1 从依赖列表中移除 `typescript` 运行时依赖（保留为 dev...

### [KI-047] `limitation` | [01-interfaces.md] §3.0 L352

YAML 语法检查。依赖 `js-yaml` 库（`yaml.load(content, { schema: yaml.JSON_SCHEMA })` 包裹 try/catch）。⚠️ **必须使用 JSON_SCHEMA**（非默认 DEFAULT_SCHEMA），因为 DEFAULT_SCHEMA 支持 `!!js/function` 等 JS-specific 类型，存在任意代码执行风险。返回格式同上。

### [KI-048] `limitation` | [01-interfaces.md] §3.0 L360

统一命令字符串格式（trim 首尾空白 → 连续空白压缩为单空格）。⚠️ **所有命令匹配路径**（auto-resolve 精确匹配、ignoreCommands glob 匹配）必须先调用此函数，确保匹配一致性。

### [KI-049] `limitation` | [01-interfaces.md] §3.0 L372

> **⚠️ Phase 1 new file — rule-config.ts 不存在。RuleConfig/RulesFile/RuleConfigLoader 为 Phase 1 新增。**

### [KI-050] `constraint` | [01-interfaces.md] §3.0 L404

private static cache: RulesFile | null = null;  // ⚠️ @single-project 约束：假设 Watchdog 运行在单项目上下文（一个 OpenCode 实例 = 一个项目）。若支持多项目，缓存需改为 `Map<projectId, RulesFile>`。

### [KI-051] `limitation` | [01-interfaces.md] §3.0 L417

> ⚠️ 标注 "Phase 1 target" 的常量值为设计目标。当前 constants.ts 实际值可能不同。Phase 列表示计划实施阶段。

### [KI-052] `performance` | [01-interfaces.md] §3.0 L432

| MAX_RALPH_ROUNDS | 20 (Phase 2 target; current code: 10) | P2 | §3.2.1 |（影响：constants.ts + transitions.ts（validateTallyTermination 中 MAX_RALPH_ROUNDS 比较逻辑，ralph_terminate 中状态转换触发））。⚠️ resolve_timeout、force_resolve_violation、pipeline_reset 三个新增 CheckpointEvent 各需 transitions.ts 中 NEW validateTransi...

## §3.1 — Phase 1: Observer (02-phase1-observer.md)

### [KI-053] `limitation` | [02-phase1-observer.md] §3.1 L468

> ⚠️ 以下为 Phase 1 **拟实现代码**，非当前 observer.ts 实现。当前 handle() 仅处理 Task 工具的 ralph_loop 观察（见实际代码 observer.ts:141-193）。

### [KI-054] `limitation` | [02-phase1-observer.md] §3.1 L471

// ⚠️ Phase 1 目标接口说明：

### [KI-055] `performance` | [02-phase1-observer.md] §3.1 L481

// - ⚠️ appendAudit 当前为同步方法（pipeline-store.ts:201 返回 void）。代码示例中不带 await，与现有 checkpoint.ts 代码风格一致（V4）。若 Phase 2 改为 async，需重新评估 Observer 20ms 超时保护。

### [KI-056] `performance` | [02-phase1-observer.md] §3.1 L487

// ⚠️ projectId 和 runId 从 this.cache.get() 获取的 PipelineState 中解构（同上方 OBSERVER_TIMEOUT handler）。

### [KI-057] `limitation` | [02-phase1-observer.md] §3.1 L490

// ⚠️ 以下 auto-resolve 伪代码的执行位置在 recordTaskAndScan 之后、Promise.race 之前。

### [KI-058] `limitation` | [02-phase1-observer.md] §3.1 L493

// ⚠️ scope: `a` 在 _handleObservations 内定义（L186），auto-resolve 在 handle() 顶层执行。

### [KI-059] `performance` | [02-phase1-observer.md] §3.1 L500

//     // ⚠️ 安全守卫：超过 100 条目跳过 resolveViolations（性能保护）

### [KI-060] `limitation` | [02-phase1-observer.md] §3.1 L502

//     // ⚠️ 不 return——继续执行后续 _handleObservations 逻辑（仅跳过 resolveViolations）

### [KI-061] `performance` | [02-phase1-observer.md] §3.1 L512

//     // ⚠️ 安全守卫：超过 100 条目跳过 resolveViolations（性能保护）

### [KI-062] `limitation` | [02-phase1-observer.md] §3.1 L514

//     // ⚠️ 不 return——继续执行后续 _handleObservations 逻辑（仅跳过 resolveViolations）

### [KI-063] `performance` | [02-phase1-observer.md] §3.1 L523

//   // ⚠️ 安全守卫：超过 100 条目跳过 resolveViolations（性能保护）

### [KI-064] `limitation` | [02-phase1-observer.md] §3.1 L525

//   // ⚠️ 不 return——继续执行后续 _handleObservations 逻辑（仅跳过 resolveViolations）

### [KI-065] `performance` | [02-phase1-observer.md] §3.1 L529

//   // ⚠️ 成功 auto-resolve OBSERVER_TIMEOUT 后重置降级计数器

### [KI-066] `limitation` | [02-phase1-observer.md] §3.1 L532

//   // ⚠️ 计数器重置基于 recordTaskAndScan 成功而非 _handleObservations 成功。若当前观察后续超时，计数器将从 0 重新开始（保守行为）。

### [KI-067] `performance` | [02-phase1-observer.md] §3.1 L534

// ⚠️ 设计决策：auto-resolve 仅处理 block 级 OBSERVER_TIMEOUT 事件（第 1-2 次超时）。降级后的 warn 级事件（第 3 次起）保留为历史审计记录，不自动 resolve。observerTimeoutCount 重置为 0 后，下次超时序列重新计数。

### [KI-068] `limitation` | [02-phase1-observer.md] §3.1 L535

// ⚠️ 多维过滤：COMMAND_FAILED/SYNTAX_ERROR_POST_WRITE 按 tool+filePath 匹配，

### [KI-069] `limitation` | [02-phase1-observer.md] §3.1 L541

// ⚠️ 执行位置：auto-resolve 在 recordTaskAndScan 之后、_handleObservations 之前执行。

### [KI-070] `limitation` | [02-phase1-observer.md] §3.1 L546

// ⚠️ 执行位置与超时保护的关系：

### [KI-071] `limitation` | [02-phase1-observer.md] §3.1 L553

// ⚠️ auto-resolve 运行在 Promise.race 超时保护之外，需独立 try/catch

### [KI-072] `limitation` | [02-phase1-observer.md] §3.1 L560

// ⚠️ auto-resolve 在 Path branching之前无条件执行；Bash/Write 过滤器自然排除非匹配工具（如 Task）

### [KI-073] `limitation` | [02-phase1-observer.md] §3.1 L561

// ⚠️ Phase 1 集成说明：以上 recordTaskAndScan 封装现有 observer.ts L141-183 的 Path 1（ralph_loop Task 观察）

### [KI-074] `limitation` | [02-phase1-observer.md] §3.1 L566

// ⚠️ 注意：Path 3 的实际条件是 state 存在 AND NOT (ralph_loop + Task tool)。

### [KI-075] `limitation` | [02-phase1-observer.md] §3.1 L573

// ⚠️ Promise.race 仅能中断 async 操作中的 yield 点（如 await），不能中断同步 CPU 密集操作。js-yaml/json.parse 等同步库执行时超时保护不生效。

### [KI-076] `performance` | [02-phase1-observer.md] §3.1 L574

// ⚠️ clearTimeout 必须在 finally 中调用——即使 _handleObservations 在 20ms 内完成，未清理的 setTimeout 会保持 event loop 引用并浪费 macrotask 资源（setTimeout 为宏任务/定时器资源，非 microtask）。

### [KI-077] `limitation` | [02-phase1-observer.md] §3.1 L589

// ⚠️ 降级计数器递增 + 检查

### [KI-078] `limitation` | [02-phase1-observer.md] §3.1 L613

// ⚠️ DEGRADED 事件为 information-only，severity='warn'，不参与 getUnresolvedViolations('block') 查询。这些事件不会被 auto-resolve 或 phase_complete 清理。唯一清理路径是 archiveRun → 见 §3.0.2 PipelineStore.archiveRun()（删除整个审计日志）。

### [KI-079] `limitation` | [02-phase1-observer.md] §3.1 L622

// ⚠️ 超时后防写入机制：Observer 设置 this._timedOut = true 标志（在 catch 块中）。_handleObservations 内部在每个 appendAudit 调用前检查 if (this._timedOut) return;。handle() 方法在每次调用开始时重置 this._timedOut = false。

### [KI-080] `limitation` | [02-phase1-observer.md] §3.1 L632

// ⚠️ 类型守卫：args 类型为 unknown，需先检查类型再访问属性

### [KI-081] `limitation` | [02-phase1-observer.md] §3.1 L643

// ⚠️ 类型守卫：output 类型为 unknown（observer.ts:143），需先检查类型

### [KI-082] `limitation` | [02-phase1-observer.md] §3.1 L650

&& !config.ignoreCommands?.some(pat => matchPattern(normalizedCmd  // ⚠️ 使用上方缓存的 normalizedCmd（原 a.command as string）

### [KI-083] `limitation` | [02-phase1-observer.md] §3.1 L658

// ⚠️ F-07: 存储 normalizeCommand 后的命令（非原始值），确保 auto-resolve 精确匹配。

### [KI-084] `limitation` | [02-phase1-observer.md] §3.1 L661

// ⚠️ F-17: 命令可能含敏感参数（API key、password、token）。Phase 1 存储完整命令供调试；

### [KI-085] `limitation` | [02-phase1-observer.md] §3.1 L663

// ⚠️ Watchdog StateStore 目录（.watchdog/）必须在 Phase 1 初始化时添加到 .gitignore，防止含原始命令的审计日志泄露到版本控制。

### [KI-086] `limitation` | [02-phase1-observer.md] §3.1 L670

// ⚠️ Auto-resolve 死锁缓解：auto-resolve 标记 resolved 不触发新命令执行，

### [KI-087] `limitation` | [02-phase1-observer.md] §3.1 L674

// ⚠️ Bash 分支到此结束，下方 else if (Write) 与 Bash 互斥

### [KI-088] `constraint` | [02-phase1-observer.md] §3.1 L677

//   因此只对 Write 工具做完整语法验证，Edit 工具跳过。⚠️ Edit 工具跳过语法验证的已知限制：Edit 可能引入语法错误（如删除闭合括号），但因 Edit 的 args 仅含 oldString/newString 而非完整文件内容，无法做全文件语法检查。缓解：(1) 同一文件的后续完整 Write 操作会触发语法验证；(2) 测试执行（Phase 2）可间接检测语法错误。Phase 1 无直接机制检测 Edit 引入的语法错误。

### [KI-089] `limitation` | [02-phase1-observer.md] §3.1 L683

// ⚠️ F-10: content null safety guard — Write 工具始终提供 content（即使为空字符串 ''），

### [KI-090] `limitation` | [02-phase1-observer.md] §3.1 L690

// 文件大小检查（AC-5: ≤100KB）。⚠️ content.length 是 JS 字符数（UTF-16 code units），非字节数。

### [KI-091] `limitation` | [02-phase1-observer.md] §3.1 L695

// ⚠️ 此事件仅在 config.enabled=true 时写入。config.enabled=false 时整个 Write 观察被跳过（L267 return），不会产生此事件。

### [KI-092] `limitation` | [02-phase1-observer.md] §3.1 L714

// ⚠️ config.extensions 缺失或为空数组时，fallback 到默认扩展名列表 ['.json', '.yaml', '.yml']（Phase 1 默认值）

### [KI-093] `limitation` | [02-phase1-observer.md] §3.1 L718

// ⚠️ 未知扩展名通过 extensions 过滤后到达此点，若无对应验证分支（如 .toml、.ini）则静默跳过。

### [KI-094] `limitation` | [02-phase1-observer.md] §3.1 L751

// ⚠️ result.error 类型为 `string | undefined`（yamlSyntaxCheck 返回类型定义）。

### [KI-095] `limitation` | [02-phase1-observer.md] §3.1 L777

// ⚠️ 插入位置：在 CheckpointHandler.handle() 中 validateTransition() 之后、applyTransition() 之前。

### [KI-096] `performance` | [02-phase1-observer.md] §3.1 L784

// ⚠️ 性能：50000 条线性扫描可能超 50ms 预算。Phase 1 实现方案：(1) 维护内存中的 unresolved 索引（Map<severity, AuditLogEntry[]>），appendAudit 时更新索引，getUnresolvedViolations 直接读索引（O(1)）；(2) 索引随 pipeline state 序列化持久化。

### [KI-097] `limitation` | [02-phase1-observer.md] §3.1 L786

// ⚠️ 审计日志轮转（audit → audit-2 → ...）：unresolved 索引必须覆盖所有 audit* key 前缀。

### [KI-098] `limitation` | [02-phase1-observer.md] §3.1 L788

const unresolved = this.store.getUnresolvedViolations(state.projectId, state.runId, 'block'); // ⚠️ getUnresolvedViolations 需要 projectId 和 runId 参数（3-param 签名），使用内存索引（O(1)），同步调用，无需 await

### [KI-099] `limitation` | [02-phase1-observer.md] §3.1 L794

// ⚠️ violation 为 optional 字段，需 filter 排除 undefined（block-level 条目可能缺失 violation 字段）

### [KI-100] `limitation` | [02-phase1-observer.md] §3.1 L808

- **⚠️ Pipeline scope**：getUnresolvedViolations 通过 appendAudit 3-param 签名的前两个参数 (projectId, runId) 隐式限定范围——仅查询当前 run 的审计日志。无需额外 scope 参数。冷启动时索引为空是正确行为——无历史违规可查询，符合"无证据则无违规"原则。

### [KI-101] `limitation` | [02-phase1-observer.md] §3.1 L817

- ⚠️ transitions.ts applyTransition 同步更新：仅更新 validateTransition 而不更新 applyTransition 会导致运行时 throw（applyTransition default 为 `throw new Error(...)`）。

### [KI-102] `limitation` | [02-phase1-observer.md] §3.1 L833

| 3 | 误拦截率 | ≤5%（误拦截率 = 被错误阻止的合法操作数 / 总合法操作数 × 100%） | e2e 测试：执行 50 个合法操作，统计误拦截。**测试环境配置**：ignoreExitCodes=[1, 130]，ignoreCommands=["git log *", "man *"]。（合法操作白名单：写入有效 JSON 文件、执行 exit 0 的 Bash 命令、执行 `git status` 等只读命令、执行预期非零退出码的命令（grep 无匹配返回 1、diff 有差异返回 1、test 条件不满足返回 1）——此类命令通过 ignoreExitCodes 配置排...

## §3.2 — Phase 2: Test Gate (03-phase2-test-gate.md)

### [KI-103] `limitation` | [03-phase2-test-gate.md] §3.2 L859

// ⚠️ Phase 2 安全网：

### [KI-104] `limitation` | [03-phase2-test-gate.md] §3.2 L861

// ⚠️ 注：L22-34（MAX_RALPH_ROUNDS safety net）commented-out 代码包含 scope-level getActiveRun()。当 safety net 启用时，L49 的 getActiveRun() 变为冗余——外层 `run` 已在 scope 中。实现时需移除 L49 或标注为 intentional re-fetch。

### [KI-105] `limitation` | [03-phase2-test-gate.md] §3.2 L862

// ⚠️ MAX_RALPH_ROUNDS 安全网为 phase-agnostic（应在所有 phase_complete 时触发），run 必须在 phase guard 之前获取

### [KI-106] `limitation` | [03-phase2-test-gate.md] §3.2 L874

// ⚠️ AUDIT_ROTATION_LIMIT_EXCEEDED 专用于审计日志轮转（10-key limit），RALPH_ROUNDS_EXCEEDED 用于 Ralph Loop round 上限

### [KI-107] `limitation` | [03-phase2-test-gate.md] §3.2 L881

// severity='warn' → Reviewer 报告为 M 级 finding（仅提示，不直接阻止推进。⚠️ 但连续存在时 Reviewer 可升级为 H 级，升级后按 H 级规则处理——由 Reviewer 独立判定，非 CheckpointHandler 行为）

### [KI-108] `limitation` | [03-phase2-test-gate.md] §3.2 L885

// ⚠️ CheckpointHandler 使用 this.store（PipelineStore），非 this.cache（PipelineStateCache）

### [KI-109] `limitation` | [03-phase2-test-gate.md] §3.2 L896

// ⚠️ sessionID 来源：CheckpointHandler.handle(event, payload, sessionID) 的第三个参数。

### [KI-110] `limitation` | [03-phase2-test-gate.md] §3.2 L902

// ⚠️ TEST_RUN_REQUESTED 在 gate check 之前写入。若存在未解决违规阻止阶段推进，

### [KI-111] `limitation` | [03-phase2-test-gate.md] §3.2 L911

// ⚠️ TEST_RUN_COMPLETE 是 AuditLogEntry.event 值（非 CheckpointEvent），但通过 tdd_checkpoint 工具的 event 参数（string 类型）dispatch。CheckpointHandler.handle() 实际 dispatch on string (CheckpointEvent | AuditEvent)。

### [KI-112] `limitation` | [03-phase2-test-gate.md] §3.2 L913

// ⚠️ 此 case 由主 Agent 通过 tdd_checkpoint 工具调用触发，事件类型为 'TEST_RUN_COMPLETE'

### [KI-113] `limitation` | [03-phase2-test-gate.md] §3.2 L914

// ⚠️ 写入顺序与现有 checkpoint.ts 模式不同：无 applyTransition/writeState 调用，仅 appendAudit

### [KI-114] `limitation` | [03-phase2-test-gate.md] §3.2 L929

// ⚠️ pass=0/fail=0 意味着无测试用例被发现（可能配置错误），记录但允许（warn 级）

### [KI-115] `limitation` | [03-phase2-test-gate.md] §3.2 L946

// ⚠️ error_summary 为 trusted input（主 Agent 提供），Phase 1 仅做 null fallback。若需严格校验，添加 typeof error_summary !== 'string' && error_summary != null 检查。

### [KI-116] `limitation` | [03-phase2-test-gate.md] §3.2 L961

⚠️ **前置依赖**：此升级机制依赖 Ralph Loop 编排器在派发 Reviewer 时将前轮 RoundRecord.findings 注入 Reviewer prompt。Phase 2 假设 Ralph Loop 编排器支持结构化 finding 访问（非仅摘要文本）。若编排器仅提供文本摘要，[TEST_EVIDENCE] 前缀匹配可能不可靠——建议 Ralph Loop 编排器在 Phase 2 增加对 RoundRecord.findings 的结构化注入支持。

### [KI-117] `limitation` | [03-phase2-test-gate.md] §3.2 L967

边界条件：若 Ralph Loop 连续 zero-CHM 条件无法满足（因测试证据 finding 持续存在），循环不会自然终止——Ralph Loop 无自然终止 round cap（依赖 findings 归零退出），但受 MAX_RALPH_ROUNDS 硬性上限保护。⚠️ 安全网：配置项 `MAX_RALPH_ROUNDS`（默认 20）。超过时 PipelineState 转为 `failed` 状态，reason='Ralph Loop exceeded maximum rounds'。若因外部原因需强制终止 pipeline run，Checkpoint 应保留未解决违规记录，...

### [KI-118] `limitation` | [03-phase2-test-gate.md] §3.2 L969

// ⚠️ 复用 PipelineState.ralph.round 追踪 Ralph Loop 迭代次数（无需新增字段）。

### [KI-119] `limitation` | [03-phase2-test-gate.md] §3.2 L971

// ⚠️ ralph.round 递增机制：由 Ralph Loop 编排器在每轮新迭代开始时递增（Review subagent 派发前）。CheckpointHandler 不负责递增——它仅读取该值用于 MAX_RALPH_ROUNDS 比较和审计条目记录。

### [KI-120] `performance` | [03-phase2-test-gate.md] §3.2 L987

- **审计日志条目数上限**（Phase 1 新增）：每个 pipeline run 审计日志最多 5000 条。超出时 FIFO 淘汰最旧条目（标记 `evicted: true`）。**实现策略**：appendAudit 写入前仅检查条目总数（O(1)，读内存计数器），超限时设置 `evictionNeeded` 标记。实际 read-modify-write 淘汰延迟到 Checkpoint `phase_complete` 时执行（利用 Checkpoint 已有的 I/O 预算），避免与 Observer 20ms 时间限制冲突。FIFO 排序使用 JSONL 行追加顺序（JSO...

### [KI-121] `limitation` | [03-phase2-test-gate.md] §3.2 L1016

sessionId: '',  // ⚠️ 哨兵值说明：sessionId='' 表示初始化阶段无活跃会话（非空字符串 sessionID 由 OpenCode 工具调用上下文提供）。哨兵值（sessionId='', phase=0）为初始化阶段专用，不回溯更新。审计日志消费者应按 `phase > 0` 过滤参与门控决策的条目。

### [KI-122] `limitation` | [03-phase2-test-gate.md] §3.2 L1017

phase: 0,       // ⚠️ 哨兵值说明：phase=0 表示 pipeline 未启动（TDD pipeline phase 编号从 1 开始）。消费者应将 phase=0 视为"无 pipeline 上下文"，不参与门控决策。

### [KI-123] `limitation` | [03-phase2-test-gate.md] §3.2 L1021

// ⚠️ 若 Watchdog 初始化时无活跃 pipeline（cache.get() 返回 null），DEGRADATION_MODE_ACTIVATED 事件通过 console.warn() 记录到进程日志，不写入审计日志（因缺少 projectId/runId）。后续 pipeline 启动时，Observer 检查 this.degraded 标志：若 degraded=true，写入审计事件 { event: 'PIPELINE_DEGRADED', phase: state.currentPhase } 并跳过观察逻辑。详见 qa-base.md §3.1 Observer...

### [KI-124] `limitation` | [03-phase2-test-gate.md] §3.2 L1022

// ⚠️ null-safety note：runId 在 ActiveRun 上（非 PipelineState）。init-time 无 active run 时 runId fallback 为 '__no_active_run__'。此场景在 Phase 2 工具注册阶段可能发生（无活跃 pipeline → audit 写入使用 '__no_active_run__' runId）。可接受——init-time 降级事件仅作追溯用。使用明确的 sentinel 值 '__no_active_run__' 代替 'unknown'，避免与合法 runId 冲突。审计消费者查询时应排除...

### [KI-125] `limitation` | [03-phase2-test-gate.md] §3.2 L1034

- **审计日志生命周期**：每个 pipeline run 的审计日志在 run 归档（`archiveRun`）后保留 7 天供查询，之后删除。单个日志 key 最大 10MB，超出时自动轮转（写入新 key `watchdog/${projectId}/${runId}/audit-2`）。⚠️ Phase 分期说明：Phase 1 仅实施 5000 条 FIFO 上限（通过 auditEntryCount 计数）。10-key 轮转上限和 10MB key 大小上限的**运行时检查**（创建新 key、写入 AUDIT_ROTATION_LIMIT_EXCEEDED 事件）为 Phas...

## §3.3 — Phase 3: Semantic Review (04-phase3-semantic.md)

### [KI-126] `migration` | [04-phase3-semantic.md] §3.3 L1054

> **⚠️ v1.6 范围裁剪说明**：Phase 3 的 S/B/A severity schema 迁移部分（§3.3.2）标记为**待定**，不在当期实施。理由：

### [KI-127] `migration` | [04-phase3-semantic.md] §3.3 L1070

⚠️ 以下为 Schema v5 迁移后的目标调用流程。当期使用 C/H/M severity 替代 S/B/A（参见 §3.3.3 映射表）。

### [KI-128] `migration` | [04-phase3-semantic.md] §3.3 L1083

#### 3.3.2 Severity 扩展与 Schema 迁移（⚠️ 待定 — 非当期范围）

### [KI-129] `migration` | [04-phase3-semantic.md] §3.3 L1096

// ⚠️ FindingSubmission.severity 和 RoundRecord.counts 的完整定义见 §3.0.3。以下仅展示 Phase 3 迁移上下文。

### [KI-130] `limitation` | [04-phase3-semantic.md] §3.3 L1136

// ⚠️ S/B→C/H 映射对 consecutiveZero 的影响（当期过渡）：§3.3.3 定义了 S/B/A → C/H/M 映射表。

### [KI-131] `limitation` | [04-phase3-semantic.md] §3.3 L1143

// ⚠️ SEV_ORDER 和 VALID_SEVERITIES 未包含在 §3.0 常量注册表（§3.0.6）中。建议在 §3.0.6 补充。

### [KI-132] `limitation` | [04-phase3-semantic.md] §3.3 L1193

- ⚠️ **隐式耦合**：consecutiveZero 计数依赖 Reviewer 正确累加每轮 counts。若 Reviewer 漏报 finding，consecutiveZero 不会归零。缓解：(1) Reviewer prompt 模板硬性要求返回完整 severity 分解；(2) 主 Agent 校验 Reviewer 输出格式包含所有 severity key。

### [KI-133] `limitation` | [04-phase3-semantic.md] §3.3 L1291

#### 3.3.5 tdd-pipeline Skill 同步（⚠️ 待定 — 依赖 §3.3.2）

### [KI-134] `limitation` | [04-phase3-semantic.md] §3.3 L1307

#### 3.3.6 产出物（⚠️ Schema 相关项待定）

### [KI-135] `migration` | [04-phase3-semantic.md] §3.3 L1316

⚠️ 以下验收标准分为两组：当期可执行（AC-1, AC-4）和 Schema v5 迁移后（AC-2, AC-3, AC-5）。Schema v5 迁移前仅验证当期可执行项。以下 AC 标注 ⚠️ 的项目仅在 Schema v5 迁移完成后可验证。未标注的项目为当期可执行。

### [KI-136] `migration` | [04-phase3-semantic.md] §3.3 L1321

| 2 | S/B/A severity 提交 | ⚠️ 依赖 Schema v5 迁移（§3.3.2）。当期替代：语义审查发现用 C/H/M 提交，映射参见 §3.3.3 | 集成测试 |

### [KI-137] `migration` | [04-phase3-semantic.md] §3.3 L1322

| 3 | 误报率 | ≤20%（语义审查 finding 中误报比例，≥30 个样本或全量评审）⚠️ 依赖 Schema v5 迁移 | 人工抽样评审 |

## §3.4 — Phase 4: Intervention Merge (05-phase4-merge.md)

### [KI-138] `limitation` | [05-phase4-merge.md] §3.4 L1336

⚠️ **CommitGuard schema 校验说明**：CommitGuard 类（commit_guard.py）不定义 validate_schema 方法。schema 校验逻辑来自 AutoCommitter.validate_schema()（committer.py L13-31）。CommitGuard 场景仅检查 schema 合规性，不执行写入。

### [KI-139] `constraint` | [05-phase4-merge.md] §3.4 L1368

- **安全约束**：`rollback_to_checkpoint` 执行 `reset --hard` 前自动 `git stash --include-untracked -m 'aristotle-rollback: {checkpoint_hash}'` 未提交更改，防止数据丢失。stash message 前缀 `aristotle-rollback:` 用于区分 Aristotle 创建的 stash 和用户手动创建的 stash。⚠️ **边界条件**：`--include-untracked` 可能意外 stash `node_modules/` 等大目录。缓解：依赖 `.g...

### [KI-140] `limitation` | [05-phase4-merge.md] §3.4 L1378

**⚠️ PipelineState 一致性（强制）**：`rollback_to_checkpoint` 执行 `git reset --hard` 回滚代码后，PipelineState 中的 phase/round 等状态可能与回滚后的实际代码不一致。**必须**在回滚后调用 `tdd_checkpoint(event='pipeline_reset')` 重置 PipelineState（此事件需在 Phase 4 实现）。未重置的 PipelineState 可能导致 Watchdog 基于过期状态做出错误门控决策（如允许跳过已回滚的阶段）。

### [KI-141] `performance` | [05-phase4-merge.md] §3.4 L1383

**⚠️ `pipeline_reset` CheckpointEvent 前向引用**：`pipeline_reset` 为 Phase 4 新增的 CheckpointEvent，用于回滚后重置 PipelineState（phase→1, phaseStatus→idle, round→0, observerTimeoutCount→0, auditEntryCount→0）。注：phase→1 而非 phase→0，因为 TDD pipeline phase 编号从 1 开始（phase=0 是 pre-init 哨兵值）。具体 payload 和 transition 逻辑在 Phase 4 实现时定义。当前文档在 CheckpointEvent 扩展列表中以 blockquote 注释「Phase 4」标注占位。

### [KI-142] `limitation` | [05-phase4-merge.md] §3.4 L1413

- `intervention/src/committer.py` — AutoCommitter 的 validate_schema() 函数将直接内联到 MCP commit_rule（CommitGuard 的 schema 校验与 AutoCommitter 共用同一 validate_schema 函数，参见 committer.py:5-31（含 _MAX_ERROR_SUMMARY_LENGTH 常量 + AutoCommitter class（含 validate_schema 方法））。注意：当前 MCP commit_rule 无 schema 校验——这是 net-new...

### [KI-143] `limitation` | [05-phase4-merge.md] §3.4 L1426

1. init_repo_tool（⚠️ MCP 注册名为 `init_repo_tool`，文档早期版本使用 `init_repo` 为显示名称）

### [KI-144] `breaking-change` | [05-phase4-merge.md] §3.4 L1465

**⚠️ commit_rule 行为变更兼容性说明**: 增强后的 commit_rule 将增加提交前守卫检查（如：规则状态必须为 staging 才能提交，frontmatter schema 校验）。现有调用方若直接调用 commit_rule 且规则未 staging，将收到拒绝。兼容策略：(1) 守卫默认启用 (2) 可通过 `skip_guard: true` 参数跳过（默认 false，用于自动化场景）(3) 错误信息包含具体拒绝原因和修复建议。

### [KI-145] `limitation` | [05-phase4-merge.md] §3.4 L1475

**双审计日志聚合策略**：Phase 1-3 仅 Checkpoint 使用 Watchdog 侧审计日志（`getUnresolvedViolations`）。MCP 侧审计日志（`.aristotle/audit.jsonl`）仅作追溯用，不参与门控决策。Phase 4 `readMcpAuditLog()` 提供聚合查询能力，用于事后分析和全链路审计。门控决策始终基于 Watchdog 侧审计日志。⚠️ `.aristotle/audit.jsonl` 必须在 `init_repo` 时自动添加到 `.gitignore`（审计日志可能含敏感命令参数），防止意外提交到版本控制。在 CI...

### [KI-146] `limitation` | [05-phase4-merge.md] §3.4 L1500

| 4 | MCP 工具数 | 25（20 现有 + 5 新增） | 工具清单 + 自动化断言：`uv run python -c "from aristotle_mcp.server import mcp; assert len(mcp._tool_manager._tools) == 25"`（⚠️ 此断言依赖 mcp 库内部 API `_tool_manager._tools`，mcp 库升级时需同步更新。⚠️ 原降级方案 `mcp` CLI `tools/list` JSON-RPC 不可用——MCP stdio 需 initialize 握手，pipe 模式无法直接发送 JSON-R...

## §1-2, §4-7 — Overview & Principles (00-overview.md)

### [KI-001] `limitation` | [00-overview.md] §2 L85

> ⚠️ 当前 Observer 实现（Phase 0）仅处理 Task 工具观察和 prompt 注入扫描。语法验证和 Bash 结果检查为 Phase 1 新增。

### [KI-147] `limitation` | [00-overview.md] §4 L1564

> ⚠️ 以下超时预算为 Phase 1 实施目标 — 当前代码无超时保护机制。

### [KI-148] `performance` | [00-overview.md] §4 L1578

**OBSERVER_TIMEOUT 解决路径**：(1) 后续 Observer 成功执行时自动 resolve 前次 OBSERVER_TIMEOUT（在 handle() 开头检查是否存在未恢复的 OBSERVER_TIMEOUT 并标记 resolved）；(2) 若整个阶段无后续调用，OBSERVER_TIMEOUT 保持 block 状态并阻止阶段推进。开发者需：(1) 重新执行工具调用以触发 Observer 成功执行（自动 resolve），或 (2) 标记阶段为 failed（记录未解决违规原因）。OBSERVER_TIMEOUT 不提供"推进即恢复"路径——fail-clo...

### [KI-149] `performance` | [00-overview.md] §4 L1584

// ⚠️ 降级检查时机：Observer handle() 写入 OBSERVER_TIMEOUT 时检查 observerTimeoutCount。

### [KI-150] `performance` | [00-overview.md] §4 L1601

⚠️ 降级计数器持久化：observerTimeoutCount 存储在 PipelineState 中，通过 StateStore 持久化。进程重启后从磁盘恢复 PipelineState 时计数器保留。跨 pipeline run 不继承（每个 run 初始为 0）。

### [KI-151] `limitation` | [00-overview.md] §4 L1643

**手动解决路径（Phase 1 新增）**：对于无法通过 auto-resolve 恢复的 block 级违规（如环境问题导致命令始终失败），提供 `tdd_checkpoint(event='force_resolve_violation', violation_type='COMMAND_FAILED', reason='...')` 逃生路径。该事件将指定类型的 block 级违规标记为 resolved 并记录 `force_resolved_reason` 字段到审计日志。强制解决不会降级违规严重性——审计日志保留完整违规记录 + 强制解决原因。Checkpoint 在阶段推进时检...

### [KI-152] `limitation` | [00-overview.md] §4 L1669

"ignoreCommands": ["git log *", "man *"]  // ⚠️ 默认值使用 "git log *"（含空格）替代 "git log*"，避免匹配 "git logout" 等不相关命令。matchPattern 匹配完整命令字符串。若 glob 匹配粒度不足，建议实现命令名提取（split on first space）后再匹配。

### [KI-153] `limitation` | [00-overview.md] §4 L1707

- 缓存策略：Watchdog 启动时加载一次并缓存至内存，Observer handle() 内多次调用 `RuleConfigLoader.load()` 读缓存不读磁盘。⚠️ **缓存失效**：Phase 1-2 缓存无 mtime 校验——配置文件修改后需重启 OpenCode 会话才能生效。Phase 4 可扩展为每次 load() 检查 mtime（stat fs 操作，<1ms 开销）并按需失效。⚠️ **多项目假设**：static cache 假设单 OpenCode 实例对应单项目。若 OpenCode 支持多项目实例，需改为实例级 Map<projectId, Rules...

## Appendices — Review Records (appendices.md)

### [KI-154] `limitation` | [appendices.md] Appendix L1897

| F-01 | Medium | Observer/Checkpoint 代码示例添加"⚠️ 拟实现代码，非当前实现"标注 | 3.1.1 |

### [KI-155] `limitation` | [appendices.md] Appendix L2049

| F-04 | **High** | §3.3.1 调用流程添加"⚠️ Schema v5 目标，当期使用 C/H/M"标注 | 3.3.1 |

### [KI-156] `limitation` | [appendices.md] Appendix L2126

| F-11 | Medium | ignoreExitCodes 默认值从 `[130]` 改为 `[1, 130]` + 注释说明 | 4.5 | ⚠️ 已被 v1.18 §4.5 L1043 覆盖——exit code 1 不应默认忽略（是最常见失败码），保持 [130]。此条为历史记录。 |

### [KI-157] `limitation` | [appendices.md] Appendix L2142

| F-29 | Low | ~~extractExitCode fallback 策略变更：先 fallback=0（fail-open）收集数据，≥95% 命中率后切换 fallback=1~~ ⚠️ 已被 v1.18 F-14 覆盖——Phase 1 统一 fallback=1（fail-safe）。此条为历史记录。 | 3.1.1 |

### [KI-158] `limitation` | [appendices.md] Appendix L2144

| F-32 | Info | Phase 3 AC 表格顶部添加"⚠️ 标注项目仅 Schema v5 后可验证，未标注为当期可执行" | 3.3.7 |

### [KI-159] `limitation` | [appendices.md] Appendix L2451

| F-01 | **High** | §3.1.1 Bash/Write brace mismatch — L568 多余 `}` 导致 if/else-if 结构断裂 | §3.1.1 L568 | 移除多余 `}`，替换为注释 `// ⚠️ Bash 分支到此结束，下方 else if (Write) 与 Bash 互斥`，使 `} else if` 正确闭合 Bash 分支并开启 Write 分支 |

### [KI-160] `limitation` | [appendices.md] Appendix L2481

| F-01 | **High** | §3.0.3 ActiveRun 缺少 `startedAt: string` 字段 | §3.0.3 ActiveRun interface | 添加 `startedAt: string` 字段（⚠️ 文件引用修正：原引用 pipeline-store.ts L370-374 不正确，实际位于 checkpoint.ts），调整字段顺序与 schema.ts 一致（runId 首位） |

---

## §3.1 — Phase 1 Green Code Review (post-implementation)

### [KI-161] `performance` | [pipeline-store.ts] getUnresolvedViolations rotated key scan

**Severity**: M | **Deferred to**: Phase 2

`getUnresolvedViolations` scans up to 10 rotated keys (`audit.1`–`audit.10`) on every call, even when index is already built. Each `handle()` call triggers up to 3 auto-resolve queries = up to 30 stateStore reads. Rotated keys rarely exist, so actual overhead is small (empty reads break early). But with high-frequency tool calls, this approaches the 20ms Observer budget.

**Fix**: Track indexed rotated keys in `Set<string>` and skip already-scanned keys. Implement before Phase 2 when auto-resolve frequency may increase.

### [KI-162] `limitation` | [observer.ts] autoResolve triplicate pattern

**Severity**: M | **Deferred to**: Phase 2

The three auto-resolve blocks (Bash/Write/OBSERVER_TIMEOUT) share identical query→filter→threshold→resolve structure. Adding new tool types (e.g. Edit) would create a 4th copy. Extract a shared helper `resolveMatchingViolations(tool, filter, matchKey)` before Phase 2.

### [KI-163] `information` | [observer.ts] autoResolve client-side filter redundancy

**Severity**: L | **Status**: Intentional

`autoResolve` applies client-side `.filter(v => v.command === cmd)` after server-side `getUnresolvedViolations(projectId, runId, 'block', { commandPattern: cmd })`. In production, the server-side filter is sufficient. The client-side filter exists for test compatibility (mock doesn't honor filter parameters). No fix needed — add explanatory comment if desired.

### [KI-164] `information` | [observer.ts] redundant typeof check on content

**Severity**: L | **Status**: Accepted

### [KI-165] `limitation` | [schema.ts + pipeline-store.ts] auditEntryCount/evictionNeeded/checkpointEviction not wired

**Severity**: M | **Deferred to**: Phase 2

Oracle F-05: `PipelineState.auditEntryCount` is never incremented, `evictionNeeded` is never set, `checkpointEviction()` is never called from checkpoint.ts. These Phase 1 artifacts are defined in schema.ts and pipeline-store.ts but the integration is missing. Wire in Phase 2: increment `auditEntryCount` in `appendAudit`, set `evictionNeeded` when count exceeds `MAX_AUDIT_ENTRIES`, call `checkpointEviction` in checkpoint.ts step 12.

### [KI-166] `information` | [observer.ts] _timedOut guards in _handleObservations are unreachable

**Severity**: L | **Status**: Intentional (defense-in-depth)

Oracle F-07: `_handleObservations` is async but has no await points internally — it runs synchronously to completion. Since `_timedOut` is only set by the timeout handler which fires after the current synchronous execution, the `if (this._timedOut) return` checks at L272/L294/L315/L330 can never be true. Retained as defense-in-depth for future async operations in `_handleObservations`.

Line 363: `if (typeof content !== 'string' || !content) return` — the ternary on line 362 guarantees `content` is always a string. The `typeof` check is dead code. No functional impact. Can clean up in a refactor pass.

---

## Holistic Review — Phase 2 Business Code (Ralph Review Loop)

*Added: 2026-06-02*

### [KI-167] `performance` | [pipeline-store.ts] buildIndex early-break on empty rotated key

**Severity**: L | **Status**: Latent (rotation never occurs in practice) | **First seen**: Round 2

`buildIndex` (L502) assumes contiguous rotated logs: `if (i >= 1 && logs.length === 0) break`. If a rotated file is missing (filesystem corruption), subsequent valid rotated files are skipped. However, `checkpointEviction` (the only rotation trigger) has zero callers — audit logs are append-only in practice. Reconfirmed across 3 independent Oracle rounds.

**3-round evaluation (R2-R4)**: No upgrade needed. No rotation mechanism active.

### [KI-168] `limitation` | [pipeline-store.ts] checkpointEviction dead code

**Severity**: L | **Status**: Dead code (zero callers) | **First seen**: Round 3

`checkpointEviction` (L444-455) implements FIFO eviction via `splice` + `buildIndex`, but: (1) no caller invokes it, (2) `splice` mutates a local copy then `buildIndex` re-reads all entries from storage, making the eviction a no-op even if called. The `evicted` field in the schema is never set. `MAX_AUDIT_ENTRIES=5000` is unused.

**3-round evaluation (R2-R4)**: No upgrade needed. Feature not wired.

### [KI-169] `limitation` | [pipeline-store.ts + schema.ts] _RESOLVE_MARKER not in AuditLogEntry type union

**Severity**: L | **Status**: Type-level only (runtime safe) | **First seen**: Round 3

`resolveViolations` (L410-421) writes `_RESOLVE_MARKER` entries with `event: '_RESOLVE_MARKER'`, `_resolve`, and `_resolvedAt` fields not declared in `AuditLogEntry`. Runtime safe via `as Record<string, unknown>` casts in `buildIndex`. Schema integrity issue only.

**3-round evaluation (R2-R4)**: No upgrade needed. Runtime safe.

### [KI-170] `limitation` | [pipeline-store.ts] Observation logs have no size limit

**Severity**: L | **Status**: Latent (archived on pipeline completion) | **First seen**: Round 4

`appendObservation` (L301-311) appends without size check. Audit logs have `MAX_AUDIT_ENTRIES=5000` (unused, see KI-168) but observation logs have no equivalent. Practical impact: ~300 entries per ralph loop run (20 rounds × ~5 Task calls × ~3 observations). Archived on `archiveRun`, so unbounded growth requires a stuck/never-completing pipeline.

**3-round evaluation (R4)**: No upgrade needed. Archived on completion, practical limit bounded.

---

## §3.4 — Phase 4 Test Plan Review (Phase 3 Review Loop)

*Added: 2026-06-11*

### [KI-171] `limitation` | [mcp-audit-log] `.aristotle/` exists as file, not directory

**Severity**: M | **Deferred to**: Phase 4 implementation

If `.aristotle/` exists as a regular file (not directory), `append_audit_entry` will fail when trying to `mkdir(parents=True)`. Not covered in test plan. Suggested test: `should_reject_when_aristotle_is_file_not_directory`.

### [KI-172] `limitation` | [mcp-audit-log] JSONL file grows unbounded

**Severity**: L | **Deferred to**: Future phase

No rotation mechanism or size cap for `.aristotle/audit.jsonl`. If file size becomes a concern, add `MAX_AUDIT_JSONL_FILE_SIZE` constant and rotation logic.

### [KI-173] `limitation` | [rollback-tools] Concurrent stash cleanup race

**Severity**: L | **Status**: Accepted (single-agent, ADR-007)

Two simultaneous `cleanup_rollback_stashes(keep=3)` calls could race between listing and dropping stashes. Single-agent per ADR-007 makes this extremely unlikely. If multi-agent support added, append-during-read atomicity must be addressed.

### [KI-174] `limitation` | [ki-doc-tools] KI doc unbounded file growth

**Severity**: L | **Deferred to**: Future phase

KI doc is append-only with no entry cap or rotation. A 1000-entry merge followed by 500 interventions creates a very large file. No test for performance degradation at scale.

### [KI-175] `limitation` | [ki-doc-tools] BOM-prefixed KI doc header detection

**Severity**: L | **Deferred to**: Phase 4 implementation

BOM-prefixed file (`\xef\xbb\xbf`) at start would break `content.startswith("# Review Records")` header check. Suggested test: write file with UTF-8 BOM, then `read_ki_docs`.

### [KI-176] `limitation` | [commit-guard] Git index.lock conflict

**Severity**: L | **Deferred to**: Phase 4 implementation

If git is locked by another process, `commit_rule` does `git add && commit` — no test for `fatal: Unable to create '.git/index.lock'`. Suggested test: create `.git/index.lock`, then call `commit_rule`.

### [KI-177] `limitation` | [integration] Stale `.bridge-active` PID

**Severity**: L | **Deferred to**: Phase 4 implementation

If `.bridge-active` marker exists with a PID that no longer exists (crashed previous session), `use_bridge` still returns True. Suggested test: write `.bridge-active` with dead PID, then call `orchestrate_start("reflect")`.

### [KI-178] `bug` | [rollback-tools] Warning threshold operator uses `>` instead of `>=`

**Severity**: M | **Deferred to**: Phase 4 implementation

`_tools_rollback.py` L209 uses `if new_count > STASH_WARNING_THRESHOLD` (strictly greater than 5), meaning warning fires at count 6+, not 5. PRD spec (05-phase4-merge.md L60) says "warning≥5 告警". Test plan correctly matches PRD (≥5). Fix: change operator from `>` to `>=` on L209.
