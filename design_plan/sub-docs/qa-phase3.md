# Phase 3: Ralph Loop 语义审查扩展（待定） — 独立审查子文档

> **来源**: quality-assurance-implementation-plan.md v1.34 §3.3 (L859-L1132)
> **共享接口定义**: 见 qa-base.md §3.0
> **状态**: ⚠️ 待定 — 非当期范围。当期使用 C/H/M 标注，S/B/A severity 为 Phase 3 目标。

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

FindingSubmission/RoundRecord 类型定义 → 见 §3.0.3。以下为 Schema v5 迁移代码中使用的目标类型：
// ⚠️ FindingSubmission.severity 和 RoundRecord.counts 的完整定义见 §3.0.3。以下仅展示 Phase 3 迁移上下文。

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
// ⚠️ S/B→C/H 映射对 consecutiveZero 的影响（当期过渡）：§3.3.3 定义了 S/B/A → C/H/M 映射表。
//   映射后的 severity 通过 ralph_round_finding 提交，计入 RoundRecord.counts 的 C/H/M。
//   因此 S→C 的 finding 直接增加 consecutiveZero 的 C 计数——行为与直接使用 C/H 等价。
//   Phase 3 Schema v5 迁移后，consecutiveZero 检查从 C+H+M=0 扩展为 C+H+M+S+B=0。

// VALID_SEVERITIES 同步更新（F5-02 修正）
const VALID_SEVERITIES = new Set(['C', 'H', 'M', 'P', 'L', 'I', 'S', 'B', 'A']);
// ⚠️ SEV_ORDER 和 VALID_SEVERITIES 未包含在 §3.0 常量注册表（§3.0.6）中。建议在 §3.0.6 补充。

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
// PipelineStore 类方法（与现有 readState 位置一致）
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
- ⚠️ **隐式耦合**：consecutiveZero 计数依赖 Reviewer 正确累加每轮 counts。若 Reviewer 漏报 finding，consecutiveZero 不会归零。缓解：(1) Reviewer prompt 模板硬性要求返回完整 severity 分解；(2) 主 Agent 校验 Reviewer 输出格式包含所有 severity key。

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

