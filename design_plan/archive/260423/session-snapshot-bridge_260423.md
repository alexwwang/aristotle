# Session Snapshot Bridge — 解决 Reflector 宿主环境混淆

**日期:** 2026-04-23
**分支:** test-coverage → 主开发
**前置:** Phase 2 已完成（295 pytest + 104 static + 70 e2e）
**目标:** 解决 Reflector 子代理无法可靠访问 `session_read` 的问题，复用 undo 分支已验证的 session 提取机制
**来源:** undo 分支 `plugins/aristotle-undo/src/index.ts` 中的 `buildMaterial()` 模式

---

## 一、问题描述

### 1.1 现状

Reflector 子代理在 STEP R1b 中需要读取目标 session 的对话内容来分析错误：

```markdown
# REFLECTOR.md L40
Use `session_read(session_id="${TARGET_SESSION_ID}", include_todos=true)` to get the conversation
```

实际运行中，Reflector 子代理（通过 `task()` 创建的独立 session）出现两个问题：

1. **工具不可用**：`session_read` 是宿主环境（OpenCode/Claude Code）的内置工具，子代理不一定能访问，且工具名在不同环境下不同（OpenCode: `t_session_search`，Claude Code: 可能不同）
2. **环境混淆**：SKILL 安装在 `~/.claude/skills/` 或 `~/.config/opencode/skills/`，模型看到路径后混淆宿主环境，用 `claude` CLI 命令（不存在）尝试读取 session，陷入死循环

### 1.2 影响

Reflect 流程完全跑不通。主 session 阻塞等待一个永远不会完成的 Reflector。

### 1.3 根因

子代理不应被要求使用它可能没有的工具。应该由**有能力的执行者**提取数据，以文件形式传递给子代理。

---

## 二、Undo 分支已有方案分析

### 2.1 undo 插件的 session 提取机制

undo 分支 `plugins/aristotle-undo/src/index.ts` 中，`buildMaterial()` 函数实现了完全相同的能力——从 session 中提取对话内容并持久化到文件：

```typescript
// 核心提取逻辑（L131-143）
const result = await ctx.client.session.messages({
  path: { id: queue.session_id },
  query: { limit: prevMsgIndex },
});
const recent = result.data.slice(-10);
background = recent
  .map((m) => {
    const role = m.info.role;
    const text = extractText(m.parts).slice(0, 200);
    return `[${role}] ${text}`;
  })
  .join("\n");
```

```typescript
// 持久化到文件（writeMaterial）
await Bun.write(
  `${projectDir}/${SNAPSHOT_DIR}/${MATERIAL_FILE}`,
  JSON.stringify(material, null, 2),
);
```

产出物是 `.opencode/aristotle-undo-material.json`，结构：

```typescript
interface MaterialEntry {
  seq: number;
  prev_msg_index: number;
  background: string;              // 前文上下文（最近 10 条，每条截 200 字）
  user_message: { id; content };
  assistant_message: { id; content };  // 截断到 2000 字
  context_incomplete?: boolean;
}
```

### 2.2 可复用要素

| 要素 | undo 实现 | reflect 需求 | 可复用性 |
|------|----------|-------------|---------|
| 提取者身份 | OpenCode Plugin（有 SDK `ctx.client`） | 主 session（有 `t_session_search` 工具） | 模式相同，执行者不同 |
| 数据格式 | JSON（MaterialEntry：配对的 user/assistant 消息） | JSON（扁平 messages 数组） | 结构不同，需转换适配层 |
| 存储位置 | `.opencode/aristotle-undo-material.json` | 需要新路径（避免冲突） | 可借鉴，不能共用 |
| 生命周期 | `pending → processing → consumed → failed` | 简化为 create → read → cleanup | 可简化 |

### 2.3 关键差异

undo 插件运行在 OpenCode Plugin 层（TypeScript/Bun），使用 SDK `ctx.client.session.messages()` 提取。

Reflector 的 session 提取需要发生在两个可能的执行者身上：

- **主 session**（SKILL.md）：有 `t_session_search` 工具
- **未来的 undo 插件**：有 SDK `ctx.client.session.messages()`

因此设计必须支持**两条提取路径**，产出统一格式的文件。

---

## 三、方案设计

### 3.1 核心思路

```
                    ┌─────────────────────────────────────────┐
                    │         Session Snapshot Bridge          │
                    │                                         │
   Path A           │  Path B (未来)                           │
   主 session       │  undo 插件                               │
   t_session_search │  ctx.client.session.messages()          │
       │            │       │                                  │
       ▼            │       ▼                                  │
  ┌─────────┐       │  ┌─────────┐                            │
  │ 提取消息 │       │  │ 提取消息 │                            │
  │ 写文件   │       │  │ 写文件   │                            │
  └────┬────┘       │  └────┬────┘                            │
       │            │       │                                  │
       ▼            │       ▼                                  │
  ┌──────────────────────────────────────┐                    │
  │  ~/.config/opencode/                 │                    │
  │    aristotle-sessions/               │                    │
     │      ses_xxx_snapshot.json            │                    │
  └──────────────────┬───────────────────┘                    │
                     │                                        │
                     ▼                                        │
              Reflector 子代理                                │
              Read(SESSION_FILE)                              │
              （只需基本 Read 工具）                            │
                    └─────────────────────────────────────────┘
```

### 3.2 文件格式：JSON（与 undo 插件对齐）

采用 JSON 格式，与 undo 插件的 `MaterialEntry` 结构保持一致，LLM 解析 JSON 字段比从非结构化 Markdown 中提取信息更精确：

```json
{
  "version": 1,
  "session_id": "ses_abc123",
  "extracted_at": "2026-04-23T15:30:00Z",
  "focus": "last 50 messages",
  "source": "t_session_search",
  "total_messages": 200,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "content": "帮我写一个函数来检查素数"
    },
    {
      "index": 2,
      "role": "assistant",
      "content": "```python\ndef is_prime(n):\n    if n <= 1:\n        return False\n    for i in range(2, n):\n        if n % i == 0:\n            return False\n    return True\n```"
    },
    {
      "index": 3,
      "role": "user",
      "content": "不对，你这个循环范围写错了，应该到 sqrt(n)"
    },
    {
      "index": 4,
      "role": "assistant",
      "content": "你说得对，我修正一下..."
    }
  ]
}
```

**为什么用 JSON：**
- LLM 解析 JSON 的字段定位比从 Markdown heading 中提取更精确
- 结构化字段（`role`、`index`）避免 LLM 自行推断消息边界带来的歧义
- `messages` 数组与 REFLECTOR.md 的 "Scan Context → Error Excerpt → Correction Excerpt" 可直接通过 index 定位

**与 undo MaterialEntry 的关系：**

两者都是 JSON，但结构不同：
- **Snapshot**：扁平 `messages[]` 数组，每条消息独立，`{index, role, content}`
- **MaterialEntry**：配对结构，每条包含 `user_message` + `assistant_message` + `background` + `prev_msg_index`

Path B（undo 合并后）需要一个轻量转换层：将 MaterialEntry 的配对消息展平为 snapshot 的扁平数组。这是有意的设计差异——Reflector 需要逐条消息的完整视图来做错误检测，而 undo 需要交互级别的配对来检测撤销。

### 3.3 存储约定

| 项目 | 值 |
|------|-----|
| 目录 | `~/.config/opencode/aristotle-sessions/` |
| 文件名 | `{session_id}_snapshot.json` |
| 元数据 | JSON 顶层字段（`version`, `session_id`, `extracted_at`, `focus`, `source`, `total_messages`） |
| 生命周期 | `created`（写入即为此状态，无需转换标记） |
| 清理策略 | **不自动清理**。Snapshot 是源数据（一手证据），应长期保留。用户可手动清理该目录。与 undo 插件的 material.json 策略对齐。 |

> **为什么不自动清理**：Snapshot 与 workflow 状态文件不同。workflow 是临时编排状态，完成后可丢弃。Snapshot 是 Reflector 分析的原始依据——`/aristotle review N` 和 re-reflect 都可能需要回看原始对话。如果 session 本身已被删除或压缩，snapshot 可能是唯一的存档。undo 插件的 material.json 也采用同样的"只增不删"策略。

### 3.4 Path A：主 session 提取（当前实现）

当 reflect 由主 session 触发（`/aristotle` 命令或 Passive Trigger），主 session 负责：

```
SKILL.md PRE-RESOLVE 阶段（现有第 16-17 行之后）：

0. Ensure directory: Bash("mkdir -p ~/.config/opencode/aristotle-sessions")
1. 根据用户指定的 --focus 参数确定提取范围：
   - "last"（默认）: t_session_search(limit=50) 取最后 50 条
   - "after TEXT": t_session_search 全量提取 → SKILL.md 定位锚点 → 从锚点截取
   - "around N": t_session_search(limit=N+10, offset=max(0,N-10)) 取窗口
   - "error" / "full": t_session_search 全量提取（可能较大，截断到 200 条）
2. 格式化为 JSON（见 3.2 结构）
3. 写入 ~/.config/opencode/aristotle-sessions/{target_session_id}_snapshot.json
4. 将文件路径作为 session_file 参数传给 MCP orchestrate_start
```

**关于 focus 策略的降级**：Path A 当前只完整支持 `"last"` 策略。`"after TEXT"` 和 `"around N"` 需要全量提取后在 SKILL.md 中做文本定位，增加了主 session 的上下文消耗和指令复杂度。`"error"` 和 `"full"` 可能产生大文件。

折中方案：**当前只实现 `"last"` 策略**（覆盖 90% 使用场景），其余策略在 snapshot JSON 的 `focus` 字段中记录用户意图，Reflector 从全量 snapshot 中自行聚焦。如果 snapshot 过大（>200 条），截断到最后 200 条并在 `focus` 字段标注 `truncated`。

### 3.5 Path B：undo 插件预提取（未来）

当 undo 插件合并后，undo 触发的 reflect 场景：

```
undo 插件检测到 /undo：
1. buildMaterial() 已提取消息（现有逻辑）
2. 额外写入一份 JSON snapshot 到 aristotle-sessions/ 目录（与 Path A 格式相同）
3. 在注入的 [system] 消息中附带文件路径
4. 主 agent 的 SKILL.md 检测到预提取文件 → 跳过提取步骤
```

Path B 暂不实施，但 Path A 的设计必须为它留好扩展点。

---

## 四、变更清单

### 4.1 文件变更

| # | 文件 | 变更 | 行数估计 |
|---|------|------|---------|
| 1 | **SKILL.md** | PRE-RESOLVE 增加 session 提取步骤 + ROUTE 传 session_file 参数 | +10 行 |
| 2 | **REFLECTOR.md** | R1b 从 `session_read()` 改为 `Read(SESSION_FILE)` | 改 1 段（~5 行） |
| 3 | **`_orch_prompts.py`** | `REFLECTOR_PROMPT_TEMPLATE` 增加 `SESSION_FILE` 参数 | 改 1 段（+2 行） |
| 4 | **`_orch_start.py`** | `orchestrate_start("reflect")` 接收 `session_file` 并传入 prompt | 改 1 处（+3 行） |

### 4.2 各文件详细变更

#### 4.2.1 SKILL.md — PRE-RESOLVE 增加 session 快照

现有 PRE-RESOLVE（第 16-17 行）之后追加：

```markdown
## PRE-RESOLVE (reflect only)
Before calling MCP for reflect:
1. Call session_list(). Resolve target_session_id: ...（现有）
2. ★ Extract session content:
   a. Ensure directory exists: Bash("mkdir -p ~/.config/opencode/aristotle-sessions")
   b. Call t_session_search(sessionId=target_session_id, limit=50)
   c. Filter results to only `user` and `assistant` role messages; discard system, tool, and other roles
   d. Format results as JSON using ALL fields from the schema in Section 3.2:
      {"version":1,"session_id":"...","extracted_at":"<ISO timestamp>","focus":"<focus_hint>","source":"t_session_search","total_messages":<count_from_search>,"messages":[{"index":N,"role":"user|assistant","content":"..."}]}
      - total_messages: number of messages in the extraction window before role filtering (informational; actual array may be shorter due to system/tool message filtering)
   e. Write to ~/.config/opencode/aristotle-sessions/{target_session_id}_snapshot.json
   f. Set session_file parameter to this path
   g. If extraction fails, set session_file="" and continue (Reflector will degrade gracefully)
3. Detect user_language, project_directory, focus (existing)
```

同时修改 ROUTE 行（L14）传递 `session_file`：

```
# 现有：
orchestrate_start("reflect", {target_session_id, focus, project_directory, user_language})
# 改为：
orchestrate_start("reflect", {target_session_id, focus, project_directory, user_language, session_file})
```

**降级策略**：如果 `t_session_search` 失败或返回空，`session_file=""`。Reflector 检测到空路径后输出 "No session content available" 并 STOP。不阻塞流程。

#### 4.2.2 REFLECTOR.md — R1b 改用文件

**变更 1：SESSION PARAMETERS 区段（L11-19）新增参数：**

```markdown
- `SESSION_FILE` — 预提取的 session 快照 JSON 文件路径（为空表示提取失败）
```

**变更 2：R1a（L25-36）改为基于文件的分析聚焦：**

现有 R1a 描述的是"如何读取 session"（API 级别的分页、limit、offset）。改为描述"如何在已提取的 snapshot 中聚焦分析"：

```markdown
### R1a. Determine Analysis Focus

Based on `FOCUS_HINT`, decide which messages in the snapshot to focus on:

| FOCUS_HINT | Strategy |
|------------|----------|
| `last` (default) | Analyze all messages in the snapshot (already filtered to last ~50) |
| `after "text"` | Scan snapshot messages for the anchor text, analyze from there |
| `around N` | Focus on messages with index near N (if present in snapshot) |
| `error` / `full` | Analyze all messages in the snapshot |
| custom text | Search snapshot for text, focus on surrounding context |

Note: The snapshot may not contain the full session. Check the `focus` field — if it contains "(truncated)", some messages were omitted. Otherwise, all messages from the extraction window are present.
```

**变更 3：R1b（L39-46）改用文件：**

现有（第 39-46 行）：

```markdown
### R1b. Read the Session

1. Use `session_read(session_id="${TARGET_SESSION_ID}", include_todos=true)` to get the conversation
2. If the session has too many messages for the chosen range:
   ...
```

改为：

```markdown
### R1b. Read the Session

The Coordinator has pre-extracted the session content to a file. You do NOT need any session reading tool.

1. If `SESSION_FILE` is provided and non-empty:
   a. Use the Read tool to read the file at `SESSION_FILE`
   b. The file is JSON with a `messages` array, each entry has `index`, `role`, `content`
   c. Parse messages from the JSON array — each `{"role": "user/assistant", "content": "..."}` is one message
   d. If the file cannot be read, output: "⚠️ Session snapshot file not found. Cannot analyze." and STOP
2. If `SESSION_FILE` is empty or not provided:
   a. Output: "⚠️ No session content available. Cannot analyze errors." and STOP
3. Record the total message count and the range you actually analyzed
```

#### 4.2.3 `_orch_prompts.py` — prompt 模板加参数

现有（第 29-41 行）：

```python
REFLECTOR_PROMPT_TEMPLATE = """You are Aristotle's Reflector subagent. Read and execute the full protocol at
{skill_dir}/REFLECTOR.md (read the file first, then follow it step by step).

TARGET_SESSION_ID: {target_session_id}
PROJECT_DIRECTORY: {project_directory}
USER_LANGUAGE: {user_language}
FOCUS_HINT: {focus_hint}
DRAFT_SEQUENCE: {sequence}

Your output is NOT shown to the user...
"""
```

改为：

```python
REFLECTOR_PROMPT_TEMPLATE = """You are Aristotle's Reflector subagent. Read and execute the full protocol at
{skill_dir}/REFLECTOR.md (read the file first, then follow it step by step).

TARGET_SESSION_ID: {target_session_id}
SESSION_FILE: {session_file}
PROJECT_DIRECTORY: {project_directory}
USER_LANGUAGE: {user_language}
FOCUS_HINT: {focus_hint}
DRAFT_SEQUENCE: {sequence}

Your output is NOT shown to the user. The Coordinator reads your session and \
extracts the DRAFT. Follow REFLECTOR.md exactly — especially STEP R5 to persist \
the DRAFT via persist_draft(sequence={sequence}, content=...).

IMPORTANT: SESSION_FILE is a JSON file. Use the Read tool to read it, then parse \
the "messages" array. Each message has "index", "role", "content" fields. Do NOT \
attempt to use session_read or any session API — the content is pre-extracted \
to the file by the Coordinator.
"""
```

`_build_reflector_prompt()` 签名加 `session_file` 参数：

```python
def _build_reflector_prompt(
    target_session_id: str,
    focus_hint: str,
    sequence: int,
    project_directory: str = "",
    user_language: str = "en-US",
    session_file: str = "",        # 新增
) -> str:
    safe_focus = focus_hint[:200]
    return REFLECTOR_PROMPT_TEMPLATE.format(
        skill_dir=str(SKILL_DIR),
        target_session_id=target_session_id,
        session_file=session_file,     # 新增
        project_directory=project_directory,
        user_language=user_language,
        focus_hint=safe_focus,
        sequence=sequence,
    )
```

#### 4.2.4 `_orch_start.py` — 传递 session_file

`orchestrate_start("reflect")` 分支（第 85-124 行），改动 2 处：

```python
# L88 后新增
session_file = args.get("session_file", "")

# L96 _build_reflector_prompt 调用加参数
r_prompt = _build_reflector_prompt(
    target_session_id=target_session_id,
    focus_hint=focus,
    sequence=sequence,
    project_directory=project_directory,
    user_language=user_language,
    session_file=session_file,        # 新增
)
```

### 4.3 不需要改的文件

| 文件 | 原因 |
|------|------|
| `_orch_event.py` | 事件处理不涉及 session 读取 |
| `_orch_state.py` | Snapshot 不自动清理，无需扩展清理逻辑 |
| `CHECKER.md` | 已经是文件驱动（读 DRAFT_FILE），无需改 |
| `_tools_rules.py` | 规则操作不涉及 |

### 4.4 新增文件变更

| # | 文件 | 变更 | 行数估计 |
|---|------|------|---------|
| 5 | **`config.py`** | 新增 `SESSIONS_DIR_NAME` 常量 + `resolve_sessions_dir()` | +5 行 |

`config.py` 新增：

```python
SESSIONS_DIR_NAME = "aristotle-sessions"

def resolve_sessions_dir() -> Path:
    return Path.home() / ".config" / "opencode" / SESSIONS_DIR_NAME
```

> **注**：`_orch_state.py` 不需要改——Snapshot 不自动清理，无需扩展 `_cleanup_stale_workflows()`。如果未来需要清理（如目录过大），可添加独立的 `cleanup_sessions()` 命令。

---

## 五、与 Undo 分支的合并路径

### 5.1 当前（test-coverage 分支）

```
Path A only: 主 session 用 t_session_search 提取 → 写 snapshot.json → Reflector 读文件
```

这是最小可行方案，5 个文件，~25 行改动，解决当前 reflect 跑不通的问题。

### 5.2 中期（undo 分支合并后）

```
Path A: 非触发场景 / 手动 /aristotle → 主 session 提取
Path B: undo 触发 → 插件 SDK 提取（更快、更精确、不占主 session 上下文）

共享：snapshot.json 格式 + aristotle-sessions/ 目录
```

undo 插件的 `buildMaterial()` 增加一个额外步骤：在写 material.json 的同时，写一份同格式的 snapshot.json。这样：

- Reflector 的消费者代码不变（只读 snapshot.json）
- undo 场景下跳过 Path A 的提取（检查文件已存在）
- 非 undo 场景下仍走 Path A

### 5.3 长期（V1.4 异步桥接后）

如果 `oc异步桥接方案.md` 中的 `promptAsync` 方案落地，子代理可以通过事件系统直接获取 session 内容，snapshot 文件变为可选缓存层而非必需品。但这一步依赖 OpenCode 平台变更，时间不确定。

### 5.4 兼容性保证

| 阶段 | snapshot.json 格式 | Reflector 消费方式 | 变更 |
|------|-------------------|-------------------|------|
| 当前（Path A） | JSON | `Read(SESSION_FILE)` + JSON 解析 | 初始实现 |
| +undo（Path B） | 相同 JSON | 相同 `Read(SESSION_FILE)` | 无 |
| +async bridge | 不变（变为可选） | 不变 | 无 |

snapshot.json 格式一旦确定就是稳定接口，后续只增加生产者（Path B），不改消费者。

---

## 六、测试计划

### 6.1 单元测试（pytest）

新增 1 个测试文件 `test/test_session_snapshot.py`：

| 测试 | 内容 |
|------|------|
| `test_build_reflector_prompt_includes_session_file` | prompt 模板包含 SESSION_FILE |
| `test_build_reflector_prompt_empty_session_file` | 空路径正常处理 |
| `test_orchestrate_start_reflect_passes_session_file` | session_file 参数传递到 prompt |
| `test_resolve_sessions_dir` | 路径解析正确 |

### 6.2 Static 检查

在 `test.sh` 中新增：

```bash
# REFLECTOR.md 不再引用 session_read（bare name，不含函数调用形式）
assert_not_contains REFLECTOR.md "session_read"
# prompt 模板包含 SESSION_FILE
assert_contains _orch_prompts.py "SESSION_FILE"
# SKILL.md ROUTE 传递 session_file
assert_contains SKILL.md "session_file"
# config.py 包含 sessions dir
assert_contains config.py "SESSIONS_DIR"
```

### 6.3 人工测试

需要验证的 e2e 场景：

1. **正常流程**：`/aristotle` → 主 session 提取 → snapshot.json 创建 → Reflector 读取成功 → 产出 DRAFT
2. **降级流程**：`t_session_search` 失败 → session_file="" → Reflector 输出提示 → 不崩溃
3. **文件不存在**：snapshot.json 被手动删除 → Reflector 检测到 → 输出提示 → 不崩溃

---

## 七、风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `t_session_search` 在某些环境不可用 | 低 | Reflect 无法提取 session | 降级输出提示，不崩溃 |
| snapshot.json 过大（session 有上千条消息） | 中 | 子代理上下文溢出 | 提取时截断（最多 200 条，每条 2000 字上限） |
| undo 合并时格式需转换 | 中 | 需要适配层 | MaterialEntry → 扁平 messages 转换（~20 行代码） |
| 主 session 提取消耗上下文 | 高 | `t_session_search` 返回内容注入主 session，不可控 | **当前无法避免**——工具返回值必然进入上下文。在 SKILL.md 中指示提取后立即写文件，不进一步讨论内容 |
| Snapshot 过时（session 在提取后继续） | 中 | Reflector 分析的是过期内容 | 可接受——错误模式不会快速变化；在 snapshot 的 `extracted_at` 中记录时间戳 |

### 关于主 session 上下文消耗

`t_session_search` 的返回内容**必然进入主 session 上下文**——这是工具调用的固有行为，无法通过指令规避。Path A 的上下文消耗是已知成本。

缓解措施：
- 在 SKILL.md 中指示：提取后**立即写入文件，不要输出、不要总结、不要引用**提取到的内容——避免二次消耗
- 每次 reflect 消耗约 50 条消息 × 平均 500 字 ≈ 25K token（可接受）
- 长期方案：等 OpenCode 支持 `save_binary` 类选项，工具直接写文件不经过上下文
- **这是 Path A 的固有缺陷，Path B（undo 插件）可完全避免**——因为提取发生在插件层而非主 session

---

## 八、实施顺序

```
1. 改 config.py（新增常量）                        ← 无破坏性
2. 改 _orch_prompts.py（加参数，纯后端）           ← 无破坏性
3. 改 _orch_start.py（传递参数，纯后端）           ← 无破坏性
4. 改 REFLECTOR.md（R1a 聚焦 + R1b 读文件 + SESSION PARAMETERS） ← 行为变更
5. 改 SKILL.md（PRE-RESOLVE 加提取步骤 + ROUTE）   ← 行为变更
6. 加测试（pytest + static）                       ← 验证
7. 人工 e2e 验证                                   ← 最终确认
```

步骤 1-3 可以先合并，不影响现有功能。步骤 4-5 是行为变更，需要一起做。

**估计工作量**：2 小时（含测试）。
