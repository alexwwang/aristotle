# Aristotle 🦉

[![CI](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml/badge.svg)](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alexwwang/aristotle?include_prereleases)](https://github.com/alexwwang/aristotle/releases)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-649%20total-brightgreen)](./docs/testing.zh-CN.md)

**[English](./README.md)** | 中文

> *认识自己，是一切智慧的开端。* — 亚里士多德

**Aristotle** 是一个 [OpenCode](https://github.com/opencode-ai/opencode) 技能（skill）——错误反思与学习代理。

通过 `/aristotle` 激活，启动一个隔离的子代理，分析会话中模型的错误，执行 5-Why 根因分析，生成 DRAFT 规则。所有规则先呈现为草稿，经你确认、修改或驳回后才写入磁盘。

## 功能特性

- **渐进披露架构** — 技能按需加载：路由器（5.6 KB）→ 反思（4.6 KB）→ 审核（6.8 KB）。每个阶段按需加载，不浪费上下文。
- **隔离式反思** — 分析在独立的后台会话中运行，主会话上下文零污染
- **5-Why 根因分析** — 8 大错误分类结构化分析（需求误解、上下文假设、模式违反、幻觉、分析不充分、工具选错、过度简化、语法/API 错误）
- **DRAFT → 审核 → 确认工作流** — 规则生成 DRAFT 草稿（含位置元数据）；用户在专用审核会话中通过 `/aristotle review N` 逐一确认、修改或驳回
- **精确定位错误** — `--focus` 参数可定向分析会话的特定部分（最后交互、第 N 条消息附近、关键词之后、仅错误扫描、或全量扫描）
- **二次反思** — 审核中可要求对特定错误做更深入分析。DRAFT 元数据（session ID、消息范围、错误摘录）使新反思器可精确定位，无需重新扫描整个会话
- **状态追踪** — `~/.config/opencode/aristotle-state.json` 追踪所有反思记录及其状态（draft → confirmed → revised），通过 `/aristotle sessions` 列出和管理历史
- **双语支持** — 同时检测英文和中文（zh-CN）的错误纠正模式
- **双层输出** — 用户级规则（`~/.config/opencode/aristotle-learnings.md`）全局生效；项目级规则（`.opencode/aristotle-project-learnings.md`）按项目生效
- **自动建议** — 技能描述中包含错误纠正关键词；当对话中出现这些模式时，AI 会自动建议运行 `/aristotle`（无需配置）
- **Bridge 插件（可选）** — 面向无 OMO 支持环境的异步轮询式反思。通过 PRE-RESOLVE 快照提取捕获错误上下文，后台运行反思器，空闲检测判定完成。支持 `/undo` 取消进行中的反思任务。

## 安装

Aristotle 包含三个组件，均从同一仓库安装：

1. **Skill** — OpenCode 加载的协议文件（`SKILL.md`、`REFLECT.md` 等）
2. **MCP Server** — 基于 Python 的 Git 版本管理规则引擎（`aristotle_mcp/`）
3. **Bridge 插件**（可选）— 基于 TypeScript 的异步反思，面向无 OMO 支持的环境（`plugins/aristotle-bridge/`）。仅在需要轮询式后台反思时安装。

### 方式一：手动安装（macOS / Linux）

```bash
# 1. 克隆仓库
git clone https://github.com/alexwwang/aristotle.git /tmp/aristotle
cd /tmp/aristotle

# 2. 运行安装脚本（部署 SKILL.md + MCP server + Bridge 插件）
bash install.sh

# 3. 添加 MCP 配置到 opencode.json
# 见下方"MCP 配置"部分的 JSON 示例

# 4.（可选）在 opencode.json 中注册 Bridge 插件
# 将 "file://$HOME/.config/opencode/aristotle-bridge/index.js" 添加到 "plugin" 数组
```

### 方式二：手动安装（Windows）

```powershell
# 1. 克隆仓库
git clone https://github.com/alexwwang/aristotle.git "$env:TEMP\aristotle"

# 2. 运行安装脚本（部署 SKILL.md + MCP server + Bridge 插件）
cd "$env:TEMP\aristotle"
powershell -ExecutionPolicy Bypass -File install.ps1

# 3. 添加 MCP 配置到 opencode.json
# 见下方"MCP 配置"部分的 JSON 示例

# 4.（可选）在 opencode.json 中注册 Bridge 插件
# 将 "file://$env:USERPROFILE\.config\opencode\aristotle-bridge\index.js" 添加到 "plugin" 数组
```

### 方式三：直接下载（仅 skill，不含 MCP）

OpenCode 会自动发现 `~/.config/opencode/skills/` 下的 SKILL.md，无需克隆完整仓库：

```bash
mkdir -p ~/.config/opencode/skills/aristotle
curl -sL https://raw.githubusercontent.com/alexwwang/aristotle/main/SKILL.md -o ~/.config/opencode/skills/aristotle/SKILL.md
```

> **注意：** 此方式只有基础 skill，不含 MCP server。你将无法获得 Git 版本控制、Δ 审核决策和规则状态管理。需运行 `install.sh` 或手动复制 MCP 文件并添加 MCP 配置（见下方）才能启用完整功能。learnings 文件会在首次运行时自动创建。

### 方式四：自引导安装（粘贴到 OpenCode 对话中）

将以下提示词粘贴到任意 OpenCode 会话中 — 它会自动为你安装完整的 Aristotle：

```
Install the Aristotle skill with MCP server from https://github.com/alexwwang/aristotle.git:
1. Clone to /tmp/aristotle
2. cd into the cloned directory, run `bash install.sh` (macOS/Linux) or `powershell -File install.ps1` (Windows)
3. Verify: run `bash test.sh` — all assertions must pass
4. Add MCP config to opencode.json: { "mcp": { "aristotle": { "type": "local", "command": ["uv", "run", "--project", "$HOME/.config/opencode/aristotle", "python", "-m", "aristotle_mcp.server"], "enabled": true } } }
5. (Optional) Register Bridge Plugin: add `"file://$HOME/.config/opencode/aristotle-bridge/index.js"` to the `"plugin"` array in opencode.json
6. Verify MCP: run `uv run --project $HOME/.config/opencode/aristotle python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools), 'tools loaded')"` — should print "20 tools loaded"
```

> **提示：** 你也可以通过 `opencode.json` 免克隆安装 skill。将仓库 URL 添加到 `skills.urls`：
> ```jsonc
> {
>   "skills": {
>     "urls": ["https://github.com/alexwwang/aristotle.git"]
>   }
> }
> ```
> 然后重启 OpenCode，skill 会自动拉取。你仍需单独执行 `uv sync` 并添加 MCP 配置。

### MCP 配置

将以下内容添加到你的 `opencode.json` 以启用 MCP server：

```jsonc
{
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "$HOME/.config/opencode/aristotle", "python", "-m", "aristotle_mcp.server"],
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
      "command": ["uv", "run", "--project", "/home/username/.config/opencode/aristotle", "python", "-m", "aristotle_mcp.server"],
      "enabled": true
    }
  }
}
```

通过环境变量 `ARISTOTLE_REPO_DIR` 自定义规则仓库位置（默认：`~/.config/opencode/aristotle-repo/`）。

## 使用方法

### 命令列表

| 命令 | 说明 |
|------|------|
| `/aristotle` | 反思**当前**会话（聚焦最后交互） |
| `/aristotle last` | 反思**上一个**会话（见下方目标解析）*（待实现）* |
| `/aristotle session ses_xxx` | 通过 **OpenCode session ID** 反思指定会话 *（待实现）* |
| `/aristotle recent N` | 反思第 **N** 近的会话（N=1 为最近的，非当前） *（待实现）* |
| `/aristotle --focus <hint>` | 定向分析特定区域（见下方聚焦选项） *（待实现）* |
| `/aristotle --model <model>` | 为反思器指定模型 *（待实现 — 将改为配置文件方式，见下方说明）* |
| `/aristotle sessions` | 列出所有反思记录及状态（带序号） |
| `/aristotle review N` | 加载第 **N** 条反思的 DRAFT 到当前会话审核（N 为 `sessions` 输出中的序号） |

> **注意：** 标有 *（待实现）* 的命令是已设计但尚未实现的功能。当前 `/aristotle` 始终反思当前会话，使用 `focus: "last"`。

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
  │  (4.6 KB)                      │  (6.8 KB)
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

### 执行模式：Bridge vs 阻塞路径

Aristotle 的 Reflect→Check（R→C）链支持两种执行路径，自动选择：

```
两种路径均非阻塞——主会话不会被冻住。
区别在于谁来驱动 R→C 链式转换。
```

| | **Bridge 插件**（推荐） | **阻塞路径**（回退） |
|---|---|---|
| 激活条件 | `.bridge-active` 标记存在 | `.bridge-active` 标记不存在 |
| 子会话创建方式 | `promptAsync()` | `task(run_in_background=true)` |
| R→C 链驱动者 | Bridge 插件 idle handler（自动） | 主会话 LLM（手动） |
| 主会话参与 | 零——触发即忘 | 每次链式转换需要 LLM 调用 |
| 主会话 token 消耗 | 无 | 每步一次 LLM 调用 |
| 依赖 OMO？ | 否 | 否（有无 OMO 均可） |

```
Bridge 路径：主会话 → aristotle_fire_o(R) → STOP
             Bridge → [R 完成] → 自动启动 C → [C 完成] → notifyParent()

阻塞路径：  主会话 → task(R) → [R 完成，通知主会话] → 主会话 LLM 调用 MCP → task(C) → [C 完成，通知主会话] → ...
                    ↑ 主会话 LLM 在每一步都参与 ↑
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

# GEAR 意图标签（检索维度）
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

### 20 个 MCP 工具

| 工具 | 用途 |
|------|------|
| `init_repo` | 初始化 Git 仓库、创建目录结构、自动迁移现有扁平规则 |
| `write_rule` | 创建新规则文件（status: `pending`），附带 YAML frontmatter、意图标签和置信度 |
| `read_rules` | 按状态、类别、scope 查询，或对 frontmatter 值做多维度正则匹配 |
| `stage_rule` | 标记规则为 `staging`（审核中） |
| `commit_rule` | 设置 status 为 `verified`，记录时间戳，执行 `git add && commit` |
| `reject_rule` | 移到 `rejected/{scope}/`，记录原因，删除原文件，提交 |
| `restore_rule` | 从 rejected 目录恢复规则到正式目录，设置新状态 |
| `list_rules` | 轻量元数据列表，支持全部搜索维度（不加载规则正文）。用于相关性评分后再选择性读取内容 |
| `detect_conflicts` | 检测共享相同 (domain, task_goal, failed_skill) 三元组的已验证规则 |
| `check_sync_status` | 检测磁盘上存在但未提交到 git 的 verified 规则 |
| `sync_rules` | 将未同步的 verified 规则提交到 git（自动检测或指定文件） |
| `get_audit_decision` | 计算当前 staging 规则的 Δ = confidence × (1 − risk_weight)，返回审核级别（auto/semi/manual） |
| `persist_draft` | 持久化 DRAFT 报告到磁盘，供后续审核和二次反思（原子写入到 `aristotle-drafts/`） |
| `create_reflection_record` | 向状态文件追加新的反思记录，自动生成序号，处理 50 条记录裁剪 |
| `complete_reflection_record` | Checker 完成后更新反思记录状态 |
| `orchestrate_start` | 初始化 learn/reflect/review/sessions 命令的工作流，返回首个动作 |
| `orchestrate_on_event` | 接收子代理完成事件，更新状态机，返回下一个动作 |
| `orchestrate_review_action` | 处理用户审核操作（确认/驳回/修改/重新反思） |
| `on_undo` | 处理 Bridge 插件的 undo 信令——将工作流标记为已撤销 |
| `report_feedback` | 报告规则反馈，并可选触发反思工作流 |

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

### MCP 前置条件

- Python 3.10+
- [uv](https://docs.astral.sh/uv/)（推荐）或 pip/mamba

> MCP 配置 JSON 已在顶部"安装"部分给出。本节仅涵盖技术细节。

### 配置

创建 `~/.config/opencode/aristotle-config.json` 自定义行为：

```jsonc
{
  // 反思器提示模式： "full" | "compact" | "auto"
  // "auto" 在任意模型 output limit ≤ 8192 tokens 时自动选择 compact
  "prompt_mode": "auto"
}
```

优先级：`ARISTOTLE_PROMPT_MODE` 环境变量 → `aristotle-config.json` → 默认 `"full"`。

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

## GEAR 协议

Aristotle 是 **[GEAR（Git-backed Error Analysis & Reflection）](./docs/GEAR.md)** 协议的一个实现——一个 AI agent 错误反思、学习与预防的协议。不再是扁平的追加写入文件，规则经过状态机流转，带有 schema 校验、意图驱动检索和基于进化模型的审核级别。

**GEAR 角色 → Aristotle 映射：**

| GEAR 角色 | Aristotle 实现 | 状态 |
|-----------|---------------|------|
| **O**（统筹者） | `SKILL.md` + `REFLECT.md` + `REVIEW.md` + `LEARN.md` | ✅ 已实现 |
| **R**（生产者） | `REFLECTOR.md`（子代理） | ✅ 已实现 |
| **C**（审计者） | `REVIEW.md` STEP V2b（schema 校验） | ✅ 已实现 |
| **L**（学习者） | `LEARN.md` | ✅ 已实现 |
| **S**（检索者） | O 内的函数调用（LEARN.md STEP L3） | ✅ 已实现 |

GEAR 协议操作映射到 Aristotle 的 MCP 工具：`produce` → `write_rule`、`stage` → `stage_rule`、`verify` → `commit_rule`、`reject` → `reject_rule`、`restore` → `restore_rule`、`search` → `read_rules`、`sync` → `check_sync_status` + `sync_rules`、`audit_decision` → `get_audit_decision`。

完整的协议规范——状态机、frontmatter schema、Δ 决策因子和一致性要求——详见 **[GEAR.md](./docs/GEAR.md)**。

## 测试

> **完整测试文档：** 详见 **[TESTING.zh-CN.md](./docs/testing.zh-CN.md)**，包含详细的测试套件说明、覆盖率分析和人工测试计划。

| 套件 | 命令 | 数量 |
|------|------|------|
| 静态测试 | `bash test.sh` | 103 |
| 单元/集成测试 (Python) | `uv run pytest test/ -v` | 325 |
| Bridge 插件 (TypeScript) | `cd plugins/aristotle-bridge && bunx vitest run` | 148 |
| E2E 集成测试 | `uv run pytest test/test_e2e_bridge_integration.py -v` | 9 |
| 回归测试（部署验证） | `bash test/regression_b1_checks.sh` | 64 |

### 测试覆盖率历史

> Phase 2 已完成。详见 **[TESTING.zh-CN.md](./docs/testing.zh-CN.md)**。

| 里程碑 | pytest | 静态测试 | e2e |
|--------|--------|----------|-----|
| 基线（修复前） | 111 | 67 | — |
| 修复后 | 134 | 67 | — |
| 协程 O 合并后 | 166 | 84 | — |
| GEAR 编排 (M1-M4) | 218 | 98 | — |
| M4 异常路径测试 | 227 | 98 | — |
| **Phase 2 (M1/M5-M9)** | **295** | **104** | **70** |
| Phase 0 Bridge (MCP 扩展) | 318 | 103 | 9 |
| Phase 1 Bridge (插件) | 325 | 103 | 9 + 148 vitest |

## 项目结构

```
.
├── SKILL.md              # 路由器 — 参数解析、阶段路由（5.6 KB）
├── REFLECTOR.md          # 子代理协议 — 错误分析、DRAFT 生成
├── REFLECT.md            # 协调器反思阶段 — 启动子代理、状态追踪、被动触发
├── REVIEW.md             # 协调器审核阶段 — DRAFT 审核、规则写入、修订
├── CHECKER.md            # 审核者协议 — schema + 内容校验（仅确认时加载）
├── LEARN.md              # 协调器学习阶段 — 意图提取、查询构造、结果过滤
├── install.sh            # 安装脚本（macOS/Linux）
├── install.ps1           # 安装脚本（Windows）
├── pyproject.toml        # MCP server 的 Python 依赖声明
├── test.sh               # 静态测试套件（103 断言）
├── aristotle_mcp/        # MCP server（Git 版本管理 + 工作流编排）
│   ├── __init__.py
│   ├── config.py         # 路径、常量、环境变量、RISK_WEIGHTS、AUDIT_THRESHOLDS、SKILL_DIR
│   ├── models.py         # RuleMetadata 数据类、YAML 序列化
│   ├── git_ops.py        # Git 抽象层（init、add+commit、show、log、status、show_exists）
│   ├── frontmatter.py    # 流式 frontmatter 搜索、原子写入
│   ├── evolution.py      # Δ 决策引擎（compute_delta、decide_audit_level）
│   ├── migration.py      # 扁平 Markdown → Git 仓库迁移
│   ├── server.py         # FastMCP 入口，re-export，工具注册
│   ├── _utils.py         # 共享工具函数
│   ├── _tools_rules.py   # 10 个规则生命周期工具（含 detect_conflicts、get_audit_decision）
│   ├── _tools_sync.py    # 2 个同步工具
│   ├── _tools_reflection.py  # 3 个反思状态工具
│   ├── _tools_undo.py    # on_undo 工具（bridge undo 信令）
│   ├── _tools_feedback.py    # report_feedback 工具（规则反馈 + 自动反思）
│   ├── _orch_prompts.py  # Prompt 模板 + 构建器
│   ├── _orch_state.py    # 工作流持久化 + 状态管理
│   ├── _orch_parsers.py  # 解析器 + 格式化器
│   ├── _orch_start.py    # orchestrate_start 工具（session_file + use_bridge）
│   ├── _orch_event.py    # orchestrate_on_event 工具
│   └── _orch_review.py   # orchestrate_review_action 工具
├── plugins/
│   └── aristotle-bridge/ # Bridge 插件 — 轮询式异步反思（不依赖 OMO）
│       ├── src/          # 9 个模块（index/types/utils/api-probe/logger/snapshot-extractor/workflow-store/idle-handler/executor）
│       ├── test/         # 7 个测试文件，148 vitest 用例
│       ├── testing.en.md # Bridge 独立测试文档（英文）
│       └── testing.zh.md # Bridge 独立测试文档（中文）
└── test/
    ├── regression_b1_checks.sh  # 部署验证（64 断言）
    ├── e2e_opencode.sh          # E2E 自动化脚本（14 断言）
    └── test_e2e_bridge_integration.py  # Bridge↔MCP 集成测试（9 pytest）
```

## 架构：渐进披露

技能拆分为六个文件。触发时仅加载 `SKILL.md`（5.6 KB），其余按需加载：

| 场景 | 加载文件 | 大小 |
|------|---------|------|
| `/aristotle`（反思） | SKILL.md + REFLECT.md | 10.0 KB |
| `/aristotle sessions` | SKILL.md only | 5.6 KB |
| `/aristotle review N` | SKILL.md + REVIEW.md | 12.2 KB |
| `/aristotle review N`（确认时） | SKILL.md + REVIEW.md + CHECKER.md | 20.9 KB |
| `/aristotle learn` | SKILL.md + LEARN.md | 14.4 KB |
| 审核 + 二次反思 | SKILL.md + REVIEW.md + REFLECT.md | 16.7 KB |
| 子代理（内部） | REFLECTOR.md | 10.2 KB |

## 已知问题与贡献方向

欢迎 PR！以下是需要改进的具体方向：

### 中优先级

- **命令参数解析** — `last`、`session ses_xxx`、`recent N` 和 `--focus <hint>` 已在文档中说明但尚未实现。当前 `/aristotle` 始终反思当前会话，使用 `focus: "last"`。实现方案见 `design_plan/pending-params-implementation.md`。
- **反思器模型配置** — 反思器当前使用宿主默认模型。在 `aristotle-config.json` 中添加 `reflector_model` 配置项（与 `prompt_mode` 相同的优先级链），可让用户按需优化成本或质量。
- **子代理 `session_read` 可用性** — 反思器子代理此前依赖 `session_read()` 读取会话内容，但部分模型/提供商组合不提供此工具。**已通过 Bridge Plugin 缓解**：PRE-RESOLVE 快照提取器在主会话（有访问权）中捕获错误上下文，通过 `session_file` 传给反思器子代理。非 Bridge 路径的完整优雅降级（回退到 `session_list` + `session_info`）仍为锦上添花项。

### 锦上添花

- ~~**规则版本与过期**~~ — 已由 MCP server（Git 版本控制）解决。规则现在有完整的 commit 历史，可以拒绝/恢复。过期清理机制仍有待实现。
- **`count_matches` 跨平台测试** — 测试套件的 `count_matches` 辅助函数在 GNU grep 上工作，但应在 Alpine（BusyBox）、macOS（BSD grep）等非 GNU 环境上测试。

## 重置 / 清理数据

如果只想清理数据而不卸载，请参阅 [RESET.zh-CN.md](./docs/reset.zh-CN.md)。

## 卸载

```bash
# 移除技能
rm -rf ~/.config/opencode/skills/aristotle

# 移除 MCP server
rm -rf ~/.config/opencode/aristotle

# 移除 Bridge 插件（可选）
rm -rf ~/.config/opencode/aristotle-bridge

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

## 许可证

MIT
