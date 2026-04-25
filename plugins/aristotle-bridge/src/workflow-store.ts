import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowState } from './types.js';
import { extractLastAssistantText } from './utils.js';
import { logger } from './logger.js';

export class WorkflowStore {
  private workflows = new Map<string, WorkflowState>();
  private readonly storePath: string;
  private static readonly MAX_WORKFLOWS = 50;

  constructor(sessionsDir: string) {
    this.storePath = join(sessionsDir, 'bridge-workflows.json');
    this.loadFromDisk();
  }

  register(wf: WorkflowState): boolean {
    if (this.workflows.size >= WorkflowStore.MAX_WORKFLOWS && !this.workflows.has(wf.workflowId)) {
      if (!this.evictOldestNonRunning()) {
        return false;
      }
    }
    this.workflows.set(wf.workflowId, wf);
    this.saveToDisk();
    return true;
  }

  findByWorkflowId(workflowId: string): WorkflowState | undefined {
    return this.workflows.get(workflowId);
  }

  findBySession(sessionId: string): WorkflowState | undefined {
    for (const wf of this.workflows.values()) {
      if (wf.sessionId === sessionId) return wf;
    }
    return undefined;
  }

  retrieve(workflowId: string):
    | { error: string }
    | { status: 'running' }
    | { status: 'chain_pending' }
    | { status: 'chain_broken'; error?: string }
    | { status: 'error'; error?: string }
    | { status: 'undone' }
    | { status: 'cancelled' }
    | { status: 'completed'; result: string }
  {
    const wf = this.workflows.get(workflowId);
    if (!wf) return { error: 'Workflow not found' };
    if (wf.status === 'running') return { status: 'running' };
    if (wf.status === 'chain_pending') return { status: 'chain_pending' as const };
    if (wf.status === 'chain_broken') return { status: 'chain_broken' as const, error: wf.error };
    if (wf.status === 'error') return { status: 'error', error: wf.error };
    if (wf.status === 'undone') return { status: 'undone' };
    if (wf.status === 'cancelled') return { status: 'cancelled' };
    return { status: 'completed', result: wf.result || '' };
  }

  getActive(): { active: Array<{ workflow_id: string; status: string; started_at: number }> } {
    const active = [...this.workflows.values()]
      .filter(wf => wf.status === 'running' || wf.status === 'chain_pending')
      .map(wf => ({
        workflow_id: wf.workflowId,
        status: wf.status,
        started_at: wf.startedAt,
      }));
    return { active };
  }

  markCompleted(id: string, result: string): void {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = 'completed';
      wf.result = result;
      this.saveToDisk();
    }
  }

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

  markError(id: string, message: string): void {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = 'error';
      wf.error = message;
      this.saveToDisk();
    }
  }

  markUndone(id: string): void {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = 'undone';
      this.saveToDisk();
    }
  }

  cancel(id: string): void {
    const wf = this.workflows.get(id);
    if (wf) {
      wf.status = 'cancelled';
      this.saveToDisk();
    }
  }

  async reconcileOnStartup(client: any): Promise<void> {
    // Phase 1: Recover chain_broken workflows (terminal, just log)
    const chainBroken = [...this.workflows.entries()]
      .filter(([_, wf]) => wf.status === 'chain_broken');
    for (const [id, wf] of chainBroken) {
      logger.warn('chain_broken from prior run: wf=%s agent=%s error=%s',
        id, wf.agent, wf.error ?? 'unknown');
    }

    // Phase 2: Recover chain_pending workflows (mid-chain crash)
    const chainPending = [...this.workflows.entries()]
      .filter(([_, wf]) => wf.status === 'chain_pending');
    for (const [id, wf] of chainPending) {
      logger.warn('recovering chain_pending workflow: wf=%s agent=%s', id, wf.agent);
      if (wf.agent === 'R') {
        logger.warn('R chain_pending recovered as completed, but MCP state may be at "checking" phase. No C was launched.');
      }
      this.markCompleted(id, wf.result || '');
      logger.info('recovered chain_pending → completed: wf=%s', id);
    }

    const running = [...this.workflows.entries()].filter(([_, wf]) => wf.status === 'running');
    for (let i = 0; i < running.length; i += 5) {
      const batch = running.slice(i, i + 5);
      await Promise.allSettled(
        batch.map(async ([id, wf]) => {
          try {
            const msgs = await client.session.messages({ path: { id: wf.sessionId } });
            const hasAssistant = msgs.data.some((m: any) => m.info.role === 'assistant');
            if (hasAssistant) {
              const result = extractLastAssistantText(msgs.data);
              this.markCompleted(id, result);
            }
          } catch {
            this.markError(id, 'Session not found during reconciliation');
          }
        }),
      );
    }
  }

  private loadFromDisk(): void {
    try {
      const data = readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return;
      for (const wf of parsed) {
        if (wf && typeof wf === 'object' && typeof wf.workflowId === 'string') {
          this.workflows.set(wf.workflowId, wf);
        }
      }
    } catch {
      // file missing or corrupted — start with empty store
    }
  }

  private saveToDisk(): void {
    try {
      const tmpPath = this.storePath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify([...this.workflows.values()], null, 2), 'utf-8');
      renameSync(tmpPath, this.storePath);
    } catch (e) {
      console.error('[aristotle-bridge] failed to persist workflow store:', e);
    }
  }

  private evictOldestNonRunning(): boolean {
    const candidates = [...this.workflows.entries()]
      .filter(([_, wf]) => wf.status !== 'running' && wf.status !== 'chain_pending')
      .sort(([_, a], [__, b]) => a.startedAt - b.startedAt);
    if (candidates.length > 0) {
      this.workflows.delete(candidates[0][0]);
      return true;
    }
    return false;
  }
}
