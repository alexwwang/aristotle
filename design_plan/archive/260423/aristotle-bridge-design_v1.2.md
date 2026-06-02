设计的本质，是消除一切不必要的差异后，那个不得不存在的差异。
# Aristotle Async Bridge Plugin — 技术方案文档

**版本**: v1.2  
**日期**: 2026-04-23  
**状态**: 已修正 — 放弃消息注入（`noReply` 有 hang bug），改用纯被动查询模式

> **v1.0 → v1.1**: 移除 MCP 直连，改为 `session.prompt({noReply})` 消息注入。  
> **v1.1 → v1.2**: 放弃消息注入（OpenCode bug #4431 / #14451），新增 `aristotle_check` 工具，代理主动查询任务状态。

---

## 1. 方案概述

### 1.1 设计目标

| 能力 | 说明 |
|------|------|
| **异步 Subagent 执行** | Aristotle 的 `fire_o` 通过 Bridge 非阻塞启动后台子代理，主会话保持可交互 |
| **Undo 操作感知** | 拦截 `undo` 工具调用，标记相关 workflow 为 `undone` |
| **OMO/OMO-Slim 无感共存** | Bridge 作为独立 OpenCode 插件，不依赖、不修改 OMO |
| **渐进式采用** | Bridge 是可选组件。无 Bridge 时 `fire_o` 同步阻塞；有 Bridge 时自动升级异步 |

### 1.2 核心原则

1. **Aristotle MCP Server 保持协议纯净** — 不含任何 OpenCode 特定代码
2. **Bridge 只做适配，不做业务** — 不含 GEAR 引擎等业务逻辑
3. **Bridge 不直接调用 Aristotle** — 所有结果通过工具查询返回给代理，由代理自行决定下一步
4. **Bridge 不注入消息到主会话** — `session.prompt({noReply})` 有已知 hang bug，完全避免使用
5. **事件驱动 + 被动查询** — `session.promptAsync()` 启动任务，`session.idle` 更新状态，代理通过 `aristotle_check` 查询

---

## 2. 架构全景

```
OpenCode 主进程 (in-process plugins)
├─ OMO-Slim (可选): task, delegate_task
├─ OMO (可选): delegate_task, background_output
└─ Bridge Plugin
    ├─ aristotle_fire_o ──► session.create() + promptAsync()
    ├─ aristotle_check  ──► 查 store，返回状态/结果
    ├─ aristotle_retrieve ──► 查 store，返回完整结果
    ├─ session.idle 监听 ──► 更新 store（不通知主会话）
    └─ undo Hook 拦截 ──► 标记 workflow undone + abort 后台会话

                    Bridge 与 Aristotle 不直接通信
                    所有交互通过 OpenCode 代理中转：

    代理 ──► aristotle_fire_o() ──► Bridge 启动后台 subagent
      │
      │   [主会话继续交互，完全无阻塞]
      │
      ├──► aristotle_check(wf_id) ──► Bridge 查 store ──► 返回 {status, result?}
      │                                    │
      │   如果 completed                    │
      │   ├──► aristotle_retrieve(wf_id) ──► Bridge 查 store ──► 返回 {result}
      │   │
      │   └──► 代理调用 Aristotle MCP orchestrate_on_event() ──► Aristotle
      │
      └──► 用户 undo ──► Bridge Hook 标记 undone
            └──► 代理调用 Aristotle MCP on_undo() ──► Aristotle

                              Aristotle MCP Server
                              (独立进程, stdio/SSE)
                              - GEAR 引擎
                              - git rules
                              - on_undo tool
```

---

## 3. OpenCode 已知 Bug（本方案回避）

| Bug | Issue | 影响 | 本方案处理 |
|-----|-------|------|-----------|
| `noReply: true` 在 1.0.69+ 进入 agent loop 导致 hang | #4431 | `session.prompt({noReply})` 无限卡住 | **完全避免使用** |
| `noReply` 注入的是 User 消息而非 system-reminder | #14451 | 代理难以识别 | **完全避免使用** |

**结论**: Bridge 不调用 `session.prompt({noReply})` 向主会话注入任何消息。任务完成状态仅保存在 Bridge 内部 store 中，由代理通过 `aristotle_check` 主动查询。

---

## 4. Bridge Plugin 详细设计

### 4.1 模块结构

```
src/
├── index.ts              # 插件入口，注册 hooks
├── api-probe.ts          # 启动时 API 探测
├── executor.ts           # 双路径任务执行器
├── workflow-store.ts     # workflow 状态存储
├── idle-handler.ts       # session.idle 事件处理（仅更新 store）
├── undo-interceptor.ts   # undo Hook 拦截
└── types.ts              # 类型定义
```

### 4.2 核心数据模型

```typescript
// types.ts

interface WorkflowState {
  workflowId: string;
  sessionId: string;
  parentSessionId: string;
  parentMessageId: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'undone';
  result?: string;
  error?: string;
  startedAt: number;
  agent: string;
}

type ApiMode = 'promptAsync' | 'fireAndForget';
```

### 4.3 插件入口 (`index.ts`)

```typescript
import type { Plugin } from '@opencode-ai/plugin';
import { z } from 'zod';
import { tool } from '@opencode-ai/plugin';
import { detectApiMode } from './api-probe';
import { AsyncTaskExecutor } from './executor';
import { WorkflowStore } from './workflow-store';
import { IdleEventHandler } from './idle-handler';
import { UndoInterceptor } from './undo-interceptor';

export const AristotleBridgePlugin: Plugin = async (ctx) => {
  const apiMode = await detectApiMode(ctx.client);
  console.log(`[aristotle-bridge] API mode: ${apiMode}`);

  const store = new WorkflowStore();
  const executor = new AsyncTaskExecutor(ctx.client, apiMode, store);
  const idleHandler = new IdleEventHandler(ctx.client, store);
  const undoInterceptor = new UndoInterceptor(ctx.client, store);

  return {
    tool: () => ({
      // ── 启动后台任务 ──
      aristotle_fire_o: tool({
        description:
          `Launch an Aristotle subagent task asynchronously in the background. ` +
          `Returns immediately with a workflow_id. ` +
          `Call aristotle_check(workflow_id) later to query status. ` +
          `Do NOT call aristotle_retrieve until aristotle_check returns "completed".`,
        parameters: z.object({
          workflow_id: z.string().describe('Unique workflow ID for tracking'),
          o_prompt: z.string().describe('The orchestrated prompt to execute'),
          agent: z.string().optional().describe('Subagent to use (default: "default")'),
        }),
        execute: async (args, toolCtx) => {
          return executor.launch({
            workflowId: args.workflow_id,
            oPrompt: args.o_prompt,
            agent: args.agent || 'default',
            parentSessionId: toolCtx.sessionID,
            parentMessageId: toolCtx.messageID,
          });
        },
      }),

      // ── 查询任务状态（新增） ──
      aristotle_check: tool({
        description:
          `Check the status of an Aristotle background task. ` +
          `Returns immediately: {status: "running"} if still in progress, ` +
          `or {status: "completed", result: "..."} if done. ` +
          `Use this to poll for completion.`,
        parameters: z.object({
          workflow_id: z.string().describe('The workflow ID from aristotle_fire_o'),
        }),
        execute: async (args) => {
          return store.retrieve(args.workflow_id);
        },
      }),

      // ── 获取已完成任务结果 ──
      aristotle_retrieve: tool({
        description:
          `Retrieve the full result of a completed Aristotle task. ` +
          `Only call after aristotle_check returns "completed".`,
        parameters: z.object({
          workflow_id: z.string().describe('The workflow ID from aristotle_fire_o'),
        }),
        execute: async (args) => {
          return store.retrieve(args.workflow_id);
        },
      }),
    }),

    // ── session.idle 事件：仅更新 store，不通知主会话 ──
    event: async ({ event }) => {
      if (event.type === 'session.idle') {
        const sessionID = event.properties?.sessionID;
        if (typeof sessionID === 'string') {
          await idleHandler.handle(sessionID);
        }
      }
    },

    // ── undo 拦截：标记 undone，abort 后台会话 ──
    'tool.execute.before': async (input, output) => {
      if (input.toolName === 'undo') {
        await undoInterceptor.handle(input.sessionID);
        // proceed 保持 true，不阻止原生 undo
      }
    },
  };
};
```

### 4.4 API 探测 (`api-probe.ts`)

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';

export type ApiMode = 'promptAsync' | 'fireAndForget';

export async function detectApiMode(client: OpencodeClient): Promise<ApiMode> {
  try {
    const testSession = await client.session.create({
      body: { title: 'aristotle-bridge-api-probe' },
    });
    await client.session.promptAsync({
      path: { id: testSession.data.id },
      body: { parts: [{ type: 'text', text: 'probe' }] },
    });
    await client.session.delete({ path: { id: testSession.data.id } });
    return 'promptAsync';
  } catch {
    return 'fireAndForget';
  }
}
```

### 4.5 双路径执行器 (`executor.ts`)

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { WorkflowStore } from './workflow-store';
import type { ApiMode } from './api-probe';

interface LaunchArgs {
  workflowId: string;
  oPrompt: string;
  agent: string;
  parentSessionId: string;
  parentMessageId: string;
}

export class AsyncTaskExecutor {
  constructor(
    private client: OpencodeClient,
    private mode: ApiMode,
    private store: WorkflowStore,
  ) {}

  async launch(args: LaunchArgs) {
    const session = await this.client.session.create({
      body: {
        title: `aristotle-${args.workflowId}`,
        parentID: args.parentSessionId,
      },
    });

    const sessionId = session.data.id;

    this.store.register({
      workflowId: args.workflowId,
      sessionId,
      parentSessionId: args.parentSessionId,
      parentMessageId: args.parentMessageId,
      status: 'running',
      startedAt: Date.now(),
      agent: args.agent,
    });

    const promptBody = {
      agent: args.agent,
      parts: [{ type: 'text' as const, text: args.oPrompt }],
    };

    if (this.mode === 'promptAsync') {
      await this.client.session.promptAsync({
        path: { id: sessionId },
        body: promptBody,
      });
    } else {
      this.client.session
        .prompt({ path: { id: sessionId }, body: promptBody })
        .catch((error: Error) => {
          console.error(`[bridge] Task ${args.workflowId} failed:`, error);
          this.store.markError(args.workflowId, error.message);
        });
    }

    return {
      workflow_id: args.workflowId,
      session_id: sessionId,
      status: 'running' as const,
      message:
        'Task launched in background. ' +
        'Use aristotle_check(workflow_id) to poll for status. ' +
        'Do NOT use aristotle_retrieve until status is "completed".',
    };
  }
}
```

### 4.6 Workflow 状态存储 (`workflow-store.ts`)

```typescript
import type { WorkflowState } from './types';

export class WorkflowStore {
  private workflows = new Map<string, WorkflowState>();

  register(wf: WorkflowState) {
    this.workflows.set(wf.workflowId, wf);
  }

  findBySession(sessionId: string): WorkflowState | undefined {
    for (const wf of this.workflows.values()) {
      if (wf.sessionId === sessionId) return wf;
    }
    return undefined;
  }

  getActiveByParentSession(parentSessionId: string): WorkflowState[] {
    const result: WorkflowState[] = [];
    for (const wf of this.workflows.values()) {
      if (wf.parentSessionId === parentSessionId && wf.status === 'running') {
        result.push(wf);
      }
    }
    return result;
  }

  markCompleted(workflowId: string, result: string) {
    const wf = this.workflows.get(workflowId);
    if (wf) {
      wf.status = 'completed';
      wf.result = result;
    }
  }

  markError(workflowId: string, error: string) {
    const wf = this.workflows.get(workflowId);
    if (wf) {
      wf.status = 'error';
      wf.error = error;
    }
  }

  markUndone(workflowId: string) {
    const wf = this.workflows.get(workflowId);
    if (wf) {
      wf.status = 'undone';
    }
  }

  retrieve(workflowId: string) {
    const wf = this.workflows.get(workflowId);
    if (!wf) return { error: 'Workflow not found' };
    if (wf.status === 'running') return { status: 'running' };
    if (wf.status === 'error') return { status: 'error', error: wf.error };
    if (wf.status === 'undone') return { status: 'undone' };
    return { status: 'completed', result: wf.result };
  }
}
```

### 4.7 Session Idle 事件处理 (`idle-handler.ts`)

**v1.2 关键修正**: 仅更新 store，**不注入任何消息到主会话**。

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { WorkflowStore } from './workflow-store';

export class IdleEventHandler {
  constructor(
    private client: OpencodeClient,
    private store: WorkflowStore,
  ) {}

  async handle(sessionID: string) {
    const wf = this.store.findBySession(sessionID);
    if (!wf || wf.status !== 'running') return;

    try {
      const messages = await this.client.session.messages({
        path: { id: sessionID },
      });
      const result = extractLastAssistantMessage(messages.data);
      this.store.markCompleted(wf.workflowId, result);

      // v1.2: 不注入消息到主会话。
      // 代理通过 aristotle_check / aristotle_retrieve 自行查询。
      // 这是为了回避 OpenCode bug #4431 / #14451。

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markError(wf.workflowId, message);
    }
  }
}

function extractLastAssistantMessage(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role === 'assistant') return String(msg.content || msg.text || '');
  }
  return '';
}
```

### 4.8 Undo 拦截 (`undo-interceptor.ts`)

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { WorkflowStore } from './workflow-store';

export class UndoInterceptor {
  constructor(
    private client: OpencodeClient,
    private store: WorkflowStore,
  ) {}

  async handle(parentSessionID: string) {
    const activeWorkflows = this.store.getActiveByParentSession(parentSessionID);
    if (activeWorkflows.length === 0) return;

    for (const wf of activeWorkflows) {
      this.store.markUndone(wf.workflowId);

      try {
        await this.client.session.abort({ path: { id: wf.sessionId } });
      } catch {
        // 会话可能已不存在，忽略
      }
    }
  }
}
```

---

## 5. 代理行为模式

### 5.1 标准异步工作流

```
1. 代理调用 aristotle_fire_o("分析代码库安全漏洞")
   ──► 返回 {workflow_id: "wf-123", status: "running"}

2. 代理继续处理用户其他输入（主会话完全无阻塞）

3. 代理在合适时机调用 aristotle_check(workflow_id="wf-123")
   ──► {status: "running"} → 代理决定稍后重试
   ──► {status: "completed", result: "Found 3 issues..."} → 代理获取结果

4. 如果 completed，代理调用 aristotle_retrieve("wf-123")
   ──► 返回完整结果（与 aristotle_check 的 result 相同）

5. 代理调用 Aristotle MCP orchestrate_on_event:
   {event_type: "subagent_done", workflow_id: "wf-123", output: "..."}
```

### 5.2 Undo 工作流

```
1. 用户执行 undo

2. Bridge 的 tool.execute.before Hook 触发
   ──► 查找该 session 下的 active workflows
   ──► 标记为 "undone"
   ──► abort 后台会话

3. 原生 undo 继续执行（proceed 保持 true）

4. 代理感知 undo 后，调用 Aristotle MCP on_undo:
   {workflow_id: "wf-123", undo_scope: "session", timestamp: 1699999999999}

5. Aristotle 回退 workflow 状态和相关 git commit
```

### 5.3 系统提示词引导

为了让 OpenCode 代理正确使用 Bridge 工具，需要在系统提示词中添加：

```markdown
## Aristotle Bridge 工具使用指南

### 启动后台任务
- 使用 `aristotle_fire_o(workflow_id, o_prompt, agent?)`
- 返回值包含 workflow_id 和 session_id，记录它们

### 查询任务状态（必须）
- 使用 `aristotle_check(workflow_id)` 轮询
- 返回 `running` 时，等待一段时间再查询
- 返回 `completed` 时，获取 result

### 获取结果
- 确认 `aristotle_check` 返回 `completed` 后
- 调用 `aristotle_retrieve(workflow_id)` 获取完整结果
- 然后调用 Aristotle MCP `orchestrate_on_event` 推进工作流

### Undo 场景
- 用户 undo 后，检查是否有 workflow 被标记为 `undone`
- 调用 Aristotle MCP `on_undo` 通知 Aristotle
```

---

## 6. Aristotle MCP Server 侧变更

### 6.1 新增 Tool: `on_undo`

```python
# aristotle_mcp/_tools_undo.py

@mcp.tool()
def on_undo(workflow_id: str, undo_scope: str, timestamp: int) -> dict:
    """Receive undo event notification from OpenCode."""
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"status": "unknown_workflow"}
    
    workflow["undo_received_at"] = timestamp
    workflow["undo_scope"] = undo_scope
    workflow["status"] = "undone"
    _save_workflow(workflow_id, workflow)
    
    if workflow.get("committed_rule"):
        git_ops.revert_commit(workflow["committed_rule"]["commit_hash"])
    
    return {
        "status": "undone",
        "workflow_id": workflow_id,
        "message": "Workflow and associated rules have been rolled back."
    }
```

### 6.2 GEAR 引擎状态扩展

```python
def orchestrate_on_event(event_type: str, workflow_id: str, **kwargs):
    workflow = _load_workflow(workflow_id)
    
    # 短路：已 undo 的 workflow 忽略后续事件
    if workflow.get("status") == "undone":
        return {"status": "ignored", "reason": "workflow was undone"}
    
    if event_type == "subagent_done":
        ...
    elif event_type == "o_done":
        ...
```

---

## 7. 完整时序图

```
User/Agent     OpenCode        Bridge          Subagent      Aristotle MCP
  │              │               │               │                │
  │  aristotle_fire_o()          │               │                │
  │─────────────►│               │               │                │
  │              │  execute()    │               │                │
  │              │──────────────►│               │                │
  │              │               │ session.create()               │
  │              │               │──────────────►│                │
  │              │               │ sessionID     │                │
  │              │               │◄──────────────│                │
  │              │               │ promptAsync() │                │
  │              │               │──────────────►│ (后台运行)      │
  │              │               │ 204           │                │
  │              │               │◄──────────────│                │
  │              │ {wf_id,       │               │                │
  │              │  status: run} │               │                │
  │◄─────────────│               │               │                │
  │              │               │               │                │
  │   [主会话继续交互，完全无阻塞]  │               │                │
  │              │               │               │                │
  │  aristotle_check(wf_id)      │               │                │
  │─────────────►│               │               │                │
  │              │ 查 store     │               │                │
  │              │──────────────►│               │                │
  │              │ {status: run} │               │                │
  │              │◄──────────────│               │                │
  │◄─────────────│               │               │                │
  │              │               │               │                │
  │   [稍后重试...]              │               │                │
  │              │               │               │                │
  │              │               │◄────── session.idle            │
  │              │               │               │                │
  │              │               │ session.messages()              │
  │              │               │──────────────►│                │
  │              │               │ result        │                │
  │              │               │◄──────────────│                │
  │              │               │ markCompleted │                │
  │              │               │ (不通知主会话) │                │
  │              │               │               │                │
  │  aristotle_check(wf_id)      │               │                │
  │─────────────►│               │               │                │
  │              │ 查 store     │               │                │
  │              │──────────────►│               │                │
  │              │ {status: comp,│               │                │
  │              │  result: "..."}│               │                │
  │              │◄──────────────│               │                │
  │◄─────────────│               │               │                │
  │              │               │               │                │
  │  aristotle_retrieve(wf_id)   │               │                │
  │─────────────►│               │               │                │
  │              │ 查 store     │               │                │
  │              │──────────────►│               │                │
  │              │ {result: ".."}│               │                │
  │              │◄──────────────│               │                │
  │◄─────────────│               │               │                │
  │              │               │               │                │
  │  orchestrate_on_event(        │               │                │
  │    subagent_done, result)    │               │                │
  │─────────────────────────────┼───────────────┼───────────────►│
  │              │               │               │                │
  │              │               │               │  {status: ack} │
  │◄────────────────────────────┼───────────────┼───────────────│
```

---

## 8. 与 OMO/OMO-Slim 的共存

| 插件 | 工具 | 作用域 |
|------|------|--------|
| OMO-Slim | `task`, `delegate_task` | 同步/阻塞 subagent |
| OMO | `delegate_task`, `background_output` | 异步 subagent + 后台任务 |
| **Bridge** | **`aristotle_fire_o`**, **`aristotle_check`**, **`aristotle_retrieve`** | **Aristotle 专用异步** |

三个插件使用独立命名空间。Bridge 不调用 OMO 工具，OMO 不调用 Bridge 工具。

---

## 9. 实施路线图

### Phase 1: Aristotle MCP Server (~45 行)

| 任务 | 文件 |
|------|------|
| 新增 `on_undo` tool | `aristotle_mcp/_tools_undo.py` |
| GEAR `undone` 状态短路 | `aristotle_mcp/_orch_event.py` |

### Phase 2: Bridge Plugin (~450 行)

| 文件 | 行数 | 说明 |
|------|------|------|
| `index.ts` | 95 | 插件入口（含 aristotle_check） |
| `api-probe.ts` | 30 | API 探测 |
| `executor.ts` | 60 | 双路径执行器 |
| `workflow-store.ts` | 50 | 状态存储 |
| `idle-handler.ts` | 45 | Idle 处理（v1.2: 无消息注入） |
| `undo-interceptor.ts` | 30 | Undo 拦截 |
| `types.ts` | 15 | 类型定义 |
| `*.test.ts` | ~150 | 单元测试 |

### Phase 3: 集成测试

| 场景 | 验证点 |
|------|--------|
| 纯 Bridge + Aristotle | `fire_o` 非阻塞，`check` 正确返回状态 |
| Bridge + OMO-Slim 共存 | 两者独立运行，互不干扰 |
| Undo 场景 | undo 后 Bridge 标记 undone，代理调用 on_undo |
| API 降级 | promptAsync 不可用自动 fallback |
| 无消息注入 | 确认 idle-handler 不调用 `session.prompt({noReply})` |

---

## 10. ADR (设计决策记录)

### ADR-1: 为什么 Bridge 不直接调用 Aristotle MCP tools？

OpenCode 插件的 `PluginContext` 不提供 `mcpClient`。`client` 属性仅暴露 OpenCode SDK 的会话管理 API，不包含 MCP 客户端能力。

### ADR-2: 为什么放弃消息注入（`session.prompt({noReply})`）？

**OpenCode Bug #4431**: `noReply: true` 在 1.0.69+ 版本进入 agent loop 导致无限 hang。  
**OpenCode Bug #14451**: `noReply` 注入的是 User 消息而非 system-reminder。

**修正**: Bridge 完全不调用 `session.prompt({noReply})`。任务完成状态保存在 Bridge 内部 store 中，代理通过 `aristotle_check` 主动查询。

### ADR-3: 为什么新增 `aristotle_check` 工具？

原方案（v1.1）依赖消息注入通知代理任务完成。放弃消息注入后，需要一种机制让代理感知任务状态变化。

**方案比较**:
- 事件 Hook 回调代理？→ 不可行，OpenCode 不支持
- 代理轮询 `aristotle_check`？→ 可行，代理自行决定轮询频率
- `aristotle_retrieve` 阻塞等待？→ 与 `delegation_read` 类似，但阻塞主会话

**选择**: `aristotle_check` 提供轻量级轮询，返回 `running` 时代理可选择稍后重试，不阻塞。

### ADR-4: 为什么 undo 不阻止原生执行？

Bridge 只负责标记 Aristotle workflow 为 `undone` 并 abort 后台会话，不决定 undo 的具体行为。原生 undo 继续执行，Aristotle 通过 `on_undo` 自行处理回退。
