# Aristotle Async Bridge Plugin — 技术方案文档

**版本**: v1.1  
**日期**: 2026-04-23  
**状态**: 已修正 — 移除 MCP 直连，改为会话消息注入

> **v1.0 → v1.1 关键修正**: 原方案错误假设 `PluginContext` 包含 `mcpClient`。实际 `PluginContext` 仅包含 `client`, `directory`, `project`, `worktree`, `$`。Bridge 无法直接调用 Aristotle MCP tools，改通过 `session.prompt({noReply: true})` 向主会话注入系统消息，由 OpenCode 代理中转。

---

## 1. 方案概述

### 1.1 设计目标

| 能力 | 说明 |
|------|------|
| **异步 Subagent 执行** | Aristotle 的 `fire_o` 通过 Bridge 非阻塞启动后台子代理，主会话保持可交互 |
| **Undo 操作感知** | 拦截 `undo` 工具调用，通知 Aristotle 使其能回退工作流状态 |
| **OMO/OMO-Slim 无感共存** | Bridge 作为独立 OpenCode 插件，不依赖、不修改 OMO |
| **渐进式采用** | Bridge 是可选组件。无 Bridge 时 `fire_o` 同步阻塞；有 Bridge 时自动升级异步 |

### 1.2 核心原则

1. **Aristotle MCP Server 保持协议纯净** — 不含任何 OpenCode 特定代码
2. **Bridge 只做适配，不做业务** — 不含 GEAR 引擎等业务逻辑
3. **Bridge 不直接调用 Aristotle** — 所有通知通过主会话消息注入，由 OpenCode 代理中转
4. **事件驱动，非阻塞** — 基于 `session.promptAsync()` + SSE 事件流
5. **防御性编程** — 启动时 API 探测 + 双路径 fallback

---

## 2. 架构全景

```
OpenCode 主进程 (in-process plugins)
├─ OMO-Slim (可选): task, delegate_task
├─ OMO (可选): delegate_task, background_output
└─ Bridge Plugin: aristotle_fire_o, aristotle_retrieve
    ├─ session.promptAsync() ──► 后台子代理会话 (独立运行)
    ├─ session.idle 事件监听 ◄── 任务完成通知
    └─ session.prompt(noReply) ──► 主会话系统消息
                                         │
                                         ▼
                              OpenCode 代理看到系统消息后
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              aristotle_        aristotle_              on_undo
              retrieve()        orchestrate_            (MCP)
                                on_event()
                                (MCP)
                    │                    │                    │
                    └────────────────────┼────────────────────┘
                                         ▼
                              Aristotle MCP Server
                              (独立进程, stdio/SSE)
                              - GEAR 引擎
                              - git rules
                              - on_undo tool
```

**关键设计**: Bridge 与 Aristotle **不直接通信**。Bridge 只与 OpenCode 会话系统交互，通过注入系统消息通知 OpenCode 代理，由代理自行决定何时调用 Aristotle 的 MCP tools。

---

## 3. Bridge Plugin 详细设计

### 3.1 模块结构

```
src/
├── index.ts              # 插件入口，注册 hooks
├── api-probe.ts          # 启动时 API 探测
├── executor.ts           # 双路径任务执行器
├── workflow-store.ts     # workflow 状态存储
├── idle-handler.ts       # session.idle 事件处理
├── undo-interceptor.ts   # undo Hook 拦截
└── types.ts              # 类型定义
```

> **注意**: 不存在 `aristotle-mcp-client.ts`。Bridge 不直接调用 Aristotle。

### 3.2 核心数据模型

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

### 3.3 插件入口 (`index.ts`)

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
      aristotle_fire_o: tool({
        description: `Launch an Aristotle subagent task asynchronously. ` +
          `Returns immediately. Wait for <system-reminder> before calling aristotle_retrieve.`,
        parameters: z.object({
          workflow_id: z.string(),
          o_prompt: z.string(),
          agent: z.string().optional(),
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

      aristotle_retrieve: tool({
        description: `Retrieve the result of a completed Aristotle background task.`,
        parameters: z.object({
          workflow_id: z.string(),
        }),
        execute: async (args) => {
          return store.retrieve(args.workflow_id);
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

    'tool.execute.before': async (input, output) => {
      if (input.toolName === 'undo') {
        await undoInterceptor.handle(input.sessionID);
      }
    },
  };
};
```

### 3.4 API 探测 (`api-probe.ts`)

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

### 3.5 双路径执行器 (`executor.ts`)

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
      message: 'Task launched. Do NOT call aristotle_retrieve now. ' +
        'Wait for <system-reminder> notification, then call aristotle_retrieve.',
    };
  }
}
```

### 3.6 Workflow 状态存储 (`workflow-store.ts`)

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
    if (wf) { wf.status = 'completed'; wf.result = result; }
  }

  markError(workflowId: string, error: string) {
    const wf = this.workflows.get(workflowId);
    if (wf) { wf.status = 'error'; wf.error = error; }
  }

  markUndone(workflowId: string) {
    const wf = this.workflows.get(workflowId);
    if (wf) { wf.status = 'undone'; }
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

### 3.7 Session Idle 事件处理 (`idle-handler.ts`)

**v1.1 修正**: 不再调用 MCP，改为注入系统消息。

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

      // v1.1: 通过系统消息通知主会话，而非直接调用 MCP
      await this.client.session.prompt({
        path: { id: wf.parentSessionId },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: `<aristotle-task-complete workflow_id="${wf.workflowId}" ` +
                `status="completed" result_length="${result.length}" />\n\n` +
                `Background task ${wf.workflowId} is complete. ` +
                `Use aristotle_retrieve workflow_id="${wf.workflowId}" to fetch the result.`,
            },
          ],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markError(wf.workflowId, message);

      // 通知主会话任务失败
      await this.client.session.prompt({
        path: { id: wf.parentSessionId },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: `<aristotle-task-complete workflow_id="${wf.workflowId}" ` +
                `status="error" error="${message}" />`,
            },
          ],
        },
      }).catch(() => {}); // 通知失败不影响主流程
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

### 3.8 Undo 拦截 (`undo-interceptor.ts`)

**v1.1 修正**: 不再调用 MCP，改为注入系统消息。

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

      // v1.1: 通过系统消息通知主会话 undo 事件
      await this.client.session.prompt({
        path: { id: parentSessionID },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: `<aristotle-task-undo workflow_id="${wf.workflowId}" ` +
                `undo_scope="session" timestamp="${Date.now()}" />\n\n` +
                `Undo operation detected. Workflow ${wf.workflowId} has been marked as undone. ` +
                `You should call on_undo workflow_id="${wf.workflowId}" to notify Aristotle.`,
            },
          ],
        },
      }).catch(() => {});

      // 终止后台会话
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

## 4. OpenCode 代理的行为模式

Bridge 注入的系统消息遵循特定格式，OpenCode 代理需要被引导识别并响应：

### 4.1 任务完成时序

```
1. Bridge aristotle_fire_o("wf-123", "分析代码库中的安全漏洞")
   ──► 返回 {workflow_id: "wf-123", status: "running"}

2. 主会话继续交互，用户可以做其他事情

3. 后台任务完成后，Bridge 注入:
   <aristotle-task-complete workflow_id="wf-123" status="completed" 
    result_length="2048" />
   Background task wf-123 is complete.
   Use aristotle_retrieve workflow_id="wf-123" to fetch the result.

4. OpenCode 代理看到 <system-reminder> 后:
   a. 调用 aristotle_retrieve(workflow_id="wf-123")
   b. 获取到 {status: "completed", result: "..."}
   c. 自行决定下一步：调用 Aristotle 的 orchestrate_on_event
      或直接呈现结果给用户

5. 代理调用 Aristotle MCP orchestrate_on_event:
   {event_type: "subagent_done", workflow_id: "wf-123", output: "..."}
```

### 4.2 Undo 时序

```
1. 用户执行 undo

2. Bridge 拦截，注入:
   <aristotle-task-undo workflow_id="wf-123" undo_scope="session" 
    timestamp="1699999999999" />
   Undo operation detected. Workflow wf-123 has been marked as undone.
   You should call on_undo workflow_id="wf-123" to notify Aristotle.

3. OpenCode 代理看到消息后:
   a. 调用 Aristotle MCP on_undo:
      {workflow_id: "wf-123", undo_scope: "session", timestamp: 1699999999999}
   b. Aristotle 回退 workflow 状态和相关 git commit
```

### 4.3 引导 OpenCode 代理识别 Bridge 消息

为了让 OpenCode 代理正确响应 Bridge 注入的系统消息，需要在系统提示词中添加引导：

```markdown
## Aristotle Bridge 集成

当收到包含以下标签的 <system-reminder> 时，请按指示操作：

### <aristotle-task-complete>
- 标签属性: workflow_id, status (completed/error), result_length/error
- 操作: 立即调用 aristotle_retrieve workflow_id="<id>" 获取结果
- 获取结果后: 调用 Aristotle MCP orchestrate_on_event 推进工作流

### <aristotle-task-undo>
- 标签属性: workflow_id, undo_scope, timestamp
- 操作: 立即调用 Aristotle MCP on_undo 通知 Aristotle
```

---

## 5. Aristotle MCP Server 侧变更

### 5.1 新增 Tool: `on_undo`

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

### 5.2 GEAR 引擎状态扩展

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

## 6. 与 OMO/OMO-Slim 的共存

| 插件 | 工具 | 作用域 |
|------|------|--------|
| OMO-Slim | `task`, `delegate_task` | 同步/阻塞 subagent |
| OMO | `delegate_task`, `background_output` | 异步 subagent + 后台任务 |
| **Bridge** | **`aristotle_fire_o`**, **`aristotle_retrieve`** | **Aristotle 专用异步** |

三个插件使用独立命名空间，互不干扰。Bridge 不调用 OMO 工具，OMO 不调用 Bridge 工具。

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
  │   [主会话继续交互，          │               │                │
  │    用户无感知]               │               │                │
  │              │               │               │                │
  │              │               │◄────── session.idle            │
  │              │               │               │                │
  │              │               │ session.messages()             │
  │              │               │──────────────►│                │
  │              │               │ result        │                │
  │              │               │◄──────────────│                │
  │              │               │               │                │
  │              │  prompt(noReply,               │                │
  │              │  <aristotle-task-complete/>)   │                │
  │              │◄──────────────│               │                │
  │              │               │               │                │
  │              │ <system-reminder>              │                │
  │              │ 任务完成通知                   │                │
  │◄─────────────│               │               │                │
  │              │               │               │                │
  │  aristotle_retrieve(wf_id)   │               │                │
  │─────────────►│               │               │                │
  │              │ 查询 store    │               │                │
  │              │──────────────►│               │                │
  │              │ {result}      │               │                │
  │              │◄──────────────│               │                │
  │              │               │               │                │
  │  orchestrate_on_event(       │               │                │
  │    subagent_done, result)    │               │                │
  │──────────────────────────────┼───────────────┼───────────────►│
  │              │               │               │                │
  │              │               │               │  {status: ack} │
  │◄─────────────────────────────┼───────────────┼───────────────│
```

---

## 8. 实施路线图

### Phase 1: Aristotle MCP Server (~45 行)

| 任务 | 文件 |
|------|------|
| 新增 `on_undo` tool | `aristotle_mcp/_tools_undo.py` |
| GEAR `undone` 状态短路 | `aristotle_mcp/_orch_event.py` |

### Phase 2: Bridge Plugin (~450 行)

| 文件 | 行数 | 说明 |
|------|------|------|
| `index.ts` | 80 | 插件入口 |
| `api-probe.ts` | 30 | API 探测 |
| `executor.ts` | 60 | 双路径执行器 |
| `workflow-store.ts` | 50 | 状态存储 |
| `idle-handler.ts` | 55 | Idle 处理（v1.1: 消息注入） |
| `undo-interceptor.ts` | 35 | Undo 拦截（v1.1: 消息注入） |
| `types.ts` | 15 | 类型定义 |
| `*.test.ts` | ~150 | 单元测试 |

### Phase 3: 集成测试

| 场景 | 验证点 |
|------|--------|
| 纯 Bridge + Aristotle | `fire_o` 非阻塞，idle 后正确通知 |
| Bridge + OMO-Slim 共存 | 两者独立运行，互不干扰 |
| Undo 场景 | undo 后 Bridge 标记 undone，代理调用 on_undo |
| API 降级 | promptAsync 不可用自动 fallback |

---

## 9. ADR (设计决策记录)

### ADR-1: 为什么 Bridge 不直接调用 Aristotle MCP tools？

OpenCode 插件的 `PluginContext` 不提供 `mcpClient`。`client` 属性仅暴露 OpenCode SDK 的会话管理 API，不包含 MCP 客户端能力。因此 Bridge 无法直接调用 Aristotle 的 tools。

**修正后的架构**: Bridge 通过 `session.prompt({noReply: true})` 注入系统消息，由 OpenCode 代理识别消息后自行调用 Aristotle MCP tools。这更符合 OpenCode 插件的设计模式——插件扩展 OpenCode 的能力，而非替代 OpenCode 代理的决策权。

### ADR-2: 为什么使用 XML 标签格式的系统消息？

`<aristotle-task-complete workflow_id="..." />` 格式的好处：
1. **机器可读**: OpenCode 代理可以通过正则匹配识别
2. **人类可读**: 系统消息中的文字说明对调试友好
3. **可扩展**: 可添加更多属性而不破坏格式
4. **与 background-agents 一致**: `<task-notification>` 已被证明有效

### ADR-3: 为什么 undo 不阻止原生执行？

Bridge 只负责通知 Aristotle，不决定 undo 的具体行为。Aristotle 收到通知后自行决定是否回退 git commit、清除状态等。这种分离保持了职责清晰——Bridge 是适配层，Aristotle 是业务逻辑层。
