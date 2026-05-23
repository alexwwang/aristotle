import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { ActiveRun, PipelineState, AuditLogEntry } from '../src/schema.js'
import { makeState, NOW } from './helpers.js'

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function createMockStateStore(): StateStore {
  const store = new Map<string, any>()
  const logs = new Map<string, any[]>()
  return {
    read<T>(key: string): T | null {
      return (store.get(key) ?? null) as T | null
    },
    write<T>(key: string, value: T): void {
      store.set(key, value)
    },
    appendLog(key: string, entry: unknown): void {
      if (!logs.has(key)) logs.set(key, [])
      logs.get(key)!.push(entry)
    },
    readLog<T>(key: string): T[] {
      return (logs.get(key) ?? []) as T[]
    },
    readLogSafe<T>(key: string): T[] {
      return (logs.get(key) ?? []) as T[]
    },
    list(_prefix: string): string[] {
      return []
    },
    // Expose for assertions
    _store: store,
    _logs: logs,
  } as any
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('PipelineStore', () => {
  let mockStore: StateStore
  let mockLogger: Logger
  let pipelineStore: PipelineStore

  beforeEach(() => {
    mockStore = createMockStateStore()
    mockLogger = createMockLogger()
    pipelineStore = new PipelineStore(mockStore, mockLogger)
  })

  // ------------------------------------------------------------------
  // Active run management
  // ------------------------------------------------------------------

  describe('active run management', () => {
    it('returns null when no active run exists', () => {
      const result = pipelineStore.getActiveRun('nonexistent-project')
      expect(result).toBeNull()
    })

    it('writes active run and can be read back', () => {
      const run: ActiveRun = {
        runId: 'run-001',
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      pipelineStore.setActiveRun('testproj', run)

      const readBack = pipelineStore.getActiveRun('testproj')
      expect(readBack).toEqual(run)
    })

    it('adds project to project index via setActiveRun', () => {
      const run: ActiveRun = {
        runId: 'run-001',
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      pipelineStore.setActiveRun('testproj', run)

      const projectIds = pipelineStore.getProjectIds()
      expect(projectIds).toContain('testproj')
    })

    it('archives previous run when setting a new one', () => {
      // First active run
      const run1: ActiveRun = {
        runId: 'run-001',
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      // Write state for first run so archiveRun has something to copy
      pipelineStore.writeState('testproj', 'run-001', makeState({ runId: 'run-001' }))
      pipelineStore.setActiveRun('testproj', run1)

      // Second active run (different runId)
      const run2: ActiveRun = {
        runId: 'run-002',
        projectId: 'testproj',
        startedAt: '2026-01-02T00:00:00.000Z',
      }
      pipelineStore.writeState('testproj', 'run-002', makeState({ runId: 'run-002' }))
      pipelineStore.setActiveRun('testproj', run2)

      // Verify run2 is now active
      expect(pipelineStore.getActiveRun('testproj')).toEqual(run2)

      // Verify run-001 state was archived
      const archivedState = (mockStore as any)._store.get('watchdog/testproj/archive/run-001/state')
      expect(archivedState).not.toBeNull()
      expect(archivedState.runId).toBe('run-001')
    })

    it('clears active run', () => {
      const run: ActiveRun = {
        runId: 'run-001',
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      pipelineStore.setActiveRun('testproj', run)
      expect(pipelineStore.getActiveRun('testproj')).toEqual(run)

      pipelineStore.clearActiveRun('testproj')
      expect(pipelineStore.getActiveRun('testproj')).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // State persistence
  // ------------------------------------------------------------------

  describe('state persistence', () => {
    it('returns null when no state exists', () => {
      const result = pipelineStore.readState('testproj', 'run-001')
      expect(result).toBeNull()
    })

    it('round-trips state through writeState and readState', () => {
      const state = makeState()
      pipelineStore.writeState('testproj', 'run-001', state)

      const readBack = pipelineStore.readState('testproj', 'run-001')
      expect(readBack).toEqual(state)
    })

    it('migrates pre-v2 state without totalPhases field', () => {
      // Simulate a pre-v2 state file that lacks totalPhases
      const oldState = {
        ...makeState(),
        version: 1,
      }
      // Remove totalPhases to simulate old state
      delete (oldState as Record<string, unknown>).totalPhases
      pipelineStore.writeState('testproj', 'run-old', oldState as PipelineState)

      const readBack = pipelineStore.readState('testproj', 'run-old')
      expect(readBack).not.toBeNull()
      expect(readBack!.totalPhases).toBe(5) // migration default
    })

    it('migration does not mutate store internal reference', () => {
      // Simulate a pre-v2 state file
      const oldState = { ...makeState(), version: 1 }
      delete (oldState as Record<string, unknown>).totalPhases
      pipelineStore.writeState('testproj', 'run-mut', oldState as PipelineState)

      // First read — triggers migration
      const read1 = pipelineStore.readState('testproj', 'run-mut')
      expect(read1!.totalPhases).toBe(5)

      // Second read — must also get totalPhases=5 (not undefined from corrupted store)
      const read2 = pipelineStore.readState('testproj', 'run-mut')
      expect(read2!.totalPhases).toBe(5)

      // Migration must be idempotent — same result each time
      expect(read1).toEqual(read2)
    })

    it('throws on read-back verification failure', () => {
      // Create a mock store that returns corrupted data on read-back
      let readCount = 0
      const corruptStore: StateStore = {
        read<T>(_key: string): T | null {
          readCount++
          if (readCount <= 2) return null as T | null // first reads return null
          // read-back verification — return corrupted data
          return { corrupted: true } as T | null
        },
        write<T>(_key: string, _value: T): void {},
        appendLog(_key: string, _entry: unknown): void {},
        readLog<T>(_key: string): T[] { return [] },
        readLogSafe<T>(_key: string): T[] { return [] },
        list(_prefix: string): string[] { return [] },
      }

      const store = new PipelineStore(corruptStore, mockLogger)
      const state = makeState()

      // H-fix #9: writeState throws (and logs) on read-back mismatch
      expect(() => store.writeState('testproj', 'run-001', state)).toThrow(
        /State persistence failed.*read-back mismatch/,
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        'State read-back mismatch for project %s run %s',
        'testproj',
        'run-001',
      )
    })
  })

  // ------------------------------------------------------------------
  // Audit log
  // ------------------------------------------------------------------

  describe('audit log', () => {
    it('appends entry to the audit log key', () => {
      const entry: AuditLogEntry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        runId: 'run-001',
        projectId: 'testproj',
        sessionId: 'sess-001',
        event: 'pipeline_start',
        phase: 0,
        decision: 'PASS',
      }

      pipelineStore.appendAudit('testproj', 'run-001', entry)

      const logs = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      expect(logs).toHaveLength(1)
      expect(logs[0]).toEqual(entry)
    })

    it('appends multiple entries to the same audit log', () => {
      const entry1: AuditLogEntry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        runId: 'run-001',
        projectId: 'testproj',
        sessionId: 'sess-001',
        event: 'pipeline_start',
        phase: 0,
        decision: 'PASS',
      }
      const entry2: AuditLogEntry = {
        timestamp: '2026-01-01T00:01:00.000Z',
        runId: 'run-001',
        projectId: 'testproj',
        sessionId: 'sess-001',
        event: 'phase_enter',
        phase: 1,
        decision: 'PASS',
      }

      pipelineStore.appendAudit('testproj', 'run-001', entry1)
      pipelineStore.appendAudit('testproj', 'run-001', entry2)

      const logs = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      expect(logs).toHaveLength(2)
      expect(logs[0]).toEqual(entry1)
      expect(logs[1]).toEqual(entry2)
    })
  })

  // ------------------------------------------------------------------
  // Archive
  // ------------------------------------------------------------------

  describe('archive', () => {
    it('copies state to archive path', () => {
      const state = makeState({ runId: 'run-001' })
      pipelineStore.writeState('testproj', 'run-001', state)

      pipelineStore.archiveRun('testproj', 'run-001')

      const archivedState = (mockStore as any)._store.get('watchdog/testproj/archive/run-001/state')
      expect(archivedState).toEqual(state)
    })

    it('does nothing when archiving non-existent state', () => {
      pipelineStore.archiveRun('testproj', 'nonexistent-run')

      const archivedState = (mockStore as any)._store.get('watchdog/testproj/archive/nonexistent-run/state')
      expect(archivedState).toBeUndefined()
    })

    it('archives audit log entries alongside state', () => {
      const state = makeState()
      pipelineStore.writeState('testproj', 'run-001', state)
      pipelineStore.appendAudit('testproj', 'run-001', {
        timestamp: NOW, runId: 'run-001', projectId: 'testproj',
        sessionId: 'sess-001', event: 'pipeline_start', phase: 0, decision: 'PASS',
      })

      pipelineStore.archiveRun('testproj', 'run-001')

      const archivedAudit = (mockStore as any)._logs.get('watchdog/testproj/archive/run-001/audit')
      expect(archivedAudit).toHaveLength(1)
      expect(archivedAudit[0].event).toBe('pipeline_start')
    })

    it('§9.2: archive preserves state but does not delete original (StateStore has no delete)', () => {
      const state = makeState({ runId: 'run-001' })
      pipelineStore.writeState('testproj', 'run-001', state)

      pipelineStore.archiveRun('testproj', 'run-001')

      // Archive exists
      const archivedState = (mockStore as any)._store.get('watchdog/testproj/archive/run-001/state')
      expect(archivedState).toEqual(state)

      // Original still exists (StateStore has no delete method)
      const originalState = (mockStore as any)._store.get('watchdog/testproj/run-001/state')
      expect(originalState).toEqual(state)
    })
  })

  // ------------------------------------------------------------------
  // Project index
  // ------------------------------------------------------------------

  describe('project index', () => {
    it('returns empty array when no index file', () => {
      const result = pipelineStore.getProjectIds()
      expect(result).toEqual([])
    })

    it('returns stored project IDs', () => {
      const run: ActiveRun = {
        runId: 'run-001',
        projectId: 'proj-a',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      pipelineStore.setActiveRun('proj-a', run)

      const projectIds = pipelineStore.getProjectIds()
      expect(projectIds).toEqual(['proj-a'])
    })

    it('deduplicates project IDs via setActiveRun', () => {
      const run: ActiveRun = {
        runId: 'run-001',
        projectId: 'proj-a',
        startedAt: '2026-01-01T00:00:00.000Z',
      }

      pipelineStore.setActiveRun('proj-a', run)
      // Set same project again (same runId, so no archive triggered)
      pipelineStore.setActiveRun('proj-a', run)

      const projectIds = pipelineStore.getProjectIds()
      expect(projectIds).toEqual(['proj-a'])
      expect(projectIds).toHaveLength(1)
    })

    it('tracks multiple projects', () => {
      const runA: ActiveRun = {
        runId: 'run-a',
        projectId: 'proj-a',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      const runB: ActiveRun = {
        runId: 'run-b',
        projectId: 'proj-b',
        startedAt: '2026-01-02T00:00:00.000Z',
      }

      pipelineStore.setActiveRun('proj-a', runA)
      pipelineStore.setActiveRun('proj-b', runB)

      const projectIds = pipelineStore.getProjectIds()
      expect(projectIds).toContain('proj-a')
      expect(projectIds).toContain('proj-b')
      expect(projectIds).toHaveLength(2)
    })
  })

  // ------------------------------------------------------------------
  // Observations (Phase 2)
  // ------------------------------------------------------------------

  describe('observations', () => {
    it('appendObservation appends entry readable by readObservations', async () => {
      const entry = {
        timestamp: NOW,
        type: '_reviewer_spawned',
        tool: 'Task',
        callID: 'call-001',
        round: 1,
        metadata: { sessionId: 'sess-001' },
      }
      await pipelineStore.appendObservation('testproj', 'run-001', entry)

      const observations = await pipelineStore.readObservations('testproj', 'run-001')
      expect(observations).toHaveLength(1)
      expect(observations[0]).toEqual(entry)
    })

    it('readObservations returns multiple appended entries', async () => {
      const entry1 = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-001', round: 1 }
      const entry2 = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-002', round: 2 }
      await pipelineStore.appendObservation('testproj', 'run-001', entry1)
      await pipelineStore.appendObservation('testproj', 'run-001', entry2)

      const observations = await pipelineStore.readObservations('testproj', 'run-001')
      expect(observations).toHaveLength(2)
      expect(observations[0].callID).toBe('call-001')
      expect(observations[1].callID).toBe('call-002')
    })

    it('findObservations filters by type', async () => {
      const entry1 = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-001', round: 1 }
      const entry2 = { timestamp: NOW, type: '_observer_degraded', tool: 'Task', callID: 'call-002', round: 1 }
      await pipelineStore.appendObservation('testproj', 'run-001', entry1)
      await pipelineStore.appendObservation('testproj', 'run-001', entry2)

      const result = await pipelineStore.findObservations('testproj', 'run-001', { type: '_reviewer_spawned' })
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('_reviewer_spawned')
    })

    it('findObservations filters by round', async () => {
      const entry1 = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-001', round: 1 }
      const entry2 = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-002', round: 2 }
      await pipelineStore.appendObservation('testproj', 'run-001', entry1)
      await pipelineStore.appendObservation('testproj', 'run-001', entry2)

      const result = await pipelineStore.findObservations('testproj', 'run-001', { round: 2 })
      expect(result).toHaveLength(1)
      expect(result[0].round).toBe(2)
    })

    it('findObservations filters by type and round together', async () => {
      const entry1 = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-001', round: 1 }
      const entry2 = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-002', round: 2 }
      const entry3 = { timestamp: NOW, type: '_observer_degraded', tool: 'Task', callID: 'call-003', round: 2 }
      await pipelineStore.appendObservation('testproj', 'run-001', entry1)
      await pipelineStore.appendObservation('testproj', 'run-001', entry2)
      await pipelineStore.appendObservation('testproj', 'run-001', entry3)

      const result = await pipelineStore.findObservations('testproj', 'run-001', { type: '_reviewer_spawned', round: 2 })
      expect(result).toHaveLength(1)
      expect(result[0].callID).toBe('call-002')
    })

    it('archiveRun moves observations to archive', () => {
      const state = makeState()
      pipelineStore.writeState('testproj', 'run-001', state)
      const entry = { timestamp: NOW, type: '_reviewer_spawned', tool: 'Task', callID: 'call-001', round: 1 }
      pipelineStore.appendObservation('testproj', 'run-001', entry)

      pipelineStore.archiveRun('testproj', 'run-001')

      const archivedObs = (mockStore as any)._logs.get('watchdog/testproj/archive/run-001/observations')
      expect(archivedObs).toHaveLength(1)
      expect(archivedObs[0].type).toBe('_reviewer_spawned')
    })
  })

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------

  describe('edge cases', () => {
    // §9.2: Path safety — key with '../' → throws
    it('throws on path traversal in readState', () => {
      expect(() => pipelineStore.readState('../etc', 'passwd')).toThrow(/path traversal/i)
    })

    it('throws on path traversal in writeState', () => {
      expect(() => pipelineStore.writeState('../etc', 'passwd', makeState())).toThrow(/path traversal/i)
    })

    it('throws on path traversal in appendAudit', () => {
      expect(() =>
        pipelineStore.appendAudit('../etc', 'passwd', {
          timestamp: NOW,
          runId: 'r',
          projectId: 'p',
          sessionId: 's',
          event: 'pipeline_start',
          phase: 0,
          decision: 'PASS',
        }),
      ).toThrow(/path traversal/i)
    })

    it('does not archive when setting same runId', () => {
      const run: ActiveRun = {
        runId: 'run-001',
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      }

      pipelineStore.writeState('testproj', 'run-001', makeState())
      pipelineStore.setActiveRun('testproj', run)

      // Set same run again
      pipelineStore.setActiveRun('testproj', run)

      // Archive key should not exist because same runId was set
      const archivedState = (mockStore as any)._store.get('watchdog/testproj/archive/run-001/state')
      expect(archivedState).toBeUndefined()
    })

    it('archives when runId changes', () => {
      const run1: ActiveRun = {
        runId: 'run-001',
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      const run2: ActiveRun = {
        runId: 'run-002',
        projectId: 'testproj',
        startedAt: '2026-01-02T00:00:00.000Z',
      }

      pipelineStore.writeState('testproj', 'run-001', makeState({ runId: 'run-001' }))
      pipelineStore.setActiveRun('testproj', run1)

      pipelineStore.writeState('testproj', 'run-002', makeState({ runId: 'run-002' }))
      pipelineStore.setActiveRun('testproj', run2)

      // Archive key should exist for run-001
      const archivedState = (mockStore as any)._store.get('watchdog/testproj/archive/run-001/state')
      expect(archivedState).toBeDefined()
      expect(archivedState.runId).toBe('run-001')
    })

    it('does not archive when existing active run has no runId', () => {
      // Set an active run without runId (edge case)
      const runWithoutId = {
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      } as ActiveRun

      const run2: ActiveRun = {
        runId: 'run-002',
        projectId: 'testproj',
        startedAt: '2026-01-02T00:00:00.000Z',
      }

      pipelineStore.setActiveRun('testproj', runWithoutId)
      pipelineStore.setActiveRun('testproj', run2)

      // Should not have archived because existing.runId was falsy
      const archivedKeys = Array.from((mockStore as any)._store.keys()).filter(
        (k) => String(k).includes('archive'),
      )
      expect(archivedKeys).toHaveLength(0)
    })

    it('clearActiveRun logs info message', () => {
      pipelineStore.clearActiveRun('testproj')
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleared active run for project %s',
        'testproj',
      )
    })

    it('setActiveRun logs info message', () => {
      const run: ActiveRun = {
        runId: 'run-001',
        projectId: 'testproj',
        startedAt: '2026-01-01T00:00:00.000Z',
      }
      pipelineStore.setActiveRun('testproj', run)
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Set active run %s for project %s',
        'run-001',
        'testproj',
      )
    })
  })
})
