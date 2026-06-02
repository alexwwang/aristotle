# Test Plan
# OpenCode Agent Platform: Shared Core + Aristotle + TDD Watchdog

**Version**: 0.1.0-draft  
**Status**: Draft  
**Last Updated**: 2026-05-03  
**Companion Documents**: PRD-opencode-agent-platform.md, TechSpec-opencode-agent-platform.md

---

## Overview

This document defines the complete test plan for the OpenCode Agent Platform. It covers all five implementation phases defined in the Tech Spec, plus two PoC verification experiments that must precede Phase 2.

Tests are organized by phase. Each phase has a clear acceptance criterion: all tests in that phase must pass before the next phase begins.

### Test Suite Summary (Target)

| Suite | Tool | Phase | Count (target) |
|-------|------|-------|----------------|
| Static assertions | `bash test.sh` extension | Phase 0 | +12 |
| Core unit tests | vitest | Phase 0 | ~40 |
| State machine unit tests | vitest | Phase 1 | ~60 |
| Interceptor unit tests | vitest | Phase 2 | ~30 |
| PoC: abort behavior | vitest + real OpenCode | Pre-Phase 2 | 5 |
| PoC: idle inject timing | vitest + real OpenCode | Pre-Phase 2 | 4 |
| Escalation unit tests | vitest | Phase 3 | ~25 |
| Cross-role integration tests | pytest + vitest | Phase 4 | ~15 |
| Existing aristotle tests (unchanged) | pytest + vitest + bash | All phases | 711 |

**Non-negotiable invariant**: The existing 711 checks must continue to pass at the end of every phase. Any phase that breaks existing tests is not complete.

---

## Phase 0: Core Extraction

### Goal

Prove that extracting shared modules from `aristotle-bridge` into `packages/core` does not change any existing behavior. No new features. The only valid outcome is: all existing tests pass, all new core-layer tests pass.

### P0-1: Migration Verification (import path update)

The existing 162 vitest tests in `plugins/aristotle-bridge/` are the primary migration verification. After Phase 0, these tests are moved to their new package locations with import paths updated. Test logic must not change.

**Acceptance criterion**: All 162 tests pass from their new location with updated imports.

Files affected:
- `workflow-store.test.ts` → `packages/core/test/workflow-store.test.ts`
- `executor.test.ts` → `packages/core/test/executor.test.ts`
- `api-probe.test.ts` → `packages/core/test/api-probe.test.ts`
- `utils.test.ts` → `packages/core/test/utils.test.ts`
- `idle-handler.test.ts` → `packages/reflection/test/idle-handler.test.ts` (Aristotle-specific R→C logic)
- `snapshot-extractor.test.ts` → `packages/reflection/test/snapshot-extractor.test.ts` (Aristotle-specific file naming)
- `config.test.ts` → `packages/core/test/config.test.ts` (generic resolver) + `packages/reflection/test/config.test.ts` (Aristotle-specific detectMcpDir)
- `index.test.ts` → `packages/reflection/test/index.test.ts` (role entry point)

### P0-2: StateStore Atomic Write Tests (new)

These tests cover the new `packages/core/src/store/state-store.ts` module, which did not exist in the original aristotle-bridge.

#### P0-2-1: Basic Read/Write

| Test ID | Description | Setup | Expected |
|---------|-------------|-------|----------|
| SS-01 | Write and read back a JSON object | Write `{phase: 1}` to key `watchdog/test/state` | Read returns `{phase: 1}` |
| SS-02 | Read non-existent key returns null | Read key that was never written | Returns `null` |
| SS-03 | Write overwrites previous value | Write `{a: 1}`, then write `{a: 2}` to same key | Read returns `{a: 2}` |
| SS-04 | Write handles nested objects | Write deeply nested object | Read returns identical structure |
| SS-05 | Keys from different roles are isolated | Write `aristotle/x` and `watchdog/x` with different values | Each key returns its own value |

#### P0-2-2: Atomic Write Behavior

| Test ID | Description | Setup | Expected |
|---------|-------------|-------|----------|
| SS-06 | Atomic write uses tmp-then-rename | Intercept `fs.renameSync`; verify `.tmp` file is created before rename | `.tmp` file exists before rename; final file exists after |
| SS-07 | No `.tmp` file left after successful write | Write normally | No `.tmp` file in directory after write completes |
| SS-08 | Stale `.tmp` file from crashed write does not block next write | Create a `.tmp` file manually, then write normally | Write succeeds; stale `.tmp` overwritten |
| SS-09 | Read after stale `.tmp` + missing final file returns null | Create stale `.tmp`, no final file | Returns `null`, no crash |

#### P0-2-3: JSONL Append Log

| Test ID | Description | Setup | Expected |
|---------|-------------|-------|----------|
| SS-10 | AppendLog creates file on first write | Write to non-existent log key | File created with one line |
| SS-11 | AppendLog appends, not overwrites | Write 3 entries sequentially | File has 3 lines, each valid JSON |
| SS-12 | AppendLog entries are valid JSON | Write arbitrary object | Each line parses without error |
| SS-13 | AppendLog handles concurrent appends without corruption | Write 10 entries in rapid succession | All 10 lines present and valid |

#### P0-2-4: Error Handling

| Test ID | Description | Setup | Expected |
|---------|-------------|-------|----------|
| SS-14 | Read handles corrupted JSON file gracefully | Write invalid JSON to file manually | Returns `null`, no crash |
| SS-15 | Write to read-only directory logs error, does not crash | Mock `fs.writeFileSync` to throw EACCES | Error logged; exception not propagated to caller |

### P0-3: Multi-Role Plugin Registration Tests (new)

These tests cover `plugin/index.ts` composing multiple roles.

#### P0-3-1: Role Registration

| Test ID | Description | Expected |
|---------|-------------|----------|
| PR-01 | Registering one role exposes its tools | Plugin object contains role's tool definitions |
| PR-02 | Registering two roles merges their tools | Plugin object contains tools from both roles |
| PR-03 | Tool name collision: second role's tool does not overwrite first | Error thrown on duplicate tool name at registration time |
| PR-04 | Role with no tools registers without error | No crash; plugin works normally |

#### P0-3-2: `tool.execute.before` Dispatch

| Test ID | Description | Expected |
|---------|-------------|----------|
| PR-05 | Single role PASS: tool call proceeds | Role returns `null`; no abort |
| PR-06 | Single role BLOCK: tool call aborted | Role returns violation string; `output.abort` set to that string |
| PR-07 | First role BLOCK: second role not called | First role blocks; second role's `onToolBefore` never invoked |
| PR-08 | First role PASS, second role BLOCK: tool call aborted | First role passes; second role blocks; abort set |
| PR-09 | Both roles PASS: tool call proceeds | Both return `null`; no abort |
| PR-10 | Role `onToolBefore` throws: error caught, treated as PASS | Exception does not propagate; tool call proceeds; error logged |

#### P0-3-3: `onIdle` Dispatch

| Test ID | Description | Expected |
|---------|-------------|----------|
| PR-11 | Both roles' `onIdle` handlers are called on `session.idle` | Both handlers invoked with correct sessionId |
| PR-12 | First role's `onIdle` throws: second role's handler still called | Exception caught; second handler executes normally |
| PR-13 | `session.idle` with non-string sessionID: no handlers called | Both handlers skipped |

### P0-4: Static Assertions Extension (new)

Add to `test.sh`:

| Assert ID | What it checks | How | Phase |
|-----------|---------------|-----|-------|
| SA-01 | `packages/watchdog` does not import from `packages/aristotle` | `grep -r "from.*packages/aristotle"` in watchdog src returns empty | Phase 1+ |
| SA-02 | `packages/aristotle` does not import from `packages/watchdog` | `grep -r "from.*packages/watchdog"` in aristotle src returns empty | Phase 1+ |
| SA-03 | `packages/core` does not import from `packages/aristotle` or `packages/watchdog` | grep both patterns in core src returns empty | Phase 0 |
| SA-04 | `packages/core` is listed as dependency in both role `package.json` files | Check both `package.json` files contain `"@opencode-ai/core"` | Phase 0 |
| SA-05 | Monorepo workspace config lists all three packages | `package.json` at root lists all three workspaces | Phase 0 |

### P0 Acceptance Criterion

All of the following must be true before Phase 1 begins:

- All existing checks pass (~720: pytest ~390 + static 103 + vitest 162 + regression 64 + e2e 2)
- All P0-2 StateStore tests pass (~15 new)
- All P0-3 multi-role plugin tests pass (~13 new)
- All P0-4 static assertions pass (5 new)
- No `.tmp` files left in any test temp directory after test run

---

## Pre-Phase 2: PoC Verification Experiments

These two experiments must be completed before Phase 2 begins. They validate critical assumptions in the Tech Spec (OTQ-01 and OTQ-02). If either experiment fails, the relevant part of the Tech Spec must be revised before implementation continues.

### PoC-1: `tool.execute.before` Abort Behavior (OTQ-01)

**Question**: In the function-style plugin API used by aristotle-bridge, does setting `output.abort = "message"` synchronously prevent tool execution and surface the message to the LLM?

**Method**: Write a minimal OpenCode plugin that registers a `tool.execute.before` handler. The handler sets `output.abort` when it sees a specific tool call (e.g., a bash command containing the string `"WATCHDOG_TEST"`). Run a real OpenCode session, ask the LLM to execute that command, and observe the outcome.

**Test cases**:

| PoC ID | Scenario | Expected outcome | Pass/Fail criteria |
|--------|----------|-----------------|-------------------|
| P1-A | Handler sets `output.abort = "test message"` | Tool does not execute; LLM sees "test message" in context | No bash execution observed; message appears in LLM response |
| P1-B | Handler throws `new Error("blocked")` instead of setting abort | Tool does not execute; LLM sees error message | Same effect as P1-A, or documents different behavior |
| P1-C | Handler returns `null` (no abort) | Tool executes normally | Bash executes; no error message injected |
| P1-D | Abort fires for main agent tool call | Tool blocked | Same as P1-A |
| P1-E | Subagent (spawned via `task`) makes same tool call | Observe whether hook fires | Document whether hook fires for subagent — expected NO based on issue #5894 |

**Outcome documentation**: Record exact abort mechanism that works (`output.abort` vs `throw`), whether the message format needs any specific structure to be visible to the LLM, and confirmed subagent scope limitation.

**If P1-A and P1-B both fail** (tool executes despite abort): The Tech Spec interceptor design (Section 3.2) must be revised. The watchdog would fall back to checkpoint-only enforcement with no pre-execution blocking. Update OTQ-01 resolution in Tech Spec before proceeding.

### PoC-2: `session.idle` Inject Timing (OTQ-02)

**Question**: When `client.session.prompt()` is called inside a `session.idle` handler, does the injected message appear in the LLM's context before it begins its next response?

**Method**: Write a plugin that injects a specific string via `client.session.prompt()` on every `session.idle` event. Run a real OpenCode session and observe whether the injected string is visible to the LLM in its immediate next response.

**Test cases**:

| PoC ID | Scenario | Expected outcome | Pass/Fail criteria |
|--------|----------|-----------------|-------------------|
| P2-A | Inject a message on idle; LLM asked "what messages do you see?" | LLM references the injected message | Injected string appears in LLM's next response |
| P2-B | Inject is slow (add 500ms artificial delay); same test | Observe if delay causes message to miss the next response | Document whether timing sensitivity exists |
| P2-C | Inject two messages from two different roles on same idle event | Both messages visible to LLM | Both strings appear in LLM response |
| P2-D | Inject fails (mock `session.prompt` to throw); LLM continues | LLM responds normally; error logged | No crash; error logged; LLM unaffected |

**Outcome documentation**: Record whether inject is synchronous or asynchronous from the LLM's perspective, whether there is a race condition risk, and the correct implementation pattern for escalation injection.

**If P2-A fails** (injected message does not appear in next LLM response): The escalation design must be revised. Document the actual timing behavior and update OTQ-02 resolution in Tech Spec.

---

## Phase 1: State Machine + Checkpoint Tool

### Goal

The Watchdog's state machine correctly validates all tdd-pipeline state transitions. The `tdd_checkpoint` MCP tool correctly accepts valid transitions and rejects invalid ones. State is persisted after every valid transition.

### P1-1: State Machine Transition Tests

These are pure unit tests with no I/O. The state machine validator is tested in isolation.

#### P1-1-1: Valid Transition Sequences (happy path)

| Test ID | Transition sequence | Expected final state |
|---------|-------------------|---------------------|
| SM-01 | `phase_enter(1)` | phase=1, status=active |
| SM-02 | `phase_enter(1)` → `ralph_loop_start(1)` | phase=1, status=ralph_loop, round=0 |
| SM-03 | `ralph_round_complete(1, round=1, C=0,H=1,M=0,L=0,I=0)` | round=1, consecutiveZero=0 |
| SM-04 | `ralph_round_complete` × 5, last tally all zero | round=5, consecutiveZero=1 |
| SM-05 | `ralph_terminate(1, "gate_pass")` after 5 rounds, last tally C=0,H=0,M=0 | status=awaiting_approval, termination=gate_pass |
| SM-06 | `ralph_round_complete` × 2 with all-zero tallies | consecutiveZero=2 |
| SM-07 | `ralph_terminate(1, "early_stop")` after 2 consecutive zero rounds | termination=early_stop |
| SM-08 | `user_approve(1)` after gate_pass | phases[1].userApproved=true |
| SM-09 | `phase_enter(2)` after phase 1 approved | phase=2, status=active |
| SM-10 | Complete phases 1–4; `test_evidence(4)` sets testEvidenceConfirmed | testEvidenceConfirmed=true |
| SM-11 | `phase_enter(5)` after test evidence confirmed | phase=5, status=active |
| SM-12 | Complete phase 5 → `pipeline_complete` | terminal state |

#### P1-1-2: Gate Pass Rules

| Test ID | Scenario | Expected |
|---------|----------|----------|
| GP-01 | `ralph_terminate("gate_pass")` at round 4 | REJECTED: round < 5 |
| GP-02 | `ralph_terminate("gate_pass")` at round 5, last tally C=1 | REJECTED: C > 0 |
| GP-03 | `ralph_terminate("gate_pass")` at round 5, last tally H=1 | REJECTED: H > 0 |
| GP-04 | `ralph_terminate("gate_pass")` at round 5, last tally M=1 | REJECTED: M > 0 |
| GP-05 | `ralph_terminate("gate_pass")` at round 5, last tally L=2, C=H=M=0 | ACCEPTED: L acceptable |
| GP-06 | `ralph_terminate("gate_pass")` at round 7, C=H=M=0 | ACCEPTED |

#### P1-1-3: Early Stop Rules

| Test ID | Scenario | Expected |
|---------|----------|----------|
| ES-01 | `ralph_terminate("early_stop")` with consecutiveZero=1 | REJECTED: need 2 |
| ES-02 | `ralph_terminate("early_stop")` with consecutiveZero=2 | ACCEPTED |
| ES-03 | Round with L>0 resets consecutiveZero counter | consecutiveZero reset to 0 |
| ES-04 | Round with C=H=M=0, L=0, I>0 increments consecutiveZero | consecutiveZero incremented |
| ES-05 | Two consecutive zero rounds at round 2 (round 1 also zero) | Early stop valid at round 2 |
| ES-06 | Rounds 3 and 5 zero, round 4 non-zero | consecutiveZero=1 after round 5 (not 2) |

#### P1-1-4: Illegal Transitions

| Test ID | Illegal transition | Expected violation |
|---------|-------------------|--------------------|
| IT-01 | `ralph_round_complete(phase=1, round=3)` when current round is 1 | Round skip detected |
| IT-02 | `ralph_round_complete(phase=2)` when current phase is 1 | Phase mismatch |
| IT-03 | `ralph_terminate("gate_pass")` when no ralph loop started | No active ralph loop |
| IT-04 | `user_approve(1)` before ralph loop completed | Ralph not completed |
| IT-05 | `user_approve(1)` after escalation | Escalated phases cannot be approved |
| IT-06 | `phase_enter(2)` before phase 1 user approved | Phase 1 not approved |
| IT-07 | `phase_enter(5)` before testEvidenceConfirmed | Test evidence required |
| IT-08 | `phase_enter(1)` when pipeline already in phase 3 | Cannot re-enter earlier phase |
| IT-09 | Any transition after `pipeline_complete` | Terminal state |
| IT-10 | `ralph_round_complete` with negative tally values | Invalid tally |

#### P1-1-5: Contested Issue Handling

| Test ID | Scenario | Expected |
|---------|----------|----------|
| CI-01 | `ralph_round_complete` with contested_resolutions referencing unknown issue ID | Validation error |
| CI-02 | Contested issue with disputeRounds=2 not escalated | Validation warning (escalation check fires separately) |
| CI-03 | `ralph_terminate` when openContested is non-empty | REJECTED: contested issues must be resolved first |

#### P1-1-6: Max Rounds

| Test ID | Scenario | Expected |
|---------|----------|----------|
| MR-01 | `ralph_terminate("max_rounds")` at round 10, C>0 | ACCEPTED as escalation path |
| MR-02 | `ralph_terminate("max_rounds")` at round 9 | REJECTED: round < 10 |
| MR-03 | `ralph_terminate("max_rounds")` at round 10, C=H=M=0 | REJECTED: gate_pass or early_stop should be used instead |

### P1-2: Checkpoint MCP Tool Tests

These tests cover the `tdd_checkpoint` tool end-to-end: state read → validate → persist → return.

#### P1-2-1: Successful Checkpoints

| Test ID | Event | Payload | Expected response |
|---------|-------|---------|------------------|
| CP-01 | `phase_enter` | `{phase: 1}` | `{ok: true, state: {...}}` |
| CP-02 | `ralph_round_complete` | valid round 1 tally | `{ok: true}`, state updated |
| CP-03 | `ralph_terminate` | `{phase:1, termination:"gate_pass"}` at round 5 | `{ok: true}` |
| CP-04 | `test_evidence` | `{phase:4, evidence_file:"..."}` | `{ok: true}`, testEvidenceConfirmed=true |
| CP-05 | `user_approval` | `{phase: 1}` | `{ok: true}`, phases[1].userApproved=true |

#### P1-2-2: Failed Checkpoints

| Test ID | Event | Violation | Expected response |
|---------|-------|-----------|------------------|
| CP-06 | `ralph_terminate("gate_pass")` at round 3 | Round count | `{ok: false, violation: "...round..."}` |
| CP-07 | `phase_enter(2)` before phase 1 approved | Approval missing | `{ok: false, violation: "...approval..."}` |
| CP-08 | `ralph_round_complete` with round skip | Round skip | `{ok: false, violation: "...round skip..."}` |
| CP-09 | Malformed JSON payload | Parse error | `{ok: false, violation: "...payload..."}` |

#### P1-2-3: State Persistence

| Test ID | Scenario | Expected |
|---------|----------|----------|
| CP-10 | Valid checkpoint → read state.json → state reflects transition | Persisted state matches expected |
| CP-11 | Failed checkpoint → state.json unchanged | State not modified on violation |
| CP-12 | Checkpoint survives process restart (read state written by previous process) | State correctly loaded from disk |

#### P1-2-4: Audit Log

| Test ID | Scenario | Expected |
|---------|----------|----------|
| CP-13 | Valid checkpoint writes PASS entry to ralph-log.jsonl | Entry with `decision: "PASS"` appended |
| CP-14 | Failed checkpoint writes BLOCK entry to ralph-log.jsonl | Entry with `decision: "BLOCK"` and `violation` field appended |
| CP-15 | Multiple checkpoints produce multiple log entries in order | Lines in correct chronological order |

### P1 Acceptance Criterion

- All P1-1 state machine tests pass (~45 tests)
- All P1-2 checkpoint tool tests pass (~20 tests)
- All 711 existing tests continue to pass
- `tdd_checkpoint` MCP tool callable from a real OpenCode session (manual smoke test)

---

## Phase 2: Interceptor

### P2-1: File Pattern Classifier Tests

#### P2-1-1: Default Classification

| Test ID | File path | Expected classification |
|---------|-----------|------------------------|
| FC-01 | `src/user.ts` | business_code |
| FC-02 | `lib/parser.py` | business_code |
| FC-03 | `app/routes.js` | business_code |
| FC-04 | `tests/test_user.py` | test_file |
| FC-05 | `__tests__/user.test.ts` | test_file |
| FC-06 | `src/user.spec.ts` | test_file |
| FC-07 | `test_user.py` | test_file |
| FC-08 | `user.test.ts` | test_file |
| FC-09 | `docs/requirements.md` | phase_deliverable(1) |
| FC-10 | `docs/technical-design.md` | phase_deliverable(2) |
| FC-11 | `README.md` | unknown (no block) |
| FC-12 | `.opencode/config.json` | unknown (no block) |

#### P2-1-2: Custom Configuration Override

| Test ID | Config | File path | Expected |
|---------|--------|-----------|----------|
| FC-13 | `business_code: ["backend/**"]` | `backend/user.ts` | business_code |
| FC-14 | `business_code: ["backend/**"]` | `src/user.ts` | unknown (default not active) |
| FC-15 | `test_files: ["spec/**"]` | `spec/user_spec.rb` | test_file |
| FC-16 | Corrupted config file | any file | Falls back to defaults; no crash |
| FC-17 | Missing config file | any file | Falls back to defaults |

#### P2-1-3: Edge Cases

| Test ID | File path | Expected |
|---------|-----------|----------|
| FC-18 | `src/user.test.ts` (test file inside src/) | test_file (test pattern takes priority) |
| FC-19 | Path with no extension | unknown |
| FC-20 | Empty string path | unknown; no crash |

### P2-2: Intercept Rule Tests

#### P2-2-1: NO_BUSINESS_CODE_BEFORE_FAILING_TESTS Rule

| Test ID | State | Tool | File | Expected |
|---------|-------|------|------|----------|
| IR-01 | phase=4, testEvidenceConfirmed=false | write | `src/user.ts` | BLOCK with violation message |
| IR-02 | phase=4, testEvidenceConfirmed=true | write | `src/user.ts` | PASS |
| IR-03 | phase=5, testEvidenceConfirmed=false | write | `src/user.ts` | BLOCK |
| IR-04 | phase=5, testEvidenceConfirmed=true | write | `src/user.ts` | PASS |
| IR-05 | phase=4, testEvidenceConfirmed=false | write | `tests/test_user.py` | PASS (test file, not blocked) |
| IR-06 | phase=3, testEvidenceConfirmed=false | write | `src/user.ts` | PASS (wrong phase for this rule) |
| IR-07 | phase=4, testEvidenceConfirmed=false | read | `src/user.ts` | PASS (read, not write) |

#### P2-2-2: NO_PHASE_ADVANCE_WITHOUT_GATE Rule

| Test ID | State | Tool | File | Expected |
|---------|-------|------|------|----------|
| IR-08 | phase=1, ralph not completed | write | `docs/technical-design.md` | BLOCK |
| IR-09 | phase=1, ralph completed, not approved | write | `docs/technical-design.md` | BLOCK |
| IR-10 | phase=1, ralph completed, approved | write | `docs/technical-design.md` | PASS |
| IR-11 | phase=2, ralph not completed | write | `docs/test-plan.md` | BLOCK |
| IR-12 | No active pipeline state | write | `docs/technical-design.md` | PASS (watchdog not active) |

#### P2-2-3: Violation Message Quality

| Test ID | Scenario | Expected message content |
|---------|----------|--------------------------|
| IR-13 | Business code blocked in phase 4 | Contains phase number, mentions test evidence, gives actionable next step |
| IR-14 | Phase advance blocked | Contains current phase, explains gate condition, mentions ralph loop status |

#### P2-2-4: Performance

| Test ID | Scenario | Expected |
|---------|----------|----------|
| IR-15 | Intercept check with state file on disk | Completes in < 50ms (including disk read) |
| IR-16 | Intercept check when no state file exists | Completes in < 10ms (early return) |

### P2 Acceptance Criterion (pending PoC-1 results)

- PoC-1 completed and OTQ-01 resolved in Tech Spec
- All P2-1 file classifier tests pass (~20 tests)
- All P2-2 intercept rule tests pass (~16 tests)
- Manual test: attempting to write business code in phase 4 session without test evidence results in visible block message

---

## Phase 3: Escalation + Idle Monitoring

### P3-1: Escalation Condition Detection Tests

#### P3-1-1: Ralph Loop Stall

| Test ID | State | Expected |
|---------|-------|----------|
| EC-01 | ralph.round=10, last tally C=1, escalated=false | Escalation triggered |
| EC-02 | ralph.round=10, last tally C=0,H=0,M=0, escalated=false | No escalation (gate pass should have fired) |
| EC-03 | ralph.round=10, C=1, escalated=true | No escalation (already escalated) |
| EC-04 | ralph.round=9, C=1, escalated=false | No escalation (round < 10) |

#### P3-1-2: Contested Issue Limit

| Test ID | State | Expected |
|---------|-------|----------|
| EC-05 | openContested has issue with disputeRounds=2 | Escalation triggered |
| EC-06 | openContested has issue with disputeRounds=1 | No escalation |
| EC-07 | openContested empty | No escalation |

#### P3-1-3: Phase Timeout

| Test ID | State | Config | Expected |
|---------|-------|--------|----------|
| EC-08 | Phase active for 241 minutes, no checkpoint | threshold=240min | Escalation triggered |
| EC-09 | Phase active for 239 minutes, no checkpoint | threshold=240min | No escalation |
| EC-10 | Phase active for 300 minutes, recent checkpoint | threshold=240min | No escalation |
| EC-11 | No active pipeline | any | No escalation |

### P3-2: Escalation Message Format Tests

| Test ID | Escalation type | Expected message contents |
|---------|----------------|--------------------------|
| EF-01 | Ralph loop stall | Round count, unresolved issue severities, recommendation |
| EF-02 | Contested issue | Issue ID, dispute round count, evidence summary |
| EF-03 | Phase timeout | Phase name, time elapsed, last checkpoint time |

### P3-3: Escalation State Management

| Test ID | Scenario | Expected |
|---------|----------|----------|
| ES-01 | Escalation fires on idle event N | State marked `escalated=true` |
| ES-02 | Same condition on idle event N+1 | Escalation NOT fired again |
| ES-03 | Different escalation condition on idle event N+1 | New escalation fires |
| ES-04 | Escalation inject throws (client.session.prompt fails) | Error logged; no crash; state still marked escalated |

### P3-4: Idle Handler Integration Tests (pending PoC-2 results)

These tests depend on PoC-2 outcome for timing guarantees. Structure confirmed here; timing assertions adjusted based on PoC-2 findings.

| Test ID | Scenario | Expected |
|---------|----------|----------|
| IH-01 | session.idle fires; no active pipeline | No escalation check; Aristotle idle handler runs normally |
| IH-02 | session.idle fires; active pipeline, no escalation condition | No inject; Aristotle idle handler runs normally |
| IH-03 | session.idle fires; stall escalation condition | Escalation injected via session.prompt |
| IH-04 | session.idle fires; both Aristotle workflow and Watchdog escalation active | Both handlers run; Aristotle handles its workflow; Watchdog injects escalation |

### P3 Acceptance Criterion

- PoC-2 completed and OTQ-02 resolved in Tech Spec
- All P3-1 escalation detection tests pass (~12 tests)
- All P3-2 message format tests pass (~3 tests)
- All P3-3 state management tests pass (~4 tests)
- All P3-4 idle integration tests pass (~4 tests)
- All 711 existing tests continue to pass

---

## Phase 4: Aristotle Integration

### P4-1: Audit Log Reader Tests

| Test ID | Scenario | Expected |
|---------|----------|----------|
| AL-01 | Read valid ralph-log.jsonl with BLOCK entries | Returns list of AuditLogEntry objects |
| AL-02 | Read empty log file | Returns empty list |
| AL-03 | Read non-existent log file | Returns empty list; no crash |
| AL-04 | Read log with some malformed lines | Valid lines parsed; malformed lines skipped; warning logged |
| AL-05 | Filter by decision="BLOCK" | Only BLOCK entries returned |
| AL-06 | Filter by session ID | Only entries matching sessionId returned |

### P4-2: PROCESS_VIOLATION Category Tests

| Test ID | Scenario | Expected |
|---------|----------|----------|
| PV-01 | Reflection with no Watchdog audit log | PROCESS_VIOLATION category not mentioned |
| PV-02 | Reflection with BLOCK entries in audit log | PROCESS_VIOLATION category analyzed in REFLECTOR output |
| PV-03 | Reflection with ESCALATE entries in audit log | PROCESS_VIOLATION category analyzed with escalation context |
| PV-04 | Audit log from different session ID | Not included in reflection input |

### P4-3: Graceful Degradation Tests

| Test ID | Scenario | Expected |
|---------|----------|----------|
| GD-01 | Watchdog not installed; Aristotle runs reflection | No crash; reflection proceeds without Watchdog data |
| GD-02 | Audit log schema version mismatch (future format) | Unknown fields ignored; known fields parsed; warning logged |
| GD-03 | Watchdog state file exists but is empty | Treated as no active pipeline; no crash |

### P4 Acceptance Criterion

- All P4-1 audit log reader tests pass (~6 tests)
- All P4-2 PROCESS_VIOLATION category tests pass (~4 tests)
- All P4-3 graceful degradation tests pass (~3 tests)
- All 711 existing tests continue to pass
- Manual end-to-end: run a session where Watchdog blocks a violation; trigger `/aristotle`; verify REFLECTOR output includes PROCESS_VIOLATION analysis

---

## Appendix A: Test Naming Conventions

Following the existing aristotle pattern:

- vitest tests: `should_{expected_behavior}_when_{condition}`
- pytest tests: `test_{method_name}_{scenario}`
- Static assertions: `check_{what}_{expected}`

## Appendix B: Test Infrastructure Requirements

- All unit tests use isolated temp directories (no shared state between tests)
- Mocks for `client.session.prompt`, `client.session.create`, `client.session.abort` follow the patterns established in `idle-handler.test.ts`
- PoC experiments require a real OpenCode installation with a configured LLM provider
- PoC results must be documented in `docs/poc-results.md` before Phase 2 begins

## Appendix C: Mapping to Tech Spec Open Questions

| Tech Spec OTQ | Resolved by | Resolution path |
|--------------|-------------|-----------------|
| OTQ-01: abort mechanism | PoC-1 | P1-A/B/C/D/E results → update Tech Spec Section 3.2 |
| OTQ-02: idle inject timing | PoC-2 | P2-A/B/C/D results → update Tech Spec Section 3.4 |
| OTQ-03: file pattern permissiveness | P2-1 tests | Default config verified permissive; override tested |
| OTQ-04: monorepo build tooling | P0 setup | Bun workspace config verified in P0-4 static assertions |
