# Aristotle 异步非阻塞主对话进程 — 完整技术方案与原理

> 文档版本: v1.1 | 更新日期: 2026-04-27
> v1.1: 同步 B1 后续 bugfix（polling 移除、spawn 替换、实例隔离、trigger 机制、ToolDefinition 格式）
> 基于 Aristotle 项目当前代码库（aristotle_mcp/ + plugins/aristotle-bridge/）完整分析

---

## 目录

1. [设计目标](#1-设计目标)
2. [架构总览](#2-架构总览)
3. [三层组件详解](#3-三层组件详解)
4. [核心异步机制](#4-核心异步机制)
5. [完整生命周期流程](#5-完整生命周期流程)
6. [状态机与工作流持久化](#6-状态机与工作流持久化)
7. [故障恢复与容错设计](#7-故障恢复与容错设计)
8. [关键设计决策与权衡](#8-关键设计决策与权衡)
9. [文件清单与职责映射](#9-文件清单与职责映射)

---

## 1. 设计目标

Aristotle 的核心目标是实现**错误反思与学习**（Error Reflection & Learning），但其面临一个根本性的架构挑战：

> **反思任务需要大量 LLM 推理时间（可能数十秒到数分钟），但主对话进程不能被阻塞。**

具体设计约束：

| 约束 | 说明 |
|------|------|
| **非阻塞** | 用户触发 `/aristotle` 后应立即返回，主对话可继续使用 |
| **多阶段链式** | 反思流程包含 R(Reflector) -> C(Checker) 两个阶段，需自动驱动 |
| **崩溃安全** | 任何时刻进程崩溃都不应丢失工作流状态 |
| **跨平台** | 需同时支持 Claude Code 和 OpenCode 两种运行环境 |
| **可观测** | 用户可随时查询工作流状态（running / completed / error） |
| **可取消** | 用户可随时终止正在运行的反思任务 |

---

## 2. 架构总览

Aristotle 采用**三层分离架构**来实现异步非阻塞：

```
+---------------------------------------------------------------------+
|                        用户主对话 (Main Session)                     |
|                                                                     |
|   用户: /aristotle                                                  |
|     |                                                               |
|     v                                                               |
|   +----------------------------------------------------------+     |
|   |  Layer 1: SKILL.md (Dispatcher/Router)                   |     |
|   |  解析命令 -> 调用 MCP orchestrate_start("reflect")        |     |
|   +--------------------------+-------------------------------+     |
|                              |                                      |
|     返回 {action: "fire_sub", use_bridge: true}                     |
|                              |                                      |
|     +------------------------+-----------------------+              |
|     |                                                |              |
|     v (Bridge Path)                    v (Blocking Path)             |
|   +-----------------+                +------------------+           |
|   | Layer 2:        |                | task() 子 agent   |           |
|   | Bridge Plugin   |                | (run_in_background)|          |
|   | (非阻塞,异步)   |                +--------+---------+           |
|   +--------+--------+                        |                      |
|            |                                  v                      |
|   立即返回给用户                    ============================     |
|   用户可继续对话                    = 后台子 Session（隔离） =     |
|            |                        ============================     |
|            v                                  |                      |
|   ============================                v                      |
|   = 后台子 Session（隔离）  =    MCP状态机决定下一步              |
|   =                          =                |                      |
|   =  +----------+            =                v                      |
|   =  | R Agent  |            =       +----------+                    |
|   =  |(Reflector)|           =       | C Agent  |                    |
|   =  +----------+            =       |(Checker) |                    |
|   =       |                  =       +----------+                    |
|   =       v                  =            |                          |
|   =  MCP subprocess          =            v                          |
|   =  决定下一步               =    通知主对话完成                    |
|   =       |                  =                                       |
|   =       v                  |                                       |
|   =  +----------+            |                                       |
|   =  | C Agent  |            |                                       |
|   =  |(Checker) |            |                                       |
|   =  +----------+            |                                       |
|   ============================                                       |
|            |                                  |                      |
|            +----------------+-----------------+                     |
|                             v                                       |
|              通知用户: "Aristotle done.                              |
|                        2 rules committed, 0 staged."                |
+---------------------------------------------------------------------+
```

### 两条执行路径

Aristotle 设计了两条并行的执行路径来适配不同宿主环境：

| 特性 | Bridge Path (OpenCode) | Blocking Path (Claude Code) |
|------|----------------------|---------------------------|
| **运行环境** | OpenCode（支持 promptAsync API） | Claude Code（支持 task() 子 agent） |
| **异步机制** | `session.promptAsync()` -- 真正异步 | `task(run_in_background=true)` -- 后台运行 |
| **状态驱动** | `session.idle` 事件自动驱动链式转换 | `task()` 通知回调驱动 |
| **MCP 通信** | 子进程调用 `_cli.py`（stdin/stdout JSON） | 直接 MCP tool 调用 |
| **会话快照** | `SnapshotExtractor` 预提取 | `session_read()` 直接读取 |
| **检测方式** | `detectApiMode()` 检测 `promptAsync` 是否存在 | Bridge 未激活时自动 fallback |

---

## 3. 三层组件详解

### 3.1 Layer 1: SKILL.md -- 语义路由器

**文件**: `SKILL.md`（116 行）

**职责**: 解析用户命令，调用 MCP 编排工具，根据返回的 action 执行对应策略。

**路由逻辑**:

```
/aristotle           -> PRE-RESOLVE -> orchestrate_start("reflect")
/aristotle learn X   -> orchestrate_start("learn", {query: "X"})
/aristotle sessions  -> orchestrate_start("sessions")
/aristotle review N  -> orchestrate_start("review", {sequence: N})
```

**PRE-RESOLVE 阶段**（reflect 专用）:

```
orchestrate_start("reflect", {...})
  -> {action: "fire_sub", use_bridge: true}
    -> Bridge Path: 调用 aristotle_fire_o()，非阻塞
  -> {action: "fire_sub", use_bridge: false}
    -> Blocking Path: task(run_in_background=true)
  -> {action: "pre_resolve_needed"}
    -> SNAPSHOT-EXTRACT: 手动提取会话快照后重试
```

**关键设计**: SKILL.md 从不加载 REFLECTOR.md / CHECKER.md 等子协议文件。所有业务逻辑由 MCP 工具处理，SKILL.md 只做路由和 action 执行。

---

### 3.2 Layer 2: Bridge Plugin -- 异步执行引擎

**文件**: `plugins/aristotle-bridge/src/`（9 个 TypeScript 文件，约 1000 行）

这是实现**真正异步非阻塞**的核心组件。

#### 3.2.1 入口与初始化 (index.ts)

```typescript
const AristotleBridgePlugin = async (ctx) => {
  // 1. 检测 promptAsync API 可用性
  const apiMode = await detectApiMode(ctx.client);
  if (!apiMode) return {};

  // 2. 创建 .bridge-active 标记文件（MCP 侧检测用）
  writeFileSync(markerPath, {pid: process.pid, startedAt: Date.now()});

  // 3. 生成实例 ID（用于多实例隔离）
  const instanceId = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const store = new WorkflowStore(sessionsDir, instanceId);

  // 4. 恢复上次崩溃的工作流（只恢复本实例的）
  await store.reconcileOnStartup(ctx.client);

  // 5. 注册结构化工具（ToolDefinition 格式 + zod 校验）
  return {
    tool: {
      aristotle_fire_o: {
        description: 'Launch an Aristotle workflow sub-agent via Bridge',
        args: { workflow_id: z.string(), o_prompt: z.string(),
                agent: z.string().optional(),
                target_session_id: z.string().optional() },
        execute: async (args, context) => {
          // target_session_id 缺失时默认为当前 session
          const result = await executor.launch({
            workflowId: args.workflow_id,
            oPrompt: args.o_prompt,
            agent: args.agent ?? 'R',
            parentSessionId: context?.sessionID || '',
            targetSessionId: args.target_session_id || context?.sessionID || '',
          });
          return JSON.stringify(result);
        },
      },
      // aristotle_check, aristotle_abort 同样使用 { description, args, execute } 格式
    },
    event: async (event) => {
      if (event.type === 'session.idle') {
        await idleHandler.handle(sessionID);  // 驱动链式转换
      }
    },
  };
};
```

#### 3.2.2 异步任务执行器 (executor.ts)

`AsyncTaskExecutor.launch()` 是异步任务启动的核心方法：

```
launch(args) 的执行步骤:
+-------------------------------------------------------------+
| 1. 快照提取（非阻塞, 10s 超时）                                |
|    - 使用 Promise.race 控制超时                               |
|    - 原子写入: tmp -> rename                                   |
|    - 按 workflowId 命名，避免重复提取                           |
+-------------------------------------------------------------+
| 2. 创建子 Session                                             |
|    - client.session.create({title, parentID})                |
+-------------------------------------------------------------+
| 3. 注册到 WorkflowStore（崩溃安全）                             |
|    - register() -> 先写 Store 再 promptAsync                   |
|    - 如果 promptAsync 失败，reconcile 可以恢复                 |
+-------------------------------------------------------------+
| 4. 异步发送 Prompt                                            |
|    - client.session.promptAsync({body: {parts: [...]}})     |
|    - 立即返回，不等待 LLM 完成                                 |
+-------------------------------------------------------------+
| 返回: {status: "running"}                                    |
| message: "Bridge handles R->C chain automatically.          |
|          Do NOT call aristotle_check to poll."               |
| 用户看到此消息后可继续正常对话                                  |
| 主 session 无需轮询，Bridge 自治完成全部链路                    |
+-------------------------------------------------------------+
```

#### 3.2.3 空闲事件处理器 (idle-handler.ts)

`IdleEventHandler` 是链式转换的核心，当子 session 完成时自动驱动下一阶段：

```
session.idle 事件触发
       |
       v
+------------------------------------------+
| handle(sessionID)                        |
|                                          |
| 0. checkTrigger() -- 检查外部触发文件     |
|    (.trigger-reflect.json)               |
| 1. 查找对应 WorkflowState                |
| 2. 提取子 session 的输出                  |
| 3. markChainPending() -- 先标记           |
|    （崩溃安全：即使后续失败，              |
|     reconcileOnStartup 可恢复）           |
| 4. 根据 agent 类型驱动:                   |
|    - R -> driveChainTransition()          |
|    - C -> driveChainCompletion()          |
+------------------------------------------+
```

**Trigger 文件机制**（外部测试/触发）:

```
外部 harness 写入 .trigger-reflect.json:
  { "session_id": "ses_xxx", "project_directory": "/path" }

handle() 检测到 trigger 文件后:
  1. 调用 callMCPStart("reflect", trigger) -> orchestrate_start
  2. 删除 trigger 文件（无论成功失败）
  3. 如果返回 fire_sub -> executor.launch({agent: "R"})
  4. R 子 session 以 trigger.session_id 为 parent 和 target

适用场景: 测试 harness 触发、被动触发（无需用户主动调用 /aristotle）
```

**`callMCP()` / `callMCPStart()` 子进程通信**:

Bridge Plugin 无法直接调用 Python MCP 函数，通过 `spawn` 子进程桥接：

```typescript
// 使用 spawn（非 execFile）—— Node.js 异步 API 不支持 input 选项
private runSubprocess(args: string[], stdinData: string): Promise<McpResult> {
  const child = spawn('uv', args, { timeout: 30000 });
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdin.on('error', () => {});  // Oracle rev 1: stdin pipe 可能已关闭
  child.on('close', (code, signal) => {
    // signal != null -> 超时被 kill
    // code !== 0 -> 尝试从 stdout 解析错误 JSON
    // code === 0 -> 解析 stdout JSON
  });
  child.stdin.write(stdinData);  // 大 payload 走 stdin，避开 ARG_MAX
  child.stdin.end();
}
```

#### 3.2.4 工作流存储 (workflow-store.ts)

`WorkflowStore` 管理所有活跃工作流的状态，提供崩溃恢复：

```
WorkflowState 状态转换图:

                    +----------+
                    | running  | <-- executor.launch() 注册
                    +----+-----+
                         |
              +----------+----------+
              |          |          |
              v          v          v
      +----------+  +--------+  +----------+
      | completed|  | error  |  |cancelled | <-- aristotle_abort()
      +----------+  +--------+  +----------+
              ^
      +-------+-----------+
      | chain_pending      | <-- markChainPending() 中间状态
      +-------+-----------+
              |
     +--------+--------+
     |        |        |
     v        v        v
 completed  error  chain_broken
                     (链式转换失败)
```

**持久化策略**:
- 内存 Map + 磁盘 JSON 双写
- 每次状态变更都 `saveToDisk()`（原子写入: tmp -> rename）
- **多实例隔离**: 每个插件实例有唯一 `instanceId`（`pid-timestamp-uuid`）
  - `saveToDisk()` 做 read-before-write merge，保留其他实例的条目
  - `reconcileOnStartup()` 只恢复 `instanceId` 匹配的工作流
  - 淘汰策略跨实例全局 LRU（终态条目可安全淘汰）
- 最大 50 个工作流，满时自动淘汰最旧的非运行中工作流

#### 3.2.5 会话快照提取 (snapshot-extractor.ts)

```
SnapshotExtractor.extract():
1. 调用 client.session.messages() 获取消息
2. 过滤 user/assistant 角色，截取前 200 条
3. 每条消息内容截取 4000 字符
4. 构建结构化快照 JSON:
   { version: 1, session_id, extracted_at, total_messages, messages }
5. 原子写入到:
   ~/.config/opencode/aristotle-sessions/{sessionId}_{workflowId}_snapshot.json
```

---

### 3.3 Layer 3: Python MCP Server -- 编排状态机

**文件**: `aristotle_mcp/`（20 个 Python 文件，约 2500 行）

#### 3.3.1 编排入口 (_orch_start.py)

`orchestrate_start(command, args_json)` 是所有工作流的起点：

```
orchestrate_start():
  1. 解析 JSON 参数
  2. 确保仓库已初始化 + 清理过期工作流
  3. 生成 workflow_id = "wf_" + uuid4().hex[:16]
  4. 根据 command 分发:

  +---------+-----------------------------------------------------+
  | reflect | 创建 R prompt -> 保存 workflow(phase=reflecting)     |
  |         | 返回 {action: "fire_sub", sub_role: "R"}            |
  +---------+-----------------------------------------------------+
  | learn   | 有 domain+goal -> 直接搜索                            |
  |         | 无 -> 创建 intent_extraction prompt                   |
  |         | 返回 {action: "fire_o", o_prompt: ...}              |
  +---------+-----------------------------------------------------+
  | review  | 加载 DRAFT + 规则列表                                 |
  |         | 返回 {action: "notify", message: ...}                |
  +---------+-----------------------------------------------------+
  | sessions| 列出所有反思记录                                      |
  |         | 返回 {action: "notify", message: ...}                |
  +---------+-----------------------------------------------------+
```

#### 3.3.2 事件处理器 (_orch_event.py)

`orchestrate_on_event(event_type, data_json)` 是状态机的核心，根据工作流当前阶段和事件类型决定下一步：

```
状态机转换规则:
+---------------------+---------------+----------------------------------+
| 当前 Phase          | 事件类型       | 动作                              |
+---------------------+---------------+----------------------------------+
| intent_extraction   | o_done        | -> search (搜索规则)               |
| search              | (同步)         | -> notify/done                    |
| scoring             | score_done    | -> compressing (fire_o)           |
| compressing         | o_done        | -> done (notify)                  |
| reflecting          | subagent_done | -> checking (fire_sub, C role)    |
| checking            | subagent_done | -> done                           |
| review              | o_done        | -> done (notify)                  |
+---------------------+---------------+----------------------------------+
```

**Reflect 流程的 R->C 链式转换**（核心路径）:

```python
# Phase: reflecting + event: subagent_done
if workflow.phase == "reflecting":
    create_reflection_record(...)
    c_prompt = _build_checker_prompt(sequence, draft_file, project_directory)
    workflow["phase"] = "checking"
    _save_workflow(workflow_id, workflow)
    return {"action": "fire_sub", "sub_prompt": c_prompt, "sub_role": "C"}
```

```python
# Phase: checking + event: subagent_done
if workflow.phase == "checking":
    committed, staged = _parse_checker_result(result)
    rule_paths = list_rules(...)
    complete_reflection_record(sequence, status, rules_count)
    workflow["phase"] = "done"
    return {"action": "done", "message": "Aristotle done. X rules committed."}
```

#### 3.3.3 工作流状态管理 (_orch_state.py)

```python
# 持久化: 原子写入到 .workflows/{workflow_id}.json
def _save_workflow(workflow_id, state):
    state["updated_at"] = _now_iso()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(path)  # atomic rename

# 自动清理过期工作流
def _cleanup_stale_workflows(max_age_hours=24):
    # done 且超过 24h -> 删除
    # 活跃且超过 48h -> 删除（僵死工作流）
```

#### 3.3.4 CLI 子进程桥接 (_cli.py)

```
TypeScript (Bridge Plugin)              Python (MCP Server)
       |                                       |
       | spawn('uv', [...])                    |
       |-------------------------------------->|
       | stdin: JSON payload                   | orchestrate_start/on_event()
       |                                       |
       |<--------------------------------------|
       | stdout: JSON result                   |
```

```python
# _cli.py - CLI 入口
def main():
    subcommand = sys.argv[1]       # "orchestrate_start" or event_type
    data_json = sys.stdin.read()   # 大 payload 走 stdin 避开 ARG_MAX

    if subcommand == "orchestrate_start":
        command = sys.argv[2]      # "learn", "reflect", "review"
        result = orchestrate_start(command, data_json)
    else:
        result = orchestrate_on_event(subcommand, data_json)

    print(json.dumps(result))      # JSON result to stdout
```

---

## 4. 核心异步机制

### 4.1 promptAsync -- 真正的非阻塞

Bridge Path 的核心是 `session.promptAsync()` API，它实现了一个 fire-and-forget 模式：

```
调用 promptAsync() 的时间线:
                                      时间 ->
调用方:  |-- call --|-- return --|                    |-- check result --|
子session:           |-- LLM thinking (30s-2min) --|

调用方在 return 后可以立即继续工作，子 session 在后台独立运行。
当子 session 进入 idle 状态时，宿主触发 session.idle 事件。
```

### 4.2 session.idle 事件 -- 自动链式驱动

```
idle 事件驱动链式转换:

  [R 子 session 完成]
       |
       v
  session.idle 事件触发
       |
       v
  IdleEventHandler.handle(sessionID)
       |
       +-- 提取 R 的输出文本
       +-- markChainPending() [崩溃安全: 先写中间状态]
       +-- callMCP("subagent_done", {result})
       |       |
       |       v  MCP 状态机决定: phase=reflecting -> phase=checking
       |       返回 {action: "fire_sub", sub_prompt: c_prompt}
       |
       +-- executor.launch({agent: "C", oPrompt: c_prompt})
       |       |
       |       v  C 子 session 异步启动
       |
       v
  [C 子 session 在后台运行]
       |
       v  (C 完成)
  session.idle 事件再次触发
       |
       v
  IdleEventHandler.handle(C_sessionID)
       |
       +-- callMCP("subagent_done", {C_result})
       |       返回 {action: "done"}
       +-- markCompleted()
```

### 4.3 子进程 MCP 桥接 -- 跨语言状态机

Bridge Plugin 是 TypeScript，MCP Server 是 Python。两者通过子进程通信：

```
为什么用子进程而不是直接调用 MCP tools?

1. Bridge Plugin 运行在宿主进程（OpenCode）中
2. 宿主进程的 MCP client 可能不可用或限制较多
3. 子进程方式更可靠，不依赖宿主的 MCP 实现
4. stdin/stdout JSON 避开了 ARG_MAX 限制
5. 超时控制（30s）防止卡死
```

### 4.4 原子写入 -- 防止数据损坏

所有关键文件写入都使用原子写入模式：

```typescript
// TypeScript 端 (workflow-store.ts, snapshot-extractor.ts)
writeFileSync(tmpPath, data);
renameSync(tmpPath, finalPath);  // atomic on POSIX
```

```python
# Python 端 (_orch_state.py, frontmatter.py)
tmp = path.with_suffix(".tmp")
tmp.write_text(content)
tmp.replace(path)  # atomic rename
```

---

## 5. 完整生命周期流程

### 5.1 Reflect 流程（Bridge Path -- 完整异步）

```
步骤1: 用户触发
  用户: /aristotle
  SKILL.md: 调用 orchestrate_start("reflect", {...})

步骤2: MCP 初始化工作流
  _orch_start.py:
    - 生成 workflow_id
    - 检测 .bridge-active 标记 -> bridge_active = true
    - 构建 R prompt
    - 保存 workflow(phase=reflecting)
    - 返回 {action: "fire_sub", use_bridge: true}

步骤3: Bridge 启动 R 子 session（非阻塞）
  SKILL.md: 调用 aristotle_fire_o({workflow_id, o_prompt})
  executor.ts:
    - SnapshotExtractor 提取当前 session 快照
    - 创建子 session
    - 注册到 WorkflowStore
    - promptAsync(R prompt)
    - 返回 {status: "running"}
  用户看到: "Task launched. I will check results when ready."
  用户可继续正常对话

步骤4: R 完成，idle 事件触发
  idle-handler.ts:
    - 提取 R 输出（DRAFT report）
    - markChainPending()
    - callMCP("subagent_done", {workflow_id, result})
      -> _cli.py subprocess -> _orch_event.py
    - MCP: phase=reflecting -> phase=checking
    - 返回 {action: "fire_sub", sub_prompt: c_prompt}

步骤5: Bridge 启动 C 子 session（非阻塞）
  executor.ts:
    - 创建子 session
    - 注册到 WorkflowStore
    - promptAsync(C prompt)

步骤6: C 完成，idle 事件触发
  idle-handler.ts:
    - 提取 C 输出（CHECKER RESULT）
    - callMCP("subagent_done", {workflow_id, result})
    - MCP: phase=checking -> phase=done
    - 返回 {action: "done"}
    - markCompleted()

步骤7: 通知用户
  Bridge 自治完成: R->C 整条链路由 idle handler 驱动
  SKILL.md 收到完成消息后显示: "Aristotle done. 2 rules committed, 0 staged."
  注意: 主 session 不做轮询（已从 SKILL.md 移除 polling loop）
```

---

## 6. 状态机与工作流持久化

### 6.1 双重持久化架构

```
WorkflowState (TypeScript)              Workflow JSON (Python)
+------------------------+              +------------------------+
| 内存 Map<string, WF>   |              | .workflows/wf_xxx.json |
| 磁盘 bridge-workflows  |              | 原子写入               |
| .json                  |              +------------------------+
+------------------------+
     Bridge Plugin 管理                   MCP Server 管理

两者独立持久化，通过 workflow_id 关联。
Bridge 存储运行时状态，MCP 存储阶段状态。
多实例环境下，每个 Bridge 实例通过 instanceId 隔离各自的工作流，
saveToDisk() 做 read-before-write merge 保留其他实例的条目。
```

### 6.2 WorkflowState 字段

```typescript
interface WorkflowState {
  workflowId: string;       // "wf_" + 16 hex chars
  sessionId: string;        // 子 session ID
  parentSessionId: string;  // 主 session ID
  status: 'running' | 'chain_pending' | 'completed' | 'error'
        | 'chain_broken' | 'undone' | 'cancelled';
  result?: string;          // 子 agent 输出
  error?: string;           // 错误信息
  startedAt: number;        // 时间戳
  agent: string;            // "R" or "C"
  instanceId?: string;      // 插件实例标识（多实例隔离）
}
```

### 6.3 MCP Workflow JSON 字段

```python
{
  "phase": "reflecting",        # 当前阶段
  "command": "reflect",         # 命令类型
  "target_session_id": "...",   # 目标 session
  "sequence": 3,                # 反思记录序号
  "pending_role": "R",          # 等待的 agent 角色
  "record_created": true,       # 反思记录是否已创建
  "target_label": "unknown",    # 目标标签
  "project_directory": "...",   # 项目目录
  "committed_rule_paths": [],   # 已提交的规则路径
  "updated_at": "2026-04-26T12:00:00Z"
}
```

---

## 7. 故障恢复与容错设计

### 7.1 崩溃场景与恢复策略

| 崩溃场景 | 检测方式 | 恢复策略 |
|----------|---------|---------|
| promptAsync 之前崩溃 | Store 无记录 | 无需恢复，从未开始 |
| promptAsync 后、LLM 完成前崩溃 | Store 状态=running | reconcileOnStartup（仅本实例）检查子 session |
| R 完成、callMCP 之前崩溃 | Store 状态=running | reconcileOnStartup 检查子 session 有输出则 markCompleted |
| callMCP 中间崩溃 | Store 状态=chain_pending | chain_pending 视为 completed（MCP 状态可能已到 checking）|
| C 启动失败 | Store 状态=chain_pending | markChainBroken，用户可见 |
| MCP 子进程超时 | spawn 30s timeout，signal kill | 返回 error，markChainBroken |
| workflow_id 不匹配 | driveChainTransition 校验 | markChainBroken |
| 多实例并发 | 不同 instanceId 的工作流独立 | saveToDisk merge 保留跨实例条目 |

### 7.2 防御性编程要点

```
1. register() 先于 promptAsync()
   - 如果 promptAsync 失败，Store 中有记录可恢复

2. markChainPending() 先于 callMCP()
   - 如果 callMCP 失败，状态是 chain_pending 而非 running
   - reconcileOnStartup 可以区分两种情况

3. 原子写入 (tmp -> rename)
   - 所有持久化操作使用临时文件+重命名
   - 防止写入一半时崩溃导致数据损坏

4. workflow_id 校验
   - driveChainTransition 中验证 MCP 返回的 workflow_id 匹配
   - 防止跨工作流干扰

5. 超时保护
   - snapshot 提取: 10s 超时
   - MCP 子进程: 30s 超时（spawn timeout）
   - reconcile 查询: 5s 超时（RECONCILE_TIMEOUT_MS）
   - 防止无限等待

6. 最大工作流限制
   - 最多 50 个并发工作流
   - 满时自动淘汰最旧的非运行中工作流

7. 多实例隔离
   - 每个 Bridge 实例有唯一 instanceId
   - reconcile 只恢复自己实例的工作流
   - saveToDisk 做 read-before-write merge 保留其他实例条目
   - 全局 LRU 淘汰跨实例的终态工作流（安全：终态只读）
```

---

## 8. 关键设计决策与权衡

### 8.1 为什么用子进程而不是直接 MCP 调用?

```
选择: spawn('uv', [...]) 子进程（v1.1 从 execFileAsync 迁移）
原因: Node.js 异步 child_process API 不支持 input 选项，
      spawn + stdin.write/end 是异步场景下传递大 payload 的正确方式。
权衡:
  + 不依赖宿主的 MCP client 实现
  + stdin/stdout 避开 ARG_MAX
  + 进程隔离，MCP 崩溃不影响 Bridge
  + spawn 异步模型更健壮，可正确处理 signal kill
  - 启动开销（uv run 需要 ~1s）
  - 每次调用启动新进程
```

### 8.2 为什么 Bridge 和 MCP 各维护独立的状态?

```
选择: Bridge WorkflowStore + MCP .workflows/ JSON
权衡:
  + Bridge 可以独立于 MCP 判断运行时状态
  + MCP 可以独立于 Bridge 维护阶段语义
  + 崩溃恢复可以交叉验证
  - 两个状态源可能不一致
  - chain_pending 是"最佳努力"恢复
```

### 8.3 为什么 chain_pending 是终态（-> completed）?

```
选择: reconcileOnStartup 将 chain_pending -> completed
原因:
  - chain_pending 意味着子 agent 已完成，但链式转换中断
  - MCP 侧可能已经进入下一阶段（如 checking）
  - 但 Bridge 侧没有对应的 C session ID
  - 无法恢复链式转换（缺少 C 的 session 引用）
  - 最安全的做法是标记为 completed，保留已有的 R 结果
```

### 8.4 `prompt({noReply:true})` 的可行性验证（Gate #1 / #2）

Bug #14b（chain 完成后用户无通知）的修复方案依赖 `prompt({noReply:true})`，需验证其行为。

```
Gate #1 — noReply 能否向父会话注入 system-reminder？
  结论: 否。noReply:true 在 opencode 中有 hang bug（issues #4431, #14451），
       不会向父会话注入消息。
  验证: test/gate1-noReply-verify.sh
  决策: Bridge Plugin 不依赖 noReply 注入，改用 idle 检测 + 状态机驱动。

Gate #2 — noReply 是否挂起？消息是否可见？
  结论: 不挂起（1180ms 返回），消息在 session messages 中可见。
  验证: test/gate2-prompt-noReply-verify.sh
  决策: Bug #14b 采用 notifyParent() 方法，在 R-done 和 C-done 两处调用
       prompt({noReply:true}) 通知父会话。最佳努力：失败仅日志，不抛异常。
```

---

## 9. 文件清单与职责映射

### Bridge Plugin (TypeScript)

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | 108 | 插件入口，注册工具和事件处理器 |
| `executor.ts` | 107 | AsyncTaskExecutor，异步启动子 session |
| `idle-handler.ts` | 373 | IdleEventHandler，驱动链式转换 |
| `workflow-store.ts` | 199 | WorkflowState 持久化和恢复 |
| `snapshot-extractor.ts` | 71 | 会话快照提取 |
| `types.ts` | 32 | TypeScript 类型定义 |
| `api-probe.ts` | 11 | promptAsync API 检测 |
| `logger.ts` | 18 | 日志工具 |
| `utils.ts` | 19 | 工具函数 |

### MCP Server (Python)

| 文件 | 行数 | 职责 |
|------|------|------|
| `server.py` | 87 | FastMCP 入口，注册 20 个工具 |
| `config.py` | 105 | 路径常量、RISK_WEIGHTS、阈值 |
| `models.py` | 182 | RuleMetadata dataclass |
| `_orch_start.py` | 244 | orchestrate_start 编排入口 |
| `_orch_event.py` | 294 | orchestrate_on_event 状态机核心 |
| `_orch_state.py` | 92 | 工作流持久化和清理 |
| `_orch_prompts.py` | 206 | Prompt 模板构建 |
| `_orch_parsers.py` | 227 | 结果解析和格式化 |
| `_orch_review.py` | 213 | Review 工作流处理 |
| `_tools_rules.py` | 738 | 10 个规则生命周期工具 |
| `_tools_sync.py` | 166 | Git 同步工具 |
| `_tools_reflection.py` | 178 | 反思记录工具 |
| `_tools_feedback.py` | 164 | 反馈和自动反思工具 |
| `_tools_undo.py` | 39 | 撤销工具 |
| `_cli.py` | 48 | CLI 子进程入口 |
| `git_ops.py` | 124 | Git 操作抽象 |
| `frontmatter.py` | 219 | 流式 frontmatter 搜索 |
| `evolution.py` | 68 | Delta 决策引擎 |
| `migration.py` | 171 | 扁平 Markdown 迁移 |
| `_utils.py` | 55 | 共享工具函数 |

### 协议文件

| 文件 | 行数 | 加载时机 | 用途 |
|------|------|---------|------|
| `SKILL.md` | 116 | 始终加载 | 路由器，命令解析 |
| `REFLECTOR.md` | 217 | R 子 agent | 错误分析，DRAFT 生成 |
| `CHECKER.md` | 153 | C 子 agent | 验证和规则写入 |
| `REFLECT.md` | 135 | reflect 阶段 | Coordinator 反射协议 |
| `REVIEW.md` | 180 | review 阶段 | 用户审核流程 |
| `LEARN.md` | 246 | learn 命令 | 知识检索协议 |
