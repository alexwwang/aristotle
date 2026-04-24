# Aristotle — 测试指南

> Aristotle MCP 规则引擎 + Bridge 插件测试概览。当前覆盖率：318 pytest + 104 static + 100 vitest + 23 e2e = 545 项检查。

## 1. 测试套件总览

| 套件 | 命令 | 数量 | 覆盖范围 |
|------|------|------|----------|
| 静态测试 | `bash test.sh` | 104 | 文件结构、SKILL.md 内容、hook 逻辑、错误模式检测 |
| 单元/集成测试 (Python) | `uv run pytest test/ -v` | 318 | 所有 MCP 工具、编排、进化、frontmatter、git 操作、Phase 0 Bridge MCP |
| Bridge 集成测试 | `uv run pytest test/test_e2e_bridge_integration.py -v` | 9 | Bridge↔MCP 集成：上下文修复、Bridge 检测、异步工作流、多阶段 |
| Bridge 插件 (TypeScript) | `cd plugins/aristotle-bridge && bunx vitest run` | 100 | 7 个模块：types/utils/api-probe/snapshot-extractor/workflow-store/idle-handler/executor |
| E2E 自动化测试 (opencode) | `bash test/e2e_opencode.sh` | 14 (5 PASS / 9 SKIP) | 真实 opencode 会话：skill 加载、sessions、learn、reflect（需 LLM） |
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

318 个测试，分布在 51+ 个测试类中。所有测试使用隔离的临时目录（`tmp_path` fixture），可安全反复运行。

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

### Phase 0 Bridge MCP 测试（23 个）

| 测试文件 | 测试类 | 数量 | 测试内容 |
|----------|--------|------|----------|
| `test/test_phase0_snapshot.py` | TestResolveSessionsDir, TestBuildReflectorPrompt, TestOrchestrateStartSessionFile, TestBridgeDetection, TestOnUndo, TestUndoneShortCircuit | 13 | Session 目录解析、reflector prompt SESSION_FILE、Bridge marker 检测、on_undo 工具、undone 状态短路 |
| `test/test_e2e_bridge_integration.py` | TestContextFixE2E, TestBridgeDetectionE2E, TestAsyncBridgeWorkflowE2E, TestMultiStageBridgeE2E | 9 | Bridge↔MCP 集成（通过真实 stdio 传输层，详见第 4 节拆分） |

## 4. Bridge 集成测试（9 pytest）

```bash
uv run pytest test/test_e2e_bridge_integration.py -v
```

通过真实 MCP stdio 传输层验证 Bridge↔MCP 交互。

### TestContextFixE2E — 上下文修复

| 测试 | 描述 |
|------|------|
| `test_reflect_prompt_contains_session_file_path` | snapshot → MCP reflect → prompt 包含 SESSION_FILE |
| `test_reflect_without_session_file_still_works` | 向后兼容：无 session_file 不崩溃 |
| `test_snapshot_file_on_disk_is_valid_json` | Snapshot JSON schema（v1, session_id） |

### TestBridgeDetectionE2E — Bridge 检测

| 测试 | 描述 |
|------|------|
| `test_use_bridge_true_when_marker_exists` | `.bridge-active` → use_bridge=true |
| `test_use_bridge_false_when_no_marker` | 无 marker → use_bridge=false |
| `test_marker_content_is_valid_json` | Marker schema（pid + startedAt） |

### TestAsyncBridgeWorkflowE2E — 异步工作流

| 测试 | 描述 |
|------|------|
| `test_full_async_reflect_workflow` | reflect → R → C → notify 完整链路 |
| `test_bridge_poll_then_abort` | 中止运行中的工作流 |

### TestMultiStageBridgeE2E — 多阶段

| 测试 | 描述 |
|------|------|
| `test_two_round_reflect_check` | reflect → checker 两轮循环 |

### E2E 测试中发现的 Bug

| Bug | 修复方式 |
|-----|----------|
| `detect_conflicts` 未注册为 MCP 工具 | 添加 `mcp.tool()` 注册 |
| `write_rule` ID 碰撞（秒级时间戳） | 改为毫秒时间戳 |
| `commit_rule` 双向冲突标注匹配了错误的规则 | 精确 ID 匹配 + `limit=10` |
| macOS `/tmp` symlink 导致 `relative_to` 失败 | `resolve_repo_dir()` 添加 `.resolve()` |

## 5. Bridge 插件测试（100 vitest）

> 完整测试级明细：详见 [plugins/aristotle-bridge/testing.zh.md](plugins/aristotle-bridge/testing.zh.md)

```bash
cd plugins/aristotle-bridge && bunx vitest run
```

| 文件 | 数量 | 覆盖 |
|------|------|------|
| `utils.test.ts` | 7 | extractLastAssistantText：反向遍历、sentinel、空白跳过 |
| `api-probe.test.ts` | 5 | detectApiMode：promptAsync 检测、session 清理 |
| `snapshot-extractor.test.ts` | 12 | 截断（4000/200）、原子写入、过滤、schema |
| `workflow-store.test.ts` | 35 | 磁盘持久化、50 容量淘汰、reconcile batch-5、loadFromDisk 验证 |
| `idle-handler.test.ts` | 7 | 状态过滤（running only）、错误处理 |
| `executor.test.ts` | 12 | 启动流程、snapshot、crash safety、session.create try/catch |
| `index.test.ts` | 22 | 3 工具注册、事件分发、.bridge-active marker、abort 幂等 |

## 6. E2E 自动化测试（opencode）

```bash
bash test/e2e_opencode.sh
```

14 个断言，通过 `opencode run "message" --format json` 驱动。测试真实 skill 加载和 MCP 调用。

| 组 | 断言 | 结果 | 描述 |
|----|------|------|------|
| E2E-1 | 1 | PASS | Skill 加载 |
| E2E-2 | 2 | PASS | Sessions（MCP 调用 + 内容） |
| E2E-3 | 2 | PASS | Learn（编排调用 + 内容） |
| E2E-4 | 2 | SKIP | Reflect（需 LLM 子 agent） |
| E2E-5 | 2 | SKIP | Snapshot 产物（依赖 reflect） |
| E2E-6 | 2 | SKIP | Bridge marker（需 plugin） |
| E2E-7 | 3 | SKIP | Workflow store（需 plugin） |

> SKIP 测试需要运行中的 LLM 或已加载的 Bridge Plugin。在真实环境下可 PASS。

## 7. E2E 实时测试

```bash
bash test/live-test.sh --model <provider/model>
```

创建真实会话，注入已知错误模式，触发 `/aristotle`，验证完整的协调器 → 反思器 → 规则写入流程。8 个断言。

## 8. 人工测试计划

### P1：Passive Trigger（无法自动化）

> 这是唯一无法自动化的测试场景。需要验证宿主 agent 在真实对话中的行为。

### 目标

验证 SKILL.md PASSIVE TRIGGER 段落正确引导宿主 agent 在检测到错误模式时建议运行 `/aristotle`，而非自动调用。

### 前置条件

1. Aristotle skill 已安装到 Claude Code 或 OpenCode
2. 已开启一个对话会话

### 测试用例

每个测试用例对应 SKILL.md PASSIVE TRIGGER 的一种触发模式。

#### P1-A：Agent 自我纠正触发（模式 1 — "You corrected your own output"）

**步骤：**
1. 要求 agent 实现一个函数（例如"写一个数组排序函数"）
2. Agent 产出代码后，要求它自我审查："Can you review the code you just wrote?"
3. Agent **自己**发现问题："Wait, there's a bug with..."
4. Agent 自行修正

**期望输出：** Agent 输出类似建议：
> 🦉 I detected an error pattern. Run /aristotle to reflect and prevent similar mistakes.

**断言：**
- ✅ Agent **自己**发现错误（非用户指出）
- ✅ Agent 建议运行 `/aristotle`
- ✅ Agent **不**自动调用 `/aristotle`

#### P1-B：方案切换触发（模式 3 — "You tried an approach, it failed, and you switched"）

**步骤：**
1. 给 agent 一个有挑战性的任务，使其可能尝试失败后换方案
2. Agent 尝试方案 A 但失败（编译错误、测试不通过等）
3. Agent 说 "Let me try a different approach..." 并切换到方案 B

**期望：** Agent 在方案切换后输出被动触发建议。

**断言：**
- ✅ Agent **自己**主动切换方案（非用户指示）
- ✅ 被动触发建议出现

#### P1-C：用户指出错误触发（模式 2 — "User pointed out an error and you agreed"）

**步骤：**
1. 要求 agent 实现某功能
2. Agent 产出有错误的代码
3. **用户**指出错误："这不对，没有处理空数组的情况"
4. Agent 同意并修正

**期望：** Agent 在同意用户纠正后输出被动触发建议。

**断言：**
- ✅ **用户**指出错误，Agent 同意
- ✅ 被动触发建议出现

#### P1-D：无误触发验证

**步骤：**
1. 正常对话（提问、回答）
2. 没有纠错或错误发生

**期望：** 不触发任何 Aristotle 建议。

#### P1-E：思考阶段自我纠正（不触发 — 正确行为）

**步骤：**
1. Agent 在思考/推理阶段遇到错误
2. Agent 在内部认识到错误，但在输出最终结果前自行修正
3. 最终输出给用户的内容已经是正确的——对话中没有可见错误

**期望：** 不触发 Aristotle 建议。

**合理性说明：** Agent 在错误到达对话之前已自行解决。Passive Trigger 监控的是可见的对话模式，而非内部推理状态。

#### P1-F：主会话纠正子代理错误（触发）

**步骤：**
1. 一个子代理（通过 `task()` 生成）返回了有错误的结果
2. 主会话 agent 审查子代理的输出
3. 主会话 agent 发现错误并予以修正

**期望：** 被动触发建议出现——主会话 agent 检测到并纠正了一个错误。

**合理性说明：** 从主会话的角度看，这匹配模式 1（"You corrected your own output"）。多 agent 错误检测场景已被 SKILL.md 的触发模式显式覆盖。

### 验证清单

完成所有 P1 测试后确认：
- [ ] P1-A：Agent **自己**发现错误并纠正 → 出现建议（模式 1）
- [ ] P1-B：Agent 方案切换 → 出现建议（模式 3）
- [ ] P1-C：**用户**指出错误，Agent 同意 → 出现建议（模式 2）
- [ ] P1-D：正常对话 → 无建议
- [ ] P1-E：思考阶段纠正（无可视错误）→ 无建议 ✅
- [ ] P1-F：主会话纠正子代理错误 → 出现建议 ✅
- [ ] Agent 从不自动调用 `/aristotle`
- [ ] 建议文本与 SKILL.md 定义一致

### Bridge 插件人工测试剧本（M1–M5）

> **执行策略**：原 5 个场景按自动化可行性合并为 2 轮执行。覆盖完整保留——每个原始验证点均映射到下方步骤。

#### Round A：M4 + M2 + M3 — Bridge 生命周期（tmux 可自动化）

一次 opencode 会话覆盖插件加载、异步反思和 undo 清理。**18 个验证点。**

| 步骤 | 动作 | 验证 | 覆盖 |
|------|------|------|------|
| A1 | 启动 opencode（含 Bridge 插件） | 日志无 "promptAsync not available" | M4-2 |
| A2 | 检查 `~/.config/opencode/aristotle-sessions/.bridge-active` | 文件存在，JSON 含 pid + startedAt | M4-3 |
| A3 | 发送 `/aristotle` | LLM 立即返回（会话不阻塞） | M2-1,2 |
| A4 | 检查 `.bridge-active` 仍存在 | Marker 文件在 | M2-3 |
| A5 | 检查 `bridge-workflows.json` | 文件存在，含 workflowId | M2-4 |
| A6 | 等待 idle 事件或轮询状态 | 状态 running → completed | M2-5,6 |
| A7 | 验证 Checker 自动触发 | 完成的工作流含 checker 结果 | M2-7 |
| A8 | 再次发送 `/aristotle` 启动新工作流 | 新工作流出现，status = running | M3-1 |
| A9 | 发送 `/undo` | SKILL.md "After any /undo" 规则触发 | M3-2,3 |
| A10 | 检查 `aristotle_check` 输出 | 返回运行中的工作流 | M3-4 |
| A11 | 验证取消操作 | 每个 running 工作流被 `aristotle_abort` 取消；MCP `on_undo` 被调用 | M3-5,6 |
| A12 | 验证用户可见消息 | "Cancelled N active Aristotle workflow(s)" | M3-7 |
| A13 | 退出 opencode | `.bridge-active` marker 被清理 | M4-4 |

**自动化说明**：A1–A13 可通过 tmux + 文件系统断言驱动。仅 A3、A6、A9 依赖 LLM 响应时间——需加充分 sleep 或轮询循环。

#### Round B：M1 + M5 — Reflect-Check 完整链路（半自动）

一次 `/aristotle` 调用覆盖快照提取、reflect-check 循环、sessions 和 review。**15 个验证点。**

| 步骤 | 动作 | 验证 | 覆盖 |
|------|------|------|------|
| B1 | 在对话中故意犯错后纠正 | 错误-纠正模式在会话中可见 | M1-1,2,3 |
| B2 | 发送 `/aristotle` | Reflector 子代理已启动 | M1-4, M5-1 |
| B3 | 检查 `~/.config/opencode/aristotle-sessions/ses_*_snapshot.json` | 文件已创建；snapshot.source 为 "t_session_search" 或 "bridge-plugin-sdk" | M1-5,6,7 |
| B4 | 等待 Reflector → Checker 链 | 每轮通过 `aristotle_fire_o` 启动；每轮状态正确 | M5-2,3,4 |
| B5 | 如 Checker 请求更深入分析 | 第二轮 Reflector 自动触发 | M5-3 |
| B6 | 通过 `aristotle_check` 检查每轮状态 | 状态 running → completed 逐轮转换 | M5-5 |
| B7 | 验证最终完成通知 | 用户看到完成消息 | M5-6 |
| B8 | 发送 `/aristotle sessions` | 新记录出现，状态正确 | M1-8 |
| B9 | 发送 `/aristotle review 1` | DRAFT 规则内容已展示 | M1-9 |

**自动化说明**：B3、B4、B6、B8、B9 为文件/API 断言。B1、B2、B5 依赖 LLM。可通过 `opencode run "message" --format json` 实现脚本化交互。

## 9. 配置常量参考

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

## 10. CI 集成

所有测试套件可无头运行：

```bash
# 快速冒烟测试（Python + 静态）
bash test.sh && uv run pytest test/ -q

# Bridge 插件
cd plugins/aristotle-bridge && bunx vitest run
```

期望结果：`318 passed` + `104 passed` + `100 passed` = **522 项检查，0 失败**。

## 11. Gate #1 验证（已完成）

**问题**：`session.prompt({noReply: true})` 是否会向父会话注入 system-reminder？

**结论**：**否。** `noReply: true` 会导致挂起 bug（OpenCode issues #4431, #14451）——它不会向父会话注入消息。已通过 `test/gate1-noReply-verify.sh` 验证。

**决策**：Bridge Plugin 采用轮询模式而非 noReply 注入。SKILL.md 使用空闲检测 + `aristotle_check`/`aristotle_abort` 工具管理异步反思，不阻塞主会话。
