import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { extractLastAssistantText } from './utils.js';
import type { WorkflowState } from './types.js';
import type { WorkflowStore } from './workflow-store.js';
import type { AsyncTaskExecutor } from './executor.js';
import { logger } from './logger.js';
import { resolveConfig } from './config.js';

const TRIGGER_FILENAME = '.trigger-reflect.json';
const ABORT_TRIGGER_FILENAME = '.trigger-abort.json';

/** Result from MCP subprocess call */
interface McpResult {
  action?: string;
  workflow_id?: string;
  sub_prompt?: string;
  sub_role?: string;
  message?: string;
  error?: string;
}

export class IdleEventHandler {
  private readonly mcpProjectDir: string;
  private readonly sessionsDir: string;

  constructor(
    private client: any,
    private store: WorkflowStore,
    private executor: AsyncTaskExecutor,
    sessionsDir: string,
  ) {
    this.sessionsDir = sessionsDir;
    this.mcpProjectDir = resolveConfig().mcp_dir;
    logger.debug('mcpProjectDir=%s sessionsDir=%s', this.mcpProjectDir, this.sessionsDir);
  }

  async handle(sessionID: string): Promise<void> {
    // Check for trigger files before normal idle handling
    // Process aborts BEFORE launching new work (prevents immediate abort of just-created workflow)
    await this.checkAbortTrigger();
    await this.checkTrigger(sessionID);

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
      // Bug #14b: R finished without needing C
      this.notifyParent(wf.parentSessionId,
        `🦉 Aristotle ran — no issues found. (${wf.workflowId})`);
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
      // Bug #14b: full R→C chain complete
      this.notifyParent(wf.parentSessionId,
        `🦉 Reflection complete (${wf.workflowId}). Use /aristotle review to see results.`);
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
   * Send a fire-and-forget notification to the parent session.
   * Uses prompt({noReply:true}) — Gate #2 verified: non-blocking + message visible.
   * Best-effort: failures are logged but never throw.
   */
  private notifyParent(parentSessionId: string, message: string): void {
    if (!parentSessionId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      void Promise.race([
        this.client.session.prompt({
          path: { id: parentSessionId },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: message }],
          },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('notification timeout')), 5000);
        }),
      ]).finally(() => { if (timer) clearTimeout(timer); })
        .then(() => logger.info('notifyParent: sent to session=%s', parentSessionId))
        .catch((e) => logger.warn('notifyParent: failed for session=%s %s',
          parentSessionId, e instanceof Error ? e.message : e));
    } catch (e) {
      // Synchronous error (e.g., invalid arguments) — log and move on
      logger.warn('notifyParent: sync error for session=%s %s',
        parentSessionId, e instanceof Error ? e.message : e);
    }
  }

  /**
   * Check for an abort trigger file written by an external test harness
   * or as a defense-in-depth cancellation mechanism.
   * If found, abort all active (running/chain_pending) workflows.
   * The trigger file is deleted after processing (success or failure).
   *
   * Trigger JSON format:
   *   { "workflow_ids": ["wf_xxx", "wf_yyy"] }
   *   If workflow_ids is empty or absent, ALL active workflows are aborted.
   */
  private async checkAbortTrigger(): Promise<void> {
    const triggerPath = join(this.sessionsDir, ABORT_TRIGGER_FILENAME);
    if (!existsSync(triggerPath)) return;

    let targetIds: string[] = [];
    try {
      const raw = readFileSync(triggerPath, 'utf-8');
      const parsed = JSON.parse(raw);
      targetIds = Array.isArray(parsed.workflow_ids) ? parsed.workflow_ids : [];
    } catch (e) {
      logger.error('abort trigger parse error: %s', e instanceof Error ? e.message : e);
      try { unlinkSync(triggerPath); } catch {}
      return;
    }

    // Delete trigger immediately to prevent re-processing
    try { unlinkSync(triggerPath); } catch {}

    // Determine which workflows to abort
    const active = this.store.getActive().active;
    const toAbort = targetIds.length > 0
      ? active.filter(wf => targetIds.includes(wf.workflow_id))
      : active; // Empty array → abort all active

    if (toAbort.length === 0) {
      logger.info('abort trigger: no active workflows to cancel');
      return;
    }

    let cancelled = 0;
    for (const wf of toAbort) {
      if (wf.status !== 'running' && wf.status !== 'chain_pending') continue;
      try {
        const wfData = this.store.findByWorkflowId(wf.workflow_id);
        if (wfData?.sessionId) {
          await this.client.session.abort({ path: { id: wfData.sessionId } }).catch(() => {});
        }
        this.store.cancel(wf.workflow_id);
        cancelled++;
        logger.info('abort trigger: cancelled wf=%s', wf.workflow_id);
      } catch (e) {
        logger.error('abort trigger: failed to cancel wf=%s %s',
          wf.workflow_id, e instanceof Error ? e.message : e);
      }
    }
    logger.info('abort trigger: cancelled %d/%d workflows', cancelled, toAbort.length);
  }

  /**
   * Check for a trigger file written by an external test harness.
   * If found, call orchestrate_start("reflect") via subprocess and launch R.
   * The trigger file is deleted after processing (success or failure).
   *
   * Trigger JSON format:
   *   { "session_id": "ses_xxx", "project_directory": "/path", ... }
   *   All fields are passed as args_json to orchestrate_start("reflect").
   */
  private async checkTrigger(parentSessionId: string): Promise<void> {
    const triggerPath = join(this.sessionsDir, TRIGGER_FILENAME);
    if (!existsSync(triggerPath)) return;

    let trigger: Record<string, string>;
    try {
      const raw = readFileSync(triggerPath, 'utf-8');
      trigger = JSON.parse(raw);
    } catch (e) {
      logger.error('trigger file parse error: %s', e instanceof Error ? e.message : e);
      try { unlinkSync(triggerPath); } catch {}
      return;
    }

    logger.info('trigger detected: session=%s project=%s', trigger.session_id, trigger.project_directory);

    // Call orchestrate_start("reflect") via subprocess
    const result = await this.callMCPStart('reflect', trigger);
    try { unlinkSync(triggerPath); } catch {}

    if (result.error) {
      logger.error('trigger orchestrate_start failed: %s', result.error);
      return;
    }

    if (result.action === 'fire_sub' && result.sub_prompt) {
      logger.info('trigger: launching R for wf=%s', result.workflow_id);
      try {
        // Use trigger.session_id as parent — R must be a child of the
        // session being reflected on, not whichever session happened to idle.
        const launchResult = await this.executor.launch({
          workflowId: result.workflow_id!,
          oPrompt: result.sub_prompt,
          agent: result.sub_role || 'R',
          parentSessionId: trigger.session_id,
          targetSessionId: trigger.session_id,
        });
        if (launchResult.status === 'error') {
          logger.error('trigger: R launch failed: %s', launchResult.message);
        } else {
          logger.info('trigger: R launched, session=%s', launchResult.session_id);
        }
      } catch (launchError) {
        const msg = launchError instanceof Error ? launchError.message : String(launchError);
        logger.error('trigger: R launch threw: %s', msg);
      }
    } else {
      logger.warn('trigger: unexpected action=%s', result.action ?? 'undefined');
    }
  }

  /**
   * Call MCP orchestrate_start via subprocess.
   * Uses stdin for args_json payload (spawn + stdin.write/end).
   */
  private async callMCPStart(command: string, args: Record<string, string>): Promise<McpResult> {
    return this.runSubprocess(
      ['run', '--project', this.mcpProjectDir, 'python', '-m', 'aristotle_mcp._cli', 'orchestrate_start', command],
      JSON.stringify(args),
    );
  }

  /**
   * Call MCP orchestrate_on_event via subprocess.
   * Uses stdin for payload to avoid ARG_MAX limit (Council R1).
   */
  private async callMCP(eventType: string, data: Record<string, string>): Promise<McpResult> {
    return this.runSubprocess(
      ['run', '--project', this.mcpProjectDir, 'python', '-m', 'aristotle_mcp._cli', eventType],
      JSON.stringify(data),
    );
  }

  /**
   * Run a subprocess via spawn with stdin data.
   * Uses spawn (async) instead of execFile because Node.js async child_process
   * APIs do not support the `input` option — only sync APIs do.
   * Returns parsed JSON from stdout, or { error } on failure.
   */
  private runSubprocess(args: string[], stdinData: string): Promise<McpResult> {
    return new Promise<McpResult>((resolve) => {
      const child = spawn('uv', args, { timeout: 30000 });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d; });
      child.stderr.on('data', (d: Buffer) => { stderr += d; });

      // Oracle rev 1: stdin error handler — child may exit before stdin is consumed
      child.stdin.on('error', () => { /* pipe closed, close event will resolve */ });

      child.on('close', (code, signal) => {
        // Oracle rev 3: distinguish signal kill (timeout) from real errors
        if (signal) {
          const msg = `Process killed by signal ${signal} (timeout?)`;
          logger.error('subprocess killed: %s stderr=%s', msg, stderr);
          resolve({ error: msg });
          return;
        }
        if (code !== 0) {
          // Try to parse error JSON from stdout (Python may have written it before exit)
          try {
            const parsed = JSON.parse(stdout.trim()) as McpResult;
            if ('error' in parsed && parsed.error !== undefined) {
              resolve(parsed);
              return;
            }
          } catch {}
          logger.error('subprocess failed: exit=%d stderr=%s', code, stderr);
          resolve({ error: `Process exited with code ${code}: ${stderr}` });
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as McpResult);
        } catch (e) {
          resolve({ error: `Invalid JSON output: ${stdout.substring(0, 200)}` });
        }
      });

      child.on('error', (err) => {
        resolve({ error: err.message });
      });

      // Write stdin data and close — this is the correct async API for stdin
      child.stdin.write(stdinData);
      child.stdin.end();
    });
  }
}
