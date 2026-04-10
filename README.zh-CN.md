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

## 测试

### 静态测试（无需会话）

```bash
bash test.sh
```

63 个断言，覆盖文件结构、渐进披露、SKILL.md 内容、错误模式检测（英文/中文/阈值）和架构保证。

### E2E 实时测试（需要 opencode 会话）

```bash
bash test/live-test.sh --model <provider/model>
```

创建真实会话，注入已知错误模式，触发 `/aristotle`，验证完整的协调器 → 反思器 → 规则写入流程。8 个断言。

## 项目结构

```
.
├── SKILL.md              # 路由器 — 参数解析、阶段路由（84 行）
├── REFLECTOR.md          # 子代理协议 — 错误分析、DRAFT 生成
├── REFLECT.md            # 协调器反思阶段 — 启动子代理、状态追踪
├── REVIEW.md             # 协调器审核阶段 — DRAFT 审核、规则写入、修订
├── install.sh            # 安装脚本（macOS/Linux）
├── install.ps1           # 安装脚本（Windows）
├── test.sh               # 静态测试套件（63 断言）
└── test/
    └── live-test.sh      # E2E 实时测试（8 断言）
```

## 架构：渐进披露

技能拆分为四个文件。触发时仅加载 `SKILL.md`（84 行），其余按需加载：

| 场景 | 加载文件 | 行数 |
|------|---------|------|
| `/aristotle`（反思） | SKILL.md + REFLECT.md | 190 |
| `/aristotle sessions` | SKILL.md | 84 |
| `/aristotle review N`（审核） | SKILL.md + REVIEW.md | 240 |
| 审核 + 二次反思 | SKILL.md + REVIEW.md + REFLECT.md | 346 |
| 子代理（内部） | REFLECTOR.md | ~170 |

## 已知问题与贡献方向

欢迎 PR！以下是需要改进的具体方向：

### 中优先级

- **子代理 `session_read` 可用性** — 反思器子代理依赖 `session_read()` 读取会话内容，但部分模型/提供商组合不提供此工具。需要优雅的降级路径。
- **多模型 E2E 测试** — 实时测试仅验证用户指定的模型。应跨多个提供商/模型测试以验证可移植性。

### 锦上添花

- **规则版本与过期** — 规则仅追加无版本管理。部分规则可能随模型改进而过时。添加时间戳和清理机制有助于长期维护。
- **`count_matches` 跨平台测试** — 测试套件的 `count_matches` 辅助函数在 GNU grep 上工作，但应在 Alpine（BusyBox）、macOS（BSD grep）等非 GNU 环境上测试。

## 卸载

```bash
# 移除技能
rm -rf ~/.claude/skills/aristotle

# 移除用户级学习规则（可选）
rm -f ~/.config/opencode/aristotle-learnings.md

# 移除状态文件（可选）
rm -f ~/.config/opencode/aristotle-state.json
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
