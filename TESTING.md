# Aristotle — Testing Guide

> Technical reference: commands, coverage, how to run. Current coverage: 306 pytest + 104 static + 118 vitest + 39 regression = 567 checks.

## 1. Test Suites Overview

| Suite | Command | Count | What It Covers |
|-------|---------|-------|----------------|
| Static | `bash test.sh` | 104 | File structure, SKILL.md content, hook logic, error pattern detection |
| Python (MCP Core) | `uv run pytest test/mcp/ -v` | 136 | Config, models, evolution, git ops, frontmatter, migration, server tools, delta, reflection |
| Python (Orchestration) | `uv run pytest test/ -v` | 170 | Orchestration, review, reflect workflow, count propagation, Phase 0 Bridge, M1–M9 |
| Bridge Plugin (TypeScript) | `cd plugins/aristotle-bridge && bunx vitest run` | 118 | Types, utils, api-probe, snapshot-extractor, workflow-store, idle-handler, executor, index |
| E2E Automated (opencode) | `bash test/e2e_opencode.sh` | 14 (5 PASS / 9 SKIP) | Real opencode session: skill load, sessions, learn, reflect (requires LLM) |
| B1 Regression | `bash test/regression_b1_checks.sh` | 39 | Post-deploy verification for B1 fixes (config paths, code logic, test assertions, deploy sync) |

## 2. Static Tests (104)

```bash
bash test.sh
```

104 assertions covering:
- File structure integrity (SKILL.md, config.py, test.sh)
- Progressive disclosure (SKILL.md ≤ 60 lines, omits internal details)
- Hook logic and argument parsing
- Error pattern detection (English/Chinese/threshold)
- Architecture guarantees
- Passive Trigger section (M8)

## 3. Python Tests (318)

```bash
uv run pytest test/ -v
```

All tests use isolated temp directories (`tmp_path` fixture) and are safe to run repeatedly.

### 3.1 MCP Core (test/mcp/ — 136 tests)

| Test File | Count | What It Tests |
|-----------|-------|---------------|
| `test/mcp/test_mcp_config.py` | 14 | Path resolution, env override, RISK_MAP, RISK_WEIGHTS, AUDIT_THRESHOLDS, SKILL_DIR, project hash |
| `test/mcp/test_mcp_evolution.py` | 10 | compute_delta (all risk levels, edge cases, validation), decide_audit_level |
| `test/mcp/test_mcp_models.py` | 13 | RuleMetadata defaults, YAML serialization roundtrip, GEAR 2.0 fields |
| `test/mcp/test_mcp_git_ops.py` | 8 | init, add+commit, show, log, status, git_show_exists |
| `test/mcp/test_mcp_frontmatter.py` | 18 | Atomic write, raw read, field update, stream filter, multi-dimension search |
| `test/mcp/test_mcp_migration.py` | 8 | Flat Markdown parsing, repo init, auto-migration |
| `test/mcp/test_mcp_server_tools.py` | 36 | Full lifecycle, reject, restore, sync, path containment |
| `test/mcp/test_mcp_server_delta.py` | 8 | get_audit_decision, confidence defaults, Δ audit levels |
| `test/mcp/test_mcp_server_reflection.py` | 21 | Draft persistence, reflection records, state management |

### 3.2 Orchestration & Workflows (test/ — 182 tests)

| Test File | Count | What It Tests |
|-----------|-------|---------------|
| `test/test_orchestration.py` | 52 | Learn orchestration, workflow state, sessions, helpers |
| `test/test_review_actions.py` | 18 | Review actions, exception paths, integration |
| `test/test_reflect_workflow.py` | 17 | Reflect flow, exception handling |
| `test/test_m5_two_round.py` | 24 | Two-round retrieval (search → score → compress), intent extraction, scoring, compression |
| `test/test_phase0_snapshot.py` | 14 | Session dir resolution, reflector prompt SESSION_FILE, bridge marker detection, on_undo tool, undone state short-circuit |
| `test/test_m6_feedback.py` | 13 | report_feedback tool, feedback signal metadata, auto-reflect trigger |
| `test/test_m7_delta_norm.py` | 12 | compute_delta log-normalization, sample_size passthrough, audit level thresholds |
| `test/test_m9_conflicts.py` | 11 | detect_conflicts, bidirectional conflict annotation, triple matching |
| `test/test_e2e_bridge_integration.py` | 9 | Bridge↔MCP integration via real stdio transport: context fix, bridge detection, async workflow, multi-stage |
| `test/test_m1_committed_paths.py` | 8 | committed_rule_paths collection → propagation → confirm fast path |
| `test/test_count_propagation.py` | 4 | Re-reflect count inheritance and cascading |

### Bugs Found During E2E Testing

| Bug | Fix |
|-----|-----|
| `detect_conflicts` not registered as MCP tool | Added `mcp.tool()` registration |
| `write_rule` ID collision (second-precision timestamp) | Changed to millisecond timestamp |
| `commit_rule` bidirectional conflict annotation matched wrong rules | Exact ID match with `limit=10` |
| macOS `/tmp` symlink caused `relative_to` failure | Added `.resolve()` to `resolve_repo_dir()` |

## 4. Bridge Plugin Tests (118 vitest)

```bash
cd plugins/aristotle-bridge && bunx vitest run
```

| File | Count | Coverage |
|------|-------|----------|
| `utils.test.ts` | 7 | extractLastAssistantText: reverse traversal, sentinel, whitespace skip |
| `api-probe.test.ts` | 5 | detectApiMode: promptAsync detection, session cleanup |
| `snapshot-extractor.test.ts` | 12 | Truncation (4000/200), atomic write, filtering, schema |
| `workflow-store.test.ts` | 35 | Disk persistence, 50-cap eviction, reconcile batch-5, loadFromDisk validation |
| `idle-handler.test.ts` | 25 | Status guards, R→C chain via mock subprocess, C completion, error handling, resolveMcpProjectDir, callMCP errors |
| `executor.test.ts` | 12 | Launch flow, snapshot, crash safety, session.create try/catch |
| `index.test.ts` | 22 | 3 tool registration, event dispatch, .bridge-active marker, abort idempotency |

## 5. E2E & Automation Scripts

### 5.1 E2E Automated (opencode run) — `bash test/e2e_opencode.sh`

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

> 9/14 tests SKIP without a running LLM or loaded Bridge Plugin. They pass in a live environment.

### 5.2 B1 R→C Chain (tmux) — `bash test/e2e_a7_r2c_chain.sh --project /path`

Tmux-based test for the B1 plugin-driven R→C chain. Starts opencode, triggers `/aristotle`, and verifies the full reflect→checker auto-chain via DB state and workflow JSON — no LLM polling required.

```bash
bash test/e2e_a7_r2c_chain.sh --project /path/to/project
```

### 5.3 B1 Regression Checks — `bash test/regression_b1_checks.sh`

39 assertions covering all B1 fixes. Run before every deployment.

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

## 6. Test Scenarios

### 6.1 Passive Trigger (P1) — requires live LLM

> The only scenario that cannot be automated. Requires verifying the host agent's behavior in a real conversation.

**Objective**: Verify that SKILL.md PASSIVE TRIGGER causes the host agent to suggest `/aristotle` when error patterns are detected, without auto-invoking it.

| Case | Trigger Pattern | Steps | Expected | Assert |
|------|-----------------|-------|----------|--------|
| P1-A | Agent Self-Correction (Pattern 1) | 1. Ask agent to implement a function<br>2. Ask it to review its own work<br>3. Agent discovers issue and self-corrects | Agent suggests: "🦉 I detected an error pattern. Run /aristotle to reflect..." | Agent discovers error **on its own**; suggests `/aristotle`; does NOT auto-invoke |
| P1-B | Approach Switch (Pattern 3) | 1. Give agent a challenging task<br>2. Agent tries approach A, fails<br>3. Agent switches to approach B | Passive trigger suggestion after the switch | Agent initiates switch **on its own**; suggestion appears |
| P1-C | User Correction (Pattern 2) | 1. Ask agent to implement something<br>2. Agent produces output with an error<br>3. **User** points out the error; agent agrees and corrects | Passive trigger suggestion after agreeing with user correction | **User** points out error, agent agrees; suggestion appears |
| P1-D | No False Positive | 1. Normal conversation (questions/answers)<br>2. No corrections or errors occur | No Aristotle suggestion triggered | — |
| P1-E | Thinking-Phase Self-Correction (No Trigger) | 1. Agent encounters an error during thinking<br>2. Agent self-corrects before producing final output<br>3. Final output is already correct | No Aristotle suggestion triggered | Passive trigger monitors visible conversation, not internal reasoning |
| P1-F | Main Session Corrects Subagent Error (Trigger) | 1. Subagent (via `task()`) returns result with error<br>2. Main session agent reviews and corrects it | Passive trigger suggestion appears | Matches Pattern 1 from main session's perspective |

#### Validation Checklist

- [ ] P1-A: Agent **self** discovers error → suggestion appears (Pattern 1)
- [ ] P1-B: Agent switches approach → suggestion appears (Pattern 3)
- [ ] P1-C: **User** points out error, agent agrees → suggestion appears (Pattern 2)
- [ ] P1-D: Normal conversation → no suggestion
- [ ] P1-E: Thinking-phase correction (no visible error) → no suggestion
- [ ] P1-F: Main session corrects subagent error → suggestion appears
- [ ] Agent never auto-invokes `/aristotle`
- [ ] Suggestion text matches SKILL.md definition

### 6.2 Bridge Plugin Scenarios (M1–M5)

> **Execution strategy**: The 5 original scenarios are consolidated into 2 rounds. B1 makes R→C chain fully automated — no LLM polling needed.

#### Round A: Bridge Lifecycle (tmux-automatable)

One opencode session covers plugin load, async reflect, and undo cleanup. **13 verification points.**

| Step | Action | Verification | Covers |
|------|--------|-------------|--------|
| A1 | Start opencode (with Bridge plugin) | No "promptAsync not available" in logs | M4-2 |
| A2 | Check `~/.config/opencode/aristotle-sessions/.bridge-active` | File exists with valid JSON (pid + startedAt) | M4-3 |
| A3 | Send `/aristotle` | LLM immediately returns (session NOT blocked) | M2-1,2 |
| A4 | Check `.bridge-active` still exists | Marker present | M2-3 |
| A5 | Check `bridge-workflows.json` | File exists with workflowId | M2-4 |
| A6 | Wait for R idle event | Status: running → chain_pending (B1: plugin detects R idle → calls subprocess) | M2-5 |
| A7 | Verify R→C auto-chain | Plugin drives R→C via subprocess: chain_pending → running(C) → completed. Checker result present. **Automated**: `bash test/e2e_a7_r2c_chain.sh --project /path` | M2-6,7 |
| A8 | Send `/aristotle` again to start a new workflow | New workflow appears, status = running | M3-1 |
| A9 | Send `/undo` | SKILL.md "After any /undo" rule triggers | M3-2,3 |
| A10 | Check `aristotle_check` output | Returns running workflows (or chain_pending/chain_broken) | M3-4 |
| A11 | Verify cancellation | Each running/chain_pending workflow cancelled via `aristotle_abort`; MCP `on_undo` called | M3-5,6 |
| A12 | Verify user-visible message | "Cancelled N active Aristotle workflow(s)" | M3-7 |
| A13 | Exit opencode | `.bridge-active` marker cleaned up | M4-4 |

**Automation notes**: A1–A13 can be driven via tmux + file-system assertions. B1 eliminates LLM polling dependency for R→C chain — A6/A7 depend only on subprocess timing (~200ms). A3, A9 still depend on LLM response timing.

#### Round B: Reflect-Check Chain (semi-automated)

One `/aristotle` invocation covers snapshot extraction, reflect-check loop, sessions, and review. **9 verification points.**

| Step | Action | Verification | Covers |
|------|--------|-------------|--------|
| B1 | Intentionally produce an error in conversation, then correct it | Error-correction pattern visible in session | M1-1,2,3 |
| B2 | Send `/aristotle` | Reflector sub-agent launched | M1-4, M5-1 |
| B3 | Check `~/.config/opencode/aristotle-sessions/ses_*_snapshot.json` | File created; snapshot.source is "t_session_search" or "bridge-plugin-sdk" | M1-5,6,7 |
| B4 | Wait for Reflector → Checker chain (B1: plugin-driven) | Plugin detects R idle → subprocess `_cli.py subagent_done` → launches C. Status: running(R) → chain_pending → running(C) → completed | M5-2,3,4 |
| B5 | If Checker requests deeper analysis | Plugin detects C idle → subprocess → launches new R (re-reflect) | M5-3 |
| B6 | Check each round's status via `aristotle_check` | Status transitions include chain_pending/chain_broken as intermediate states | M5-5 |
| B7 | Verify final completion notification | User sees completion message | M5-6 |
| B8 | Send `/aristotle sessions` | New record appears with correct status | M1-8 |
| B9 | Send `/aristotle review 1` | DRAFT rule content displayed | M1-9 |

**Automation notes**: B3, B4, B6, B8, B9 are file/API assertions. B1, B2, B5 depend on LLM. R→C chain (B4) is now plugin-driven — no LLM polling needed. Use `opencode run "message" --format json` for scriptable interaction.

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
# Quick smoke test (Python + static)
bash test.sh && uv run pytest test/ -q

# Bridge Plugin
cd plugins/aristotle-bridge && bunx vitest run

# B1 Regression
bash test/regression_b1_checks.sh
```

Expected result: `306 passed` + `104 passed` + `118 passed` + `39 passed` = **567 checks, 0 failures**.

## 9. Gate #1 Verification (Completed)

**Question**: Does `session.prompt({noReply: true})` inject a system-reminder into the parent session?

**Result**: **No.** `noReply: true` causes a hang bug (OpenCode issues #4431, #14451) — it does not inject messages into the parent session. This was verified via `test/gate1-noReply-verify.sh`.

**Decision**: Bridge Plugin adopted polling mode instead of noReply injection. SKILL.md uses idle detection + `aristotle_check`/`aristotle_abort` tools to manage async reflection without blocking the main session.
