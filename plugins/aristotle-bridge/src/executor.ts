import type { LaunchArgs, LaunchResult } from './types.js';
import { SnapshotExtractor } from './snapshot-extractor.js';
import type { WorkflowStore } from './workflow-store.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class AsyncTaskExecutor {
  private readonly sessionsDir: string;

  constructor(
    private client: any,
    private store: WorkflowStore,
    sessionsDir?: string,
  ) {
    this.sessionsDir = sessionsDir ?? '';
  }

  async launch(args: LaunchArgs): Promise<LaunchResult> {
    let { workflowId, oPrompt, parentSessionId, targetSessionId } = args;
    const agent: string = args.agent || 'R';

    // 1. Snapshot extraction (non-blocking)
    if (targetSessionId) {
      try {
        const extractor = new SnapshotExtractor(this.sessionsDir || undefined);
        await Promise.race([
          extractor.extract(this.client, targetSessionId, args.focusHint ?? 'last 50 messages', 50),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('snapshot extraction timed out')), 10000)
          ),
        ]);
      } catch (e) {
        console.warn('[aristotle-bridge] snapshot extraction failed:', e);
      }
    }

    // Inject SESSION_FILE path if snapshot exists
    if (targetSessionId) {
      const snapshotPath = join(this.sessionsDir, `${targetSessionId}_snapshot.json`);
      if (existsSync(snapshotPath)) {
        oPrompt = oPrompt.replace('SESSION_FILE: ', `SESSION_FILE: ${snapshotPath}`);
      }
    }

    // 2. Create sub-session
    let session: { data: { id: string } };
    try {
      session = await this.client.session.create({
        body: { title: `aristotle-${workflowId}`, parentID: parentSessionId },
      });
    } catch (e) {
      return {
        workflow_id: workflowId,
        session_id: '',
        status: 'error',
        message: `Failed to create sub-session: ${e}`,
      };
    }

    // 3. Register to store before promptAsync (crash safety)
    const registered = this.store.register({
      workflowId,
      sessionId: session.data.id,
      parentSessionId,
      status: 'running',
      startedAt: Date.now(),
      agent,
      ...(targetSessionId ? { targetSessionId } : {}),
    });

    if (!registered) {
      await this.client.session.abort({ path: { id: session.data.id } }).catch(() => {});
      return {
        workflow_id: workflowId,
        session_id: '',
        status: 'error',
        message: 'Store full: too many concurrent workflows (max 50). Try again later.',
      };
    }

    // 4. promptAsync
    try {
      await this.client.session.promptAsync({
        path: { id: session.data.id },
        body: { agent, parts: [{ type: 'text', text: oPrompt }] },
      });
    } catch (e) {
      await this.client.session.abort({ path: { id: session.data.id } }).catch(() => {});
      this.store.markError(workflowId, `promptAsync failed: ${e}`);
      return {
        workflow_id: workflowId,
        session_id: session.data.id,
        status: 'error',
        message: 'Failed to launch sub-session.',
      };
    }

    return {
      workflow_id: workflowId,
      session_id: session.data.id,
      status: 'running',
      message:
        '🦉 Task launched. workflow_id: ' + workflowId + '. ' +
        'Call aristotle_check("' + workflowId + '") to poll status. ' +
        'Call aristotle_abort("' + workflowId + '") to cancel.',
    };
  }
}
