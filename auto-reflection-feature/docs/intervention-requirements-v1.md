# Requirements: Watchdog Intervention for TDD Pipeline (MVP v1)

> **Version**: v1.1 (MVP)
> **Status**: Draft - Pending Confirmation
> **Branch**: feature/watchdog-intervention
> **Depends on**: auto-reflection-feature (watchdog, reflector, rule_generator, committer, queue)

---

## Why Articulation

TDD Pipeline 的 Watchdog 能检测 LLM 行为违规，但检测本身不够——需要 **干预**：阻止违规操作、回退到正确状态、提供明确指令重试。没有干预，Watchdog 只是日志记录器。

核心风险：
1. **干预不足**：只检测不阻止，LLM 照样继续违规操作
2. **回退错误**：回退到错误阶段或丢失已提交的工作
3. **误报阻塞**：系统误报导致正常流程被阻断

Approach: 定义完整的干预矩阵，每种违规类型有明确的触发条件、回退阶段、自动修复动作、KI 文档要求。

---

## Intervention Matrix (v1.1)

### Phase 1-3: Process Violations

Phase 1-3 是设计阶段（需求/技术方案/测试计划），通过 Ralph Loop Review 保证质量。违规来源是 Ralph Loop 输出的 C/H/M 计数。

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-1 | SKIP_REVIEW | Phase 1-3 完成但无 Ralph Loop 执行记录 | 当前 Phase | 无（要求执行 Ralph Loop） | 记录干预：跳过了审查 |
| V-2 | INSUFFICIENT_REVIEW | Ralph Loop 未达到连续 2 轮 ZERO_C_H_M | 当前 Phase | 无（要求继续 Loop） | 记录干预：审查轮次不足 |
| V-3 | UNFIXED_ISSUES | Ralph Loop 发现 C/H/M > 0 但 Phase 继续 | 当前 Phase | 无（要求修复后重试 Loop） | 记录干预：未修复问题数 |

### Phase 4-5: Behavioral Violations

Phase 4（Red）写测试，Phase 5（Green）写实现。违规来源是文件系统操作。

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-4 | SKIP_RED_PHASE | Phase 4 创建实现文件但无对应失败测试 | Phase 4 | 1. git checkout HEAD 删除实现 2. 创建测试骨架 | 记录干预：跳过 Red Phase，文件路径 |
| V-5 | MODIFIED_TEST | Phase 5 检测到测试文件内容变更（相对 git HEAD） | Phase 5 | git checkout HEAD 恢复原始测试 | 记录干预：修改测试，文件路径 |
| V-6 | MISSING_TEST | Phase 4/5 创建实现文件但 tests/ 中无对应测试文件 | Phase 4 | 无（要求 LLM 先写测试，系统无法替 LLM 写有意义测试） | 记录干预：缺少测试，文件路径 |

### Phase 6-7: Regression and Compliance

Phase 6 是预发布测试，Phase 7 是系统质量审计。

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-7 | REGRESSION | Phase 6 测试失败（回归） | Phase 5 | 标记失败范围，要求 Phase 5 修复实现 | 记录干预：回归范围 |
| V-8 | MISSING_KI_DOC | 干预/审查发生后 ki 文档未更新 | 当前阶段 | 自动追加干预记录到 ki 文档 | 自身就是修复 |
| V-9 | KI_DOC_OUTDATED | ki 文档最后更新时间早于最近一次干预 | 当前阶段 | 追加缺失的干预记录 | 自身就是修复 |

### Cross-Phase: Commit Compliance

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-10 | UNCOMMITTED_PHASE | Phase 完成但无对应 commit | 当前 Phase | 自动 commit（见 commit 协议） | 记录自动 commit |
| V-11 | UNCOMMITTED_REVIEW | Ralph Loop 轮次完成但无对应 commit | 当前 Phase | 自动 commit（见 commit 协议） | 记录自动 commit |

### KI Assessment

| # | Violation Type | Trigger | Rollback To | Auto-Fix | KI Doc Action |
|---|---------------|---------|-------------|----------|---------------|
| V-12 | MISSING_KI_ASSESSMENT | Ralph Loop 结束进入下一阶段前，无 ki 状况评估（问题优先级 + 当前状态） | 当前 Phase | 自动执行评估并更新 ki 文档 | 记录评估结果 |

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
| US-I8 | Core | As a TDD Pipeline operator, I want the intervention to be fully automatic (SYNC mode), so that no human intervention is needed |
| US-I9 | Core | As a TDD Pipeline operator, I want ki assessment (status + issue priority) at each stage boundary, so that quality state is always visible |

---

## Acceptance Criteria

### Phase 1-3: Process Violations

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I1 | US-I1 | Given Phase 1/2/3 completes, When no Ralph Loop execution record found, Then block pipeline, raise SKIP_REVIEW, require Ralph Loop execution | Ralph Loop ran 0 rounds = skip |
| AC-I2 | US-I1 | Given Ralph Loop ran less than 2 rounds of ZERO_C_H_M, When Phase attempts to proceed, Then block pipeline, raise INSUFFICIENT_REVIEW, require more rounds | Exactly 2 rounds ZERO = pass |
| AC-I3 | US-I1 | Given Ralph Loop finds C or H or M greater than 0, When Phase attempts to proceed, Then block pipeline, raise UNFIXED_ISSUES with issue count | C=0, H=0, M=1 = blocked |
| AC-I4 | US-I1 | Given Phase 1-3 violation detected, When rollback triggered, Then target_phase = current phase (stay and retry) | Phase 2 violation stays at Phase 2 |

### Phase 4-5: Behavioral Violations

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I5 | US-I2 | Given Phase 4 detects implementation file creation with no failing test, When intervention triggers, Then delete implementation file via git checkout HEAD, raise SKIP_RED_PHASE, require LLM to write test first | File not in git = use os.remove |
| AC-I6 | US-I3 | Given Phase 5 detects test file content change vs git HEAD, When intervention triggers, Then restore test via git checkout HEAD, raise MODIFIED_TEST | File not tracked by git = skip restore, log warning |
| AC-I7 | US-I4 | Given Phase 4/5 detects implementation file with no corresponding test file, When intervention triggers, Then block pipeline, raise MISSING_TEST, require LLM to write the test | System does NOT create placeholder skeleton |
| AC-I8 | US-I2 | Given SKIP_RED_PHASE rollback, When target_phase calculated, Then target_phase = 4 (Red phase, write test first) | N/A |

### Phase 6-7: Regression

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I9 | US-I7 | Given Phase 6 tests fail (regression detected), When intervention triggers, Then mark failure range, rollback to Phase 5, require fix implementation | Not git revert, just flag and re-enter Phase 5 |
| AC-I10 | US-I7 | Given REGRESSION rollback, When target_phase calculated, Then target_phase = 5 (Green phase, fix implementation) | N/A |

### KI Document

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I11 | US-I5 | Given any intervention triggers, When intervention completes, Then ki document is auto-appended with: violation type, target phase, auto-fix applied, timestamp | Multiple interventions = multiple entries |
| AC-I12 | US-I5 | Given Ralph Loop completes a round, When round ends, Then ki document is updated with round results (C/H/M counts) | Round 1 fails = record it |

### KI Assessment

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I13 | US-I9 | Given Ralph Loop ends and pipeline attempts to enter next phase, When no ki assessment record found for this stage boundary, Then block pipeline, raise MISSING_KI_ASSESSMENT, auto-execute assessment | Assessment exists but empty = still valid |

### Commit Compliance

| # | US | Acceptance Criterion | Edge Cases |
|---|-----|---------------------|------------|
| AC-I14 | US-I6 | Given any phase completes, When phase done, Then auto-commit with message format: req-number: phase-name summary | No changes to commit = skip, log |
| AC-I15 | US-I6 | Given Ralph Loop round completes, When round done, Then auto-commit with message format: req-number: phase-name [Loop N] summary | N/A |
| AC-I16 | US-I6 | Given uncommitted files detected at phase boundary, When check runs, Then auto-commit all uncommitted files | MCP tool handles auto-commit |

---

## Commit Protocol

### Message Format
```
<req-number>: <phase-name> [Loop N] <summary>
```

Examples:
- INT-001: PHASE-1-DESIGN Initial requirements document
- INT-001: PHASE-2-SOLUTION [Loop 1] Address review feedback
- INT-001: PHASE-4-RED Write failing tests for intervener
- INT-001: PHASE-5-GREEN Implement intervener.intervene()

### Auto-Commit Rules
1. Phase boundary: When phase completes, commit all changes
2. Loop boundary: When Ralph Loop round completes, commit all changes
3. Intervention: When auto-fix is applied, commit fix results
4. Empty commit: If git diff is empty, skip and log
5. MCP integration: Use MCP commit_rule for rule files, git add -A and git commit for code/docs

---

## KI Document Protocol

### File
auto-reflection-feature/docs/04-review-records.md

### Update Triggers
1. Intervention: Every intervention, append entry
2. Ralph Loop round: Every round, append round results
3. Phase completion: Every phase, append phase summary
4. **Stage boundary assessment**: Before entering next phase, assess current status + issue priority

### Entry Format
```markdown
### [TYPE] Title

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

**Date**: ISO 8601
**Phase**: N
**Status**: PASS / CONDITIONAL / FAIL
**Open Issues**: N (priority sorted)
**Issue Priority**: P0: X items, P1: Y items, P2: Z items
**Ki Doc Updated**: Yes
**Committed**: Yes (hash: abc123)

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
- Constraint: SYNC mode only, block, rollback, retry. No async/hybrid in MVP.
- Constraint: No human override in MVP (emergency mode = v2)
- Constraint: One intervention per violation, no cascading interventions
- Constraint: KI document is append-only, no deletion or modification of existing entries
- Constraint: V-6 (MISSING_TEST) has no auto-fix, system cannot write meaningful tests for LLM

---

## Violation Type Summary

| Code | Name | Phase | Category | Auto-Fix | KI Required |
|------|------|-------|----------|----------|-------------|
| V-1 | SKIP_REVIEW | 1-3 | Process | No | Yes |
| V-2 | INSUFFICIENT_REVIEW | 1-3 | Process | No | Yes |
| V-3 | UNFIXED_ISSUES | 1-3 | Process | No | Yes |
| V-4 | SKIP_RED_PHASE | 4 | Behavioral | Yes - delete impl | Yes |
| V-5 | MODIFIED_TEST | 5 | Behavioral | Yes - git checkout HEAD | Yes |
| V-6 | MISSING_TEST | 4-5 | Behavioral | No - require LLM to write | Yes |
| V-7 | REGRESSION | 6 | Regression | No - mark + flag | Yes |
| V-8 | MISSING_KI_DOC | 1-7 | Compliance | Yes - auto-append | Self |
| V-9 | KI_DOC_OUTDATED | 1-7 | Compliance | Yes - auto-append | Self |
| V-10 | UNCOMMITTED_PHASE | 1-7 | Compliance | Yes - auto-commit | Yes |
| V-11 | UNCOMMITTED_REVIEW | 1-3 | Compliance | Yes - auto-commit | Yes |
| V-12 | MISSING_KI_ASSESSMENT | 1-7 | KI Assessment | Yes - auto-execute | Self |

Total: 12 violation types, 9 user stories, 16 acceptance criteria

Auto-fix count: 6 (V-4, V-5, V-8, V-9, V-10, V-11, V-12 = 7 with V-12 assessment)
No auto-fix count: 5 (V-1, V-2, V-3, V-6, V-7)

---

Document created: 2026-05-25
Version: v1.1
Changelog from v1.0:
- V-6 MISSING_TEST: Changed auto-fix from skeleton creation to no auto-fix (LLM must write meaningful test)
- V-12 MISSING_KI_ASSESSMENT: New violation type for stage boundary ki assessment
- US-I9, AC-I13: New user story and acceptance criteria for ki assessment
- KI Document Protocol: Added Stage Boundary Assessment format
Next step: Confirm requirements, then Brainstorm review, then Phase 2 Technical Solution
