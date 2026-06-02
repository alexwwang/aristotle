# Aristotle LEARN 协议测试技术方案

> 版本: 1.0 | 日期: 2026-04-21 | 状态: Draft

## 目录

1. [现状分析](#1-现状分析)
2. [测试目标](#2-测试目标)
3. [测试策略](#3-测试策略)
4. [测试用例清单](#4-测试用例清单)
5. [与现有测试的集成](#5-与现有测试的集成)

---

## 1. 现状分析

### 1.1 LEARN.md 协议概览

LEARN.md (246 行) 定义了 Aristotle 的 "coordinator learn phase"。它由 O (Orchestrator) 执行，负责从规则库中检索与当前任务相关的经验教训，压缩后注入 L (Learner) 的上下文。核心约束是 **上下文隔离** -- L 永远不接触 MCP、frontmatter、read_rules 等基础设施细节。

LEARN.md 的执行流程分为 6 个 STEP (L1-L6)，涉及两种 MCP 工具的调用 (`list_rules`, `read_rules`)，以及一个底层搜索引擎 (`stream_filter_rules`)。

### 1.2 STEP L1: RECEIVE LEARNING REQUEST -- 请求接收

**协议行为:**
- 接收四种触发场景: `/aristotle learn` 命令、`--domain X --goal Y` 参数化调用、自然语言查询、P3.3 被动监控信号
- 输入为自然语言字符串或显式 `--domain`/`--goal` 标志

**可测试性:** L1 本身是路由逻辑，由 SKILL.md 的命令解析完成。LEARN.md 不执行解析，只声明输入格式。无法在 MCP 工具层面直接测试；需要在 E2E 层面验证 SKILL.md 正确路由到 LEARN.md。

**依赖的 MCP 工具:** 无。

### 1.3 STEP L2: EXTRACT INTENT -- 意图提取 (O 的角色)

**协议行为:**
- L2a: O 从 L 的自然语言请求中推断结构化 intent_tags (domain, task_goal, failed_skill, error_context)
- L2b: 使用固定映射表将关键词信号映射到 domain (8 个类别: file_operations, api_integration, database_operations, code_generation, build_system, testing, deployment, general)
- L2c: 阈值评估 -- domain 非空可继续查询；domain 为空但 error_context 非空使用 keyword 参数；两者都空则告知 L 并 STOP

**可测试性:** L2 是 LLM 推理行为，无法通过传统单元测试覆盖。但 L2b 的 domain 映射表可以静态断言其存在于 LEARN.md 中。L2c 的阈值逻辑可以在协议内容层面断言。

**依赖的 MCP 工具:** 无直接依赖。但 L2c 的 keyword fallback 路径最终影响 L3 中 `stream_filter_rules` 的 `keyword` 参数。

### 1.4 STEP L3: CONSTRUCT QUERY -- 查询构建 (S 函数)

**协议行为:**
- L3a: 构建 `read_rules()` 参数字典，status 固定为 `"verified"`，附加 intent_domain、intent_task_goal、failed_skill、keyword 等
- L3b: 从 error_context 提取 2-4 个核心技术名词，用 `|` 连接为 regex OR 模式
- L3c: **Round 1** -- 调用 `list_rules(**params)` 获取路径 + frontmatter (无 content body)
- L3d: **Round 2** -- O 为每个候选规则生成一个 subagent，每个 subagent 读取一个规则文件并评分 (1-10)
- L3e: 收集评分结果，按分数降序排列，取 top `MAX_LEARN_RESULTS` (默认 5)，丢弃评分低于 3 的规则

**依赖的 MCP 工具:**
- `list_rules` (Round 1): 轻量元数据查询，底层调用 `stream_filter_rules` + `read_frontmatter_raw`
- `load_rule_file` (Round 2, 由 subagent 调用): 读取完整规则文件
- `check_sync_status` + `sync_rules` (L3e 可选): 自愈机制

**现有测试覆盖:**
- `TestFrontmatter.test_stream_filter_by_status/category/keyword/limit` -- 已覆盖 status、category、keyword、limit 维度
- `TestFrontmatter.test_stream_filter_by_intent_domain/task_goal/failed_skill/error_summary` -- 已覆盖 GEAR 2.0 的 4 个检索维度
- `TestFrontmatter.test_stream_filter_multi_dimension_combined` -- 已覆盖多维度组合查询
- `TestFrontmatter.test_stream_filter_no_intent_tags_field` -- 已覆盖缺失 intent_tags 的旧规则兼容
- `TestServerTools.test_list_rules` -- 已覆盖 list_rules 基本功能
- `TestServerTools.test_list_rules_multi_dimension_search` -- 已覆盖 list_rules 多维度检索 (intent_domain, failed_skill, error_summary)
- `TestServerTools.test_list_rules_returns_no_content` -- 已覆盖 list_rules 不返回 content body
- `TestServerTools.test_read_rules_keyword` -- 已覆盖 keyword regex 搜索
- `TestServerTools.test_read_rules_multi_dimension_search` -- 已覆盖 read_rules 多维度检索

### 1.5 STEP L4: COMPRESS AND FORMAT -- 压缩与格式化 (O 的角色)

**协议行为:**
- L4a: 同 category 内去重 -- 如果多个规则有相似 error_summary，保留最具体的
- L4b: 压缩摘要 -- 提取 metadata.error_summary、content 中的 Rule/Example section、metadata.id
- L4c: 输出格式 -- 固定的 Markdown 模板，包含 error_summary、Avoid 建议、correct/wrong 示例、Rule ID

**可测试性:** L4 是 LLM 内容处理行为。L4c 的输出格式模板可以在协议内容层面静态断言。

**依赖的 MCP 工具:** 无新增依赖。使用 subagent 返回的数据。

### 1.6 STEP L5: RETURN TO L -- 返回结果

**协议行为:**
- 将压缩摘要传递给 L
- L 收到的内容不含基础设施细节
- L 负责根据 error_summary、Avoid 约束、correct/wrong 示例、Rule ID 行动

**可测试性:** 需要在 E2E 层面验证 L 的上下文中不包含 MCP 调用细节。

**依赖的 MCP 工具:** 无。

### 1.7 STEP L6: ERROR FEEDBACK ESCALATION -- 错误反馈升级

**协议行为:**
- L6a: L 提交 error scene report (intent_tags, failed_skill, applied_rules, error_description)
- L6b: O 标记对应规则为 `needs_sync`，触发新的 Reflector subagent 生成改进规则提案

**可测试性:** L6b 涉及跨协议调用 (LEARN -> REFLECT)。`needs_sync` 状态更新可通过 `update_frontmatter_field` 测试。完整的 escalation 路径需要 E2E 测试。

**依赖的 MCP 工具:** `stage_rule`, `commit_rule` (规则状态更新)

### 1.8 Learn Mode Permissions

**协议行为:**
- 允许: 调用 MCP 工具、解析/过滤结果、返回压缩摘要、接收 error scene report、触发 Reflector subagent、更新规则状态
- 禁止: 向 L 暴露 MCP 调用细节、返回原始规则内容、向 L 的上下文加载 LEARN.md、直接修改规则内容

**可测试性:** 权限声明可在协议内容层面静态断言。实际遵守情况需要 E2E 测试。

### 1.9 底层依赖关系总结

```
LEARN.md (协议层)
  |
  +-- STEP L3c: list_rules()          --> stream_filter_rules() + read_frontmatter_raw()
  +-- STEP L3d: load_rule_file()      --> frontmatter.load()
  +-- STEP L3e: check_sync_status()   --> stream_filter_rules() + git_show_exists()
  +-- STEP L3e: sync_rules()          --> git add + commit
  +-- STEP L6b: stage_rule()          --> update_frontmatter_field()
  +-- STEP L6b: commit_rule()         --> write_rule_file() + git add + commit
```

核心搜索引擎 `stream_filter_rules` (frontmatter.py) 支持以下检索维度:

| 维度 | 参数名 | 匹配方式 | 现有测试覆盖 |
|------|--------|----------|-------------|
| 状态 | `status_filter` | 精确匹配 | TestFrontmatter (3 tests) |
| 分类 | `category` | 精确匹配 | TestFrontmatter (1 test) |
| 关键词 | `keyword` | regex OR (全 frontmatter 值) | TestFrontmatter (1 test) |
| 意图域 | `intent_domain` | regex (intent_tags.domain) | TestFrontmatter (1 test) |
| 任务目标 | `intent_task_goal` | regex (intent_tags.task_goal) | TestFrontmatter (1 test) |
| 失败技能 | `failed_skill` | regex | TestFrontmatter (1 test) |
| 错误摘要 | `error_summary` | regex | TestFrontmatter (1 test) |
| 数量限制 | `limit` | 截断 | TestFrontmatter (1 test) |
| 多维组合 | 多参数同时 | AND 语义 | TestFrontmatter (1 test) |

---

## 2. 测试目标

### 2.1 可以直接测试的行为 (MCP 工具层面)

以下行为可通过 pytest 直接测试，因为它们有明确的输入/输出契约:

1. **list_rules 的多维度检索** -- 已有部分覆盖，需要补充边界条件和 LEARN 特定场景
2. **read_rules 的多维度检索** -- 已有部分覆盖，需要补充 keyword regex 组合测试
3. **stream_filter_rules 的 LEARN 调用模式** -- status="verified" + intent_domain + intent_task_goal + failed_skill 组合
4. **list_rules 不返回 content body** -- 已覆盖，需要扩展验证 metadata 字段完整性
5. **check_sync_status / sync_rules** -- 已覆盖，LEARN 的自愈路径复用现有测试
6. **Multi-scope 检索** (user + project) -- list_rules/read_rules 的 `scope="all"` 路径
7. **LEARN 默认 status="verified" 约束** -- 验证检索结果不包含 pending/staging 规则

### 2.2 需要协议层面测试的行为 (LEARN.md 内容断言)

以下行为无法通过单元测试覆盖，但可以验证 LEARN.md 包含正确的指令:

1. **L2b domain 映射表** -- 验证 LEARN.md 包含全部 8 个 domain 类别
2. **L3a 参数构建模板** -- 验证 LEARN.md 包含正确的 params 构建逻辑
3. **L3b keyword 提取策略** -- 验证 LEARN.md 包含 keyword 提取示例
4. **L3d subagent prompt 模板** -- 验证 LEARN.md 包含评分指令
5. **L3e 评分阈值和 MAX_LEARN_RESULTS** -- 验证 LEARN.md 包含丢弃阈值 (3) 和默认值 (5)
6. **L4c 输出格式模板** -- 验证 LEARN.md 包含格式模板和无结果时的提示
7. **L6a error scene report 格式** -- 验证 LEARN.md 包含报告模板
8. **Learn Mode Permissions** -- 验证 LEARN.md 包含权限白名单和黑名单
9. **MAX_LEARN_RESULTS 可调参数** -- 验证 LEARN.md 声明此参数及默认值

### 2.3 需要 E2E 测试的行为

以下行为涉及 LLM 推理或多 agent 协调，只能在完整运行时验证:

1. **L1 路由** -- SKILL.md 正确解析 `/aristotle learn` 并加载 LEARN.md
2. **L2 意图提取** -- O 正确从自然语言推断 domain/task_goal
3. **L3d 并行评分** -- subagent 正确读取规则并返回 {score, reason} JSON
4. **L4 压缩** -- O 正确压缩规则内容为摘要格式
5. **L5 上下文隔离** -- L 的响应中不包含 MCP/frontmatter/read_rules 等关键词
6. **L6 escalation** -- L 提交 error scene report 后 O 触发 Reflector

---

## 3. 测试策略

### 3.1 Layer 1: MCP 工具测试 (pytest)

**目标:** 测试 LEARN 协议依赖的 MCP 工具在 LEARN 使用模式下的正确性。

**框架:** `test/test_mcp.py` 中新增 `TestLearnTools` 类。

**原则:**
- 测试 LEARN 协议的 MCP 调用模式，而非重复已有测试
- 聚焦于 LEARN 特有的参数组合和边界条件
- 复用现有 `tmp_repo` fixture

**覆盖范围:**

| 测试目标 | MCP 工具 | 测试方式 |
|----------|----------|----------|
| list_rules + status="verified" | list_rules | 创建 pending/verified 规则，验证只返回 verified |
| list_rules 多维度 AND 组合 | list_rules | 创建多维规则，验证 AND 语义 |
| read_rules + keyword regex | read_rules | 使用 `|` 连接的 regex，验证 OR 匹配 |
| list_rules metadata 完整性 | list_rules | 验证返回的 metadata 包含 GEAR 2.0 全字段 |
| read_rules scope="all" 跨 scope | read_rules | 同时创建 user + project 规则 |
| LEARN 自愈路径 | check_sync_status + sync_rules | 验证 L3e 可选步骤的完整工作流 |
| list_rules + category 组合 | list_rules | 验证 category 精确匹配与多维度组合 |
| read_rules 不返回 rejected | read_rules | 验证 status="verified" 不包含 rejected 规则 |

### 3.2 Layer 2: 协议内容测试 (test.sh 扩展)

**目标:** 验证 LEARN.md 文件包含正确的协议指令和约束声明。

**框架:** `test.sh` 中新增 `T7: LEARN.md Protocol Content` section。

**原则:**
- 使用 `assert_contains` / `assert_not_contains` 断言 LEARN.md 的内容
- 不验证 LLM 行为，只验证协议文档的完备性
- 每个 STEP 对应一组断言

**覆盖范围:**

| 断言目标 | 验证内容 |
|----------|----------|
| STEP 标签 | LEARN.md 包含 L1-L6 全部 6 个 STEP |
| L2b domain 表 | 包含全部 8 个 domain 类别的映射 |
| L3a 参数模板 | 包含 `status: "verified"` 和参数构建逻辑 |
| L3b keyword 策略 | 包含 `|` 连接和 2-4 术语约束 |
| L3d 评分 | 包含 1-10 评分和 subagent prompt 模板 |
| L3e 阈值 | 包含 score < 3 丢弃和 MAX_LEARN_RESULTS=5 |
| L4c 格式 | 包含输出模板和 "No relevant lessons" fallback |
| L6a 格式 | 包含 error scene report 格式 |
| Permissions | 包含 allowed/denied 权限列表 |
| 隔离约束 | 包含 context isolation 声明 |
| 可调参数 | 包含 MAX_LEARN_RESULTS 默认值 |

### 3.3 Layer 3: E2E 测试 (live-test.sh 扩展)

**目标:** 在实际 OpenCode session 中验证完整的 learn 流程。

**框架:** `test/live-test.sh` 中新增 learn 相关的断言。

**原则:**
- 需要预置 verified 规则到 test repo
- 验证 `/aristotle learn` 命令的完整执行路径
- 验证输出格式和上下文隔离

**覆盖范围:**

| 测试场景 | 验证内容 |
|----------|----------|
| 基础 learn 触发 | `/aristotle learn` 正确触发并返回结果 |
| 参数化 learn | `--domain database --goal connection_pool` 正确检索 |
| 自然语言 learn | 自由文本查询正确推断意图并检索 |
| 无匹配结果 | 返回 "No relevant lessons" 提示 |
| 上下文隔离 | L 的响应不含 MCP/frontmatter 等关键词 |

---

## 4. 测试用例清单

### 4.1 Layer 1: MCP 工具测试 (pytest -- TestLearnTools)

| ID | 描述 | 预期行为 | 优先级 | 类型 |
|----|------|----------|--------|------|
| TL1.1 | list_rules status="verified" 只返回已验证规则 | 创建 1 pending + 1 verified 规则，list_rules(status_filter="verified") 只返回 1 条 | P0 | unit |
| TL1.2 | list_rules status="verified" 排除 staging 规则 | 创建 1 staging + 1 verified 规则，list_rules(status_filter="verified") 只返回 1 条 | P0 | unit |
| TL1.3 | list_rules 多维度 AND: domain + task_goal | 创建 2 条规则 (domain=db+goal=migration, domain=db+goal=seeding)，intent_domain="database" + intent_task_goal="migration" 只返回第 1 条 | P0 | unit |
| TL1.4 | list_rules 多维度 AND: domain + failed_skill | 创建 2 条规则 (domain=db+skill=prisma, domain=db+skill=sequelize)，intent_domain="database" + failed_skill="prisma" 只返回第 1 条 | P0 | unit |
| TL1.5 | list_rules 多维度 AND: domain + error_summary | 创建 2 条规则，intent_domain="database" + error_summary="timeout" 返回匹配的 1 条 | P1 | unit |
| TL1.6 | read_rules keyword 使用 regex OR | 创建规则 source_session="ses_abc"，read_rules(status="pending", keyword="ses_abc\|ses_xyz") 返回 1 条 | P0 | unit |
| TL1.7 | read_rules status="verified" 不返回 rejected | 创建 verified + rejected 各 1 条，read_rules(status="verified") 只返回 1 条 | P0 | unit |
| TL1.8 | list_rules metadata 包含 GEAR 2.0 全字段 | 创建带 GEAR 2.0 字段的规则，list_rules 返回的 metadata 包含 intent_tags, failed_skill, error_summary | P0 | unit |
| TL1.9 | list_rules 不返回 content body | list_rules 的 rules[0] 不含 "content" key | P0 | unit |
| TL1.10 | read_rules scope="all" 跨 scope 检索 | 创建 user + project 规则各 1 条，read_rules(scope="all", status="pending") 返回 2 条 | P1 | unit |
| TL1.11 | LEARN 自愈: unsynced verified 被检测和修复 | 创建 verified 规则但未 git commit，check_sync_status 检测到 1 条，sync_rules 修复后 unsynced_count=0 | P1 | unit |
| TL1.12 | list_rules category + domain 组合 | 创建 category=HALLUCINATION+domain=db 和 category=HALLUCINATION+domain=api，category="HALLUCINATION" + intent_domain="database" 只返回 1 条 | P1 | unit |
| TL1.13 | list_rules 空 repo 返回 0 结果 | 空 repo 中 list_rules 返回 count=0, rules=[] | P0 | unit |
| TL1.14 | read_rules 无匹配维度返回空 | read_rules(intent_domain="nonexistent") 返回 count=0 | P0 | unit |
| TL1.15 | stream_filter_rules 对旧规则 (无 intent_tags) 的兼容 | 无 intent_tags 的规则在 intent_domain 过滤时被排除 | P0 | unit |
| TL1.16 | list_rules limit 参数正确截断 | 创建 10 条规则，list_rules(limit=3) 返回 3 条 | P1 | unit |
| TL1.17 | keyword regex 大小写不敏感 | 规则 frontmatter 含 "Prisma"，keyword="prisma" 可匹配 | P1 | unit |
| TL1.18 | intent_task_goal 部分匹配 | intent_tags.task_goal="connection_pool_management"，intent_task_goal="pool" 可匹配 | P0 | unit |

### 4.2 Layer 2: 协议内容测试 (test.sh -- T7 section)

| ID | 描述 | 预期行为 | 优先级 | 类型 |
|----|------|----------|--------|------|
| TL2.1 | LEARN.md 包含 L1-L6 全部 STEP | 文件包含 "STEP L1" 到 "STEP L6" | P0 | static |
| TL2.2 | L2b 包含 8 个 domain 类别 | 文件包含 file_operations, api_integration, database_operations, code_generation, build_system, testing, deployment, general | P0 | static |
| TL2.3 | L3a 包含 status="verified" 约束 | 文件包含 `status: "verified"` 或等价表达 | P0 | static |
| TL2.4 | L3a 包含参数构建逻辑 | 文件包含 intent_domain, intent_task_goal, failed_skill, keyword 的参数构建代码 | P0 | static |
| TL2.5 | L3b 包含 keyword 提取策略 | 文件包含 `|` 连接和 "2-4 terms" 或 "2-3 core technical nouns" | P0 | static |
| TL2.6 | L3c 包含 list_rules 调用指令 | 文件包含 "list_rules" 和 "metadata-only" 或 "no content bodies" | P0 | static |
| TL2.7 | L3d 包含 subagent 评分机制 | 文件包含 "1-10" 评分范围和 subagent prompt 模板 | P0 | static |
| TL2.8 | L3e 包含评分阈值 | 文件包含 score < 3 丢弃逻辑和 MAX_LEARN_RESULTS 默认值 5 | P0 | static |
| TL2.9 | L4c 包含输出格式模板 | 文件包含 "Found N relevant lessons" 格式和 error_summary/Avoid/Rule ID 模板 | P0 | static |
| TL2.10 | L4c 包含无结果 fallback | 文件包含 "No relevant lessons found" 提示和 --domain/--goal 建议 | P0 | static |
| TL2.11 | L5 包含上下文隔离约束 | 文件包含 "No infrastructure details" 或等价的隔离声明 | P0 | static |
| TL2.12 | L6a 包含 error scene report 格式 | 文件包含 applied_rules 和 error_description 字段 | P0 | static |
| TL2.13 | L6b 包含 escalation 路径 | 文件包含 Reflector subagent 触发和规则状态更新逻辑 | P1 | static |
| TL2.14 | Permissions 包含白名单 | 文件包含 "read_rules" 或 "list_rules" 在 allowed 列表中 | P0 | static |
| TL2.15 | Permissions 包含黑名单 | 文件包含禁止 "Expose MCP call details" 和 "Return raw rule file content" | P0 | static |
| TL2.16 | 包含 MAX_LEARN_RESULTS 可调参数声明 | 文件包含 "MAX_LEARN_RESULTS" 和 "default: 5" | P0 | static |
| TL2.17 | LEARN.md 文件大小在合理范围 | LEARN.md 行数 <= 300 | P1 | static |
| TL2.18 | 包含 context isolation 核心约束声明 | 文件包含 "Core constraint: context isolation" 或等价表述 | P0 | static |

### 4.3 Layer 3: E2E 测试 (live-test.sh 扩展)

| ID | 描述 | 预期行为 | 优先级 | 类型 |
|----|------|----------|--------|------|
| TL3.1 | 基础 `/aristotle learn` 触发 | 命令执行成功，返回包含 "relevant lessons" 或 "No relevant lessons" 的响应 | P0 | e2e |
| TL3.2 | 参数化 learn 正确检索 | `/aristotle learn --domain database --goal connection_pool` 返回匹配规则 | P0 | e2e |
| TL3.3 | 自然语言 learn 正确推断 | "之前做数据库迁移踩过坑吗?" 触发 learn 并返回相关规则 | P1 | e2e |
| TL3.4 | 无匹配结果返回 fallback | 查询不存在的 domain，返回 "No relevant lessons" + 建议 | P1 | e2e |
| TL3.5 | L 上下文隔离 | L 的响应中不包含 "MCP"、"frontmatter"、"read_rules"、"list_rules"、"stream_filter" 关键词 | P0 | e2e |
| TL3.6 | 输出格式正确 | 返回的格式包含 [CATEGORY]、error_summary、Avoid、correct/wrong 示例、Rule ID | P1 | e2e |
| TL3.7 | L6 escalation 触发 | L 在 learn 后仍犯错时提交 error scene report，O 触发新的 Reflector | P1 | e2e |

---

## 5. 与现有测试的集成

### 5.1 已有测试对 LEARN 底层功能的覆盖

LEARN 协议依赖的 MCP 工具已有大量测试覆盖。以下列出现有测试与 LEARN STEP 的映射关系:

| LEARN STEP | 依赖的 MCP 操作 | 现有测试覆盖 | 覆盖程度 |
|------------|-----------------|-------------|---------|
| L3c (Round 1: list_rules) | list_rules + stream_filter_rules | TestServerTools.test_list_rules, test_list_rules_multi_dimension_search, test_list_rules_returns_no_content; TestFrontmatter 全部 stream_filter 测试 | 高 -- 基本功能全覆盖 |
| L3d (Round 2: load_rule_file) | load_rule_file (由 subagent 调用) | TestFrontmatter.test_write_and_load | 中 -- 基础读写覆盖 |
| L3e (自愈) | check_sync_status + sync_rules | TestSyncTools 全部 7 个测试 | 高 -- 完整覆盖 |
| L6b (规则状态更新) | stage_rule + commit_rule | TestServerTools.test_stage_rule, test_commit_rule, test_full_lifecycle | 高 -- 完整覆盖 |
| L3a (参数构建) | write_rule (GEAR 2.0 字段) | TestServerTools.test_write_rule_with_gear2_fields, test_write_rule_with_intent_domain_only; TestFrontmatter 全部 intent_tags 测试 | 高 -- 字段读写全覆盖 |

### 5.2 新增测试在现有文件中的组织方式

#### 5.2.1 test_mcp.py 新增 TestLearnTools 类

在 `TestDeltaDecision` 类之后 (约 line 1412) 新增:

```python
# ═══════════════════════════════════════════════════════
# Learn tools (LEARN.md L3 support)
# ═══════════════════════════════════════════════════════
class TestLearnTools:
    """Tests for MCP operations used by the LEARN protocol.

    Focuses on LEARN-specific calling patterns:
    - status="verified" constraint
    - Multi-dimension AND combinations
    - list_rules (metadata-only) vs read_rules (full content)
    - keyword regex OR matching
    - Scope="all" cross-scope retrieval
    """
```

预计新增 18 个测试方法 (TL1.1-TL1.18)，约 150-200 行代码。

#### 5.2.2 test.sh 新增 T7 section

在 `T6: Architecture Guarantees` section 之后 (约 line 241) 新增:

```bash
# ═══ T7: LEARN.md Protocol Content ═══
info "T7: LEARN.md Protocol Content"; sep
```

预计新增 18 个断言 (TL2.1-TL2.18)，约 30-40 行脚本。

#### 5.2.3 live-test.sh 扩展

在现有 live-test.sh 中新增 learn 相关的测试场景和断言 (TL3.1-TL3.7)。需要:
- 预置 verified 规则到 test repo
- 发送 `/aristotle learn` 命令
- 验证响应格式和内容

### 5.3 测试矩阵总览

| 层级 | 文件 | 新增测试数 | 新增断言数 | 依赖 |
|------|------|-----------|-----------|------|
| Layer 1 (unit) | test/test_mcp.py | 18 tests | ~40 assertions | pytest, tmp_path |
| Layer 2 (static) | test.sh | 18 assertions | 18 assertions | bash, grep |
| Layer 3 (e2e) | test/live-test.sh | 7 tests | ~15 assertions | OpenCode session |
| **合计** | | **43** | **~73** | |

### 5.4 测试执行优先级建议

**P0 (必须实现):**
- TL1.1-TL1.6, TL1.8-TL1.9, TL1.13-TL1.15, TL1.18 (Layer 1 核心检索)
- TL2.1-TL2.16, TL2.18 (Layer 2 协议完备性)
- TL3.1-TL3.2, TL3.5 (Layer 3 基础功能)

**P1 (重要但可延后):**
- TL1.7, TL1.10-TL1.12, TL1.16-TL1.17 (Layer 1 边界条件)
- TL2.17 (Layer 2 文件大小)
- TL3.3-TL3.4, TL3.6-TL3.7 (Layer 3 高级场景)

### 5.5 无法测试的行为

以下行为由 LLM runtime 决定，无法通过确定性测试覆盖:

1. **L2a 意图推断的准确性** -- O 是否能正确从 "之前做数据库迁移踩过坑吗?" 推断出 domain=database_operations
2. **L3d subagent 评分质量** -- subagent 是否能准确评估规则相关性
3. **L4a 去重准确性** -- O 是否能正确判断 "相似 error_summary" 并保留最具体的
4. **L4b 压缩质量** -- O 是否能正确提取 Rule/Example section 的核心内容

这些行为只能通过人工 review 或建立 eval dataset 来评估，不在本测试方案的自动化测试范围内。
