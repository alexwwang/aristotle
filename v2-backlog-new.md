## v2 Backlog (Post-MVP)

### Review Sub-Step Monitoring

Ralph Loop Review protocol mandates **Dual-Pass Mode** (Recall -> Fact-Gather -> Precision). Current MVP (V-1..V-13) only monitors macro-level review execution. The following violation types cover the **sub-step integrity** within a single review round.

**Design decisions (confirmed)**:
1. Three independent violation types (V-14/V-15/V-16), not a merged type - each sub-step has distinct trigger and remediation
2. To be included in a separate v2 requirements document (not merged into v1.x)
3. No auto-fix for any - LLM must re-execute the skipped step (consistent with V-1/V-2/V-3 pattern)

#### Violation Matrix

| # | Type | Trigger | Rollback To | Auto-Fix | KI Doc Action | Priority |
|---|------|---------|-------------|----------|---------------|----------|
| V-14 | SKIP_RECALL | Review round completed but no Recall pass output (no raw findings found) | Current Phase | None (require LLM to execute Recall pass) | Record: skipped Recall | P2 |
| V-15 | SKIP_FACT_GATHER | Precision pass ran but VERIFIED_FACTS is empty or missing | Current Phase | None (require LLM to gather facts from project) | Record: skipped fact-gathering | P2 |
| V-16 | SKIP_PRECISION | Recall findings used directly as final tally without Precision Filter pass | Current Phase | None (require LLM to execute Precision Filter) | Record: skipped Precision | P2 |

**Scope**: Phases 1-5 (all phases with Ralph Loop Review).

**Intervention behavior**: All three block the pipeline (SYNC mode). The LLM receives instruction specifying which sub-step was skipped and must re-execute that sub-step before the review round can proceed. No auto-fix is possible - the system cannot substitute for the LLM's judgment in recalling findings, gathering project facts, or filtering for precision.

**Design impact**:
- VIOLATION_PRIORITY: 3 new P2 entries (same tier as V-1/V-2/V-3/V-13)
- PipelineContext: needs review_sub_step tracking field (recalled: bool, facts_gathered: bool, precision_done: bool)
- InterventionCoordinator: 3 new plan entries (all auto_fix=False, needs_rollback=False, is_destructive=False)
- ViolationFilter: must detect absence of each sub-step output
- New US and AC to be written in v2 requirements document

**Rationale**: Dual-Pass is mandatory per protocol. Skipping any sub-step defeats the quality gate:
- Skip Recall -> findings are incomplete, defects missed
- Skip Fact-Gather -> Precision has no objective basis, operates on LLM reasoning alone
- Skip Precision -> false positives pass through, wasted fix rounds on non-issues
