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
import { MAX_AUDIT_ENTRIES } from './constants.js';

/** Filter options for getUnresolvedViolations */
export interface ViolationFilter {
  tool?: string
  filePath?: string
  event?: string
  commandPattern?: string
}

type AuditEntryWithSource = AuditLogEntry & Record<string, unknown> & { _sourceKey?: string }

export class PipelineStore {
  /** In-memory index: key = `${projectId}/${runId}`, value = Map of severity → entries */
  private violationIndex = new Map<string, Map<string, AuditEntryWithSource[]>>()
  /** Tracks rotated keys already indexed — avoids re-scanning on every query */
  private indexedRotatedKeys = new Set<string>()
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
        if (t && typeof t === 'object' && !('P' in t)) (t as Record<string, unknown>).P = 0
      }
    }
    // Phase 2.3: defensive migration — add P:0 to old roundRecords counts
    // This MUST run before any code accesses .counts.P on loaded records.
    // Defense-in-depth: corrupted state files may have counts as undefined OR
    // a non-object primitive (string/number). The typeof check + truthy guard
    // ensures `'P' in r.counts` and the subsequent property assignment are safe.
    if (state?.ralph?.roundRecords) {
      for (const r of state.ralph.roundRecords) {
        if (r && r.counts && typeof r.counts === 'object' && !('P' in r.counts)) {
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
    const key = this.auditKey(projectId, runId)
    this.stateStore.appendLog(key, entry);
    this.indexEntry(projectId, runId, key, entry as AuditEntryWithSource)
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

  // ------------------------------------------------------------------
  // Phase 1: Violation query & resolve
  // ------------------------------------------------------------------

  getUnresolvedViolations(
    projectId: string,
    runId: string,
    severity: string,
    filter?: ViolationFilter,
  ): AuditEntryWithSource[] {
    this.validatePathComponents(projectId, runId)
    const idxKey = `${projectId}/${runId}`

    if (!this.violationIndex.has(idxKey)) {
      this.buildIndex(projectId, runId)
    }

    const prefix = this.auditKey(projectId, runId)
    for (let i = 1; i <= 10; i++) {
      const rotKey = `${prefix}.${i}`
      if (this.indexedRotatedKeys.has(rotKey)) continue
      const rotLogs = this.stateStore.readLogSafe<AuditEntryWithSource>(rotKey)
      if (rotLogs.length === 0) break
      for (const entry of rotLogs) {
        this.indexEntry(projectId, runId, rotKey, entry)
      }
      this.indexedRotatedKeys.add(rotKey)
    }

    const severityMap = this.violationIndex.get(idxKey)
    if (!severityMap) return []

    let entries = severityMap.get(severity) ?? []

    // Filter out resolved and evicted
    entries = entries.filter(e => !e.resolved && !e.evicted)

    if (!filter) return entries.map(e => ({ ...e }))

    return entries.filter(e => {
      if (filter.tool !== undefined && e.tool !== filter.tool) return false
      if (filter.filePath !== undefined && e.filePath !== filter.filePath) return false
      if (filter.event !== undefined && e.event !== filter.event) return false
      if (filter.commandPattern !== undefined) {
        const cmd = e.command as string | undefined
        if (!cmd) return false
        // Use startsWith for prefix matching, exact match, or glob via picomatch
        const pat = filter.commandPattern
        if (pat.endsWith('*')) {
          if (!cmd.startsWith(pat.slice(0, -1))) return false
        } else if (cmd !== pat) {
          return false
        }
      }
      return true
    }).map(e => ({ ...e }))
  }

  resolveViolations(projectId: string, runId: string, timestamps: string[]): void {
    this.validatePathComponents(projectId, runId)
    if (timestamps.length === 0) return

    // Append-only store: persist resolution via _resolve marker entries
    const auditKey = this.auditKey(projectId, runId)
    const now = new Date().toISOString()
    for (const ts of timestamps) {
      this.stateStore.appendLog(auditKey, {
        _resolve: ts,
        _resolvedAt: now,
        timestamp: now,
        runId,
        projectId,
        event: '_RESOLVE_MARKER',
        phase: 0,
        decision: 'PASS',
        sessionId: '',
      })
    }

    // Update in-memory index directly (avoids full rebuild)
    this.applyResolutionsToIndex(projectId, runId, new Set(timestamps), now)
  }

  /** Apply resolution markers to in-memory index entries. */
  private applyResolutionsToIndex(
    projectId: string, runId: string, tsSet: Set<string>, resolvedAt: string,
  ): void {
    const idxKey = `${projectId}/${runId}`
    const severityMap = this.violationIndex.get(idxKey)
    if (!severityMap) return
    for (const entries of severityMap.values()) {
      for (const entry of entries) {
        if (tsSet.has(entry.timestamp) && !entry.resolved) {
          entry.resolved = true
          entry.resolvedAt = resolvedAt
        }
      }
    }
  }

  checkpointEviction(projectId: string, runId: string): void {
    this.validatePathComponents(projectId, runId)
    const auditKey = this.auditKey(projectId, runId)
    const logs = this.stateStore.readLogSafe<AuditEntryWithSource>(auditKey)

    if (logs.length <= MAX_AUDIT_ENTRIES) return

    const excess = logs.length - MAX_AUDIT_ENTRIES
    logs.splice(0, excess)

    this.buildIndex(projectId, runId)
  }

  // ------------------------------------------------------------------
  // Private: index management
  // ------------------------------------------------------------------

  private indexEntry(projectId: string, runId: string, sourceKey: string, entry: AuditEntryWithSource): void {
    const idxKey = `${projectId}/${runId}`
    let severity = entry.severity
    const decision = entry.decision
    // Index under explicit severity; also index under decision-derived severity if different
    const derivedFromDecision = decision === 'BLOCK' ? 'block' : decision === 'WARN' ? 'warn' : undefined
    const severities = new Set<string>()
    if (severity) severities.add(severity)
    if (derivedFromDecision) severities.add(derivedFromDecision)
    if (severities.size === 0) return

    if (!this.violationIndex.has(idxKey)) {
      this.violationIndex.set(idxKey, new Map())
    }
    const severityMap = this.violationIndex.get(idxKey)!

    entry._sourceKey = sourceKey
    for (const sev of severities) {
      if (!severityMap.has(sev)) {
        severityMap.set(sev, [])
      }
      severityMap.get(sev)!.push(entry)
    }
  }

  private buildIndex(projectId: string, runId: string): void {
    const idxKey = `${projectId}/${runId}`
    this.violationIndex.delete(idxKey)

    const prefix = this.auditKey(projectId, runId)

    // Pass 1: collect all logs + extract resolution markers
    const allEntries: AuditEntryWithSource[] = []
    const resolvedMap = new Map<string, string>()
    const sourceKeys: AuditEntryWithSource[] = []

    for (const source of [prefix, ...this.rotatedKeys(prefix)]) {
      const logs = this.stateStore.readLogSafe<AuditEntryWithSource>(source)
      for (const entry of logs) {
        if ((entry as Record<string, unknown>)._resolve) {
          resolvedMap.set(
            (entry as Record<string, unknown>)._resolve as string,
            (entry as Record<string, unknown>)._resolvedAt as string ?? new Date().toISOString(),
          )
        } else {
          entry._sourceKey = source
          allEntries.push(entry)
        }
      }
    }

    // Pass 2: apply resolutions then index
    if (resolvedMap.size > 0) {
      for (const entry of allEntries) {
        if (resolvedMap.has(entry.timestamp) && !entry.resolved) {
          entry.resolved = true
          entry.resolvedAt = resolvedMap.get(entry.timestamp)
        }
      }
    }

    for (const entry of allEntries) {
      this.indexEntry(projectId, runId, entry._sourceKey!, entry)
    }
  }

  private rotatedKeys(prefix: string): string[] {
    const keys: string[] = []
    for (let i = 1; i <= 10; i++) {
      const rotKey = `${prefix}.${i}`
      const rotLogs = this.stateStore.readLogSafe<AuditEntryWithSource>(rotKey)
      if (rotLogs.length === 0) break
      keys.push(rotKey)
      this.indexedRotatedKeys.add(rotKey)
    }
    return keys
  }
}
