# Unified Snapshot via SDK — 设计方案 v3

**日期**: 2026-04-24
**状态**: 待最终审核
**审核历史**: Council → Oracle ×2 → 当前
**v2→v3 变更**: 取消两阶段调用 + probe_only，改为单次调用 + MCP 侧 Bridge 检测 + executor 注入 SESSION_FILE

## 背景

PRE-RESOLVE 步骤 1 引用 `session_list()`（Claude Code 工具），步骤 2 引用 `t_session_search`（OMC 插件工具）。两者在 opencode 裸装环境均不可用，导致 GLM-5.1 在步骤 1 卡住，永远走不到 `orchestrate_start`。

## 工具可用性矩阵

| 工具 | Claude Code | OpenCode + Bridge | OpenCode 裸装 |
|------|:-----------:|:-----------------:|:-------------:|
| `session_list()` | ✅ | ❌ | ❌ |
| `session_read()` | ✅ | ❌ | ❌ |
| `client.session.messages()` (Bridge SDK) | ❌ | ✅ | ❌ |
| `aristotle_fire_o` (Bridge tool) | ❌ | ✅ | ❌ |

## 设计原则

- **最少 LLM 调用**：Bridge 环境 2 次工具调用（orchestrate_start + aristotle_fire_o）
- **MCP 驱动检测**：Bridge 环境由 MCP 侧 `.bridge-active` marker 判定，不依赖 LLM 自省
- **单次 orchestrate_start**：LLM 调用一次 orchestrate_start，MCP 根据环境返回不同 action
- **executor 注入 SESSION_FILE**：解决 prompt 先于 snapshot 构建的时序问题
- **`t_session_search` 引用全部移除**

## 三种环境的数据流

### Bridge 环境（OpenCode + Bridge Plugin）— 2 次 LLM 调用

```
1. LLM → orchestrate_start("reflect", {target_session_id: "", session_file: ""})
   MCP 检测 .bridge-active → 放宽空 ID 守卫 → 构建 prompt(SESSION_FILE 为空)
   → 返回 {action: "fire_sub", use_bridge: true, ...}

2. LLM → aristotle_fire_o(workflow_id, o_prompt, target_session_id)
   executor.launch():
     a. extract snapshot via client.session.messages() → 写入 {id}_snapshot.json
     b. 注入 SESSION_FILE 路径到 o_prompt: replace "SESSION_FILE: " → "SESSION_FILE: /path/to/snapshot.json"
     c. promptAsync(injected_prompt)
   → Bridge 异步执行

Reflector 子代理: 读取注入的 SESSION_FILE → 分析错误 → 产出规则
```

### 非 Bridge 环境（Claude Code）— 1+N 次 LLM 调用

```
1. LLM → orchestrate_start("reflect", {target_session_id: "", session_file: ""})
   MCP 检测无 .bridge-active + 空 ID
   → 返回 {action: "pre_resolve_needed"}

2. LLM 执行 PRE-RESOLVE:
   session_list() → resolve target_session_id
   session_read() → 获取内容
   write snapshot file → set session_file

3. LLM → orchestrate_start("reflect", {target_session_id, session_file, ...})
   → 返回 {action: "fire_o", o_prompt, ...}

4. LLM → task(prompt=o_prompt) 阻塞执行
```

### 非 Bridge 环境（OpenCode 裸装）— 降级路径

```
1. LLM → orchestrate_start("reflect", {target_session_id: "", session_file: ""})
   MCP 检测无 .bridge-active + 空 ID
   → 返回 {action: "pre_resolve_needed"}

2. LLM 尝试 PRE-RESOLVE → session_list() 不存在 → 失败
   → session_file = ""
   → 再次调用 orchestrate_start(target_session_id="", session_file="")

3. MCP 空 ID 守卫: 非 Bridge + 空 ID → 返回 {action: "notify", message: "🦉 Need target_session_id."}
   → STOP（优雅降级，不崩溃）
```

---

## 改动详情（5 个文件）

### 1. `aristotle_mcp/_orch_start.py` — M2+M3: Bridge 检测 + 空 ID 放宽

**改动量：+8 行**

```python
# 当前 line 92-93:
if not target_session_id:
    return {"action": "notify", "message": "🦉 Need target_session_id."}

# 改为:
bridge_active = resolve_sessions_dir().joinpath(".bridge-active").exists()

if not target_session_id:
    if bridge_active:
        pass  # Bridge handles session resolution via executor
    else:
        return {"action": "pre_resolve_needed"}
```

同时将 `bridge_active` 检测从 line 107 上移到 line 92 之前（避免重复检测）。

新增 `pre_resolve_needed` action：告诉 LLM 需要先做 PRE-RESOLVE 再回来。
不创建 workflow、不调 `_next_sequence()`、不调 `_save_workflow()`。

**关键**：非 Bridge + 空 ID 时不再返回 notify(STOP)，而是返回 `pre_resolve_needed`，给 LLM 第二次机会。

### 2. `plugins/aristotle-bridge/src/executor.ts` — H2+H3+SESSION_FILE 注入

**改动量：+20 行**

```typescript
// launch() 内部，在 promptAsync 之前:

// 1. Snapshot 提取（每次重新提取，不复用）
if (targetSessionId) {
  try {
    await Promise.race([
      this.snapshotExtractor.extract(
        this.client, targetSessionId, focusHint, limit
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('snapshot timeout')), 10_000)
      ),
    ]);
  } catch (e) {
    console.warn('[aristotle-bridge] snapshot extraction failed:', e);
  }
}

// 2. SESSION_FILE 路径注入（解决 prompt 先于 snapshot 的时序问题）
const snapshotPath = join(this.sessionsDir, `${targetSessionId}_snapshot.json`);
if (existsSync(snapshotPath)) {
  oPrompt = oPrompt.replace('SESSION_FILE: ', `SESSION_FILE: ${snapshotPath}`);
}

// 3. 继续原有逻辑：创建 session → promptAsync
```

- **[H2]** 每次 launch 都重新提取
- **[H3]** Promise.race 10s 超时保护
- **[新]** SESSION_FILE 路径注入：确定性字符串替换 `SESSION_FILE: ` → `SESSION_FILE: /path/to/file`
- **[M5]** focusHint 从 LaunchArgs 传入

### 3. `REFLECTOR.md` — H1: 统一 SESSION_FILE 读取逻辑

**改动量：~5 行**

```
R1b 当前: Use session_read(session_id="${TARGET_SESSION_ID}") to get the conversation
R1b 改为: Read SESSION_FILE (see SESSION PARAMETERS above). If SESSION_FILE is empty,
          output "No session data available for reflection." and STOP.
```

SESSION PARAMETERS 块新增：`SESSION_FILE: path to snapshot JSON, or empty string`

`_orch_prompts.py` lines 43-46：**保持不变**（已经是正确逻辑）。

### 4. `SKILL.md` — 伪代码重构 + PRE-RESOLVE 简化

**改动量：PRE-RESOLVE 段重写 ~30 行**

```markdown
## ROUTE
```
cmd = first argument or ""
MATCH cmd:
  "learn"    → CALL orchestrate_start("learn", args_json) → execute ACTION
  "sessions" → CALL orchestrate_start("sessions", "{}") → execute ACTION
  "review"   → CALL orchestrate_start("review", {sequence: N}) → execute ACTION → REVIEW FEEDBACK
  *          → GOTO PRE-RESOLVE
```

## PRE-RESOLVE (reflect only)
```
result = CALL orchestrate_start("reflect", {target_session_id: "", session_file: "",
                                           focus: "last", user_language: "en-US",
                                           project_directory: <cwd>})

MATCH result.action:
  "fire_sub":
    → Bridge handles everything. execute ACTION. STOP.
  "pre_resolve_needed":
    → Extract snapshot using session_list() + session_read()
    → Write ~/.config/opencode/aristotle-sessions/{id}_snapshot.json
    → CALL orchestrate_start("reflect", {target_session_id, session_file, ...})
    → execute ACTION. STOP.
  "notify":
    → Display result.message. STOP.
```
```

**关键简化**：
- Bridge 环境：1 次 orchestrate_start → fire_sub → aristotle_fire_o → 完成（2 次工具调用）
- Claude Code：1 次 orchestrate_start → pre_resolve_needed → 提取 → 第 2 次 orchestrate_start → 完成
- 裸装：1 次 orchestrate_start → pre_resolve_needed → 提取失败 → 第 2 次 → 优雅降级
- **移除所有 `session_list()`、`t_session_search` 引用**（pre_resolve_needed 路径内才用）
- **移除两阶段/probe_only 概念**

其余部分（ACTION EXECUTION、REVIEW FEEDBACK、/undo、PASSIVE TRIGGER）保持现有格式。

### 5. `plugins/aristotle-bridge/test/executor.test.ts`

**改动量：+5 个 test case**

- launch 时 extract 被调用且参数正确
- extract 失败时 launch 仍正常返回
- extract 超时时 launch 仍正常返回
- 连续两次 launch 同一 sessionId，extract 被调用两次（不复用）
- SESSION_FILE 注入：snapshot 存在时 o_prompt 被正确替换

---

## 不改动的文件

- `_orch_prompts.py` — 保持不变（已正确）
- `snapshot-extractor.ts` — 零改动
- `workflow-store.ts`、`idle-handler.ts`、`api-probe.ts` — 零改动
- `index.ts` — 新增 focusHint 参数透传（~2 行）

## 副作用分析

| # | 副作用 | 严重度 | 处理 |
|---|--------|:---:|------|
| 1 | Bridge 路径 prompt 构建时 SESSION_FILE 为空 | 🔴 | executor 注入路径（+3 行 replace） |
| 2 | 空 target_session_id 进入 workflow record | 🟢 | metadata 字段不影响功能 |
| 3 | 非 Bridge 空 ID 第一次调用不创建 workflow | ✅ | `pre_resolve_needed` 在 `_save_workflow` 之前返回 |
| 4 | `_next_sequence()` 仅在实际创建 workflow 时递增 | ✅ | `pre_resolve_needed` 在 `_next_sequence` 之前返回 |
| 5 | 裸装环境 PRE-RESOLVE 失败后第二次调用仍空 ID | 🟡 | 第二次空 ID → MCP 返回 notify → STOP（优雅降级） |
| 6 | SESSION_FILE replace 匹配到多个位置 | 🟢 | prompt 中只有一个 `SESSION_FILE: ` 前缀 |

## 审核发现追踪

### Council 发现
| ID | 问题 | v3 方案 |
|----|------|---------|
| H1 | REFLECTOR.md 引用 session_read | ✅ R1b 改为 SESSION_FILE → Read → STOP |
| H2 | snapshotExists 返回旧数据 | ✅ 每次重新提取 |
| H3 | extract 无超时 | ✅ Promise.race 10s |
| M2 | Bridge 环境 target_session_id | ✅ MCP 放宽守卫 |
| M3 | LLM 自省工具列表不可靠 | ✅ MCP 侧 bridge_active 检测 |
| M5 | focus 硬编码 | ✅ focusHint 参数透传 |

### Oracle 发现
| ID | 问题 | v3 方案 |
|----|------|---------|
| O-H1 | prompt template vs REFLECTOR.md 矛盾 | ✅ 统一为 SESSION_FILE，template 不动 |
| O-H2 | skip_pre_resolve 时序问题 | ✅ 取消两阶段，改为单次+action 分支 |
| O-H3 | 空 ID 守卫阻塞 | ✅ 放宽守卫 + pre_resolve_needed |
| O-H4 | 执行顺序 | ✅ 已调整 |
| O-M1 | 伪代码重构 | ✅ ROUTE + PRE-RESOLVE 改伪代码 |
| O-M2 | REFLECTOR.md 缺 SESSION_FILE | ✅ 纳入参数块 |
| O-new | 两阶段创建重复 workflow | ✅ v3 取消两阶段，单次调用 |
| O-new | executor SESSION_FILE 时序 | ✅ executor 注入路径 |
| O-new | Phase 1 无 error handling | ✅ 单次调用，MATCH action 处理所有分支 |
| O-new | session_list() 空返回 | ✅ pre_resolve_needed 内 "IF any step fails" 兜底 |

### Oracle 最终审核（v3）
| ID | 问题 | 结论 |
|----|------|------|
| Q1 | pre_resolve_needed 是否避免重复 workflow | ✅ 在 _save_workflow 之前返回 |
| Q2 | SESSION_FILE replace 是否安全 | ✅ 当前模板中只有一个匹配项 |
| Q3-H1 | extract 失败时仍启动空子会话 | 🟡 已知限制，Reflector STOP 优雅降级 |
| Q3-M1 | LLM 写入快照路径可能不匹配 | 🟡 session_file 参数自校验 |

---

## 纳入范围的额外改动（原 [L] 项）

### L1: snapshot source 字段区分来源

`snapshot-extractor.ts` 已有 `source: 'bridge-plugin-sdk'`。
SKILL.md PRE-RESOLVE 路径中 LLM 写入快照时，`source` 字段设为 `'llm-session-read'`。
无代码改动，仅在 SKILL.md 指令中指定。

### L2: 快照文件清理策略

在 `executor.ts` 的 `reconcileOnStartup()` 调用之后，增加快照清理：
```typescript
// executor.ts 或 idle-handler.ts
// 清理 >7 天的 snapshot 文件
const dir = sessionsDir;
const files = readdirSync(dir).filter(f => f.endsWith('_snapshot.json'));
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
for (const f of files) {
  const stat = statSync(join(dir, f));
  if (stat.mtimeMs < cutoff) unlinkSync(join(dir, f));
}
```
改动量：+10 行，放在 `index.ts` 插件初始化阶段。

### L4: 快照目录路径共享常量

`config.py` 已有 `SESSIONS_DIR_NAME` 和 `resolve_sessions_dir()`。
新增 Python 常量导出 + executor.ts 直接用 `DEFAULT_SESSIONS_DIR()`。
改动量：零（已存在）。

### M1 (Council): 并发写冲突

`snapshot-extractor.ts` 当前用 `{sessionId}_snapshot.json.tmp` + `renameSync`。
改为随机后缀 tmp 文件：
```typescript
const tmpPath = filePath + '.' + crypto.randomUUID().slice(0, 8) + '.tmp';
```
改动量：+1 行。

### M4 (Council): 子代理 Read 工具权限

opencode 子会话继承父会话权限，已有验证。
在 `testing.en.md` / `testing.zh.md` 中记录为前置条件。
无代码改动。
