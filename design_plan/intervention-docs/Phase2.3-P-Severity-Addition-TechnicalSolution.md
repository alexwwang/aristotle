# Technical Solution: Phase 2.3 — P Severity Addition

## Implementation Status

**Status**: Implemented and shipped (commit `a0fd01e`).

This document describes the design as implemented. The "Current → New" tables below reflect the **pre-Phase 2.3 baseline** vs the **as-shipped state**. The "Current" column is historical; the "New" column matches code at HEAD.

## Requirements Reference
`Phase2.3-P-Severity-Addition-Requirements.md` — 18 ACs, 12 Constraints. Terminology follows the Glossary in that document (§Glossary): GPAV, KI, defect-tier, quality-tier, RoundTally, RoundRecord.counts, SEV_ORDER, original.

## AC Traceability Matrix

| AC | Covered By | Verification |
|----|-----------|--------------|
| AC-1 | C2, C4 | unit test (severity P accepted) |
| AC-2 | C3 | unit test (Unicode/ASCII normalization) |
| AC-3 | C4 | unit test (plain M still accepted) |
| AC-4 | C5, C7 | unit test (P/L do not reset consecutiveZero) |
| AC-5 | C5 | unit test (M resets) |
| AC-6 | C5 | unit test (gate_pass with P/L) |
| AC-7 | C5 | unit test (max_rounds rejected when C=H=M=0) |
| AC-8 | C5 | unit test (early_stop with P/L) |
| AC-9 | C1, C6 | unit test (count aggregation produces M/P) |
| AC-10 | C2 (SEV_ORDER), C4 | unit test (M→P requires downgrade_reason) |
| AC-11 | C4 | unit test (M→P with reason accepted) |
| AC-12 | C8 | unit test (readState adds P:0 to old tallyHistory) |
| AC-13 | C8 | unit test (version > SCHEMA_VERSION rejected) |
| AC-14 | C1, C7 | unit test (ralph_round_complete preserves P count) |
| AC-15 | C3 | end-to-end test (Unicode → stored P key) |
| AC-16 | C2 (checkTally) | unit test (missing P key rejected) |
| AC-17 | C8 | unit test (readState adds P:0 to old roundRecords.counts) |
| AC-18 | C11 | grep verification across all canonical deployment paths (see C11.5) |

Constraint mapping (Requirements Constraints → Change Matrix entries; `Con-N` = Requirements Constraint N to disambiguate from Change `C-N`): Con-1 (covered by C2/C4); Con-2 (C2/C4/C8 + Constraint 2.3 noted in C9); Con-3 (C3); Con-4 (C2); Con-5 (C5/C7); Con-6 (C5); Con-7 (C8); Con-8 (out of scope); Con-9 (out of scope); Con-10 (C11); Con-11 (C10); Con-12 (C8/C9).

## Change Matrix

### C1. Schema Types (`schema.ts`)

| Line | Pre-Phase 2.3 Baseline | As Shipped | AC |
|------|------------------------|------------|----|
| 87 | `consecutiveZero: number // consecutive rounds with zero C/H/M (L excluded)` | `// consecutive rounds with zero C/H/M (P/L excluded)` | — |
| 118 | `counts: { C: number; H: number; M: number; L: number; I: number }` | `counts: { C: number; H: number; M: number; P: number; L: number; I: number }` | AC-9 |
| 124 | `severity: 'C' \| 'H' \| 'M' \| 'L' \| 'I'` | `severity: 'C' \| 'H' \| 'M' \| 'P' \| 'L' \| 'I'` | AC-1, AC-3 |
| 127 | `original?: 'C' \| 'H' \| 'M' \| 'L' \| 'I'` | `original?: 'C' \| 'H' \| 'M' \| 'P' \| 'L' \| 'I'` | AC-2, AC-10 |
| 21 | `SCHEMA_VERSION = 3` | `SCHEMA_VERSION = 4` | AC-13 |
| 98-106 | `RoundTally { C, H, M, L, I }` | Add `P: number` after `M` | AC-14, AC-17 |
| 117-121 | RoundRecord docstring brief | Extended with cross-reference to readState migration invariant | AC-17 |

### C2. Severity Constants & Helpers (`transitions.ts`)

| Line | Pre-Phase 2.3 Baseline | As Shipped | AC |
|------|------------------------|------------|----|
| 63 | `for (const key of ['C', 'H', 'M', 'L', 'I'])` | `for (const key of ['C', 'H', 'M', 'P', 'L', 'I'])` — checkTally enforces all 6 keys present (AC-16) | AC-16 |
| 74 | `SEV_ORDER: { C: 5, H: 4, M: 3, L: 2, I: 1 }` | `{ C: 5, H: 4, M: 3, P: 2, L: 1, I: 0 }` | — |
| 74 comment | `C=5 > H=4 > M=3 > L=2 > I=1` | `C=5 > H=4 > M=3 > P=2 > L=1 > I=0. P=Proposal (quality-tier, does not reset consecutive-zero).` | — |

> **F-9 resolution**: The original "no change" annotation was incorrect. `checkTally` was changed to require all 6 keys, which is the correct behavior per AC-16 (missing P key = protocol violation, not "zero findings"). AC-14 was rewritten to test the `P:0` scenario (zero P-level findings), and AC-16 was added to test the missing-P-key rejection.

### C3. Input Normalization (`checkpoint.ts`)

Add `normalizeSeverities()` function in `checkpoint.ts` (line 24-38). Called **before** both `validateTransition` and `applyTransition` (line ~225, immediately before validate).

```
const SEVERITY_NORMALIZE_MAP: Record<string, string> = {
  '\u004D\u2081': 'M', '\u004D\u2082': 'P',  // Unicode subscripts M₁, M₂
  'M1': 'M', 'M2': 'P',                       // ASCII fallback
}
```

Applied to `findings[].severity` (always present) and `findings[].original` (optional per schema line 46 — normalization runs only when `original` is defined; `if (f.original) f.original = MAP[f.original] ?? f.original`) in `ralph_round_finding` payload only.

**Guard**: `if (event === 'ralph_round_finding') { ... }` — only this event carries severity strings.

| AC | Coverage |
|----|----------|
| AC-2 | Unicode/ASCII normalization accepted |
| AC-15 | Normalization reaches apply (same payload object mutated before both calls) |

### C4. Validation (`transitions.ts` validate)

| Line | Pre-Phase 2.3 Baseline | As Shipped | AC |
|------|------------------------|------------|----|
| 333 | `validSeverities = new Set(['C', 'H', 'M', 'L', 'I'])` | `new Set(['C', 'H', 'M', 'P', 'L', 'I'])` | AC-1, AC-3 |
| 340 | Error: `"C/H/M/L/I"` | `"C/H/M/P/L/I"` | — |
| 350 | Error: `"C/H/M/L/I"` | `"C/H/M/P/L/I"` | — |

### C5. GPAV Zero-Check Bug Fix (`transitions.ts` terminate validation)

All three primary-path locations fix the same bug: remove `L === 0` / `+ .L` from zero-checks. `P` is NOT added (quality-tier, excluded like L).

| Approximate Line | Pre-Phase 2.3 Baseline | As Shipped | AC |
|------|------------------------|------------|----|
| 570 (primary) | `c.C === 0 && c.H === 0 && c.M === 0 && c.L === 0` | `c.C === 0 && c.H === 0 && c.M === 0` | AC-4, AC-8 |
| 585 (primary) | `lastRec.counts.C + lastRec.counts.H + lastRec.counts.M + lastRec.counts.L > 0` | `lastRec.counts.C + lastRec.counts.H + lastRec.counts.M > 0` | AC-5, AC-6 |
| 606 (primary) | `lastRec.counts.C + lastRec.counts.H + lastRec.counts.M + lastRec.counts.L === 0` | `lastRec.counts.C + lastRec.counts.H + lastRec.counts.M === 0` | AC-5, AC-7 |

**Fallback and legacy paths** (F-18 verification): The KI-24 fallback path uses `tallyHistory` when `completedRecords` is empty (lines ~629, ~650). These paths already excluded L in the pre-Phase 2.3 baseline (they always used `C+H+M`) and required no changes for Phase 2.3. Verified by inspection at HEAD.

**AC-8 (early_stop) coverage**: AC-8 is satisfied by the consecutive-zero counter fix at line ~570 — the early_stop termination path derives its "consecutive defect-tier-clean count" from this counter, so correcting the counter's L-exclusion also corrects early_stop validation behavior. No early_stop-specific code change is required.

Error messages and adjacent comments updated to reflect `C=H=M=0, P/L excluded`.

### C6. Apply Handler — `ralph_round_finding` (`transitions.ts`)

| Approximate Line | Pre-Phase 2.3 Baseline | As Shipped | AC |
|------|------------------------|------------|----|
| 1042 | `const counts = { C: 0, H: 0, M: 0, L: 0, I: 0 }` | `{ C: 0, H: 0, M: 0, P: 0, L: 0, I: 0 }` | AC-9 |
| 1063 | `M: existing.counts.M + counts.M` (no P) | `P: existing.counts.P + counts.P` (no `?? 0` fallback) | AC-9 |

> **F-5 resolution**: The original design proposed `(existing.counts.P ?? 0) + counts.P` as defensive. After C8's roundRecords migration guarantees P exists on all loaded records, the `?? 0` is redundant and was removed for symmetry with other fields.

### C7. Apply Handler — `ralph_round_complete` (`transitions.ts`)

| Approximate Line | Pre-Phase 2.3 Baseline | As Shipped | AC |
|------|------------------------|------------|----|
| 939-945 | `tally as { C, H, M, L, I }` type assertion | Add `P: number` to type assertion | AC-14 |
| 953-963 | `roundTally = { round, C, H, M, L, I, timestamp }` | Add `P: tally.P` (payload always includes P per C2/AC-16) | AC-14 |
| 970 | `tally.C + tally.H + tally.M === 0` for consecutiveZero | No change — already excluded L (consistent with C5 strict definition) | — |

> **F-10 resolution**: The original design proposed hardcoding `P: 0` in roundTally construction. After C2's checkTally change (AC-16) guarantees P is present in the payload, the implementation uses `P: tally.P` to preserve the actual reported count.

### C8. Version Gate + Defensive Migration (`pipeline-store.ts`)

Add version check and migrations in `readState`:

```typescript
// Version gate — reject future-format state
if (state && state.version > SCHEMA_VERSION) {
  throw new Error(
    `State file version ${state.version} is newer than supported version ${SCHEMA_VERSION}. ` +
    `Update the watchdog to support this version.`
  )
}
// Defensive migration 1: add P:0 to old tallyHistory entries
if (state?.ralph?.tallyHistory) {
  for (const t of state.ralph.tallyHistory) {
    if (!('P' in t)) (t as Record<string, unknown>).P = 0;
  }
}
// Defensive migration 2: add P:0 to old roundRecords counts
// (Required because pre-v4 GPAV records may lack P key)
// Null guard on r.counts: corrupted/truncated state files may have
// missing counts entirely; the guard prevents TypeError from `'P' in undefined`.
if (state?.ralph?.roundRecords) {
  for (const r of state.ralph.roundRecords) {
    if (r.counts && !('P' in r.counts)) (r.counts as Record<string, unknown>).P = 0;
  }
}
```

**Location**: Before existing migration checks (line 141-152).

| AC | Coverage |
|----|----------|
| AC-12 | Old tallyHistory without P field — migrated to P:0 on load |
| AC-13 | Newer version rejected with clear error |
| AC-17 | Pre-v4 roundRecords.counts without P — migrated to P:0 on load |

> **F-6 resolution**: The original design only documented the `tallyHistory` migration. The actual implementation also migrates `roundRecords.counts` because both data structures can lack P in pre-v4 state files. Both migrations are required for AC-17 completeness.

### C9. Read-Path Invariant

After C8 migrates both `tallyHistory` and `roundRecords.counts` on load, all loaded state has `P` present. Code that reads `.counts.P` after `readState()` is safe. The merge branch in C6 uses direct access (no `?? 0`) because of this invariant.

**Invariant documented in `schema.ts` RoundRecord docstring (Phase 2.3 audit fix F1)**: Any code creating RoundRecord objects outside the normal load path (e.g. test mocks) must include `P` to maintain this invariant.

### C10. Contested Issue Compatibility (Constraint 11 verification)

No code changes required. Contested issue logic in `transitions.ts` uses explicit `id` field for matching, not severity-based filtering. P findings are submitted via `ralph_round_finding` and tracked in `roundRecords.counts.P` separately from contested state. Verified by inspection at HEAD.

### C11. TDD Protocol Files (15 files, ~75 replacements)

#### C11.1 Canonical source and deployment paths

The TDD pipeline skill files have **one source-of-truth** and **two deployment mirrors**:

| Role | Path | Update direction |
|------|------|------------------|
| Source-of-truth | `/Users/alex/tdd-pipeline/skill/` | Edit here first |
| Deployment mirror (opencode) | `/Users/alex/.config/opencode/skills/tdd-pipeline/` | rsync from source |
| Deployment mirror (Claude Code) | `/Users/alex/.claude/skills/tdd-pipeline/` | rsync from source |

**Sync rule**: edits MUST land at the source first; mirrors are refreshed via `rsync -av --delete /Users/alex/tdd-pipeline/skill/ <mirror>/`. Direct edits to mirrors are prohibited (they are overwritten on next sync). AC-18's completion criterion applies to **all three locations** (source + both mirrors).

#### C11.2 Replacement rules

Replacement rules (applied ONLY to severity context, NOT issue IDs like `[M-1]`):

| Pattern | Replacement | Context |
|---------|-------------|---------|
| `M₁` | `M` | severity only |
| `M₂` | `P` | severity only |
| `M1` | `M` | severity only (not `[M-1]`, `M-1` issue IDs) |
| `M2` | `P` | severity only |
| `C/H/M1` | `C/H/M` | stop condition references |
| `C/H/M1/M2` | `C/H/M/P` | full severity list references |
| `M1: N \| M2: N` | `M: N \| P: N` | tally format |

#### C11.3 Files in scope (15 total)

All 15 files received replacements per C11.2. Two additional files (`customize-opencode`, `cli-customization`) outside this directory were also surveyed and confirmed to contain zero severity references — they are documented here for audit completeness but are NOT in the 15-file scope.

1. `ralph-review-loop.md` — severity table, examples, tally format
2. `ralph-continuation.md` — stop conditions, flowchart
3. `ralph-contested.md` — contested issue references
4. `ralph-gpav.md` — submission format, validation rules
5. `ralph-log-template.md` — tally format, GPAV submission format
6. `severity-migration.md` — substantial rewrite: mapping table now documents M (Major-Defect, defect-tier) and P (Proposal, quality-tier) as the v0.13+ vocabulary, with pre-v0.13 → v0.13+ migration heuristic
7. `ralph-examples.md` — stop condition examples
8. `review-design.md` — severity enum in JSON format
9. `review-code.md` — severity enum in JSON format
10. `phase-1-product-design.md` — ralph gate condition
11. `phase-2-technical-solution.md` — ralph gate condition
12. `phase-3-test-plan.md` — ralph gate condition
13. `phase-4-test-code.md` — ralph gate condition
14. `phase-5-business-code.md` — ralph gate condition + new Task Decomposition + Verification Completeness principles (Phase 7 audit follow-up)
15. `SKILL.md` — contested issue reference

#### C11.4 Note on severity-migration.md

`severity-migration.md` exists in the source-of-truth and is mirrored into both deployment paths. It is the canonical migration guide for orchestrators upgrading from pre-v0.13. After the C11.2 rewrite it contains zero M1/M2/M₁/M₂ references (the file uses the new M/P vocabulary in both the "What Changed" narrative and the mapping table). Note: a transient deployment skew was observed during Phase 2 review where the `.claude/` mirror lagged the source — this was a sync hygiene gap, not a content defect; resolved by enforcing C11.1 sync rule.

#### C11.5 AC-18 verification mechanism

The verification uses two separate grep invocations to avoid ERE/Unicode pitfalls (`\|` in ERE is literal pipe not alternation; `\uXXXX` is not a recognized escape in POSIX ERE — Unicode subscripts must appear as the actual UTF-8 bytes):

| AC | Verification command | Expected result |
|----|---------------------|-----------------|
| AC-18 (ASCII) | `grep -rEn 'M[12]([^-]|$)' /Users/alex/tdd-pipeline/skill/ /Users/alex/.config/opencode/skills/tdd-pipeline/ /Users/alex/.claude/skills/tdd-pipeline/` | zero matches (the `[^-]|$` character-exclusion + EOL alternation excludes issue ID patterns like `[M-1]`, `M-1`, `M-2` by requiring M1/M2 followed by a non-dash character or end-of-line) |
| AC-18 (Unicode) | `grep -rEn 'M₁|M₂' /Users/alex/tdd-pipeline/skill/ /Users/alex/.config/opencode/skills/tdd-pipeline/ /Users/alex/.claude/skills/tdd-pipeline/` | zero matches (ERE form, portable across GNU and BSD grep) |

Verification must be re-run after any sync operation. A non-zero match in any of the three paths constitutes an AC-18 failure. Per C11.1, the source-of-truth and both deployment mirrors must all return zero matches.

## Implementation Order

```
Phase 4 (RED — test code):
  T1. schema type changes (compile-time enforcement)
  T2. AC-1/2/3: severity validation tests (accept P, normalize, accept M)
  T3. AC-4/5: consecutive-zero counter tests (P/L no reset, M resets)
  T4. AC-6/7/8: terminate validation tests (P/L excluded from checks)
  T5. AC-9: count aggregation test (separate M/P counts)
  T6. AC-10/11: downgrade tests (M→P requires reason)
  T7. AC-12: read compat test (old data P defaults to 0)
  T8. AC-13: version gate test
  T9. AC-14: ralph_round_complete with P:0 (zero P-level findings)
  T10. AC-15: end-to-end normalization test (Unicode → stored P)
  T11. AC-16: ralph_round_complete missing P key → rejected (protocol violation)
  T12. AC-17: readState migration adds P:0 to pre-v4 roundRecords

Phase 5 (GREEN — business code):
  S1. C1: schema.ts types + SCHEMA_VERSION bump
  S2. C2: SEV_ORDER + checkTally update (6 keys required)
  S3. C3: normalizeSeverities() + checkpoint.ts preprocessing
  S4. C4: validSeverities + error messages
  S5. C5: GPAV L-bug fix (3 primary locations; fallback paths verified unchanged)
  S6. C6: ralph_round_finding apply handler (counts init + merge)
  S7. C7: ralph_round_complete apply handler (add P: tally.P)
  S8. C8: version gate + tallyHistory migration + roundRecords migration in pipeline-store.ts
  S9. C9: RoundRecord docstring invariant + readState cross-reference comment
  S10: C11: TDD protocol file updates (15 files)

Phase 5.5 (existing test adaptation):
  E1. Update all 188 test sites referencing M severity/counts. Three adaptation patterns dominate:
      (a) hardcoded `counts` object literals — add `P: 0` key after `M` (mechanical search-replace);
      (b) RoundTally fixtures — add `P: N` matching test intent (typically `P: 0`);
      (c) severity-enum assertions / Set membership — update from `['C','H','M','L','I']` to `['C','H','M','P','L','I']` where the full enum is enumerated;
      (d) error-message string assertions — update from `"C/H/M/L/I"` to `"C/H/M/P/L/I"`.
      Patterns (a)–(c) are mechanical; pattern (d) requires care for any custom error message variants.
```

## Dependency Graph

```
S1 (schema) ──→ S4 (validation) ──→ S6 (apply finding)
               ──→ S5 (L-bug fix)
               ──→ S7 (apply complete)
               ──→ S8 (version gate + migrations)
S2 (SEV_ORDER + checkTally) ──→ S4 (used by severityLt, checkTally)
S3 (normalize) ──→ must land before S4 (normalized before validate)
```

S1 and S2 can be done in parallel. S3 must land before S4. S5-S9 depend on S1.
