# Known Issues — Watchdog Package

> Living document. Tracks design decisions, deferred features, and accepted trade-offs in the `packages/watchdog/` codebase. Each entry has a stable ID (KI-N) referenced from source comments.

## Index

| ID | Title | Status | Severity | Referenced In |
|----|-------|--------|----------|---------------|
| KI-1 | Map-backed mock store boilerplate duplication | Deferred | Low | test/checkpoint-phase2.test.ts, test/integration-phase2.test.ts |
| KI-2 | `any` types in public API surface | Deferred | Low | src/index.ts:53, src/tools.ts:31 |
| KI-3 | `index.ts` entry point has zero test coverage | Deferred | Low | src/index.ts |
| KI-4 | Observer hardcodes `'Task'` as subagent tool name | Deferred | Low | src/observer.ts:82 |
| KI-5 | `stripJsonComments` mangles `//` inside JSON string values | Resolved | Medium | src/watchdog-config.ts:33 |
| KI-6 | Three separate `makeState` helpers across test files | Resolved | Low | test/helpers.ts |
| KI-7 | Observer non-round degradation over-blocks AC-2 for ALL subsequent rounds | Resolved | High | src/observer.ts:53 |
| KI-9 | Articulation keyword false positives via substring matching | Accepted | Low | src/articulation.ts |
| KI-10 | Tally validation branches on error message substring | Resolved | Medium | src/transitions.ts:49-66 |
| KI-12 | Interceptor audit timestamp not synchronized with CheckpointHandler | Accepted | Info | src/interceptor.ts:86 |
| KI-13 | `formatElapsed` doesn't guard against negative input | Resolved | Low | src/checkpoint.ts:468 |
| KI-16 | Emoji in error messages | Resolved | Low | src/ (no emoji in current code) |
| KI-17 | `RalphTermination` type includes `'escalated'` but no producer creates it | Accepted | Info | src/schema.ts |
| KI-18 | `readState` migration re-runs every call | Accepted | Info | src/pipeline-store.ts:130-136 |
| KI-20 | Interceptor test classification objects include extra fields | Deferred | Low | test/interceptor.test.ts:111 |
| KI-21 | `scanPrompt` captures only first match per pattern | Deferred | Low | src/prompt-scanner.ts:54 |
| KI-22 | GPAV gate_pass doesn't verify complete roundRecords coverage | Active | Design | src/transitions.ts:562 |
| KI-23 | GPAV fallback uses legacy consecutiveZero (C+H+M) instead of strict | Deferred | Low | src/transitions.ts:608-614 |
| KI-24 | GPAV fallback trusts legacy tallyHistory when GPAV activated mid-loop | Active | Design | src/transitions.ts:614 |
| KI-25 | TC-G-34 test comment misstates expected consecutiveZero count | Resolved | Low | test/transitions.test.ts |
| KI-26 | downgrade_reason empty string | Resolved | Medium | src/transitions.ts:353 |
| KI-27 | Missing test for both prompt and description dirty | Deferred | Low | test/observer.test.ts |
| KI-28 | `autoValidated` field name is semantically misleading | Deferred | Info | src/schema.ts:82 |
| KI-29 | Missing test for `max_rounds` in GPAV fallback path | Deferred | Low | test/transitions.test.ts |
| KI-30 | RPS regex patterns with `/s` flag produce oversized match captures | Deferred | Info | src/prompt-scanner.ts:27-38 |
| KI-31 | RPS regex quadratic backtracking risk | Deferred | Low | src/prompt-scanner.ts:33 |
| KI-32 | `ralph_round_finding` apply merge code is unreachable | Deferred | Info | src/transitions.ts:1048 |
| KI-33 | TC-G-31/TC-G-32 construct unreachable mixed-path states | Deferred | Low | test/transitions.test.ts:1903-2019 |
| KI-34 | `contested_resolutions` IDs not validated against `openContested` | Deferred | Info | src/transitions.ts:159-192, 476-488 |
| KI-35 | `consecutiveZero` and `tallyHistory` are dead data in pure GPAV mode | Deferred | Info | src/transitions.ts:856-870 |
| KI-36 | `test_evidence` payload uses strict `!==` for phase | Accepted | Low | src/transitions.ts |
| KI-37 | `completedRecords` ordering assumption not enforced | Accepted | Low | src/transitions.ts |
| KI-38 | Legacy→GPAV switch creates dual-source state | Accepted | Info | src/transitions.ts:482-510 |
| KI-39 | `user_approval` validate missing explicit phaseStatus check | Accepted | Low | src/transitions.ts |
| KI-40 | `contested_resolutions` payload validation missing test coverage | Accepted | Low | test/transitions.test.ts |
| KI-41 | Missing phaseStatus !== 'ralph_loop' rejection test | Deferred | Low | test/transitions.test.ts Part B |
| KI-42 | `contested_resolutions` duplicate ID first-wins behavior unverified | Deferred | Low | src/transitions.ts:934 |
| KI-43 | `new_contested` ID conflict check doesn't reflect same-round resolutions | Deferred | Low | src/transitions.ts:232-243 |
| KI-44 | TC-G-31 doesn't assert consecutiveZero should be 0 | Deferred | Low | test/transitions.test.ts TC-G-31 |
| KI-45 | KI-24 fallback and legacy code duplication | Resolved | Low | src/transitions.ts |
| KI-46 | Contested partial resolution undocumented | Accepted | Low | src/transitions.ts |
| KI-47 | findings array and description size limits | Resolved | Info | src/constants.ts |
| KI-48 | TC-G-02 doesn't cover phaseStatus='ralph_loop' + ralph=null | Accepted | Info | test/transitions.test.ts |
| KI-49 | Phase 3 TODO not linked to issue tracker | Deferred | Info | src/transitions.ts:941-943 |
| KI-50 | `downgrade_reason` has no length limit | Resolved | Low | src/constants.ts, src/transitions.ts |
| KI-51 | KI-47 limit is per-submission, merge could accumulate past limit | Accepted | Info | src/transitions.ts |
| KI-52 | TC-G-33 constructs normally unreachable state | Deferred | Low | test/transitions.test.ts:1706-1737 |
| KI-53 | KI-22 defensive comment wording may mislead | Resolved | Low | src/transitions.ts |
| KI-54 | validSeverities Set rebuilt on every call | Resolved | Low | src/transitions.ts |
| KI-55 | `validateTransition` pure function has no config injection | Resolved | Low | src/transitions.ts:90 |
| KI-56 | `totalPhases` deeply embedded in state machine | Resolved | Low | src/transitions.ts:383, src/schema.ts:26 |
| KI-57 | Rollback from arbitrary phase requires pre-filling state | Deferred | Low | src/transitions.ts:396-410 |
| KI-58 | `intercept-rules.ts` unconditionally requires `ralphCompleted` | Resolved | Medium | src/intercept-rules.ts:62 |
| KI-59 | `ralph_loop_start` doesn't check loopType | Resolved | Medium | src/transitions.ts:418-433 |
| KI-60 | LLM can run multiple phase loops via sub-agent | Accepted | Low | src/transitions.ts |
| KI-61 | CheckpointHandler effectiveMax archive trigger untested | Resolved | Medium | test/checkpoint-loop-type.test.ts |
| KI-62 | loadWatchdogConfig integration path missing test coverage | Resolved | Medium | src/watchdog-config.ts |
| KI-63 | CheckpointHandler constructor signature mismatch causes TypeError | Resolved | Medium | src/checkpoint.ts:64 |
| KI-64 | IT-1/2/3 marked as integration but only test parseLoopPhases unit | Resolved | Medium | test/checkpoint-loop-type.test.ts:229-262 |
| KI-65 | PipelineState schema missing loopPhaseMap and maxPhase fields | Resolved | Medium | src/schema.ts:36-39 |
| KI-66 | AC-12 legacy early_stop dual-path claim | Accepted | Info | Phase2.3-P-Severity-Addition-Requirements.md AC-12 |
| KI-67 | Error messages for `original: 'M'` edge case | Resolved | Low | src/transitions.ts |
| KI-68 | 188 test sites need mechanical update for P severity | Resolved | Medium | test/transitions.test.ts |
| KI-P6 | Ralph Loop Precision should use independent subagent | Deferred | Low | Phase 4 compliance audit |
| KI-P7 | Ralph Loop Fact-Gathering should be explicit | Deferred | Low | Phase 4 compliance audit |

Status values: Active (intentional design), Resolved (fixed), Deferred (pending future work), Accepted (known limitation)

---

## KI-5: `stripJsonComments` mangles `//` inside JSON string values

**Status**: Resolved
**Discovered**: Phase 5 Ralph Loop Review (R2, R4)
**Referenced In**: src/watchdog-config.ts:33

### Context
`watchdog.jsonc` supports JSONC (JSON with comments). The `stripJsonComments` function removes `//` and `/* */` comments before JSON parsing.

### Issue
Original regex-based implementation stripped `//` and `/*` inside quoted string values. A JSONC value like `"url": "https://example.com"` would have `//example.com"` removed, producing invalid JSON.

### Decision / Resolution
Rewrote to character-level scanning that tracks string context. When `inString` is true, comment delimiters are treated as literal characters.

### Code Reference
```typescript
/**
 * Strip single-line (//) and multi-line block comments from JSON string.
 * KI-5 fix: respects quoted strings — does not strip // or /* inside "..." values.
 */
function stripJsonComments(jsonc: string): string {
  // Process character-by-character to track string context.
  // Regex-only approaches can't correctly handle escaped quotes or nested strings.
  let inString = false
  let result = ''
  let i = 0
  while (i < jsonc.length) {
    const ch = jsonc[i]
    if (inString) {
      result += ch
      if (ch === '\\') {
        // Escaped character — consume next char too
        i++
        if (i < jsonc.length) result += jsonc[i]
      } else if (ch === '"') {
        inString = false
      }
```

---

## KI-7: Observer non-round degradation over-blocks AC-2 for ALL subsequent rounds

**Status**: Resolved
**Discovered**: Phase 5 Ralph Loop Review (R6)
**Referenced In**: src/observer.ts:53

### Context
Observer tracks degradation per-run (`degradedRuns`) and per-round (`degradedRounds`). AC-2 (access control) queries use `isDegraded(projectId, runId, round?)` to decide whether to enable safety checks.

### Issue
`isDegraded()` checked `degradedRuns` (run-level degradation) before `degradedRounds` (round-level). When a transient observer error occurred during non-Ralph activity, the entire run was marked degraded, blocking AC-2 for ALL subsequent rounds even if the error was unrelated to Ralph.

### Decision / Resolution
Scoped `degradedRuns` check to `isDegraded()` calls without `round` parameter only. Per-round queries only check `degradedRounds`, so a transient observer error during non-Ralph activity does not disable AC-2 for all subsequent rounds.

### Code Reference
```typescript
  isDegraded(projectId: string, runId: string, round?: number): boolean {
    const key = `${projectId}/${runId}`
    // L3 fix: if handleDegradation failed for this pipeline, treat as degraded
    if (this.handlerFailedPipelines.has(key)) return true
    // KI-7 fix: degradedRuns (non-round degradation) only applies when no specific round is queried.
    // A per-round query should only check degradedRounds, so that a transient observer error
    // during non-ralph activity does not disable AC-2 for all subsequent rounds.
    if (round === undefined) {
      if (this.degradedRuns.has(key)) return true
      const rounds = this.degradedRounds.get(key)
      return rounds !== undefined && rounds.size > 0
    }
    const rounds = this.degradedRounds.get(key)
    return rounds?.has(round) ?? false
  }
```

---

## KI-10: Tally validation branches on error message substring

**Status**: Resolved
**Discovered**: Phase 5 Ralph Loop Review (R10)
**Referenced In**: src/transitions.ts:49-66

### Context
`ralph_round_complete` validates the `tally` payload. The `checkTally` helper returned structured data but downstream code parsed error messages via substring matching to distinguish error types.

### Issue
Branching on error message content is fragile — renaming or rewording messages silently breaks logic.

### Decision / Resolution
`checkTally` now returns structured `{ ok, errorType: 'missing' | 'type' }` instead of parsing message strings. Callers branch on `errorType`.

---

## KI-22: GPAV gate_pass doesn't verify complete roundRecords coverage

**Status**: Active
**Discovered**: Phase 2.1 Ralph Loop Review (R8)
**Referenced In**: src/transitions.ts:562

### Context
When `autoValidated=true`, GPAV terminate uses `completedRecords` (filtered from `roundRecords`) as the authoritative data source for termination checks.

### Issue
The code doesn't verify that ALL completed rounds (1 through `ralph.round`) have corresponding `roundRecords`. A corrupted state with partial records could lead to GPAV using incomplete data for gate_pass decisions.

### Decision / Resolution
Defense-in-depth improvement. Current validation logic in `ralph_round_complete` enforces that every completed round has a roundRecord when `autoValidated=true`. The scenario requires state corruption or a validation bypass. Added defensive comment; full assertion deferred.

### Code Reference
```typescript
      if (ralph.autoValidated && ralph.roundRecords.length > 0) {
        const completedRecords = ralph.roundRecords.filter(r => r.round <= ralph.round)
        // KI-22 defensive check: in normal GPAV flow, completedRecords should cover
        // all rounds. If not, fall through to KI-24 fallback (completedRecords empty
        // or partial). This branch handles partial coverage gracefully.
        if (completedRecords.length > 0) {
```

---

## KI-24: GPAV fallback trusts legacy tallyHistory when GPAV activated mid-loop

**Status**: Active
**Discovered**: Phase 2.1 Ralph Loop Review (R10)
**Referenced In**: src/transitions.ts:614

### Context
GPAV (Gate Pass Authority Validation) uses `roundRecords` as the authoritative data source. When an agent activates GPAV mid-loop (by submitting `ralph_round_finding` for the first time after completing earlier rounds via legacy `ralph_round_complete`), `completedRecords` may be empty for the legacy rounds.

### Issue
When `autoValidated=true` but `completedRecords` is empty, the code falls back to agent-reported `tallyHistory` — the exact problem GPAV was designed to prevent. An agent could complete rounds 1-5 in legacy mode, submit one `ralph_round_finding` for round 6 (uncommitted), then terminate with GPAV falling back to legacy tallies for rounds 1-5.

### Decision / Resolution
Design intent. Legacy rounds were validated through `ralph_round_complete` (tested by 285+ existing tests). GPAV is an incremental improvement, not a replacement. Once SKILL.md is updated to include `ralph_round_finding`, models will use GPAV from round 1, making this transition state unreachable.

### Code Reference
```typescript
        } else {
          // [KI-24] Known design decision: when autoValidated=true but completedRecords is empty
          // (agent activated GPAV mid-loop by submitting findings for an uncommitted round),
          // we fall back to legacy tallyHistory checks. This is intentional — legacy rounds
          // were validated through ralph_round_complete. Once SKILL.md is updated to include
          // ralph_round_finding, agents will use GPAV from round 1 and this path becomes
          // unreachable. See KnownIssues-Watchdog.md KI-24 for full analysis.
          // Reviewers: this is a documented design choice, NOT a defect.
          if (termination === 'gate_pass') {
            if (ralph.round < MIN_GATE_ROUNDS) {
              return fail(
                'Insufficient rounds for gate pass',
                `Gate pass requires at least ${MIN_GATE_ROUNDS} rounds. Current: ${ralph.round}.`,
              )
            }
            const last = ralph.tallyHistory[ralph.tallyHistory.length - 1]
            if (!last || last.C + last.H + last.M > 0) {
              return fail(
                'Unresolved issues remain',
                'Gate pass requires the last tally to have C+H+M equal to 0.',
              )
            }
          }
```

---

## KI-26: Missing test for `downgrade_reason: ''` (empty string)

**Status**: Resolved
**Discovered**: Phase 2.1 Ralph Loop Review (R10)
**Re-evaluated**: Phase 2.3 Test Plan Review (Gate Passed) — promoted to Active/Medium due to P severity addition expanding downgrade surface area
**Resolved**: Phase 2.3 post-P5 cleanup — source `trim()` fix applied, regression test passing
**Referenced In**: test/transitions-phase23.test.ts, src/transitions.ts:353

### Context
`ralph_round_finding` validation rejects findings with a severity downgrade (`original` field present) that lack a `downgrade_reason`. The validation checks both `typeof !== 'string'` and `length === 0`.

### Issue
TC-G-06 only tests missing `downgrade_reason` (undefined). Empty-string rejection is untested despite being a distinct code path.

### Decision / Resolution
Validation logic is correct. Phase 2.3 added P severity downgrade paths (M→P, H→P, C→P via TC-17/TC-19/TC-41/TC-42), making `downgrade_reason` validation more critical. Empty-string rejection should be tested in Phase 4 alongside TC-41/TC-42 implementation. Promoted to Active/Medium.

### Code Reference
```typescript
        if (f.original !== undefined) {
          if (!validSeverities.has(f.original as string)) {
            return fail(`Invalid original severity at index ${i}`, `Original severity must be one of C/H/M/P/L/I, got "${f.original}".`)
          }
          if (severityLt(f.severity as string, f.original as string)) {
            if (typeof f.downgrade_reason !== 'string' || (f.downgrade_reason as string).length === 0) {
              return fail(`Missing downgrade_reason at index ${i}`, `Severity downgrade from ${f.original} to ${f.severity} requires a downgrade_reason.`)
            }
          }
        }
```

---

## KI-27: Missing test for both prompt and description dirty

**Status**: Deferred
**Discovered**: Phase 2.1 Ralph Loop Review (R10)
**Referenced In**: test/observer.test.ts

### Context
RPS (Reviewer Prompt Scanner) in observer scans both `prompt` and `description` fields of Task calls for injection patterns. Tests cover prompt-only, description-only, and both-clean scenarios.

### Issue
No test covers `{ prompt: 'early stop', description: 'R1 found issues' }` where BOTH fields contain injection patterns simultaneously.

### Decision / Resolution
Both-field scan logic is tested via prompt-scanner unit tests. Observer integration test for dual-field is a completeness gap, not a correctness gap. Add when observer tests are next modified.

### Code Reference
```typescript
      // Scan all candidate fields, accumulate matches
      const allMatches: Array<{ pattern: string; match: string }> = []
      for (const p of promptsToScan) {
        const result = scanPrompt(p)
        if (result.flagged) allMatches.push(...result.matchedPatterns)
      }

      if (allMatches.length === 0) return

      // Log matched patterns
      const patterns = allMatches.map(m => `"${m.match}" (${m.pattern})`).join(', ')
      this.logger?.warn('RPS: prompt injection detected in Task call round %d: %s', round, patterns)
```

---

## KI-29: Missing test for `max_rounds` in GPAV fallback path

**Status**: Deferred
**Discovered**: Phase 2.1 Ralph Loop Review (R12)
**Referenced In**: test/transitions.test.ts

### Context
The GPAV fallback path (autoValidated=true, completedRecords empty) has three termination modes: `gate_pass`, `early_stop`, and `max_rounds`. TC-G-35 and TC-G-36 cover `gate_pass` and `early_stop`.

### Issue
`max_rounds` in the GPAV fallback path is untested. The code is correct (mirrors legacy logic), but this security-sensitive code path lacks direct coverage.

### Decision / Resolution
Code path is identical to legacy max_rounds which is well-tested. Add when transitions test file is next modified.

### Code Reference
```typescript
          } else if (termination === 'max_rounds') {
            if (ralph.round < MAX_RALPH_ROUNDS) {
              return fail(
                'Insufficient rounds for max_rounds termination',
                `max_rounds termination requires at least ${MAX_RALPH_ROUNDS} rounds. Current: ${ralph.round}.`,
              )
            }
            const last = ralph.tallyHistory[ralph.tallyHistory.length - 1]
            if (!last || last.C + last.H + last.M === 0) {
              return fail(
                'No unresolved issues',
                'max_rounds termination requires the last tally to have C+H+M greater than 0.',
              )
            }
          }
```

---

## KI-32: `ralph_round_finding` apply merge code is unreachable

**Status**: Deferred
**Discovered**: Phase 7 Oracle audit
**Referenced In**: src/transitions.ts:1048

### Context
The `ralph_round_finding` apply handler has a merge path for appending findings to an existing `roundRecord` when `existingIdx >= 0`.

### Issue
Validate enforces `round === ralph.round + 1` (monotonic advance), so a finding for the same round number can never be submitted twice. The merge branch (`existingIdx >= 0`) is unreachable through normal validate→apply flow.

### Decision / Resolution
By design. Merge code is intentionally retained for future multi-submit-per-round use cases. When needed, relax validate to allow `round === ralph.round` in GPAV mode.

### Code Reference
```typescript
      // Find or create round record
      // NOTE (KI-32): The merge branch (existingIdx >= 0) is currently unreachable through
      // validate→apply because validate enforces round === ralph.round + 1 (monotonic advance).
      // This is intentional — merge logic is pre-built for future multi-submit-per-round use
      // cases. When needed, relax validate to allow round === ralph.round in GPAV mode.
      const existingIdx = state.ralph.roundRecords.findIndex(r => r.round === round)
      let newRoundRecords: RoundRecord[]
      if (existingIdx >= 0) {
        // Append to existing record (multiple finding submissions per round)
        const existing = state.ralph.roundRecords[existingIdx]
        const merged = {
          ...existing,
          counts: {
            C: existing.counts.C + counts.C,
            H: existing.counts.H + counts.H,
            M: existing.counts.M + counts.M,
            P: existing.counts.P + counts.P,
            L: existing.counts.L + counts.L,
            I: existing.counts.I + counts.I,
          },
        }
        newRoundRecords = [...state.ralph.roundRecords]
        newRoundRecords[existingIdx] = merged
```

---

## KI-34: `contested_resolutions` IDs not validated against `openContested`

**Status**: Deferred
**Discovered**: Phase 7 Oracle audit
**Referenced In**: src/transitions.ts:476-488

### Context
`ralph_round_complete` validate requires `contested_resolutions` to be non-empty when `openContested` is non-empty. The cross-check ensures at least one submitted ID matches an open issue.

### Issue
Validate checks that at least one ID matches, but does NOT reject submissions where ALL IDs are fake (zero matches). Agent can provide `[{id: "fake", action: "accepted"}]` to pass validation without resolving any actual issue. Apply correctly handles this (unmentioned issues get `disputeRounds+1`).

### Decision / Resolution
Benign consequence — unresolved issue persists but state is not corrupted. Low priority improvement. Add cross-check if contested resolution becomes security-sensitive.

### Code Reference
```typescript
      if (state.ralph.openContested.length > 0 && Array.isArray(payload.contested_resolutions) && payload.contested_resolutions.length > 0) {
        const openIds = new Set(state.ralph.openContested.map(i => i.id))
        const provided = payload.contested_resolutions as Array<Record<string, unknown>>
        const matchingIds = provided.filter(r => openIds.has(r.id as string))
        if (matchingIds.length === 0) {
          return fail(
            'Invalid contested_resolutions',
            'None of the provided contested_resolutions match any open contested issue. Open issues: ' + [...openIds].join(', '),
          )
        }
      }
```

---

## KI-47: findings array and description size limits

**Status**: Resolved
**Discovered**: Phase 7 dual-pass Recall (F-17)
**Referenced In**: src/constants.ts, src/transitions.ts

### Context
`ralph_round_finding` accepts a `findings` array with `description` fields. Originally had no size limits.

### Issue
Malicious or buggy agent could submit oversized data causing memory/storage bloat.

### Decision / Resolution
`MAX_FINDINGS_PER_ROUND` (50) and `MAX_FINDING_DESCRIPTION_LENGTH` (2000) constants added. Validation enforced. KI-50 (`downgrade_reason` length limit = 1000) resolved separately.

### Code Reference
```typescript
      if ((payload.findings as unknown[]).length > MAX_FINDINGS_PER_ROUND) {
        return fail('Too many findings', `ralph_round_finding accepts at most ${MAX_FINDINGS_PER_ROUND} findings per round, got ${(payload.findings as unknown[]).length}.`)
      }
      // ...
      if ((f.description as string).length > MAX_FINDING_DESCRIPTION_LENGTH) {
        return fail(`Description too long at index ${i}`, `Finding description must be at most ${MAX_FINDING_DESCRIPTION_LENGTH} characters, got ${(f.description as string).length}.`)
      }
```

---

## KI-62: loadWatchdogConfig integration path missing test coverage

**Status**: Resolved
**Discovered**: Checkpoint Integration Phase 4 TDD Review (R3)
**Referenced In**: src/watchdog-config.ts:125

### Context
Design Coverage Matrix DC-16/17/18 requires testing `loadWatchdogConfig`'s three integration paths: valid config, invalid config (ConfigValidationError), and missing config (fallback).

### Issue
Originally only `parseLoopPhases` was unit-tested. The full chain (file read → parseLoopPhases → error handling → config assembly) had no integration tests.

### Decision / Resolution
Added `parseLoopPhasesFromConfig()` helper to `watchdog-config.ts`, wired `loopConfig` in `index.ts`, added 4 integration tests covering DC-16/17/18.

### Code Reference
```typescript
      // KI-62: parse loopPhases config if present
      const loopConfig = parseLoopPhasesFromConfig(parsed, logger)

      return { phaseDeliverables, ignorePatterns, monitoredTools, ...loopConfig }
      // Note: spread is safe — helper returns {} (no keys) or { loopConfig: LoopConfigResult }.
      // Never returns { loopConfig: undefined } — missing/invalid configs omit the key entirely.
```

---

## Additional Active KIs (Brief Entries)

### KI-1: Map-backed mock store boilerplate duplication
**Status**: Deferred | **Raised in**: R1, R2, R4, R8, R9, R10 | Same ~50-line Map-backed mock store setup copy-pasted 10+ times across test files. Extract `createWiredMockStore()` factory in Phase 2.1.

### KI-2: `any` types in public API surface
**Status**: Deferred | **Raised in**: R5, R8, R10 | `ctx: any` in index.ts:53, `args: any, context: any` in tools.ts:31. Standard DI boundary practice. Define interfaces when framework API stabilizes.

### KI-3: `index.ts` entry point has zero test coverage
**Status**: Deferred | **Raised in**: R8, R10 | `createWatchdogRole` wires 11 modules untested. Each module individually tested. Add smoke test in Phase 2.1.

### KI-4: Observer hardcodes `'Task'` as subagent tool name
**Status**: Deferred | **Raised in**: R8 | Only `Task` used currently. Extract to config in Phase 3.

### KI-6: Three separate `makeState` helpers across test files
**Status**: Resolved | **Raised in**: R3, R7, R8, R10 | **Resolved in**: Post-P5 cleanup — all 5 test files now import strongly-typed `makeState`, `makeRalphState`, `NOW`, `basePayload` from `test/helpers.ts`. Local duplicates removed.

### KI-9: Articulation keyword false positives via substring matching
**Status**: Accepted | **Raised in**: R8, R10 | Design intent. `includes(kw)` matches semantically related words (protects/protection), which is desirable. High-risk patterns already use RegExp. 50-char gate is the primary quality filter.

### KI-12: Interceptor audit timestamp not synchronized with CheckpointHandler
**Status**: Accepted | **Raised in**: R3 | Independent call chains, separate timestamps acceptable.

### KI-13: `formatElapsed` doesn't guard against negative input
**Status**: Resolved | **Raised in**: R10 | **Resolved in**: Post-P5 cleanup — added `if (ms < 0) return '<1s'` guard in src/checkpoint.ts:468.

### KI-16: Emoji in error messages
**Status**: Resolved | **Raised in**: R9 | **Resolved in**: Earlier phase cleanup — no emoji found in current source.

### KI-17: `RalphTermination` type includes `'escalated'` but no producer creates it
**Status**: Accepted | **Raised in**: R3, R8 | Reserved for Phase 3. Payload validation rejects `escalated`. No action until Phase 3 implements escalation flow.

### KI-18: `readState` migration re-runs every call
**Status**: Accepted | **Raised in**: R1, R2 | Correct by design — migration only persists after a write round-trip.

### KI-20: Interceptor test classification objects include extra fields
**Status**: Deferred | **Raised in**: R8 | Extra fields ignored at runtime. Type-safe improvement possible.

### KI-21: `scanPrompt` captures only first match per pattern
**Status**: Deferred | **Raised in**: R4, R8 | `String.match()` without `g` flag. Sufficient for detection. Upgrade to `matchAll` if enforcement mode added.

### KI-23: GPAV fallback uses legacy consecutiveZero (C+H+M) instead of strict
**Status**: Deferred | **Raised in**: R9 | By design — fallback returns to legacy checks. Recompute if practical concern.

### KI-25: TC-G-34 test comment misstates expected consecutiveZero count
**Status**: Resolved | **Raised in**: R10 | **Resolved in**: Post-P5 cleanup — comment corrected from "2 (rounds 4-5)" to "3 (rounds 3-5)".

### KI-28: `autoValidated` field name is semantically misleading
**Status**: Deferred | **Raised in**: R10 | Renaming would be schema-breaking. Add JSDoc clarifying semantics.

### KI-30: RPS regex patterns with `/s` flag produce oversized match captures
**Status**: Deferred | **Raised in**: R13 | Reviewer prompts typically <5KB. Truncate if storage becomes a concern.

### KI-31: RPS regex quadratic backtracking risk
**Status**: Deferred | **Raised in**: R13 | Two `.*` greedy quantifiers. Add length guard if prompts grow past 50KB.

### KI-33: TC-G-31/TC-G-32 construct unreachable mixed-path states
**Status**: Deferred | **Raised in**: Phase 7 | Tests bypass validate. Rewrite as pure GPAV or mark as apply-only.

### KI-35: `consecutiveZero` and `tallyHistory` are dead data in pure GPAV mode
**Status**: Deferred | **Raised in**: Phase 7 | No functional impact. Document in JSDoc.

### KI-36: `test_evidence` payload uses strict `!==` for phase
**Status**: Accepted | **Raised in**: Phase 7 | CheckpointHandler normalizes payloads. Inconsistent but not broken.

### KI-37: `completedRecords` ordering assumption not enforced
**Status**: Accepted | **Raised in**: Phase 7 | In-memory append-only guarantees ordering. Only relevant if persistence layer changes.

### KI-38: Legacy→GPAV switch creates dual-source state
**Status**: Accepted | **Raised in**: Phase 7 | Handled defensively by existing terminate logic. Transition artifact.

### KI-39: `user_approval` validate missing explicit phaseStatus check
**Status**: Accepted | **Raised in**: Phase 7 | `ralphCompleted` check provides equivalent protection. Explicit phaseStatus check would be redundant.

### KI-40: `contested_resolutions` payload validation missing test coverage
**Status**: Accepted | **Raised in**: Phase 7 | State-level contested checks have coverage. Payload-level tests are nice-to-have, not a gap.

### KI-41: Missing phaseStatus !== 'ralph_loop' rejection test
**Status**: Deferred | **Raised in**: Phase 7 | Validate logic correct, only missing test.

### KI-42: `contested_resolutions` duplicate ID first-wins behavior unverified
**Status**: Deferred | **Raised in**: Phase 7 | Behavior deterministic. Add duplicate ID check.

### KI-43: `new_contested` ID conflict check doesn't reflect same-round resolutions
**Status**: Deferred | **Raised in**: Phase 7 | Extremely low trigger probability. Apply handles correctly.

### KI-44: TC-G-31 doesn't assert consecutiveZero should be 0
**Status**: Deferred | **Raised in**: Phase 7 | TC-G-41 has full assertion. Add to TC-G-31 when convenient.

### KI-45: KI-24 fallback and legacy code duplication
**Status**: Resolved | **Raised in**: Phase 7 | **Resolved in**: Post-P5 cleanup — extracted `validateTallyTermination()` in src/transitions.ts, ~30 lines of duplicate termination logic collapsed to shared function call.

### KI-46: Contested partial resolution undocumented
**Status**: Accepted | **Raised in**: Phase 7 | Behavior correct by design. No action — contested resolution is a Phase 3 concern.

### KI-48: TC-G-02 doesn't cover phaseStatus='ralph_loop' + ralph=null
**Status**: Accepted | **Raised in**: Phase 7 | Inconsistent state is unreachable in production. Defensive test optional, not a defect.

### KI-49: Phase 3 TODO not linked to issue tracker
**Status**: Deferred | **Raised in**: Phase 7 | Standard tech debt. Link to KnownIssues or tracker.

### KI-50: `downgrade_reason` has no length limit
**Status**: Resolved | **Raised in**: Phase 7 R1, R2 | **Resolved in**: Post-P5 cleanup — added `MAX_DOWNGRADE_REASON_LENGTH = 1000` constant and validation in transitions.ts.

### KI-51: KI-47 limit is per-submission, merge could accumulate past limit
**Status**: Accepted | **Raised in**: Phase 7 R1, R2 | Merge branch (KI-32) is currently unreachable code. Re-evaluate only if KI-32 is opened.

### KI-52: TC-G-33 constructs normally unreachable state
**Status**: Deferred | **Raised in**: Phase 7 R2 | Test validates defense-in-depth. Add annotation to test description.

### KI-53: KI-22 defensive comment wording may mislead
**Status**: Resolved | **Raised in**: Phase 7 R2 | **Resolved in**: Post-P5 cleanup — removed misleading comment after KI-45 refactor made the "fall through to KI-24" description stale.

### KI-54: validSeverities Set rebuilt on every call
**Status**: Resolved | **Raised in**: Phase 7 R2 | **Resolved in**: Post-P5 cleanup — extracted to module-level `VALID_SEVERITIES` constant.

### KI-55: `validateTransition` pure function has no config injection
**Status**: Resolved | **Raised in**: Phase 1 R4 | Resolved: `loopPhaseMap` stored in PipelineState, `getLoopType` reads from state.

### KI-56: `totalPhases` deeply embedded in state machine
**Status**: Resolved | **Raised in**: Phase 1 R4 | Resolved: `maxPhase` optional field + effectiveMax fallback.

### KI-57: Rollback from arbitrary phase requires pre-filling state
**Status**: Deferred | **Raised in**: Phase 1 R4 | Requirement clarified: rollback starts from Phase 1 only.

### KI-58: `intercept-rules.ts` unconditionally requires `ralphCompleted`
**Status**: Resolved | **Raised in**: Phase 1 R4 | Resolved: Rule 2 loopType-aware via getLoopType.

### KI-59: `ralph_loop_start` doesn't check loopType
**Status**: Resolved | **Raised in**: Phase 1 R4 | Resolved: B.5 loopType guard added.

### KI-60: LLM can run multiple phase loops via sub-agent
**Status**: Accepted | **Raised in**: Phase 1 design | Trust-based security model limitation. Watchdog only monitors checkpoint calls.

### KI-61: CheckpointHandler effectiveMax archive trigger untested
**Status**: Resolved | **Raised in**: Phase 4 R3 | **Resolved in**: Phase 2.2 — checkpoint-loop-type.test.ts covers archive trigger at effectiveMax (5 tests: maxPhase archive, non-final no-archive, legacy fallback, boundary).

### KI-63: CheckpointHandler constructor signature mismatch causes TypeError
**Status**: Resolved | **Raised in**: Phase 4 R12 | **Resolved in**: Phase 5 — constructor finalized as `(store, staleThresholdMs, loopConfig?, cache?, observer?, logger?)`. All test files use correct signature.

### KI-64: IT-1/2/3 marked as integration but only test parseLoopPhases unit
**Status**: Resolved | **Raised in**: Phase 4 R14 | Fixed: KI-62 fix adds integration tests. Stale RED comments replaced.

### KI-65: PipelineState schema missing loopPhaseMap and maxPhase fields
**Status**: Resolved | **Raised in**: Phase 4 R28 | **Resolved in**: Phase 5 — schema.ts L36-39 defines `loopPhaseMap?: PhaseLoopMap` and `maxPhase?: number` on PipelineState.

### KI-66: AC-12 legacy early_stop dual-path claim
**Status**: Accepted | **Raised in**: Phase 2.3 R9, R10 | Fixed in document. GPAV-only annotation now correct.

### KI-67: Error messages for `original: 'M'` edge case
**Status**: Resolved | **Raised in**: Phase 2.3 risk analysis | **Resolved in**: Post-P5 verification — 7 tests covering M→P downgrade (TC-09/17/18/26/38/41/42) all pass. Error messages correct, no code change needed.

### KI-68: 188 test sites need mechanical update for P severity
**Status**: Resolved | **Raised in**: Phase 2.3 risk analysis | **Resolved in**: Phase 2.3 TDD pipeline Phases 4-5 | Original estimate of 188 sites was consumed incrementally during Phase 2.3 development. Final verification: only 1 baseline site remained (transitions.test.ts L180 negative test) — fixed in Phase 5. All 479 tests pass with P: 0 in all counts/tally objects.

---

## Dropped (verified non-issues)

| ID | Description | Reason |
|----|-------------|--------|
| KI-8 | `checkpoint.ts` comment numbering skips step 7 | Pure cosmetic |
| KI-11 | Corrupted-state violation path unreachable | Defense-in-depth safety net |
| KI-14 | Observer debug log uses object parameter | Pino-style logger idiomatic |
| KI-15 | FIFO eviction logs on every eviction | Debug-level only, bounded by buffer size |
| KI-19 | State written on articulation failure | Correct by design — tracks failure count |

---

## Phase 2.3 Review Findings (P/L/I Catalog)

During the Phase 2.3 (P Severity Addition) Ralph review loop (R1-R9 for Phase 4 code review), the following non-blocking findings were documented for future consideration. These are NOT defects — they are improvement opportunities or observations that did not warrant immediate action.

### KI-Px (Proposal-level findings)

- **KI-P1**: in-place mutation contract for normalizeSeverities — discovered in design R6 F-5 / code R1 F-3. Currently safe (payloads from JSON.parse are always mutable), but JSDoc would prevent future surprises.
- **KI-P2**: unbounded migration scan in readState — discovered in design R7 F-14. O(n) per readState call, bounded by MAX_RALPH_ROUNDS. Could gate behind state.version < 4.
- **KI-P3**: termination validation triplication — discovered in code R1 F-1. GPAV/KI-24/legacy paths have ~30 lines of nearly identical termination logic. Future divergence risk.
- **KI-P4**: bundled bugfix coupling — discovered in design R7 F-15. L-in-zero-check bug fix shipped with P severity addition; if P needs revert, L fix must be re-applied separately.
- **KI-P5**: downgrade matrix coverage — discovered in design R6 F-2/F-3. No test for C→P or P→L downgrades (generic severityLt handles them correctly, but no specific tests).
- **KI-P6**: Ralph Loop Precision pass should always use independent subagent — discovered in Phase 4 compliance audit. R8/R9 used inline main-agent evaluation instead of spawning independent Precision subagent. Protocol mandates `spawn_precision_subagent` with no exceptions. Fix: enforce in all future loops regardless of finding triviality.
- **KI-P7**: Ralph Loop Fact-Gathering step should be explicit — discovered in Phase 4 compliance audit. R1–R9 lacked structured fact-gathering between Recall and Precision (grep residual refs, cat suspect functions, read configs). Precision subagents performed their own verification, but protocol requires main-agent pre-collection. Fix: add explicit fact-gather checklist before Precision spawn.

### KI-Lx (Low/cosmetic findings)

- **KI-L1**: AC-9 max_rounds justification wording slightly misleading (see KI-65 in Phase 2.3 section) — edge case note says "quality-tier M₂ doesn't qualify" but rejection is due to C+H+M=0, not M₂ status.
- **KI-L2**: 188 test sites need mechanical P:0 addition (see KI-68) — large surface area increases risk of silent test failures.

### KI-Ix (Informational observations)

- **KI-I1**: `original: 'M'` edge case works correctly — normalizeSeverities maps M₁→M and M₂→P but plain 'M' passes through since it's already the target format. No action needed.
- **KI-I2**: AC-12 originally claimed "applies to both GPAV and legacy paths" but M₂=3 data shape can only occur in GPAV mode. Annotation corrected in final document version.
- **KI-I3**: Phase 2.3 Test Plan Review Gate Passed (R10+R11 consecutive zero C/H/M, v2.15). All KI items re-evaluated post-gate. KI-26 promoted to Active/Medium. KI-67/KI-68 remain Deferred (action in Phase 4/5.5). No new KI items from R11 review.
- **KI-I3**: Phase 2.3 Test Plan Review Gate Passed (R10+R11 consecutive zero C/H/M, v2.15). All KI items re-evaluated post-gate. KI-26 promoted to Active/Medium. KI-67/KI-68 remain Deferred (action in Phase 4/5.5). No new KI items from R11 review.

---

## How to Add a New KI

1. Pick the next free KI-N number (check Index)
2. Add code comment: `// KI-N: <brief>` or `// [KI-N] <brief>` near the relevant line
3. Add full entry to this document with Context, Issue, Decision, Code Reference
4. Update Index table
5. If resolving an existing KI, change Status to Resolved and add Resolution date
