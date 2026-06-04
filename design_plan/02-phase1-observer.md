# Phase 1: 基础质量验证（Observer）— §3.1

**Version**: 1.46 | **工期**: 2 周

## Related
- [01-interfaces.md](./01-interfaces.md) — 接口定义（本节的前置依赖）
- [03-phase2-test-gate.md](./03-phase2-test-gate.md) — Phase 2（依赖本节产出）
- [adr.md](./adr.md) — 设计决策（[ADR-005](./adr.md), [ADR-006](./adr.md), [ADR-009](./adr.md), [ADR-011](./adr.md), [ADR-012](./adr.md)）
- [known-issues.md](./known-issues.md) — 已知限制
- [ref/phase1-pseudocode.md](./ref/phase1-pseudocode.md) — 伪代码参考

---

## 目标

增强 Observer 为主动质量守卫：实时捕获 Bash 命令失败、Write 语法错误、超时异常，自动解决已修复的违规，在 Checkpoint 门控处阻止未修复问题。

## 数据流

```
工具调用 → Observer.handle()
  ├─ Path 1: ralph_loop + Task → recordTaskAndScan（Phase 1 重构）
  ├─ Path 2: 无 state → session buffer（不变）
  └─ Path 3: 活跃 pipeline 但非 ralph_loop → no-op（不变）

Observer._handleObservations()（Path 1 内部）:
  1. 扫描 Bash output → COMMAND_FAILED（exit code ≠ 0）
  2. 扫描 Write content → SYNTAX_ERROR_POST_WRITE / FILE_TOO_LARGE_FOR_CHECK
  3. appendAudit(severity='block') 记录违规
  4. Promise.race(_handleObservations, 20ms timeout)
  5. 超时 → OBSERVER_TIMEOUT（≥3次降级为 warn）
  6. auto-resolve（handle() 顶层，Promise.race 外）：
     - Bash 成功 → resolve COMMAND_FAILED
     - Write 成功 → resolve SYNTAX_ERROR_POST_WRITE
     - 任何成功 → resolve OBSERVER_TIMEOUT

Checkpoint.phase_complete:
  1. getUnresolvedViolations(projectId, runId, 'block')
  2. 若有未解决 block → 阻止阶段推进
  3. 若无 → writeState + appendAudit + resolveViolations（标记已解决）
```

## 关键行为

| 行为 | 说明 | 参考 |
|------|------|------|
| 超时保护 | Promise.race 20ms，catch 在 finally clearTimeout | [ADR-005](./adr.md) |
| 超时降级 | 连续 ≥3 次后 severity='warn'，不再阻止推进 | [ADR-009](./adr.md) |
| auto-resolve | 在 Promise.race 外执行，O(1) 索引查找 | [ADR-012](./adr.md) |
| FIFO 淘汰 | 5000 条上限，淘汰延迟到 Checkpoint | [ADR-011](./adr.md) |
| 违规门控 | Checkpoint 检查未解决 block 级违规 | §3.0.2 |
| state 直接修改 | Observer 修改 cache.get() 引用（single-agent only） | [ADR-006](./adr.md) |

## 产出物

| 产出 | 文件 | 说明 |
|------|------|------|
| Observer 增强 | observer.ts | recordTaskAndScan 重构 + auto-resolve + 超时降级 |
| 新增方法 | pipeline-store.ts | getUnresolvedViolations, resolveViolations |
| Schema 扩展 | schema.ts | AuditLogEntry 新增 severity/resolved 等字段 |
| 辅助函数 | rule-config.ts (新) | extractExitCode, quickSyntaxCheck 等 |
| 常量 | constants.ts | OBSERVER_TIMEOUT_MS, MAX_AUDIT_ENTRIES 等 |

## 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | JSON 语法拦截率 | 100% | e2e 测试（10 个无效 JSON） |
| 2 | Bash 失败检出率 | ≥95% | 回归测试（20 个失败命令） |
| 3 | 误拦截率 | ≤5% | e2e 测试（50 合法操作 + ignoreExitCodes/ignoreCommands 白名单） |
| 4 | Interceptor 响应时间 | P99 <5ms | 性能基准测试 |
| 5 | Observer 响应时间 | P99 <20ms | 性能基准测试 |
| 6 | auto-resolve | 后续成功操作 resolve 前次违规 | 单元测试（序列：失败→成功→检查 resolved） |
| 7 | 超时降级 | 连续 3 次超时后 severity='warn' | 单元测试 |
| 8 | 门控阻止 | 存在未解决 block 违规时 phase_complete 失败 | 集成测试 |
| 9 | 审计日志 FIFO | 5000 条上限触发淘汰 | 单元测试 |

> 完整伪代码 → [ref/phase1-pseudocode.md](./ref/phase1-pseudocode.md)
