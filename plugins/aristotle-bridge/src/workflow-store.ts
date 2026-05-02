import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowState } from './types.js';
import { extractLastAssistantText } from './utils.js';
import { logger } from './logger.js';

export class WorkflowStore {
  private workflows = new Map<string, WorkflowState>();
  private readonly storePath: string;
  private readonly instanceId: string;
  private static readonly MAX_WORKFLOWS = 50;
  private static readonly RECONCILE_TIMEOUT_MS = 5000;

  constructor(sessionsDir: string, instanceId: string) {
    this.storePath = join(sessionsDir, 'bridge-workflows.json');
    this.instanceId = instanceId;
    if (!instanceId) throw new Error('instanceId is required');
    this.loadFromDisk();
  }

  register(wf: WorkflowState): boolean {
    if (this.workflows.size >= WorkflowStore.MAX_WORKFLOWS && !this.workflows.has(wf.workflowId)) {
      if (!this.evictOldestNonRunning()) {
        return false;
      }
      // Persist eviction immediately so saveToDisk merge doesn't restore it
      this.saveToDiskRaw();
    }
    const stamped = { ...wf, instanceId: this.instanceId };
    this.workflows.set(wf.workflowId, stamped);
    this.saveToDisk();
    return true;
  }

  findByWorkflowId(workflowId: string): WorkflowState | undefined {
    return this.workflows.get(workflowId);
  }

  /** Remove a workflow from the store entirely (for stale/cleaned-up workflows). */
  remove(workflowId: string): boolean {
    const deleted = this.workflows.delete(workflowId);
    if (deleted) this.saveToDisk();
    return deleted;
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
    // Phase 0: Purge stale terminal entries older than 7 days
    const STALE_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const staleIds: string[] = [];
    for (const [id, wf] of this.workflows.entries()) {
      if (wf.status !== 'running' && wf.status !== 'chain_pending' &&
          now - wf.startedAt > STALE_TERMINAL_MS) {
        staleIds.push(id);
      }
    }
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        this.workflows.delete(id);
      }
      logger.info('purged %d stale terminal workflows (older than 7 days)', staleIds.length);
      this.saveToDiskRaw();
    }

    // Phase 1: Recover chain_broken workflows (terminal, just log own)
    const chainBroken = [...this.workflows.entries()]
      .filter(([_, wf]) => wf.status === 'chain_broken' && wf.instanceId === this.instanceId);
    for (const [id, wf] of chainBroken) {
      logger.warn('chain_broken from prior run: wf=%s agent=%s error=%s',
        id, wf.agent, wf.error ?? 'unknown');
    }

    // Phase 2: Recover chain_pending workflows (mid-chain crash, own only)
    const chainPending = [...this.workflows.entries()]
      .filter(([_, wf]) => wf.status === 'chain_pending' && wf.instanceId === this.instanceId);
    for (const [id, wf] of chainPending) {
      logger.warn('recovering chain_pending workflow: wf=%s agent=%s', id, wf.agent);
      if (wf.agent === 'R') {
        logger.warn('R chain_pending recovered as completed, but MCP state may be at "checking" phase. No C was launched.');
      }
      this.markCompleted(id, wf.result || '');
      logger.info('recovered chain_pending → completed: wf=%s', id);
    }

    // Phase 3: Recover running workflows (own only, with timeout)
    const running = [...this.workflows.entries()]
      .filter(([_, wf]) => wf.status === 'running' && wf.instanceId === this.instanceId);
    for (let i = 0; i < running.length; i += 5) {
      const batch = running.slice(i, i + 5);
      await Promise.allSettled(
        batch.map(async ([id, wf]) => {
          try {
            const msgs = await this.withTimeout(
              client.session.messages({ path: { id: wf.sessionId } }),
              WorkflowStore.RECONCILE_TIMEOUT_MS,
            );
            if (!msgs?.data?.length) {
              this.markError(id, 'Empty or invalid session response during reconciliation');
              return;
            }
            const hasAssistant = msgs.data.some((m: any) => m.info.role === 'assistant');
            if (hasAssistant) {
              const result = extractLastAssistantText(msgs.data);
              this.markCompleted(id, result);
            } else {
              this.markError(id, 'Session has no assistant response');
            }
          } catch (e) {
            const msg = e instanceof Error && e.message === 'reconcile timeout'
              ? 'Reconcile timeout: session query exceeded time limit'
              : 'Session not found during reconciliation';
            logger.warn('reconcile error: wf=%s %s', id, msg);
            this.markError(id, msg);
          }
        }),
      );
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('reconcile timeout')), ms);
      }),
    ]).finally(() => clearTimeout(timer!));
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
      // Read-before-write merge: preserve entries from other instances
      const diskEntries = this.readDiskMap();
      for (const [id, wf] of diskEntries) {
        if (!this.workflows.has(id) && wf.instanceId !== this.instanceId) {
          // Entry from another instance — preserve it
          this.workflows.set(id, wf);
        }
      }
      // NOTE: concurrent saveToDisk has a known TOCTOU race (microsecond-scale on
      // local filesystem). Two instances reading the same snapshot before writing
      // can lose one instance's changes. Risk is very low for single-machine deploy.
      this.saveToDiskRaw();
    } catch (e) {
      console.error('[aristotle-bridge] failed to persist workflow store:', e);
    }
  }

  /** Write current in-memory state to disk without merge (for eviction persistence). */
  private saveToDiskRaw(): void {
    const tmpPath = this.storePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify([...this.workflows.values()], null, 2), 'utf-8');
    renameSync(tmpPath, this.storePath);
  }

  private readDiskMap(): Map<string, WorkflowState> {
    const map = new Map<string, WorkflowState>();
    try {
      const data = readFileSync(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const wf of parsed) {
          if (wf && typeof wf === 'object' && typeof wf.workflowId === 'string') {
            map.set(wf.workflowId, wf);
          }
        }
      }
    } catch { /* file missing or corrupted */ }
    return map;
  }

  // Global LRU: intentionally evicts any instance's terminal workflows.
  // Safe because terminal states (completed/error/cancelled/undone) are read-only.
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
