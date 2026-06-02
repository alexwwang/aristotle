# Undo-Triggered Reflection — 进展记录

> 日期：2026-04-19
> 分支：`undo-track`

## 已完成

### 1. Demo 插件验证通过

**文件**：`plugins/aristotle-undo/src/index.ts`（153 行）

插件作为独立 OpenCode plugin 运行，零 OMO 依赖。通过 8 轮 live testing（tmux 驱动真实 OpenCode 实例）逐步排除了所有直觉上可行的方案，最终找到可行路径。

**检测机制**：`session.idle` 写快照时设 flag → `session.diff` 消费 flag → flag 未设置 = `/undo` 发生 → 写 evidence 文件。

**验证结果**：

| 步骤 | 结果 |
|------|------|
| Plugin 加载 | ✅ |
| 第一轮跳过 | ✅ |
| 第二轮快照保存 | ✅ `Snapshot #2: user=48 asst=52` |
| `/undo` 检测 | ✅ `🔴 session.diff WITHOUT recent snapshot — undo detected!` |
| Evidence 文件 | ✅ `event=undo.detected`，完整 user + assistant 上下文 |

**单元测试**：16 tests, 24 assertions, 全部通过。

### 2. 设计文档

- `design_plan/Undo-Triggered Reflection 实现方案.md` — 完整的事件系统实测结论、7 个失败方案、最终可行方案的状态机设计、代码架构

### 3. 工程配置

- `.opencode/opencode.json` — 项目级 plugin 注册
- `.gitignore` — 排除 `node_modules/`、`bun.lock`、evidence 文件
- `plugins/aristotle-undo/.gitignore` — 插件本地保护
- 已提交到 `undo-track` 分支（commit `f139263`）

---

## 待完成：Aristotle 集成设计

插件能检测 `/undo` 并保存上下文，但还没有接入 Aristotle 的反思流程。以下是需要决策和设计的关键问题。

### 问题 1：谁来触发反思？

Evidence 文件写好后，如何启动 Aristotle 反思？

| 选项 | 说明 | 利弊 |
|------|------|------|
| **A. 插件自调 MCP** | 插件直接调 `write_rule` | ❌ 插件是 event handler，没有 LLM 做分析 |
| **B. Skill 启动时扫描** | 下次用户输入时 SKILL.md 检测 evidence 文件 → 自动触发 | ✅ 复用现有架构，用户无感；❌ 依赖下一次用户交互 |
| **C. 插件调 `task()`** | 插件写 evidence 后直接启动 Reflector | ✅ 即时；❌ 绕过 Coordinator，状态追踪不完整 |

### 问题 2：Reflector 输入源

当前 Reflector 依赖 `session_read()` 读会话内容。`/undo` 后会话已被撤销，输入源变成 evidence 文件。

- 需要给 Reflector 增加 `R0` 阶段（从 evidence 文件读取上下文）
- 或新建专门的 Undo Reflector 协议
- evidence 文件包含完整 user + assistant 对话 + parts，信息量足够做 5-Why 分析

### 问题 3：协议文件改动范围

| 文件 | 改动内容 |
|------|----------|
| `SKILL.md` | 加 `undo` 触发路由（如 `/aristotle undo` 或被动扫描） |
| `REFLECT.md` | 加 `P3.4 Undo Trigger` 阶段（读取 evidence → 启动 Reflector） |
| `REFLECTOR.md` | 加 `R0` evidence 文件分析（作为 session_read 的替代输入源） |
| `ROADMAP.md` | 记录此功能为 V1.1d |

### 问题 4：用户体验

- `/undo` 后是**自动**触发反思，还是需要用户手动 `/aristotle undo`？
- 反思结果如何通知用户？（Reflector 在后台跑，用户已切到新对话）
- 如果用户连续 undo 多次，是否每轮都触发反思？

---

## 下一步

1. 确认上述 4 个问题的决策
2. 撰写集成设计方案（具体的协议改动 diff）
3. 实施改动
4. 端到端测试：`/undo` → evidence → 反思 → DRAFT → 规则
