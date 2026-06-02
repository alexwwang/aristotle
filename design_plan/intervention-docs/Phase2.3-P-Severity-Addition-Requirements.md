# Requirements Document: Phase 2.3 — P Severity Addition

## Why Articulation

Phase 2.3 adapts the watchdog checkpoint system to TDD Pipeline v0.13's severity reclassification. The old flat 5-level system (C/H/M/L/I) is extended to a 3-tier 6-level system (C/H/M/P/L/I). The three tiers are: **Critical** (C/H), **Major** (M defect-tier / P quality-tier), and **Minor** (L/I). The key insight: **`M` stays unchanged as defect-tier**, and `P` (Proposal) is **added** as a quality-tier severity for major improvements.

This is an **additive change** — `M` is not split, renamed, or removed. Existing data, payloads, and code paths that use `M` continue to work without migration.

## Design Rationale

TDD Pipeline v0.13 defines two sub-levels under the old "Major" severity:
- **M₁** (Major-Defect): behavioral defect, counted in stop condition
- **M₂** (Major-Improvement): architectural improvement, NOT counted

Rather than splitting `M` into `M1`/`M2` (breaking backward compatibility), we **keep `M` for defect-tier** and **add `P` for quality-tier proposals**. The mapping:

| TDD Protocol Notation | Wire/Storage Format | Tier |
|----------------------|--------------------| -----|
| M₁ (Major-Defect) | **M** (unchanged) | Defect |
| M₂ (Major-Improvement) | **P** (Proposal, new) | Quality |

Input normalization handles the common case where LLM orchestrators read TDD protocol docs (which use M₁/M₂ notation) and submit those characters. ASCII variants `M1`/`M2` are also accepted and normalized — see Constraint 3 for the full normalization map.

## Glossary

| Term | Definition |
|------|-----------|
| **GPAV** | Gate-Pass Auto-Validation — the watchdog's primary review path where `ralph_round_finding` submissions auto-validate without requiring an explicit `ralph_round_complete` call. Activated when `state.ralph.autoValidated === true`. |
| **KI** | Known Issue — a previously identified concern (design choice, deferred feature, or accepted trade-off) documented in `KnownIssues-Watchdog.md` with stable ID `KI-N`. KI references in this doc point to specific entries (e.g., KI-24 is a legacy fallback path). |
| **defect-tier** | Severity levels that reset the consecutive-zero counter (C, H, M). Findings at this tier block termination. |
| **quality-tier** | Severity levels that do NOT reset the consecutive-zero counter (P, L, I). Improvement-class findings; do not block termination. |
| **RoundTally** | Aggregate severity counts for one completed round, stored in `tallyHistory[]`. Shape: `{C, H, M, P, L, I, timestamp}`. |
| **RoundRecord.counts** | Per-round severity tally maintained by GPAV. Shape: `{C, H, M, P, L, I}`. |
| **SEV_ORDER** | Numeric severity ordering: `{C:5, H:4, M:3, P:2, L:1, I:0}`. Used by downgrade detection (severity < original → requires `downgrade_reason`). |
| **original** | The initial severity assigned to a finding before any downgrade. Stored in finding objects; compared against current severity for downgrade detection via SEV_ORDER ordering. When `severity < original`, `downgrade_reason` is required. |

## System Boundaries

### In scope
- Add `P` severity: `FindingSubmission.severity`, `RoundTally`, `RoundRecord.counts`
- Validation logic: add `'P'` to severity whitelist
- Stop condition logic: `P` does NOT reset consecutive-zero counter (quality-tier, like L)
- `ralph_terminate` validation: gate_pass, early_stop, max_rounds checks exclude `P` (and `L`)
- Severity ordering: `SEV_ORDER` adds `P: 2`, shifts `L: 1`, `I: 0`
- Count computation: `P` counted separately in RoundRecord.counts
- Input normalization: `M₁`→`M`, `M₂`→`P` (and ASCII variants `M1`→`M`, `M2`→`P`) — backward-compat shim for old orchestrators
- Existing bug fix: GPAV paths incorrectly include `L` in zero-checks
- readState version gating: reject state files newer than expected version
- **TDD Pipeline protocol adaptation**: update all 15 skill files to use `M`/`P` terminology (75 replacements across `ralph-review-loop.md`, `ralph-continuation.md`, `ralph-gpav.md`, `severity-migration.md`, etc.). **Completion criterion**: zero remaining references to `M1`/`M2`/`M₁`/`M₂` notation across all skill files; all severity-related text uses the unified `M` (defect-tier) and `P` (quality-tier) vocabulary.
- Test suite update: add `P` to affected tests

### Out of scope
- **Termination type restructuring** (gate_pass/max_rounds alignment with protocol — separate Phase)
- **`ralph_round_complete` tool signature** — the tool still accepts a tally object. However, the tally schema now requires all 6 severity keys including `P` (enforced by validation — see AC-16). Backward compatibility for pre-v4 **stored state files** (not runtime payloads) is handled separately by readState migration — see AC-12, AC-17, and Constraint 2.
- Known Issues awareness (deferred additive feature)
- Orchestrator-side behavioral changes
- Config file changes

### External dependencies
- None — TDD Pipeline protocol adaptation is in scope for this change

## User Stories

| # | Priority | User Story |
|---|----------|-----------|
| US-1 | Core | As a pipeline orchestrator, I want to submit findings with severity P (Proposal) so that quality improvements are tracked but don't block the stop condition |
| US-2 | Core | As a pipeline orchestrator, I want the stop condition to only count C/H/M (not quality-tier P/L/I) so that quality-tier findings don't block gate progression |
| US-3 | Core | As a pipeline operator, I want existing state data to remain fully compatible without migration |

## Acceptance Criteria

| # | User Story | Priority | Acceptance Criterion | Edge Cases |
|---|-----------|----------|---------------------|------------|
| AC-1 | US-1 | Core | Given a `ralph_round_finding` submission with `severity: 'P'`, When the watchdog validates it, Then it is accepted and counted in the quality tier (not defect tier) | P does not reset consecutive-zero counter |
| AC-2 | US-1 | Core | Given a `ralph_round_finding` submission with `severity: 'M₂'` (Unicode), When the watchdog processes it, Then severity is normalized to `'P'` and accepted | Same for `'M2'` (ASCII) → `'P'`; `'M₁'`→`'M'`, `'M1'`→`'M'`; applies to `original` field too |
| AC-3 | US-1 | Core | Given a `ralph_round_finding` submission with `severity: 'M'` (plain), When the watchdog validates it, Then it is accepted as defect-tier M (no change from current behavior) | Old `'M'` format still works — no rejection |
| AC-4 | US-2 | Core | Given a round with C=0, H=0, M=0, P=3, L=2, When the watchdog evaluates the consecutive-zero counter, Then the counter increments (P and L do not reset) | P>0 alone does not reset; L>0 alone does not reset |
| AC-5 | US-2 | Core | Given a round with C=0, H=0, M=1, P=0, L=0, When the watchdog evaluates the consecutive-zero counter, Then the counter resets to 0 | Single M finding resets counter (unchanged) |
| AC-6 | US-2 | Core | Given `ralph_terminate` with termination=`gate_pass` and last round has C=0, H=0, M=0, P=2, L=3, When the watchdog validates, Then gate_pass is accepted | P/L excluded from gate check |
| AC-7 | US-2 | Core | Given `ralph_terminate` with termination=`max_rounds` and last round has C=0, H=0, M=0, P=3, L=2, When the watchdog validates, Then max_rounds is rejected (no defect-tier findings) | Zero C/H/M in last round means the run should have terminated earlier via `gate_pass` or `early_stop`; `max_rounds` implies defects forced exhaustion. P/L excluded from this check. |
| AC-8 | US-2 | Core | Given `ralph_terminate` with termination=`early_stop` (early-stop path), where the last 2 completed rounds have C=0, H=0, M=0, P=3, L=2, When the watchdog validates, Then early_stop is accepted (consecutive defect-tier-clean count = 2, P/L excluded) | P/L excluded from early_stop zero-check |
| AC-9 | US-1 | Core | Given `ralph_round_finding` with 2 findings of severity M and 1 of P, When applied, Then `RoundRecord.counts` = `{C:0, H:0, M:2, P:1, L:0, I:0}` | Count aggregation produces separate M/P |
| AC-10 | US-1 | Core | Given `ralph_round_finding` with severity P and original M (no downgrade_reason), When validated, Then rejected with "downgrade_reason required" | M→P is a downgrade per SEV_ORDER (3→2) |
| AC-11 | US-1 | Core | Given `ralph_round_finding` with severity P and original M (with downgrade_reason), When validated, Then accepted | M→P downgrade allowed with reason |
| AC-12 | US-3 | Core | Given a state file written by pre-v4 code (no `P` field in RoundTally), When readState loads it, Then RoundTally.P defaults to 0 (no migration needed) | Additive field, `?? 0` on read |
| AC-13 | US-3 | Core | Given a state file with version > SCHEMA_VERSION, When readState loads it, Then it rejects with a clear error "state file version N is newer than supported version M" | Prevents silent misinterpretation of future-format data |
| AC-14 | US-3 | Core | Given `ralph_round_complete` (autoValidated=false) with tally `{C:0, H:1, M:2, P:0, L:0, I:0}` (zero P-level findings), When the watchdog applies it, Then stored RoundTally has all six severity counts preserved including `P: 0` | Models that find no P-level issues must still report `P: 0` per protocol |
| AC-15 | US-1 | Core | Given `ralph_round_finding` with `severity: 'M₂'` (Unicode), When the watchdog validates AND applies the full transition, Then the stored RoundRecord.counts has key `P` (not `'M₂'`) with value 1, and no `'M₂'` key exists | Normalization must reach apply — validate+apply share same normalized severity |
| AC-16 | US-1 | Core | Given `ralph_round_complete` payload without P key in tally (e.g. `{C:0, H:1, M:2, L:0, I:0}`), When the watchdog validates it, Then it is **rejected** with errorType `'missing'` | Protocol requires all 6 severity keys; missing key = protocol violation, not "zero findings" |
| AC-17 | US-3 | Core | Given a state file written by pre-v4 code (no `P` field in any `RoundTally` or `RoundRecord.counts`), When readState loads it, Then all `P` fields are populated with `0` via defensive migration | Disk migration is the ONLY legitimate path that handles missing-P data; runtime payloads must include P |
| AC-18 | US-1 | Docs | Given all TDD Pipeline skill files (15 files including `ralph-review-loop.md`, `ralph-continuation.md`, `ralph-gpav.md`, `severity-migration.md`), When searched for `M1`/`M2`/`M₁`/`M₂` notation, Then zero matches are found — all severity text uses unified `M` (defect-tier) and `P` (quality-tier) vocabulary | Documentation must align with implementation; mixed notation creates orchestrator confusion |

## Constraints & Assumptions

1. **M stays unchanged**: `M` continues to mean "Major-Defect" in defect-tier. No renaming, no migration, no breaking change. The TDD protocol's M₁ maps to `M` 1:1.
2. **P is additive at the storage layer, mandatory at the protocol layer**: `P` is a new severity level. Three distinct paths handle missing-P data:
   - **Runtime payloads** (e.g. `ralph_round_complete.tally`, `ralph_round_finding.findings[].severity`): **MUST include all 6 severity keys** (C/H/M/P/L/I). A missing P key is a protocol violation, not "zero P-level findings". `checkTally` enforces this by rejecting payloads without all 6 keys. Under the current TDD protocol, model output always evaluates all severity tiers, so `P: 0` means "I evaluated and found no P-level issues" while missing P means "I did not evaluate the P tier".
   - **Disk state files** (pre-v4): May lack `P` field in `RoundTally`/`RoundRecord.counts`. Handled by `readState` defensive migration (adds `P: 0`). This is the ONLY legitimate "no P field" path.
   - **Historical KI re-evaluation**: When re-evaluating a historical KI document, the new severity assessment (which may assign P) is written through normal `ralph_round_finding` paths — payload always includes the full set of severities.

   No SCHEMA_VERSION bump is strictly required for the additive P field alone, but version 4 bump is included for forward-compatibility version-gate safety.
3. **Input normalization**: Before validation, normalize severity strings: `{ 'M₁': 'M', 'M₂': 'P', 'M1': 'M', 'M2': 'P' }`. Applied to both `severity` and `original` fields in `ralph_round_finding`. All standard severity characters (`C`, `H`, `M`, `P`, `L`, `I`) are not in the normalization map and pass through unchanged. Only `ralph_round_finding` accepts severity strings. **Normalization must happen as a preprocessing step before both `validateTransition` and `applyTransition`** — the current architecture passes raw payload to both functions independently. If normalization only happens in validate, apply would use the raw Unicode string as a counts key (e.g., `counts['M₂']++`), producing corrupted data. The normalization point is in `checkpoint.ts` before the validate/apply call chain.
4. **SEV_ORDER**: `{ C: 5, H: 4, M: 3, P: 2, L: 1, I: 0 }`. Only relative order matters.
5. **Stop condition**: C/H/M reset the consecutive-zero counter. P, L, I do not. This is consistent with TDD Pipeline v0.13 where M₂ and L don't reset.
6. **Existing bug fix**: The three primary GPAV termination-check sites (consecutive-zero counter in the GPAV path, gate_pass validation, max_rounds validation — all in the ralph_terminate handler in `transitions.ts`) incorrectly include `L` in zero-checks. All three primary-path locations fixed in this change. The KI-24 fallback path and legacy (pre-GPAV) path already excluded L in the pre-Phase 2.3 baseline and required no modification — verified by inspection of current source.
7. **readState version gate**: If state file `version > SCHEMA_VERSION`, reject with error. Prevents old code from silently misinterpreting newer state formats. This is a **forward-compatibility safety net** independent of the P severity addition.
8. **Not introducing KI-awareness**: Deferred. KI dedup is the orchestrator's responsibility before GPAV submission.
9. **Termination types unchanged**: gate_pass, max_rounds, early_stop, escalated — not restructured in this Phase.
10. **Terminology unified**: Both the TDD Pipeline protocol and watchdog use `M` (defect-tier Major) and `P` (quality-tier Proposal). The protocol's 15 skill files are updated as part of this change (75 replacements). Input normalization (`M₁`→`M`, `M₂`→`P`) is a backward-compat shim for old orchestrators that still submit the v0.13 M₁/M₂ format.
11. **Contested issues**: Only C/H/M findings participate in the contested issue protocol. P findings are quality-tier (like L) and cannot be contested. No watchdog code changes needed — contested logic uses explicit `id` fields, not severity-based filtering.
12. **Legitimate "missing P" scenarios**: Exactly **one** legitimate path exists where data may lack the `P` field: reading pre-v4 state files from disk. All runtime payload paths must include `P` (enforced by `checkTally`). Test fixtures and replay scenarios that simulate pre-v4 data must do so via state file construction, not payload construction.

## Open Questions (resolved)

| # | Question | Resolution |
|---|----------|-----------|
| OQ-1 | M split into M1/M2 or keep M + add new char? | **Keep M + add P** — backward compatible, no migration, rollback-safe. TDD protocol updated to match. |
| OQ-2 | Which character for M₂ equivalent? | **P** (Proposal) — neutral, semantically clear as "suggested improvement" |
| OQ-3 | SEV_ORDER values | `{C:5, H:4, M:3, P:2, L:1, I:0}` — P inserted at 2, L/I shift down |
| OQ-4 | SCHEMA_VERSION bump? | **Yes — bump to v4** as forward-compatibility safety net for the version gate (AC-13). The `P` addition alone is additive and would not strictly require a bump, but pairing it with the version gate justifies the bump for clean upgrade semantics. |
| OQ-5 | Fix pre-existing L-in-stop-condition bug? | **Yes** — same code area, include in this change |
| OQ-6 | Restructure termination types? | **No** — deferred to separate Phase |
| OQ-7 | Rollback strategy? | **Safe by design** — old code reads M correctly, ignores unknown P field |
