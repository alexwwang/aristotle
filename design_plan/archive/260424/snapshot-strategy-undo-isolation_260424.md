# Snapshot Strategy & Undo Isolation — 设计方案

**日期**: 2026-04-24
**状态**: 待审核
**前置**: unified-snapshot-via-sdk v3 已实施

## 设计原则

1. **Aristotle 是 daemon** — 反思一旦启动，与主会话解耦，不受用户 undo 影响
2. **Snapshot 是取证证据** — 捕获触发时刻的会话状态，不可变
3. **最少 LLM 调用** — Bridge 环境 2 次工具调用
4. **智能复用** — 不盲目 re-extract，基于消息数量变化决策

## Snapshot 策略：消息数量守卫

executor.launch() 中的 snapshot 决策逻辑：

```
IF targetSessionId:
  IF snapshotExists(targetSessionId):
    old = read snapshot JSON
    current_count = client.session.messages(targetSessionId, limit=0).total  # 轻量查询
    IF current_count > old.total_messages:
      → re-extract（session 增长了，有新内容）
    ELSE:
      → 保留旧 snapshot（session 未增长或被 undo，保留取证证据）
  ELSE:
    → extract 新 snapshot
```

**改动量**：executor.ts ~15 行
- 需要一个轻量 API 获取当前消息数量（不拉取全部消息）
- `client.session.messages({path: {id}, query: {limit: 1}})` 返回 `data` 数组长度不够准确
- 更可靠：读取已有 snapshot 的 `total_messages` 字段 + 对比

### 消息数量获取方案

**问题**：`client.session.messages()` 是否支持 `limit=0` 或返回 total count？

**方案**：用 `limit=1` 请求，检查返回 `data` 数组。这不是获取 total count 的正确方式。

**更好方案**：直接在 snapshot JSON 中存储 `total_messages` 字段（已有），然后用 `client.session.messages({path: {id}, query: {limit: 200}})` 获取当前消息数量做对比。

但获取 200 条消息只为计数太重。

**最终方案**：不获取当前消息数。改用更简单的逻辑——

```
IF snapshotExists:
  → 保留旧 snapshot（不 re-extract）
ELSE:
  → extract 新 snapshot
```

这就是原始设计。Council H2 的 stale data 问题通过另一种方式解决：
- 同 session 再次 `/aristotle` 时，MCP 的 orchestrate_start 会分配新的 workflow_id
- executor 用 `{sessionId}_{workflowId}.json` 命名（而非 `{sessionId}.json`）
- 每次反思有独立快照，互不干扰

### 命名方案变更

```
当前: {sessionsDir}/{sessionId}_snapshot.json
改为: {sessionsDir}/{sessionId}_{workflowId}_snapshot.json
```

- 首次 `/aristotle`: `ses_abc_wf_001_snapshot.json`（50 条消息）
- 第二次 `/aristotle`: `ses_abc_wf_002_snapshot.json`（80 条消息，新的独立快照）
- undo 后 `/aristotle`: `ses_abc_wf_003_snapshot.json`（可能 44 条，但这个快照也有分析价值）

**好处**：
- 每次反思独立取证，永不覆盖
- undo 后旧快照 `wf_001` 仍保留 undo 前的完整证据
- L2 清理策略（>7 天）自然回收旧快照

## Undo 隔离

### 当前问题

SKILL.md "After any /undo" 规则：任何 undo 都检查并 abort 所有 running Aristotle 工作流。

**歧义**：用户 undo 一个代码修改 → 触发 SKILL.md undo 规则 → 误杀正在运行的反思工作流。

### 方案

1. **移除 SKILL.md "After any /undo" 自动 abort 规则**
2. **记备忘**：后续可增加手动取消机制（`/aristotle abort`）

### 改动

SKILL.md 删除 "After any /undo" 整个 section（103-111 行）。

## 改动范围

| 文件 | 改动 |
|------|------|
| `executor.ts` | snapshot 命名改为 `{sessionId}_{workflowId}_snapshot.json`，恢复 snapshotExists 守卫 |
| `executor.ts` | SESSION_FILE 注入路径同步更新 |
| `snapshot-extractor.ts` | extract 方法签名新增可选 workflowId 参数 |
| `SKILL.md` | 删除 "After any /undo" section |
| `executor.test.ts` | 恢复 snapshotExists 相关测试 |

## 副作用

| # | 问题 | 处理 |
|---|------|------|
| 1 | 旧命名 `{id}_snapshot.json` 与新命名 `{id}_{wf}_snapshot.json` 共存 | reconcileOnStartup 清理旧格式文件 |
| 2 | L2 清理需匹配新命名模式 | `*_snapshot.json` glob 已覆盖 |
| 3 | 移除 undo 规则后 orphan workflow 风险 | workflow 有 50-poll 上限，超时自动 markError |
