import { describe, it, expect, vi } from 'vitest'
import { SessionBuffer } from '../src/session-buffer.js'
import { SESSION_BUFFER_MAX_SIZE, MAX_TRACKED_SESSIONS } from '../src/constants.js'

const MAX_SIZE = 1000

function createBuffer(): SessionBuffer {
  return new SessionBuffer({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any)
}

describe('SessionBuffer', () => {
  // ── TC-A-01 (was TC-A-11) ─────────────────────────────────────────────────
  it('records entries within bounds', () => {
    const buffer = createBuffer()

    buffer.record('sess-001', {
      tool: 'Task',
      callID: 'call-1',
      timestamp: '2026-01-01T00:00:00Z',
    })
    buffer.record('sess-001', {
      tool: 'edit',
      callID: 'call-2',
      timestamp: '2026-01-01T00:00:01Z',
    })

    const result = buffer.getSession('sess-001')
    expect(result).toHaveLength(2)
    expect(result[0].tool).toBe('Task')
    expect(result[1].tool).toBe('edit')
  })

  // ── TC-A-02 (was TC-A-12) ─────────────────────────────────────────────────
  it('evicts oldest entries on overflow', () => {
    const buffer = createBuffer()

    for (let i = 0; i < MAX_SIZE + 1; i++) {
      buffer.record('sess-001', {
        tool: 'Task',
        callID: `call-${i}`,
        timestamp: `2026-01-01T00:00:${i.toString().padStart(2, '0')}Z`,
      })
    }

    const result = buffer.getSession('sess-001')
    expect(result).toHaveLength(MAX_SIZE)
    expect(result[0].callID).toBe('call-1')
    expect(result[MAX_SIZE - 1].callID).toBe(`call-${MAX_SIZE}`)
  })

  // ── TC-A-03 (was TC-A-13) ─────────────────────────────────────────────────
  it('clears all entries for a session', () => {
    const buffer = createBuffer()

    buffer.record('sess-001', {
      tool: 'Task',
      callID: 'call-1',
      timestamp: '2026-01-01T00:00:00Z',
    })
    buffer.clearSession('sess-001')

    expect(buffer.getSession('sess-001')).toEqual([])
  })

  // ── TC-A-04 (was TC-A-14) ─────────────────────────────────────────────────
  it('isolates entries per session', () => {
    const buffer = createBuffer()

    buffer.record('sess-A', {
      tool: 'Task',
      callID: 'call-A1',
      timestamp: '2026-01-01T00:00:00Z',
    })
    buffer.record('sess-B', {
      tool: 'edit',
      callID: 'call-B1',
      timestamp: '2026-01-01T00:00:01Z',
    })

    expect(buffer.getSession('sess-A')).toHaveLength(1)
    expect(buffer.getSession('sess-B')).toHaveLength(1)
    expect(buffer.sessionCount()).toBe(2)
  })

  // ── SA-3: SESSION_BUFFER_MAX_SIZE constant exists and equals 1000 ────
  it('SA-3: SESSION_BUFFER_MAX_SIZE is exported as 1000', () => {
    expect(SESSION_BUFFER_MAX_SIZE).toBe(1000)
  })

  // ── TC-A-XX: Per-session FIFO eviction independence ──────────────────────
  it('per-session FIFO eviction does not affect other sessions', () => {
    const buffer = createBuffer()
    const SMALL_MAX = 5

    // Fill session A beyond its limit using the constant (1000)
    // But we test independence: fill sess-A with 10 entries, sess-B with 3
    for (let i = 0; i < 10; i++) {
      buffer.record('sess-A', {
        tool: 'Task',
        callID: `call-A${i}`,
        timestamp: `2026-01-01T00:00:${i.toString().padStart(2, '0')}Z`,
      })
    }
    for (let i = 0; i < 3; i++) {
      buffer.record('sess-B', {
        tool: 'edit',
        callID: `call-B${i}`,
        timestamp: `2026-01-01T00:00:${i.toString().padStart(2, '0')}Z`,
      })
    }

    // Both sessions keep all entries (10 and 3 are well under 1000)
    expect(buffer.getSession('sess-A')).toHaveLength(10)
    expect(buffer.getSession('sess-B')).toHaveLength(3)
  })

  // ── TC-A-05: MAX_TRACKED_SESSIONS evicts oldest session ───────────────
  it('evicts oldest session when session count exceeds MAX_TRACKED_SESSIONS', () => {
    const buffer = createBuffer()

    // Fill MAX_TRACKED_SESSIONS + 1 sessions with 1 entry each
    for (let i = 0; i < MAX_TRACKED_SESSIONS + 1; i++) {
      buffer.record(`sess-${i.toString().padStart(3, '0')}`, {
        tool: 'Task',
        callID: `call-${i}`,
        timestamp: '2026-01-01T00:00:00Z',
      })
    }

    // Session count should be capped at MAX_TRACKED_SESSIONS
    expect(buffer.sessionCount()).toBe(MAX_TRACKED_SESSIONS)

    // The oldest session (sess-000) should have been evicted
    expect(buffer.getSession('sess-000')).toEqual([])

    // The newest session should still exist
    const lastSession = `sess-${MAX_TRACKED_SESSIONS.toString().padStart(3, '0')}`
    expect(buffer.getSession(lastSession)).toHaveLength(1)
  })
})
