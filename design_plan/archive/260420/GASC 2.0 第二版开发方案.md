# GASC 2.0 第二版开发方案与代码实施计划

> 基于 GASC 2.0 意图驱动技能协作方案，结合 git-mcp 已实现代码，修订后的完整开发计划。
> 最后更新：2026-04-15

---

## 1. 角色映射确认

### 1.1 GASC 2.0 角色 → Aristotle 现有架构映射

| GASC 2.0 角色 | 职责 | Aristotle 对应 | 实现状态 |
|--------------|------|---------------|---------|
| **O（Orchestrator）** | 统筹协调 + 知识服务提供者。拉起 R/C/S，接收 L 的检索请求，委托 S 执行并过滤结果，决策审核级别 | `SKILL.md`（路由器）+ `REFLECT.md`（反思协调）+ `REVIEW.md`（审核协调）+ 未来 `LEARN.md`（学习协调） | 部分实现（反思/审核路由已通，学习服务未接入） |
| **R（Resource Creator）** | 编写反思规则文档。撰写 intent_tags、failed_skill、error_summary 等检索维度 | `REFLECTOR.md`（Reflector subagent） | 部分实现（生成 DRAFT 规则，但缺少 GASC 2.0 新增的检索维度字段） |
| **C（Checker）** | 审核 R 的产出：校验 schema、验证意图标签准确性、纠正错误描述。执行状态推进（verified/rejected）和 git commit | `REVIEW.md` 中的 confirm/reject 流程 + 未来 MCP commit 调用 | 部分实现（用户确认逻辑已通，但直接写文件而非通过 MCP） |
| **S（Searcher）** | 将半结构化检索需求转化为 MCP regex 查询条件，获取结果交 O 过滤 | **O 内的函数调用**（非独立 subagent）+ `LEARN.md` 中的查询构造指令 | 未实现 |
| **L（Learner）** | 任务执行者。执行前评估是否需增量学习，生成 intent_tags 请求 O 检索，学习后仍犯错则向 O 报告 | OpenCode 主会话中的 Sisyphus（或其他 skill agent） | 未实现 |

### 1.2 O 的双重角色明确

O **同时是**：
1. **统筹者** — 识别场景，决定拉起 R / C / S
2. **知识服务提供者** — 接收 L 的检索请求，委托 S 执行检索，过滤 S 返回的结果后再交给 L
3. **进化决策者** — 基于 evolution_stats.json 决定审核级别（Apprentice → Peer → Expert）

### 1.3 L 的行为模型

L **不参与代码重构**。正确的行为链路：

```
L 执行任务
  │
  ├─ 任务开始前：
  │   生成 intent_tags → 请求 O 检索历史教训
  │   O → 调用 S(函数) → 构造 MCP 查询 → 获取结果 → O 过滤 → 返回给 L
  │   L 学习教训，调整执行策略
  │
  ├─ 执行成功 → 正常结束
  │
  └─ 学习后仍犯错：
      L 生成"错误现场报告" → 提交给 O
      O 记录反馈 + 标记 needs_sync
      O 拉起 R → 反思 + 生成改进方案（新 pending 规则）
      O 拉起 C → 审核改进方案 → verified/rejected
```

---

## 2. 当前实现基线

### 2.1 已完成（第一版）

| 模块 | 文件 | 行数 | 说明 |
|------|------|------|------|
| 配置 | `aristotle_mcp/config.py` | 60 | 路径解析、RISK_MAP、project_hash |
| 模型 | `aristotle_mcp/models.py` | 125 | RuleMetadata dataclass + YAML 序列化 |
| Git | `aristotle_mcp/git_ops.py` | 118 | Git 抽象层（init/add+commit/show/log/status） |
| Frontmatter | `aristotle_mcp/frontmatter.py` | 153 | 流式过滤、原子写入、字段更新 |
| 迁移 | `aristotle_mcp/migration.py` | 149 | 扁平 Markdown → Git 仓库 |
| Server | `aristotle_mcp/server.py` | 493 | FastMCP + 7 工具 |
| 测试 | `test/test_mcp.py` | ~500 | 54 个 pytest 断言 |
| 构建 | `pyproject.toml` | — | uv + setuptools |

### 2.2 现有 7 个 MCP 工具

| 工具 | 状态 | GASC 2.0 角色对应 |
|------|------|------------------|
| `init_repo` | ✅ 已实现 | O 冷启动 |
| `write_rule` | ✅ 已实现（缺 GASC 2.0 新字段） | R 写入 |
| `read_rules` | ✅ 已实现（缺多维度检索） | S/L 检索 |
| `stage_rule` | ✅ 已实现 | C 审核前 |
| `commit_rule` | ✅ 已实现 | C 确认 |
| `reject_rule` | ✅ 已实现 | C 拒绝 |
| `list_rules` | ✅ 已实现 | O/L 轻量列表 |

---

## 3. 分阶段实施计划（修订版）

### P1：Schema 升级 & MCP 工具补齐

**目标**：将 GASC 2.0 的 frontmatter 检索维度落地，补齐遗漏工具。

#### P1.1 RuleMetadata 扩展

在 `models.py` 的 `RuleMetadata` 新增 3 个字段：

```python
@dataclass
class RuleMetadata:
    # ... 现有字段保持不变 ...
    intent_tags: dict | None = None       # {"domain": "...", "task_goal": "..."}
    failed_skill: str | None = None       # 关联故障技能 ID
    error_summary: str | None = None      # 错误现场精简总结
```

`to_frontmatter_string()` 需支持 `intent_tags` 的嵌套 YAML 输出：

```yaml
intent_tags:
  domain: "text_analysis"
  task_goal: "extract_entity_from_pdf"
```

`from_frontmatter_dict()` 需支持反序列化嵌套 dict。

#### P1.2 write_rule 参数扩展

`server.py:write_rule` 新增参数：

```python
def write_rule(
    content: str,
    # ... 现有参数 ...
    intent_domain: str | None = None,
    intent_task_goal: str | None = None,
    failed_skill: str | None = None,
    error_summary: str | None = None,
) -> dict:
```

当 `intent_domain` 或 `intent_task_goal` 有值时，组装为 `intent_tags` dict 写入 metadata。

#### P1.3 read_rules 多维度组合检索

`frontmatter.py:stream_filter_rules` 和 `server.py:read_rules` 新增过滤维度：

| 参数 | 匹配目标 | 实现方式 |
|------|---------|---------|
| `intent_domain` | frontmatter 中 `intent_tags.domain` 的值 | regex 匹配 |
| `intent_task_goal` | frontmatter 中 `intent_tags.task_goal` 的值 | regex 匹配 |
| `failed_skill` | frontmatter 中 `failed_skill` 的值 | regex 匹配 |
| `error_summary` | frontmatter 中 `error_summary` 的值 | regex 匹配 |

实现策略：在 `stream_filter_rules` 中，对 frontmatter 文本先做 `yaml.safe_load` 解析（仅在 50 行头区域内），然后按字段精确匹配。如果解析失败则回退到 regex 文本匹配。

#### P1.4 restore_rule 工具

从 `rejected/{scope}/` 还原规则到正式目录：

```python
@mcp.tool()
def restore_rule(file_path: str, new_status: str = "pending") -> dict:
    """Restore a rejected rule back to active directory."""
```

- 保留原始 metadata（scope、project_hash 等）
- 清除 `rejected_at` / `rejected_reason`
- status 设为 `new_status`（默认 pending）
- 物理移动文件 + git add + commit

#### P1.5 Migration 兼容

旧数据迁移时的默认值策略：

| 新字段 | 迁移默认值 | 理由 |
|--------|-----------|------|
| `intent_tags` | `null` | 旧规则无法回溯意图 |
| `failed_skill` | `null` | 旧规则无关联技能 |
| `error_summary` | `null`（未来可从 Context 字段 heuristic 提取） | 降级处理 |

#### P1.6 Git 安装前置检测

`init_repo` 执行前检查 `git --version`，失败返回明确错误信息。

**P1 交付物**：MCP Server 7 → 8 工具，新 schema + 多维度检索。
**P1 测试**：扩展 `test_mcp.py`，覆盖新字段序列化/反序列化、多维度组合查询、restore 生命周期、前置检测。

---

### P2：Aristotle Skill 层集成（R + C 角色落地）

**目标**：将 REVIEW.md 的直接文件写入改造为 MCP 工具调用，扩展 REFLECTOR 输出协议。

#### P2.1 REVIEW.md STEP V3 改造

**当前行为**：用户 confirm 后直接 append 到 `aristotle-learnings.md`。
**改造为**：调用 MCP 工具链。

改造后的 STEP V3 流程：

```
用户 confirm
  │
  ├─ 调用 write_rule(
  │    content=DRAFT 规则内容,
  │    scope="user" 或 "project",
  │    category=错误分类,
  │    source_session=目标 session ID,
  │    intent_domain=R 推断的领域,
  │    intent_task_goal=R 推断的任务目标,
  │    failed_skill=涉及的工具/技能,
  │    error_summary=错误现场一句话总结
  │  )
  │  → 返回 rule_id, file_path, status="pending"
  │
  ├─ 调用 stage_rule(file_path)
  │  → status="staging"
  │
  ├─ 审核级别判断（基于 Δ 决策因子，P4 实现；P2 先用固定 semi 模式）
  │  ├─ 如果低风险（category ∈ 低风险组）→ 自动调用 commit_rule
  │  └─ 否则 → 展示规则 diff，等待用户二次确认后调用 commit_rule
  │
  └─ 更新 state file（与现有逻辑一致）
```

#### P2.2 REFLECTOR.md STEP R4 输出扩展

在 DRAFT 报告中，每个 Reflection 新增 3 个字段：

```
### Reflection 1: [SHORT_TITLE]
- **Severity**: ...
- **Category**: ...
- **Location**: ...
- **Error Excerpt**: ...
- **Correction Excerpt**: ...
- **5-Why Root Cause**: ...
- **Intent Tags**: domain="[领域]", task_goal="[任务目标]"    ← 新增
- **Failed Skill**: [涉及的技能/工具 ID，或 null]             ← 新增
- **Error Summary**: [一句话精简总结错误现场]                  ← 新增
- **Proposed Rule**: ...
- **Context**: ...
- **Example**: ...
```

Reflector 生成逻辑：
- `intent_tags.domain`：从错误发生的上下文推断（如涉及文件操作 → "file_operations"，涉及 API 调用 → "api_integration"）
- `intent_tags.task_goal`：从用户原始请求推断任务目标
- `failed_skill`：识别错误中涉及的具体工具或技能（如 "grep_tool", "playwright", "prisma"）
- `error_summary`：将 Error Excerpt 压缩为一句 ≤100 字符的精简描述

#### P2.3 REVIEW.md 中 C 角色逻辑

在用户 confirm 后、commit 前，增加一个轻量审核步骤：

1. 校验必填字段：id、category、created_at、intent_tags（至少 domain）
2. 校验 intent_tags 格式：必须是合法 dict，domain 非空
3. 校验 error_summary 长度：≤200 字符
4. 硬性校验失败 → 标记为 rejected，提示用户修改
5. 软性校验（内容合理性）→ P4 阶段由 Δ 因子决策

#### P2.4 opencode.json E2E 验证

实际配置 OpenCode，验证 MCP server 启动和工具发现链路。

**P2 交付物**：Aristotle 完整反思-审核-写入链路通过 MCP 走 Git 仓库。
**P2 测试**：live-test.sh 验证 reflect → review → write_rule → stage_rule → commit_rule 链路。

---

### P3：L（Learner）+ S（Searcher）增量学习服务

**目标**：实现 GASC 2.0 的意图驱动学习闭环。

#### P3.1 LEARN.md 新增

新建 `${SKILL_DIR}/LEARN.md`，定义 L 的学习检索协议。内容包含：

**a) intent_tags 生成指引**

L（即主会话中的 agent）根据当前任务理解，提取：
- `domain`：任务涉及的技术领域
- `task_goal`：任务的核心目标

**b) 查询构造逻辑（S 函数）**

将 intent_tags 转化为 MCP 调用参数的规则：

```
如果 L 提供了 intent_tags:
  → read_rules(intent_domain=tags.domain, intent_task_goal=tags.task_goal, status="verified")

如果 L 提供了错误总结:
  → read_rules(error_summary="关键词1|关键词2", status="verified")

如果 L 提供了 failed_skill:
  → read_rules(failed_skill=skill_id, status="verified")

组合查询：
  → 以上参数可同时传入，MCP 返回 AND 匹配结果
```

**c) 结果解读与应用**

收到 O 返回的检索结果后，L 的处理策略：
- 每个 rule 的 `error_summary` 作为关键警告
- `Proposed Rule` 作为必须遵守的约束
- `Example` 作为正确/错误行为对照

**d) 错误反馈流程**

学习后仍犯错时，L 向 O 提交"错误现场报告"：

```
错误现场报告:
  intent_tags: {domain: "...", task_goal: "..."}
  failed_skill: "..." (如适用)
  applied_rules: ["rec_xxx", "rec_yyy"]  ← 学习过但未能避免的规则 ID
  error_description: "..."
```

O 收到后：
1. 标记对应规则为 `needs_sync`
2. 拉起 R 进行新一轮反思（传入错误现场报告作为上下文）
3. R 生成改进方案（新 pending 文件）
4. C 审核改进方案

#### P3.2 SKILL.md 路由扩展

在 SKILL.md 的 PHASE 0: ROUTE 中新增：

```
/aristotle learn [intent]         → LEARN: 检索历史教训，注入当前上下文
/aristotle learn --domain X --goal Y → LEARN: 指定 domain/task_goal 检索
```

同时更新路由表：

| Command | Action |
|---------|--------|
| `learn [intent]` | Read `${SKILL_DIR}/LEARN.md`, 执行学习检索协议 |
| `learn --domain X --goal Y` | 同上，但使用显式参数 |

SKILL.md 的 Phase 表扩展为：

| Phase | Command | Loads | Purpose |
|-------|---------|-------|---------|
| **Route** | `/aristotle` | This file only | Parse args, route |
| **Reflect** | `/aristotle [target]` | This file + `REFLECT.md` | Fire Reflector |
| **Review** | `/aristotle review N` | This file + `REVIEW.md` | Review DRAFT |
| **Learn** | `/aristotle learn` | This file + `LEARN.md` | Retrieve related lessons |

#### P3.3 被动触发：多 Agent 错误监听

SKILL.md 的 description 已包含错误触发关键词（"that's wrong", "不对", "搞错了" 等）。

扩展触发场景，覆盖多 agent 协作中的错误反馈：

**新增触发模式**：当 OpenCode 的多 agent 场景中，agent B 在检查 agent A 的工作时发现错误，并在反馈中表达出来时（如 "this implementation has a bug", "this approach won't work because...", "这里有个问题"），Aristotle 监听到该错误并启动反思循环。

**实现方式**：
- SKILL.md 的 description 补充多 agent 错误检测关键词
- 触发后执行完整的 reflect → review → commit 流程
- 生成的规则中 `intent_tags.domain` 自动标记为 "multi_agent_coordination"

**具体触发关键词补充**：

```yaml
description: |
  ... existing triggers ...
  Also triggers in multi-agent scenarios when one agent detects errors
  in another agent's work (e.g., "found an issue in", "this has a bug",
  "incorrect implementation", "this approach won't work",
  "发现一个问题", "这里有个 bug", "实现有误", "这个方案不行").
```

#### P3.4 needs_sync 信号机制

- L 通过 `read_rules(status="verified")` 读取
- 检测到物理文件存在但 `git show HEAD:file` 失败的情况
- 写入 `.signal` 文件到 repo 根目录
- O/Skill 检测信号后触发 `commit_rule` 补提

**P3 交付物**：L 可在任务前增量获取相关教训；多 agent 场景错误自动触发反思。
**P3 测试**：模拟 L 请求 → 构造查询 → MCP 检索 → 返回摘要链路；模拟多 agent 错误触发。

---

### P4：进化模型 & Δ 决策因子

**目标**：实现审核级别的自动升降，减少人工干预。

#### P4.1 evolution_stats.json

仓库根目录维护统计文件：

```json
{
  "version": 1,
  "total_rules": 42,
  "by_status": {"verified": 38, "rejected": 4},
  "by_category": {
    "HALLUCINATION": {"total": 10, "verified": 9, "rejected": 1}
  },
  "audit_mode": "semi",
  "audit_level": "apprentice",
  "success_streak": 15,
  "last_auto_promotion": null
}
```

#### P4.2 Δ 决策因子

在 C 角色审核时计算：

```
Δ = confidence × (1 - risk_weight)
```

| risk_level | risk_weight |
|-----------|-------------|
| high | 0.8 |
| medium | 0.5 |
| low | 0.2 |

| Δ 值 | 审核行为 |
|------|---------|
| Δ > 0.7 | auto — 自动 commit，无需人工确认 |
| 0.4 < Δ ≤ 0.7 | semi — 展示 diff，等待用户确认 |
| Δ ≤ 0.4 | manual — 强制人工审查 |

#### P4.3 审核级别自动升降

基于 `evolution_stats.json` 的成功率：

| 条件 | 动作 |
|------|------|
| 成功率 > 95% 且连续 50 条 verified | apprentice → peer（Δ 阈值下调 0.1） |
| 成功率 > 98% 且连续 100 条 verified | peer → expert（Δ 阈值再下调 0.1） |
| 成功率 < 80% | 降级一级 |

**P4 交付物**：完整的 GASC 2.0 进化闭环。
**P4 测试**：模拟不同 Δ 值的审核路径；模拟级别升降触发。

---

### P5：文档 & 收尾

- README 双语文档全面更新（GASC 2.0 架构、5 角色、新增工具、学习检索流程）
- 进度文档最终版
- AGENTS.md（如需）
- 全量测试覆盖补齐
- Windows 兼容性测试（可选）

---

## 4. 阶段依赖关系

```
P1 (Schema + 工具补齐) ← 基础，所有后续阶段依赖
  │
  ├─→ P2 (Aristotle Skill 集成：R + C) ← 依赖 P1 的新 schema 和工具
  │      │
  │      └─→ P3 (L + S 增量学习 + 被动触发) ← 依赖 P2 的 MCP 写入链路
  │             │
  │             └─→ P4 (进化模型) ← 依赖 P3 积累的数据
  │                    │
  │                    └─→ P5 (文档收尾)
  │
  └─→ P2.4 (E2E 验证) ← 可在 P2 完成后与 P3 并行
```

P1 → P2 严格顺序。P3 依赖 P2 的 MCP 写入已通。P4 依赖 P3 的数据积累。

---

## 5. 本期聚焦建议

基于"先实现最小可用集"原则，建议本期聚焦 **P1 + P2**：

1. **P1**：Schema 扩展 + `restore_rule` + 多维度检索 + Migration 兼容 + Git 检测
2. **P2.1**：REVIEW.md STEP V3 改造为 MCP 调用
3. **P2.2**：REFLECTOR.md STEP R4 输出协议扩展（intent_tags + failed_skill + error_summary）
4. **P2.3**：REVIEW.md 中 C 角色的 schema 校验逻辑

完成后的效果：
- Aristotle 的完整反思-审核-写入链路全部通过 MCP 走 Git 仓库
- 每条规则带 GASC 2.0 的 3 个检索维度（intent_tags / failed_skill / error_summary）
- MCP 支持 8 个工具，含多维度组合检索
- 为 P3 的 L 学习服务和多 agent 被动触发打好基础

---

## 6. GASC 2.0 新增 Frontmatter 完整示例

```yaml
---
id: "rec_1713283200"
status: "verified"
scope: "user"
category: "HALLUCINATION"
confidence: 0.85
risk_level: "high"

# GASC 2.0 检索维度
intent_tags:
  domain: "database_operations"
  task_goal: "prisma_connection_pool_management"
failed_skill: "prisma_client"
error_summary: "Too many connections: P2024 timed out fetching from pool in serverless"

# 原有字段
source_session: "ses_abc123"
message_range: "msg_45-msg_52"
created_at: "2026-04-16T10:30:00+08:00"
verified_at: "2026-04-16T10:35:00+08:00"
verified_by: "auto"
---

## [2026-04-16] HALLUCINATION — Prisma Connection Pool Exhaustion in Serverless
**Context**: When deploying Prisma-based API to Vercel...
**Rule**: Always configure explicit connection_limit and pool_timeout in Prisma datasource...
**Why**: Serverless functions create concurrent connections...
**Example**: ✅ `datasource db { provider = "postgresql" url = env("DATABASE_URL") + "&connection_limit=5&pool_timeout=10" }` ❌ Using default Prisma connection config
```

---

## 7. 与第一版方案的关键差异总结

| 维度 | 第一版 | 第二版（本版） |
|------|--------|---------------|
| 角色模型 | O/R/C/L 四角色 | O/R/C/L/S 五角色（S 新增） |
| O 的定位 | 统筹者 | 统筹者 + 知识服务提供者（双重角色） |
| S 的定位 | 不存在 | O 内的函数调用（先轻量，预留 subagent 演进路径） |
| L 的行为 | 未明确 | 学习后仍犯错 → 向 O 报告 → O 拉起 R/C（L 不参与重构） |
| Frontmatter | 无检索维度 | 新增 intent_tags / failed_skill / error_summary |
| 检索能力 | status + category + keyword regex | 新增 intent_domain / intent_task_goal / failed_skill / error_summary 多维度组合 |
| 触发模式 | 用户显式 `/aristotle` | 用户主动触发 + 多 agent 被动监听 |
| Skill 文件 | SKILL/REFLECT/REVIEW/REFLECTOR | 新增 LEARN.md |
| 审核模型 | 固定 semi | Δ 决策因子 + 三级自动升降 |
