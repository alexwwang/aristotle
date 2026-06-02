# coroutine-O SKILL.md 指令失效 — 分析结论

**日期**: 2026-04-21
**分支**: coroutine-O
**前置文档**: Layer4 测试方法反思_260421.md

---

## 1. 问题描述

coroutine-O 的 SKILL.md dispatcher 包含 ROUTE 和 ACTIONS 两个部分。实测发现：

- **ROUTE 部分被遵循**：模型调用 MCP `orchestrate_start`
- **ACTIONS 部分被忽略**：当 MCP 返回 `fire_o` action 时，模型没有执行 `task()` 启动 O subagent，而是自主加载了 LEARN.md

## 2. 调研过程

### 2.1 排除的假设（已被否定）

| # | 假设 | 排除原因 |
|---|------|---------|
| 1 | 模型不遵循指令 | 模型遵循了 ROUTE 部分，说明它能读懂 SKILL.md |
| 2 | LEARN.md 的存在导致问题 | reflect 流程中 REFLECTOR.md 也存在但没被误加载 |
| 3 | `opencode run` 单次模式导致 | 交互式 session 中同样出现 |
| 4 | "DO NOT load" 禁令被反向心理触发 | 删除禁令后行为无变化 |

### 2.2 调研方法

| 调研项 | 方法 | 关键发现 |
|--------|------|---------|
| opencode skill 注入格式 | 读 openclaw 源码 (skills-ChGZGQ52.js) | 没有 `<skill_content>` / `<skill_files>` 标签；skill 通过 `<available_skills>` XML 列表注入系统提示，模型用 read 工具加载 SKILL.md |
| reflect 流程实际行为 | tmux 交互式测试 | 模型调用 `orchestrate_start("reflect")` 而非加载 REFLECT.md；两个流程都走 MCP 路径 |
| SKILL.md 结构分析 | 对比 ROUTE 和 ACTIONS 的语言结构 | ROUTE 使用具体动词 "call MCP"，ACTIONS 使用文档风格的 bullet-list |
| 成功 skill 的指令模式 | GitHub 搜索 + 本地 skill 分析 | 成功的 skill 用编号步骤 (`STEP N`) 或条件分支 (`### If action is X:`)，不用 bullet-list |

## 3. 根因

### 3.1 直接原因：ACTIONS 部分的指令格式

SKILL.md ACTIONS 部分：

```markdown
## ACTIONS

- `fire_o` → task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
  Then: call MCP `orchestrate_on_event("o_fired", {workflow_id})` → execute returned action.
- `notify` → Extract the `message` field from MCP response and display it to the user verbatim. Prefix with 🦉. → STOP
- `done` → STOP
```

这是一个**文档风格的引用表**，不是**指令风格的执行步骤**。模型将其理解为"说明信息"而非"待执行的动作序列"。

对比 ROUTE 部分：

```markdown
## ROUTE

Parse command → call MCP `orchestrate_start(command, args_json)` → execute returned action.
```

ROUTE 使用具体动词 "call MCP `orchestrate_start`"，模型理解为一个可执行动作。

### 3.2 结构性证据

| 维度 | ROUTE | ACTIONS | 效果 |
|------|-------|---------|------|
| 动词类型 | 具体操作 ("call MCP") | 抽象映射 ("fire_o → task(...)") | 具体动词被执行，抽象映射被忽略 |
| 格式 | 单行指令 | bullet-list | 单行=动作，列表=文档 |
| 条件触发 | 无条件执行 | 需要匹配 action 类型 | 匹配逻辑不在指令中，模型自己决定 |
| 成功案例对比 | 类似 REFLECT.md 的 STEP 格式 | 无已知成功案例使用此格式 |  |

### 3.3 为什么模型选择加载 LEARN.md

当模型从 ACTIONS 部分没有获得明确的下一步指令时，它需要自主决策。决策路径：

1. MCP 返回 `fire_o` + `o_prompt`
2. 模型在 ACTIONS 中找不到可执行的步骤描述
3. 模型注意到 `<available_skills>` 中 skill 目录路径
4. 模型用 read 工具列出目录内容，发现 LEARN.md
5. "LEARN" 匹配 "learn" 命令的语义 → 加载 LEARN.md
6. LEARN.md 内容详尽（246 行），包含完整的 learn 协议 → 模型按 LEARN.md 执行

这不是"模型不遵循指令"，是"ACTIONS 没有提供足够清晰的指令，模型选择了语义上最合理的替代路径"。

## 4. 解决方向

将 ACTIONS 从文档风格的引用表改为指令风格的条件分支：

```markdown
## ACTION EXECUTION

After orchestrate_start returns, match the action and execute:

### If action is `fire_o`:
1. Call task(category="unspecified-low", run_in_background=true, prompt=o_prompt)
2. When background task notification arrives, call MCP orchestrate_on_event("o_done", {workflow_id, result})
3. Execute the action returned by orchestrate_on_event

### If action is `notify`:
1. Extract the `message` field from MCP response
2. Display to user with 🦉 prefix
3. STOP

### If action is `done`:
STOP
```

关键差异：
- `### If action is X:` 条件分支代替 `- X →` bullet-list
- 编号步骤代替箭头符号
- 每个分支有明确的 STOP 标记
- 与 REFLECT.md 的 STEP N 成功模式一致

## 5. 待验证

修改后需要在交互式 session 中重测两条流程：
1. `/aristotle learn <NL query>` → 模型是否执行 task() 而非加载 LEARN.md
2. `/aristotle learn --domain X --goal Y` → 模型是否直接走 MCP notify 路径
3. `/aristotle` (reflect) → 模型是否读 REFLECT.md 而非走 MCP
