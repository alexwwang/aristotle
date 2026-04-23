# Aristotle — 测试指南

> Aristotle MCP 规则引擎测试概览。当前覆盖率：295 pytest + 104 static + 70 e2e = 469 项检查。

## 1. 测试套件总览

| 套件 | 命令 | 数量 | 覆盖范围 |
|------|------|------|----------|
| 静态测试 | `bash test.sh` | 104 | 文件结构、SKILL.md 内容、hook 逻辑、错误模式检测 |
| 单元/集成测试 | `uv run pytest test/ -v` | 295 | 所有 MCP 工具、编排、进化、frontmatter、git 操作 |
| E2E 自动化测试 | `uv run python test_e2e_phase2.py` | 70 | 完整 MCP stdio 传输层、编排工作流、反馈、冲突检测 |
| E2E 实时测试 | `bash test/live-test.sh --model <provider/model>` | 8 | 真实会话 + 已知错误模式 |

## 2. 静态测试

```bash
bash test.sh
```

104 个断言，覆盖：
- 文件结构完整性（SKILL.md、config.py、test.sh）
- 渐进披露（SKILL.md ≤ 60 行，省略内部细节）
- Hook 逻辑与参数解析
- 错误模式检测（英文/中文/阈值）
- 架构保证
- Phase 2：Passive Trigger 段落（M8）

## 3. 单元/集成测试（pytest）

```bash
uv run pytest test/ -v
```

295 个测试，分布在 50 个测试类中。所有测试使用隔离的临时目录（`tmp_path` fixture），可安全反复运行。

### Phase 1 测试（227 个）

| 测试文件 | 测试类 | 数量 | 测试内容 |
|----------|--------|------|----------|
| `test/mcp/test_mcp_config.py` | TestConfig | 14 | 路径解析、环境变量覆盖、RISK_MAP、RISK_WEIGHTS、AUDIT_THRESHOLDS、SKILL_DIR、项目哈希 |
| `test/mcp/test_mcp_evolution.py` | TestEvolution | 10 | compute_delta（所有风险级别、边界值、输入校验）、decide_audit_level |
| `test/mcp/test_mcp_models.py` | TestModels | 13 | RuleMetadata 默认值、YAML 序列化往返、GEAR 2.0 字段 |
| `test/mcp/test_mcp_git_ops.py` | TestGitOps | 8 | init、add+commit、show、log、status、git_show_exists |
| `test/mcp/test_mcp_frontmatter.py` | TestFrontmatter | 18 | 原子写入、原始读取、字段更新、流式过滤、多维度搜索 |
| `test/mcp/test_mcp_migration.py` | TestMigration | 8 | 扁平 Markdown 解析、repo 初始化、自动迁移 |
| `test/mcp/test_mcp_server_tools.py` | TestServerTools, TestSyncTools, TestPathTraversal | 36 | 完整生命周期、reject、restore、sync、路径包含性检查 |
| `test/mcp/test_mcp_server_delta.py` | TestDeltaDecision | 8 | get_audit_decision、confidence 默认值、Δ 审核级别 |
| `test/mcp/test_mcp_server_reflection.py` | TestPersistDraft, TestCreateReflectionRecord, TestCompleteReflectionRecord | 21 | Draft 持久化、reflection records、状态管理 |
| `test/test_orchestration.py` | TestOrchestrateStart, TestOrchestrateOnEvent, TestWorkflowStateManagement, TestIntegrationMockO, TestSearchParamMapping, TestHelperFunctions, TestOrchestrateStartSessions | 52 | Learn 编排、workflow 状态、sessions、helpers |
| `test/test_review_actions.py` | TestOrchestrateReviewAction, TestExceptionRevise, TestIntegrationReview | 18 | Review actions、异常路径、集成测试 |
| `test/test_reflect_workflow.py` | TestOrchestrateStartReflect, TestOrchestrateOnEventReflect, TestExceptionReflect, TestExceptionStart | 17 | Reflect 流程、异常处理 |
| `test/test_count_propagation.py` | TestReReflectCountPropagation | 4 | Re-reflect count 继承和级联 |

### Phase 2 测试（68 个）

| 测试文件 | 数量 | 测试内容 |
|----------|------|----------|
| `test/test_m1_committed_paths.py` | 8 | committed_rule_paths 收集 → 传播 → confirm 快路径 |
| `test/test_m5_two_round.py` | 24 | 两轮检索（search → score → compress）、意图提取、评分、压缩 |
| `test/test_m6_feedback.py` | 13 | report_feedback 工具、feedback signal 元数据、自动反思触发 |
| `test/test_m7_delta_norm.py` | 12 | compute_delta log-normalization、sample_size 透传、审核级别阈值 |
| `test/test_m9_conflicts.py` | 11 | detect_conflicts、双向冲突标注、triple 匹配 |

## 4. E2E 自动化测试（Phase 2）

```bash
uv run python test_e2e_phase2.py
```

70 个测试，通过 MCP stdio 传输层运行。启动真实 MCP 服务器子进程，通过 JSON-RPC 调用工具。

### 按测试函数覆盖

| 测试函数 | 断言数 | 场景 |
|----------|--------|------|
| `test_learn` | 13 | 完整两轮检索、快捷路径、无结果、缺参 |
| `test_reflect` | 9 | Reflector→Checker 全链路、缺参 |
| `test_review` | 7 | Confirm、re-reflect、不存在的序列 |
| `test_feedback` | 13 | 元数据更新、delta log-norm、缺参、不存在规则 |
| `test_feedback_auto_reflect` | 5 | 自动反思触发、深度限制 |
| `test_conflicts` | 11 | 双向冲突标注、无冲突规则、detect_conflicts |
| `test_integration` | 10 | 未知 workflow、无效 JSON、sessions、reject+restore、不存在文件 |
| `test_passive_trigger` | 5 | SKILL.md 内容验证（4 断言 + 1 结构检查） |

### E2E 测试中发现的 Bug

| Bug | 修复方式 |
|-----|----------|
| `detect_conflicts` 未注册为 MCP 工具 | 添加 `mcp.tool()` 注册 |
| `write_rule` ID 碰撞（秒级时间戳） | 改为毫秒时间戳 |
| `commit_rule` 双向冲突标注匹配了错误的规则 | 精确 ID 匹配 + `limit=10` |
| macOS `/tmp` symlink 导致 `relative_to` 失败 | `resolve_repo_dir()` 添加 `.resolve()` |

## 5. E2E 实时测试

```bash
bash test/live-test.sh --model <provider/model>
```

创建真实会话，注入已知错误模式，触发 `/aristotle`，验证完整的协调器 → 反思器 → 规则写入流程。8 个断言。

## 6. 人工测试计划（P1 — Passive Trigger）

> 这是唯一无法自动化的测试场景。需要验证宿主 agent 在真实对话中的行为。

### 目标

验证 SKILL.md PASSIVE TRIGGER 段落正确引导宿主 agent 在检测到错误模式时建议运行 `/aristotle`，而非自动调用。

### 前置条件

1. Aristotle skill 已安装到 Claude Code 或 OpenCode
2. 已开启一个对话会话

### 测试用例

#### P1-A：自我纠正触发

**步骤：**
1. 要求 agent 实现某功能（例如"写一个数组排序函数"）
2. Agent 产出了有错误的代码
3. 指出错误："这不对，没有处理空数组的情况"
4. Agent 承认错误并修正

**期望输出：** Agent 输出类似建议：
> 🦉 I detected an error pattern. Run /aristotle to reflect and prevent similar mistakes.

**断言：**
- ✅ Agent 建议运行 `/aristotle`
- ✅ Agent **不**自动调用 `/aristotle`

#### P1-B：方案切换触发

**步骤：**
1. Agent 尝试某种方案但失败
2. Agent 说"我试了方案 X 但不行，换方案 Y 试试..."

**期望：** 与 P1-A 相同的被动触发建议。

#### P1-C：用户明确纠正

**步骤：**
1. 用户明确纠正 agent："不对，你搞错了" / "That's wrong"
2. Agent 同意并修正

**期望：** 与 P1-A 相同的被动触发建议。

#### P1-D：无误触发验证

**步骤：**
1. 正常对话（提问、回答）
2. 没有纠错或错误发生

**期望：** 不触发任何 Aristotle 建议。

### 验证清单

完成所有 P1 测试后确认：
- [ ] P1-A：自我纠正 → 出现建议
- [ ] P1-B：方案切换 → 出现建议
- [ ] P1-C：用户纠正 → 出现建议
- [ ] P1-D：正常对话 → 无建议
- [ ] Agent 从不自动调用 `/aristotle`
- [ ] 建议文本与 SKILL.md 定义一致

## 7. 配置常量参考

### 测试相关常量（config.py）

| 常量 | 值 | 用途 |
|------|-----|------|
| `SCORING_TOP_N` | 5 | 搜索后取前 N 条评分 |
| `SCORE_PARALLEL_MAX` | 3 | 并行评分上限 |
| `COMPRESS_TOP_N` | 3 | 压缩时取前 N 条 |
| `COMPRESS_MAX_CHARS` | 800 | 压缩输出总字符上限 |
| `COMPRESS_RULE_MAX_CHARS` | 200 | 单条规则压缩字符上限 |
| `MAX_FEEDBACK_REFLECT` | 3 | Feedback 自动反思最大深度 |
| `MAX_SAMPLES` | 20 | Log-normalization 分母 |
| `AUDIT_THRESHOLDS.auto` | 0.7 | Δ > 0.7 → 自动 commit |
| `AUDIT_THRESHOLDS.semi` | 0.4 | 0.4 < Δ ≤ 0.7 → 半自动 |
| `RISK_WEIGHTS` | high=0.8, medium=0.5, low=0.2 | 风险权重 |

## 8. CI 集成

所有测试套件可无头运行：

```bash
# 快速冒烟测试
bash test.sh && uv run pytest test/ -q

# Phase 2 完整验证
bash test.sh && uv run pytest test/ -q && uv run python test_e2e_phase2.py
```

期望结果：`295 passed` + `104 passed` + `70 passed` = **469 项检查，0 失败**。
