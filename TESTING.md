# Aristotle — Testing Guide

> Testing overview for the Aristotle MCP rule engine. Current coverage: 295 pytest + 104 static + 70 e2e = 469 checks.

## 1. Test Suites Overview

| Suite | Command | Count | What It Covers |
|-------|---------|-------|----------------|
| Static | `bash test.sh` | 104 | File structure, SKILL.md content, hook logic, error pattern detection |
| Unit/Integration | `uv run pytest test/ -v` | 295 | All MCP tools, orchestration, evolution, frontmatter, git ops |
| E2E Automated | `uv run python test_e2e_phase2.py` | 70 | Full MCP stdio transport, orchestration workflows, feedback, conflicts |
| E2E Live | `bash test/live-test.sh --model <provider/model>` | 8 | Real session with known error patterns |

## 2. Static Tests

```bash
bash test.sh
```

104 assertions covering:
- File structure integrity (SKILL.md, config.py, test.sh)
- Progressive disclosure (SKILL.md ≤ 60 lines, omits internal details)
- Hook logic and argument parsing
- Error pattern detection (English/Chinese/threshold)
- Architecture guarantees
- Phase 2: Passive Trigger section (M8)

## 3. Unit/Integration Tests (pytest)

```bash
uv run pytest test/ -v
```

295 tests in 50 test classes. All use isolated temp directories (`tmp_path` fixture) and are safe to run repeatedly.

### Phase 1 Tests (227)

| Test File | Classes | Count | What It Tests |
|-----------|---------|-------|---------------|
| `test/mcp/test_mcp_config.py` | TestConfig | 14 | Path resolution, env override, RISK_MAP, RISK_WEIGHTS, AUDIT_THRESHOLDS, SKILL_DIR, project hash |
| `test/mcp/test_mcp_evolution.py` | TestEvolution | 10 | compute_delta (all risk levels, edge cases, validation), decide_audit_level |
| `test/mcp/test_mcp_models.py` | TestModels | 13 | RuleMetadata defaults, YAML serialization roundtrip, GEAR 2.0 fields |
| `test/mcp/test_mcp_git_ops.py` | TestGitOps | 8 | init, add+commit, show, log, status, git_show_exists |
| `test/mcp/test_mcp_frontmatter.py` | TestFrontmatter | 18 | Atomic write, raw read, field update, stream filter, multi-dimension search |
| `test/mcp/test_mcp_migration.py` | TestMigration | 8 | Flat Markdown parsing, repo init, auto-migration |
| `test/mcp/test_mcp_server_tools.py` | TestServerTools, TestSyncTools, TestPathTraversal | 36 | Full lifecycle, reject, restore, sync, path containment |
| `test/mcp/test_mcp_server_delta.py` | TestDeltaDecision | 8 | get_audit_decision, confidence defaults, Δ audit levels |
| `test/mcp/test_mcp_server_reflection.py` | TestPersistDraft, TestCreateReflectionRecord, TestCompleteReflectionRecord | 21 | Draft persistence, reflection records, state management |
| `test/test_orchestration.py` | TestOrchestrateStart, TestOrchestrateOnEvent, TestWorkflowStateManagement, TestIntegrationMockO, TestSearchParamMapping, TestHelperFunctions, TestOrchestrateStartSessions | 52 | Learn orchestration, workflow state, sessions, helpers |
| `test/test_review_actions.py` | TestOrchestrateReviewAction, TestExceptionRevise, TestIntegrationReview | 18 | Review actions, exception paths, integration |
| `test/test_reflect_workflow.py` | TestOrchestrateStartReflect, TestOrchestrateOnEventReflect, TestExceptionReflect, TestExceptionStart | 17 | Reflect flow, exception handling |
| `test/test_count_propagation.py` | TestReReflectCountPropagation | 4 | Re-reflect count inheritance and cascading |

### Phase 2 Tests (68)

| Test File | Count | What It Tests |
|-----------|-------|---------------|
| `test/test_m1_committed_paths.py` | 8 | committed_rule_paths collection → propagation → confirm fast path |
| `test/test_m5_two_round.py` | 24 | Two-round retrieval (search → score → compress), intent extraction, scoring, compression |
| `test/test_m6_feedback.py` | 13 | report_feedback tool, feedback signal metadata, auto-reflect trigger |
| `test/test_m7_delta_norm.py` | 12 | compute_delta log-normalization, sample_size passthrough, audit level thresholds |
| `test/test_m9_conflicts.py` | 11 | detect_conflicts, bidirectional conflict annotation, triple matching |

## 4. E2E Automated Tests (Phase 2)

```bash
uv run python test_e2e_phase2.py
```

70 tests running through MCP stdio transport. Spawns a real MCP server subprocess and calls tools via JSON-RPC.

### Coverage by Test Function

| Test Function | Assertions | Scenarios |
|---------------|------------|-----------|
| `test_learn` | 13 | Full two-round retrieval, shortcut path, no results, missing params |
| `test_reflect` | 9 | Reflector→Checker full chain, missing params |
| `test_review` | 7 | Confirm, re-reflect, non-existent sequence |
| `test_feedback` | 13 | Metadata updates, delta log-norm, missing params, nonexistent rules |
| `test_feedback_auto_reflect` | 5 | Auto-reflect trigger, max depth guard |
| `test_conflicts` | 11 | Bidirectional annotation, no-conflict rule, detect_conflicts |
| `test_integration` | 10 | Unknown workflow, invalid JSON, sessions, reject+restore, nonexistent file |
| `test_passive_trigger` | 5 | SKILL.md content validation (4 assertions + 1 structural) |

### Bugs Found During E2E Testing

| Bug | Fix |
|-----|-----|
| `detect_conflicts` not registered as MCP tool | Added `mcp.tool()` registration |
| `write_rule` ID collision (second-precision timestamp) | Changed to millisecond timestamp |
| `commit_rule` bidirectional conflict annotation matched wrong rules | Exact ID match with `limit=10` |
| macOS `/tmp` symlink caused `relative_to` failure | Added `.resolve()` to `resolve_repo_dir()` |

## 5. E2E Live Tests

```bash
bash test/live-test.sh --model <provider/model>
```

Creates a real session with known error patterns, triggers `/aristotle`, and verifies the full coordinator → reflector → rule-writing flow. 8 assertions.

## 6. Manual Test Plan (P1 — Passive Trigger)

> This is the only scenario that cannot be automated. It requires verifying the host agent's behavior in a real conversation.

### Objective

Verify that the SKILL.md PASSIVE TRIGGER section correctly causes the host agent to suggest running `/aristotle` when error patterns are detected, without auto-invoking it.

### Prerequisites

1. Aristotle skill installed in Claude Code or OpenCode
2. A conversation session with the agent

### Test Cases

Each test case maps to one of the three SKILL.md PASSIVE TRIGGER patterns.

#### P1-A: Agent Self-Correction (Pattern 1 — "You corrected your own output")

**Steps:**
1. Ask the agent to implement a function (e.g., "Write a function to sort an array")
2. After the agent produces code, ask it to review its own work: "Can you review the code you just wrote?"
3. The agent **itself** discovers an issue: "Wait, there's a bug with..."
4. The agent self-corrects

**Expected:** Agent outputs a suggestion like:
> 🦉 I detected an error pattern. Run /aristotle to reflect and prevent similar mistakes.

**Assert:**
- ✅ Agent discovers the error **on its own** (not pointed out by user)
- ✅ Agent suggests `/aristotle`
- ✅ Agent does NOT automatically invoke `/aristotle`

#### P1-B: Approach Switch (Pattern 3 — "You tried an approach, it failed, and you switched")

**Steps:**
1. Give the agent a challenging task where the first approach may fail
2. Agent tries approach A, which fails (compile error, test failure, etc.)
3. Agent says "Let me try a different approach..." and switches to approach B

**Expected:** Agent outputs passive trigger suggestion after the switch.

**Assert:**
- ✅ Agent initiates the switch **on its own**
- ✅ Passive trigger suggestion appears

#### P1-C: User Correction (Pattern 2 — "User pointed out an error and you agreed")

**Steps:**
1. Ask the agent to implement something
2. Agent produces output with an error
3. **User** points out the error: "That's wrong, it doesn't handle empty arrays"
4. Agent agrees and corrects

**Expected:** Agent outputs passive trigger suggestion after agreeing with user correction.

**Assert:**
- ✅ **User** points out the error, agent agrees
- ✅ Passive trigger suggestion appears

#### P1-D: No False Positive

**Steps:**
1. Normal conversation (asking questions, getting answers)
2. No corrections or errors occur

**Expected:** No Aristotle suggestion triggered.

#### P1-E: Thinking-Phase Self-Correction (No Trigger — Correct Behavior)

**Steps:**
1. Agent encounters an error during its thinking/reasoning phase
2. Agent recognizes the mistake internally but self-corrects before producing the final output
3. The final output to the user is already correct — no visible error in the conversation

**Expected:** No Aristotle suggestion triggered.

**Rationale:** The agent resolved the error before it reached the conversation. Passive trigger monitors visible conversation patterns, not internal reasoning states.

#### P1-F: Main Session Corrects Subagent Error (Trigger)

**Steps:**
1. A subagent (spawned via `task()`) returns a result with an error
2. The main session agent reviews the subagent output
3. Main session agent detects the error and corrects it

**Expected:** Passive trigger suggestion appears — the main session agent detected and corrected an error.

**Rationale:** This matches Pattern 1 ("You corrected your own output") from the main session's perspective. The multi-agent error detection scenario is explicitly covered by SKILL.md's trigger patterns.

### Validation Checklist

After completing all P1 tests, verify:
- [ ] P1-A: Agent **self** discovers error → suggestion appears (Pattern 1)
- [ ] P1-B: Agent switches approach → suggestion appears (Pattern 3)
- [ ] P1-C: **User** points out error, agent agrees → suggestion appears (Pattern 2)
- [ ] P1-D: Normal conversation → no suggestion
- [ ] P1-E: Thinking-phase correction (no visible error) → no suggestion ✅
- [ ] P1-F: Main session corrects subagent error → suggestion appears ✅
- [ ] Agent never auto-invokes `/aristotle`
- [ ] Suggestion text matches SKILL.md definition

## 7. Configuration Reference

### Test Constants (config.py)

| Constant | Value | Purpose |
|----------|-------|---------|
| `SCORING_TOP_N` | 5 | Top N rules to score after search |
| `SCORE_PARALLEL_MAX` | 3 | Max parallel scoring |
| `COMPRESS_TOP_N` | 3 | Top N rules for compression |
| `COMPRESS_MAX_CHARS` | 800 | Total compressed output char limit |
| `COMPRESS_RULE_MAX_CHARS` | 200 | Per-rule compressed char limit |
| `MAX_FEEDBACK_REFLECT` | 3 | Max auto-reflect depth from feedback |
| `MAX_SAMPLES` | 20 | Log-normalization denominator |
| `AUDIT_THRESHOLDS.auto` | 0.7 | Δ > 0.7 → auto commit |
| `AUDIT_THRESHOLDS.semi` | 0.4 | 0.4 < Δ ≤ 0.7 → semi-auto |
| `RISK_WEIGHTS` | high=0.8, medium=0.5, low=0.2 | Risk multipliers |

## 8. CI Integration

All test suites can run headless:

```bash
# Quick smoke test
bash test.sh && uv run pytest test/ -q

# Full Phase 2 validation
bash test.sh && uv run pytest test/ -q && uv run python test_e2e_phase2.py
```

Expected result: `295 passed` + `104 passed` + `70 passed` = **469 checks, 0 failures**.
