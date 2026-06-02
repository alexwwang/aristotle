# Undo-Triggered Reflection — 集成设计方案

> 日期：2026-04-20
> 分支：`undo-track`
> 前置文档：`Undo-Triggered Reflection 实现方案.md`（Demo 验证）、`Undo-Triggered Reflection 进展记录.md`（决策历程）

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│  Plugin (aristotle-undo)           传感器层 — 零 LLM 依赖          │
│                                                                     │
│  session.idle → 写快照到 queue（pop 旧 normal，push 新 normal）     │
│  session.diff → 检测 undo → push undo 条目到 queue                  │
│  chat.message → 注入 [system] 指令触发 /aristotle                   │
└─────────────┬───────────────────────────────────────────────────────┘
              │ ① evidence queue 文件
              │ ② chat.message 注入
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  O / Coordinator (SKILL.md)        调度层 — 极轻，不读 evidence     │
│                                                                     │
│  路由 /aristotle → REFLECT.md（默认，现有逻辑不变）                 │
│  AI 收到 [system] 注入 → 自动执行 /aristotle（走默认路由）          │
└─────────────┬───────────────────────────────────────────────────────┘
              │ ③ task() 启动 Reflector，传入 evidence 路径 + session ID
              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  R / Reflector (REFLECTOR.md)       执行层 — 全新 context            │
│                                                                     │
│  R0: 读 evidence queue → 取出所有 undo 条目                         │
│  R1: session_read() → 按 prev_msg_index 定位上下文 → 拼接材料       │
│  R2-R4: 现有分析流程（检测错误 → 5-Why → DRAFT）                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心原则

1. **解耦**：触发类型区分在 Plugin 和 UNDO_REFLECT.md 层，Reflector 执行层不感知触发来源
2. **O 极轻**：O 只做路由和启动子代理，不读 evidence 内容、不拼接上下文
3. **R 全权处理**：Reflector 负责读 queue、拼接历史、执行分析——全新 context，无上下文压力
4. **以后新触发类型**各自一个 `XXX_REFLECT.md`，遵循相同解耦模式

---

## 2. 已验证的决策

| # | 问题 | 决策 | 验证方式 |
|---|------|------|----------|
| 1 | 架构分层 | Plugin(传感器) → O(调度) → R(拼接+分析) | 设计讨论 |
| 2 | 解耦方式 | 新建 UNDO_REFLECT.md，Reflector 不变 | 设计讨论 |
| 3 | Evidence 存储 | FIFO 队列，undo 带 tag + prev_msg_index，只由 R pop | 设计讨论 |
| 4 | prev_session_pos | 方案 A：快照时记录 msg_index（零开销，soft delete 不影响） | 分析确认 |
| 5 | O 感知 undo | 方案 C：chat.message 注入 `[system]` 指令（无 synthetic） | ✅ Live test 通过 |
| 6 | synthetic 字段 | 不使用 synthetic:true（AI 会忽略），让用户看到注入文本 | ✅ Live test 对比 |
| 7 | 上下文拼接 | R 做，O 不碰 | 设计讨论 |
| 8 | 连续 undo | 队列压入多条 undo 条目，R 按 seq 贯序处理 | 设计讨论 |
| 9 | /undo 触发方式 | `/undo` 文本输入和 `ctrl+x u` 均有效，session.diff 检测均工作 | ✅ Live test 验证 |
| 10 | 用户体验 | 自动触发，注入文本对用户可见（README 说明） | 设计讨论 |

---

## 3. 改动清单

### 3.1 Plugin 改造：Evidence Queue

**文件**：`plugins/aristotle-undo/src/index.ts`

**当前**：单文件 snapshot/evidence（覆盖写入）

**目标**：FIFO 队列文件，区分 normal/undo 条目

#### 3.1.1 数据结构

```typescript
// .opencode/aristotle-undo-queue.json
interface QueueEntry {
  type: "normal" | "undo";
  seq: number;              // 第几轮对话（从 1 开始）
  user_message: { id: string; content: string };
  assistant_message: { id: string; content: string; parts: Part[] };
  timestamp: string;
  // normal 条目独有
  msg_index?: number;       // 写入时 session 消息总数（用于 prev_msg_index）
  // undo 条目独有
  prev_msg_index?: number;  // 被撤销对话的前一轮在 session 中的消息位置
}

interface Queue {
  version: 1;
  session_id: string;
  entries: QueueEntry[];
}
```

#### 3.1.2 操作逻辑

**session.idle（正常对话完成）**：
1. `session.messages()` 取最近消息，获取 `msg_index`（消息总数）
2. 读取 queue 文件
3. pop 掉队列中所有 `type=normal` 的旧条目（只保留最近一条作为 prev_pos 参考）
4. push 新 `{ type: "normal", seq: idleCount, msg_index }` 条目
5. 写回 queue 文件

**session.diff 检测到 undo**：
1. 读取 queue 文件
2. 取队列中最后一条 `type=normal` 的 `msg_index` 作为 `prev_msg_index`
3. push `{ type: "undo", seq: 原快照的 seq, prev_msg_index }` 条目
4. **不 pop undo 条目**——只由 Reflector 消费
5. 写回 queue 文件
6. 设 `undoDetected = true`

**chat.message（注入触发）**：
1. 检查 `undoDetected` flag
2. 有 → 注入 `[system] The user just performed /undo on a previous response. Run /aristotle on the current session to analyze what went wrong. After that, answer the user's question normally.`
3. 消费 flag

#### 3.1.3 Reflector 消费

Reflector 从 queue 文件 pop 所有 `type=undo` 条目（按 seq 排序），读取后删除这些条目并写回文件。normal 条目也一并清理。

### 3.2 新建 UNDO_REFLECT.md

**文件**：`UNDO_REFLECT.md`（新建）

**职责**：Undo 触发的专用 Reflect 协议。O 加载此文件后，按步骤准备 Reflector 所需的材料路径，然后启动 Reflector。

**不改动 REFLECT.md**——现有反思流程完全不受影响。

```markdown
# Aristotle Undo Reflect Protocol

> 由 /aristotle 默认路由自动加载（AI 被 [system] 注入触发时走 REFLECT.md）

## STEP U1: 检查 Evidence Queue

读取 `${PROJECT_DIR}/.opencode/aristotle-undo-queue.json`：
- 如果文件不存在或没有 undo 条目 → 无 undo 待处理，走标准 REFLECT.md 流程
- 如果有 undo 条目 → 继续 U2

## STEP U2: 收集上下文参数

从 queue 中提取：
- `target_session_id` = queue.session_id
- `evidence_queue_path` = queue 文件的完整路径
- `project_directory` = 当前工作目录
- `user_language` = 从消息内容推断
- `focus_hint` = "undo"
- `target_label` = "undo-trigger"

## STEP U3: 启动 Reflector

调用 task() 启动 Reflector 子代理，传入 evidence_queue_path 作为额外参数。
Reflector 读 queue → 按 prev_msg_index 定位上下文 → 拼接材料 → 执行分析。

## STEP U4: 清理 Queue

Reflector 完成后，O 不负责清理（Reflector 自行消费 undo 条目）。

## STEP U5: 更新状态 + 通知

同 REFLECT.md F4/F5/F6。
```

### 3.3 SKILL.md 改动

**文件**：`SKILL.md`

**改动范围**：最小化

1. **description 字段**：在现有触发词末尾追加 undo 相关描述
   ```
   ... Also auto-triggers after /undo when plugin detects undo event via [system] instruction injection.
   ```

2. **Parse Arguments**：无新增子命令。`/aristotle` 默认路由已覆盖——AI 收到 `[system]` 注入后执行 `/aristotle`，走标准 reflect 流程。UNDO_REFLECT.md 的加载由 REFLECT.md 在检测到 evidence queue 时触发。

### 3.4 REFLECT.md 改动

**文件**：`REFLECT.md`

**改动范围**：在 STEP F1 中增加 undo 检测分支

在 `STEP F1: COLLECT MINIMAL CONTEXT` 的 `target_session_id` 解析逻辑后，增加：

```markdown
### Undo Trigger Detection

Before resolving target_session_id, check for pending undo evidence:

1. Check if `${PROJECT_DIR}/.opencode/aristotle-undo-queue.json` exists
2. If yes, read it and check for entries with `type: "undo"`
3. If undo entries exist:
   - Read `${SKILL_DIR}/UNDO_REFLECT.md` and execute that protocol instead
   - STOP (do not continue with standard reflect flow)
4. If no undo entries → proceed with standard reflect flow
```

### 3.5 REFLECTOR.md 改动

**文件**：`REFLECTOR.md`

**改动范围**：在 STEP R1 之前增加 R0（evidence queue 输入源）

```markdown
## STEP R0: UNDO EVIDENCE ANALYSIS (Conditional)

If `EVIDENCE_QUEUE_PATH` parameter is provided:

### R0a. Read Evidence Queue

Read the file at `EVIDENCE_QUEUE_PATH`. Extract all entries with `type: "undo"`,
sorted by `seq` ascending.

### R0b. Build Error Context

For each undo entry:
1. Use `prev_msg_index` to locate the context boundary in the session
2. `session_read(session_id, limit=N)` to get messages around the undo point
3. The undo entry's `user_message` and `assistant_message` provide the exact
   erroneous exchange
4. Combine evidence content + session history to reconstruct the full error scene

### R0c. Proceed to R2

Skip R1 (standard session scan) — go directly to R2 (detect error corrections)
using the reconstructed context from R0b. The undo itself IS the error signal,
so R2 should always find at least one error.
```

同时在 `SESSION PARAMETERS` 部分增加：
```
- `EVIDENCE_QUEUE_PATH` — (optional) Evidence queue 文件路径，undo 触发时由 Coordinator 传入
```

### 3.6 ROADMAP.md 改动

在 V1.1 区块末尾增加：

```markdown
### V1.1d Undo-Triggered Reflection

**目标：** 用户 /undo 后自动触发 Aristotle 反思，捕获被撤销的上下文进行分析。

**组件：**
- Plugin：`plugins/aristotle-undo/`（事件传感器 + evidence queue）
- 协议：`UNDO_REFLECT.md`（undo 专用 reflect 协议）
- 路由：REFLECT.md 增加 undo 检测分支
- 执行：REFLECTOR.md 增加 R0 evidence 分析阶段

**改动文件：** `plugins/aristotle-undo/src/index.ts`、`UNDO_REFLECT.md`（新建）、`REFLECT.md`、`REFLECTOR.md`、`SKILL.md`、`ROADMAP.md`
```

### 3.7 README.md 改动

在 Features 或 Known Issues 部分增加说明：

```markdown
- **Undo-Triggered Reflection** — When the aristotle-undo plugin is installed, performing /undo automatically triggers Aristotle to analyze the reverted response. The plugin injects a visible `[system]` instruction into your next message to activate reflection. This is by design — it ensures the AI processes the undo event correctly.
```

---

## 4. 数据流

### 4.1 正常对话

```
用户输入 → AI 回复 → session.idle 触发
  → Plugin: pop 旧 normal，push 新 normal（含 msg_index）
  → queue 文件更新
```

### 4.2 单次 /undo

```
用户 /undo → session.diff 触发（无 session.idle）
  → Plugin: 检测到 undo
  → 从 queue 最后一条 normal 取 prev_msg_index
  → push undo 条目
  → 设 undoDetected = true

用户发送新消息 "修复这个 bug"
  → chat.message 触发
  → 注入: "[system] The user just performed /undo..."
  → AI 收到合并消息 → 执行 /aristotle
  → O 加载 REFLECT.md → 检测到 queue 有 undo 条目
  → 加载 UNDO_REFLECT.md → 启动 Reflector（传入 queue 路径）
  → Reflector: R0 读 queue → R0b 按 prev_msg_index 拼接上下文
  → R2-R4 分析 → 生成 DRAFT
  → Reflector 清理 queue 中的 undo 条目
```

### 4.3 连续 /undo（N-1 轮后，N 轮多次尝试 N_1, N_2, N_3）

```
session.idle → push normal(seq=N, msg_index=42)
用户 /undo → push undo(seq=N, prev_msg_index=35)  // N-1 轮的位置
用户发新消息 → AI 回复 N_1 → session.idle → push normal(seq=N_1, msg_index=45)
用户 /undo → push undo(seq=N_1, prev_msg_index=35)  // 仍然是 N-1 的位置
用户发新消息 → AI 回复 N_2 → session.idle → push normal(seq=N_2, msg_index=48)
用户 /undo → push undo(seq=N_2, prev_msg_index=35)
...

最终用户不再 undo，发正常消息：
  → chat.message 注入 [system]
  → AI 执行 /aristotle
  → Reflector 读 queue: 3 条 undo(seq=N, N_1, N_2) + 若干 normal
  → 按 seq 排序，逐个分析：每个都有完整的 N_i 对话 + prev_msg_index=35 定位 N-1 上下文
  → 每条 undo 独立生成 Reflection（或合并分析，取决于 R 的判断）
```

---

## 5. 改动文件清单

| 文件 | 操作 | 行数估算 | 说明 |
|------|------|---------|------|
| `plugins/aristotle-undo/src/index.ts` | 改造 | ~250 行（+80） | Evidence queue + 注入逻辑 |
| `plugins/aristotle-undo/test/plugin.test.ts` | 更新 | +30 行 | Queue 相关测试 |
| `UNDO_REFLECT.md` | 新建 | ~60 行 | Undo 专用 reflect 协议 |
| `REFLECT.md` | 小改 | +10 行 | F1 增加 undo 检测分支 |
| `REFLECTOR.md` | 小改 | +30 行 | R0 evidence 分析阶段 |
| `SKILL.md` | 小改 | +2 行 | description 追加触发词 |
| `ROADMAP.md` | 小改 | +10 行 | V1.1d 记录 |
| `README.md` | 小改 | +3 行 | Undo 功能说明 |

**不改动的文件**：
- `REVIEW.md` — Review 流程不变
- `LEARN.md` — Learn 流程不变
- `CHECKER.md` — Checker 流程不变
- `GEAR.md` — 协议规范不变
- MCP server (`aristotle_mcp/`) — 完全不受影响

---

## 6. 实施顺序

1. **Plugin 改造**（queue + 注入）
2. **REFLECTOR.md** 增加 R0
3. **UNDO_REFLECT.md** 新建
4. **REFLECT.md** 增加 undo 分支
5. **SKILL.md** 更新 description
6. **ROADMAP.md** + **README.md** 更新
7. **单元测试**更新
8. **Live test**：/undo → evidence queue → 反思 → DRAFT

---

## 7. 已知风险与限制

### 7.1 短期风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| OpenCode PR #2563（undo/redo 重构）合并 | session.diff 可能不再触发，检测失效 | 届时需适配新 API（`POST /sessions/{sid}/undo`） |
| AI 偶尔不执行注入的 [system] 指令 | 反思不触发 | 被动扫描兜底：O 检查 queue 文件 |
| 注入文本对用户可见 | 轻微体验影响 | README 说明，未来 synthetic 机制改进后可隐藏 |

### 7.2 长期关注

- OpenCode `synthetic` 字段行为可能变化——如果未来 `synthetic:true` 的 part 能被 AI 执行，应切换回去（用户无感）
- PR #2563 的 `session.stopping` hook 如果合并，可提供更精确的 undo 事件（不再依赖 flag 状态机）
- Queue 文件大小需限制——Reflector 消费后清理，正常使用不会膨胀
