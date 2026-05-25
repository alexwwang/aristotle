# Requirements Document v2: Aristotle Auto-Reflection for TDD Pipeline

> **Version**: v2.0 (Enhancement)
> **Status**: Draft - Pending Review
> **Base**: MVP v1.0 + Brainstorm findings
> **Scope**: Core + Configuration + Monitoring + Degradation + Data Lifecycle + Concurrency + Human Override + Versioning

---

## Why Articulation (v2)

MVP v1 已实现核心功能（检测 + 反射 + 提交），但在生产环境中缺少以下关键能力：
1. **无法禁用/配置**：全有或全无，无法渐进式 rollout
2. **无法观测**：不知道系统是否在正常工作
3. **无法降级**：异常时只能崩溃或静默失败
4. **无法人工介入**：误报时只能硬编码绕过

v2 解决这些问题，使系统可运营、可配置、可恢复。

---

## v1 → v2 变更摘要

| 类别 | v1 状态 | v2 新增 | 优先级 |
|------|---------|---------|--------|
| 配置管理 | ❌ 缺失 | ✅ 开关、模式、阈值 | P0 |
| 性能资源 | ❌ 缺失 | ✅ SLA、容量、限流 | P0 |
| 监控告警 | ❌ 缺失 | ✅ 指标、健康检查、日志 | P1 |
| 降级路径 | ⚠️ 部分 | ✅ Queue满、Git不可用、磁盘满 | P1 |
| 数据生命周期 | ❌ 缺失 | ✅ 保留期、轮转、清理 | P1 |
| 并发一致性 | ⚠️ 部分 | ✅ 去重、幂等、隔离 | P1 |
| 人工介入 | ❌ 缺失 | ✅ 覆盖、申诉、豁免、紧急模式 | P2 |
| 版本兼容 | ⚠️ 部分 | ✅ MCP版本、GEAR版本、Schema版本 | P2 |

---

## System Boundaries (v2)

### In Scope (新增)
- **配置管理**：运行时开关、干预模式选择、审查阈值调整
- **监控指标**：干预次数、违规趋势、队列深度、MCP 健康状态
- **降级策略**：队列满时丢弃最旧、Git 不可用时本地 stash、磁盘满时告警
- **数据清理**：队列文件 7 天过期、审查记录 50 条上限、日志 30 天轮转
- **并发控制**：1 秒内重复违规去重、多流水线隔离、文件锁
- **人工覆盖**：紧急模式绕过所有检查、特定规则豁免、误报申诉

### Out of Scope (保留)
- 设计文档错误检测（Phase 1-3 文档质量）
- 代码实现错误检测（逻辑 bug）
- MCP 工具调用错误
- 手动审查自动生成的规则

---

## User Stories (v2 新增)

| # | Priority | User Story |
|---|----------|-----------|
| US-7 | P0 | As a TDD Pipeline operator, I want to disable auto-reflection for specific projects, so that I can roll out gradually |
| US-8 | P0 | As a TDD Pipeline operator, I want to configure intervention mode (sync/async/hybrid), so that I can balance safety and speed |
| US-9 | P1 | As a TDD Pipeline operator, I want to see metrics (violation count, intervention success rate), so that I can monitor LLM behavior |
| US-10 | P1 | As a TDD Pipeline operator, I want alerts when queue is full or MCP is down, so that I can respond to incidents |
| US-11 | P1 | As a TDD Pipeline operator, I want old queue files auto-deleted, so that disk does not fill up |
| US-12 | P2 | As a TDD Pipeline user, I want to force continue when auto-reflection is wrong, so that I am not blocked by false positives |
| US-13 | P2 | As a TDD Pipeline user, I want emergency mode to bypass all checks, so that I can handle production incidents |

---

## Acceptance Criteria (v2 新增)

### 配置管理 (US-7, US-8)

| # | US | AC | Edge Cases |
|---|----|-----|-----------|
| AC-9 | US-7 | Given auto_reflection_enabled=false in config, When violation detected, Then no reflection triggered, no rule written, warning logged | Config missing → default true |
| AC-10 | US-8 | Given intervention_mode=async, When violation detected, Then event logged but LLM not blocked | Mode=sync → block; mode=hybrid → block + async reflect |
| AC-11 | US-8 | Given review_threshold={H: block, M: warn}, When Ralph Loop finds M issue, Then warn only, allow proceed | Threshold missing → default {C: block, H: block, M: warn} |

### 监控告警 (US-9, US-10)

| # | US | AC | Edge Cases |
|---|----|-----|-----------|
| AC-12 | US-9 | Given system running, When /health endpoint called, Then return JSON with queue_depth, mcp_status, last_intervention_timestamp | MCP unavailable → mcp_status=down |
| AC-13 | US-9 | Given 5 violations in 1 minute, When metrics queried, Then violation_rate=5/min | No violations → rate=0 |
| AC-14 | US-10 | Given queue_depth > 1000, When check runs, Then alert emitted (log + optional webhook) | Queue clears → alert resolved |

### 降级路径 (US-10)

| # | US | AC | Edge Cases |
|---|----|-----|-----------|
| AC-15 | US-10 | Given queue full and strategy=drop_oldest, When new event arrives, Then oldest event deleted, new event queued | strategy=block → block pipeline until space |
| AC-16 | US-10 | Given git unavailable, When commit triggered, Then stash to local, retry on next pipeline | Git restored → auto-sync stashed rules |
| AC-17 | US-10 | Given disk full, When queue write attempted, Then alert + drop event + do not crash | Disk cleared → resume normal operation |

### 数据生命周期 (US-11)

| # | US | AC | Edge Cases |
|---|----|-----|-----------|
| AC-18 | US-11 | Given queue file older than 7 days, When cleanup runs, Then file deleted | File accessed recently → keep |
| AC-19 | US-11 | Given review records > 50 entries, When new entry added, Then prune oldest to maintain 50 | Exactly 50 → add new, delete oldest |

### 并发一致性 (v2)

| # | US | AC | Edge Cases |
|---|----|-----|-----------|
| AC-20 | — | Given same violation within 1 second, When second event arrives, Then deduplicated, only one processed | 1.1 seconds later → process as new |
| AC-21 | — | Given event with id=abc already processed, When duplicate id arrives, Then skipped | Id missing → generate from hash |

### 人工介入 (US-12, US-13)

| # | US | AC | Edge Cases |
|---|----|-----|-----------|
| AC-22 | US-12 | Given user requests force_continue with reason, When approved, Then bypass intervention for this action only | No reason → reject request |
| AC-23 | US-13 | Given emergency_mode=true, When any violation detected, Then log only, no block, no reflect | Emergency mode persists until explicitly disabled |

---

## Prerequisites (v2 新增)

8. **Config schema**: `auto_reflection_enabled` (bool), `intervention_mode` (enum), `review_threshold` (dict)  
9. **Metrics endpoint**: `/health` or MCP tool `get_metrics()`  
10. **Alert channel**: Webhook config for critical alerts  
11. **Cleanup scheduler**: Cron-like scheduler for data lifecycle  

---

## Constraints & Assumptions (v2 新增)

- **Assumption**: Config changes require pipeline restart (no hot reload in v2)
- **Assumption**: Alert webhook is fire-and-forget (no retry on webhook failure)
- **Constraint**: Emergency mode requires explicit user action to enable (cannot be triggered by LLM)
- **Constraint**: Force continue requires human approval (cannot be self-approved by LLM)
- **Constraint**: Data cleanup is best-effort (may retain slightly longer than configured)

---

## Migration from v1

1. **Config**: Add `auto_reflection_enabled=true` to maintain v1 behavior
2. **Metrics**: New endpoint, no breaking change
3. **Queue**: Existing files auto-migrated (no format change)
4. **Rules**: Existing rules unaffected

---

*Document created: 2026-05-25*  
*Next step: Phase 1 Design Review (Ralph Loop) for v2*
