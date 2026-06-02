# Aristotle Async Bridge Plugin — 技术方案文档

**版本**: v1.0  
**日期**: 2026-04-23  
**状态**: 设计定稿，待实施

---

## 1. 方案概述

### 1.1 设计目标

Aristotle 是一个独立的 MCP (Model Context Protocol) Server，核心能力包括 GEAR 工作流引擎、基于 Git 的规则管理和多步骤任务编排。本方案（Aristotle Async Bridge Plugin，以下简称 **Bridge**）旨在为 Aristotle 在 **OpenCode 生态**中提供以下能力：

| 能力 | 说明 |
|------|------|
| **异步 Subagent 执行** | Aristotle 的 `fire_o` 动作通过 Bridge 以非阻塞方式启动后台子代理，主会话保持完全可交互 |
| **Undo 操作感知** | 通过 Hook 拦截 OpenCode 的 `undo` 工具调用，将 undo 事件通过 MCP 回传 Aristotle，使其能正确响应状态回退 |
| **OMO/OMO-Slim 无感共存** | Bridge 作为独立 OpenCode 插件运行，不依赖、不修改 OMO 或 OMO-Slim 的任何代码 |
| **渐进式采用** | Bridge 是可选组件。没有 Bridge 时，Aristotle 仍可通过标准 MCP 与 OpenCode 工作（`fire_o` 同步阻塞）；安装 Bridge 后自动升级为异步模式 |

### 1.2 核心原则

1. **Aristotle MCP Server 保持协议纯净** — 不包含任何 OpenCode 特定代码，只通过标准 MCP tools 与外部通信
2. **Bridge 只做适配，不做业务** — Bridge 是 OpenCode 侧的薄层适配器，不含 GEAR 引擎、规则管理等任何 Aristotle 业务逻辑
3. **事件驱动，非阻塞** — 基于 `session.promptAsync()` + SSE 事件流完成异步闭环
4. **防御性编程** — 启动时 API 探测 + 双路径 fallback，确保在不同 OpenCode 版本下的兼容性

---

## 2. 架构全景

```
┌──────────────────────────────────────────────────────────────────────┐
│                        运行时架构                                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────┐         MCP (stdio/SSE)          ┌────────┐ │
│  │   OpenCode 主进程    │  ◄────────────────────────────► │        │ │
│  │                     │                                │        │ │
│  │  ┌───────────────┐  │                                │  Aristotle  │ │
│  │  │  OMO-Slim     │  │        MCP (stdio/SSE)         │  MCP   │ │
│  │  │  (可选)        │  │  ◄────────────────────────────► │  Server│ │
│  │  └───────────────┘  │                                │        │ │
│  │                     │                                │ - GEAR │ │
│  │  ┌───────────────┐  │                                │ - git  │ │
│  │  │  OMO          │  │                                │ - rules│ │
│  │  │  (可选)        │  │                                │        │ │
│  │  └───────────────┘  │                                └────────┘ │
│  │                     │                                         ▲   │
│  │  ┌───────────────┐  │                                         │   │
│  │  │  Bridge       │  │         OpenCode SDK                    │   │
│  │  │  Plugin       │  │  ┌─────────────────────────────┐      │   │
│  │  │               │  │  │ session.promptAsync()       │──────┘   │
│  │  │ - tool Hook   │──┼──►│ session.idle event listener │          │
│  │  │ - event Hook  │  │  │ undo tool.execute.before    │          │
│  │  └───────────────┘  │  └─────────────────────────────┘          │
│  │                     │                                            │
│  └─────────────────────┘                                            │
│                                                                      │
│  三个独立插件，各自使用独立的工具命名空间：                              │
│  - OMO-Slim:   task, delegate_task                                  │
│  - OMO:        delegate_task, background_output                     │
│  - Bridge:     aristotle_fire_o, aristotle_retrieve                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Aristotle MCP Server 侧（独立进程）

Aristotle 运行在独立进程中，通过 stdio 或 SSE 与 OpenCode 通信。它不感知 Bridge 的存在，始终只提供标准的 MCP tools。

**已存在的 tools**:
- `orchestrate_start(prompt)` — 启动工作流，返回 `{action, o_prompt}`
- `orchestrate_on_event(event_type, ...)` — 事件处理器，处理 `o_done`, `subagent_done` 等
- `produce(prompt)` / `audit(...)` / `consume(...)` — GEAR 三阶段

**本方案新增 tools**:
- `on_undo(workflow_id, undo_scope, timestamp)` — 接收 undo 事件通知

### 2.2 Bridge Plugin 侧（OpenCode 进程内）

Bridge 是 OpenCode 的 in-process 插件，直接调用 OpenCode SDK API。

**注册的工具**:
- `aristotle_fire_o(workflow_id, o_prompt, agent?)` — 异步启动 Aristotle subagent
- `aristotle_retrieve(workflow_id)` — 获取任务结果

**注册的 Hooks**:
- `tool` Hook — 注册上述工具
- `event` Hook — 监听 `session.idle` 事件
- `tool.execute.before` Hook — 拦截 `undo` 工具调用

---

## 3. Bridge Plugin 详细设计

### 3.1 模块结构

```
src/
├── index.ts                  # 插件入口，注册 hooks
├── api-probe.ts              # 启动时 API 探测
├── executor.ts               # 双路径任务执行器
├── workflow-store.ts         # workflow 状态存储
├── idle-handler.ts           # session.idle 事件处理
├── undo-interceptor.ts       # undo Hook 拦截
├── aristotle-mcp-client.ts   # MCP 客户端（通知 Aristotle）
└── types.ts                  # 类型定义
```

### 3.2 核心数据模型

```typescript
// types.ts

interface WorkflowState {
  workflowId: string;        // Aristotle 的工作流 ID
  sessionId: string;         // OpenCode 后台会话 ID
  parentSessionId: string;   // 主会话 ID（用于通知）
  parentMessageId: string;   // 触发消息 ID
  status: 'pending' | 'running' | 'completed' | 'error' | 'undone';
  result?: string;           // 子代理最终输出
  error?: string;            // 错误信息
  startedAt: number;         // 启动时间戳
  agent: string;             // 使用的子代理
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
import { AristotleMcpClient } from './aristotle-mcp-client';

export const AristotleBridgePlugin: Plugin = async (ctx) => {
  // ── Phase 1: API 探测 ──
  const apiMode = await detectApiMode(ctx.client);
  console.log(`[aristotle-bridge] API mode: ${apiMode}`);

  // ── Phase 2: 初始化组件 ──
  const store = new WorkflowStore();
  const executor = new AsyncTaskExecutor(ctx.client, apiMode, store);
  const idleHandler = new IdleEventHandler(ctx.client, store);
  const undoInterceptor = new UndoInterceptor(ctx.client, store);
  const mcpClient = new AristotleMcpClient(ctx.mcpClient);

  // ── Phase 3: 返回 Plugin 定义 ──
  return {
    // ── 工具注册 ──
    tool: () => ({
      aristotle_fire_o: tool({
        description: `Launch an Aristotle subagent task asynchronously. 
        This tool creates a background session, starts the subagent with the given prompt, 
        and returns immediately without blocking the main session. 
        Use aristotle_retrieve to get the result later.`,
        parameters: z.object({
          workflow_id: z.string().describe('The Aristotle workflow ID for tracking'),
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

      aristotle_retrieve: tool({
        description: `Retrieve the result of a completed Aristotle background task. 
        Returns immediately if task is done, or indicates if still running.`,
        parameters: z.object({
          workflow_id: z.string().describe('The workflow ID from aristotle_fire_o'),
        }),
        execute: async (args) => {
          return store.retrieve(args.workflow_id);
        },
      }),
    }),

    // ── 事件监听 ──
    event: async ({ event }) => {
      if (event.type === 'session.idle') {
        const sessionID = event.properties?.sessionID;
        if (typeof sessionID === 'string') {
          await idleHandler.handle(sessionID, mcpClient);
        }
      }
    },

    // ── Undo 拦截 ──
    'tool.execute.before': async (input, output) => {
      if (input.toolName === 'undo') {
        await undoInterceptor.handle(input.sessionID, mcpClient);
        // proceed 保持 true，不阻止原生 undo 执行
      }
    },
  };
};
```

### 3.4 API 探测 (`api-probe.ts`)

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';

export type ApiMode = 'promptAsync' | 'fireAndForget';

/**
 * 启动时探测 promptAsync API 的可用性。
 * 创建一个临时会话，尝试调用 promptAsync，成功后立即删除。
 */
export async function detectApiMode(client: OpencodeClient): Promise<ApiMode> {
  try {
    const testSession = await client.session.create({
      body: { title: 'aristotle-bridge-api-probe' },
    });

    await client.session.promptAsync({
      path: { id: testSession.data.id },
      body: {
        parts: [{ type: 'text', text: 'probe' }],
      },
    });

    await client.session.delete({ path: { id: testSession.data.id } });

    return 'promptAsync';
  } catch {
    // promptAsync 不存在或调用失败，降级到 fireAndForget
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
    // 1. 创建后台会话
    const session = await this.client.session.create({
      body: {
        title: `aristotle-${args.workflowId}`,
        parentID: args.parentSessionId,
      },
    });

    const sessionId = session.data.id;

    // 2. 记录 workflow 状态
    this.store.register({
      workflowId: args.workflowId,
      sessionId,
      parentSessionId: args.parentSessionId,
      parentMessageId: args.parentMessageId,
      status: 'running',
      startedAt: Date.now(),
      agent: args.agent,
    });

    // 3. 根据模式选择执行路径
    const promptBody = {
      agent: args.agent,
      parts: [{ type: 'text' as const, text: args.oPrompt }],
    };

    if (this.mode === 'promptAsync') {
      // ═══════════════════════════════════════════
      // 路径 A: promptAsync（官方异步 API）
      // 返回 204，不阻塞，子代理 loop 由 OpenCode 内部调度
      // ═══════════════════════════════════════════
      await this.client.session.promptAsync({
        path: { id: sessionId },
        body: promptBody,
      });
    } else {
      // ═══════════════════════════════════════════
      // 路径 B: fire-and-forget prompt()
      // 不 await，Promise 在后台运行
      // background-agents 同款实现
      // ═══════════════════════════════════════════
      this.client.session
        .prompt({
          path: { id: sessionId },
          body: promptBody,
        })
        .catch((error: Error) => {
          console.error(`[bridge] Task ${args.workflowId} failed:`, error);
          this.store.markError(args.workflowId, error.message);
        });
    }

    // 4. 立即返回（两种路径都保证不阻塞）
    return {
      workflow_id: args.workflowId,
      session_id: sessionId,
      status: 'running' as const,
      mode: this.mode,
      message:
        'Task launched in background. Do NOT call aristotle_retrieve now. ' +
        'Wait for <system-reminder> notification first.',
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

### 3.7 Session Idle 事件处理 (`idle-handler.ts`)

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { WorkflowStore } from './workflow-store';
import type { AristotleMcpClient } from './aristotle-mcp-client';

export class IdleEventHandler {
  constructor(
    private client: OpencodeClient,
    private store: WorkflowStore,
  ) {}

  async handle(sessionID: string, mcp: AristotleMcpClient) {
    // 查找对应的 workflow
    const wf = this.store.findBySession(sessionID);
    if (!wf || wf.status !== 'running') return;

    try {
      // 1. 获取后台会话的消息历史
      const messages = await this.client.session.messages({
        path: { id: sessionID },
      });

      // 2. 提取最后一条 assistant 消息作为结果
      const result = extractLastAssistantMessage(messages.data);

      // 3. 更新 workflow 状态
      this.store.markCompleted(wf.workflowId, result);

      // 4. 通过 MCP 通知 Aristotle 任务完成
      await mcp.notifyTaskComplete(wf.workflowId, result);

      // 5. 向父会话注入静默通知（noReply: true）
      await this.client.session.prompt({
        path: { id: wf.parentSessionId },
        body: {
          noReply: true,
          parts: [
            {
              type: 'text',
              text: `<aristotle-task-complete workflow_id="${wf.workflowId}" />`,
            },
          ],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markError(wf.workflowId, message);
      console.error(`[bridge] Failed to handle idle for ${sessionID}:`, message);
    }
  }
}

function extractLastAssistantMessage(messages: unknown[]): string {
  // 从消息数组中提取最后一条 assistant 角色的消息文本
  // 具体实现取决于 OpenCode SDK 的消息格式
  // 简化示例：
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role === 'assistant') return String(msg.content || msg.text || '');
  }
  return '';
}
```

### 3.8 Undo 拦截 (`undo-interceptor.ts`)

```typescript
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { WorkflowStore } from './workflow-store';
import type { AristotleMcpClient } from './aristotle-mcp-client';

export class UndoInterceptor {
  constructor(
    private client: OpencodeClient,
    private store: WorkflowStore,
  ) {}

  async handle(parentSessionID: string, mcp: AristotleMcpClient) {
    // 查找该父会话下所有运行中的 Aristotle workflows
    const activeWorkflows = this.store.getActiveByParentSession(parentSessionID);
    if (activeWorkflows.length === 0) return;

    console.log(`[bridge] Undo detected for session ${parentSessionID}, ` +
      `notifying ${activeWorkflows.length} active workflow(s)`);

    for (const wf of activeWorkflows) {
      // 1. 通过 MCP 通知 Aristotle undo 事件
      await mcp.notifyUndo(wf.workflowId, 'session', Date.now());

      // 2. 标记 workflow 为 undone
      this.store.markUndone(wf.workflowId);

      // 3. 可选：终止后台会话
      try {
        await this.client.session.abort({
          path: { id: wf.sessionId },
        });
      } catch {
        // 会话可能已不存在，忽略错误
      }
    }
  }
}
```

### 3.9 MCP 客户端 (`aristotle-mcp-client.ts`)

```typescript
/**
 * 封装与 Aristotle MCP Server 的通信。
 * 通过 OpenCode 提供的 MCP 客户端实例调用 Aristotle 的 tools。
 */
export class AristotleMcpClient {
  constructor(private mcp: { call: (tool: string, args: unknown) => Promise<unknown> }) {}

  /**
   * 通知 Aristotle 任务已完成。
   * 调用 Aristotle MCP Server 的 orchestrate_on_event tool。
   */
  async notifyTaskComplete(workflowId: string, result: string) {
    try {
      await this.mcp.call('orchestrate_on_event', {
        event_type: 'subagent_done',
        workflow_id: workflowId,
        output: result,
      });
    } catch (error) {
      console.error(`[bridge] Failed to notify Aristotle of completion:`, error);
    }
  }

  /**
   * 通知 Aristotle undo 事件。
   * 调用 Aristotle MCP Server 的 on_undo tool。
   */
  async notifyUndo(workflowId: string, scope: string, timestamp: number) {
    try {
      await this.mcp.call('on_undo', {
        workflow_id: workflowId,
        undo_scope: scope,
        timestamp,
      });
    } catch (error) {
      console.error(`[bridge] Failed to notify Aristotle of undo:`, error);
    }
  }
}
```

---

## 4. Aristotle MCP Server 侧变更

### 4.1 新增 Tool: `on_undo`

```python
# aristotle_mcp/_tools_undo.py

@mcp.tool()
def on_undo(workflow_id: str, undo_scope: str, timestamp: int) -> dict:
    """
    接收来自 OpenCode Bridge 的 undo 事件通知。
    
    Aristotle 收到通知后可以：
    1. 标记 workflow 状态为 'undone'
    2. 通过 git_ops 回退相关的规则变更
    3. 使 workflow 后续的事件处理短路
    """
    workflow = _load_workflow(workflow_id)
    if not workflow:
        return {"status": "unknown_workflow"}
    
    workflow["undo_received_at"] = timestamp
    workflow["undo_scope"] = undo_scope
    workflow["status"] = "undone"
    _save_workflow(workflow_id, workflow)
    
    # 如果 workflow 已产生 git commit，执行 revert
    if workflow.get("committed_rule"):
        git_ops.revert_commit(workflow["committed_rule"]["commit_hash"])
    
    return {
        "status": "undone",
        "workflow_id": workflow_id,
        "message": "Workflow and associated rules have been rolled back."
    }
```

### 4.2 GEAR 引擎状态扩展

```python
# 在 _orch_event.py 中处理 undone 状态

def orchestrate_on_event(event_type: str, workflow_id: str, **kwargs):
    workflow = _load_workflow(workflow_id)
    
    # 短路：如果 workflow 已被 undo，忽略后续事件
    if workflow.get("status") == "undone":
        return {"status": "ignored", "reason": "workflow was undone"}
    
    if event_type == "subagent_done":
        # 正常处理子代理完成
        ...
    elif event_type == "o_done":
        # 正常处理 produce 完成
        ...
```

---

## 5. 与 OMO/OMO-Slim 的共存策略

### 5.1 独立命名空间

三个插件使用完全独立的工具命名空间，互不干扰：

| 插件 | 工具 | 作用域 |
|------|------|--------|
| **OMO-Slim** | `task`, `delegate_task` | 同步/阻塞式 subagent |
| **OMO** | `delegate_task`, `background_output` | 异步 subagent + 后台任务管理 |
| **Bridge** | `aristotle_fire_o`, `aristotle_retrieve` | Aristotle 专用异步委派 |

### 5.2 三种使用场景

```
场景 A: 纯 Aristotle（无 OMO）
├─ OpenCode 用户调用 aristotle_fire_o
├─ Bridge 异步启动 subagent
└─ 完成后通知 → aristotle_retrieve 获取结果

场景 B: Aristotle + OMO-Slim
├─ OMO-Slim 的 task 继续以同步方式工作
├─ Bridge 的 aristotle_fire_o 以异步方式工作
└─ 两者独立，互不阻塞

场景 C: Aristotle + OMO
├─ 选项 1: 使用 Bridge 的 aristotle_fire_o（推荐，更轻量）
├─ 选项 2: 使用 OMO 的 delegate_task(run_in_background=true)
│   └─ OMO 内部也用 promptAsync，与 Bridge 原理相同
└─ 两者可以共存，用户/代理自行选择
```

### 5.3 为什么不会重复 OMO 的 TUI 失交互问题

| 因素 | OMO (问题来源) | Bridge (本方案) |
|------|---------------|-----------------|
| 并发 subagent 数 | 5+ (ultrawork) | 1（GEAR 串行工作流） |
| 轮询机制 | 全局每 2 秒轮询所有任务 | 仅监听 session.idle 事件 |
| Toast 通知 | 实时更新每个任务的 toast | 无 toast，仅完成时一次通知 |
| 会话树复杂度 | 多层级嵌套 + tmux pane | 单层父子关系 |
| 事件注入频率 | 高（进度更新、状态变更） | 低（仅任务完成时一次） |
| MCP 路由开销 | 11 个代理 + 多个 MCP | 仅 Aristotle 一个 Server |

Bridge 的事件频率和复杂度远低于 OMO，不会触发 TUI 事件循环的拥堵。

---

## 6. 异步闭环完整时序图

```
OpenCode         Bridge Plugin         Aristotle MCP         Subagent
  │                   │                     │                  │
  │  1. aristotle_fire_o(tool call)         │                  │
  │───────────────────────────────────────► │                  │
  │                   │                     │                  │
  │  2. session.create()                    │                  │
  │────────────────►  │                     │                  │
  │  3. sessionID     │                     │                  │
  │◄────────────────  │                     │                  │
  │                   │                     │                  │
  │  4. session.promptAsync(body)           │                  │
  │───────────────────────────────────────► │                  │
  │  5. 204 No Content                      │                  │
  │◄─────────────────────────────────────── │                  │
  │                   │                     │                  │
  │  6. {workflow_id, session_id, status:   │                  │
  │     "running"}    │                     │                  │
  │◄─────────────────────────────────────── │                  │
  │                   │                     │                  │
  │                   │        [子代理在后台独立运行]            │
  │                   │                     │                  │
  │  7. session.idle event                │                  │
  │──────────────────────────────────────► │                  │
  │                   │                     │                  │
  │  8. session.messages(sessionID)         │                  │
  │────────────────►  │                     │                  │
  │  9. messages[]    │                     │                  │
  │◄────────────────  │                     │                  │
  │                   │                     │                  │
  │                   │  10. orchestrate_on_event(             │
  │                   │      event_type="subagent_done")       │
  │                   │────────────────────►│                  │
  │                   │                     │                  │
  │                   │  11. {status: "ack"}                  │
  │                   │◄────────────────────│                  │
  │                   │                     │                  │
  │  12. session.prompt(noReply: true,      │                  │
  │      "<aristotle-task-complete/>")      │                  │
  │───────────────────────────────────────► │                  │
  │                   │                     │                  │
  │  13. <system-reminder> 任务已完成       │                  │
  │──────────────────────────────────────► │                  │
  │                   │                     │                  │
  │  14. aristotle_retrieve(workflow_id)    │                  │
  │───────────────────────────────────────► │                  │
  │  15. {status: "completed", result: ...} │                  │
  │◄─────────────────────────────────────── │                  │
```

---

## 7. 实施路线图

### Phase 1: Aristotle MCP Server 侧（Aristotle 仓库）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 新增 `on_undo` MCP tool | `aristotle_mcp/_tools_undo.py` | ~30 行 |
| GEAR 引擎 `undone` 状态处理 | `aristotle_mcp/_orch_event.py` | ~10 行 |
| 工作流状态机扩展 | `aristotle_mcp/_workflow_state.py` | ~5 行 |

### Phase 2: Bridge Plugin（新建仓库 `aristotle-bridge`）

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 插件入口与类型定义 | `index.ts`, `types.ts` | ~80 行 |
| API 探测 | `api-probe.ts` | ~30 行 |
| 双路径执行器 | `executor.ts` | ~60 行 |
| Workflow 存储 | `workflow-store.ts` | ~50 行 |
| Idle 事件处理 | `idle-handler.ts` | ~50 行 |
| Undo 拦截 | `undo-interceptor.ts` | ~30 行 |
| MCP 客户端 | `aristotle-mcp-client.ts` | ~30 行 |
| 单元测试 | `*.test.ts` | ~200 行 |
| 包配置 | `package.json`, `tsconfig.json` | 标准 |

**总代码量估计**: ~500 行 TypeScript + ~200 行测试。

### Phase 3: 集成测试

| 场景 | 验证点 |
|------|--------|
| 纯 Aristotle + Bridge | `fire_o` 非阻塞，主会话可交互 |
| Aristotle + Bridge + OMO-Slim | OMO-Slim 的 `task` 不影响 Bridge 的 `aristotle_fire_o` |
| Undo 场景 | `undo` 后 Aristotle 正确回退 workflow 状态 |
| API 降级 | 删除 `promptAsync` 后自动 fallback 到 `prompt()` |

---

## 8. 附录：设计决策记录

### ADR-1: 为什么不用 Out-of-Process 子进程调 LLM API？

Aristotle 本身就是 out-of-process 的 MCP Server。Bridge 只需要负责 OpenCode 侧的会话管理，不需要再 spawn 一个进程去调 LLM API。再增加一层进程会增加复杂度且无收益。

### ADR-2: 为什么 Bridge 是可选组件？

保持 Aristotle 的协议纯净性和客户端无关性。用户可以通过标准 MCP 将 Aristotle 连接到 Claude Desktop、Cursor、OpenCode 等任何客户端。Bridge 只为 OpenCode 用户提供异步增强。

### ADR-3: 为什么监听 `session.idle` 而不是轮询？

OMO 使用轮询（每 2 秒）是因为它管理大量并发后台任务，需要主动检测 staleness 和崩溃。Aristotle 的 GEAR 是串行工作流，一次只有一个 `fire_o` 在运行，`session.idle` 事件足够可靠，且开销更低。

### ADR-4: 为什么 `undo` 不阻止原生执行？

Bridge 只负责通知 Aristotle，不决定 undo 的具体行为。Aristotle 收到通知后自行决定是否回退 git commit、清除状态等。这种分离保持了职责清晰。

### ADR-5: 为什么使用 `aristotle_` 前缀命名工具？

避免与 OMO（`delegate_task`）、OMO-Slim（`task`）、background-agents（`delegate`）的工具命名冲突。前缀命名是 OpenCode 插件生态的惯例。
