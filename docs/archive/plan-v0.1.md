# Aristotle Skill 改造方案 v1

> **归档版本 v0.1** — 2026-04-10
> Superseded by ROADMAP.md
>
> 本文档记录 Aristotle 最初四项架构改进方案（SKILL.md 瘦身、完成通知优化、
> session 管理、模型选择），大部分已实施。后续开发计划见 `ROADMAP.md`。

## 一、待办1：SKILL.md 瘦身

### 问题
SKILL.md 共 371 行，Coordinator 指令 + 完整 Reflector 协议（Steps R1-R6，约 170 行）全部内联。OpenCode 触发 skill 时整份注入父上下文，浪费大量 token。

### 方案

| 文件 | 职责 | 预估行数 |
|------|------|---------|
| `SKILL.md` | 仅 Coordinator 指令（Phase 1: Steps 1.1–1.7） | ~120 行 |
| `REFLECTOR.md` | 完整 Reflector 协议（Steps R0-R7 + RC） | ~280 行 |

**SKILL.md 改动要点：**

1. 删除内联的 Reflector prompt 模板（Step 1.3 中的整块 JavaScript 模板字符串）
2. Step 1.3 的 `task()` prompt 改为：
   ```
   You are Aristotle's Reflector subagent. Read and execute the protocol at
   ${SKILL_DIR}/REFLECTOR.md.

   TARGET_SESSION_ID: ${target_session_id}
   PROJECT_DIRECTORY: ${project_directory}
   USER_LANGUAGE: ${user_language}
   ```
3. Coordinator 通过 `SKILL_DIR`（从 `~/.claude/skills/aristotle/` 推导）传递路径
4. 保留 session switch 流程说明（精简为文字说明，删除 ASCII art）

---

## 二、待办2：完成通知不取回子代理内容

### 问题
Step 1.5 指示调用 `background_output(task_id)` 检查状态。模型倾向附带 `full_session=true`，导致整份分析报告被拉入父上下文。

### 方案

**删除 `background_output()` 调用。** 收到 completion notification 后，直接输出一行提示：

```
🦉 Aristotle done [current]. Review: opencode -s ses_abc111
```

在 SKILL.md 中用加粗禁令明确约束：

> **NEVER call `background_output` for the reflector task. The completion notification is sufficient to trigger the one-line reminder.**

---

## 三、待办3：子代理 Session 管理

### 3.1 核心机制：专用审核 Session + 内容加载

**调研结论：task() 创建的子代理 session 是非交互式的。**

经源码分析和数据库实证确认：
- `opencode -s <session_id>` 可以**查看** task session，但**无法发送新消息**
- 所有 task session 都有权限限制：`task=deny, question=deny, write=deny, edit=deny`
- 47 个 task session 全部只有 1 条 user message（初始 prompt），0 个有后续交互
- GitHub Issues #4422、#16303、#11012 确认此为已知限制

**因此：审核必须发生在主 session 中，通过加载子 session 内容实现。**

审核流程：
1. 用户在**专用审核 session** 中运行 `/aristotle sessions` 查看反思记录
2. 运行 `/aristotle review N` 将第 N 条反思的 DRAFT 报告加载到当前 session
3. 在当前 session 中审核、确认、修订、拒绝
4. Coordinator 执行规则写入（不依赖 Reflector 子代理）

### 3.2 多次启动的区分问题

在同一主 session 中多次运行 `/aristotle` 时，多个 reflector session 标题完全一样，用户无法分辨。

**解决方案：状态追踪文件**

路径：`~/.config/opencode/aristotle-state.json`

```json
[
  {
    "id": "rec_001",
    "reflector_session_id": "ses_abc111",
    "target_session_id": "ses_main",
    "target_label": "current",
    "launched_at": "2026-04-10T22:30:00+08:00",
    "status": "confirmed",
    "rules_count": 2
  },
  {
    "id": "rec_002",
    "reflector_session_id": "ses_def222",
    "target_session_id": "ses_prev",
    "target_label": "last",
    "launched_at": "2026-04-10T22:35:00+08:00",
    "status": "draft",
    "rules_count": null
  }
]
```

**状态流转：**

```
draft → confirmed → revised
  ↑         │           │
  └─────────┘           │
  (re-analyze)          │
                        └──→ (可继续 revised)
```

### 3.3 `/aristotle sessions` 子命令

新增命令，读取状态文件输出结构化列表：

```
🦉 Aristotle Sessions
──────────────────────────────────────────────────────
#  Target         Status     Rules  Launched
1  current        ✅ confirmed  2    04-10 22:30
2  last           ⏳ draft      ?    04-10 22:35
3  ses_abc4       🔄 revised    1    04-09 14:20

Review #2: /aristotle review 2
```
🦉 Aristotle Sessions
──────────────────────────────────────────────────────
#  Target         Status     Rules  Launched
1  current        ✅ confirmed  2    04-10 22:30
2  last           ⏳ draft      ?    04-10 22:35
3  ses_abc4       🔄 revised    1    04-09 14:20

Switch to #2: opencode -s ses_def222
```

### 3.4 `task()` description 带可辨识标签

```
/aristotle             → description: "Aristotle: current session"
/aristotle last        → description: "Aristotle: last session"
/aristotle session xxx → description: "Aristotle: ses_xxx (abc4)"
/aristotle recent 3    → description: "Aristotle: recent #1/3"
```

### 3.5 专用审核 Session Workflow

用户开一个专用 session 做审核管理：

```
opencode                        ← 开一个干净的 session
> /aristotle sessions           ← 查看所有反思记录
> /aristotle review 2           ← 加载 #2 的 DRAFT 报告到当前 session
> [审核 DRAFT 报告]
> "confirm"                     ← 确认写入
> /aristotle sessions           ← 状态已更新
> /aristotle review 1           ← 加载 #1 的 DRAFT 报告
> "revise 2: 缩小范围到 API 路由" ← 修订
> "confirm all"                 ← 确认写入
```

**为什么可以加载内容到审核 session：** 专用审核 session 的唯一目的就是审核反思报告，加载 DRAFT 报告是该 session 的正常工作内容，不存在上下文污染。

### 3.6 `/aristotle review N` 命令

在主 session 中加载第 N 条反思记录的 DRAFT 报告。

**实现步骤：**

1. 读取 `aristotle-state.json`，找到第 N 条记录的 `reflector_session_id`
2. 使用 `session_read(session_id=reflector_session_id)` 读取 Reflector 的完整消息历史
3. 从消息历史中提取 DRAFT 报告内容（STEP R4 的输出）
4. 将 DRAFT 报告呈现给用户
5. 等待用户反馈（confirm / revise / reject）
6. 根据反馈执行操作：
   - **confirm** → Coordinator 直接写入 learnings 文件 + 更新 state
   - **revise** → 用户给出修改意见 → Coordinator 修改后重新呈现
   - **reject** → 更新 state status 为 rejected

**Coordinator 自行处理规则写入（路径 B），不依赖 Reflector 子代理存活。**

### 3.7 跨 Session 联合反思（可选）

在审核 session 中，用户可以显式要求联合分析两个 session：

```
> /aristotle review 2 --cross 1
> "结合 #1 的反思一起分析"
```

Coordinator 加载两份 DRAFT 报告，做交叉分析，检查系统性重复错误。

---

## 四、待办4：移除模型选择对话框

### 问题
Step 1.3 在启动前用 `question` 工具询问模型选择，浪费一轮对话。

### 方案

1. **删除** Step 1.3 中整个 `question` 工具调用块
2. **默认**使用当前会话模型（task() 不指定 model 参数）
3. 扩展 Step 1.1 的参数解析：

```
/aristotle                          → 默认模型
/aristotle --model sonnet           → 指定模型
/aristotle last --model opus        → 组合参数
/aristotle recent 3 --model sonnet  → 组合参数
/aristotle --model sonnet session xxx → 任意顺序
```

仅在解析到 `--model` 时才在 task() 中传入 model 参数。

---

## 五、REFLECTOR.md 完整步骤清单

从当前 SKILL.md 的 Steps R1-R6 扩展为：

| Step | 名称 | 来源 |
|------|------|------|
| R0 | IDENTITY CHECK | **新增** — 身份自检，读取协议 |
| R1 | READ AND ANALYZE | 保留 |
| R2 | DETECT ERROR CORRECTIONS | 保留 |
| R3 | ROOT-CAUSE ANALYSIS (5 Whys) | 保留 |
| R4 | GENERATE DRAFT RULES | 保留，头尾加身份声明 |
| R5 | PROCESS USER FEEDBACK | 保留 |
| R6 | WRITE CONFIRMED RULES | 保留，末尾新增更新 state 文件 |
| R7 | POST-WRITE REVISION | **新增** — 已写入规则的修订模式 |
| RC | CROSS-SESSION REFLECTION | **新增** — 可选的联合反思 |

---

## 六、文件改动清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `SKILL.md` | 大幅精简 | Coordinator only，~120 行 |
| `REFLECTOR.md` | **新建** | 完整 Reflector 协议，~280 行 |
| `test.sh` | 更新 | 新增断言：REFLECTOR.md 存在性、SKILL.md 行数上限、state 文件格式 |
| `install.sh` | 更新 | 新增拷贝 REFLECTOR.md |

---

## 七、不改动的部分

| 项目 | 原因 |
|------|------|
| OpenCode 框架 | task session 非交互式是架构限制，skill 层面无法绕过 |
| learnings 文件格式 | APPEND ONLY 保持，仅新增修订模式 |
| install.ps1 | 同步更新即可，无架构变动 |
| live-test.sh | 需要后续单独适配新流程，本次不改 |
