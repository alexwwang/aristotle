Title: RFC: GEAR — A Protocol for AI Agent Error Learning

## Background

AI agents routinely repeat the same errors across sessions. Corrections applied in one session vanish in the next because memory is session-scoped, unstructured, or lacks quality control. This cross-session error repetition problem prevents agents from accumulating durable knowledge and forces users to repeatedly re-teach the same lessons.

## Core Idea

GEAR (Git-backed Error Analysis & Reflection) introduces three coordinated mechanisms: the Production-Audit-Consumption (PAC) model separates error reflection into decoupled phases with distinct role responsibilities; the Δ decision factor routes audit between automatic, semi-automatic, and mandatory human review based on confidence, risk, and empirical evidence; git-backed storage provides atomic reads, full version history, and verifiable rule provenance. Together, these enable agents to learn from errors in one session and prevent recurrence in subsequent sessions without requiring model fine-tuning.

The protocol defines five roles (Orchestrator, Resource Creator, Checker, Learner, Searcher), a five-state rule lifecycle, and a structured YAML frontmatter schema with intent-driven retrieval dimensions.

**PAC and the five roles:** In the PAC model, Production is handled by the Resource Creator (R), which writes rules freely; Audit by the Checker (C), which validates schema and executes git commits; Consumption by the Learner (L), which applies verified rules pre-task and reports failures. The Orchestrator (O) coordinates all phases and routes scenes, while the Searcher (S) handles intent-driven rule retrieval via a two-round scoring process. The separation ensures R produces freely, C verifies rigorously, and L consumes safely — each role has one clear responsibility and cannot substitute for another.

**The Δ decision factor** is a per-rule quality score computed as:

```
Δ_raw = confidence × (1 − risk_weight)
Δ     = Δ_raw × normalize(log(sample_size + 1))
```

It combines the rule's confidence (0–1), its risk category weight (0.8 / 0.5 / 0.2 for high / medium / low risk), and a log-normalized evidence factor that grows with application history. When `sample_size = 0`, the normalization factor is 0, forcing Δ = 0 and mandatory human review regardless of confidence. As a rule accumulates application data, Δ rises and can graduate to semi-automatic (Δ > 0.4) or fully automatic audit (Δ > 0.7). This means every new rule gets at least one human review cycle before the system can auto-commit it.

**`verified_by`** records whether a rule was admitted by the Checker automatically (`"auto"`) or by a named human reviewer. It is set at verification time and serves as provenance for audit decisions.

Specification: https://doi.org/10.5281/zenodo.19660780
Reference implementation: https://github.com/alexwwang/aristotle

Example rule frontmatter:
```yaml
---
id: "rec_1713283200"
status: "verified"
scope: "user"
project_hash: "a1b2c3d4"
category: "HALLUCINATION"
confidence: 0.85
risk_level: "high"
intent_tags:
  domain: "database_operations"
  task_goal: "connection_pool_management"
failed_skill: "prisma_client"
error_summary: "P2024 connection pool timeout in serverless"
source_session: "ses_abc123"
message_range: "msg_45-msg_52"
created_at: "2026-04-16T10:30:00+08:00"
verified_at: "2026-04-16T10:35:00+08:00"
verified_by: "auto"
rejected_at: null
rejected_reason: null
success_rate: null
failure_rate: null
sample_size: 0
conflicts_with: null
---
```

## Why Different

GEAR's contribution is the combination, not any single mechanism. The table below shows which prior works cover which dimensions — no existing system provides all of them.

| Dimension                      | Reflexion | MPR     | Lore    | Mem0    | ARIA    | MemCoder | GEAR |
| ------------------------------ | --------- | ------- | ------- | ------- | ------- | -------- | ---- |
| Cross-session persistence      | ❌        | partial | ✅      | ✅      | ✅      | ✅       | ✅   |
| Git-backed storage             | ❌        | ❌      | ✅      | ❌      | ❌      | ❌       | ✅   |
| Audit role separation          | ❌        | ❌      | ❌      | ❌      | partial | ❌       | ✅   |
| Risk-driven human intervention | ❌        | ❌      | ❌      | ❌      | ❌      | ❌       | ✅   |
| Structured metadata schema     | ❌        | partial | ✅      | ❌      | ❌      | partial  | ✅   |
| Intent-driven retrieval        | ❌        | ❌      | partial | ✅      | ❌      | ✅ (AST) | ✅   |
| Learns from errors             | ✅        | ✅      | ❌      | ❌      | partial | ❌       | ✅   |

What each prior work lacks and GEAR addresses:

- **vs CLAUDE.md / AGENTS.md:** flat append-only files → GEAR adds audit layer + state machine + lifecycle management
- **vs Reflexion:** ephemeral session memory → GEAR adds git persistence + risk-driven human-in-the-loop
- **vs MPR:** structured memory + rule admissibility, but no audit separation, no git, no human oversight → GEAR adds PAC separation + Δ routing
- **vs Lore:** git-backed structured knowledge at commit level → GEAR operates at error attribution rule granularity with schema validation + dedicated audit role
- **vs Mem0:** vector retrieval with no audit layer → GEAR adds structured audit + risk-driven oversight + state machine
- **vs ARIA:** human review triggered reactively when the agent gets stuck → GEAR proactively routes review via Δ risk scoring, reducing unnecessary intervention
- **vs MemCoder:** learns from successful patterns (positive samples) → GEAR learns from errors (negative samples). The two directions complement each other.

## Implementation Status

The Aristotle reference implementation includes 11 MCP tools, 111 unit tests, and 63 static assertions (unit tests verify runtime behavior; static assertions cover schema invariants and state machine transitions). All nine conformance requirements are satisfied. CR9 (conflict declaration) is implemented at the schema level — the `conflicts_with` field is written and preserved — but automated conflict detection and Orchestrator surfacing are not yet triggered at runtime; conflict resolution currently requires manual invocation.

The implementation is in production use with Claude Code / OpenCode.

## Open Questions

Four design questions remain unresolved in GEAR 1.1:

**OP-1: Evolution target** — All GEAR agents are stateless protocol executors. Adjusting audit thresholds does not improve any agent's intrinsic capability; it only reduces human oversight. What should actually evolve? Candidates include the Δ threshold parameters themselves, the schema's error category taxonomy, or a meta-rule layer that sits above the current architecture — but none of these have been evaluated.

**OP-2: Parameter calibration** — The Δ decision factor uses empirically derived parameters (risk_weight values of 0.8/0.5/0.2, MAX_SAMPLES = 20, audit thresholds of 0.4/0.7). Their optimality has not been systematically validated. Attribution ambiguity makes controlled experiments difficult: when an error stops recurring, it is hard to isolate whether the rule prevented it or the task context simply changed. Domain-dependent optima are also a concern — per-domain tuning may be necessary.

**OP-3: Checker learning path** — C cannot learn from history because it does not read the rule library. True evolution for C would require a separate "audit lesson" rule category, which raises questions about rule taxonomy and C's scope boundary.

**OP-4: Cold start accumulation** — New rules enter with `sample_size = 0`, forcing Δ = 0 and mandatory human review by design. Rules targeting rare error categories may remain at low sample counts indefinitely, permanently requiring manual review regardless of their actual quality. This is structurally distinct from OP-2: OP-2 asks what the right thresholds are; OP-4 asks how rules reach those thresholds at all. Potential directions include decay-weighted sample counting, rule merging across similar error categories to pool sample sizes, or a provisional auto-audit tier for rules that have passed multiple manual reviews but have low sample counts. Each involves trade-offs between conservative oversight and operational usability that require community input.

I'm seeking community feedback:

What scenarios do you encounter where agents repeat errors? Are the conformance requirements reasonable? Which design decisions do you think are problematic?

## Call to Action

Join the discussion: https://github.com/alexwwang/aristotle/issues

Read the specification: https://doi.org/10.5281/zenodo.19660780

Try Aristotle with OpenCode / Claude Code and report your findings. I want to know what works, where it falls short in your workflow, and where the protocol needs rethinking.
