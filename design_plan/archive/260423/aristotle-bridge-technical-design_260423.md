# Aristotle Bridge — 技术方案文档

**版本**: v8 (v1.2 决策合并：input.tool + 磁盘持久化 + agent-driven undo)
**日期**: 2026-04-23
**状态**: Ralph Loop 进行中

---

## 1. Header

| 属性 | 值 |
|------|-----|
| 文档名称 | Aristotle Bridge 技术设计 |
| 版本 | v8 |
| 前序版本 | v7 (Gate #1 验证后) + v1.2 (确认决策合并) |
| 核心变更 | 删除 undo-interceptor.ts；新增 aristotle_abort 工具；aristotle_check() 支持无参模式；agent-driven undo |
| Bridge 检测 | `.bridge-active` 标记文件 |
| 通知模式 | **纯被动查询** — noReply 已验证不可用 (#4431/#14451) |
| 存储模式 | **磁盘持久化** — 插件进程随 OpenCode 退出而消亡，无 destroy/unload hook |

---

## 2. 架构总览

```
┌─ OpenCode 主进程 ────────────────────────────────────────────┐
│                                                               │
│  主 session                     Aristotle MCP Server (stdio)  │
│  ├─ SKILL.md (指令)             ├─ GEAR 引擎 ✅               │
│  ├─ t_session_search (OMC)      ├─ 规则管理 (git) ✅          │
│  ├─ orchestrate_start (MCP)     ├─ on_undo tool ✅            │
│  └─ aristotle_fire_o (Bridge)   └─ orchestrate_on_event ✅    │
│                                                               │
│  ┌─ Bridge Plugin (Layer 1) ───────────────────────────────┐ │
│  │  aristotle_fire_o → promptAsync → 后台子代理             │ │
│  │  aristotle_check → 查 store → 返回状态/结果/全部 active    │ │
│  │  aristotle_abort → 标记 cancelled + abort 子会话         │ │
│  │  session.idle → 收集结果 → 更新 store（跳过 cancelled）  │ │
│  │  snapshot-extractor → SDK 提取 session → snapshot.json   │ │
│  │  WorkflowStore (磁盘持久化 + 启动 reconciliation)        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  共享文件: ~/.config/opencode/aristotle-sessions/             │
│    {session_id}_snapshot.json (原子写入)                      │
│    bridge-workflows.json (磁盘持久化 store)                   │
└───────────────────────────────────────────────────────────────┘
```

**关键原则（来自 v1.2，保持不变）**:
1. Aristotle MCP Server 保持协议纯净 —— 不含任何 OpenCode 特定代码
2. Bridge 只做适配，不做业务 —— 不含 GEAR 引擎等业务逻辑
3. Bridge 不直接调用 Aristotle —— 所有结果通过工具查询返回给代理
4. **Bridge 不注入消息到主会话** —— `noReply` 有已知 hang bug (#4431/#14451)，完全避免使用
5. **事件驱动 + 被动查询** —— `promptAsync` 启动，`session.idle` 更新 store，代理轮询 `aristotle_check`

---

## 3. 完整时序图

### 3.1 无 Bridge（Phase 0 only）

```
1. PRE-RESOLVE:
   ├─ Resolve target_session_id
   ├─ t_session_search → extract → write snapshot.json
   └─ Set session_file path

2. ROUTE: orchestrate_start("reflect", {..., session_file})
   └─ Response: {action: "fire_sub", sub_prompt, ...}

3. ACTION: task(prompt=sub_prompt)
   └─ Blocking — wait for subagent to complete

4. POST-ACTION: orchestrate_on_event("subagent_done", ...)
```

### 3.2 有 Bridge（Phase 1）— 被动查询模式

```
1. PRE-RESOLVE:
   ├─ Resolve target_session_id
   ├─ t_session_search → extract → write snapshot.json
   └─ Set session_file path

2. ROUTE: orchestrate_start("reflect", {..., session_file})
   └─ Response: {action: "fire_sub", sub_prompt, ..., use_bridge: true}

3. ACTION (Bridge path — 被动查询):
   ├─ SKILL.md 检测 use_bridge=true
   ├─ 调用 aristotle_fire_o(workflow_id, sub_prompt, target_session_id=...)
   │   └─ Bridge executor:
   │       ├─ 如果 snapshot 不存在 → SnapshotExtractor.extract()
   │       ├─ 创建子会话 → promptAsync → 返回 {status: "running"}
   │       └─ 主 session 立即恢复，不阻塞
   ├─ SKILL.md 返回用户: "🦉 Task launched. workflow_id: wf-123"
   │
   ├─ [主会话继续交互，完全无阻塞]
   │
   ├─ 代理在适当时机调用 aristotle_check(workflow_id):
   │   ├── status="running" → 继续等待（不输出任何内容）
   │   └── status="completed" → 取出 result，继续下一步
   │
   ├─ 取到 result 后 → orchestrate_on_event("subagent_done", result)
   └─ Bridge 后台: session.idle → 收集结果到 WorkflowStore

4. Undo 路径（agent-driven）:
   ├─ 用户执行 /undo
   ├─ SKILL.md "After any /undo" 规则触发:
   │   ├─ 调用 aristotle_check()（无参）→ 获取所有 active workflows
   │   ├─ 对每个 running workflow:
   │   │   ├─ 调用 aristotle_abort(workflow_id) → Bridge 标记 cancelled + abort 子会话
   │   │   └─ 调用 Aristotle MCP on_undo(tool, workflow_id)
   │   └─ 向用户报告: "Workflows aborted: wf-123"
   └─ Bridge idle-handler: 遇到 status="cancelled" → 跳过，不收集结果

5. Abort 路径（用户主动取消）:
   ├─ 用户/代理调用 aristotle_abort(workflow_id)
   ├─ Bridge: 标记 store 为 "cancelled" + session.abort()
   └─ 返回: {status: "cancelled", workflow_id}
```

---

## 4. 模块分解与接口定义

### 4.1 模块结构

```
src/
├── index.ts              # 插件入口（无 undo-interceptor 注册）
├── api-probe.ts          # API 探测（promptAsync 可用性）
├── executor.ts           # 异步任务执行器（promptAsync 路径）
├── workflow-store.ts     # 磁盘持久化 + reconciliation + cancelled 状态
├── idle-handler.ts       # session.idle → 更新 store（跳过 cancelled）
├── snapshot-extractor.ts # SDK session 提取 → snapshot.json
├── utils.ts              # 共享: extractLastAssistantText
└── types.ts              # 类型定义
```

**注意**: 无 `undo-interceptor.ts`。无 `formatCompleteMessage`/`formatUndoMessage`（noReply 已死）。

---

### 4.2 types.ts — 类型定义

```typescript
export interface WorkflowState {
  workflowId: string;
  sessionId: string;           // 子会话 ID
  parentSessionId: string;     // 主会话 ID
  status: 'running' | 'completed' | 'error' | 'undone' | 'cancelled';
  result?: string;             // completed 时的子代理输出
  error?: string;              // error 时的错误信息
  startedAt: number;           // Unix ms 时间戳
  agent: string;               // 子代理名称
}

export type ApiMode = 'promptAsync';  // 仅 promptAsync，无 fallback（决策 #3）

export interface LaunchArgs {
  workflowId: string;
  oPrompt: string;
  agent: string;               // 子代理名称，默认 "R"
  parentSessionId: string;
  targetSessionId?: string;    // 目标会话（用于 snapshot 提取）
}

export interface LaunchResult {
  workflow_id: string;
  session_id: string;
  status: 'running' | 'error';
  message: string;
}
```

---

### 4.3 Layer 0: Python/MCP 侧 — 已实施 ✅

#### 4.3.1 config.py — Sessions 目录 ✅

```python
SESSIONS_DIR_NAME: str = "aristotle-sessions"

def resolve_sessions_dir() -> Path:
    return Path.home() / ".config" / "opencode" / SESSIONS_DIR_NAME
```

#### 4.3.2 _orch_prompts.py — Reflector Prompt ✅

```python
def _build_reflector_prompt(
    target_session_id: str,
    focus_hint: str,
    sequence: int,
    project_directory: str = "",
    user_language: str = "en-US",
    session_file: str = "",  # ✅ 已实施
) -> str:
```

模板变更：
```python
# 在现有 TARGET_SESSION_ID 行之后新增:
SESSION_FILE: {session_file}

# 在模板末尾 IMPORTANT 块中新增:
IMPORTANT: SESSION_FILE is a JSON file. If SESSION_FILE is non-empty, use the Read \
tool to read it, then parse the "messages" array. Each message has "index", "role", \
"content" fields. Do NOT attempt to use session_read or any session API. \
If SESSION_FILE is empty, output "No session data available for reflection." and STOP.
```

#### 4.3.3 _orch_start.py — 透传 session_file + 返回 use_bridge ✅

```python
# reflect 分支内:
session_file = args.get("session_file", "")

# ... 现有逻辑 ...

r_prompt = _build_reflector_prompt(
    target_session_id=target_session_id,
    focus_hint=focus,
    sequence=sequence,
    project_directory=project_directory,
    user_language=user_language,
    session_file=session_file,  # ← ✅ 已实施
)

# Bridge 检测（文件信号）
sessions_dir = resolve_sessions_dir()
bridge_active = (sessions_dir / ".bridge-active").exists()

response = {
    "action": "fire_sub",
    "workflow_id": workflow_id,
    "sub_prompt": r_prompt,
    "sub_role": "R",
    "notify_message": notify_msg,
    "use_bridge": bridge_active,  # ✅ 已实施
}
```

> **Bridge 检测机制**: MCP server 是独立进程，无法通过环境变量感知 OpenCode 插件。改用**文件信号**：Bridge 插件加载时写入 `~/.config/opencode/aristotle-sessions/.bridge-active` 标记文件。`orchestrate_start` 每次调用时检查此文件是否存在。文件检查是原子操作（`Path.exists()`），且不依赖进程启动顺序。

#### 4.3.4 _tools_undo.py — on_undo MCP Tool ✅

```python
def on_undo(workflow_id: str, undo_scope: str = "unknown", timestamp: int = 0) -> dict:
    """接收 undo 事件，标记 workflow 为 undone。不自动 revert git。
    undo_scope 和 timestamp 可选——当主 agent 无法从消息中推断时使用默认值。"""
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"status": "unknown_workflow"}
    workflow["undo_received_at"] = timestamp
    workflow["undo_scope"] = undo_scope
    workflow["status"] = "undone"
    _save_workflow(workflow_id, workflow)
    return {"status": "undone", "workflow_id": workflow_id,
            "message": "Workflow marked as undone."}
```

> `on_undo` 只标记状态，不自动 revert git。Git revert 由用户通过 review 确认。  
> **注册方式**: `server.py` 中 `mcp.tool()(on_undo)` 注册。

#### 4.3.5 _orch_event.py — undone 状态短路 ✅

```python
# orchestrate_on_event 入口处:
workflow = _load_workflow(workflow_id)

# 检查 undo 竞争: 即使 Bridge 侧已标记 undone/被取消，
# <aristotle-task-complete> 可能先于事件到达
if workflow.get("status") in ("undone", "cancelled"):
    return {"action": "notify", "workflow_id": workflow_id,
            "message": "🦉 Workflow was undone/cancelled. Event ignored."}
```

---

### 4.4 Layer 1: TypeScript/Bridge 侧

#### 4.4.1 index.ts — 插件入口

```typescript
import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import type { Plugin, OpencodeClient } from '@opencode-ai/sdk';
import { z } from 'zod';

const sessionsDir = join(homedir(), '.config', 'opencode', 'aristotle-sessions');

export const AristotleBridgePlugin: Plugin = async (ctx) => {
  // 硬性要求: promptAsync 必须可用
  const apiMode = await detectApiMode(ctx.client);
  if (!apiMode) {
    console.error('[aristotle-bridge] promptAsync not available. Plugin disabled.');
    return {}; // 不注册工具
  }

  // 设置 Bridge 激活标记
  const markerPath = join(sessionsDir, '.bridge-active');
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf-8');

  // 注册清理: 插件卸载/进程退出时删除标记
  const cleanup = () => { try { unlinkSync(markerPath); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGHUP', cleanup);

  const store = new WorkflowStore(sessionsDir);
  await store.reconcileOnStartup(ctx.client);
  const executor = new AsyncTaskExecutor(ctx.client, store);
  const idleHandler = new IdleEventHandler(ctx.client, store);

  // 注意: 无 UndoInterceptor 注册（已删除）

  return {
    tool: () => ({
      aristotle_fire_o: tool({
        parameters: z.object({
          workflow_id: z.string(),
          o_prompt: z.string(),
          agent: z.string().optional(),
          target_session_id: z.string().optional(),
        }),
        execute: async (args, toolCtx) => {
          // OpenCode SDK zod 输出保留原始字段名（snake_case），需显式映射
          return executor.launch({
            workflowId: args.workflow_id,
            oPrompt: args.o_prompt,
            agent: args.agent ?? 'R',
            parentSessionId: toolCtx.sessionID,
            targetSessionId: args.target_session_id,
          });
        },
      }),

      // 查询任务状态 — 支持无参模式返回全部 active
      aristotle_check: tool({
        description: 'Check status of Aristotle background task(s).',
        parameters: z.object({
          workflow_id: z.string().optional(),
        }),
        execute: async (args) => {
          if (!args.workflow_id) {
            // 无参模式: 返回所有 active workflows
            return store.getActive();
          }
          return store.retrieve(args.workflow_id);
        },
      }),

      // 显式取消任务（替代 undo-interceptor）
      aristotle_abort: tool({
        description: 'Abort a running Aristotle workflow.',
        parameters: z.object({ workflow_id: z.string() }),
        execute: async (args) => {
          const wf = store.findByWorkflowId(args.workflow_id);
          if (!wf) {
            return { error: 'Workflow not found' };
          }
          if (wf.status === 'cancelled') {
            return { status: 'cancelled', workflow_id: args.workflow_id };
          }
          if (wf.status !== 'running') {
            return { status: wf.status, workflow_id: args.workflow_id };
          }
          await ctx.client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
          store.cancel(args.workflow_id);
          return { status: 'cancelled', workflow_id: args.workflow_id };
        },
      }),
    }),

    event: async ({ event }) => {
      if (event.type === 'session.idle') {
        const sessionID = event.properties?.sessionID;
        if (typeof sessionID === 'string') {
          await idleHandler.handle(sessionID);
        }
      }
    },

    // 注意: 无 'tool.execute.before' undo 拦截 hook（已删除）
    // Undo 完全由 agent 驱动，通过 aristotle_abort 显式调用
  };
};
```

#### 4.4.2 api-probe.ts — API 探测

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { ApiMode } from './types';

export async function detectApiMode(client: OpencodeClient): Promise<ApiMode | null> {
  try {
    const testSession = await client.session.create({
      body: { title: 'aristotle-bridge-api-probe' },
    });
    try {
      await client.session.promptAsync({
        path: { id: testSession.data.id },
        body: { parts: [{ type: 'text', text: 'probe' }] },
      });
      return 'promptAsync';
    } catch {
      return null;  // promptAsync 不可用
    } finally {
      await client.session.delete({ path: { id: testSession.data.id } }).catch(() => {});
    }
}
```

#### 4.4.3 executor.ts — 双路径执行器

```typescript
export class AsyncTaskExecutor {
  constructor(
    private client: OpencodeClient,
    private store: WorkflowStore,
  ) {}

  async launch(args: LaunchArgs): Promise<LaunchResult> {
    // 1. 如果有 target_session_id 且 snapshot 不存在，用 SDK 提取
    //    提取失败不阻塞启动 — 子代理降级为 session_file="" 模式
    if (args.targetSessionId) {
      try {
        const extractor = new SnapshotExtractor();
        if (!extractor.snapshotExists(args.targetSessionId)) {
          await extractor.extract(this.client, args.targetSessionId);
        }
      } catch (e) {
        console.warn('[aristotle-bridge] snapshot extraction failed:', e);
      }
    }

    // 2. 创建子会话
    const session = await this.client.session.create({
      body: { title: `aristotle-${args.workflowId}`, parentID: args.parentSessionId },
    });

    // 3. 注册到 store（先于 promptAsync，防止崩溃丢孤儿）
    const registered = this.store.register({
      workflowId: args.workflowId,
      sessionId: session.data.id,
      parentSessionId: args.parentSessionId,
      status: 'running',
      startedAt: Date.now(),
      agent: args.agent,
    });

    if (!registered) {
      await this.client.session.abort({ path: { id: session.data.id } }).catch(() => {});
      return {
        workflow_id: args.workflowId,
        session_id: '',
        status: 'error',
        message: 'Too many concurrent workflows (max 50). Try again later.',
      };
    }

    // 4. promptAsync（主路径）
    try {
      await this.client.session.promptAsync({
        path: { id: session.data.id },
        body: { agent: args.agent, parts: [{ type: 'text', text: args.oPrompt }] },
      });
    } catch (e) {
      await this.client.session.abort({ path: { id: session.data.id } }).catch(() => {});
      this.store.markError(args.workflowId, `promptAsync failed: ${e}`);
      return {
        workflow_id: args.workflowId,
        session_id: session.data.id,
        status: 'error',
        message: 'Failed to launch sub-session.',
      };
    }

    return {
      workflow_id: args.workflowId,
      session_id: session.data.id,
      status: 'running',
      message:
        '🦉 Task launched. workflow_id: ' + args.workflowId + '. ' +
        'Call aristotle_check("' + args.workflowId + '") to poll status. ' +
        'Call aristotle_abort("' + args.workflowId + '") to cancel.',
    };
  }
}
```

#### 4.4.4 idle-handler.ts — 完成通知

```typescript
export class IdleEventHandler {
  constructor(
    private client: OpencodeClient,
    private store: WorkflowStore,
  ) {}

  async handle(sessionID: string): Promise<void> {
    const wf = this.store.findBySession(sessionID);
    if (!wf || wf.status !== 'running') return; // covers cancelled, completed, error, undone

    try {
      const messages = await this.client.session.messages({ path: { id: sessionID } });
      const result = extractLastAssistantText(messages.data);
      this.store.markCompleted(wf.workflowId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markError(wf.workflowId, message);
    }
  }
}
```

> **不注入消息到主会话** — 结果仅写入 store，由代理通过 `aristotle_check` 主动查询。

#### 4.4.5 utils.ts — 共享工具函数

```typescript
/**
 * 从消息列表中提取最后一个有文本内容的 assistant 消息。
 * 跳过纯 tool-call 轮次（如 persist_draft 调用后无文本输出）。
 * 被 IdleEventHandler 和 WorkflowStore.reconcileOnStartup 共享使用。
 */
export function extractLastAssistantText(
  messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role === 'assistant') {
      const text = msg.parts
        .filter((p): p is { type: 'text'; text: string } =>
          p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text)
        .join('\n')
        .trim();
      if (text) return text; // 跳过空文本（纯 tool-call 轮次）
    }
  }
  return '[ARISTOTLE_BRIDGE:no_text_output]';
}
```

> 只有一个循环。如果所有 assistant 轮次都是纯 tool call（无文本），返回标记字符串。

#### 4.4.6 snapshot-extractor.ts — SDK Session 提取

```typescript
import { mkdirSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class SnapshotExtractor {
  private readonly sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? join(homedir(), '.config', 'opencode', 'aristotle-sessions');
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  async extract(
    client: OpencodeClient,
    sessionId: string,
    focusHint: string = 'last 50 messages',
    limit: number = 50,
  ): Promise<string> {
    const effectiveLimit = Math.min(limit, 200); // 双层截断
    const messages = await client.session.messages({
      path: { id: sessionId },
      query: { limit: effectiveLimit },
    });

    const filtered = messages.data
      .filter(m => m.info.role === 'user' || m.info.role === 'assistant')
      .map((m, i) => ({
        index: i + 1,
        role: m.info.role,
        content: m.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map(p => p.text)
          .join('\n')
          .slice(0, 4000),
      }));

    const snapshot = {
      version: 1,
      session_id: sessionId,
      extracted_at: new Date().toISOString(),
      focus: focusHint,
      source: 'bridge-plugin-sdk',
      total_messages: filtered.length,
      messages: filtered,
    };

    const filePath = join(this.sessionsDir, `${sessionId}_snapshot.json`);
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    renameSync(tmpPath, filePath); // 原子写入
    return filePath;
  }

  snapshotExists(sessionId: string): boolean {
    return existsSync(join(this.sessionsDir, `${sessionId}_snapshot.json`));
  }
}
```

#### 4.4.7 workflow-store.ts — 磁盘持久化 + reconciliation

```typescript
export class WorkflowStore {
  private workflows = new Map<string, WorkflowState>();
  private readonly storePath: string;
  private static readonly MAX_WORKFLOWS = 50;

  constructor(sessionsDir: string) {
    this.storePath = join(sessionsDir, 'bridge-workflows.json');
    this.loadFromDisk();
  }

  /** 启动时调用：检查所有 running 状态的 workflow。并发上限 5。 */
  async reconcileOnStartup(client: OpencodeClient): Promise<void> {
    const running = [...this.workflows.entries()].filter(([_, wf]) => wf.status === 'running');
    // 并发限制：每次最多 5 个 API 调用
    for (let i = 0; i < running.length; i += 5) {
      const batch = running.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async ([id, wf]) => {
          try {
            const msgs = await client.session.messages({ path: { id: wf.sessionId } });
            const hasAssistant = msgs.data.some(m => m.info.role === 'assistant');
            if (hasAssistant) {
              const result = extractLastAssistantText(msgs.data);
              this.markCompleted(id, result);
            }
          } catch {
            this.markError(id, 'Session not found during reconciliation');
          }
        })
      );
      // allSettled 不抛出，仅记录异常（不应到达 catch 内的 catch）
      results.forEach(r => { if (r.status === 'rejected') console.warn('[aristotle-bridge] reconciliation error:', r.reason); });
    }
  }

  register(wf: WorkflowState): boolean {
    if (this.workflows.size >= WorkflowStore.MAX_WORKFLOWS) {
      if (!this.evictOldestCompleted()) {
        return false;
      }
    }
    this.workflows.set(wf.workflowId, wf);
    this.saveToDisk();
    return true;
  }

  markCompleted(id: string, result: string): void {
    const wf = this.workflows.get(id);
    if (wf) { wf.status = 'completed'; wf.result = result; this.saveToDisk(); }
  }

  markError(id: string, error: string): void {
    const wf = this.workflows.get(id);
    if (wf) { wf.status = 'error'; wf.error = error; this.saveToDisk(); }
  }

  // undone 由 Python MCP on_undo 工具设置（通过 Phase 0 状态文件）。
  // Bridge 侧保留此方法用于启动 reconciliation 时同步 Python 侧状态。
  markUndone(id: string): void {
    const wf = this.workflows.get(id);
    if (wf) { wf.status = 'undone'; this.saveToDisk(); }
  }

  // v8 新增: cancelled 状态
  cancel(id: string): void {
    const wf = this.workflows.get(id);
    if (wf) { wf.status = 'cancelled'; this.saveToDisk(); }
  }

  /** 淘汰策略: 只淘汰 completed/error/undone/cancelled，按 startedAt 升序 */
  private evictOldestCompleted(): boolean {
    const candidates = [...this.workflows.entries()]
      .filter(([_, wf]) => wf.status !== 'running')
      .sort(([_, a], [__, b]) => a.startedAt - b.startedAt);
    if (candidates.length > 0) {
      this.workflows.delete(candidates[0][0]);
      return true;
    }
    return false;
  }

  // v8 新增: 无参 check 返回所有 active workflows
  getActive(): { active: Array<{ workflow_id: string; status: string; started_at: number }> } {
    const active = [...this.workflows.values()]
      .filter(wf => wf.status === 'running')
      .map(wf => ({
        workflow_id: wf.workflowId,
        status: wf.status,
        started_at: wf.startedAt,
      }));
    return { active };
  }

  private loadFromDisk(): void {
    try {
      const data = readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      for (const wf of parsed) this.workflows.set(wf.workflowId, wf);
    } catch { /* 文件不存在或损坏，从空 store 开始 */ }
  }

  private saveToDisk(): void {
    try {
      const tmpPath = this.storePath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify([...this.workflows.values()], null, 2), 'utf-8');
      renameSync(tmpPath, this.storePath);
    } catch (e) {
      console.error('[aristotle-bridge] failed to persist workflow store:', e);
      // 内存状态正确但未持久化 — 下次 saveToDisk 成功时覆盖
    }
  }

  // ── 查询方法 ──

  findByWorkflowId(workflowId: string): WorkflowState | undefined {
    return this.workflows.get(workflowId);
  }

  findBySession(sessionId: string): WorkflowState | undefined {
    for (const wf of this.workflows.values()) {
      if (wf.sessionId === sessionId) return wf;
    }
    return undefined;
  }

  retrieve(workflowId: string):
    | { error: string }
    | { status: 'running' }
    | { status: 'error'; error?: string }
    | { status: 'undone' }
    | { status: 'cancelled' }
    | { status: 'completed'; result: string }
  {
    const wf = this.workflows.get(workflowId);
    if (!wf) return { error: 'Workflow not found' };
    if (wf.status === 'running') return { status: 'running' };
    if (wf.status === 'error') return { status: 'error', error: wf.error };
    if (wf.status === 'undone') return { status: 'undone' };
    if (wf.status === 'cancelled') return { status: 'cancelled' };
    return { status: 'completed', result: wf.result || '' };
  }
}
```

---

## 5. 跨模块数据契约

### 5.1 Snapshot JSON Schema（版本 1，稳定接口）

```json
{
  "version": 1,
  "session_id": "ses_abc123",
  "extracted_at": "2026-04-23T15:30:00Z",
  "focus": "last 50 messages",
  "source": "bridge-plugin-sdk",
  "total_messages": 42,
  "messages": [
    { "index": 1, "role": "user", "content": "..." },
    { "index": 2, "role": "assistant", "content": "..." }
  ]
}
```

- `total_messages`: `messages.length`，即过滤+截断后的实际消息数。**注意**: 早期 `session-snapshot-bridge` 文档定义为"过滤前数量"——以本文档为准。
- `content` 每条上限 **4000 字符**（折中：足够覆盖典型代码块+错误栈，200 条 × 4000 字符 ≈ 800KB ≈ ~200K token）
- `messages` 数组上限 **200 条**（硬限制）
- **原子写入**（tmp + rename）
- `version` 字段用于格式演进

### 5.2 工具返回值契约

#### aristotle_fire_o 返回

```typescript
{
  workflow_id: string;
  session_id: string;
  status: 'running' | 'error';
  message: string;  // 包含 workflow_id 和 abort 提示
}
```

#### aristotle_check 返回

**有参模式** (`workflow_id` 提供):
```typescript
{ status: 'running' }
| { status: 'completed', result: string }
| { status: 'error', error?: string }
| { status: 'undone' }
| { status: 'cancelled' }
| { error: 'Workflow not found' }
```

**无参模式** (查询全部 active):
```typescript
{
  active: [
    { workflow_id: string, status: string, started_at: number }
  ]
}
```

#### aristotle_abort 返回

```typescript
// running → cancelled
{ status: 'cancelled', workflow_id: string }
// 已 cancelled（幂等）
{ status: 'cancelled', workflow_id: string }
// 其他终态（completed/error/undone）
{ status: WorkflowState.status, workflow_id: string }
// 不存在
{ error: 'Workflow not found' }
```

---

## 6. SKILL.md 行为变更

### 6.1 PRE-RESOLVE (reflect only)

```markdown
Before calling MCP for reflect:
1. Resolve target_session_id
2. Extract session content:
   a. Ensure directory: Bash("mkdir -p ~/.config/opencode/aristotle-sessions")
   b. Check if snapshot file already exists
      - If exists → skip to step 2f
   c. Call t_session_search(sessionId=target_session_id, limit=50)
   d. Filter to user/assistant roles only
   e. Format as JSON (schema version 1):
      - total_messages = filtered.length
      - source: "t_session_search"
      - content per message: max 4000 chars
      - messages array: max 200 entries
      - Write using Write tool
      - After write, read back to verify JSON validity
   f. Set session_file to the file path
   g. If extraction fails at any step, set session_file=""
3. Detect user_language, project_directory, focus
```

### 6.2 ROUTE → ACTION（Bridge 检测 + 执行路径切换）

```markdown
4. ROUTE: Call MCP orchestrate_start("reflect", {target_session_id, focus,
   project_directory, user_language, session_file})

 5. Check response:
    - If response.use_bridge === true:
       a. Try calling aristotle_fire_o(
            workflow_id=response.workflow_id,
            o_prompt=response.sub_prompt,
            target_session_id=target_session_id)
          - If succeeds → capture response.session_id as bridge_session_id, proceed to step b
          - If fails or tool not found → fall through to blocking path
       b. Return to user: "🦉 Task launched. workflow_id: {id}. I'll check results when ready."
       c. MULTI-STAGE LOOP（reflect→check→… 可能多轮）:
          while true:
            - Call aristotle_check(workflow_id) → poll until status≠"running"
            - status="completed" → extract result, proceed
            - status="error" → report error to user, BREAK
            - status="cancelled" → report "Workflow was cancelled", BREAK
            - status="undone" → report "Workflow was undone", BREAK
            - Max polls per stage: 50
            - 注意：每次 poll 是一个完整的 tool-call round-trip（固有延迟 ~1-3s），无需额外 sleep
          d. Call orchestrate_on_event("subagent_done", {workflow_id, result: result, session_id: bridge_session_id})
          e. If response.action === "fire_sub":
             - Call aristotle_fire_o(workflow_id, o_prompt=response.sub_prompt, agent=response.sub_role)
             - Update bridge_session_id = response.session_id
             - GOTO c (poll next stage)
          f. If response.action === "notify":
             - Display response.message to user, DONE

     - If response.use_bridge is absent or false:
       a. Call task(prompt=response.sub_prompt) — blocking
       b. When complete, call orchestrate_on_event("subagent_done", {workflow_id, result: ..., session_id: ""})
```

### 6.3 After any /undo（新增 v8）

```markdown
## After any /undo command

1. Call aristotle_check() with NO arguments to get all active workflows:
   └─ Returns: { active: [{workflow_id, status, started_at}] }

2. For each active workflow with status "running":
   a. Call aristotle_abort(workflow_id) to cancel the background task
   b. Call Aristotle MCP on_undo(workflow_id, undo_scope="session", timestamp=now)

3. Report to user: "Cancelled N active Aristotle workflow(s): wf-xxx, wf-yyy"

4. If no active workflows: silently continue
```

> **设计理由**: `tool.execute.before` hook 字段名存在不确定性（`input.tool` vs `input.toolName`），且插件进程无 unload/destroy hook 保证清理。改为**显式工具调用**让 agent 完全控制 undo 流程，避免 hook 不可靠导致的竞态。

---

## 7. 决策记录表

| # | 决策 | 理由 | 排斥的替代 |
|---|------|------|-----------|
| 1 | 文件传递 session | 子代理工具可用性不确定，文件 I/O 通用 | 内联传递、session_read 委托 |
| 2 | Bridge 不直接调用 MCP，通过轮询 | `ctx.mcpClient` 不存在；noReply 已验证不可用 | HTTP 直连、noReply 注入（已验证失败） |
| 3 | 仅 promptAsync，无 fallback | fallback 未验证且增加复杂度 | 双路径 |
| 4 | `target_session_id` 显式参数 | Bridge 需要知道提取哪个 session | 从 prompt 解析 |
| 5 | `on_undo` 只标记状态 | revert 是破坏性操作 | 自动 revert |
| 6 | **WorkflowStore 磁盘持久化** | 插件进程随 OpenCode 退出消亡，无 destroy/unload hook | 内存 Map |
| 7 | Snapshot 原子写入 | 防止部分 JSON | 直接 writeFileSync |
| 8 | content 上限 4000 字符 | 折中：覆盖典型代码块，控制总 token | 2000（太短）/ 8000（太大） |
| 9 | Bridge 检测用文件信号（.bridge-active） | MCP server 独立进程，env var 不传播 | LLM 自省、env var |
| 10 | **Undo 改为 agent-driven（删除 undo-interceptor）** | `input.tool` vs `input.toolName` 不确定；无 unload hook | `tool.execute.before` hook 拦截 |
| 11 | Snapshot 不自动清理 | 源数据是一手证据 | 定时清理 |
| 12 | 启动 reconciliation | 恢复重启前的孤儿 workflow | 丢弃（信息丢失） |
| 13 | PRE-RESOLVE 始终提取 | Bridge 可能未装或未提取，保证 fallback | 跳过提取等 Bridge 做（脆弱） |
| 14 | 轮询模式（非消息注入） | Gate #1 FAIL: noReply 不注入 system-reminder | noReply 注入（已验证失败） |
| 15 | **aristotle_abort 显式取消工具** | 替代 undo-interceptor，agent 完全控制 | Hook 自动拦截 |
| 16 | **aristotle_check() 无参模式** | 支持 after-undo 批量查询所有 active workflows | 逐个传入 workflow_id |

---

## 8. 失败模式表

| 场景 | 触发 | 响应 | 降级 |
|------|------|------|------|
| t_session_search 不可用 | 无 OMC | session_file="" | Reflector 输出提示并 STOP |
| Snapshot 损坏/删除 | 手动/磁盘错误 | Reflector Read 失败 | 输出提示并 STOP |
| Snapshot version ≠ 1 | 格式演进 | Reflector 校验 version | 输出 "Incompatible snapshot version" 并 STOP |
| promptAsync 不可用 | OpenCode 版本旧 | 插件拒绝加载 | 主 agent 用 task()（阻塞） |
| 子代理永不 idle | 挂起/崩溃 | Workflow 保持 running | 用户手动 abort |
| Bridge 重启 | 崩溃 | 磁盘恢复 + reconciliation（已知限制：可能将崩溃子代理误判为已完成） | 部分结果被收集 |
| **Undo 触发（agent-driven）** | 用户 /undo | aristotle_check() 无参 → aristotle_abort 每个 active → on_undo | 无（显式流程） |
| 主 agent 不响应 | 忽略系统消息 | 结果在 store | 工作流暂停 |
| 并发 snapshot 写入 | Phase 0 + Bridge | PRE-RESOLVE 在 fire_o 之前完成，基本不重叠；snapshotExists 检查 | 后写入者跳过 |
| Bridge 标记文件过期 | Bridge 崩溃未清理 | aristotle_fire_o 失败 → 降级为 task()（阻塞） | 自动降级 |
| 轮询超过 50 次 | 子代理永不 idle | SKILL.md 输出超时提示，建议手动 abort | 用户手动调用 aristotle_abort |
| WorkflowStore 满 | 50 个 workflow | 淘汰最旧已完成项 | 如全 running 则拒绝新注册 |
| LLM 生成无效 JSON | Phase 0 提取 | 验证+删除+降级 | session_file="" |
| **aristotle_abort 重复调用** | 用户/代理误操作 | 幂等：已 cancelled 返回 `{status:'cancelled'}`，其他终态返回当前状态 | 无副作用 |
| **Snapshot 提取失败（Bridge）** | SDK API 错误 | executor.launch 内 try/catch，不阻塞启动 | 子代理降级为 session_file="" 模式 |
| **Idle 时 workflow 已 cancelled** | abort 与 idle 竞态 | idle-handler 检查 status==='cancelled' → 跳过 | 不收集结果 |

---

## 9. 开放技术问题

| # | 问题 | 风险 | 状态 |
|---|------|------|------|
| 1 | ~~`session.prompt({noReply:true})` 是否产生 system-reminder~~ | ~~如果不产生，通知链断裂~~ | **已解决：FAIL → 改用轮询模式** |
| 2 | ~~`tool.execute.before` 字段名 `tool` vs `toolName`~~ | ~~不确定性导致 hook 不可靠~~ | **已解决：删除 undo-interceptor，改用显式 aristotle_abort** |
| 3 | ~~插件进程 unload/destroy hook~~ | ~~无法保证清理 undo-interceptor 状态~~ | **已解决：磁盘持久化 + agent-driven undo** |
| 4 | SKILL.md JSON 格式化依赖 LLM 准确性 | 可能生成无效 JSON | Phase 1 接管后消除 |
| 5 | `session.idle` 事件触发时机 | 子代理完成到 idle 可能有延迟 | 待观测，代理轮询可容忍 |

> **Gate #1 验证记录**（2026-04-23）：
> - `opencode serve` 模式：`session.prompt({noReply:true})` 不注入消息到 session messages
> - `opencode run` 模式：插件 event hook 不被触发（隔离环境下）
> - 结论：noReply 模式不可用于 Bridge 通知链，改用 SKILL.md 轮询 `aristotle_check`

---

## 10. 测试计划

### 10.1 Phase 0 测试（Python/SKILL 层）— 已完成 ✅

| 类型 | 测试项 | 状态 |
|------|--------|------|
| pytest | `test_build_reflector_prompt_includes_session_file` | ✅ |
| pytest | `test_build_reflector_prompt_empty_session_file` | ✅ |
| pytest | `test_orchestrate_start_reflect_passes_session_file` | ✅ |
| pytest | `test_resolve_sessions_dir` | ✅ |
| pytest | `test_orchestrate_start_reflect_returns_use_bridge_when_marker_exists` | ✅ |
| pytest | `test_orchestrate_start_reflect_no_use_bridge_by_default` | ✅ |
| pytest | `test_on_undo_marks_workflow_undone` | ✅ |
| pytest | `test_on_undo_unknown_workflow` | ✅ |
| pytest | `test_orchestrate_on_event_ignores_undone_workflow` | ✅ |
| static | REFLECTOR.md 不含 "session_read" | ✅ |
| static | `_orch_prompts.py` 含 "SESSION_FILE" | ✅ |
| static | SKILL.md 含 "session_file" | ✅ |
| static | `config.py` 含 "SESSIONS_DIR" | ✅ |

### 10.2 Phase 1 测试（TypeScript/Bridge 层）— 待实施

| 类型 | 测试项 |
|------|--------|
| unit | `SnapshotExtractor.extract()` — 格式正确、4000 字符截断、200 条上限、原子写入 |
| unit | `SnapshotExtractor.snapshotExists()` — 存在/不存在 |
| unit | `WorkflowStore` — 磁盘持久化、容量淘汰（只淘汰已完成）、满时拒绝 |
| unit | `WorkflowStore.cancel()` — 标记 cancelled 状态、持久化 |
| unit | `WorkflowStore.getActive()` — 无参模式返回所有 running workflows |
| unit | `extractLastAssistantText()` — `{info, parts}` 格式、跳过纯 tool-call、兜底字符串 |
| unit | `IdleEventHandler.handle()` — 跳过 cancelled、正常收集结果、错误处理 |
| unit | `aristotle_abort` 工具 — 取消 running workflow、幂等（重复取消/已取消返回 `{status:'cancelled'}`、其他终态返回当前状态） |
| integration | `executor.launch()` — promptAsync 调用、snapshot 条件提取 |
| integration | 启动 reconciliation — running 状态 workflow 恢复 |
| integration | `aristotle_check()` 无参模式 — 返回正确 active 列表 |

---

## 11. 实施计划

| Phase | 范围 | 依赖 | 状态 |
|-------|------|------|------|
| **Phase 0** | Layer 0: config + prompts + start + undo tool + event + REFLECTOR.md + SKILL.md | OMC（可选） | ✅ **已完成** |
| **Phase 1** | Layer 1: Bridge Plugin（7 模块 + 测试） | OpenCode SDK + Gate #1 验证 | 🔄 进行中 |
| **Phase 2** | Layer 2: SKILL.md after-undo 规则 + agent-driven abort 集成 | Phase 1 | ⏳ 待启动 |
| **Phase 3** | 端到端集成测试（Bridge + Aristotle + undo 场景） | Phase 2 | ⏳ 待启动 |

**Phase 1 详细任务**:

| 文件 | 行数 | 说明 |
|------|------|------|
| `types.ts` | 25 | WorkflowState 含 cancelled 状态 |
| `api-probe.ts` | 30 | API 探测 |
| `utils.ts` | 25 | extractLastAssistantText |
| `snapshot-extractor.ts` | 55 | SDK 提取 + 原子写入 |
| `workflow-store.ts` | 90 | 磁盘持久化 + reconcile + cancel + getActive |
| `executor.ts` | 60 | promptAsync 路径 + snapshot 条件提取 |
| `idle-handler.ts` | 35 | 更新 store（跳过 cancelled） |
| `index.ts` | 85 | 插件入口：3 个工具（fire_o/check/abort） |
| `*.test.ts` | ~200 | 单元 + 集成测试 |

**已删除（v7 → v8）**:
- ~~`undo-interceptor.ts`~~ — 由 `aristotle_abort` 工具替代
- ~~`formatCompleteMessage()`~~ — noReply 已死
- ~~`formatUndoMessage()`~~ — noReply 已死
- ~~`'tool.execute.before' hook 注册~~ — agent-driven undo
