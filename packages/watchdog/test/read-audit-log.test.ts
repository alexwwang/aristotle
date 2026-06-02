/**
 * Tests for PipelineStore.readAuditLog and the read_audit_log tool registration.
 *
 * Covers: no filter, event filter, severity filter, resolved filter, limit,
 * combined filters, empty result for non-existent run, sort order, and
 * path traversal validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import type { AuditLogEntry } from '../src/schema.js'
import { createWatchdogTools } from '../src/tools.js'

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function createMockStateStore(): StateStore & { _logs: Map<string, any[]> } {
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

function makeEntry(overrides: Partial<AuditLogEntry> & { resolved?: boolean; severity?: string } = {}): AuditLogEntry {
  const { resolved, severity, ...rest } = overrides
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    runId: 'run-001',
    projectId: 'proj-1',
    sessionId: 'sess-001',
    event: 'INTERCEPT',
    phase: 1,
    decision: 'PASS',
    resolved,
    severity,
    ...rest,
  }
}

// ------------------------------------------------------------------
// PipelineStore.readAuditLog
// ------------------------------------------------------------------

describe('PipelineStore.readAuditLog', () => {
  let store: PipelineStore
  let stateStore: ReturnType<typeof createMockStateStore>

  beforeEach(() => {
    stateStore = createMockStateStore()
    store = new PipelineStore(stateStore, createMockLogger())
  })

  function populateEntries(entries: AuditLogEntry[]) {
    const key = 'watchdog/proj-1/run-001/audit'
    for (const entry of entries) {
      stateStore.appendLog(key, entry)
    }
  }

  it('returns all entries when no filter is provided', () => {
    const entries = [
      makeEntry({ timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:03.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001')
    expect(result).toHaveLength(3)
  })

  it('filters by event type', () => {
    const entries = [
      makeEntry({ event: 'INTERCEPT', timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ event: 'phase_enter', timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ event: 'INTERCEPT', timestamp: '2026-01-01T00:00:03.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001', { event: 'INTERCEPT' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.event === 'INTERCEPT')).toBe(true)
  })

  it('filters by severity', () => {
    const entries = [
      makeEntry({ severity: 'block', timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ severity: 'warn', timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ severity: 'block', timestamp: '2026-01-01T00:00:03.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001', { severity: 'block' })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.severity === 'block')).toBe(true)
  })

  it('filters by resolved status (true)', () => {
    const entries = [
      makeEntry({ resolved: true, timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ resolved: false, timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ resolved: true, timestamp: '2026-01-01T00:00:03.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001', { resolved: true })
    expect(result).toHaveLength(2)
    expect(result.every(e => e.resolved === true)).toBe(true)
  })

  it('filters by resolved status (false)', () => {
    const entries = [
      makeEntry({ resolved: true, timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ resolved: false, timestamp: '2026-01-01T00:00:02.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001', { resolved: false })
    expect(result).toHaveLength(1)
    expect(result[0].resolved).toBe(false)
  })

  it('applies limit filter', () => {
    const entries = [
      makeEntry({ timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:03.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:04.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:05.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001', { limit: 3 })
    expect(result).toHaveLength(3)
  })

  it('applies combined filters', () => {
    const entries = [
      makeEntry({ event: 'INTERCEPT', severity: 'block', resolved: false, timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ event: 'INTERCEPT', severity: 'warn', resolved: false, timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ event: 'phase_enter', severity: 'block', resolved: false, timestamp: '2026-01-01T00:00:03.000Z' }),
      makeEntry({ event: 'INTERCEPT', severity: 'block', resolved: true, timestamp: '2026-01-01T00:00:04.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001', {
      event: 'INTERCEPT',
      severity: 'block',
      resolved: false,
    })
    expect(result).toHaveLength(1)
    expect(result[0].event).toBe('INTERCEPT')
    expect(result[0].severity).toBe('block')
    expect(result[0].resolved).toBe(false)
  })

  it('returns empty array for non-existent run', () => {
    const result = store.readAuditLog('proj-1', 'run-nonexistent')
    expect(result).toEqual([])
  })

  it('returns entries sorted by timestamp descending (newest first)', () => {
    const entries = [
      makeEntry({ timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:03.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:02.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001')
    expect(result[0].timestamp).toBe('2026-01-01T00:00:03.000Z')
    expect(result[1].timestamp).toBe('2026-01-01T00:00:02.000Z')
    expect(result[2].timestamp).toBe('2026-01-01T00:00:01.000Z')
  })

  it('throws on path traversal in projectId', () => {
    expect(() => store.readAuditLog('../etc', 'run-001')).toThrow('Path traversal')
  })

  it('throws on path traversal in runId', () => {
    expect(() => store.readAuditLog('proj-1', '../etc')).toThrow('Path traversal')
  })

  it('limit=0 returns empty array', () => {
    const entries = [
      makeEntry({ timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ timestamp: '2026-01-01T00:00:02.000Z' }),
    ]
    populateEntries(entries)
    const result = store.readAuditLog('proj-1', 'run-001', { limit: 0 })
    expect(result).toHaveLength(0)
  })

  it('filters by Phase 2 event types (TEST_RUN_REQUESTED, TEST_RUN_COMPLETE)', () => {
    const entries = [
      makeEntry({ event: 'TEST_RUN_REQUESTED', severity: 'warn', timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ event: 'TEST_RUN_COMPLETE', severity: 'warn', pass: 8, fail: 0, error_summary: '', timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ event: 'RALPH_ROUNDS_EXCEEDED', severity: 'warn', timestamp: '2026-01-01T00:00:03.000Z' }),
      makeEntry({ event: 'DEGRADATION_MODE_ACTIVATED', severity: 'warn', timestamp: '2026-01-01T00:00:04.000Z' }),
    ]
    populateEntries(entries)
    const requested = store.readAuditLog('proj-1', 'run-001', { event: 'TEST_RUN_REQUESTED' })
    expect(requested).toHaveLength(1)
    expect(requested[0].event).toBe('TEST_RUN_REQUESTED')
    expect(requested[0].severity).toBe('warn')

    const complete = store.readAuditLog('proj-1', 'run-001', { event: 'TEST_RUN_COMPLETE' })
    expect(complete).toHaveLength(1)
    expect(complete[0].pass).toBe(8)
    expect(complete[0].fail).toBe(0)
    expect(complete[0].error_summary).toBe('')
  })

  it('filters by severity and matches Phase 2 entries with severity', () => {
    const entries = [
      makeEntry({ event: 'TEST_RUN_REQUESTED', severity: 'warn', timestamp: '2026-01-01T00:00:01.000Z' }),
      makeEntry({ event: 'COMMAND_FAILED', severity: 'block', timestamp: '2026-01-01T00:00:02.000Z' }),
      makeEntry({ event: 'TEST_RUN_COMPLETE', severity: 'warn', pass: 5, fail: 1, error_summary: '1 fail', timestamp: '2026-01-01T00:00:03.000Z' }),
    ]
    populateEntries(entries)
    const warnEntries = store.readAuditLog('proj-1', 'run-001', { severity: 'warn' })
    expect(warnEntries).toHaveLength(2)
    expect(warnEntries.every(e => e.severity === 'warn')).toBe(true)
  })
})

// ------------------------------------------------------------------
// read_audit_log tool registration
// ------------------------------------------------------------------

describe('read_audit_log tool', () => {
  it('is registered in createWatchdogTools output', () => {
    const mockHandler: any = { handle: () => Promise.resolve('{}') }
    const mockStore: any = { readAuditLog: vi.fn(() => []) }
    const tools = createWatchdogTools({ checkpointHandler: mockHandler, pipelineStore: mockStore })
    expect(tools.read_audit_log).toBeDefined()
    expect(tools.read_audit_log.description).toContain('audit log')
  })

  it('returns ok:false when worktree is missing', async () => {
    const mockHandler: any = { handle: () => Promise.resolve('{}') }
    const mockStore: any = { readAuditLog: vi.fn(() => []) }
    const tools = createWatchdogTools({ checkpointHandler: mockHandler, pipelineStore: mockStore })
    const result = await tools.read_audit_log.execute!(
      { projectId: 'p1', runId: 'r1' },
      {}, // no worktree
    )
    const parsed = JSON.parse(result as string)
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('Cannot determine project root')
  })

  it('calls pipelineStore.readAuditLog and returns entries', async () => {
    const mockHandler: any = { handle: () => Promise.resolve('{}') }
    const mockEntries = [makeEntry({ timestamp: '2026-01-01T00:00:01.000Z' })]
    const mockStore: any = { readAuditLog: vi.fn(() => mockEntries) }
    const tools = createWatchdogTools({ checkpointHandler: mockHandler, pipelineStore: mockStore })

    const result = await tools.read_audit_log.execute!(
      { projectId: 'proj-1', runId: 'run-001' },
      { worktree: '/tmp/test' },
    )
    const parsed = JSON.parse(result as string)
    expect(parsed.ok).toBe(true)
    expect(parsed.entries).toHaveLength(1)
    expect(mockStore.readAuditLog).toHaveBeenCalledWith('proj-1', 'run-001', undefined)
  })

  it('passes filter object to readAuditLog', async () => {
    const mockHandler: any = { handle: () => Promise.resolve('{}') }
    const mockStore: any = { readAuditLog: vi.fn(() => []) }
    const tools = createWatchdogTools({ checkpointHandler: mockHandler, pipelineStore: mockStore })

    await tools.read_audit_log.execute!(
      { projectId: 'proj-1', runId: 'run-001', filter: { event: 'INTERCEPT', limit: 10 } },
      { worktree: '/tmp/test' },
    )
    expect(mockStore.readAuditLog).toHaveBeenCalledWith('proj-1', 'run-001', {
      event: 'INTERCEPT',
      limit: 10,
    })
  })
})
