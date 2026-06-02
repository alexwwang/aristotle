# Aristotle 质量保障体系实施方案

**状态**: 方案设计（16 轮审查完成，含范围质疑）
**版本**: 1.16
**日期**: 2026-05-31
**修订**: 2026-05-31 — v1.16 Pass 12 TDD Ralph Review Loop Round 10：4 findings（2H + 2M），全部修复。核心修复：(1) L336 接口重写补全缺失字段：sessionId、severity 可选化、round、修正注释 (2) L328 Prose 修正对齐 Phase 2 实现时机 (3) L401-405 TEST_RUN_REQUESTED 条目无 severity（符合新接口定义）。 definitive L336 anchor fix。

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
        │   ├── Git 回滚（新增）← create_rollback_point, rollback_to_checkpoint（⏳ Phase 4）
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

### Phase 1: 基础质量验证（2 周）

**目标**：让 LLM 的明显错误（语法、命令失败、文件写入错误）能被立即发现和阻止。

#### 3.1.1 Watchdog 机械验证增强

**设计约束**：
- **Interceptor**（onToolBefore）只能基于 `path` 和 `state` 判断，**无法获取文件内容**
- **Observer**（onToolAfter）可以读取 `args`（含 content）和 `output`，做深度检查
- 语法检查必须在 Observer 中执行（事后验证模式）

**Interceptor 规则**（保持 2 个，不新增）：
```typescript
// AC-3: 业务代码写入门控（原有）
// AC-12: 阶段门控（原有）
```

**Observer 增强**（新增 2 个检查）：
> ⚠️ 以下为 Phase 1 **拟实现代码**，非当前 observer.ts 实现。当前 handle() 仅处理 Task 工具的 ralph_loop 观察（见实际代码 observer.ts:141-193）。

```typescript
// ⚠️ Phase 1 目标接口说明：
// - 所有 appendAudit 调用使用 Phase 1 扩展后的 AuditLogEntry
// - 扩展策略：保留 decision 字段 + 新增 severity 字段（Observer 条目专用）
// - event 联合类型扩展为：CheckpointEvent | 'INTERCEPT' | 'PROMPT_INJECTION_DETECTED' | 'COMMAND_FAILED' | 'SYNTAX_ERROR_POST_WRITE' | 'OBSERVER_TIMEOUT' | 'FILE_TOO_LARGE_FOR_CHECK'
// - Observer 条目同时携带 decision（必填，兼容现有代码）和 severity（Observer 专用）
// - timestamp 由 appendAudit 内部自动填充（Date.now().toISOString()），调用方无需传递
// - sessionId 从 OpenCode 上下文获取，由 handle() 参数 sessionID 传入
// - phase 从 this.cache.getActiveRun() 获取
// - runId/projectId 由 appendAudit 三参数签名前两个参数传递，不在 entry 中重复

// observer.ts handle() 方法扩展（Phase 1 拟实现）
async handle(tool, args, output, sessionID, callID) {
  // Auto-resolve: 检查当前 tool/文件 的前次 block 级违规，本次成功则标记 resolved
  // Auto-resolve 实现：
  // const previousViolations = await this.store.getUnresolvedViolations('block', { tool, filePath });
  // if (previousViolations.length > 0) {
  //   await this.store.resolveViolations(projectId, runId, previousViolations.map(v => v.timestamp));
  // }
  // 现有逻辑：记录 Task 调用、扫描注入
  // `recordTaskAndScan` 为拟提取的私有方法，封装现有 `this.cache.get()` + `this.store.appendObservation()` + `this.scanTaskPrompt()` 调用序列。
  await this.recordTaskAndScan(tool, args, output, sessionID, callID);
  
  // 超时保护（§4.2 防御闭环）
  const TIMEOUT_MS = 20;
  // setTimeout 在 JS 事件循环中非精确计时。Observer 超时为 best-effort 保护，实际超时可能略超 20ms。AC-5 P99 基准测量实际执行时间而非依赖 setTimeout 精度。
  const timeoutPromise = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new ObserverTimeoutError()), TIMEOUT_MS));
  class ObserverTimeoutError extends Error { constructor() { super('Observer timeout'); this.name = 'ObserverTimeoutError'; } }
  try {
    await Promise.race([
      this._handleObservations(tool, args, output, sessionID, callID),
      timeoutPromise
    ]);
  } catch (e) {
    if (e instanceof ObserverTimeoutError) {
      const { projectId, runId, phase } = this.cache.getActiveRun();
      await this.store.appendAudit(projectId, runId, {
        event: 'OBSERVER_TIMEOUT',
        decision: 'BLOCK',
        severity: 'block',
        violation: 'Observer handle() 超时（>20ms），检查已跳过',
        sessionId: sessionID,
        phase,
      });
      return; // fail-open: 不阻塞当前操作
    }
    throw e;
  }
  // 超时错误处理：当前通过 instanceof 检查捕获 ObserverTimeoutError。Phase 3 可引入专用 ObserverTimeoutError 类以支持结构化错误处理。
}

// 私有方法：实际观察逻辑（提取自 handle()）
private async _handleObservations(tool, args, output, sessionID, callID) {
  // 新增：Bash 命令结果检查
  if (tool === 'Bash') {
    const exitCode = extractExitCode(output);
    if (exitCode !== 0) {
      // 检查配置：是否忽略此退出码
      const config = RuleConfigLoader.load('COMMAND_RESULT_CHECK');
      if (config.enabled && !config.ignoreExitCodes?.includes(exitCode)
          && !config.ignoreCommands?.some(pat => matchPattern(args.command, pat))) {
        const { projectId, runId, phase } = this.cache.getActiveRun();
        await this.store.appendAudit(projectId, runId, {
          event: 'COMMAND_FAILED',
          decision: config.severity === 'block' ? 'BLOCK' : 'WARN',
          severity: config.severity,  // 'warn' 或 'block'
          violation: `命令退出码 ${exitCode}: ${args.command}`,
          sessionId: sessionID,
          phase,
        });
        // Observer handle() 返回 Promise<void>（被动监视器，无返回值）
        // 警告通过审计日志传递，Checkpoint 阶段推进时检查 block 级违规
      }
    }
  }
  
  // 新增：文件写入后语法验证（Observer 可读取 args.content）
    // 注意：空文件（content === ''）和空白文件（content.trim() === ''）均视为合法（无内容 = 无语法错误）。falsy 跳过覆盖空字符串，trim 检查覆盖空白文件。
  //   因此只对 Write 工具做完整语法验证，Edit 工具跳过
  if (tool === 'Write') {
    const filePath = args.filePath;
    const content = args.content;
    const config = RuleConfigLoader.load('SYNTAX_CHECK_POST_WRITE');
    if (!config.enabled) return;
    
    // 文件大小检查（AC-5: ≤100KB）
    if (content.length > 100 * 1024) {
      const { projectId, runId, phase } = this.cache.getActiveRun();
      await this.store.appendAudit(projectId, runId, {
        event: 'FILE_TOO_LARGE_FOR_CHECK',
        decision: 'WARN',
        severity: 'warn',
        violation: `文件 ${filePath} 超过 100KB 限制，跳过语法检查`,
        sessionId: sessionID,
        phase,
      });
      return;
    }
    
    // 根据配置的 extensions 过滤（而非硬编码）
    const extMatch = config.extensions?.some(ext => filePath?.endsWith(ext));
    if (!extMatch || !content?.trim()) return;
    // NOTE: 未知扩展名（不在 .json/.ts/.tsx/.yaml/.yml 列表中）通过 extensions 过滤后不执行验证。若需支持新扩展名，需同时添加对应验证分支。
    
    if (filePath?.endsWith('.json')) {
      try { JSON.parse(content); }
      catch (e) {
        const { projectId, runId, phase } = this.cache.getActiveRun();
        await this.store.appendAudit(projectId, runId, {
          event: 'SYNTAX_ERROR_POST_WRITE',
          decision: 'BLOCK',
          severity: 'block',
          violation: `JSON 语法错误: ${e.message}`,
          sessionId: sessionID,
          phase,
        });
      }
    }
    
    // [Phase 2] TypeScript/TSX 语法验证（Phase 1 不实现此分支）
    if (filePath?.endsWith('.ts') || filePath?.endsWith('.tsx')) { // TypeScript/TSX 语法验证。TSX 是 TypeScript 超集，quickSyntaxCheck 兼容
      const result = quickSyntaxCheck(content);
      if (!result.ok) {
        const { projectId, runId, phase } = this.cache.getActiveRun();
        await this.store.appendAudit(projectId, runId, {
          event: 'SYNTAX_ERROR_POST_WRITE',
          decision: 'BLOCK',
          severity: 'block',
          violation: `TypeScript 语法错误: ${result.error}`,
          sessionId: sessionID,
          phase,
        });
      }
    }
    // Phase 1 仅实现上方 .json 和 .yaml/.yml 分支
    
    if (filePath?.endsWith('.yaml') || filePath?.endsWith('.yml')) {
      const result = yamlSyntaxCheck(content);
      if (!result.ok) {
        const { projectId, runId, phase } = this.cache.getActiveRun();
        await this.store.appendAudit(projectId, runId, {
          event: 'SYNTAX_ERROR_POST_WRITE',
          decision: 'BLOCK',
          severity: 'block',
          violation: `YAML 语法错误: ${result.error}`,
          sessionId: sessionID,
          phase,
        });
      }
    }
}
}
```

**辅助函数规范**：
- `extractExitCode(output: string): number` — 从 Bash 工具 output 中解析退出码。格式：`output` 最后行含 `Exit code: N` 或 process exit signal。实现：正则 `/exit code: (\d+)/i` 提取，fallback 返回 1。// fallback 返回 1（fail-safe）。⚠️ Phase 1 实施建议：先以 fallback=0（fail-open）上线收集实际覆盖率数据，若 ≥95% 命中率则切换 fallback=1。
- `quickSyntaxCheck(content: string): { ok: boolean; error?: string }` — TypeScript 语法快速检查。依赖 `typescript` compiler API（`createSourceFile` + `SyntaxKind` 遍历）。返回 `{ ok: true }` 或 `{ ok: false, error: '行 X: 语法错误描述' }`。⚠️ 评估轻量替代方案（如 `acorn` ~100KB 做纯语法解析）以减少生产环境依赖体积。Phase 1 可先仅支持 JSON/YAML 验证（零新依赖），TypeScript 验证延后评估。**Phase 1 决策**：先仅支持 JSON/YAML 验证（零新运行时依赖），TypeScript/TSX 验证延后至 Phase 2 评估。Phase 1 从依赖列表中移除 `typescript` 运行时依赖（保留为 devDependency 用于测试）。
- `yamlSyntaxCheck(content: string): { ok: boolean; error?: string }` — YAML 语法检查。依赖 `js-yaml` 库（`yaml.load()` 包裹 try/catch）。返回格式同上。
- `matchPattern(command: string, pattern: string): boolean` — Bash 命令名与 ignoreCommands glob 模式匹配。依赖 `minimatch` 库（`minimatch(command, pattern)`）。用于 COMMAND_RESULT_CHECK 的 ignoreCommands 过滤。

**Checkpoint 门控增强**（Phase 1 拟实现，当前 checkpoint.ts:397-405 仅做 archiveRun + clearActiveRun）：
```typescript
// checkpoint.ts — 阶段推进时检查审计日志（Phase 1 拟实现）
case 'phase_complete':
  // 检查审计日志中是否有未修复的 block 级违规
  // `getUnresolvedViolations` 为 Phase 1 需新增到 PipelineStore 的方法。实现：读取当前 run 审计日志 → 过滤 severity 匹配条目 → 排除 resolved:true 条目。
  const unresolved = await this.store.getUnresolvedViolations('block');
  if (unresolved.length > 0) {
    return {
      blocked: true,
      reason: `存在 ${unresolved.length} 个未修复的 block 级违规，无法推进阶段`,
      violations: unresolved.map(v => v.violation),
    };
  }
  break;
```

#### 3.1.2 产出物
- Watchdog Interceptor：2 个规则（不变）
- Watchdog Observer：+2 个检查（Bash 结果 + 文件写入语法验证）
- Watchdog Checkpoint：审计日志门控（阻止有未修复违规的阶段推进）
- **CheckpointGateResult 接口**：`{ blocked: boolean; reason?: string; violations?: string[] }`（Phase 1 新增）
- **与 CheckpointResult 的关系**：CheckpointGateResult 是 CheckpointHandler 门控检查的内部返回类型，与 `schema.ts` 的 CheckpointResult（tdd_checkpoint 工具的返回类型）不同。门控检查先执行，通过后才构造 CheckpointResult 返回给调用方。
- **PipelineStore 新增方法**：`getUnresolvedViolations(severity: string): AuditLogEntry[]`（Phase 1 需新增。实现：读取当前 run 审计日志 → 过滤 severity 匹配条目 → 排除 resolved:true 条目）
- 规则配置加载器（`RuleConfig`）— 实现为 `packages/watchdog/src/rule-config.ts`，从 `.watchdog/rules.json` 加载配置
- **AuditLogEntry.event 类型扩展**：
  - **Phase 1 审计事件**：`COMMAND_FAILED`、`SYNTAX_ERROR_POST_WRITE`、`OBSERVER_TIMEOUT`（Observer 超时事件）、`FILE_TOO_LARGE_FOR_CHECK`（大文件跳过检查）
  - **Phase 2 审计事件**：`TEST_RUN_REQUESTED`、`TEST_RUN_COMPLETE`（测试运行请求/完成）
  - **Phase 2 事件占位形式**：Phase 2 实现时扩展 event 联合类型包含 `TEST_RUN_REQUESTED | TEST_RUN_COMPLETE`（§3.2.2 产出物）。
  - Phase 3（待定）：`REVIEWER_SPAWNED` — Reviewer 派发事件
  - **CheckpointEvent 保持不变** — CheckpointEvent 仅处理 pipeline 状态机事件（phase_complete、ralph_round_finding 等），不包含审计事件。
  - **分期策略**：Phase 1 定义 Phase 1 审计事件类型 + Phase 2 事件类型占位（forward-compatible），Phase 2 实现时填充具体逻辑。
  - 所有审计事件 string 值统一使用 SCREAMING_SNAKE_CASE 命名。
- **AuditLogEntry 接口定义**（`packages/watchdog/src/schema.ts` 扩展）：
  ```typescript
  interface AuditLogEntry {
    event: CheckpointEvent | 'INTERCEPT' | 'PROMPT_INJECTION_DETECTED' | 'COMMAND_FAILED' | 'SYNTAX_ERROR_POST_WRITE' | 'OBSERVER_TIMEOUT' | 'FILE_TOO_LARGE_FOR_CHECK';  // CheckpointEvent=状态机事件，其余=审计扩展事件（Phase 1 Observer 生成）
    decision: 'PASS' | 'BLOCK' | 'WARN';  // 审计决策（必填，兼容现有 schema.ts）
    sessionId: string;  // 会话 ID（从 handle() 参数 sessionID 传入）
    severity?: 'warn' | 'block';  // Observer 专用（仅 Observer 生成的条目携带）. 非 Observer 条目省略此字段
    violation?: string;              // 违规描述（COMMAND_FAILED, SYNTAX_ERROR_POST_WRITE, OBSERVER_TIMEOUT）。// violation 是 undefined 的决策情况：PASS 决策时 undefined，JSON 序列化时省略该键
    resolved?: boolean;              // 违规解决机制标记（Phase 1 新增）
    resolvedAt?: string;             // ISO timestamp of resolution
    // Phase 2 扩展字段
    phase?: number;                  // 触发时的 pipeline phase（TEST_RUN_REQUESTED）
    round?: number;                  // Ralph 循环轮次（Checkpoint 条目使用）
    timestamp?: string;              // ISO 8601（与现有 schema.ts 一致，由 appendAudit 内部填充）
    pass?: number;                   // 测试通过数（TEST_RUN_COMPLETE）
    fail?: number;                   // 测试失败数（TEST_RUN_COMPLETE）
    error_summary?: string;          // 错误摘要（TEST_RUN_COMPLETE）
  }
  ```
  注意：`severity` 在 AuditLogEntry 中为 `'warn' | 'block'`（门控行为），与 FindingSeverity（C/H/M/P/L/I，审查评级）是不同概念。

  **Migration Note**: Phase 1 扩展现有 AuditLogEntry，非替换。保留 `decision` 字段不变；Observer 专用事件通过扩展 event 联合类型添加（`'OBSERVER_TIMEOUT' | 'COMMAND_FAILED' | 'SYNTAX_ERROR_POST_WRITE'`）；Observer 审计条目使用 `severity` 作为扩展字段（仅 Observer 生成的条目携带）。建议定义 `ObserverAuditEntry extends AuditLogEntry` 类型。

  **⚠️ AuditLogEntry 接口差异说明**：文档展示的接口为 Phase 1 目标扩展。当前实现（`schema.ts`）`event` 为联合类型（非 `string`），`timestamp` 为 ISO string（非 Unix ms），`phase` 为必填。Phase 1 新增的 Observer 事件通过扩展 event 联合类型实现，`severity` 为新增字段（非替代 `decision`），`resolved`/`resolvedAt` 为新增字段。完整迁移对照参见 Migration Note（上文）。
- **新增运行时依赖**（Phase 1）：
  - ~~`typescript` — TypeScript compiler API（Phase 2 候选依赖，Phase 1 不引入）~~ Phase 1 决策：仅 JSON/YAML 验证（零新运行时依赖）。typescript 作为 Phase 2 候选保留参考。
  - `js-yaml` — YAML 解析库，用于 yamlSyntaxCheck
  - `minimatch` — glob 模式匹配库，用于 ignoreCommands 模式匹配
- 文档：`docs/watchdog-mechanical-validation.md`

#### 3.1.3 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | JSON 语法拦截率 | 100%（写入无效 JSON 必被记录到审计日志） | e2e 测试：发送 10 个无效 JSON，全部被记录 |
| 2 | Bash 失败检出率 | ≥95%（exit code ≠ 0 的命令被标记） | 回归测试：运行 20 个失败命令，统计检出率 |
| 3 | 误拦截率 | ≤5%（误拦截率 = 被错误阻止的合法操作数 / 总合法操作数 × 100%） | e2e 测试：执行 50 个合法操作，统计误拦截（合法操作白名单：写入有效 JSON 文件、写入有效 .ts 文件、执行 exit 0 的 Bash 命令、执行 `git status` 等只读命令、**执行预期非零退出码的命令（grep 无匹配返回 1、diff 有差异返回 1、test 条件不满足返回 1）——此类命令应通过 `ignoreExitCodes` 配置排除**） |
| 4 | Interceptor 响应时间 | <5ms（P99） | 性能基准测试（vitest benchmark，1000 次调用，Node.js 20.x，Apple M1 或同等）。注：Interceptor 不读取文件内容，输入规模不影响性能 |
| 5 | Observer 响应时间 | ≤100KB 场景 P99 <20ms（主验收标准）。所有场景 P99 单独记录作为辅助指标。 | 性能基准测试（vitest benchmark，1000 次调用，Node.js 20.x，Apple M1 或同等，**文件 ≤100KB**。超出 100KB 的文件跳过语法检查并记录 warn 级审计事件。） |
| 6 | 审计日志门控 | 100%（有 block 级违规时阻止阶段推进） | 单元测试 |

---

### Phase 2: 测试驱动质量门（2 周）

**目标**：在关键阶段（Phase 5 业务代码写入后）确保测试被执行，测试失败阻止阶段推进。

#### 3.2.1 测试门控机制

**设计约束**：
- Watchdog 是 TypeScript 插件，运行在 OpenCode 进程中
- 直接运行 `npm test` 或 `pytest` 会阻塞整个会话
- 测试框架不统一（JS/Python/Go…）Watchdog 不应硬编码
- **测试运行是主 Agent 的职责**，Watchdog 只负责**检查是否有测试执行证据**

**不在 Interceptor 或 Observer 中运行测试**。改为 Checkpoint 审计日志模式：

```typescript
// checkpoint.ts — phase_complete 事件处理扩展
case 'phase_complete':
  if (state.currentPhase === BUSINESS_CODE_PHASE) {  // BUSINESS_CODE_PHASE = 5（TDD pipeline Phase 5: Business Code）。// TODO: Phase 2 新增到 watchdog/src/constants.ts。Watchdog state.currentPhase 使用 TDD pipeline 的 phase 编号。
    // 读取 TEST_EVIDENCE_CHECK 配置决定测试证据缺失时的行为
     const evidenceConfig = RuleConfigLoader.load('TEST_EVIDENCE_CHECK');
     if (!evidenceConfig.enabled) break;
     // severity 影响 Reviewer 报告级别，不影响 Checkpoint 门控
     // severity='block' → Reviewer 报告为 H 级 finding（不解决则阻止推进）
     // severity='warn' → Reviewer 报告为 M 级 finding（仅提示，不阻止推进）
     const testEvidenceSeverity = evidenceConfig.severity || 'block';
    // 记录测试运行请求到审计日志
    const { projectId: pid, runId: rid } = this.cache.getActiveRun();  // pid/rid 为内部缓存键缩写（存储效率），公共 API 使用完整 projectId/runId
    await this.store.appendAudit(pid, rid, {
      event: 'TEST_RUN_REQUESTED',
      decision: 'PASS',
      phase: state.currentPhase,
    });
    // 测试运行由主 Agent 负责
    // Reviewer 会检查审计日志，发现 TEST_RUN_REQUESTED 但无 TEST_RUN_COMPLETE
    // 则报告 H 级 finding
  }
  break;
```

**实际执行流程**：
```
1. 主 Agent 完成业务代码写入
2. 主 Agent 调用 tdd_checkpoint(event="phase_complete")
3. Checkpoint 记录 TEST_RUN_REQUESTED 到审计日志
4. Ralph Loop 下一轮 → Reviewer subagent 检查审计日志
5. Reviewer 发现 TEST_RUN_REQUESTED 但无 TEST_RUN_COMPLETE → 报告 H 级 finding
6. Reviewer 发现 TEST_RUN_COMPLETE 但 fail_count > 0 → 报告 H 级 finding
7. 主 Agent 必须运行测试 → 提交测试结果（审计日志记录 TEST_RUN_COMPLETE，含 pass/fail 计数）→ 才能通过

> **注**：Reviewer 在"下一轮"检查时存在时间窗口——测试可能正在执行中。实际场景中，Reviewer 的审查轮次间隔（30-90 秒）提供了足够的缓冲。若首次发现无 TEST_RUN_COMPLETE，报告 M 级（提示），下一轮仍未完成则升级为 H 级。

边界条件：若 Ralph Loop 连续 zero-CHM 条件无法满足（因测试证据 finding 持续存在），循环不会自然终止——Ralph Loop 无 round cap，会持续迭代直到所有 finding 解决。若因外部原因需强制终止 pipeline run，Checkpoint 应保留未解决违规记录，下次 run 可继续。

> **注**：当 `TEST_RUN_REQUESTED` 存在但 `TEST_RUN_COMPLETE` 尚未写入时，consecutiveZero 计数不归零（视为 pending H 级 finding）。确保测试证据 finding 不会因时间窗口问题被遗漏。
```

#### 3.2.2 产出物
- Checkpoint: 审计日志增加 TEST_RUN_REQUESTED/TEST_RUN_COMPLETE 事件
  - TEST_RUN_COMPLETE 事件必须包含 `{ pass: number, fail: number, error_summary: string }`
  - fail > 0 时 Reviewer 报告 H 级 finding（等同测试缺失）
- **`tdd_checkpoint` 扩展接口**（Phase 2 新增）：`tdd_checkpoint(event: string, test_result?: { pass: number; fail: number; error_summary: string })`。当 event='TEST_RUN_COMPLETE' 时，`test_result` 参数必填。CheckpointHandler 写入 AuditLogEntry 时将 pass/fail/error_summary 写入扩展字段。
- **AuditLogEntry.event 类型扩展（Phase 2 新增）**：在 `schema.ts` 中将 `'TEST_RUN_REQUESTED' | 'TEST_RUN_COMPLETE'` 添加到 AuditLogEntry.event 联合类型。
- CheckpointEvent 保持不变：CheckpointEvent 仅处理 pipeline 状态机事件，不包含审计事件。
- **审计日志端到端机制定义**（Phase 2 前置依赖）：
  1. **写入**：TEST_RUN_COMPLETE 由主 Agent 通过 Watchdog 注册的 `tdd_checkpoint` OpenCode 工具写入（扩展该工具接受 test_result 参数）
  2. **存储**：审计日志通过 StateStore 抽象层存储，key 为 `watchdog/${projectId}/${runId}/audit`（与 state 共享存储层）
  3. **读取**：Watchdog 注册 `read_audit_log` 自定义工具到 OpenCode（非 MCP，通过 OpenCode 插件 API 注册），主 Agent 在派发 Reviewer 前调用
  4. **跨语言**：Watchdog (TypeScript) 通过 OpenCode 插件注册机制暴露工具，MCP (Python) 不直接调用 Watchdog。主 Agent 通过 OpenCode 工具调用链桥接
  5. **选型**：首选 OpenCode 自定义工具注册（类型安全 + 框架集成），降级条件：若插件 API 不支持工具注册，则通过 StateStore key `watchdog/${projectId}/${runId}/audit` 直接读取审计日志
  6. **运行时检测**：Watchdog 初始化时尝试注册自定义工具，若 API 不可用则自动切换至降级模式（无需手动配置）。检测方法：try { await opencode.plugins.registerTool('read_audit_log', handler) } catch (e) { if (e instanceof TypeError || e.name === 'NotImplementedError') { this.degraded = true; this.appendAudit(...DEGRADATION_MODE_ACTIVATED...) } else { throw e; } // 非 API 不可用异常，向上抛出 }。降级状态通过 StateStore key `watchdog/${projectId}/degraded` 暴露，主 Agent 可通过 tdd_checkpoint 响应头感知。切换后写入审计日志 `DEGRADATION_MODE_ACTIVATED` 事件。
- **`read_audit_log` OpenCode 自定义工具注册**（Phase 2 新增产出物）：Watchdog 插件通过 OpenCode 插件 API 注册 `read_audit_log` 工具，供主 Agent 在派发 Reviewer 前查询审计日志。实现位置：`packages/watchdog/src/tools/read-audit-log.ts`。
- **降级方案 runId 传递机制**：若插件 API 不支持工具注册，通过 StateStore 已知 key `watchdog/${projectId}/active`（存储 ActiveRun 含 runId）暴露 runId，主 Agent 通过现有 MCP 工具 `pipeline_status`（需扩展返回 runId 字段）或直接读取 StateStore 文件路径（`.watchdog/state/{projectId}/active`）。若均不可用，由 Watchdog 在 `tdd_checkpoint` 工具响应中附带当前 runId。
- **审计日志生命周期**：每个 pipeline run 的审计日志在 run 归档（`archiveRun`）后保留 7 天供查询，之后删除。单个日志 key 最大 10MB，超出时自动轮转（写入新 key `watchdog/${projectId}/${runId}/audit-2`）。⚠️ TTL 清理和轮转为运维特性，Phase 2+ 实现。当前阶段日志无限增长。Phase 2 实现时需评估 StateStore 是否支持按时间/大小清理。
- Reviewer prompt: 增加"检查测试执行证据"检查项（含测试结果内容校验）
- 文档：`docs/test-driven-quality-gate.md`

#### 3.2.3 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 测试请求记录率 | 100%（Phase 5 完成时自动记录 TEST_RUN_REQUESTED） | e2e 测试 |
| 2 | Reviewer 检出率 | 100%（有 TEST_RUN_REQUESTED 无 TEST_RUN_COMPLETE 时报告 H 级） | 集成测试 |
| 3 | 测试证据检出时效 | 测试执行证据缺失在 ≤90 秒内被发现（Reviewer subagent 单轮审查耗时约 30-90 秒，取上限 90 秒作为 SLA 基准） | 集成测试 |
| 4 | 测试结果报告 | 包含：通过/失败数、失败详情、错误摘要 | 输出格式验证 |
| 5 | tdd_checkpoint 扩展 | 接受 test_result 参数并正确写入 TEST_RUN_COMPLETE 事件 | 单元测试（3 用例：pass>0、fail>0、error_summary 非空） |

---

### Phase 3: Ralph Loop 语义审查扩展（待定 — 非当期范围）

> **⚠️ v1.6 范围裁剪说明**：Phase 3 的 S/B/A severity schema 迁移部分（§3.3.2）标记为**待定**，不在当期实施。理由：
> 1. 现有 C/H/M 已能覆盖 S/B/A 描述的场景（API 幻觉→H，需求不符→M/H，过度设计→L/I）
> 2. Schema 迁移涉及 25+ 处核心文件改动，无上游协议变更驱动
> 3. 当期核心目标是打通基本质量闭环（Phase 1→2→4），不是精确分类
>
> **保留部分**：§3.3.3 审查维度（语义正确性、业务逻辑一致性、上下文适配性）作为 Reviewer prompt 检查项指导，但用现有 C/H/M severity 标注。
>
> **重新激活条件**：当出现现有 C/H/M 无法充分表达的质量问题，且有明确的用户场景驱动时，作为独立 Phase 需求文档重新论证。

**目标**：让 Reviewer subagent 不仅检查代码质量，还检查语义正确性、业务逻辑一致性。

#### 3.3.1 调度机制

语义审查发生在 Ralph Loop 的 Reviewer round 中，由主 Agent 通过 Task tool 派发。无需新的触发条件。

**调用流程**：
⚠️ 以下为 Schema v5 迁移后的目标调用流程。当期使用 C/H/M severity 替代 S/B/A（参见 §3.3.3 映射表）。
```
1. Ralph Loop 进入 round N
2. 主 Agent 调用 Task(category="quick", prompt="<reviewer prompt>")
   → Observer 记录 REVIEWER_SPAWNED（⏳ Phase 3 待定，当前跳过此步骤）
3. Reviewer subagent 执行审查（含 S/B/A 检查）
4. Reviewer 返回 findings 文本给主 Agent
5. 主 Agent 调用 tdd_checkpoint(event="ralph_round_finding", 
   finding={ severity: 'S'|'B'|'A', ... })
6. CheckpointHandler 验证 severity 是否合法
7. 主 Agent 调用 tdd_checkpoint(event="ralph_round_complete")
```

#### 3.3.2 Severity 扩展与 Schema 迁移（⚠️ 待定 — 非当期范围）

> 以下内容保留作为未来参考，当期不实施。影响面分析：25+ 处改动跨 4 个核心源文件（schema.ts, transitions.ts, checkpoint.ts, pipeline-store.ts），需独立需求文档论证。

**当前**: SCHEMA_VERSION = 4, severity: C/H/M/P/L/I  
**目标**: SCHEMA_VERSION = 5, severity: C/H/M/P/L/I/S/B/A

**S/B/A 与 C/H/M/P/L/I 并存，不替代**：
- C/H/M/P/L/I = 代码质量维度（原有）
- S/B/A = 语义质量维度（新增）
- Reviewer 可同时报告两类 severity

**迁移策略（向后兼容）**：
```typescript
// schema.ts
export const SCHEMA_VERSION = 5;

export type FindingSeverity = 'C' | 'H' | 'M' | 'P' | 'L' | 'I' | 'S' | 'B' | 'A';

// FindingSubmission.severity 联合类型同步扩展（F5-03 修正）
// 当前: severity: 'C' | 'H' | 'M' | 'P' | 'L' | 'I'
// 目标: severity: 'C' | 'H' | 'M' | 'P' | 'L' | 'I' | 'S' | 'B' | 'A'
// 同步修改 schema.ts FindingSubmission 接口

// RoundRecord.counts 类型扩展（F5-04 修正）
// 当前: counts: { C: number; H: number; M: number; P: number; L: number; I: number }
// 目标: counts: { C: number; H: number; M: number; P: number; L: number; I: number; S: number; B: number; A: number }
// 同步修改 schema.ts RoundRecord 接口 + transitions.ts counts 初始化
// transitions.ts 初始化更新:
//   const counts = { C: 0, H: 0, M: 0, P: 0, L: 0, I: 0, S: 0, B: 0, A: 0 };
//   counts[f.severity]++ 现在能正确处理 S/B/A

// transitions.ts SEV_ORDER 更新
// 策略：保留现有 C/H/M/P/L/I 数值不变（向后兼容），S/B/A 插入上方
const SEV_ORDER: Record<string, number> = {
  S: 8,  // Showstopper — 必须修复，否则不能继续
  C: 5,  // Critical（保持不变）
  B: 4,  // Blocker — 阻碍质量达标（与 H 同级，等同高风险）
  H: 4,  // High（保持不变）
  M: 3,  // Medium（保持不变）
  P: 2,  // Pass（保持不变）
  L: 1,  // Low（保持不变）
  A: 0,  // Acceptable — 信息性，可延后
  I: 0,  // Info（保持不变）
};
// 注意：S=8 确保高于所有现有级别；B 与 H 同级（均=4）表示业务阻塞等同高风险
// B 与 H 同值表示**处理优先级相同**，区别在于维度（业务阻塞 vs 代码风险）。当 B 和 H 同时触发时，按发现顺序处理，无需额外排序。若需区分处理路径（如 B 需业务确认），在 Schema v5 中扩展 FindingSubmission 添加 `category?: string` 字段用于路由。当期不区分，B 和 H 使用相同处理路径。
// audit：所有依赖 SEV_ORDER 绝对数值的代码路径需 review
//   - severityLt() 比较逻辑不受影响（相对比较）
//   - consecutiveZero 检查 (C+H+M=0) 需决定是否加入 S+B，见 F5-12 修正

// VALID_SEVERITIES 同步更新（F5-02 修正）
const VALID_SEVERITIES = new Set(['C', 'H', 'M', 'P', 'L', 'I', 'S', 'B', 'A']);

// pipeline-store.ts readState() 迁移
// 与现有 pipeline-store.ts 迁移模式对齐（F5-06 修正 + F-15 修正）
// 现有模式：readState 不修改 version 字段，只在内存中补缺失字段
// 实际 API：使用 this.stateStore.read<PipelineState>(key)，非 fs.readFileSync
// v4→v5 迁移策略：
//   1. SCHEMA_VERSION 升至 5（代码层面）
//   2. readState 加载 v4 文件时：version gate 允许 v4 < v5
//   3. 不在 readState 中修改 state.version（保持磁盘一致性）
//   4. 新状态文件默认 version = SCHEMA_VERSION = 5
//   5. 旧数据中无 S/B/A 字段不影响（TypeScript 可选字段 + 默认值 0）
//   6. 与现有迁移模式对齐（P:0 补字段、totalPhases 补字段等）
readState(projectId: string, runId: string): PipelineState | null {
  const state = this.stateStore.read<PipelineState>(this.stateKey(projectId, runId));
  if (!state) return null;

  // v4 → v5 迁移：补缺失字段（不修改 version）
  // 迁移风格与现有 P 字段迁移一致（schema.ts readState L157）
  if (state.version < 5) {
    // RoundRecord.counts 补 S/B/A 字段
    for (const round of state.roundRecords ?? []) {
      if (round.counts) {
        round.counts.S = round.counts.S ?? 0;
        round.counts.B = round.counts.B ?? 0;
        round.counts.A = round.counts.A ?? 0;
      }
    }
    // 不修改 state.version — version 只在写入时更新
  }
  
  return state;
}
```

**Schema 迁移测试要求**：
1. v4 状态文件在 v5 代码下正常加载（无 S/B/A 字段不影响）
2. v5 状态文件中的 S/B/A findings 被正确排序（SEV_ORDER）
3. v4 状态文件不会被自动持久化为 v5（内存中升级，磁盘上只读不改）
4. 新创建的状态文件默认为 v5
5. S/B/A findings 在 Ralph Loop 统计中正确计入

**Checkpoint 事件**: 无需新增事件类型。S/B/A severity 通过现有 `ralph_round_finding` 事件提交。CheckpointHandler 的 severity 验证逻辑只需扩展合法值集合。

**consecutiveZero 行为规范（F5-12 修正）**：
- S (Showstopper) **重置** consecutiveZero（等同 C/H/M — 必须修复才能通过）
- B (Blocker) **重置** consecutiveZero（等同 C/H/M — 阻碍质量达标）
- A (Acceptable) **不重置** consecutiveZero（等同 P/L/I — 信息性建议）
- 实现位置：`transitions.ts` consecutiveZero 检查从 `C+H+M=0` 扩展为 `C+H+M+S+B=0`

#### 3.3.3 扩展 Reviewer 检查项

```
Reviewer 审查维度（现有 + 新增）：

现有（保留）：
├── C (Critical) — 严重缺陷（崩溃、数据丢失）
├── H (High) — 高风险（安全漏洞、性能问题）
├── M (Medium) — 中等问题（边界情况、异常处理）
├── P (Pass) — 通过（无问题）
├── L (Low) — 低优先级（代码风格、注释）
└── I (Info) — 信息（建议、优化点）

新增（并存）：
├── S (Showstopper) — 语义正确性
│   ├── API/函数调用参数类型和数量是否正确
│   ├── 数据流向是否合理（无循环依赖、无死数据）
│   ├── 类型断言是否有运行时验证支撑
│   ├── 外部依赖的 API 是否真实存在（非幻觉）
│   └── 逻辑推理链是否完整无跳跃
├── B (Blocker) — 业务逻辑一致性
│   ├── 实现是否与需求文档/Issue 描述一致
│   ├── 状态转换是否覆盖了所有合法路径
│   ├── 边界条件是否考虑了业务场景（不仅是技术边界）
│   ├── 错误处理是否符合业务预期（不只是技术上的 catch）
│   └── 并发/竞态条件是否在业务层面被考虑
└── A (Acceptable) — 上下文适配性
    ├── 方案复杂度是否匹配问题规模
    ├── 是否有更简单的替代方案被忽略
    ├── 技术选型是否适合项目当前阶段
    ├── 是否引入了不必要的依赖或抽象
    └── 是否考虑了团队当前的技术能力和维护成本
```

**S/B/A → C/H/M 映射表（Phase 3 待定期间过渡使用）**：
| S/B/A | 映射 C/H/M | 判定依据 |
|-------|-----------|---------|
| S (Showstopper) | H 或 C | API 幻觉/数据丢失风险 → C；逻辑推理错误 → H |
| B (Blocker) | H 或 M | 需求实现不符 → H；边界条件遗漏 → M |
| A (Acceptable) | L 或 I | 不必要复杂度 → L；更好方案建议 → I |

**映射判定规则**：
```
// S→C 判定条件：涉及外部 API 调用幻觉、数据丢失/损坏风险、文件系统破坏风险
// S→H 判定条件：纯逻辑推理错误、流程控制错误、边界条件遗漏
// B→H 判定条件：阻碍业务流程但无数据风险
// B→M 判定条件：业务流程降级但仍可继续
// A→L 判定条件：代码风格或非关键优化
// A→I 判定条件：建议性改进或文档补充
```

#### 3.3.4 Reviewer Prompt 扩展

在 Reviewer subagent 的 prompt 模板中增加：

```markdown
## 语义审查（Semantic Review）

在代码审查之外，请检查以下语义问题：

### S — 语义正确性（Showstopper 级别）
检查项：
1. API/函数调用是否使用了正确的参数类型和数量
2. 数据流向是否符合逻辑（无循环依赖、无死数据）
3. 类型断言是否有运行时验证支撑
4. 外部依赖的 API 是否真实存在（非幻觉）
5. 逻辑推理链是否完整无跳跃

### B — 业务逻辑一致性（Blocker 级别）
检查项：
1. 实现是否与需求文档/Issue 描述一致
2. 状态转换是否覆盖了所有合法路径
3. 边界条件是否考虑了业务场景（不仅仅是技术边界）
4. 错误处理是否符合业务预期（不只是技术上的 catch）
5. 并发/竞态条件是否在业务层面被考虑

### A — 上下文适配性（Acceptable 级别）
检查项：
1. 方案复杂度是否匹配问题规模
2. 是否有更简单的替代方案被忽略
3. 技术选型是否适合项目当前阶段
4. 是否引入了不必要的依赖或抽象
5. 是否考虑了团队当前的技术能力和维护成本

### 测试执行证据检查
1. 审计日志中是否存在 TEST_RUN_REQUESTED？
2. 如果存在，是否也有对应的 TEST_RUN_COMPLETE？
3. 测试结果是否全部通过？
4. 如果缺少测试证据，报告为 H 级 finding

## Finding 提交格式

使用 ralph_round_finding 提交时，当期使用 C/H/M severity（参见 §3.3.3 映射表）标注语义审查发现。
S/B/A severity 提交格式在 Schema v5 迁移（§3.3.2）完成后启用。
```

#### 3.3.5 tdd-pipeline Skill 同步（⚠️ 待定 — 依赖 §3.3.2）

**位置**: 外部仓库 `github.com/alexwwang/tdd-pipeline`

**需要更新的文件**:
1. `skill/REVIEWER.md` — 增加语义审查 prompt 模板 + 测试证据检查
2. `skill/REFLECTOR.md` — 增加 S/B/A severity 说明
3. `skill/CHECKER.md` — 增加 severity 合法值校验

**接口约定**: 
- Watchdog 是协议执行层（检查 severity 合法性）
- Skill 是协议定义层（定义 severity 语义）
- 改了 skill → 改了 schema → 改了 validation

**风险评估**: tdd-pipeline 为同一维护者仓库，同步无组织阻碍。若同步延迟，Phase 3 本身已标记为"待定"，不阻塞当期主线（Phase 1→2→4→5）。

#### 3.3.6 产出物（⚠️ Schema 相关项待定）
- ~~Schema v5 迁移（含向后兼容测试）~~ → 待定
- Reviewer prompt 模板更新（当期可做：用现有 C/H/M 标注语义审查维度）
- ~~tdd-pipeline skill 文档更新（3 个文件）~~ → 待定（依赖 Schema 迁移）
- ~~集成测试：S/B/A finding 通过完整 Ralph Loop 流程~~ → 待定
- 文档：`docs/ralph-loop-semantic-review.md`（当期可做：审查维度指南）

#### 3.3.7 验收标准

⚠️ 以下验收标准分为两组：当期可执行（AC-1, AC-4）和 Schema v5 迁移后（AC-2, AC-3, AC-5）。Schema v5 迁移前仅验证当期可执行项。以下 AC 标注 ⚠️ 的项目仅在 Schema v5 迁移完成后可验证。未标注的项目为当期可执行。

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | Reviewer prompt 覆盖 | S/B/A 三维度各有 ≥5 个检查项 | 检查清单评审 |
| 2 | S/B/A severity 提交 | ⚠️ 依赖 Schema v5 迁移（§3.3.2）。当期替代：语义审查发现用 C/H/M 提交，映射参见 §3.3.3 | 集成测试 |
| 3 | 误报率 | ≤20%（语义审查 finding 中误报比例，≥30 个样本或全量评审）⚠️ 依赖 Schema v5 迁移 | 人工抽样评审 |
| 4 | Schema 兼容 | v4 状态文件在 v5 下正常读取 | 迁移测试（5 个用例） |
| 5 | Skill 同步 | tdd-pipeline 3 个文件已更新 | 文件 diff 对照 |

---

### Phase 4: intervention 合并到 aristotle_mcp（2 周）

**目标**：将 intervention/ 的无状态操作合并到 aristotle_mcp/，删除有状态模块，统一操作入口。

#### 3.4.0 合并前置条件 — 状态模型统一

**核心约束**: Aristotle MCP 是无状态工具服务器（每个 tool call 独立）。intervention/ 的有状态模块不直接合并。

**处理方式**：

| intervention 模块 | 处理方式 | 理由 |
|-------------------|----------|------|
| ViolationFilter (19行) | **删除** | Watchdog Interceptor 已完全覆盖，功能冗余 |
| InterventionCoordinator | **删除** | 协调逻辑由 Watchdog Observer + Ralph Loop 替代 |
| Reflector | **删除** | MCP 无法调用 LLM，由 Ralph Loop Reviewer 替代 |
| PromptValidator | **移到 Ralph Loop** | 作为 Reviewer prompt 的一部分（bilingual forbidden patterns） |
| RollbackEngine | **简化合并到 MCP** | 转为无状态工具（create_rollback_point, rollback_to_checkpoint）。**设计决策**：MCP 只提供通用回滚（git reset），不保留 violation_type 特定回滚策略（`_delete_implementation`、`_restore_test`）。理由：(1) 精确回滚依赖 ViolationEvent + PipelineContext 有状态数据，与 MCP 无状态原则冲突 (2) 精确回滚策略由 Watchdog TypeScript 侧调用 MCP 工具组合实现。参见 §3.4.1 影响分析。 |
| KiDocManager | **合并到 MCP** | 转为无状态工具（write_ki_doc, read_ki_docs） |
| RuleGenerator | **删除** | 功能与 MCP write_rule 重叠（write_rule 接收用户内容直接持久化，RuleGenerator 的模板生成逻辑由 Ralph Loop Reviewer prompt 替代） |
| intervention_types.py (143 行) | **删除** | 数据类型定义由 Watchdog schema.ts 替代 |
| __init__.py (6 行) | **删除** | 目录整体清除时自然删除 |
| CommitGuard | **拆分处理** | 自动提交功能**删除**（依赖 PipelineContext 有状态数据，与 MCP 无状态原则冲突，自动提交职责由 Watchdog TypeScript 侧承担）；schema 校验逻辑内联增强 MCP `commit_rule`（非独立新工具），参见 §3.4.1 |

> **注**：完整删除文件列表见 §3.4.2。

**合并后架构**：
- 所有 MCP 工具都是无状态的
- 有状态逻辑全部在 Watchdog（TypeScript 侧）
- MCP 只做 CRUD 操作（读/写/查询规则、KI 文档、回滚点）

#### 3.4.1 合并内容

| 功能 | 来源 | 目标 | MCP 工具 |
|------|------|------|----------|
| Git 回滚 | RollbackEngine | `git_ops.py` | `create_rollback_point`, `rollback_to_checkpoint`（详细约束见下方） |

**Git 回滚安全约束**（追加到现有 `git_ops.py`，不修改已有函数）：
- 新增 `git stash`、`git reset --hard`、`git reflog` 操作
- **安全约束**：`rollback_to_checkpoint` 执行 `reset --hard` 前自动 `git stash --include-untracked` 未提交更改，防止数据丢失
- **stash 失败处理**：若 stash 失败，阻止 rollback 返回错误，不继续执行 reset
- **stash 堆积管理**：每次 rollback 前检查 stash 数量，超过 5 个时返回警告（非错误，允许继续操作，响应中含 stash 清理建议）。**超过 10 个时阻止 rollback 并要求先清理 stash（硬上限）。**

**RollbackEngine 简化影响分析**（F-20 修正）：当前 RollbackEngine 有两类 violation-specific 回滚策略：
- `SKIP_RED_PHASE → _delete_implementation`：删除实现文件（不恢复测试）
- `MODIFIED_TEST → _restore_test`：恢复测试文件到 boundary_commit_hash 版本

合并后的 `rollback_to_checkpoint` 只提供通用 `git reset --hard`（回滚到指定 checkpoint）。**丢失的能力**：无法只删实现而不动测试（或只恢复测试而不动实现）。**缓解**：精确回滚由 Watchdog TypeScript 侧组合 MCP 工具实现（先 `rollback_to_checkpoint` 恢复全部，再重写需要保留的文件）。对 TDD pipeline 安全网的影响：可接受——严重违规通常需要全量回滚，violation-specific 策略在当前代码中实际覆盖率较低（仅 2 种类型）。

**精确回滚实现路径**（Phase 4+ 设计）：Watchdog Observer 检测到严重违规 → 通过 OpenCode MCP tool dispatch 调用 `rollback_to_checkpoint` 恢复全部 → 再调用 `write_rule` 重写需保留的文件。具体调用链在 Phase 4 实施时设计，当前文档记录设计意图。
| KI 文档 | KiDocManager | `_tools_ki.py` | `write_ki_doc`, `read_ki_docs` |
| 提交守卫 | CommitGuard | `_tools_rules.py` | 增强 `commit_rule`（增加守卫逻辑，非新工具） |

#### 3.4.2 删除内容
- `intervention/src/watchdog.py` — ViolationFilter 19 行，功能被 Interceptor 完全覆盖
- `intervention/src/intervention_coordinator.py` — 协调逻辑分散到 Watchdog + Ralph Loop
- `intervention/src/reflector.py` — MCP 无法调用 LLM，由 Ralph Loop 替代
- `intervention/src/prompt_validator.py` — 移到 Ralph Loop Reviewer prompt
- `intervention/src/rule_generator.py` — 与现有 write_rule 功能重叠
- `intervention/src/committer.py` — AutoCommitter 的 validate_schema() 函数将直接内联到 MCP commit_rule（CommitGuard 的 schema 校验与 AutoCommitter 共用同一 validate_schema 函数，参见 committer.py:12-28）
- `intervention/src/commit_guard.py` — 守卫逻辑将内联到 MCP `commit_rule`（46 行，非独立新工具）
- `intervention/src/intervention_types.py` — 数据类型定义（143 行），功能由 Watchdog schema 替代
- `intervention/src/__init__.py` — 包初始化（6 行，随目录整体删除）
- `intervention/` 目录整体删除

#### 3.4.3 MCP 工具清单（合并后验证）

**现有 20 工具**（aristotle_mcp/，已对照 `mcp._tool_manager._tools` 验证）：

规则生命周期（13 个）：
1. init_repo
2. write_rule
3. read_rules
4. list_rules
5. stage_rule
6. commit_rule
7. reject_rule
8. restore_rule
9. detect_conflicts
10. get_audit_decision
11. check_sync_status
12. sync_rules
13. report_feedback

工作流编排（6 个）：
14. orchestrate_start
15. orchestrate_on_event
16. orchestrate_review_action
17. create_reflection_record
18. complete_reflection_record
19. persist_draft

其他（1 个）：
20. on_undo

**以下为 Bridge Plugin 方法，非 MCP 工具**（不计入 20）：
- aristotle_fire_o（简称 fire_o，Reflector 调度）
- aristotle_check（简称 check_workflow，工作流状态查询）
- aristotle_abort（简称 abort_workflow，工作流取消）

**新增 4 工具**（来自 intervention/）：
21. create_rollback_point（来自 RollbackEngine）
22. rollback_to_checkpoint（来自 RollbackEngine）
23. write_ki_doc（来自 KiDocManager）
24. read_ki_docs（来自 KiDocManager）

**注意**: RuleGenerator 的功能已由现有 write_rule 覆盖，CommitGuard 的守卫逻辑将内联增强 commit_rule，两者均不作为独立新工具添加。实际合并后为 **24 工具**。

**⚠️ commit_rule 行为变更兼容性说明**: 增强后的 commit_rule 将增加提交前守卫检查（如：规则状态必须为 staging 才能提交，frontmatter schema 校验）。现有调用方若直接调用 commit_rule 且规则未 staging，将收到拒绝。兼容策略：(1) 守卫默认启用 (2) 可通过 `skip_guard: true` 参数跳过（默认 false，用于自动化场景）(3) 错误信息包含具体拒绝原因和修复建议。**安全约束**：MCP 侧自维护审计日志（`.aristotle/audit.jsonl`），`skip_guard: true` 调用时 MCP 写入 GUARD_BYPASSED 条目到 MCP 侧审计日志。Watchdog Checkpoint 通过 `readMcpAuditLog()` 方法（Phase 4 新增）聚合 MCP 侧审计日志。**Phase 4 安全增强**：`readMcpAuditLog()` 聚合 MCP 侧审计日志后，Checkpoint 可选择将 `GUARD_BYPASSED` 事件纳入门控决策（作为 warn 级 finding，不阻止但记录）。Phase 1-3 设计决策：信任 MCP 调用方，guard bypass 仅追溯。**`readMcpAuditLog()` 接口定义**（Phase 4 新增）：`readMcpAuditLog(): Promise<McpAuditEntry[]>`。读取 MCP 侧审计日志（`.aristotle/audit.jsonl`），返回结构化条目。Watchdog Checkpoint 在阶段推进时调用此方法聚合 MCP 侧审计事件。**`McpAuditEntry` 接口定义**：`{ event: string; timestamp: string; details: Record<string, unknown>; source: 'mcp' }`。`event` 与 AuditLogEntry.event 使用相同命名规范（SCREAMING_SNAKE_CASE）。`timestamp` 为 ISO 8601 字符串。`details` 包含事件特定数据（如 GUARD_BYPASSED 的参数信息）。`source: 'mcp'` 区分 Watchdog 侧审计条目。

**双审计日志聚合策略**：Phase 1-3 仅 Checkpoint 使用 Watchdog 侧审计日志（`getUnresolvedViolations`）。MCP 侧审计日志（`.aristotle/audit.jsonl`）仅作追溯用，不参与门控决策。Phase 4 `readMcpAuditLog()` 提供聚合查询能力，用于事后分析和全链路审计。门控决策始终基于 Watchdog 侧审计日志。在 CI/CD 环境变量 `ARISTOTLE_CI=true` 存在时 skip_guard 默认 **false**（CI 环境仍执行守卫检查）。CI 脚本如需跳过（如批量迁移场景），显式传递 `skip_guard: true`。

**现有调用方影响分析**：(1) Aristotle workflow orchestrate 流程中 commit_rule 调用时规则已 staging（正常流程）→ 无影响 (2) 直接 MCP 调用场景 → 未 staging 规则将被拒绝，需显式 skip_guard=true (3) Bridge plugin 调用 → 同 (1)，正常流程已 staging。迁移建议：发布 changelog 通知直接 MCP 调用方。

**并发安全约束**：MCP 侧审计日志使用 append-only JSONL 格式（原子写入单行）。`readMcpAuditLog()` 容忍末尾不完整行（跳过并记录 warn）。不使用文件锁（避免跨进程死锁）。**单行大小限制**：MCP 侧审计日志单行不超过 4KB（PIPE_BUF 典型值）。`error_summary` 等长文本字段超限时截断至 500 字符。超出限制的条目写入后标记 `truncated: true`。

> **注**：4 个新工具的详细接口规格（参数名/类型/必填、返回值结构、错误码）作为 Phase 4 前置任务在 Phase 4 开始前补充到本文档。Phase 4 TDD 流程要求先有接口规格才能编写测试。当前仅列出工具名称和功能来源，作为实施定位参考。

#### 3.4.4 产出物
- 合并后的 aristotle_mcp/（24 工具）
- 删除 intervention/ 目录
- intervention 保留模块的测试迁移验证（以实际迁移时计数为准）
- **测试迁移说明**：(1) 删除模块（ViolationFilter/InterventionCoordinator 等）的测试直接删除 (2) 保留模块（KiDocManager/RollbackEngine）的测试迁移至 `packages/watchdog/tests/` 或 MCP 侧测试目录 (3) 迁移数量以实际可迁移用例为准，不设硬性目标。
- 文档：`docs/intervention-merge-guide.md`

#### 3.4.5 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 功能等价 | 合并后 MCP 工具覆盖 intervention 所有保留模块的公开方法 | 接口对照表 |
| 2 | 测试保留 | intervention 保留模块的测试（RollbackEngine, KiDocManager）迁移后通过；CommitGuard schema 校验逻辑已内联到 commit_rule，验证见 AC-7 | pytest |
| 3 | 目录清除 | intervention/ 目录不存在 | ls 验证 |
| 4 | MCP 工具数 | 24（20 现有 + 4 新增） | 工具清单 + 自动化断言：`uv run python -c "from aristotle_mcp.server import mcp; assert len(mcp._tool_manager._tools) == 24"`（⚠️ 此断言依赖 mcp 库内部 API `_tool_manager._tools`，mcp 库升级时需同步更新。降级方案：`mcp` CLI 发送 `tools/list` JSON-RPC 请求计数。） |
| 5 | 无状态验证 | 所有 24 工具无 session 状态依赖 | 代码审查 |
| 6 | PromptValidator 迁移 | bilingual forbidden patterns 已集成到 Reviewer prompt 模板 | prompt 模板 diff |
| 7 | commit_rule 行为兼容 | 守卫检查生效（未 staging 规则被拒绝 + 正确错误信息）、skip_guard 绕过验证、现有调用方兼容 | pytest（3 个用例） |

---

### Phase 5: 文档完善（1 周，贯穿全程）

**目标**：确保每个系统有清晰的设计文档、使用文档和架构说明。

#### 3.5.1 文档清单

| 文档 | 位置 | 内容 | 类型 |
|------|------|------|------|
| 架构总览 | `docs/architecture-overview.md` | 三个系统的职责和交互 | overview |
| Watchdog 设计 | `docs/watchdog-design.md` | Interceptor/Observer/Checkpoint 详细设计 | design |
| Ralph Loop 扩展 | `docs/ralph-loop-semantic-review.md` | 语义审查机制 | design |
| MCP 工具参考 | `docs/mcp-tools-reference.md` | 24 个工具的完整文档 | reference |
| 质量保障指南 | `docs/quality-assurance-guide.md` | 如何确保产出质量 | guide |
| 开发者指南 | `docs/developer-guide.md` | 如何扩展规则、添加检查项 | guide |

#### 3.5.2 产出物
- 6 份核心文档
- README 更新（版本号、工具数、结构描述与实际一致）
- CHANGELOG 更新

#### 3.5.3 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 文档覆盖率 | 每个公开工具/API 有文档 | 文档审查 |
| 2 | 架构图准确性 | 与代码实现一致 | 交叉验证 |
| 3 | README 一致性 | 版本号、工具数、结构描述与实际一致 | 自动化检查 |

---

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

**术语定义**：fail-open = 检查失败时放行（安全性让步于可用性）；fail-closed = 检查失败时阻止（可用性让步于安全性）；fail-open for current call, fail-closed at gate = 当前操作放行（fail-open），但违规记录在审计日志中，后续 Checkpoint 阶段推进时阻止（fail-closed）。Observer 和 Reviewer 采用此模式。

| 层 | 操作 | 最大耗时 | 超时行为 |
|----|------|----------|----------|
| 同步 | Interceptor evaluate() | 5ms | 超时 → 跳过规则（fail-open） |
| 同步 | Observer handle() | 20ms | 超时 → 记录 `OBSERVER_TIMEOUT` 审计事件（severity=block）+ 记录警告，不阻塞当前操作。fail-open for current call, fail-closed at gate（见防御闭环设计）。 |
| 异步 | Checkpoint 审计日志检查 | 50ms | 超时 → 阻止阶段推进（fail-closed） |
| 异步 | Reviewer subagent 审查 | 60s | 超时 → 报告 H 级 finding |
| 异步 | 测试运行（主 Agent 执行） | Reviewer 检查周期 | Reviewer 下轮发现 TEST_RUN_REQUESTED 无 TEST_RUN_COMPLETE → H 级 finding |

**防御闭环设计**：Observer 超时时写入 `OBSERVER_TIMEOUT` 审计事件（severity=block）。Checkpoint 在阶段推进时检查审计日志中的 `OBSERVER_TIMEOUT` 事件。若存在未恢复的 Observer 超时，阻止阶段推进（fail-closed）。这填补了"Observer 超时 → 无违规记录 → Checkpoint 放行"的 bypass 路径。

**OBSERVER_TIMEOUT 解决路径**：(1) 后续 Observer 成功执行时自动 resolve 前次 OBSERVER_TIMEOUT（在 handle() 开头检查是否存在未恢复的 OBSERVER_TIMEOUT 并标记 resolved）；(2) 若整个阶段无后续调用，OBSERVER_TIMEOUT 保持 block 状态并阻止阶段推进。开发者需：(1) 重新执行工具调用以触发 Observer 成功执行（自动 resolve），或 (2) 标记阶段为 failed（记录未解决违规原因）。OBSERVER_TIMEOUT 不提供"推进即恢复"路径——fail-closed at gate 原则要求显式恢复。

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

**审计日志管理策略**：每个 pipeline run 使用独立审计日志；Checkpoint 阶段推进时将违规标记为 resolved；`getUnresolvedViolations()` 仅查询当前阶段未解决条目，避免日志无限增长影响查询性能。当审计日志发生轮转时（`audit` → `audit-2`），`getUnresolvedViolations` 必须扫描所有轮转 key（`audit`、`audit-2`、...）。实现：`PipelineStore.getUnresolvedViolations()` 内部枚举 `audit*` key 前缀并合并结果。最大轮转数：10（audit-1 到 audit-10）。超过 10 个 key 时停止扫描并写入 warn 级审计事件 `AUDIT_ROTATION_LIMIT_EXCEEDED`。

**违规解决机制**：`getUnresolvedViolations(severity)` 查询审计日志中 severity 匹配且未标记 resolved 的条目。解决方式：Checkpoint 阶段推进成功时，自动将当前阶段所有 block 级违规标记为 `resolved: true`（更新原条目 `resolved: true` + `resolvedAt` 字段（upsert 语义：存在则更新，不存在则忽略））。对于 OBSERVER_TIMEOUT：后续 Observer 成功执行（无超时）自动 resolve 前次 OBSERVER_TIMEOUT（在 handle() 开头检查是否存在未恢复的 OBSERVER_TIMEOUT 并标记 resolved）。

**COMMAND_FAILED / SYNTAX_ERROR_POST_WRITE 自动恢复**：对于 COMMAND_FAILED：后续同命令成功执行（精确匹配 `args.command` 完整字符串）时自动 resolve 前次 COMMAND_FAILED。对于参数不同的命令变体（如 `pytest -x` vs `pytest -v`），视为不同命令，各自维护违规状态。对于 SYNTAX_ERROR_POST_WRITE：后续同文件成功写入（语法检查通过）时自动 resolve 前次 SYNTAX_ERROR_POST_WRITE。实现：Observer handle() 开头检查审计日志中是否存在当前 tool/文件 的未解决 block 级违规，若当前调用成功则标记 resolved。

`getUnresolvedViolations` 仅返回 `resolved !== true` 的条目。

### 4.5 规则配置机制

#### 配置文件
位置：`.watchdog/rules.json`（项目级）或 `~/.watchdog/rules.json`（用户级）

**与现有配置的关系**：`rule-config.ts`（Phase 1 新建）管理 Observer/Checkpoint 行为规则，从 `.watchdog/rules.json` 加载。`watchdog-config.ts`（现有）管理 Watchdog 整体配置（phase 序列、观察模式等），从 `.opencode/watchdog.jsonc` 加载。两者职责不重叠、文件不冲突。长期目标（Phase 5+）：合并为统一配置。

**RuleConfig 接口规范**（`packages/watchdog/src/rule-config.ts`，Phase 1 新建）：

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

interface RulesFile {
  version: 1;
  rules: Record<string, RuleConfig>;
  // observer 顶层字段已移除，统一通过 rules.X.enabled 控制
}

class RuleConfigLoader {
  private static cache: RulesFile | null = null;  // 假设 Watchdog 运行在单项目上下文（一个 OpenCode 实例 = 一个项目）。若支持多项目，缓存需改为 `Map<projectId, RulesFile>`。
  private static cacheKey: string | null = null;

  /** Load rules from file (cached per file path). Returns default if file missing. */
  static load(ruleName: string): RuleConfig;

  /** Force reload (for testing). */
  static invalidateCache(): void;
}
```

默认值策略：文件不存在 → 使用内置默认值（不打印警告）；文件格式错误 → 使用默认值 + 打印警告。

```json
{
  "version": 1,
  "rules": {
    "SYNTAX_CHECK_POST_WRITE": {
      "enabled": true,
      "severity": "block",
      "extensions": [".json", ".ts", ".tsx", ".yaml", ".yml"]
    },
    "COMMAND_RESULT_CHECK": {
      "enabled": true,
      "severity": "warn",
      "ignoreExitCodes": [1, 130],  // 1=通用错误(grep无匹配/diff有差异), 130=SIGINT
      "ignoreCommands": ["git log*", "man *"]
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
- 缓存策略：Watchdog 启动时加载一次并缓存至内存，Observer handle() 内多次调用 `RuleConfigLoader.load()` 读缓存不读磁盘

---

## 5. 关键里程碑

| 里程碑 | 预期时间 | 验收标准 | 量化门槛 |
|--------|----------|----------|----------|
| M1: 机械验证上线 | Phase 1 结束 | Bash 失败检出 ≥95%，误拦截 ≤5%，语法拦截 100% | 通过 e2e + 回归测试 |
| M2: 测试门控上线 | Phase 2 结束 | 测试请求记录 100%，Reviewer 检出 100% | 通过 e2e + 集成测试 |
| ~~M3: 语义审查上线~~ | ~~Phase 3~~ | ~~S/B/A 提交正常~~ | ~~待定 — 非当期范围~~ |
| M3: intervention 合并 | Phase 4 结束 | 保留测试全通过，目录已清除，24 工具 | pytest + ls |
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
├─ Aristotle MCP (20 工具)         ├─ Aristotle MCP (24 工具 + KI + 回滚，全部无状态)
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
4. ✅ 操作统一入口 → **Aristotle MCP 24 工具（全部无状态）**
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
| F-02 | **High** | 所有 appendAudit 调用从单参数对象改为 3-param 签名 `(projectId, runId, entry)`，添加 `const { projectId, runId } = this.cache.getActiveRun()` 注释 | 3.1.1, 3.2.1 |
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
| F-11 | Medium | ignoreExitCodes 默认值从 `[130]` 改为 `[1, 130]` + 注释说明 | 4.5 |
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
| F-29 | Low | extractExitCode fallback 策略变更：先 fallback=0（fail-open）收集数据，≥95% 命中率后切换 fallback=1 | 3.1.1 |
| F-28 | Info | reload_config 从"Phase 4 可通过 tdd_checkpoint"改为"未来可扩展，当前未列入任何 Phase 产出物" | 4.5 |
| F-32 | Info | Phase 3 AC 表格顶部添加"⚠️ 标注项目仅 Schema v5 后可验证，未标注为当期可执行" | 3.3.7 |

**Pass 12 Round 7 结论**: 24 findings（2H + 13M + 9L）全部修复。核心发现：

1. **Observer 代码示例与实际接口持续分歧**（F-01，RC-1 第 4 轮）：前 3 轮修复仅添加 prose notes 而未更新代码示例本身。本次直接更新所有 6 处 appendAudit 调用，添加 decision/severity/sessionId/phase 字段，并在代码块顶部添加 Phase 1 目标接口说明头。

2. **Phase 边界混淆导致依赖矛盾**（F-02，RC-6）：§3.1.2 依赖列表中 typescript 被列为 Phase 1 运行时依赖，但 §3.1.1 quickSyntaxCheck 和 F-09 修改已明确 Phase 1 不引入 typescript。修复：用 strikethrough 标记 + 决策说明。

3. **防御编程不足**（F-06, F-12, F-19）：字符串匹配错误类型（F-06）、过宽的 catch-all（F-12）、无大小限制的 JSONL 写入（F-19）。修复：分别改用 instanceof 检查、缩窄 catch 范围、添加 PIPE_BUF 限制。
