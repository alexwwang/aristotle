# Aristotle Bridge 统一开发方案

**日期:** 2026-04-23
**版本:** v2（整合 v1.1 修正 + OMC 依赖分析 + bug 修复 + snapshot extractor）
**输入文档:**
- `session-snapshot-bridge_260423.md` — Reflector session 访问修复（6 轮审核通过）
- `aristotle-bridge-design_v1.1.md` — Async Bridge Plugin 设计（v1.1，已修正 MCP 通信）
- API 可行性验证报告（oracle + librarian 交叉验证）

---

## 一、可行性评估

### 1.1 Bridge v1.1 总体评估：**可行，需修补 2 个 bug**

v1.1 修正了 v1.0 的核心问题（`ctx.mcpClient` 不存在 → 改用 `session.prompt({noReply:true})` 消息注入），架构方向正确。

| API 假设 | 验证结果 | 状态 |
|----------|---------|------|
| `session.promptAsync()` | ✅ 存在 | 确认 |
| `session.abort()` | ✅ 存在 | 确认 |
| `session.prompt({noReply: true})` | ✅ 存在 | 确认 |
| `tool.execute.before` hook | ✅ 存在 | 确认 |
| Plugin `tool` hook | ✅ 存在 | 确认 |
| `ctx.mcpClient` | ❌ 不存在 | **v1.1 已修正**：改为消息注入 |
| 消息格式 `msg.role`/`msg.content` | ❌ 错误 | **v1.1 未修正**：应为 `{info, parts}` |
| `input.toolName` | ❌ 错误 | **v1.1 未修正**：应为 `input.tool` |

### 1.2 未修复的 Bug

| # | 文件 | Bug | 修复 | 影响 |
|---|------|-----|------|------|
| 1 | `idle-handler.ts` L388-394 | `msg.role`/`msg.content` 不存在 | → `msg.info.role` + `msg.parts` 提取 | idle-handler 永远返回空字符串，任务结果丢失 |
| 2 | `index.ts` L166 | `input.toolName` | → `input.tool` | undo 拦截永远不会触发 |

### 1.3 OMC 依赖分析

` t_session_search` 是 OMC 插件提供的 MCP 工具，不是 OpenCode 内置工具。OpenCode 原生不提供任何 session 读取能力。

| 环境 | session 访问能力 | Session Snapshot Bridge |
|------|-----------------|----------------------|
| OpenCode + OMC | `t_session_search` 可用 | Phase 0 正常工作 |
| OpenCode 无 OMC | 无 session 读取工具 | Phase 0 无法提取 session |
| OpenCode + Bridge Plugin | `ctx.client.session.messages()` 可用 | Phase 1 自动替代 Phase 0 |

**结论**：Phase 0 依赖 OMC，Phase 1 的 Bridge Plugin 可以消除此依赖。

---

## 二、问题空间与方案映射

```
问题 1: Reflector 无法访问 session     → Session Snapshot (Phase 0) + Bridge snapshot extractor (Phase 1)
问题 2: task() 阻塞式执行             → Bridge promptAsync (Phase 1)
问题 3: undo 操作无感知               → Bridge undo interceptor + on_undo MCP tool (Phase 1)
```

### 依赖关系

```
Phase 0: SKILL.md + t_session_search → snapshot.json → Reflector 读文件
  └─ 依赖: OMC（可选，无 OMC 时降级提示）
  └─ 独立可实施 ✓

Phase 1: Bridge Plugin
  ├─ promptAsync → 异步执行
  ├─ session.messages() → snapshot.json（替代 t_session_search，零 OMC 依赖）
  ├─ undo interceptor → on_undo
  └─ 不依赖 Phase 0 的代码，只共享 snapshot.json 格式
```

**两个 Phase 可并行开发**：
- Phase 0 改 Python/SKILL 层
- Phase 1 改 TypeScript 插件层
- 唯一交集是 snapshot.json 格式（已稳定，6 轮审核通过）

---

## 三、分层架构

```
Layer 0: Session Snapshot Bridge (Python/MCP + SKILL)
├── 主 session 用 t_session_search(OMC) 提取 → snapshot.json
├── Reflector 用 Read(SESSION_FILE) 消费
├── 上下文消耗: ~25K token（可接受但非理想）
└── 依赖: OMC（可选）

Layer 1: Aristotle Bridge Plugin (TypeScript/OpenCode Plugin)
├── aristotle_fire_o 工具: 异步启动子代理（promptAsync）
├── session.idle 监听 → 消息注入 → 主 agent 调用 MCP
├── session 提取增强: Bridge 用 SDK 提取 → snapshot.json
│   （替代 Layer 0 的 t_session_search 路径，零上下文消耗、零 OMC 依赖）
├── undo 拦截: tool.execute.before + 消息注入
└── 依赖: OpenCode SDK（无 OMC 依赖）

Layer 2: Undo 集成 (合并 undo 分支功能)
├── undo 检测逻辑（从 aristotle-undo 迁移）
├── material.json → snapshot.json 转换层
└── [system] 注入通知
```

### 分层切换逻辑

```
安装 Bridge 后的 SKILL.md 行为:

PRE-RESOLVE 阶段:
  1. 检查 snapshot 文件是否已存在（Bridge 可能已预提取）
     ├── 已存在 → 直接使用，跳过 t_session_search
     └── 不存在 → 检查 t_session_search 是否可用
         ├── 可用（OMC 已装）→ 提取并写文件
         └── 不可用 → session_file="" → Reflector 降级提示

ACTION EXECUTION 阶段:
  If action is `fire_o`:
    检查 aristotle_fire_o 工具是否可用
    ├── 可用（Bridge 已装）→ 调用 aristotle_fire_o（非阻塞）
    └── 不可用 → 调用 task()（阻塞）
```

---

## 四、Phase 0: Session Snapshot Bridge

**已通过 6 轮审核，详见 `session-snapshot-bridge_260423.md`。**

**范围**: 5 个 Python 文件 + 2 个协议文件，~25 行

| 步骤 | 文件 | 变更 |
|------|------|------|
| 1 | `config.py` | +`SESSIONS_DIR_NAME`, +`resolve_sessions_dir()` |
| 2 | `_orch_prompts.py` | prompt 模板 +`SESSION_FILE` 参数 |
| 3 | `_orch_start.py` | 透传 `session_file` 到 prompt |
| 4 | `REFLECTOR.md` | SESSION PARAMETERS + R1a 聚焦 + R1b 读文件 |
| 5 | `SKILL.md` | PRE-RESOLVE 提取步骤 + ROUTE 传参 + Bridge 检测 |
| 6 | 测试 | pytest + static checks |

**实施时间**: 2 小时 | **阻塞**: 无

---

## 五、Phase 1: Bridge Plugin

### 5.1 v1.1 Bug 修复

| # | 文件 | 修复 |
|---|------|------|
| 1 | `idle-handler.ts` | `extractLastAssistantMessage()` 改为 `{info, parts}` 格式 |
| 2 | `index.ts` | `input.toolName` → `input.tool` |

修复后的 `extractLastAssistantMessage()`:

```typescript
function extractLastAssistantMessage(
  messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info.role === 'assistant') {
      return msg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
        .map(p => p.text)
        .join('\n');
    }
  }
  return '';
}
```

### 5.2 新增: Snapshot Extractor

```typescript
// snapshot-extractor.ts
import type { OpencodeClient } from '@opencode-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class SnapshotExtractor {
  private readonly sessionsDir: string;

  constructor() {
    this.sessionsDir = join(homedir(), '.config', 'opencode', 'aristotle-sessions');
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  async extract(
    client: OpencodeClient,
    sessionId: string,
    focusHint: string = 'last 50 messages',
    limit: number = 50,
  ): Promise<string> {
    const messages = await client.session.messages({
      path: { id: sessionId },
      query: { limit },
    });

    const filtered = messages.data
      .filter(m => m.info.role === 'user' || m.info.role === 'assistant')
      .map((m, i) => ({
        index: i + 1,
        role: m.info.role,
        content: m.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
          .map(p => p.text)
          .join('\n')
          .slice(0, 2000),
      }));

    const snapshot = {
      version: 1,
      session_id: sessionId,
      extracted_at: new Date().toISOString(),
      focus: focusHint,
      source: 'bridge-plugin-sdk',
      total_messages: messages.data.length,
      messages: filtered,
    };

    const filePath = join(this.sessionsDir, `${sessionId}_snapshot.json`);
    writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    return filePath;
  }

  snapshotExists(sessionId: string): boolean {
    const filePath = join(this.sessionsDir, `${sessionId}_snapshot.json`);
    try {
      const { existsSync } = require('node:fs');
      return existsSync(filePath);
    } catch {
      return false;
    }
  }
}
```

### 5.3 与 fire_sub 集成

Bridge 在启动 Reflector 子代理前自动提取 session：

```typescript
// executor.ts 的 launch() 方法中，在创建子代理 session 之前:
if (args.oPrompt.includes('SESSION_FILE')) {
  // 这是一个 Reflector/Checker 子代理，可能需要 session snapshot
  // 检查 snapshot 是否已存在
  const extractor = new SnapshotExtractor();
  if (!extractor.snapshotExists(targetSessionId)) {
    const snapshotPath = await extractor.extract(this.client, targetSessionId);
    // 替换 prompt 中的 SESSION_FILE 占位符
    args.oPrompt = args.oPrompt.replace('SESSION_FILE: ', `SESSION_FILE: ${snapshotPath}`);
  }
}
```

> **注**: 具体的 session_id 传递方式需要进一步设计。Bridge 需要从 `orchestrate_start` 的返回值或主 session 上下文中获取 `target_session_id`。这可能需要调整 SKILL.md 的交互协议，让主 agent 在调用 `aristotle_fire_o` 时传递额外参数。

### 5.4 SKILL.md Bridge 集成指令

```markdown
## Bridge Detection

If tool `aristotle_fire_o` is available in your tool list:
- For `fire_o` actions: call `aristotle_fire_o(workflow_id, o_prompt)` instead of `task()`
- For `fire_sub` actions: call `aristotle_fire_o(workflow_id, sub_prompt)` instead of `task()`
- Wait for `<aristotle-task-complete>` system-reminder, then call `aristotle_retrieve(workflow_id)` to get result
- Then call MCP `orchestrate_on_event("subagent_done", ...)` as normal

If `aristotle_fire_o` is NOT available:
- Use standard `task()` (blocking) as before
```

### 5.5 模块结构（修正后）

```
src/
├── index.ts                  # 插件入口（修复 input.tool）
├── api-probe.ts              # promptAsync 探测
├── executor.ts               # 双路径执行器 + snapshot 集成
├── workflow-store.ts         # workflow 状态存储
├── idle-handler.ts           # session.idle 处理（修复消息格式）
├── snapshot-extractor.ts     # ★ 新增: SDK session 提取 → snapshot.json
├── undo-interceptor.ts       # undo 拦截（v1.1 消息注入）
└── types.ts                  # 类型定义
```

**注意**: `aristotle-mcp-client.ts` 已移除（v1.1 修正）。Bridge 不直接调用 Aristotle MCP。

---

## 六、Aristotle MCP Server 侧变更

| Layer | 文件 | 变更 | 行数 |
|-------|------|------|------|
| 0 | `config.py` | +`SESSIONS_DIR_NAME`, +`resolve_sessions_dir()` | +5 |
| 0 | `_orch_prompts.py` | prompt 模板 +SESSION_FILE | +3 |
| 0 | `_orch_start.py` | 透传 session_file | +3 |
| 1 | `_tools_undo.py` (新建) | `on_undo()` MCP tool | +30 |
| 1 | `_orch_event.py` | undone 状态短路处理 | +5 |

---

## 七、实施路线图

### Phase 0: Session Snapshot Bridge（立即）
- **分支**: test-coverage
- **范围**: Layer 0 全部
- **时间**: 2 小时
- **验证**: 295 pytest + 104 static + 人工 e2e
- **产出**: reflect 流程可用（依赖 OMC）

### Phase 1: Bridge Plugin（Phase 0 后或并行）
- **分支**: 新建 `bridge-plugin`
- **范围**: Layer 1（async + snapshot extractor + undo 拦截 + bug 修复）
- **时间**: 3-5 天
- **验证**: 插件单元测试 + 手动集成测试
- **产出**: 主 session 非阻塞 + 零上下文消耗 session 提取 + undo 感知

### Phase 2: Undo 集成（Phase 1 后）
- **分支**: 合并 undo-track → bridge-plugin
- **范围**: Layer 2（undo 检测 + material 生成）
- **时间**: 2-3 天
- **验证**: undo 场景 e2e 测试

### Phase 3: 合并与发布
- 合并 bridge-plugin → test-coverage → main

---

## 八、风险与决策点

| # | 风险/决策 | 影响 | 缓解 |
|---|---------|------|------|
| 1 | Phase 0 依赖 OMC | 无 OMC 环境 reflect 降级 | Phase 1 Bridge 消除此依赖 |
| 2 | `promptAsync` 从未在本项目使用 | 可能有未知 runtime 行为 | api-probe.ts 探测 + fireAndForget fallback |
| 3 | `tool.execute.before` 无法阻止执行 | undo 拦截只能"事后通知" | 符合 Bridge "只适配不做业务"原则 |
| 4 | SKILL.md 需检测 Bridge 是否安装 | 增加指令复杂度 | 用工具可用性检测（单行条件） |
| 5 | Bridge 如何获取 target_session_id | executor.launch() 需要此信息来提取 snapshot | 可能需要调整 fire_o 参数或从 prompt 中解析 |
| 6 | 主 session 上下文消耗（Phase 0） | ~25K token/次 | Phase 1 Bridge 完全消除 |
