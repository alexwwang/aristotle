# Pass 1 Fixes — 质量保障实施方案修改方案

**状态**: Pass 1 Fixes  
**审阅者**: Reviewer (主 Agent)  
**基于**: Pass 1 Findings + Precision Pass + Explore Agent 技术分析  
**日期**: 2025-05-29

---

## 修改概要

对 `quality-assurance-implementation-plan.md` 的 12 个 confirmed findings，逐一给出修改方案。  
每个 fix 标注：影响范围、修改内容、与整体的相容性。

---

## C-1 Fix: 添加量化验收标准

**问题**: 方案无量化验收标准，无法客观判断 Phase 是否达标。  
**影响范围**: Section 3（所有 Phase）+ Section 6（里程碑）

**修改方案**:

在每个 Phase 的产出物列表后增加 **验收标准** 小节：

```markdown
### Phase 1 验收标准
| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | JSON 语法拦截率 | 100%（写入无效 JSON 必被拦截） | e2e 测试：发送 10 个无效 JSON，全部被拦截 |
| 2 | Bash 失败检出率 | ≥95%（exit code ≠ 0 的命令被标记） | 回归测试：运行 20 个失败命令，统计检出率 |
| 3 | 误拦截率 | ≤5%（合法操作被错误阻止） | e2e 测试：执行 50 个合法操作，统计误拦截 |
| 4 | Interceptor 响应时间 | <10ms（P99） | 性能基准测试 |
| 5 | Observer 响应时间 | <50ms（P99） | 性能基准测试 |

### Phase 2 验收标准
| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 测试触发率 | 100%（Phase 5 业务代码写入后自动触发） | e2e 测试 |
| 2 | 测试超时 | 30s 硬限制 | 单元测试 |
| 3 | 失败阻止率 | 100%（测试失败 → 阻止阶段推进） | e2e 测试 |
| 4 | 测试结果报告 | 包含：通过/失败数、失败详情、错误摘要 | 输出格式验证 |

### Phase 3 验收标准
| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | Reviewer prompt 覆盖 | S/B/A 三维度各有 ≥5 个检查项 | 检查清单评审 |
| 2 | Finding 提交 | 新增 S/B/A severity 通过 ralph_round_finding 提交 | 集成测试 |
| 3 | 误报率 | ≤20%（S/B/A finding 中误报比例） | 人工抽样评审 |
| 4 | Schema 兼容 | v4 状态文件在 v5 下正常读取 | 迁移测试 |

### Phase 4 验收标准
| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 功能等价 | 合并后 MCP 工具覆盖 intervention 所有公开方法 | 接口对照表 |
| 2 | 测试保留 | 所有 intervention 测试（243 个）在合并后通过 | pytest 全量 |
| 3 | 目录清除 | intervention/ 目录不存在 | ls 验证 |
| 4 | MCP 工具数 | ≥24（20 现有 + 4 合并） | 工具清单 |

### Phase 5 验收标准
| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 文档覆盖率 | 每个公开工具/API 有文档 | 文档审查 |
| 2 | 架构图准确性 | 与代码实现一致 | 交叉验证 |
| 3 | README 一致性 | 版本号、工具数、结构描述与实际一致 | 自动化检查 |
```

**里程碑表更新**（Section 6）：

```markdown
| 里程碑 | 时间 | 验收标准 | 量化门槛 |
|--------|------|----------|----------|
| M1: 机械验证上线 | Phase 1 结束 | Bash 失败检出 ≥95%，误拦截 ≤5% | 通过 e2e + 回归测试 |
| M2: 测试门控上线 | Phase 2 结束 | 测试触发 100%，失败阻止 100% | 通过 e2e 测试 |
| M3: 语义审查上线 | Phase 3 结束 | S/B/A 提交正常，误报 ≤20% | 通过集成 + 抽样评审 |
| M4: intervention 合并 | Phase 4 结束 | 243 测试全通过，目录已清除 | pytest + ls |
| M5: 文档完善 | Phase 5 结束 | 6 份文档完成，README 一致 | 文档审查 |
```

**相容性**: 无冲突。纯增量添加。

---

## C-2 Fix: 添加规则配置机制

**问题**: 方案中 Interceptor/Observer 规则全部硬编码，无法按项目调整。  
**影响范围**: Section 3.1.1（Phase 1）、Section 3.2.1（Phase 2）

**修改方案**:

在 Section 4（架构设计原则）之后新增 Section 4.5：

```markdown
### 4.5 规则配置机制

#### 配置文件
位置：`.watchdog/rules.json`（项目级）或 `~/.watchdog/rules.json`（用户级）

```json
{
  "version": 1,
  "rules": {
    "SYNTAX_CHECK_BEFORE_WRITE": {
      "enabled": true,
      "severity": "block",
      "extensions": [".json", ".ts", ".tsx", ".yaml", ".yml"]
    },
    "COMMAND_RESULT_CHECK": {
      "enabled": true,
      "severity": "warn",
      "ignoreExitCodes": [130],
      "ignoreCommands": ["git log*", "man *"]
    },
    "TESTS_MUST_PASS_IN_GREEN_PHASE": {
      "enabled": true,
      "severity": "block",
      "timeout": 30000,
      "testCommand": "auto"
    },
    "AC-3_BUSINESS_CODE_GATE": {
      "enabled": true,
      "severity": "block"
    },
    "AC-12_PHASE_GATE": {
      "enabled": true,
      "severity": "block"
    }
  },
  "observer": {
    "bashResultCheck": true,
    "fileWriteValidation": true
  }
}
```

#### 优先级
1. 项目级 `.watchdog/rules.json`（最高）
2. 用户级 `~/.watchdog/rules.json`
3. 内置默认值（最低）

#### 规则启用/禁用
- `enabled: false` → 规则跳过，不执行 evaluate
- `severity: "warn"` → 记录但不阻止
- `severity: "block"` → 记录并阻止操作

#### 配置校验
- Watchdog 启动时读取并校验 rules.json
- schema 不匹配 → 使用默认值 + 打印警告
- 运行时重新加载：不支持（需重启 OpenCode 会话）
```

**Phase 1 代码更新**：

```typescript
// 原来的硬编码：
// if (path.endsWith('.json')) { ... }

// 改为配置驱动：
const config = RuleConfig.load('SYNTAX_CHECK_BEFORE_WRITE');
if (!config.enabled) return { blocked: false };
if (!config.extensions.some(ext => path.endsWith(ext))) return { blocked: false };
// ... 执行检查
```

**相容性**: 无冲突。配置层是纯加法，不影响现有逻辑。

---

## H-2 Fix: Phase 3 补充实施细节

**问题**: Phase 3 只列了"扩展 Reviewer 检查项"和"prompt 文本"，缺乏：
- Reviewer 如何被调度（谁触发？什么时候？）
- Finding 如何回传（通过什么机制？）
- S/B/A severity 如何映射到 checkpoint 事件？
- 与 tdd-pipeline skill 的接口是什么？

**影响范围**: Section 3.3（Phase 3）

**修改方案**: 重写 Phase 3 为：

```markdown
### Phase 3: Ralph Loop 语义审查扩展（3 周）

**目标**：让 Reviewer subagent 不仅检查代码质量，还检查语义正确性、业务逻辑一致性。

#### 3.3.1 调度机制（何时触发语义审查）

语义审查发生在 Ralph Loop 的 Reviewer round 中，由主 Agent 通过 Task tool 派发。

**触发条件**：
- Ralph Loop 每轮都会 spawn Reviewer subagent
- Reviewer subagent 的 prompt 中已包含语义审查指引
- 无需新的触发条件，复用现有 ralph_round_finding 事件

**调用流程**：
```
1. Ralph Loop 进入 round N
2. 主 Agent 调用 Task(category="quick", prompt="<reviewer prompt>")
   → Observer 记录 REVIEWER_SPAWNED
3. Reviewer subagent 执行审查（含 S/B/A 检查）
4. Reviewer 返回 findings 文本给主 Agent
5. 主 Agent 调用 tdd_checkpoint(event="ralph_round_finding", 
   finding={ severity: 'S'|'B'|'A', ... })
6. CheckpointHandler 验证 severity 是否合法
7. 主 Agent 调用 tdd_checkpoint(event="ralph_round_complete")
```

#### 3.3.2 Severity 扩展与 Schema 迁移

**当前**: SCHEMA_VERSION = 4, severity: C/H/M/P/L/I  
**目标**: SCHEMA_VERSION = 5, severity: C/H/M/P/L/I/S/B/A

**迁移策略**（向后兼容）：
```typescript
// schema.ts
export const SCHEMA_VERSION = 5;

// 扩展 severity 类型
export type FindingSeverity = 'C' | 'H' | 'M' | 'P' | 'L' | 'I' | 'S' | 'B' | 'A';

// transitions.ts SEV_ORDER 更新
const SEV_ORDER: Record<string, number> = {
  S: 7,  // Showstopper — 必须修复，否则不能继续
  C: 6,  // Critical
  B: 5,  // Blocker — 阻碍质量达标
  H: 4,  // High
  M: 3,  // Medium
  P: 2,  // Pass
  L: 1,  // Low
  A: 0,  // Acceptable — 信息性，可延后
  I: -1, // Info
};
```

**注意**: S/B/A 不是替代 C/H/M/P/L/I，而是**并存**。  
- C/H/M/P/L/I = 代码质量维度（原有）  
- S/B/A = 语义质量维度（新增）  
- Reviewer 可同时报告两类 severity

**Checkpoint 事件**: 无需新增事件类型。S/B/A severity 通过现有的 `ralph_round_finding` 事件提交。CheckpointHandler 已有的 severity 验证逻辑只需扩展合法值集合。

#### 3.3.3 Reviewer Prompt 扩展

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

### B — 业务逻辑一致性（Blocker 级别）
检查项：
1. 实现是否与需求文档/Issue 描述一致
2. 状态转换是否覆盖了所有合法路径
3. 边界条件是否考虑了业务场景（不仅仅是技术边界）
4. 错误处理是否符合业务预期（不只是技术上的 catch）

### A — 上下文适配性（Acceptable 级别）
检查项：
1. 方案复杂度是否匹配问题规模
2. 是否有更简单的替代方案被忽略
3. 技术选型是否适合项目当前阶段
4. 是否引入了不必要的依赖或抽象

## Finding 提交格式

使用 ralph_round_finding 提交时，severity 字段支持：
- 原有: C, H, M, P, L, I（代码质量）
- 新增: S, B, A（语义质量）
两者可并存，不要用 S/B/A 替代 C/H/M。
```

#### 3.3.4 tdd-pipeline Skill 同步

**位置**: 外部仓库 `github.com/alexwwang/tdd-pipeline`

**需要更新的文件**:
1. `skill/REVIEWER.md` — 增加语义审查 prompt 模板
2. `skill/REFLECTOR.md` — 增加 S/B/A severity 说明
3. `skill/CHECKER.md` — 增加 severity 合法值校验

**接口约定**: 
- Watchdog 是协议执行层（检查 severity 合法性）
- Skill 是协议定义层（定义 severity 语义）
- 改了 skill → 改了 schema → 改了 validation

#### 3.3.5 产出物
- Schema v5 迁移（含向后兼容测试）
- Reviewer prompt 模板更新
- tdd-pipeline skill 文档更新（3 个文件）
- 集成测试：S/B/A finding 通过完整 Ralph Loop 流程
- 文档：`docs/semantic-review-guide.md`
```

**相容性**: 与 TDD agent 分析一致。Schema v4→v5 向后兼容，无破坏性变更。S/B/A 与 C/H/M/P/L/I 并存，不替代。

---

## M-1 Fix: Interceptor 语法检查改为 Observer 实现

**问题**: Interceptor 的 `onToolBefore` 无法获取文件内容（args 只有 path，没有 content）。  
  语法检查必须在 `onToolAfter`（Observer）中执行，因为那时才能读取写入的文件。  
**影响范围**: Section 3.1.1 Phase 1

**修改方案**:

将 `SYNTAX_CHECK_BEFORE_WRITE` 规则从 Interceptor 移到 Observer：

```markdown
#### 3.1.1 Watchdog 机械验证增强（修正）

**Interceptor 规则**（保持 2 个，不新增）：
- AC-3: 业务代码写入门控（原有）
- AC-12: 阶段门控（原有）

**Observer 增强**（新增 2 个检查）：

```typescript
// observer.ts handle() 扩展

// 检查 1: 文件写入后语法验证
if (tool === 'Write' || tool === 'Edit') {
  const filePath = args.file_path || args.filePath;
  const content = args.newString || args.content;
  
  if (filePath?.endsWith('.json') && content) {
    try { JSON.parse(content); } 
    catch (e) {
      await this.store.appendAudit({
        event: 'SYNTAX_ERROR_POST_WRITE',
        violation: `JSON 语法错误: ${e.message}`,
        severity: 'block',  // 写入已完成但标记为违规
      });
      // 注意：Observer 无法阻止已发生的操作
      // 但会在审计日志中记录，供 Ralph Loop 审查
      // 下次 checkpoint 验证时可阻止阶段推进
    }
  }
}

// 检查 2: Bash 命令结果检查
// （同原方案，无变化）
```

**设计说明**：
- Interceptor = 写入**前**拦截，只能基于 path/state 判断
- Observer = 写入**后**验证，可以读取文件内容做深度检查
- 语法错误在 Observer 中发现 → 记入审计日志 → Checkpoint 阶段推进时检查审计日志 → 有未修复的 block 级违规则阻止推进

**这意味着**: 
- 写入操作本身不被阻止（已发生）
- 但阶段推进会被阻止（检查审计日志）
- 这是一种"事后阻止"模式，不是"事前拦截"模式
```

**产出物更新**：
- ~~Interceptor: 4 个规则~~ → Interceptor: 2 个规则（不变）
- Observer: +2 个检查（语法验证 + Bash 结果）
- 新增机制：审计日志 → Checkpoint 门控

**相容性**: 与 Watchdog 架构一致。Interceptor 保持轻量（只做 path/state 判断），Observer 做深度检查。

---

## M-2 Fix: 测试运行改为 Checkpoint 事件触发

**问题**: 测试运行可能耗时 30s+，放在 Interceptor 会阻塞 OpenCode 会话。  
  而且 `runTests()` 在 Interceptor 的 evaluate 中是同步调用，不合理。  
**影响范围**: Section 3.2.1 Phase 2

**修改方案**:

将测试门控从 Interceptor 规则改为 Checkpoint 阶段门控：

```markdown
#### 3.2.1 自动测试门控（修正）

**不在 Interceptor 中运行测试**。改为在 Checkpoint 的 phase_complete 事件中触发。

**机制**：

```typescript
// checkpoint.ts — phase_complete 事件处理扩展

case 'phase_complete':
  if (state.currentPhase === 5) {  // TEST_CODE_PHASE 或 BUSINESS_CODE_PHASE
    // 记录测试运行请求
    await this.store.appendAudit({
      event: 'TEST_RUN_REQUESTED',
      phase: state.currentPhase,
      timestamp: Date.now(),
    });
    
    // 测试运行由主 Agent 负责执行（在 Ralph Loop 的 Reviewer round 中）
    // Watchdog 不直接运行测试，而是：
    // 1. 在 phase_complete 时记录需要测试验证
    // 2. Reviewer subagent 在审查时检查测试结果
    // 3. 如果没有测试证据，报告为 S 级 finding
  }
  break;
```

**实际执行流程**：
```
1. 主 Agent 完成业务代码写入
2. 主 Agent 调用 tdd_checkpoint(event="phase_complete")
3. Checkpoint 记录 TEST_RUN_REQUESTED 到审计日志
4. Ralph Loop 下一轮 → Reviewer 检查审计日志
5. Reviewer 发现 TEST_RUN_REQUESTED 但无 TEST_RUN_COMPLETE
6. Reviewer 报告 S 级 finding: "缺少测试执行证据"
7. 主 Agent 必须运行测试 → 提交测试结果 → 才能通过
```

**为什么不直接运行测试**：
- Watchdog 是 TypeScript 插件，运行在 OpenCode 进程中
- 直接运行 `npm test` 或 `pytest` 会阻塞整个会话
- 测试框架不统一（JS/Python/Go…）Watchdog 不应该硬编码
- 测试运行是**主 Agent 的职责**，Watchdog 只负责**检查是否有证据**

**产出物更新**：
- ~~Interceptor 新增 TESTS_MUST_PASS 规则~~ → 删除
- Checkpoint: 审计日志增加 TEST_RUN_REQUESTED/TEST_RUN_COMPLETE 事件
- Reviewer prompt: 增加"检查测试执行证据"检查项
```

**相容性**: 与 TDD agent 分析一致。测试运行不是 Watchdog 的职责范围，Watchdog 只做合规检查。

---

## M-3 Fix: intervention 合并时状态模型统一

**问题**: intervention/ 是有状态的（ViolationFilter 维护 session 状态），aristotle_mcp/ 是无状态的（每次 tool call 独立）。合并时需统一。  
**影响范围**: Section 3.4 Phase 4

**修改方案**:

在 Phase 4 的合并内容表前增加：

```markdown
#### 3.4.0 合并前置条件

**状态模型统一策略**：

intervention/ 的有状态模块（ViolationFilter、InterventionCoordinator）不直接合并。  
原因：
- MCP 是无状态工具服务器（每个 tool call 独立）
- session 状态应由 OpenCode 会话管理，不是 MCP 管辖范围
- Watchdog（TypeScript 侧）已有 Observer 做 session 级观察

**处理方式**：
| intervention 模块 | 处理方式 | 理由 |
|-------------------|----------|------|
| ViolationFilter (19行) | **删除** | Watchdog Interceptor 已完全覆盖 |
| InterventionCoordinator | **删除** | 协调逻辑由 Watchdog Observer + Ralph Loop 替代 |
| Reflector | **删除** | MCP 无法调用 LLM，由 Ralph Loop Reviewer 替代 |
| PromptValidator | **移到 Ralph Loop** | 作为 Reviewer prompt 的一部分 |
| RollbackEngine | **合并到 MCP** | 转为无状态工具（create_rollback_point, rollback_to_checkpoint） |
| KiDocManager | **合并到 MCP** | 转为无状态工具（write_ki_doc, read_ki_docs） |
| RuleGenerator | **合并到 MCP** | 已有无状态版本，直接替换 |
| CommitGuard | **合并到 MCP** | 转为无状态工具（commit_rule_with_guard） |

**合并后架构**：
- 所有 MCP 工具都是无状态的
- 有状态逻辑全部在 Watchdog（TypeScript 侧）
- MCP 只做 CRUD 操作（读/写/查询规则、KI 文档、回滚点）
```

**相容性**: 消除状态模型冲突。合并后 MCP 保持无状态，有状态逻辑在 Watchdog。

---

## M-4 Fix: Schema 迁移详细方案

**问题**: S/B/A severity 与 TDD schema v4 不兼容，需要明确的迁移方案。  
**影响范围**: Phase 3 + Section 4

**修改方案**: 已包含在 H-2 Fix 中（Schema v4→v5 迁移策略）。额外补充：

```markdown
#### Schema 迁移测试要求

**必须通过的测试用例**：
1. v4 状态文件在 v5 代码下正常加载（无 S/B/A 字段不影响）
2. v5 状态文件中的 S/B/A findings 被正确排序（SEV_ORDER）
3. v4 状态文件不会自动升级为 v5（只读不改）
4. 新创建的状态文件默认为 v5
5. S/B/A findings 在 Ralph Loop 统计中正确计入
```

**相容性**: 与 TDD agent 分析一致。向后兼容，无数据丢失。

---

## M-5 Fix: 同步/异步超时具体值

**问题**: Section 4.2 列了同步/异步分层但缺少具体超时值。  
**影响范围**: Section 4.2

**修改方案**:

在 Section 4.2 的分层图后增加：

```markdown
#### 超时与性能预算

| 层 | 操作 | 最大耗时 | 超时行为 |
|----|------|----------|----------|
| 同步 | Interceptor evaluate() | 5ms | 超时 → 跳过规则（fail-open） |
| 同步 | Observer handle() | 20ms | 超时 → 记录警告，不阻塞 |
| 异步 | Checkpoint 审计日志检查 | 50ms | 超时 → 阻止阶段推进（fail-closed） |
| 异步 | Reviewer subagent 审查 | 60s | 超时 → 报告 S 级 finding |
| 异步 | 测试运行（主 Agent 执行） | 30s | 超时 → 报告 S 级 finding |

**设计原则**：
- 同步操作必须极快（<5ms），否则会阻塞 OpenCode 主循环
- 异步操作有宽松超时，但必须有超时保护
- fail-open 用于非关键检查（语法验证、观察器）
- fail-closed 用于关键门控（阶段推进）
```

**相容性**: 无冲突。纯增量。

---

## L-1 Fix: 文档命名统一

**问题**: Section 3.5.1 的文档命名风格不一致（有的用 `-design`，有的用 `-guide`，有的用 `-reference`）。  
**影响范围**: Section 3.5.1

**修改方案**:

统一命名规范：`{系统}-{类型}.md`

```markdown
#### 3.5.1 文档清单（修正）

| 文档 | 位置 | 命名 | 类型后缀 |
|------|------|------|----------|
| 架构总览 | docs/architecture-overview.md | 系统名-overview | -overview |
| Watchdog 设计 | docs/watchdog-design.md | 系统名-design | -design |
| Ralph Loop 扩展 | docs/ralph-loop-semantic-review.md | 功能名-描述 | -描述 |
| MCP 工具参考 | docs/mcp-tools-reference.md | 系统名-reference | -reference |
| 质量保障指南 | docs/quality-assurance-guide.md | 功能名-guide | -guide |
| 开发者指南 | docs/developer-guide.md | 受众名-guide | -guide |
```

**相容性**: 纯命名调整，无功能影响。

---

## L-2 Fix: Phase 时间估算调整

**问题**: 10 周总工期估算基于乐观假设，未考虑跨 Phase 依赖和外部仓库协调。  
**影响范围**: Section 6 里程碑

**修改方案**:

```markdown
#### 时间估算（修正）

| Phase | 乐观 | 预期 | 悲观 | 说明 |
|-------|------|------|------|------|
| Phase 1 | 1 周 | 2 周 | 3 周 | Observer 增强较简单，但性能测试可能需要调优 |
| Phase 2 | 1 周 | 2 周 | 4 周 | Checkpoint 测试门控需要与 Ralph Loop 集成 |
| Phase 3 | 2 周 | 3 周 | 5 周 | Schema 迁移 + tdd-pipeline skill 同步（外部仓库） |
| Phase 4 | 1 周 | 2 周 | 3 周 | 合并较直接，但 243 测试迁移可能有问题 |
| Phase 5 | 1 周 | 1 周 | 2 周 | 文档编写，风险低 |
| **总计** | **6 周** | **10 周** | **17 周** | 预期值基于中等经验水平 |

**关键路径**: Phase 1 → Phase 2（顺序依赖）  
**可并行**: Phase 3 和 Phase 4（无直接依赖）
```

**相容性**: 无冲突。调整预期不影响实施顺序。

---

## I-1 Fix: 架构图补充 KI/回滚数据流

**问题**: Section 2.1 架构图未显示 KI 文档和回滚的数据流路径。  
**影响范围**: Section 2.1

**修改方案**:

在架构图后增加数据流说明：

```markdown
#### 完整数据流

```
LLM 执行 → Watchdog 拦截/观察
              │
              ├─ 违规 → 审计日志 → Checkpoint 门控（阻止阶段推进）
              │
              └─ 完成阶段 → Ralph Loop Reviewer
                              │
                              ├─ C/H/M finding → 审计日志
                              ├─ S/B/A finding → 审计日志
                              │
                              └─ 需要操作 → Aristotle MCP
                                            │
                                            ├─ 规则写入/查询（_tools_rules.py）
                                            ├─ KI 文档读写（_tools_ki.py）← 新增
                                            ├─ 回滚点创建/回滚（git_ops.py）← 新增
                                            └─ 工作流编排（7 工具）
```

**KI 文档流**: Reviewer 发现 recurring pattern → MCP write_ki_doc → 下次 Reviewer 可查询  
**回滚流**: Watchdog 检测到严重违规 → MCP create_rollback_point → 用户确认后 rollback_to_checkpoint
```

**相容性**: 无冲突。纯补充说明。

---

## I-2 Fix: MCP 工具数验证

**问题**: 合并后声称 28 工具但未逐一验证。  
**影响范围**: Section 3.4

**修改方案**:

在 Phase 4 合并内容后增加工具清单验证表：

```markdown
#### MCP 工具清单（合并后验证）

**现有 20 工具**（aristotle_mcp/）：
1. write_rule
2. read_rules
3. list_rules
4. stage_rule
5. commit_rule
6. reject_rule
7. restore_rule
8. detect_conflicts
9. get_audit_decision
10. check_sync_status
11. sync_rules
12. report_feedback
13. orchestrate_start
14. orchestrate_on_event
15. orchestrate_review_action
16. fire_o (Reflector)
17. check_workflow
18. abort_workflow
19. create_reflection_record
20. complete_reflection_record
21. persist_draft
22. init_repo_tool

**新增 4 工具**（来自 intervention/）：
23. create_rollback_point（来自 RollbackEngine）
24. rollback_to_checkpoint（来自 RollbackEngine）
25. write_ki_doc（来自 KiDocManager）
26. read_ki_docs（来自 KiDocManager）

**注意**: 实际为 26 工具，不是 28。  
rule_generator 和 commit_guard 的功能已在现有工具中覆盖（write_rule + commit_rule），不重复添加。
```

**相容性**: 修正数字。不影响实际功能。

---

## 修改优先级与顺序

| Fix | 优先级 | 依赖 | 可并行 |
|-----|--------|------|--------|
| C-1 | P0 | 无 | ✅ |
| C-2 | P0 | 无 | ✅ |
| H-2 | P1 | M-4 | ❌ 先做 M-4 |
| M-1 | P1 | 无 | ✅ |
| M-2 | P1 | 无 | ✅ |
| M-3 | P1 | 无 | ✅ |
| M-4 | P1 | 无 | ✅ 先于 H-2 |
| M-5 | P2 | 无 | ✅ |
| L-1 | P3 | 无 | ✅ |
| L-2 | P3 | 无 | ✅ |
| I-1 | P3 | 无 | ✅ |
| I-2 | P3 | 无 | ✅ |

**推荐修改顺序**：
1. C-1 + C-2 + M-5 + L-1 + L-2 + I-1 + I-2（并行，纯增量）
2. M-1 + M-2 + M-3 + M-4（并行，修正技术方案）
3. H-2（依赖 M-4 的 schema 迁移方案）

---

## 相容性检查

所有 12 个 fixes 之间的相容性：

| Fix A | Fix B | 冲突? | 说明 |
|-------|-------|-------|------|
| C-1 (量化标准) | H-2 (Phase 3 细节) | ❌ | C-1 增加标准，H-2 增加细节，互补 |
| C-2 (配置机制) | M-1 (Observer 语法检查) | ❌ | C-2 的配置可控制 M-1 的检查启用 |
| H-2 (Schema v5) | M-4 (Schema 迁移) | ❌ | 合并为统一方案 |
| M-1 (Observer) | M-2 (Checkpoint 测试) | ❌ | 不同检查点，互不影响 |
| M-3 (状态统一) | H-2 (Phase 3) | ❌ | M-3 影响 Phase 4，H-2 影响 Phase 3 |
| I-2 (工具数修正) | M-3 (合并内容) | ❌ | I-2 修正 M-3 的数字 |

**结论**: 12 个 fixes 之间无冲突，全部相容。可以一次性修改方案文档。
