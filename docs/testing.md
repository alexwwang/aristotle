# Aristotle — Testing Guide

> Aristotle MCP rule engine + Bridge plugin test overview. Current coverage: 325 pytest + 103 static + 148 vitest + 64 regression = 640 checks.

## 1. Test Suites Overview

| Suite | Command | Count | What It Covers |
|-------|---------|-------|----------------|
| Static | `bash test.sh` | 103 | File structure, SKILL.md content, hook logic, error pattern detection, progressive disclosure (byte limit) |
| Python | `uv run pytest test/ -v` | 325 | MCP core, orchestration & workflows, evolution, frontmatter, git ops, Bridge MCP |
| Bridge Plugin | `cd plugins/aristotle-bridge && bunx vitest run` | 144 | 7 modules: types/utils/api-probe/snapshot-extractor/workflow-store/idle-handler/executor |
| E2E Automated | `bash test/e2e_opencode.sh` | 14 | Real opencode session: skill load, sessions, learn, reflect (requires LLM) |
| B1 Regression | `bash test/regression_b1_checks.sh` | 64 | Post-deploy verification for B1 fixes |

## 2. Static Tests (103)

```bash
bash test.sh
```

103 assertions covering:
- File structure integrity (SKILL.md, config.py)
- Progressive disclosure (all skill docs by byte size: SKILL.md ≤ 8KB, REFLECT.md ≤ 8KB, REVIEW.md ≤ 8KB)
- Hook logic and argument parsing
- Error pattern detection (English/Chinese/threshold)
- Architecture guarantees (dispatcher contains no protocol details, subagent reads session via SESSION_FILE)
- Phase 2: Passive Trigger paragraph (M8)

## 3. Python Tests (325)

```bash
uv run pytest test/ -v
```

325 tests across 51+ test classes. All tests use isolated temp directories (`tmp_path` fixture) and are safe to run repeatedly.

### 3.1 MCP Core (test/mcp/ — 136 tests)

| Test File | Test Class | Count | What It Tests |
|-----------|-----------|-------|---------------|
| `test/mcp/test_mcp_config.py` | TestConfig | 14 | Path resolution, env override, RISK_MAP, RISK_WEIGHTS, AUDIT_THRESHOLDS, SKILL_DIR, project hash |
| `test/mcp/test_mcp_evolution.py` | TestEvolution | 10 | compute_delta (all risk levels, edge cases, validation), decide_audit_level |
| `test/mcp/test_mcp_models.py` | TestModels | 13 | RuleMetadata defaults, YAML serialization roundtrip, GEAR 2.0 fields |
| `test/mcp/test_mcp_git_ops.py` | TestGitOps | 8 | init, add+commit, show, log, status, git_show_exists |
| `test/mcp/test_mcp_frontmatter.py` | TestFrontmatter | 18 | Atomic write, raw read, field update, stream filter, multi-dimension search |
| `test/mcp/test_mcp_migration.py` | TestMigration | 8 | Flat Markdown parsing, repo init, auto-migration |
| `test/mcp/test_mcp_server_tools.py` | TestServerTools, TestSyncTools, TestPathTraversal | 36 | Full lifecycle, reject, restore, sync, path containment |
| `test/mcp/test_mcp_server_delta.py` | TestDeltaDecision | 8 | get_audit_decision, confidence defaults, Δ audit levels |
| `test/mcp/test_mcp_server_reflection.py` | TestPersistDraft, TestCreateReflectionRecord, TestCompleteReflectionRecord | 21 | Draft persistence, reflection records, state management |

### 3.2 Orchestration & Workflows (test/ — 182 tests)

| Test File | Test Class | Count | What It Tests |
|-----------|-----------|-------|---------------|
| `test/test_orchestration.py` | TestOrchestrateStart, TestOrchestrateOnEvent, TestWorkflowStateManagement, TestIntegrationMockO, TestSearchParamMapping, TestHelperFunctions, TestOrchestrateStartSessions | 52 | Learn orchestration, workflow state, sessions, helpers |
| `test/test_review_actions.py` | TestOrchestrateReviewAction, TestExceptionRevise, TestIntegrationReview | 18 | Review actions, exception paths, integration |
| `test/test_reflect_workflow.py` | TestOrchestrateStartReflect, TestOrchestrateOnEventReflect, TestExceptionReflect, TestExceptionStart | 17 | Reflect flow, exception handling |
| `test/test_count_propagation.py` | TestReReflectCountPropagation | 4 | Re-reflect count inheritance and cascading |
| `test/test_m1_committed_paths.py` | — | 8 | committed_rule_paths collection → propagation → confirm fast path |
| `test/test_m5_two_round.py` | — | 24 | Two-round retrieval (search → score → compress), intent extraction, scoring, compression |
| `test/test_m6_feedback.py` | — | 13 | report_feedback tool, feedback signal metadata, auto-reflect trigger |
| `test/test_m7_delta_norm.py` | — | 12 | compute_delta log-normalization, sample_size passthrough, audit level thresholds |
| `test/test_m9_conflicts.py` | — | 11 | detect_conflicts, bidirectional conflict annotation, triple matching |
| `test/test_phase0_snapshot.py` | TestResolveSessionsDir, TestBuildReflectorPrompt, TestOrchestrateStartSessionFile, TestBridgeDetection, TestOnUndo, TestUndoneShortCircuit | 14 | Session dir resolution, reflector prompt SESSION_FILE, Bridge marker detection, on_undo tool, undone state short-circuit |
| `test/test_e2e_bridge_integration.py` | TestContextFixE2E, TestBridgeDetectionE2E, TestAsyncBridgeWorkflowE2E, TestMultiStageBridgeE2E | 9 | Bridge↔MCP integration: context fix, Bridge detection, async workflow, multi-stage |

## 4. Bridge Plugin Tests (144 vitest)

> Full test-level breakdown: see [plugins/aristotle-bridge/testing.md](plugins/aristotle-bridge/testing.md)

```bash
cd plugins/aristotle-bridge && bunx vitest run
```

| File | Count | Coverage |
|------|-------|----------|
| `utils.test.ts` | 7 | extractLastAssistantText: reverse traversal, sentinel, whitespace skip |
| `api-probe.test.ts` | 5 | detectApiMode: promptAsync detection, session cleanup |
| `snapshot-extractor.test.ts` | 12 | Truncation (4000/200), atomic write, filtering, schema |
| `workflow-store.test.ts` | 45 | Disk persistence, 50-cap eviction, reconcile batch-5, loadFromDisk validation, instanceId isolation, saveToDisk merge |
| `idle-handler.test.ts` | 40 | Status guards, R→C chain driving (mock subprocess), C completion, error handling, resolveMcpProjectDir, callMCP error parsing, trigger file handling, abort trigger handling |
| `executor.test.ts` | 12 | Launch flow, snapshot, crash safety, session.create try/catch |
| `index.test.ts` | 23 | 3 tool registrations, event dispatch, .bridge-active marker, abort idempotency |

## 5. E2E & Automation Scripts

### 5.1 E2E Automated (opencode run)

```bash
bash test/e2e_opencode.sh
```

14 assertions driven by `opencode run "message" --format json`. Tests real skill loading and MCP calls.

| Group | Asserts | Result | Description |
|-------|---------|--------|-------------|
| E2E-1 | 1 | PASS | Skill loads |
| E2E-2 | 2 | PASS | Sessions (MCP calls + content) |
| E2E-3 | 2 | PASS | Learn (orchestration calls + content) |
| E2E-4 | 2 | PASS | Reflect (requires LLM sub-agent) |
| E2E-5 | 2 | PASS | Snapshot artifact (depends on reflect) |
| E2E-6 | 2 | PASS | Bridge marker (requires plugin) |
| E2E-7 | 3 | PASS | Workflow store (requires plugin) |

### 5.2 B1 R→C Chain (tmux)

One opencode session covers plugin load, async reflect, and undo cleanup. **18 verification points.**

| Step | Action | Verification | Covers |
|------|--------|-------------|--------|
| A1 | Start opencode (with Bridge plugin) | No "promptAsync not available" in logs | M4-2 |
| A2 | Check `~/.config/opencode/aristotle-sessions/.bridge-active` | File exists with valid JSON (pid + startedAt) | M4-3 |
| A3 | Send `/aristotle` | LLM immediately returns (session NOT blocked) | M2-1,2 |
| A4 | Check `.bridge-active` still exists | Marker present | M2-3 |
| A5 | Check `bridge-workflows.json` | File exists with workflowId | M2-4 |
| A6 | Wait for idle event or poll status | Status: running → completed | M2-5,6 |
| A7 | Verify R→C chain — automated (B1) | Plugin drives R→C chain via subprocess. `bash test/e2e_a7_r2c_chain.sh --project /path/to/project` | M2-7 |
| A8 | Send `/aristotle` again to start a new workflow | New workflow appears, status = running | M3-1 |
| A9 | Cancel running workflow via `.trigger-abort.json` | `checkAbortTrigger()` reads file, cancels all active workflows | M3-2,3 |
| A10 | Check `aristotle_check` output | Returns running workflows | M3-4 |
| A11 | Verify cancellation | Each running workflow is cancelled via `store.cancel()`, status becomes terminal | M3-5,6 |
| A12 | Verify user-visible message | tmux output contains "cancelled" + "workflow" | M3-7 |
| A13 | Exit opencode | `.bridge-active` marker cleaned up | M4-4 |

**Automation notes**: A1–A13 are driven via tmux + trigger-file mechanism. A8 uses `.trigger-reflect.json` + neutral message to trigger idle event; A9 uses `.trigger-abort.json` to trigger `checkAbortTrigger()`. A3 depends on LLM response time — add sufficient sleep or polling loop.

### 5.3 B1 Regression Checks

```bash
bash test/regression_b1_checks.sh
```

64 assertions covering all B1 fixes. Run before every deployment.

| Category | Checks | What It Verifies |
|----------|--------|------------------|
| Config | 2 | opencode.json paths (no tilde), absolute paths |
| MCP logic | 2 | checking→done, reflecting→fire_sub |
| CLI entry | 3 | _cli.py exists, reads stdin, handles empty input |
| Status types | 2 | chain_pending/chain_broken in types.ts |
| Workflow store | 7 | markChainPending/Broken, retrieve, getActive, eviction, reconcile |
| Chain driving | 8 | subprocess call, stdin payload, launchResult.status, no markCompleted after fire_sub, notify→chainBroken, debug log, cancelled race |
| Index integration | 3 | 4-arg constructor, abort chain_broken/chain_pending |
| Logger | 3 | exists, stderr output, unknown[] types |
| Deploy sync | 4 | install dir exists, _cli.py synced, done action synced, plugin deployed |
| Test assertions | 5 | notify→done in Python tests, bridge-active marker cleanup |
| Bug #11–#12 | 10 | instanceId isolation, reconcile timeout, saveToDisk merge, eviction persistence |
| Bug #13–#14 | 6 | spawn stdin, promptAsync no agent, ToolDefinition format, context?.sessionID |
| Tool registration | 6 | description/args/execute format, fire_o defaults, abort idempotency |
| Executor | 4 | no polling directive, STOP message |

Design principle: one check per fix, check intent not implementation, cover config layer, fast and repeatable.

## 6. Test Scenarios

### 6.1 Passive Trigger (P1) — requires live LLM

> The only scenario that cannot be automated. Requires verifying the host agent's behavior in a real conversation.

**Objective**: Verify that SKILL.md PASSIVE TRIGGER paragraph correctly guides the host agent to suggest `/aristotle` when error patterns are detected, without auto-invoking it.

**Prerequisites**:
1. Aristotle skill installed in Claude Code or OpenCode
2. A conversation session is open

| Case | Trigger Pattern | Steps | Expected Output | Assert |
|------|-----------------|-------|-----------------|--------|
| P1-A | Pattern 1 — Agent Self-Correction | 1. Ask agent to implement a function 2. Ask it to self-review 3. Agent discovers issue and self-corrects | Agent suggests running `/aristotle` | Agent discovers error on its own; suggests `/aristotle`; does not auto-invoke |
| P1-B | Pattern 3 — Approach Switch | 1. Give agent a challenging task 2. Approach A fails 3. Agent proactively switches to approach B | Passive trigger suggestion appears after switch | Agent proactively switches; suggestion appears |
| P1-C | Pattern 2 — User Points Out Error | 1. Ask agent to implement something 2. Agent produces error 3. User points it out, agent agrees and corrects | Suggestion appears after agreeing to correct | User points out, agent agrees; suggestion appears |
| P1-D | No Trigger | Normal conversation, no corrections | No suggestion triggered | No suggestion |
| P1-E | Thinking-Phase Self-Correction (No Trigger) | Agent discovers error internally and corrects before output, final output is correct | No suggestion triggered | No suggestion |
| P1-F | Main Session Corrects Subagent Error | Subagent returns error, main session discovers and corrects it | Trigger suggestion appears | Main session detects and corrects error; suggestion appears |

**Rationale**:
- P1-E: The agent resolved the error before it reached the conversation. Passive Trigger monitors visible conversation patterns, not internal reasoning state.
- P1-F: From the main session's perspective, this matches Pattern 1 ("You corrected your own output"). Multi-agent error detection is explicitly covered by SKILL.md's trigger patterns.

**Validation Checklist**:

- [ ] P1-A: Agent self-discovers error and corrects → suggestion appears (Pattern 1)
- [ ] P1-B: Agent switches approach → suggestion appears (Pattern 3)
- [ ] P1-C: User points out error, agent agrees → suggestion appears (Pattern 2)
- [ ] P1-D: Normal conversation → no suggestion
- [ ] P1-E: Thinking-phase correction (no visible error) → no suggestion
- [ ] P1-F: Main session corrects subagent error → suggestion appears
- [ ] Agent never auto-invokes `/aristotle`
- [ ] Suggestion text matches SKILL.md definition

### 6.2 Bridge Plugin Scenarios (M1–M5)

> **Execution strategy**: Original 5 scenarios merged into 2 execution rounds by automation feasibility. Full coverage retained — each original verification point maps to steps below.

#### Round B: M1 + M5 — Reflect-Check Full Chain (semi-automated)

One `/aristotle` invocation covers snapshot extraction, reflect-check loop, sessions, and review. **15 verification points.**

| Step | Action | Verification | Covers |
|------|--------|-------------|--------|
| B1 | Intentionally produce an error in conversation, then correct it | Error-correction pattern visible in session | M1-1,2,3 |
| B2 | Send `/aristotle` | Reflector sub-agent launched | M1-4, M5-1 |
| B3 | Check `~/.config/opencode/aristotle-sessions/ses_*_snapshot.json` | File created; snapshot.source is "t_session_search" or "bridge-plugin-sdk" | M1-5,6,7 |
| B4 | Wait for Reflector → Checker chain | Each round launched via `aristotle_fire_o`; each round's state is correct | M5-2,3,4 |
| B5 | If Checker requests deeper analysis | Second-round Reflector auto-triggered | M5-3 |
| B6 | Check each round's status via `aristotle_check` | Status running → completed transitions round by round | M5-5 |
| B7 | Verify final completion notification | User sees completion message | M5-6 |
| B8 | Send `/aristotle sessions` | New record appears with correct status | M1-8 |
| B9 | Send `/aristotle review 1` | DRAFT rule content displayed | M1-9 |

**Automation notes**: B3, B4, B6, B8, B9 are file/API assertions. B1, B2, B5 depend on LLM. Can be scripted via `opencode run "message" --format json`.

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
| `RISK_WEIGHTS` | high=0.8, medium=0.5, low=0.2 | Risk weights |

## 8. CI Integration

### 8.1 Test Commands

All test suites can run headless:

```bash
# Quick smoke test (Python + static)
bash test.sh && uv run pytest test/ -q

# Bridge Plugin
cd plugins/aristotle-bridge && bunx vitest run

# B1 Regression (run before every deployment)
bash test/regression_b1_checks.sh
```

Expected result: `325 passed` + `103 passed` + `148 passed` + `64 passed` = **640 checks, 0 failures**.
### 8.2 Pre-Test Deployment

Before E2E/live testing, ensure the production environment is up to date. See [deployment.md](deployment.md) for the full checklist and deploy steps.