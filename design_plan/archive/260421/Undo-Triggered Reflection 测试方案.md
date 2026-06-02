# Undo-Triggered Reflection — 测试方案

> 日期：2026-04-20
> 前置文档：`Undo-Triggered Reflection 技术方案.md`（v3 定稿）
>
> 本文档基于技术方案 v3 设计 3 层测试（Plugin 单元 → 协议文件 → 集成），覆盖全部可测试需求。

---

## 0. 总览

| 层级 | 执行方式 | 用例数 | 何时运行 |
|------|---------|--------|---------|
| 第一层：Plugin 单元 | `bun test`（Bun 原生测试） | 64 | 每次改 Plugin 代码 |
| 第二层：协议文件 | `bash test.sh`（扩展） | 27 | 每次改协议文件 |
| 第三层：集成 + Live | 状态机模拟 + tmux Live test | 18 + 17 | Phase 4 验证阶段 |

**总计 126 个测试用例**，按优先级分为：

- **P0**（必须）：阻塞性缺陷覆盖，实施前必须到位
- **P1**（应该）：质量保障，实施过程中补充
- **P2**（建议）：已知局限或人工验证项

---

## 1. 已知局限

### 1.1 并发写入安全

Plugin 运行在单进程事件循环中，`session.diff` handler 的 queue/material 写入操作不是原子的（`readQueue` → 修改 → `writeQueue` 之间存在 async yield 点）。在极端的快速连续 `/undo` 场景下理论上存在 TOCTOU 窗口，但实际风险可忽略：

- 事件源为手动操作，两次 `/undo` 间隔远大于文件 I/O 耗时
- OpenCode 事件系统串行派发 Plugin handler 回调
- Bun 文件 I/O 微秒级完成

如需支持自动化批量 undo 场景，应增加文件锁或写前校验。**本测试方案不覆盖并发写入场景。**

### 1.2 U5/U6 用户通知格式

U5/U6 输出的通知文本是给用户看的，措辞可能随版本迭代调整。建议在 Live Test 中人工验证可读性，不写精确文本匹配的自动化断言。自动化测试仅验证通知包含关键字段（task_id、session_id）。

---

## 2. 第一层：Plugin 单元测试

**范围**：`plugins/aristotle-undo/src/index.ts` 的所有函数和 handler。
**执行**：`bun test plugins/aristotle-undo/test/plugin.test.ts`
**Mock 策略**：mock `ctx.client.session.messages()` 返回预设消息列表；文件 I/O 使用临时目录。

### 2.1 数据结构验证

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T1.1.1 | `QueueEntry` type="normal" 包含 msg_index | 正常条目结构完整 | P1 |
| T1.1.2 | `QueueEntry` type="undo" 包含 prev_msg_index | undo 条目结构完整 | P1 |
| T1.1.3 | `Material` 初始 status="pending", retry_count=0, max_retries=2 | 状态机初始值 | P1 |
| T1.1.4 | `MaterialEntry` 包含 background, user_message, assistant_message | 条目完整 | P1 |
| T1.1.5 | `MaterialEntry.assistant_message.content` 截断到 2000 字符 | 防膨胀 | P1 |
| T1.1.6 | `MaterialEntry.seq` 与对应 `QueueEntry.seq` 一致 | 数据关联正确 | P1 |

### 2.2 文件 I/O（Queue / Material）

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T1.2.1 | `writeQueue` → `readQueue` 往返正确，含 `queue.version === 1` | 序列化一致性 + version 字段 | P0 |
| T1.2.2 | `readQueue` 文件不存在 → 返回 null | 空状态处理 | P0 |
| T1.2.3 | `readQueue` 文件损坏（非法 JSON）→ 返回 null | 容错 | P0 |
| T1.2.4 | `writeMaterial` → `readMaterial` 往返正确 | 序列化一致性 | P0 |
| T1.2.5 | `readMaterial` 文件不存在 → 返回 null | 空状态处理 | P0 |
| T1.2.6 | `readMaterial` 文件损坏 → 返回 null | 容错 | P0 |
| T1.2.7 | `writeQueue` 写入路径为 `${dir}/.opencode/aristotle-undo-queue.json` | 路径正确 | P1 |
| T1.2.8 | `writeMaterial` 写入路径为 `${dir}/.opencode/aristotle-undo-material.json` | 路径正确 | P1 |

### 2.3 session.idle handler（Queue 写入逻辑）

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T1.3.1 | 第一轮对话 (count=1) → 跳过 queue 写入 | MIN_EXCHANGE_GATE | P0 |
| T1.3.2 | 用户消息 < 10 字符 → 跳过 | MIN_LENGTH_GATE | P0 |
| T1.3.3 | 用户消息以 `/undo` 开头 → 跳过，reset snapshotWritten flag | UNDO_SKIP_GATE | P0 |
| T1.3.4 | 用户消息以 `/redo` 开头 → 跳过，reset snapshotWritten flag | REDO_SKIP_GATE + flag 重置 | P0 |
| T1.3.5 | 正常第二轮 → 写 queue normal 条目（seq=2, msg_index=正确值） | 标准写入 | P0 |
| T1.3.6 | 连续两轮正常 → queue 只有 1 条 normal（旧条目被 pop） | 正常条目只保留最新 | P0 |
| T1.3.7 | 有 undo 条目 + 写 normal → undo 条目保留 | 不误删 undo | P0 |
| T1.3.8 | 无 user 消息 → return 不写 | 空消息防护 | P1 |
| T1.3.9 | 无 assistant 消息 → return 不写 | 空回复防护 | P1 |
| T1.3.10 | `msg_index` = `session.messages()` 返回的数组长度 | 位置记录正确 | P0 |
| T1.3.11 | `ctx.client.session.messages()` 抛异常 → catch 不崩溃，不写 queue | API 错误容错 | P1 |
| T1.3.12 | Plugin 启动时 material status=pending → 设置 pendingNotification flag | 遗留任务检测 | P0 |
| T1.3.13 | Plugin 启动时 material status=consumed → 不设置 flag | 无遗留任务不干扰 | P0 |
| T1.3.14 | Plugin 启动时无 material 文件 → 不设置 flag | 空状态正常 | P0 |

### 2.4 session.diff handler（Undo 检测 + Material 构建）

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T1.4.1 | snapshotWritten flag=true（刚写 snapshot）→ 正常流，return | 正常 DIFF 过滤 | P0 |
| T1.4.2 | 无 queue 文件 → return | 空状态防护 | P0 |
| T1.4.3 | queue 无条目 → return | 空队列防护 | P0 |
| T1.4.4 | flag=false + 有 normal 条目 → 检测 undo，写 undo 到 queue | **核心：undo 检测** | P0 |
| T1.4.5 | undo 条目的 `prev_msg_index` = 最后一条 normal 的 `msg_index` | 位置回溯正确 | P0 |
| T1.4.6 | 无 material 文件 → 创建 material（status=pending） | 首次创建 | P0 |
| T1.4.7 | material status=consumed → 覆盖写入新 material | 安全覆盖 | P0 |
| T1.4.8 | material status=pending → 追加新 undo 条目 | 保护未消费数据 | P0 |
| T1.4.9 | material status=processing → 追加新 undo 条目 | 保护运行中数据 | P0 |
| T1.4.10 | material status=retry_pending → 追加新 undo 条目 | 保护待重试数据 | P0 |
| T1.4.11 | material status=failed → 覆盖写入新 material | 已放弃，新优先 | P0 |
| T1.4.12 | 连续 2 次 undo → queue 有 2 条 undo，material 有 2 entries | 多 undo 场景 | P0 |
| T1.4.13 | undo 检测后 `undoDetected` flag 设为 true | 触发 chat.message 注入 | P0 |
| T1.4.14 | 无 normal 条目时 `prev_msg_index=0`（防御性） | 边界防护 | P1 |
| T1.4.15 | Material 追加路径去重：已有 entry seq=5，queue undo 含 seq=5 → material.entries.length 不变 | 追加去重 | P0 |

> **已知局限**：代码不验证 `queue.session_id` 与当前 session 的一致性。在单进程、单用户、手动触发约束下，queue 文件按项目目录隔离，session_id 不匹配不会发生。多 OpenCode 实例同项目场景（极罕见）可能导致误检，当前不实现验证。

### 2.5 buildMaterial() 函数

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T1.5.1 | prev_msg_index > 0 → `session.messages(limit=prevMsgIndex)` 返回背景 | 正常背景构建 | P0 |
| T1.5.2 | 背景取最后 10 条消息 | 背景窗口限制 | P0 |
| T1.5.3 | 每条背景消息截断到 200 字符 | 背景截断 | P1 |
| T1.5.4 | prev_msg_index=0 → background 为空字符串 | 无背景场景 | P0 |
| T1.5.5 | `session.messages()` 抛异常 → `context_incomplete=true` | 容错标记 | P0 |
| T1.5.6 | `session.messages()` 返回 error → `context_incomplete=true` | API 错误处理 | P0 |
| T1.5.7 | `assistant_message.content` 截断到 2000 字符 | 防膨胀 | P0 |
| T1.5.8 | 多 undo 条目按 prev_msg_index 分组共享背景 | 分组优化 | P1 |
| T1.5.9 | 同组内各条目共享同一 background 字符串 | 去重正确 | P1 |
| T1.5.10 | 返回 Material 的 version=1, session_id=queue.session_id, project_directory=ctx.directory, created_at 为合法 ISO | 顶层契约字段 | P0 |

### 2.6 chat.message handler（注入逻辑）

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T1.6.1 | `undoDetected=true` → 注入文本 Part | **核心注入** | P0 | [existing] |
| T1.6.2 | 注入内容**无** `synthetic` 字段 | 非 synthetic（方案 C） | P0 | [existing] |
| T1.6.3 | 注入 Part 有 id/sessionID/messageID/type/text 六个必填字段 | 结构完整 | P0 | [existing] |
| T1.6.4 | 注入文本以 `[system]` 开头 | 格式正确 | P0 | [existing] |
| T1.6.5 | 注入文本包含 `/aristotle` 指令 | 指令可执行 | P0 | [existing] |
| T1.6.6 | `undoDetected=false` → 不注入 | 正常流不干扰 | P0 | [new] |
| T1.6.7 | sessionID 不在 undoDetected Map 中 → 不注入 | 未知 session | P0 | [new] |
| T1.6.8 | 注入后 flag 消费（设为 false） | 一次性注入 | P0 | [new] |
| T1.6.9 | 不同 session 独立跟踪 | 多 session 隔离 | P0 | [new] |
| T1.6.10 | 首次 chat.message + pendingNotification=true → 注入遗留任务提示，消费 flag | Plugin 初始化通知 | P0 | [new] |
| T1.6.11 | pendingNotification 消费后，后续 chat.message 不再注入遗留提示 | 一次性通知 | P0 | [new] |

---

## 3. 第二层：协议文件测试

**范围**：UNDO_REFLECT.md（新建）、REFLECT.md（改动）、SKILL.md（改动）、REFLECTOR.md（不变）、文档文件。
**执行**：扩展 `bash test.sh`，新增断言。

### 3.1 UNDO_REFLECT.md 存在性与内容

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T2.1.1 | 文件存在于 `${SKILL_DIR}/UNDO_REFLECT.md` | 文件到位 | P0 |
| T2.1.2 | 包含 "STEP U1" ~ "STEP U6" 全部步骤 | 协议完整 | P0 |
| T2.1.3 | 包含全部 5 个状态：pending, processing, consumed, retry_pending, failed | 状态机完整 | P0 |
| T2.1.4 | 包含 `max_retries` 字段引用 | 重试机制 | P0 |
| T2.1.5 | 包含对 REFLECTOR.md R1/R2 的依赖声明 | 解耦诚实性 | P0 |
| T2.1.6 | 包含 material 文件路径 `.opencode/aristotle-undo-material.json` | 路径正确 | P0 |
| T2.1.7 | U2 prompt 包含 `FOCUS_HINT: undo`、`TARGET_SESSION_ID`、`PROJECT_DIRECTORY`、`USER_LANGUAGE`、material 文件路径、分析指令 | prompt 参数完整 | P0 |
| T2.1.8 | U3 在启动 R 后立即设 `processing`（不是 `consumed`） | 时序正确 | P0 |
| T2.1.9 | U6 在 R 成功后才设 `consumed` | 状态设置时序 | P0 |
| T2.1.10 | U1 processing 状态 → 输出提示信息后 STOP | 并发保护 | P0 |
| T2.1.11 | U1 failed 状态 → 输出 material 路径和恢复提示后 STOP | 用户恢复路径 | P0 |
| T2.1.12 | U4 更新 aristotle-state.json，target_label 包含 "undo" | 状态文件集成 | P0 |

### 3.2 REFLECT.md 改动验证

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T2.2.1 | F1 开头包含 "Undo Trigger Detection" 区块 | undo 分支存在 | P0 |
| T2.2.2 | 检测到 pending/retry_pending → 读 UNDO_REFLECT.md 并 STOP | 路由正确 | P0 |
| T2.2.3 | 检测到 consumed/failed → 继续标准流程 | 回退正确 | P0 |
| T2.2.4 | material 文件不存在 → 继续标准流程 | 回退正确 | P0 |

### 3.3 SKILL.md 改动验证

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T2.3.1 | description 包含 "undo" 相关描述 | 触发词扩展 | P1 |
| T2.3.2 | Parse Arguments 区块包含 plugin trigger 注释行 | 参数文档完整 | P1 |

### 3.4 REFLECTOR.md 不变验证

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T2.4.1 | REFLECTOR.md 行数 = 195（与改动前一致） | **文件未改** | P0 |
| T2.4.2 | 不包含 "undo" 字样（大小写不敏感） | 无 undo 耦合 | P0 |

### 3.5 其他文档验证

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T2.5.1 | ROADMAP.md 包含 V1.1d 区块 | 版本记录 | P1 |
| T2.5.2 | README.md 包含 "Undo-Triggered Reflection" 说明 | 用户文档 | P1 |
| T2.5.3 | .gitignore 包含 `aristotle-undo-queue.json` | 新文件排除 | P1 |
| T2.5.4 | .gitignore 包含 `aristotle-undo-material.json` | 新文件排除 | P1 |
| T2.5.5 | .gitignore 不包含旧文件名 `aristotle-undo-snapshot.json` | 旧规则清理 | P1 |
| T2.5.6 | .gitignore 不包含旧文件名 `aristotle-undo-evidence.json` | 旧规则清理 | P1 |

### 3.6 不改动文件验证

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T2.6.1 | 以下文件行数与改动前一致（或哈希匹配）：REVIEW.md, LEARN.md, CHECKER.md, GEAR.md, REFLECTOR.md | 意外修改未发生 | P1 |

---

## 4. 第三层：集成测试

**范围**：Material 状态机完整流转 + Plugin/Material 交互时序 + 边界条件。
**执行**：状态机模拟（单元测试框架内的模拟状态流转）+ Live Test（手动）。

### 4.1 Material 状态机完整流转

**Mock 安排**：状态机测试在 material-file 层面操作，直接读写 material JSON 文件模拟状态转换。Reflector 成功/失败的模拟方式：
- **Reflector 成功**：直接设置 `material.status = "consumed"`（模拟 U6 成功后写入）
- **Reflector 失败**：设置 `material.status = "retry_pending"`、`material.retry_count++`、`material.last_error = "..."`（模拟 U6 失败后写入）
- **Reflector 运行中**：设置 `material.status = "processing"`（模拟 U3 后、U6 前状态）
- 不需要 mock `background_output` 或 `task()` 调用——这些测试只验证 material 文件层面的状态流转正确性

| ID | 测试路径 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T3.1.1 | **Happy path**: Plugin 写 pending → U2 启动 R(processing) → U6 成功(consumed) | 全链路畅通 | P0 |
| T3.1.2 | **单次重试**: pending → processing → 失败 → retry_pending → processing → consumed | 重试成功 | P0 |
| T3.1.3 | **多次重试后成功**: pending → processing → 失败 → retry_pending → processing → 失败 → retry_pending → processing → consumed | max_retries=2 内成功 | P0 |
| T3.1.4 | **重试耗尽**: pending → processing → 失败 × 3 → failed | 超限终态 | P0 |
| T3.1.5 | **retry_count 递增**: 每次 U6 失败 retry_count + 1 | 计数正确 | P0 |
| T3.1.6 | **last_error 记录**: 失败时 last_error 包含错误信息 | 错误可追溯 | P0 |

### 4.2 Plugin + Material 交互时序

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T3.2.1 | undo → Plugin 写 material(pending) → chat.message 注入 → AI 读 REFLECT.md → 检测 material → 读 UNDO_REFLECT.md | 完整触发链 | P0 |
| T3.2.2 | R 运行中(processing) 用户又 undo → Plugin 追加条目不覆盖 | 并发安全 | P0 |
| T3.2.3 | material consumed 后用户再 undo → Plugin 覆盖新 material | 覆盖正确 | P0 |
| T3.2.4 | material failed 后用户再 undo → Plugin 覆盖新 material | 恢复正确 | P0 |

### 4.3 边界条件

| ID | 测试用例 | 验证点 | 优先级 |
|----|---------|--------|--------|
| T3.3.1 | Plugin 启动时 material status=pending → pendingNotification flag 设置为 true（不清理、不改文件） | 遗留任务保留 | P0 |
| T3.3.2 | Plugin 启动时 material status=processing → pendingNotification flag 设置为 true（不清理、不改文件） | R 崩溃后保留 | P0 |
| T3.3.3 | Material 文件 JSON 损坏 → UNDO_REFLECT 删除文件回退标准流程 | 损坏恢复 | P0 |
| T3.3.4 | `context_incomplete=true` → Reflector 只分析 user_message + assistant_message | 降级分析 | P0 |
| T3.3.5 | Reflector 启动后 material 文件被外部删除 → R 报错 → 触发重试机制 | 运行时容错 | P0 |
| T3.3.6 | Queue 只有 undo 条目无 normal（理论上不应发生）→ prev_msg_index=0 | 防御性处理 | P1 |
| T3.3.7 | ~~降级为 Live Test~~ 见 Live Test 附加检查 | — | — |
| T3.3.8 | **U5 通知关键字段**: Reflector 启动后通知输出包含 `undo-trigger`、`undo(s)`、`task_id:`、`session_id:` 子串（非精确匹配，仅验证关键字段存在） | 启动通知完整 | P1 |
| T3.3.9 | **U6 失败通知关键字段**: Reflector 失败后通知输出包含 `retry_count` 值（如 `attempt 1/2`）和 `material` 路径子串（非精确匹配） | 失败通知完整 | P1 |

---

## 5. Live Test（端到端手动验证）

**前置条件**：opencode + aristotle-undo plugin 已安装并加载。
**执行方式**：按步骤手动操作，每步检查文件和状态。

| ID | 步骤 | 验证点 |
|----|------|--------|
| T4.1 | 启动 opencode + plugin，发 "hello" → 等 session.idle | queue 文件不存在（count=1 被 MIN_EXCHANGE_GATE 跳过，首次 idle 不写 queue） |
| T4.2 | 发 "tell me about recursion" → 等 session.idle | queue 首次写入（count=2 通过 gate），有 1 条 normal，seq=2（或更高，取决于 session 启动时隐式 idle 数量） |
| T4.3 | `/undo` → 等 session.diff | queue 有 1 normal + 1 undo |
| T4.4 | 检查 material 文件 | status=pending，entries=1，background 非空 |
| T4.5 | 再 `/undo` | queue 有 1 normal + 2 undo，material entries=2（追加） |
| T4.6 | 发新消息 "what is 2+2?" | chat.message 注入 `[system]` 文本可见 |
| T4.7 | AI 执行 `/aristotle` | REFLECT.md 检测到 material → 读 UNDO_REFLECT.md → 不走标准流程 |
| T4.8 | Reflector 启动 | material status 变为 processing |
| T4.9 | Reflector 完成 | material status 变为 consumed，aristotle-state.json 新增 undo-trigger 记录 |
| T4.10 | 再 `/undo` | material 被覆盖（status=pending，entries=1，新条目） |

### Live Test 附加检查

| 检查项 | 验证 | 执行方式 |
|--------|------|---------|
| `/aristotle sessions` 列表中出现 undo-trigger 记录 | target_label 包含 "undo" | tmux |
| `/aristotle review N` 能加载 undo 触发的 DRAFT | DRAFT 内容含 undo 分析 | tmux |
| Reflector 失败时通知文本可读（手动模拟失败场景） | 包含重试次数和 material 路径 | tmux |
| Material 文件在 consumed 后大小合理 | 不含冗余数据 | tmux |
| **T3.1.7 processing 状态守卫**: 手动设置 material status=processing → 触发 `/aristotle` → 验证输出 "still running" 提示且无第二个 Reflector 启动（`/aristotle sessions` 无新记录） | UNDO_REFLECT U1 并发保护 | tmux：直接编辑 material JSON → tmux 发送 `/aristotle` → 检查输出和 state file |
| **retry_pending 路由验证**: 手动设置 material status=retry_pending → 触发 `/aristotle` → 验证走了 UNDO_REFLECT 路径而非标准路径（aristotle-state.json 新增 undo-trigger 记录而非 last-session 记录） | REFLECT.md Undo Trigger Detection 运行时行为 | tmux：直接编辑 material JSON → tmux 发送 `/aristotle` → 检查 state file |
| **T3.3.7 Reflector 集成验证**: 手动设置 material status=pending → 触发 `/aristotle` → 等 Reflector 完成 → 验证 aristotle-state.json 中出现 status='draft'、rules_count > 0、target_label 包含 'undo' 的记录 | Reflector prompt 引导有效，DRAFT 质量可接受 | tmux：直接编辑 material JSON → tmux 发送 `/aristotle` → 等 R 完成 → 检查 state file |

---

## 6. 覆盖度评估

### 按技术方案章节

| 章节 | 覆盖率 | 用例数 |
|------|--------|--------|
| §0 数据文件生命周期 | 100% | 9 |
| §1.3 数据结构 | 100% | 6 |
| §1.4 函数 I/O | 100% | 8 |
| §1.5 session.idle | 100% | 14 |
| §1.6 session.diff | 100% | 15 |
| §1.7 chat.message | 100% | 11 |
| §1.7 buildMaterial | 100% | 10 |
| §2 UNDO_REFLECT.md | 100% | 12 |
| §3 REFLECT.md 改动 | 100% | 4 |
| §4 REFLECTOR.md 不变 | 100% | 2 |
| §5-8 文档改动 | 100% | 6 |
| §10 边界情况 | 100% | 8 |
| §11 重试机制 | 100% | 6 |
| §1.9 Plugin 初始化 | 100% | 5 |
| §9 状态机（Live Test） | 100% | 2 |
| §12-14 不改动文件 | 100% | 1 |

### 按优先级

| 优先级 | 用例数 | 占比 |
|--------|--------|------|
| P0（必须） | 82 | 65% |
| P1（应该） | 27 | 21% |
| Live Test（tmux 手动） | 17 | 14% |

---

## 7. 实施建议

### 与技术方案 Phase 对齐

| 技术方案 Phase | 对应测试 |
|----------------|---------|
| Phase 1: Plugin 改造 | 第一层全部（T1.x） |
| Phase 2: 协议文件 | 第二层 T2.1-T2.4 |
| Phase 3: 文档+配置 | 第二层 T2.5-T2.6 |
| Phase 4: 验证 | 第三层全部（T3.x）+ Live Test（T4.x） |

### 单元测试重写要点

现有测试文件 `test/plugin.test.ts`（389 行）基于 v8 的 Snapshot/Evidence 模型，需**完整重写**：

1. 删除所有 `Snapshot` / `Evidence` / `writeSnapshot` / `readSnapshot` / `writeEvidence` 相关测试
2. 删除 `extractText` 独立测试（此函数不变，但应在 handler 测试中隐式验证）
3. 新增 Queue / Material 数据结构和 I/O 测试（§2.1-2.2）
4. 新增 session.idle handler 测试（§2.3，替代旧 snapshot 测试）
5. 新增 session.diff handler 测试（§2.4，替代旧 evidence 测试）
6. 新增 buildMaterial 测试（§2.5）
7. 保留 chat.message 注入测试（§2.6），更新注入文本为方案 C 格式（`[system]` 无 synthetic）

### Mock 策略

```typescript
// ctx.client.session.messages() mock（Bun test 兼容）
const mockMessages = (msgs: MockMessage[]) => {
  const fn = (() => Promise.resolve({
    error: null,
    data: msgs,
  })) as any;
  fn.mockResolvedValue = (val: any) => { fn._resolvedValue = val; };
  return fn;
};

// ctx.directory mock
const mockDir = join(import.meta.dir, ".test-plugin");

// ctx.client mock
const mockCtx = {
  directory: mockDir,
  client: {
    session: {
      messages: mockMessages([...]),
    },
  },
};
```

### test.sh 扩展方式

在 `test.sh` 的 assertions 区域追加：

```bash
# === Undo-Triggered Reflection Tests ===
# (每个 T2.x 断言一行 count_matches 或 file_exists 检查)
```
