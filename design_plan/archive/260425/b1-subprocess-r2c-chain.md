# B1: Plugin-Driven R→C Chain via Subprocess

> Created: 2025-04-25
> Status: Ready for implementation (Council + Oracle R1–R4, all fixes incorporated)
> Problem: LLM won't execute SKILL.md polling loop after async `aristotle_fire_o` returns

## Review History
- **Council**: APPROVE WITH REVISIONS (R1–R4)
- **Oracle R1**: APPROVE WITH FIXES (F-1 Critical, F-2/F-4 High)
- **Oracle R2**: APPROVE WITH FIXES (I-1–I-9, all incorporated)
- **Oracle R3**: APPROVE WITH FIXES (Issue 1–7, all incorporated)
- **Oracle R4**: APPROVE WITH FIXES (Issue 1–9, all incorporated)
- **Oracle R5** (Oracle-ds4p): APPROVE WITH FIXES (Issue 1–6, all incorporated)
- **Oracle R6** (Oracle-ds4p): APPROVE WITH FIXES (Issue 1 — launchResult.status check)

## Background

### Problem
After `aristotle_fire_o` returns `{status: "running"}`, the LLM stops — it does not enter the SKILL.md MULTI-STAGE LOOP (poll `aristotle_check` → call `orchestrate_on_event` → launch C). The R→C chain breaks at the first step.

### Root Cause
LLMs cannot reliably execute multi-step imperative control flows across tool-call boundaries. The async tool return triggers a "task done" interpretation. This is a fundamental LLM agent failure mode: **async handoff without callback**.

### Why Option B1
Previous investigation evaluated 6 approaches (A–F in `r2c-bridge-integration.md`, then B1–B5 sub-approaches). B1 (subprocess) is the only approach that:
- Zero logic duplication (MCP remains single source of truth)
- Zero drift risk (no TypeScript copy of Python state machine)
- ~40 lines of new code
- `uv run` warm cache ~200ms latency (once per reflection, acceptable)
- Fully testable (mock subprocess in vitest)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│ opencode process (Bridge Plugin)                 │
│                                                  │
│  idle-handler.ts                                 │
│    1. R sub-session idle → extract result        │
│    2. markCompleted(workflowId, result)           │
│    3. if agent === 'R':                          │
│       a. subprocess: uv run _cli.py subagent_done │
│       b. parse response → {action: "fire_sub"}   │
│       c. executor.launch(C) via opencode SDK     │
│    4. if agent === 'C':                          │
│       a. subprocess: uv run _cli.py subagent_done │
│       b. parse response → {action: "notify"}     │
│       c. markFinalDone()                          │
│                                                  │
│  executor.ts (unchanged)                         │
│    - session.create + promptAsync                 │
│                                                  │
├─────────────────────────────────────────────────┤
│ MCP process (Python, stdio)                      │
│                                                  │
│  _orch_event.py (minimal change — Oracle R4 Issue 1)                    │
│    orchestrate_on_event("subagent_done", ...)     │
│    → returns action:"done" (was "notify") for checking completion │
│    → unchanged for all other paths               │
│    → creates reflection record                   │
│    → builds checker prompt                       │
│    → updates workflow phase                      │
│    → returns {action, sub_prompt, sub_role}       │
│                                                  │
│  _cli.py (NEW)                                   │
│    Thin CLI wrapper: sys.argv → orchestrate → JSON│
└─────────────────────────────────────────────────┘
```

---

## Detailed Design

### 1. New File: `aristotle_mcp/_cli.py`

Thin CLI entry point for subprocess invocation from Bridge Plugin.

```python
"""CLI entry point for Bridge Plugin subprocess calls.

Usage: python -m aristotle_mcp._cli <event_type>
Reads data_json from stdin (avoids ARG_MAX limit on large payloads).
Writes result JSON to stdout.
"""
import sys
import json
from aristotle_mcp._orch_event import orchestrate_on_event


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python -m aristotle_mcp._cli <event_type>\n")
        print(json.dumps({"error": "Usage: python -m aristotle_mcp._cli <event_type>"}))
        sys.exit(1)

    event_type = sys.argv[1]
    data_json = sys.stdin.read()

    if not data_json:
        sys.stderr.write("No data provided on stdin\n")
        print(json.dumps({"error": "No data provided on stdin"}))
        sys.exit(1)

    try:
        result = orchestrate_on_event(event_type, data_json)
        print(json.dumps(result))
    except Exception as e:
        # Write error JSON to stdout AND detail to stderr.
        # stdout error JSON lets the TS side parse it even on exit(1).
        err_json = json.dumps({"error": str(e)})
        sys.stderr.write(f"orchestrate_on_event error: {e}\n")
        print(err_json)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

**Key design decisions:**
- **stdin for payload** (Council R1, Oracle F-2): avoids macOS `ARG_MAX` (~256KB) limit. AI-generated reflection results can exceed this.
- `event_type` stays as `sys.argv[1]` (short, never large)
- `execFile` with `input` option — no shell involvement, same security posture
- Errors to stderr + exit code 1 (standard subprocess error handling). Error JSON also written to stdout so TS side can parse it even on non-zero exit.
- JSON on stdout (single line, easy to parse)
- Module-executable: `python -m aristotle_mcp._cli` (no path hardcoding). Uses `python` (not `python3`) because `uv run` provides the correct Python interpreter.
- No 🦉 prefix check needed: `_orch_event.py` returns `action:"done"` for checking-phase success (not `action:"notify"`). All `notify` responses from `subagent_done` are errors/edge cases. (Oracle R4 Issue 1)

### 2. Modified File: `aristotle_mcp/_orch_event.py` (1-line change — Oracle R4 Issue 1)

The checking-phase `subagent_done` completion (line ~278) must return `"action": "done"` instead of `"action": "notify"`. This ensures `_cli.py` passes successful completions through (exit 0) and only treats `notify` responses as errors.

```diff
  # In §6 "Reflect flow: subagent_done + checking":
- return {
-     "action": "notify",
-     "workflow_id": workflow_id,
-     "message": msg,
- }
+ return {
+     "action": "done",
+     "workflow_id": workflow_id,
+     "message": msg,
+ }
```

All other branches in `_orch_event.py` remain unchanged.

### 3. New File: `plugins/aristotle-bridge/src/logger.ts` (Oracle R4 Issue 3)

The design uses a `logger` module throughout. It must be created as part of B1 implementation.

```typescript
/**
 * Simple logger controlled by ARISTOTLE_LOG env var.
 * Set ARISTOTLE_LOG=debug for verbose output, otherwise only error/warn.
 */
const level = (process.env.ARISTOTLE_LOG ?? 'info').toLowerCase();
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(l: string): boolean {
  return (LEVELS[l] ?? 99) >= (LEVELS[level] ?? 1);
}

export const logger = {
  debug: (fmt: string, ...args: unknown[]) => shouldLog('debug') && console.error(`[aristotle:debug] ${fmt}`, ...args),
  info:  (fmt: string, ...args: unknown[]) => shouldLog('info')  && console.error(`[aristotle:info] ${fmt}`, ...args),
  warn:  (fmt: string, ...args: unknown[]) => shouldLog('warn')  && console.error(`[aristotle:warn] ${fmt}`, ...args),
  error: (fmt: string, ...args: unknown[]) => shouldLog('error') && console.error(`[aristotle:error] ${fmt}`, ...args),
};
```

Uses `console.error` (stderr) to avoid polluting stdout (reserved for subprocess JSON).

### 4. Modified File: `plugins/aristotle-bridge/src/idle-handler.ts`

After `markCompleted`, detect R/C agent and drive the chain.

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { extractLastAssistantText } from './utils.js';
import type { WorkflowState } from './types.js';
import type { WorkflowStore } from './workflow-store.js';
import type { AsyncTaskExecutor } from './executor.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

/** Result from MCP subprocess call */
interface McpResult {
  action?: string;
  workflow_id?: string;
  sub_prompt?: string;
  sub_role?: string;
  message?: string;
  error?: string;
}

/**
 * Resolve MCP project directory:
 * 1. ARISTOTLE_MCP_DIR env var (highest priority)
 * 2. Walk up from sessionsDir looking for pyproject.toml + aristotle_mcp/ dir
 *    (defense-in-depth — typically fails for standard installs where aristotle
 *    is not an ancestor of ~/.config/opencode/)
 * 3. Fallback to hard-coded path (primary resolution for most users)
 *
 * Oracle R4 Issue 6: Phase 2 should prioritize _cli.py --print-project-dir
 * to replace the hardcoded fallback with auto-detection.
 */
export function resolveMcpProjectDir(sessionsDir: string): string {  // exported for testing
  const envDir = process.env.ARISTOTLE_MCP_DIR;
  if (envDir && existsSync(join(envDir, 'pyproject.toml')) && existsSync(join(envDir, 'aristotle_mcp'))) {
    return envDir;
  }

  // Walk up from sessionsDir (~/.config/opencode/aristotle-sessions)
  let dir = sessionsDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pyproject.toml')) && existsSync(join(dir, 'aristotle_mcp'))) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback (local dev)
  const envFallback = process.env.ARISTOTLE_PROJECT_DIR;
  if (envFallback && existsSync(join(envFallback, 'aristotle_mcp'))) return envFallback;
  return process.cwd();
}

export class IdleEventHandler {
  private readonly mcpProjectDir: string;

  constructor(
    private client: any,
    private store: WorkflowStore,
    private executor: AsyncTaskExecutor,
    sessionsDir: string,
  ) {
    this.mcpProjectDir = resolveMcpProjectDir(sessionsDir);
    logger.info('mcpProjectDir=%s', this.mcpProjectDir);
  }

  async handle(sessionID: string): Promise<void> {
    const wf: WorkflowState | undefined = this.store.findBySession(sessionID);
    logger.debug('idle handle: session=%s found=%s status=%s agent=%s',
      sessionID, !!wf, wf?.status ?? 'n/a', wf?.agent ?? 'n/a');
    if (!wf || wf.status !== 'running') return;

    try {
      // 1. Extract result from sub-session
      const messages = await this.client.session.messages({ path: { id: sessionID } });
      const result = extractLastAssistantText(messages.data);

      // 2. Transition to chain_pending BEFORE driving chain (Oracle F-1)
      //    This ensures reconcileOnStartup can recover if we crash mid-chain.
      if (wf.agent === 'R' || wf.agent === 'C') {
        this.store.markChainPending(wf.workflowId, result);
        logger.info('chain_pending: wf=%s agent=%s session=%s resultLen=%d',
          wf.workflowId, wf.agent, sessionID, (result ?? '').length);

        // 3. Drive chain transition
        if (wf.agent === 'R') {
          await this.driveChainTransition(wf, sessionID, result);
        } else if (wf.agent === 'C') {
          await this.driveChainCompletion(wf, sessionID, result);
        }
      } else {
        // Non-chain agent (shouldn't happen, but safe fallback)
        this.store.markCompleted(wf.workflowId, result);
        logger.info('completed: wf=%s session=%s', wf.workflowId, sessionID);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // If status is chain_pending, the error occurred during chain driving — mark chain_broken
      const currentWf = this.store.findBySession(sessionID);
      if (currentWf?.status === 'chain_pending') {
        this.store.markChainBroken(wf.workflowId, message);
        logger.error('idle-handler chain error: wf=%s %s', wf.workflowId, message);
      } else if (currentWf?.status === 'cancelled') {
        // Oracle R3 Issue 3: abort already handled — don't overwrite with error
        logger.warn('idle-handler: wf=%s already cancelled, skipping error mark', wf.workflowId);
      } else {
        this.store.markError(wf.workflowId, message);
        logger.error('idle-handler error: wf=%s %s', wf.workflowId, message);
      }
    }
  }

  private async driveChainTransition(
    wf: WorkflowState, sessionId: string, result: string
  ): Promise<void> {
    logger.info('R→C transition: wf=%s', wf.workflowId);

    const action = await this.callMCP('subagent_done', {
      workflow_id: wf.workflowId,
      result,
      session_id: sessionId,
    });

    if (action.error) {
      // Subprocess failed — mark as chain_broken (Council R3)
      this.store.markChainBroken(wf.workflowId, action.error);
      logger.error('MCP subprocess error, chain broken: wf=%s %s', wf.workflowId, action.error);
      return;
    }

    if (action.action === 'fire_sub') {
      // Oracle R4 Issue 4: validate workflow_id match (defense-in-depth)
      if (action.workflow_id !== wf.workflowId) {
        this.store.markChainBroken(wf.workflowId, `MCP returned mismatched workflow_id: ${action.workflow_id}`);
        logger.error('workflow_id mismatch: expected=%s got=%s', wf.workflowId, action.workflow_id);
        return;
      }
      logger.info('launching C: wf=%s', action.workflow_id);
      try {
        const launchResult = await this.executor.launch({
          workflowId: action.workflow_id,
          oPrompt: action.sub_prompt,
          agent: action.sub_role || 'C',
          parentSessionId: wf.parentSessionId,
        });
        // Oracle R6 Issue 1: executor.launch catches errors internally and returns
        // {status: 'error'} instead of throwing. Must check launchResult.status.
        if (launchResult.status === 'error') {
          this.store.markChainBroken(wf.workflowId, `C launch failed: ${launchResult.message}`);
          logger.error('C launch failed (status=error): wf=%s %s', wf.workflowId, launchResult.message);
          return;
        }
        // Oracle R4 Issue 2: do NOT markCompleted here.
        // executor.launch → store.register() overwrites entry with C's session (status=running).
        // C's idle handler will call markCompleted with C's result.
        logger.info('C launched: wf=%s cSession=%s', wf.workflowId, launchResult.session_id);
      } catch (launchError) {
        // executor.launch threw — chain is broken
        const msg = launchError instanceof Error ? launchError.message : String(launchError);
        this.store.markChainBroken(wf.workflowId, `C launch failed: ${msg}`);
        logger.error('C launch failed, chain broken: wf=%s %s', wf.workflowId, msg);
      }
    } else if (action.action === 'done') {
      // Chain complete (e.g., R found nothing to analyze, or C checking finished)
      this.store.markCompleted(wf.workflowId, result);
      logger.info('chain complete (%s): wf=%s', action.action, wf.workflowId);
    } else if (action.action === 'notify') {
      // Oracle R5 Issue 1: all 'notify' from subagent_done are errors/edge cases.
      // (checking completion returns 'done'; only error paths return 'notify')
      const msg = action.message || 'MCP returned notify';
      this.store.markChainBroken(wf.workflowId, msg);
      logger.warn('MCP notify (error/edge case): wf=%s msg=%s', wf.workflowId, msg);
    } else {
      // Unexpected action — mark chain_broken so it's visible
      const msg = `Unexpected MCP action: ${action.action ?? 'undefined'}`;
      this.store.markChainBroken(wf.workflowId, msg);
      logger.warn('unexpected action: wf=%s action=%s', wf.workflowId, action.action);
    }
  }

  private async driveChainCompletion(
    wf: WorkflowState, sessionId: string, result: string
  ): Promise<void> {
    logger.info('C completion: wf=%s', wf.workflowId);

    const action = await this.callMCP('subagent_done', {
      workflow_id: wf.workflowId,
      result,
      session_id: sessionId,
    });

    if (action.error) {
      this.store.markChainBroken(wf.workflowId, action.error);
      logger.error('MCP subprocess error, chain broken: wf=%s %s', wf.workflowId, action.error);
      return;
    }

    if (action.action === 'done') {
      this.store.markCompleted(wf.workflowId, result);
      logger.info('reflection complete: %s', action.message ?? 'done');
    } else if (action.action === 'notify') {
      // Oracle R5 Issue 1: all 'notify' from subagent_done are errors/edge cases
      const msg = action.message || 'MCP returned notify';
      this.store.markChainBroken(wf.workflowId, msg);
      logger.warn('MCP notify (error/edge case): wf=%s msg=%s', wf.workflowId, msg);
    } else if (action.action === 'fire_sub') {
      // Note: current _orch_event.py checking phase returns 'done' (not fire_sub),
      // but future re-reflect support may return 'fire_sub' here.
      logger.info('re-reflect requested: wf=%s', action.workflow_id);
      // Oracle R4 Issue 4: validate workflow_id
      if (action.workflow_id !== wf.workflowId) {
        this.store.markChainBroken(wf.workflowId, `MCP returned mismatched workflow_id: ${action.workflow_id}`);
        return;
      }
      try {
        const launchResult = await this.executor.launch({
          workflowId: action.workflow_id,
          oPrompt: action.sub_prompt,
          agent: action.sub_role || 'R',
          parentSessionId: wf.parentSessionId,
        });
        // Oracle R6 Issue 1: check launchResult.status (launch doesn't throw on error)
        if (launchResult.status === 'error') {
          this.store.markChainBroken(wf.workflowId, `Re-reflect launch failed: ${launchResult.message}`);
          logger.error('re-reflect launch failed (status=error): wf=%s %s', wf.workflowId, launchResult.message);
          return;
        }
        // Oracle R4 Issue 2: no markCompleted — new R's register() takes over
      } catch (launchError) {
        const msg = launchError instanceof Error ? launchError.message : String(launchError);
        this.store.markChainBroken(wf.workflowId, `Re-reflect launch failed: ${msg}`);
        logger.error('re-reflect launch failed: wf=%s %s', wf.workflowId, msg);
      }
    } else {
      const msg = `Unexpected MCP action: ${action.action ?? 'undefined'}`;
      this.store.markChainBroken(wf.workflowId, msg);
      logger.warn('unexpected action: wf=%s action=%s', wf.workflowId, action.action);
    }
  }

  /**
   * Call MCP orchestrate_on_event via subprocess.
   * Uses stdin for payload to avoid ARG_MAX limit (Council R1).
   */
  private async callMCP(eventType: string, data: Record<string, string>): Promise<McpResult> {
    const dataJson = JSON.stringify(data);
    try {
      const { stdout } = await execFileAsync('uv', [
        'run', 'python', '-m', 'aristotle_mcp._cli',
        eventType,
      ], {
        cwd: this.mcpProjectDir,
        timeout: 30000,
        input: dataJson,  // payload via stdin (Council R1)
      });
      return JSON.parse(stdout.trim()) as McpResult;
    } catch (e: any) {
      // execFileAsync throws on non-zero exit code.
      // Try to parse error from stdout (if Python wrote JSON before exit).
      if (e.stdout) {
        try {
          const parsed = JSON.parse(String(e.stdout).trim()) as McpResult;
          // Oracle R4 Issue 9: check with 'in' operator, not truthiness
          if ('error' in parsed && parsed.error !== undefined) return parsed;
        } catch {}
      }
      const stderr = e.stderr ? String(e.stderr) : '';
      logger.error('subprocess failed: %s stderr=%s', e.message, stderr);
      return { error: e.message };
    }
  }
}
```

### 5. Modified File: `plugins/aristotle-bridge/src/index.ts`

Pass `executor` and `sessionsDir` to `IdleEventHandler` constructor.

```diff
- const idleHandler = new IdleEventHandler(ctx.client, store);
+ const idleHandler = new IdleEventHandler(ctx.client, store, executor, sessionsDir);
```

Also update `aristotle_abort` to handle new states (Oracle R2 I-7, R5 Issue 2):

```typescript
// In aristotle_abort handler, insert BEFORE the existing `if (wf.status !== 'running')` catchall:
// chain_broken is terminal — return its error (no state change)
if (wf.status === 'chain_broken') {
  return { status: 'chain_broken', error: wf.error };
}

// chain_pending is cancellable (like running) — abort + mark cancelled
if (wf.status === 'chain_pending') {
  await client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
  store.cancel(workflowId);
  return { status: 'cancelled', workflow_id: workflowId };
}

// Existing handler continues for:
// - 'running' → abort + cancel (unchanged)
// - 'completed', 'error', 'undone', 'cancelled' → fall through to existing catchall
```

Note: returns plain objects (not `JSON.stringify`), matching existing code convention.

### 6. Simplification: `SKILL.md`

The Bridge path in MULTI-STAGE LOOP (lines 56-80) becomes unnecessary — the plugin handles R→C automatically. But the **non-Bridge path** (lines 81-83, using `task()` subagent) must be preserved for Claude Code and environments without the Bridge plugin.

**Bridge path simplification:**
```
If use_bridge is true:
  a. Call aristotle_fire_o → returns {status: "running"}
  b. Display notify_message to user
  c. STOP — plugin drives R→C chain in background
  d. User can call aristotle_check later for final results
```

**No changes to non-Bridge path** — `task()` + `orchestrate_on_event` still works as before.

### 7. Modified File: `plugins/aristotle-bridge/src/types.ts`

Add `chain_pending` and `chain_broken` to WorkflowState status union.

```diff
- status: 'running' | 'completed' | 'error' | 'undone' | 'cancelled';
+ status: 'running' | 'chain_pending' | 'completed' | 'error' | 'chain_broken' | 'undone' | 'cancelled';
```

**Status semantics:**
- `chain_pending`: R/C completed, subprocess called or about to be called. Recoverable on restart.
- `chain_broken`: Subprocess failed or returned error. Terminal state. Visible via `aristotle_check`.
- `completed`: Final terminal state. Chain fully driven (or non-chain agent).

### 8. Modified File: `plugins/aristotle-bridge/src/workflow-store.ts`

Add `markChainPending`, `markChainBroken`, and chain recovery in `reconcileOnStartup`.

```typescript
markChainPending(id: string, result: string): void {
  const wf = this.workflows.get(id);
  if (wf) {
    wf.status = 'chain_pending';
    wf.result = result;
    this.saveToDisk();
  }
}

markChainBroken(id: string, error: string): void {
  const wf = this.workflows.get(id);
  if (wf) {
    wf.status = 'chain_broken';
    wf.error = error;
    this.saveToDisk();
  }
}
```

**Chain recovery in `reconcileOnStartup`** (Oracle F-4 + R2 I-8):
```typescript
// In reconcileOnStartup, run BEFORE existing running workflow reconciliation:

// Phase 1: Recover chain_broken workflows (terminal, just log)
const chainBroken = [...this.workflows.entries()]
  .filter(([_, wf]) => wf.status === 'chain_broken');
for (const [id, wf] of chainBroken) {
  logger.warn('chain_broken from prior run: wf=%s agent=%s error=%s',
    id, wf.agent, wf.error ?? 'unknown');
  // No state change — chain_broken is already terminal
}

// Phase 2: Recover chain_pending workflows (mid-chain crash)
const chainPending = [...this.workflows.entries()]
  .filter(([_, wf]) => wf.status === 'chain_pending');
for (const [id, wf] of chainPending) {
  logger.warn('recovering chain_pending workflow: wf=%s agent=%s', id, wf.agent);
  // Oracle R4 Issue 5: if agent is R, MCP state may already be at "checking" phase
  // (callMCP succeeded but executor.launch crashed). Log warning about data inconsistency.
  if (wf.agent === 'R') {
    logger.warn('R chain_pending recovered as completed, but MCP state may be at "checking" phase. No C was launched.');
  }
  this.markCompleted(id, wf.result || '');
  logger.info('recovered chain_pending → completed: wf=%s', id);
}

// Phase 3: Existing running workflow reconciliation (unchanged)
```

**Update `retrieve()` to handle new states** (Oracle R2 I-4):
```diff
  retrieve(workflowId: string):
    | { error: string }
    | { status: 'running' }
+   | { status: 'chain_pending' }
    | { status: 'error'; error?: string }
+   | { status: 'chain_broken'; error?: string }
    | { status: 'undone' }
    | { status: 'cancelled' }
    | { status: 'completed'; result: string }
  {
    const wf = this.workflows.get(workflowId);
    if (!wf) return { error: 'Workflow not found' };
    if (wf.status === 'running') return { status: 'running' };
+   if (wf.status === 'chain_pending') return { status: 'chain_pending' };
+   if (wf.status === 'chain_broken') return { status: 'chain_broken', error: wf.error };
    if (wf.status === 'error') return { status: 'error', error: wf.error };
    ...
  }
```

**Protect `chain_pending` from eviction** in `evictOldestNonRunning`:
```diff
- .filter(([_, wf]) => wf.status !== 'running')
+ .filter(([_, wf]) => wf.status !== 'running' && wf.status !== 'chain_pending')
```

**Update `getActive()` to include `chain_pending`** (Oracle R3 Issue 2):
```diff
- .filter(wf => wf.status === 'running')
+ .filter(wf => wf.status === 'running' || wf.status === 'chain_pending')
```
Note: `chain_pending` is typically short-lived (~200ms subprocess call). Including it ensures users polling `aristotle_check` see active mid-chain workflows. The user-facing docs should note that `chain_pending` means "R/C done, driving next phase."

**`resolveMcpProjectDir` Phase 2 upgrade path** (Oracle R3 Issue 7):
The current fallback uses `ARISTOTLE_PROJECT_DIR` env var or `process.cwd()`. Phase 2 will improve this with:
- **Option A**: `_cli.py --print-project-dir` flag — Python resolves `aristotle_mcp` package location via `__file__` and prints the parent directory. TS side calls this once at plugin init.
- **Option B**: `aristotleBridge.mcpDir` config option in `opencode.json` — user sets it explicitly.
Preferred: **Option A** (zero-config, auto-detected).

### 9. Test Changes

**`test/idle-handler.test.ts`** — mock `execFileAsync` to test:
- R completion → subprocess called with `subagent_done` → `fire_sub` response → executor.launch called
- R completion → executor.launch throws → `markChainBroken` called
- C completion → subprocess called → `notify` response → no further action
- C completion → `fire_sub` response (re-reflect) → executor.launch called
- Subprocess error → `markChainBroken`, no crash
- Subprocess timeout → `markChainBroken`, no crash
- MCP returns unexpected action → `markChainBroken`
- `chain_pending`/`chain_broken` status → `handle()` early return (not `running`)
- Non-chain agent → `markCompleted` (fallback path)
- Error after `markChainPending` → `markChainBroken` (not `markError`)
- Error after `cancelled` by abort → status preserved (not overwritten)
- `resolveMcpProjectDir`: env var set → uses it; env var unset → walk-up finds project; walk-up fails → fallback
- `callMCP`: subprocess exit(1) with stdout JSON → parses error from `e.stdout`

**`test/workflow-store.test.ts`** — new tests:
- `markChainPending()` — status transitions to `chain_pending`, result saved
- `markChainBroken()` — status transitions to `chain_broken`, error saved
- `retrieve()` — `chain_pending` returns `{status: 'chain_pending'}`, `chain_broken` returns `{status: 'chain_broken', error}`
- `reconcileOnStartup()` Phase 1 — `chain_broken` stays `chain_broken` (just logged)
- `reconcileOnStartup()` Phase 2 — `chain_pending` → `completed`
- `reconcileOnStartup()` ordering — Phase 2 runs before Phase 3
- `evictOldestNonRunning` — `chain_pending` not evicted
- `getActive()` — includes `chain_pending` workflows

**`test/index.test.ts`** — new tests:
- `aristotle_abort` for `chain_pending` → `cancelled`
- `aristotle_abort` for `chain_broken` → returns error, no state change

**`aristotle_mcp/test_cli.py`** — test the CLI entry point:
- Valid invocation → correct JSON output
- Invalid args → error JSON + exit 1
- Missing stdin → error JSON + exit 1
- MCP checking-phase success (`action:"done"`) → exit 0, JSON passed through
- MCP error (`action:"notify"` with 🦉) → exit 0, JSON passed through (error discrimination is in TS side)

**`test_orch_event.py`** — verify `_orch_event.py` checking completion returns `"done"`:
- `subagent_done` + `phase=checking` → returns `action:"done"` (not `action:"notify"`)

**`test_logger.ts`** — verify logger module:
- Default level: info/warn/error logged, debug suppressed
- `ARISTOTLE_LOG=debug`: all levels logged
- Output goes to stderr (not stdout)

---

## Edge Cases

| Case | Handling |
|------|----------|
| Subprocess fails (uv not found, Python error) | `callMCP` returns `{error}`, idle handler calls `markChainBroken`. `aristotle_check` returns `chain_broken` with error details. User sees the failure. |
| Subprocess times out (30s) | `execFileAsync` timeout → same `chain_broken` path. |
| MCP returns unexpected action | Marked as `chain_broken`. Visible via `aristotle_check`. |
| Re-reflect (C requests deeper analysis) | `driveChainCompletion` handles `fire_sub` → launches another R. Note: current MCP returns `done` from checking phase (not `fire_sub`), so this code path is dormant but ready for future re-reflect support. |
| User runs `/undo` during R→C chain | `aristotle_abort` cancels sub-session. When idle handler fires, store status is `cancelled` → early return (no chain transition). |
| Concurrent R→C chains | Each workflow is independent. Subprocess calls are sequential per workflow (idle events fire one at a time). |
| Plugin restarts mid-chain | `reconcileOnStartup` finds `chain_pending` workflows and recovers them (marks as completed, C was just not launched). |
| Plugin crashes after markChainPending but before subprocess | `reconcileOnStartup` finds `chain_pending` → marks as completed. C never launched, but R result preserved. |
| Plugin crashes after subprocess succeeds but before executor.launch(C) | MCP state is `phase: "checking"` but no C running. `reconcileOnStartup` finds C's `chain_pending` → same recovery path. Note: MCP workflow file is already mutated, so the `checking` phase is valid — just no session executing it. User can retry `/aristotle` for a new chain. |
| Large R result (>256KB) | Payload via stdin (not argv) — no size limit. `execFile` `input` option writes to stdin without shell involvement. |

---

## Risks

| Risk | Mitigation | Severity |
|------|-----------|----------|
| `uv run` cold start slow (~2-5s) | Warm cache ~200ms. Pre-warm at plugin init if needed. | Low |
| Shell escaping in data_json | Use `sys.argv` not shell interpolation. `execFile` passes args directly (no shell). | None |
| MCP state file race (plugin + LLM both read/write) | Plugin only writes via MCP subprocess. LLM no longer needs to call `orchestrate_on_event`. Single writer. | None |
| Python dependency missing in subprocess | `uv run` resolves dependencies automatically. Same env as MCP server. | None |
| `ARISTOTLE_MCP_DIR` hardcoded | Phase 2: auto-detect via `_cli.py --print-project-dir` or `aristotleBridge.mcpDir` config option (see §8). | Medium |

---

## Migration Plan

1. Add `_cli.py` — zero risk, new file
2. Modify `_orch_event.py` — 1-line change (`notify` → `done` in checking completion)
3. Create `logger.ts` — new file (zero risk)
4. Modify `idle-handler.ts` — add executor param + subprocess logic
5. Modify `index.ts` — pass executor to IdleEventHandler
6. Add tests — mock subprocess
7. Build + deploy
8. Test A7 with tmux script
9. Simplify SKILL.md (remove MULTI-STAGE LOOP) — after A7 passes
10. Update TESTING.md with new expected behavior

---

## What This Changes

| Before (LLM-driven) | After (Plugin-driven) |
|----------------------|----------------------|
| LLM calls `fire_o` → polls `aristotle_check` → calls `orchestrate_on_event` → calls `fire_o` again | LLM calls `fire_o` once → plugin handles R→C automatically |
| SKILL.md has 30-line MULTI-STAGE LOOP | SKILL.md simplified to "call fire_o, then STOP" |
| Unreliable (LLM stops mid-loop) | Reliable (deterministic code) |
| No subprocess overhead | ~200ms subprocess per phase transition |
| LLM sees intermediate results | LLM only sees final result via `aristotle_check` |
