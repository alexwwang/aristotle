# Aristotle GEAR 实施进度 v1.0

> **归档版本 v1.0** — P1–P4 完成
> 最后更新：2026-04-17
>
> 本文档追踪 GEAR 协议的 Aristotle MCP Server 实施进度（P1–P4）。
> 已归档，不再更新。后续开发计划见 `ROADMAP.md`。
> 协议规范见项目根目录 `GEAR.md`。

---

## 按分阶段计划（5 阶段）

| 阶段 | 名称 | 状态 | 完成度 | 说明 |
|------|------|------|--------|------|
| **P1** | Schema 升级 & MCP 工具补齐 | ✅ 完成 | **100%** | 8 工具、75 测试、多维度检索、restore_rule |
| **P2** | Aristotle Skill 层集成（R + C） | ✅ 完成 | **100%** | REVIEW.md MCP 化、REFLECTOR.md 输出扩展、C 角色 schema 校验 |
| **P3** | L + S 增量学习服务 | ✅ 完成 | **100%** | LEARN.md、SKILL.md 路由扩展、被动触发、sync 自愈、10 工具、82 测试 |
| **P4** | Δ 决策因子 | ✅ 完成 | **100%** | Δ 计算、get_audit_decision 工具、V3c 动态审核（进化等级已推迟） |
| **P5** | 文档 & 收尾 | 🔲 未开始 | **0%** | README 最终更新、进度文档归档、全量测试覆盖 |

---

## P1 已完成明细

### MCP 工具（8 个）

| 工具 | GEAR 操作 | 状态 |
|------|----------|------|
| `init_repo` | init | ✅ 含 git 可用性检测 + 扁平规则自动迁移 |
| `write_rule` | produce | ✅ 含 GEAR 检索维度（intent_tags/failed_skill/error_summary） |
| `read_rules` | search | ✅ 多维度组合检索（status/category/intent_domain/intent_task_goal/failed_skill/error_summary） |
| `stage_rule` | stage | ✅ |
| `commit_rule` | verify | ✅ 含 git add + commit |
| `reject_rule` | reject | ✅ 移入 rejected/{scope}/，保留完整元数据 |
| `restore_rule` | restore | ✅ 从 rejected 还原到正式目录 |
| `list_rules` | list | ✅ 轻量元数据列表 |

### Frontmatter Schema（GEAR 2.0 扩展）

| 字段 | 类型 | 来源 |
|------|------|------|
| `id` / `status` / `scope` / `category` / `confidence` / `risk_level` | 基础字段 | P1 |
| `intent_tags.domain` / `intent_tags.task_goal` | 检索维度 | P1 |
| `failed_skill` / `error_summary` | 检索维度 | P1 |
| `source_session` / `message_range` / `created_at` / `verified_at` / `verified_by` | 审计字段 | P1 |
| `rejected_at` / `rejected_reason` | 拒绝字段 | P1 |

### 测试

- 75 个 pytest 测试，全部通过
- 覆盖 6 个模块：config(10) / models(16) / git_ops(8) / frontmatter(19) / migration(7) / server(21)

---

## P2 已完成明细

### P2.1 — REVIEW.md STEP V3 MCP 化

**改动文件：** `REVIEW.md`（167 → 188 行）

- STEP V3 从直接 append `aristotle-learnings.md` 改为 MCP 工具调用链：
  - V3a: `write_rule` — 创建规则文件（pending）
  - V3b: `stage_rule` — 标记 staging
  - V3c: 审核级别决策（当前固定 semi 模式，P4 将接入 Δ 因子）
  - V3d: 状态文件更新
  - V3e: 输出确认
- STEP V2 confirm 路由更新：confirm → V2b → V3
- Review Mode Permissions 扩展：新增 MCP 工具调用权限

### P2.2 — REFLECTOR.md STEP R4 输出协议扩展

**改动文件：** `REFLECTOR.md`（172 → 195 行）

- STEP R4 DRAFT 模板新增 3 个字段：
  - `Intent Tags`: domain + task_goal
  - `Failed Skill`: 工具/技能 ID
  - `Error Summary`: ≤100 字符错误摘要
- Summary 表新增 Intent Domain 列
- 新增 "GEAR Field Inference Guide" 子节：domain 常见值映射、task_goal 推断、failed_skill 示例、error_summary 约束

### P2.3 — REVIEW.md C 角色 Schema 校验

**改动文件：** `REVIEW.md`（同 P2.1）

- 新增 STEP V2b（Schema Validation — C Role）：
  - V2b-1: 必填项检查（id/category/intent_tags/error_summary）
  - V2b-2: 格式校验（intent_tags.domain 必填、category 必须为 8 种之一）
  - V2b-3: 校验结果路由（通过→V3、硬性失败→rejected、软性警告→自动修正）

### P2.4 — E2E 验证

- 75/75 pytest 通过
- GEAR.md 协议文档创建（从 GASC 重命名 + 定位收敛为错误反思领域协议）
- README 双语文档更新（Design section、8 tools、75 tests、frontmatter 示例）

---

## P3 已完成明细

### P3.1 — LEARN.md 学习检索协议

**新增文件：** `LEARN.md`（214 行）

- 定义完整的 L→O→S→O→L 学习检索协议
- STEP L1：接收学习请求（4 种触发场景：主动/参数化/自然语言/被动触发 P3.3）
- STEP L2：O 的意图提取（domain 推断表、阈值评估）
- STEP L3：S 的查询构造（参数构建规则、关键词提取策略、MCP 调用）
- STEP L4：O 的过滤与压缩（相关性排序、去重、≤5 条数量控制、摘要格式）
- STEP L5：返回精炼摘要给 L（L 不感知任何反思基础设施）
- STEP L6：错误反馈升级（错误现场报告 → O 拉起 R/C → 新一轮反思）

### P3.2 — SKILL.md 路由扩展

**改动文件：** `SKILL.md`（84 → 90 行）

- Phase 表新增 Learn 行
- Parse Arguments 新增 3 条 learn 命令
- Execute Route 新增 learn 路由

### P3.3 — 被动触发（多 Agent 错误监听）

**改动文件：** `SKILL.md`（description）、`REFLECT.md`（128 行）

- SKILL.md description 追加 11 个多 agent 错误检测关键词（英 6 + 中 5）
- REFLECT.md STEP F1 新增 Passive Trigger (P3.3) 子节
- REFLECT.md STEP F6 被动触发完成通知格式区分

### P3.4 — Sync 自愈机制

**改动文件：** `git_ops.py`、`server.py`、`LEARN.md`、`test/test_mcp.py`

- `git_ops.py` 新增 `git_show_exists()` 函数
- `server.py` 新增 2 个 MCP 工具：`check_sync_status`（检测未 commit 的 verified 规则）、`sync_rules`（补提）
- MCP 工具总数：8 → 10
- `LEARN.md` STEP L3c 追加 sync 自愈说明
- pytest 测试：75 → 82（新增 TestSyncTools 类 7 个测试）
- **设计改进**：用 O 主动调用 `check_sync_status` 替代原始的 `.signal` 文件机制，符合上下文隔离原则

### P3 关键设计决策（已确认）

1. **S 先作为 O 内的函数调用实现**，非独立 subagent
2. **L 不参与代码重构**：学习后仍犯错 → 向 O 报告 → O 拉起 R/C
3. **被动触发**：多 agent 场景中，agent B 检查 agent A 工作时发现错误并说出，Aristotle 监听到后启动反思循环
4. **LEARN.md 作为独立协议文件**：与 REFLECT.md / REVIEW.md 同级

---

## P4 已完成明细

### P4.1 — config.py 新增常量

**改动文件：** `config.py`（60 → 68 行）

- 新增 `RISK_WEIGHTS`：`{high: 0.8, medium: 0.5, low: 0.2}`
- 新增 `AUDIT_THRESHOLDS`：`{auto: 0.7, semi: 0.4}`

### P4.2 — evolution.py 新模块

**新增文件：** `evolution.py`（53 行）

- `compute_delta(confidence, risk_level)` — Δ = confidence × (1 − risk_weight)，含输入校验
- `decide_audit_level(delta)` — 对照 AUDIT_THRESHOLDS 返回 auto/semi/manual
- 无状态模块，不依赖 stats 文件

### P4.3 — get_audit_decision MCP 工具

**改动文件：** `server.py`（+40 行）

- 新增 `get_audit_decision(file_path)` MCP 工具
- 读取 staging 规则的 confidence + risk_level，调用 evolution.py 计算 Δ
- 返回 delta、audit_level、confidence、risk_level、thresholds
- MCP 工具总数：10 → 11

### P4.4 — write_rule confidence 参数

**改动文件：** `server.py`

- `write_rule` 新增 `confidence: float = 0.7` 参数
- 替换原来硬编码的 `confidence=0.7`
- 向后兼容（默认值不变）

### P4.5 — REVIEW.md V3c 动态审核

**改动文件：** `REVIEW.md`

- V3c 从固定 semi 模式改为调用 `get_audit_decision` 动态决策
- 三级分支：auto（直接 commit）、semi（展示 diff 等确认）、manual（强制 CHECKER.md 校验）
- 输出格式包含 Δ 值、confidence、risk_level

### P4.6 — GEAR.md 更新

**改动文件：** `GEAR.md`

- "Evolution Levels" 子节重写为 "Evolution Levels (Deferred)"
- 记录三个未决问题：进化目标、反馈信号、C 的学习路径
- Δ 决策引擎标注为已实现

### P4.7 — 测试

- pytest：84 → 104（新增 TestEvolution 10 + TestDeltaDecision 8 + TestConfig +2）
- 覆盖：compute_delta（3 risk_level × 多 confidence + 边界值 + 输入校验）、decide_audit_level（3 级）、get_audit_decision（auto/semi/manual + 不存在文件）、write_rule confidence（默认/自定义/Δ 影响级别）

---

## P4 待实施明细

> 范围收敛：仅实现 Δ 决策引擎，暂不实现进化等级。详见下方"未决问题"。

| 子任务 | 内容 |
|--------|------|
| **P4.1** | `evolution.py` 新模块：`compute_delta(confidence, risk_level)` + `decide_audit_level(delta)` |
| **P4.2** | `get_audit_decision` MCP 工具：输入 file_path，返回 Δ 值 + 审核级别 |
| **P4.3** | `write_rule` 新增 `confidence` 参数（R 设置置信度，当前硬编码 0.7） |
| **P4.4** | `REVIEW.md` STEP V3c 改造：从固定 semi 模式 → 调用 `get_audit_decision` 动态决策 |
| **P4.5** | config.py 新增 `RISK_WEIGHTS` 常量 + 测试 + 文档更新 |

### Δ 决策逻辑（逐条规则）

```
Δ = confidence × (1 − risk_weight)

risk_weight:
  high   → 0.8  (HALLUCINATION, MISUNDERSTOOD_REQUIREMENT)
  medium → 0.5  (INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, ASSUMED_CONTEXT, SYNTAX_API_ERROR)
  low    → 0.2  (PATTERN_VIOLATION, OVERSIMPLIFICATION)

audit_level:
  Δ > 0.7  → auto   (无需人工确认，直接 commit)
  0.4–0.7  → semi   (展示 diff，等待用户确认)
  Δ ≤ 0.4  → manual (强制详细审核 + CHECKER.md 校验)
```

### 未决问题：进化等级（下一期处理）

**背景：** GEAR 协议定义了 apprentice → peer → expert 的进化模型，基于 success rate 和 consecutive verified 数自动升降审核阈值。经分析发现当前实现该机制存在根本性问题。

**核心问题：进化的对象是谁？**

GEAR 五个 agent（O/R/C/L/S）全部是 stateless 的协议执行者，不携带记忆。唯一持久化的是 git 规则库和协议文档。调整阈值并不能让任何 agent 变得更聪明，只是减少了人工审核。

**具体障碍：**

1. **反馈信号不可靠** — `verified/(verified+rejected)` 比率反映的是用户行为模式变化，不是系统质量提升
2. **C 无法从历史中学习** — C 只执行 CHECKER.md 协议，不读规则库，threshold 降低不会提升审核准确率
3. **数据积累太慢** — Aristotle 规则产出频率低（用户犯错才触发），50 consecutive verified 可能需要数月
4. **真正的进化路径未明确** — C 的能力提升需要"C 知道自己过去犯过什么错"，这意味着需要区分"给 L 的执行规则"和"给 C 的审核教训"，属于架构层面的重新设计

**下一期需要回答的问题：**

1. 进化的对象是什么？（R 产出质量 / C 审核能力 / 管线可靠性 / threshold 本身）
2. 反馈信号来源是什么？（verify/reject 比？L 的 error feedback？用户长期满意度？）
3. 进化结果作用在哪里？（threshold 调整？协议文档更新？规则库补充审核案例？）
4. 是否需要为 C 建立独立的"审核教训"规则体系？

### 遗留优化项（未来版本）

- **触发关键词外置化**：将 SKILL.md description 中的 reflect 触发关键词（含多 agent 错误检测词）提取到独立文件（如 `TRIGGERS.md`），支持在使用中积累用户对错误的表达习惯。属于 P5 或更后期的优化。

---

## 已交付文件清单（P1 + P2 + P3）

```
aristotle_mcp/
├── __init__.py          (2 行)
├── config.py            (68 行) — 路径解析、常量、RISK_MAP、RISK_WEIGHTS、AUDIT_THRESHOLDS
├── models.py            (150 行) — RuleMetadata + GEAR 字段 + YAML helpers
├── evolution.py         (53 行) — Δ 决策引擎（compute_delta + decide_audit_level）
├── git_ops.py           (124 行) — Git 抽象层 + git_show_exists
├── frontmatter.py       (180 行) — 流式过滤 + 多维度搜索 + 原子写入
├── migration.py         (160 行) — 迁移 + git check + 仓库初始化
└── server.py            (820 行) — FastMCP 入口 + 11 个工具

GEAR.md                  (445 行) — GEAR 协议规范（进化等级 deferred，Δ 决策已实现）
SKILL.md                 (90 行) — 路由器（reflect/review/learn/sessions 四路由）
REFLECT.md               (128 行) — 反思协调（含被动触发 P3.3）
REFLECTOR.md             (195 行) — R 子代理协议（P2.2 已扩展输出）
REVIEW.md                (175 行) — 审核协调（V3c 已改为 Δ 动态决策）
CHECKER.md               (60 行) — 审核者协议（仅 confirm 时加载）
LEARN.md                 (246 行) — L 学习检索协议（两轮查询 + subagent 评分）

pyproject.toml           — uv + setuptools
test/test_mcp.py         (1370+ 行) — 104 pytest 测试
README.md                — 英文文档（含 GEAR Design section）
README.zh-CN.md          — 中文文档（含 GEAR Design section）
```

---

## Git 提交记录（git-mcp 分支）

| Hash | Message |
|------|---------|
| `ef1e19b` | refactor: rename GASC to GEAR in REFLECTOR and tests |
| `4c51b98` | docs: add GEAR design section to READMEs and update tool/test counts |
| `2782987` | docs: add GEAR protocol specification |
| `c9de531` | feat: integrate MCP tool chain and C role schema validation into REVIEW protocol |
| `7ff1e5a` | docs: extend REFLECTOR STEP R4 with GEAR 2.0 intent/skill/summary fields |
| `54f4c11` | test: add 21 tests for GEAR 2.0 schema, multi-dimension search, restore_rule, and git check |
| `be225a6` | feat: add GEAR 2.0 schema fields, multi-dimension search, and restore_rule tool |
| `e0eba9e` | feat: add Git-backed MCP server for rule versioning |

---

## 下一步

P1–P4 全部完成。后续开发计划见项目根目录 `ROADMAP.md`（纳入 git 版本管理）。

本文档至此归档。后续进展不再更新此文件。
