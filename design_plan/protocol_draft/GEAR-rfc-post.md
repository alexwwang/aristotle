Title: RFC: GEAR — A Protocol for AI Agent Error Learning

## Background

AI agents routinely repeat the same errors across sessions. Corrections applied in one session vanish in the next because memory is session-scoped, unstructured, or lacks quality control. This cross-session error repetition problem prevents agents from accumulating durable knowledge and forces users to repeatedly re-teach the same lessons.

## Core Idea

GEAR (Git-backed Error Analysis & Reflection) introduces three coordinated mechanisms: the Production-Audit-Consumption (PAC) model separates error reflection into decoupled phases with distinct role responsibilities; the Δ decision factor routes audit between automatic, semi-automatic, and mandatory human review based on confidence, risk, and empirical evidence; git-backed storage provides atomic reads, full version history, and verifiable rule provenance. Together, these enable agents to learn from errors in one session and prevent recurrence in subsequent sessions without requiring model fine-tuning.

The protocol defines five roles (Orchestrator, Resource Creator, Checker, Learner, Searcher), a five-state rule lifecycle, and a structured YAML frontmatter schema with intent-driven retrieval dimensions.

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

GEAR combines persistence, audit, and human oversight in a unified protocol. No single prior work provides all three.

- **vs CLAUDE.md / AGENTS.md:** flat append-only files → GEAR adds audit layer + state machine + lifecycle management
- **vs Reflexion:** ephemeral session memory → GEAR adds git persistence + risk-driven human-in-the-loop
- **vs MPR:** structured memory + rule admissibility, but no audit separation, no git, no human oversight → GEAR adds PAC separation + Δ routing
- **vs Lore:** git-backed structured knowledge at commit level → GEAR operates at error attribution rule granularity with schema validation + dedicated audit role
- **vs Mem0:** vector retrieval with no audit layer → GEAR adds structured audit + risk-driven oversight + state machine
- **vs ARIA:** human review triggered on-demand when agent gets stuck → GEAR proactively routes review via Δ risk scoring, reducing unnecessary intervention
- **vs MemCoder:** learns from successful patterns (positive samples) → GEAR learns from errors (negative samples). The two directions complement each other.

## Implementation Status

Aristotle reference implementation includes 11 MCP tools, 111 unit tests, and 63 static assertions. All nine conformance requirements are satisfied (CR9 partially — schema only, runtime conflict detection pending). The implementation is in production use with Claude Code / OpenCode.

## Open Questions

Four design questions remain unresolved in GEAR 1.1:

**OP-1: Evolution target** — All GEAR agents are stateless protocol executors. Adjusting audit thresholds does not improve any agent's capability; it only reduces human oversight. What should actually evolve?

**OP-2: Parameter calibration** — The Δ decision factor uses empirically derived parameters (risk_weight values of 0.8/0.5/0.2, MAX_SAMPLES = 20, audit thresholds of 0.4/0.7). Their optimality has not been systematically validated.

**OP-3: Checker learning path** — The Checker role cannot learn from history because it does not read the rule library. True evolution would require a separate audit lesson rule category.

**OP-4: Cold start accumulation** — New rules enter with sample_size = 0, forcing Δ = 0 and mandatory human review. Rare error categories may remain at low sample counts indefinitely, permanently requiring manual review.

I'm seeking community feedback:

What scenarios do you encounter where agents repeat errors? Are the conformance requirements reasonable? Which design decisions do you think are problematic?

## Call to Action

Join the discussion: https://github.com/alexwwang/aristotle/issues

Read the specification: https://doi.org/10.5281/zenodo.19660780

Try Aristotle with Claude Code and report your findings. I want to know what works, what breaks, and where the protocol falls short in real-world use.
