# Phase 4: Intervention 合并到 aristotle_mcp — §3.4

**Version**: 1.46 | **工期**: 2 周

## Related
- [01-interfaces.md](./01-interfaces.md) — 接口定义
- [adr.md](./adr.md) — 设计决策
- [known-issues.md](./known-issues.md) — 已知限制

---

## 目标

将 intervention 包功能合并到 aristotle_mcp，消除独立 intervention 模块，统一为单一 MCP 服务。

## 合并范围

### 保留（迁移到 aristotle_mcp）

| 模块 | 迁移内容 | 说明 |
|------|---------|------|
| RollbackEngine | 2 个通用处理器 | 合并后仅通用 `git reset --hard`，**不保留** violation-specific 策略（_delete_implementation/_restore_test）。精确回滚由 Watchdog TS 侧组合调用实现 |
| KiDocManager | 4 个公开方法 | 原样迁移 |
| CommitGuard | ensure_committed | schema 校验来自 AutoCommitter |

### 迁移到 Ralph Loop

| 模块 | 迁移内容 | 说明 |
|------|---------|------|
| PromptValidator | bilingual forbidden patterns | 作为 Reviewer prompt 的一部分，**非** aristotle_mcp 迁移 |

### 新增（非 intervention 来源）

| 工具 | 说明 |
|------|------|
| cleanup_rollback_stashes | Phase 4 新增工具 |

### 删除（migrate-then-delete）

| 文件 | 说明 |
|------|------|
| rollback_engine.py | 迁移后删除 |
| ki_doc_manager.py | 迁移后删除 |
| committer.py | validate_schema 内联到 commit_rule |
| prompt_validator.py | 迁移到 Ralph Loop 后删除 |
| violation_filter.py | 冗余，Interceptor 已覆盖 |
| intervention_coordinator.py | 冗余，流程已由 Ralph Loop 接管 |
| reflector.py | 被 Ralph Loop Reviewer 替代 |
| rule_generator.py | 与 write_rule 重叠 |
| intervention_types.py | 类型定义迁移到 aristotle_mcp types |
| __init__.py | 模块入口，删除 |

### MCP 工具清单（合并后 25 个）
现有 20 + 新增 5：**create_rollback_point, rollback_to_checkpoint, write_ki_doc, read_ki_docs, cleanup_rollback_stashes**

## 关键约束

| 约束 | 说明 |
|------|------|
| Git 回滚安全 | 仅计 `aristotle-rollback:` 前缀 stash；stash 失败阻止 rollback；untracked >100MB 返回警告；warning≥5 告警，hard≥10 阻止 |
| PipelineState 一致性 | rollback_to_checkpoint 返回 pipeline_reset_required=true → Watchdog 自动调用 tdd_checkpoint('pipeline_reset')；fallback：MCP handler 直接触发；最终兜底：下次 pipeline_start 重置 |
| 双审计日志 | aristotle_mcp 写 `.aristotle/audit.jsonl`（McpAuditEntry），Watchdog 写现有审计日志，通过 runId 关联。append-only JSONL，4KB/行限，500 字符截断，init_repo 时加 .gitignore |
| commit_rule 行为变更 | 合并后增加守卫检查：staging 状态 + frontmatter schema 校验。skip_guard 参数可绕过（CI 环境 ARISTOTLE_CI=true 时禁用 skip_guard） |
| RollbackEngine 简化 | 不保留 _delete_implementation/_restore_test violation-specific 策略，仅通用 git reset --hard |

## 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 功能等价 | 合并后覆盖所有保留模块公开方法 | 接口对照 |
| 2 | 测试保留 | 迁移后测试通过 | pytest |
| 3 | 目录清除 | intervention/ 不存在 | ls |
| 4 | MCP 工具数 | 25 | `uv run python -c "assert len(mcp._tool_manager._tools) == 25"` |
| 5 | 无状态验证 | 所有工具无 session 状态依赖 | 代码审查 |
| 6 | PromptValidator 迁移 | bilingual forbidden patterns 功能等价（Ralph Loop 侧） | pytest |
| 7 | commit_rule 兼容 | 守卫检查 + skip_guard 绕过 + CI 禁用 | pytest |
| 8 | 接口规范完整性 | 所有保留模块公开方法有接口文档 | 文档审查 |
| 9 | 审计日志完整性 | McpAuditEntry 写入 .aristotle/audit.jsonl，4KB 限 + 截断 + .gitignore | 集成测试 |
| 10 | pipeline_reset 行为 | rollback_to_checkpoint 触发 pipeline_reset，fallback 链三层覆盖 | 单元测试 + 集成测试 |
