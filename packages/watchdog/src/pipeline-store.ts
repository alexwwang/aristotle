import type { StateStore } from '@opencode-ai/core/store/state-store';
import type { Logger } from '@opencode-ai/core/logger';
import type {
  ActiveRun,
  AuditLogEntry,
  PipelineState,
  ProjectIndex,
} from './schema.js';

export class PipelineStore {
  constructor(
    private stateStore: StateStore,
    private logger: Logger,
  ) {}

  // ------------------------------------------------------------------
  // Path safety
  // ------------------------------------------------------------------

  /** Validate projectId and runId don't contain path traversal */
  private validatePathComponents(projectId: string, runId?: string): void {
    if (projectId.includes('../') || projectId.includes('..\\')) {
      throw new Error(`Path traversal detected in projectId: ${projectId}`)
    }
    if (runId !== undefined && (runId.includes('../') || runId.includes('..\\'))) {
      throw new Error(`Path traversal detected in runId: ${runId}`)
    }
  }

  // ------------------------------------------------------------------
  // Key helpers
  // ------------------------------------------------------------------

  private projectIndexKey(): string {
    return 'watchdog/projects';
  }

  private activeKey(projectId: string): string {
    return `watchdog/${projectId}/active`;
  }

  private stateKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/${runId}/state`;
  }

  private auditKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/${runId}/audit`;
  }

  private archiveStateKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/archive/${runId}/state`;
  }

  private archiveAuditKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/archive/${runId}/audit`;
  }

  // ------------------------------------------------------------------
  // Project index
  // ------------------------------------------------------------------

  getProjectIds(): string[] {
    const index = this.stateStore.read<ProjectIndex>(this.projectIndexKey());
    return index?.projectIds ?? [];
  }

  private addProjectToIndex(projectId: string): void {
    const index = this.stateStore.read<ProjectIndex>(this.projectIndexKey());
    const ids = new Set(index?.projectIds ?? []);
    if (!ids.has(projectId)) {
      ids.add(projectId);
      this.stateStore.write<ProjectIndex>(this.projectIndexKey(), {
        projectIds: Array.from(ids),
      });
      this.logger.info('Added project %s to watchdog index', projectId);
    }
  }

  // ------------------------------------------------------------------
  // Active run
  // ------------------------------------------------------------------

  getActiveRun(projectId: string): ActiveRun | null {
    this.validatePathComponents(projectId)
    return this.stateStore.read<ActiveRun>(this.activeKey(projectId));
  }

  setActiveRun(projectId: string, run: ActiveRun): void {
    this.validatePathComponents(projectId, run.runId)
    const existing = this.getActiveRun(projectId);
    if (existing && existing.runId && existing.runId !== run.runId) {
      this.logger.info(
        'Archiving previous active run %s for project %s',
        existing.runId,
        projectId,
      );
      this.archiveRun(projectId, existing.runId);
    }

    this.stateStore.write<ActiveRun>(this.activeKey(projectId), run);
    this.addProjectToIndex(projectId);
    this.logger.info('Set active run %s for project %s', run.runId, projectId);
  }

  clearActiveRun(projectId: string): void {
    this.validatePathComponents(projectId)
    this.stateStore.write(this.activeKey(projectId), null as unknown as ActiveRun);
    this.logger.info('Cleared active run for project %s', projectId);
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  readState(projectId: string, runId: string): PipelineState | null {
    this.validatePathComponents(projectId, runId)
    return this.stateStore.read<PipelineState>(this.stateKey(projectId, runId));
  }

  writeState(projectId: string, runId: string, state: PipelineState): void {
    this.validatePathComponents(projectId, runId)
    const key = this.stateKey(projectId, runId);
    this.stateStore.write<PipelineState>(key, state);

    // Read-back verification (C-4)
    const readBack = this.stateStore.read<PipelineState>(key);
    if (JSON.stringify(readBack) !== JSON.stringify(state)) {
      this.logger.error(
        'State read-back mismatch for project %s run %s',
        projectId,
        runId,
      );
    }
  }

  // ------------------------------------------------------------------
  // Audit log
  // ------------------------------------------------------------------

  appendAudit(projectId: string, runId: string, entry: AuditLogEntry): void {
    this.validatePathComponents(projectId, runId)
    this.stateStore.appendLog(this.auditKey(projectId, runId), entry);
  }

  // ------------------------------------------------------------------
  // Archive
  // ------------------------------------------------------------------

  archiveRun(projectId: string, runId: string): void {
    this.validatePathComponents(projectId, runId)
    const state = this.readState(projectId, runId);
    if (state) {
      this.stateStore.write<PipelineState>(
        this.archiveStateKey(projectId, runId),
        state,
      );
      this.logger.info(
        'Archived state for project %s run %s',
        projectId,
        runId,
      );
    }

    // Audit log archival not yet supported — StateStore has no readLog/copy.
    this.logger.warn(
      'Audit log not archived for project %s run %s (StateStore limitation)',
      projectId,
      runId,
    );
  }
}
