# 待实现参数：目标解析、聚焦、模型配置

> 状态: 待实现 | 创建: 2026-04-28

## 背景

README 中声明了 8 个 `/aristotle` 命令，其中 5 个的参数解析逻辑尚未在 SKILL.md 中实现。

| 命令 | README 状态 | 实际状态 |
|------|------------|---------|
| `/aristotle` | ✅ | ✅ 有效 |
| `/aristotle last` | ✅ | ⚠️ 未实现 |
| `/aristotle session ses_xxx` | ✅ | ⚠️ 未实现 |
| `/aristotle recent N` | ✅ | ⚠️ 未实现 |
| `/aristotle --focus <hint>` | ✅ | ⚠️ 未实现 |
| `/aristotle --model <model>` | ✅ | ⚠️ 未实现 |
| `/aristotle sessions` | ✅ | ✅ 有效 |
| `/aristotle review N` | ✅ | ✅ 有效 |

## 1. 目标解析（`last` / `session ses_xxx` / `recent N`）

### 问题

SKILL.md 的 PRE-RESOLVE 段落硬编码了参数：

```
target_session_id: ""
focus: "last"
session_file: ""
```

用户输入的 `last`/`session ses_xxx`/`recent N` 完全被忽略。

### 依赖

- `session_list()` — OpenCode 内置工具，SKILL.md 已在 SNAPSHOT-EXTRACT 中使用
- 无需 MCP 代码改动

### 实现方案

**改动范围：仅 SKILL.md 的 PRE-RESOLVE 段落**

在 PRE-RESOLVE 开头添加参数解析：

```
## ARGUMENT PARSE
arg = first argument or ""
target_session_id = ""
target_label = "current"

MATCH arg:
  ""             → target_session_id = "" (current session, Bridge auto-resolves)
  "last"         → sessions = session_list(); target_session_id = sessions[1].id; target_label = "last"
  "session" ID   → target_session_id = ID; target_label = ID
  "recent" N     → sessions = session_list(); target_session_id = sessions[N].id; target_label = "recent-" + N
  --focus HINT   → focus_hint = HINT (extract from args, don't consume as target)
  *              → display "Unknown argument. Usage: /aristotle [last|session ID|recent N] [--focus hint]". STOP.
```

然后 PRE-RESOLVE 使用解析后的变量：

```
result = CALL orchestrate_start("reflect", {
  target_session_id: target_session_id,
  focus: focus_hint,
  target_label: target_label,
  session_file: "",
  user_language: <detect>,
  project_directory: <cwd>
})
```

### Bridge 路径下的行为

Bridge 路径下 `target_session_id` 可以由 Bridge executor 自动解析（`session.idle` 事件天然知道触发会话），但显式传入时应该尊重用户选择。

### 风险

- `session_list()` 可能不可用（某些 provider），需 graceful fallback
- Bridge 路径下 executor 需要读取 `target_session_id` 并传给 `promptAsync`

## 2. 聚焦选项（`--focus <hint>`）

### 问题

SKILL.md 硬编码 `focus: "last"`，`--focus` 参数未被解析。

### 依赖

- MCP 的 `focus_hint` 参数 — **字符串透传**，不做任何解析
- R prompt 模板中的 `{focus_hint}` 占位符 — 直接插入
- 无需 MCP 代码改动

### 实现方案

**改动范围：仅 SKILL.md**

在参数解析中提取 `--focus`：

```
focus_hint = "last"  // 默认

扫描参数列表，找到 "--focus" 后的下一个参数作为 focus_hint
有效值: last, after "文本", around N, error, full
无效值: 使用默认 "last" 并通知用户
```

然后透传给 MCP：

```
orchestrate_start("reflect", { ..., focus: focus_hint, ... })
```

### 为什么 focus 不需要代码实现

focus_hint 是给 Reflector 的**行为指引**，不是程序逻辑：

| 值 | R 的行为 |
|----|---------|
| `last` | R 读取 snapshot 最后 50 条消息 |
| `after "text"` | R 从 "text" 首次出现处开始 |
| `around N` | R 取第 N-10 到 N+10 条 |
| `error` | R 扫描全部但只提取错误模式 |
| `full` | R 扫描全部 |

R 是 LLM，理解自然语言指令——MCP 只需透传字符串。

## 3. 模型配置（`--model` → config）

### 问题

README 声明 `--model <model>`，但未实现。

### 设计决策

**不使用 CLI 参数，改用配置文件**。原因：

1. 反思器用哪个模型是**部署级决策**（不是每次调用都变）
2. 已有 `aristotle-config.json` 配置机制 + `prompt_mode` 先例
3. 配置文件支持环境变量覆盖（与 `prompt_mode` 一致的优先级链）

### 实现方案

**改动范围：config.py + _orch_start.py + SKILL.md + Bridge executor**

#### 3.1 config.py — 新增 `reflector_model` 读取

```python
def get_reflector_model() -> str:
    """Determine the model for the Reflector sub-session.

    Priority:
    1. ARISTOTLE_REFLECTOR_MODEL env var (highest)
    2. aristotle-config.json → reflector_model field
    3. Default: "" (use host default)
    """
    env_val = os.environ.get("ARISTOTLE_REFLECTOR_MODEL", "").strip()
    if env_val:
        return env_val

    config = _read_aristotle_config()
    return config.get("reflector_model", "")
```

#### 3.2 aristotle-config.json — 配置示例

```json
{
  "prompt_mode": "auto",
  "reflector_model": "gem-cn-max/glm-4.7"
}
```

留空字符串 = 使用宿主默认模型。

#### 3.3 _orch_start.py — 透传到返回结果

`orchestrate_start("reflect", ...)` 在返回结果中添加 `model` 字段：

```python
model = get_reflector_model()
return {
    "action": "fire_sub",
    "workflow_id": workflow_id,
    "sub_prompt": r_prompt,
    "model": model,  # 新增
    ...
}
```

#### 3.4 SKILL.md — blocking 路径使用 model

```
### If action is fire_sub (blocking path):
3. Call task(category="unspecified-low", run_in_background=true,
            model=result.model || undefined,
            load_skills=[], prompt=sub_prompt)
```

#### 3.5 Bridge executor — promptAsync 使用 model

```typescript
// executor.ts
await this.client.session.promptAsync({
  path: { id: session.data.id },
  body: {
    parts: [{ type: 'text', text: oPrompt }],
    // model 从 MCP 返回结果中获取，透传给 promptAsync
    ...(model ? { model } : {}),
  },
});
```

### 优先级链

```
ARISTOTLE_REFLECTOR_MODEL env → aristotle-config.json → 宿主默认
```

与 `prompt_mode` 完全一致的优先级设计。

## 实现优先级

| # | 功能 | 改动量 | 价值 |
|---|------|-------|------|
| 1 | 目标解析 | SKILL.md（~15 行） | 高 — `last` 是最常用的反思目标 |
| 2 | 聚焦选项 | SKILL.md（~5 行） | 中 — 与目标解析一起实现 |
| 3 | 模型配置 | config.py + _orch_start.py + SKILL.md + executor.ts | 中 — 配置驱动，不急 |

建议：先实现 1+2（纯 SKILL.md 改动，零风险），再实现 3（涉及代码改动）。
