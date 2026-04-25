import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { detectApiMode } from './api-probe.js';
import { WorkflowStore } from './workflow-store.js';
import { AsyncTaskExecutor } from './executor.js';
import { IdleEventHandler } from './idle-handler.js';

const DEFAULT_SESSIONS_DIR = () => join(homedir(), '.config', 'opencode', 'aristotle-sessions');

const AristotleBridgePlugin = async (ctx: any): Promise<any> => {
  const apiMode = await detectApiMode(ctx.client);
  if (!apiMode) {
    console.error('[aristotle-bridge] promptAsync not available. Plugin disabled.');
    return {};
  }

  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir ?? DEFAULT_SESSIONS_DIR();

  // Create bridge-active marker (dot-prefixed to match MCP side convention)
  const markerPath = join(sessionsDir, '.bridge-active');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(markerPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), 'utf-8');

  // Cleanup on exit
  const cleanup = () => {
    try { unlinkSync(markerPath); } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGHUP', cleanup);

  const store = new WorkflowStore(sessionsDir);
  await store.reconcileOnStartup(ctx.client);

  // Cleanup snapshot files older than 7 days
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of readdirSync(sessionsDir)) {
      if (!f.endsWith('_snapshot.json')) continue;
      const p = join(sessionsDir, f);
      if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
    }
  } catch {}

  const executor = new AsyncTaskExecutor(ctx.client, store, sessionsDir);
  const idleHandler = new IdleEventHandler(ctx.client, store, executor, sessionsDir);

  return {
    tool: () => ({
      aristotle_fire_o: async (args: any) => {
        return executor.launch({
          workflowId: args.workflow_id,
          oPrompt: args.o_prompt,
          agent: args.agent ?? 'R',
          parentSessionId: ctx.session?.id,
          targetSessionId: args.target_session_id,
        });
      },

      aristotle_check: async (args: any) => {
        if (!args.workflow_id) {
          return store.getActive();
        }
        return store.retrieve(args.workflow_id);
      },

      aristotle_abort: async (args: any) => {
        const wf = store.findByWorkflowId(args.workflow_id);
        if (!wf) {
          return { error: 'Workflow not found' };
        }
        if (wf.status === 'cancelled') {
          return { status: 'cancelled', workflow_id: args.workflow_id };
        }
        // chain_broken is terminal — return its error (no state change)
        if (wf.status === 'chain_broken') {
          return { status: 'chain_broken', error: wf.error };
        }
        // chain_pending is cancellable (like running) — abort + mark cancelled
        if (wf.status === 'chain_pending') {
          await ctx.client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
          store.cancel(args.workflow_id);
          return { status: 'cancelled', workflow_id: args.workflow_id };
        }
        if (wf.status !== 'running') {
          return { status: wf.status, workflow_id: args.workflow_id };
        }
        await ctx.client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
        store.cancel(args.workflow_id);
        return { status: 'cancelled', workflow_id: args.workflow_id };
      },
    }),

    event: async (event: any) => {
      const e = event.event ?? event;
      if (e.type === 'session.idle') {
        const sessionID = e.properties?.sessionID;
        if (typeof sessionID === 'string') {
          await idleHandler.handle(sessionID);
        }
      }
    },
  };
};

export default AristotleBridgePlugin;
