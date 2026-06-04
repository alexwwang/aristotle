# Phase 2: 测试驱动质量门 — §3.2

**Version**: 1.46 | **工期**: 2 周

## Related
- [01-interfaces.md](./01-interfaces.md) — 接口定义
- [02-phase1-observer.md](./02-phase1-observer.md) — Phase 1（本节前置依赖）
- [adr.md](./adr.md) — 设计决策
- [known-issues.md](./known-issues.md) — 已知限制
- [ref/phase2-pseudocode.md](./ref/phase2-pseudocode.md) — 伪代码参考

---

## 目标

在 Checkpoint 阶段引入测试证据检查：要求 Agent 在推进到业务代码阶段前提交测试运行结果，确保先测试后编码的 TDD 纪律。

## 数据流

```
流程 A — 测试请求触发：
  phase_complete（Phase 4→5 业务代码阶段）
    → appendAudit(event='TEST_RUN_REQUESTED')
    → Reviewer 读取 TEST_EVIDENCE_CHECK 配置
    → 无 TEST_RUN_COMPLETE → 首次 M 级 finding
    → 连续轮次仍无 → M→H 升级

流程 B — 测试结果提交：
  Agent 调用 tdd_checkpoint('TEST_RUN_COMPLETE', { pass, fail, error_summary })
    → CheckpointHandler.handle()
      → validateTransition('TEST_RUN_COMPLETE', ...)
      → appendAudit(event='TEST_RUN_COMPLETE', { pass, fail, error_summary })
      → fail > 0 → Reviewer H 级 finding
      → pass=0 && fail=0 → M 级（疑似配置错误）

降级模式：
  Watchdog 初始化 → 工具注册失败 → DEGRADATION_MODE_ACTIVATED
    → this.degraded = true（实例变量，非 StateStore）
    → 所有检查降级为 warn（不阻止推进）
    → 通过审计事件提供可观测性

RALPH_ROUNDS 安全网：
  MAX_RALPH_ROUNDS=20 超出 → appendAudit(event='RALPH_ROUNDS_EXCEEDED') → 阻止推进
```

## 关键行为

| 行为 | 说明 | 参考 |
|------|------|------|
| TEST_RUN_COMPLETE | 新增 CheckpointEvent，携带 pass/fail/error_summary | §3.0.3 |
| 降级模式 | 工具注册失败时降级，不阻止推进但记录审计 | [ADR-009](./adr.md) |
| RALPH_ROUNDS 安全网 | MAX_RALPH_ROUNDS=20 超出时阻止推进 | §3.0.6 |
| read_audit_log | Phase 2 新增 MCP 工具，读取审计日志 | §3.5 |
| M→H 升级 | TEST_RUN_REQUESTED 后无 COMPLETE，连续轮次升级 severity | §3.2 |

## 产出物

| 产出 | 文件 | 说明 |
|------|------|------|
| CheckpointHandler 扩展 | checkpoint.ts | TEST_RUN_COMPLETE 处理 |
| 降级检测 | observer.ts / watchdog.ts | init-time try/catch |
| read_audit_log MCP | 新工具 | 审计日志读取 |
| 降级状态持久化 | observer.ts | this.degraded 实例变量 + 审计事件 |

## 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 测试请求记录率 | 100%（Phase 5 phase_complete 时自动记录 TEST_RUN_REQUESTED） | e2e 测试 |
| 2 | Reviewer 检出率 | 100%（有 REQUESTED 无 COMPLETE → M 级，连续 → H 级） | 集成测试 |
| 3 | 检出时效 | ≤90 秒 | 集成测试 |
| 4 | 测试证据审计 | TEST_RUN_COMPLETE 写入 pass/fail/error_summary | 单元测试（含边界值：NaN/-1/Infinity/1.5 → error） |
| 5 | 降级行为 | 工具注册失败后 severity='warn' | 单元测试 |
| 6 | MAX_RALPH_ROUNDS | 达到上限写入 RALPH_ROUNDS_EXCEEDED | 单元测试 |
| 7 | read_audit_log | MCP 工具返回审计日志 | 集成测试 |

> 完整伪代码 → [ref/phase2-pseudocode.md](./ref/phase2-pseudocode.md)
