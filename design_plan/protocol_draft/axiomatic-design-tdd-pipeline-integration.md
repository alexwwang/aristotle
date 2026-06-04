# 公理设计（Axiomatic Design）整合进 TDD Pipeline 方案

> **状态**: Draft
> **日期**: 2026-05-20
> **范围**: tdd-pipeline skill（Phase 1 / Phase 2 / Design Review）
> **执行者**: Aristotle 项目开发

---

## 1. 背景

### 1.1 当前 TDD Pipeline 的审核盲区

TDD Pipeline 在 Phase 2（技术方案）的架构审核中，模块边界和方案比选依赖审查者经验：

- **模块边界**：通过 "single_responsibility + blast_radius + min_api_surface" 检查，但缺乏结构化的耦合检测机制
- **方案比选**：通过 "alternatives + trade-offs recorded" 要求记录备选方案，但缺乏量化的选优标准
- **需求纯度**：Phase 1 的 AC 可能混入实现细节（"用 Redis 缓存"），但现有 gate 未显式检查 FR/DP 分离

这些盲区导致：
1. 耦合设计可能在 Ralph review 中漏过（主观判断 "边界是否清晰" vs 机械判断 "矩阵是否对角"）
2. 方案选择缺乏可复现的量化依据
3. 需求阶段的实现泄露到下游才被发现

### 1.2 公理设计的适配性

MIT 公理设计（Nam P. Suh, 1990）提供两个可机械验证的公理：

| 公理 | 含义 | 对应 TDD Pipeline 痛点 |
|------|------|----------------------|
| **公理一：独立性公理** | FRs 之间必须独立，调整某个 DP 不应影响其他 FR | 耦合检测 |
| **公理二：信息公理** | 信息含量最少的设计最优 | 方案量化比选 |

与 TDD Pipeline 的天然映射：

```
公理设计域              TDD Pipeline 阶段
─────────────────────────────────────────
客户域 → FRs            Phase 1 产品设计
功能域 → DPs            Phase 2 技术方案
FR↔DP 映射验证          Phase 2 Gate Review
层分解                   Phase 2 Split Decision
信息含量比较             Phase 2 方案比选
```

**核心原则：不新增阶段，公理设计作为 Phase 1+2 的增强透镜融入现有流程。**

---

## 2. 方案概述

共 **3 处修改**，涉及 3 个文件：

| # | 文件 | 修改内容 | 影响 |
|---|------|---------|------|
| 1 | `phase-1-product-design.md` | 新增 FR Independence Check 段落 + Gate 新增项 | Phase 1 交付物增加一节 |
| 2 | `phase-2-technical-solution.md` | 新增 Design Matrix + Information Content 段落 + Gate 新增项 | Phase 2 交付物增加两节 |
| 3 | `review-design.md` | Checklist + Recall Prompt 新增 3 个审查维度 | 设计审查范围扩大 |

**不修改的部分**：
- Phase 3-5（公理设计的价值在需求→方案阶段，测试和编码阶段不需要）
- Ralph Loop 机制（设计矩阵检查作为 gate item 融入现有 Ralph review）
- Split Decision（Zigzag 思想与 Split Decision 目标一致，不需要替换）
- Pipeline 5 阶段结构（不新增阶段）

---

## 3. 详细修改方案

### 3.1 修改 1：Phase 1 — FR 独立性约束

**文件**: `phase-1-product-design.md`
**位置**: Deliverable Template 中 Acceptance Criteria 表格之后，Constraints & Assumptions 之前

#### 3.1.1 新增交付物段落

在 Deliverable Template 的 `## Acceptance Criteria` 表格之后插入：

```markdown
## FR Independence Check (Axiom 1)

对每对 AC，检查是否存在独立性冲突：

| FR₁ | FR₂ | Independent? | Note |
|-----|-----|-------------|------|
| AC-1 | AC-2 | ✅ | 无共享资源 |
| AC-1 | AC-3 | ⚠️ | 共享用户状态，需在 Phase 2 隔离 |
| AC-2 | AC-3 | ✅ | 独立操作 |

独立性判定标准：
- ✅ 完全独立：实现其中一个不影响另一个
- ⚠️ 准独立：通过设计可解耦（Phase 2 必须处理）
- ❌ 耦合：需要重新定义 FR 或合并

**FR 纯度检查**：每条 AC 描述的是 "做什么"（功能域），不是 "怎么做"（物理域）。
反例：AC = "使用 Redis 缓存" ← 这已经是 DP，不是 FR
正例：AC = "查询响应 < 50ms"
```

#### 3.1.2 Gate Checklist 新增项

在 `phase-1-product-design.md` 的 Gate: Reviewer Checklist 中新增：

```diff
  gate_pass = ALL:
    boundaries:     system scope, exclusions, and external deps explicitly defined
    traceability:   all user_stories → traceable to original request
    testability:    every AC testable (binary pass/fail, no subjective language)
    classification: every US + AC ∈ {core, secondary}
    justification:  core/secondary labels justified per definition
    ambiguity:      zero unresolved ambiguities
    edge_cases:     error scenarios + boundary conditions identified
    constraints:    assumptions + limitations explicit
+   fr_independence: no ❌ pairs in FR Independence Check; ⚠️ pairs documented with decoupling plan
+   fr_purity:      every AC describes WHAT not HOW (no DP leakage into FRs)
    ralph:          zero C/H/M issues
```

### 3.2 修改 2：Phase 2 — 设计矩阵 + 信息公理（核心整合点）

**文件**: `phase-2-technical-solution.md`
**位置**: Deliverable Template 中 Component Breakdown 之后，Key Decisions 之前

#### 3.2.1 新增交付物段落 A：Design Matrix

在 `## Component Breakdown` 表格之后插入：

```markdown
## Design Matrix (Axiom 1 — Independence Verification)

将 FRs（Phase 1 ACs）与 DPs（本方案组件）的关系构造成矩阵。
X = 该 DP 影响该 FR，0 = 不影响。

示例：

|       | DP₁: AuthService | DP₂: OrderService | DP₃: CacheLayer | DP₄: EventBus |
|-------|:-:|:-:|:-:|:-:|
| FR₁: 用户认证 <50ms | X | 0 | 0 | 0 |
| FR₂: 订单创建原子性 | 0 | X | 0 | X |
| FR₃: 查询响应 <100ms | 0 | 0 | X | 0 |
| FR₄: 事件最终一致 | 0 | X | 0 | X |

设计类型判定：
- ☐ 无耦合（Uncoupled）：对角矩阵 — 每个 FR 独立由一个 DP 控制
- ☑ 准耦合（Decoupled）：三角矩阵 — 需按特定顺序调整 DP
- ☐ 耦合（Coupled）：满矩阵 — FRs 相互干扰，**不可接受**

（勾选当前设计类型）

耦合点分析（如有非对角元素必须填写）：
- FR₂ ↔ FR₄ 共享 DP₂/DP₄ → 调整顺序：先 EventBus，再 OrderService
- 消除耦合的方案：将 OrderService 的事件发布拆为独立 DP（评估中）
```

**设计矩阵构造规则**：
1. FR 行 = Phase 1 的所有 Core AC + 影响架构的 Secondary AC
2. DP 列 = Phase 2 的所有 Key 组件
3. 每个 (FR, DP) 格子标注 X 或 0
4. 矩阵类型判定：对角 → 无耦合，三角（含排列后三角）→ 准耦合，其他 → 耦合

#### 3.2.2 新增交付物段落 B：Information Content

在 Design Matrix 之后插入：

```markdown
## Information Content (Axiom 2 — Alternative Comparison)

当存在多个候选方案时（至少评估 2 个），用信息含量量化比选。

| 方案 | 设计类型 | 耦合点数 | 成功率评估 | I_total (bits) | 判定 |
|------|---------|---------|-----------|---------------|------|
| A: 当前方案 | 准耦合 | 2 | 85% | 0.24 | |
| B: 拆分方案 | 无耦合 | 0 | 90% | 0.15 | ✅ Selected |
| C: 合并方案 | 耦合 | 5 | 70% | 0.51 | ❌ Rejected |

判定规则（严格按顺序）：
1. **先淘汰耦合方案**（违反公理一，不可通过后续设计弥补）
2. **在无耦合/准耦合中选 I_total 最低的**
3. 如选准耦合方案，必须标注 DP 调整顺序（在 Design Matrix 中已记录）
4. 如最终选择非 I_total 最低的方案，必须记录理由（如成本约束、时间约束）

注：如仅有一个方案且为无耦合/准耦合，此表可简化为单行声明。
```

**信息含量估算方法**（实用简化版）：
- I_i = -log₂(success_rate_i)
- success_rate 基于工程判断评估：该方案在满足 FR_i 的成功概率
- I_total = Σ I_i（所有 FR 的信息含量之和）

#### 3.2.3 Gate Checklist 新增项

在 `phase-2-technical-solution.md` 的 Gate: Reviewer Checklist 中新增：

```diff
  gate_pass = ALL:
    coverage:     all Phase1.AC covered by design
    classification: all components/interfaces/failure_modes ∈ {key, peripheral}
    consistency:  Phase1.core → maps_to ≥ 1 Phase2.key
    testability:  interfaces concrete enough for test authoring
    failure:      error paths designed (not just happy path)
    lean:         every abstraction justified (no over-engineering)
    boundary:     single_responsibility + blast_radius + min_api_surface ✓
    security:     threat_model + trust_boundaries + data_protection + test_scenarios ✓
    quality:      operability + observability + data + performance + maintainability ✓
    nfr:          non-functional constraints documented
    decisions:    alternatives + trade-offs recorded
+   design_matrix: FR-DP matrix constructed, type classified (uncoupled/decoupled/coupled)
+   coupling:      IF coupled → REJECT; IF decoupled → DP adjustment order documented
+   information:   IF alternatives exist → I_total compared, lowest chosen (or justification for deviation)
    ralph:        zero C/H/M issues
```

### 3.3 修改 3：Design Review — 新增公理审查维度

**文件**: `review-design.md`
**位置**: Design Review Checklist 列表 + Recall Prompt 审查维度

#### 3.3.1 Checklist 新增项

在现有 8 项 checklist 之后新增：

```diff
  - [ ] **Security**: Data exposure, injection risks, missing validation
+ - [ ] **Axiom 1 — Independence**: Design matrix constructed, FR-DP uncoupled (or decoupled with adjustment order)
+ - [ ] **Axiom 2 — Information**: If alternatives exist, lowest I_total selected with quantitative basis
+ - [ ] **FR Purity**: ACs describe "what" (functional domain), not "how" (physical domain)
```

#### 3.3.2 Recall Prompt 审查维度新增

在 Recall Prompt 的审查维度列表（8 项）之后新增：

```diff
  8. 安全性：数据暴露、注入风险、缺少验证
+ 9. 独立性公理：设计矩阵是否已构造？FR-DP 是否存在耦合？准耦合是否有调整顺序？
+ 10. 信息公理：多方案比选是否有量化依据（I_total）？是否淘汰了耦合方案？
+ 11. FR纯度：AC是否描述"做什么"而非"怎么做"？是否混入了实现细节？
```

---

## 4. 审核体验变化

### Before（现有）
```
Reviewer: "模块边界是否清晰？"
→ 主观判断，依赖审查者经验
→ 同一个设计，不同审查者可能得出不同结论
```

### After（整合后）
```
Reviewer: "设计矩阵是否是对角/三角的？耦合点在哪？调整顺序是什么？"
→ 机械检查，零主观
→ 耦合方案直接 REJECT，不需要争论
→ 信息含量提供量化比选依据，替代"我觉得方案A更好"
```

---

## 5. 实施注意事项

1. **设计矩阵不是额外负担**：Phase 2 的 Component Breakdown 表格本质上就是 FR↔DP 映射，设计矩阵只是把这个隐含关系显式化、结构化
2. **FR 纯度检查的时机**：在 Phase 1 做，不是 Phase 2。一旦 AC 混入了 DP，Phase 2 的设计矩阵会退化为自证循环
3. **信息含量的实用简化**：不需要精确的 probability density 计算，工程判断的成功率估算足够用。公理二的价值在于"有量化依据"而非"精确到小数点后三位"
4. **对小型项目的适配**：当 AC < 5 且组件 < 5 时，设计矩阵可以简化为文字描述（"DP₁ 仅影响 FR₁，DP₂ 仅影响 FR₂，无耦合"），不需要画完整矩阵
5. **与现有 quality checklist 的关系**：公理设计不替代 maintainability.change_point（"需求变更影响几个模块"），而是从不同角度验证同一件事——独立性公理是 change_point 的理论基础

---

## 6. 验收标准

修改完成后，应满足：

- [ ] `phase-1-product-design.md` 包含 FR Independence Check 段落和 fr_independence / fr_purity gate 项
- [ ] `phase-2-technical-solution.md` 包含 Design Matrix 和 Information Content 段落和 design_matrix / coupling / information gate 项
- [ ] `review-design.md` 的 Checklist 和 Recall Prompt 包含 3 个新审查维度
- [ ] 现有 gate 项、Ralph loop 机制、Split Decision 逻辑未受影响
- [ ] 用一个实际案例走通 Phase 1 → Phase 2 流程，验证设计矩阵的可操作性
