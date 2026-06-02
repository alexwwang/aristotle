# Phase 2 Technical Design: Watchdog Active Monitoring + Pre-execution Verification

**Version**: 1.0-draft
**Status**: Draft
**Last Updated**: 2026-05-13
**Companion Documents**: PRD-opencode-agent-platform.md, TechSpec-opencode-agent-platform.md, Phase1-Watchdog-StateMachine.md, Phase2-Requirements.md
**Dependencies**: Phase 1 (Watchdog State Machine + Checkpoint Tool) — implemented and tested (319 tests passing)
**TDD Pipeline Phase**: Phase 2 (Technical Solution)

---

## 1. Overview & Scope

### 1.1 Goal

Phase 2 makes the Watchdog an active monitor: it observes LLM behavior via tool hooks, intercepts violations, and validates pre-execution understanding.

### 1.2 What's In Scope

- Module A: Event Observation (US-1, US-6) — `tool.execute.after` observer
- Module B: File Interception (US-2, US-3) — `tool.execute.before` interceptor
- Module C: Articulation Validation (US-4, US-5) — `why_articulation` checkpoint event

### 1.3 What's NOT In Scope

- Escalation detection (Phase 3)
- Aristotle `PROCESS_VIOLATION` integration (Phase 4)
- Auto-detection of pipeline opportunities (Phase 3)

### 1.4 Design Principles (Inherited)

- **Core provides mechanism, not policy.** StateStore, Logger, and RoleRegistration come from core. Transition rules, interception logic, and observation classification are watchdog policy.
- **Dependency injection over import coupling.** Watchdog modules receive config values through constructor parameters, not by importing config directly.
- **Source compatibility ≠ build compatibility.** This document includes build/deploy strategy (Phase 0 lesson).

---

## 2. Architecture Overview

### 2.1 Component Diagram (text)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OpenCode Runtime                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  edit    │  │  write   │  │   Task   │  │ tdd_cp.. │  ← built-in & │
│  │ (built-in)│  │(built-in)│  │(built-in)│  │(plugin)  │     plugin     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    tools      │
│       │             │             │             │                        │
│       └─────────────┴─────────────┴─────────────┘                        │
│                         │                                               │
│              OpenCode plugin dispatch                                    │
│              ┌──────────────────────┐                                    │
│              │ "tool.execute.before"│ ───┐                               │
│              │ "tool.execute.after" │    │                               │
│              └──────────────────────┘    │                               │
│                         │                │                               │
└─────────────────────────┼────────────────┼───────────────────────────────┘
                          │                │
                          ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     @opencode-ai/core plugin/registration                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      assemblePlugin                               │   │
│  │                                                                   │   │
│  │  ┌──────────────────┐    ┌──────────────────┐                    │   │
│  │  │ tool.execute.before│   │ tool.execute.after │                    │   │
│  │  │ handler            │   │ handler            │                    │   │
│  │  │  (dispatches to   │   │  (dispatches to    │                    │   │
│  │  │   role.onToolBefore│   │   role.onToolAfter)│                    │   │
│  │  └────────┬─────────┘   └────────┬─────────┘                    │   │
│  │           │                      │                                │   │
│  │           ▼                      ▼                                │   │
│  │  ┌─────────────────────────────────────────┐                     │   │
│  │  │         RoleRegistration                │                     │   │
│  │  │  ┌─────────────┐  ┌─────────────┐      │                     │   │
│  │  │  │  aristotle  │  │  watchdog   │      │                     │   │
│  │  │  │ onToolBefore│  │ onToolBefore│      │                     │   │
│  │  │  │ onToolAfter │  │ onToolAfter │      │                     │   │
│  │  │  └─────────────┘  └──────┬──────┘      │                     │   │
│  │  └──────────────────────────┼─────────────┘                     │   │
│  └─────────────────────────────┼───────────────────────────────────┘   │
│                                │                                       │
└────────────────────────────────┼───────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    @opencode-ai/watchdog (this package)                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────┐     │
│  │  Interceptor    │  │    Observer     │  │  CheckpointHandler   │     │
│  │ (onToolBefore)  │  │  (onToolAfter)  │  │  (tdd_checkpoint)    │     │
│  │                 │  │                 │  │                      │     │
│  │ • File classify │  │ • Task detect   │  │ • why_articulation   │     │
│  │ • Rule evaluate │  │ • Record obs    │  │ • Cache refresh      │     │
│  │ • Throw on viol │  │ • Session buffer│  │ • State persistence  │     │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬───────────┘     │
│           │                    │                      │                  │
│           └────────────────────┼──────────────────────┘                  │
│                                │                                        │
│                                ▼                                        │
│                    ┌─────────────────────┐                              │
│                    │ PipelineStateCache   │                              │
│                    │ (in-memory, shared)  │                              │
│                    └──────────┬──────────┘                              │
│                               │                                         │
│                               ▼                                         │
│                    ┌─────────────────────┐                              │
│                    │    PipelineStore     │                              │
│                    │ (disk persistence)   │                              │
│                    └─────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────┘
```

**Current plugin output**: `{ tool?, event? }`

**Phase 2 adds**: `"tool.execute.before"` and `"tool.execute.after"` keys. These are special keys that OpenCode's plugin system calls for **ALL** tools (built-in and plugin-registered), unlike the `tool` key which only registers plugin-defined tools.

### 2.2 Data Flow

#### `tool.execute.before` — Interception (Module B)

```
OpenCode dispatches tool call
  → assemblePlugin "tool.execute.before" handler fires
    → iterates all roles' onToolBefore
      → watchdog.onToolBefore(tool, args, sessionId)
        → PipelineStateCache.get() → cached PipelineState (or null)
        → if no active pipeline → return silently (fail-open, AC-8)
        → extract file path from args
        → classify file path (business code? phase deliverable?)
        → evaluate intercept rules in order (C-7)
        → if rule matches → throw WatchdogInterceptError(violation_message) [fail-closed, expected]
        → unexpected error → throw generic Error("infrastructure failure") [fail-closed, defensive]
        → else → return normally (allow tool execution)
```

#### `tool.execute.after` — Observation (Module A)

```
OpenCode dispatches after tool execution
  → assemblePlugin "tool.execute.after" handler fires
    → iterates all roles' onToolAfter
      → watchdog.onToolAfter(tool, args, output, sessionId)
        → if tool === 'Task' and active pipeline in ralph_loop
             → read current ralph.round from PipelineStateCache
             → append ObservationEntry with type='_reviewer_spawned', round=round+1
        → else if no active pipeline
             → append minimal entry to SessionBuffer (AC-10)
        → else
             → no-op (no observation recorded)
```

#### `tdd_checkpoint` — State Machine + Cache Refresh

```
OpenCode dispatches tdd_checkpoint tool
  → watchdog checkpoint handler (existing Phase 1 flow)
    → validateTransition → applyTransition → writeState
    → PipelineStateCache.update(newState)  // ← NEW: synchronous cache refresh
    → if event === 'phase_complete' && phase === 5
         → PipelineStateCache.clear()  // ← NEW
```

### 2.3 Dependency Graph (Module level)

```
Module A (Observer)
  reads:  PipelineState (via PipelineStateCache)
  writes: ObservationEntry → PipelineStore

Module B (Interceptor)
  reads:  PipelineState (via PipelineStateCache)
  throws: Error on violation

Module C (Articulation)
  reads:  PipelineState (via PipelineStateCache)
  writes: PipelineState (articulation fields)
  extends: transitions.ts, checkpoint.ts, schema.ts

PipelineStateCache (shared)
  reads:  PipelineStore (adaptive: in-memory cache in non-OMO, disk read in OMO mode)
  writes: internal cache field (synchronized on checkpoint writes)

SessionBuffer (shared, Module A)
  holds:  in-memory array of minimal tool call records
```

---

## 3. Core Package Changes

### 3.1 `assemblePlugin` Update (`registration.ts`)

**Current behavior**: `assemblePlugin` wraps `plugin tool.execute` with `onToolBefore`/`onToolAfter`. This only covers tools registered by the plugin (e.g., `tdd_checkpoint`), NOT OpenCode's built-in tools (`edit`, `write`, `Task`).

**Problem**: Module B must intercept `edit` and `write` calls. Module A must observe `Task` calls. These are built-in tools — the wrapping approach does not fire for them.

**Phase 2 fix**: `assemblePlugin` must also return `"tool.execute.before"` and `"tool.execute.after"` keys. OpenCode's plugin system calls these for ALL tools, built-in and plugin-registered. The existing tool wrapping code stays in place for plugin-registered tools (backward compatible, handles `tdd_checkpoint` hook chain).

```typescript
// packages/core/src/plugin/registration.ts — updated assemblePlugin

export interface PluginOutput {
  tool?: Record<string, ToolDefinition>
  event?: (event: any) => Promise<void>
  "tool.execute.before"?: (params: {
    tool: string
    sessionID: string
    callID: string
    args: unknown
  }) => Promise<void>
  "tool.execute.after"?: (params: {
    tool: string
    sessionID: string
    callID: string
    args: unknown
    output: unknown
  }) => Promise<void>
}

export function assemblePlugin(
  ctx: any,
  roles: Array<RoleRegistration | null>,
): PluginOutput {
  const activeRoles = roles.filter((r): r is RoleRegistration => r != null)

  if (activeRoles.length === 0) {
    return {}
  }

  // ── Existing Phase 1: merge tools ───────────────────────────────
  const mergedTools: Record<string, ToolDefinition> = {}
  for (const role of activeRoles) {
    if (role.tools) {
      for (const [name, def] of Object.entries(role.tools)) {
        if (name in mergedTools) {
          throw new Error(`Tool name conflict: ${name}`)
        }
        mergedTools[name] = def
      }
    }
  }

  const hasToolHooks = activeRoles.some(r => r.onToolBefore || r.onToolAfter)

  // ── Existing Phase 1: wrap plugin-registered tools ──────────────
  if (hasToolHooks) {
    for (const [name, def] of Object.entries(mergedTools)) {
      const originalExecute = def.execute
      mergedTools[name] = {
        ...def,
        execute: async (args: any, context: any) => {
          const sessionId = getSessionId(context)

          // Call onToolBefore for all active roles (fail-closed: errors propagate)
          for (const role of activeRoles) {
            if (role.onToolBefore) {
              await role.onToolBefore(name, args, sessionId, context.callID ?? '')
            }
          }

          // Execute original tool
          const output = await originalExecute(args, context)

          // Call onToolAfter for all active roles (fail-open with degradation flag)
          for (const role of activeRoles) {
            if (role.onToolAfter) {
              try {
                await role.onToolAfter(name, args, output, sessionId, context.callID ?? '')
              } catch {
                // Observer errors caught here; degradation flag set internally
              }
            }
          }

          return output
        },
      }
    }
  }

  const output: PluginOutput = {}

  if (Object.keys(mergedTools).length > 0) {
    output.tool = mergedTools
  }

  // ── Phase 2 NEW: Global tool.execute.before/after ───────────────
  // These fire for ALL tools (built-in + plugin), via OpenCode dispatch.
  const rolesWithBefore = activeRoles.filter(r => r.onToolBefore)
  const rolesWithAfter = activeRoles.filter(r => r.onToolAfter)

  if (rolesWithBefore.length > 0) {
    output["tool.execute.before"] = async (params) => {
      for (const role of rolesWithBefore) {
        // Interceptor is fail-closed: both WatchdogInterceptError (expected)
        // and unexpected errors block tool execution. All errors propagate.
        await role.onToolBefore!(params.tool, params.args, params.sessionID, params.callID)
        // If we reach here, the role allowed execution — continue to next role.
      }
    }
  }

  if (rolesWithAfter.length > 0) {
    output["tool.execute.after"] = async (params) => {
      for (const role of rolesWithAfter) {
        try {
          await role.onToolAfter!(
            params.tool,
            params.args,
            params.output,
            params.sessionID,
            params.callID,
          )
        } catch {
          // Observer is fail-open: tool has already executed, blocking the result
          // is pointless. Observer sets its own internal degradation flag when it
          // fails, so AC-2 can account for incomplete observations.
          // Error isolation: one role's onToolAfter error doesn't block others.
        }
      }
    }
  }

  // ── Existing Phase 1: idle handler ──────────────────────────────
  const hasIdleHandlers = activeRoles.some(r => r.onIdle)
  if (hasIdleHandlers) {
    output.event = async (event: any) => {
      const e = event?.event ?? event
      if (e?.type !== 'session.idle') return
      const sessionId = e?.properties?.sessionID ?? ''
      if (typeof sessionId !== 'string' || !sessionId) return
      for (const role of activeRoles) {
        if (role.onIdle) {
          try {
            await role.onIdle(sessionId, ctx.client)
          } catch {
            // PR-12: don't block subsequent roles on idle error
          }
        }
      }
    }
  }

  return output
}
```

**Error isolation (asymmetric)**:
- `tool.execute.before` (**fail-closed**): Any throw blocks execution. The Interceptor distinguishes `WatchdogInterceptError` (expected violation, includes guidance) from unexpected errors (infrastructure failure, includes "restart pipeline" guidance). Both block the tool. First throw wins — subsequent roles' `onToolBefore` are not called.
- `tool.execute.after` (**fail-open with degradation flag**): Errors are caught per-role. The Observer sets an internal `degradedRounds` flag on failure, which AC-2 queries before enforcing violations. One role's observer crash does not prevent other roles from observing the same tool call. Tool result is returned normally — blocking it after execution is pointless.

**Backward compatibility**: The existing tool wrapping (for plugin-registered tools like `tdd_checkpoint`) stays. The global `tool.execute.before`/`after` keys fire for ALL tools including built-ins. OpenCode de-duplicates — if a tool is both wrapped and dispatched via global hooks, both fire (wrap happens first at the tool definition level, global happens at the runtime dispatch level). This double-firing is harmless for `onToolAfter` observers (idempotent observation) and for `onToolBefore` interceptors (idempotent checks, same throw).

> **⚠️ Architectural constraint**: All `onToolBefore`/`onToolAfter` handlers MUST be idempotent. Double-firing is currently harmless because the Interceptor early-returns for non-edit/write tools and the Observer only records Task calls. Future role implementers must ensure their hooks tolerate being called twice for the same tool invocation, or the dispatch layer must be updated to deduplicate.

### 3.2 `RoleRegistration` Interface Update (`registration.ts`)

```typescript
export interface RoleRegistration {
  /**
   * Called before any tool executes.
   *
   * Phase 2 change: Returns Promise<void> instead of Promise<string | null>.
   * - throw Error = block tool execution (C-1 requirement)
   * - return normally = allow tool execution
   *
   * OTQ-01 rationale: OpenCode's tool.execute.before hook does not support
   * returning a modified output or an abort signal. The only way to block
   * execution is to throw. The old `return string` pattern was aspirational
   * but unsupported by the runtime.
   *
   * M-7 fix: callID parameter added for ObservationEntry correlation.
   * OpenCode's hook dispatch provides params.callID which is propagated here.
   */
  onToolBefore?: (tool: string, args: unknown, sessionId: string, callID: string) => Promise<void>

  /** M-7 fix: callID parameter added for ObservationEntry correlation. */
  onToolAfter?: (tool: string, args: unknown, output: unknown, sessionId: string, callID: string) => Promise<void>

  onIdle?: (sessionId: string, client: any) => Promise<void>

  tools?: Record<string, ToolDefinition>
}
```

**Migration**: Phase 1's `tdd_checkpoint` tool wrapping used `onToolBefore` returning `string | null` to intercept. That wrapping code is updated to the new signature. The `CheckpointHandler` itself does not use `onToolBefore` — it was called via the wrapped tool definition, not via the global hook. No other roles currently implement `onToolBefore`.

### 3.3 `PluginOutput` Type Extension

```typescript
export interface PluginOutput {
  tool?: Record<string, ToolDefinition>
  event?: (event: any) => Promise<void>

  /** Phase 2: Global before-execution hook — fires for ALL tools */
  "tool.execute.before"?: (params: {
    tool: string
    sessionID: string
    callID: string
    args: unknown
  }) => Promise<void>

  /** Phase 2: Global after-execution hook — fires for ALL tools */
  "tool.execute.after"?: (params: {
    tool: string
    sessionID: string
    callID: string
    args: unknown
    output: unknown
  }) => Promise<void>
}
```

---

## 4. Schema Extensions

### 4.1 New Types

All extensions are **additive** (no field removals, no type narrowing). Schema version remains `1`.

```typescript
// packages/watchdog/src/schema.ts — updated

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
  | 'why_articulation'  // ← NEW: Module C event

/** State machine version for forward-compatible reads */
export const SCHEMA_VERSION = 1

export interface PipelineState {
  version: typeof SCHEMA_VERSION
  projectId: string
  runId: string
  startedAt: string
  description: string

  // ── Phase 2 NEW: Multi-agent ownership ────────────────────────────────
  /** Session ID that created this pipeline. Only the owner session can
   *  advance pipeline state (checkpoint writes). Sub-agent sessions are
   *  rejected with guidance (§X OMO Defense, Layer 2+3).
   *
   *  Optional for Phase 1 backward compatibility: state files created by
   *  Phase 1 lack this field. When undefined, ownership check is skipped
   *  (any session can write — safe because Phase 1 didn't have multi-agent).
   *  Set on first `pipeline_start` after upgrade. */
  ownerSessionId?: string

  currentPhase: 0 | 1 | 2 | 3 | 4 | 5
  phaseStatus: PhaseStatus

  phases: Record<number, PhaseRecord>
  ralph: RalphLoopState | null

  testEvidenceConfirmed: boolean
  lastCheckpointAt: string
}

export type PhaseStatus = 'idle' | 'active' | 'ralph_loop' | 'awaiting_approval' | 'complete'

export interface PhaseRecord {
  phase: number
  enteredAt: string
  ralphCompleted: boolean
  ralphTermination: RalphTermination | null
  userApproved: boolean
  approvedAt: string | null

  // ── Phase 2 NEW fields ────────────────────────────────────────────
  /** Whether the why-articulation content passed all 3 dimension checks */
  articulationVerified: boolean           // default false

  /** Per-dimension content validation results (set when verified) */
  articulationDimensions?: {
    what_it_protects: boolean
    key_risks: boolean
    why_approach_works: boolean
  }

  /** Set when why_articulation state preconditions pass (regardless of content validation outcome).
   *  Distinguishes "never called" (false) from "called but failed" (true). */
  articulationAttempted: boolean          // default false

  /** Historical marker — once set, never cleared. Indicates 3 consecutive content validation failures
   *  occurred in this phase. Advisory only; Ralph reviewers may scrutinize more carefully. */
  articulationDegraded: boolean           // default false
}

export type RalphTermination = 'early_stop' | 'gate_pass' | 'max_rounds'

export interface RalphLoopState {
  phase: number
  round: number
  consecutiveZero: number
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
  id: string
  firstContestedRound: number
  disputeRounds: number
  description: string
}

export interface ActiveRun {
  runId: string
  projectId: string
  startedAt: string
}

export interface ProjectIndex {
  projectIds: string[]
}

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

export interface AuditLogEntry {
  timestamp: string
  runId: string
  projectId: string
  sessionId: string
  event: CheckpointEvent
  phase: number
  round?: number
  decision: 'PASS' | 'BLOCK'
  violation?: string
}

// ── Phase 2 NEW types ───────────────────────────────────────────────────

/** Observation entry for hook-generated event records.
 *  Distinct from AuditLogEntry — observations capture runtime behavior,
 *  audit log captures checkpoint state transitions.
 */
export interface ObservationEntry {
  timestamp: string
  type: string              // e.g., '_reviewer_spawned'
  tool: string              // e.g., 'Task'
  callID: string
  round?: number            // ralph.round at observation time, if applicable
  metadata?: Record<string, unknown>
}

// ── Phase 2 NEW type constants ──────────────────────────────────────────

/** Observation type: a Task tool call was detected during ralph_loop */
export const OBS_TYPE_REVIEWER_SPAWNED = '_reviewer_spawned' as const
```

### 4.2 Constants Additions

```typescript
// packages/watchdog/src/constants.ts — updated

export const MAX_RALPH_ROUNDS = 10
export const MIN_GATE_ROUNDS = 5
export const EARLY_STOP_CONSECUTIVE = 2
export const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000  // 4 hours
export const MAX_PHASE = 5

// ── Phase 2 NEW constants ─────────────────────────────────────────────

/** Maximum consecutive content validation failures before degradation */
export const ARTICULATION_MAX_FAILURES = 3

/** Maximum entries in the session-level observation buffer */
export const SESSION_BUFFER_MAX_SIZE = 1000
```

---

## 5. Shared Infrastructure Components

### 5.1 `PipelineStateCache` (`state-cache.ts`) — NEW

Adaptive cache strategy: **memory cache in single-agent mode, disk-read in OMO multi-agent mode**. The mode is determined once at plugin initialization by checking whether OMO is installed.

**Why adaptive**: In non-OMO single-agent mode, memory cache avoids ~1ms disk read per hook call — pure performance win with no correctness trade-off (only one session, single writer). In OMO multi-agent mode, memory cache is unsafe — sub-agent sessions would hold stale state after the orchestrator writes. Disk reads ensure sub-agents always see the latest state.

```typescript
// packages/watchdog/src/state-cache.ts

import type { Logger } from '@opencode-ai/core/logger'
import type { PipelineState } from './schema.js'
import type { PipelineStore } from './pipeline-store.js'
import { computeProjectId } from './project-id.js'

/**
 * PipelineStateCache: adaptive strategy for single-agent vs multi-agent.
 *
 * Mode selection:
 * - multiAgent: false (default, no OMO detected)
 *     → In-memory cache, Phase 1 behavior
 *     → update() stores state, clear() resets, get() returns cached or lazy-populates
 * - multiAgent: true (OMO detected at plugin init)
 *     → Every get() reads from disk
 *     → update() and clear() are no-ops
 *     → Ensures sub-agents always see latest orchestrator state
 *
 * Mode is determined once at construction. No runtime switching.
 */
export class PipelineStateCache {
  private cache: PipelineState | null = null
  private projectId: string | null = null
  private store: PipelineStore
  private logger: Logger
  private worktreeRoot: string
  private multiAgent: boolean

  constructor(
    store: PipelineStore,
    logger: Logger,
    worktreeRoot: string,
    multiAgent: boolean = false,
  ) {
    this.store = store
    this.logger = logger
    this.worktreeRoot = worktreeRoot
    this.multiAgent = multiAgent
  }

  /** Get current pipeline state.
   *  - multiAgent mode: reads from disk every call
   *  - single-agent mode: returns cached value, lazy-populates on first access */
  get(): PipelineState | null {
    if (this.multiAgent) {
      return this.readFromDisk()
    }

    // Single-agent: in-memory cache (Phase 1 behavior)
    if (this.cache !== null) {
      return this.cache
    }
    this.ensurePopulated()
    return this.cache
  }

  /** Update cache after checkpoint writes state.
   *  - multiAgent mode: no-op (disk is source of truth)
   *  - single-agent mode: stores in memory */
  update(state: PipelineState): void {
    if (this.multiAgent) return  // no-op
    this.cache = state
    this.projectId = state.projectId
    this.logger.debug('PipelineStateCache updated for project %s run %s', state.projectId, state.runId)
  }

  /** Clear cache (pipeline complete / archive).
   *  - multiAgent mode: no-op
   *  - single-agent mode: clears in-memory cache */
  clear(): void {
    if (this.multiAgent) return  // no-op
    if (this.cache) {
      this.logger.debug('PipelineStateCache cleared for project %s run %s', this.cache.projectId, this.cache.runId)
    }
    this.cache = null
    this.projectId = null
  }

  // ── Private helpers ──────────────────────────────────────────────

  /** Read state from disk (used in multiAgent mode). */
  private readFromDisk(): PipelineState | null {
    try {
      const currentProjectId = computeProjectId(this.worktreeRoot)
      const activeRun = this.store.getActiveRun(currentProjectId)
      if (!activeRun) return null
      return this.store.readState(currentProjectId, activeRun.runId)
    } catch (err) {
      this.logger.warn('PipelineStateCache disk read failed: %s', String(err))
      return null
    }
  }

  /** Lazy-populate from disk (used in single-agent mode only). */
  private ensurePopulated(): void {
    if (this.cache !== null) return
    try {
      const currentProjectId = computeProjectId(this.worktreeRoot)
      const activeRun = this.store.getActiveRun(currentProjectId)
      if (activeRun) {
        const state = this.store.readState(currentProjectId, activeRun.runId)
        if (state) {
          this.cache = state
          this.projectId = currentProjectId
          this.logger.info('PipelineStateCache lazy-populated: project %s run %s (phase %d)',
            currentProjectId, activeRun.runId, state.currentPhase)
        }
      }
    } catch (err) {
      this.logger.warn('PipelineStateCache lazy-populate failed: %s', String(err))
    }
  }
}
```

**OMO detection** (in `createWatchdogRole`, §5.4):

```typescript
// Detect OMO at plugin initialization — one-time check, result cached
function detectMultiAgent(ctx: any): boolean {
  // Check if opencode.json registers OMO plugin.
  // Assumes ctx.directory is the project root (same as worktreeRoot in most cases).
  // If ctx.directory differs from worktreeRoot, detection may miss OMO.
  // This is acceptable: OMO detection is advisory, not security-critical.
  // The fallback (single-agent cache mode) is always safe.
  try {
    const configPath = path.join(ctx.directory, 'opencode.json')
    if (!fs.existsSync(configPath)) return false
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const plugins: string[] = config?.plugin ?? []
    return plugins.some(p =>
      typeof p === 'string' && (
        p.includes('oh-my-opencode') || p.includes('oh-my-openagent')
      )
    )
  } catch {
    return false  // Conservative: if detection fails, assume single-agent
  }
}

// In createWatchdogRole:
const multiAgent = detectMultiAgent(ctx)
const cache = new PipelineStateCache(store, logger, worktreeRoot, multiAgent)
```

**Performance comparison**:

| Mode | `get()` cost | `update()` | `clear()` | Correctness |
|------|-------------|------------|-----------|-------------|
| Single-agent (no OMO) | ~0.1ms (memory hit) | Stores in memory | Clears memory | ✅ Single writer, cache always consistent |
| Multi-agent (OMO) | ~1ms (SSD readFileSync) | No-op | No-op | ✅ Always reads latest from disk |

**Migration note**: Phase 1's `CheckpointHandler` calls `cache.update(newState)` and `cache.clear()` — these work in both modes. In single-agent mode they update the in-memory cache; in multi-agent mode they're no-ops. No code changes needed in `checkpoint.ts`. Phase 1 tests continue to work without modification (they mock the store, cache stays in single-agent mode by default).

### 5.2 Directory Structure (Phase 2 additions)

```
packages/watchdog/src/
├── schema.ts              ← UPDATED (CheckpointEvent, PhaseRecord, ObservationEntry)
├── constants.ts           ← UPDATED (ARTICULATION_MAX_FAILURES, SESSION_BUFFER_MAX_SIZE)
├── transitions.ts         ← UPDATED (why_articulation case in validateTransition + applyTransition)
├── pipeline-store.ts      ← UPDATED (appendObservation, readObservations, findObservations)
├── checkpoint.ts          ← UPDATED (why_articulation handling, cache.update() on write, cache.clear() on archive)
├── interceptor.ts         ← NEW (Module B: onToolBefore → file classification → rule evaluation → throw)
├── file-classifier.ts     ← NEW (Module B: classify file path — config-driven Rule 4 patterns)
├── path-extractor.ts      ← NEW (Module B: extract target path from edit/write args)
├── intercept-rules.ts     ← NEW (Module B: AC-3/AC-4 rule definitions)
├── watchdog-config.ts     ← NEW (shared: load .opencode/watchdog.jsonc, fallback defaults)
├── observer.ts            ← NEW (Module A: onToolAfter → Task detection → ObservationEntry)
├── session-buffer.ts      ← NEW (Module A: in-memory buffer for no-pipeline observations)
├── articulation.ts        ← NEW (Module C: dimension validation + degradation tracking)
├── state-cache.ts         ← NEW (shared: PipelineStateCache)
├── tools.ts               ← UNCHANGED (tdd_checkpoint tool registration)
├── project-id.ts          ← UNCHANGED (computeProjectId)
└── index.ts               ← UPDATED (wire new components: config, cache, interceptor, observer)
```

### 5.3 `PipelineStore` Extensions (`pipeline-store.ts`)

New methods for observation records. OQ-2 resolution: **shared store** — observations use the same key structure (`projectId/runId`) as state and audit log, avoiding a second StateStore instance.

```typescript
// Added to PipelineStore class in pipeline-store.ts

/**
 * Append an observation entry to the observation log.
 * Key: watchdog/{projectId}/{runId}/observations (.jsonl)
 *
 * Called by the observer (Module A) when a relevant tool call is detected.
 */
appendObservation(projectId: string, runId: string, entry: ObservationEntry): void

/**
 * Read all observations for a run.
 * Returns empty array if no observations exist.
 */
readObservations(projectId: string, runId: string): ObservationEntry[]

/**
 * Find observations by type and/or round.
 * Used by checkpoint validation (AC-2) to verify reviewer presence.
 */
findObservations(
  projectId: string,
  runId: string,
  filter: {
    type?: string
    round?: number
  },
): ObservationEntry[]
```

**Storage key**: `watchdog/{projectId}/{runId}/observations` (`.jsonl` format, same as audit log). Appended via `StateStore.appendLog`.

### 5.4 Updated `index.ts` (`createWatchdogRole`)

```typescript
// packages/watchdog/src/index.ts — updated

/**
 * Watchdog role entry point.
 *
 * Design: Phase2-ActiveMonitoring.md §5.4
 *
 * Creates and wires the watchdog role:
 * 1. Resolve config (same sessionsDir as aristotle)
 * 2. Resolve worktree root
 * 3. Create logger
 * 4. Load watchdog config (phase deliverable patterns)
 * 5. Create remaining dependencies (store, stateStore)
 * 6. Create shared infrastructure (cache, session buffer)
 * 7. Create Module B interceptor + Module A observer
 * 8. Create checkpoint handler
 * 9. Run crash recovery (informational logging only)
 * 10. Create tools (tdd_checkpoint, wired to cache)
 * 11. Return RoleRegistration with onToolBefore / onToolAfter
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import type { RoleRegistration } from '@opencode-ai/core/plugin/registration'
import { createStateStore } from '@opencode-ai/core/store/state-store'
import { createLogger } from '@opencode-ai/core/logger'
import { PipelineStore } from './pipeline-store.js'
import { CheckpointHandler } from './checkpoint.js'
import { createWatchdogTools } from './tools.js'
import { PipelineStateCache } from './state-cache.js'
import { SessionBuffer } from './session-buffer.js'
import { Interceptor } from './interceptor.js'
import { Observer } from './observer.js'
import { loadWatchdogConfig } from './watchdog-config.js'
import { STALE_THRESHOLD_MS } from './constants.js'

const DEFAULT_SESSIONS_DIR = join(homedir(), '.config', 'opencode', 'aristotle-sessions')
const CONFIG_PATH = join(homedir(), '.config', 'opencode', 'aristotle-config.json')

function readConfigSessionsDir(): string | null {
  try {
    if (existsSync(CONFIG_PATH)) {
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      return config.sessions_dir ?? null
    }
  } catch { /* ignore parse errors */ }
  return null
}

export async function createWatchdogRole(ctx: any): Promise<RoleRegistration | null> {
  // 1. Resolve config
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir
    ?? readConfigSessionsDir()
    ?? process.env.ARISTOTLE_SESSIONS_DIR
    ?? DEFAULT_SESSIONS_DIR
  mkdirSync(sessionsDir, { recursive: true })

  // 2. Resolve worktree root for path normalization (C-6)
  //    ctx.worktree is available at plugin init time (same as Phase 1 checkpoint context)
  const worktreeRoot: string = ctx.worktree ?? process.cwd()

  // 3. Create core dependencies (DI) — logger must be created before loadWatchdogConfig
  const logger = createLogger('watchdog', 'AGENT_PLATFORM_LOG')

  // 4. Load watchdog config (§7.4.1) — requires logger for fallback warnings
  const watchdogConfig = loadWatchdogConfig(worktreeRoot, logger)

  // 5. Create remaining core dependencies
  const stateStore = createStateStore(sessionsDir, logger)
  const store = new PipelineStore(stateStore, logger)

  // 6. Create shared infrastructure
  //    Detect OMO for adaptive cache strategy (§5.1): memory cache (non-OMO) or disk read (OMO)
  const multiAgent = detectMultiAgent(ctx)
  const cache = new PipelineStateCache(store, logger, worktreeRoot, multiAgent)
  const sessionBuffer = new SessionBuffer(logger)

  // 7. Create Module B interceptor + Module A observer
  const interceptor = new Interceptor({
    cache,
    logger,
    worktreeRoot,
    deliverablePatterns: watchdogConfig.phaseDeliverables,
    ignorePatterns: watchdogConfig.ignorePatterns,
    monitoredTools: watchdogConfig.monitoredTools,
  })
  const observer = new Observer({ cache, store, sessionBuffer, logger })

  // 8. Create checkpoint handler (wires cache.update on writes, cache.clear on archive)
  const checkpointHandler = new CheckpointHandler(store, STALE_THRESHOLD_MS, cache, observer)

  // 9. Crash recovery — informational scan (Phase 1 §7.1)
  try {
    const projectIds = store.getProjectIds()
    for (const projectId of projectIds) {
      const activeRun = store.getActiveRun(projectId)
      if (activeRun) {
        const state = store.readState(projectId, activeRun.runId)
        if (state) {
          const elapsed = Date.now() - new Date(state.lastCheckpointAt).getTime()
          if (elapsed > STALE_THRESHOLD_MS) {
            logger.warn(
              'Found stale watchdog run for project %s: phase %d, last checkpoint %dms ago',
              projectId,
              state.currentPhase,
              elapsed,
            )
          }
        }
      }
    }
  } catch (err) {
    logger.warn('Crash recovery scan failed: %s', String(err))
  }

  // 10. Create tools
  const tools = createWatchdogTools({ checkpointHandler })

  // 11. Return RoleRegistration with hooks
  return {
    tools,
    onToolBefore: interceptor.handle.bind(interceptor),
    onToolAfter: observer.handle.bind(observer),
  }
}
```

**Note on `CheckpointHandler` constructor change**: Phase 1 constructor was `CheckpointHandler(store, staleThresholdMs)`. Phase 2 adds two parameters: `cache: PipelineStateCache` and `observer: Observer`. The handler calls `cache.update(newState)` after `store.writeState()` (no-op with disk-read cache) and `cache.clear()` after `store.clearActiveRun()` + `store.archiveRun()` on `phase_complete(5)` (also no-op). It also calls `observer.clearDegradation(projectId, runId)` on `phase_complete(5)` to clean up in-memory degradation data. The `observer` reference is used for AC-2 degradation checks during `ralph_round_complete` (§6.4).

### 5.5a Pipeline Ownership (Multi-Agent Safety)

**Problem**: In OMO multi-agent environments, sub-agent sessions load their own watchdog plugin instances, each with its own `CheckpointHandler`. If a sub-agent's LLM calls `tdd_checkpoint`, it could write to the same `state.json` as the orchestrator — causing race conditions and state corruption (§X).

**Solution**: `PipelineState.ownerSessionId` records which session created the pipeline. `CheckpointHandler.handle()` rejects writes from non-owner sessions. Combined with a single-pipeline-per-project constraint, this prevents:

1. **Race conditions on `state.json`** — only owner session writes
2. **Duplicate pipelines** — `pipeline_start` from sub-agent rejected because active pipeline already exists
3. **Uncontrolled pipeline advancement** — sub-agent cannot skip phases or bypass Ralph review

**Ownership check pseudocode** (Layer 2+3 defense, §X):

```typescript
// In CheckpointHandler.handle(), after resolving projectId/runId and reading state:
//
// Ownership safety invariant: non-owner sessions must never see stale recovery
// prompts or advance pipeline state. This is enforced structurally:
// - For non-pipeline_start events: ownership check (Step A) runs first, before
//   stale check. Non-owners are rejected before reaching stale logic.
// - For pipeline_start events: stale check (non-stale → reject everyone) runs
//   before ownership check (stale → reject non-owner). The non-stale path
//   rejects unconditionally for ALL sessions, so non-owners never reach the
//   stale-restart logic. The stale path then checks ownership before allowing.

// ── Step A: Ownership check for non-pipeline_start events ────────────
// Uses hasOwner() type guard: returns true only when ownerSessionId is
// a non-empty string. Phase 1 states (undefined ownerSessionId) skip
// this check — backward compatible.
// Corrupted state (activeRun but currentState=null): not explicitly handled
//   by ownership code — downstream rejection is coincidental (residual risk).
//   hasOwner(null) returns false → ownership check skipped → event
//   proceeds to the general stale/recovery logic in handle() (not shown
//   in this excerpt), which also requires currentState → falls
//   through to validateTransition which returns NO_ACTIVE_RUN for null
//   state on non-pipeline_start events. Net effect: rejected, but via
//   a different path. This is accepted as a residual risk — the
//   downstream validation layer catches it, even though ownership is
//   not explicitly enforced. If stricter ownership is needed, add an
//   explicit guard: if (activeRun && !currentState) { reject }.
if (event !== 'pipeline_start' && activeRun && hasOwner(currentState)) {
  if (currentState.ownerSessionId !== context.sessionID) {
    this.store.appendAudit(projectId, runId, {
      timestamp: new Date().toISOString(),
      runId,
      projectId,
      sessionId: context.sessionID,
      event,
      phase: currentState.currentPhase,
      decision: 'BLOCK' as const,
      violation: `owner_mismatch: session ${context.sessionID} vs owner ${currentState.ownerSessionId}`,
    })
    return JSON.stringify({
      ok: false,
      violation: 'Checkpoint rejected: this pipeline belongs to another session.',
      guidance: [
        'Sub-agents cannot advance pipeline state.',
        'Complete your assigned task and report results to the orchestrator.',
        'Do NOT attempt to create a new pipeline or retry this call.',
      ].join(' '),
    })
  }
}

// ── Step B: pipeline_start guards ────────────────────────────────────
// Three-layer defense: empty sessionID → single-pipeline constraint →
// stale/corrupted state ownership.
if (event === 'pipeline_start') {
  // Guard 1: reject empty sessionID (ownership requires valid sessionID)
  // No audit log: no session identity to record, and activeRun/runId may not exist yet.
  if (!context.sessionID) {
    return JSON.stringify({
      ok: false,
      violation: 'Cannot start pipeline: session ID is empty.',
      guidance: 'The checkpoint tool requires a valid session context. Ensure you are running in a project directory.',
    })
  }
  // Guard 2: single-pipeline constraint with stale awareness
  if (activeRun) {
    if (currentState) {
      // Non-stale: reject unconditionally
      if (!isStale(currentState.lastCheckpointAt, staleThresholdMs)) {
        this.store.appendAudit(projectId, activeRun.runId, {
          timestamp: new Date().toISOString(), runId: activeRun.runId, projectId,
          sessionId: context.sessionID, event, phase: currentState.currentPhase,
          decision: 'BLOCK' as const,
          violation: 'duplicate_pipeline: active non-stale pipeline already exists',
        })
        return JSON.stringify({
          ok: false,
          violation: 'A pipeline is already active for this project.',
          guidance: 'Only one pipeline per project is allowed. Complete or cancel the current pipeline first.',
        })
      }
      // Stale: only the owner may restart (prevents sub-agent hijack)
      if (hasOwner(currentState) && currentState.ownerSessionId !== context.sessionID) {
        this.store.appendAudit(projectId, activeRun.runId, {
          timestamp: new Date().toISOString(), runId: activeRun.runId, projectId,
          sessionId: context.sessionID, event, phase: currentState.currentPhase,
          decision: 'BLOCK' as const,
          violation: `owner_mismatch: session ${context.sessionID} vs owner ${currentState.ownerSessionId}`,
        })
        return JSON.stringify({
          ok: false,
          violation: 'A stale pipeline exists but belongs to another session.',
          guidance: 'Only the orchestrator can restart a stale pipeline. Sub-agents cannot create new pipelines.',
        })
      }
      // Stale + (owner match ∨ no owner [Phase 1]): allowed (pipeline restarted, old one archived)
    } else {
      // Corrupted state: activeRun exists but state file missing/unreadable.
      // Fail-closed: cannot verify ownership, so reject pipeline_start.
      // Consistent with fail-closed principle: when security-critical data
      // is unavailable, block the operation rather than allow it.
      this.store.appendAudit(projectId, activeRun.runId, {
        timestamp: new Date().toISOString(), runId: activeRun.runId, projectId,
        sessionId: context.sessionID, event, phase: -1,
        decision: 'BLOCK' as const,
        violation: 'corrupted_state: activeRun exists but state file missing/unreadable',
      })
      return JSON.stringify({
        ok: false,
        violation: 'An active pipeline run exists but its state is missing or corrupted. Cannot verify ownership.',
        guidance: 'Remove the stale run metadata manually, or investigate the state storage.',
      })
    }
  }
  // ── Fallthrough: all guards passed ───────────────────────
  // Inject owner identity into payload before applyTransition
  payload._ownerSessionId = context.sessionID
  return applyTransition(event, payload, context)
}

// ── Set ownerSessionId on pipeline_start ───────────────────────
// Applied via applyTransition: newState.ownerSessionId = payload._ownerSessionId
```

**`applyTransition` for `pipeline_start` (ownerSessionId assignment)**:

```typescript
// In transitions.ts, applyTransition function, 'pipeline_start' case:
// Phase 2 addition: bake ownerSessionId into the new state

case 'pipeline_start': {
  const payload = parsePayload(rawPayload)
  // Note: sessionID validation happens in CheckpointHandler.handle(),
  // not in this pure function. The handler rejects empty sessionID
  // before calling applyTransition.
  return {
    version: SCHEMA_VERSION,
    projectId: payload.projectId,
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    description: payload.description ?? '',
    ownerSessionId: payload._ownerSessionId ?? undefined,  // injected by handler
    currentPhase: 0,
    phaseStatus: 'idle',
    phases: {},
    ralph: null,
    testEvidenceConfirmed: false,
    lastCheckpointAt: new Date().toISOString(),
  }
}
```

**Schema**: `ownerSessionId?: string` — **optional for Phase 1 backward compatibility**. Phase 1 states on disk have no `ownerSessionId` field. Phase 2+ pipelines always have it set (enforced by CheckpointHandler rejecting empty sessionID before `pipeline_start` proceeds). The `hasOwner()` type guard narrows `PipelineState | null` to `OwnedPipelineState` (where `ownerSessionId: string` is mandatory) for type-safe access.

```typescript
// schema.ts
export interface OwnedPipelineState extends PipelineState {
  ownerSessionId: string  // mandatory — only present for Phase 2+ pipelines
}

/** Type guard: true when ownerSessionId is a non-empty string. */
export function hasOwner(state: PipelineState | null): state is OwnedPipelineState {
  return state !== null && typeof state.ownerSessionId === 'string' && state.ownerSessionId.length > 0
}
```

**Error message design**: The rejection message explicitly tells the sub-agent (1) why it was rejected, (2) what to do instead, and (3) what NOT to do. This minimizes compensating behaviors (retry loops, creating new pipelines).

### 5.5 Key Decisions Table

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| OpenCode hooks via plugin output keys | OpenCode dispatches `tool.execute.before`/`after` for **ALL** tools, not just plugin-registered ones | Wrapping only plugin tools (won't intercept `edit`/`write` built-ins) |
| `onToolBefore`: throw to block | OTQ-01: no abort field in plugin output, must throw to block execution | Return string (OpenCode ignores it) |
| Adaptive `PipelineStateCache` | Single-agent mode: in-memory cache (Phase 1 behavior, ~0.1ms). OMO multi-agent mode: always read disk (~1ms). Mode detected once at plugin init by checking OMO registration in `opencode.json`. Best of both worlds — zero regression in non-OMO, full safety in OMO. | Always-read-disk (unnecessary ~1ms overhead in non-OMO), Always-cache (unsafe in OMO), Config switch (user burden) |
| Fail-open on state read failure | Disk read failure → null → hooks treat as "no pipeline" (AC-8). Infrastructure failure = safest degradation is to not intercept. | Fail-closed (blocks all tools on disk read error — overly aggressive) |
| Fail-closed on interceptor error | Interceptor failure root causes are infrastructure issues (corrupted state, OOM, runtime bugs), not transient errors. Retry unlikely to succeed. Tool blocked with "restart pipeline" guidance. | Fail-open (silent bypass = security gap, violates TDD invariants) |
| Fail-open + dual-channel degradation on observer error | Observer failure also infrastructure-level, but tool has already executed — blocking result is pointless. In-memory flag tells AC-2 to skip check (hot path). Persisted `_observer_degraded` ObservationEntry allows downstream (Ralph reviewer, MCP tools) to perform substitute verification (cold path). | Fail-closed (tool result already produced, blocking it helps nothing) |
| Structural ownership enforcement | For non-`pipeline_start` events: ownership check (Step A) runs before stale check. For `pipeline_start`: stale check runs first but non-stale path rejects ALL sessions unconditionally; stale path checks ownership before allowing restart. Net invariant: non-owners never see stale recovery prompts. | Stale check first for all events (sub-agent sees recovery prompt → hijacks pipeline), or ownership-only for pipeline_start (misses non-stale duplicate case) |
| Stale pipeline_start: owner-only restart | Stale pipelines may be restarted, but only by the original owner session. Prevents sub-agent from becoming new owner via stale recovery path. Phase 1 pipelines excepted — see backward-compat decision below. | Unconditional reject on stale (blocks legitimate owner recovery), unconditional allow on stale (sub-agent hijack) |
| Fail-closed on corrupted state (`pipeline_start` only) | When activeRun exists but state file is missing/unreadable, ownership cannot be verified. Block pipeline_start rather than allow any session to become owner. | Fail-open (any session becomes owner during crash-recovery window) |
| `hasOwner()` type guard with empty-string rejection | `ownerSessionId?: string` in schema for Phase 1 compat. Type guard narrows to `OwnedPipelineState` (mandatory string) only when value is non-empty string. Provides type narrowing that truthiness check cannot. | Direct truthiness check `if (state.ownerSessionId)` — no type narrowing to `OwnedPipelineState`, no explicit empty-string guard |
| Reject empty sessionID on `pipeline_start` | Ownership requires a valid session identity. Empty/falsy sessionID means we can't assign or verify ownership. Reject before any state mutation. | Allow empty (creates unowned pipeline, defeats ownership model) |
| Single-pipeline constraint (session-agnostic) | Only one pipeline per project at a time. Applies to ALL sessions including the owner — prevents duplicate state files. Non-stale active pipeline → unconditional reject for everyone. | Owner override (owner can start second pipeline — duplicate state files, race conditions) |
| Phase 1 backward compatibility (ownership skip) | Phase 1 states have no `ownerSessionId`. `hasOwner()` returns false → ownership check skipped. This means any session can write Phase 1 pipelines. Accepted because Phase 1 was designed without multi-agent awareness — enforcing ownership would break existing pipelines. | Fail-closed on Phase 1 (rejects all writes to legacy pipelines — migration disaster), Auto-migrate (adds ownerSessionId to Phase 1 states — requires knowing original session, impossible) |
| `ObservationEntry` in `PipelineStore` | Same key structure (`projectId/runId`), avoids second StateStore instance | Separate observation store (unnecessary complexity) |
| Accept all `Task` calls as reviews | OQ-1: false positives harmless (extra observation), false negatives dangerous (missed review) | Keyword matching (fragile, couples to prompt wording) |
| Articulation: simple pattern matching | A-3: false positives/negatives acceptable; Ralph catches errors | LLM-based validation (overkill, latency, cost) |
| Degradation counter: in-memory only | Advisory, not blocking; lost on restart is acceptable | Persisted counter (schema bloat for advisory feature) |
| Config-driven phase deliverable patterns | Project naming conventions vary widely; defaults cover common cases, config covers the rest. File IS source of truth — no merge logic. | Hardcoded only (inflexible), gitignore format (can't express phase→pattern mapping), JSON (no comments) |
| JSONC config (strip comments + JSON.parse) | No external dependency needed: `strip-json-comments` (~1KB, ~40 lines) + built-in `JSON.parse`. Avoids YAML parsing complexity (yes/no boolean traps, indentation errors, 80+ page spec). | Full `yaml` library (heavy, ~200KB), minimal YAML parser (~200 lines custom code), TOML (no Node.js built-in parser) |
| Pipeline ownership (`ownerSessionId`) | Multi-agent safety (§15a): only orchestrator session can write pipeline state. Prevents race conditions on `state.json` and duplicate pipelines. Overhead: one string comparison per checkpoint call. | No ownership (any session can write state — race conditions in OMO), Distributed lock (complex, overkill for local filesystem) |
| Config-driven `monitoredTools` | OMO registers custom editing tools (e.g., `hashline_edit`) that bypass hardcoded `edit`/`write` check. Config allows users to add these tools without code changes. Default covers OpenCode built-ins. | Hardcoded `edit`/`write` only (misses OMO tools), Auto-detect all tools with file args (false positives from non-editing tools) |

### 5.6 Non-functional Constraints Table

| Dimension | Requirement | Design Response |
|-----------|-------------|----------------|
| Hook latency | < 5ms per tool call (A-4) | Adaptive (§5.1): non-OMO ~0.1ms (memory cache), OMO ~1ms (disk read). Interceptor + Observer: cache/disk read + regex + rules + optional appendFileSync. |
| Fail semantics (asymmetric) | Interceptor: fail-closed. Observer: fail-open with dual-channel degradation. | **Interceptor** (`onToolBefore`): both `WatchdogInterceptError` (expected) and unexpected errors block tool execution. **Observer** (`onToolAfter`): tool already executed, blocking result is pointless. Dual-channel degradation: (1) in-memory `degradedRounds` flag for AC-2 hot-path skip, (2) persisted `_observer_degraded` ObservationEntry for downstream substitute verification. |
| Data isolation | PipelineState not in LLM context | Hooks are server-side only, no LLM exposure. Observations are stored server-side. |
| Reversibility | Intercept blocks are temporary | throw message includes guidance on how to proceed (e.g., "confirm test evidence first") |
| Cache consistency | Adaptive (§5.1): non-OMO uses in-memory cache (single-writer, synchronous update); OMO reads from disk every call (multi-agent safe). Single-writer enforced by ownerSessionId in both modes. |
| Memory | Session buffer bounded (1000 entries) | `SESSION_BUFFER_MAX_SIZE` constant, FIFO eviction on overflow |

### 5.7 Build & Deploy Strategy

Same as Phase 1 §8:

- **Pure TypeScript**, no external dependencies beyond `@opencode-ai/core` and `@opencode-ai/plugin`
- **Bundled into single plugin/index.js** alongside aristotle and reflection packages
- **No separate deployment** — watchdog code ships with the existing plugin bundle
- **New dependency**: `strip-json-comments` (~1KB) for JSONC parsing. No external YAML dependency.

**Package.json** (unchanged from Phase 1):

```json
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

**Plugin integration** (unchanged):

```typescript
// plugin/index.ts
import { assemblePlugin } from '@opencode-ai/core/plugin/registration'
import { createAristotleRole } from '@opencode-ai/reflection'
import { createWatchdogRole } from '@opencode-ai/watchdog'

export default async function (ctx: any) {
  const aristotleRole = await createAristotleRole(ctx)
  const watchdogRole = await createWatchdogRole(ctx)
  return assemblePlugin(ctx, [aristotleRole, watchdogRole])
}
```

## 6. Module A: Event Observation (US-1, US-6)

### 6.1 Component Overview

Module A implements the `tool.execute.after` hook (`watchdog.onToolAfter`). It observes every tool execution, classifies `Task` tool calls during active Ralph loops as reviewer spawns, and maintains a passive observation buffer for out-of-pipeline tool calls.

Two data paths:

1. **Pipeline-active path** (AC-1): Active pipeline in `ralph_loop` → structured `ObservationEntry` → `PipelineStore` (persisted)
2. **No-pipeline path** (AC-10): No active pipeline → minimal `{tool, callID, timestamp}` → `SessionBuffer` (in-memory, bounded)

Both paths are **fire-and-forget** — errors are logged, never thrown (fail-open). On failure, the Observer sets an internal `degradedRounds` flag so AC-2 knows observations may be incomplete for that round, and persists a `_observer_degraded` ObservationEntry so downstream consumers (Ralph reviewer, MCP tools) can perform substitute verification.

### 6.2 Observer (`observer.ts`)

```typescript
// packages/watchdog/src/observer.ts

import type { Logger } from '@opencode-ai/core/logger'
import type { PipelineStateCache } from './state-cache.js'
import type { PipelineStore } from './pipeline-store.js'
import type { SessionBuffer } from './session-buffer.js'
import type { ObservationEntry } from './schema.js'
import { OBS_TYPE_REVIEWER_SPAWNED } from './schema.js'

export interface ObserverDeps {
  cache: PipelineStateCache
  store: PipelineStore
  sessionBuffer: SessionBuffer
  logger: Logger
}

/**
 * Observes tool execution via `onToolAfter` hook.
 *
 * Design: Phase2-ActiveMonitoring.md §6.2
 *
 * Logic:
 * 1. If tool === 'Task' AND active pipeline in ralph_loop
 *    → record _reviewer_spawned ObservationEntry with round = ralph.round + 1
 * 2. Else if no active pipeline
 *    → record minimal entry to SessionBuffer
 * 3. Else → no-op
 *
 * Failure handling (fail-open with dual-channel degradation):
 * - Errors are caught and never thrown (tool has already executed).
 * - Channel 1 (hot path): in-memory degradedRounds/degradedRuns flag
 *   → AC-2 queries isDegraded() and skips violation check immediately.
 * - Channel 2 (cold path): persisted _observer_degraded ObservationEntry
 *   → downstream consumers (Ralph reviewer, MCP tools, human audit)
 *   → can read this event and perform substitute verification against original data.
 * - Root causes are infrastructure issues (disk I/O failure, corrupted cache, OOM).
 */
export class Observer {
  private cache: PipelineStateCache
  private store: PipelineStore
  private sessionBuffer: SessionBuffer
  private logger: Logger

  /**
   * Tracks rounds where observer failed — AC-2 should not enforce violations
   * for these rounds because observations may be incomplete.
   * Key: `${projectId}/${runId}`, Value: set of degraded round numbers.
   */
  private degradedRounds = new Map<string, Set<number>>()

  /** Tracks runs where observer failed outside round context (e.g., cache.get() threw). */
  private degradedRuns = new Set<string>()

  constructor(deps: ObserverDeps) {
    this.cache = deps.cache
    this.store = deps.store
    this.sessionBuffer = deps.sessionBuffer
    this.logger = deps.logger
  }

  /**
   * Check if observations for a given round may be incomplete.
   * Called by AC-2 (CheckpointHandler) before enforcing reviewer-presence violations.
   */
  isDegraded(projectId: string, runId: string, round: number): boolean {
    const key = `${projectId}/${runId}`
    return this.degradedRuns.has(key)
      || (this.degradedRounds.get(key)?.has(round) ?? false)
  }

  /**
   * Clear degradation data for a completed pipeline run.
   * Called by CheckpointHandler on phase_complete(5) to prevent memory leaks
   * in long-running plugin processes.
   */
  clearDegradation(projectId: string, runId: string): void {
    const key = `${projectId}/${runId}`
    this.degradedRounds.delete(key)
    this.degradedRuns.delete(key)
  }

  /**
   * `onToolAfter` handler — called by assemblePlugin for EVERY tool execution.
   *
   * @param tool    — tool name (e.g., 'Task', 'edit', 'write')
   * @param args    — tool arguments (opaque, only logged on debug)
   * @param output  — tool output (opaque, not used by observer)
   * @param sessionId — OpenCode session identifier
   */
  async handle(
    tool: string,
    args: unknown,
    output: unknown,
    sessionId: string,
    callID: string,
  ): Promise<void> {
    try {
      const state = this.cache.get()

      if (state && state.phaseStatus === 'ralph_loop' && tool === 'Task') {
        // Path 1: Active pipeline in ralph_loop — structured observation
        const round = (state.ralph?.round ?? 0) + 1
        const entry: ObservationEntry = {
          timestamp: new Date().toISOString(),
          type: OBS_TYPE_REVIEWER_SPAWNED,
          tool,
          callID,
          round,
          metadata: { sessionId },
        }
        this.store.appendObservation(state.projectId, state.runId, entry)
        this.logger.debug(
          'Observer: recorded _reviewer_spawned for round %d (project %s)',
          round,
          state.projectId,
        )
        return
      }

      if (!state) {
        // Path 2: No active pipeline — session buffer
        this.sessionBuffer.record(sessionId, {
          tool,
          callID,
          timestamp: new Date().toISOString(),
        })
        return
      }

      // Path 3: Active pipeline but not ralph_loop, or non-Task tool → no-op
      this.logger.debug('Observer: no-op for tool %s (phaseStatus: %s)', tool, state?.phaseStatus)
    } catch (err) {
      // Fail-open: tool has already executed, never throw from onToolAfter.
      // Dual-channel degradation recovery:
      //   Channel 1 (hot path): in-memory flag → AC-2 skips immediately
      //   Channel 2 (cold path): persisted _observer_degraded entry → downstream
      //     consumers (Ralph reviewer, MCP tools, human audit) can read this
      //     and perform substitute verification against original data
      this.logger.warn('Observer error (suppressed): %s', String(err))

      // Mark degraded if we were in an active pipeline context
      try {
        const state = this.cache.get()
        if (state) {
          const key = `${state.projectId}/${state.runId}`
          const degradedRound = state.phaseStatus === 'ralph_loop'
            ? (state.ralph?.round ?? 0) + 1
            : undefined

          // Channel 1: in-memory flag (hot path — AC-2 queries this)
          if (degradedRound !== undefined) {
            let rounds = this.degradedRounds.get(key)
            if (!rounds) {
              rounds = new Set()
              this.degradedRounds.set(key, rounds)
            }
            rounds.add(degradedRound)
          } else {
            this.degradedRuns.add(key)
          }

          // Channel 2: persisted degradation event (cold path — downstream audit)
          // Allows Ralph reviewer / MCP tools to detect observer failure and
          // perform substitute verification against original data sources.
          this.store.appendObservation(state.projectId, state.runId, {
            timestamp: new Date().toISOString(),
            type: '_observer_degraded',
            tool,
            callID,
            round: degradedRound,
            metadata: { error: String(err) },
          })

          this.logger.warn(
            'Observer degraded for project %s run %s%s — AC-2 will skip; downstream should verify',
            state.projectId,
            state.runId,
            degradedRound !== undefined ? ` round ${degradedRound}` : '',
          )
        }
      } catch {
        // Degradation tracking itself failed — nothing more we can do.
        // Channel 1 (in-memory) may still be valid if the inner try
        // failed after setting the flag but before persisting.
        // The original error is already logged above.
      }
    }
  }
}
```

**Data flow diagram:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Path 1: Active pipeline, ralph_loop, tool === 'Task'                    │
│                                                                          │
│  onToolAfter('Task', args, output, sessionId)                            │
│    → cache.get() → PipelineState (ralph_loop, round=N)                   │
│    → entry: ObservationEntry { type: '_reviewer_spawned', round: N+1 }   │
│    → store.appendObservation(projectId, runId, entry)                    │
│    → persisted to watchdog/{projectId}/{runId}/observations (.jsonl)     │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  Path 2: No active pipeline                                              │
│                                                                          │
│  onToolAfter(tool, args, output, sessionId)                              │
│    → cache.get() → null                                                  │
│    → sessionBuffer.record(sessionId, {tool, callID, timestamp})          │
│    → in-memory Map<string, Array<...>>                                   │
│    → cleared on session end / plugin restart                             │
└──────────────────────────────────────────────────────────────────────────┘
```

**OQ-1 Resolution**: All `Task` calls are accepted as potential reviews. The `args` and `output` fields are **not inspected** for review-related keywords. False positives (Task calls for non-review purposes) are harmless — they create extra observation records that AC-2 may see as "reviewer present". False negatives (missing a review spawn) are dangerous — they would cause AC-2 violations. Keyword matching was rejected as fragile (couples to prompt wording), and requiring a flag was rejected as adding LLM protocol friction.

### 6.3 SessionBuffer (`session-buffer.ts`)

```typescript
// packages/watchdog/src/session-buffer.ts

import type { Logger } from '@opencode-ai/core/logger'
import { SESSION_BUFFER_MAX_SIZE } from './constants.js'

export interface SessionBufferEntry {
  tool: string
  callID: string
  timestamp: string
}

/**
 * In-memory per-session observation buffer.
 *
 * Design: Phase2-ActiveMonitoring.md §6.3
 *
 * Holds tool call records for sessions without an active pipeline.
 * NOT persisted — cleared on session end or plugin restart.
 *
 * Bounded by SESSION_BUFFER_MAX_SIZE per session. FIFO eviction on overflow.
 */
export class SessionBuffer {
  private buffers = new Map<string, SessionBufferEntry[]>()
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /**
   * Record a tool call observation for a session.
   * If the session's buffer exceeds SESSION_BUFFER_MAX_SIZE, oldest entries
   * are evicted (FIFO).
   */
  record(sessionId: string, entry: SessionBufferEntry): void {
    let buffer = this.buffers.get(sessionId)
    if (!buffer) {
      buffer = []
      this.buffers.set(sessionId, buffer)
    }

    buffer.push(entry)

    // FIFO eviction
    while (buffer.length > SESSION_BUFFER_MAX_SIZE) {
      buffer.shift()
      this.logger.debug('SessionBuffer: FIFO eviction for session %s', sessionId)
    }
  }

  /** Get all buffered entries for a session. Returns empty array if none. */
  getSession(sessionId: string): SessionBufferEntry[] {
    return this.buffers.get(sessionId)?.slice() ?? []
  }

  /** Clear all entries for a session. Called on session end. */
  clearSession(sessionId: string): void {
    this.buffers.delete(sessionId)
  }

  /** Get count of tracked sessions (for diagnostics). */
  sessionCount(): number {
    return this.buffers.size
  }
}
```

> **Note on `clearSession()`**: `clearSession()` is reserved for future Phase 3 integration. In Phase 2, stale buffers are bounded by `SESSION_BUFFER_MAX_SIZE` (FIFO eviction) and cleared on plugin restart.

**Bounded FIFO eviction logic**: Each session has an independent buffer. When `record()` pushes the buffer past `SESSION_BUFFER_MAX_SIZE` (1000), `Array.shift()` removes the oldest entry. This is O(n) per eviction, but with max 1000 entries and one shift per overflow, the amortized cost is negligible for the expected observation rate (tens of tool calls per session, not thousands).

### 6.4 AC-2 Integration (`checkpoint.ts` update)

Before accepting a `ralph_round_complete` event, the checkpoint handler must verify that a `_reviewer_spawned` observation exists for the round being completed. **If the Observer was degraded for that round** (infrastructure failure prevented observation), AC-2 is skipped with a warning — a false violation is worse than a missed check.

**Where**: In `CheckpointHandler.handle()`, after step 5 (validateTransition returns valid) and before step 7 (applyTransition + writeState). This is an **additional validation layer** that reads the observation store — it is I/O, so it belongs in `checkpoint.ts`, not in `transitions.ts` (which is pure, no I/O).

**Dependency**: `CheckpointHandler` now requires an `Observer` reference (added as constructor parameter) to query `observer.isDegraded(projectId, runId, round)`.

**Pseudocode**:

```typescript
// Inside CheckpointHandler.handle(), after validateTransition, before applyTransition:

if (event === 'ralph_round_complete') {
  const payloadRound = Number(payload.round)

  // Check if Observer was degraded for this round — skip AC-2 if so
  if (this.observer.isDegraded(projectId, runId, payloadRound)) {
    this.logger.warn(
      'AC-2 skipped: observer was degraded during round %d (project %s run %s) — observations may be incomplete',
      payloadRound, projectId, runId,
    )
    // Fall through to applyTransition — don't block on potentially false violation
  } else {
    const observations = this.store.findObservations(
      projectId,
      runId,
      { type: OBS_TYPE_REVIEWER_SPAWNED, round: payloadRound }
    )

    if (observations.length === 0) {
      const msg = `Round ${payloadRound} completed without a reviewer subagent`
      this.logger.warn('AC-2 violation: %s (project %s run %s)', msg, projectId, runId)
      this.store.appendAudit(projectId, runId, {
        timestamp: now,
        runId,
        projectId,
        sessionId: context.sessionID,
        event: 'ralph_round_complete',
        phase: state.currentPhase,
        round: payloadRound,
        decision: 'BLOCK',
        violation: msg,
      })
      return JSON.stringify({ ok: false, violation: msg, guidance:
        'Spawn a reviewer subagent (Task tool) before completing this Ralph round.'
      })
    }
  }
}
```

**Multiple spawns in same round**: `findObservations` returns all matching entries. The check is `length === 0` (at least one required). Multiple `_reviewer_spawned` entries for the same round are idempotent — the first one satisfies AC-2.

**Round mismatch**: If a `_reviewer_spawned` observation exists for round N but the checkpoint claims round N+1, `findObservations({round: N+1})` returns empty → violation. This correctly catches "reviewer spawned in wrong round" (AC-2 edge case).

**Observer degradation semantics**: When the observer sets `degradedRounds` for a round, AC-2 skips enforcement for that round entirely. This means: if the observer crashed AND a reviewer was actually not spawned, the violation is silently missed. This is acceptable because (1) observer crashes indicate infrastructure failure, (2) the Ralph reviewer is the primary safety net regardless, and (3) a false violation (blocking a valid round) is more disruptive than a missed check during infrastructure failure.

### 6.5 Observation Storage (`PipelineStore` extension)

```typescript
// Added to PipelineStore class in pipeline-store.ts

/**
 * Append an observation entry to the observation log.
 * Key: watchdog/{projectId}/{runId}/observations (.jsonl)
 *
 * Called by the Observer (Module A) when a Task call is detected during ralph_loop.
 */
appendObservation(
  projectId: string,
  runId: string,
  entry: ObservationEntry,
): void {
  const key = this.observationKey(projectId, runId)
  this.stateStore.appendLog(key, JSON.stringify(entry))
  this.logger.debug('Appended observation to %s', key)
}

/**
 * Read all observations for a run.
 * Returns empty array if file not found or unreadable.
 */
readObservations(
  projectId: string,
  runId: string,
): ObservationEntry[] {
  const key = this.observationKey(projectId, runId)
  const lines = this.stateStore.readLog(key) ?? []
  return lines
    .map(line => {
      try {
        return JSON.parse(line) as ObservationEntry
      } catch {
        this.logger.warn('Corrupt observation line in %s: %s', key, line)
        return null
      }
    })
    .filter((e): e is ObservationEntry => e !== null)
}

/**
 * Find observations by type and/or round.
 * Used by checkpoint validation (AC-2) to verify reviewer presence.
 */
findObservations(
  projectId: string,
  runId: string,
  filter: { type?: string; round?: number },
): ObservationEntry[] {
  const all = this.readObservations(projectId, runId)
  return all.filter(e => {
    if (filter.type && e.type !== filter.type) return false
    if (filter.round !== undefined && e.round !== filter.round) return false
    return true
  })
}

// Private path helper
private observationKey(projectId: string, runId: string): string {
  return `watchdog/${projectId}/${runId}/observations`
}
```

**Storage format**: `.jsonl` (one JSON object per line), same as audit log. Each line is a self-contained `ObservationEntry`.

**Key**: `watchdog/{projectId}/{runId}/observations`

**Physical file**: `{baseDir}/watchdog/{projectId}/{runId}/observations.jsonl`

### 6.6 Failure Mode Handling

| Failure Scenario | Priority | Design Response |
|-----------------|----------|----------------|
| Observation write fails | Peripheral | Log warning, continue (observation is diagnostic, not critical) |
| Session buffer overflow | Peripheral | FIFO eviction, log info |
| Missing `_reviewer_spawned` in round | Key | AC-2 violation at `ralph_round_complete` time |
| `cache.get()` returns stale state | Peripheral | Observation uses stale `ralph.round` → off-by-one in round field. Mitigated by cache.update() synchronously on every checkpoint write (§5.1). |
| `findObservations` disk read fails | Peripheral | Returns empty array → AC-2 violation triggers (conservative: when in doubt, require reviewer). Logged as warning. |
| Observer throws unexpectedly | Key | Caught by outer try/catch in `handle()`. Dual-channel degradation: (1) in-memory flag for AC-2 hot-path skip, (2) persisted `_observer_degraded` ObservationEntry for downstream substitute verification. Root causes are infrastructure failures (disk I/O, OOM). |

### 6.7 Test Plan Summary

| Test | Module | Expected Result |
|------|--------|----------------|
| Observer: Task call with active pipeline in `ralph_loop` | observer.ts | `_reviewer_spawned` ObservationEntry appended with `round = ralph.round + 1` |
| Observer: Task call without active pipeline | observer.ts | Entry recorded in SessionBuffer for that session |
| Observer: Non-Task call (`edit`, `write`) | observer.ts | No observation recorded (no-op) |
| Observer: Multiple Task calls in same round | observer.ts | Multiple ObservationEntries with same round value |
| Observer: Task call with active pipeline not in `ralph_loop` | observer.ts | No observation recorded (phaseStatus != ralph_loop) |
| Observer: `handle()` throws unexpected error during active ralph_loop | observer.ts | Error caught, dual-channel degradation: (1) in-memory flag set for current round, (2) `_observer_degraded` ObservationEntry persisted to store. `isDegraded(projectId, runId, round)` returns `true` |
| Observer: `handle()` throws when cache.get() fails | observer.ts | Error caught, dual-channel degradation: `degradedRuns` set for run key + persisted entry. `isDegraded()` returns `true` for any round in that run |
| Observer: `isDegraded()` returns `false` for non-degraded round | observer.ts | No error occurred, `isDegraded()` returns `false` |
| Observer: Degradation tracking itself fails (nested catch) | observer.ts | Original error still logged, no unhandled exception |
| Observer: `clearDegradation()` after `phase_complete(5)` | observer.ts | In-memory flag cleared, subsequent `isDegraded()` returns `false` |
| Observer: Persisted `_observer_degraded` entry readable by downstream | observer.ts | Store contains entry with `type: '_observer_degraded'`, downstream (Ralph reviewer, MCP) can query it |
| AC-2: Round complete with matching observation | checkpoint.ts | Returns `ok: true` |
| AC-2: Round complete without observation | checkpoint.ts | Returns violation "Round N completed without a reviewer subagent" |
| AC-2: Round complete without observation BUT observer degraded | checkpoint.ts | AC-2 skipped, warning logged, round proceeds (no violation) |
| AC-2: Round complete with observation for wrong round | checkpoint.ts | Returns violation (round mismatch) |
| SessionBuffer: record within bounds | session-buffer.ts | All entries retained, getSession returns correct array |
| SessionBuffer: overflow → FIFO eviction | session-buffer.ts | Oldest entries dropped, newest retained |
| SessionBuffer: clearSession | session-buffer.ts | getSession returns empty array |

## 7. Module B: File Interception (US-2, US-3)

### 7.1 Component Overview

Module B implements the `tool.execute.before` interceptor. It blocks file writes that violate TDD pipeline invariants before the tool executes. The interceptor is passive when no pipeline is active (AC-8), only inspects tools listed in `monitoredTools` config (C-3, default: `edit`/`write`; §15a L3), and evaluates rules in strict declaration order (C-7).

Components:

- **Interceptor** (`interceptor.ts`): Entry point. Orchestrates extraction → resolution → classification → rule evaluation → throw or allow.
- **PathExtractor** (`path-extractor.ts`): Pure function extracting target path from tool-specific arg shapes (OQ-3).
- **FileClassifier** (`file-classifier.ts`): Pure function mapping absolute paths to file categories using TechSpec §3.2.2 priority-ordered rules (C-4, C-6).
- **InterceptRules** (`intercept-rules.ts`): Array of rule objects implementing AC-3 and AC-4.

Path resolution converts relative paths to absolute using the session worktree root (resolved from OpenCode `context.worktree` at plugin initialization) before classification (C-6).

---

### 7.2 Interceptor (`interceptor.ts`)

```typescript
// packages/watchdog/src/interceptor.ts

import { resolve } from 'node:path'
import type { Logger } from '@opencode-ai/core/logger'
import type { PipelineState } from './schema.js'
import type { PipelineStateCache } from './state-cache.js'
import { extractFilePath } from './path-extractor.js'
import { classifyFile, type FileClassification } from './file-classifier.js'
import { interceptRules } from './intercept-rules.js'

/**
 * Thrown when the interceptor blocks a tool call due to a TDD invariant violation.
 * This is an EXPECTED throw — the tool is intentionally blocked.
 * The message includes guidance on how to proceed.
 */
export class WatchdogInterceptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchdogInterceptError'
  }
}

export class Interceptor {
  private cache: PipelineStateCache
  private logger: Logger
  private worktreeRoot: string
  private deliverablePatterns: PhaseDeliverablePatterns
  private ignorePatterns: string[]
  private monitoredTools: Set<string>

  constructor(opts: {
    cache: PipelineStateCache
    logger: Logger
    worktreeRoot: string
    deliverablePatterns: PhaseDeliverablePatterns
    ignorePatterns: string[]
    monitoredTools: string[]
  }) {
    this.cache = opts.cache
    this.logger = opts.logger
    this.worktreeRoot = opts.worktreeRoot
    this.deliverablePatterns = opts.deliverablePatterns
    this.ignorePatterns = opts.ignorePatterns
    this.monitoredTools = new Set(opts.monitoredTools)
  }

  /** Bound to RoleRegistration.onToolBefore */
  async handle(tool: string, args: unknown, sessionId: string, callID: string): Promise<void> {
    try {
      // a. Only intercept configured file-writing tools (C-3 + §X L2)
      if (!this.monitoredTools.has(tool)) {
        return
      }

      // b. Read cache — null means no active pipeline (AC-8)
      const state = this.cache.get()
      if (state === null) {
        return
      }

      // c. Extract file path from args
      const rawPath = extractFilePath(tool, args)
      if (rawPath === null) {
        this.logger.warn('Interceptor: %s call missing target path', tool)
        return
      }

      // d. Resolve to absolute path (C-6)
      const absolutePath = resolve(this.worktreeRoot, rawPath)

      // e. Classify file (config-driven Rule 4, ignorePatterns as Rule 0)
      const classification = classifyFile(absolutePath, this.deliverablePatterns, this.ignorePatterns)

      // f. Evaluate rules in order (C-7)
      for (const rule of interceptRules) {
        if (rule.applies(tool, absolutePath, classification, state)) {
          const violation = rule.check(tool, absolutePath, classification, state)
          if (violation !== null) {
            this.logger.info(
              'Interceptor blocked %s to %s: %s (phase %d, run %s)',
              tool, absolutePath, rule.name, state.currentPhase, state.runId,
            )
            throw new WatchdogInterceptError(violation)
          }
        }
      }

      // g. No match → allow execution

    } catch (err) {
      if (err instanceof WatchdogInterceptError) {
        // Expected interception — propagate to LLM with guidance
        throw err
      }
      // Unexpected error — fail-closed: block tool, report infrastructure failure
      this.logger.error('Interceptor unexpected error: %s', String(err))
      throw new Error(
        `⛔ [TDD Watchdog] Internal error during interception. ` +
        `Tool execution blocked for safety. Error: ${String(err)}. ` +
        `Please check watchdog logs and restart the pipeline if needed.`
      )
    }
  }
}
```

**Fail-closed design rationale**: The interceptor's job is to **prevent violations**. If the interceptor itself fails, its prevention capability is zero. Allowing the tool through on error (fail-open) would create a silent security gap — a TDD invariant violation would go undetected. Since interceptor failures are caused by infrastructure issues (corrupted cache, OOM, runtime bugs), retry is unlikely to succeed. The fail-closed approach blocks the tool and surfaces the error to the LLM, which can notify the user.

**Execution flow diagram:**

```
tool.execute.before fires
  │
  ├─► monitoredTools.has(tool)? ──No──► return silently (C-3)
  │
  ├─► cache.get() ──null──► return silently (AC-8)
  │
  ├─► extractFilePath(tool, args) ──null──► log warning, return
  │
  ├─► resolve(worktreeRoot, rawPath) → absolutePath (C-6)
  │
  ├─► classifyFile(absolutePath) → FileClassification (C-4)
  │
  ├─► for each rule in interceptRules (C-7):
  │       applies()? ──No──► next rule
  │         │
  │         └─► check()? ──null──► next rule
  │               │
  │               └─► violation ──► throw WatchdogInterceptError(violation)
  │
  ├─► no match ──► return (allow execution)
  │
  └─► [catch unexpected error] ──► throw Error("⛔ infrastructure failure")
```

---

### 7.3 PathExtractor (`path-extractor.ts`)

```typescript
// packages/watchdog/src/path-extractor.ts

/**
 * Extract the target file path from tool arguments.
 *
 * OQ-3 Resolution (built-in tools):
 *   - edit:  args.filePath (string)
 *   - write: args.file    (string)
 *
 * Generic fallback (custom tools from monitoredTools config):
 *   Tries common field names in priority order:
 *   filePath > file > path > file_path
 *   First non-empty string wins.
 *
 * Returns null if no path field found or not a string.
 */
export function extractFilePath(tool: string, args: unknown): string | null {
  if (typeof args !== 'object' || args === null) {
    return null
  }

  const a = args as Record<string, unknown>

  // Known tool-specific fields (OQ-3)
  if (tool === 'edit' && typeof a.filePath === 'string') {
    return a.filePath
  }

  if (tool === 'write' && typeof a.file === 'string') {
    return a.file
  }

  // Generic fallback for custom tools (e.g., OMO hashline_edit)
  // Tries common field names in priority order
  for (const field of ['filePath', 'file', 'path', 'file_path']) {
    if (typeof a[field] === 'string' && (a[field] as string).length > 0) {
      return a[field] as string
    }
  }

  return null
}
```

**Rationale**: Known tool fields are checked first for precision (avoids false positives from unrelated `path` fields). The generic fallback handles custom editing tools without requiring per-tool schema knowledge. If a custom tool uses an unusual field name not in the fallback list, the path won't be extracted → interceptor logs a warning and allows the write (safe degradation).

---

### 7.4 FileClassifier (`file-classifier.ts`)

```typescript
// packages/watchdog/src/file-classifier.ts

export type FileCategory =
  | 'test_file'
  | 'business_code'
  | 'phase_deliverable'
  | 'unknown'

export interface FileClassification {
  category: FileCategory
  phase?: number  // populated when category === 'phase_deliverable'
}

/**
 * Phase deliverable pattern definition.
 * Loaded from .opencode/watchdog.jsonc or code fallback.
 */
export interface PhaseDeliverablePatterns {
  [phase: number]: string[]  // glob patterns, e.g., ['requirements*.md', 'prd*.md']
}

/**
 * Classify an absolute file path using priority-ordered rules.
 *
 * Rules evaluated top-to-bottom; first match wins.
 * Classification is path-based — the target file need not exist (C-4).
 *
 * Rule 4 patterns are injected from watchdog config (§7.4.1).
 * Rules 1-3 are hardcoded (structural patterns that don't vary by project).
 */
export function classifyFile(
  absolutePath: string,
  deliverablePatterns: PhaseDeliverablePatterns,
  ignorePatterns: string[] = [],
): FileClassification {
  const lower = absolutePath.toLowerCase()

  // Rule 0: ignore patterns — classified as 'unknown' regardless of all other rules
  // Applies globally: if a file matches here, it bypasses test, business_code,
  // and phase_deliverable classifications. Use for files that would falsely match
  // any rule (e.g., 'technical-notes.md' matching 'technical*.md' in Rule 4).
  const basename = lower.split(/[\\/]/).pop() ?? ''
  for (const ignore of ignorePatterns) {
    if (globToRegex(ignore).test(basename)) {
      return { category: 'unknown' }
    }
  }

  // Rule 1: test directories
  if (/[\\/]test[\\/]/.test(lower) ||
      /[\\/]tests[\\/]/.test(lower) ||
      /[\\/]__tests__[\\/]/.test(lower) ||
      /[\\/]spec[\\/]/.test(lower)) {
    return { category: 'test_file' }
  }

  // Rule 2: test filename patterns
  if (/\.test\.[^.]+$/.test(lower) ||
      /\.spec\.[^.]+$/.test(lower) ||
      /_test\.[^.]+$/.test(lower) ||
      /test_[^/]*\.py$/.test(lower)) {
    return { category: 'test_file' }
  }

  // Rule 3: business code directories
  if (/[\\/]src[\\/]/.test(lower) ||
      /[\\/]lib[\\/]/.test(lower) ||
      /[\\/]app[\\/]/.test(lower)) {
    return { category: 'business_code' }
  }

  // Rule 4: phase deliverable filename patterns (config-driven, C-4)
  // basename already extracted for Rule 0
  for (const [phaseStr, patterns] of Object.entries(deliverablePatterns)) {
    const phase = Number(phaseStr)
    for (const pattern of patterns) {
      // Convert glob to regex: *.md → .*\.md, * → .*
      const re = globToRegex(pattern)
      if (re.test(basename)) {
        return { category: 'phase_deliverable', phase }
      }
    }
  }

  // Rule 5: default
  return { category: 'unknown' }
}

/**
 * Convert a simple glob pattern to a case-insensitive regex.
 * Supports: * (any chars), ? (single char), everything else literal.
 * Pattern is anchored to start and end of filename.
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials
    .replace(/\*/g, '.*')                     // * → .*
    .replace(/\?/g, '.')                      // ? → .
  return new RegExp(`^${escaped}$`, 'i')
}
```

**Priority-ordered classification rules:**

| Priority | Pattern | Category | Phase | Source |
|----------|---------|----------|-------|--------|
| 0 | Filename matches `ignorePatterns` entry (global override — bypasses ALL other rules) | `unknown` | — | `.opencode/watchdog.jsonc` |
| 1 | Path contains `/test/`, `/tests/`, `/__tests__/`, `/spec/` | `test_file` | — | Hardcoded |
| 2 | Filename matches `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py` | `test_file` | — | Hardcoded |
| 3 | Path contains `/src/`, `/lib/`, `/app/` | `business_code` | — | Hardcoded |
| 4 | Filename matches configurable patterns per phase | `phase_deliverable` | N | `.opencode/watchdog.jsonc` |
| 5 | (none of the above) | `unknown` | — | Default |

**Phase deliverable mappings (C-4: code AND documents):**

| Phase | Deliverable Type | Default Patterns (from watchdog.jsonc) |
|-------|-----------------|--------------------------------------|
| 1 | Requirements document | `requirements*.md`, `product-design*.md`, `user-stories*.md`, `prd*.md` |
| 2 | Technical design document | `technical*.md`, `architecture*.md`, `design-doc*.md`, `api-design*.md` |
| 3 | Test plan document | `test-plan*.md`, `test-strategy*.md`, `test-cases*.md` |
| 4 | Test files | Rules 1–2 (`test_file`) — hardcoded |
| 5 | Business code | Rule 3 (`business_code`) — hardcoded |

**Classification examples:**

| Path | Result | Rationale |
|------|--------|-----------|
| `/project/src/utils/helper.ts` | `business_code` | `/src/` match (Rule 3) |
| `/project/tests/auth.test.ts` | `test_file` | `/tests/` match (Rule 1) |
| `/project/lib/core.py` | `business_code` | `/lib/` match (Rule 3) |
| `/project/docs/technical-design.md` | `phase_deliverable(2)` | `technical*.md` (Rule 4, config) |
| `/project/README.md` | `unknown` | No rule matches (Rule 5) |

> **R2 M-1 note: Phase 3→4 interception gap**. Phase 4 deliverables (test files) are classified as generic `test_file`, not `phase_deliverable(phase: 4)`. This means Rule 2's `phase_deliverable` branch never fires for Phase 3→4 transitions. An LLM in Phase 3 can write test code files before Phase 3's Ralph gate passes. This gap is accepted because: (1) `test_file` is too broad a category for precise blocking (would catch pre-existing and utility tests), (2) Phase 3 deliverables (test plan documents) ARE correctly classified as `phase_deliverable(3)`, so writing `test-plan.md` IS blocked, (3) writing individual test files during Phase 3 is a lower-severity violation than writing business code before tests. Ralph review remains the safety net.

### 7.4.1 Watchdog Configuration (`.opencode/watchdog.jsonc`)

**Design rationale**: Phase deliverable patterns vary significantly across projects and teams. Hardcoding them couples the watchdog to specific naming conventions. Instead, patterns are loaded from a project-level JSONC (JSON with comments) config file that is installed with defaults and user-editable.

**Why JSONC over YAML**: JSONC uses `JSON.parse` (built-in, zero-dependency, zero-ambiguity) with `strip-json-comments` (~1KB, ~40 lines) for comment support. YAML has boolean traps (`yes`/`no`/`on`/`off` → boolean), indentation-sensitive errors, and requires a ~200-line custom parser or heavy external library. TOML has no Node.js built-in parser. For our simple 2-level nested structure, JSONC is the simplest correct choice.

**File format**:

```jsonc
// .opencode/watchdog.jsonc
// TDD Watchdog configuration — phase deliverable file patterns
//
// This file is loaded at plugin startup. Edit to match your project's
// naming conventions. Patterns are simple globs: * = any chars, ? = single char.
// Patterns match against the filename only (not the full path).
// Matching is case-insensitive.
//
// Files matching these patterns are classified as "phase deliverables".
// The interceptor blocks writes to phase N deliverables when phase N-1
// has not been completed and approved (AC-4).

{
  "phaseDeliverables": {
    "phase1": [
      "requirements*.md",
      "product-design*.md",
      "user-stories*.md",
      "prd*.md"
    ],
    "phase2": [
      "technical*.md",
      "architecture*.md",
      "design-doc*.md",
      "api-design*.md"
    ],
    "phase3": [
      "test-plan*.md",
      "test-strategy*.md",
      "test-cases*.md"
    ]
  },

  // False-positive exclusions: files classified as 'unknown' REGARDLESS of all rules.
  // This means a file listed here will bypass test_file, business_code,
  // AND phase_deliverable classifications. Use sparingly.
  //
  // Example: uncomment to exclude false-positive matches
  // "ignorePatterns": [
  //   "technical-notes.md",
  //   "test-planetary-motion.md"
  // ]
  "ignorePatterns": [],

  // File-writing tools to monitor. The Interceptor checks these tools for
  // TDD invariant violations. Default: ["edit", "write"] (OpenCode built-ins).
  // If you use Oh-My-OpenCode (OMO), add its custom editing tools here.
  //
  // Example for OMO users:
  // "monitoredTools": ["edit", "write", "hashline_edit"]
  "monitoredTools": ["edit", "write"]
}
```

**Loading mechanism**:

```typescript
// packages/watchdog/src/watchdog-config.ts

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PhaseDeliverablePatterns } from './file-classifier.js'
import type { Logger } from '@opencode-ai/core/logger'

/** Strip single-line (//) and multi-line (/* * /) comments from JSON string. ~40 lines. */
function stripJsonComments(jsonc: string): string {
  return jsonc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Built-in fallback patterns — used when config file is missing or broken. */
export const FALLBACK_PATTERNS: PhaseDeliverablePatterns = {
  1: ['requirements*.md', 'product-design*.md', 'user-stories*.md', 'prd*.md'],
  2: ['technical*.md', 'architecture*.md', 'design-doc*.md', 'api-design*.md'],
  3: ['test-plan*.md', 'test-strategy*.md', 'test-cases*.md'],
}

/** Default tools to monitor for file writes. OpenCode built-in editing tools.
 *  OMO users should add custom editing tools (e.g., 'hashline_edit') here. */
export const DEFAULT_MONITORED_TOOLS = ['edit', 'write'] as const

export interface WatchdogConfig {
  phaseDeliverables: PhaseDeliverablePatterns
  ignorePatterns: string[]
  /** Tool names to monitor for file interception (§X, L2 defense).
   *  Default: ['edit', 'write']. OMO users: add custom editing tools. */
  monitoredTools: string[]
}

/**
 * Load watchdog config from project worktree.
 * - File exists + valid → use it (file is source of truth)
 * - File missing → log info, use code fallback
 * - File broken (parse error) → log warning, use code fallback
 */
export function loadWatchdogConfig(worktreeRoot: string, logger: Logger): WatchdogConfig {
  const configPath = join(worktreeRoot, '.opencode', 'watchdog.jsonc')

  if (!existsSync(configPath)) {
    logger.info('No watchdog.jsonc found at %s — using built-in defaults', configPath)
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(stripJsonComments(raw)) as any

    // Validate structure
    if (parsed?.phaseDeliverables && typeof parsed.phaseDeliverables === 'object') {
      const phaseDeliverables: PhaseDeliverablePatterns = {}
      for (const [key, value] of Object.entries(parsed.phaseDeliverables)) {
        const phase = Number(key.replace('phase', ''))
        if (Number.isNaN(phase)) continue
        phaseDeliverables[phase] = Array.isArray(value)
          ? value.filter(v => typeof v === 'string')
          : []
      }

      const ignorePatterns: string[] = Array.isArray(parsed.ignorePatterns)
        ? parsed.ignorePatterns.filter((v: any) => typeof v === 'string')
        : []

      const monitoredTools: string[] = Array.isArray(parsed.monitoredTools)
        ? parsed.monitoredTools.filter((v: any) => typeof v === 'string')
        : [...DEFAULT_MONITORED_TOOLS]

      // Guard: empty monitoredTools silently disables all interception
      if (monitoredTools.length === 0) {
        logger.warn('watchdog.jsonc has empty monitoredTools — falling back to defaults')
        monitoredTools.push(...DEFAULT_MONITORED_TOOLS)
      }

      logger.info('Loaded watchdog.jsonc: %d phases, %d ignore patterns, %d monitored tools',
        Object.keys(phaseDeliverables).length, ignorePatterns.length, monitoredTools.length)

      return { phaseDeliverables, ignorePatterns, monitoredTools }
    }

    logger.warn('watchdog.jsonc missing phaseDeliverables — using built-in defaults')
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  } catch (err) {
    logger.warn('Failed to load watchdog.jsonc: %s — using built-in defaults', String(err))
    return { phaseDeliverables: FALLBACK_PATTERNS, ignorePatterns: [], monitoredTools: [...DEFAULT_MONITORED_TOOLS] }
  }
}
```

**Installation**: Plugin setup script copies `watchdog.jsonc` (with defaults + comments) to `.opencode/watchdog.jsonc` if the file does not already exist. If it exists, it is never overwritten — user edits are preserved across updates.

**Parsing**: Uses `stripJsonComments()` (~40 lines, strips `//` and `/* */` comments) + built-in `JSON.parse`. No external YAML dependency, no boolean traps, no indentation sensitivity.

**Config lifecycle**:
1. **Install**: `.opencode/watchdog.jsonc` created with defaults + comments
2. **Plugin init**: `loadWatchdogConfig(worktreeRoot)` reads file → `WatchdogConfig`
3. **Passed to**: `Interceptor` constructor → `classifyFile(path, config.phaseDeliverables)` on each hook
4. **Hot reload**: Not supported. Config is read once at plugin startup. Changes require plugin reload (restart OpenCode session).

---

### 7.5 Intercept Rules

```typescript
// packages/watchdog/src/intercept-rules.ts

import type { FileClassification } from './file-classifier.js'
import type { PipelineState } from './schema.js'

export interface InterceptRule {
  name: string
  applies(
    tool: string,
    filePath: string,
    classification: FileClassification,
    state: PipelineState,
  ): boolean
  check(
    tool: string,
    filePath: string,
    classification: FileClassification,
    state: PipelineState,
  ): string | null  // violation message or null
}
```

**Rule 1 — AC-3: Test Evidence Gate**

```
Name:        NO_BUSINESS_CODE_BEFORE_FAILING_TESTS
Applies:     state.currentPhase ∈ {4, 5}
             AND classification.category === 'business_code'
              AND tool pre-filtered by Interceptor's monitoredTools
Condition:   state.testEvidenceConfirmed === false
Violation:   ⛔ [TDD Watchdog] Phase {phase} violation: business code write
             blocked. Failing tests must be confirmed before writing
             implementation. Call tdd_checkpoint('test_evidence', ...)
             with your test output.
```

```typescript
{
  name: 'NO_BUSINESS_CODE_BEFORE_FAILING_TESTS',
  applies(_tool, _fp, classification, state) {
    return (
      (state.currentPhase === 4 || state.currentPhase === 5) &&
      classification.category === 'business_code'
    )
  },
  check(_tool, _fp, _classification, state) {
    if (state.testEvidenceConfirmed === false) {
      return `⛔ [TDD Watchdog] Phase ${state.currentPhase} violation: business code write blocked. Failing tests must be confirmed before writing implementation. Call tdd_checkpoint('test_evidence', ...) with your test output.`
    }
    return null
  },
}
```

**Rule 2 — AC-4: Phase Gate**

```
Name:        NO_PHASE_ADVANCE_WITHOUT_GATE
Applies:     (classification.category === 'phase_deliverable'
             AND classification.phase === state.currentPhase + 1
              AND tool pre-filtered by Interceptor's monitoredTools
             AND state.currentPhase >= 1)
             OR (state.currentPhase === 4 AND classification.category === 'business_code')
Condition:   state.phases[state.currentPhase]?.ralphCompleted === false
             OR state.phases[state.currentPhase]?.userApproved === false
Violation:   ⛔ [TDD Watchdog] Phase transition blocked: Phase {N} Ralph
             loop gate has not been passed (status: {status}).
             Complete the Ralph loop and obtain user approval before
             starting Phase {N+1}.
```

```typescript
{
  name: 'NO_PHASE_ADVANCE_WITHOUT_GATE',
  applies(_tool, _fp, classification, state) {
    // Phase 5 deliverables are classified as business_code
    // Block business_code writes when in Phase 4 and Phase 4 gate not passed
    if (state.currentPhase === 4 && classification.category === 'business_code') return true
    return (
      state.currentPhase >= 1 &&
      classification.category === 'phase_deliverable' &&
      classification.phase === state.currentPhase + 1
    )
  },
  check(_tool, _fp, _classification, state) {
    const rec = state.phases[state.currentPhase]
    if (!rec || !rec.ralphCompleted || !rec.userApproved) {
      const status = !rec
        ? 'phase not entered'
        : rec.ralphCompleted
          ? 'awaiting user approval'
          : 'Ralph loop incomplete'
      return `⛔ [TDD Watchdog] Phase transition blocked: Phase ${state.currentPhase} Ralph loop gate has not been passed (status: ${status}). Complete the Ralph loop and obtain user approval before starting Phase ${state.currentPhase + 1}.`
    }
    return null
  },
}
```

**Rule evaluation order diagram (C-7):**

```
┌─────────────────────────────────────────────┐
│  edit / write call with active pipeline     │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ Rule 1: NO_BUSINESS_CODE_BEFORE_            │
│         FAILING_TESTS (AC-3)                │
│                                             │
│   applies? ──No──► proceed to Rule 2        │
│      │                                      │
│      └─► check passes? ──Yes──► allow       │
│            │                                │
│            └─► No ──► THROW AC-3 violation  │
└─────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ Rule 2: NO_PHASE_ADVANCE_WITHOUT_GATE       │
│         (AC-4)                              │
│                                             │
│   applies? ──No──► allow                    │
│      │                                      │
│      └─► check passes? ──Yes──► allow       │
│            │                                │
│            └─► No ──► THROW AC-4 violation  │
└─────────────────────────────────────────────┘
```

---

### 7.6 Error Message Format

Both violation messages follow a consistent template optimized for LLM readability:

| Rule | Prefix | What happened | Actionable guidance |
|------|--------|---------------|---------------------|
| AC-3 | `⛔ [TDD Watchdog]` | `Phase {N} violation: business code write blocked` | "Call `tdd_checkpoint('test_evidence', ...)` with your test output." |
| AC-4 | `⛔ [TDD Watchdog]` | `Phase transition blocked: Phase {N} gate not passed` | "Complete the Ralph loop and obtain user approval before starting Phase {N+1}." |

**Design rationale**: The `⛔` prefix makes violations visually distinct in LLM tool output. Each message states (1) what was blocked, (2) why, and (3) the exact next step to unblock. This reduces confusion and prevents the LLM from retrying the same write without addressing the root cause.

---

### 7.7 Failure Mode Handling

| Failure Scenario | Priority | Design Response |
|-----------------|----------|----------------|
| Cache miss (no pipeline) | Key | Silent return (AC-8). No throw, no state read, no log noise. |
| Cache populate fails | Key | Fail-open, log warning (C-8). Disk read returns null; hooks treat as no pipeline. |
| State read from disk fails | Key | Fail-open, log warning (C-8, multi-agent). `cache.get()` returns null; hooks treat as no pipeline. |
| Unexpected error (cache corruption, OOM, runtime bug) | Key | **Fail-closed**: tool blocked, `Error("⛔ infrastructure failure")` thrown. LLM sees message and can notify user. Root causes are infrastructure issues — retry unlikely to help. Logged as error. |
| Unknown file classification | Peripheral | Don't block (C-4). `unknown` category never matches rule predicates. |
| Tool args missing path | Peripheral | Log warning, don't block. No safe assumption can be made about intent. |
| edit/write with multiple targets | Key | Only first path checked. OpenCode built-in `edit`/`write` accept a single file path per invocation. |

---

### 7.8 Test Plan Summary

| # | Test | Coverage |
|---|------|----------|
| 1 | `handle('read', ...)` → returns without reading cache | C-3 |
| 2 | `handle('edit', ...)` with `cache.get() = null` → returns silently | AC-8 |
| 3 | `extractFilePath('edit', { filePath: 'x' })` → `'x'` | OQ-3 |
| 4 | `extractFilePath('write', { file: 'x' })` → `'x'` | OQ-3 |
| 5 | `extractFilePath('edit', {})` → `null`, interceptor logs + allows | Peripheral |
| 6 | `classifyFile('/src/foo.ts', patterns)` → `business_code` | Rule 3 |
| 7 | `classifyFile('/tests/foo.test.ts', patterns)` → `test_file` | Rule 1 |
| 8 | `classifyFile('/docs/technical-spec.md', patterns)` → `phase_deliverable(2)` | Rule 4, config |
| 9 | `classifyFile('/random.md', patterns)` → `unknown` | Rule 5 |
| 9a | `classifyFile('/docs/prd-v2.md', patterns)` → `phase_deliverable(1)` | Config default `prd*.md` |
| 9b | `classifyFile('/docs/user-stories.md', patterns)` → `phase_deliverable(1)` | Config default `user-stories*.md` |
| 9c | `classifyFile('/docs/technical-notes.md', patterns, ['technical-notes.md'])` → `unknown` (ignores false-positive match on `technical*.md`) | ignorePatterns |
| 9d | Custom config: `classifyFile('/api-design.md', customPatterns)` where phase2 includes `api-design*.md` → `phase_deliverable(2)` | Config override |
| 10 | Rule 1: Phase 4, no evidence, business code → throws `WatchdogInterceptError` | AC-3 |
| 11 | Rule 1: Phase 4, evidence confirmed, business code → allows | AC-3 edge |
| 12 | Rule 1: Phase 4, no evidence, test file → allows | AC-3 edge |
| 13 | Rule 2: Phase 2 incomplete, write to Phase 3 deliverable → throws `WatchdogInterceptError` | AC-4 |
| 14 | Rule 2: Phase 2 complete+approved, write to Phase 3 deliverable → allows | AC-4 edge |
| 15 | Rule order: AC-3 + AC-4 both violated → only AC-3 throws | C-7 |
| 16 | Disk read: active run on disk → `cache.get()` returns state | C-8, multi-agent |
| 17 | Disk read failure: corrupt state → `cache.get()` returns null, warning logged, interceptor allows | C-8 |
| 18 | Unexpected error (`classifyFile` throws) → throws generic Error with "⛔ infrastructure failure" message | Fail-closed |
| 19 | Unexpected error message includes "restart the pipeline" guidance | Fail-closed |
| 20 | `WatchdogInterceptError` instance check: thrown violation is `instanceof WatchdogInterceptError` | Error class |
| 21 | Unexpected error is plain `Error`, NOT `WatchdogInterceptError` | Error class |
| 22 | `loadWatchdogConfig`: missing file → returns FALLBACK_PATTERNS + DEFAULT_MONITORED_TOOLS | Config fallback |
| 23 | `loadWatchdogConfig`: valid file → returns parsed patterns + monitoredTools | Config loading |
| 24 | `loadWatchdogConfig`: malformed JSONC → log warning + returns defaults | Config error |
| 25 | `loadWatchdogConfig`: valid JSONC but missing `phaseDeliverables` → returns FALLBACK_PATTERNS | Config validation |
| 26 | `loadWatchdogConfig`: extra phases in config (e.g., phase 6) → included in output, never matched by rules | Config extensibility |
| 27 | `globToRegex('*.md')` matches `technical-design.md`, not `technical-design.txt` | Glob→regex |
| 28 | Interceptor with `monitoredTools: ['edit', 'write', 'hashline_edit']`: `hashline_edit` call intercepted | §15a L3 |
| 29 | Interceptor with default `monitoredTools`: custom tool `hashline_edit` NOT intercepted | C-3 default |
| 30 | `extractFilePath('hashline_edit', { filePath: 'x.ts' })` → `'x.ts'` (generic fallback) | PathExtractor fallback |
| 31 | `extractFilePath('custom_tool', { path: 'y.ts' })` → `'y.ts'` (generic fallback, 'path' field) | PathExtractor fallback |
| 32 | Disk read consistency: orchestrator writes state → sub-agent's next `cache.get()` sees new state | Multi-agent consistency |
| 33 | `loadWatchdogConfig`: empty `monitoredTools` → warning logged + fallback to defaults | Config footgun guard |
| 34 | `extractFilePath('custom', { filePath: 'a', path: 'b' })` → `'a'` (first field wins) | PathExtractor priority |

> **Note**: Ownership test cases (TC-35~52 in original numbering) are in `Phase3-TestPlan.md`.

## 8. Module C: Articulation Validation (US-4, US-5)

### 8.1 Component Overview

Module C validates the LLM's "why articulation" text before phase execution. When the LLM calls `tdd_checkpoint('why_articulation', {phase, articulation})`, the Watchdog checks that the articulation covers three required dimensions: **what it protects**, **key risks**, and **why the approach works**.

This is a **checkpoint-enforced soft gate** — validation results are advisory. The LLM may proceed after a failed validation (by re-calling with improved articulation), and if the checkpoint tool is unavailable the gate degrades gracefully to Ralph review (AC-6).

Module C extends three existing files:
- `schema.ts` — `CheckpointEvent`, `PhaseRecord` additions (see §4.1)
- `transitions.ts` — `why_articulation` case in `validateTransition` + `applyTransition`
- `checkpoint.ts` — content validation + degradation tracking in `handle()`

Plus one new file:
- `articulation.ts` — pure validation function + guidance lookup

### 8.2 ArticulationValidator (`articulation.ts`)

`articulation.ts` exports a single pure function. It performs lightweight keyword/pattern matching per dimension (A-3: false positives/negatives acceptable, caught by Ralph review).

```typescript
// packages/watchdog/src/articulation.ts

export interface ArticulationResult {
  verified: boolean
  dimensions: {
    what_it_protects: boolean
    key_risks: boolean
    why_approach_works: boolean
  }
  missingDimension?: string
  guidance?: string
}

const PROTECTION_KEYWORDS = /protect|guard|prevent|skip|consequence|cost|lose|break|fail|wrong|impact/i
const RISK_KEYWORDS = /risk|failure|edge.case|boundary|break|incorrect|wrong|bug|issue|problem|limitation/i
const APPROACH_KEYWORDS = /because|reason|works|effective|chose|choose|alternative|better|instead|why/i

const MIN_ARTICULATION_LENGTH = 50

const ARTICULATION_GUIDANCE: Record<string, string> = {
  what_it_protects:
    "Your articulation doesn't address what this phase protects or what's lost by skipping it. Consider: what would go wrong if this phase were done carelessly?",
  key_risks:
    "Your articulation doesn't identify task-specific risks. Consider: what's the most likely way this task could go wrong? What edge cases or failure modes are relevant?",
  why_approach_works:
    "Your articulation lists steps but doesn't explain why this approach will work. Consider: why this approach over alternatives? What makes it effective for this task?",
}

export function validateArticulation(text: string): ArticulationResult {
  // Minimum length guard
  if (text.length < MIN_ARTICULATION_LENGTH) {
    return {
      verified: false,
      dimensions: { what_it_protects: false, key_risks: false, why_approach_works: false },
      missingDimension: 'what_it_protects',
      guidance: ARTICULATION_GUIDANCE.what_it_protects,
    }
  }

  const dims = {
    what_it_protects: PROTECTION_KEYWORDS.test(text),
    key_risks: RISK_KEYWORDS.test(text),
    why_approach_works: APPROACH_KEYWORDS.test(text),
  }

  const allPass = dims.what_it_protects && dims.key_risks && dims.why_approach_works

  if (allPass) {
    return { verified: true, dimensions: dims }
  }

  // Return guidance for the first failing dimension (ordered: protects → risks → approach)
  const missing = !dims.what_it_protects
    ? 'what_it_protects'
    : !dims.key_risks
      ? 'key_risks'
      : 'why_approach_works'

  return {
    verified: false,
    dimensions: dims,
    missingDimension: missing,
    guidance: ARTICULATION_GUIDANCE[missing],
  }
}
```

**Phase-specific semantics** (informational — validation uses the same keyword lists across all phases; Ralph reviewers use this table for deeper evaluation):

| Phase | What It Protects | Key Risks | Why Approach Works |
|-------|-----------------|-----------|-------------------|
| 1 | Requirement accuracy; wrong assumptions poison downstream decisions | Misunderstanding implicit constraints; ambiguous scope | Choice of elicitation method over alternatives |
| 2 | Architectural traceability; orphaned decisions create unbounded change cost | Over-engineering; ignoring existing constraints | Why this decomposition / technology selection |
| 3 | Test-to-requirement alignment; tests that verify the wrong behavior | Missing equivalence classes; brittle test design | Testing strategy choice (property-based, example-based, etc.) |
| 4 | Test-as-specification accuracy; passing the wrong tests | Edge cases in business logic; concurrency / ordering | Implementation technique vs. naive approach |
| 5 | Minimal-implementation discipline; scope creep | Refactoring without test coverage; breaking invariants | Why this refactor ordering or extraction strategy |

**Minimum length check**: Text under 50 characters fails all dimensions. This catches empty or placeholder articulations without running keyword checks.

**Guidance generation**: Only the first missing dimension is reported to avoid overwhelming the LLM. The guidance text maps directly to `CheckpointViolation.guidance`.

### 8.3 Degradation Mechanism

After 3 consecutive content validation failures for the same phase, the Watchdog sets `articulationDegraded = true` on the `PhaseRecord`. This is an advisory flag for Ralph reviewers — it does **not** block execution.

```typescript
// Inside CheckpointHandler class (checkpoint.ts)

private articulationFailures = new Map<number, number>()

private checkDegradation(phase: number): boolean {
  const count = this.articulationFailures.get(phase) ?? 0
  return count >= ARTICULATION_MAX_FAILURES  // 3
}

private recordFailure(phase: number): void {
  const count = this.articulationFailures.get(phase) ?? 0
  this.articulationFailures.set(phase, count + 1)
}

private resetFailures(phase: number): void {
  this.articulationFailures.delete(phase)
}
```

**Reset conditions**:
- Successful content validation (`ok: true`) for the phase → counter resets to 0
- `phase_enter(N)` for the same phase → counter resets to 0 (new articulation opportunity)
- `pipeline_start` → counter map is cleared (M-3: prevents cross-run pollution)
- Plugin restart → counter is lost; acceptable because degradation is advisory (AC-5)

```typescript
// In CheckpointHandler.handle(), pipeline_start branch:
if (event === 'pipeline_start') {
  this.articulationFailures.clear()  // M-3: reset cross-run pollution
}
```

**Lost-on-restart acceptability**: If the plugin restarts after 2 failures, the counter resets. The LLM gets 3 more attempts before degradation. This is acceptable per A-3 and AC-5 — degradation is a hint to Ralph, not a security control.

### 8.4 `transitions.ts` Update

**`validateTransition` — `why_articulation` case**:

```typescript
case 'why_articulation': {
  if (!isInt(payload.phase) || payload.phase < 1 || payload.phase > 5) {
    return fail(
      'Invalid phase number',
      'why_articulation requires phase to be an integer between 1 and 5.',
    )
  }
  if (!isNonEmptyString(payload.articulation)) {
    return fail(
      'Missing or invalid articulation',
      'why_articulation requires a non-empty string articulation field.',
    )
  }
  break
}
```

State preconditions (in the second `switch`):
```typescript
case 'why_articulation': {
  if (state === null) return fail(NO_ACTIVE_RUN, START_FIRST)
  const phase = payload.phase as number
  if (phase !== state.currentPhase) {
    return fail(
      'Phase mismatch',
      `why_articulation must target the current phase (${state.currentPhase}).`,
    )
  }
  if (state.phaseStatus !== 'active') {
    return fail(
      'Phase not active',
      'why_articulation can only be called when phase status is active.',
    )
  }
  const rec = state.phases[phase]
  if (!rec) {
    return fail(
      `Phase ${phase} not found`,
      `why_articulation requires phase ${phase} to have been entered.`,
    )
  }
  return ok()
}
```

**`applyTransition` — `why_articulation` case**:

Content validation results are injected into the payload by `CheckpointHandler` before calling `applyTransition` (see §8.5). `transitions.ts` performs only state mutation.

```typescript
case 'why_articulation': {
  if (state === null) {
    throw new Error('BUG: state must not be null for why_articulation')
  }
  const phase = payload.phase as number
  const verified = payload._articulationVerified as boolean
  const dimensions = payload._articulationDimensions as ArticulationResult['dimensions'] | undefined
  const degraded = payload._articulationDegraded as boolean

  return {
    ...state,
    phases: {
      ...state.phases,
      [phase]: {
        ...state.phases[phase],
        articulationAttempted: true,
        articulationVerified: verified,
        articulationDimensions: dimensions,
        articulationDegraded: state.phases[phase].articulationDegraded || degraded,
      },
    },
    lastCheckpointAt: now,
  }
}
```

**Phase 1's `phase_enter` applyTransition must be updated** to initialize the 3 new articulation fields with `false` defaults:

```typescript
// In applyTransition, 'phase_enter' case:
[phase]: {
  phase,
  enteredAt: now,
  ralphCompleted: false,
  ralphTermination: null,
  userApproved: false,
  approvedAt: null,
  articulationVerified: false,      // ← NEW
  articulationAttempted: false,     // ← NEW
  articulationDegraded: false,      // ← NEW
}
```

**Design note**: `articulationDegraded` uses `||` — once set, it is never cleared (historical marker, AC-7). `articulationVerified` and `articulationDimensions` are overwritten on every call, so a later success replaces earlier failure results.

### 8.5 `checkpoint.ts` Update

The `CheckpointHandler.handle()` method gains a content-validation branch after step 6 (transition validation) and before step 7 (apply transition).

**Constructor change**: Phase 2 adds `cache: PipelineStateCache` (see §5.4). The degradation counter is a private field on `CheckpointHandler`.

**Pseudocode for `why_articulation` flow**:

```typescript
// Inside CheckpointHandler.handle(), after validation.valid === true

if (event === 'why_articulation') {
  const phase = payload.phase as number
  const text = payload.articulation as string

  // 1. Content validation (pure function, no side effects)
  const result = validateArticulation(text)

  // 2. Degradation tracking
  let degraded = false
  if (!result.verified) {
    this.recordFailure(phase)
    if (this.checkDegradation(phase)) {
      degraded = true
    }
  } else {
    this.resetFailures(phase)
  }

  // 3. Bake results into payload for applyTransition
  payload._articulationVerified = result.verified
  payload._articulationDimensions = result.dimensions
  payload._articulationDegraded = degraded

  // 4. Apply transition (state mutation only)
  newState = applyTransition(event, payload, currentState)
  // ... write state, audit PASS, cache update, return result

  // 5. Build response
  if (result.verified) {
    return JSON.stringify({ ok: true, state: summarizeState(newState) })  // summarizeState: fn inherited from Phase 1 checkpoint.ts (§4.2)
  } else {
    const violation = degraded
      ? `Why articulation incomplete: missing '${result.missingDimension}' (degraded after ${ARTICULATION_MAX_FAILURES} attempts — escalated to Ralph review)`
      : `Why articulation incomplete: missing '${result.missingDimension}'`
    return JSON.stringify({
      ok: false,
      violation,
      guidance: result.guidance,
    })
  }
}
```

**Audit semantics**: The audit entry is `decision: 'PASS'` because state preconditions passed and `PhaseRecord` was mutated (articulationAttempted set). The content validation outcome is captured in `PhaseRecord` fields, not the audit decision. This preserves Phase 1's invariant: `PASS` = state was written (AC-5).

> **⚠️ Important: Dual semantics of PASS + ok:false**. When content validation fails, the tool returns `ok: false` (guidance provided) while the audit log records `decision: 'PASS'`. This is **by design** — the state mutation succeeded (preconditions valid), but the articulation content was insufficient. To diagnose articulation failures from audit logs, check `PhaseRecord.articulationVerified` (false = content failed) and `PhaseRecord.articulationAttempted` (true = at least one call was made). The audit decision alone is insufficient.

**Cache update**: After `writeState()`, call `this.cache.update(newState)` (Phase 2 shared infrastructure, §5.1).

**M-5 fix: Counter reset on phase_enter**. In addition to the `why_articulation` branch shown above, the `phase_enter` branch in `CheckpointHandler.handle()` must reset the degradation counter:

```typescript
// In CheckpointHandler.handle(), after successful applyTransition for 'phase_enter':
if (event === 'phase_enter') {
  this.resetFailures(payload.phase as number)  // M-5: reset articulation failure counter for new phase
}
```

This ensures the counter resets when a new phase begins, preventing stale failure counts from a previous phase from affecting the new one.

### 8.6 Execution Flow Diagram

```
phase_enter(N)
  │
  ▼
LLM writes articulation (open-ended text)
  │
  ▼
tdd_checkpoint('why_articulation', {phase: N, articulation: text})
  │
  ├──► validateTransition (state preconditions)
  │      ├── phase === currentPhase? ✓
  │      ├── phaseStatus === 'active'? ✓
  │      └── phases[phase] exists? ✓
  │         → valid: true
  │
  ├──► validateArticulation(text) (content validation)
  │      ├── dimension 1: what_it_protects? ✗
  │      ├── dimension 2: key_risks? ✓
  │      └── dimension 3: why_approach_works? ✓
  │         → verified: false, missing: 'what_it_protects'
  │
  ├──► recordFailure(N) → count = 1
  │      └── checkDegradation(N)? false (1 < 3)
  │
  ├──► applyTransition with _articulationVerified=false,
  │      _articulationDimensions={...}, _articulationDegraded=false
  │         → articulationAttempted=true, articulationVerified=false
  │
  └──► Return: ok=false, violation="Why articulation incomplete:
         missing 'what_it_protects'", guidance=...

  [LLM addresses guidance and re-calls]

  ...after 3 failures...

  ├──► checkDegradation(N)? true (3 ≥ 3)
  │      → _articulationDegraded=true
  │      → articulationDegraded=true on PhaseRecord (historical marker)
  │      → violation includes "escalated to Ralph review"

  [Later success after degradation]

  ├──► validateArticulation(text) → verified: true
  ├──► resetFailures(N)
  ├──► applyTransition → articulationVerified=true
  └──► articulationDegraded stays true (historical marker, AC-7)
```

### 8.7 Failure Mode Handling

| Failure Scenario | Priority | Design Response |
|-----------------|----------|----------------|
| Text too short to evaluate | Peripheral | All dimensions fail, guidance suggests addressing first missing dimension (what_it_protects) |
| 2 of 3 dimensions covered | Key | Return `ok: false` with specific missing dimension guidance; LLM addresses and re-calls |
| 3 consecutive failures | Key | Set `articulationDegraded = true`, return `ok: false` with escalation note; Ralph reviewer sees flag |
| Plugin restart (counter lost) | Peripheral | Counter resets to 0; acceptable — degradation is advisory, not blocking |
| Later success after degradation | Key | `articulationVerified = true` but `articulationDegraded` stays `true` (historical marker, AC-7) |
| Checkpoint tool unavailable | Peripheral | Soft gate degrades to prompt guidance + Ralph review fallback; no error (AC-6) |
| Invalid payload (missing articulation) | Key | `validateTransition` blocks before content validation; audit BLOCK |
| State precondition failure | Key | `validateTransition` returns violation; `articulationAttempted` remains `false` (AC-9) |

### 8.8 Test Plan Summary

| Test | Coverage |
|------|----------|
| `validateArticulation` — all 3 dimensions pass | Keyword matching hits all regexes, returns `verified: true` |
| `validateArticulation` — 1 of 3 dimensions missing | Returns correct `missingDimension` and `guidance` |
| `validateArticulation` — text < 50 chars | Returns all dimensions false, guidance for `what_it_protects` |
| `validateArticulation` — empty string | Same as < 50 chars |
| `validateTransition('why_articulation')` — valid payload, valid state | Returns `{valid: true}` |
| `validateTransition('why_articulation')` — phase mismatch | Returns violation with expected phase number |
| `validateTransition('why_articulation')` — phaseStatus not 'active' | Returns violation |
| `validateTransition('why_articulation')` — phase not entered | Returns violation |
| `applyTransition('why_articulation')` — sets articulationAttempted=true | State mutation correct |
| `applyTransition('why_articulation')` — articulationDegraded OR semantics | Degraded stays true once set |
| `CheckpointHandler` — 2 failures then success | Counter resets, returns ok=true, no degraded flag |
| `CheckpointHandler` — 3 consecutive failures | Sets degraded flag, returns ok=false with escalation note |
| `CheckpointHandler` — success after degradation | articulationVerified=true, articulationDegraded stays true |
| `CheckpointHandler` — phase_enter resets counter | New phase_enter clears previous phase's failure count |
| End-to-end — why_articulation → ok=true → phase continues | Full flow through handle(), state persisted, cache updated |
| End-to-end — why_articulation → ok=false → guidance returned | Full flow, audit PASS, PhaseRecord updated with attempted=true |

---

## 9. Component Breakdown

| Component | Priority | Responsibilities | Serves ACs | Interface | Dependencies |
|-----------|----------|-----------------|------------|-----------|-------------|
| **Observer** (`observer.ts`) | Key | Detect Task tool calls during ralph_loop; record `_reviewer_spawned` ObservationEntry; maintain session buffer for no-pipeline calls; track degradation state | AC-1, AC-2, AC-10 | `handle(tool, args, output, sessionId, callID): Promise<void>`, `isDegraded(projectId, runId, round): boolean`, `clearDegradation(projectId, runId): void` | PipelineStateCache, PipelineStore, SessionBuffer, Logger |
| **Interceptor** (`interceptor.ts`) | Key | Block configured file-writing tools that violate TDD invariants; evaluate rules in order; fail-closed on unexpected errors | AC-3, AC-4, AC-8 | `handle(tool, args, sessionId, callID): Promise<void>` | PipelineStateCache, PathExtractor, FileClassifier, InterceptRules, Logger |
| **CheckpointHandler** (`checkpoint.ts`) | Key | Process `why_articulation` checkpoint events; validate content dimensions; track degradation counter; enforce AC-2 at `ralph_round_complete`; **enforce pipeline ownership** (§5.5a); clean up observer degradation on `phase_complete(5)` | AC-2, AC-5, AC-6, AC-7, AC-9, multi-agent safety | `handle(args, context): Promise<string>` (unchanged signature) | PipelineStore, PipelineStateCache, Observer, ArticulationValidator, Logger |
| **ArticulationValidator** (`articulation.ts`) | Key | Validate articulation text covers 3 dimensions; generate guidance for missing dimensions | AC-5 | `validateArticulation(text: string): ArticulationResult` where `ArticulationResult = { verified: boolean, dimensions: { what_it_protects, key_risks, why_approach_works }, missingDimension?, guidance? }` | None (pure function) |
| **FileClassifier** (`file-classifier.ts`) | Key | Classify file paths into categories using priority-ordered rules; config-driven Rule 4 patterns | AC-3, AC-4 | `classifyFile(absolutePath, deliverablePatterns, ignorePatterns): FileClassification` | None (pure function with injected patterns) |
| **PathExtractor** (`path-extractor.ts`) | Peripheral | Extract file path from edit/write tool args | AC-3, AC-4 (via Interceptor) | `extractFilePath(tool, args): string | null` | None (pure function) |
| **InterceptRules** (`intercept-rules.ts`) | Key | Define AC-3 (test evidence gate) and AC-4 (phase gate) rules with applies/check interface | AC-3, AC-4 (via Interceptor) | `InterceptRule { name, applies(), check() }` | FileClassification, PipelineState |
| **SessionBuffer** (`session-buffer.ts`) | Peripheral | Record tool calls when no pipeline active; bounded FIFO; per-session scoping | AC-10 | `record(sessionId, entry)`, `getSession(sessionId): Entry[]`, `clearSession(sessionId)` | Logger |
| **PipelineStateCache** (`state-cache.ts`) | Key | Adaptive: in-memory cache (single-agent) or disk-read every call (OMO multi-agent). Mode detected at plugin init. | C-8, AC-8, multi-agent consistency | `get(): PipelineState | null`, `update(state)`, `clear()` | PipelineStore, Logger |
| **WatchdogConfig** (`watchdog-config.ts`) | Peripheral | Load `.opencode/watchdog.jsonc`; validate structure; fallback to built-in defaults | Config for AC-3, AC-4 | `loadWatchdogConfig(worktreeRoot, logger): WatchdogConfig` | Logger |
## 10. Requirements Traceability

### 10.1 Acceptance Criteria → Component Mapping

| AC | US | Priority | Primary Component(s) | Supporting Components | Design Section |
|----|-----|----------|---------------------|----------------------|----------------|
| AC-1 | US-1 | Core | Observer | PipelineStateCache, PipelineStore | §6.2 |
| AC-2 | US-1 | Core | CheckpointHandler | Observer (isDegraded), PipelineStore (findObservations) | §6.4 |
| AC-3 | US-2 | Core | Interceptor, InterceptRules (Rule 1) | FileClassifier, PathExtractor, PipelineStateCache | §7.2, §7.5 |
| AC-4 | US-3 | Core | Interceptor, InterceptRules (Rule 2) | FileClassifier, PathExtractor, PipelineStateCache | §7.2, §7.5 |
| AC-5 | US-4 | Core | CheckpointHandler, ArticulationValidator | PipelineStateCache, PipelineStore | §8.2, §8.5 |
| AC-6 | US-4 | Core | CheckpointHandler (soft gate — no enforcement) | None | §8.1 |
| AC-7 | US-5 | Secondary | CheckpointHandler (state persistence) | PipelineStore | §8.4, §8.5 |
| AC-8 | US-2,3 | Core | Interceptor (silent return), Observer (silent return) | PipelineStateCache | §7.2, §6.2 |
| AC-9 | US-4 | Core | CheckpointHandler (return ok:true/false), CheckpointHandler (articulationAttempted/Verified fields) | None | §8.5 |
| AC-10 | US-6 | Secondary | Observer (session buffer path), SessionBuffer | None | §6.2, §6.3 |

### 10.2 Constraint → Component Mapping

| Constraint | Enforced By | Design Section |
|-----------|-------------|----------------|
| C-1 (throw to block) | assemblePlugin, Interceptor | §3.1, §7.2 |
| C-2 (hook params) | assemblePlugin dispatch | §3.1 |
| C-3 (edit/write only) | Interceptor early return | §7.2 |
| C-4 (file classification) | FileClassifier | §7.4 |
| C-5 (short-circuit no pipeline) | Interceptor, Observer | §7.2, §6.2 |
| C-6 (path normalization) | Interceptor (resolve) | §7.2 |
| C-7 (rule evaluation order) | InterceptRules iteration | §7.5 |
| C-8 (adaptive cache) | PipelineStateCache | §5.1 |

### 10.3 Priority Consistency Check

**Forward check** (core AC → key component):

| Core AC | Key Component Serving It | Pass? |
|---------|------------------------|-------|
| AC-1 | Observer (Key) | ✅ |
| AC-2 | CheckpointHandler (Key) + Observer (Key) | ✅ |
| AC-3 | Interceptor (Key) | ✅ |
| AC-4 | Interceptor (Key) | ✅ |
| AC-5 | CheckpointHandler (Key) + ArticulationValidator (Key) | ✅ |
| AC-8 | Interceptor (Key) | ✅ |
| AC-9 | CheckpointHandler (Key) | ✅ |

**Result**: All core ACs are served by at least one Key component. No downgrades needed.

**Reverse check** (orphaned key components):

| Key Component | Core ACs Served | Notes |
|---------------|----------------|-------|
| FileClassifier | AC-3, AC-4 (via Interceptor) | Supporting role, correctly Key because wrong classification = wrong interception |
| InterceptRules | AC-3, AC-4 (via Interceptor) | Business logic, correctly Key |
| PipelineStateCache | C-8 (infrastructure) | Correctly Key — cache corruption affects all interception decisions |

**Result**: No orphaned key components. All Key classifications are intentional.

## 11. Unified Failure Mode Handling

| Failure Scenario | Priority | Affected Component(s) | Design Response | User Impact |
|-----------------|----------|----------------------|----------------|-------------|
| Observer write fails (disk I/O) | Peripheral | Observer | Log warning, continue. Set degradation flag for current round. | AC-2 may be skipped for degraded round |
| Session buffer overflow | Peripheral | SessionBuffer | FIFO eviction, log info | Oldest no-pipeline observations lost |
| Missing `_reviewer_spawned` in round | Key | Observer, CheckpointHandler | AC-2 violation at `ralph_round_complete` time | Round blocked, LLM must spawn reviewer |
| `cache.get()` returns stale state | Peripheral | PipelineStateCache | Observation uses stale `ralph.round` → off-by-one. Mitigated by synchronous `cache.update()` on every checkpoint write | Minor round mismatch in observations |
| `findObservations` disk read fails | Peripheral | PipelineStore | Returns empty array → AC-2 violation triggers (conservative) | False violation — reviewer present but not detected |
| Observer throws unexpectedly | Key | Observer | Dual-channel degradation: (1) in-memory flag for AC-2 skip, (2) persisted `_observer_degraded` entry for downstream substitute verification | Observer crash = skipped check + downstream can verify independently |
| Cache miss (no pipeline) | Key | Interceptor, Observer | Silent return (AC-8) | No impact — no pipeline = no interception |
| Cache populate fails | Key | PipelineStateCache | Fail-open, log warning. Cache stays null; hooks treat as no pipeline | Interception disabled until cache recovered |
| Interceptor unexpected error | Key | Interceptor | Fail-closed: tool blocked with "⛔ infrastructure failure" message | Tool blocked; LLM notifies user |
| Unknown file classification | Peripheral | FileClassifier | Don't block (Rule 5: `unknown`) | File allowed through |
| Tool args missing path | Peripheral | Interceptor | Log warning, don't block | File allowed through |
| edit/write with multiple targets | Key | Interceptor | Only first path checked. OpenCode built-ins accept single file per invocation | Not applicable (single-file tools) |
| Articulation content too short | Peripheral | ArticulationValidator | Returns `ok: false` with specific dimension guidance | LLM must re-call with better articulation |
| 3 consecutive articulation failures | Key | CheckpointHandler | `articulationDegraded: true` set (historical marker, never cleared). Returns `ok: false` with escalation note | Ralph reviewer scrutinizes more carefully |
| Config JSONC malformed | Peripheral | WatchdogConfig | Log warning, use FALLBACK_PATTERNS + DEFAULT_MONITORED_TOOLS | Default patterns used, interception still works |
| Config JSONC missing | Peripheral | WatchdogConfig | Log info, use FALLBACK_PATTERNS + DEFAULT_MONITORED_TOOLS | Same as above |
| Plugin restart during active pipeline | Key | PipelineStateCache | No cache to repopulate — next `get()` reads from disk | Always fresh state, no stale cache |
| Sub-agent checkpoint on owned pipeline | Key | CheckpointHandler | Rejected with `ok: false` + guidance; audit BLOCK logged | Sub-agent cannot advance state; guided to report to orchestrator |
| Sub-agent creates second pipeline | Key | CheckpointHandler | `pipeline_start` rejected: active pipeline already exists | Single-pipeline constraint prevents duplicate |
| OMO custom editing tool not in monitoredTools | Peripheral | Interceptor | Tool bypasses interception (not in config) | TDD invariant potentially violated; user must update config |
| Concurrent .jsonl append from multiple sessions | Peripheral | Observer, PipelineStore | POSIX `O_APPEND` guarantees per-line atomicity | Each entry complete; line order non-deterministic but safe |

## 12. Non-functional Constraints (Complete)

| Dimension | Requirement | Design Response |
|-----------|-------------|----------------|
| **Hook latency** | < 5ms per tool call (A-4) | Adaptive (§5.1): non-OMO ~0.1ms (memory cache), OMO ~1ms (disk read). Interceptor + Observer: cache/disk read + regex + rules + optional appendFileSync. |
| **Fail semantics (asymmetric)** | Interceptor: fail-closed. Observer: fail-open with dual-channel degradation. | Interceptor blocks on any error (`WatchdogInterceptError` or unexpected). Observer swallows errors but sets in-memory degradation flag (hot path for AC-2) and persists `_observer_degraded` ObservationEntry (cold path for downstream substitute verification). |
| **Data isolation** | PipelineState not in LLM context | Hooks are server-side only, no LLM exposure. Observations stored server-side. State cache is in-memory process-local. |
| **Operation reversibility** | Intercept blocks are temporary | throw message includes guidance on how to proceed (e.g., "confirm test evidence first"). User can always address the root cause and retry. |
| **Cache consistency** | Single-writer invariant (A-5) | Only checkpoint handler writes state; cache updated synchronously in same process. No cross-process consistency issue. |
| **Memory** | Session buffer bounded; degradation maps bounded | `SESSION_BUFFER_MAX_SIZE` (1000 entries) per session with FIFO eviction. `degradedRounds` Map cleared on `phase_complete(5)`. `degradedRuns` Set cleared on `phase_complete(5)`. |
| **Concurrency/blocking** | Hooks must not block tool execution unnecessarily | `onToolBefore`: pure computation (path extraction + classification + rule evaluation), no async I/O. `onToolAfter`: single `appendFileSync` (~1ms). Both run synchronously in the hook dispatch. |
| **Resource boundaries** | No unbounded growth | SessionBuffer: FIFO bounded. degradedRounds/degradedRuns: cleared on pipeline completion. In-memory consecutive failure counter: reset on success or new phase. Plugin restart clears all memory. |
| **Extension vectors** | New intercept rules, new observation types, new config patterns | `InterceptRule` interface for new rules (append to array). `ObservationEntry.type` for new observation types (stringly-typed). `.opencode/watchdog.jsonc` for project-specific patterns. |
| **Authentication/authorization** | N/A (no user-facing auth) | Watchdog is a plugin-internal component. No user authentication. OpenCode plugin system controls which plugins are loaded. |
| **Encryption** | N/A (no sensitive data in transit) | All state is local filesystem. No network communication. No encryption needed. |
| **Throughput** | ~1 tool call per second (LLM-driven) | Design targets < 5ms overhead. Actual throughput demand is extremely low — LLM tool calls are human-paced. |
| **Cost constraints** | Zero infrastructure cost | Pure local computation. No external services. No API calls. No cloud resources. |
| **Compliance** | Audit trail for TDD process decisions | Every checkpoint event writes an AuditLogEntry. Every interception writes a log. Every observation writes an ObservationEntry. Full history persisted in `.jsonl` files. |

## 13. Observability Design

| Signal | Metric / Log | Alert Condition | Owner |
|--------|-------------|-----------------|-------|
| Hook latency | `logger.debug('Observer: ...')` / `logger.info('Interceptor blocked ...')` | N/A — latency measured by hook execution time (< 5ms budget) | Watchdog plugin |
| Interception event | `logger.info('Interceptor blocked %s to %s: %s')` | Manual review: check watchdog logs for blocked writes | Pipeline operator (via LLM output) |
| AC-2 violation | `logger.warn('AC-2 violation: %s')` | Any AC-2 violation = reviewer not spawned in round | Pipeline operator (via checkpoint response) |
| Observer degradation | `logger.warn('Observer degraded for project %s run %s round %d')` | Any degradation = observer failed, AC-2 skipped | Pipeline operator (check logs) |
| Cache miss on populate | `logger.warn('Cache populate failed: %s')` | Cache fail = interception disabled | Infrastructure check |
| Config load failure | `logger.warn('Failed to load watchdog.jsonc: %s')` | Config fail = defaults used | Project configuration check |
| Stale pipeline run | `logger.warn('Found stale watchdog run for project %s')` | Active run > STALE_THRESHOLD_MS | Crash recovery |
| Articulation degradation | `logger.warn('Articulation degraded for phase %d')` | 3 consecutive failures = auto-verification gave up | Ralph reviewer (visible in state) |
| Session buffer overflow | `logger.info('Session buffer overflow for session %s')` | Bounded FIFO eviction | Informational only |

**Correlation IDs**: `callID` (from OpenCode dispatch) and `runId`/`projectId` (from PipelineState) provide correlation across log entries. Each interception/observation includes both in log output.

**Log structure**: All log entries use structured format with positional arguments (compatible with OpenCode's logger). Log levels: `debug` (per-tool-call noise), `info` (interceptions, config loads), `warn` (failures, violations, degradation), `error` (unexpected interceptor errors).

## 14. Cost Estimation

| Item | Type | Estimated Cost | Notes |
|------|------|---------------|-------|
| Development: Module A (Observer) | One-time | ~4 hours | 1 new file + 1 store extension + 1 buffer |
| Development: Module B (Interceptor) | One-time | ~4 hours | 4 new files + core registration update |
| Development: Module C (Articulation) | One-time | ~3 hours | 3 existing file extensions + 1 new validator |
| Development: Config system | One-time | ~1.5 hours | watchdog-config.ts (includes stripJsonComments) |
| Development: Shared infrastructure | One-time | ~2 hours | PipelineStateCache, schema updates |
| Testing | One-time | ~6.5 hours | ~79 tests across 3 modules + integration (§21 estimate) |
| Review (Ralph loop) | One-time | ~2 hours | Estimated 2-3 rounds |
| Infrastructure | Recurring | $0 | No external services, no cloud resources |
| Runtime overhead | Recurring | < 5ms/tool call CPU | In-memory operations only |
| Storage | Recurring | ~1KB/pipeline run | `.jsonl` observation + audit files, local SSD |
| Third-party services | Recurring | $0 | No external dependencies |

**Total one-time estimate**: ~23 hours development + testing + review

## 15. Priority Downgrade Justifications

| Item | Phase 1 Priority | Phase 2 Design Priority | Justification |
|------|-----------------|------------------------|---------------|
| AC-6 (soft gate when checkpoint unavailable) | Core | No enforcement component | By design — checkpoint-enforced soft gate degrades to Ralph review. No separate component needed. |
| Phase 3→4 interception gap (Phase 4 deliverables = test files) | — | Accepted gap | `test_file` too broad for precise blocking. Phase 3 deliverable documents (`test-plan*.md`) ARE correctly classified. Writing test code files during Phase 3 is lower severity than writing business code before tests. Ralph review is safety net. |
| JSONC config with stripJsonComments (vs full yaml library) | — | Peripheral (~40 lines bundled) | Only needs comment stripping + JSON.parse. Full yaml library adds ~200KB for unused features. |
| Session buffer observations | Secondary (US-6) | Peripheral | Data is for future Phase 3 auto-detection. Not consumed by any Phase 2 logic. |

## 15a. OMO Multi-Agent Defense Model

### Problem Statement

Oh-My-OpenCode (OMO) is an OpenCode plugin that provides multi-agent orchestration — parallel sub-agents, background tasks, and team mode. In OMO environments:

1. **Each sub-agent runs in its own OpenCode session** with its own plugin instances (including watchdog)
2. **All sessions share the same filesystem** — same `state.json`, same source files
3. **Sub-agents have full tool access** by default — they can call `tdd_checkpoint`, `edit`, `write`, and any plugin tool
4. **OMO registers custom editing tools** (e.g., `hashline_edit`) that bypass the watchdog's hardcoded `edit`/`write` tool filter

Without defensive design, sub-agents can:
- Write to `state.json` concurrently with the orchestrator → race conditions → corrupted/lost state transitions
- Call `tdd_checkpoint` to create a second pipeline → conflicting pipeline states → unpredictable interception
- Use custom editing tools to bypass file interception → TDD invariants silently violated

### Four-Layer Defense

| Layer | Mechanism | Where | What It Prevents |
|-------|-----------|-------|------------------|
| **L0: Install-time check** | Installation agent detects OMO config and verifies sub-agent `tools` lists exclude `tdd_checkpoint` | TDD pipeline skill install script | Prevents sub-agents from having the tool at all |
| **L1: OMO tools whitelist** | OMO agent configuration excludes `tdd_checkpoint` from sub-agent tool lists | `oh-my-opencode.json[c]` | Blocks tool registration for sub-agents |
| **L2: Pipeline ownership** | `ownerSessionId` in `PipelineState` + `CheckpointHandler` rejects non-owner writes + single-pipeline-per-project constraint | `checkpoint.ts` (§5.5a) | Prevents state corruption even if L0+L1 fail |
| **L3: Config-driven monitored tools** | `monitoredTools` in `.opencode/watchdog.jsonc` replaces hardcoded `edit`/`write` check | `interceptor.ts` (§7.2), `watchdog.jsonc` (§7.4.1) | Intercepts OMO custom editing tools |

**Defense-in-depth principle**: Each layer independently prevents a class of attacks. All four must fail simultaneously for a sub-agent to corrupt pipeline state AND bypass file interception.

### L0: Install-Time Verification (TDD Pipeline Skill)

During TDD pipeline skill installation, the installation agent:

1. Detects whether `oh-my-opencode` / `oh-my-openagent` is registered in `opencode.json` or `opencode.jsonc`
2. If present, reads `oh-my-opencode.json[c]` agent configuration
3. For each non-primary agent (not `sisyphus`):
   - If `tools` list is **explicitly declared** and includes `tdd_checkpoint` → **error**: require removal before proceeding
   - If `tools` list is **not declared** (uses runtime defaults) → **warning**: suggest explicit declaration excluding `tdd_checkpoint`
4. Verifies `watchdog.jsonc` `monitoredTools` includes OMO custom editing tools if detected

**Strict vs lenient**: Installation does not block on warnings. Errors (explicit `tdd_checkpoint` in sub-agent tools) are blocking. Warnings (implicit tool access) are informational.

### L1: OMO Tools Whitelist

Recommended OMO configuration:

```jsonc
// .opencode/oh-my-opencode.jsonc
{
  "agents": {
    "sisyphus": {
      // Primary agent — full tool access including tdd_checkpoint
    },
    "hephaestus": {
      "tools": ["edit", "write", "read", "grep", "glob", "bash", "task"]
      // NOTE: tdd_checkpoint and tdd_state NOT included
    }
    // ... other sub-agents similarly exclude tdd_checkpoint
  }
}
```

This is the user's responsibility. L0 helps verify it. L2 provides the safety net.

### L2: Pipeline Ownership (§5.5a)

- `PipelineState.ownerSessionId`: set on `pipeline_start`, preserved by spread pattern (`...state`) in all other transitions (not explicitly enforced by schema — accepted risk)
- `CheckpointHandler`: rejects writes from non-owner sessions with clear guidance
- Single-pipeline-per-project: `pipeline_start` rejected if non-stale active pipeline already exists (stale pipelines can be restarted by owner only; Phase 1 legacy pipelines excepted — see Key Decisions)
- Audit trail: all ownership-violation rejections logged as `BLOCK` with violation strings: `owner_mismatch` (Step A + Step B stale+non-owner), `duplicate_pipeline` (Step B non-stale), `corrupted_state` (Step B corrupted). Empty-sessionID rejection (Guard 1) is not audited — no session identity to record. See §5.5a pseudocode for full strings.

### L3: Config-Driven Monitored Tools (§7.4.1)

- `monitoredTools` in `.opencode/watchdog.jsonc`: array of tool names to intercept
- Default: `["edit", "write"]` (OpenCode built-ins)
- OMO users: add `"hashline_edit"` or other custom editing tools
- `PathExtractor` generic fallback: for custom tools, tries `filePath > file > path > file_path`

### Residual Risks

| Risk | Accepted? | Rationale |
|------|-----------|-----------|
| Sub-agent starts pipeline before orchestrator | Yes (design invariant) | OMO orchestrator always starts the pipeline before spawning sub-agents. If a sub-agent calls `pipeline_start` first, it becomes owner and the orchestrator is locked out. This is an operational invariant, not a code-level defense — enforced by OMO's agent lifecycle. |
| Non-`pipeline_start` event on corrupted state bypasses ownership | Yes | `hasOwner(null)` → false → ownership skipped. Rejection still occurs via downstream `validateTransition` → `NO_ACTIVE_RUN`, but defense is coincidental, not structural. See §5.5a Step A comment. |
| Parallel agents write same file (content conflict) | Yes | Different tasks → different files. Last-write-wins acceptable. Not a TDD invariant issue. |
| Sub-agent enters passive mode (no active pipeline) → writes freely | Yes | Correct behavior — sub-agents work within the orchestrator's current phase. No pipeline in sub-agent session = no interception needed. |
| L0 install check skipped by user | Yes | L2 provides complete safety net. L0 is defense-in-depth, not sole protection. |
| OMO adds new editing tool not in `monitoredTools` config | Partially | PathExtractor generic fallback + user must update config. Not auto-detected. |

### .jsonl Concurrency Safety

`.jsonl` files (observations, audit log) use `appendFileSync`. Under concurrent multi-session writes:
- POSIX `O_APPEND` flag guarantees each `write` syscall is atomic at the kernel level
- Each entry is a self-contained JSON line — no cross-line dependencies
- Line ordering between sessions is non-deterministic but each line is complete
- **No additional locking needed**

### StateStore.write() Atomicity

`StateStore.write()` uses write-then-rename pattern (`writeFileSync(tmp) → renameSync(tmp, target)`):
- `rename` is atomic on POSIX — the target file is either the old content or the new content, never a mix
- With L2 ownership enforcement, only the owner session writes `state.json` — no concurrent renames
- **Single-writer guarantee enforced by L2, not by the filesystem**

### Non-OMO Regression Safety

All four defense layers are **additive** — they do not alter behavior in single-agent mode:

| Layer | Non-OMO behavior | Regression? |
|-------|-----------------|-------------|
| L0: Install check | Skipped (OMO not installed) | None |
| L1: OMO tools whitelist | Not applicable (no OMO agents) | None |
| L2: Pipeline ownership | `ownerSessionId === self` → always passes | None (one string comparison) |
| L3: Config-driven monitoredTools | Default `["edit", "write"]` = old hardcoded value | None |

Cache strategy is adaptive (§5.1): non-OMO mode uses in-memory cache (Phase 1 behavior, ~0.1ms), OMO mode reads from disk (~1ms). Mode detected once at plugin init. Phase 1 tests continue to pass without modification.

---

## 16. Boundary Review

### 16.1 Single-Sentence Job

| Module | One-Sentence Job |
|--------|-----------------|
| Observer | "Record that a reviewer was spawned during a Ralph round." |
| Interceptor | "Block file writes that violate TDD phase invariants." |
| CheckpointHandler (Phase 2 extensions) | "Validate articulation content and enforce reviewer presence at round completion." |
| ArticulationValidator | "Check whether articulation text covers three required dimensions." |
| FileClassifier | "Map a file path to a category and phase number." |
| PathExtractor | "Extract the target file path from edit/write tool arguments." |
| SessionBuffer | "Remember tool calls that happen when no pipeline is running." |
| PipelineStateCache | "Keep pipeline state in memory so hooks don't read disk on every tool call." |
| WatchdogConfig | "Read phase deliverable patterns from a JSONC config file." |

### 16.2 Inter-Module Dependency Justification

| Dependency | From → To | Justified? | Reason |
|-----------|-----------|-----------|--------|
| Interceptor → FileClassifier | Interception needs to know file category | ✅ | Core classification logic; pure function with injected config |
| Interceptor → PathExtractor | Interception needs file path from tool args | ✅ | Tool-specific arg extraction; pure function |
| Interceptor → InterceptRules | Interception evaluates rules | ✅ | Policy separated from mechanism |
| Interceptor → PipelineStateCache | Interception needs current phase/status | ✅ | Required for rule predicates (phase number, test evidence) |
| Observer → PipelineStateCache | Observation needs pipeline state (ralph.round) | ✅ | Required for round correlation |
| Observer → PipelineStore | Observation writes to .jsonl | ✅ | Persistence |
| Observer → SessionBuffer | No-pipeline observations | ✅ | Separate storage for non-pipeline data |
| CheckpointHandler → Observer | AC-2 degradation check | ✅ | Observer knows if it failed; checkpoint handler enforces |
| CheckpointHandler → PipelineStateCache | Cache update after state write | ✅ | Keeps cache in sync with disk |
| CheckpointHandler → ArticulationValidator | Content dimension validation | ✅ | Pure function, no state |
| CheckpointHandler → PipelineStore | State persistence | ✅ | Inherited from Phase 1 |

**No circular dependencies.** All dependencies flow: Cache → State → Store (persistence), or Hook → Interceptor/Observer → Cache (read) / Store (write).

### 16.3 Minimum API Surface

| Module | Public API Surface | Assessment |
|--------|-------------------|------------|
| Observer | `handle()`, `isDegraded()`, `clearDegradation()` | ✅ Minimal — 3 methods |
| Interceptor | `handle()` | ✅ Minimal — 1 method |
| FileClassifier | `classifyFile()` | ✅ Minimal — 1 function |
| PathExtractor | `extractFilePath()` | ✅ Minimal — 1 function |
| SessionBuffer | `record()`, `getSession()`, `clearSession()` | ✅ Minimal — CRUD-like |
| PipelineStateCache | `get()`, `update()`, `clear()` | ✅ Minimal — adaptive: memory cache (non-OMO) or disk read (OMO) |
| WatchdogConfig | `loadWatchdogConfig()` | ✅ Minimal — 1 function |
| ArticulationValidator | `validate()` | ✅ Minimal — 1 function |

## 17. Security Review

### 17.1 Threat Model

| Actor | Attack Surface | Risk Level | Mitigation |
|-------|---------------|------------|------------|
| LLM (adversarial prompt) | Calls edit/write to bypass TDD invariants | Medium | Interceptor blocks violations mechanically. LLM cannot bypass `throw`. |
| LLM (confused) | Calls edit/write to wrong phase deliverable | Low | Interceptor blocks with clear guidance. LLM sees error and adjusts. |
| Corrupted state.json | Cache loads corrupted data → wrong interception decisions | Low | Lazy-populate reads state.json; parse failure → cache stays null → fail-open (AC-8). Checkpoint writes are atomic (write + rename pattern in PipelineStore). |
| File system race | State file modified between cache update and next hook | Very Low | Single-writer invariant (A-5). Only checkpoint handler writes state, same process. |
| Config injection | Malicious `.opencode/watchdog.jsonc` in project root | Low | Config only affects file classification patterns. Worst case: all files classified as `unknown` → no interception (safe degradation). No code execution from config. |

### 17.2 Trust Boundaries

```
[LLM Context]                    [Plugin Server-Side]              [Local Filesystem]
 (untrusted)                       (trusted)                         (trusted)
                                                                    
 LLM calls tool ──► OpenCode dispatch ──► Plugin hooks         State files
                     (trust boundary)     (trusted zone)        (.jsonl, .json)
                                            │                       
                                            ├── Interceptor reads cache
                                            ├── Observer writes observations  
                                            └── Cache reads state.json
```

**Key trust boundary**: LLM context → OpenCode dispatch. The LLM is untrusted — it may attempt to write files that violate TDD invariants. The interceptor is the enforcement point on the trusted side of this boundary.

### 17.3 Data Protection

| Data | Sensitivity | At Rest | In Transit | Notes |
|------|------------|---------|-----------|-------|
| PipelineState (phase, ralph rounds) | Low | Local filesystem (`.jsonl`) | N/A (no network) | Not sensitive — TDD process metadata |
| ObservationEntry | Low | Local filesystem (`.jsonl`) | N/A | Records tool call metadata |
| AuditLogEntry | Low | Local filesystem (`.jsonl`) | N/A | Decision history |
| `.opencode/watchdog.jsonc` | None | Local filesystem | N/A | File patterns, no secrets |
| Session buffer | Low | In-memory only | N/A | Cleared on restart |

**No encryption needed** — all data is local, no network transit, no sensitive user data.

### 17.4 Input Validation

| Input Source | Trust Level | Validation | Location |
|-------------|------------|------------|----------|
| Tool name from OpenCode dispatch | Trusted (OpenCode provides) | String comparison (`edit`, `write`, `Task`) | Interceptor, Observer |
| Tool args (file path) | Untrusted (LLM provides) | Type check (`typeof === 'string'`), null check | PathExtractor |
| Checkpoint event payload | Untrusted (LLM provides) | Phase number validation, string type checks | CheckpointHandler |
| Articulation text | Untrusted (LLM provides) | Dimension pattern matching (not regex-injection-safe by design — acceptable for server-side pattern matching) | ArticulationValidator |
| Config JSONC | Semi-trusted (project file) | Structure validation, type checks on parsed values | WatchdogConfig |

### 17.5 Security Test Scenarios (→ Phase 3/4)

| Scenario | Expected Behavior |
|----------|------------------|
| LLM writes business code without test evidence | Blocked by AC-3 |
| LLM writes Phase 3 deliverable during Phase 2 | Blocked by AC-4 |
| Corrupted state.json causes cache to return wrong phase | Fail-open → no interception (safe degradation) |
| Config file with `ignorePatterns: ["*"]` | All files classified as `unknown` → no interception |
| LLM calls `edit` with non-string filePath | PathExtractor returns null → interceptor allows (safe degradation) |

## 18. System Quality Checklist

### 18.1 Operability

| Dimension | Assessment |
|-----------|------------|
| **Concurrency** | Adaptive: single-agent mode uses in-memory cache (single-writer, synchronous update); OMO multi-agent mode reads from disk on every `get()` (sub-agents always see latest state). Mode detected once at plugin init. `.jsonl` files accept concurrent `appendFileSync` (POSIX `O_APPEND` atomicity). Hook execution within a session is synchronous and serial. |
| **Reversibility** | All write operations are append-only (.jsonl). State mutations go through `applyTransition` (pure function). Cache can be cleared and re-populated. Interception blocks are temporary — LLM retries after addressing root cause. |
| **Resources** | Memory: bounded by SessionBuffer (1000 entries) + degradation maps (cleared on completion). CPU: < 5ms per hook call. Disk: append-only writes (~1ms). No timeout risks in hot path. |

### 18.2 Observability

| Dimension | Assessment |
|-----------|------------|
| **Alerts** | No automated alerts (local plugin, no monitoring infra). Violations surface to LLM as error messages. Degradation events logged as warnings. Operator reviews logs manually. |
| **Health** | Normal operation: < 5ms hook latency, no warnings. Deviation: logged warnings at `warn` level. Stale runs detected at startup. |
| **Debug** | All hooks log at `debug` level with tool name, callID, sessionID. Interceptions log at `info` level with violation details. Failures log at `warn`/`error` level with error message. |

### 18.3 Data

| Dimension | Assessment |
|-----------|------------|
| **Isolation** | PipelineState never enters LLM context. Hooks are server-side. Observations and audit logs are local-only. |
| **Loss risk** | Observer degradation flag is in-memory — lost on crash (acceptable, advisory only). In-memory failure counter lost on restart (acceptable per AC-5). SessionBuffer lost on restart (acceptable per AC-10). All persisted data (.jsonl) survives restart. |

### 18.4 Performance

| Dimension | Assessment |
|-----------|------------|
| **Latency** | < 5ms per tool call (A-4). Single-agent mode: in-memory cache, ~0.1ms. OMO mode: disk read (~1ms) per hook. Observer `appendFileSync` (~1ms) in both modes. |
| **Throughput** | Expected: ~1 tool call/second (LLM-paced). Design budget: 200 tool calls/second (5ms budget). Headroom: ~70x. |
| **Caching** | Adaptive (§5.1): non-OMO mode uses in-memory cache (~0.1ms); OMO mode reads from disk every call (~1ms). Mode detected once at plugin init. |

### 18.5 Maintainability

| Dimension | Assessment |
|-----------|------------|
| **Change point** | New intercept rule: add to `interceptRules` array (1 file). New observation type: add new `OBS_TYPE_*` constant + Observer path (2 files). New phase deliverable pattern: edit `.opencode/watchdog.jsonc` (0 code files). |
| **Logic leakage** | Interception logic: self-contained in Interceptor + InterceptRules. Observation logic: self-contained in Observer. Articulation logic: self-contained in ArticulationValidator. No cross-module business logic. |
| **Extension cost** | New role with hooks: add to `activeRoles` in assemblePlugin (1 line). New config option: add field to `WatchdogConfig` interface + JSONC example (2 files). New checkpoint event: add case to transitions + checkpoint handler (2 files). |

---

---

## 19. Divergences from TechSpec

Phase 2 design supersedes TechSpec §3.2 in these areas:

| Aspect | TechSpec §3.2 | Phase 2 Design | Reason |
|--------|--------------|----------------|--------|
| Interception mechanism | Return violation string from onToolBefore | throw `WatchdogInterceptError` to block (OTQ-01); unexpected errors also throw (fail-closed) | OpenCode has no abort field in output; throw is the only way to block. `WatchdogInterceptError` distinguishes expected violations from infrastructure failures. |
| File pattern scope | Business code patterns only (src/lib/app) | Code + document files (C-4) | Phase 1-3 deliverables are markdown files |
| Observation storage | Not specified | PipelineStore shared .jsonl (OQ-2) | Same key structure, avoids second StateStore |
| Reviewer detection | Not specified | Accept all Task calls (OQ-1) | False positives harmless, false negatives dangerous |
| Hook registration | Plugin wraps registered tools | Plugin returns global hook keys | Must intercept built-in edit/write, not just plugin tools |
| Degradation | Not specified | 3-failure in-memory counter + articulationDegraded flag | Prevents infinite validation loops |

## 20. Open Technical Questions

**None remaining.** All three OQs from the requirements document are resolved:

- **OQ-1** ✅: Accept all Task calls as potential reviews. Rationale in §6.2.
- **OQ-2** ✅: ObservationEntry stored in PipelineStore (shared .jsonl). Design in §6.5.
- **OQ-3** ✅: edit args use `filePath`, write args use `file`. Design in §7.3.

## 20.1 Deferred: Manual Quality Review (Non-phase Deliverable Review)

**Status**: Deferred to future phase. Not in Phase 2 scope.

**Problem**: TDD pipeline phases cover phase deliverables (requirements, design, test plan, test code, business code). But projects also have persistent documentation (README, CHANGELOG, API docs) that fall outside any phase. These are classified as `unknown` by FileClassifier → not intercepted → only reviewed when Ralph happens to see them in a normal round. There is no way to explicitly request a dedicated Ralph review loop for such files.

**Two candidate designs evaluated**:

| Approach | Description | Complexity |
|----------|-------------|------------|
| **A. Lightweight** (recommended when implemented) | New checkpoint event `quality_review`: LLM calls `tdd_checkpoint('quality_review', {files, reason})`. Watchdog records the request in audit log, Ralph reviewer spawns normally and reviews the listed files. No new state machine, no new lifecycle. Results in audit log only. | ~50 lines, no schema change |
| **B. Full Pipeline** | Independent `QualityReviewState` with its own lifecycle (start → in_progress rounds → passed/failed → archived). Multi-round loop with pass/fail criteria. Parallel to TDD pipeline. | ~300 lines, new schema + store extension |

**Decision**: Approach A is sufficient for the use case. Ralph loop already provides multi-round review capability. A dedicated state machine is overkill for ad-hoc file quality checks. When implemented, Approach A should be a new case in `CheckpointHandler.handle()` that validates the files list, writes an audit entry, and returns guidance for the LLM to spawn a reviewer.

**Extension point**: The `ignorePatterns` config (§7.4.1) and the `quality_review` event are complementary — `ignorePatterns` controls which files bypass interception, `quality_review` provides a mechanism to explicitly request review for any file regardless of classification.

## 21. Test Plan Summary

### 21.1 Module A — Event Observation (~22 tests)

| Category | Tests | Key Scenarios |
|----------|-------|---------------|
| Observer | 6 | Task + pipeline → observation; Task + no pipeline → buffer; non-Task → skip |
| AC-2 | 4 | Round with observation → pass; without → violation; wrong round → fail |
| Dual-channel degradation | 4 | Observer crash → in-memory flag set + `_observer_degraded` entry persisted; AC-2 query returns true; `clearDegradation` clears both channels; flag persists across rounds within same run |
| SessionBuffer | 5 | Record, overflow FIFO, clear, multiple sessions |
| Integration | 3 | Full pipeline flow with observations; crash recovery observation loss; downstream reads `_observer_degraded` entry from store |

### 21.2 Module B — File Interception

> Ownership and multi-agent test cases moved to `Phase3-TestPlan.md`.

| Category | Tests | Key Scenarios |
|----------|-------|---------------|
| PathExtractor | 6 | edit filePath, write file, missing path, non-edit/write, generic fallback (filePath), generic fallback (path) |
| FileClassifier | 8 | test patterns, business code, phase deliverables, unknown, edge cases |
| Config loading | 5 | JSONC with comments loads correctly; missing file → defaults; malformed JSONC → defaults + warning; extra phases preserved; monitoredTools parsed |
| Monitored tools | 3 | Default tools only intercept edit/write; custom tool in config intercepted; custom tool not in config bypasses |
| Rule 1 (AC-3) | 5 | Phase 4/5 no evidence → block; test file → allow; evidence confirmed → allow |
| Rule 2 (AC-4) | 5 | Phase N+1 deliverable + Phase N incomplete → block; complete → allow |
| Interceptor | 3 | No pipeline → silent; non-intercepted tool → skip; multiple rules |
| Integration | 4 | Full flow: edit business code in Phase 4 without evidence |

### 21.3 Module C — Articulation Validation (~20 tests)

| Category | Tests | Key Scenarios |
|----------|-------|---------------|
| ArticulationValidator | 8 | All dimensions pass; each dimension missing; too short; all dimensions missing |
| Degradation | 4 | 3 failures → degraded; success resets; degradation persists; restart loses counter |
| transitions.ts | 4 | Valid preconditions; wrong phase; not active; phase not entered |
| checkpoint.ts | 4 | Full flow: ok=true; ok=false with guidance; degraded note; re-validation |

### 21.4 Total Estimate

| Module | Tests |
|--------|-------|
| Module A | ~22 |
| Module B | See `Phase3-TestPlan.md` |
| Module C | ~20 |
| Integration (full flow) | ~10 |

---

## 22. Ralph Loop Review Log

### Round 1 (Critic + Ralph)
- C: 0 | H: 4 | M: 4 | L: 4 | I: 1
- Critic: 0C/1H/7M/3L — all fixed before R1
- Issues: H-1 regex syntax, H-2 method binding, H-3 Phase 4→5 gap, H-4 Phase 0 crash, M-1 callID propagation, M-2 phase_enter defaults, M-3 counter carryover, M-4 directory listing
- All ADOPTed and fixed

### Round 2
- C: 0 | H: 0 | M: 2 | L: 3 | I: 1
- Issues: M-1 Phase 3→4 gap (acknowledged), M-2 cross-platform basename, L-1 dead code, L-2 missing import, L-3 rendering
- All ADOPTed and fixed
- Consecutive-zero C/H count: 1

### Round 3 (Early Stop)
- C: 0 | H: 0 | M: 0 | L: 3
- Issues: L-1 JSDoc remnant, L-2 duplicate step numbering, L-3 disk I/O claim accuracy
- All ADOPTed and fixed
- Consecutive-zero C/H count: 2 (R2 + R3) — **EARLY STOP**

### User Design Iteration 3: OMO Multi-Agent Defense (post-gate)

Gate review passed (12/12 criteria). User identified five risks from OMO multi-agent environment:
1. **Cache staleness** (L1): Sub-agents have independent in-memory caches, share same `state.json`
2. **Custom tool bypass** (L2): OMO registers editing tools (e.g., `hashline_edit`) not in hardcoded `edit`/`write` list
3. **Hook ordering** (L3): OMO hooks execute before watchdog hooks
4. **Parallel file writes** (L4): Multiple agents writing same file
5. **Background agent脱离** (L5): Sub-agent sessions have no pipeline → watchdog passive

User-proposed solutions adopted:
- **主 agent 串行 checkpoint 模型**: Only orchestrator advances pipeline state; sub-agents read-only
- **每次读磁盘**: Eliminate in-memory cache for multi-agent consistency (~1ms overhead, within budget)
- **配置化工具列表**: `monitoredTools` in `watchdog.jsonc` instead of hardcoded `edit`/`write`
- **`ownerSessionId`**: Pipeline ownership prevents sub-agent state writes + single-pipeline constraint
- **安装检查**: L0 install-time OMO config verification

FIFO queue for writes rejected — not feasible in synchronous hook API, and unnecessary (different agents write different files).

Four-layer defense model added (§15a):
- L0: Install-time check (TDD pipeline skill)
- L1: OMO tools whitelist
- L2: Pipeline ownership (`ownerSessionId` + single-pipeline constraint)
- L3: Config-driven `monitoredTools` + PathExtractor generic fallback

Changes applied to: §4.1 (schema), §5.1 (adaptive cache), §5.5a (ownership), §7.2 (interceptor), §7.3 (PathExtractor), §7.4.1 (config), §9 (components), §15a (new section), §16 (failure modes), §18 (NFR), §21 (test plan ~79→~85), §22 (this log).

Cache strategy revised from "always disk read" to "adaptive" after user regression analysis question:
- Non-OMO mode: in-memory cache (Phase 1 behavior, ~0.1ms, zero regression)
- OMO mode: disk read every call (~1ms, multi-agent safe)
- Mode detected once at plugin init by checking OMO registration in `opencode.json`
- Phase 1 tests continue to pass (cache defaults to single-agent mode)
