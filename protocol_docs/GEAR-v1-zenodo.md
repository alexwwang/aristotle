# GEAR: Git-backed Error Analysis & Reflection

**A Protocol Specification for AI Agent Error Learning**
**Version:** 1.1

---

## Abstract

AI agents routinely repeat the same errors across sessions. Corrections applied in
one session vanish in the next because memory is session-scoped, unstructured, or
lacks quality control. This cross-session error repetition problem prevents agents
from accumulating durable knowledge and forces users to repeatedly re-teach the
same lessons.

GEAR (Git-backed Error Analysis & Reflection) is a protocol specification that
addresses this problem through three coordinated mechanisms: the
Production-Audit-Consumption (PAC) model, which separates error reflection into
decoupled phases with distinct role responsibilities; the Δ decision factor, a
per-rule quality score that routes audit between automatic, semi-automatic, and
mandatory human review based on confidence, risk, and empirical evidence; and
git-backed storage, which provides atomic reads, full version history, and
verifiable rule provenance. Together, these mechanisms enable agents to learn from
errors in one session and prevent recurrence in subsequent sessions without
requiring model fine-tuning.

GEAR defines five roles (Orchestrator, Resource Creator, Checker, Learner,
Searcher), a five-state rule lifecycle, a structured YAML frontmatter schema with
intent-driven retrieval dimensions, and nine conformance requirements. The protocol
is implementation-agnostic and does not specify agent runtime behavior or LLM
invocation protocols. A reference implementation, Aristotle, demonstrates the
protocol in a Claude Code environment.

---

## 1. Introduction

GEAR is a protocol for AI agent error reflection, learning, and prevention across sessions. It defines how agents capture mistakes, structure them as rules with metadata, validate quality through an audit process, and apply validated lessons to future tasks.

The protocol introduces three core mechanisms: the Production-Audit-Consumption (PAC) model that separates learning into decoupled phases, the Δ decision factor that routes audit based on rule confidence and risk, and git-backed storage that makes reflection rules persistent and verifiable. Together, these enable agents to learn from errors in one session and prevent recurrence in subsequent sessions without requiring model fine-tuning.

GEAR targets engineers and system designers building agent learning systems. It does not specify agent runtime behavior or LLM invocation protocols. This document provides the complete protocol specification including roles, state machine, data schema, conformance requirements, and implementation guidance.

---

## 2. Motivation

AI agents routinely make the same errors across sessions. A correction applied in session A vanishes in session B because memory is session-scoped or unstructured. This cross-session error repetition problem prevents agents from accumulating durable knowledge and forces users to repeatedly guide the system through the same mistakes.

Existing solutions each address part of the problem but fail to combine persistence, audit, and human oversight. CLAUDE.md and AGENTS.md are flat append-only files with no lifecycle management, audit layer, or quality gates. Reflexion introduces reflection as a paradigm but stores episodic memory in session-scoped buffers that disappear when the session ends. Mem0 and similar vector retrieval systems enable semantic search but lack an audit layer and human-in-the-loop quality control. No existing solution provides cross-session persistence with structured audit and risk-driven human intervention.

GEAR fills this gap by introducing the Production-Audit-Consumption separation. Rules flow through a state machine from creation through verification before becoming available for consumption. Git-backed storage guarantees atomic reads and full version history. The Δ decision factor automatically routes low-risk, well-tested rules to auto-commit while requiring human review for high-risk or untested rules. This combination of persistence, audit, and adaptive oversight enables agents to learn durably from errors without sacrificing quality.

---

## 3. Related Work

Research on AI agent memory and learning has explored multiple approaches, but none combine the key mechanisms that GEAR provides: git-backed persistence, audit role separation, and risk-driven human intervention. The closest approaches fall into three research threads: reflection-based learning, git as memory infrastructure, and human-in-the-loop systems.

The reflection foundational paradigm emerged with Reflexion, where agents generate verbal reinforcement from task failures and use it to self-correct in future trials. Meta-Policy Reflexion (MPR) extends this by introducing structured memory with rule admissibility criteria. MPR is conceptually closest to GEAR—both store reflection rules with metadata and apply them to prevent recurrence—but MPR lacks audit role separation, does not persist rules to git, and provides no mechanism for risk-driven human oversight. MPR's rules live in ephemeral storage and lack the multi-stage verification pipeline that GEAR's PAC model enforces.

Git has emerged as infrastructure for agent memory in two complementary works. Git-Context-Controller (GCC) uses git to manage context windows and retrieval but focuses on context management rather than error learning. Lore treats git as a long-term memory store where agents record decision records at the commit level. Lore is the closest git-based approach to GEAR, but it stores high-level decisions rather than attribution rules for specific error categories. GEAR builds on git infrastructure like Lore and GCC but specializes in error attribution rules with schema validation and a dedicated audit role.

Human-in-the-loop learning has been explored in ARIA, which triggers human review on-demand when the agent encounters uncertainty or gaps. ARIA's approach is reactive—the agent requests help only when stuck. GEAR's approach is proactive via the Δ decision factor: the system continuously evaluates rule quality based on confidence, risk, and application history, requiring human review only for rules that fail quality thresholds. Both approaches integrate humans, but GEAR's risk-based routing is more systematic and reduces unnecessary intervention.

Memory for code agents and multi-level reflection present two additional threads. MemCoder learns from successful code patterns rather than errors, demonstrating that positive samples can also drive learning. SAMULE introduces multi-level reflection with fine-tuned models for different reflection depths. SAMULE requires model fine-tuning and lacks audit structure, while GEAR operates with off-the-shelf models through protocol-level design. MemCoder's success-based learning complements GEAR's error-based approach—errors provide sparse but high-signal corrections, while successes provide abundant but noisier patterns.

GEAR's contribution is the combination, not any single mechanism. Git-backed storage, audit role separation, intent-driven retrieval, and risk-based human intervention each exist in prior work, but they have not been integrated into a unified protocol for cross-session error learning. GEAR synthesizes these mechanisms into a cohesive system where each component addresses a specific failure mode in existing approaches.

| Dimension | Reflexion | MPR | GCC | Lore | ARIA | MemCoder | SAMULE | GEAR |
|---|---|---|---|---|---|---|---|---|
| Cross-session persistence | ❌ | partial | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Git-backed storage | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Audit role separation | ❌ | ❌ | ❌ | ❌ | partial | ❌ | ❌ | ✅ |
| Risk-driven human intervention | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Structured metadata schema | ❌ | partial | partial | ✅ | ❌ | partial | ❌ | ✅ |
| Intent-driven retrieval | ❌ | ❌ | ❌ | partial | ❌ | ✅ (AST) | ❌ | ✅ |
| Requires model fine-tuning | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Learns from | errors | errors | context | decisions | gaps | successes | errors | errors |

---

## 4. Scope and Non-Goals

### In Scope

- Structured error reflection with lifecycle management
- Git-backed persistent rule storage with atomic reads
- Intent-driven rule retrieval via metadata filtering
- Confidence-based audit routing (Δ decision factor)
- Feedback signal tracking through rule application outcomes

### Explicitly Out of Scope

- **Agent runtime implementation** — GEAR does not specify how agents execute tasks, call tools, or manage their context windows.
- **LLM invocation protocols** — How R generates rule content or how L applies it is implementation-defined.
- **Vector-based semantic retrieval** — GEAR specifies metadata filtering only. Implementations MAY add vector search as a complementary layer.
- **Multi-agent coordination** — GEAR assumes a single orchestration context. Distributed agent networks are out of scope.
- **Rule content format beyond frontmatter** — The Markdown body structure (Context, Rule, Example sections) is an Aristotle convention, not a GEAR conformance requirement.

---

## 5. The Production-Audit-Consumption Model

GEAR separates learning into three decoupled phases. This separation MUST prevent feedback loops and ensure each phase operates independently.

**Production:** The Resource Creator (R) writes reflection rules with structured intent tags. These rules capture what went wrong and how to fix it. R doesn't decide whether rules are good enough — it just produces them.

**Audit:** The Checker (C) validates schemas, executes status transitions, and manages git commits. C is the gatekeeper that enforces quality before rules become available for consumption. C doesn't create or consume — it only validates.

**Consumption:** The Learner (L) reads verified rules, applies them pre-task, and provides feedback when errors still occur. L doesn't audit or produce — it learns and reports.

Why separate them? Production without audit accumulates noise. Consumption without audit risks applying unvetted corrections. The model ensures: R produces freely, C verifies rigorously, L consumes safely. Each role has one clear responsibility.

---

## 6. Five Roles

GEAR defines five roles that MUST coordinate through git operations and a query interface.

| Role | Responsibility |
|------|---------------|
| **O** (Orchestrator) | Routes scenes, decides audit level, provides knowledge service |
| **R** (Resource Creator) | Writes reflection rules with intent tags |
| **C** (Checker) | Validates schema, executes status transitions, git commit |
| **L** (Learner) | Pre-task learning, error feedback |
| **S** (Searcher) | Converts intent to query conditions, returns results |

### Interaction Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │                    O (Orchestrator)                  │
                    │  Routes scenes · Decides audit level · Knowledge svc │
                    └───┬──────────┬──────────┬──────────┬───────────────┘
                        │          │          │          │
            reflect     │  confirm │  learn   │  error   │  search
            scene       │  request │  request │ feedback │  delegation
                        ▼          ▼          │          ▼
                 ┌──────────┐ ┌──────────┐   │    ┌──────────┐
                 │ R        │ │ C        │   │    │ S        │
                 │ Resource │ │ Checker  │   │    │ Searcher │
                 │ Creator  │ │          │   │    │          │
                 └────┬─────┘ └────┬─────┘   │    └────┬─────┘
                      │            │          │         │
                      │ pending    │ verified │         │ metadata
                      │ rules      │ status   │         │ + scored
                      ▼            ▼          │         │ results
                 ┌────────────────────────┐   │         │
                 │    Git Rule Store      │   │         │
                 │  (frontmatter + body)  │◄──┘         │
                 └────────────┬───────────┘             │
                               │                         │
                     verified  │  ◄───── Round 1 ────────┘
                     rules     │        list_rules (metadata only)
                               │         ┌─────────────────┐
                               │         │ Scoring Subagents│
                               │         │ (Round 2: read   │
                               │         │  full content,   │
                               │         │  score 1-10)     │
                               │         └────────┬────────┘
                               │                  │
                               ▼                  ▼
                         ┌──────────┐     Top-N scored rules
                         │ L        │     (compressed summaries)
                         │ Learner  │
                         │          │
                         └────┬─────┘
                              │
                     error    │  "applied rules, still failed"
                     feedback │
                              └──────────► O (triggers new R → C cycle)
```

**Key flows:**

| Flow | Path | Description |
|------|------|-------------|
| **Reflect** | O → R → C → Git | Error detected → R produces rule → C validates → Git commit |
| **Learn** | L → O → S → Git → L | L requests lessons → O delegates S → two-round scoring → compressed summaries to L |
| **Error feedback** | L → O → R → C | L applied rules but still erred → O triggers new reflection cycle |
| **Review** | O → C | User reviews DRAFT → C validates schema + content → commit or reject |

### O — Orchestrator

**Core capabilities:**
- Route scenes to appropriate agents based on error context
- Decide audit level (Apprentice / Peer / Expert) based on confidence and risk
- Provide knowledge service by delegating to S for rule retrieval

**Triggers:**
- User invocation (e.g. skill command, explicit request)
- Unexpected events invoked from agent (e.g. error reports from L)

**Produces:**
- Audit level decisions
- Routed agent sessions (R, C, or combined R → C)
- Filtered rule search results from S

### R — Resource Creator

**Core capabilities:**
- Write reflection rules with structured frontmatter
- Tag rules with intent tags for precise retrieval
- Capture error context and corrective actions

**Triggers:**
- O routes scenes requiring new rules
- Post-mortem sessions after persistent errors

**Produces:**
- Rule files in `pending` state
- Frontmatter with `intent_tags`, `error_summary`, `failed_skill`

### C — Checker

**Core capabilities:**
- Validate frontmatter schema compliance
- Execute status transitions (`pending` → `staging` → `verified`)
- Create git commits with structured messages
- Reject malformed or incorrect rules. C MUST reject any rule that fails schema validation.

**Triggers:**
- O completes audit-level decision
- R produces a rule ready for validation

**Produces:**
- Git commits
- Status transition records
- Rejection messages with reasons

### L — Learner

**Core capabilities:**
- Generate intent tags pre-task based on current context
- Retrieve relevant rules via O → S delegation
- Apply rules during task execution
- Report errors when rules fail to prevent recurrence. L MUST send an error report to O when a previously applied rule did not prevent the error.

**Triggers:**
- Task initiation
- Task failure despite applying learned rules

**Produces:**
- Intent tag queries for pre-task learning
- Error reports to O for new reflection cycles

### S — Searcher

**Core capabilities:**
- Convert intent descriptions into structured query conditions
- Execute queries with dimension filters against the rule store
- Rank results by relevance across retrieval dimensions
- Execute a two-round retrieval process: Round 1 returns metadata-only candidates
  via `list_rules` to minimize context overhead; Round 2 spawns parallel scoring
  subagents that each read one rule's full content and score relevance (1-10). This
  separation avoids loading hundreds of full rule bodies into the orchestrator's
  context window.

**Triggers:**
- O delegates knowledge service requests from L

**Produces:**
- Filtered, ranked rule lists for L to consume

---

## 7. Rule Lifecycle (State Machine)

A rule MUST transition through exactly five states. Status is stored in each file's YAML frontmatter `status` field.

```
  produce            stage              verify
     │                 │                  │
     ▼                 ▼                  ▼
┌──────────┐     ┌──────────┐     ┌──────────┐
│ pending  │ ──► │ staging  │ ──► │ verified │
└──────────┘     └────┬─────┘     └──────────┘
                      │
                      │ reject
                      ▼
                ┌──────────┐
                │ rejected │ ──► restore ──► pending
                └──────────┘
```

*Normal lifecycle flow. The anomaly state `needs_sync` (§7.5) is triggered when a file exists on disk but was not committed through the proper pipeline.*

### pending

Rule has been created by R but not yet reviewed. File exists on disk but MUST NOT be committed to git in this state.

**Who can see:** R (creator), C (for validation), O.
**Transitions:** `stage` → staging, or `reject` → rejected.

### staging

Rule is locked for review by C. Status field updated to `staging`.

**Who can see:** C (auditor), O.
**Transitions:** `verify` → verified, or `reject` → rejected.

### verified

Rule has passed audit and is committed to git. This is the terminal state — the only state L MAY read.

**Who can see:** All roles. L reads via `git show HEAD:` to guarantee atomic reads of committed content.
**Transitions:** None (terminal).

### rejected

Rule failed audit. MUST be moved to a `rejected/` directory mirroring the original structure. Original metadata MUST be preserved.

**Who can see:** All roles.
**Transitions:** `restore` → pending.

### needs_sync

Anomaly state. Detected when a file exists on disk but `git show HEAD:file` fails — the file was not committed through the proper pipeline. Common triggers include: C crashing after writing a file but before committing, or manual edits to the rule store bypassing the protocol.

**Resolution:** O detects the signal, C performs a supplementary commit.

---

## 8. Data Protocol: Frontmatter Schema

Every rule file MUST contain YAML frontmatter with structured metadata. This schema drives intent-driven retrieval and rule validation.

```yaml
---
id: "rec_1713283200"
# Unique rule identifier

status: "verified"
# Lifecycle state: pending → staging → verified | rejected

scope: "user"
# "user" for global rules, "project" for project-specific rules
project_hash: "a1b2c3d4"
# Opaque identifier for the project — only set when scope is "project"

category: "HALLUCINATION"
# Error category. Implementations define their own taxonomy.
# Example taxonomy: MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT,
# PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS,
# WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR

confidence: 0.85
# Confidence score (0–1), set by R during creation

risk_level: "high"
# Derived from category. Three levels: high, medium, low

# --- Retrieval Dimensions ---

intent_tags:
  domain: "database_operations"
  # Technical domain: what area of work the error belongs to
  task_goal: "connection_pool_management"
  # Task objective: what the user was trying to accomplish

failed_skill: "prisma_client"
# Tool, skill, or component involved in the error (or null)

error_summary: "P2024 connection pool timeout in serverless"
# Concise description of the error scene (≤200 characters)

# --- Provenance ---

source_session: "ses_abc123"
message_range: "msg_45-msg_52"
# Session and message range where the error was observed

created_at: "2026-04-16T10:30:00+08:00"
verified_at: "2026-04-16T10:35:00+08:00"
verified_by: "auto"
# Verification metadata: when and who/what approved

rejected_at: null
rejected_reason: null
# Rejection metadata — only set when status is "rejected"

# --- Feedback Signal ---

success_rate: null        # float 0-1, ratio of successful applications by L
failure_rate: null        # float 0-1, ratio of failed applications by L
sample_size: 0            # int, total number of times L applied this rule

# --- Rule Relations ---

conflicts_with: null      # list[string], IDs of rules that contradict this rule
---
```

### Required Fields

Implementations MUST support these frontmatter fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | always | Unique identifier |
| `status` | enum | always | One of: `pending`, `staging`, `verified`, `rejected`, `needs_sync (anomaly state)` |
| `scope` | enum | always | One of: `user`, `project` |
| `category` | string | always | Error category from the implementation's taxonomy |
| `confidence` | float | always | Confidence score 0–1 |
| `risk_level` | enum | always | One of: `high`, `medium`, `low` |
| `intent_tags` | dict | on creation | Nested `domain` and `task_goal` for retrieval |
| `error_summary` | string | on creation | Concise error description (≤200 chars) |
| `failed_skill` | string | optional | Tool/skill involved in the error |
| `created_at` | ISO 8601 | always | Creation timestamp |
| `verified_at` | ISO 8601 | on verify | Verification timestamp |
| `verified_by` | string | on verify | Who/what approved the rule |
| `rejected_at` | ISO 8601 | on reject | Rejection timestamp |
| `rejected_reason` | string | on reject | Reason for rejection |
| `success_rate` | float | on feedback | Ratio of successful applications (0–1). Set by C after L reports outcome. |
| `failure_rate` | float | on feedback | Ratio of failed applications (0–1). `failure_rate = 1 - success_rate` by convention. |
| `sample_size` | int | on feedback | Total number of times L applied this rule. `sample_size = 0` means untested. |
| `conflicts_with` | list | optional | Rule IDs that contradict this rule. Implementations SHOULD declare known conflicts. |

### Three Retrieval Dimensions

The `intent_tags`, `failed_skill`, and `error_summary` fields enable multi-dimension rule retrieval:

1. **Intent Domain** (`intent_tags.domain`): Broad technical area. When L identifies "I'm working on database operations," O queries for rules matching that domain.

2. **Task Goal** (`intent_tags.task_goal`): Specific objective. "I need to manage connection pools" narrows results within a domain. Combined with domain, this provides precise targeting.

3. **Failed Skill** (`failed_skill`) + **Error Summary** (`error_summary`): Cross-references tools that missed an error, and provides concise error descriptions for quick scanning.

These dimensions work together. Domain provides broad relevance. Task goal targets specific problems. Failed skill identifies gaps in existing knowledge. Queries MAY combine any subset for AND matching.

---

## 9. The Δ Decision Factor

GEAR's audit routing uses a per-rule quality score to determine how much human oversight is required.

```
Δ_raw = confidence × (1 − risk_weight)
Δ = Δ_raw × normalize(log(sample_size + 1))

where normalize(x) = x / log(MAX_SAMPLES + 1)
      MAX_SAMPLES = 20 (default)
```

Confidence ranges from 0 to 1. Risk weight is determined by rule category. The log normalization factor scales Δ by evidence strength — rules with more application data receive higher trust.

### Sample Size Effect

| sample_size | log(N+1) | normalize | Effect |
|-------------|----------|-----------|--------|
| 0 | 0 | 0.00 | New rule, Δ = 0, always manual |
| 1 | 0.69 | 0.23 | ~77% discount |
| 3 | 1.39 | 0.46 | ~54% discount |
| 5 | 1.79 | 0.59 | ~41% discount |
| 10 | 2.40 | 0.79 | ~21% discount |
| 20 | 3.04 | 1.00 | No discount |

### Risk Weight Table

| Risk Level | Weight | Description |
|-----------|--------|-------------|
| high | 0.8 | Critical errors: hallucinations, misunderstood requirements |
| medium | 0.5 | Moderate errors: wrong tool choice, incomplete analysis |
| low | 0.2 | Minor errors: pattern violations, oversimplification |

Higher risk weight means lower Δ, requiring more scrutiny before promotion.

### Audit Level Table

| Δ Value | Audit Level | Behavior |
|---------|-------------|----------|
| Δ > 0.7 | auto | Auto-commit, no human confirmation needed |
| 0.4 < Δ ≤ 0.7 | semi | Show diff, wait for user confirmation |
| Δ ≤ 0.4 | manual | Mandatory human review |

> When `sample_size = 0`, the normalization factor is 0, forcing Δ = 0 regardless of confidence or risk level. This ensures new rules always require at least one human review cycle.

---

## 10. Core Workflow: Intent-Driven Self-Healing Loop

The GEAR protocol enables a continuous learning loop through six steps.

### Step 1: Task Starts

User initiates a task. L is triggered to pre-learn relevant rules.

### Step 2: L Generates Intent Tags

L analyzes current context and generates intent tags:
- `domain`: inferred from task description
- `task_goal`: derived from user's stated goal
- `failed_skill`: populated if a previous skill attempt failed

### Step 3: O Delegates to S, Filters, and Injects

L sends intent tags to O via knowledge service. O delegates to S, which executes
a two-round retrieval: Round 1 returns metadata-only candidates via `list_rules`
to minimize context overhead; Round 2 spawns parallel scoring subagents that each
read one rule's full content and score relevance (1–10). S returns all scored
results to O. O selects the Top-N rules, compresses them into summaries, and
injects the result into L's context. O is the sole actor responsible for context
injection — S scores, O decides and delivers.

### Step 4: L Learns and Executes

L reads returned rules, applies lessons to current task, and executes.

### Step 5: Error Reporting

If L still encounters errors, it MUST send an error report to O containing:
- What rule(s) were applied
- What error occurred
- Context where rules failed

### Step 6: O Triggers New Reflection Cycle

O MUST analyze the error report, route the scene to R for new rule creation, then to C for validation. The new rule enters pending state, completes audit, and becomes available for future L queries.

The loop closes. Each failure creates new knowledge. Each session benefits from all previous sessions.

---

## 11. Protocol Operations

GEAR defines eight abstract operations mapped to roles and lifecycle transitions.

| Operation | Role | Description |
|-----------|------|-------------|
| `init` | O | Initialize storage: create directory structure, git repo, migrate existing data |
| `produce` | R | Create new rule file with frontmatter in `pending` state |
| `search` | S | Query rules with multi-dimension filters (status, category, intent tags, error fields) |
| `stage` | C | Transition rule from `pending` to `staging` |
| `verify` | C | Transition rule from `staging` to `verified`, commit to git |
| `reject` | C | Move rule to rejected store, record reason, commit |
| `restore` | C | Restore rejected rule to active store with new status |
| `list` | O / L | Lightweight metadata listing (no rule bodies loaded) |

O MUST coordinate the sequencing of all protocol operations. R and C MUST NOT invoke operations directly — O is the sole coordinator.

---

## 12. Reference Implementation

Aristotle is the reference implementation of GEAR, deployed as a skill for the Claude Code / OpenCode agent environment. It implements all nine conformance requirements through 11 MCP (Model Context Protocol) tools: `init_repo`, `write_rule`, `read_rules`, `stage_rule`, `commit_rule`, `reject_rule`, `restore_rule`, `list_rules`, `check_sync_status`, `sync_rules`, and `get_audit_decision`. The implementation uses a progressive disclosure architecture where only the router (84 lines) loads on trigger; reflect (106 lines), review (156 lines), and learn phases load on demand. The test suite includes 111 MCP unit tests and 63 static assertions covering all five roles, the state machine, and the Δ decision engine. All nine conformance requirements are satisfied. Conformance requirement 9 (conflict declaration) is implemented at the schema level — the `conflicts_with` field is written and preserved — but automated conflict detection and Orchestrator surfacing are not yet triggered at runtime; conflict resolution currently requires manual invocation. This is a known partial implementation and is tracked as a future milestone.

Source code: https://github.com/alexwwang/aristotle

---

## 13. Conformance

A system claiming GEAR conformance MUST satisfy the following requirements:

1. **Role separation.** Production (R), audit (C), and consumption (L) MUST be handled by distinct agents or processes. A single agent MUST NOT simultaneously act as both producer (R) and auditor (C) for the same rule.

2. **Git-backed storage.** All verified rules MUST be committed to a git repository. Consumers MUST read via `git show HEAD:` or equivalent atomic-read mechanism. Uncommitted files on disk MUST NOT be visible to L.

3. **State machine enforcement.** Rules MUST transition only through defined states: `pending` → `staging` → `verified` or `rejected`. Implementations MUST NOT skip states (e.g. `pending` → `verified`).

4. **Frontmatter schema.** Every rule file MUST include YAML frontmatter with at minimum: `id`, `status`, `scope`, `category`, `confidence`, `risk_level`, `intent_tags`, `created_at`.

5. **Intent-driven retrieval.** The system MUST support querying rules by at least `intent_tags.domain` and `intent_tags.task_goal`, in addition to `status` and `category`.

6. **Rejected rule preservation.** Rejected rules MUST retain their original metadata (scope, project identifier, category). They MUST be restorable to `pending` state without data loss.

7. **Atomic writes.** Rule files MUST be written atomically (write to temp file, then rename). Partial writes MUST NOT be visible to other agents.

8. **Feedback signal tracking.** Implementations MUST support tracking rule application outcomes via `success_rate`, `failure_rate`, and `sample_size` fields. These fields MUST be initially null/zero and MUST be updated when Learner reports application results.

9. **Conflict declaration.** Implementations SHOULD support of `conflicts_with` field to declare known contradictions between rules. When conflicts are detected, implementations MUST surface both rules to Orchestrator for resolution.

---

## 14. Open Problems

The following design questions remain unresolved in GEAR 1.1.
Implementations SHOULD NOT attempt to address these without community consensus.

### OP-1: Evolution Target

All GEAR agents are stateless protocol executors. Adjusting audit thresholds
does not improve any agent's capability; it only reduces human oversight.
What should actually evolve remains an open question.

### OP-2: Parameter Calibration and Reliable Feedback Signal

The Δ decision factor uses several parameters (`risk_weight` values of 0.8/0.5/0.2,
`MAX_SAMPLES = 20`, audit thresholds of 0.4/0.7) that are empirically derived from
the Aristotle implementation. Their optimality has not been systematically validated.

Calibrating these parameters requires measuring error reduction rates across
different task domains after rules are applied. However, this faces several
difficulties:

1. **Attribution ambiguity** — When an error does not recur after applying a rule,
   it is difficult to determine whether the rule prevented the error or the task
   context simply changed. Constructing controlled experiments with equivalent
   control groups is non-trivial in real agent workflows.

2. **Domain-dependent optima** — Different task domains (code generation, data
   analysis, document writing) may exhibit different error distributions and risk
   patterns. A single set of parameters may not be globally optimal; per-domain
   tuning may be necessary.

3. **Feedback signal reliability** — The `success_rate`/`failure_rate`/`sample_size`
   fields introduced in v1.1 provide a foundation for measurement, but whether
   these metrics alone capture rule quality, or whether qualitative feedback is
   also needed, remains an open question.

4. **Cold start problem** — See OP-4.

These questions are left for community discussion and empirical investigation.

### OP-3: Checker Learning Path

C cannot learn from history because it does not read the rule library.
True evolution for C would require a separate "audit lesson" rule category,
which raises questions about the rule taxonomy and C's scope.

### OP-4: Cold Start Accumulation Rate

New rules enter with `sample_size = 0`, forcing `Δ = 0` and mandatory human
review by design. However, the rate at which a rule accumulates sufficient
`sample_size` to exit the cold start regime depends entirely on usage frequency:
a rule scoped to a rare error category may remain at `sample_size < 3` indefinitely,
permanently requiring manual review regardless of its actual quality.

This is structurally distinct from parameter calibration (OP-2): OP-2 asks what
the right thresholds are; OP-4 asks how rules reach those thresholds at all.
Potential directions include: decay-weighted sample counting (recent applications
count more), rule merging across similar error categories to pool sample sizes, or
a separate "provisional auto" audit tier for rules that have passed multiple manual
reviews but have low sample counts. These approaches involve trade-offs between
conservative oversight and operational usability that require community input.

---

## 15. References

1. Shinn, N., Cassano, F., Gopinath, A., Narasimhan, K., and Yao, S. "Reflexion:
   Language Agents with Verbal Reinforcement Learning." In *Advances in Neural
   Information Processing Systems 36 (NeurIPS 2023)*. arXiv:2303.11366.

2. Wu, C. and Qu, Z. "Meta-Policy Reflexion: Reusable Reflective Memory and Rule
   Admissibility for Resource-Efficient LLM Agent." arXiv:2509.03990, 2025.

3. Wu, J. "Git Context Controller: Manage the Context of LLM-based Agents like
   Git." arXiv:2508.00031, 2025.

4. Stetsenko, I. "Lore: Repurposing Git Commit Messages as a Structured Knowledge
   Protocol for AI Coding Agents." arXiv:2603.15566, 2026.

5. He, Y., Li, R., Chen, A., Liu, Y., Chen, Y., Sui, Y., Chen, C., Zhu, Y., Luo, L.,
   Yang, F., and Hooi, B. "Enabling Self-Improving Agents to Learn at Test Time With
   Human-In-The-Loop Guidance." arXiv:2507.17131, 2025.

6. Deng, Y., Liu, X., Zhang, Y., Yang, G., and Yang, S. "Your Code Agent Can Grow
   Alongside You with Structured Memory." arXiv:2603.13258, 2026.

7. Ge, Y., Romeo, S., Cai, J., Sunkara, M., and Zhang, Y. "SAMULE: Self-Learning
   Agents Enhanced by Multi-level Reflection." In *Proceedings of EMNLP 2025*,
   pp. 16591–16610. DOI:10.18653/v1/2025.emnlp-main.839.

8. Bradner, S. "Key words for use in RFCs to Indicate Requirement Levels."
   RFC 2119, BCP 14. 1997.

9. Git — Fast Version Control System. https://git-scm.com/

10. YAML Ain't Markup Language (YAML™) Version 1.2. https://yaml.org/spec/1.2/

---

## 16. Version History

| Version | Date | Milestone |
|---------|------|-----------|
| 1.1 | 2026-04-19 | Feedback signal fields (`success_rate`, `failure_rate`, `sample_size`), conflict declaration (`conflicts_with`), Δ log-normalization, RFC 2119 language, Scope/Non-Goals, Open Problems. |
| 1.0-draft | 2026-04-16 | Initial protocol specification: five roles, state machine, frontmatter schema, Δ decision factor, conformance requirements. First implementation: Aristotle (P1 + P2). |
