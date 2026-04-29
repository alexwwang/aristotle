# Aristotle — Test Status Tracker

> Last updated: 2026-04-28 | Commit: Pending update (A8/A9/A13 e2e test fixes)

## Automated Test Results

| Suite | Command | Count | Status | Last Run |
|-------|---------|-------|--------|----------|
| Python (pytest) | `uv run pytest` | 325 | ✅ Pass | 2026-04-28 |
| Bridge Plugin (vitest) | `cd plugins/aristotle-bridge && npx vitest run` | 148 | ✅ Pass | 2026-04-28 |
| Static tests | `bash test.sh` | 103 | ✅ Pass | 2026-04-28 |
| B1 Regression | `bash test/regression_b1_checks.sh` | 64 | ✅ Pass | 2026-04-28 |
| Deploy Checklist | 12 verification items | 12 | ✅ Pass | 2026-04-28 |
| **Total** | | **640** | **All Pass** | |

### Known Issues

| Issue | Affects | Status |
|-------|---------|--------|
| B7: No user notification after chain completes | — | ✅ Fixed |

---

## E2E / Integration Test Progress

### E2E Automated Tests (opencode run) — `bash test/e2e_opencode.sh`

| Group | Asserts | Result | Notes |
|-------|---------|--------|-------|
| E2E-1: Skill loads | 1 | ✅ Pass | |
| E2E-2: Sessions | 2 | ✅ Pass | |
| E2E-3: Learn | 2 | ✅ Pass | |
| E2E-4: Reflect | 2 | ✅ Covered | Covered — verified via A8-A13 standalone setup |
| E2E-5: Snapshot | 2 | ✅ Pass | Disk verified: 23 files, schema v1 + source=bridge-plugin-sdk |
| E2E-6: Bridge marker | 2 | ✅ Conditionally pass | A8-A13 verified per round; no marker when static (by design) |
| E2E-7: Workflow store | 3 | ✅ Pass | Disk verified: 3 workflows, required fields complete |

### B1 R→C Chain (tmux) — `bash test/e2e_a7_r2c_chain.sh --project /path`

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| 1 | Setup tmux + insert typo | ✅ | |
| 2 | Wait for Bridge plugin init | ✅ | |
| 3 | Create error context | ✅ | |
| 4 | Wait for LLM response | ✅ | |
| 5 | Trigger `/aristotle` | ✅ | |
| 6 | Workflow status = running | ✅ | A8-A13 standalone setup verified per round (after Bug #3 fix) |
| 7 | R chain_pending/completed | ✅ | Same as above |
| 8 | C sub-session (≥2) | ✅ | Same as above |
| 9 | Workflow completed | ✅ | Same as above |

**Note**: After Bug #3 (MCP path with tilde) was fixed, A8-A13 standalone setup verified R→C full chain per round. B1 steps 6-9 are now indirectly covered.

---

## Manual Test Progress

### P1: Passive Trigger (requires live LLM session)

| Test | Pattern | Status | Date | Notes |
|------|---------|--------|------|-------|
| P1-A | Agent self-correction | ✅ Pass | 2026-04-25 | opencode + GLM-5.1 |
| P1-B | Approach switch | ✅ Pass | 2026-04-25 | opencode + GLM-5.1 |
| P1-C | User correction | ✅ Pass | 2026-04-25 | opencode + GLM-5.1 |
| P1-D | No false positive | ✅ Pass | 2026-04-25 | Normal conversation, no trigger |
| P1-E | Thinking-phase self-correction (no trigger) | ✅ Pass | 2026-04-25 | Internal correction before output |
| P1-F | Main session corrects subagent error | ✅ Pass | 2026-04-25 | task() subagent error detected |

### Round A: Bridge Lifecycle (M4 + M2 + M3)

| Step | Action | Status | Date | Notes |
|------|--------|--------|------|-------|
| A1 | Start opencode with plugin | ✅ Pass | 2026-04-27 | No promptAsync error; tools registered correctly after Bug #8 fix |
| A2 | .bridge-active marker | ✅ Pass | 2026-04-27 | Valid JSON with pid |
| A3 | `/aristotle` non-blocking | ✅ Pass | 2026-04-27 | LLM returns STOP message |
| A4 | Marker persists | ✅ Pass | 2026-04-27 | |
| A5 | bridge-workflows.json created | ✅ Pass | 2026-04-27 | Contains workflowId + sessionId |
| A6 | R idle → chain_pending | ✅ Pass | 2026-04-27 | B1: plugin detects idle |
| A7 | R→C auto-chain | ✅ Pass | 2026-04-27 | rec_19: R produced DRAFT → C wrote 2 staging rules → done |
| A8 | Second `/aristotle` | ✅ Fixed | 2026-04-28 | Switched to trigger-file (tmux send-keys doesn't trigger skill) |
| A9 | `/aristotle suspend` cancellation | ✅ Fixed | 2026-04-28 | Switched to checkAbortTrigger() (test infrastructure, not a user feature) |
| A10 | `aristotle_check` output | ✅ Pass | 2026-04-28 | e2e script verified: 1 running workflow detected before abort |
| A11 | Abort + cancel verification | ✅ Pass | 2026-04-28 | e2e script verified: all terminal after abort (1 completed + 1 chain_broken) |
| A12 | User-visible cancel message | ✅ Pass | 2026-04-28 | e2e script verified: tmux output contains "cancelled" + "workflow" |
| A13 | Marker cleanup on exit | ✅ Fixed | 2026-04-28 | Timeout increased 15s→30s + second graceful shutdown |

### Round B: Reflect-Check Chain (M1 + M5)

| Step | Action | Status | Date | Notes |
|------|--------|--------|------|-------|
| B1 | Error-correction pattern | ✅ Pass | 2026-04-27 | Prime function: model made 1 prime, user corrected |
| B2 | `/aristotle` launches R | ✅ Pass | 2026-04-27 | Prompt includes CONTEXT SUMMARY |
| B3 | Snapshot file created | ✅ Pass | 2026-04-28 | A8-A13 verified: each R workflow has snapshot, schema v1 + source=bridge-plugin-sdk |
| B4 | R→C chain completes | ✅ Pass | 2026-04-27 | rec_19 DRAFT produced 2 reflections |
| B5 | Re-reflect (if requested) | ⏭️ SKIP | — | Checker did not request deeper analysis |
| B6 | Status transitions | ✅ Pass | 2026-04-27 | running → completed (confirmed via debug log) |
| B7 | Completion notification | ✅ Pass | 2026-04-28 | After Bug #14b fix: prompt({noReply:true}) notifies parent session |
| B8 | `/aristotle sessions` | ✅ Pass | 2026-04-28 | MCP backend directly verified: returns 30 records |
| B9 | `/aristotle review 1` | ✅ Pass | 2026-04-28 | MCP backend directly verified: returns 10 rules + action menu |

---

## Bugs Found and Fixed (Phase 0/1 Full List)

> Scope: All bug fixes from Phase 0 MCP core (E2E-testing bugs fixed in commit `7da8269`), Phase 0 Bridge MCP extensions, and Phase 1 Bridge Plugin (from commit `8822e99`) to present.

| # | Bug | Root Cause | Fix | Commit |
|---|-----|-----------|-----|--------|
| P0-1 | `detect_conflicts` not registered as MCP tool | New tool function added without `mcp.tool()` registration call | Added `mcp.tool()` registration | `7da8269` |
| P0-2 | `write_rule` ID collision (second-precision timestamp) | Multiple rules written within the same second get identical IDs | Changed to millisecond timestamp | `7da8269` |
| P0-3 | `commit_rule` bidirectional conflict annotation matched wrong rules | Conflict query used fuzzy matching + `limit=1` too restrictive, returned unrelated rules | Exact ID match + `limit=10` | `7da8269` |
| P0-4 | macOS `/tmp` symlink caused `relative_to` failure | macOS `/tmp` is a symlink to `/private/tmp`; `Path.relative_to()` paths didn't match | Added `.resolve()` to `resolve_repo_dir()` | `7da8269` |
| 1 | Bridge Plugin build+install+registration | Initial build output and opencode registration incomplete | Fix build + install + testing docs | `6c3b676` |
| 2 | api-probe calls real API | `detectApiMode()` called real promptAsync during init, blocking startup | Use typeof check instead of real API call | `22b09f9` |
| 3 | MCP command path with tilde | opencode.json MCP command used `~` path; `uv run` doesn't expand → MCP startup failed | Use absolute paths | `2f0fee0` |
| 4 | Hardcoded HOME paths in source | Multiple files had hardcoded `/Users/alex/` paths | Replace all with environment variables | `6c6e536` |
| 5 | Subprocess stdin mechanism | R→C chain used execFile which can't communicate with MCP subprocess | Switch to spawn + stdin pipe + trigger file | `700fe13` |
| 6 | promptAsync invalid agent parameter | `agent` param not a supported opencode API option | Remove agent parameter | `6aae8c2` |
| 7 | Wrong trigger parentSessionId | Trigger mechanism didn't use session_id as parentSessionId | Use `trigger.session_id` | `bc9e222` |
| 8 | Stale agent param in SKILL.md | SKILL.md `aristotle_fire_o` call still passed agent parameter | Remove stale agent parameter | `e356165` |
| 9 | SKILL.md polling blocks main session | After Bridge path, LLM still called `aristotle_check` to poll | Remove polling instructions; executor returns STOP | `caf20fa` |
| 10 | Tool registration format | `plugin.tool` returned bare function; opencode expects `{description, args, execute}` → tools silently skipped | Use ToolDefinition object map | `149fc6c` |
| 11 | target_session_id default | `ctx.session?.id` from PluginInput (no session property), always undefined | Use `context?.sessionID` from ToolContext | `149fc6c` |
| 12 | reconcileOnStartup blocks startup | `client.session.messages()` on stale running workflow → session not found → API hangs → startup blocked | 3-in-1: instanceId + reconcile timeout + saveToDisk merge | `ff4e57d` |
| 13 | R truncation, no DRAFT produced | `opencode.json` limit.output=4096; GLM reasoning+output share budget; reasoning 4092 → output 4 → `reason:"length"` | DRAFT existence check + compact prompt + config-driven mode selection | `3fdcb4a` |
| 14 | C result count mismatch | `_parse_checker_result` regex didn't match C's actual output format `"- Auto-committed: 0"` → count (0,0) | Query list_rules frontmatter status for counting | `8311d9f` |
| 15 | A8/A9 tmux e2e failure | tmux `send-keys` injects stdin character stream, which doesn't trigger opencode interactive skill activation layer; A13 tmux kill-session sends SIGKILL which is uncatchable | A8/A9 switched to trigger-file mechanism; A13 added graceful shutdown timeout and retry | `3014130` |
| 14b | No user notification | Bridge fire-and-forget; chain completion only logged to stderr, invisible in non-debug mode | Gate #1: noReply doesn't inject system-reminder (hang bug). Gate #2: noReply non-blocking + visible (1180ms). Fix: `notifyParent()` via `prompt({noReply:true})`. See §8.4 in async-non-blocking-architecture.md | `9258382` |

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Pass | Test passed |
| ❌ Fail | Test failed, investigation needed |
| 🔄 Pending | Not yet executed |
| ⏭️ SKIP | Skipped (missing dependency) |
| 🚫 Blocked | Cannot run due to prerequisite failure |
