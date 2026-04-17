# Aristotle 🦉

**[English](./README.md)** | 中文

> *认识自己，是一切智慧的开端。* — 亚里士多德

**Aristotle** 是一个 [OpenCode](https://github.com/opencode-ai/opencode) 技能（skill）——错误反思与学习代理。

通过 `/aristotle` 激活，启动一个隔离的子代理，分析会话中模型的错误，执行 5-Why 根因分析，生成 DRAFT 规则。所有规则先呈现为草稿，经你确认、修改或驳回后才写入磁盘。

## 功能特性

- **渐进披露架构** — 技能按需加载：路由器（84行）→ 反思（106行）→ 审核（156行）。每个阶段按需加载，不浪费上下文。
- **隔离式反思** — 分析在独立的后台会话中运行，主会话上下文零污染
- **5-Why 根因分析** — 8 大错误分类结构化分析（需求误解、上下文假设、模式违反、幻觉、分析不充分、工具选错、过度简化、语法/API 错误）
- **DRAFT → 审核 → 确认工作流** — 规则生成 DRAFT 草稿（含位置元数据）；用户在专用审核会话中通过 `/aristotle review N` 逐一确认、修改或驳回
- **精确定位错误** — `--focus` 参数可定向分析会话的特定部分（最后交互、第 N 条消息附近、关键词之后、仅错误扫描、或全量扫描）
- **二次反思** — 审核中可要求对特定错误做更深入分析。DRAFT 元数据（session ID、消息范围、错误摘录）使新反思器可精确定位，无需重新扫描整个会话
- **状态追踪** — `~/.config/opencode/aristotle-state.json` 追踪所有反思记录及其状态（draft → confirmed → revised），通过 `/aristotle sessions` 列出和管理历史
- **双语支持** — 同时检测英文和中文（zh-CN）的错误纠正模式
- **双层输出** — 用户级规则（`~/.config/opencode/aristotle-learnings.md`）全局生效；项目级规则（`.opencode/aristotle-project-learnings.md`）按项目生效
- **自动建议** — 技能描述中包含错误纠正关键词；当对话中出现这些模式时，AI 会自动建议运行 `/aristotle`（无需配置）

## 安装

### 方式一：手动安装（macOS / Linux）

```bash
# 克隆仓库
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
cd ~/.claude/skills/aristotle

# 运行安装脚本
bash install.sh
```

### 方式二：手动安装（Windows）

```powershell
# 克隆仓库
git clone https://github.com/alexwwang/aristotle.git "$env:USERPROFILE\.claude\skills\aristotle"

# 运行安装脚本
cd "$env:USERPROFILE\.claude\skills\aristotle"
powershell -ExecutionPolicy Bypass -File install.ps1
```

### 方式三：直接克隆（跳过安装脚本）

OpenCode 会自动发现 `~/.claude/skills/` 下的 SKILL.md，无需安装脚本：

```bash
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
```

> **注意：** 此方式跳过了方式一中的 learnings 文件初始化。首次运行时该文件会自动创建。

### 方式四：自引导安装（粘贴到 OpenCode 对话中）

将以下 prompt 粘贴到任意 OpenCode 会话中 — 它会自动为你安装 Aristotle：

```
Install the Aristotle skill from https://github.com/alexwwang/aristotle.git to ~/.claude/skills/aristotle by cloning the repo, then run the install script (install.sh on macOS/Linux, install.ps1 on Windows). Verify the installation by running bash test.sh from the cloned directory — all 63 assertions must pass. After that, delete the cloned source directory (the installed copy at ~/.claude/skills/aristotle is what matters).
```

## 使用方法

### 命令列表

| 命令 | 说明 |
|------|------|
| `/aristotle` | 反思**当前**会话（聚焦最后交互） |
| `/aristotle last` | 反思**上一个**会话（见下方目标解析） |
| `/aristotle session ses_xxx` | 通过 **OpenCode session ID** 反思指定会话 |
| `/aristotle recent N` | 反思第 **N** 近的会话（N=1 为最近的，非当前） |
| `/aristotle --focus <hint>` | 定向分析特定区域（见下方聚焦选项） |
| `/aristotle --model <model>` | 为反思器指定模型 |
| `/aristotle sessions` | 列出所有反思记录及状态（带序号） |
| `/aristotle review N` | 加载第 **N** 条反思的 DRAFT 到当前会话审核（N 为 `sessions` 输出中的序号） |

### 目标解析

Aristotle 通过 `session_list` 解析目标会话。规则如下：

| 目标 | 解析方式 |
|------|---------|
| *（无参数）* | 当前会话 — 即运行 `/aristotle` 的会话 |
| `last` | `session_list` 输出中当前会话的前一个会话，无论其是否"打开"。OpenCode 会话没有完成/关闭状态 — 它们按最后活动时间排序。 |
| `session ses_xxx` | 通过 OpenCode session ID（格式：`ses_` 前缀 + 字母数字）直接查找。此处的 ID 是**目标会话的 ID**（包含错误的会话），不是反思器的 session ID。 |
| `recent N` | `session_list` 中排除当前会话后的第 N 条。`recent 1` = 当前会话的紧前一条，`recent 3` = 第 3 近的。对**那一个**会话启动反思器。 |

> **注意：** 如果你同时打开了多个 OpenCode 实例，所有会话都会出现在 `session_list` 中（按最后活动时间排序）。`last` 和 `recent N` 直接从列表中选取 — 不会跳过"打开中"的会话。如果想精确指定某个会话，请用 `session <id>`。

### 聚焦选项

限制反思器在目标会话中的扫描范围：

| 聚焦参数 | 行为 |
|----------|------|
| `last`（默认） | 目标会话的最后 50 条消息 |
| `after "文本"` | 从首次出现"文本"的位置到会话末尾 |
| `around N` | 第 N-10 到 N+10 条消息（20 条消息窗口） |
| `error` | 扫描整个会话，但只提取错误纠正模式（跳过无错部分） |
| `full` | 扫描整个会话（适用于短会话或全面审查） |

### 审核工作流

1. **列出反思记录**：`/aristotle sessions` → 显示带序号的列表及状态
2. **选择一条**：`/aristotle review 2` → 加载第 2 条 DRAFT 到当前会话
3. **决定**：`confirm` / `修改 1: 反馈` / `放弃` / `重新反思`
4. **迭代**：继续审核其他记录，或要求更深入的二次反思

> `/aristotle review N` 中的序号 `N` 来自 `/aristotle sessions` 输出的 `#` 列。它**不是** OpenCode session ID — 而是反思记录列表中的位置编号。

```
反思阶段                         审核阶段
──────────                      ──────────
/aristotle                      /aristotle review 1
  │                               │
  ├─ 加载 REFLECT.md               ├─ 加载 REVIEW.md
  │  (106 行)                     │  (156 行)
  │                               │
  ├─ 启动反思器 ───────►           ├─ 读取反思器会话
  │  (后台任务)             DRAFT   │  提取 DRAFT 报告
  │                        ──────► │
  ├─ 更新状态文件                  ├─ 呈现 DRAFT 给用户
  ├─ 一行通知                      ├─ 处理确认/修改/驳回
  └─ 停止                         ├─ 确认时写入规则
                                  └─ 需要时二次反思
                                     （加载 REFLECT.md）
```

## Aristotle MCP Server

Aristotle 附带一个可选的 MCP（Model Context Protocol）服务器，为学习规则增加 **Git 版本控制**。没有它，规则是扁平的 Markdown 文件——无历史、无回滚、无法跨机器同步。有了它，每条规则都有 YAML frontmatter、状态追踪和完整的 git 历史。

### 为什么用 Git？

扁平的 `aristotle-learnings.md` 只能追加，没有版本管理。如果一条规则后来发现是错的，你只能手动删掉，而且不记得它原来写了什么。MCP server 解决了这个问题：

- **状态生命周期** — 规则经过 `pending → staging → verified`（或 `rejected`）的流转。没有经过显式 commit 的规则不会进入"生产环境"。
- **原子读取** — 消费端（未来的 Agent L）通过 `git show HEAD:` 读取，永远不会碰到磁盘上写了一半的草稿。
- **自愈机制** — 如果文件在磁盘上存在但没有 commit，系统会检测到这个缺口并重新触发提交流水线。
- **被拒规则可恢复** — 拒绝的文件移到 `rejected/{scope}/`，保留完整的原始元数据，随时可以还原。

### 架构

```
┌──────────────────────────────────────────────────┐
│  OpenCode (宿主)                                  │
│                                                   │
│  ┌───────────┐     MCP (stdio)    ┌────────────┐ │
│  │ Aristotle  │ ◄──────────────► │ aristotle   │ │
│  │ Skill      │    JSON-RPC       │ -mcp        │ │
│  └───────────┘                   └──────┬─────┘ │
│                                         │        │
│                              ┌──────────▼──────┐ │
│                              │ Git 仓库         │ │
│                              │                  │ │
│                              │ user/*.md        │ │
│                              │ projects/H/*.md  │ │
│                              │ rejected/*/      │ │
│                              └──────────────────┘ │
└──────────────────────────────────────────────────┘
```

### 存储结构

```
~/.config/opencode/aristotle-repo/     ← Git 仓库（真相源）
├── .git/
├── .gitignore
├── user/                               ← 用户级规则
│   └── 2026-04-10_hallucination.md
├── projects/                           ← 项目级规则
│   └── a1b2c3d4/                       ← SHA256(项目路径)[:8]
│       └── 2026-04-12_pattern_violation.md
└── rejected/                           ← 与上方镜像的目录结构
    ├── user/
    └── projects/a1b2c3d4/
```

每条规则文件包含 YAML frontmatter：

```yaml
---
id: "rec_1712743800"
status: "verified"
scope: "user"
category: "HALLUCINATION"
confidence: 0.85
risk_level: "high"

# GEAR Design 2.0 retrieval dimensions
intent_tags:
  domain: "database_operations"
  task_goal: "connection_pool_management"
failed_skill: "prisma_client"
error_summary: "P2024 connection pool timeout in serverless"

# Standard fields
source_session: "ses_abc123"
created_at: "2026-04-10T22:30:00+08:00"
verified_at: "2026-04-10T22:35:00+08:00"
verified_by: "auto"
---

## [2026-04-10] HALLUCINATION — 虚构的 API 方法
**Context**: ...
**Rule**: ...
```

### 规则状态生命周期

```
write_rule()
     │
     ▼
┌──────────┐
│ pending  │  磁盘上的未跟踪文件
└────┬─────┘
     │ stage_rule()
     ▼
┌──────────┐
│ staging  │  锁定，等待审核
└────┬─────┘
   ┌─┴─┐
   │   │
commit   reject_rule()
_rule()      │
   │         ▼
   ▼   ┌──────────┐
verified rejected/  （保留 scope 和元数据）
```

### 11 个 MCP 工具

| 工具 | 用途 |
|------|------|
| `init_repo` | 初始化 Git 仓库、创建目录结构、自动迁移现有扁平规则 |
| `write_rule` | 创建新规则文件（status: `pending`），附带 YAML frontmatter、GEAR 2.0 字段和置信度 |
| `read_rules` | 按状态、类别、scope 查询，或对 frontmatter 值做多维度正则匹配 |
| `stage_rule` | 标记规则为 `staging`（审核中） |
| `commit_rule` | 设置 status 为 `verified`，记录时间戳，执行 `git add && commit` |
| `reject_rule` | 移到 `rejected/{scope}/`，记录原因，删除原文件，提交 |
| `restore_rule` | 从 rejected 目录恢复规则到正式目录，设置新状态 |
| `list_rules` | 轻量元数据列表，支持全部搜索维度（不加载规则正文）。用于相关性评分后再选择性读取内容 |
| `check_sync_status` | 检测磁盘上存在但未提交到 git 的 verified 规则 |
| `sync_rules` | 将未同步的 verified 规则提交到 git（自动检测或指定文件） |
| `get_audit_decision` | 计算当前 staging 规则的 Δ = confidence × (1 − risk_weight)，返回审核级别（auto/semi/manual） |

### 流式 Frontmatter 检索

`read_rules` 使用两阶段搜索，针对数百个规则文件做了优化：

1. **阶段一（快）** — 只读每个文件的前 50 行，用正则匹配 frontmatter 的 KV 对。跳过不匹配的文件。不做 YAML 解析。
2. **阶段二（完整）** — 只对匹配的文件做完整的 frontmatter 解析和正文加载。

500 个文件的场景下，阶段一约 80ms 完成。总搜索时间（20 条命中）：约 180ms。

### 两轮查询架构（学习阶段）

学习阶段（`/aristotle learn`）使用上下文高效的两轮查询，避免大量规则正文撑爆 O 的上下文：

```
Round 1: list_rules(params) → 候选路径 + 元数据（不含正文）
                ↓
Round 2: O 启动 N 个并行评分子代理
          subagent_i(查询, 规则路径) → 读取 1 条规则 → 打分 1-10 → 返回 {score, reason}
                ↓
O 收集打分 → 排序 → 取 Top MAX_LEARN_RESULTS（默认: 5）
                ↓
O 压缩 Top-N 为最小摘要 → 注入 L 的上下文
```

- **O 永远不直接读取规则正文**——只做编排（启动、收集、排序、压缩）
- **每个子代理上下文极小**——一条查询 + 一条规则文件
- **评分依赖完整 markdown 正文**——Context、Rule 和 Example 部分都参与相关性判断
- **`list_rules` 和 `read_rules` 共享同一搜索引擎**——`stream_filter_rules()`——但返回不同重量的结果

### 安装

#### 前置条件

- Python 3.10+
- [uv](https://docs.astral.sh/uv/)（推荐）或 pip/mamba

#### 方式一：手动安装

```bash
# 克隆并进入仓库
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
cd ~/.claude/skills/aristotle

# 用 uv 安装依赖（自动创建 .venv）
uv sync
```

然后在 `opencode.json` 中添加：

```jsonc
{
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "~/.claude/skills/aristotle", "python", "-m", "aristotle_mcp.server"],
      "enabled": true
    }
  }
}
```

或使用绝对路径：

```jsonc
{
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "/path/to/aristotle", "python", "-m", "aristotle_mcp.server"],
      "enabled": true
    }
  }
}
```

通过环境变量 `ARISTOTLE_REPO_DIR` 自定义仓库位置（默认：`~/.config/opencode/aristotle-repo/`）。

#### 方式二：自引导安装（粘贴到 OpenCode 对话中）

将以下 prompt 粘贴到任意 OpenCode 会话中：

```
Install the Aristotle MCP server from https://github.com/alexwwang/aristotle.git:
1. Clone to ~/.claude/skills/aristotle
2. cd into the cloned directory
3. Run `uv sync` to install Python dependencies
4. Add MCP config to opencode.json: type "local", command ["uv", "run", "--project", "~/.claude/skills/aristotle", "python", "-m", "aristotle_mcp.server"], enabled true
5. Verify by running `uv run python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools), 'tools loaded')"`
```

### 迁移

`init_repo` 首次运行时，会自动检测现有的 `aristotle-learnings.md` 文件并将其中的规则迁移到 Git 仓库。迁移默认值：

| 字段 | 值 | 理由 |
|------|---|------|
| `id` | `mig_N`（递增序号） | 区分迁移规则与新生成规则 |
| `status` | `verified` | 已有规则本质上都经过人工确认 |
| `confidence` | `0.7` | 保守默认值 |
| `risk_level` | 从 category 推导 | `HALLUCINATION` → high，`SYNTAX_API_ERROR` → medium，其余 → low |
| `verified_by` | `"migration"` | 标记来源 |
| `verified_at` | 等于 `created_at` | 从 Markdown 标题行解析 |

迁移完成后，原文件重命名为 `.bak`。

## 设计：GEAR 2.0

Aristotle 是 **[GEAR（Git-backed Error Analysis & Reflection）](./GEAR.md)** 协议的一个实现——一个 AI agent 错误反思、学习与预防的协议。不再是扁平的追加写入文件，规则经过状态机流转，带有 schema 校验、意图驱动检索和基于进化模型的审核级别。

**GEAR 角色 → Aristotle 映射：**

| GEAR 角色 | Aristotle 实现 | 状态 |
|-----------|---------------|------|
| **O**（统筹者） | `SKILL.md` + `REFLECT.md` + `REVIEW.md` + `LEARN.md` | ✅ 已实现 |
| **R**（生产者） | `REFLECTOR.md`（子代理） | ✅ 已实现 |
| **C**（审计者） | `REVIEW.md` STEP V2b（schema 校验） | ✅ 已实现 |
| **L**（学习者） | `LEARN.md` | ✅ 已实现 |
| **S**（检索者） | O 内的函数调用（LEARN.md STEP L3） | ✅ 已实现 |

GEAR 协议操作映射到 Aristotle 的 MCP 工具：`produce` → `write_rule`、`stage` → `stage_rule`、`verify` → `commit_rule`、`reject` → `reject_rule`、`restore` → `restore_rule`、`search` → `read_rules`、`sync` → `check_sync_status` + `sync_rules`、`audit_decision` → `get_audit_decision`。

完整的协议规范——状态机、frontmatter schema、Δ 决策因子和一致性要求——详见 **[GEAR.md](./GEAR.md)**。

## 测试

### 静态测试（无需会话）

```bash
bash test.sh
```

63 个断言，覆盖文件结构、渐进披露、SKILL.md 内容、错误模式检测（英文/中文/阈值）和架构保证。

### MCP Server 单元测试

```bash
uv run pytest test/test_mcp.py -v
```

104 个断言，覆盖全部 9 个模块/测试类：

| 测试类 | 模块 | 断言数 | 测试内容 |
|--------|------|--------|----------|
| `TestConfig` | `config.py` | 12 | 路径解析、环境变量覆盖、RISK_MAP、RISK_WEIGHTS、AUDIT_THRESHOLDS、项目哈希 |
| `TestEvolution` | `evolution.py` | 10 | compute_delta（所有 risk_level、边界值、输入校验）、decide_audit_level（auto/semi/manual）、集成测试 |
| `TestModels` | `models.py` | 16 | RuleMetadata 默认值、YAML 序列化往返、from_frontmatter_dict、GEAR 2.0 字段测试 |
| `TestGitOps` | `git_ops.py` | 9 | init、add+commit、show、log、status、git_show_exists、边界情况 |
| `TestFrontmatter` | `frontmatter.py` | 19 | 原子写入、原始读取、字段更新、流式过滤（status/category/keyword/limit）、跳过索引文件、多维度搜索测试 |
| `TestMigration` | `migration.py` | 7 | 扁平 Markdown 解析、仓库初始化、自动迁移并备份 |
| `TestServerTools` | `server.py` | 21 | 完整生命周期（write → stage → commit → read）、拒绝流程、restore_rule、输入校验、GEAR 2.0 字段、git 检查测试 |
| `TestSyncTools` | `server.py` | 7 | check_sync_status（干净/脏数据/无仓库）、sync_rules（自动/指定文件/无待同步）、git_show_exists |
| `TestDeltaDecision` | `server.py` + `evolution.py` | 8 | get_audit_decision（auto/semi/manual）、write_rule confidence（默认/自定义）、Δ 影响审核级别 |

所有测试使用隔离的临时目录（`tmp_path` fixture），可安全反复运行。

### E2E 实时测试（需要 opencode 会话）

```bash
bash test/live-test.sh --model <provider/model>
```

创建真实会话，注入已知错误模式，触发 `/aristotle`，验证完整的协调器 → 反思器 → 规则写入流程。8 个断言。

## 项目结构

```
.
├── SKILL.md              # 路由器 — 参数解析、阶段路由（90 行）
├── REFLECTOR.md          # 子代理协议 — 错误分析、DRAFT 生成
├── REFLECT.md            # 协调器反思阶段 — 启动子代理、状态追踪、被动触发
├── REVIEW.md             # 协调器审核阶段 — DRAFT 审核、规则写入、修订
├── CHECKER.md            # 审核者协议 — schema + 内容校验（仅确认时加载）
├── LEARN.md              # 协调器学习阶段 — 意图提取、查询构造、结果过滤
├── install.sh            # 安装脚本（macOS/Linux）
├── install.ps1           # 安装脚本（Windows）
├── pyproject.toml        # MCP server 的 Python 依赖声明
├── test.sh               # 静态测试套件（63 断言）
├── aristotle_mcp/        # MCP server（Git 支持的规则管理）
│   ├── __init__.py
│   ├── config.py         # 路径、常量、环境变量、RISK_WEIGHTS、AUDIT_THRESHOLDS
│   ├── models.py         # RuleMetadata 数据类、YAML 序列化
│   ├── git_ops.py        # Git 抽象层（init、add+commit、show、log、status、show_exists）
│   ├── frontmatter.py    # 流式 frontmatter 搜索、原子写入
│   ├── evolution.py      # Δ 决策引擎（compute_delta、decide_audit_level）
│   ├── migration.py      # 扁平 Markdown → Git 仓库迁移
│   └── server.py         # FastMCP 入口，10 个工具
└── test/
    └── live-test.sh      # E2E 实时测试（8 断言）
```

## 架构：渐进披露

技能拆分为六个文件。触发时仅加载 `SKILL.md`（90 行），其余按需加载：

| 场景 | 加载文件 | 行数 |
|------|---------|------|
| `/aristotle`（反思） | SKILL.md + REFLECT.md | 218 |
| `/aristotle sessions` | 仅 SKILL.md | 90 |
| `/aristotle review N` | SKILL.md + REVIEW.md | 257 |
| `/aristotle review N`（确认时） | SKILL.md + REVIEW.md + CHECKER.md | 317 |
| `/aristotle learn` | SKILL.md + LEARN.md | 346 |
| 审核 + 二次反思 | SKILL.md + REVIEW.md + REFLECT.md | 385 |
| 子代理（内部） | REFLECTOR.md | ~195 |

## 已知问题与贡献方向

欢迎 PR！以下是需要改进的具体方向：

### 中优先级

- **子代理 `session_read` 可用性** — 反思器子代理依赖 `session_read()` 读取会话内容，但部分模型/提供商组合不提供此工具。需要优雅的降级路径。
- **多模型 E2E 测试** — 实时测试仅验证用户指定的模型。应跨多个提供商/模型测试以验证可移植性。

### 锦上添花

- ~~**规则版本与过期**~~ — 已由 MCP server（Git 版本控制）解决。规则现在有完整的 commit 历史，可以拒绝/恢复。过期清理机制仍有待实现。
- **`count_matches` 跨平台测试** — 测试套件的 `count_matches` 辅助函数在 GNU grep 上工作，但应在 Alpine（BusyBox）、macOS（BSD grep）等非 GNU 环境上测试。

## 卸载

```bash
# 移除技能
rm -rf ~/.claude/skills/aristotle

# 移除用户级学习规则（可选）
rm -f ~/.config/opencode/aristotle-learnings.md
rm -f ~/.config/opencode/aristotle-learnings.md.bak

# 移除状态文件（可选）
rm -f ~/.config/opencode/aristotle-state.json

# 移除 MCP 规则仓库（可选）
rm -rf ~/.config/opencode/aristotle-repo

# 从 opencode.json 中移除 MCP 配置（手动编辑）
# 删除 "mcp" 部分中的 "aristotle" 条目
```

## 为什么是 `~/.claude/skills/`？—— Skill 发现机制调查

你可能会好奇，为什么这个技能必须安装到 `~/.claude/skills/`，而不是看起来更自然的 `~/.config/opencode/skills/` 等位置。

### OpenCode 的 Skill 发现机制（v1.3.15）

OpenCode 的 skill 发现按以下顺序扫描目录：

1. **`EXTERNAL_DIRS`** — 全局扫描 `~/.claude/` 和 `~/.agents/`，匹配 `skills/**/SKILL.md`
2. **`EXTERNAL_DIRS`** 项目级 — 扫描 `<项目>/.claude/` 和 `<项目>/.agents/`
3. **`configDirs`** — 扫描 `~/.config/opencode/`，匹配 `{skill,skills}/**/SKILL.md`
4. **`skills.paths`** — 从 `opencode.json` 配置读取自定义路径
5. **`skills.urls`** — 从远程 URL 获取 skill

### 根因

`EXTERNAL_DIRS` 对 `.claude` 的扫描是 OpenCode v1.3.15 中唯一完全正常工作的发现路径。详见 [GitHub issues](https://github.com/anomalyco/opencode/issues/16524)。

### ⚠️ 避坑：不要对 skills 目录使用符号链接

OpenCode 内部的 glob 遍历**不会跟随目录符号链接**。请使用真实目录：

```bash
# ✅ 真实目录 — 始终有效
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
```

## 许可证

MIT
