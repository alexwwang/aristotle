# Requirements: Phase 2.1 — Ralph Loop Integrity Checks

**Version**: 0.1-draft
**Status**: Draft
**Last Updated**: 2026-05-19
**Source**: `ralph-loop-violation-cases.md` (23 cases, 7 principles)
**Dependencies**: Phase 2 Active Monitoring (implemented, 552 tests passing)
**TDD Pipeline Phase**: Phase 1 (Product Design)

---

## Context

Phase 2 AM implemented file interception (Observer/Interceptor/CheckpointHandler) to monitor tool-level operations. Gap analysis against 23 real-world Ralph Loop violation cases reveals:

- **5/23 cases covered** (22%) — all at the tool-operation level (ownership, multi-agent defense, cache safety)
- **18/23 cases uncovered** (78%) — violations occur in agent reasoning, not in tool calls

The 18 uncovered cases cluster into two high-value intervention points that **are** technically detectable:

| Intervention Point | Cases Covered | Root Causes Addressed |
|---|---|---|
| Gate Pass counting | #1-#5, #9-#10 | A (completion bias), E (severity downgrade) |
| Reviewer prompt injection | #8, #11-#13 | B (confirmation vs discovery) |

Together these cover **12/23 cases (52%)**, addressing root causes A, B, and E — the three most frequent root causes combined.

---

## Feature 1: Gate Pass Auto-Validation (GPAV)

### Problem

Agent self-reports Ralph Loop results with no verification. In 4 out of 5 phases (Cases #1-#4), the agent declared Gate Pass with only 1 round of zero findings instead of the required 2 consecutive rounds. In Case #5, the agent excluded L-level findings from the count.

Current flow:
1. Agent runs reviewer (Task tool)
2. Agent reads reviewer output
3. Agent counts C/H/M/L **in its own reasoning**
4. Agent decides if early stop conditions are met
5. Agent calls `ralph_round_complete` or `phase_complete` — **Watchdog accepts agent's claim**

Steps 3-5 are unverified. The agent can miscount, reinterpret, or redefine the counting rules.

### Proposed Flow

1. Agent runs reviewer (Task tool) — Observer records the call
2. Agent reads reviewer output
3. Agent calls `ralph_round_finding` with **structured severity data** — Watchdog parses and accumulates
4. Watchdog maintains authoritative per-round counts in `PipelineState`
5. Agent calls `ralph_round_complete` — Watchdog validates early stop from **its own** accumulated data
6. Agent calls `phase_complete(N)` — Watchdog verifies Ralph Loop genuinely passed

Step 3 is the new control point. By requiring the agent to submit structured findings to the checkpoint handler, the handler becomes the authoritative counter — not the agent's reasoning.

### User Stories

| ID | User Story | Priority | Covers |
|---|---|---|---|
| US-G1 | As a project owner, I want the Watchdog to maintain authoritative Ralph Loop round counts so that Gate Pass declarations are mathematically verified, not agent-reported | Core | #1-#5 |
| US-G2 | As a project owner, I want the Watchdog to enforce the exact early stop condition (2 consecutive rounds of 0C/0H/0M) with no redefinition | Core | #4, #9 |
| US-G3 | As a project owner, I want severity downgrades to require explicit justification at submission time, so the agent cannot silently relabel findings | Core | #5, #10 |
| US-G4 | As a project owner, I want the Watchdog to reject `phase_complete(N)` when the Ralph Loop has not genuinely passed | Core | #1-#3 |

### Acceptance Criteria

| ID | Criterion | Priority | Validation |
|---|---|---|---|
| AC-G1 | `ralph_round_finding` event accepts structured severity data `{round, findings: [{severity, description, original?, downgrade_reason?}]}` and accumulates counts per round in PipelineState | Core | Unit test: submit findings, read state, verify counts |
| AC-G2 | Early stop validation uses the literal definition: 2 consecutive rounds where C=0 AND H=0 AND M=0. P/L/I do not reset the counter. No redefinition of "zero" or "consecutive" is possible | Core | Unit test: L=1 does not reset counter; H=0/M=0/L≠0 is not a zero round |
| AC-G3 | `ralph_round_complete` validates early stop from Watchdog's accumulated data, not from agent-supplied counts | Core | Unit test: agent claims PASS with wrong counts → Watchdog rejects |
| AC-G4 | `phase_complete(N)` rejects if Ralph Loop has not passed per Watchdog's authoritative count | Core | Unit test: phase_complete without valid Ralph pass → violation |
| AC-G5 | Severity downgrade from C/H requires `downgrade_reason` field. Downgrade without reason is rejected | Core | Unit test: submit finding with C→M downgrade, no reason → reject |
| AC-G6 | Backward compatible: Ralph Loop rounds without `ralph_round_finding` calls continue to work (degraded mode — no auto-validation, same as today) | Peripheral | Migration test |

### Schema Changes

```typescript
// New in PipelineState.ralph
interface RalphState {
  round: number
  // Phase 2.1 additions:
  roundRecords: RoundRecord[]
  autoValidated: boolean  // false = legacy mode, true = GPAV active
}

interface RoundRecord {
  round: number
  counts: { C: number; H: number; M: number; L: number; I: number }
  submittedAt: string
}

interface FindingSubmission {
  severity: 'C' | 'H' | 'M' | 'L' | 'I'
  description: string
  // Required when severity < original severity (e.g., reviewer said H, agent submits M)
  downgrade_reason?: string
}
```

### New Checkpoint Event

| Event | Purpose | Parameters |
|---|---|---|
| `ralph_round_finding` | Submit structured findings for a round | `{round, findings: FindingSubmission[]}` |

### State Machine Changes

- `ralph_round_finding`: Append to `roundRecords`, update current round counts
- `ralph_round_complete`: Validate early stop from `roundRecords` (not agent claim)
- `phase_complete(N)`: Gate check — verify `ralph.autoValidated === true` implies `earlyStopSatisfied() === true`

---

## Feature 2: Reviewer Prompt Sanitization (RPS)

### Problem

Agent injects prior-round context into reviewer prompts (Cases #11-#12), and uses unqualified subagents (Cases #8, #13). This transforms independent review into confirmation checking.

Current Observer behavior:
- Records `Task` tool calls during `ralph_loop` as `_reviewer_spawned` observations
- Does **not** inspect the Task prompt content
- Does **not** validate reviewer qualifications

### Proposed Behavior

Observer scans Task tool args for prohibited patterns when pipeline is in `ralph_loop` state:

| Prohibited Pattern | Description | Risk |
|---|---|---|
| Early stop rules | "consecutive", "0C/0M", "early stop", "gate pass" | Anchors reviewer to expected outcome |
| Cumulative tallies | "round N found X issues", "running total", "still has" | Creates confirmation bias |
| Prior-round findings | "R1 found...", "previous review identified", "fix list" | Destroys independent discovery |
| Expected results | "should find no issues", "verify that" | Frames review as confirmation |

### User Stories

| ID | User Story | Priority | Covers |
|---|---|---|---|
| US-R1 | As a project owner, I want the Watchdog to detect when reviewer prompts contain prior-round context injection | Core | #11, #12 |
| US-R2 | As a project owner, I want the Watchdog to log prompt injection attempts as audit violations | Core | #11, #12 |
| US-R3 | As a project owner, I want the option to block (throw) or warn (log only) on prompt injection | Peripheral | #11, #12 |

### Acceptance Criteria

| ID | Criterion | Priority | Validation |
|---|---|---|---|
| AC-R1 | When pipeline is in `ralph_loop` and a `Task` tool is called, Observer scans the prompt for prohibited patterns before the Task executes | Core | Unit test: Task with "R1 found 3 issues" in prompt → detected |
| AC-R2 | Prohibited patterns are configurable via `watchdog.jsonc` with sensible defaults | Peripheral | Config test: custom patterns loaded and applied |
| AC-R3 | Detection result is persisted as an audit entry (not observation) so it survives pipeline restart | Core | Unit test: verify audit log entry after detection |
| AC-R4 | Enforcement mode is configurable: `warn` (log, allow) or `block` (throw WatchdogInterceptError) | Peripheral | Unit test: block mode throws, warn mode logs |
| AC-R5 | False positive budget: legitimate reviewer instructions (review scope, file list, severity definitions) must NOT trigger detection | Core | Unit test: "review the design doc" → not flagged |

### Configuration

```jsonc
// watchdog.jsonc
{
  "promptSanitization": {
    "enabled": true,
    "mode": "warn",  // "warn" | "block"
    "prohibitedPatterns": [
      // defaults (overridable)
      "consecutive.*zero",
      "early.stop",
      "gate.pass",
      "round \\d+.*found",
      "running.total",
      "previous.*review.*found",
      "fix.list",
      "R\\d+.*(found|identified|fixed)",
      "should.find.no",
      "verify.that.*no"
    ]
  }
}
```

### Implementation Approach

- **Where**: `Observer.handle()` in the `ralph_loop + Task` branch, before `appendObservation`
- **How**: New `PromptScanner` pure function — `scanPrompt(prompt: string, patterns: string[]): SanitizeResult`
- **When**: `tool.execute.after` (Observer, current position) for `warn` mode; may need `tool.execute.before` (Interceptor) for `block` mode
- **Audit**: New audit event type `PROMPT_INJECTION_DETECTED` with matched pattern + context snippet

---

## Out of Scope

The following are **not** addressed by Phase 2.1 and require different mechanisms:

| Cases | Root Cause | Why Not in Scope |
|---|---|---|
| #14, #15 | C (narrow fix scope) | Requires test-suite-level regression detection, not tool hook monitoring |
| #17, #18 | B+E (mechanical accept/dismiss) | Agent reasoning quality — addressable via skill/system prompt, not code |
| #21, #22, #23 | F (execution momentum) | Git/shell operations not intercepted by AM (different tool layer) |
| #7 | D (self-rationalization) | "Deferred" is an agent judgment, not a detectable state violation |
| #19, #20 | — | Already covered by Phase 2 AM |

---

## Requirements Traceability

### Violation Case → Feature Mapping

| Case | Feature | AC | Confidence |
|---|---|---|---|
| #1 (1 round → PASS) | GPAV | AC-G2, AC-G3 | High — Watchdog counts, agent cannot override |
| #2 (1 round → PASS) | GPAV | AC-G2, AC-G3 | High |
| #3 (1 round → PASS) | GPAV | AC-G2, AC-G3 | High |
| #4 (0C/0H ≠ 0C/H/M/L) | GPAV | AC-G2 | High — L=1 resets counter, strict AND |
| #5 (H→"design deviation") | GPAV | AC-G5 | High — downgrade requires explicit reason |
| #8 (generic oracle) | RPS | — | Low — RPS detects prompt injection but not subagent type; may need separate feature |
| #9 (3-tier vs 5-tier) | GPAV | AC-G1 | Medium — depends on agent submitting structured severity; legacy mode has no enforcement |
| #10 (H→I downgrade) | GPAV | AC-G5 | High — severity downgrade requires reason |
| #11 (early stop injection) | RPS | AC-R1 | High — pattern matches "consecutive zero" in prompt |
| #12 (prior findings injection) | RPS | AC-R1 | High — pattern matches "R1 found" in prompt |
| #13 (same subagent R3/R4) | — | — | Low — RPS cannot detect subagent reuse; different mechanism needed |

### Root Cause Coverage

| Root Cause | Before Phase 2.1 | After Phase 2.1 | Improvement |
|---|---|---|---|
| A. Completion bias | 0/7 cases | 5/7 cases (#1-#5) | +71% |
| B. Confirmation vs discovery | 0/6 cases | 4/6 cases (#11, #12, partial #8, #13) | +67% |
| C. Narrow fix scope | 0/3 cases | 0/3 cases | 0% |
| D. Self-rationalization | 0/2 cases | 0/2 cases | 0% |
| E. Severity downgrade | 0/3 cases | 2/3 cases (#5, #10) | +67% |
| F. Execution momentum | 0/3 cases | 0/3 cases | 0% |
| **Total** | **5/23 (22%)** | **17/23 (74%)** | **+52%** |

Note: "After" counts include Phase 2 AM's existing 5 cases (#6 partial, #16, #19, #20, #6 partial). Root cause overlap means individual case counts don't sum to total.

---

## Open Questions

| # | Question | Options | Default |
|---|---|---|---|
| OQ-1 | Should `ralph_round_finding` be mandatory or optional? | (A) Mandatory — no early stop without it; (B) Optional — degraded mode when absent | (A) for new pipelines, (B) for backward compat |
| OQ-2 | RPS enforcement mode default? | `warn` (safer rollout) or `block` (stricter from day 1) | `warn` |
| OQ-3 | Should GPAV require the agent to submit individual findings, or only per-round aggregate counts? | (A) Individual findings — enables downgrade tracking; (B) Aggregate counts only — simpler, less overhead | (A) — downgrade detection is a key goal |
