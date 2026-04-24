# Aristotle — Testing Guide

> Testing overview for the Aristotle MCP rule engine + Bridge Plugin. Current coverage: 318 pytest + 104 static + 100 vitest + 23 e2e = 545 checks.

## 1. Test Suites Overview

| Suite | Command | Count | What It Covers |
|-------|---------|-------|----------------|
| Static | `bash test.sh` | 104 | File structure, SKILL.md content, hook logic, error pattern detection |
| Unit/Integration (Python) | `uv run pytest test/ -v` | 318 | All MCP tools, orchestration, evolution, frontmatter, git ops, Phase 0 Bridge MCP |
| Bridge Integration | `uv run pytest test/test_e2e_bridge_integration.py -v` | 9 | Bridge↔MCP integration: context fix, bridge detection, async workflow, multi-stage |
| Bridge Plugin (TypeScript) | `cd plugins/aristotle-bridge && bunx vitest run` | 100 | 7 modules: types, utils, api-probe, snapshot-extractor, workflow-store, idle-handler, executor |
| E2E Automated (opencode) | `bash test/e2e_opencode.sh` | 14 (5 PASS / 9 SKIP) | Real opencode session: skill load, sessions, learn, reflect (requires LLM) |
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

318 tests in 51+ test classes. All use isolated temp directories (`tmp_path` fixture) and are safe to run repeatedly.

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

### Phase 0 Bridge MCP Tests (23)

| Test File | Classes | Count | What It Tests |
|-----------|---------|-------|---------------|
| `test/test_phase0_snapshot.py` | TestResolveSessionsDir, TestBuildReflectorPrompt, TestOrchestrateStartSessionFile, TestBridgeDetection, TestOnUndo, TestUndoneShortCircuit | 13 | Session dir resolution, reflector prompt SESSION_FILE, bridge marker detection, on_undo tool, undone state short-circuit |
| `test/test_e2e_bridge_integration.py` | TestContextFixE2E, TestBridgeDetectionE2E, TestAsyncBridgeWorkflowE2E, TestMultiStageBridgeE2E | 9 | Bridge↔MCP integration via real stdio transport (see Section 4 for breakdown) |

## 4. Bridge Integration Tests (9 pytest)

```bash
uv run pytest test/test_e2e_bridge_integration.py -v
```

Integration tests verifying the Bridge↔MCP interaction via real MCP stdio transport.

### TestContextFixE2E — Context Fix Verification

| Test | Description |
|------|-------------|
| `test_reflect_prompt_contains_session_file_path` | snapshot → MCP reflect → prompt contains SESSION_FILE |
| `test_reflect_without_session_file_still_works` | Backward compat: no crash without session_file |
| `test_snapshot_file_on_disk_is_valid_json` | Snapshot JSON schema (v1, session_id) |

### TestBridgeDetectionE2E — Bridge Detection

| Test | Description |
|------|-------------|
| `test_use_bridge_true_when_marker_exists` | `.bridge-active` → use_bridge=true |
| `test_use_bridge_false_when_no_marker` | No marker → use_bridge=false |
| `test_marker_content_is_valid_json` | Marker schema (pid + startedAt) |

### TestAsyncBridgeWorkflowE2E — Async Workflow

| Test | Description |
|------|-------------|
| `test_full_async_reflect_workflow` | reflect → R → C → notify full chain |
| `test_bridge_poll_then_abort` | Abort running workflow |

### TestMultiStageBridgeE2E — Multi-Stage

| Test | Description |
|------|-------------|
| `test_two_round_reflect_check` | reflect → checker two-round loop |

### Bugs Found During E2E Testing

| Bug | Fix |
|-----|-----|
| `detect_conflicts` not registered as MCP tool | Added `mcp.tool()` registration |
| `write_rule` ID collision (second-precision timestamp) | Changed to millisecond timestamp |
| `commit_rule` bidirectional conflict annotation matched wrong rules | Exact ID match with `limit=10` |
| macOS `/tmp` symlink caused `relative_to` failure | Added `.resolve()` to `resolve_repo_dir()` |

## 5. Bridge Plugin Tests (100 vitest)

> Full test-level breakdown: See [plugins/aristotle-bridge/testing.en.md](plugins/aristotle-bridge/testing.en.md)

```bash
cd plugins/aristotle-bridge && bunx vitest run
```

| File | Count | Coverage |
|------|-------|----------|
| `utils.test.ts` | 7 | extractLastAssistantText: reverse traversal, sentinel, whitespace skip |
| `api-probe.test.ts` | 5 | detectApiMode: promptAsync detection, session cleanup |
| `snapshot-extractor.test.ts` | 12 | Truncation (4000/200), atomic write, filtering, schema |
| `workflow-store.test.ts` | 35 | Disk persistence, 50-cap eviction, reconcile batch-5, loadFromDisk validation |
| `idle-handler.test.ts` | 7 | Status filtering (running only), error handling |
| `executor.test.ts` | 12 | Launch flow, snapshot, crash safety, session.create try/catch |
| `index.test.ts` | 22 | 3 tool registration, event dispatch, .bridge-active marker, abort idempotency |

## 6. E2E Automated Tests (opencode)

```bash
bash test/e2e_opencode.sh
```

14 assertions driven by `opencode run "message" --format json`. Tests real skill loading and MCP calls.

| Group | Asserts | Result | Description |
|-------|---------|--------|-------------|
| E2E-1 | 1 | PASS | Skill loads |
| E2E-2 | 2 | PASS | Sessions (MCP calls + content) |
| E2E-3 | 2 | PASS | Learn (orchestration calls + content) |
| E2E-4 | 2 | SKIP | Reflect (requires LLM sub-agent) |
| E2E-5 | 2 | SKIP | Snapshot artifact (depends on reflect) |
| E2E-6 | 2 | SKIP | Bridge marker (requires plugin) |
| E2E-7 | 3 | SKIP | Workflow store (requires plugin) |

> SKIP tests require a running LLM or loaded Bridge Plugin. They pass when run in a live environment.

## 7. E2E Live Tests

```bash
bash test/live-test.sh --model <provider/model>
```

Creates a real session with known error patterns, triggers `/aristotle`, and verifies the full coordinator → reflector → rule-writing flow. 8 assertions.

## 8. Manual Test Plan

### P1: Passive Trigger (cannot be automated)

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

### Bridge Plugin Manual Scenarios (M1–M5)

#### M1: Reflect Full Flow (Context Fix Verification)

Prerequisites: opencode running, Aristotle MCP configured

1. Intentionally make an error (e.g., wrong API usage)
2. User corrects the error
3. Wait for passive trigger suggestion
4. Execute `/aristotle`
5. Verify: Reflector sub-agent can read error conversation context
6. Verify: `~/.config/opencode/aristotle-sessions/ses_*_snapshot.json` is created
7. Verify: snapshot.source is "t_session_search" or "bridge-plugin-sdk"
8. Verify: `/aristotle sessions` shows new record
9. Verify: `/aristotle review 1` shows rule draft

#### M2: Bridge Async Non-Blocking

Prerequisites: Bridge plugin loaded (.bridge-active exists)

1. Execute `/aristotle`
2. Verify: Main session is NOT blocked; LLM immediately returns "Task launched"
3. Verify: `~/.config/opencode/aristotle-sessions/.bridge-active` exists
4. Verify: `bridge-workflows.json` exists with workflowId
5. Poll `aristotle_check` or wait for idle event
6. Verify: Status transitions running → completed
7. Verify: Checker is automatically triggered upon completion

#### M3: Post-/undo Aristotle Cleanup

1. Start a running Aristotle workflow
2. Execute `/undo`
3. Verify: SKILL.md "After any /undo" rule triggers
4. Verify: `aristotle_check()` with no args returns active workflows
5. Verify: Each running workflow is cancelled via `aristotle_abort`
6. Verify: MCP `on_undo` is called
7. Verify: User sees "Cancelled N active Aristotle workflow(s)"

#### M4: Bridge Plugin Load Verification

1. Confirm `plugins/aristotle-bridge/` is compiled
2. Start opencode, no "promptAsync not available" in logs
3. Verify: `.bridge-active` marker exists (pid + startedAt)
4. Exit opencode, verify marker is cleaned up

#### M5: Multi-Stage Reflect-Check Loop

1. Execute `/aristotle` to trigger first reflect
2. Wait for Reflector to complete → Checker auto-starts
3. If Checker needs deeper analysis → second round Reflector
4. Verify: Each round launches via Bridge `aristotle_fire_o`
5. Verify: Each round `aristotle_check` returns correct status
6. Verify: Final Checker completion notifies user

## 9. Configuration Reference

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

## 10. CI Integration

All test suites can run headless:

```bash
# Quick smoke test (Python + static)
bash test.sh && uv run pytest test/ -q

# Bridge Plugin
cd plugins/aristotle-bridge && bunx vitest run
```

Expected result: `318 passed` + `104 passed` + `100 passed` = **522 checks, 0 failures**.

## 11. Gate #1 Verification (Completed)

**Question**: Does `session.prompt({noReply: true})` inject a system-reminder into the parent session?

**Result**: **No.** `noReply: true` causes a hang bug (OpenCode issues #4431, #14451) — it does not inject messages into the parent session. This was verified via `test/gate1-noReply-verify.sh`.

**Decision**: Bridge Plugin adopted polling mode instead of noReply injection. SKILL.md uses idle detection + `aristotle_check`/`aristotle_abort` tools to manage async reflection without blocking the main session.
