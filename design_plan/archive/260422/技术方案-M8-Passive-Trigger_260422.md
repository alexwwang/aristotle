# 技术方案 M8: Passive Trigger 增强

**日期:** 2026-04-22
**前置文档:** GEAR Phase 2 产品方案_260422.md §五
**范围:** SKILL.md 仅
**不涉及:** MCP 代码变更、测试代码

---

## 一、模块概述

M8 通过增强 SKILL.md 指令实现被动触发——当 AI 检测到 error-correction 模式时，建议用户运行 `/aristotle` 进行反思。不增加任何 MCP 代码。

**方案选择：** 产品方案 §5.4 推荐方案 A（SKILL.md 指令增强），Phase 2 不实现方案 B（结构化 Trigger Signal 文件）。

### 变更统计

| 文件 | 行数 | 性质 |
|------|------|------|
| SKILL.md | +~9 行 | 新增 PASSIVE TRIGGER 段落 |

---

## 二、SKILL.md 变更

### 2.1 新增段落

在 SKILL.md 末尾、在 ≤60 行约束内追加：

```markdown
## PASSIVE TRIGGER
Monitor the conversation for these patterns:
1. You corrected your own output (acknowledged a mistake)
2. User pointed out an error and you agreed
3. You tried an approach, it failed, and you switched approaches

When any pattern is detected, suggest:
"🦉 I detected an error pattern. Run /aristotle to reflect and prevent similar mistakes."
Do NOT auto-trigger. Only suggest.
```

### 2.2 行数预算

当前 SKILL.md 约 39 行。追加 9 行后约 48 行，在 60 行约束内。

### 2.3 设计决策

| 决策 | 理由 |
|------|------|
| 建议而非自动触发 | 避免误触发，用户自主决定是否反思 |
| 不使用 signal 文件 | 减少 I/O 和状态管理复杂度，Phase 3 评估 |
| 不新增 MCP 工具 | 当前 AI 的 pattern detection 能力已足够识别 error-correction 场景 |
| 3 种触发模式覆盖 | 覆盖了 error-correction 的主要场景（自我纠正、用户纠正、方案切换） |
| §5.2 vs §5.3 | §5.2 展示的是 Phase 3 的自动触发目标行为；Phase 2 实现的是 §5.3 的建议触发。技术方案遵循 §5.3 |

---

## 三、验证

| # | 验证项 | 方法 |
|---|--------|------|
| V1 | SKILL.md 总行数 ≤ 60 | test.sh 断言 |
| V2 | SKILL.md 包含 PASSIVE TRIGGER 段落 | test.sh 断言 |
| V3 | SKILL.md 不包含 auto-trigger 指令 | 人工审查 |
