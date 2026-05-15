/**
 * Schema contract tests — verify type definitions match runtime data shapes.
 * Complements behavioral tests in Module A/B/C files.
 * Design: Phase3-SchemaContract-SemanticAssertion.md
 */
import { describe, it, expect } from 'vitest'
import type { CheckpointEvent, ObservationEntry } from '../src/schema.js'

describe('Schema Contract', () => {
  // ── SC-1: CheckpointEvent includes why_articulation ──────────────────
  it('SC-1: CheckpointEvent union includes why_articulation', () => {
    // Compile-time: if why_articulation is not in the union, TS errors here
    const events: CheckpointEvent[] = [
      'pipeline_start',
      'phase_enter',
      'ralph_loop_start',
      'ralph_round_complete',
      'ralph_terminate',
      'test_evidence',
      'user_approval',
      'phase_complete',
      'why_articulation',
    ]
    expect(events).toContain('why_articulation')
    expect(events).toHaveLength(9)
  })

  // ── SC-3: ObservationEntry uses "tool" not "toolName" ────────────────
  it('SC-3: ObservationEntry has tool field matching observer output', () => {
    const entry: ObservationEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      runId: 'run-001',
      projectId: 'proj-001',
      sessionId: 'sess-001',
      type: '_reviewer_spawned',
      tool: 'Task',
      callID: 'call-123',
      round: 1,
    }
    expect(entry).toHaveProperty('tool')
    expect(entry.tool).toBe('Task')
    // Ensure no toolName field exists — the type should not have it
    expect('toolName' in entry).toBe(false)
  })
})
