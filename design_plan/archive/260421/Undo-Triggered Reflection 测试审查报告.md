# Undo-Triggered Reflection 测试方案审查报告

> 日期：2026-04-20
> 审查者：Momus (Plan Critic)
> 审查对象：`Undo-Triggered Reflection 测试方案.md` vs `Undo-Triggered Reflection 技术方案.md`
> 审查方法：逐条对照技术方案的每个需求、行为、边界条件、数据结构字段、状态转换、错误路径和集成点

---

## ERRORS（测试方案与技术方案矛盾）

### E1. T4.1 Live Test 第一轮对话后断言错误

| 字段 | 内容 |
|------|------|
| **测试用例** | T4.1 |
| **测试方案写** | "启动 opencode + plugin，发 'hello' → 等 session.idle → queue 文件存在，有 1 条 normal，msg_index > 0" |
| **技术方案写** | §1.5 lines 262-264: `if (count <= 1) { log("First exchange — skip snapshot"); return; }`。第一次 idle 事件 count=1 → 跳过。第一次 queue 写入只在 count=2（第二次 idle）时发生。 |
| **严重度** | **Medium** — Live Test 是手动的。单独 "hello" 消息触发 count=1 → 跳过，queue 应为空。需要 (a) 一个隐式的会话初始化触发一次 idle，或 (b) 调整步骤编号。T4.2 的 "seq=3（或更高）" 部分预期了这种不确定性，但 T4.1 的断言本身是错误的。 |

### E2. 测试用例计数错误

| 字段 | 内容 |
|------|------|
| **章节** | §0 总览表 + §6 覆盖度评估 |
| **测试方案写** | "总计 103 个测试用例"，Layer 1 = 50，Layer 2 = 26 |
| **实际计数** | T1.1(6) + T1.2(8) + T1.3(11) + T1.4(14) + T1.5(10) + T1.6(9) = **58**（非 50）。T2.1(12) + T2.2(4) + T2.3(2) + T2.4(2) + T2.5(6) + T2.6(1) = **27**（非 26）。T3 = 17，T4 = 10 + 4 附加 = 14。总计 = **116**（非 103）。 |
| **严重度** | **Low** — 外观计数错误，不影响测试质量。 |

---

## OMISSIONS（技术方案需求无测试覆盖）

### O1. §1.5 — `/redo` 消息也重置 `snapshotWritten` flag（未测试）

| 字段 | 内容 |
|------|------|
| **技术方案** | §1.5 lines 256-259: `/undo` 和 `/redo` 路径都执行 `snapshotWritten.set(sessionID, false)` |
| **测试覆盖** | T1.3.3 测试了 `/undo` 跳过 + 重置 flag。T1.3.4 测试了 `/redo` 跳过但**只写了"跳过"**，没有验证 `snapshotWritten` flag 是否也被重置为 false。 |
| **影响** | 如果 `/redo` 不重置 flag，后续的 `session.diff` 可能误检 undo（因为 `snapshotWritten` 仍为 `true`）。 |
| **建议** | T1.3.4 应验证：`/redo` idle 事件后，`snapshotWritten.get(sessionID) === false`。 |
| **严重度** | **High** |

### O2. §1.6 — Material 追加路径的去重逻辑（未测试）

| 字段 | 内容 |
|------|------|
| **技术方案** | §1.6 lines 348-349: `const newEntries = allUndoEntries.filter(e => !existingMaterial.entries.some(me => me.seq === e.seq));` — 过滤掉 seq 已存在于 material 中的条目。 |
| **测试覆盖** | T1.4.8-T1.4.10 测试了追加行为但从未验证去重过滤。没有测试创建 `allUndoEntries` 包含已存在 seq 的场景。 |
| **影响** | 如果去重失败，重复条目会被加入 material，导致 Reflector 重复分析同一个 undo。 |
| **建议** | 创建一个 material 文件含 entry seq=5，然后触发 undo 检测时 queue 包含 undo entry seq=5 → 验证 material.entries.length 不变。 |
| **严重度** | **Medium** |

### O3. §2 U5 — Reflector 启动通知格式（无自动化测试）

| 字段 | 内容 |
|------|------|
| **技术方案** | §2 STEP U5 指定了精确的通知格式：`🦉 Aristotle Reflector launched [undo-trigger, ${N} undo(s)]. task_id: bg_xxxxx \| session_id: ses_xxxxx` |
| **测试覆盖** | 测试方案 §1.2 明确豁免 U5/U6 通知格式的自动化测试。但也没有自动化测试验证关键字段（task_id、session_id）的存在。只有手动 Live Test T4.7-T4.9。 |
| **建议** | 增加集成测试验证 U5 输出包含 `undo-trigger`、`undo(s)`、`task_id:`、`session_id:` 子串（非精确匹配，只验证关键字段存在）。 |
| **严重度** | **Medium** |

### O4. §2 U6 — 失败通知消息（无自动化测试）

| 字段 | 内容 |
|------|------|
| **技术方案** | §2 STEP U6 指定两种失败通知：重试情况 `"Will retry on next activation (attempt ${retry_count}/${max_retries})"` 和最终失败情况 `"failed after ${max_retries} retries. Material saved for manual inspection: ${path}"` |
| **测试覆盖** | T3.1.2-T3.1.6 测试了状态转换但没有验证通知内容。 |
| **建议** | 集成测试验证 U6 输出包含 `retry_count` 和 `material path` 子串。 |
| **严重度** | **Medium** |

### O5. §1.3 — `Queue.version` 字段（未显式验证）

| 字段 | 内容 |
|------|------|
| **技术方案** | §1.3 line 84: `interface Queue { version: 1; session_id: string; entries: QueueEntry[]; }` |
| **测试覆盖** | T1.2.1 测试 write→read 往返但验证点只说"序列化一致性"，没有显式检查 `version=1`。 |
| **建议** | 在 T1.2.1 或 T1.3.5 中增加 `queue.version === 1` 断言。 |
| **严重度** | **Low** |

### O6. §1.6 — Queue `session_id` 一致性（未测试）

| 字段 | 内容 |
|------|------|
| **技术方案** | §1.3 line 85: `Queue.session_id` 标识会话。§1.6 line 310 读取 queue 但没有验证 `queue.session_id` 是否匹配当前会话。 |
| **测试覆盖** | 没有测试验证 queue 文件属于不同 session 时的行为。 |
| **影响** | 旧 session 的 queue 文件可能导致对错误会话数据的 undo 检测。 |
| **建议** | 测试：queue 文件存在 session_id="ses_old"，当前 session 是 "ses_new" → 验证 handler 不使用过期数据。 |
| **严重度** | **Medium** |

### O7. §10.2 — UNDO_REFLECT processing 状态运行时行为（只测了文件内容）

| 字段 | 内容 |
|------|------|
| **技术方案** | §2 U1 line 413: `processing → R 正在运行，不重复启动。输出 "🦉 Aristotle Reflector is still running..." → STOP` |
| **测试覆盖** | T2.1.10 验证了文件内容包含此指令。但没有集成测试验证运行时行为：当 UNDO_REFLECT 在 material status 为 `processing` 时被调用，确实输出了消息且没有启动第二个 Reflector。 |
| **影响** | 这是防止重复 Reflector 启动的主要并发保护。 |
| **建议** | 集成测试：设置 material status 为 `processing`，调用 UNDO_REFLECT 流程 → 验证没有第二次 `task()` 调用，验证输出包含 "still running" 消息。 |
| **严重度** | **Critical** |

### O8. §2 U2 — Reflector prompt 参数完整性（未测试）

| 字段 | 内容 |
|------|------|
| **技术方案** | §2 U2 指定 Reflector prompt 必须包含：`TARGET_SESSION_ID`、`PROJECT_DIRECTORY`、`USER_LANGUAGE`、`FOCUS_HINT: undo`、material 文件路径、以及分析指令。 |
| **测试覆盖** | T2.1.7 只检查 `FOCUS_HINT: undo` 是否存在。T2.1.6 检查 material 路径。但没有测试验证 prompt 包含 `TARGET_SESSION_ID`、`PROJECT_DIRECTORY`、`USER_LANGUAGE` 或分析指令。 |
| **建议** | 静态测试验证 U2 prompt 块包含所有必需参数。 |
| **严重度** | **Medium** |

---

## GAPS（测试方案模糊或不完整）

### G1. T3.3.7 — "至少走到 R3" 不可验证

| 字段 | 内容 |
|------|------|
| **测试用例** | T3.3.7 |
| **问题** | "执行分析（至少走到 R3）" — R3 是 REFLECTOR.md 内部的"5-Why 根因分析"。没有指定如何以编程方式验证"到达 R3"。 |
| **建议** | 定义具体验证方式：如 "Reflector session 输出包含 5-Why 分析文本" 或 "DRAFT 规则生成到 aristotle-state.json 中"。测试应检查可衡量的副作用而非内部步骤。 |
| **严重度** | **Critical** |

### G2. Mock 策略引用 Jest 但项目使用 Bun

| 字段 | 内容 |
|------|------|
| **章节** | §7 Mock 策略 |
| **问题** | 代码显示 `jest.fn().mockResolvedValue(...)` 但 plugin 测试基础设施使用 Bun test，不是 Jest。 |
| **建议** | 替换为 Bun 兼容的 mock。 |
| **严重度** | **Medium** |

### G3. T1.6.x 未区分现有测试 vs 新增测试

| 字段 | 内容 |
|------|------|
| **章节** | §2.6 chat.message handler |
| **问题** | 技术方案 §12.1 说 "现有 5 个测试保留，不变"。但 T1.6 有 9 个测试，没有标记哪 5 个是现有的、哪 4 个是新增的。 |
| **建议** | 标记现有测试（如加 "existing" 标签），明确哪些是 undo-trigger 功能新增的。 |
| **严重度** | **Low** |

### G4. T3.1.x 状态机测试未指定 U6 的 mock 安排

| 字段 | 内容 |
|------|------|
| **章节** | §4.1 Material 状态机完整流转 |
| **问题** | T3.1.1-T3.1.6 描述了状态路径但没有说明如何模拟 "Reflector 成功" vs "Reflector 失败"。U6 由后台任务完成通知触发 — 如何模拟？ |
| **建议** | 描述 `background_output` / Reflector 结果的 mock，或明确这些测试只在 material-file 层面操作（直接操作 status 并验证转换）。 |
| **严重度** | **High** |

---

## REDUNDANCIES（重复或重叠的测试用例）

### R1. T1.4.6 + T1.4.7 + T1.4.11 — Material 创建/覆盖场景

三个测试都测"从零开始写入新 material"。实现路径相同（`buildMaterial()` → `writeMaterial()`）。**判定：非真正冗余** — 测试不同前置条件下的不同分支。保留全部。

### R2. T1.4.8 + T1.4.9 + T1.4.10 — Material 追加场景

三个测试测相同的追加路径，代码路径完全一致。**判定：可合并为 2 个** — 一个测试追加路径，一个验证所有三个 status 触发同一分支。但冗余很小，保留全部也可。

### R3. T1.5.5 + T1.5.6 — buildMaterial 错误处理

测试两种不同的失败模式。**判定：非冗余** — 测试不同代码路径。

---

## COVERAGE VERDICT

### 整体覆盖度：~90%

### Critical 项（实施前必须修复）

| # | 项目 | 类型 | 原因 |
|---|------|------|------|
| **C1** | O7: `processing` 状态阻止重复 Reflector 启动无运行时测试 | 遗漏 | T2.1.10 只验证文件内容，不验证行为。这是主要并发保护。 |
| **C2** | G1: T3.3.7 "至少走到 R3" 不可测量 | 缺陷 | P0 测试没有定义验证方法。必须指定具体断言。 |

### High 项（应该修复）

| # | 项目 | 类型 | 原因 |
|---|------|------|------|
| **H1** | O1: T1.3.4 未验证 `/redo` 重置 `snapshotWritten` flag | 遗漏 | 可能导致 `/redo` → `session.diff` 序列中的误检。 |
| **H2** | O6: 无测试验证不同 session_id 的 queue 文件 | 遗漏 | 多 session 环境可能读到过期数据。 |
| **H3** | G4: 状态机测试缺少 U6 的 mock 安排 | 缺陷 | 开发者不知道如何模拟 Reflector 成功/失败。 |
| **H4** | E1: T4.1 Live Test 第一轮对话后断言错误 | 错误 | Live test 步骤 1 会失败；第一次 idle 总是被跳过。 |

### 按技术方案章节的覆盖度

| 章节 | 覆盖率 | 备注 |
|------|--------|------|
| §0 数据文件生命周期 | 100% | 所有文件角色和生命周期转换已覆盖 |
| §1.3 数据结构 | 95% | Queue.version 未显式断言 |
| §1.4 函数 I/O | 100% | 所有 read/write 函数 + buildMaterial 已覆盖 |
| §1.5 session.idle handler | 98% | 缺少 /redo flag 重置验证 |
| §1.6 session.diff handler | 95% | 缺少去重逻辑测试、session_id 一致性 |
| §1.7 chat.message handler | 100% | 所有 9 个行为已测试 |
| §2 UNDO_REFLECT.md | 85% | 文件内容测试充分；运行时行为（U1 processing guard、U5/U6 通知格式）未自动化 |
| §3 REFLECT.md 改动 | 100% | 所有 4 个行为已测试 |
| §4 REFLECTOR.md 不变 | 100% | 两个验证点已覆盖 |
| §5-8 文档改动 | 100% | 所有文件存在性和内容检查 |
| §9 Material 状态机 | 90% | 所有转换已测试；缺少运行时并发保护测试 |
| §10 边界情况 | 90% | §10.2 processing guard 行为未运行时测试；§10.4 孤儿清理在 P1 |
| §11 重试机制 | 95% | retry_count 边界测试充分；通知格式仅手动 |
| §12-14 元数据/不改动 | 100% | 不改动文件已验证 |

---

## 附加发现：精确改动点（来自 Explore Agent）

| 文件 | 改动位置 | 改动类型 |
|------|---------|---------|
| REFLECT.md | **line 11-12** 之间（空行后、target_session_id 之前） | 插入 Undo Trigger Detection 区块 |
| SKILL.md | **line 3** description 字段末尾 | 追加 undo trigger 描述 |
| SKILL.md | **line 53** 之后（passive trigger 行之后） | 追加 plugin trigger 注释行 |
| ROADMAP.md | **line 40-41** 之间（V1.1c 之后、`---` 分隔符之前） | 插入 V1.1d 区块 |
| README.md | **line 29-30** 之间（Auto-Suggestion 之后、`## Installation` 之前） | 插入 Undo feature bullet |
| .gitignore | 无需改动 | undo 文件在 `.opencode/` 下已被排除 |

### REFLECTOR.md 步骤细节（UNDO_REFLECT.md prompt 引导跳过/简化的部分）

| 步骤 | 行号 | 功能 | UNDO_REFLECT 引导 |
|------|------|------|-------------------|
| R1 | 22-46 | 读 session (`session_read`) | **跳过** — material 文件提供上下文 |
| R2 | 49-69 | 纠错模式扫描 | **简化** — /undo 本身就是错误信号 |
| R3 | 72-98 | 5-Why 根因分析 | 正常执行 |
| R4 | 100-195 | 生成 DRAFT | 正常执行 |
