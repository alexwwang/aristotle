# Watchdog 开发进度追踪

**最后更新**: 2026-05-23
**当前分支**: `phase0-core-extraction` (已推送到 `origin/phase0-core-extraction`)

---

## 相关文档索引

所有文档位于 `local-assets` 分支的 `design_plan/` 目录下。

### 需求与规格文档

| 文档 | 路径 | 说明 |
|------|------|------|
| PRD（产品需求文档） | [`PRD-opencode-agent-platform.md`](./PRD-opencode-agent-platform.md) | 整体产品需求定义 |
| TechSpec（技术规格） | [`TechSpec-opencode-agent-platform.md`](./TechSpec-opencode-agent-platform.md) | 平台技术架构规格（Phase 0-5 全局） |
| Phase 2 需求清单 | [`Phase2-Requirements.md`](./Phase2-Requirements.md) | Phase 2 Active Monitoring 的用户故事与验收标准 |

> **文档结构说明**：Phase 2 引入了正式的 TDD Pipeline 流程，因此有独立的三层文档结构（Requirements → Product Design → TestPlan）。Phase 0 和 Phase 1 在引入该流程之前完成，没有独立的 Requirements 文档——它们的需求定义嵌在 PRD 和 TechSpec 对应章节中，设计文档直接作为技术实现规格使用。

### Phase 设计文档（按阶段）

| 文档 | 路径 | 说明 |
|------|------|------|
| Phase 0 设计文档 | [`Phase0-Core-Extraction.md`](./Phase0-Core-Extraction.md) | Core 提取架构设计 |
| Phase 1 设计文档 | [`Phase1-Watchdog-StateMachine.md`](./Phase1-Watchdog-StateMachine.md) | 状态机 + Checkpoint 工具设计 |
| Phase 2 设计文档 | [`Phase2-ActiveMonitoring.md`](./Phase2-ActiveMonitoring.md) | Active Monitoring 完整设计（v1.8，已冻结） |

### Phase 2 子模块设计文档

Phase 2 设计文档经过 Oracle 设计审核后冻结（R3 C=0/H=0），拆分为以下子文档：

| 文档 | 路径 | 说明 |
|------|------|------|
| Module A — Event Observation | [`Phase3-ModuleA.md`](./Phase3-ModuleA.md) | Observer + SessionBuffer 设计 |
| Module B — File Interception | [`Phase3-ModuleB.md`](./Phase3-ModuleB.md) | Interceptor + FileClassifier + Rules 设计 |
| Module C — Articulation Validation | [`Phase3-ModuleC.md`](./Phase3-ModuleC.md) | Articulation validator + degradation 设计 |
| Shared Infrastructure | [`Phase3-Shared.md`](./Phase3-Shared.md) | PipelineStateCache + PipelineStore 扩展 |
| Schema Contract + Semantic Assertion | [`Phase3-SchemaContract-SemanticAssertion.md`](./Phase3-SchemaContract-SemanticAssertion.md) | 类型契约与语义断言 |

### 测试计划文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 全局测试计划 | [`TestPlan-opencode-agent-platform.md`](./TestPlan-opencode-agent-platform.md) | 平台整体测试策略 |
| Phase 0 测试计划 | [`TestPlan-Phase0-Core-Extraction.md`](./TestPlan-Phase0-Core-Extraction.md) | Core 提取阶段测试计划 |
| Phase 2 测试计划 | [`Phase3-TestPlan.md`](./Phase3-TestPlan.md) | Active Monitoring 测试计划（v1.2.1，已冻结） |

### 审核记录文档

| 文档 | 路径 | 说明 |
|------|------|------|
| Phase 0 第三轮审核 | [`ThirdRoundReview-Phase0.md`](./ThirdRoundReview-Phase0.md) | Phase 0 完成后的独立审核记录 |
| Phase 2 设计文档审核 | 包含在 [`Phase2-ActiveMonitoring.md`](./Phase2-ActiveMonitoring.md) §22-23 | Oracle 架构审核 + Ralph 循环审核日志 |
| Phase 2 代码审核 | 记录在 `CHANGELOG.md`（主仓库） | 审计追踪表（21+ 轮审核） |

---

## 整体需求分期

整个 Watchdog 需求共 **6 期**（Phase 0 ~ Phase 5），隶属于 `@opencode-ai/watchdog` 包，是 OpenCode Agent Platform 的一部分。

| Phase | 名称 | 状态 | 测试 | 关键交付物 |
|-------|------|------|------|-----------|
| **Phase 0** | Core 提取 | ✅ 完成 | 150 tests | `packages/core` + `packages/reflection` + `plugin/` 架构，从旧 Python 代码库提取 TypeScript 包 |
| **Phase 1** | 状态机 + Checkpoint 工具 | ✅ 完成 | 319 tests | 10 事件状态机、`tdd_checkpoint` 工具、PhaseRecord、Ralph loop、14 轮 ds4f 审核 |
| **Phase 2** | Active Monitoring | ✅ 完成 | 552 tests | 拦截器(Module B)、观察者(Module A)、Articulation 验证(Module C)、SessionBuffer、multi-agent 防御 |
| **Phase 2.3** | P Severity Addition | 🔄 进行中 | 37+9 tests planned | SEV_ORDER 添加 P、L bug fix、迁移守卫、downgrade_reason |
| **Phase 3** | Escalation + Idle Monitoring | 🔲 未开始 | — | Ralph loop escalation 检测、`onIdle` handler 异步通知、escalation 双通道机制 |
| **Phase 4** | Aristotle 集成 | 🔲 未开始 | — | `PROCESS_VIOLATION` 错误类别、audit log reader、reflection prompt 包含 Watchdog 上下文 |
| **Phase 5** | 安装体验 | 🔲 未开始 | — | 更新 `install.sh` / `install.ps1`、README 覆盖双角色 |

### 当前进度

```
Phase 0 ████████████████████ 100%
Phase 1 ████████████████████ 100%
Phase 2 ████████████████████ 100%
Phase 2.3 ██████████░░░░░░░░░░  50%  ← 当前位置 (Phase 3 GATE PASSED, Phase 4 in progress)
Phase 3 ░░░░░░░░░░░░░░░░░░░░   0%
Phase 4 ░░░░░░░░░░░░░░░░░░░░   0%
Phase 5 ░░░░░░░░░░░░░░░░░░░░   0%

总体完成度: 50% (Phase 2 完成, Phase 2.3 进行中)
```

### Phase 2.3 子阶段：P Severity Addition

Phase 2.3 在 Phase 2 完成的基础上，为 watchdog 添加 P (Pattern) severity level，修复 L 被错误包含在 consecutiveZero 中的 bug。

| 文档 | 路径 | 说明 |
|------|------|------|
| Phase 2.3 需求文档 | [`Phase2.3-P-Severity-Addition-Requirements.md`](./Phase2.3-P-Severity-Addition-Requirements.md) | 18 ACs, 12 Constraints |
| Phase 2.3 技术方案 | [`Phase2.3-P-Severity-Addition-TechnicalSolution.md`](./Phase2.3-P-Severity-Addition-TechnicalSolution.md) | C1–C11 设计组件 |
| Phase 2.3 测试计划 | [`Phase2.3-P-Severity-Addition-TestPlan.md`](./Phase2.3-P-Severity-Addition-TestPlan.md) | v2.15, GATE PASSED (R10+R11) |
| Phase 2.3 测试复审日志 | [`Phase2.3-P-Severity-Addition-TestPlan-ReviewLog.md`](./Phase2.3-P-Severity-Addition-TestPlan-ReviewLog.md) | R1–R11 (201 raw findings) |
| KI 追踪 | [`KnownIssues-Watchdog.md`](./KnownIssues-Watchdog.md) | KI-26 promoted to Active/Medium |

### Phase 2.3 TDD Pipeline 进度

| Phase | 名称 | 状态 | 说明 |
|-------|------|------|------|
| Phase 1 | Product Design | ✅ 完成 | Requirements Document |
| Phase 2 | Technical Solution | ✅ 完成 | TechnicalSolution Document |
| Phase 3 | Test Plan | ✅ GATE PASSED | v2.15, R10+R11 连续零 C/H/M, 37 it() blocks 已实现 |
| Phase 4 | Test Code | 🔄 进行中 | 9 planned TCs 待实现 + KI-26 测试 |
| Phase 5 | Business Code | 🔲 未开始 | 源码实现 + 188 test sites 适配 |
| Phase 6 | Pre-Release Testing | 🔲 未开始 | — |
| Phase 7 | System Quality Audit | 🔲 未开始 | — |

### Phase 2.3 测试覆盖

| 指标 | 值 |
|------|-----|
| 已实现 it() blocks | 37 (30 transitions + 7 pipeline-store) |
| Phase 4 planned TCs | 9 (TC-38, TC-39, TC-40, TC-40b, TC-41, TC-42, TC-43, TC-44, TC-21g) |
| Phase 4 完成后总数 | 46 |
| KI-26 额外测试 | 1 (downgrade_reason empty string) |
| Phase 5.5 适配 | 188 test sites (KI-68) |

### Phase 2.3 审核统计

| 审核阶段 | 轮数 | 结果 |
|----------|------|------|
| Phase 3 Test Plan Review (R1–R11) | 11 valid rounds | 201 raw → 15 M/H + ~26 P/L adopted, GATE PASSED |
| 协议违规/作废轮次 | R4-R6 (inline precision), R8+R9 biased | 所有更改已恢复/作废 |

---

## Phase 2 完成度详情

### 模块实现

| Spec 模块 | 源文件 | 状态 |
|-----------|--------|------|
| Module A: Event Observation | `observer.ts`, `session-buffer.ts` | ✅ |
| Module B: File Interception | `interceptor.ts`, `path-extractor.ts`, `file-classifier.ts`, `intercept-rules.ts` | ✅ |
| Module C: Articulation Validation | `articulation.ts`, `transitions.ts` 扩展 | ✅ |
| Core: Plugin Registration | `registration.ts` | ✅ |
| Core: StateStore | `state-store.ts` | ✅ |
| Shared: PipelineStateCache | `state-cache.ts` | ✅ |
| Shared: PipelineStore | `pipeline-store.ts` | ✅ |
| Config: WatchdogConfig | `watchdog-config.ts` | ✅ |
| Wiring: index.ts | `index.ts` | ✅ |
| Schema: type extensions | `schema.ts` | ✅ |

### 验收标准 (AC) 覆盖

| AC | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| AC-1 | Observer 检测 Task 调用并记录 `_reviewer_spawned` | Core | ✅ |
| AC-2 | `ralph_round_complete` 验证 reviewer 存在；degradation 时跳过 | Core | ✅ |
| AC-3 | Phase 4 business code 无条件 block；Phase 5 需 Phase 4 gate | Core | ✅ |
| AC-4 | Phase N+1 deliverable 需 Phase N Ralph+approval gate | Core | ✅ |
| AC-5 | 3维度 articulation 验证 + degradation counter(3次降级) | Core | ✅ |
| AC-6 | Articulation 是 soft gate，不阻止 ralph_round_complete | Core | ✅ |
| AC-7 | Degradation 历史标记持久化 | Secondary | ✅ |
| AC-8 | 无 active pipeline 时所有 hook 静默返回 | Core | ✅ |
| AC-9 | Articulation 结果持久化到 PipelineState | Core | ✅ |
| AC-10 | 无 pipeline 时 SessionBuffer 记录所有 tool 调用 | Secondary | ✅ |

### 测试覆盖

| 指标 | 值 |
|------|-----|
| 测试文件 | 17 个 |
| 测试用例 | 552 pass |
| 源文件 | 18 个 |
| 测试:源文件比 | 0.94:1 |

### 审核统计

| 审核阶段 | 审核者 | 轮数 | 最终 C/H |
|----------|--------|------|---------|
| Phase 1 R1-R14 | ds4f | 14 | 0/0 (连续5轮清零) |
| Council 审计 | 3 模型 | 1 | 0/0 (2/3 超时，doubao 2C+1H 全部推翻) |
| 三 Oracle 回归 | Oracle-1/2/3 | 1 | 0/0 |
| Oracle-K26/DS4F Ralph | 双模型并行 | 2 | 0/0 |
| Oracle-DS4F 独立 Ralph | 单模型 | 2 | 0/0 |
| Oracle 独立审核 | ora-52 | 1 | 0/0 (4M 全部修复) |
| **总计** | — | **21+** | **C=0, H=0** |

### Spec 合规偏差（已记录并接受）

| 偏差 | 性质 | 说明 |
|------|------|------|
| `articulationFailures` 持久化 vs spec "in-memory only" | 正向偏差 | 更保守，防 gaming |
| `readLog` 返回 `T[]` vs spec `string[] \| null` | 正向偏差 | 更有用 |
| `intercept-rules.ts` 用 `id` vs spec `name` | 命名差异 | 无功能影响 |
| `isDegraded` round 参数可选 vs spec 必填 | 扩展 | 不破坏契约 |
| `write()` / `appendLog()` 静默吞错 | tech debt | 发生概率极低 |

---

## Phase 3 前向预留

Phase 2 代码中已为 Phase 3 做了多处预留：

- `RalphTermination` 已包含 `'escalated'`（`schema.ts`）
- `RalphLoopState` 已有 `escalated: boolean` + `escalatedAt: string | null`
- `transitions.ts` 中 `ralph_round_complete` 已有 TODO 注释标记 Phase 3 实现 escalated 逻辑
- `user_approval` 已有 escalation 双检查（`ralph.escalated || ralphTermination === 'escalated'`）
- `observer.ts` 已有 `onIdle` 相关的 session 数据收集（SessionBuffer）
- `registration.ts` 已支持 `onIdle` handler
- `escalation/` 目录占位已在 TechSpec 中规划

---

## Commit 历史（按 Phase 分组）

### Phase 0：Core 提取 (12 commits, 05-03 ~ 05-12)

| Hash | 描述 |
|------|------|
| `16a491c` | tool: dp-save.sh 同步脚本 |
| `5ed4296` | tool: 简化 dp-save.sh 用 worktree |
| `baaa8fb` | tool: dp-save.sh 加 --restore |
| `3b8cd2e` | reflector: R1d subagent 归属验证 |
| `61b9e58` | fix: 回归测试脚本 + Phase 0 文档 |
| `fccdd9a` | **feat(phase0): 实现 core + reflection 包** |
| `9d0b3ce` | fix: await async createAristotleRole |
| `a55c1f3` | fix: zod 依赖 ^3→^4 |
| `28da163` | fix: 匹配 OpenCode session.idle 格式 |
| `e2a1fba` | docs: 测试计数 148→150 |
| `bc3b660` | build: externalize zod |
| `8382d2c` | refactor: 归档旧 bridge 代码 |

### Phase 1：状态机 + Checkpoint (4 commits, 05-13)

| Hash | 描述 |
|------|------|
| `9ed737c` | **feat(watchdog): 实现 Phase 1 状态机 + checkpoint 工具** |
| `8bb9abc` | refactor: 重命名包 |
| `3b123dd` | fix: R1/R2 审核 3H+10M |
| `9ca7310` | fix: R3 审核 6M |

### Phase 2：Active Monitoring (17 commits, 05-15 ~ 05-17)

| Hash | 描述 |
|------|------|
| `a2194f8` | **feat(watchdog): 实现 Phase 2 Active Monitoring** |
| `5333973` | fix: 按设计文档对齐重建代码 |
| `2df3958` | test: schema 契约 + 语义断言测试 |
| `c80e39c` | fix: ObservationEntry 类型 |
| `c0dfe8b` | fix: mock 构造函数兼容 Vitest v4 |
| `0448f48` | feat: Phase 2 组件接入 index.ts |
| `c9dabe1` | feat: registration.ts 全局钩子 |
| `227646a` | feat: detectMultiAgent + 钩子测试 |
| `c0499e8` | test: first-throw-wins 断言 |
| `860356b` | test: callID 转发 |
| `5d092ab` | test: ownership 测试 |
| `543fbc3` | fix: detectMultiAgent 属性读取 |
| `991bebf` | fix: **R6 C-1** 所有权检查顺序 |
| `3681c2f` | refactor: hasOwner 类型守卫 |
| `ba994c5` | fix: 阻止 sub-agent stale restart |
| `3ca4f69` | fix: corrupted state fail-closed |
| `a16ce76` | test: TC-C-41b/45/46 |
| `9a51433` | **fix: Phase 5 多轮审核汇总修复** |

### Phase 3 设计文档 (9 commits, 05-12 ~ 05-16)

| Hash | 描述 |
|------|------|
| `fc6157b` | docs: Phase 0-3 设计文档 |
| `2a58070` | docs: §5.5a 所有权防御 |
| `94c93a8` | docs: §5.5a H-1/H-2/M-1~M-5 |
| `4a38eac` | docs: §5.5a **冻结** (R3 C=0/H=0) |
| `55dc65e` | docs: §5.5a ora-24 审核 |
| `c6738d6` | docs: §5.5a H/M/L 修复 |
| `a2c8222` | docs: §5.5a stale counts + hasOwner |
| `9a8b04f` | docs: §5.5a Oracle R1 |
| `1e3f93f` | docs: §5.5a L 级精修 + 最终冻结 |

### 清理 (3 commits, 05-17)

| Hash | 描述 |
|------|------|
| `9a51433` | chore: remove dp-save.sh + gitignore |
| `0af526d` | chore: aristotle-bridge gitignore 更新 |
| `c029b73` | chore: untrack plugin/dist/index.js |

---

## 代码库现状

```
aristotle/
├── packages/
│   ├── core/           ← 基础设施（StateStore, Logger, registration, config）
│   ├── reflection/     ← Aristotle 反射角色（idle-handler, executor, tools）
│   └── watchdog/       ← TDD Watchdog 角色（interceptor, observer, checkpoint）
│       ├── src/        ← 18 个源文件
│       └── test/       ← 15 个测试文件 (552 tests)
├── plugin/             ← OpenCode plugin 构建入口（单数）
│   ├── index.ts        ← assemblePlugin(aristotleRole, watchdogRole)
│   └── dist/           ← gitignore, 不推送到远端
├── plugins/            ← 历史遗留（复数）
│   └── aristotle-bridge/  ← 已废弃，功能已迁移到 packages/
└── aristotle_mcp/      ← Python MCP server（Aristotle 服务端）
```
