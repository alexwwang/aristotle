# GEAR: Git-backed Error Analysis & Reflection

**Version:** 1.1

GEAR is a protocol for AI agent error reflection, learning, and prevention. It defines how agents capture mistakes, structure them as rules, validate quality, and apply lessons to future tasks.

It solves the problem that corrections made in one session vanish in the next. By storing reflection rules in git with structured metadata, GEAR makes error learnings persistent, searchable, and verifiable across sessions.

---

## Scope and Non-Goals

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

## The Production-Audit-Consumption Model

GEAR separates learning into three decoupled phases. This separation MUST prevent feedback loops and ensure each phase operates independently.

**Production:** The Resource Creator (R) writes reflection rules with structured intent tags. These rules capture what went wrong and how to fix it. R doesn't decide whether rules are good enough — it just produces them.

**Audit:** The Checker (C) validates schemas, executes status transitions, and manages git commits. C is the gatekeeper that enforces quality before rules become available for consumption. C doesn't create or consume — it only validates.

**Consumption:** The Learner (L) reads verified rules, applies them pre-task, and provides feedback when errors still occur. L doesn't audit or produce — it learns and reports.

Why separate them? Production without audit accumulates noise. Consumption without audit risks applying unvetted corrections. The model ensures: R produces freely, C verifies rigorously, L consumes safely. Each role has one clear responsibility.

---

## Five Roles

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

**Triggers:**
- O delegates knowledge service requests from L

**Produces:**
- Filtered, ranked rule lists for L to consume

---

## Rule Lifecycle (State Machine)

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

Plus `needs_sync` as the anomaly state.

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

Anomaly state. Detected when a file exists on disk but `git show HEAD:file` fails — the file was not committed through the proper pipeline.

**Resolution:** O detects the signal, C performs a supplementary commit.

---

## Data Protocol: Frontmatter Schema

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
| `status` | enum | always | One of: `pending`, `staging`, `verified`, `rejected` |
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

## The Δ Decision Factor

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

## Core Workflow: Intent-Driven Self-Healing Loop

The GEAR protocol enables a continuous learning loop through six steps.

### Step 1: Task Starts

User initiates a task. L is triggered to pre-learn relevant rules.

### Step 2: L Generates Intent Tags

L analyzes current context and generates intent tags:
- `domain`: inferred from task description
- `task_goal`: derived from user's stated goal
- `failed_skill`: populated if a previous skill attempt failed

### Step 3: O Delegates to S

L sends intent tags to O via knowledge service. O delegates to S, which constructs a query filtering rules by the three retrieval dimensions. S executes the query, O filters results by relevance, and returns ranked rules to L.

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

## Open Problems

The following design questions remain unresolved in GEAR 1.1.
Implementations SHOULD NOT attempt to address these without community consensus.

### OP-1: Evolution Target

All GEAR agents are stateless protocol executors. Adjusting audit thresholds
does not improve any agent's capability; it only reduces human oversight.
What should actually evolve remains an open question.

### OP-2: Reliable Feedback Signal

The `success_rate`/`failure_rate`/`sample_size` fields introduced in v1.1
provide a foundation for rule quality measurement. However, whether this
signal is sufficient for automated evolution decisions requires empirical
validation. Open questions include: what sample_size threshold constitutes
reliable signal, how to handle conflicting feedback across contexts, and
whether success_rate alone captures rule quality or if qualitative feedback
is also needed.

### OP-3: Checker Learning Path

C cannot learn from history because it does not read the rule library.
True evolution for C would require a separate "audit lesson" rule category,
which raises questions about the rule taxonomy and C's scope.

---

## Protocol Operations

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

## Conformance

A system claiming GEAR conformance MUST satisfy the following requirements:

1. **Role separation.** Production (R), audit (C), and consumption (L) MUST be handled by distinct agents or processes. No single agent MUST perform two roles simultaneously on the same rule.

2. **Git-backed storage.** All verified rules MUST be committed to a git repository. Consumers MUST read via `git show HEAD:` or equivalent atomic-read mechanism. Uncommitted files on disk MUST NOT be visible to L.

3. **State machine enforcement.** Rules MUST transition only through the defined states: `pending` → `staging` → `verified` or `rejected`. Implementations MUST NOT skip states (e.g. `pending` → `verified`).

4. **Frontmatter schema.** Every rule file MUST include YAML frontmatter with at minimum: `id`, `status`, `scope`, `category`, `confidence`, `risk_level`, `intent_tags`, `created_at`.

5. **Intent-driven retrieval.** The system MUST support querying rules by at least `intent_tags.domain` and `intent_tags.task_goal`, in addition to `status` and `category`.

6. **Rejected rule preservation.** Rejected rules MUST retain their original metadata (scope, project identifier, category). They MUST be restorable to `pending` state without data loss.

7. **Atomic writes.** Rule files MUST be written atomically (write to temp file, then rename). Partial writes MUST NOT be visible to other agents.

8. **Feedback signal tracking.** Implementations MUST support tracking rule application outcomes via `success_rate`, `failure_rate`, and `sample_size` fields. These fields MUST be initially null/zero and MUST be updated when the Learner reports application results.

9. **Conflict declaration.** Implementations SHOULD support the `conflicts_with` field to declare known contradictions between rules. When conflicts are detected, implementations MUST surface both rules to the Orchestrator for resolution.

---

## Version History

| Version | Date | Milestone |
|---------|------|-----------|
| 1.1 | 2026-04-19 | Feedback signal fields (`success_rate`, `failure_rate`, `sample_size`), conflict declaration (`conflicts_with`), Δ log-normalization, RFC 2119 language, Scope/Non-Goals, Open Problems. |
| 1.0-draft | 2026-04-16 | Initial protocol specification: five roles, state machine, frontmatter schema, Δ decision factor, conformance requirements. First implementation: Aristotle (P1 + P2). |
