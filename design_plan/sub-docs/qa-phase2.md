### Phase 2: 测试驱动质量门（2 周）

> **约定**：本文档中的裸章节引用（如 §3.0、§3.1）指向 qa-base.md 中对应章节。

**目标**：在关键阶段（Phase 5 业务代码写入后）确保测试被执行，测试失败阻止阶段推进。

#### 3.2.1 测试门控机制

**设计约束**：
- Watchdog 是 TypeScript 插件，运行在 OpenCode 进程中
- 直接运行 `npm test` 或 `pytest` 会阻塞整个会话
- 测试框架不统一（JS/Python/Go…）Watchdog 不应硬编码
- **测试运行是主 Agent 的职责**，Watchdog 只负责**检查是否有测试执行证据**

**不在 Interceptor 或 Observer 中运行测试**。改为 Checkpoint 审计日志模式：

```typescript
// checkpoint.ts — CheckpointHandler.handle(event, payload, sessionID) 内的 phase_complete 分支扩展
case 'phase_complete':
  // ⚠️ Phase 2 安全网：
  // const run = this.store.getActiveRun(state.projectId); if (!run) break;
  // ⚠️ 注：L22-34（MAX_RALPH_ROUNDS safety net）commented-out 代码包含 scope-level getActiveRun()。当 safety net 启用时，L49 的 getActiveRun() 变为冗余——外层 `run` 已在 scope 中。实现时需移除 L49 或标注为 intentional re-fetch。
  // ⚠️ MAX_RALPH_ROUNDS 安全网为 phase-agnostic（应在所有 phase_complete 时触发），run 必须在 phase guard 之前获取
  // if (state.ralph?.round >= MAX_RALPH_ROUNDS) {
  //   this.store.appendAudit(run.projectId, run.runId, {
  //     event: 'RALPH_ROUNDS_EXCEEDED',
  //     decision: 'WARN',
  //     severity: 'warn',
  //     violation: 'Ralph Loop 达到最大轮次上限',
  //     ...
  //   });
  //   /* transition state to failed */
  //   break;
  // }
  // ⚠️ AUDIT_ROTATION_LIMIT_EXCEEDED 专用于审计日志轮转（10-key limit），RALPH_ROUNDS_EXCEEDED 用于 Ralph Loop round 上限
  if (state.currentPhase === BUSINESS_CODE_PHASE) {  // BUSINESS_CODE_PHASE = 5（TDD pipeline Phase 5: Business Code）。// TODO: Phase 2 新增到 watchdog/src/constants.ts。Watchdog state.currentPhase 使用 TDD pipeline 的 phase 编号。
    // 读取 TEST_EVIDENCE_CHECK 配置决定测试证据缺失时的行为
     const evidenceConfig = RuleConfigLoader.load('TEST_EVIDENCE_CHECK');
     if (!evidenceConfig.enabled) break;
     // severity 影响 Reviewer 报告级别，不影响 Checkpoint 门控
      // severity='block' → Reviewer 报告为 H 级 finding（不解决则阻止推进）
      // severity='warn' → Reviewer 报告为 M 级 finding（仅提示，不直接阻止推进。⚠️ 但连续存在时 Reviewer 可升级为 H 级，升级后按 H 级规则处理——由 Reviewer 独立判定，非 CheckpointHandler 行为）
       // TEST_EVIDENCE_CHECK.severity 配置说明：severity='block'（默认）→ Reviewer 报告 H 级；severity='warn' → 首次 M 级，连续存在时 Reviewer 独立升级 H 级（升级为 Reviewer 侧逻辑，不影响 CheckpointHandler 门控判定）。CheckpointHandler 不使用此配置——由 Reviewer 独立加载。
    // severity 配置由 Reviewer 独立加载（RuleConfigLoader.load('TEST_EVIDENCE_CHECK')），不存储在审计条目中
    // 记录测试运行请求到审计日志
    // ⚠️ CheckpointHandler 使用 this.store（PipelineStore），非 this.cache（PipelineStateCache）
    // getActiveRun(projectId) 是 PipelineStore 的方法，返回 ActiveRun | null
    const run = this.store.getActiveRun(state.projectId);
    if (!run) break; // 无活跃 run，跳过审计
     this.store.appendAudit(run.projectId, run.runId, {
      event: 'TEST_RUN_REQUESTED',
      decision: 'PASS',
      runId: run.runId,
      projectId: run.projectId,
      phase: state.currentPhase,
      sessionId: sessionID,  // from CheckpointHandler context
      // ⚠️ sessionID 来源：CheckpointHandler.handle(event, payload, sessionID) 的第三个参数。
      // CheckpointHandler 注册为 tdd_checkpoint 工具的处理器，OpenCode 在调用工具时传入 sessionID。
      // 与 Observer handle() 的 sessionID 参数来源相同（OpenCode 工具调用上下文）。
      timestamp: new Date().toISOString(),
     });
    // 测试运行由主 Agent 负责
    // ⚠️ TEST_RUN_REQUESTED 在 gate check 之前写入。若存在未解决违规阻止阶段推进，
    // 主 Agent 需同时修复违规 AND 提供测试证据（TEST_RUN_COMPLETE）。
    // 测试期望在 phase_complete intent 时设置，而非阶段转换成功后。此为设计决策——测试应在任何 gate 结果前运行。
    // Reviewer 会检查审计日志，发现 TEST_RUN_REQUESTED 但无 TEST_RUN_COMPLETE
    // 则报告 H 级 finding
  }
  break;

// TEST_RUN_COMPLETE — 纯审计写入，无状态转换（与 phase_complete/resolve_timeout 等有状态转换的 case 不同）
// ⚠️ TEST_RUN_COMPLETE 是 AuditLogEntry.event 值（非 CheckpointEvent），但通过 tdd_checkpoint 工具的 event 参数（string 类型）dispatch。CheckpointHandler.handle() 实际 dispatch on string (CheckpointEvent | AuditEvent)。
// 注：Phase 2 实现时，CheckpointHandler.handle() 的 event 参数类型应扩展为 `CheckpointEvent | AuditEvent`（或 `string` + runtime discriminated union），确保 TypeScript 对两个联合类型进行 exhaustiveness check。新增 default case 记录未识别事件以增强可观测性。
// ⚠️ 此 case 由主 Agent 通过 tdd_checkpoint 工具调用触发，事件类型为 'TEST_RUN_COMPLETE'
// ⚠️ 写入顺序与现有 checkpoint.ts 模式不同：无 applyTransition/writeState 调用，仅 appendAudit
// 注：TEST_RUN_COMPLETE 不检查 currentPhase——设计选择（out-of-phase 提交仅产生审计条目，Reviewer 忽略非 BUSINESS_CODE_PHASE 的 test evidence）。若需严格门控，添加 `if (trState.currentPhase < BUSINESS_CODE_PHASE) return { success: false, error: '...' }`。
case 'TEST_RUN_COMPLETE':
  // 参数校验：test_result 在 TEST_RUN_COMPLETE 事件时必填
  if (!payload?.test_result) {
    // 校验失败：不写入审计条目，返回错误信息供主 Agent 重试
    // 返回格式：{ success: false, error: 'test_result is required when event=TEST_RUN_COMPLETE' }
    return { success: false, error: 'test_result is required when event=TEST_RUN_COMPLETE' };
  }
  const { pass, fail, error_summary } = payload.test_result;
  // 运行时校验（TypeScript 类型在编译时擦除）
  if (typeof pass !== 'number' || typeof fail !== 'number' || !Number.isInteger(pass) || !Number.isInteger(fail) || !Number.isFinite(pass) || !Number.isFinite(fail) || pass < 0 || fail < 0) {
    return { success: false, error: 'test_result.pass and test_result.fail must be non-negative numbers' };
  }
  if (pass + fail === 0) {
    // ⚠️ pass=0/fail=0 意味着无测试用例被发现（可能配置错误），记录但允许（warn 级）
    // Reviewer 会检查此情况并报告 M 级 finding
  }
  const trState = this.cache.get();  // trState 从 cache 获取（与外层 state 为同一引用，per §3.0.3 shared-reference invariant）。使用独立变量名以区分 TEST_RUN_COMPLETE 纯审计路径（无 applyTransition）。注：两者返回同一引用（§3.0.3 same-reference invariant）。使用不同变量名仅为代码清晰——trState 与 state 指向同一 PipelineState 对象。
  if (!trState) return { success: false, error: 'No active pipeline state' };
  const trRun = this.store.getActiveRun(trState.projectId);
  if (!trRun) return { success: false, error: 'No active run' };
  this.store.appendAudit(trRun.projectId, trRun.runId, {
    event: 'TEST_RUN_COMPLETE',
    decision: 'PASS',
    phase: trState.currentPhase,
    runId: trRun.runId,
    projectId: trRun.projectId,
    sessionId: sessionID,
    timestamp: new Date().toISOString(),
    pass,
    fail,
    // ⚠️ error_summary 为 trusted input（主 Agent 提供），Phase 1 仅做 null fallback。若需严格校验，添加 typeof error_summary !== 'string' && error_summary != null 检查。
    error_summary: error_summary ?? '',
  });
  return { success: true };

```

**实际执行流程**：
````
1. 主 Agent 完成业务代码写入
2. 主 Agent 调用 tdd_checkpoint(event="phase_complete")
3. Checkpoint 记录 TEST_RUN_REQUESTED 到审计日志
4. Ralph Loop 下一轮 → Reviewer subagent 检查审计日志
 5. Reviewer 发现 TEST_RUN_REQUESTED 但无 TEST_RUN_COMPLETE → 首次报告 M 级 finding（提示），下一轮仍未完成则升级为 H 级 finding（阻止通过）
升级判定逻辑：Reviewer prompt 应包含指令 — 检查前轮 RoundRecord.findings 数组中查找 severity='M' 且 description 含 '[TEST_EVIDENCE]' 前缀的条目。Reviewer 报告 TEST_EVIDENCE 相关 finding 时必须在 description 开头标注 '[TEST_EVIDENCE]'。若有且本轮 TEST_RUN_COMPLETE 仍不存在，升级为 H 级 finding。
⚠️ **前置依赖**：此升级机制依赖 Ralph Loop 编排器在派发 Reviewer 时将前轮 RoundRecord.findings 注入 Reviewer prompt。Phase 2 假设 Ralph Loop 编排器支持结构化 finding 访问（非仅摘要文本）。若编排器仅提供文本摘要，[TEST_EVIDENCE] 前缀匹配可能不可靠——建议 Ralph Loop 编排器在 Phase 2 增加对 RoundRecord.findings 的结构化注入支持。
6. Reviewer 发现 TEST_RUN_COMPLETE 但 fail_count > 0 → 报告 H 级 finding
7. 主 Agent 必须运行测试 → 提交测试结果（审计日志记录 TEST_RUN_COMPLETE，含 pass/fail 计数）→ 才能通过

> **注**：Reviewer 在"下一轮"检查时存在时间窗口——测试可能正在执行中。实际场景中，Reviewer 的审查轮次间隔（30-90 秒）提供了足够的缓冲。若首次发现无 TEST_RUN_COMPLETE，报告 M 级（提示），下一轮仍未完成则升级为 H 级。

边界条件：若 Ralph Loop 连续 zero-CHM 条件无法满足（因测试证据 finding 持续存在），循环不会自然终止——Ralph Loop 无自然终止 round cap（依赖 findings 归零退出），但受 MAX_RALPH_ROUNDS 硬性上限保护。⚠️ 安全网：配置项 `MAX_RALPH_ROUNDS`（默认 20）。超过时 PipelineState 转为 `failed` 状态，reason='Ralph Loop exceeded maximum rounds'。若因外部原因需强制终止 pipeline run，Checkpoint 应保留未解决违规记录，下次 run 可基于审计日志上下文继续（审计日志持久化，非 run-resume 机制）。
```typescript
// ⚠️ 复用 PipelineState.ralph.round 追踪 Ralph Loop 迭代次数（无需新增字段）。
// MAX_RALPH_ROUNDS 安全网（Phase 2 实现）
// ⚠️ ralph.round 递增机制：由 Ralph Loop 编排器在每轮新迭代开始时递增（Review subagent 派发前）。CheckpointHandler 不负责递增——它仅读取该值用于 MAX_RALPH_ROUNDS 比较和审计条目记录。
if (state.ralph?.round >= MAX_RALPH_ROUNDS) {
  appendAudit(state.projectId, run.runId, { event: 'RALPH_ROUNDS_EXCEEDED', ... });
  break; // 强制退出 Ralph Loop
}
// phase_complete gate 检查：标记 phaseStatus='failed'
// 'failed' 状态的 applyTransition 特殊 case：保留审计日志 + 未解决违规，供人工干预。
```

> **注**：TEST_EVIDENCE finding 的 M/H 级报告本身使 consecutiveZero 不归零（C+H+M>0）。无需额外机制——常规 severity 计数已覆盖此场景。当 `TEST_RUN_REQUESTED` 存在但 `TEST_RUN_COMPLETE` 尚未写入时，首次 M 级 → M>0 → consecutiveZero 不归零；次轮升级 H 级 → H>0 → consecutiveZero 不归零。
````

#### 3.2.2 产出物

#### 前置依赖（Phase 1 产出）
- CheckpointEvent Phase 1 扩展：新增 `resolve_timeout` 和 `force_resolve_violation`。其余 CheckpointEvent 仅处理 pipeline 状态机事件，不包含审计事件。（但 `tdd_checkpoint` 工具通过 string 参数同时 dispatch 两类事件 — CheckpointEvent 和 AuditEvent。详见 §3.0.3 `tdd_checkpoint` 签名。）
- **审计日志条目数上限**（Phase 1 新增）：每个 pipeline run 审计日志最多 5000 条。超出时 FIFO 淘汰最旧条目（标记 `evicted: true`）。**实现策略**：appendAudit 写入前仅检查条目总数（O(1)，读内存计数器），超限时设置 `evictionNeeded` 标记。实际 read-modify-write 淘汰延迟到 Checkpoint `phase_complete` 时执行（利用 Checkpoint 已有的 I/O 预算），避免与 Observer 20ms 时间限制冲突。FIFO 排序使用 JSONL 行追加顺序（JSONL 行追加顺序保证最早的行 = 最旧的条目，无需按 timestamp 排序）。淘汰操作为非阻塞：标记待删除条目 + 写入标记文件，后台清理（microtask 或 setImmediate）执行实际删除。注：5000 条上限在 Observer 每 run 触发约 500-1000 次（Write + Bash）的场景下提供 5-10x 缓冲。**FIFO 计数器初始化**：PipelineState 新增 `auditEntryCount: number`（初始 0）。appendAudit 每次调用时递增（O(1)），达到 5000 时设置 `evictionNeeded` 标记。Checkpoint phase_complete 检查该标记并执行淘汰。淘汰完成后更新计数器：`state.auditEntryCount -= evictedCount`（而非重置为 0，因为可能存在未淘汰的新写入）。计数器随 PipelineState 持久化。**计数器持久化**：`auditEntryCount` 随 PipelineState 通过 StateStore 持久化。appendAudit 时更新内存计数器 + 写入磁盘（与 PipelineState 同步写入）。进程重启后从磁盘恢复 PipelineState 时计数器保留。跨 pipeline run 不继承（每个 run 初始为 0）。⚠️ auditEntryCount 计数器为内存状态，在 phase_complete/checkpoint 边界与 PipelineState 同步写入磁盘。崩溃恢复时，计数器反映最后一次 checkpoint 时的值（非最新）。最大偏差 = 两次 checkpoint 间的 Observer 事件数。Phase 2 不支持 run-resume（崩溃即 run-restart），因此偏差仅影响已废弃的 run。⚠️ 崩溃恢复语义：Phase 2 假设 run-restart（非 run-resume）。崩溃后的新 pipeline_start 会重置 auditEntryCount=0。不支持从崩溃点恢复 run——这避免了 stale counter 问题。⚠️ **auditEntryCount 重置机制**：pipeline_start applyTransition 应设置 auditEntryCount=0, evictionNeeded=false。此重置与 observerTimeoutCount 重置（phase_complete）分离——auditEntryCount 跟踪整个 run 生命周期，observerTimeoutCount 跟踪单 phase。**⚠️ 5000 条上限与 10MB 轮转的关系**：5000 条是条目数上限（appendAudit 写入前检查 auditEntryCount），触发 FIFO 淘汰。10MB 是单个 audit key 大小上限（轮转触发条件）。两者独立生效：先到先触发。典型场景下 5000 条约 2-5MB（每条 ~400-1000 字节），5000 条先触发。极端场景（超长 violation 描述）可能 10MB 先触发。FIFO 淘汰和 key 轮转不互相阻塞。

#### Phase 2 产出物
- Checkpoint: 审计日志增加 TEST_RUN_REQUESTED/TEST_RUN_COMPLETE 事件
  - TEST_RUN_COMPLETE 事件必须包含 `{ pass: number, fail: number, error_summary: string }`
  - fail > 0 时 Reviewer 报告 H 级 finding（等同测试缺失）
- **`tdd_checkpoint` 扩展接口**（Phase 2 新增）→ 完整定义见 §3.0.3。CheckpointHandler 写入 AuditLogEntry 时将 pass/fail/error_summary 写入扩展字段。
- **AuditLogEntry.event 类型扩展（Phase 2 新增）**：在 `schema.ts` 中将 `'TEST_RUN_REQUESTED' | 'TEST_RUN_COMPLETE'` 添加到 AuditLogEntry.event 联合类型。
- **审计日志端到端机制定义**（Phase 2 前置依赖）：
  1. **写入**：TEST_RUN_COMPLETE 由主 Agent 通过 Watchdog 注册的 `tdd_checkpoint` OpenCode 工具写入（扩展该工具接受 test_result 参数）
  2. **存储**：审计日志通过 StateStore 抽象层存储，key 为 `watchdog/${projectId}/${runId}/audit`（与 state 共享存储层）
  3. **读取**：Watchdog 注册 `read_audit_log` 自定义工具到 OpenCode（非 MCP，通过 OpenCode 插件 API 注册），主 Agent 在派发 Reviewer 前调用
  4. **跨语言**：Watchdog (TypeScript) 通过 OpenCode 插件注册机制暴露工具，MCP (Python) 不直接调用 Watchdog。主 Agent 通过 OpenCode 工具调用链桥接
  5. **选型**：首选 OpenCode 自定义工具注册（类型安全 + 框架集成），降级条件：若插件 API 不支持工具注册，则通过 StateStore key `watchdog/${projectId}/${runId}/audit` 直接读取审计日志
  6. **运行时检测**：Watchdog 初始化时尝试注册自定义工具，若 API 不可用则自动切换至降级模式（无需手动配置）。降级检测逻辑详见 §4.2 OBSERVER_TIMEOUT 降级机制，实现时应提取为独立私有方法 `_checkDegradation(state, sessionID)`。伪代码如下：

```typescript
try {
  await opencode.plugins.registerTool('read_audit_log', handler)
} catch (e) {
  if (e instanceof TypeError || e.name === 'NotImplementedError') {
    this.degraded = true;
    const state = this.cache.get();
    if (state) {
      this.store.appendAudit(state.projectId, this.store.getActiveRun(state.projectId)?.runId ?? '__no_active_run__', {
        event: 'DEGRADATION_MODE_ACTIVATED',
        decision: 'WARN',
        severity: 'warn',
        violation: 'OpenCode 插件 API 不支持工具注册，降级为文件路径模式',
        sessionId: '',  // ⚠️ 哨兵值说明：sessionId='' 表示初始化阶段无活跃会话（非空字符串 sessionID 由 OpenCode 工具调用上下文提供）。哨兵值（sessionId='', phase=0）为初始化阶段专用，不回溯更新。审计日志消费者应按 `phase > 0` 过滤参与门控决策的条目。
        phase: 0,       // ⚠️ 哨兵值说明：phase=0 表示 pipeline 未启动（TDD pipeline phase 编号从 1 开始）。消费者应将 phase=0 视为"无 pipeline 上下文"，不参与门控决策。
        timestamp: new Date().toISOString(),
      });
    } else {
      // ⚠️ 若 Watchdog 初始化时无活跃 pipeline（cache.get() 返回 null），DEGRADATION_MODE_ACTIVATED 事件通过 console.warn() 记录到进程日志，不写入审计日志（因缺少 projectId/runId）。后续 pipeline 启动时，Observer 检查 this.degraded 标志：若 degraded=true，写入审计事件 { event: 'PIPELINE_DEGRADED', phase: state.currentPhase } 并跳过观察逻辑。详见 qa-base.md §3.1 Observer 伪代码。
      // ⚠️ null-safety note：runId 在 ActiveRun 上（非 PipelineState）。init-time 无 active run 时 runId fallback 为 '__no_active_run__'。此场景在 Phase 2 工具注册阶段可能发生（无活跃 pipeline → audit 写入使用 '__no_active_run__' runId）。可接受——init-time 降级事件仅作追溯用。使用明确的 sentinel 值 '__no_active_run__' 代替 'unknown'，避免与合法 runId 冲突。审计消费者查询时应排除此值。
    }
  } else {
    throw e; // 非 API 不可用异常，向上抛出
  }
}
```
降级状态通过实例变量 `this.degraded` 跟踪（进程生命周期内有效），并通过 `DEGRADATION_MODE_ACTIVATED` 审计事件提供可观测性。init-time 重新检测（L165-191 try/catch）确保重启后降级状态恢复。
- **`read_audit_log` OpenCode 自定义工具注册**（Phase 2 新增产出物）：Watchdog 插件通过 OpenCode 插件 API 注册 `read_audit_log` 工具，供主 Agent 在派发 Reviewer 前查询审计日志。实现位置：`packages/watchdog/src/tools/read-audit-log.ts`。
// 接口规格：read_audit_log(projectId: string, runId: string, options?: { eventFilter?: string[], limit?: number }): { entries: AuditLogEntry[], totalCount: number }
// 传递机制：主 Agent 调用 read_audit_log 后将结果注入 Reviewer subagent prompt 的上下文块（structured JSON）。
- **降级方案 runId 传递机制**：若插件 API 不支持工具注册，通过 StateStore 已知 key `watchdog/${projectId}/active`（存储 ActiveRun 含 runId）暴露 runId，主 Agent 通过现有 MCP 工具 `pipeline_status`（需扩展返回 runId 字段）或直接读取 StateStore 文件路径（`.watchdog/state/{projectId}/active`）。若均不可用，由 Watchdog 在 `tdd_checkpoint` 工具响应中附带当前 runId。**runId 获取优先级**：(1) StateStore key `watchdog/${projectId}/active`（最快，内存缓存）→ (2) tdd_checkpoint response attachment（需 Round Robin 支持）→ (3) pipeline_status MCP tool extension（需新 tool）→ (4) StateStore 文件直接读取（fallback，最慢）。实现应按此顺序尝试。
- **审计日志生命周期**：每个 pipeline run 的审计日志在 run 归档（`archiveRun`）后保留 7 天供查询，之后删除。单个日志 key 最大 10MB，超出时自动轮转（写入新 key `watchdog/${projectId}/${runId}/audit-2`）。⚠️ Phase 分期说明：Phase 1 仅实施 5000 条 FIFO 上限（通过 auditEntryCount 计数）。10-key 轮转上限和 10MB key 大小上限的**运行时检查**（创建新 key、写入 AUDIT_ROTATION_LIMIT_EXCEEDED 事件）为 Phase 3+ 延迟实施运维特性（不在 Phase 2 产出范围内）
- Reviewer prompt: 增加"检查测试执行证据"检查项（含测试结果内容校验：fail>0 报告 H 级；pass=0 且 fail=0 报告 M 级（配置疑似错误）)
- `[TEST_EVIDENCE]` prefix convention specification: Reviewer findings related to test evidence must prefix description with `[TEST_EVIDENCE]`. Ralph Loop orchestrator must inject `RoundRecord.findings` array (not text summary) into Reviewer prompt. Escalation: M→H if `[TEST_EVIDENCE]` finding persists in consecutive round.
- 文档：`docs/test-driven-quality-gate.md`

#### 3.2.3 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 测试请求记录率 | 100%（Phase 5 完成时自动记录 TEST_RUN_REQUESTED） | e2e 测试 |
| 2 | Reviewer 检出率 | 100%（有 TEST_RUN_REQUESTED 无 TEST_RUN_COMPLETE 时，首次报告 M 级，连续两轮未完成升级为 H 级） | 集成测试 |
| 3 | 测试证据检出时效 | 测试执行证据缺失在 ≤90 秒内被发现（Reviewer subagent 单轮审查耗时约 30-90 秒，取上限 90 秒作为 SLA 基准） | 集成测试 |
| 4 | 测试结果报告 | 包含：通过/失败数、失败详情、错误摘要 | 输出格式验证 |
| 5 | tdd_checkpoint 扩展 | 接受 test_result 参数并正确写入 TEST_RUN_COMPLETE 事件 | 单元测试（4 用例：pass>0 且 fail=0、fail>0 含 error_summary 非空、空 test_result 参数报错、pass=0 且 fail=0（零测试用例发现，审计条目写入成功且 Reviewer 报告 M 级）。边界值：pass=NaN→error, fail=-1→error, pass=Infinity→error, pass=1.5→error（Number.isInteger() 拦截；Number.isFinite() 对整数是冗余的）） |
| 6 | read_audit_log 工具注册 | Watchdog 注册成功 + 返回审计日志条目 | 单元测试（工具调用返回非空数组） |

---

