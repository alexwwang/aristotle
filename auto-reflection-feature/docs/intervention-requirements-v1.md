# Requirements: Watchdog Intervention for TDD Pipeline (MVP v1)

> **Version**: v1.3 (MVP)
> **Status**: Draft - Ralph Loop Round 2 Review
> **Branch**: feature/watchdog-intervention
> **Depends on**: auto-reflection-feature (watchdog, reflector, rule_generator, committer, queue)
> **TDD Pipeline Reference**: Phase definitions per tdd-pipeline skill (phase-1 through phase-7)

---

## Why Articulation

TDD Pipeline 的 Watchdog 能检测 LLM 行为违规，但检测本身不够——需要 **干预**：阻止违规操作、回退到正确状态、提供明确指令重试。没有干预，Watchdog 只是日志记录器。

核心风险：
1. **干预不足**：只检测不阻止，LLM 照样继续违规操作
2. **回退错误**：回退到错误阶段或丢失已提交的工作
3. **误报阻塞**：系统误报导致正常流程被阻断
4. **审查污染**：Ralph Loop 提示词注入了停止条件/历史记录等禁止内容，导致审查结果无效

Approach: 定义完整的干预矩阵，每种违规类型有明确的触发条件、回退阶段、自动修复动作、KI 文档要求。Ralph Loop 提示词必须经过合规性扫描。

---

## Definitions

本节定义文档中使用的核心术语的操作性含义：

| Term | Definition |
|------|-----------|
| **ZERO_C_H_M** | 一轮 Ralph Loop Review 中 Critical=0 且 High=0 且 Major=0。即无缺陷级发现。 |
| **Consecutive ZERO_C_H_M** | 连续 N 轮 Ralph Loop 每轮都达到 ZERO_C_H_M。中断（任何一轮有 C/H/M）则计数归零。 |
| **Ralph Loop execution record** | 结构化日志条目，包含：round number, C/H/M tally, contested issues, fixes applied。存储在 pipeline context 中。 |
| **Corresponding test file** | 基于目录映射约定：`src/<module>.py` 对应 `tests/test_<module>_test.py`。模块名从源文件名提取（不含扩展名）。 |
| **File in git** | A file tracked by the git index (returned by git ls-files). Untracked files are NOT in git. |
| **Phase completion** | 当前 Phase 的主要产出物已生成且通过 Ralph Loop gate（Phase 1-5）或通过预发布测试（Phase 6）。 |
| **SYNC mode** | 干预模式：Watchdog 在每个操作步骤后同步检查，发现违规时立即阻止 LLM 并执行干预。LLM 无法继续下一步直到违规解决。 |
| **Rollback to Phase N** | 将 pipeline 状态重置为 Phase N 的开始状态。（1）已有 commit 的工作保留；（2）未 commit 的工作先 auto-commit 再回退；（3）仅影响当前 Phase 的产出物。 |
| **Last legitimate commit** | V-5 detection baseline commit. Defined as Phase 4 to 5 stage boundary commit (the commit made when Phase 4 completes). |
| **Regression** | 在 Phase 5 结束时通过的测试用例，在 Phase 6 中失败。不包括：(a) 新增但从未通过的测试；(b) flaky test（同一用例在相同代码下有时通过有时失败）。 |
| **Stage boundary** | 从 Phase N 进入 Phase N+1 的转换点。此时必须完成：ki assessment + commit + 合规检查。 |
| **Auto-fix** | 系统自动执行的修复动作（确定性代码操作，不调用 LLM）。分为：full auto（完全自动）和 semi-auto（自动执行 + 要求 LLM 后续操作）。 |
| **Destructive auto-fix** | 会删除或覆盖现有文件的 auto-fix（如 V-4 删除实现、V-5 恢复测试）。有 commit 协议保护：执行前确保已有 commit，可通过 git 恢复。 |
| **req-number** | Commit message 中的需求追踪编号。格式：需求文档的标识符（如 INT-001）。由 pipeline 在启动时分配。 |

---

## Intervention Matrix (v1.3)

### Violation Priority (multi-violation handling)

当多个违规同时触发时，按以下优先级处理（高优先级先处理）：

| Priority | Category | Rationale |
|----------|----------|-----------|
| P1 | Behavioral (V-4, V-5, V-6) | 直接影响代码产出，必须立即阻止 |
| P2 | Process (V-1, V-2, V-3, V-13) | 流程违规，阻止继续但不涉及文件操作 |
| P3 | Regression (V-7) | 测试结果问题，不涉及当前操作 |
| P4 | Compliance (V-8, V-9, V-10, V-11) | 文档/commit 合规，可自动修复 |
| P5 | Assessment (V-12) | ki 评估，可自动补全 |

### Phase 1-3: Process Violations

Phase 1-3 是设计阶段（需求/技术方案/测试计划），通过 Ralph Loop Review 保证质量。违规来源是 Ralph Loop 输出的 C/H/M 计数。

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-1 | SKIP_REVIEW | Phase 1-3 完成但无 Ralph Loop execution record | 当前 Phase | 无（要求执行 Ralph Loop） | 记录干预：跳过了审查 |
| V-2 | INSUFFICIENT_REVIEW | Ralph Loop 未达到 consecutive 2 rounds of ZERO_C_H_M | 当前 Phase | 无（要求继续 Loop） | 记录干预：审查轮次不足 |
| V-3 | UNFIXED_ISSUES | Ralph Loop 发现 C/H/M > 0 但 Phase 继续 | 当前 Phase | 无（要求修复后重试 Loop） | 记录干预：未修复问题数 |
| V-13 | INVALID_REVIEW_PROMPT | Ralph Loop reviewer prompt 包含禁止内容（双语检测） | 当前 Phase | 无（要求 LLM 重构合规 prompt） | 记录违规：列出具体违禁项 |

### Phase 4-5: Behavioral Violations

Phase 4（Red）写测试，Phase 5（Green）写实现。违规来源是文件系统操作。

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-4 | SKIP_RED_PHASE | Phase 4 创建实现文件但无 corresponding test file 且无失败测试 | Phase 4 | Semi-auto: 删除违规实现文件 + 要求 LLM 先写测试 | 记录干预：跳过 Red Phase，文件路径 |
| V-5 | MODIFIED_TEST | Phase 5 检测到测试文件断言/期望值变更（相对最近一次合法 commit，不包括仅重构） | Phase 5 | Full auto: 恢复测试至最近一次合法 commit 版本 | 记录干预：修改测试，文件路径 |
| V-6 | MISSING_TEST | Phase 4/5 创建实现文件但 tests/ 中无 corresponding test file | Phase 4 | 无（要求 LLM 先写测试，系统无法替 LLM 写有意义测试） | 记录干预：缺少测试，文件路径 |

**V-4/V-5 Destructive auto-fix safety**: 执行前确认当前 phase 已 commit（由 commit 协议保证）。所有 auto-fix 可通过 `git reflog` 恢复。

**V-5 Test modification scope**: 仅检测断言（assert）和期望值（expected value）变更。以下变更不触发 V-5：
- import 语句变更
- 变量/函数重命名（refactor）
- 测试结构调整（提取 helper、参数化）
- 注释变更

### Phase 6: Regression (not Phase 7)

Phase 6 是预发布测试。Phase 7 是系统质量审计，不产生回归测试。

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-7 | REGRESSION | Phase 5 结束时通过的测试在 Phase 6 中失败（排除 flaky test） | Phase 5 | 标记失败范围，要求 Phase 5 修复实现 | 记录干预：回归范围 |

### Phase 6-7: Document Compliance

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-8 | MISSING_KI_DOC | 干预/审查发生后 ki 文档未更新（无新增条目） | 当前阶段 | 自动追加干预记录到 ki 文档 | 自身就是修复 |
| V-9 | KI_DOC_OUTDATED | ki 文档最新条目的内嵌 timestamp 早于最近一次干预的 timestamp | 当前阶段 | 追加缺失的干预记录 | 自身就是修复 |

### Cross-Phase: Commit Compliance

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-10 | UNCOMMITTED_PHASE | Phase 完成但无对应 commit | 当前 Phase | 自动 commit | 记录自动 commit |
| V-11 | UNCOMMITTED_REVIEW | Ralph Loop 轮次完成但无对应 commit | 当前 Phase | 自动 commit | 记录自动 commit |

### KI Assessment

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-12 | MISSING_KI_ASSESSMENT | Ralph Loop 结束进入下一阶段前，无 ki 状况评估（问题优先级 + 当前状态） | 当前 Phase | 自动执行评估并更新 ki 文档 | 记录评估结果 |

### KI Violation Merge Rule

以下顺序覆盖 Violation Priority 表，仅适用于同一边界的 V-8/V-9/V-10/V-11/V-12 组合。在同一 stage boundary，V-8/V-9/V-12 可能同时触发。合并策略：
1. 先执行 V-10/V-11（确保所有内容已 commit）
2. 再执行 V-12（ki assessment）
3. 最后执行 V-8/V-9（ki doc 更新）
合并为一次干预事件，在 ki 文档中记录为单条合并条目。

---

## Ralph Loop Prompt Validation (V-13)

Ralph Loop 协议要求 reviewer prompt **不得包含** 以下内容。检测必须支持中文和英文双语。

### Forbidden Patterns

| # | Forbidden Category | English Patterns | Chinese Patterns |
|---|-------------------|-----------------|-----------------|
| FP-1 | Stop conditions | stop condition, gate pass, 2 consecutive rounds | 停止条件, 连续2轮, 连续两轮, 审查达标, 质量达标 |
| FP-2 | Cumulative tallies | cumulative tally, running total, total C, total H, total M | 累计计数, 累计统计, 总C数, 总H数, 总M数 |
| FP-3 | Prior round findings | prior round, previous round, round 1 found, last round | 上一轮, 前一轮, 上轮发现, 之前发现 |
| FP-4 | Fix lists | fix list, fixes applied, addressed items, resolved issues | 修复列表, 已修复, 已解决, 修改清单 |
| FP-5 | Round counts | round N, round count, this is round, loop round | 第N轮, 第几轮, 当前轮次, loop轮次 |
| FP-6 | Loop state | loop state, gate status, pass/fail status | 循环状态, 审查状态, 是否通过 |
| FP-7 | Scope-limiting hints | only check X, limit scope to, focus only on, do not review | 只检查X, 限制范围, 不要审查, 跳过审查 |

### Detection Rules

1. **Case insensitive**: All pattern matching is case-insensitive
2. **Bilingual matching strategy**: English patterns use `\b` word boundary matching. Chinese patterns use lookaround-based matching（前字符为行首/非CJK字符/空格，后字符同理）。不依赖 `\b` 对中文字符的支持。
3. **Minimum confidence**: If pattern appears in quoted/reference context (e.g., "per protocol, do not include X"), do not flag
4. **Exempt contexts**: Code blocks (triple backtick ` ``` `), inline code (single backtick `` ` ``), and markdown formatted headings are exempt
5. **FP-7 uses phrase matching**: FP-7 patterns must match as multi-word phrases, not individual words. "skip" alone does NOT trigger; "skip the review" or "跳过审查" DOES trigger.
6. **Threshold**: 1+ match on any forbidden pattern = violation
7. **Report format**: List each matched pattern with its location (line number) in the prompt

---

## User Stories

| # | Priority | User Story |
|---|----------|-----------|
| US-I1 | Core | As a TDD Pipeline operator, I want the system to block LLM when it skips Ralph Loop Review (Phase 1-3), so that design quality is enforced |
| US-I2 | Core | As a TDD Pipeline operator, I want the system to block LLM when it writes implementation before tests (Phase 4), so that TDD Red-Green cycle is enforced |
| US-I3 | Core | As a TDD Pipeline operator, I want the system to restore modified tests from git (Phase 5), so that test integrity is maintained |
| US-I4 | Core | As a TDD Pipeline operator, I want the system to detect missing tests and require LLM to write them, so that coverage is enforced |
| US-I5 | Core | As a TDD Pipeline operator, I want every intervention to auto-update the ki document, so that intervention history is traceable |
| US-I6 | Core | As a TDD Pipeline operator, I want every phase/loop completion to be committed to git, so that rollback is reliable |
| US-I7 | Core | As a TDD Pipeline operator, I want regression failures (Phase 6) to rollback to Phase 5 for fix, so that regression is handled correctly |
| US-I8 | Core | As a TDD Pipeline operator, I want all interventions to execute in SYNC mode (block immediately, no human override), so that TDD protocol is enforced without human intervention |
| US-I9 | Core | As a TDD Pipeline operator, I want ki assessment (status + issue priority) at each stage boundary, so that quality state is always visible |
| US-I10 | Core | As a TDD Pipeline operator, I want the system to validate Ralph Loop prompts for forbidden content (bilingual), so that review integrity is guaranteed |

---

## Acceptance Criteria

### Phase 1-3: Process Violations

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I1 | US-I1 | Given Phase 1/2/3 completes, When no Ralph Loop execution record found, Then block pipeline, raise SKIP_REVIEW, require Ralph Loop execution | Ralph Loop ran 0 rounds = skip |
| AC-I2 | US-I1 | Given Ralph Loop ran less than 2 consecutive rounds of ZERO_C_H_M, When Phase attempts to proceed, Then block pipeline, raise INSUFFICIENT_REVIEW, require more rounds | Exactly 2 consecutive rounds ZERO = pass |
| AC-I3 | US-I1 | Given Ralph Loop finds C or H or M greater than 0, When Phase attempts to proceed, Then block pipeline, raise UNFIXED_ISSUES with issue count | C=0, H=0, M=1 = blocked |
| AC-I4 | US-I1 | Given Phase 1-3 violation detected, When rollback triggered, Then rollback to current phase (preserve committed work, require retry of failed step) | Phase 2 violation = stay at Phase 2, retry the review |

### Ralph Loop Prompt Validation

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I17 | US-I10 | Given Ralph Loop reviewer prompt is constructed, When prompt scanned for forbidden patterns (FP-1 through FP-7, bilingual EN+ZH), Then if 1+ match found, block pipeline, raise INVALID_REVIEW_PROMPT with matched pattern details | Pattern in code block or inline code = exempt; quoted reference context = exempt |
| AC-I18 | US-I10 | Given INVALID_REVIEW_PROMPT violation raised, When violation reported to LLM, Then report includes: matched pattern text, line number, forbidden category (FP-1 to FP-7) | Multiple matches = report all |
| AC-I19 | US-I10 | Given Ralph Loop prompt is in Chinese, When scanned, Then Chinese forbidden patterns detected using lookaround-based matching (not word boundary) | Mixed EN+ZH prompt = scan both with respective strategies |

### Phase 4-5: Behavioral Violations

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I5 | US-I2 | Given Phase 4 detects implementation file creation with no failing test, When intervention triggers, Then delete implementation file, raise SKIP_RED_PHASE, require LLM to write test first | File not in git = use file system delete; file in git = use git checkout |
| AC-I6 | US-I3 | Given Phase 5 detects test file assertion/expectation change vs last legitimate commit, When intervention triggers, Then restore test to last legitimate commit version, raise MODIFIED_TEST | File not tracked by git = skip restore, log warning; refactor-only changes = not a violation |
| AC-I7 | US-I4 | Given Phase 4/5 detects implementation file with no corresponding test file, When intervention triggers, Then block pipeline, raise MISSING_TEST, require LLM to write the test | System does NOT create placeholder skeleton |
| AC-I8 | US-I2 | Given SKIP_RED_PHASE rollback, When target phase calculated, Then target_phase = 4 (Red phase, write test first) | N/A |

### Phase 6: Regression

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I9 | US-I7 | Given Phase 6 tests fail where the same tests passed at Phase 5 end, When intervention triggers, Then mark failure range, rollback to Phase 5, require fix implementation | Flaky test = do not trigger (requires deterministic failure) |
| AC-I10 | US-I7 | Given REGRESSION rollback, When target_phase calculated, Then target_phase = 5 (Green phase, fix implementation) | N/A |

### KI Document

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I11 | US-I5 | Given any intervention triggers, When intervention completes, Then ki document is auto-appended with: violation type, target phase, auto-fix applied, timestamp | Multiple interventions = multiple entries |
| AC-I12 | US-I5 | Given Ralph Loop completes a round, When round ends, Then ki document is updated with round results (C/H/M counts) | Round 1 fails = record it |
| AC-I20 | US-I5 | Given ki document exists with entries, When ki document newest entry timestamp is older than most recent intervention timestamp, Then raise KI_DOC_OUTDATED, auto-append missing intervention record | Timestamp source: structured timestamp field in ki document entry, not file mtime |

### KI Assessment

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I13 | US-I9 | Given Ralph Loop ends and pipeline attempts to enter next phase, When no ki assessment record found for this stage boundary, Then block pipeline, raise MISSING_KI_ASSESSMENT, auto-execute assessment | Assessment with at least status field = valid; completely empty = MISSING_KI_ASSESSMENT |

### SYNC Mode

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I21 | US-I8 | Given any violation detected (V-1 through V-13), When intervention triggers, Then pipeline is blocked immediately, auto-fix (if applicable) executes, LLM receives instruction to retry, no human intervention required | Multiple violations = handle by priority (see Violation Priority table) |

### Commit Compliance

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I14 | US-I6 | Given any phase completes with non-empty diff, When phase done, Then auto-commit with message format: req-number: phase-name summary | Empty diff = skip, log |
| AC-I15 | US-I6 | Given Ralph Loop round completes with non-empty diff, When round done, Then auto-commit with message format: req-number: phase-name [Loop N] summary | Empty diff = skip, log |
| AC-I16 | US-I6 | Given uncommitted files detected at phase boundary, When check runs, Then auto-commit all uncommitted files | MCP tool handles auto-commit |

### Phase Boundary Rollback Granularity

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I22 | US-I2 | Given V-6 detected in Phase 5, When rollback to Phase 4 triggered, Then Phase 5 work is preserved via auto-commit before rollback, only Phase 4 is re-entered | Committed Phase 5 work remains in git history |

---

## Commit Protocol

### Message Format
```
<req-number>: <phase-name> [Loop N] <summary>
```

Where `<req-number>` is the requirement tracking identifier assigned at pipeline start (e.g., INT-001).

Examples:
- INT-001: PHASE-1-DESIGN Initial requirements document
- INT-001: PHASE-2-SOLUTION [Loop 1] Address review feedback
- INT-001: PHASE-4-RED Write failing tests for intervener
- INT-001: PHASE-5-GREEN Implement intervener.intervene()

### Auto-Commit Rules
1. Phase boundary: When phase completes with non-empty diff, commit all changes
2. Loop boundary: When Ralph Loop round completes with non-empty diff, commit all changes
3. Intervention: When auto-fix is applied, commit fix results
4. Empty commit: If diff is empty, skip and log
5. Pre-rollback: Before rollback to earlier phase, auto-commit current phase work
6. MCP integration: Use MCP commit_rule for rule files, git add -A and git commit for code/docs

---

## KI Document Protocol

### File
auto-reflection-feature/docs/04-review-records.md

### Timestamp Source
Each ki document entry MUST contain a structured timestamp field in ISO 8601 format. Do NOT rely on file system mtime. Example:
```
**Timestamp**: 2026-05-25T14:30:00+08:00
```

### File Not Found
If ki document file does not exist when intervention attempts to update it, create the file with standard header before appending.

### Update Triggers
1. Intervention: Every intervention, append entry
2. Ralph Loop round: Every round, append round results
3. Phase completion: Every phase, append phase summary
4. Stage boundary assessment: Before entering next phase, assess current status + issue priority

### Merge Rule at Stage Boundary
When V-8/V-9/V-12 trigger at the same boundary, merge into a single intervention event with a single ki document entry documenting all combined actions.

### Entry Format
```markdown
### [TYPE] Title

**Timestamp**: ISO 8601
**Date**: ISO 8601
**Phase**: N
**Violation**: V-N (if intervention)
**Action**: What was done
**Result**: Outcome

---
```

### Stage Boundary Assessment Format
```markdown
### [ASSESSMENT] Phase N -> N+1

**Timestamp**: ISO 8601
**Date**: ISO 8601
**Phase**: N
**Status**: PASS / CONDITIONAL / FAIL
**Open Issues**: N (priority sorted)
**Issue Priority**: P0: X items, P1: Y items, P2: Z items
**Ki Doc Updated**: Yes
**Committed**: Yes (hash: abc123)

---
```

### Prompt Validation Entry Format
```markdown
### [PROMPT-VALIDATION] Phase N Ralph Loop

**Timestamp**: ISO 8601
**Date**: ISO 8601
**Phase**: N
**Violations**: FP-1: X matches, FP-2: Y matches, ...
**Details**: line N: "matched text" -> FP-category
**Result**: PASS / BLOCKED

---
```

---

## Prerequisites

1. Watchdog module: ViolationFilter + ViolationEvent (implemented)
2. Reflector module: AutoReflector (implemented)
3. Rule generator: RuleGenerator (implemented)
4. Committer module: AutoCommitter (implemented)
5. Queue module: DurableQueue (implemented)
6. Git repository: Working git repo with commit history (in container)
7. Ralph Loop output: C/H/M counts accessible via pipeline context

---

## Constraints and Assumptions

- Assumption: Git repo is clean before each phase (enforced by commit protocol)
- Assumption: Ralph Loop outputs C/H/M counts in a parseable format
- Assumption: File paths follow convention: src/module.py maps to tests/test_module_test.py
- Assumption: Ralph Loop prompts may be in English, Chinese, or mixed language
- Assumption: All destructive auto-fixes have commit-before-fix safety guarantee
- Constraint: SYNC mode only — block immediately, rollback, retry. No async/hybrid in MVP.
- Constraint: No human override in MVP (emergency mode = v2). Acknowledged risk: false positive interventions have no manual override in MVP; mitigated by git commit safety net.
- Constraint: One intervention per violation, no cascading. Multi-violation handled by priority table.
- Constraint: KI document is append-only — no deletion or modification of existing entries
- Constraint: V-6 (MISSING_TEST) has no auto-fix, system cannot write meaningful tests for LLM
- Constraint: V-4 auto-fix deletes implementation but does NOT create test skeleton (changed from earlier versions). LLM must write test.
- Constraint: V-13 regex may have false positives/negatives; code blocks and inline code exempt. Semantic detection is v2 scope.
- Constraint: V-5 only detects assertion/expectation changes, not refactoring changes

---

## Violation Type Summary

| Code | Name | Phase | Category | Auto-Fix | KI Required |
|------|------|-------|----------|----------|-------------|
| V-1 | SKIP_REVIEW | 1-3 | Process | No | Yes |
| V-2 | INSUFFICIENT_REVIEW | 1-3 | Process | No | Yes |
| V-3 | UNFIXED_ISSUES | 1-3 | Process | No | Yes |
| V-13 | INVALID_REVIEW_PROMPT | 1-3 | Process | None (require LLM to reconstruct compliant prompt) | Yes |
| V-4 | SKIP_RED_PHASE | 4 | Behavioral | Semi-auto - delete impl only | Yes |
| V-5 | MODIFIED_TEST | 5 | Behavioral | Full auto - restore test | Yes |
| V-6 | MISSING_TEST | 4-5 | Behavioral | No - require LLM to write | Yes |
| V-7 | REGRESSION | 6 | Regression | No - mark + flag | Yes |
| V-8 | MISSING_KI_DOC | 1-7 | Compliance | Yes - auto-append | Self |
| V-9 | KI_DOC_OUTDATED | 1-7 | Compliance | Yes - auto-append | Self |
| V-10 | UNCOMMITTED_PHASE | 1-7 | Compliance | Yes - auto-commit | Yes |
| V-11 | UNCOMMITTED_REVIEW | 1-3 | Compliance | Yes - auto-commit | Yes |
| V-12 | MISSING_KI_ASSESSMENT | 1-7 | KI Assessment | Yes - auto-execute | Self |

Total: 13 violation types, 10 user stories, 22 acceptance criteria

Auto-fix: 5 full-auto (V-5, V-8, V-9, V-10, V-11), 1 semi-auto (V-4), 1 auto-execute (V-12)
No auto-fix: 6 (V-1, V-2, V-3, V-6, V-7, V-13)

---

Document created: 2026-05-25
Version: v1.3
Changelog from v1.2:
- F-01: Removed git commands from AC-I5/AC-I6, replaced with behavioral descriptions
- F-02: AC-I2 added "consecutive" to match matrix V-2
- F-03: AC-I14/AC-I15 added "with non-empty diff" condition
- F-04: Matrix header changed from "Phase 6-7" to "Phase 6" for regression section
- F-05/F-08: Added Definitions section with SYNC mode definition; added AC-I21 for US-I8
- F-06: Added AC-I20 for V-9 KI_DOC_OUTDATED
- F-07: Added Definitions section with operational definitions for all key terms
- F-09: AC-I4 clarified rollback-to-self = preserve committed work, retry failed step
- F-10: Added Violation Priority table for multi-violation handling
- F-11: Detection Rule 2 changed to lookaround-based matching for Chinese (not \b)
- F-12: V-4 auto-fix changed to semi-auto (delete only, no test skeleton creation)
- F-13: Added "Destructive auto-fix safety" note; Constraints acknowledge false positive risk with git safety net
- F-15: FP-7 changed to phrase matching (multi-word), not individual words
- F-17: V-5 scope limited to assertion/expectation changes, refactoring excluded
- F-18: V-7 trigger redefined as Regression (see Definitions)
- F-19: KI Document Protocol now specifies structured timestamp, not file mtime
- F-20: req-number defined in Definitions section
- F-22: Detection Rule 4 expanded to include inline code (single backtick) exemption
- F-23: Added AC-I22 for Phase 5->4 rollback granularity
- F-25: Constraints now acknowledge false positive risk for all auto-fix violations
- F-28: KI Document Protocol added "File Not Found" behavior
- F-29: Added KI Violation Merge Rule section
- F-30/F-32: Merged into F-01 (behavioral descriptions replace git commands)
Next step: Round 2 Ralph Loop Review
