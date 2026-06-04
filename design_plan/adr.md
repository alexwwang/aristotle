# Architecture Decision Records — Aristotle QA

**Source**: quality-assurance-implementation-plan.md v1.46
**Total decisions**: 17

---

## ADR-001: Phase 1 target 状态而非当前状态

- **Section**: s3.0 (L125)
- **Context**: 技术方案描述的是实施目标状态，不是当前代码库状态。当前代码仅含基础架构。
- **Decision**: Phase 1 target 状态而非当前状态
- **Rationale**: 避免实施者混淆已实现和未实现的部分

## ADR-002: severity 字段仅 Observer 条目携带

- **Section**: s3.0 (L141)
- **Context**: 现有 PROMPT_INJECTION_DETECTED 条目不携带 severity；Phase 1 不补全（design choice）
- **Decision**: severity 字段仅 Observer 条目携带
- **Rationale**: 非 Observer 门控条目，不影响 phase_complete 门控。补全需回填历史数据，成本高收益低

## ADR-003: runId/projectId 冗余保留

- **Section**: s3.0 (L163)
- **Context**: appendAudit 3-param 签名 (projectId, runId, entry) 中 entry 也含 runId/projectId，存在冗余
- **Decision**: runId/projectId 冗余保留
- **Rationale**: 保留冗余以兼容现有代码。Phase 4 可考虑从 entry 移除（breaking change）

## ADR-004: timestamp 作为条目定位键

- **Section**: s3.0 (L268)
- **Context**: resolveViolations 使用 ISO 8601 timestamp 字符串数组定位条目
- **Decision**: timestamp 作为条目定位键
- **Rationale**: 同一毫秒内两条目可能误标记，但 JS 单线程下概率极低。Phase 4+ 可加自增 sequenceId

## ADR-005: appendAudit 保持同步（void 返回）

- **Section**: s3.0 (L234)
- **Context**: Phase 1 保持 appendAudit 同步，移除 observer.ts 中多余的 await
- **Decision**: appendAudit 保持同步（void 返回）
- **Rationale**: 若 Phase 2 改为 async，需重新评估 Observer 20ms 超时保护。同步调用不消耗超时预算

## ADR-006: Observer 内存 state 直接修改（非显式 writeState）

- **Section**: s3.1 (L283)
- **Context**: Observer handle() 直接修改 cache.get() 返回的 state 对象，不调 writeState
- **Decision**: Observer 内存 state 直接修改（非显式 writeState）
- **Rationale**: 变更通过下一次 Checkpoint writeState 持久化。前提：cache 返回同一引用（single-agent only）

## ADR-007: Single-agent only

- **Section**: s3.1 (L283)
- **Context**: Phase 1 仅支持 single-agent 模式。multi-agent 下 cache.get() 返回新对象，Observer 修改无效
- **Decision**: Single-agent only
- **Rationale**: multi-agent 需改为显式 writeState 或 Checkpoint 事件触发更新

## ADR-008: 崩溃恢复 = run-restart（非 run-resume）

- **Section**: s3.0 (审计日志管理)
- **Context**: Phase 2 假设崩溃后 run-restart，不支持从崩溃点恢复 run
- **Decision**: 崩溃恢复 = run-restart（非 run-resume）
- **Rationale**: 避免 stale counter 问题。新 pipeline_start 重置 auditEntryCount=0

## ADR-009: OBSERVER_TIMEOUT 降级阈值 ≥3

- **Section**: s3.1 (L1571)
- **Context**: 连续 ≥3 次超时后 severity 降级为 warn，不再阻止推进
- **Decision**: OBSERVER_TIMEOUT 降级阈值 ≥3
- **Rationale**: 防止瞬时负载导致永久阻塞。计数器在 phase_complete 时重置

## ADR-010: 5000 条审计上限 vs 10MB 轮转

- **Section**: s3.0 (审计日志管理)
- **Context**: 5000 条是条目数上限（appendAudit 前检查），10MB 是单个 audit key 大小上限
- **Decision**: 5000 条审计上限 vs 10MB 轮转
- **Rationale**: 两者独立生效，先到先触发。典型场景 5000 条先触发（约 2-5MB）

## ADR-011: FIFO 淘汰延迟到 Checkpoint 执行

- **Section**: s3.0 (审计日志管理)
- **Context**: appendAudit 仅设置 evictionNeeded 标记，实际淘汰延迟到 phase_complete
- **Decision**: FIFO 淘汰延迟到 Checkpoint 执行
- **Rationale**: 避免与 Observer 20ms 时间限制冲突。Checkpoint 已有 I/O 预算

## ADR-012: auto-resolve 运行在 Promise.race 外

- **Section**: s3.1 (L548)
- **Context**: auto-resolve 在 handle() 顶层执行，不在 Promise.race 超时保护内
- **Decision**: auto-resolve 运行在 Promise.race 外
- **Rationale**: getUnresolvedViolations O(1) + resolveViolations 同步，不消耗 20ms 预算

## ADR-013: resolve_timeout I/O 在 writeState 之前

- **Section**: s3.0 (L196)
- **Context**: resolve_timeout 执行顺序：applyTransition → I/O (resolveViolations) → writeState
- **Decision**: resolve_timeout I/O 在 writeState 之前
- **Rationale**: 与标准 applyTransition→writeState→appendAudit 不同。I/O 需基于当前 state，先执行再持久化

## ADR-014: Exit code fallback = 1（fail-safe）

- **Section**: s3.0 (L344)
- **Context**: 未知退出状态统一返回 1（标记为失败），而非 0
- **Decision**: Exit code fallback = 1（fail-safe）
- **Rationale**: 确保未知退出状态被标记为失败。上线后误报过多可切为 fallback=0（fail-open）

## ADR-015: JSON-RPC fallback 不可用

- **Section**: s3.4 (L1500)
- **Context**: AC-4 降级方案标注 JSON-RPC pipe 不可用（MCP stdio 需 initialize 握手）
- **Decision**: JSON-RPC fallback 不可用
- **Rationale**: 仅保留 Python 直接导入作为验证手段。AC 断言依赖内部 API _tool_manager._tools

## ADR-016: CommitGuard 不定义 validate_schema

- **Section**: s3.4 (L9)
- **Context**: schema 校验逻辑来自 AutoCommitter (committer.py)，CommitGuard 仅调用
- **Decision**: CommitGuard 不定义 validate_schema
- **Rationale**: CommitGuard 职责是 ensure_committed，不混入校验逻辑

## ADR-017: @single-project 约束

- **Section**: s3.0 (L404)
- **Context**: Watchdog 运行在单项目上下文（一个 OpenCode 实例 = 一个项目）
- **Decision**: @single-project 约束
- **Rationale**: 多项目需缓存改 Map<projectId, RulesFile>。Phase 1 不支持
