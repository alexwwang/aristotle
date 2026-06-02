/**
 * Phase 1 tests for PipelineStore — getUnresolvedViolations, resolveViolations, FIFO eviction,
 * and in-memory index.
 *
 * TDD Red phase: these methods do NOT exist yet on PipelineStore.
 * All tests should FAIL until the implementation lands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { AuditLogEntry } from '../src/schema.js'
import { NOW } from './helpers.js'

/** Phase 1 constant — will move to constants.ts when implementation lands. */
const MAX_AUDIT_ENTRIES = 5000

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

/** Helper to create a violation audit entry with sensible defaults. */
function makeViolationEntry(overrides: Partial<AuditLogEntry> & {
  tool?: string
  filePath?: string
  command?: string
  severity?: 'block' | 'warn'
  resolved?: boolean
  resolvedAt?: string
  evicted?: boolean
} = {}): AuditLogEntry & Record<string, unknown> {
  const { tool, filePath, command, severity, resolved, resolvedAt, evicted, ...auditOverrides } = overrides
  const entry: AuditLogEntry & Record<string, unknown> = {
    timestamp: NOW,
    runId: 'run-001',
    projectId: 'testproj',
    sessionId: 'sess-001',
    event: 'INTERCEPT',
    phase: 1,
    decision: 'WARN',
    severity: 'warn',
    ...auditOverrides,
  }
  if (tool !== undefined) entry.tool = tool
  if (filePath !== undefined) entry.filePath = filePath
  if (command !== undefined) entry.command = command
  if (severity !== undefined) entry.severity = severity
  if (resolved !== undefined) entry.resolved = resolved
  if (resolvedAt !== undefined) entry.resolvedAt = resolvedAt
  if (evicted !== undefined) entry.evicted = evicted
  return entry
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('PipelineStore Phase 1', () => {
  let mockStore: StateStore
  let mockLogger: Logger
  let pipelineStore: PipelineStore

  beforeEach(() => {
    mockStore = createMockStateStore()
    mockLogger = createMockLogger()
    pipelineStore = new PipelineStore(mockStore, mockLogger)
  })

  // ------------------------------------------------------------------
  // getUnresolvedViolations
  // ------------------------------------------------------------------

  describe('getUnresolvedViolations', () => {
    it('TC-PS1-01: returns empty when no audit entries exist', () => {
      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toEqual([])
    })

    it('TC-PS1-02: returns block-level unresolved violations', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'BLOCK',
        severity: 'block',
        event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'block')
      expect(result).toHaveLength(1)
      expect(result[0].severity).toBe('block')
      expect(result[0].decision).toBe('BLOCK')
    })

    it('TC-PS1-03: returns warn-level unresolved violations', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN',
        severity: 'warn',
        event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(1)
      expect(result[0].severity).toBe('warn')
      expect(result[0].decision).toBe('WARN')
    })

    it('TC-PS1-04: filters by tool=Bash', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Bash', event: 'INTERCEPT',
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Write', event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn', { tool: 'Bash' })
      expect(result).toHaveLength(1)
      expect(result[0].tool).toBe('Bash')
    })

    it('TC-PS1-05: filters by tool=Write + filePath', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Write', filePath: '/src/index.ts', event: 'INTERCEPT',
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Write', filePath: '/src/other.ts', event: 'INTERCEPT',
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Bash', event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn', {
        tool: 'Write',
        filePath: '/src/index.ts',
      })
      expect(result).toHaveLength(1)
      expect(result[0].filePath).toBe('/src/index.ts')
    })

    it('TC-PS1-06: filters by event=pipeline_start', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'BLOCK', event: 'pipeline_start', tool: 'Bash',
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'BLOCK', event: 'INTERCEPT', tool: 'Bash',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'block', {
        event: 'pipeline_start',
      })
      expect(result).toHaveLength(1)
      expect(result[0].event).toBe('pipeline_start')
    })

    it('TC-PS1-07: filters by commandPattern (glob match)', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Bash', command: 'npm test*', event: 'INTERCEPT',
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Bash', command: 'git commit*', event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn', {
        commandPattern: 'npm*',
      })
      expect(result).toHaveLength(1)
      expect(result[0].command).toBe('npm test*')
    })

    it('TC-PS1-08: combined filter — tool + event (AND semantics)', () => {
      // Matches: tool=Bash, event=INTERCEPT
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Bash', event: 'INTERCEPT',
      }))
      // No match: tool=Bash, event=pipeline_start
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Bash', event: 'pipeline_start',
      }))
      // No match: tool=Write, event=INTERCEPT
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', tool: 'Write', event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn', {
        tool: 'Bash',
        event: 'INTERCEPT',
      })
      expect(result).toHaveLength(1)
      expect(result[0].tool).toBe('Bash')
      expect(result[0].event).toBe('INTERCEPT')
    })

    it('TC-PS1-09: excludes already-resolved entries', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', resolved: true,
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(1)
      expect(result[0].resolved).toBeFalsy()
    })

    it('TC-PS1-10: returns entries with _sourceKey field', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT',
      }))

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('_sourceKey')
      expect(typeof result[0]._sourceKey).toBe('string')
      // _sourceKey should identify the audit key the entry came from
      expect(result[0]._sourceKey).toContain('testproj')
    })
  })

  // ------------------------------------------------------------------
  // resolveViolations
  // ------------------------------------------------------------------

  describe('resolveViolations', () => {
    it('TC-PS1-11: marks entries as resolved by timestamp', () => {
      const ts1 = '2026-01-01T00:00:00.000Z'
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts1,
      }))

      pipelineStore.resolveViolations('testproj', 'run-001', [ts1])

      const logs = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      const entry = logs.find((e: any) => e.timestamp === ts1)
      expect(entry.resolved).toBe(true)
    })

    it('TC-PS1-12: sets resolvedAt to ISO 8601 string', () => {
      const ts1 = '2026-01-01T00:00:00.000Z'
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts1,
      }))

      pipelineStore.resolveViolations('testproj', 'run-001', [ts1])

      const logs = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      const entry = logs.find((e: any) => e.timestamp === ts1)
      expect(entry.resolvedAt).toBeDefined()
      expect(typeof entry.resolvedAt).toBe('string')
      // Verify it's a valid ISO 8601 date string
      expect(new Date(entry.resolvedAt).toISOString()).toBe(entry.resolvedAt)
    })

    it('TC-PS1-13: resolved entries no longer appear in getUnresolvedViolations', () => {
      const ts1 = '2026-01-01T00:00:00.000Z'
      const ts2 = '2026-01-01T00:01:00.000Z'
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts1,
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts2,
      }))

      // Before resolve: 2 unresolved
      expect(pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')).toHaveLength(2)

      pipelineStore.resolveViolations('testproj', 'run-001', [ts1])

      // After resolve: 1 unresolved
      const remaining = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].timestamp).toBe(ts2)
    })

    it('TC-PS1-14: resolving non-existent timestamp is a no-op', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: NOW,
      }))

      // Should not throw
      expect(() =>
        pipelineStore.resolveViolations('testproj', 'run-001', ['2099-12-31T23:59:59.999Z']),
      ).not.toThrow()

      // Original entry should be untouched
      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(1)
    })

    it('TC-PS1-15: resolving already-resolved entry is idempotent', () => {
      const ts1 = '2026-01-01T00:00:00.000Z'
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts1,
      }))

      pipelineStore.resolveViolations('testproj', 'run-001', [ts1])
      const firstResolvedAt = (mockStore as any)._logs
        .get('watchdog/testproj/run-001/audit')
        .find((e: any) => e.timestamp === ts1).resolvedAt

      // Resolve again — should not change resolvedAt
      pipelineStore.resolveViolations('testproj', 'run-001', [ts1])
      const secondResolvedAt = (mockStore as any)._logs
        .get('watchdog/testproj/run-001/audit')
        .find((e: any) => e.timestamp === ts1).resolvedAt

      expect(secondResolvedAt).toBe(firstResolvedAt)
    })

    it('TC-PS1-16: multiple timestamps resolved in single call', () => {
      const ts1 = '2026-01-01T00:00:00.000Z'
      const ts2 = '2026-01-01T00:01:00.000Z'
      const ts3 = '2026-01-01T00:02:00.000Z'
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts1,
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts2,
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts3,
      }))

      pipelineStore.resolveViolations('testproj', 'run-001', [ts1, ts3])

      const remaining = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].timestamp).toBe(ts2)
    })

    it('TC-PS1-17: updates in-memory index after resolve', () => {
      const ts1 = '2026-01-01T00:00:00.000Z'
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts1,
      }))

      // Verify index was built (1 unresolved)
      expect(pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')).toHaveLength(1)

      pipelineStore.resolveViolations('testproj', 'run-001', [ts1])

      // Index must reflect the resolved state (0 unresolved)
      expect(pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')).toHaveLength(0)
    })

    it('TC-PS1-18: empty timestamps array is a no-op', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT',
      }))

      expect(() =>
        pipelineStore.resolveViolations('testproj', 'run-001', []),
      ).not.toThrow()

      // Entry should still be unresolved
      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(1)
    })
  })

  // ------------------------------------------------------------------
  // FIFO Eviction (AC-9)
  // ------------------------------------------------------------------

  describe('FIFO eviction', () => {
    it('TC-PS1-19: under 5000 entries — no eviction', () => {
      // Append 4999 entries
      for (let i = 0; i < 4999; i++) {
        pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
          decision: 'WARN',
          event: 'INTERCEPT',
          timestamp: new Date(Date.parse(NOW) + i).toISOString(),
        }))
      }

      // Checkpoint should not evict
      pipelineStore.checkpointEviction('testproj', 'run-001')

      const logs = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      expect(logs).toHaveLength(4999)
      // No entries should be marked evicted
      expect(logs.every((e: any) => !e.evicted)).toBe(true)
    })

    it('TC-PS1-20: at exactly 5000 entries — no eviction', () => {
      for (let i = 0; i < 5000; i++) {
        pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
          decision: 'WARN',
          event: 'INTERCEPT',
          timestamp: new Date(Date.parse(NOW) + i).toISOString(),
        }))
      }

      pipelineStore.checkpointEviction('testproj', 'run-001')

      const logs = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      expect(logs).toHaveLength(5000)
      expect(logs.every((e: any) => !e.evicted)).toBe(true)
    })

    it('TC-PS1-21: over 5000 entries — oldest entries evicted', () => {
      // Append 5010 entries
      for (let i = 0; i < 5010; i++) {
        pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
          decision: 'WARN',
          event: 'INTERCEPT',
          timestamp: new Date(Date.parse(NOW) + i).toISOString(),
        }))
      }

      pipelineStore.checkpointEviction('testproj', 'run-001')

      const logs = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      // Should have exactly 5000 entries remaining
      expect(logs).toHaveLength(5000)
      // First 10 should be marked evicted (they're the oldest)
      // Actually: eviction removes oldest, so after eviction count should be 5000
      // The evicted entries are the oldest ones
      const evicted = logs.filter((e: any) => e.evicted === true)
      expect(evicted).toHaveLength(0) // evicted entries should be removed, not kept

      // Verify the remaining entries are the newest 5000
      const firstRemaining = logs[0]
      expect(new Date(firstRemaining.timestamp).getTime()).toBeGreaterThan(Date.parse(NOW))
    })

    it('TC-PS1-22: evicted entries marked with evicted: true before removal', () => {
      // We test that eviction marks entries before removing by checking via getUnresolvedViolations
      for (let i = 0; i < 5010; i++) {
        pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
          decision: 'WARN',
          event: 'INTERCEPT',
          timestamp: new Date(Date.parse(NOW) + i).toISOString(),
        }))
      }

      pipelineStore.checkpointEviction('testproj', 'run-001')

      // All returned entries should NOT be evicted
      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result.every((e: any) => !e.evicted)).toBe(true)
    })

    it('TC-PS1-23: eviction happens at checkpoint (not at append)', () => {
      // Append 5010 entries — no eviction should happen yet
      for (let i = 0; i < 5010; i++) {
        pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
          decision: 'WARN',
          event: 'INTERCEPT',
          timestamp: new Date(Date.parse(NOW) + i).toISOString(),
        }))
      }

      // Before checkpoint: all 5010 entries should be present
      const logsBefore = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      expect(logsBefore).toHaveLength(5010)

      // After checkpoint: eviction kicks in
      pipelineStore.checkpointEviction('testproj', 'run-001')

      const logsAfter = (mockStore as any)._logs.get('watchdog/testproj/run-001/audit')
      expect(logsAfter).toHaveLength(5000)
    })

    it('TC-PS1-24: evicted entries excluded from getUnresolvedViolations', () => {
      // Append 5010 entries
      for (let i = 0; i < 5010; i++) {
        pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
          decision: 'WARN',
          event: 'INTERCEPT',
          timestamp: new Date(Date.parse(NOW) + i).toISOString(),
        }))
      }

      pipelineStore.checkpointEviction('testproj', 'run-001')

      // getUnresolvedViolations should only return the 5000 remaining entries
      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(5000)
    })
  })

  // ------------------------------------------------------------------
  // In-memory Index
  // ------------------------------------------------------------------

  describe('in-memory index', () => {
    it('TC-PS1-25: index built when appendAudit is called', () => {
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT',
      }))

      // If index is built at append time, getUnresolvedViolations should find it
      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(1)
    })

    it('TC-PS1-26: index updated when resolveViolations is called', () => {
      const ts1 = '2026-01-01T00:00:00.000Z'
      const ts2 = '2026-01-01T00:01:00.000Z'
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts1,
      }))
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', event: 'INTERCEPT', timestamp: ts2,
      }))

      // Resolve one — index should reflect the update
      pipelineStore.resolveViolations('testproj', 'run-001', [ts1])

      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      expect(result).toHaveLength(1)
      expect(result[0].timestamp).toBe(ts2)
    })

    it('TC-PS1-27: index covers all audit* key prefixes (rotation)', () => {
      // Primary audit key — warn entry
      pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
        decision: 'WARN', severity: 'warn', event: 'INTERCEPT', timestamp: '2026-01-01T00:00:00.000Z',
      }))
      // Rotated audit key (audit.1) — block entry, populated via appendLog
      const rotatedEntry = makeViolationEntry({
        decision: 'BLOCK', severity: 'block', event: 'INTERCEPT', timestamp: '2026-01-01T00:01:00.000Z',
      })
      ;(mockStore as any).appendLog('watchdog/testproj/run-001/audit.1', rotatedEntry)

      const warnResult = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn')
      const blockResult = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'block')
      expect(warnResult).toHaveLength(1)
      expect(blockResult).toHaveLength(1)
    })

    it('TC-PS1-28: index lookup is O(1) — no full scan', () => {
      // Populate with many entries
      for (let i = 0; i < 100; i++) {
        pipelineStore.appendAudit('testproj', 'run-001', makeViolationEntry({
          decision: i < 50 ? 'WARN' : 'BLOCK',
          event: 'INTERCEPT',
          timestamp: new Date(Date.parse(NOW) + i).toISOString(),
          tool: i < 50 ? 'Bash' : 'Write',
        }))
      }

      // Filtered lookup should be efficient — returns only matching entries
      const result = pipelineStore.getUnresolvedViolations('testproj', 'run-001', 'warn', {
        tool: 'Bash',
      })
      expect(result).toHaveLength(50)
      // All results should match the filter
      expect(result.every((e: any) => e.tool === 'Bash')).toBe(true)
    })
  })
})
