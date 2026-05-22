import type { StateStore } from '@opencode-ai/core/store/state-store';
import type { Logger } from '@opencode-ai/core/logger';
import {
  SCHEMA_VERSION,
} from './schema.js';
import type {
  ActiveRun,
  AuditLogEntry,
  ObservationEntry,
  PipelineState,
  ProjectIndex,
  RalphLoopState,
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

  private observationKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/${runId}/observations`;
  }

  private archiveStateKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/archive/${runId}/state`;
  }

  private archiveAuditKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/archive/${runId}/audit`;
  }

  private archiveObservationKey(projectId: string, runId: string): string {
    return `watchdog/${projectId}/archive/${runId}/observations`;
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

    // L5 fix: write index FIRST, then activeRun pointer.
    // If crash occurs between the two writes, the worst case is:
    //   - index has the project but no activeRun → harmless (getActiveRun returns null)
    // The previous order (activeRun first) could leave a dangling pointer on crash.
    this.addProjectToIndex(projectId);
    this.stateStore.write<ActiveRun>(this.activeKey(projectId), run);
    this.logger.info('Set active run %s for project %s', run.runId, projectId);
  }

  clearActiveRun(projectId: string): void {
    this.validatePathComponents(projectId)
    this.stateStore.write<ActiveRun | null>(this.activeKey(projectId), null);
    this.logger.info('Cleared active run for project %s', projectId);
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  readState(projectId: string, runId: string): PipelineState | null {
    this.validatePathComponents(projectId, runId)
    let state = this.stateStore.read<PipelineState>(this.stateKey(projectId, runId));
    // Version gate: reject state files from newer versions
    if (state && state.version > SCHEMA_VERSION) {
      throw new Error(
        `State file version ${state.version} is newer than supported version ${SCHEMA_VERSION}. Update the watchdog to support this version.`
      )
    }
    // Phase 2.3: defensive migration — add P:0 to old tallyHistory entries
    // See schema.ts RoundRecord docstring for design context.
    // Null guard on t mirrors the roundRecords.counts guard below: corrupted
    // state files may have null entries; prevents TypeError on `'P' in null`.
    if (state?.ralph?.tallyHistory) {
      for (const t of state.ralph.tallyHistory) {
        if (t && !('P' in t)) (t as Record<string, unknown>).P = 0
      }
    }
    // Phase 2.3: defensive migration — add P:0 to old roundRecords counts
    // This MUST run before any code accesses .counts.P on loaded records.
    // Defense-in-depth: corrupted state files may have counts as undefined OR
    // a non-object primitive (string/number). The typeof check + truthy guard
    // ensures `'P' in r.counts` and the subsequent property assignment are safe.
    if (state?.ralph?.roundRecords) {
      for (const r of state.ralph.roundRecords) {
        if (r.counts && typeof r.counts === 'object' && !('P' in r.counts)) {
          (r.counts as Record<string, unknown>).P = 0
        }
      }
    }
    // Migration: pre-v2 state files lack totalPhases field
    if (state && !('totalPhases' in state)) {
      (state as Record<string, unknown>).totalPhases = 5;
    }
    // Migration: pre-v3 ralph state lacks roundRecords and autoValidated
    if (state?.ralph && !('roundRecords' in state.ralph)) {
      const ralph: RalphLoopState = state.ralph
      state = {
        ...state,
        ralph: { ...ralph, roundRecords: [], autoValidated: false },
      };
    }
    return state;
  }

  writeState(projectId: string, runId: string, state: PipelineState): void {
    this.validatePathComponents(projectId, runId)
    const key = this.stateKey(projectId, runId);
    this.stateStore.write<PipelineState>(key, state);

    // Read-back verification (C-4) — H-fix #9: throw on mismatch
    // Prevents silent data loss: better a visible failure than false success.
    const readBack = this.stateStore.read<PipelineState>(key);
    if (JSON.stringify(readBack) !== JSON.stringify(state)) {
      this.logger.error(
        'State read-back mismatch for project %s run %s',
        projectId,
        runId,
      );
      throw new Error(
        `State persistence failed: read-back mismatch for project ${projectId} run ${runId}`,
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

    // Archive audit log
    const auditEntries = this.stateStore.readLogSafe<AuditLogEntry>(this.auditKey(projectId, runId));
    if (auditEntries.length > 0) {
      const archiveAuditKey = this.archiveAuditKey(projectId, runId);
      for (const entry of auditEntries) {
        this.stateStore.appendLog(archiveAuditKey, entry);
      }
      this.logger.info(
        'Archived %d audit entries for project %s run %s',
        auditEntries.length,
        projectId,
        runId,
      );
    }

    // Archive observations
    const observations = this.stateStore.readLogSafe<ObservationEntry>(this.observationKey(projectId, runId));
    if (observations.length > 0) {
      const archiveObsKey = this.archiveObservationKey(projectId, runId);
      for (const entry of observations) {
        this.stateStore.appendLog(archiveObsKey, entry);
      }
      this.logger.info(
        'Archived %d observations for project %s run %s',
        observations.length,
        projectId,
        runId,
      );
    }
  }

  // ------------------------------------------------------------------
  // Observations (Phase 2)
  // ------------------------------------------------------------------

  /**
   * Append an observation entry. async for future StateStore async migration
   * (e.g. fs.promises.appendFile). Internal operations are currently sync.
   */
  async appendObservation(
    projectId: string,
    runId: string,
    entry: ObservationEntry,
  ): Promise<void> {
    this.validatePathComponents(projectId, runId)
    const key = this.observationKey(projectId, runId)
    // M-1: use appendLog for crash-safe, concurrent-safe writes (same pattern as appendAudit)
    // async for future StateStore async migration (e.g. fs.promises.appendFile)
    this.stateStore.appendLog(key, entry)
  }

  /**
   * Read all observation entries. async for future StateStore async migration
   * (e.g. fs.promises.readFile). Internal operations are currently sync.
   */
  async readObservations(
    projectId: string,
    runId: string,
  ): Promise<ObservationEntry[]> {
    this.validatePathComponents(projectId, runId)
    const key = this.observationKey(projectId, runId)
    // F1 fix: readLogSafe skips corrupt lines instead of losing all observations
    return this.stateStore.readLogSafe<ObservationEntry>(key)
  }

  /**
   * Find observations matching a filter. async for future StateStore async migration.
   * Internal operations are currently sync.
   */
  async findObservations(
    projectId: string,
    runId: string,
    filter: { type?: string; round?: number },
  ): Promise<ObservationEntry[]> {
    const entries = await this.readObservations(projectId, runId)
    return entries.filter((e) => {
      if (filter.type !== undefined && e.type !== filter.type) return false
      if (filter.round !== undefined && e.round !== filter.round) return false
      return true
    })
  }
}
