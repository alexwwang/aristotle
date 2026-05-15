/**
 * PipelineStateCache: adaptive cache for single-agent vs multi-agent.
 */
import { computeProjectId } from './project-id.js'
import type { PipelineState } from './schema.js'

export class PipelineStateCache {
  private _projectId: string
  private _memoryState: PipelineState | null = null

  constructor(
    private _store?: any,
    private _logger?: any,
    private _worktreeRoot?: string,
    private _multiAgent: boolean = false,
  ) {
    this._projectId = _worktreeRoot ? computeProjectId(_worktreeRoot) : ''
  }

  get(): PipelineState | null {
    if (this._multiAgent) {
      // Multi-agent mode: always read from disk for consistency
      try {
        const activeRun = this._store?.getActiveRun(this._projectId)
        if (!activeRun) {
          return null
        }
        const state = this._store?.readState(this._projectId, activeRun.runId)
        return state ?? null
      } catch (err) {
        this._logger?.warn('disk read failed', { error: String(err) })
        return null
      }
    }

    // Single-agent mode: use in-memory cache
    return this._memoryState
  }

  update(state: PipelineState): void {
    if (this._multiAgent) return  // no-op in multi-agent mode (disk is source of truth)
    this._memoryState = state     // memory only in single-agent mode
  }

  clear(): void {
    this._memoryState = null
  }
}
