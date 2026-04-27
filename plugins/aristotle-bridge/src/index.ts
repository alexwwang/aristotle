import { join } from 'node:path';
import { homedir } from 'node:os';
import { writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { detectApiMode } from './api-probe.js';
import { WorkflowStore } from './workflow-store.js';
import { AsyncTaskExecutor } from './executor.js';
import { IdleEventHandler } from './idle-handler.js';
import { logger } from './logger.js';

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

  const instanceId = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const store = new WorkflowStore(sessionsDir, instanceId);
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
    tool: {
      aristotle_fire_o: {
        description: 'Launch an Aristotle workflow sub-agent (Reflector) via the Bridge plugin',
        args: {
          workflow_id: z.string().describe('Unique workflow identifier'),
          o_prompt: z.string().describe('The orchestrator prompt to send to the sub-agent'),
          agent: z.string().optional().describe('Agent role: R (reflector, default) or C (checker)'),
          target_session_id: z.string().optional().describe('Target session ID to analyze'),
        },
        execute: async (args: any, context: any) => {
          const sessionId = context?.sessionID || '';
          logger.debug('fire_o: args.target_session_id=%s context.sessionID=%s sessionId=%s',
            args.target_session_id || '<empty>', context?.sessionID || '<missing>', sessionId);
          const result = await executor.launch({
            workflowId: args.workflow_id,
            oPrompt: args.o_prompt,
            agent: args.agent ?? 'R',
            parentSessionId: sessionId,
            targetSessionId: args.target_session_id || sessionId,
          });
          return JSON.stringify(result);
        },
      },

      aristotle_check: {
        description: 'Check the status of an Aristotle workflow, or list all active workflows',
        args: {
          workflow_id: z.string().optional().describe('Workflow ID to check; omit to list all active'),
        },
        execute: async (args: any) => {
          if (!args.workflow_id) {
            return JSON.stringify(store.getActive());
          }
          return JSON.stringify(store.retrieve(args.workflow_id));
        },
      },

      aristotle_abort: {
        description: 'Cancel a running Aristotle workflow',
        args: {
          workflow_id: z.string().describe('Workflow ID to cancel'),
        },
        execute: async (args: any) => {
          const wf = store.findByWorkflowId(args.workflow_id);
          if (!wf) {
            return JSON.stringify({ error: 'Workflow not found' });
          }
          if (wf.status === 'cancelled') {
            return JSON.stringify({ status: 'cancelled', workflow_id: args.workflow_id });
          }
          if (wf.status === 'chain_broken') {
            return JSON.stringify({ status: 'chain_broken', error: wf.error });
          }
          if (wf.status === 'chain_pending') {
            await ctx.client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
            store.cancel(args.workflow_id);
            return JSON.stringify({ status: 'cancelled', workflow_id: args.workflow_id });
          }
          if (wf.status !== 'running') {
            return JSON.stringify({ status: wf.status, workflow_id: args.workflow_id });
          }
          await ctx.client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
          store.cancel(args.workflow_id);
          return JSON.stringify({ status: 'cancelled', workflow_id: args.workflow_id });
        },
      },
    },

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
