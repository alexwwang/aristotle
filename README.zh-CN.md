# Aristotle 🦉

**[English](./README.md)** | 中文

> *认识自己，是一切智慧的开端。* — 亚里士多德

**Aristotle** 是一个 [OpenCode](https://github.com/opencode-ai/opencode) 技能（skill）——错误反思与学习代理。

通过 `/aristotle` 激活，启动一个隔离的子代理，分析会话中模型的错误，执行 5-Why 根因分析，并将预防规则写入持久化文件。所有规则先呈现为草稿（DRAFT），经你确认、修改或驳回后才写入磁盘。

## 功能特性

- **隔离式反思** — 分析在独立的后台会话中运行，主会话上下文零污染
- **5-Why 根因分析** — 8 大错误分类结构化分析（需求误解、上下文假设、模式违反、幻觉、分析不充分、工具选错、过度简化、语法/API 错误）
- **草稿→确认工作流** — 规则先生成 DRAFT，用户逐一确认/修改/驳回后才写入
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

在任意 OpenCode 会话中输入 `/aristotle` 触发反思：

| 命令 | 说明 |
|------|------|
| `/aristotle` | 反思当前会话 |
| `/aristotle last` | 反思上一个已完成的会话 |
| `/aristotle session <id>` | 反思指定会话 |
| `/aristotle recent N` | 反思最近 N 个会话 |

### 执行流程

1. **协调器**（主会话）— 收集目标会话 ID、项目目录、用户语言，然后启动后台 `task()`。启动后**立即打印反思器的 session ID**，你可以随时切过去查看进展，无需等待通知。
2. **反思器**（隔离子代理）— 读取会话记录，检测错误纠正模式，执行 5-Why 分析，生成草稿规则
3. **用户审核** — 切换到反思器会话（`opencode -s <id>`）确认、修改或驳回每条规则。主会话在分析完成时也会发送一行提醒，但你不必等它。
4. **持久化** — 已确认的规则追加到规则文件

```
主会话                               反思器会话（隔离）
─────────────                        ────────────────────────────
用户: /aristotle        ──────►      读取会话记录
                                      检测错误（5-Why）
"🦉 已启动。opencode -s xxx"          生成 DRAFT 规则
                                      呈现给用户 ◄──────────┐
                                      等待确认/修改          │
                                      写入规则文件          │
                          ◄──────     "✅ 规则已写入！"      │
"🦉 完成。opencode -s xxx"                                   │
                                      （用户切换到此处）─────┘
```

## 测试

### 静态测试（无需会话）

```bash
bash test.sh
```

37 个断言，覆盖文件结构、SKILL.md 内容、错误模式检测（英文/中文/阈值）和架构保证。

### E2E 实时测试（需要 opencode 会话）

```bash
bash test/live-test.sh --model <provider/model>
```

创建真实会话，注入已知错误模式，触发 `/aristotle`，验证完整的 协调器 → 反思器 → 规则写入 流程。8 个断言。

## 项目结构

```
.
├── .gitignore
├── SKILL.md                          # 技能定义（LLM 提示词与协议）
├── install.sh                        # 安装脚本（macOS/Linux）
├── install.ps1                       # 安装脚本（Windows）
├── test.sh                           # 静态测试套件（37 断言）
└── test/
    └── live-test.sh                  # E2E 实时测试（8 断言）
```

## 已知问题与贡献方向

欢迎 PR！以下是需要改进的具体方向：

### 高优先级

- **模型兼容性** — 技能通过 `question` 工具让用户为反思器选择模型，但 `opencode run` 在非交互模式下会在此处卡住。反思器应在非交互环境中直接使用合理的默认值。
- **子代理 `session_read` 可用性** — 反思器子代理依赖 `session_read()` 读取会话内容，但部分模型/提供商组合不提供此工具。当不可用时，技能会退回到在主会话中直接分析（破坏了隔离架构）。需要优雅的降级路径。
- **规则去重** — 追加新规则前不检查是否已存在语义相似的规则。长时间使用后，对相似错误的重复反思会产生接近重复的规则。

### 中优先级

- **`APPEND ONLY` 仅靠提示词约束** — SKILL.md Step R6c 声明了追加写入和禁止重复规则，但无程序化强制执行。需要写入后的验证步骤扫描重复项。
- **多模型 E2E 测试** — 实时测试仅验证用户指定的模型。应跨多个提供商/模型测试以验证可移植性。

### 锦上添花

- **会话范围过滤** — `/aristotle recent N` 拉取最近 N 个会话但不按日期或相关性过滤。添加日期范围或错误密度过滤可减少噪声。
- **规则版本与过期** — 规则仅追加无版本管理。部分规则可能随模型改进而过时。添加时间戳和清理机制有助于长期维护。
- **`count_matches` 跨平台测试** — 测试套件的 `count_matches` 辅助函数在 GNU grep 上工作，但应在 Alpine（BusyBox）、macOS（BSD grep）等非 GNU 环境上测试。
- **SKILL.md 模式校验** — 无自动化检查 SKILL.md frontmatter 是否正确或引用的协议步骤是否存在。lint 步骤可捕获偏差。

## 卸载

```bash
# 移除技能
rm -rf ~/.claude/skills/aristotle

# 移除用户级学习规则（可选）
rm -f ~/.config/opencode/aristotle-learnings.md
```

## 为什么是 `~/.claude/skills/`？—— Skill 发现机制调查

你可能会好奇，为什么这个技能必须安装到 `~/.claude/skills/`，而不是看起来更自然的 `~/.config/opencode/skills/` 等位置。以下是我们调查的结果。

### OpenCode 的 Skill 发现机制（v1.3.15）

OpenCode 的 skill 发现按以下顺序扫描目录：

1. **`EXTERNAL_DIRS`** — 全局扫描 `~/.claude/` 和 `~/.agents/`（源码中硬编码为 `[".claude", ".agents"]`），匹配 `skills/**/SKILL.md`
2. **`EXTERNAL_DIRS` 项目级** — 扫描 `<项目>/.claude/` 和 `<项目>/.agents/`
3. **`configDirs`** — 扫描 `~/.config/opencode/`，匹配 `{skill,skills}/**/SKILL.md`
4. **`skills.paths`** — 从 `opencode.json` 配置读取自定义路径
5. **`skills.urls`** — 从远程 URL 获取 skill

### 测试过的路径

| 路径 | 发现结果 | 说明 |
|------|----------|------|
| `~/.claude/skills/` | ✅ 有效 | v1.3.15 中唯一可靠工作的路径 |
| `~/.agents/skills/` | ❌ 未发现 | 虽在 `EXTERNAL_DIRS` 列表中，但实际不工作 |
| `~/.config/opencode/skills/` | ❌ 未发现 | `configDirs` 扫描理论上应能发现，但存在 bug |
| `opencode.json` 中的 `skills.paths` | ❌ 未发现 | 已配置但未被识别 |

### 根因

`EXTERNAL_DIRS` 对 `.claude` 的扫描是 OpenCode v1.3.15 中唯一完全正常工作的发现路径。`.agents` 目录扫描和 `configDirs` 扫描均存在实现缺陷 — 多个 GitHub issue（[#16524](https://github.com/anomalyco/opencode/issues/16524)、[#10986](https://github.com/anomalyco/opencode/issues/10986)、[#12741](https://github.com/anomalyco/opencode/issues/12741)）报告了类似问题。

因此 `~/.claude/skills/` 是目前唯一可靠可用的路径，尽管 `.claude` 名义上是 Claude Code 的目录。如果 OpenCode 在未来版本修复了 skill 发现机制，我们会同步更新安装路径。

### ⚠️ 避坑：不要对 skills 目录使用符号链接

OpenCode 内部的 glob 遍历**不会跟随目录符号链接**。如果 `~/.claude/skills/`（或项目级 `.claude/skills/`）是一个符号链接——例如指向 git submodule 或共享目录——OpenCode 会静默地发现**零个 skill**，尽管 `ls` 看起来一切正常。

这个问题在 **git worktree sandbox** 环境（如 OpenCode Desktop）中尤为隐蔽——sandbox 会话的 skill 扫描运行在 repo 的副本上，符号链接目标可能无法正确解析。

**正确做法：**
```bash
# ✅ 真实目录 — 始终有效
git clone https://github.com/alexwwang/aristotle.git ~/.claude/skills/aristotle
```

**错误做法：**
```bash
# ❌ 符号链接 — 静默失败
ln -s /some/shared/skills ~/.claude/skills
```

详见 [issue #18848](https://github.com/anomalyco/opencode/issues/18848) 的完整分析。

## 许可证

MIT
