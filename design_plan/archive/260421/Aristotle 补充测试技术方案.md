# Aristotle 补充测试技术方案

> 覆盖 CHECKER.md、Focus Modes、State File、Install Script 四个测试盲区

当前测试覆盖: test.sh (67 static assertions) + test_mcp.py (111 pytest assertions) + live-test.sh (8 E2E assertions)。以下四个领域测试为零或极薄。

---

## Part A: CHECKER.md 测试技术方案

CHECKER.md 定义两阶段验证: Schema Compliance (3 规则) + Content Accuracy (6 规则)，最终产生 4 种 Validation Outcome。它作为纯协议文档由 LLM 在 REVIEW 阶段按文字执行，不是可调用函数。因此测试策略分两层:

- **Static**: 验证协议文档本身的完整性 (术语、枚举值、结构)
- **Unit (pytest)**: 验证 MCP 层 schema 约束是否与 CHECKER.md 一致

### A.1 Schema Compliance Tests

| TC ID | Description | Expected Behavior | Priority | Type |
|-------|-------------|-------------------|----------|------|
| TC1.1 | Valid categories enumeration | CHECKER.md 引用的 8 个 category 与 REFLECTOR.md R3 定义完全一致: MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR | P0 | static |
| TC1.2 | Valid categories match config | CHECKER.md 列出的 categories 与 `config.py` 的 RISK_MAP keys 一致 | P0 | unit |
| TC1.3 | `intent_tags` required sub-fields | CHECKER.md 声明 `intent_tags.domain` 和 `intent_tags.task_goal` 必须非空; `write_rule` 在 `intent_domain=""` 时不拒绝 (当前不校验空字符串) | P1 | unit |
| TC1.4 | `error_summary` length bound | CHECKER.md 声明 <=200 字符，软警告 auto-truncate。当前 MCP `write_rule` 无长度校验 | P1 | unit |
| TC1.5 | `id` field exclusion | CHECKER.md 明确声明 Checker 不验证 `id` (由 `write_rule` MCP 自动生成，格式 `rec_{timestamp}`) | P1 | static |
| TC1.6 | Schema reject on missing required fields | 当 category 不在有效集合、intent_tags.domain 为空、task_goal 为空时，必须硬拒绝 | P0 | unit |

### A.2 Content Accuracy Tests

| TC ID | Description | Expected Behavior | Priority | Type |
|-------|-------------|-------------------|----------|------|
| TC2.1 | Category mismatch examples documented | CHECKER.md 包含 3 对典型错配: HALLUCINATION vs INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE vs SYNTAX_API_ERROR, MISUNDERSTOOD_REQUIREMENT vs ASSUMED_CONTEXT | P1 | static |
| TC2.2 | Intent tags accuracy rules | domain 必须匹配 error 上下文 (如 database migration -> `"database_operations"` 不应写 `"code_generation"`); task_goal 描述用户意图而非错误本身 | P1 | static |
| TC2.3 | Error summary quality criteria | summary 应描述 error scene 而非 root cause; 必须具体可区分; 与 Error Excerpt 一致 | P1 | static |
| TC2.4 | Failed skill null handling | 无具体 tool 导致的 reasoning 错误应为 null，而非猜测 tool name | P1 | static |
| TC2.5 | Proposed rule quality guard | rule 必须直接针对 root cause; 不接受 "be more careful" 类泛化 rule; 必须可验证 (明确 pass/fail) | P1 | static |
| TC2.6 | Context/Example consistency | Context 定义 trigger 条件; Example pass 展示正确行为; Example fail 匹配实际错误 | P1 | static |

### A.3 Validation Outcome Tests

| TC ID | Description | Expected Behavior | Priority | Type |
|-------|-------------|-------------------|----------|------|
| TC3.1 | All-pass -> proceed to MCP write | 当所有 schema + content 检查通过，REVIEW.md STEP V3 执行 write_rule | P0 | static |
| TC3.2 | Schema failure -> hard reject | 缺失 intent_tags.domain/task_goal 或无效 category 时，输出失败字段名并停止 | P0 | static |
| TC3.3 | Content inaccuracy -> auto-correct | Category 错配自动修正; vague error_summary 自动改进; 展示修正内容给用户 | P1 | static |
| TC3.4 | Generic proposed rule -> flag to user | 过度泛化的 rule 不自动修正，而是提示用户提供更具体的表述 | P1 | static |
| TC3.5 | Soft warning -> proceed with note | 轻微不精确不影响 rule 质量，在输出中标注后继续 | P1 | static |
| TC3.6 | REVIEW.md references CHECKER.md on confirm | REVIEW.md STEP V2 在 confirm 时明确要求 "Read `${SKILL_DIR}/CHECKER.md`, execute validation" | P0 | static |

### A.4 实现策略

**Static (test.sh 新增 section T7)**: 6-8 个 assert_contains/assert_not_contains，验证 CHECKER.md 文档完整性与术语一致性:

```
assert_contains CHECKER.md "SCHEMA COMPLIANCE"
assert_contains CHECKER.md "CONTENT ACCURACY"
assert_contains CHECKER.md "VALIDATION OUTCOME"
assert_contains CHECKER.md "MISUNDERSTOOD_REQUIREMENT"   (8 categories 全部出现)
assert_contains CHECKER.md "hard reject"
assert_contains CHECKER.md "auto-correct"
assert_contains CHECKER.md "soft warning"
```

**Unit (test_mcp.py 新增 TestChecker class)**: 3-5 个 pytest 测试，验证 MCP 层 schema 约束:

- `test_write_rule_rejects_invalid_category`: `write_rule(category="INVALID")` 应失败
- `test_write_rule_valid_categories`: 遍历 8 个有效 category，全部成功
- `test_error_summary_length_acceptance`: 当前无截断逻辑，记录为已知 gap
- `test_intent_domain_empty_string_accepted`: 当前不校验空字符串，记录为已知 gap
- `test_risk_map_covers_all_categories`: RISK_MAP 包含全部 8 category

**E2E**: CHECKER.md 的实际执行依赖 LLM 推理，无法用确定性断言覆盖。通过 live-test.sh 的 confirm 流程间接验证 (已超出当前 scope)。

---

## Part B: Focus Mode 测试技术方案

SKILL.md 和 REFLECTOR.md 定义 5 种 focus 策略 + 1 种自定义文本策略。当前仅 `last` 通过 live-test.sh 间接覆盖。

### B.1 Focus Strategy 覆盖矩阵

| Strategy | 定义位置 | 当前测试 | 缺口 |
|----------|---------|---------|------|
| `last` | REFLECTOR.md R1a table | live-test.sh (间接) | 无静态断言 |
| `after "text"` | REFLECTOR.md R1a table | 无 | 完全未覆盖 |
| `around N` | REFLECTOR.md R1a table | 无 | 完全未覆盖 |
| `error` | REFLECTOR.md R1a table | 无 | 完全未覆盖 |
| `full` | REFLECTOR.md R1a table | 无 | 完全未覆盖 |
| custom text | REFLECTOR.md R1a table | 无 | 完全未覆盖 |

### B.2 Test Cases

| TC ID | Description | Expected Behavior | Priority | Type |
|-------|-------------|-------------------|----------|------|
| TF1.1 | All 5 strategies documented | REFLECTOR.md R1a table 包含 `last`, `after "text"`, `around N`, `error`, `full` 五行 | P0 | static |
| TF1.2 | SKILL.md references focus options | SKILL.md `--focus` 参数说明包含 5 种策略名 | P0 | static |
| TF1.3 | REFLECT.md focus_hint param list | REFLECT.md F1 列出全部 focus_hint 选项 | P0 | static |
| TF1.4 | `last` default behavior | REFLECTOR.md 声明 `last` 读最后 50 条消息; SKILL.md 声明无参数时默认 last | P1 | static |
| TF1.5 | `after "text"` boundary | 从 "text" 首次出现到 session 结尾; 若未找到 text 则 fallback 行为需文档说明 | P1 | static |
| TF1.6 | `around N` window size | 消息窗口为 N-10 到 N+10 (20 条消息); 边界 N<10 或 N>total 时 clamp | P1 | static |
| TF1.7 | `error` mode scope | 读完整 session 但仅分析 error-correction patterns (跳过 clean section) | P1 | static |
| TF1.8 | `full` mode token warning | full 模式 "may consume more tokens"，文档中应有提示 | P2 | static |
| TF1.9 | Custom text as focus_hint | SKILL.md "custom text" 行: 搜索 text 在消息中的位置，聚焦周围上下文 | P1 | static |
| TF1.10 | DRAFT header includes Focus | REFLECTOR.md R4 输出格式包含 `Focus: ${FOCUS_HINT}` 字段 | P0 | static |
| TF1.11 | DRAFT header includes Scanned Range | REFLECTOR.md R4 输出格式包含 `Scanned Range: messages [start]--[end]` | P0 | static |
| TF1.12 | Re-reflect uses Location metadata | REVIEW.md V6 声明 re-reflect 时使用原 DRAFT 的 scanned_range 和 Location 字段 | P1 | static |

### B.3 实现策略

**全部为 Static (test.sh 新增 section T8)**: 约 12 个 assert_contains 断言:

```
# REFLECTOR.md 完整策略表
assert_contains REFLECTOR.md "| \`last\`"
assert_contains REFLECTOR.md "| \`after"       (after "text" strategy)
assert_contains REFLECTOR.md "| \`around N\`"
assert_contains REFLECTOR.md "| \`error\`"
assert_contains REFLECTOR.md "| \`full\`"

# SKILL.md focus 参数
assert_contains SKILL.md "last/after.*around N/error/full"

# DRAFT 输出格式
assert_contains REFLECTOR.md "Focus: \${FOCUS_HINT}"
assert_contains REFLECTOR.md "Scanned Range"

# 默认值
assert_contains REFLECTOR.md "last.*default"   (或等效表述)
```

**E2E**: 理想情况下 live-test.sh 扩展 5 个 scenario (每种 focus 一个)，但依赖 LLM 行为不确定，优先级 P2。

---

## Part C: State File 测试技术方案

aristotle-state.json 由 REFLECT.md F4 写入，由 SKILL.md `sessions` 命令读取，由 REVIEW.md V3d 更新。当前零测试覆盖。

### C.1 State File Schema

根据 REFLECT.md F4 定义:

```json
{
  "id": "rec_1712743800",
  "reflector_session_id": "ses_xxx",
  "target_session_id": "ses_yyy",
  "target_label": "current|last|ses_xxxx|recent #i/N|passive-trigger",
  "launched_at": "2026-04-10T22:30:00+08:00",
  "status": "draft|confirmed|revised|rejected",
  "rules_count": null | 2
}
```

顶层结构: JSON Array，最多 50 条记录。

### C.2 Test Cases

| TC ID | Description | Expected Behavior | Priority | Type |
|-------|-------------|-------------------|----------|------|
| TS1.1 | State file is JSON array | 顶层结构为 `[]`; 空文件或不存在时 SKILL.md sessions 显示 "No sessions found" | P0 | static |
| TS1.2 | Record has all required fields | 每条记录包含: id, reflector_session_id, target_session_id, target_label, launched_at, status, rules_count | P0 | static |
| TS1.3 | Status enum limited to 4 values | status 只能是: `draft`, `confirmed`, `revised`, `rejected` | P0 | static |
| TS1.4 | SKILL.md displays status icons | sessions 命令输出格式: draft=... confirmed=... revised=... rejected=... | P1 | static |
| TS1.5 | Max 50 records pruning | REFLECT.md F4 声明 "Keep at most the 50 most recent records (prune oldest if exceeded)" | P0 | static |
| TS1.6 | Pruning drops oldest records | 超过 50 条时删除最旧记录 (按 launched_at 排序) | P0 | unit |
| TS1.7 | Status transitions: draft -> confirmed | REVIEW.md V3d 在 confirm 后更新 status 为 confirmed 并设置 rules_count | P0 | static |
| TS1.8 | Status transitions: draft -> rejected | REVIEW.md V2 reject 分支更新 status 为 rejected | P0 | static |
| TS1.9 | Status transitions: confirmed -> revised | REVIEW.md V4 post-write revision 更新 status 为 revised | P1 | static |
| TS1.10 | target_label format variants | REFLECT.md F2 定义 4 种 label: "current", "last", "ses_xxxx" (last 4 chars), "recent #i/N" | P1 | static |
| TS1.11 | passive-trigger label | REFLECT.md P3.3 passive trigger 使用 target_label = "passive-trigger" | P1 | static |
| TS1.12 | id format rec_{timestamp} | id 使用 `rec_$(date +%s)` 格式; 与 MCP rule id 格式一致 | P1 | static |
| TS1.13 | rules_count null on draft | draft 状态时 rules_count 为 null; confirm 后更新为实际数量 | P1 | unit |
| TS1.14 | Record is 1-indexed in sessions display | SKILL.md `sessions` 命令显示 1-indexed 序号; `review N` 使用相同序号查找 | P0 | static |

### C.3 实现策略

**Static (test.sh 新增 section T9)**: 约 8 个断言:

```
# REFLECT.md state file schema
assert_contains REFLECT.md "aristotle-state.json"
assert_contains REFLECT.md '"status": "draft"'
assert_contains REFLECT.md '"rules_count": null'
assert_contains REFLECT.md "50 most recent"

# REVIEW.md status transitions
assert_contains REVIEW.md '"confirmed"'
assert_contains REVIEW.md '"revised"'
assert_contains REVIEW.md '"rejected"'

# SKILL.md sessions display
assert_contains SKILL.md "draft.*confirmed.*revised.*rejected"   (status icons)
assert_contains SKILL.md "review N"
```

**Unit (test_mcp.py 新增 TestStateFile class)**: 4-6 个 pytest 测试:

- `test_state_record_schema`: 验证记录包含所有必需字段
- `test_state_valid_statuses`: 验证 4 种 status 值
- `test_state_pruning_at_50`: 插入 55 条记录，验证只剩 50 条
- `test_state_pruning_drops_oldest`: 验证删除的是 launched_at 最早的记录
- `test_state_rules_count_null_on_draft`: draft 状态 rules_count 为 None
- `test_state_1_indexed_access`: review N 使用 1-indexed 从数组取元素

注意: 当前 aristotle-state.json 的读写逻辑分散在 REFLECT.md/REVIEW.md (由 LLM 执行) 而非 Python 代码中。Unit 测试需要考虑:
1. 如果将 state 管理逻辑提取到 Python 函数，可直接测试
2. 否则只能通过 static 测试覆盖协议文档的完整性
3. 推荐: 在 `aristotle_mcp/` 下新增 `state.py` 模块，将 state 读写逻辑代码化

---

## Part D: Install Script 测试技术方案

install.sh (103 行) 执行 3 步: 复制文件 -> 初始化 learnings -> 验证。当前 test.sh T5 仅做 `bash -n` 语法检查。

### D.1 Test Cases

| TC ID | Description | Expected Behavior | Priority | Type |
|-------|-------------|-------------------|----------|------|
| TI1.1 | Syntax check (existing) | `bash -n install.sh` 无报错 (已在 T5 覆盖) | P0 | static |
| TI1.2 | Step 1 copies 4 skill files | install.sh 复制 SKILL.md, REFLECTOR.md, REFLECT.md, REVIEW.md 到 `~/.claude/skills/aristotle/` | P0 | unit |
| TI1.3 | Step 1 does NOT copy CHECKER.md | CHECKER.md 由 REVIEW.md 按需加载，不应预先复制 | P1 | unit |
| TI1.4 | Step 1 does NOT copy test files | test.sh, test/live-test.sh, test_mcp.py 不应复制到安装目录 | P1 | unit |
| TI1.5 | Step 2 creates learnings file | `~/.config/opencode/aristotle-learnings.md` 在不存在时创建 | P0 | unit |
| TI1.6 | Step 2 learnings file header content | 文件包含标题 "# Aristotle Learnings (User-Level)" 和 append-only 注释 | P0 | unit |
| TI1.7 | Step 2 preserves existing learnings | 若 learnings 文件已存在，不覆盖 (输出 "preserving") | P0 | unit |
| TI1.8 | Step 2 learnings file is valid markdown | 文件开头为 `#` 标题，包含 HTML 注释 | P1 | unit |
| TI1.9 | Step 3 verifies installed files | install.sh 检查 4 个 skill 文件 + learnings 文件是否存在 | P0 | static |
| TI1.10 | Step 3 reports error count | 缺少文件时输出 "N issues found" 而非直接失败 | P1 | static |
| TI1.11 | Error count is zero on success | 所有文件就位时输出 "All files verified" | P1 | unit |
| TI1.12 | SKILL_BASE respects CLAUDE_CONFIG_DIR | 环境变量 `CLAUDE_CONFIG_DIR` 可覆盖默认 `~/.claude` | P1 | unit |
| TI1.13 | OPENCODE_CONFIG respects env var | 环境变量 `OPENCODE_CONFIG_DIR` 可覆盖默认 `~/.config/opencode` | P1 | unit |
| TI1.14 | mkdir -p creates destination | 目标目录不存在时自动创建 | P0 | unit |
| TI1.15 | idempotent re-run | 多次执行 install.sh 不报错，learnings 文件保留原有内容 | P0 | unit |
| TI1.16 | SKILL_SRC auto-detection from script location | `SCRIPT_DIR` 从 `${BASH_SOURCE[0]}` 推导，支持从 repo 或安装目录运行 | P1 | static |

### D.2 实现策略

**Static (test.sh 新增 section T5 扩展)**: 3-4 个断言:

```
assert_contains install.sh "mkdir -p"
assert_contains install.sh "SKILL.md"
assert_contains install.sh "preserving"
assert_contains install.sh "CLAUDE_CONFIG_DIR"
```

**Unit (新增 test/test_install.sh 或 test_mcp.py TestInstall class)**:

bash 行为测试需要一个临时 HOME 目录:

```bash
# test/test_install.sh (新文件)
setup() {
    export TMPHOME=$(mktemp -d)
    export CLAUDE_CONFIG_DIR="$TMPHOME/.claude"
    export OPENCODE_CONFIG_DIR="$TMPHOME/.config/opencode"
}
teardown() { rm -rf "$TMPHOME"; }

test_step1_copies_files()   # 验证 4 个文件复制
test_step2_creates_learnings # 验证 learnings 文件创建
test_step2_preserves_existing # 验证不覆盖
test_idempotent_rerun        # 验证重复运行
test_env_override            # 验证环境变量覆盖
```

或 Python 版本 (如果倾向统一在 pytest):

```python
class TestInstallScript:
    def test_install_copies_skill_files(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / ".claude"))
        monkeypatch.setenv("OPENCODE_CONFIG_DIR", str(tmp_path / ".config/opencode"))
        subprocess.run(["bash", "install.sh"], check=True)
        assert (tmp_path / ".claude/skills/aristotle/SKILL.md").exists()
        # ...

    def test_learnings_file_created(self, ...): ...
    def test_learnings_file_preserved(self, ...): ...
    def test_idempotent(self, ...): ...
```

推荐: 新增 `test/test_install.sh` 作为独立 bash 测试文件，因为 install.sh 是 bash 脚本且需要文件系统操作。在 CI 中与 test.sh 串联执行。

---

## 实施优先级总结

| Priority | Section | Test Count | Effort |
|----------|---------|-----------|--------|
| **P0** | A.1 Schema (TC1.1, TC1.2, TC1.6) | 3 | 1h |
| **P0** | A.3 Outcome (TC3.1, TC3.2, TC3.6) | 3 | 0.5h |
| **P0** | B.1 Strategies (TF1.1-TF1.3, TF1.10-TF1.11) | 5 | 0.5h |
| **P0** | C.2 State (TS1.1-TS1.3, TS1.5, TS1.7-TS1.8, TS1.14) | 8 | 1.5h |
| **P0** | D.1 Install (TI1.2, TI1.5, TI1.7, TI1.9, TI1.14, TI1.15) | 6 | 2h |
| **P1** | A.2 Content (TC2.1-TC2.6) | 6 | 0.5h |
| **P1** | A.1 Schema (TC1.3-TC1.5) | 3 | 0.5h |
| **P1** | B.1 Strategies (TF1.4-TF1.9, TF1.12) | 7 | 0.5h |
| **P1** | C.2 State (TS1.4, TS1.6, TS1.9-TS1.13) | 7 | 1h |
| **P1** | D.1 Install (TI1.3-TI1.4, TI1.6, TI1.8, TI1.10-TI1.13, TI1.16) | 9 | 1h |
| **P2** | B.1 Strategies (TF1.8) | 1 | -- |

**总计**: 25 个 P0 用例 + 25 个 P1 用例 + 1 个 P2 用例 = 51 个测试用例

### 测试层分布

| Type | Count | Where |
|------|-------|-------|
| static (test.sh) | ~30 | T7 (Checker), T8 (Focus), T9 (State), T5-ext (Install) |
| unit (pytest) | ~18 | TestChecker, TestStateFile (new), plus test_install.sh |
| E2E | ~3 | live-test.sh extension (P2, deferred) |

### 已知 Gaps (需设计决策)

1. **State management 无 Python 代码**: 当前 state file 读写全在 REFLECT.md/REVIEW.md 的 LLM 执行逻辑中。Unit 测试 `TS1.6, TS1.13` 需要先在 `aristotle_mcp/state.py` 中代码化 state 管理逻辑。
2. **error_summary 长度校验缺失**: CHECKER.md 声明 <=200 字符 auto-truncate，但 `write_rule` MCP tool 无此逻辑。需决定是在 MCP 层还是 Checker 文档层面修复。
3. **intent_tags 空 string 校验缺失**: CHECKER.md 声明 domain/task_goal 必须非空，但 `write_rule` 不校验空字符串。
4. **Install script CHECKER.md 复制**: 当前 install.sh 不复制 CHECKER.md。如果 CHECKER.md 需要预装 (而非运行时读取源 repo)，需修改 install.sh。
