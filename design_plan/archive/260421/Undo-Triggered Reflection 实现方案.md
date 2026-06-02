# Undo-Triggered Reflection — 实现方案

> 状态：Demo 验证通过（2026-04-19）
> 分支：`undo-track`
> 文件：`plugins/aristotle-undo/src/index.ts`

## 1. 问题

用户在 OpenCode 中使用 `/undo` 撤销一轮对话时，被撤销的上下文会丢失。Aristotle 需要捕获这些上下文来分析"模型为什么答错了"，但 OpenCode 的 undo 机制没有提供任何可用的回调。

## 2. OpenCode 1.4.x 事件系统实测结论

通过 8 轮 live testing（tmux 驱动真实 OpenCode 实例），逐步排除了所有直觉上可行的方案：

### 2.1 不可行的方案

| 方案 | 原因 |
|------|------|
| `message.removed` 事件 | `/undo` 后该事件 **不触发**。OpenCode 的 `session.revert()` 是软删除，不走 pubsub 事件 |
| `command.executed` 事件 | `/undo` 被当作 TUI 内部操作，**不走 command 路径** |
| `chat.message` hook 区分 user/assistant | 该 hook **只触发 user 消息**。`agent` 和 `model` 字段始终有值，无法用来区分类型 |
| `message.updated` + `completed` 检测 | `message.updated` 对 assistant 消息触发时 `completed` **始终为 false**（在生成开始时触发，完成后不再触发） |
| `message.updated` (role=user) 检测 `/undo` | `/undo` 被 TUI 拦截，**不创建 user 消息**，不触发此事件 |
| `session.messages()` 轮询检测消失的消息 | Revert 是软删除，API **仍返回已撤销的消息**，无法区分 |
| `session.idle` 检测 `/undo` user 消息 | `/undo` 不触发 assistant 响应，`session.idle` **不会触发** |

### 2.2 可行的事件时序

通过全量事件日志（记录每个 `event.type`）发现的实际时序：

**正常对话流程：**
```
用户输入 → message.updated(role=user, completed=false)
         → message.updated(role=assistant, completed=false)
         → message.part.delta × N（流式输出）
         → session.diff（会话内容变化）
         → session.updated（会话元数据更新）
         → session.idle（助手完成响应）  ← 唯一可靠的"完成"信号
         → session.diff（再次触发）
```

**`/undo` 流程：**
```
/undo 输入 → tui.toast.show（显示 "1 message reverted"）
           → session.diff（会话内容变化）
           → session.updated（会话元数据更新）
           → （无 session.idle！无 assistant 响应！）
```

**关键差异**：正常流程在 `session.diff` 之前有 `session.idle`；`/undo` 流程在 `session.diff` 之前 **没有** `session.idle`。

## 3. 最终方案：Session Diff Flag 检测

### 3.1 核心思路

用一个 `snapshotWritten` 布尔标志跟踪快照状态：

1. `session.idle` 触发时 → 写快照 → 设 `flag = true`
2. `session.diff` 触发时 → 检查 `flag`
   - `flag = true` → 正常流程，消费 flag（`flag = false`）
   - `flag = false` → 没有经过 `session.idle`，说明是 `/undo` → 写 evidence

### 3.2 状态机

```
                    session.idle
                    写快照
                        │
                        ▼
              ┌─────────────────┐
              │ flag = true      │
              └────────┬────────┘
                       │
            session.diff 到达
                       │
              ┌────────┴────────┐
              │                  │
         flag = true        flag = false
         (正常流程)          (undo!)
              │                  │
     消费 flag → false     写 evidence 文件
```

### 3.3 快照条件门控

不是所有对话都值得快照：

- **第一轮跳过**：`idleCount <= 1`（用户还在热身）
- **短消息跳过**：用户消息 < 10 字符
- **`/undo`、`/redo` 跳过**：命令本身不覆盖快照（保护上一轮的快照）

### 3.4 数据文件

| 文件 | 路径 | 写入时机 | 内容 |
|------|------|----------|------|
| Snapshot | `.opencode/aristotle-undo-snapshot.json` | 每次 `session.idle`（覆盖） | 最后一个符合条件对话的 user + assistant 完整内容 |
| Evidence | `.opencode/aristotle-undo-evidence.json` | 检测到 `/undo` 时 | `event: "undo.detected"` + 完整 snapshot 副本 |

## 4. 代码架构

```
src/index.ts (153 行)
├── 类型定义
│   └── Snapshot 接口
├── 工具函数
│   ├── extractText() — 从 Part[] 提取纯文本
│   ├── writeSnapshot() — 写快照文件
│   ├── readSnapshot() — 读快照文件
│   └── writeEvidence() — 写 evidence 文件
├── 状态
│   ├── idleCount: Map<sessionID, number>
│   └── snapshotWritten: Map<sessionID, boolean>
└── event handler
    ├── session.idle → 写快照，设 flag
    └── session.diff → 检查 flag，检测 undo
```

只使用 `event` hook（不使用 `chat.message`、`chat.params` 等），依赖 `@opencode-ai/plugin` 和 `@opencode-ai/sdk` 两个包，**零 OMO 依赖**。

## 5. 调试历程

| 版本 | 方案 | 失败原因 |
|------|------|----------|
| v1 | OMO Stop hook + 关键词触发 | 依赖 OMO，违反独立性原则 |
| v2 | `chat.message` 预快照 + `message.removed` | `chat.message` 只触发 user 消息；`message.removed` 不触发 |
| v3 | `chat.message` user 跟踪 + `session.idle` 取 assistant | `chat.message` 中 `agent`/`model` 始终有值，无法区分 user/assistant |
| v4 | `message.updated` + `completed=true` 快照 | `completed` 始终为 false |
| v5 | `message.updated` (role=user) 检测 `/undo` | `/undo` 不创建 user 消息 |
| v6 | `message.updated` (role=user) + `session.idle` 组合 | `/undo` 不触发 `message.updated` |
| v7 | 纯 `session.idle` + 检查最后 user 消息是否 `/undo` | `/undo` 后 `session.idle` 不触发 |
| **v8** | **`session.idle` 写快照 + `session.diff` flag 检测** | **✅ 通过** |

## 6. 已知限制

1. **OpenCode 版本绑定**：方案依赖 OpenCode 1.4.x 的事件时序。如果 OpenCode 升级后 `/undo` 开始触发 `message.removed`，应优先使用该事件（更精确）
2. **快照粒度**：每次 `session.idle` 覆盖前一个快照，只保留最后一轮对话。如果用户连续多轮对话后 undo，只能捕获最后一轮
3. **并发 session**：`snapshotWritten` 是内存 Map，每个 plugin 进程独立，不跨进程共享
4. **项目范围**：快照文件在项目 `.opencode/` 目录下，只对该项目生效

## 7. 后续集成计划

1. **Aristotle SKILL.md** — 添加 `undo` 触发关键词
2. **REFLECT.md** — 添加 P3.4 Undo Trigger 阶段
3. **REFLECTOR.md** — 添加 R0 Undo Context Analysis 协议
4. **ROADMAP.md** — 更新路线图
5. **Evidence → Aristotle MCP** — 当 evidence 文件出现时，自动触发 Aristotle 反思流程
