# Overview — Aristotle 质量保障体系

**Version**: 1.46

## Related
- [01-interfaces.md](./01-interfaces.md) — §3.0 接口定义
- [02-phase1-observer.md](./02-phase1-observer.md) — §3.1 Phase 1
- [03-phase2-test-gate.md](./03-phase2-test-gate.md) — §3.2 Phase 2
- [04-phase3-semantic.md](./04-phase3-semantic.md) — §3.3 Phase 3（待定）
- [05-phase4-merge.md](./05-phase4-merge.md) — §3.4 Phase 4
- [06-phase5-docs.md](./06-phase5-docs.md) — §3.5 Phase 5
- [adr.md](./adr.md) — 设计决策记录
- [known-issues.md](./known-issues.md) — 已知限制

---

## 1. 当前状态

已完成 Observer 基础架构（Phase 0）：Observer 类监听 Task 工具 ralph_loop 调用，扫描 prompt 注入，写入审计日志。PipelineStore、CheckpointHandler、StateCache 基础方法已实现。

Schema 版本 v4，PipelineState 含 currentPhase/ralph/phaseStatus 等字段。

## 2. 目标

构建多层质量保障体系：
1. **机械验证**（Phase 1）：Observer 实时捕获 Bash/Write 错误，自动解决，门控阻止。量化门槛：Bash 失败检出 ≥95%，误拦截 ≤5%，Observer P99 <20ms
2. **测试门控**（Phase 2）：强制 TDD 纪律，测试证据审计。量化门槛：测试请求记录 100%，检出时效 ≤90s
3. **语义审查**（Phase 3，待定）：Ralph Loop 扩展 Severity 体系
4. **模块整合**（Phase 4）：intervention → aristotle_mcp 合并

## 3. 关键里程碑

| 里程碑 | Phase | 依赖 | 可交付物 | 量化验收 |
|--------|-------|------|----------|----------|
| M1: Observer 增强 | P1 | 无 | auto-resolve + 门控 + 审计 FIFO | 检出≥95%, 误拦截≤5%, P99<20ms |
| M2: 测试门控 | P2 | P1 | TEST_RUN_COMPLETE + 降级模式 | 记录100%, 检出时效≤90s |
| M3: Intervention 合并 | P4 | 无 | 25 MCP 工具，intervention/ 删除 | 功能等价+测试全通过 |

## 4. 架构

### 职责边界（黄金法则）

| 子系统 | 职责 | 绝对不做 |
|--------|------|----------|
| Watchdog | 质量门控、审计日志、违规追踪 | 不做代码审查、不做业务逻辑判断 |
| Ralph Loop | 自动审查循环、severity 评级 | 不做实时拦截、不直接写审计日志 |
| Aristotle MCP | 规则管理、intervention 工具 | 不做 pipeline 状态管理、不做门控决策 |

### 同步/异步分层

| 层 | 预算 | 行为 | 超时策略 |
|----|------|------|----------|
| Interceptor | <5ms | 同步拦截（prompt 注入检测） | 阻断调用 |
| Observer | <20ms | 异步观察（Bash/Write 扫描） | Promise.race + 审计 + 降级 |
| Checkpoint | — | 门控检查（未解决 block 阻止推进） | 无超时，同步执行 |
| Reviewer | ~60s | 异步审查（语义正确性） | Ralph Loop 超时管理 |

### 防御闭环

Observer 超时 → 审计 OBSERVER_TIMEOUT → ≥3 次降级为 warn → Checkpoint 仅检查 block 级 → 任何成功操作 auto-resolve 前次违规。

### 错误处理策略

| 错误类别 | 处理系统 | 响应 |
|---------|---------|------|
| 机械错误（exit code、语法） | Observer + Checkpoint | 捕获+审计+门控 |
| 流程错误（prompt 注入） | Interceptor | 阻断 |
| 配置错误（工具注册失败） | Watchdog init | 降级模式 |
| 超时 | Observer | 审计+降级 |

---

## 5. 技术评估

### 5.1 性能

| 指标 | 预算 | 测量方法 |
|------|------|----------|
| Observer 执行延迟 | ≤20ms P99 | `performance.now()` 测量 _handleObservations 耗时 |
| auto-resolve 延迟 | ≤1ms | 内存索引 O(1) 查找，无 I/O |
| Checkpoint 门控 | ≤5ms | getUnresolvedViolations 内存索引查询 |
| appendAudit | ≤1ms | 同步 JSONL 追加 |
| 审计日志大小 | ≤10MB/key | 运行时检查 |
| 条目数上限 | 5000 条/run | FIFO 淘汰，在 phase_complete 执行 |

**关键路径**：Observer handle() → _handleObservations（扫描+审计）+ auto-resolve。总预算 = 20ms（Promise.race 超时保护）。

**内存占用**：unresolved 索引 Map（每 run ~500-1000 条目 × ~500B/条目 ≈ 250-500KB）。PipelineState 含审计计数器（O(1) 开销）。

### 5.2 安全性

| 威胁 | 影响 | 缓解 |
|------|------|------|
| skip_guard 绕过 | Agent 跳过质量门控 | CI 环境 `ARISTOTLE_CI=true` 强制门控 |
| 审计日志篡改 | 隐藏质量违规 | JSONL 追加模式 + `.gitignore` 防提交 |
| Bash output 注入 | extractExitCode 解析恶意 output | 正则仅匹配 `exit code: (\d+)`，不执行 |
| YAML 反序列化 | js-yaml DEFAULT_SCHEMA 允许 `!!js/function` | 强制 JSON_SCHEMA |
| 审计日志含敏感命令参数 | 泄露到版本控制 | `.gitignore` + 审计日志本地存储 |
| COMMAND_FAILED 误报 | 阻止正常推进 | auto-resolve 机制 + force_resolve_violation 手动解决 |
| 测试证据伪造 | Agent 提交虚假测试结果 | 测试框架 hash 校验（Phase 2+） |
| 测试证据绕过 | Agent 不提交 TEST_RUN_COMPLETE | Reviewer 检出缺失 → M→H 升级 |

### 5.3 可扩展性

| 维度 | 当前 | 扩展路径 |
|------|------|----------|
| 新审计事件 | 扩展 event 联合类型 | 纯加法变更，不改现有条目 |
| 新 Phase 接入 | transitions.ts 新增 case | applyTransition default throw 确保不遗漏 |
| 新门控规则 | RuleConfigLoader 加载 | 规则配置独立于代码 |
| multi-agent | 不支持 | cache.get() 返回新对象，Observer 需改为显式 writeState |
| Schema 演进 | SCHEMA_VERSION=4 | Phase 1 扩展字段全 optional，向后兼容 |

### 5.4 可靠性

| 故障模式 | 影响 | 恢复策略 |
|---------|------|----------|
| Observer 超时 | 审计记录 OBSERVER_TIMEOUT，不阻塞当前调用 | 后续成功自动 resolve；≥3 次降级为 warn |
| 崩溃（Observer 修改后、Checkpoint 前） | observerTimeoutCount 丢失 | 重新计数，最坏多一次超时才降级 |
| 崩溃（I/O 成功、writeState 失败） | 审计显示已解决但 state 未更新 | 下次 Checkpoint 幂等 resolve_timeout 修正 |
| 审计日志轮转 | 旧 key 条目不可查询 | unresolved 索引覆盖所有 audit* key 前缀 |
| Promise.race 不中断同步操作 | js-yaml/json.parse 阻塞超时保护 | AC-5 P99 基准测量实际执行时间 |

### 5.5 可观测性

| 信号 | 来源 | 用途 |
|------|------|------|
| OBSERVER_TIMEOUT 审计事件 | Observer catch 块 | 监控超时频率 |
| OBSERVER_TIMEOUT_DEGRADED | Observer ≥3 次降级 | 告警：系统持续超载 |
| DEGRADATION_MODE_ACTIVATED | Watchdog init | 告警：工具注册失败 |
| AUDIT_ROTATION_LIMIT_EXCEEDED | appendAudit | 监控审计日志增长 |
| auto-resolve 审计事件 | Observer handle() | 追踪违规解决模式 |
| severity 分布 | 审计日志查询 | 监控 block vs warn 比例 |

## 6. 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 20ms 预算不足（大文件/复杂命令） | 中 | P99 基准测量 + 超时降级兜底 |
| auto-resolve 误解决 | 低 | commandPattern 精确匹配 + timestamp 定位 |
| 测试证据检查被绕过 | 中 | Reviewer M→H 升级机制 |
| Schema 迁移破坏旧数据 | 低 | Phase 1 全 optional 字段，向后兼容 |
| intervention 合并破坏现有功能 | 中 | 接口对照 + 全量测试 |
| 测试结果伪造 | 中 | 测试框架 hash 校验 |
| AC-4 断言依赖内部 API | 中 | 备用验证命令 `print(len(...))` |
| Phase 3 Schema v5 迁移阻塞 | 高 | Phase 3 标记待定，不阻塞 P1/P2/P4 |

## 7. 演进路线：Prompt 编排权迁移

当前架构（Phase 1-2）：主 Agent 读取 skill 模板 → 调用 read_audit_log 获取上下文 → 自行组装 prompt → 调用 task() 派发 Reviewer。Observer RPS 扫描兜底。

**演进目标（Phase 2 后期 / Phase 3 前）**：MCP 新增 `assemble_review_prompt` 工具。

| 阶段 | Prompt 组装者 | 上下文来源 | 质量保障 |
|------|-------------|-----------|---------|
| P1-2（当前） | 主 Agent | read_audit_log + skill 模板 | Observer RPS + AC-2 |
| P3 前 | MCP `assemble_review_prompt` | RoundRecord.findings + 审计日志 + 升级状态 | 结构化注入，RPS 降级为冗余检查 |

**迁移条件**：
1. read_audit_log 工具已注册（P2 产出）
2. RoundRecord.findings 可通过 MCP 访问（需 MCP 侧新增读取接口）
3. Prompt 模板从纯文本占位符演进为结构化变量（`{DELIVERABLE}` → `{deliverable: string, type: "code"|"design"}`）

**不做的原因**：Phase 1-2 的审查内容（机械验证 + 测试证据）上下文简单，主 Agent 组装足够可靠。RoundRecord.findings 结构化注入仅在 M→H 升级判定需要跨轮次对比时才成为硬需求（Phase 3 语义审查场景）。

## 8. 总结

Phase 1 + Phase 4 可并行实施（无硬依赖）。Phase 2 依赖 Phase 1 的 severity 字段和 unresolved 索引。总工期预估 6 周（P1 2周 + P2 2周 + P4 2周）。
