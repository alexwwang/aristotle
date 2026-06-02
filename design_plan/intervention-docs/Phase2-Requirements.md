# Requirements Document: Watchdog Phase 2 — Active Monitoring + Pre-execution Verification

**Version**: 1.6-draft
**Status**: Review Passed (R1-R3 early stop, R4-R7 post-amendment fix verification, early stop at R7)
**Last Updated**: 2026-05-13
**Companion Documents**: PRD-opencode-agent-platform.md, TechSpec-opencode-agent-platform.md, Phase1-Watchdog-StateMachine.md, mcp-verify-why-articulation-design.md
**Dependencies**: Phase 1 (Watchdog State Machine + Checkpoint Tool) — must be implemented and tested before Phase 2 work begins
**TDD Pipeline Phase**: Phase 1 (Product Design) — gate passed

---

## Context

Phase 1 built the Watchdog state machine and `tdd_checkpoint` tool. LLMs call checkpoint to report their progress, and the state machine validates transitions. Phase 2 makes the Watchdog an **active monitor** — it observes LLM behavior, intercepts violations, and validates pre-execution understanding.

### Inherited from Phase 1

- `tdd_checkpoint` tool with 8 event types (pipeline_start through phase_complete)
- `PipelineState` state machine with transitions, validation, and audit logging
- `PipelineStore` for state persistence
- Plugin entry point (`packages/watchdog/`)
- Design spec: `Phase1-Watchdog-StateMachine.md`

### Source Documents

- TechSpec §3.2: Intercept rules (NO_BUSINESS_CODE_BEFORE_FAILING_TESTS, NO_PHASE_ADVANCE_WITHOUT_GATE)
- TechSpec §3.2.2: File pattern classification
- TechSpec OTQ-01: Interception must `throw`, not modify output
- `plan-docs/active/mcp-verify-why-articulation-design.md`: Why articulation as checkpoint event

### Phase 1 Schema Extensions

Phase 2 extends Phase 1 schemas. These changes are additive (no field removals, no type narrowing):

1. **`CheckpointEvent`** gains `'why_articulation'` as a 9th event type
2. **`PhaseRecord`** gains:
   - `articulationVerified: boolean` (default `false`)
   - `articulationDimensions?: { what_it_protects: boolean; key_risks: boolean; why_approach_works: boolean }`
   - `articulationAttempted: boolean` (default `false` — set when `why_articulation` state preconditions pass, regardless of content validation outcome; precondition BLOCK leaves this `false`)
   - `articulationDegraded: boolean` (default `false` — set when 3 consecutive content validation failures occur; signals Ralph reviewer that auto-verification gave up)
3. **`validateTransition`** and **`applyTransition`** gain a new case for `'why_articulation'`
4. **New `ObservationEntry` type** (distinct from `AuditLogEntry`) for hook-generated observations:
   ```typescript
   interface ObservationEntry {
     timestamp: string
     type: string  // e.g., '_reviewer_spawned'
     tool: string  // e.g., 'Task'
     callID: string
     round?: number  // ralph.round at observation time, if applicable
     metadata?: Record<string, unknown>
   }
   ```
5. **Schema version**: remains `1` (additive-only extension)
6. **`AuditLogEntry.tally`**: Phase 1 comment `"Phase 2 will add: tally?"` deferred — ralph_round_complete tally data is available via `PipelineState.ralph.tallyHistory`, making audit log redundancy unnecessary.

## User Stories

| # | Priority | User Story |
|---|----------|-----------|
| US-1 | Core | As a pipeline operator, I want the Watchdog to observe when the LLM spawns a reviewer subagent (Task tool), so that Ralph loop rounds without a real reviewer are detected at checkpoint time. |
| US-2 | Core | As a pipeline operator, I want the Watchdog to block file writes to business code when test evidence has not been confirmed (Phase 4/5), so that the TDD invariant "no business code without failing tests" is enforced mechanically. |
| US-3 | Core | As a pipeline operator, I want the Watchdog to block file writes that belong to Phase N+1 deliverables when Phase N has not passed its Ralph gate, so that phase skipping is prevented even if the LLM doesn't call checkpoint. |
| US-4 | Core | As a pipeline operator, I want the Watchdog to validate that the LLM's "why articulation" covers three dimensions (what it protects, key risks, why the approach works) before allowing phase execution, so that shallow understanding is caught early. |
| US-5 | Secondary | As a pipeline operator, I want the Watchdog to record articulation verification status in pipeline state, so that Ralph reviewers can reference it and audit logs show the full verification history. |
| US-6 | Secondary | As a pipeline operator, I want the Watchdog to observe tool call patterns even when no pipeline is active, so that potential pipeline-relevant behavior (e.g., Task calls resembling review loops) is recorded for future auto-detection of pipeline opportunities. |

## Acceptance Criteria

| # | US | Priority | Acceptance Criterion | Edge Cases |
|---|----|----------|---------------------|------------|
| AC-1 | US-1 | Core | Given an active pipeline in `ralph_loop` phaseStatus, When the LLM calls the Task tool, Then the Watchdog records an `ObservationEntry` with `type: '_reviewer_spawned'` and `round` set to `state.ralph.round + 1` (the semantic round in progress, since `state.ralph.round` tracks the last *completed* round). | LLM calls Task for non-review purposes (e.g., code exploration); multiple Task calls within one round; no active pipeline run (observation goes to session buffer per AC-10, not to ObservationEntry). |
| AC-2 | US-1 | Core | Given a `ralph_round_complete` checkpoint event, When no `ObservationEntry` with `type: '_reviewer_spawned'` and `round === payload.round` exists, Then the Watchdog returns a CheckpointViolation with message "Round N completed without a reviewer subagent". | Reviewer spawned in wrong round (round mismatch → validation fails); multiple spawns in same round (at least one match → passes). |
| AC-3 | US-2 | Core | Given an active pipeline in Phase 4 or 5 with `testEvidenceConfirmed === false`, When the LLM calls the `edit` or `write` tool targeting a business code file (non-test file), Then the Watchdog throws an error with message identifying the violation and instructing to confirm test evidence first. | File path doesn't match known patterns (unknown classification → don't block); file is a test file; test evidence already confirmed; file doesn't exist yet but path matches business code pattern (still blocked — classification is path-based). |
| AC-4 | US-3 | Core | Given an active pipeline where Phase N has `ralphCompleted === false` or `userApproved === false`, When the LLM calls the `edit` or `write` tool targeting a Phase N+1 deliverable file, Then the Watchdog throws an error with message identifying the incomplete phase and blocking the write. Intercept rules are evaluated in order: AC-3 (test evidence) is checked before AC-4 (phase gate). First matching rule throws; subsequent rules are not evaluated. | Phase N gate passed (don't block); file matches patterns for multiple phases; no active pipeline run (don't block per AC-8). |
| AC-5 | US-4 | Core | Given an active pipeline in `active` phaseStatus after `phase_enter(N)`, When the LLM calls `tdd_checkpoint('why_articulation', {phase: N, articulation: text})`, Then the Watchdog performs two-phase validation: (1) state precondition check (correct phase, active status, phase entered) → sets `articulationAttempted: true`, (2) content validation (dimension coverage) → sets `articulationVerified` and `articulationDimensions` based on result. Returns `ok: true` if all dimensions pass, or `ok: false` with specific guidance if any dimension is missing. Audit entry records `decision: 'PASS'` whenever state preconditions pass (state is always mutated). Content validation outcome is captured in `PhaseRecord.articulationVerified` and `articulationDimensions`, not in audit decision. This preserves Phase 1's invariant that PASS = state was written. **Degradation**: The content validation failure counter is tracked **in-memory only** (not persisted to PhaseRecord — no schema field needed). After 3 consecutive failed content validations (all returning `ok: false`) for the same phase, the Watchdog sets `articulationDegraded: true` on the PhaseRecord and returns `ok: false` with a note that this has been escalated to Ralph review. Ralph reviewers see both `articulationDegraded` and `articulationAttempted` to understand the auto-verification gave up. **Counter reset**: The in-memory consecutive-failure counter for a phase resets to 0 on any successful content validation (`ok: true`) for that phase, or when a new phase is entered. Counter is lost on plugin restart (acceptable given degradation is advisory, not blocking). | Text covers 2 of 3 dimensions; text is too short to evaluate; re-call after addressing guidance; 3 failed attempts in a row (degradation); degradation followed by successful re-validation (counter resets, `articulationDegraded` remains `true` as historical marker). |
| AC-6 | US-4 | Core | Given `tdd_checkpoint` tool is unavailable, When the LLM proceeds to phase execution without calling `why_articulation`, Then the pipeline continues without error (checkpoint-enforced soft gate degrades to Ralph review fallback). | Tool becomes available mid-session — N/A, no retroactive enforcement. |
| AC-7 | US-5 | Secondary | Given a `why_articulation` checkpoint event that passes validation, When the state is persisted, Then `phases[N].articulationVerified` is set to `true` and `phases[N].articulationDimensions` records per-dimension results. `articulationDegraded` is a **historical marker** — once set to `true`, it is NOT cleared by subsequent successful validations. Ralph reviewers interpret `articulationDegraded=true + articulationVerified=true` as "once degraded, later resolved" and may scrutinize more carefully. | Re-verification of same phase (overwrites previous dimensions); validation fails on first call then passes on retry; degradation occurred but later validation succeeds (degraded flag persists). |
| AC-8 | US-2, US-3 | Core | Given no active pipeline run, When any tool call triggers `tool.execute.before`, Then the interception hooks silently return without throwing errors. (Observation hooks behave differently — see AC-10.) | Pipeline starts mid-session after tools have already been called. |
| AC-9 | US-4 | Core | Given `why_articulation` returns `ok: true`, When the LLM proceeds to execution, Then the phase may proceed. Given `why_articulation` returns `ok: false` or is never called, Then `phases[N].articulationVerified` remains `false` (its default) and `articulationAttempted` distinguishes "never called" (`false`) from "called but failed" (`true`). Ralph reviewers reference both fields. | LLM skips articulation entirely (`articulationAttempted: false`, `articulationVerified: false`); LLM calls and fails (`articulationAttempted: true`, `articulationVerified: false`). |
| AC-10 | US-6 | Secondary | Given no active pipeline run, When the `tool.execute.after` hook fires for any tool call, Then the Watchdog records the observation (tool name, callID, timestamp) to a session-level observation buffer. Session buffer entries are minimal `{tool, callID, timestamp}` tuples — they do NOT conform to the `ObservationEntry` schema (which includes `type`, `round`, and `metadata` fields). This distinction is intentional: buffer entries are raw telemetry for future analysis, while `ObservationEntry` records are structured pipeline-attached observations. This data is NOT written to PipelineState and does NOT trigger any state transitions. It exists purely as observational data for future Phase 3 auto-detection capabilities. Observation buffer is scoped per-session and pruned on session end. | Session ends before pipeline starts (buffer discarded); pipeline starts mid-session (buffer data may be retrospectively useful but is not automatically consumed — Phase 3 scope). |

## Constraints & Assumptions

### Constraints

- **C-1**: OpenCode `tool.execute.before` hook must `throw` to block execution (OTQ-01). It cannot modify the output. Phase 2 must update `RoleRegistration.onToolBefore` interface from `Promise<string | null>` to `Promise<void>` where blocking = throw, allowing = return. This is a core package change.
- **C-2**: `tool.execute.before/after` provides `{ tool, sessionID, callID }` and `output: { args }`. File path must be extracted from `args` (varies by tool).
- **C-3**: File interception applies to `edit` and `write` tools only. Bash tool is NOT intercepted (too complex, high false-positive risk). `patch` tool excluded (low usage frequency; args schema TBD per OQ-3; add in future if needed).
- **C-4**: File pattern classification follows TechSpec §3.2.2 priority-ordered rules. Unknown classification → don't block. Classification operates on the target file path, regardless of whether the file currently exists. **Covers both code files and document files** — Phase 1-3 deliverables are markdown files (e.g., `requirements*.md`, `technical*.md`, `test-plan*.md`) that are classified via the phase deliverable pattern rules in TechSpec §3.2.2, not just `/src/` path patterns.
- **C-5**: Interception hooks (`tool.execute.before`) must short-circuit when no active pipeline exists — no throw, no state read. Observation hooks (`tool.execute.after`) continue recording to session buffer regardless of pipeline state (see AC-10).
- **C-6**: File paths extracted from tool args are resolved to absolute paths using the session's worktree root before classification. Classification rules match against the normalized absolute path.
- **C-7**: Intercept rules are evaluated in declaration order (AC-3 before AC-4). First matching rule throws; subsequent rules are not evaluated.
- **C-8**: Hook handlers (`onToolBefore`, `onToolAfter`) must use an in-memory cache for PipelineState, refreshed synchronously when `tdd_checkpoint` writes new state. Hooks must NOT read PipelineState from disk on every tool call — the per-call disk I/O overhead is unacceptable for latency-sensitive hooks that fire on every tool invocation. Cache lifecycle: (1) populated when a pipeline run becomes active via `pipeline_start`, (2) updated on every checkpoint write within the same process, (3) cleared when pipeline completes or is archived, (4) **lazy-populated from disk on first hook access** when the cache is empty but an active run exists (e.g., after plugin restart / crash recovery — Phase 1 §7 finds an active run but no "becomes active" transition fires). This one-time disk read on first access is acceptable; subsequent accesses use the cached value. **If the lazy-populate disk read fails** (corrupt or missing state.json, dangling active.json reference), the cache remains empty and hooks treat the situation as if no active pipeline exists (fail-open, log warning). This is consistent with AC-8's no-pipeline silent-return pattern and the overall fail-open philosophy (TechSpec D5).

### Assumptions

- **A-1**: OpenCode's `Task` tool name is consistently `"Task"` across versions.
- **A-2**: Not all `Task` calls are Ralph reviews. Distinguishing reviewer spawns from other Task calls is a Phase 2 technical design problem (may use args inspection or accept all Task calls as potential reviews).
- **A-3**: The three articulation dimensions (what_it_protects, key_risks, why_approach_works) can be evaluated with sufficient accuracy by the validation logic. False positives/negatives are acceptable and will be caught by Ralph review.
- **A-4**: Hook handlers execute fast enough to not noticeably degrade tool call latency (< 5ms overhead per call).
- **A-5**: In-memory PipelineState cache consistency with disk is acceptable. The cache is updated synchronously when `tdd_checkpoint` writes state (same process). The only inconsistency window is an external process modifying state.json between checkpoint calls, which is not a supported scenario (single-writer invariant: only the plugin process writes state).

## Open Questions

| # | Question | Resolution |
|---|----------|-----------|
| OQ-1 | How to distinguish Ralph reviewer Task calls from other Task calls? Options: (a) accept all Task calls as potential reviews (cheap, some false positives), (b) inspect Task args/prompt for review-related keywords, (c) require LLM to pass a flag. | → Phase 2 technical design |
| OQ-2 | Should `ObservationEntry` records be stored in a separate observation store (alongside but distinct from audit log), or in a new PipelineStore method? Separate store keeps observation/query concerns clean; shared store simplifies implementation. | → Phase 2 technical design |
| OQ-3 | What is the exact file path extraction logic for `edit` and `write` tool args? Need to verify against OpenCode tool arg schemas. | → Phase 2 technical design (verify at implementation time) |

## Module Decomposition (Split Decision)

SPLIT = true (6 user stories ≥ 5 threshold, target = 3 modules)

| Module | Stories | Description | Dependencies |
|--------|---------|-------------|-------------|
| Module A: Event Observation | US-1, US-6 | `tool.execute.after` observer: Task call correlation (with pipeline) + passive observation buffer (without pipeline) | Reads PipelineState when available; writes ObservationEntry or session buffer |
| Module B: File Interception | US-2, US-3 | `tool.execute.before` intercept rules + file pattern classifier + path normalization | Reads PipelineState; throws on violation |
| Module C: Articulation Validation | US-4, US-5 | `why_articulation` checkpoint event + dimension validation + PhaseRecord extension | **Extends Phase 1's** `schema.ts`, `transitions.ts`, `checkpoint.ts` |

## Ralph Loop Review Log

### Round 1
- C: 0 | H: 3 | M: 6 | L: 3
- Issues:
  - [H-1] `_reviewer_spawned` observation doesn't fit Phase 1's `AuditLogEntry` schema — needs distinct `ObservationEntry` type
  - [H-2] `why_articulation` not in Phase 1's `CheckpointEvent` type — schema migration is implicit
  - [H-3] AC-9's "records `articulationVerified === false`" mechanism is ambiguous — should be passive state
  - [M-1] Multiple intercept rule firing order is undefined
  - [M-2] "Hard-gate-with-degradation" terminology is misleading
  - [M-3] File path normalization not addressed
  - [M-4] AC-3 doesn't distinguish file creation from file editing
  - [M-5] AC-1 round correlation mechanism underspecified
  - [M-6] `onToolBefore` interface incompatibility with throw-based interception
  - [L-1] Module C has implicit cross-module dependency on Phase 1 code
  - [L-2] AC-6 edge case "Tool becomes available mid-session" is unactionable
  - [L-3] Open questions are well-chosen
- Main Agent Critical Evaluation:

  | Item | Decision | Rationale | Action |
  |------|----------|-----------|--------|
  | H-1 | ADOPT | Clean separation of observation vs audit types | Added `ObservationEntry` type and schema extensions section |
  | H-2 | ADOPT | Explicit schema changes list needed | Added "Phase 1 Schema Extensions" section |
  | H-3 | ADOPT | Passive state is simpler; `articulationAttempted` distinguishes cases | Rewrote AC-9 |
  | M-1 | ADOPT | Deterministic rule ordering | Added C-7, updated AC-4 |
  | M-2 | ADOPT | Terminology must match actual behavior | Changed to "checkpoint-enforced soft gate" |
  | M-3 | ADOPT | Path normalization affects classifier correctness | Added C-6 |
  | M-4 | ADOPT | Classification is path-based, not file-existence-based | Updated AC-3 edge cases |
  | M-5 | ADOPT | Round correlation needs precise specification | Updated AC-1 and AC-2 |
  | M-6 | ADOPT | Interface change is a dependency | Added to C-1 |
  | L-1 | ADOPT | Document cross-module deps | Added Dependencies column to module table |
  | L-2 | ADOPT | Mark as N/A | Updated AC-6 edge case |
  | L-3 | — | Confirmed | No change |

- Fixes applied: All H/M/L issues addressed in document revision
- Contested issues forwarded to next round: (none)

### Round 2
- C: 0 | H: 0 | M: 1 | L: 3
- Issues:
  - [M-1] AC-1 off-by-one: `state.ralph.round` tracks last completed round, observation should record `round + 1`
  - [L-1] AC-5 `articulationAttempted` write on failed content doesn't fit validate→apply pattern; needs two-phase validation note
  - [L-2] C-3 excludes `patch` tool without rationale
  - [L-3] AC-8 references US-1 only but applies to all hook handlers
- Main Agent Critical Evaluation:

  | Item | Decision | Rationale | Action |
  |------|----------|-----------|--------|
  | M-1 | ADOPT | Off-by-one would cause false violations | Fixed AC-1: `round + 1` |
  | L-1 | ADOPT | Prevents implementation confusion | Added two-phase validation to AC-5 |
  | L-2 | ADOPT | Rationale needed for future readers | Added `patch` exclusion note to C-3 |
  | L-3 | ADOPT | Traceability gap | Updated AC-8 to reference US-1, US-2, US-3 |

- Fixes applied: All M/L issues addressed
- Contested issues forwarded to next round: (none)
- Cumulative tally after Round 2: C=0, H=0, M=0 (fixed), L=0 (fixed)

### Round 3
- C: 0 | H: 0 | M: 1 | L: 1
- Issues:
  - [M-1] AC-5 partial-success case (preconditions pass, content fails) audit decision undefined — needs explicit PASS invariant statement
  - [L-1] Phase 1 `AuditLogEntry.tally` comment promises Phase 2 addition but not listed in schema extensions
- Main Agent Critical Evaluation:

  | Item | Decision | Rationale | Action |
  |------|----------|-----------|--------|
  | M-1 | ADOPT | Audit semantics must be unambiguous | Added PASS invariant to AC-5 |
  | L-1 | ADOPT | Traceability cleanup between Phase 1/2 docs | Added deferral note to schema extensions |

- Fixes applied: Both issues addressed
- Contested issues forwarded to next round: (none)
- Consecutive-zero C/H count: 2 (Round 2 + Round 3 both 0C/0H)

### Round 4 (Post-amendment incremental review)
- C: 0 | H: 0 | M: 4 | L: 1 | I: 1
- Issues:
  - [M-1] C-8 cache initialization undefined after plugin restart with existing active pipeline
  - [M-2] AC-5 degradation counter storage mechanism unspecified
  - [M-3] AC-5 consecutive failure counter reset condition undefined
  - [M-4] AC-5 / AC-7 do not specify whether articulationDegraded is cleared on later success
  - [L-1] Frontmatter status line should reflect pending R4 review
  - [I-1] Divergence from Why Articulation Design doc non-goal (degradation concept)
- Main Agent Critical Evaluation:

  | Item | Decision | Rationale | Action |
  |------|----------|-----------|--------|
  | M-1 | ADOPT | C-8 must be robust across plugin restarts | Added lazy-populate clause to C-8 |
  | M-2 | ADOPT | Counter storage affects schema design | AC-5 explicitly states in-memory only |
  | M-3 | ADOPT | Consecutive needs explicit reset semantics | AC-5 defines reset on success or new phase_enter |
  | M-4 | ADOPT | Ralph reviewer interpretation depends on flag semantics | AC-7 states historical marker, never cleared |
  | L-1 | ADOPT | Administrative accuracy | Updated status line |
  | I-1 | — | Informational only | Updated companion design doc |

- Fixes applied: All M/L issues addressed
- Contested issues forwarded to next round: (none)
- Consecutive-zero C/H count: 0 (R4 had 4M, reset)

### Round 5 (R4 fix verification)
- C: 0 | H: 0 | M: 1 | L: 1
- Issues:
  - [M-1] C-8 lazy-populate missing disk-read-failure handling
  - [L-1] R4 review log entry absent from document
- Main Agent Critical Evaluation:

  | Item | Decision | Rationale | Action |
  |------|----------|-----------|--------|
  | M-1 | ADOPT | Crash-recovery disk read failure has opposite safety implications for fail-open vs fail-closed | Added fail-open clause to C-8 |
  | L-1 | ADOPT | Review log traceability | Added R4 entry to review log |

- Fixes applied: Both issues addressed
- Contested issues forwarded to next round: (none)
- Consecutive-zero C/H count: 0 (R5 had 1M)

### Round 6 (Full scan)
- C: 0 | H: 0 | M: 0 | L: 3
- Issues:
  - [L-1] `articulationAttempted` schema description ambiguous against two-phase validation
  - [L-2] AC-10 session buffer entry shape unspecified
  - [L-3] R4 review log entry lacks cumulative tally
- Main Agent Critical Evaluation:

  | Item | Decision | Rationale | Action |
  |------|----------|-----------|--------|
  | L-1 | ADOPT | Precondition BLOCK vs content fail distinction | Narrowed to "set when preconditions pass" |
  | L-2 | ADOPT | Buffer entries need explicit schema distinction | AC-10 states minimal tuples, not ObservationEntry |
  | L-3 | ADOPT | Administrative consistency | Added cumulative tally to R4 entry |

- Fixes applied: All L issues addressed
- Contested issues forwarded to next round: (none)
- Consecutive-zero C/H count: 1 (R6 = 0C/0H)

### Round 7 (Full scan, early stop)
- C: 0 | H: 0 | M: 0 | L: 2
- Issues:
  - [L-1] Missing R6 review log entry
  - [L-2] Frontmatter status line omits R6
- Main Agent Critical Evaluation:

  | Item | Decision | Rationale | Action |
  |------|----------|-----------|--------|
  | L-1 | ADOPT | Review log completeness | Added R6 entry |
  | L-2 | ADOPT | Frontmatter accuracy | Updated status line |

- Fixes applied: Both L issues addressed
- Contested issues forwarded to next round: (none)
- Consecutive-zero C/H count: 2 (R6 + R7 both 0C/0H) — **EARLY STOP**
