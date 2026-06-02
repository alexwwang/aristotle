# Undo-Triggered Reflection 测试方案盲区分析

> 日期：2026-04-20（v2 — 产品设计决策已确认，技术方案和测试方案已更新）
> 前置文档：`Undo-Triggered Reflection 测试方案.md`（v3，126 用例）
> 审查报告：`Undo-Triggered Reflection 测试审查报告.md`（Momus 审查，已全部修复）
>
> 本文档记录审查报告修复后仍存在的测试盲区，按性质分类。
> **产品设计缺口（#1, #5, #12）已通过用户确认决策，更新到技术方案 §1.9 和 §10.4。**

---

## 总体评估

审查报告标记的 2 Critical + 4 High + 7 Medium 已全部修复，覆盖率从 ~90% 提升到 ~95%。剩余 13 个盲区中，3 个产品设计缺口已确认解决方案并更新到技术方案和测试方案。剩余 10 个为测试深度问题。

---

## 一、技术方案有明确定义但测试完全缺失

### 1. §1.8 旧文件迁移/忽略行为 ✅ 已决策

**决策**：不迁移、不删除。新 Plugin 使用不同文件名和读取函数，自然忽略旧文件。技术方案 §1.8 已补充说明。

**技术方案** §1.8 定义了旧文件 → 新文件的路径变更：
- `.opencode/aristotle-undo-snapshot.json` → `.opencode/aristotle-undo-queue.json`
- `.opencode/aristotle-undo-evidence.json` → `.opencode/aristotle-undo-material.json`

**盲区**：没有测试验证 Plugin 改造后旧文件残留的处理。用户从 v8 plugin 升级时，磁盘上可能有旧 snapshot/evidence 文件。新 plugin 的函数名和常量都换了（`readQueue` 不再读 snapshot），旧文件会被自然忽略——但技术方案没有显式说明这个行为，测试也没有覆盖。

**影响**：升级场景下旧文件残留，不会导致功能错误（被忽略），但可能造成磁盘空间浪费或用户困惑。

**建议**：在技术方案中明确写一句"旧文件不迁移，新 plugin 自然忽略"，或在 Plugin 启动时加一行清理旧文件的逻辑（此时需加测试）。

**严重度**：Medium

### 2. §1.6 `result.data` 为 null 但无 error

**技术方案** buildMaterial 代码（§1.4 line 185-196）：
```typescript
if (result.data) {
  // 正常处理
} else {
  contextIncomplete = true;
}
```

**盲区**：T1.5.5 测试了 `session.messages()` 抛异常，T1.5.6 测试了 `result.error` 非空。但没有测试 `result.error === null && result.data === null` 的情况——API 返回成功但 data 为空。这是 OpenCode SDK 的一个合法返回状态（如 session 被删除或 ID 无效）。

**建议**：补充测试用例 T1.5.11："session.messages() 返回 `{ error: null, data: null }` → context_incomplete=true"。

**严重度**：Low

### 3. §2 U2 prompt 中 `USER_LANGUAGE` 实际传递

**盲区**：T2.1.7 验证了 prompt 文本包含 `USER_LANGUAGE` 字符串，但没有验证这个值是否正确传递了用户的语言偏好。REFLECT.md F1 说"Detect from user's messages (zh-CN / en-US)"——语言检测逻辑本身没有测试。

**影响**：如果语言检测错误，Reflector 的 DRAFT 输出语言可能不匹配用户期望。

**建议**：这是现有 REFLECT.md 的通用问题，非 undo 特有。可在全局测试中覆盖，不在 undo 测试 scope 内。记录为已知局限。

**严重度**：Low

### 4. retry_pending → AI 触发路由的运行时验证 ✅ 已决策

**决策**：降级为 Live Test（tmux 执行）。手动设置 material status=retry_pending → 触发 `/aristotle` → 验证 aristotle-state.json 新增 undo-trigger 记录（非 last-session 记录）。不做自动化集成测试。

**技术方案** §9 状态机图 + §3 REFLECT.md 改动：retry_pending 状态下，下次 AI 触发时 REFLECT.md 的 Undo Trigger Detection 应重新路由到 UNDO_REFLECT。

**盲区**：T2.2.2 验证了 REFLECT.md 文件内容包含路由指令（pending/retry_pending → 读 UNDO_REFLECT.md）。T3.1.2 验证了 material 文件层面的状态流转（retry_pending → processing）。但两者之间存在**运行时行为间隙**——没有集成测试验证"REFLECT.md 在执行时检测到 retry_pending → 实际加载了 UNDO_REFLECT.md → 实际启动了 Reflector"这条完整链路。

**影响**：如果 REFLECT.md 的条件判断写错了（如只检查 pending 不检查 retry_pending），重试流程会静默失败。

**建议**：补充集成测试：设置 material status=retry_pending → 模拟 /aristotle 触发 → 验证走了 UNDO_REFLECT 路径而非标准路径。

**严重度**：Medium

### 5. §10.4 孤儿清理的触发时机 ✅ 已决策

**决策**：不清理孤儿。改为启动时检测 + 首次 chat.message 提醒用户运行 `/aristotle`。material 数据完整，反思流程可完成。技术方案 §10.4 已更新。

**技术方案** §10.4："Material 文件 > 24 小时且 status=pending → Plugin 启动时清理"。

**盲区**：T3.3.1-T3.3.2 测试了 24h 条件判断，但没验证"Plugin 启动时"这个触发点。清理逻辑是在 `server()` 函数初始化时执行的？还是在某个 handler 的特定条件下？如果放在 `server()` 入口，需要一个测试在 Plugin 加载时验证清理执行。

**影响**：如果清理逻辑缺失或触发时机不对，孤儿文件会一直残留。

**建议**：技术方案应明确定义清理逻辑的触发位置。然后在 Plugin 启动测试中覆盖。

**严重度**：Medium

### 6. §11 `retry_count` 归零场景

**技术方案** §11 提到 `/aristotle retry`（V1.1e）会将 `retry_count` 归零、`status` 改回 `retry_pending`。

**盲区**：虽然 V1.1e 不在本次 scope，但测试方案没有在任何地方记录这个**未来集成点需要补充的测试**。

**建议**：在测试方案的未来工作章节加一行："V1.1e `/aristotle retry` 实现后需补充：retry_count 归零、status 改回 retry_pending、重新启动 Reflector 的测试"。

**严重度**：Low

---

## 二、测试存在但验证深度不足

### 7. T1.5.2 背景消息排序

**当前**：T1.5.2 验证"背景取最后 10 条消息"，但只验证数量，没验证排序。

**技术方案** 代码：`const recent = result.data.slice(-10);` — 取最后 10 条。如果 session 返回的消息不是按时间排序的（防御性考虑），`slice(-10)` 可能取到错误的消息。

**建议**：T1.5.2 补充验证：background 中的消息顺序与 session.messages() 返回的最后 10 条一致。

**严重度**：Low

### 8. T3.3.7 DRAFT 内容质量

**当前**：只验证 `aristotle-state.json` 中存在 status='draft' 的记录。

**未验证**：
- DRAFT 的 `target_label` 是否包含 'undo'
- DRAFT 的 `rules_count` 是否 > 0（Reflector 是否分析出了规则）
- Reflector 的 prompt 引导（跳过 R1、简化 R2）是否真的生效

**建议**：T3.3.7 补充断言：rules_count > 0、target_label 包含 'undo'。但验证"R1 被跳过"需要在 Reflector session 的输出中检查，成本较高。可作为 Live Test 附加检查项。

**严重度**：Low

### 9. T3.1.7 mock 层级矛盾 ✅ 已决策

**决策**：T3.1.7 从第三层自动化测试中移除，降级为 Live Test（tmux 执行）。手动设置 material status=processing → 触发 `/aristotle` → 验证输出 "still running" 且无第二个 Reflector 启动。自动化层面保留 T2.1.10（静态验证 UNDO_REFLECT.md 文件内容）覆盖。

**当前描述**："material status=processing 时，调用 UNDO_REFLECT 流程 → 验证无第二次 task() 调用"。

**矛盾**：§4.1 Mock 安排明确说状态机测试在 material-file 层面操作，"不需要 mock background_output 或 task() 调用"。但 T3.1.7 要验证"无第二次 task() 调用"，这需要 mock `task()`——与 mock 策略矛盾。

**建议**：T3.1.7 拆分为两部分：
- 材料层测试（当前 mock 策略）：验证 processing 状态下 material 文件不被修改
- 协议层测试（需要 mock task()）：验证 UNDO_REFLECT 协议执行时不调用 task()

或者改为纯集成测试（在 Live Test 中手动验证）。

**严重度**：Medium

### 10. T2.6.1 行数匹配不够健壮

**当前**：验证文件行数与改动前一致。

**问题**：等量增删（加一行注释、删一行空行）不会改变行数但会改变内容。

**建议**：对关键文件（REFLECTOR.md）改用内容校验：验证包含关键段落（如 "STEP R1"、"STEP R2"、"STEP R3"、"STEP R4"）且不包含 "undo" 字样。行数作为辅助参考。

**严重度**：Low

---

## 三、设计层面（技术方案本身也没定义清楚）

### 11. 24h 比较逻辑的边界条件 ✅ 已失效

**原盲区**：§10.4 说 "> 24 小时"但未定义比较逻辑细节。

**已失效**：§10.4 已从"孤儿清理"改为"启动检测+通知"，不再涉及 24h 比较。此项无需处理。

**技术方案** §10.4 说 "> 24 小时"，但未定义：
- 时区处理（`created_at` 是 ISO 8601 含时区 vs UTC？）
- 比较精度（秒级？毫秒级？）
- 时钟回拨防护

T3.3.1-T3.3.2 只说 "> 24h"，没有验证比较逻辑的实现细节。

**建议**：技术方案补充定义比较方式（建议：`Date.now() - new Date(created_at).getTime() > 86400000`），测试方案补充边界条件（刚好 24h、23h59m、跨 DST）。

**严重度**：Low

### 12. Plugin 启动初始化行为 ✅ 已决策

**决策**：启动时检查 material 文件是否有未处理任务（pending/processing/retry_pending），有则设 pendingNotification flag，首次 chat.message 注入提示。不修改文件、不清理。技术方案 §1.9 已新增。

**技术方案** 未明确定义 Plugin `server()` 函数启动时应做什么初始化：
- 是否清理孤儿 material 文件？
- 是否验证 queue 文件格式版本？
- 是否处理从旧版 plugin 升级的数据迁移？

测试方案也没有覆盖 Plugin 启动阶段。

**建议**：技术方案补充 §1.9 "Plugin 初始化" 章节，明确启动行为，然后补充测试。

**严重度**：Low

### 13. 跨项目 material 隔离

**技术方案** `Material.project_directory` 标识项目。

**未讨论**：如果用户同时在两个不同项目目录下运行 OpenCode（各自独立 Plugin 进程），material 文件路径是 `${projectDir}/.opencode/` 下的，天然隔离。但如果 OpenCode 的 Plugin 进程是共享的（单一进程服务多项目），material 文件可能混淆。

**当前判断**：OpenCode Plugin 按 `ctx.directory` 区分项目，文件写入项目目录下的 `.opencode/`，天然隔离。但这个假设没有被显式测试。

**建议**：补充测试 T1.4.17：两个不同 ctx.directory 的 Plugin 实例各自写 queue/material，互不干扰。

**严重度**：Low

---

## 建议优先级

| 优先级 | 项目 | 状态 |
|--------|------|------|
| **已确认** | #1 旧文件迁移 | 技术方案 §1.8 已补充 |
| **已确认** | #5 孤儿清理 → 改为启动通知 | 技术方案 §1.9 + §10.4 已更新 |
| **已确认** | #12 Plugin 启动初始化 | 技术方案 §1.9 已新增 |
| **已确认** | #4 retry_pending 路由 | 降级为 Live Test（tmux） |
| **已确认** | #9 T3.1.7 mock 矛盾 | 降级为 Live Test（tmux） |
| **可延后** | #2, #3, #6, #7, #8, #10, #11, #13 | 验证深度 / Low 优先级 |

---

## UPDATE 1 — 产品设计决策确认（2026-04-20）

> 本轮通过 Oracle 产品设计分析 + 用户确认，解决了 13 个盲区中的 6 项。

### 决策记录

#### #1 旧文件迁移 → 不处理

- **决策**：不迁移、不删除旧 snapshot/evidence 文件。新 Plugin 使用不同文件名和读取函数，自然忽略。
- **理由**：零代码改动、零风险、零功能影响。用户可手动删除。
- **落地**：技术方案 §1.8 补充说明。

#### #5 孤儿清理 → 改为启动通知

- **原方案**：Plugin 启动时删除 > 24h 的 pending/processing material 文件。
- **问题**：material 文件包含完整的反思数据（background + user_message + assistant_message），清理会丢失不可恢复的分析材料。
- **决策**：不清理。改为 Plugin 启动时检测 pending/processing/retry_pending 状态，设 `pendingNotification` flag，首次 chat.message 注入提示："Aristotle has pending undo reflection task(s). Run /aristotle to process them."
- **理由**：数据保留，用户自主决定是否处理。`/aristotle` 已能通过 UNDO_REFLECT U1 自动检出 pending/retry_pending 并走反思流程。
- **落地**：技术方案 §1.9 新增、§10.4 重写。测试方案新增 T1.3.12-14、T1.6.10-11、T3.3.1-2 改为验证不清理。

#### #12 Plugin 启动初始化 → 仅检测+通知

- **决策**：`server()` 启动时仅做 material 文件状态检测 + pendingNotification flag 设置。不验证版本（`readQueue` 自然容错）、不迁移旧文件（见 #1）、不清理孤儿（见 #5）。
- **落地**：技术方案 §1.9 新增。

#### #4 retry_pending 路由运行时验证 → Live Test

- **问题**：无集成测试验证 "REFLECT.md 检测到 retry_pending → 加载 UNDO_REFLECT.md → 启动 Reflector" 完整链路。
- **决策**：降级为 Live Test（tmux）。手动设置 material status=retry_pending → 触发 `/aristotle` → 验证 aristotle-state.json 新增 undo-trigger 记录。
- **理由**：自动化集成测试需要 mock AI 协议执行环境，成本与收益不匹配。

#### #9 T3.1.7 mock 层级矛盾 → Live Test

- **问题**：T3.1.7 要"验证无第二次 task() 调用"，但 mock 策略不 mock task()。验证 material 文件不修改与功能点（UNDO_REFLECT U1 不启动第二个 Reflector）脱节。
- **决策**：T3.1.7 从第三层自动化测试中移除，降级为 Live Test（tmux）。手动设置 material status=processing → 触发 `/aristotle` → 验证输出 "still running" 且无第二个 Reflector 启动。
- **理由**：该行为发生在 UNDO_REFLECT 协议层（AI 读取协议并执行），不是 Plugin 层。自动化层面保留 T2.1.10（静态验证文件内容）覆盖。
- **落地**：测试方案 T3.1.7 移除，Live Test 附加检查新增对应项。

#### #11 24h 比较逻辑 → 已失效

- **原盲区**：§10.4 "Material > 24h → 清理"未定义比较逻辑细节。
- **失效原因**：§10.4 已从"孤儿清理"改为"启动检测+通知"，不再涉及 24h 时间比较。此项无需处理。

### 未决项（7 项，均为 Low）

| # | 盲区 | 性质 | 建议处理 |
|---|------|------|---------|
| #2 | `result.data` 为 null 无 error | 测试缺失 | 补充 T1.5.11 |
| #3 | `USER_LANGUAGE` 传递 | 非 undo scope | 标记已知局限 |
| #6 | `retry_count` 归零 | V1.1e scope | 测试方案加未来工作注释 |
| #7 | 背景消息排序 | 验证深度 | T1.5.2 补充断言 |
| #8 | DRAFT 内容质量 | 验证深度 | T3.3.7 补充断言或 Live Test |
| #10 | 行数匹配健壮性 | 验证方式 | 改用内容校验 |
| #13 | 跨项目隔离 | 假设未验证 | 补充 T1.4.17 |

### 文档变更汇总

| 文档 | 变更 |
|------|------|
| 技术方案 §1.8 | +旧文件处理说明 |
| 技术方案 §1.9 | +Plugin 初始化（pendingNotification + 首次通知） |
| 技术方案 §10.4 | 重写：孤儿清理 → 启动检测+通知 |
| 测试方案 | +5 用例（T1.3.12-14, T1.6.10-11），T3.1.7 降级 Live Test，+2 Live Test 项；总计 127 |
| 盲区分析 | 原文保留，本 UPDATE 追加 |
| 审查报告 | 不变（记录原始审查发现） |
