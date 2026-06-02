# Undo-Triggered Reflection 测试方案终稿审查

> 日期：2026-04-20
> 审查者：Momus（终稿审查）
> 审查范围：修正后测试方案 vs 最新代码实现 vs 最新技术方案
> 审查结果：**REJECT**（3 个阻塞性问题）

---

## ERRORS（测试方案与代码矛盾）

### E1. T1.4.15 — session_id 一致性检查在代码中不存在

- **测试方案**：queue 文件 session_id 与当前 session 不匹配 → handler 不使用过期数据
- **实际代码**：`session.diff` handler 直接 `readQueue(ctx.directory)` 使用，没有比较 `queue.session_id` 与当前 session。`session.diff` 事件甚至没有从 event.properties 提取 sessionID。
- **结论**：测试用例测试了不存在的功能。要么在代码中实现 session_id 验证，要么删除此测试用例。

### E2. T1.6.7 — "无 sessionID 条目" 描述模糊

- 应改为 "sessionID 不在 undoDetected Map 中"，而非 "无 sessionID 条目"。

### E3. T4.1 Live Test — queue 不存在的断言不可靠

- OpenCode 可能触发隐式 idle 事件（系统初始化消息），导致 count > 1。已在 T4.2 承认不确定性但 T4.1 未修正。

---

## OMISSIONS（代码/规格行为未在测试方案中）

### O1. pendingNotification 按 ctx.directory 索引，不是 sessionID

- 代码中 `pendingNotification` Map 用 `ctx.directory` 作 key，而 `undoDetected` 和 `snapshotWritten` 用 `sessionID`。T1.6.10-11 没有验证这个 keying 差异。

### O2. 无测试验证 pendingNotification 的跨项目隔离

- T1.6.9 测试了 undoDetected 的多 session 隔离（sessionID key），但 pendingNotification 用 directory key，无等价测试。

### O3. session.diff handler 不提取 sessionID

- 代码完全依赖 `queue.session_id`（文件中读取），不检查 session.diff 事件的 sessionID。多 session 共享同一项目目录时共享同一 queue 文件。无测试覆盖此场景。

### O4. chat.message handler 可能同时触发两个注入

- 代码先检查 pendingNotification（line 325），再检查 undoDetected（line 337）。两个条件可能同时为 true，导致同时注入两条 [system] 文本。无测试覆盖双注入场景。

### O5. T2.4.1 和 T2.6.1 对 REFLECTOR.md 有冗余验证

- 两个测试都检查 REFLECTOR.md 不变。非阻塞，可保留。

### O6. 无测试覆盖 snapshotWritten Map 无条目（undefined）的情况

- 代码 `snapshotWritten.get(queue.session_id)` 可能返回 undefined。行为正确（falsy → 走 undo 检测），但无显式测试。

---

## IMPOSSIBLE TESTS（无法按描述实现）

### I1. T3.3.7 — 在 mock 框架内不可实现

- 测试需要验证 Reflector subagent 读 material、执行分析、产生 DRAFT。§4.1 mock 策略明确说"不 mock task()"。应降级为 Live Test。

### I2. T1.4.15 — 无法测试不存在的 session_id 验证

- 见 E1。

---

## COUNT DISCREPANCIES

### C1. 优先级计数不匹配

- **声称**：P0=90, P1=31
- **实际**：Layer 1-3 显式标记 P0=84, P1=27。Live Test 16 项无优先级标签，无法验证。
- **总计 127** 正确（65+27+19+16）。

---

## VERDICT: REJECT

### 阻塞性问题（必须修复）

1. **T1.4.15** 测试了代码中不存在的 session_id 验证。删除或实现。
2. **T3.3.7** 在 mock 框架内不可实现。降级为 Live Test。
3. **§6 优先级计数** 与实际不匹配。修正或给 Live Test 项标注优先级。

### 非阻塞性问题（建议修复）

- E2: T1.6.7 描述修正
- O1-O2: pendingNotification keying 差异测试
- O4: 双注入场景测试
- O6: snapshotWritten undefined 测试
