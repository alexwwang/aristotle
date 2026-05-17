/**
 * PipelineStateCache: adaptive cache for single-agent vs multi-agent.
 */
import { computeProjectId } from './project-id.js'
import type { PipelineState } from './schema.js'
import type { PipelineStore } from './pipeline-store.js'
import type { Logger } from '@opencode-ai/core/logger'

export class PipelineStateCache {
  private _projectId: string
  private _memoryState: PipelineState | null = null
  private _failedLoad: boolean = false
  private _populated: boolean = false  // tracks whether initial disk load happened

  /** Whether the last disk read failed (multi-agent mode only). §5.1 */
  get hadFailedLoad(): boolean { return this._failedLoad }

  constructor(
    private _store: PipelineStore,
    private _worktreeRoot: string,
    private _logger?: Logger,
    private _multiAgent: boolean = false,
  ) {
    this._projectId = computeProjectId(_worktreeRoot)
  }

  get(): PipelineState | null {
    if (this._multiAgent) {
      // Multi-agent mode: always read from disk for consistency
      try {
        const activeRun = this._store.getActiveRun(this._projectId)
        if (!activeRun) {
          this._failedLoad = false
          return null
        }
        const state = this._store.readState(this._projectId, activeRun.runId)
        if (state) {
          this._failedLoad = false
          return state
        }
        // activeRun exists but state is null — likely corruption, treat as failure
        this._failedLoad = true
        this._logger?.warn('activeRun exists but state is null for project %s', this._projectId)
        return null
      } catch (err) {
        this._failedLoad = true
        this._logger?.warn('disk read failed', { error: String(err) })
        return null
      }
    }

    // Single-agent mode: lazy-load from disk on first access (§5.1 ensurePopulated)
    if (!this._populated) {
      this._populated = true
      try {
        const activeRun = this._store.getActiveRun(this._projectId)
        if (activeRun) {
          const state = this._store.readState(this._projectId, activeRun.runId)
          if (state) {
            this._memoryState = state
            this._failedLoad = false
            this._logger?.debug('lazy-loaded state from disk for project %s', this._projectId)
          } else {
            // activeRun exists but state is null — corrupted state
            this._failedLoad = true
            this._logger?.warn('activeRun exists but state is null for project %s (corrupted?)', this._projectId)
          }
        }
      } catch (err) {
        this._failedLoad = true
        this._logger?.warn('lazy load from disk failed', { error: String(err) })
      }
    }

    return this._memoryState
  }

  update(state: PipelineState): void {
    if (this._multiAgent) return  // no-op in multi-agent mode (disk is source of truth)
    this._memoryState = state     // memory only in single-agent mode
    this._failedLoad = false      // external update means system is healthy
  }

  clear(): void {
    this._memoryState = null
    this._populated = false
    this._failedLoad = false
  }
}
