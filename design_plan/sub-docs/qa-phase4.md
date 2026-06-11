### Phase 4: intervention 合并到 aristotle_mcp（2 周）

**目标**：将 intervention/ 的无状态操作合并到 aristotle_mcp/，删除有状态模块，统一操作入口。

#### 3.4.0 合并前置条件 — 状态模型统一

**核心约束**: Aristotle MCP 是无状态工具服务器（每个 tool call 独立）。intervention/ 的有状态模块不直接合并。

⚠️ **CommitGuard schema 校验说明**：CommitGuard 类（commit_guard.py）不定义 validate_schema 方法。schema 校验逻辑来自 AutoCommitter.validate_schema()（committer.py L13-31）。CommitGuard 场景仅检查 schema 合规性，不执行写入。

**处理方式**：

| intervention 模块 | 处理方式 | 理由 |
|-------------------|----------|------|
| ViolationFilter (19行) | **删除** | Watchdog Interceptor 已完全覆盖，功能冗余 |
| InterventionCoordinator | **删除** | 协调逻辑由 Watchdog Observer + Ralph Loop 替代 |
| Reflector | **删除** | MCP 无法调用 LLM，由 Ralph Loop Reviewer 替代 |
| PromptValidator | **移到 Ralph Loop** | 作为 Reviewer prompt 的一部分（bilingual forbidden patterns） |
| RollbackEngine | **简化合并到 MCP** | 转为无状态工具（create_rollback_point, rollback_to_checkpoint）。**设计决策**：MCP 只提供通用回滚（git reset），不保留 violation_type 特定回滚策略（`_delete_implementation`、`_restore_test`）。理由：(1) 精确回滚依赖 ViolationEvent + PipelineContext 有状态数据，与 MCP 无状态原则冲突 (2) 精确回滚策略由 Watchdog TypeScript 侧调用 MCP 工具组合实现。参见 §3.4.1 影响分析。 |
| KiDocManager | **合并到 MCP** | 转为无状态工具（write_ki_doc, read_ki_docs） |
| RuleGenerator | **删除** | 功能与 MCP write_rule 重叠（write_rule 接收用户内容直接持久化，RuleGenerator 的模板生成逻辑由 Ralph Loop Reviewer prompt 替代） |
| intervention_types.py (143 行) | **删除** | 数据类型定义由 Watchdog schema.ts 替代 |
| __init__.py (6 行) | **删除** | 目录整体清除时自然删除 |
| CommitGuard | **拆分处理** | 自动提交功能**删除**（ensure_committed 依赖 PipelineContext 有状态数据，与 MCP 无状态原则冲突）。schema 校验逻辑来自 AutoCommitter（committer.py），将内联增强 MCP `commit_rule`。 |

> **注**：KiDocManager 4 个方法（record_intervention, ensure_assessment, ensure_updated, record_merge）成为 Watchdog TS 侧调用方职责——Watchdog 格式化内容后调用 write_ki_doc 存储原始 Markdown。read_ki_docs 返回原始文档内容供调用方解析。

> **注**：KiDocManager 方法→Watchdog TS 映射细节延迟到 Phase 4 Watchdog 实现阶段定义。关键不变式：MCP 工具是格式无关的通用存储；Watchdog 拥有文档结构所有权。

> **注**：完整删除文件列表见 §3.4.2。

**合并后架构**：
- 所有 MCP 工具都是无状态的
- 有状态逻辑全部在 Watchdog（TypeScript 侧）
- MCP 只做 CRUD 操作（读/写/查询规则、KI 文档、回滚点）

#### 3.4.1 合并内容

**Git 回滚安全约束**（追加到现有 `git_ops.py`，不修改已有函数）：
- 新增 `git stash`、`git reset --hard`、`git reflog` 操作
- **安全约束**：`rollback_to_checkpoint` 执行 `reset --hard` 前自动 `git stash --include-untracked -m 'aristotle-rollback: {checkpoint_hash}'` 未提交更改，防止数据丢失。stash message 前缀 `aristotle-rollback:` 用于区分 Aristotle 创建的 stash 和用户手动创建的 stash。⚠️ **边界条件**：`--include-untracked` 可能意外 stash `node_modules/` 等大目录。缓解：依赖 `.gitignore` 规则（git stash --include-untracked 遵循 .gitignore），建议在 stash 前检查 untracked 文件总大小（`git ls-files -z --others --exclude-standard | xargs -0 du -cs`），超过 100MB 时返回警告。
- **stash 失败处理**：若 stash 失败，阻止 rollback 返回错误，不继续执行 reset
- **stash 堆积管理**：每次 rollback 前检查 stash 数量——仅计算 `aristotle-rollback:` 前缀的 stash（非全局 stash 数量）。实现：`git stash list` 输出后 grep `aristotle-rollback:` 前缀计数（非 `git stash list` 原始长度），避免误计用户手动 stash。超过 5 个时返回警告（非错误，允许继续操作，响应中含 stash 清理建议）。**超过 10 个时阻止 rollback 并要求先清理 stash（硬上限）。**

> **注**：100MB 阈值参考：node_modules 典型大小上限，防止回滚大文件导致 stash 膨胀。

**Stash 清理机制**：当 `aristotle-rollback:` 前缀的 stash 达到硬上限（10 个）时，提供 `cleanup_rollback_stashes` 工具选项（Phase 4 新增）。清理策略：(1) 按时间倒序列出所有 `aristotle-rollback:` stash；(2) 保留最近 3 个（可能需要回滚到最近的检查点）；(3) 删除其余 stash（count - 3 个）。清理后允许 rollback 继续。清理前需确认 stash 对应的 checkpoint 是否已合入 main 分支——已合入的 checkpoint stash 可安全删除。

> **注**：5（warning）到 10（hard block）之间，rollback 正常执行（response 中包含 warning）。不会自动触发清理，直到达到 10 个硬性上限。

**⚠️ PipelineState 一致性（强制）**：`rollback_to_checkpoint` 执行 `git reset --hard` 回滚代码后，PipelineState 中的 phase/round 等状态可能与回滚后的实际代码不一致。**必须**在回滚后调用 `tdd_checkpoint(event='pipeline_reset')` 重置 PipelineState（此事件需在 Phase 4 实现）。未重置的 PipelineState 可能导致 Watchdog 基于过期状态做出错误门控决策（如允许跳过已回滚的阶段）。
**执行策略**：(1) rollback_to_checkpoint 工具返回值包含 `pipeline_reset_required: true` 标志 (2) Watchdog Observer 检测到 rollback_to_checkpoint 调用后，在下次 handle() 时检查并自动触发 pipeline_reset（若尚未调用）(3) Phase 4 AC 新增验收项：rollback 后 PipelineState 必须被 reset（自动化断言）。

**Fallback 策略**：若 Watchdog 未运行（纯 MCP 调用 / CI 环境），rollback_to_checkpoint 的 tool 实现（aristotle_mcp/server.py 中对应 handler）应在 rollback 完成后直接调用 tdd_checkpoint(event='pipeline_reset')。实现路径：MCP handler 检测 pipeline_reset_required=true 后，在 MCP 侧直接触发 reset，而非依赖 Watchdog 下次 handle()。若 MCP 侧也不支持（无 Watchdog + 无 MCP handler），则接受 PipelineState 暂时不一致——下次 pipeline_start 时状态会重新初始化。此为已知限制。

**⚠️ `pipeline_reset` CheckpointEvent 前向引用**：`pipeline_reset` 为 Phase 4 新增的 CheckpointEvent，用于回滚后重置 PipelineState（phase→1, phaseStatus→idle, round→0, observerTimeoutCount→0, auditEntryCount→0）。注：phase→1 而非 phase→0，因为 TDD pipeline phase 编号从 1 开始（phase=0 是 pre-init 哨兵值，见 known-issues.md §3.2 "phase=0 表示 pipeline 未启动"）。具体 payload 和 transition 逻辑在 Phase 4 实现时定义。当前文档在 CheckpointEvent 扩展列表中以 blockquote 注释「Phase 4」标注占位。

**RollbackEngine 简化影响分析**（F-20 修正）：当前 RollbackEngine 有两类 violation-specific 回滚策略：
- `SKIP_RED_PHASE → _delete_implementation`：删除实现文件（不恢复测试）
- `MODIFIED_TEST → _restore_test`：恢复测试文件到 boundary_commit_hash 版本

合并后的 `rollback_to_checkpoint` 只提供通用 `git reset --hard`（回滚到指定 checkpoint）。**丢失的能力**：无法只删实现而不动测试（或只恢复测试而不动实现）。**缓解**：精确回滚由 Watchdog TypeScript 侧组合 MCP 工具实现（先 `rollback_to_checkpoint` 恢复全部，再重写需要保留的文件）。对 TDD pipeline 安全网的影响：可接受——严重违规通常需要全量回滚，violation-specific 策略在当前代码中实际覆盖率较低（仅 2 种类型）。

**精确回滚实现路径**（Phase 4 Watchdog 实现阶段定义）：Watchdog Observer 检测到严重违规 → 通过 OpenCode MCP tool dispatch 调用 `rollback_to_checkpoint` 恢复全部 → 再通过文件系统操作（git checkout <branch> -- <file> 或直接写入）恢复需保留的文件。具体调用链在 Phase 4 实施时设计，当前文档记录设计意图。

##### 核心产出

| 功能 | 来源 | 目标 | MCP 工具 |
|------|------|------|----------|
| Git 回滚 | RollbackEngine | `git_ops.py`（Phase 4 扩展：新增 create_rollback_point + rollback_to_checkpoint） | `create_rollback_point`, `rollback_to_checkpoint`（详细约束见上方） |
| KI 文档 | KiDocManager | `_tools_ki.py`（**Phase 4 新建文件**） | `write_ki_doc`, `read_ki_docs` |
| 提交守卫 | CommitGuard | `_tools_rules.py` | 增强 `commit_rule`（增加守卫逻辑，非新工具） |

##### 辅助产出

| 功能 | 来源 | 目标 | MCP 工具 |
|------|------|------|----------|
| Stash 清理 | Phase 4 新增（非 intervention 来源） | `git_ops.py` | `cleanup_rollback_stashes` |

#### 3.4.2 删除内容
- `intervention/src/watchdog.py` — ViolationFilter 19 行，功能被 Interceptor 完全覆盖
- `intervention/src/intervention_coordinator.py` — 协调逻辑分散到 Watchdog + Ralph Loop
- `intervention/src/reflector.py` — MCP 无法调用 LLM，由 Ralph Loop 替代
- `intervention/src/prompt_validator.py` — 移到 Ralph Loop Reviewer prompt
- `intervention/src/rule_generator.py` — 与现有 write_rule 功能重叠
- `intervention/src/committer.py` — AutoCommitter 的 validate_schema() 函数将直接内联到 MCP commit_rule（CommitGuard 的 schema 校验与 AutoCommitter 共用同一 validate_schema 函数，参见 committer.py:5-31（含 _MAX_ERROR_SUMMARY_LENGTH 常量 + AutoCommitter class（含 validate_schema 方法））。注意：当前 MCP commit_rule 无 schema 校验——这是 net-new 功能增强，非功能迁移。⚠️ 已验证 committer.py:5-31 行范围准确（文件总计 31 行，L5=_MAX_ERROR_SUMMARY_LENGTH, L12-31=AutoCommitter class（含 validate_schema 方法））。
- `intervention/src/commit_guard.py` — 守卫逻辑将内联到 MCP `commit_rule`（46 行，非独立新工具）
- `intervention/src/rollback_engine.py` — **合并后删除**。功能已合并到 MCP git_ops.py（create_rollback_point + rollback_to_checkpoint 2 个工具）。合并后删除源文件。
- `intervention/src/ki_doc_manager.py` — **合并后删除**。功能已合并到 MCP _tools_ki.py（write_ki_doc + read_ki_docs 2 个工具）。合并后删除源文件。
- `intervention/src/intervention_types.py` — 数据类型定义（143 行），功能由 Watchdog schema 替代
- `intervention/src/__init__.py` — 包初始化（6 行，随目录整体删除）
- `intervention/` 目录整体删除

#### 3.4.3 MCP 工具清单（合并后验证）

**现有 20 工具**（aristotle_mcp/，已对照 `mcp._tool_manager._tools` 验证）：

规则生命周期（13 个）：
1. init_repo_tool（⚠️ MCP 注册名为 `init_repo_tool`，文档早期版本使用 `init_repo` 为显示名称）
2. write_rule
3. read_rules
4. list_rules
5. stage_rule
6. commit_rule
7. reject_rule
8. restore_rule
9. detect_conflicts
10. get_audit_decision
11. check_sync_status
12. sync_rules
13. report_feedback

工作流编排（6 个）：
14. orchestrate_start
15. orchestrate_on_event
16. orchestrate_review_action
17. create_reflection_record
18. complete_reflection_record
19. persist_draft

其他（1 个）：
20. on_undo

**以下为 Bridge Plugin 方法，非 MCP 工具**（不计入 20）：
- aristotle_fire_o（简称 fire_o，Reflector 调度）
- aristotle_check（简称 check_workflow，工作流状态查询）
- aristotle_abort（简称 abort_workflow，工作流取消）

**新增 5 工具**（来自 intervention/）：
21. create_rollback_point（来自 RollbackEngine）
22. rollback_to_checkpoint（来自 RollbackEngine）
23. write_ki_doc（来自 KiDocManager）
24. read_ki_docs（来自 KiDocManager）
25. cleanup_rollback_stashes（来自 Stash 清理机制，§3.4.1）

**注意**: RuleGenerator 的功能已由现有 write_rule 覆盖，CommitGuard 的守卫逻辑将内联增强 commit_rule，两者均不作为独立新工具添加。实际合并后为 **25 工具**。

**⚠️ commit_rule 行为变更兼容性说明**: 增强后的 commit_rule 将增加提交前守卫检查（如：规则状态必须为 staging 才能提交，frontmatter schema 校验）。现有调用方若直接调用 commit_rule 且规则未 staging，将收到拒绝。兼容策略：(1) 守卫默认启用 (2) 可通过 `skip_guard: true` 参数跳过（默认 false，用于自动化场景）(3) 错误信息包含具体拒绝原因和修复建议。

**守卫行为 & skip_guard**：**安全约束**：MCP 侧自维护审计日志（`.aristotle/audit.jsonl`），`skip_guard: true` 调用时 MCP 写入 GUARD_BYPASSED 条目到 MCP 侧审计日志。

**审计日志写入**：Watchdog Checkpoint 通过 `readMcpAuditLog()` 方法（Phase 4 新增）聚合 MCP 侧审计日志。

**readMcpAuditLog 接口**：Phase 1-3 设计决策：信任 MCP 调用方，guard bypass 仅追溯。**`readMcpAuditLog()` 接口定义**（Phase 4 新增）：`readMcpAuditLog(): Promise<McpAuditEntry[]>`。读取 MCP 侧审计日志（`.aristotle/audit.jsonl`），返回结构化条目。Watchdog Checkpoint 在阶段推进时调用此方法聚合 MCP 侧审计事件。→ McpAuditEntry/McpAuditEvent 类型定义见 §3.0.1

**Phase 4 增强说明**：`readMcpAuditLog()` 聚合 MCP 侧审计日志后，Checkpoint 可选择将 `GUARD_BYPASSED` 事件纳入门控决策（作为 warn 级 finding，不阻止但记录）。

**双审计日志聚合策略**：Phase 1-3 仅 Checkpoint 使用 Watchdog 侧审计日志（`getUnresolvedViolations`）。MCP 侧审计日志（`.aristotle/audit.jsonl`）仅作追溯用，不参与门控决策。Phase 4 `readMcpAuditLog()` 提供聚合查询能力，用于事后分析和全链路审计。门控决策始终基于 Watchdog 侧审计日志。⚠️ `.aristotle/audit.jsonl` 必须在 `init_repo` 时自动添加到 `.gitignore`（审计日志可能含敏感命令参数），防止意外提交到版本控制。在 CI/CD 环境变量 `ARISTOTLE_CI=true` 存在时，skip_guard 不可用（强制执行守卫检查，无法绕过）。此为 CI 环境的安全策略——CI 不应绕过质量门控。（环境变量定义见部署文档；Phase 4 产出物需包含 ARISTOTLE_CI 配置说明）

**现有调用方影响分析**：(1) Aristotle workflow orchestrate 流程中 commit_rule 调用时规则已 staging（正常流程）→ 无影响 (2) 直接 MCP 调用场景 → 未 staging 规则将被拒绝，需显式 skip_guard=true (3) Bridge plugin 调用 → 同 (1)，正常流程已 staging。迁移建议：发布 changelog 通知直接 MCP 调用方。

**并发安全约束**：MCP 侧审计日志使用 append-only JSONL 格式（原子写入单行）。`readMcpAuditLog()` 容忍末尾不完整行（跳过并记录 warn）。不使用文件锁（避免跨进程死锁）。**单行大小限制**：MCP 侧审计日志单行不超过 4KB（基于日志行可读性和 grep 友好性的实用限制（darwin PIPE_BUF=512，本限制非原子性保证））。`error_summary` 等长文本字段超限时截断至 500 字符。超出限制的条目写入后标记 `truncated: true`。
> **注**：frontmatter schema 校验（committer.py）限制 error_summary ≤ 200 字符；MCP 审计 JSONL 截断使用独立 500 字符限制（日志行安全）。两者作用于不同数据路径，互不影响。

> **注**：5 个新工具的详细接口规格（参数名/类型/必填、返回值结构、错误码）作为 Phase 4 前置任务在 Phase 4 开始前补充到本文档。Phase 4 TDD 流程要求先有接口规格才能编写测试。当前仅列出工具名称和功能来源，作为实施定位参考。

> **Phase 4 前置任务**：5 个新工具的接口规范须在 Phase 4 开发前完成评审，指定 spec owner 并设立 review gate。

#### 3.4.4 产出物
- 合并后的 aristotle_mcp/（25 工具）
- 删除 intervention/ 目录
- intervention 保留模块的测试迁移验证（以实际迁移时计数为准）
- **测试迁移说明**：(1) 删除模块（ViolationFilter/InterventionCoordinator 等）的测试直接删除 (2) 保留模块（KiDocManager/RollbackEngine）的测试迁移至 `packages/watchdog/tests/` 或 MCP 侧测试目录 (3) 迁移数量以实际可迁移用例为准，不设硬性目标。intervention/tests/ 中 test_rollback_engine.py 和 test_ki_doc_manager.py 需迁移至 packages/watchdog/tests/；其余 8 个测试文件随目录整体删除。
- 文档：`docs/intervention-merge-guide.md`

#### 3.4.5 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 功能等价 | 合并后 MCP 工具覆盖 intervention 所有保留模块的公开方法 | 接口对照表 |
| 2 | 测试保留 | intervention 保留模块的测试（RollbackEngine, KiDocManager）迁移后通过；CommitGuard schema 校验逻辑已内联到 commit_rule，验证见 AC-7 | pytest |
| 3 | 目录清除 | intervention/ 目录不存在 | ls 验证 |
| 4 | MCP 工具数 | 25（20 现有 + 5 新增） | 工具清单 + 自动化断言：`uv run python -c "from aristotle_mcp.server import mcp; assert len(mcp._tool_manager._tools) == 25"`（⚠️ 此断言依赖 mcp 库内部 API `_tool_manager._tools`，mcp 库升级时需同步更新。⚠️ 原降级方案 `mcp` CLI `tools/list` JSON-RPC 不可用——MCP stdio 需 initialize 握手，pipe 模式无法直接发送 JSON-RPC 请求。备用验证：`uv run python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools))"`） |
| 5 | 无状态验证 | 所有 25 工具无 session 状态依赖 | 代码审查 |
| 6 | PromptValidator 迁移 | bilingual forbidden patterns 已集成到 Reviewer prompt 模板 | prompt 模板 diff |
| 7 | commit_rule 行为兼容 | 守卫检查生效（未 staging 规则被拒绝 + 正确错误信息）、skip_guard 绕过验证、现有调用方兼容 | pytest（3 个用例） |
| 8 | 接口规格完整性 | 5 个新工具均有完整参数定义（名称/类型/必填/默认值）、返回值结构、错误码定义 | 文档审查 + JSON Schema 校验 |
| 9 | MCP 审计日志完整性 | skip_guard 写入 GUARD_BYPASSED + 4KB 超限截断 + 末尾不完整行容忍 | pytest（3 个用例） |
| 10 | pipeline_reset 行为验证 | 触发后 PipelineState 所有字段重置为初始值 + 无活跃 state 拒绝 + validateTransition/applyTransition 同步 | 单元测试（3 个用例） |

---

### Phase 5: 文档完善（1 周，贯穿全程）

**目标**：确保每个系统有清晰的设计文档、使用文档和架构说明。

#### 3.5.1 文档清单

| 文档 | 位置 | 内容 | 类型 |
|------|------|------|------|
| 架构总览 | `docs/architecture-overview.md` | 三个系统的职责和交互 | overview |
| Watchdog 设计 | `docs/watchdog-design.md` | Interceptor/Observer/Checkpoint 详细设计 | design |
| Ralph Loop 扩展 | `docs/ralph-loop-semantic-review.md` | 语义审查机制 | design |
| MCP 工具参考 | `docs/mcp-tools-reference.md` | 25 个工具的完整文档 | reference |
| 质量保障指南 | `docs/quality-assurance-guide.md` | 如何确保产出质量 | guide |
| 开发者指南 | `docs/developer-guide.md` | 如何扩展规则、添加检查项 | guide |

#### 3.5.2 产出物
- 6 份核心文档
- README 更新（版本号、工具数、结构描述与实际一致）
- CHANGELOG 更新

#### 3.5.3 验收标准

| # | 验收项 | 量化标准 | 验证方法 |
|---|--------|----------|----------|
| 1 | 文档覆盖率 | 每个公开工具/API 有文档 | 文档审查 |
| 2 | 架构图准确性 | 与代码实现一致 | 交叉验证 |
| 3 | README 一致性 | 版本号、工具数、结构描述与实际一致 | 自动化检查 |

