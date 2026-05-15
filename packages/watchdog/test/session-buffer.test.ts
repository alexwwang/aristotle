import { describe, it, expect } from 'vitest'
import { SessionBuffer } from '../src/session-buffer.js'

const MAX_SIZE = 1000

describe('SessionBuffer', () => {
  // ── TC-A-01 (was TC-A-11) ─────────────────────────────────────────────────
  it('records entries within bounds', () => {
    const buffer = new SessionBuffer(MAX_SIZE)

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
    const buffer = new SessionBuffer(MAX_SIZE)

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
    const buffer = new SessionBuffer(MAX_SIZE)

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
    const buffer = new SessionBuffer(MAX_SIZE)

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
})
