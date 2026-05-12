import { join } from 'node:path';
import { writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { RoleRegistration } from '@opencode-ai/core/plugin/registration';
import { WorkflowStore } from '@opencode-ai/core/store/workflow-store';
import { SnapshotExtractor } from './reflection/snapshot-extractor.js';
import { AristotleExecutor } from './executor.js';
import { IdleEventHandler } from './idle-handler.js';
import { createAristotleTools } from './tools.js';
import { resolveConfig } from './config.js';

export async function createAristotleRole(ctx: any): Promise<RoleRegistration | null> {
  // 1. API probe — if promptAsync is unavailable, return null
  if (typeof ctx?.client?.session?.promptAsync !== 'function') {
    return null;
  }

  // 2. Parse config
  const config = resolveConfig();
  const sessionsDir = ctx.config?.aristotleBridge?.sessionsDir ?? config.sessions_dir;

  // 3. Create bridge-active marker (dot-prefixed to match MCP side convention)
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

  // Cleanup snapshot files older than 7 days
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of readdirSync(sessionsDir)) {
      if (!f.endsWith('_snapshot.json')) continue;
      const p = join(sessionsDir, f);
      if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
    }
  } catch {}

  // 4. Create components
  const instanceId = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const store = new WorkflowStore(sessionsDir, instanceId);
  await store.reconcileOnStartup(ctx.client);

  const snapshotExtractor = new SnapshotExtractor(sessionsDir);
  const executor = new AristotleExecutor(ctx.client, store, snapshotExtractor);
  const idleHandler = new IdleEventHandler(ctx.client, store, executor, { sessionsDir, mcpDir: config.mcp_dir });

  // 5. Create tools
  const tools = createAristotleTools({
    store,
    executor,
    client: ctx.client,
  });

  // 6. Return RoleRegistration
  return {
    tools,
    async onIdle(sessionId: string) {
      await idleHandler.handle(sessionId);
    },
  };
}
