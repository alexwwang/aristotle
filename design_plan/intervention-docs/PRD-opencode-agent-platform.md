# Product Requirements Document
# OpenCode Agent Platform: Aristotle + TDD Watchdog

**Version**: 0.1.0-draft  
**Status**: Draft  
**Last Updated**: 2026-05-03

---

## 1. Background & Problem Statement

### 1.1 The Core Problem

AI-assisted software development today has two persistent failure modes:

**Failure Mode 1 — Unreliable execution**: The LLM drifts from a defined process mid-session. It skips steps, takes shortcuts under pressure, or "forgets" protocol rules after context compaction. The user cannot tell whether the process was actually followed or merely claimed to be followed.

**Failure Mode 2 — Non-learning errors**: The LLM repeats the same category of mistakes across sessions. Without a structured mechanism to capture, analyze, and inject lessons from past errors, every new session starts from zero institutional memory.

These two failure modes compound: an unreliable process produces unreliable outcomes, and without error learning, the same unreliable patterns recur indefinitely.

### 1.2 Existing Partial Solutions

**Aristotle** (existing project) addresses Failure Mode 2. It runs a post-session error reflection workflow, performs 5-Why root-cause analysis, and writes structured learning rules that persist across sessions via a Git-backed MCP server.

**tdd-pipeline** (existing project) addresses process definition — it specifies a rigorous 5-phase TDD workflow with a mandatory Ralph loop review mechanism. But it has no enforcement layer: compliance is entirely prompt-based and cannot be verified.

### 1.3 The Gap

Neither project addresses the intersection: **real-time, verifiable process enforcement that feeds into persistent learning**. The user has no guarantee the defined process was executed, and the learning system has no structured signal about *what kind* of process violations occurred.

### 1.4 Vision

A unified platform where:
- AI-assisted development follows a defined, verifiable process
- Process violations are caught and corrected in real time
- Errors and violations are systematically learned from across sessions
- The system improves over time without requiring the user to manually intervene

The user's role is to define goals and approve outputs — not to police the AI's behavior or re-teach it lessons it should have already learned.

---

## 2. Users & Use Cases

### 2.1 Target User Profile

**Primary user**: A developer who uses an AI coding agent (OpenCode) for substantive software development tasks — not one-off scripts, but multi-session projects with real architecture, tests, and business logic.

**Key characteristics**:
- Wants AI to handle implementation details while the user retains strategic control
- Has experienced LLM drift (agent abandons process mid-task) or repeated errors
- Values verifiability: wants to know *that* the process was followed, not just that the agent claims it was
- Does not want to babysit the agent or re-explain rules every session

**The user's aspiration**: Treat the AI agent the way a senior engineer treats a capable but imperfect junior — delegate confidently, get reliable results, and see the junior improve over time.

### 2.2 User Stories

#### Process Reliability

**US-01**: As a developer, I want the agent to be blocked from writing business code before failing tests exist, so that TDD discipline is enforced even when the agent is tempted to skip ahead.

**US-02**: As a developer, I want to be alerted when the agent attempts to advance to the next phase without passing the Ralph loop gate, so that I can intervene before a low-quality phase is approved.

**US-03**: As a developer, I want the Ralph loop to run the required number of rounds with genuine independent review, so that I can trust the quality gate actually functioned.

**US-04**: As a developer, I want a verifiable audit trail of what the agent did (which phases it entered, how many Ralph loop rounds ran, what issues were found), so that I can review the process after the fact.

**US-05**: As a developer, I want the agent to escalate to me when it is genuinely stuck (Ralph loop hitting max rounds with persistent issues), rather than silently failing or pretending to pass.

#### Error Learning

**US-06**: As a developer, I want the agent to reflect on errors after each session and generate structured learning rules, so that the same mistakes do not recur in future sessions.

**US-07**: As a developer, I want to review, approve, or reject proposed learning rules before they are persisted, so that I stay in control of what the agent "learns."

**US-08**: As a developer, I want learning rules to be scoped appropriately (global vs. project-specific), so that lessons from one project do not pollute unrelated work.

**US-09**: As a developer, I want process violations detected by the watchdog to feed into the learning system, so that systematic drift patterns are captured and corrected at the rule level — not just flagged in the moment.

#### Cross-Session Continuity

**US-10**: As a developer, I want the agent to resume a multi-session project with full awareness of where it left off (current phase, Ralph loop state, outstanding issues), so that I do not need to re-explain context at the start of every session.

**US-11**: As a developer, I want the system to maintain state reliably even after crashes, OpenCode restarts, or context compaction, so that long-running projects are not derailed by infrastructure failures.

### 2.3 Out of Scope (v1)

- Support for coding agents other than OpenCode
- Multi-user or team collaboration features
- Cloud sync or remote storage of learning rules
- Automated rule application without user review
- Support for workflows other than tdd-pipeline

---

## 3. Product Structure

### 3.1 Platform Overview

The platform consists of three layers:

**Layer 1 — Shared Core Library**  
Low-level infrastructure shared by all agent roles. Provides: plugin lifecycle, session state persistence, workflow store, event routing, MCP tool registration scaffolding. No business logic.

**Layer 2 — Agent Roles**  
Two independent agent roles, each with their own business logic, built on top of the shared core:

- **Aristotle** (Error Reflection Agent): Monitors for errors, triggers post-session reflection, manages learning rule lifecycle
- **TDD Watchdog** (Process Guardian Agent): Monitors tdd-pipeline execution in real time, enforces state machine transitions, detects and blocks violations, escalates when stuck

**Layer 3 — User Interface**  
Each role exposes capabilities to the user and LLM via OpenCode skill files (SKILL.md) and plugin tools. Aristotle uses a Python MCP server for reflection workflows. Watchdog exposes its checkpoint tool directly via the plugin `tool` hook (no separate process). Users interact via natural language commands.

### 3.2 Role Boundaries

| Concern | Aristotle | TDD Watchdog | Shared Core |
|---------|-----------|--------------|-------------|
| Session state persistence | Uses | Uses | Owns |
| Plugin event routing | Uses | Uses | Owns |
| MCP tool scaffolding | Uses | Uses | Owns |
| Error reflection & 5-Why analysis | Owns | — | — |
| Learning rule lifecycle (Git-backed) | Owns | — | — |
| tdd-pipeline state machine | — | Owns | — |
| Ralph loop audit log | — | Owns | — |
| Violation detection & blocking | — | Owns | — |
| Process violation → learning signal | Feeds into Aristotle | Produces signal | — |

### 3.3 Data Sharing

The two roles share a common data directory (`~/.config/opencode/aristotle/`) with clearly partitioned subdirectories. Aristotle reads Watchdog's audit logs as one input source for error reflection. Watchdog reads Aristotle's learning rules to understand known drift patterns. Neither role writes to the other's primary data store.

---

## 4. Feature Specifications

### 4.1 TDD Watchdog

#### 4.1.1 State Machine Tracking

The Watchdog maintains an authoritative external record of the tdd-pipeline execution state. This record is the ground truth — it is not derived from conversation history or LLM memory.

**Tracked state includes**:
- Current phase (1–5)
- Phase entry timestamp
- Ralph loop: current round count, consecutive-zero counter, open contested issues, tally history per round
- Gate pass / early stop / escalation status per phase
- Test evidence: whether failing tests have been confirmed before business code was permitted
- User approval checkpoints

**State persistence**: Written to disk after every state transition. Survives crashes and restarts.

#### 4.1.2 Checkpoint Protocol

At defined points in the tdd-pipeline workflow, the LLM is required to call a Watchdog plugin tool (`tdd_checkpoint`) to report its current state. The Watchdog validates the reported state against the state machine rules and returns either a confirmation or a violation description.

**Mandatory checkpoint events**:
- Pipeline start (initialization — creates runId and active state)
- Phase entry (any phase)
- Ralph loop round completion (each round)
- Phase transition attempt (before advancing to next phase)
- Test evidence submission (Phase 4 → Phase 5 gate)
- User approval received

**Validation performed at each checkpoint**:
- Is the reported phase/round consistent with recorded history?
- Are preconditions for the current action satisfied?
- Are there open contested issues that must be resolved first?
- Does the gate condition hold (zero C/H/M) before phase transition?

**On violation**: Watchdog returns a structured violation message. The LLM must resolve the violation before proceeding. The violation is logged to the audit trail.

#### 4.1.3 Pre-Execution Interception (`tool.execute.before`)

In addition to checkpoint-based validation, the Watchdog intercepts LLM tool calls before execution to catch violations that the LLM might attempt without going through a checkpoint.

**Intercepted patterns**:

| Tool Call Pattern | Phase Context | Violation |
|-------------------|---------------|-----------|
| Write to business code file | Phase 4 | Test evidence not confirmed |
| Write to Phase N+1 deliverable | Any phase | Ralph gate not passed for Phase N |
| Write to Phase N+1 deliverable | Any phase | User approval not recorded for Phase N |

**On interception**: Tool call is aborted. Violation message is injected into LLM context. LLM must satisfy preconditions before retrying.

**Scope limitation**: Interception applies to the main agent's tool calls only. Subagent tool calls (spawned via `task`) are not intercepted — this is a platform constraint of OpenCode's plugin system.

#### 4.1.4 Escalation

Escalation uses a dual-channel mechanism to ensure reliability:

**Primary channel (synchronous, reliable)**: When the LLM calls `tdd_checkpoint`, if Watchdog detects an escalation condition, the escalation information is included directly in the tool's response. This is synchronous — no race condition. The LLM sees the escalation immediately and can act on it.

**Secondary channel (asynchronous, best-effort)**: On `session.idle` events, Watchdog checks for unsurfaced escalation conditions and injects a notification via `prompt()`. This is fire-and-forget — the notification may arrive after the LLM has already started its next response. Used as a safety net for cases where the LLM does not call `tdd_checkpoint` after an escalation condition is met.

**Ralph loop stall escalation**: If the Ralph loop reaches 10 rounds with persistent C/H/M issues and no gate pass, the Watchdog halts the loop and surfaces a structured escalation. The escalation includes: current round count, unresolved issue list with severities, contested issue history, and a recommendation.

**Contested issue escalation**: If the same issue remains contested after 2 dispute rounds (per Ralph loop protocol), the Watchdog surfaces a dossier to the user requesting resolution.

**Session idle monitoring**: On every `session.idle` event, the Watchdog checks for anomalies: phases that have been active too long without a checkpoint, Ralph loop rounds that appear to have been skipped, or escalation conditions that have not been surfaced.

#### 4.1.5 Audit Log

Every Watchdog action is written to an append-only audit log (`ralph-log.jsonl`). Log entries include: timestamp, event type, phase, round, tally snapshot, decision (PASS / BLOCK / ESCALATE), and rationale.

The audit log is readable by Aristotle as a structured error signal source.

#### 4.1.6 User Commands

| Command | Description |
|---------|-------------|
| `/watchdog status` | Show current pipeline state (phase, Ralph loop round, gate status) |
| `/watchdog log` | Show audit log for current pipeline run |
| `/watchdog reset` | Reset watchdog state for current project (requires confirmation) |

### 4.2 Aristotle (Revised Scope)

Aristotle's core features remain unchanged. The revision in this platform context is:

**New input source**: Aristotle's error reflection workflow gains access to Watchdog audit logs as a structured input. Process violations (phase skipping, gate bypass attempts, contested issue escalations) are treated as a category of learnable error, alongside the existing 8 error categories.

**New error category**: `PROCESS_VIOLATION` — the LLM deviated from a defined workflow protocol. Root-cause analysis follows the same 5-Why structure as existing categories.

**Shared state awareness**: Aristotle can read the current Watchdog state to understand the project context when performing reflection (e.g., "this error occurred during Phase 3 Ralph loop round 4").

### 4.3 Shared Core Library

The shared core is not user-facing. It provides the following capabilities to both agent roles:

- **Plugin registration**: Standard scaffolding for registering OpenCode plugin hooks (`tool.execute.before`, `tool.execute.after`, `session.idle`, custom plugin tools) and composing multiple agent roles into a single plugin
- **Session state store**: Keyed persistent store for per-session and per-project state, with atomic read/write and crash recovery
- **Workflow store**: Track active workflows across sessions (equivalent to current aristotle-bridge `WorkflowStore`)
- **Idle event handler**: Dispatch `session.idle` events to registered handlers from each role
- **Async task executor**: Launch background sessions and track their lifecycle (equivalent to current `AsyncTaskExecutor`)
- **Logger**: Structured logging with configurable levels

---

## 5. Non-Functional Requirements

### 5.1 Reliability

- State must survive OpenCode restarts, crashes, and context compaction
- Audit log must be append-only and never truncated by the platform
- Checkpoint validation must be synchronous — the LLM cannot proceed past a failed checkpoint

### 5.2 Performance

- `tool.execute.before` interception must complete in < 50ms (file read + rule check)
- Checkpoint MCP tool response must complete in < 200ms
- Audit log write must not block the main agent thread

### 5.3 Transparency

- Every Watchdog decision (PASS / BLOCK / ESCALATE) must be visible to the user in plain language
- The user must be able to inspect the full audit trail at any time
- Aristotle's proposed learning rules must always go through user review before being persisted

### 5.4 Decoupling

- Aristotle and TDD Watchdog are independent agent roles within the same monorepo, assembled into a single OpenCode plugin via the shared core's `assemblePlugin` mechanism
- A user running only Aristotle does not need Watchdog code: if Watchdog is not registered, `assemblePlugin` simply skips it. This is achieved at the plugin composition layer, not through physical repo separation
- Both roles depend on the shared core library, not on each other
- The shared core must have no knowledge of either role's business logic

### 5.5 Extensibility

- The shared core must be designed so that additional agent roles can be added in the future without modifying existing roles
- The checkpoint protocol must be extensible to support workflows other than tdd-pipeline in the future

---

## 6. Success Metrics

### 6.1 Process Reliability
- Reduction in detected phase-skip attempts per 10 pipeline runs (baseline established in first month)
- Ralph loop round count accuracy: actual rounds logged vs. rounds the LLM claims to have run
- Gate bypass attempt rate: number of phase transitions attempted without gate pass

### 6.2 Error Learning
- Recurrence rate of previously learned error categories across sessions
- User rule approval rate (high rejection rate = reflection quality issue)
- Time-to-zero for repeated error categories (how many sessions until a learned rule eliminates a pattern)

### 6.3 User Experience
- User intervention rate: how often the user needs to manually correct the agent's process
- Session completion rate without escalation: percentage of pipeline runs that complete without requiring user to resolve a stuck state

---

## 7. Open Questions

> All open questions have been resolved. See §8 for decisions.

**OQ-01**: Should the Watchdog maintain state per-project (identified by git root) or per-pipeline-run? → **Resolved**: Per-pipeline-run with Active Run Index. See §8.

**OQ-02**: How should the platform handle the case where the user runs tdd-pipeline without Watchdog installed? → **Resolved**: Fail-open with explicit warning. See §8.

**OQ-03**: What is the right granularity for process violation learning rules? → **Resolved**: Structured Three-Element Rule Format. See §8.

**OQ-04**: The shared core library will require a refactor of aristotle-bridge's existing modules. What is the migration path? → **Resolved**: Refactor first, then build Watchdog on shared core. See §8.

---

## 8. Open Questions — Resolutions

### OQ-01 Resolution: Per-pipeline-run with Active Run Index

**Decision**: State is stored per-pipeline-run, indexed by `project_git_root + pipeline_start_timestamp`.

**Rationale**: Per-pipeline-run provides historical traceability, isolates audit logs between runs, and avoids conflating data from separate pipeline executions. Per-project would be simpler but cannot distinguish history.

**Additional constraint**: Each project has at most **one active pipeline run** at a time. Starting a new pipeline run automatically archives the previous run. The Watchdog resolves "current state" queries by looking up the active run for the current project.

### OQ-02 Resolution: Fail-open with Explicit Warning

**Decision**: Checkpoint calls are **advisory (fail-open)** when Watchdog is not installed. Pipeline execution continues normally.

**Rationale**:
- Fail-closed creates too high an adoption barrier — users must install both components before any TDD work.
- tdd-pipeline already has prompt-based rules; Watchdog is an enforcement *enhancement*, not the only mechanism.
- Users who want enforcement will install Watchdog; users who don't should not be blocked.

**Behavior when Watchdog is absent**:
- Checkpoint calls fail silently (the tdd-pipeline SKILL.md should handle MCP tool call errors gracefully).
- On `session.idle`, if Watchdog is not detected, a one-time informational message is injected: *"Watchdog plugin not detected — tdd-pipeline process execution is not externally verified in this session."*
- This message fires at most once per session to avoid noise.

### OQ-03 Resolution: Structured Three-Element Rule Format

**Decision**: `PROCESS_VIOLATION` learning rules follow a structured three-element format:

1. **Context** — The scenario in which the violation occurred (phase, Ralph loop round, task type, what the agent was trying to accomplish).
2. **Violation** — The specific deviation from the defined process (what shortcut was attempted, what precondition was skipped).
3. **Correct Behavior** — What the agent should have done instead.

**Example rule**:

> **Context**: Phase 4 (Red→Green), Ralph loop round 3, reviewer found C-severity issue.  
> **Violation**: Attempted to proceed to Phase 5 without resolving the C issue.  
> **Correct Behavior**: Must fix all C/H/M issues and achieve gate pass (zero C/H/M) before advancing to Phase 5.

This format is directly usable as the output template for the Aristotle reflection prompt when processing `PROCESS_VIOLATION` errors.

### OQ-04 Resolution: Refactor First, Then Build Watchdog on Shared Core

**Decision**: First refactor Aristotle to extract the shared core library. Then validate that refactored Aristotle works correctly on top of the core. Finally, build Watchdog on top of the same shared core.

**Status**: Phase 0 (Core extraction) completed 2026-05-12. Phase 1 technical spike passed. Phase 1 implementation pending.

**Implementation phases** (aligned with TechSpec Section 7):

- **Phase 0 — Core extraction**: Extract shared infrastructure from aristotle-bridge into `packages/core`. Refactor Aristotle to use the shared core. All existing Aristotle tests must pass before proceeding.
- **Phase 1 — Watchdog state machine + checkpoint**: Build Watchdog's state machine and MCP checkpoint tool on top of shared core. No interception yet.
- **Phase 2 — Interception**: Add `tool.execute.before` intercept rules and file pattern classifier.
- **Phase 3 — Escalation + idle monitoring**: Add escalation detection and injection.
- **Phase 4 — Aristotle integration**: Add `PROCESS_VIOLATION` category, connect Aristotle's reflection to Watchdog audit logs.
- **Phase 5 — Migration + install**: Data migration script, installer, documentation.

**Rationale**: The shared core grows out of Aristotle's existing infrastructure. Extracting it first ensures Watchdog is built on a validated foundation rather than duplicating code. This avoids the "build twice, refactor later" pattern and keeps a single source of truth from the start.

---

## Appendix: Glossary

| Term | Definition |
|------|-----------|
| Ralph loop | The mandatory multi-round review protocol in tdd-pipeline, where an independent reviewer subagent evaluates each phase deliverable |
| Gate pass | The condition for advancing past Ralph loop: zero C/H/M severity issues in the current round, after at least 5 rounds |
| Early stop | An accelerated exit from Ralph loop when 2 consecutive rounds have zero C/H/M findings (P/L/I do not reset the counter) |
| Contested issue | A C/H/M issue that the main agent has REJECTed, requiring explicit resolution by the reviewer in the next round |
| Checkpoint | A mandatory call by the LLM to the Watchdog plugin tool (`tdd_checkpoint`) to report and validate its current state |
| Audit log | The append-only record of all Watchdog decisions, maintained in `ralph-log.jsonl` |
| Shared core | The extracted library of infrastructure capabilities shared by Aristotle and TDD Watchdog |
| Agent role | A distinct set of business logic and user-facing capabilities built on the shared core (Aristotle or TDD Watchdog) |
