# Phase 3: 语义审查扩展（待定）— §3.3

**Version**: 1.46 | **状态**: 待定 — 非 P1/P2/P4 范围

## Related
- [01-interfaces.md](./01-interfaces.md) — 接口定义
- [adr.md](./adr.md) — 设计决策
- [known-issues.md](./known-issues.md) — 已知限制
- [ref/phase3-pseudocode.md](./ref/phase3-pseudocode.md) — 伪代码参考

---

## 状态说明

Phase 3 标记为**待定**，不在当期实施。理由：
1. 现有 C/H/M 已能覆盖 S/B/A 场景（API 幻觉→H，需求不符→M/H，过度设计→L/I）
2. Schema v5 迁移涉及 25+ 处核心文件改动，无上游协议变更驱动
3. 当期核心目标是打通基本质量闭环（Phase 1→2→4）

**保留部分**：审查维度（语义正确性、业务逻辑一致性、上下文适配性）作为 Reviewer prompt 指导，用现有 C/H/M severity 标注。

**重新激活条件**：现有 C/H/M 无法表达的质量问题 + 明确用户场景驱动 → 作为独立 Phase 需求文档重新论证。

## 目标（待激活）

让 Reviewer subagent 不仅检查代码质量，还检查语义正确性、业务逻辑一致性。

## 范围概要

| 组件 | 说明 |
|------|------|
| 调度机制 | Ralph Loop Reviewer round 内派发，新增 REVIEWER_SPAWNED 审计事件 |
| Severity 扩展 | Schema v5: counts 新增 S(safety)/B(business)/A(architecture) → C/H/M/P/L/I/S/B/A |
| 审查维度 | 语义正确性、业务逻辑一致性、上下文适配性 |
| 重试与熔断 | 同一 finding 连续 2 轮未解决 → 升级 severity |

> 完整伪代码 → [ref/phase3-pseudocode.md](./ref/phase3-pseudocode.md)
