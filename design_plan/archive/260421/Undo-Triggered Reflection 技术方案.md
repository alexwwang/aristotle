# Undo-Triggered Reflection — 技术方案

> 日期：2026-04-20（v3 — 方案 B+：Plugin 写 material 文件 + 状态标 + 重试）
> 前置文档：`Undo-Triggered Reflection 集成设计.md`（架构概览、已验证决策、改动清单）
>
> **方案选择**：方案 B+ — Plugin 检测 undo 时直接读 queue + session 并写 material 文件。
> UNDO_REFLECT.md 极简化（~35 行：检查 material → 传路径 → 启动 Reflector → 状态管理）。
> REFLECTOR.md 文件不改，但 U2 prompt 引导 Reflector 行为（替代 R1、简化 R2）。
>
> **方案演进**：
> - v1 (方案 B)：Reflector 加 R0，耦合 undo → 否决（解耦不足）
> - v2 (方案 A)：UNDO_REFLECT.md 做全部准备，prompt 内联材料 → 否决（主 session context 膨胀）
> - v3 (方案 B+)：Plugin 写 material 文件，主 session 零膨胀 → 当前方案

---

## 0. 数据文件总览

| 文件 | 路径 | 写入者 | 读取者 | 用途 |
|------|------|--------|--------|------|
| Queue | `.opencode/aristotle-undo-queue.json` | Plugin | Plugin | 对话轮次快照 + undo 条目 |
| Material | `.opencode/aristotle-undo-material.json` | Plugin | UNDO_REFLECT / Reflector | 完整反思材料（含 session 上下文） |

### 生命周期

```
Plugin (session.idle)  ──写──►  Queue (normal 条目)
Plugin (session.diff)  ──写──►  Queue (undo 条目)
Plugin (session.diff)  ──写──►  Material (读 queue + session → 拼接)
UNDO_REFLECT           ──读──►  Material (检查状态 → 传路径给 Reflector)
Reflector              ──读──►  Material (从文件读分析材料 → R1-R4)
UNDO_REFLECT (R完成后) ──改──►  Material (status → consumed)
UNDO_REFLECT (R失败时) ──改──►  Material (status → retry_pending, retry_count++)
UNDO_REFLECT (重试时)  ──读──►  Material (status=retry_pending → 重新启动 R)
Plugin (下次 idle)     ──检──►  Material (status=consumed → 下次 undo 可覆盖)
```

---

## 1. Plugin 改造：`plugins/aristotle-undo/src/index.ts`

### 1.1 当前状态（170 行）

现有三个 hook：
- `session.idle`（lines 82-136）：写单文件 snapshot，设 `snapshotWritten` flag
- `session.diff`（lines 138-152）：检查 flag → 检测 undo → 写单文件 evidence → 设 `undoDetected`
- `chat.message`（lines 155-168）：检查 `undoDetected` → 注入 `[system]` 指令

### 1.2 改动范围

| 改动 | 说明 |
|------|------|
| 新增 `QueueEntry` 和 `Queue` 接口 | 替代现有 `Snapshot` 接口 |
| 新增 `Material` 接口 | 完整反思材料，含状态标和重试字段 |
| 新增 `readQueue()` / `writeQueue()` | 替代 `readSnapshot()` / `writeSnapshot()` |
| 新增 `readMaterial()` / `writeMaterial()` | Material 文件操作 |
| 新增 `buildMaterial()` | 读 queue + session → 拼接完整材料 |
| 改造 `session.idle` handler | 写 queue（pop 旧 normal + push 新 normal + msg_index） |
| 改造 `session.diff` handler | 检测 undo → push undo 条目 → 调 buildMaterial() → 写 material |
| `chat.message` handler | 不变（已验证通过） |
| 删除 `writeSnapshot()` / `readSnapshot()` / `writeEvidence()` | 被 queue + material 操作替代 |
| 删除 `Snapshot` 接口 | 被 `QueueEntry` 替代 |

### 1.3 新数据结构

```typescript
// === 删除 ===
// interface Snapshot { ... }

// === 新增：Queue ===
interface QueueEntry {
  type: "normal" | "undo";
  seq: number;              // 对话轮次（从 1 开始，与 idleCount 对应）
  user_message: { id: string; content: string };
  assistant_message: { id: string; content: string; parts: Part[] };
  timestamp: string;
  // normal 条目
  msg_index?: number;       // 写入时 session 消息总数
  // undo 条目
  prev_msg_index?: number;  // 被撤销对话的前一轮在 session 中的消息位置
}

interface Queue {
  version: 1;
  session_id: string;
  entries: QueueEntry[];
}

// === 新增：Material ===
interface MaterialEntry {
  seq: number;
  prev_msg_index: number;
  background: string;             // undo 前的 session 历史摘要
  user_message: { id: string; content: string };
  assistant_message: { id: string; content: string };
  context_incomplete?: boolean;   // session 读取失败时为 true
}

interface Material {
  version: 1;
  status: "pending" | "processing" | "consumed" | "retry_pending" | "failed";
  created_at: string;
  session_id: string;
  project_directory: string;
  retry_count: number;
  max_retries: number;            // 默认 2
  last_error: string | null;
  entries: MaterialEntry[];
}
```

### 1.4 新增/替换函数

```typescript
// === 删除 ===
// async function writeSnapshot(projectDir, snapshot) { ... }
// async function readSnapshot(projectDir) { ... }
// async function writeEvidence(ctx, snapshot) { ... }
// const SNAPSHOT_FILE = "aristotle-undo-snapshot.json";

// === 新增 ===
const QUEUE_FILE = "aristotle-undo-queue.json";
const MATERIAL_FILE = "aristotle-undo-material.json";
const MAX_RETRIES = 2;

async function readQueue(projectDir: string): Promise<Queue | null> {
  try {
    const file = Bun.file(`${projectDir}/${SNAPSHOT_DIR}/${QUEUE_FILE}`);
    if (await file.exists()) return (await file.json()) as Queue;
  } catch { /* no queue */ }
  return null;
}

async function writeQueue(projectDir: string, queue: Queue): Promise<void> {
  await Bun.write(
    `${projectDir}/${SNAPSHOT_DIR}/${QUEUE_FILE}`,
    JSON.stringify(queue, null, 2)
  );
}

async function readMaterial(projectDir: string): Promise<Material | null> {
  try {
    const file = Bun.file(`${projectDir}/${SNAPSHOT_DIR}/${MATERIAL_FILE}`);
    if (await file.exists()) return (await file.json()) as Material;
  } catch { /* no material */ }
  return null;
}

async function writeMaterial(projectDir: string, material: Material): Promise<void> {
  await Bun.write(
    `${projectDir}/${SNAPSHOT_DIR}/${MATERIAL_FILE}`,
    JSON.stringify(material, null, 2)
  );
}

/**
 * 从 queue + session 构建完整 Material。
 * 在 Plugin 进程中执行，不占主 session context。
 */
async function buildMaterial(
  ctx: PluginInput,
  queue: Queue,
  undoEntries: QueueEntry[],
): Promise<Material> {
  const entries: MaterialEntry[] = [];

  // 按 prev_msg_index 分组，共享同一 session 读取
  const groups = new Map<number, QueueEntry[]>();
  for (const entry of undoEntries) {
    const key = entry.prev_msg_index ?? 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  for (const [prevMsgIndex, groupEntries] of groups) {
    let background = "";
    let contextIncomplete = false;

    if (prevMsgIndex > 0) {
      try {
        const result = await ctx.client.session.messages({
          path: { id: queue.session_id },
          query: { limit: prevMsgIndex },
        });
        if (result.data) {
          // 取最后 10 条消息作为背景
          const recent = result.data.slice(-10);
          background = recent
            .map(m => {
              const role = m.info.role;
              const text = extractText(m.parts).slice(0, 200);
              return `[${role}] ${text}`;
            })
            .join("\n");
        } else {
          contextIncomplete = true;
        }
      } catch {
        contextIncomplete = true;
      }
    }

    for (const entry of groupEntries) {
      entries.push({
        seq: entry.seq,
        prev_msg_index: prevMsgIndex,
        background,
        user_message: {
          id: entry.user_message.id,
          content: entry.user_message.content,
        },
        assistant_message: {
          id: entry.assistant_message.id,
          content: entry.assistant_message.content.slice(0, 2000), // 截断防膨胀
        },
        context_incomplete: contextIncomplete || undefined,
      });
    }
  }

  return {
    version: 1,
    status: "pending",
    created_at: new Date().toISOString(),
    session_id: queue.session_id,
    project_directory: ctx.directory,
    retry_count: 0,
    max_retries: MAX_RETRIES,
    last_error: null,
    entries,
  };
}
```

### 1.5 session.idle handler 改造

```typescript
if (event.type === "session.idle") {
  const { sessionID } = event.properties as { sessionID: string };
  const count = (idleCount.get(sessionID) ?? 0) + 1;
  idleCount.set(sessionID, count);

  try {
    const result = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { limit: 10 },
    });
    if (result.error || !result.data) return;

    const msgs = result.data;
    const lastUser = [...msgs].reverse().find((m) => m.info.role === "user");
    if (!lastUser) return;

    const userContent = extractText(lastUser.parts);

    if (userContent.startsWith("/undo") || userContent.startsWith("/redo")) {
      log(`/undo command response — skip snapshot overwrite`);
      snapshotWritten.set(sessionID, false);
      return;
    }

    if (count <= 1) {
      log(`First exchange — skip snapshot`);
      return;
    }

    if (userContent.length < MIN_USER_MESSAGE_LENGTH) {
      log(`User msg too short (${userContent.length}) — skip`);
      return;
    }

    const lastAsst = [...msgs].reverse().find((m) => m.info.role === "assistant");
    if (!lastAsst) return;

    const asstText = extractText(lastAsst.parts);

    // Queue 操作
    let queue = await readQueue(ctx.directory) ?? {
      version: 1,
      session_id: sessionID,
      entries: [],
    };

    queue.entries = queue.entries.filter(e => e.type !== "normal");

    queue.entries.push({
      type: "normal",
      seq: count,
      user_message: { id: lastUser.info.id, content: userContent },
      assistant_message: { id: lastAsst.info.id, content: asstText, parts: lastAsst.parts },
      timestamp: new Date().toISOString(),
      msg_index: msgs.length,
    });

    await writeQueue(ctx.directory, queue);

    snapshotWritten.set(sessionID, true);
    log(`Snapshot #${count}: user=${userContent.length} asst=${asstText.length} queue_entries=${queue.entries.length}`);
  } catch (err) {
    log(`Error: ${err}`);
  }
  return;
}
```

### 1.6 session.diff handler 改造

```typescript
if (event.type === "session.diff") {
  const queue = await readQueue(ctx.directory);
  if (!queue || queue.entries.length === 0) return;

  const wasWritten = snapshotWritten.get(queue.session_id);
  if (wasWritten) {
    snapshotWritten.set(queue.session_id, false);
    log(`session.diff after snapshot — normal flow`);
    return;
  }

  // Undo detected
  const lastNormal = [...queue.entries].reverse().find(e => e.type === "normal");
  const prevMsgIndex = lastNormal?.msg_index ?? 0;
  const lastEntry = queue.entries[queue.entries.length - 1];

  // Push undo 条目到 queue
  queue.entries.push({
    type: "undo",
    seq: lastEntry.seq,
    user_message: lastEntry.user_message,
    assistant_message: lastEntry.assistant_message,
    timestamp: new Date().toISOString(),
    prev_msg_index: prevMsgIndex,
  });

  await writeQueue(ctx.directory, queue);

  // 构建 Material 文件
  const allUndoEntries = queue.entries.filter(e => e.type === "undo");
  const existingMaterial = await readMaterial(ctx.directory);

  if (existingMaterial && existingMaterial.status === "consumed") {
    // 上一轮已完成，安全覆盖
    const material = await buildMaterial(ctx, queue, allUndoEntries);
    await writeMaterial(ctx.directory, material);
    log(`📦 Material file overwritten (previous was consumed)`);
  } else if (existingMaterial && (existingMaterial.status === "pending" || existingMaterial.status === "processing" || existingMaterial.status === "retry_pending")) {
    // 有未消费/正在处理/等待重试的 material，追加新 undo 条目
    const newEntries = allUndoEntries.filter(
      e => !existingMaterial.entries.some(me => me.seq === e.seq)
    );
    if (newEntries.length > 0) {
      const newMaterial = await buildMaterial(ctx, queue, newEntries);
      existingMaterial.entries.push(...newMaterial.entries);
      await writeMaterial(ctx.directory, existingMaterial);
      log(`📦 Material file (${existingMaterial.status}) appended with ${newEntries.length} new entries`);
    }
  } else if (existingMaterial && existingMaterial.status === "failed") {
    // 已放弃，新 undo 优先，覆盖
    const material = await buildMaterial(ctx, queue, allUndoEntries);
    await writeMaterial(ctx.directory, material);
    log(`📦 Material file overwritten (previous was failed)`);
  } else {
    // 无 material 文件，创建
    const material = await buildMaterial(ctx, queue, allUndoEntries);
    await writeMaterial(ctx.directory, material);
    log(`📦 Material file created with ${allUndoEntries.length} entries`);
  }

  undoDetected.set(queue.session_id, true);

  log(`🔴 Undo detected! queue has ${allUndoEntries.length} undo entries`);
  log(`  prev_msg_index: ${prevMsgIndex}`);
}
```

### 1.7 chat.message handler

**不变**。已验证通过，保留当前代码。

### 1.8 文件路径变更

| 旧文件 | 新文件 | 说明 |
|--------|--------|------|
| `.opencode/aristotle-undo-snapshot.json` | `.opencode/aristotle-undo-queue.json` | queue 替代 snapshot |
| `.opencode/aristotle-undo-evidence.json` | `.opencode/aristotle-undo-material.json` | material 替代 evidence |

`.gitignore` 需更新：删除旧文件规则，新增 `aristotle-undo-queue.json` 和 `aristotle-undo-material.json`。

**旧文件处理**：旧文件（snapshot、evidence）不迁移、不删除。新 Plugin 使用不同文件名和不同读取函数，自然忽略旧文件。用户可手动删除。

### 1.9 Plugin 初始化

Plugin `server()` 启动时检查是否有未处理的遗留 material 任务：

```typescript
const pendingNotification = new Map<string, boolean>();

export const server = async (ctx: PluginInput) => {
  log(`Plugin loaded. Project: ${ctx.directory}`);

  // 检查遗留 material
  const material = await readMaterial(ctx.directory);
  if (material && (material.status === "pending" || material.status === "processing" || material.status === "retry_pending")) {
    pendingNotification.set(ctx.directory, true);
    log(`📋 Pending material found (status=${material.status}). Will notify on first message.`);
  }

  return { ... }
};
```

**设计决策**：
- **不修改文件状态**：pending 留 pending，processing 留 processing，retry_pending 留 retry_pending
- **不清理孤儿**：数据完整，反思流程可以完成
- **首次通知**：通过 chat.message 注入一次性提示，告知用户运行 `/aristotle` 处理遗留任务
- **不引入新子命令**：`/aristotle` 已能处理 pending/retry_pending（UNDO_REFLECT U1 自动检出）；`/aristotle retry`（V1.1e）仅用于 failed 状态的 retry_count 归零

通知文本：

```typescript
output.parts.push({
  id: crypto.randomUUID(),
  sessionID,
  messageID: messageID ?? "",
  type: "text",
  text: "[system] Aristotle has pending undo reflection task(s). Run /aristotle to process them.",
});
```

**适用场景**：
- 用户升级 Plugin 后首次启动，可能有遗留 pending 任务
- 上次 OpenCode 崩溃导致 Reflector 中断（processing 状态）
- 用户主动关闭 OpenCode 导致反思未完成

---

## 2. 新建 `UNDO_REFLECT.md`（~30 行）

**职责**：极简化——检查 material 文件 → 传路径给 Reflector → 处理完成/失败 → 更新状态标。

Reflector 从 material 文件读取分析材料，走标准 R1-R4，不需要 R0。

```markdown
# Aristotle Undo Reflect Protocol

> 仅在 REFLECT.md 检测到 undo material 文件时加载。
> REFLECTOR.md 文件不改，但本协议的 prompt 会引导 Reflector 跳过 R1 的 session_read（改为读 material 文件）
> 并简化 R2 的纠错扫描（/undo 本身就是错误信号）。
> ⚠️ 依赖 REFLECTOR.md R1/R2 的当前行为——如果 REFLECTOR.md 修改了这两个步骤，本协议需同步更新。

---

## STEP U1: 检查 Material 文件

1. 检查 `${PROJECT_DIR}/.opencode/aristotle-undo-material.json` 是否存在
2. 如果不存在 → 无 undo 待处理，回退到标准 REFLECT.md 流程 → STOP
3. 如果存在，读取并检查 `status` 字段：
   - `pending` → 首次处理，继续 U2
   - `processing` → R 正在运行，不重复启动。输出 "🦉 Aristotle Reflector is still running. Please wait for it to complete." → STOP
   - `retry_pending` → 重试，继续 U2
   - `consumed` → 已处理完，回退到标准流程 → STOP
   - `failed` → 已达最大重试次数。输出 "🦉 Previous undo reflection failed after ${max_retries} retries. Material saved at: ${path}. Use /aristotle retry (V1.1e) or /aristotle for standard reflection." → STOP

## STEP U2: 启动 Reflector

调用 `task()` 启动 Reflector 子代理：

- `category`: `"unspecified-low"`
- `load_skills`: `[]`
- `run_in_background`: `true`
- `description`: `"Aristotle: undo-triggered session"`
- `prompt`:

```
You are Aristotle's Reflector subagent. Read and execute the full protocol at
${SKILL_DIR}/REFLECTOR.md (read the file first, then follow it step by step).

TARGET_SESSION_ID: ${material.session_id}
PROJECT_DIRECTORY: ${material.project_directory}
USER_LANGUAGE: ${user_language}
FOCUS_HINT: undo

## Analysis Material

Read the file at ${PROJECT_DIR}/.opencode/aristotle-undo-material.json.
It contains pre-built error context for N undo entries.

Instructions:
- Start from R1 — the material file provides the context you need
- Each entry's `user_message` is what the user asked
- Each entry's `assistant_message` is the reverted (erroneous) response
- Each entry's `background` is the conversation context before the undo point
- The /undo action IS the error signal — no need to scan for correction keywords
- Analyze each undo entry as a separate error
```

## STEP U3: 更新 Material 状态（processing）

Reflector 启动成功后，立即将 material 标记为 processing（不是 consumed）：

```json
{ "status": "processing" }
```

写入文件。这告诉 Plugin：R 正在运行，新 undo 应追加而非覆盖。

**consumed 状态在 U6（R 完成后）才设置，不在启动时。** 这样保证了：
- R 失败时可以正确进入 retry_pending
- Plugin 不会在 R 运行期间覆盖 material

## STEP U4: 更新状态文件

同 REFLECT.md F4。更新 `~/.config/opencode/aristotle-state.json`，`target_label` = `"undo-trigger"`。

## STEP U5: 通知用户

```
🦉 Aristotle Reflector launched [undo-trigger, ${N} undo(s)].
   task_id: bg_xxxxx | session_id: ses_xxxxx

Analyzing reverted response(s). When complete:
  /aristotle review N
```

**然后 STOP。**

## STEP U6: 处理完成通知

成功时：
1. 将 material 文件 status 改为 `consumed`（此时才标记，不是 U3）
2. 通知用户：
```
🦉 Aristotle done [undo-trigger]. Review: /aristotle review N
```

失败时（检测方法：background_output 返回错误或 Reflector 输出 "No actionable errors" 以外的异常）：

1. 重新读取 material 文件
2. `retry_count++`
3. 如果 `retry_count <= max_retries`：
   - 设置 `status: "retry_pending"`
   - 设置 `last_error: "<错误信息>"`
   - 写回 material 文件
   - 通知用户：
     ```
     🦉 Aristotle Reflector failed [undo-trigger]. Will retry on next activation (attempt ${retry_count}/${max_retries}).
     ```
4. 如果 `retry_count > max_retries`：
   - 设置 `status: "failed"`
   - 设置 `last_error: "<错误信息>"`
   - 写回 material 文件
   - 通知用户：
     ```
     🦉 Aristotle Reflector failed [undo-trigger] after ${max_retries} retries. Material saved for manual inspection:
       ${PROJECT_DIR}/.opencode/aristotle-undo-material.json
     ```
```

---

## 3. 改动 `REFLECT.md`（+14 行）

### 插入位置

在 `STEP F1: COLLECT MINIMAL CONTEXT` 的开头（line 9 之后），在 `target_session_id` 解析之前，插入 undo 检测。

### 具体改动

```markdown
### Undo Trigger Detection (Pre-check)

Before resolving `target_session_id`, check for pending undo evidence:

1. Check if file `${PROJECT_DIR}/.opencode/aristotle-undo-material.json` exists
2. If the file exists, read it and check `status`:
   - `pending` or `retry_pending` → undo evidence available
   - `consumed` or `failed` → no action needed
3. If undo evidence available:
   - Read `${SKILL_DIR}/UNDO_REFLECT.md` and execute that protocol instead
   - **STOP** — do not continue with the standard reflect flow below
4. If no undo evidence (or file doesn't exist) → proceed with standard reflect flow
```

---

## 4. REFLECTOR.md — 文件不改（0 行），但 prompt 引导行为

**REFLECTOR.md 文件本身不改（0 行改动）。** 但 UNDO_REFLECT.md 的 U2 prompt 通过自然语言指令引导 Reflector 的行为：

- 替代 R1 的 `session_read()`：告诉 Reflector 从 material 文件读取上下文
- 简化 R2 的纠错扫描：告诉 Reflector `/undo` 本身就是错误信号，无需扫描纠正关键词
- R3-R4 走标准流程（5-Why 分析 + DRAFT 生成）

**这是 prompt 级引导，不是文件级解耦。** 如果 REFLECTOR.md 未来修改 R1/R2 的语义，U2 的 prompt 可能需要同步调整。因此 UNDO_REFLECT.md 中应记录这个依赖关系：

> ⚠️ 依赖 REFLECTOR.md 的 R1（session_read）和 R2（纠错模式扫描）的当前行为。如果 REFLECTOR.md 修改了这两个步骤的语义，U2 的 prompt 可能需要同步更新。

---

## 5. 改动 `SKILL.md`（+2 行）

### 5.1 description 字段追加

在 line 3 的 description 末尾追加：

```
 Also auto-triggers after /undo when the aristotle-undo plugin detects an undo event.
```

### 5.2 Parse Arguments 注释

在 line 53 之后追加：

```
(aristotle-undo plugin trigger)       → REFLECT: auto-detected from /undo event, reads material file
```

---

## 6. 改动 `ROADMAP.md`（+14 行）

在 V1.1 区块 V1.1c 之后追加：

```markdown
### V1.1d Undo-Triggered Reflection

**目标：** 用户 /undo 后自动触发 Aristotle 反思，捕获被撤销的对话上下文。

**组件：**
- Plugin：`plugins/aristotle-undo/`（event hook 传感器 + queue + material 文件构建 + chat.message 注入）
- 协议：`UNDO_REFLECT.md`（极简化：检查 material → 传路径 → 处理完成/失败）
- 路由：`REFLECT.md`（F1 加 undo 检测分支）
- 执行：`REFLECTOR.md` **不变**（读通用 material 文件，走标准 R1-R4）

**改动文件：** UNDO_REFLECT.md（新建）、REFLECT.md（+undo 分支）、SKILL.md（+description）、plugins/aristotle-undo/src/index.ts（queue + material 改造）

**不改动的文件：** REFLECTOR.md（Reflector 不感知 undo）

**重试机制：** Material 文件含 status + retry_count。Reflector 失败后自动重试（max 2 次），material 文件持久化 prompt 材料，重试时重新启动 Reflector 读同一文件。

**已验证：**
- `/undo` + `ctrl+x u` 均触发 session.diff → plugin 检测 ✅
- chat.message 注入 `[system]` 指令 → AI 执行 /aristotle ✅
- synthetic:false 使 AI 将注入视为可执行指令 ✅
```

---

## 7. 改动 `README.md`（+4 行）

在 Features 列表末尾追加：

```markdown
- **Undo-Triggered Reflection** — When the `aristotle-undo` plugin detects a `/undo` operation, it automatically injects a `[system]` instruction into your next message to trigger Aristotle's reflection on the reverted response. This injection is visible in the chat — this is intentional and required for reliable AI activation. See [aristotle-undo plugin](plugins/aristotle-undo/) for details.
```

---

## 8. .gitignore 更新

删除旧规则：
```
aristotle-undo-snapshot.json
aristotle-undo-evidence.json
```

新增：
```
aristotle-undo-queue.json
aristotle-undo-material.json
```

---

## 9. Material 文件完整生命周期（状态机）

```
                    Plugin 检测 undo
                    写 material (status=pending)
                          │
                          ▼
               ┌─────────────────────┐
               │   status: pending   │
               └──────────┬──────────┘
                          │
              UNDO_REFLECT 读 material
              启动 Reflector
                          │
                          ▼
               ┌──────────────────────┐
               │  status: processing  │  ← U2: 启动 R 后立即设置
               └──────────┬───────────┘
                          │
              收到 R 完成通知（U6）
                          │
              ┌───────────┴───────────┐
              │                       │
          Reflector 成功          Reflector 失败
              │                       │
              ▼                       ▼
    ┌──────────────────┐    retry_count++ ≤ max_retries?
    │ status: consumed │         │               │
    └──────────────────┘        Yes              No
         │                       │               │
    Plugin 下次 undo             ▼               ▼
    可安全覆盖         ┌─────────────────┐  ┌──────────────┐
                        │ status:         │  │ status:      │
                        │ retry_pending   │  │ failed       │
                        └────────┬────────┘  └──────────────┘
                                 │               │
                       下次 AI 触发        通知用户 material 保留
                       REFLECT.md 检测      可用 /aristotle retry (V1.1e)
                       retry_pending
                       → 重新执行 UNDO_REFLECT
                       → 重新启动 Reflector
                       → 读同一个 material 文件
```

### 状态说明

| 状态 | 含义 | 写入者 | 下次行为 |
|------|------|--------|---------|
| `pending` | 首次创建，等待处理 | Plugin | UNDO_REFLECT 启动 R |
| `processing` | R 正在运行中 | UNDO_REFLECT (U2) | Plugin 追加不覆盖；UNDO_REFLECT 不重复启动 |
| `consumed` | R 成功完成 | UNDO_REFLECT (U6) | Plugin 下次可覆盖 |
| `retry_pending` | R 失败，等待重试 | UNDO_REFLECT (U6) | 下次 AI 触发时重试 |
| `failed` | 超过最大重试次数 | UNDO_REFLECT (U6) | 通知用户，不自动重试 |

---

## 10. 边界情况处理

### 10.1 Plugin 写 Material 时

| 情况 | 处理 |
|------|------|
| Material 文件不存在 | 创建，status=pending |
| Material status=pending | 追加新 undo 条目（保护正在等待 R 的数据） |
| Material status=processing | 追加新 undo 条目（R 正在运行，不覆盖） |
| Material status=consumed | 安全覆盖（上一轮已处理完） |
| Material status=retry_pending | 追加新 undo 条目（R 可能正在重试） |
| Material status=failed | 覆盖（已放弃，新 undo 优先） |
| session.messages() 失败 | 写 material 但 entries 标记 `context_incomplete: true` |
| prev_msg_index=0 | background 为空，只分析 undo 条目本身 |

### 10.2 UNDO_REFLECT 读 Material 时

| 情况 | 处理 |
|------|------|
| 文件不存在 | 回退标准 REFLECT 流程 |
| status=pending | 首次处理，继续 U2 |
| status=processing | R 正在运行，不重复启动，输出提示后 STOP |
| status=retry_pending | 重试，继续 U2 |
| status=consumed | 跳过（已处理），回退标准流程 |
| status=failed | 跳过 + 通知用户 material 保存位置和 `/aristotle retry` (V1.1e) |
| 文件内容损坏/空 | 删除文件，回退标准流程 |

### 10.3 Reflector 读 Material 时

| 情况 | 处理 |
|------|------|
| 文件存在且格式正确 | 正常分析 |
| `context_incomplete=true` | 只基于 user_message + assistant_message 分析 |
| 文件不存在（R 启动后被删） | 输出错误 → STOP → 触发重试机制 |

### 10.4 Material 文件清理与遗留处理

| 时机 | 操作 |
|------|------|
| UNDO_REFLECT 启动 R 后（U2） | status → processing（R 正在运行） |
| R 成功完成（U6） | status → consumed |
| R 失败（U6） | status → retry_pending 或 failed |
| status=failed 后 | 保留文件供用户手动检查 |
| Plugin 下次检测 undo 且 status=consumed | 覆盖写入新 material |
| Plugin 启动时检测 pending/processing/retry_pending | 不清理、不改状态，设 pendingNotification flag |
| 用户首次发消息且 pendingNotification=true | 注入 `[system]` 提示，消费 flag |

**为什么不清理孤儿**：material 文件包含完整的反思数据（background + user_message + assistant_message），反思流程可以正常完成。清理会丢失不可恢复的分析材料。正确的做法是提醒用户运行 `/aristotle` 完成遗留任务。

---

## 11. 重试机制设计

### 范围

仅覆盖 undo 触发的反思重试。全局重试机制（覆盖关键词触发、被动触发）在后续版本设计。

### 重试触发点

REFLECT.md 的 Undo Trigger Detection 检查 material 文件时，如果 `status=retry_pending`，自动重新执行 UNDO_REFLECT.md，不需要用户操作。

### 重试限制

- 最大重试次数：2（`material.max_retries`）
- 重试间隔：无显式间隔，依赖下次 AI 触发（用户发消息或 `/aristotle`）
- Prompt 持久化：material 文件本身就是持久化的 prompt 材料，重试时 Reflector 重新读同一个文件

### 重试失败后

Material 文件 status 改为 `failed`，通知用户文件路径。用户可以：
- 执行 `/aristotle retry`（V1.1e，通用重试命令）— 将 material 的 `status` 改回 `retry_pending`，`retry_count` 归零，重新拉起 Reflector
- 手动 `/aristotle` 触发标准反思（不依赖 material）
- 检查 material 文件内容判断问题

> **注意**：`/aristotle retry` 是通用重试命令（V1.1e），不区分 undo 与否，可以重试所有失败的反思任务。本次 scope 内只保留 failed 的 material 文件 + 通知用户路径，retry 命令的实现留待 V1.1e。

---

## 12. 测试设计

### 12.1 Plugin 单元测试更新

```typescript
describe("Queue operations", () => {
  test("session.idle writes normal entry to queue with msg_index");
  test("session.idle pops old normal entries before pushing new");
  test("session.idle preserves undo entries when pushing new normal");
  test("session.diff with no prior snapshotWritten pushes undo entry");
  test("undo entry gets prev_msg_index from last normal entry");
  test("consecutive undos push multiple undo entries");
  test("queue file is created with correct structure");
  test("empty queue returns null from readQueue");
});

describe("Material operations", () => {
  test("session.diff creates material file on first undo");
  test("material contains entries with background, user_message, assistant_message");
  test("material status is pending on creation");
  test("consecutive undo appends to existing pending material");
  test("consecutive undo overwrites consumed material");
  test("consecutive undo appends to retry_pending material");
  test("material marks context_incomplete when session read fails");
  test("material entry assistant_message truncated to 2000 chars");
});

describe("chat.message hook — signal injection", () => {
  // 现有 5 个测试保留，不变
});
```

### 12.2 Live Test 设计

```
1. 启动 opencode + plugin
2. 发送 "hello" → 等 session.idle → 检查 queue 有 1 条 normal
3. 发送 "tell me a joke" → 等 session.idle → 检查 queue 有 1 条 normal(seq=3)
4. /undo → 等 session.diff → 检查 queue 有 1 normal + 1 undo
                           → 检查 material 文件存在(status=pending, entries=1)
5. /undo again → 检查 queue 有 1 normal + 2 undo
              → 检查 material(status=pending, entries=2)
6. 发送新消息 "what is 2+2?" → 验证 [system] 注入 → AI 执行 /aristotle
7. 检查 Reflector 启动 → material status 变为 consumed
8. 再次 /undo → 检查 material 被覆盖（status=pending，新条目）
```

### 12.3 协议文件测试

- 检查 `UNDO_REFLECT.md` 文件存在
- 检查包含 STEP U1-U6
- 检查包含 "retry_pending" 和 "max_retries"（重试机制）
- 检查 `REFLECT.md` 包含 "Undo Trigger Detection" 文本
- 检查 `REFLECTOR.md` **未被修改**（仍为 195 行）

---

## 13. 实施顺序

```
Phase 1: Plugin 改造
  1a. 替换 Snapshot → Queue + Material 数据结构
  1b. 改造 session.idle handler（queue 操作）
  1c. 改造 session.diff handler（queue + material 操作）
  1d. 新增 buildMaterial() 函数
  1e. 更新单元测试
  1f. 运行测试确认全绿

Phase 2: 协议文件
  2a. 新建 UNDO_REFLECT.md（极简化：检查 material → 传路径 → 状态管理）
  2b. 改动 REFLECT.md（+undo 分支）
  2c. 改动 SKILL.md（+description）
  2d. （不改 REFLECTOR.md）

Phase 3: 文档 + 配置
  3a. 改动 ROADMAP.md
  3b. 改动 README.md
  3c. 更新 .gitignore

Phase 4: 验证
  4a. 运行 test.sh（静态测试）
  4b. 运行 plugin 单元测试
  4c. Live test: /undo → queue → material → 反思 → DRAFT
```

---

## 14. 不改动的文件（确认清单）

| 文件 | 原因 |
|------|------|
| **`REFLECTOR.md`** | **核心：Reflector 不感知 undo，从通用 material 文件读取分析材料** |
| `REVIEW.md` | Review 流程不涉及 undo |
| `LEARN.md` | Learn 流程不变 |
| `CHECKER.md` | Checker 流程不变 |
| `GEAR.md` | 协议规范不变 |
| `aristotle_mcp/server.py` | MCP server 不变 |
| `aristotle_mcp/*.py` | 所有 MCP 模块不变 |
| `install.sh` / `install.ps1` | 安装脚本不变（plugin 需用户单独安装） |
| `test/test_mcp.py` | MCP 测试不变 |
