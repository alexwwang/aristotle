# Aristotle 项目主体测试方案

> 版本: 1.0 | 日期: 2026-04-21 | 状态: Draft
> 覆盖范围: LEARN 协议、CHECKER 验证、Focus Modes、State File、Install Script

---

## 目录

1. [总览](#1-总览)
2. [第一层: MCP 单元测试 (pytest)](#2-第一层-mcp-单元测试pytest)
3. [第二层: 协议静态测试 (test.sh 扩展)](#3-第二层-协议静态测试testsh-扩展)
4. [第三层: E2E 测试 (live-test.sh 扩展)](#4-第三层-e2e-测试live-testsh-扩展)
5. [覆盖度评估](#5-覆盖度评估)
6. [实施建议](#6-实施建议)

---

## 1. 总览

### 1.1 现有测试基线

| 层级 | 文件 | 当前测试数 | 覆盖范围 |
|------|------|-----------|---------|
| Static | test.sh | 67 assertions | 文件结构、SKILL.md 内容、Hook 模式检测、架构保证 |
| Unit | test/test_mcp.py | 111 assertions | config、evolution、models、git_ops、frontmatter、migration、server、sync、delta、path traversal (10 个 Test 类) |
| E2E | test/live-test.sh | 8 assertions | 完整 reflect 触发 -> subagent -> 背景任务流程 |

### 1.2 新增测试方案

| 层级 | 目标文件 | 新增测试数 | 新增断言数 | 依赖 |
|------|---------|-----------|-----------|------|
| Unit (pytest) | test/test_mcp.py | 29 tests | ~65 assertions | pytest, tmp_path, monkeypatch |
| Static (test.sh) | test.sh | 59 assertions | 59 assertions | bash, grep |
| E2E (live-test.sh) | test/live-test.sh | 7 tests | ~15 assertions | OpenCode session |
| **合计** | | **95** | **~139** | |

### 1.3 按模块统计

| 模块 | 单元测试 | 静态测试 | E2E 测试 | 合计 |
|------|---------|---------|---------|------|
| LEARN 支持 (MCP 工具) | 18 | 18 | 7 | 43 |
| CHECKER 验证 | 3 | 14 | -- | 17 |
| Focus Modes | -- | 12 | -- | 12 |
| State File | 2 | 12 | -- | 14 |
| Install Script | 6 | 3 | -- | 9 |
| **合计** | **29** | **59** | **7** | **95** |

### 1.4 测试 ID 命名规范

| 前缀 | 含义 | 层级 |
|------|------|------|
| TL1.x | Test Learn - Layer 1 (unit) | pytest TestLearnTools |
| TL2.x | Test Learn - Layer 2 (static) | test.sh T7 section |
| TL3.x | Test Learn - Layer 3 (e2e) | live-test.sh |
| TC1.x | Test Checker schema | static + unit |
| TC2.x | Test Checker content | static |
| TC3.x | Test Checker outcome | static |
| TF1.x | Test Focus modes | static |
| TS1.x | Test State file | static + unit |
| TI1.x | Test Install script | static + unit |

---

## 2. 第一层: MCP 单元测试 (pytest)

### 2.1 TestLearnTools (新增类)

在 `test/test_mcp.py` 的 `TestDeltaDecision` 类之后 (约 line 1412) 新增。

验证 LEARN 协议所依赖的 MCP 工具在 LEARN 调用模式下的正确性。复用现有 `tmp_repo` fixture。

| ID | 方法名 | 描述 | 预期行为 | 优先级 |
|----|--------|------|----------|--------|
| TL1.1 | test_list_rules_verified_only | list_rules status="verified" 只返回已验证规则 | 创建 1 pending + 1 verified 规则，`list_rules(status_filter="verified")` 只返回 1 条 | P0 |
| TL1.2 | test_list_rules_excludes_staging | list_rules status="verified" 排除 staging 规则 | 创建 1 staging + 1 verified 规则，`list_rules(status_filter="verified")` 只返回 1 条 | P0 |
| TL1.3 | test_list_rules_domain_plus_task_goal | list_rules 多维度 AND: domain + task_goal | 创建 domain=db+goal=migration 和 domain=db+goal=seeding 各 1 条，`intent_domain="database" + intent_task_goal="migration"` 只返回第 1 条 | P0 |
| TL1.4 | test_list_rules_domain_plus_failed_skill | list_rules 多维度 AND: domain + failed_skill | 创建 domain=db+skill=prisma 和 domain=db+skill=sequelize 各 1 条，`intent_domain="database" + failed_skill="prisma"` 只返回第 1 条 | P0 |
| TL1.5 | test_list_rules_domain_plus_error_summary | list_rules 多维度 AND: domain + error_summary | 创建 2 条不同 error_summary 的规则，`intent_domain="database" + error_summary="timeout"` 返回匹配的 1 条 | P1 |
| TL1.6 | test_read_rules_keyword_regex_or | read_rules keyword 使用 regex OR | 创建规则 source_session="ses_abc"，`read_rules(status="pending", keyword="ses_abc\|ses_xyz")` 返回 1 条 | P0 |
| TL1.7 | test_read_rules_verified_excludes_rejected | read_rules status="verified" 不返回 rejected | 创建 verified + rejected 各 1 条，`read_rules(status="verified")` 只返回 1 条 | P0 |
| TL1.8 | test_list_rules_metadata_gear2_fields | list_rules metadata 包含 GEAR 2.0 全字段 | 创建带 GEAR 2.0 字段的规则，list_rules 返回的 metadata 包含 intent_tags, failed_skill, error_summary | P0 |
| TL1.9 | test_list_rules_no_content_body | list_rules 不返回 content body | list_rules 的 rules[0] 不含 "content" key | P0 |
| TL1.10 | test_read_rules_scope_all_cross_scope | read_rules scope="all" 跨 scope 检索 | 创建 user + project 规则各 1 条，`read_rules(scope="all", status="pending")` 返回 2 条 | P1 |
| TL1.11 | test_learn_selfheal_sync | LEARN 自愈: unsynced verified 被检测和修复 | 创建 verified 规则但未 git commit，`check_sync_status` 检测到 1 条，`sync_rules` 修复后 unsynced_count=0 | P1 |
| TL1.12 | test_list_rules_category_plus_domain | list_rules category + domain 组合 | 创建 category=HALLUCINATION+domain=db 和 category=HALLUCINATION+domain=api，`category="HALLUCINATION" + intent_domain="database"` 只返回 1 条 | P1 |
| TL1.13 | test_list_rules_empty_repo | list_rules 空 repo 返回 0 结果 | 空 repo 中 list_rules 返回 count=0, rules=[] | P0 |
| TL1.14 | test_read_rules_no_match | read_rules 无匹配维度返回空 | `read_rules(intent_domain="nonexistent")` 返回 count=0 | P0 |
| TL1.15 | test_stream_filter_legacy_compat | stream_filter_rules 对旧规则 (无 intent_tags) 的兼容 | 无 intent_tags 的规则在 intent_domain 过滤时被排除 | P0 |
| TL1.16 | test_list_rules_limit_truncate | list_rules limit 参数正确截断 | 创建 10 条规则，`list_rules(limit=3)` 返回 3 条 | P1 |
| TL1.17 | test_keyword_case_insensitive | keyword regex 大小写不敏感 | 规则 frontmatter 含 "Prisma"，`keyword="prisma"` 可匹配 | P1 |
| TL1.18 | test_intent_task_goal_partial_match | intent_task_goal 部分匹配 | intent_tags.task_goal="connection_pool_management"，`intent_task_goal="pool"` 可匹配 | P0 |

### 2.2 TestCheckerTools (新增类)

验证 MCP 层 schema 约束与 CHECKER.md 声明的一致性。

| ID | 方法名 | 描述 | 预期行为 | 优先级 |
|----|--------|------|----------|--------|
| TC1.2 | test_risk_map_covers_all_categories | RISK_MAP 包含全部 8 category | `RISK_MAP` 的 keys 包含 CHECKER.md 引用的全部 8 个有效 category | P0 |
| TC1.6 | test_write_rule_rejects_invalid_category | write_rule 拒绝无效 category | `write_rule(category="INVALID")` 应返回失败 | P0 |
| TC1.7 | test_write_rule_valid_categories | write_rule 接受全部有效 category | 遍历 8 个有效 category，全部调用成功 | P1 |

注意: TC1.3 (`intent_tags` 空 string 校验) 和 TC1.4 (`error_summary` 长度校验) 记录为已知 gap，当前 MCP 层无此校验逻辑，暂不编写测试。

### 2.3 TestStateFile (新增类)

验证 state file 的 schema 和约束。注意: 当前 state file 读写逻辑分散在 REFLECT.md/REVIEW.md (LLM 执行)，本测试类验证 state file schema 的合理性。若后续提取到 Python 模块 `aristotle_mcp/state.py`，可扩展为完整单元测试。

| ID | 方法名 | 描述 | 预期行为 | 优先级 |
|----|--------|------|----------|--------|
| TS1.6 | test_state_pruning_at_50 | 超过 50 条记录时裁剪 | 向 JSON 数组插入 55 条记录，验证只剩 50 条 | P0 |
| TS1.13 | test_state_rules_count_null_on_draft | draft 状态时 rules_count 为 None | 新记录 status="draft" 时 rules_count 字段为 None/null | P1 |

前置依赖: 这两个测试需要 `aristotle_mcp/state.py` 模块 (尚未存在)。若模块未创建，则这两个测试改为 static 断言。

### 2.4 TestInstallScript (新增类)

使用 `tmp_path` + `monkeypatch` 在隔离环境中测试 install.sh。

| ID | 方法名 | 描述 | 预期行为 | 优先级 |
|----|--------|------|----------|--------|
| TI1.2 | test_install_copies_skill_files | 安装复制 4 个 skill 文件 | 执行 install.sh 后 `$SKILL_DEST/SKILL.md`、`REFLECTOR.md`、`REFLECT.md`、`REVIEW.md` 存在 | P0 |
| TI1.5 | test_learnings_file_created | 安装创建 learnings 文件 | `aristotle-learnings.md` 在不存在时被创建 | P0 |
| TI1.7 | test_learnings_file_preserved | 安装保留已有 learnings | 已有 learnings 文件时不覆盖，输出 "preserving" | P0 |
| TI1.14 | test_mkdir_creates_destination | 安装创建目标目录 | 目标目录不存在时自动创建 | P0 |
| TI1.15 | test_install_idempotent | 安装幂等 | 多次执行不报错，learnings 文件保留原有内容 | P0 |
| TI1.12 | test_skill_base_env_override | SKILL_BASE 支持环境变量覆盖 | `CLAUDE_CONFIG_DIR` 可覆盖默认 `~/.claude` | P1 |

---

## 3. 第二层: 协议静态测试 (test.sh 扩展)

在现有 `test.sh` 的 `T6: Architecture Guarantees` section 之后 (约 line 241) 新增以下 section。每个 section 使用 `assert_contains` / `assert_not_contains` 断言协议文档的内容完整性。

### 3.1 T7: LEARN.md Protocol Content

验证 LEARN.md 包含 LEARN 协议的全部必要指令和约束声明。

| ID | 断言目标 | 验证内容 | 文件 | 优先级 |
|----|----------|----------|------|--------|
| TL2.1 | STEP 标签 | LEARN.md 包含 "STEP L1" 到 "STEP L6" (6 个 STEP 全部存在) | LEARN.md | P0 |
| TL2.2 | L2b domain 映射表 | 包含全部 8 个 domain: file_operations, api_integration, database_operations, code_generation, build_system, testing, deployment, general | LEARN.md | P0 |
| TL2.3 | L3a status 约束 | 包含 `status: "verified"` 或等价表达 | LEARN.md | P0 |
| TL2.4 | L3a 参数构建 | 包含 intent_domain, intent_task_goal, failed_skill, keyword 的参数构建逻辑 | LEARN.md | P0 |
| TL2.5 | L3b keyword 提取策略 | 包含 `\|` 连接和 "2-4 terms" 或 "2-3 core technical nouns" | LEARN.md | P0 |
| TL2.6 | L3c list_rules 指令 | 包含 "list_rules" 和 "metadata-only" 或 "no content bodies" | LEARN.md | P0 |
| TL2.7 | L3d subagent 评分 | 包含 "1-10" 评分范围和 subagent prompt 模板 | LEARN.md | P0 |
| TL2.8 | L3e 评分阈值 | 包含 score < 3 丢弃逻辑和 MAX_LEARN_RESULTS 默认值 5 | LEARN.md | P0 |
| TL2.9 | L4c 输出格式模板 | 包含 "Found N relevant lessons" 格式和 error_summary/Avoid/Rule ID 模板 | LEARN.md | P0 |
| TL2.10 | L4c 无结果 fallback | 包含 "No relevant lessons found" 提示和 --domain/--goal 建议 | LEARN.md | P0 |
| TL2.11 | L5 上下文隔离 | 包含 "No infrastructure details" 或等价的隔离声明 | LEARN.md | P0 |
| TL2.12 | L6a error scene report | 包含 applied_rules 和 error_description 字段 | LEARN.md | P0 |
| TL2.13 | L6b escalation 路径 | 包含 Reflector subagent 触发和规则状态更新逻辑 | LEARN.md | P1 |
| TL2.14 | Permissions 白名单 | 包含 "read_rules" 或 "list_rules" 在 allowed 列表中 | LEARN.md | P0 |
| TL2.15 | Permissions 黑名单 | 包含禁止 "Expose MCP call details" 和 "Return raw rule file content" | LEARN.md | P0 |
| TL2.16 | MAX_LEARN_RESULTS 参数 | 包含 "MAX_LEARN_RESULTS" 和 "default: 5" | LEARN.md | P0 |
| TL2.17 | 文件大小合理 | LEARN.md 行数 <= 300 | LEARN.md | P1 |
| TL2.18 | context isolation 核心约束 | 包含 "Core constraint: context isolation" 或等价表述 | LEARN.md | P0 |

### 3.2 T8: CHECKER.md Protocol Content

验证 CHECKER.md 文档的完整性和术语一致性。

| ID | 断言目标 | 验证内容 | 文件 | 优先级 |
|----|----------|----------|------|--------|
| TC1.1 | 全部有效 category 枚举 | CHECKER.md 引用的 8 个 category 与 REFLECTOR.md R3 定义一致: MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR | CHECKER.md | P0 |
| TC1.5 | id 字段排除声明 | CHECKER.md 明确声明 Checker 不验证 id | CHECKER.md | P1 |
| TC2.1 | Category 错配示例 | 包含 3 对典型错配: HALLUCINATION vs INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE vs SYNTAX_API_ERROR, MISUNDERSTOOD_REQUIREMENT vs ASSUMED_CONTEXT | CHECKER.md | P1 |
| TC2.2 | Intent tags 准确性规则 | 包含 domain 必须匹配 error 上下文的说明和 task_goal 描述用户意图而非错误本身的声明 | CHECKER.md | P1 |
| TC2.3 | Error summary 质量标准 | 包含 "describe the error scene, not the root cause" 或等价表述 | CHECKER.md | P1 |
| TC2.4 | Failed skill null handling | 包含 "reasoning mistake" 对应 null 的说明 | CHECKER.md | P1 |
| TC2.5 | Proposed rule quality guard | 包含 "not be overly generic" 和 "verifiable" 声明 | CHECKER.md | P1 |
| TC2.6 | Context/Example consistency | 包含 Context/Example 对齐说明 | CHECKER.md | P1 |
| TC3.1 | All-pass -> proceed | 包含 "ALL checks pass" 和 "proceed" | CHECKER.md | P0 |
| TC3.2 | Schema failure -> hard reject | 包含 "hard reject" 和 "inform user which field failed" | CHECKER.md | P0 |
| TC3.3 | Content inaccuracy -> auto-correct | 包含 "auto-correct" | CHECKER.md | P1 |
| TC3.4 | Generic rule -> flag to user | 包含 "flag to user" 或 "suggest more specific" | CHECKER.md | P1 |
| TC3.5 | Soft warning -> proceed | 包含 "soft warning" 或 "minor imprecision" | CHECKER.md | P1 |
| TC3.6 | REVIEW.md 引用 CHECKER.md | REVIEW.md STEP V2 包含 "Read `${SKILL_DIR}/CHECKER.md`, execute validation" 或等价表述 | REVIEW.md | P0 |

### 3.3 T9: Focus Modes

验证 REFLECTOR.md、REFLECT.md、SKILL.md 中 Focus 策略的完整声明。

| ID | 断言目标 | 验证内容 | 文件 | 优先级 |
|----|----------|----------|------|--------|
| TF1.1 | 全部 5 种策略 | REFLECTOR.md R1a table 包含 `last`, `after "text"`, `around N`, `error`, `full` | REFLECTOR.md | P0 |
| TF1.2 | SKILL.md 引用 focus 选项 | SKILL.md --focus 参数说明包含 5 种策略名或引用 | SKILL.md | P0 |
| TF1.3 | REFLECT.md focus_hint 参数列表 | REFLECT.md F1 列出全部 focus_hint 选项 | REFLECT.md | P0 |
| TF1.4 | last 默认行为 | REFLECTOR.md 声明 `last` 读最后 50 条消息; REFLECT.md 声明默认 last | REFLECTOR.md + REFLECT.md | P1 |
| TF1.5 | after "text" 边界 | 包含从 text 首次出现到 session 结尾的说明 | REFLECTOR.md | P1 |
| TF1.6 | around N 窗口大小 | 包含 N-10 到 N+10 (20 条消息窗口) 说明 | REFLECTOR.md | P1 |
| TF1.7 | error mode 范围 | 包含 "error-correction patterns" 和 "skip clean section" 或等价表述 | REFLECTOR.md | P1 |
| TF1.8 | full mode token 提示 | 包含 "may consume more tokens" 或等价表述 | REFLECTOR.md | P2 |
| TF1.9 | custom text as focus_hint | SKILL.md 包含 "custom text" 作为 focus 策略的说明 | SKILL.md | P1 |
| TF1.10 | DRAFT header 含 Focus | REFLECTOR.md R4 输出格式包含 `Focus: ${FOCUS_HINT}` 字段 | REFLECTOR.md | P0 |
| TF1.11 | DRAFT header 含 Scanned Range | REFLECTOR.md R4 输出格式包含 `Scanned Range: messages [start]--[end]` | REFLECTOR.md | P0 |
| TF1.12 | Re-reflect 使用 Location metadata | REVIEW.md V6 声明 re-reflect 时使用原 DRAFT 的 scanned_range 和 Location 字段 | REVIEW.md | P1 |

### 3.4 T10: State File Schema

验证 REFLECT.md、REVIEW.md、SKILL.md 中 state file 相关声明的完整性。

| ID | 断言目标 | 验证内容 | 文件 | 优先级 |
|----|----------|----------|------|--------|
| TS1.1 | State file 是 JSON Array | REFLECT.md 声明 "start with `[]`" 或等价 | REFLECT.md | P0 |
| TS1.2 | 记录必需字段 | REFLECT.md F4 记录模板包含: id, reflector_session_id, target_session_id, target_label, launched_at, status, rules_count | REFLECT.md | P0 |
| TS1.3 | Status 枚举限制 | status 只出现在 4 个值: draft, confirmed, revised, rejected | REFLECT.md + REVIEW.md | P0 |
| TS1.4 | SKILL.md 显示 status icons | sessions 命令输出包含 draft/confirmed/revised/rejected 的 icon 标记 | SKILL.md | P1 |
| TS1.5 | 最多 50 条记录 | REFLECT.md 包含 "50 most recent" 或 "at most 50" | REFLECT.md | P0 |
| TS1.7 | draft -> confirmed 转换 | REVIEW.md V3d 包含 status 更新为 "confirmed" | REVIEW.md | P0 |
| TS1.8 | draft -> rejected 转换 | REVIEW.md V2 包含 status 更新为 "rejected" | REVIEW.md | P0 |
| TS1.9 | confirmed -> revised 转换 | REVIEW.md V4 包含 status 更新为 "revised" | REVIEW.md | P1 |
| TS1.10 | target_label 格式变体 | REFLECT.md F2 定义 4 种 label 格式: "current", "last", "ses_xxxx", "recent #i/N" | REFLECT.md | P1 |
| TS1.11 | passive-trigger label | REFLECT.md P3.3 包含 "passive-trigger" 作为 target_label | REFLECT.md | P1 |
| TS1.12 | id 格式 rec_{timestamp} | REFLECT.md 包含 `rec_$(date +%s)` 或等价 id 格式 | REFLECT.md | P1 |
| TS1.14 | 1-indexed 序号 | SKILL.md sessions 使用 1-indexed 序号; review N 使用相同序号 | SKILL.md | P0 |

### 3.5 T11: Install Script Content (T5 扩展)

在现有 T5 section 基础上扩展，验证 install.sh 的关键行为声明。

| ID | 断言目标 | 验证内容 | 文件 | 优先级 |
|----|----------|----------|------|--------|
| TI1.9 | Step 3 验证安装文件 | install.sh 包含对所有已安装文件的存在性检查 | install.sh | P0 |
| TI1.16 | SKILL_SRC 自动检测 | install.sh 使用 `${BASH_SOURCE[0]}` 推导 SCRIPT_DIR | install.sh | P1 |
| TI1.3 | 不复制 CHECKER.md | install.sh 不包含 "CHECKER.md" 字符串 (CHECKER.md 按需加载) | install.sh | P1 |

### 3.6 test.sh 新增内容总结

| Section | 新增断言数 | 位置 |
|---------|-----------|------|
| T7: LEARN.md | 18 | T6 之后 |
| T8: CHECKER.md | 14 | T7 之后 |
| T9: Focus Modes | 12 | T8 之后 |
| T10: State File | 12 | T9 之后 |
| T11: Install Script | 3 | T5 扩展或 T10 之后 |
| **合计** | **59** | |

注意: 实际断言数可能因合并相似断言而略有调整。每个 ID 至少对应一个 `assert_contains` 或 `assert_not_contains` 调用。TF1.1 的 5 个策略检查可展开为 5 个独立断言。

---

## 4. 第三层: E2E 测试 (live-test.sh 扩展)

### 4.1 Learn Flow 测试场景

在 live-test.sh 的 Step 4 之后新增 learn 相关测试步骤。需要预置 verified 规则到 test repo。

| ID | 步骤描述 | 验证方式 | 优先级 |
|----|----------|----------|--------|
| TL3.1 | 基础 `/aristotle learn` 触发 | 发送 `/aristotle learn` 命令，检查响应包含 "relevant lessons" 或 "No relevant lessons" | P0 |
| TL3.2 | 参数化 learn 正确检索 | 发送 `/aristotle learn --domain database --goal connection_pool`，检查返回匹配规则或合理 fallback | P0 |
| TL3.3 | 自然语言 learn 正确推断 | 发送 "之前做数据库迁移踩过坑吗?" 等自然语言，检查触发 learn 并返回相关规则 | P1 |
| TL3.4 | 无匹配结果返回 fallback | 查询不存在的 domain，检查返回 "No relevant lessons" + 建议 | P1 |
| TL3.5 | L 上下文隔离 | 检查 L 的响应中不包含 "MCP"、"frontmatter"、"read_rules"、"list_rules"、"stream_filter" 关键词 | P0 |
| TL3.6 | 输出格式正确 | 检查返回的格式包含 CATEGORY、error_summary、Avoid、correct/wrong 示例、Rule ID | P1 |
| TL3.7 | L6 escalation 触发 | L 在 learn 后仍犯错时提交 error scene report，检查 O 触发新的 Reflector | P1 |

### 4.2 E2E 测试前置条件

1. 需要在执行 learn 测试前，通过 MCP `write_rule` + `commit_rule` 预置至少 1-2 条 verified 规则
2. 预置规则应包含 GEAR 2.0 字段 (intent_tags, error_summary) 以确保多维度检索可测
3. TL3.5 和 TL3.6 的断言依赖于 LLM 输出的格式稳定性，建议使用宽松匹配 (grep -i) 而非精确匹配

### 4.3 E2E 实现策略

建议在 live-test.sh 中新增 Step 5 (Pre-seed rules) 和 Step 6 (Learn flow tests):

```bash
# Step 5: Pre-seed verified rules for learn testing
info_msg "Step 5: Pre-seeding verified rules..."
# 通过 opencode run 调用 MCP 工具创建并 commit verified 规则

# Step 6: Learn flow tests
info_msg "Step 6: Testing /aristotle learn..."
STEP6=$(run_opencode -s "$SES_ID" --model "$MODEL" \
    --command "aristotle learn --domain database --goal connection_pool" || true)
# 验证输出...
```

---

## 5. 覆盖度评估

### 5.1 按协议 STEP 覆盖 (LEARN L1-L6)

| STEP | 协议行为 | 测试方式 | 覆盖程度 |
|------|---------|---------|---------|
| L1: RECEIVE | 路由到 LEARN.md | Static (TL2.1 验证 STEP 存在) + E2E (TL3.1 验证命令路由) | 中 -- 路由逻辑本身由 SKILL.md 执行 |
| L2a: INTENT EXTRACTION | O 推断 intent_tags | 不可自动测试 (LLM 推理) | 无 -- 依赖人工 eval |
| L2b: DOMAIN MAPPING | 8 个 domain 映射表 | Static (TL2.2 验证全部 8 domain 存在) | 高 -- 协议文档完整 |
| L2c: THRESHOLD | domain 空 -> fallback 逻辑 | Static (TL2.3, TL2.4 验证约束声明) | 中 -- 逻辑声明可验证，执行不可测试 |
| L3a: BUILD PARAMS | status="verified" + 多维参数 | Unit (TL1.1-TL1.5, TL1.12, TL1.18) + Static (TL2.3-TL2.4) | 高 -- MCP 层全覆盖 |
| L3b: KEYWORD EXTRACTION | \| 连接 2-4 术语 | Unit (TL1.6) + Static (TL2.5) | 高 |
| L3c: ROUND 1 list_rules | 元数据查询 | Unit (TL1.8, TL1.9, TL1.13, TL1.16) + Static (TL2.6) | 高 |
| L3d: ROUND 2 SCORING | subagent 并行评分 | Static (TL2.7 验证评分指令) | 低 -- LLM 行为不可自动测试 |
| L3e: COLLECT/RANK | Top-N + 阈值 + 自愈 | Unit (TL1.11) + Static (TL2.8) | 中 |
| L4: COMPRESS/FORMAT | 压缩与格式化 | Static (TL2.9, TL2.10) | 中 -- 模板可验证，执行不可测试 |
| L5: RETURN TO L | 上下文隔离 | E2E (TL3.5) + Static (TL2.11) | 中 |
| L6a: ERROR REPORT | L 提交错误报告 | Static (TL2.12 验证报告格式) | 低 |
| L6b: ESCALATION | O 触发 Reflector | Static (TL2.13) + E2E (TL3.7) | 中 |

### 5.2 按 CHECKER 维度覆盖

| 检查维度 | 测试方式 | 覆盖程度 |
|----------|---------|---------|
| Schema: category 枚举 | Static (TC1.1) + Unit (TC1.2, TC1.6, TC1.7) | 高 |
| Schema: intent_tags 必填 | Static (TC1.1) | 中 -- 空串校验为已知 gap |
| Schema: error_summary 长度 | Static (CHECKER.md 包含 <=200 声明) | 低 -- MCP 层无截断逻辑 |
| Schema: id 排除 | Static (TC1.5) | 高 |
| Schema: 缺失字段拒绝 | Unit (TC1.6) | 中 |
| Content: category 错配 | Static (TC2.1) | 中 -- 文档覆盖，执行不可测试 |
| Content: intent tags 准确性 | Static (TC2.2) | 中 |
| Content: error summary 质量 | Static (TC2.3) | 中 |
| Content: failed skill null | Static (TC2.4) | 中 |
| Content: proposed rule 质量 | Static (TC2.5) | 中 |
| Content: Context/Example 一致性 | Static (TC2.6) | 中 |
| Outcome: all-pass -> write | Static (TC3.1, TC3.6) | 高 |
| Outcome: schema fail -> reject | Static (TC3.2) | 高 |
| Outcome: auto-correct | Static (TC3.3) | 中 |
| Outcome: generic rule flag | Static (TC3.4) | 中 |
| Outcome: soft warning | Static (TC3.5) | 中 |

### 5.3 按 Focus 维度覆盖

| 策略 | Static 覆盖 | E2E 覆盖 | 总体 |
|------|------------|---------|------|
| `last` | TF1.1, TF1.4 | live-test.sh (间接) | 高 |
| `after "text"` | TF1.1, TF1.5 | -- | 中 |
| `around N` | TF1.1, TF1.6 | -- | 中 |
| `error` | TF1.1, TF1.7 | -- | 中 |
| `full` | TF1.1, TF1.8 | -- | 中 |
| custom text | TF1.9 | -- | 中 |
| DRAFT 输出格式 | TF1.10, TF1.11 | -- | 高 |

### 5.4 按 State File 维度覆盖

| 维度 | Static 覆盖 | Unit 覆盖 | 总体 |
|------|------------|----------|------|
| Schema (JSON Array) | TS1.1-TS1.3 | -- | 中 |
| 字段完整性 | TS1.2 | -- | 高 (文档) |
| Status 转换 | TS1.7-TS1.9 | -- | 高 (文档) |
| 裁剪 (50 条) | TS1.5 | TS1.6* | 高 |
| target_label 格式 | TS1.10-TS1.11 | -- | 高 (文档) |
| rules_count | TS1.2 | TS1.13* | 高 (文档) |
| 1-indexed 序号 | TS1.14 | -- | 高 (文档) |

*标记: 依赖 state.py 模块。

### 5.5 按 Install Script 维度覆盖

| 维度 | Static 覆盖 | Unit 覆盖 | 总体 |
|------|------------|----------|------|
| 文件复制 | TI1.9 | TI1.2 | 高 |
| Learnings 文件创建 | -- | TI1.5, TI1.7 | 高 |
| 目录创建 | -- | TI1.14 | 高 |
| 幂等性 | -- | TI1.15 | 高 |
| 环境变量覆盖 | TI1.16 | TI1.12 | 高 |
| 不复制 CHECKER.md | TI1.3 | -- | 中 |

### 5.6 已知局限性 (LLM-runtime 行为不可自动测试)

以下行为由 LLM 推理质量决定，无法通过确定性自动化测试覆盖:

1. **L2a 意图推断准确性** -- O 是否能正确从自然语言推断 domain/task_goal
2. **L3d subagent 评分质量** -- subagent 是否能准确评估规则相关性 (1-10 分)
3. **L4a 去重准确性** -- O 是否能正确判断 "相似 error_summary" 并保留最具体的
4. **L4b 压缩质量** -- O 是否能正确提取 Rule/Example section 核心内容
5. **CHECKER 内容验证执行** -- Checker 的 6 条 Content Accuracy 规则的实际执行质量
6. **Category auto-correct 决策** -- O 是否能在 confidence 高时正确 auto-correct category
7. **State file 的 LLM 读写正确性** -- REFLECT.md/REVIEW.md 中 LLM 对 JSON 的读写操作是否无 bug

这些行为只能通过以下方式间接评估:
- 人工 review LLM 输出
- 建立 eval dataset (未来工作)
- 生产环境监控

---

## 6. 实施建议

### 6.1 优先级排序 (实施顺序)

#### Phase 1: P0 核心测试 (建议首先实施)

| 顺序 | 测试集 | 测试数 | 工作量 | 理由 |
|------|--------|--------|--------|------|
| 1 | T7: LEARN.md Static (TL2.1-TL2.16, TL2.18) | 17 | 0.5h | 纯文档断言，快速实施，覆盖 LEARN 协议完整性 |
| 2 | T8: CHECKER.md Static (TC1.1, TC3.1, TC3.2, TC3.6) | 4 | 0.5h | 关键 schema 和 outcome 断言 |
| 3 | TestLearnTools Unit P0 (TL1.1-TL1.6, TL1.8-TL1.9, TL1.13-TL1.15, TL1.18) | 12 | 2h | LEARN 核心检索逻辑 |
| 4 | TestCheckerTools Unit P0 (TC1.2, TC1.6) | 2 | 0.5h | MCP 层 category 约束 |
| 5 | T9: Focus Static P0 (TF1.1-TF1.3, TF1.10-TF1.11) | 5 | 0.5h | Focus 策略完整性 |
| 6 | T10: State Static P0 (TS1.1-TS1.3, TS1.5, TS1.7-TS1.8, TS1.14) | 8 | 1h | State file schema 关键字段 |
| **Phase 1 合计** | | **48** | **~5h** | |

#### Phase 2: P0 安装测试 + P1 补充

| 顺序 | 测试集 | 测试数 | 工作量 | 理由 |
|------|--------|--------|--------|------|
| 7 | TestInstallScript Unit P0 (TI1.2, TI1.5, TI1.7, TI1.14, TI1.15) | 5 | 2h | 安装正确性 |
| 8 | T11: Install Static P0 (TI1.9) | 1 | 0.25h | 安装验证步骤 |
| 9 | TestLearnTools Unit P1 (TL1.5, TL1.7, TL1.10-TL1.12, TL1.16-TL1.17) | 6 | 1h | LEARN 边界条件 |
| 10 | T7/T8 P1 补充 (TL2.13, TL2.17, TC1.5, TC2.1-2.6, TC3.3-3.5) | 10 | 1h | 文档完整性补充 |
| 11 | T9 P1 补充 (TF1.4-TF1.7, TF1.9, TF1.12) | 7 | 0.5h | Focus 策略细节 |
| 12 | T10 P1 补充 (TS1.4, TS1.9-TS1.12) | 4 | 0.5h | State 细节 |
| **Phase 2 合计** | | **33** | **~5.25h** | |

#### Phase 3: E2E + P2 延后项

| 顺序 | 测试集 | 测试数 | 工作量 | 理由 |
|------|--------|--------|--------|------|
| 13 | Learn E2E P0 (TL3.1-TL3.2, TL3.5) | 3 | 2h | 基础 learn 端到端验证 |
| 14 | Learn E2E P1 (TL3.3-TL3.4, TL3.6-TL3.7) | 4 | 2h | 高级 learn 场景 |
| 15 | TF1.8 (full mode token warning) | 1 | -- | P2 |
| 16 | TestCheckerTools Unit P1 (TC1.7) | 1 | 0.25h | 8 category 遍历 |
| 17 | TestInstallScript Unit P1 (TI1.12) | 1 | 0.5h | 环境变量覆盖 |
| **Phase 3 合计** | | **10** | **~5h** | |

### 6.2 与现有测试文件的集成方式

#### test_mcp.py 新增类位置

```
现有结构:
  TestConfig          (line ~20)
  TestEvolution       (line ~98)
  TestModels          (line ~178)
  TestGitOps          (line ~355)
  TestFrontmatter     (line ~429)
  TestMigration       (line ~742)
  TestServerTools     (line ~858)
  TestSyncTools       (line ~1162)
  TestDeltaDecision   (line ~1282)
  TestPathTraversal   (line ~1417)

新增位置:
  TestLearnTools      (TestDeltaDecision 之后, ~line 1412)  -- 18 tests
  TestCheckerTools    (TestLearnTools 之后)                 -- 3 tests
  TestStateFile       (TestCheckerTools 之后)               -- 2 tests (或标记 skip)
  TestInstallScript   (TestStateFile 之后)                  -- 6 tests
```

#### test.sh 新增 section 位置

```
现有结构:
  T1: File Structure       (line ~66)
  T2: SKILL.md Content     (line ~79)
  T2b: Auto-Trigger        (line ~91)
  T2c: File Size           (line ~100)
  T3: Hook Pattern         (line ~122)
  T5: Install Script       (line ~190)
  T6: Architecture         (line ~195)

新增位置:
  T7: LEARN.md Content     (T6 之后, ~line 241)  -- 18 assertions
  T8: CHECKER.md Content   (T7 之后)              -- 14 assertions
  T9: Focus Modes          (T8 之后)              -- 12 assertions
  T10: State File Schema   (T9 之后)              -- 12 assertions
  T11: Install Script Ext  (T5 扩展或 T10 之后)   -- 3 assertions
```

#### live-test.sh 扩展位置

在现有 Step 4 (Trigger /aristotle) 之后新增 Step 5-6:
- Step 5: Pre-seed verified rules via MCP
- Step 6: Learn flow tests (7 scenarios)

### 6.3 前置依赖

| 依赖 | 影响的测试 | 当前状态 | 建议 |
|------|-----------|---------|------|
| `aristotle_mcp/state.py` 模块 | TS1.6, TS1.13 (State unit tests) | 不存在 | 先标记为 skip; 后续提取 state 管理逻辑时取消 skip |
| LEARN.md 文件存在 | TL2.1-TL2.18 (全部 LEARN static) | 已存在 | 无阻塞 |
| CHECKER.md 文件存在 | TC1.1-TC3.6 (全部 CHECKER static) | 已存在 | 无阻塞 |
| REFLECTOR.md/REFLECT.md 存在 | TF1.1-TF1.12 (全部 Focus static) | 已存在 | 无阻塞 |
| install.sh 可执行 | TI1.2-TI1.15 (全部 Install tests) | 已存在 | 无阻塞 |

### 6.4 已知 Gaps 与设计决策

| Gap | 影响 | 建议 |
|-----|------|------|
| State management 无 Python 代码 | TS1.6, TS1.13 无法直接测试 | 推荐: 在 `aristotle_mcp/state.py` 中代码化 state 读写逻辑 |
| error_summary 长度校验缺失 | CHECKER.md 声明 <=200 字符，但 write_rule 无截断 | 需决定: MCP 层增加截断 or CHECKER 文档层面修正 |
| intent_tags 空 string 校验缺失 | CHECKER.md 声明 domain/task_goal 必须非空，write_rule 不校验 | 需决定: MCP 层增加校验 or 记录为已知 gap |
| keyword 大小写敏感 | TL1.17 依赖 stream_filter_rules 的大小写行为 | 需验证: 当前实现是否已支持 case-insensitive |
| E2E 测试 LLM 输出不稳定 | TL3.5, TL3.6 的断言可能因 LLM 输出变化而失败 | 使用宽松匹配 (grep -i + 关键词) 而非精确匹配 |

### 6.5 测试执行命令

```bash
# Phase 1-2: Static + Unit
bash test.sh                                              # 67 + 59 = 126 assertions
uv run pytest test/test_mcp.py -v                         # 111 + ~29 = ~140 assertions

# Phase 3: E2E
bash test/live-test.sh --model <provider/model>           # 8 + ~15 = ~23 assertions

# 全量执行
bash test.sh && uv run pytest test/test_mcp.py -v && bash test/live-test.sh --model <model>
```

---

## 附录 A: 与现有测试的映射关系

### A.1 已有测试对 LEARN 底层功能的覆盖

| LEARN STEP | 依赖的 MCP 操作 | 已有测试 | 覆盖程度 |
|------------|-----------------|---------|---------|
| L3c (Round 1: list_rules) | list_rules + stream_filter_rules | TestServerTools.test_list_rules, test_list_rules_multi_dimension_search, test_list_rules_returns_no_content; TestFrontmatter 全部 stream_filter 测试 | 高 |
| L3d (Round 2: load_rule_file) | load_rule_file (subagent 调用) | TestFrontmatter.test_write_and_load | 中 |
| L3e (自愈) | check_sync_status + sync_rules | TestSyncTools 全部 7 个测试 | 高 |
| L6b (规则状态更新) | stage_rule + commit_rule | TestServerTools.test_stage_rule, test_commit_rule, test_full_lifecycle | 高 |
| L3a (参数构建) | write_rule (GEAR 2.0 字段) | TestServerTools.test_write_rule_with_gear2_fields, test_write_rule_with_intent_domain_only; TestFrontmatter 全部 intent_tags 测试 | 高 |

### A.2 新增测试不重复已有测试

新增 TestLearnTools 专注于 LEARN 协议特有的调用模式:
- TL1.1-TL1.2: 验证 status="verified" 过滤 (已有 TestFrontmatter.test_stream_filter_by_status 测试底层 stream_filter，但未测试 server 层 list_rules 的组合行为)
- TL1.3-TL1.5: 验证多维度 AND 组合 (已有 TestServerTools.test_list_rules_multi_dimension_search，但 TL1.x 聚焦 LEARN 场景的参数组合)
- TL1.6: 验证 regex OR keyword (已有 TestServerTools.test_read_rules_keyword，但 TL1.6 使用 `\|` 语法)
- TL1.9: 验证 list_rules 不返回 content (已有 TestServerTools.test_list_rules_returns_no_content，TL1.9 补充 metadata 字段完整性检查)
