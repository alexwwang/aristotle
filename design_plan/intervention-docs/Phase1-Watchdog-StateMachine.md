# Phase 1 Technical Design: Watchdog State Machine + Checkpoint Tool

**Version**: 1.0-draft
**Status**: Draft
**Last Updated**: 2026-05-12
**Companion Documents**: PRD-opencode-agent-platform.md, TechSpec-opencode-agent-platform.md

---

## 1. Overview & Scope

### 1.1 Goal

Build Watchdog's state machine and `tdd_checkpoint` plugin tool. The LLM calls `tdd_checkpoint` at mandatory points during tdd-pipeline execution; Watchdog validates state transitions and persists the ground-truth state to disk.

### 1.2 What's In Scope

- State machine schema and transition validation
- `tdd_checkpoint` plugin tool handler
- Pipeline state persistence (PipelineStore)
- Pipeline start, active run management, and archival
- Crash recovery on plugin initialization
- Unit tests for all transition rules

### 1.3 What's NOT In Scope (Deferred to Later Phases)

- `tool.execute.before` interception (Phase 2)
- Escalation detection and notification (Phase 3)
- Aristotle `PROCESS_VIOLATION` integration (Phase 4)
- SKILL.md updates for tdd-pipeline (separate deliverable, but API contract defined here)

### 1.4 Design Principles (Inherited from Phase 0)

- **Core provides mechanism, not policy.** StateStore, Logger, and RoleRegistration come from core. Project ID computation, transition rules, and checkpoint protocol are watchdog policy.
- **Dependency injection over import coupling.** Watchdog modules receive config values through constructor parameters, not by importing config directly.
- **Source compatibility ≠ build compatibility.** This document includes build/deploy strategy (Phase 0 lesson).

---

## 2. Module Interface Design

### 2.1 Directory Structure

```
packages/watchdog/
├── src/
│   ├── schema.ts              ← PipelineState types (pure types, no logic)
│   ├── constants.ts           ← Magic numbers and thresholds
│   ├── transitions.ts         ← validateTransition + applyTransition
│   ├── pipeline-store.ts      ← State persistence + active run management
│   ├── checkpoint.ts          ← tdd_checkpoint tool handler
│   ├── project-id.ts          ← computeProjectId (watchdog policy, not core)
│   ├── index.ts               ← createWatchdogRole (role entry point)
│   └── tools.ts               ← Tool registration (like aristotle/tools.ts)
├── test/
│   ├── transitions.test.ts    ← Transition validation tests (matrix)
│   ├── pipeline-store.test.ts ← Store tests
│   ├── checkpoint.test.ts     ← Checkpoint handler tests
│   └── project-id.test.ts     ← Project ID computation tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 2.2 Module Signatures

#### `schema.ts` — Pure Type Definitions

```typescript
/** Watchdog checkpoint event types — the public API contract with tdd-pipeline SKILL.md */
export type CheckpointEvent =
  | 'pipeline_start'
  | 'phase_enter'
  | 'ralph_loop_start'
  | 'ralph_round_complete'
  | 'ralph_terminate'
  | 'test_evidence'
  | 'user_approval'
  | 'phase_complete'

/** State machine version for forward-compatible reads */
export const SCHEMA_VERSION = 1

export interface PipelineState {
  version: typeof SCHEMA_VERSION
  projectId: string
  runId: string
  startedAt: string                // ISO 8601
  description: string              // from pipeline_start payload

  currentPhase: 0 | 1 | 2 | 3 | 4 | 5  // 0 = initialized, awaiting first phase_enter
  phaseStatus: PhaseStatus

  phases: Record<number, PhaseRecord>
  ralph: RalphLoopState | null

  testEvidenceConfirmed: boolean
  lastCheckpointAt: string         // ISO 8601, for stale detection
}

export type PhaseStatus = 'idle' | 'active' | 'ralph_loop' | 'awaiting_approval' | 'complete'

export interface PhaseRecord {
  phase: number
  enteredAt: string                // ISO 8601
  ralphCompleted: boolean
  ralphTermination: RalphTermination | null
  userApproved: boolean
  approvedAt: string | null
}

export type RalphTermination = 'early_stop' | 'gate_pass' | 'max_rounds'
// M-1 fix: Use 'max_rounds' to match the event payload and TechSpec §3.1.1.
// 'escalated' is not a termination type — escalation is a Phase 3 concept.

export interface RalphLoopState {
  phase: number
  round: number                    // 1-based
  consecutiveZero: number          // consecutive rounds with zero C/H/M (I excluded; m-1: not counting I)
  tallyHistory: RoundTally[]
  openContested: ContestedIssue[]
  escalated: boolean
  escalatedAt: string | null
  termination: RalphTermination | null
}

export interface RoundTally {
  round: number
  C: number
  H: number
  M: number
  L: number
  I: number
  timestamp: string
}

export interface ContestedIssue {
  id: string                       // e.g. "M-2"
  firstContestedRound: number
  disputeRounds: number
  description: string
}

/** Active run index — one per project */
export interface ActiveRun {
  runId: string
  projectId: string
  startedAt: string
}

/** Project index — tracks all projects that have ever had watchdog data */
export interface ProjectIndex {
  projectIds: string[]
}

/** Checkpoint tool return types */
export interface CheckpointOk {
  ok: true
  state: PipelineStateSummary
}

export interface CheckpointViolation {
  ok: false
  violation: string
  guidance: string
}

export interface CheckpointRecovery {
  ok: false
  recovery: true
  staleState: PipelineStateSummary
  message: string
}

export type CheckpointResult = CheckpointOk | CheckpointViolation | CheckpointRecovery

export interface PipelineStateSummary {
  phase: number
  phaseStatus: PhaseStatus
  ralphRound: number | null
  runId: string
}

/** Audit log entry */
export interface AuditLogEntry {
  timestamp: string
  runId: string
  projectId: string               // M-5 fix: enables Phase 4 Aristotle correlation
  sessionId: string               // M-5 fix: enables session-level analysis
  event: CheckpointEvent
  phase: number
  round?: number
  decision: 'PASS' | 'BLOCK'
  violation?: string
  // Phase 3 will add: escalationType?: string
  // Phase 2 will add: tally?: RoundTally (for ralph_round_complete events)
}
```

#### `constants.ts`

```typescript
export const MAX_RALPH_ROUNDS = 10
export const MIN_GATE_ROUNDS = 5
export const EARLY_STOP_CONSECUTIVE = 2
export const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000  // 4 hours
export const MAX_PHASE = 5
```

#### `project-id.ts`

```typescript
/**
 * Compute a deterministic project identifier from git worktree root.
 * SHA256 of the absolute path, first 8 hex chars.
 *
 * This is watchdog POLICY — it's how watchdog identifies "a project".
 * Core doesn't know what a "project" is.
 */
export function computeProjectId(worktree: string): string
```

#### `transitions.ts`

```typescript
import type { PipelineState, CheckpointEvent, RalphTermination } from './schema.js'

export interface TransitionResult {
  valid: true
}

export interface TransitionViolation {
  valid: false
  violation: string
  guidance: string
}

export type ValidationResult = TransitionResult | TransitionViolation

/**
 * Validate a state transition WITHOUT mutating state.
 * Pure function — no I/O, no side effects.
 *
 * M-7: Validates all payload fields against event-specific schemas first
 * (type checks, range checks, required fields), then checks state preconditions.
 * Invalid payloads return violation before state is examined.
 */
export function validateTransition(
  event: CheckpointEvent,
  payload: Record<string, unknown>,
  state: PipelineState | null,  // null = no active run (first pipeline_start)
): ValidationResult

/**
 * Apply a validated transition, returning new state.
 * MUST only be called after validateTransition returns { valid: true }.
 * Pure function — caller is responsible for persistence.
 *
 * M-13: For pipeline_start, caller (CheckpointHandler) generates the runId
 * externally and passes it via payload._runId. This keeps applyTransition
 * pure and testable. All other events are naturally pure.
 *
 * M-17: Same pattern for timestamps. Caller injects current ISO timestamp
 * via payload._now. applyTransition uses payload._now for all timestamp
 * fields (lastCheckpointAt, enteredAt, approvedAt, RoundTally.timestamp, startedAt).
 * This keeps applyTransition deterministic for testing.
 */
export function applyTransition(
  event: CheckpointEvent,
  payload: Record<string, unknown>,
  state: PipelineState | null,
): PipelineState
```

#### `pipeline-store.ts`

```typescript
import type { StateStore } from '@opencode-ai/core'
import type { PipelineState, ActiveRun, AuditLogEntry } from './schema.js'

/**
 * Manages pipeline state persistence.
 *
 * Dependencies injected via constructor:
 * - stateStore: core's StateStore for file I/O (mechanism)
 * - key generation logic: watchdog policy (this module)
 *
 * Path convention (all managed by this module, not string-concatenated ad-hoc):
 *   project index:     watchdog/projects                    (.json) — lists all projectIds
 *   active run index:  watchdog/{projectId}/active          (.json)
 *   pipeline state:    watchdog/{projectId}/{runId}/state    (.json)
 *   audit log:         watchdog/{projectId}/{runId}/audit    (.jsonl)
 *   archive state:     watchdog/{projectId}/archive/{runId}/state (.json)
 *   archive audit:     watchdog/{projectId}/archive/{runId}/audit (.jsonl)
 *
 * C-1 fix: Crash recovery uses project index (single file read) instead
 * of directory listing (StateStore.list is non-recursive).
 */
export class PipelineStore {
  constructor(
    private stateStore: StateStore,  // injected from core
    private logger: import('@opencode-ai/core').Logger,  // injected from core
  ) {}

  // ── Project index ──

  /** Register a project in the index. Called by setActiveRun. */
  private addProjectToIndex(projectId: string): void

  /** Read all known project IDs. Used for crash recovery. */
  getProjectIds(): string[]

  // ── Active run management ──

  /** Get the active run for a project. Returns null if no active run. */
  getActiveRun(projectId: string): ActiveRun | null

  /** Set the active run. Archives any previous active run. */
  setActiveRun(projectId: string, run: ActiveRun): void

  /** Clear the active run (on pipeline completion). */
  clearActiveRun(projectId: string): void

  // ── State persistence ──

  /** Read pipeline state. Returns null if not found. */
  readState(projectId: string, runId: string): PipelineState | null

  /** Write pipeline state. Atomic (core StateStore uses tmp+rename).
   *  C-4 fix: Read-back verification after write to detect silent failures. */
  writeState(projectId: string, runId: string, state: PipelineState): void

  // ── Audit log ──

  /** Append an audit log entry. */
  appendAudit(projectId: string, runId: string, entry: AuditLogEntry): void

  // ── Archive ──

  /** Archive a completed run's state and audit log. */
  archiveRun(projectId: string, runId: string): void

  // ── Path constants (not exported, used internally) ──

  private activeKey(projectId: string): string        // 'watchdog/{projectId}/active'
  private stateKey(projectId: string, runId: string): string  // 'watchdog/{projectId}/{runId}/state'
  private auditKey(projectId: string, runId: string): string  // 'watchdog/{projectId}/{runId}/audit'
  private archiveStateKey(projectId: string, runId: string): string
  private archiveAuditKey(projectId: string, runId: string): string
}
```

#### `checkpoint.ts`

```typescript
import type { PipelineStore } from './pipeline-store.js'
import type { CheckpointResult, CheckpointEvent } from './schema.js'

/**
 * Handle a tdd_checkpoint tool call.
 *
 * Dependencies injected via constructor:
 * - store: PipelineStore
 * - staleThresholdMs: number (from constants, injectable for testing)
 */
export class CheckpointHandler {
  constructor(
    private store: PipelineStore,
    private staleThresholdMs: number,
  ) {}

  /**
   * Process a checkpoint event.
   *
   * Flow:
   * 1. Resolve projectId from context.worktree
   * 2. Find active run (or null for pipeline_start)
   * 3. If stale run detected AND event != 'pipeline_start' → return recovery prompt
   *       (pipeline_start bypasses stale check — it's the escape hatch to start fresh; H-5 fix)
   * 4. Read current state (or null)
   * 5. Validate transition
   * 6. If invalid → audit BLOCK + return violation
   * 7. Apply transition → write state → audit PASS + return ok
   * 8. C-3 fix: If event is phase_complete(5) → clearActiveRun + archiveRun
   */
  handle(
    event: CheckpointEvent,
    payloadJson: string,
    context: { worktree: string; sessionID: string },
  ): Promise<string>  // JSON.stringify(CheckpointResult)
}
```

#### `tools.ts`

```typescript
import type { ToolDefinition } from '@opencode-ai/core/plugin/registration'

/**
 * Create watchdog plugin tools.
 * Follows the same pattern as packages/reflection/src/tools.ts.
 */
export function createWatchdogTools(deps: {
  checkpointHandler: import('./checkpoint.js').CheckpointHandler
}): Record<string, ToolDefinition>
```

#### `index.ts` — Role Entry Point

```typescript
import type { RoleRegistration } from '@opencode-ai/core/plugin/registration'
import { createStateStore } from '@opencode-ai/core'
import { createLogger } from '@opencode-ai/core/logger'

export async function createWatchdogRole(ctx: any): Promise<RoleRegistration | null> {
  // 1. Resolve config (inject from ctx or env, same pattern as aristotle)
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir ?? /* default */

  // 2. Create dependencies (DI — no direct config import)
  const logger = createLogger('watchdog', 'AGENT_PLATFORM_LOG')
  const stateStore = createStateStore(sessionsDir, logger)
  const store = new PipelineStore(stateStore, logger)
  const checkpointHandler = new CheckpointHandler(store, STALE_THRESHOLD_MS)

  // 3. Run crash recovery
  //    Scan all projects with active runs, check stale threshold
  //    (Does NOT auto-recover — just marks for recovery prompt on next checkpoint)

  // 4. Create tools
  const tools = createWatchdogTools({ checkpointHandler })

  // 5. Return RoleRegistration
  return { tools }
}
```

---

## 3. State Schema — Complete Field Reference

Every field in `PipelineState` with its purpose, invariants, and who writes it:

| Field | Type | Written by | Invariant |
|-------|------|-----------|-----------|
| `version` | `1` | pipeline_start | Always `SCHEMA_VERSION`. Never changes after creation. |
| `projectId` | `string` | pipeline_start | SHA256(worktree)[:8]. Deterministic for same worktree. |
| `runId` | `string` | pipeline_start | UUID v4. Unique per pipeline run. |
| `startedAt` | `string` | pipeline_start | ISO 8601. Set once. |
| `description` | `string` | pipeline_start | Human-readable feature description from LLM. |
| `currentPhase` | `0\|1\|2\|3\|4\|5` | pipeline_start (→0), phase_enter (→N) | Monotonically increasing. Phase N+1 only after Phase N complete. 0 = initialized. |
| `phaseStatus` | `PhaseStatus` | multiple events | Follows state machine diagram (§4.2). |
| `phases` | `Record<number, PhaseRecord>` | phase_enter + subsequent events | Key = phase number (1–5). Created on phase_enter, updated by ralph/user events. |
| `ralph` | `RalphLoopState \| null` | ralph_loop_start | Null when not in ralph_loop. Created on ralph_loop_start. |
| `testEvidenceConfirmed` | `boolean` | test_evidence | `false` until test_evidence event with valid evidence. Only relevant for Phase 4→5 gate. |
| `lastCheckpointAt` | `string` | every checkpoint | ISO 8601. Updated on every checkpoint call. Used for stale detection. |

### 3.1 Schema Evolution Strategy

**Forward compatibility**: New fields added in Phase 2/3/4 are optional. Code reads `state.newField ?? defaultValue`. Never remove fields — deprecate with a comment.

**Version check**: On read, if `state.version < SCHEMA_VERSION`, apply migration functions in order. For Phase 1, there are no migrations. Example for future:

```typescript
function migrate(state: any): PipelineState {
  if (state.version === 1) {
    // Phase 3 adds escalation fields
    state.version = 2
    state.escalationHistory = state.escalationHistory ?? []
  }
  return state
}
```

---

## 4. Checkpoint Protocol — The SKILL.md Contract

This section defines the **exact API** that tdd-pipeline SKILL.md must instruct the LLM to call. Any mismatch here means LLM calls fail silently or return violations.

### 4.1 Tool Definition

```
Tool name: tdd_checkpoint
Arguments:
  - event: string (enum of CheckpointEvent values)
  - payload: string (JSON, schema depends on event)

Returns: JSON string of CheckpointResult
```

### 4.2 Event Types and Payload Schemas

#### `pipeline_start`

```json
// Payload
{ "description": "string" }

// Behavior: Creates new pipeline run. Archives any existing active run for this project.
//   Internally calls store.setActiveRun() which calls addProjectToIndex() (M-11).
// State effect: Creates PipelineState with currentPhase=0, phaseStatus='idle'
// Returns: { ok: true, state: { phase: 0, phaseStatus: "idle", ralphRound: null, runId: "..." } }
```

**Note**: `currentPhase=0` and `phaseStatus='idle'` means "pipeline initialized but no phase entered yet". The first `phase_enter` sets `currentPhase=1`.

#### `phase_enter`

```json
// Payload
{ "phase": 1 | 2 | 3 | 4 | 5 }

// Preconditions:
//   - phase == 1: phaseStatus == 'idle' (just started)
//   - phase == N (N > 1): phases[N-1].userApproved == true AND phaseStatus == 'complete' (phase_complete(N-1) was called)
//   - phase == 5: testEvidenceConfirmed == true (in addition to phase 4 approval)
// State effect: currentPhase = phase, phaseStatus = 'active', creates PhaseRecord
```

#### `ralph_loop_start`

```json
// Payload
{ "phase": number }

// Preconditions: currentPhase == phase, phaseStatus == 'active'
// State effect: phaseStatus = 'ralph_loop', creates RalphLoopState with round=0
//   (round=0 is intentional; first valid ralph_round_complete sets it to 1)
```

#### `ralph_round_complete`

```json
// Payload
{
  "phase": number,
  "round": number,
  "tally": { "C": number, "H": number, "M": number, "L": number, "I": number },
  "contested_resolutions"?: Array<{ "id": string, "action": "accepted" | "re_raised" | "escalated" }>
}

// Preconditions:
//   - phase == currentPhase
//   - round == ralph.round + 1 (no round skipping)
//   - tally fields are non-negative integers
//   - if openContested is non-empty, contested_resolutions must be present
// M-6 fix: contested issues NOT mentioned in contested_resolutions are carried
//   forward unchanged (disputeRounds incremented by 1). This is the safest default.
// M-10 note: 'escalated' action is accepted but treated like 're_raised' in Phase 1.
//   Full escalation handling deferred to Phase 3.
//
// M-18 fix: contested_resolutions actions:
//   - "accepted": issue REMOVED from openContested (resolved)
//   - "re_raised": disputeRounds incremented by 1, stays in openContested
//   - "escalated": treated as "re_raised" in Phase 1
//   New contested issues enter openContested via the ralph_round_complete payload:
//   the LLM includes them in a `new_contested` array (optional field).
// State effect: ralph.round = round, append to tallyHistory, update openContested
//   Also: if tally.C + tally.H + tally.M == 0, increment consecutiveZero by 1;
//         otherwise reset consecutiveZero to 0 (C-6 fix)
```

#### `ralph_terminate`

```json
// Payload
{ "phase": number, "termination": "gate_pass" | "early_stop" | "max_rounds" }

// Preconditions:
//   - phase == currentPhase (M-19: guard against cross-phase terminate)
//   - termination == "gate_pass": ralph.round >= MIN_GATE_ROUNDS AND last tally C+H+M == 0
//   - termination == "early_stop": ralph.consecutiveZero >= EARLY_STOP_CONSECUTIVE
//   - termination == "max_rounds": ralph.round >= MAX_RALPH_ROUNDS AND last tally C+H+M > 0
// State effect:
//   - "gate_pass" or "early_stop": phaseStatus = 'awaiting_approval', ralphTermination set
//   - "max_rounds": phaseStatus = 'awaiting_approval' with ralphTermination = 'max_rounds'
//   - All terminations: phases[phase].ralphCompleted = true (C-5 fix)
//   - ralph.termination = termination (M-12: RalphLoopState keeps its data through
//     awaiting_approval; ralph is nullified on phase_complete or next phase_enter)
```

#### `test_evidence`

```json
// Payload
{ "phase": 4, "evidence_file": string }

// Preconditions: currentPhase >= 4, evidence_file is a non-empty string
// State effect: testEvidenceConfirmed = true
// Note: Watchdog does NOT verify the file contents — it trusts the LLM's claim.
//       The interception layer (Phase 2) provides the enforcement.
```

#### `user_approval`

```json
// Payload
{ "phase": number }

// Preconditions:
//   - phases[phase].ralphCompleted == true
//   - (M-9 note: ralphTermination != 'escalated' check is reserved for Phase 3
//     when 'escalated' may be added to RalphTermination; currently always true)
// State effect: phases[phase].userApproved = true, phases[phase].approvedAt = now
```

#### `phase_complete`

```json
// Payload
{ "phase": number }

// Preconditions: phases[phase].userApproved == true, phaseStatus == 'awaiting_approval'
// State effect: phaseStatus = 'complete'
//   Also: ralph = null (M-12: RalphLoopState data no longer needed after phase completion)
// Note: This is distinct from user_approval — the LLM explicitly confirms the phase is done.
//       This separation allows the LLM to do post-approval cleanup before moving on.
```

### 4.3 Special Responses

#### Stale Run Recovery

When a checkpoint call is made and the active run has `lastCheckpointAt` older than `STALE_THRESHOLD_MS`:

```json
{
  "ok": false,
  "recovery": true,
  "staleState": { "phase": 3, "phaseStatus": "ralph_loop", "ralphRound": 4, "runId": "..." },
  "message": "Found stale pipeline run from 5h ago. Last activity: Phase 3 Ralph loop round 4. Options: (1) continue from where you left off — call phase_enter or ralph_round_complete as appropriate, (2) start fresh — call pipeline_start to archive this run and begin a new one."
}
```

#### No Active Run (non-pipeline_start event)

```json
{
  "ok": false,
  "violation": "No active pipeline run for this project.",
  "guidance": "Start a pipeline first by calling tdd_checkpoint with event='pipeline_start'."
}
```

---

## 5. State Persistence — Paths, Timing, and Concurrency

### 5.1 File Path Definitions

All paths are managed by `PipelineStore` via private methods. No other module constructs paths.

| Logical name | Key passed to StateStore | Physical file |
|---|---|---|
| Active run index | `watchdog/{projectId}/active` | `{baseDir}/watchdog/{projectId}/active.json` |
| Pipeline state | `watchdog/{projectId}/{runId}/state` | `{baseDir}/watchdog/{projectId}/{runId}/state.json` |
| Audit log | `watchdog/{projectId}/{runId}/audit` | `{baseDir}/watchdog/{projectId}/{runId}/audit.jsonl` |
| Archive state | `watchdog/{projectId}/archive/{runId}/state` | `{baseDir}/watchdog/{projectId}/archive/{runId}/state.json` |
| Archive audit | `watchdog/{projectId}/archive/{runId}/audit` | `{baseDir}/watchdog/{projectId}/archive/{runId}/audit.jsonl` |

`baseDir` is the same `sessionsDir` used by Aristotle (resolved from config, injected into PipelineStore via StateStore).

### 5.2 Read/Write Timing

Single checkpoint call performs this sequence:

```
1. readState(projectId, runId)              ← synchronous fs.readFileSync
2. validateTransition(event, payload, state) ← pure function, no I/O
3. (if valid) applyTransition(event, payload, state) ← pure function, no I/O
4. (if valid) writeState(projectId, runId, newState) ← synchronous tmp+rename
5. appendAudit(projectId, runId, entry)     ← synchronous fs.appendFileSync
```

Total: 2 reads (active.json + state.json) + 1 write + 1 append = 4 file operations.

### 5.3 Concurrency Analysis

**Scenario**: LLM calls `tdd_checkpoint` twice in rapid succession (e.g., ralph_round_complete + ralph_terminate in the same turn).

**Race window**: Between step 1 (read) and step 4 (write), another checkpoint call could read the same old state. Both validate against old state, both pass, the second write overwrites the first.

**Likelihood**: Extremely low. Checkpoint calls come from LLM tool invocations, which OpenCode processes sequentially within a session. Two concurrent checkpoint calls would require the LLM to invoke two tools in a single turn that both trigger checkpoint — which is not how tdd-pipeline works (one checkpoint per step).

**Impact if it occurs**: One transition is lost. The state file reflects only the later transition. The audit log captures both (append-only), so data is recoverable.

**Decision**: No locking for Phase 1. Document the race window. If it becomes a problem in practice, add a simple in-process mutex (Map<projectId, Promise>) in Phase 2.

### 5.4 State File Size Estimate

Worst case: Ralph loop does 10 rounds with max contested issues.

```
PipelineState overhead:    ~500 bytes
5 × PhaseRecord:           ~1 KB
10 × RoundTally:           ~3 KB
10 × ContestedIssue:       ~2 KB
Total:                     ~6.5 KB
```

Even 10× worst case is < 100 KB. Read/write latency on local filesystem is < 1ms. Well within the 200ms budget.

---

## 6. Core/Watchdog Boundary

Every function categorized as core mechanism or watchdog policy:

| Function | Location | Category | Rationale |
|----------|----------|----------|-----------|
| `StateStore.read/write/appendLog` | core | Mechanism | Generic file I/O with atomic write |
| `createLogger` | core | Mechanism | Generic structured logging |
| `RoleRegistration` interface | core | Mechanism | Generic plugin role registration |
| `assemblePlugin` | core | Mechanism | Generic role composition |
| `PipelineStore` path construction | watchdog | Policy | Watchdog-specific key naming convention |
| `computeProjectId` | watchdog | Policy | How to identify a project is a watchdog decision |
| `validateTransition` | watchdog | Policy | TDD-specific state machine rules |
| `applyTransition` | watchdog | Policy | TDD-specific state mutations |
| State schema (`PipelineState`) | watchdog | Policy | TDD-specific data structure |
| `tdd_checkpoint` tool definition | watchdog | Policy | TDD-specific tool API |
| Stale threshold | watchdog | Policy | 4 hours is a TDD-specific operational decision |

**What goes to core in the future**: If a second role (e.g., deployment-pipeline) also needs "compute deterministic ID from worktree", then `computeProjectId` moves to core as `computeDeterministicId`. Rule of three — wait for the second consumer.

---

## 7. Crash Recovery

### 7.1 Recovery on Plugin Initialization

When `createWatchdogRole` runs (plugin load):

1. Create `PipelineStore`
2. Call `store.getProjectIds()` to find all known projects (single file read)
3. For each project:
   a. Read `active.json`
   b. If found, read state
   c. Log stale runs as warnings (no auto-recovery, no state mutation, no in-memory flags)

M-2 fix: Stale detection is **not** done at init time with in-memory flags. Instead, it's checked on every `tdd_checkpoint` call by comparing `state.lastCheckpointAt` against `STALE_THRESHOLD_MS` (see §4 CheckpointHandler step 3). This covers both cases: stale after crash (plugin restart) and stale during normal operation (user goes to lunch). The init-time scan (steps 2-3) is informational only — logging warnings to help operators notice stale runs.
4. On next `tdd_checkpoint` call, if stale flag is set, return recovery prompt (§4.3)

### 7.2 Recovery Flow

```
Plugin loads
  → scan active runs
  → find stale run (phase 3, round 4, last checkpoint 5h ago)
  → mark for recovery (timestamp-based, no in-memory flag, no disk write)

LLM calls tdd_checkpoint('phase_enter', { phase: 3 })
  → CheckpointHandler compares lastCheckpointAt against STALE_THRESHOLD_MS (§4 step 3)
  → stale detected → returns recovery prompt (not violation)
  → LLM asks user: "continue or start fresh?"

User says "continue":
  → LLM calls tdd_checkpoint('ralph_round_complete', { phase: 3, round: 5, ... })
  → stale flag cleared, normal processing resumes

User says "start fresh":
  → LLM calls tdd_checkpoint('pipeline_start', { description: '...' })
  → archives old run, creates new run
```

### 7.3 Crash During Write

Core's `StateStore.write` uses `tmp + rename`. If crash occurs:
- Before rename: old state intact, new state lost. Safe.
- After rename: new state intact. Safe.
- Atomic on POSIX (rename is atomic). No partial writes possible.

---

## 8. Build & Deploy Strategy

### 8.1 Package Configuration

```json
// packages/watchdog/package.json
{
  "name": "@opencode-ai/watchdog",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@opencode-ai/core": "workspace:*",
    "@opencode-ai/plugin": "^1.4.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

### 8.2 Plugin Integration

```typescript
// plugin/index.ts (updated for Phase 1)
import { assemblePlugin } from '@opencode-ai/core/plugin/registration'
import { createAristotleRole } from '@opencode-ai/reflection'
import { createWatchdogRole } from '@opencode-ai/watchdog'

export default async function (ctx: any) {
  const aristotleRole = await createAristotleRole(ctx)
  const watchdogRole = await createWatchdogRole(ctx)  // new
  return assemblePlugin(ctx, [aristotleRole, watchdogRole])
}
```

### 8.3 Build

Watchdog is pure TypeScript with no external dependencies beyond core and @opencode-ai/plugin. Same build pipeline as aristotle package — no special steps needed.

### 8.4 Deploy

No separate deployment. Watchdog code is bundled into the plugin build (same as aristotle). Single `index.js` deployed to `~/.config/opencode/aristotle-bridge/index.js`.

---

## 9. Test Plan

### 9.1 Transition Validation Tests (transitions.test.ts)

Matrix: every (event × precondition) combination. Minimum 30 test cases.

**Happy path**: Complete pipeline flow from pipeline_start through phase_complete(5)

```
pipeline_start → phase_enter(1) → ralph_loop_start(1) → ralph_round_complete(1,1) → ... → ralph_terminate(1, "gate_pass") → user_approval(1) → phase_complete(1) → phase_enter(2) → ... → phase_complete(5)
```

**Violation tests**:

| Event | Invalid precondition | Expected violation |
|-------|---------------------|--------------------|
| phase_enter(2) | Phase 1 not complete | "Phase 1 not yet complete" |
| phase_enter(5) | testEvidenceConfirmed == false | "Test evidence not confirmed" |
| ralph_round_complete(1, 3) | Previous round was 1 (skipped 2) | "Round skipping not allowed" |
| ralph_terminate(1, "gate_pass") | round=3 (< MIN_GATE_ROUNDS=5) | "Insufficient rounds for gate pass" |
| ralph_terminate(1, "gate_pass") | Last tally has C=1 | "Unresolved issues remain" |
| ralph_terminate(1, "early_stop") | consecutiveZero=1 (< 2) | "Insufficient consecutive zero rounds" |
| user_approval(1) | ralph not completed | "Ralph loop not completed" |
| phase_enter(1) | Pipeline already started | "Pipeline already active" |
| pipeline_start | (no precondition — always succeeds) | N/A (creates new run) |

**Payload validation tests** (M-8):

| Event | Invalid payload | Expected violation |
|-------|----------------|--------------------|
| phase_enter | phase=0 or phase=6 | "Invalid phase number" |
| ralph_round_complete | round=-1 or round=0.5 | "Invalid round number" |
| ralph_round_complete | tally.C="abc" | "Invalid tally field type" |
| ralph_round_complete | Missing required field `tally` | "Missing required field" |
| test_evidence | phase=3 (not 4) | "Invalid phase for test evidence" |
| pipeline_start | Missing `description` | "Missing required field" |

### 9.2 PipelineStore Tests (pipeline-store.test.ts)

- Active run management: set, get, clear, archive
- State round-trip: write → read → verify
- Audit log: append → read raw file → verify entries
- Archive: write state → archive → verify original gone, archive exists
- Path safety: key with `../` → throws

### 9.3 CheckpointHandler Tests (checkpoint.test.ts)

- Full happy path: pipeline_start → ... → phase_complete(5)
- Stale recovery: mock state with old lastCheckpointAt → verify recovery prompt
- No active run: call phase_enter without pipeline_start → verify "no active run" violation
- Payload validation: malformed JSON → verify graceful error

### 9.4 Project ID Tests (project-id.test.ts)

- Deterministic: same path → same ID
- Different paths → different IDs
- Path normalization: trailing slash, double slash

### 9.5 Test Count Estimate

| Module | Tests |
|--------|-------|
| transitions.ts | ~42 (35 transitions + 7 payload validation) |
| pipeline-store.ts | ~15 |
| checkpoint.ts | ~12 |
| project-id.ts | ~5 |
| **Total** | **~74** |

---

## 10. Open Questions for Phase 1

**None.** All design decisions are captured above. The three OTQ questions that were preconditions for Phase 1 have been resolved (see TechSpec §9).

---

## 11. Divergences from TechSpec

Phase 1 design supersedes TechSpec §3 in these areas:

| Aspect | TechSpec §3 | Phase 1 Design | Reason |
|--------|------------|----------------|--------|
| State key | `stateKey(context.sessionID)` | `(projectId, runId)` via `resolveActiveStateKey` | OTQ-03: sessions don't span restarts |
| Events | 7 events (no `pipeline_start` or `phase_complete`) | 8 events (added both) | D1: explicit lifecycle; M-3: mandatory phase commit |
| `phase_transition` event | Combined end+start in one event | Split into `phase_complete` + `phase_enter` | Clearer separation of concerns |
| `RalphTermination` | Includes `'escalated'` | Uses `'max_rounds'` | Escalation is a Phase 3 concept, not a termination type |
| `PhaseStatus` | 4 values | 5 values (added `'idle'` for pre-first-phase) | Needed for `pipeline_start` → `phase_enter(1)` gap |
| Directory structure | Subdirectories (`state-machine/`, `checkpoint/`) | Flat files | Simpler for Phase 1 scope; can refactor to subdirs later |
| `tdd_checkpoint` | MCP server tool | Plugin `tool` hook | D2: no Python needed, lower latency |
| Audit log location | `ralph-log.jsonl` | `audit.jsonl` via StateStore | Consistent with StateStore key convention |
| `consecutiveZero` definition | C/H/M/L == 0 | C/H/M == 0 (L excluded) | L is informational, not a blocker; M-16 |
