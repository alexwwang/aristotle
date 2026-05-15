/**
 * CheckpointHandler Phase 2 tests — Module C (Articulation Validation)
 *
 * Tests TC-C-09 through TC-C-30.
 * TDD Red phase — tests fail until source modules are updated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckpointResult, PipelineState } from '../src/schema.js'
import { CheckpointHandler } from '../src/checkpoint.js'
import { validateTransition, applyTransition } from '../src/transitions.js'
import {
  makeState,
  makePhaseRecord,
  createMockStore,
  createMockCache,
  createMockObserver,
  STALE_THRESHOLD_MS,
} from './helpers.js'
import { computeProjectId } from '../src/project-id.js'

const WORKTREE = '/Users/test/my-project'
const SESSION_ID = 'sess-001'
const CONTEXT = { worktree: WORKTREE, sessionID: SESSION_ID }
const PROJECT_ID = computeProjectId(WORKTREE)
const NOW = '2026-01-01T00:00:00.000Z'

function parseResult(raw: string): CheckpointResult {
  return JSON.parse(raw) as CheckpointResult
}

function getLastWrittenState(store: any): any {
  const calls = store.writeState.mock.calls
  if (calls.length === 0) return null
  return calls[calls.length - 1][2]
}

/** Advance pipeline to phase N with ralph_loop active (phaseStatus = 'active' after ralph_loop_start). */
async function advanceToPhaseActive(handler: CheckpointHandler, phase: number): Promise<void> {
  await handler.handle('phase_enter', JSON.stringify({ phase }), CONTEXT)
  await handler.handle('ralph_loop_start', JSON.stringify({ phase }), CONTEXT)
}

// ── Test Setup ──────────────────────────────────────────────────────────────

describe('CheckpointHandler Phase 2', () => {
  let mockStore: ReturnType<typeof createMockStore>
  let mockCache: ReturnType<typeof createMockCache>
  let mockObserver: ReturnType<typeof createMockObserver>
  let handler: CheckpointHandler

  beforeEach(() => {
    mockStore = createMockStore()
    mockCache = createMockCache()
    mockObserver = createMockObserver()

    // Reconfigure store mocks for synchronous returns (checkpoint.ts uses sync calls)
    const activeRuns = new Map<string, any>()
    const states = new Map<string, any>()
    const audits = new Map<string, any[]>()
    const observations = new Map<string, any[]>()

    mockStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
    mockStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
    mockStore.clearActiveRun.mockImplementation((pid: string) => activeRuns.delete(pid))
    mockStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
    mockStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))
    mockStore.appendAudit.mockImplementation((pid: string, rid: string, entry: any) => {
      const key = `${pid}/${rid}`
      if (!audits.has(key)) audits.set(key, [])
      audits.get(key)!.push(entry)
    })
    mockStore.findObservations.mockImplementation((pid: string, rid: string, filter: any) => {
      const entries = observations.get(`${pid}/${rid}`) ?? []
      if (!filter) return entries
      return entries.filter((e: any) => {
        if (filter.type && e.type !== filter.type) return false
        if (filter.round !== undefined && e.round !== filter.round) return false
        return true
      })
    })
    mockStore.appendObservation.mockImplementation((pid: string, rid: string, entry: any) => {
      const key = `${pid}/${rid}`
      if (!observations.has(key)) observations.set(key, [])
      observations.get(key)!.push(entry)
    })
    mockStore.readObservations.mockImplementation((pid: string, rid: string) => observations.get(`${pid}/${rid}`) ?? [])

    // Attach test helpers
    Object.assign(mockStore, {
      _setActiveRun(pid: string, run: any) { activeRuns.set(pid, run) },
      _setState(pid: string, rid: string, state: any) { states.set(`${pid}/${rid}`, state) },
      _getAudits(pid: string, rid: string) { return audits.get(`${pid}/${rid}`) ?? [] },
      _addObservation(pid: string, rid: string, entry: any) {
        const key = `${pid}/${rid}`
        if (!observations.has(key)) observations.set(key, [])
        observations.get(key)!.push(entry)
      },
    })

    // Reconfigure cache for sync returns
    mockCache.get.mockReturnValue(null)
    mockCache.update.mockImplementation(() => { /* no-op */ })
    mockCache.clear.mockImplementation(() => { /* no-op */ })

    // Phase 2 constructor takes 4 params: store, staleThresholdMs, cache, observer
    handler = new (CheckpointHandler as any)(mockStore, STALE_THRESHOLD_MS, mockCache, mockObserver)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  Articulation validation (degradation tests) — TC-C-09..12
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Articulation validation', () => {
    // ── TC-C-09 ─────────────────────────────────────────────────────────────
    it('TC-C-09: 3 consecutive failures -> degraded', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      }))

      const badPayload = JSON.stringify({ phase: 1, articulation: 'Too short.' })

      // Failure 1
      let result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)

      // Feed state forward
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      // Failure 2
      result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)

      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      // Failure 3 — should be degraded
      result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)
      if (!result.ok && 'violation' in result) {
        expect(result.violation).toContain('escalated to Ralph review')
      }
      const finalState = getLastWrittenState(mockStore)
      expect(finalState.phases[1].articulationDegraded).toBe(true)
    })

    // ── TC-C-10 ─────────────────────────────────────────────────────────────
    it('TC-C-10: success resets failure counter', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      }))

      const badPayload = JSON.stringify({ phase: 1, articulation: 'Too short.' })
      const goodPayload = JSON.stringify({
        phase: 1,
        articulation: 'This protects user data. Key risks include XSS. The approach works because input validation is effective.',
      })

      // Failure 1
      let result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)

      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      // Failure 2
      result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)

      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      // Success — counter resets, not degraded
      result = parseResult(await handler.handle('why_articulation' as any, goodPayload, CONTEXT))
      expect(result.ok).toBe(true)
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationVerified).toBe(true)
      expect(state.phases[1].articulationDegraded).toBe(false)
    })

    // ── TC-C-11 ─────────────────────────────────────────────────────────────
    it('TC-C-11: degradation persists as historical marker', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationDegraded: true, articulationAttempted: true, articulationVerified: false } },
      }))

      const goodPayload = JSON.stringify({
        phase: 1,
        articulation: 'This protects user data. Key risks include XSS. The approach works because input validation is effective.',
      })

      const result = parseResult(await handler.handle('why_articulation' as any, goodPayload, CONTEXT))
      expect(result.ok).toBe(true)
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationVerified).toBe(true)
      // Historical marker stays true (never un-sets)
      expect(state.phases[1].articulationDegraded).toBe(true)
    })

    // ── TC-C-12 ─────────────────────────────────────────────────────────────
    it('TC-C-12: restart loses failure counter', async () => {
      // Simulate 2 failures on first handler
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      }))

      const badPayload = JSON.stringify({ phase: 1, articulation: 'Too short.' })

      // 2 failures on first handler
      await handler.handle('why_articulation' as any, badPayload, CONTEXT)
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))
      await handler.handle('why_articulation' as any, badPayload, CONTEXT)

      // Fresh handler — counter reset
      const freshHandler = new (CheckpointHandler as any)(mockStore, STALE_THRESHOLD_MS, mockCache, mockObserver)
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      // First failure on fresh handler should NOT be degraded (counter=1)
      const result = parseResult(await freshHandler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)
      if (!result.ok && 'violation' in result) {
        expect(result.violation).not.toContain('escalated to Ralph review')
      }
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationDegraded).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  Transitions — why_articulation — TC-C-13..18
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Transitions - why_articulation', () => {
    // ── TC-C-13 ─────────────────────────────────────────────────────────────
    it('TC-C-13: valid preconditions for why_articulation', () => {
      const state = makeState({
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      })
      const result = validateTransition('why_articulation' as any, { phase: 1, articulation: 'test' }, state)
      expect(result.valid).toBe(true)
    })

    // ── TC-C-14 ─────────────────────────────────────────────────────────────
    it('TC-C-14: rejects why_articulation when phase mismatches', () => {
      const state = makeState({
        currentPhase: 2,
        phaseStatus: 'active',
        phases: { 2: makePhaseRecord(2) },
      })
      const result = validateTransition('why_articulation' as any, { phase: 1, articulation: 'test' }, state)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.violation).toBe('Phase mismatch')
      }
    })

    // ── TC-C-15 ─────────────────────────────────────────────────────────────
    it('TC-C-15: rejects why_articulation when phaseStatus is not active', () => {
      const state = makeState({
        currentPhase: 1,
        phaseStatus: 'idle',
        phases: { 1: makePhaseRecord(1) },
      })
      const result = validateTransition('why_articulation' as any, { phase: 1, articulation: 'test' }, state)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.violation).toBe('Phase not active')
      }
    })

    // ── TC-C-16 ─────────────────────────────────────────────────────────────
    it('TC-C-16: rejects why_articulation when phase record is missing', () => {
      const state = makeState({
        currentPhase: 1,
        phaseStatus: 'active',
        phases: {},
      })
      const result = validateTransition('why_articulation' as any, { phase: 1, articulation: 'test' }, state)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.violation).toContain('Phase 1 not found')
      }
    })

    // ── TC-C-17 ─────────────────────────────────────────────────────────────
    it('TC-C-17: applyTransition sets articulation fields', () => {
      const state = makeState({
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      })
      const newState = applyTransition('why_articulation' as any, {
        phase: 1,
        _articulationVerified: true,
        _articulationDimensions: {
          what_it_protects: true,
          key_risks: true,
          why_approach_works: true,
        },
        _now: NOW,
      }, state)

      expect(newState.phases[1].articulationAttempted).toBe(true)
      expect(newState.phases[1].articulationVerified).toBe(true)
      expect(newState.phases[1].articulationDimensions).toEqual({
        what_it_protects: true,
        key_risks: true,
        why_approach_works: true,
      })
      expect(newState.phases[1].articulationDegraded).toBe(false)
    })

    // ── TC-C-18 ─────────────────────────────────────────────────────────────
    it('TC-C-18: applyTransition preserves pre-existing degradation', () => {
      const state = makeState({
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationDegraded: true } },
      })
      const newState = applyTransition('why_articulation' as any, {
        phase: 1,
        _articulationVerified: true,
        _articulationDimensions: {
          what_it_protects: true,
          key_risks: true,
          why_approach_works: true,
        },
        _now: NOW,
      }, state)

      expect(newState.phases[1].articulationAttempted).toBe(true)
      expect(newState.phases[1].articulationVerified).toBe(true)
      expect(newState.phases[1].articulationDegraded).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  Checkpoint — articulation — TC-C-19..25
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Checkpoint - articulation', () => {
    // ── TC-C-19 ─────────────────────────────────────────────────────────────
    it('TC-C-19: why_articulation with good text returns ok=true', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      }))

      const payload = JSON.stringify({
        phase: 1,
        articulation: 'This protects user data. Key risks include XSS. The approach works because input validation is effective.',
      })

      const result = parseResult(await handler.handle('why_articulation' as any, payload, CONTEXT))
      expect(result.ok).toBe(true)
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationVerified).toBe(true)
    })

    // ── TC-C-20 ─────────────────────────────────────────────────────────────
    it('TC-C-20: why_articulation with poor text returns ok=false with guidance', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      }))

      const payload = JSON.stringify({ phase: 1, articulation: 'Short text.' })

      const result = parseResult(await handler.handle('why_articulation' as any, payload, CONTEXT))
      expect(result.ok).toBe(false)
      if (!result.ok && 'violation' in result) {
        expect(result.violation).toContain('incomplete')
        expect(result.guidance).toBeTruthy()
      }
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationAttempted).toBe(true)
    })

    // ── TC-C-21 ─────────────────────────────────────────────────────────────
    it('TC-C-21: degraded note after 3 failures', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      const badPayload = JSON.stringify({ phase: 1, articulation: 'Too short.' })

      // 2 more failures (already 1 prior)
      let result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)

      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      // Third failure overall — degraded
      result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)
      if (!result.ok && 'violation' in result) {
        expect(result.violation).toContain('escalated to Ralph review')
      }
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationDegraded).toBe(true)
    })

    // ── TC-C-22 ─────────────────────────────────────────────────────────────
    it('TC-C-22: re-validation after failure succeeds with good text', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      const goodPayload = JSON.stringify({
        phase: 1,
        articulation: 'This protects user data. Key risks include XSS. The approach works because input validation is effective.',
      })

      const result = parseResult(await handler.handle('why_articulation' as any, goodPayload, CONTEXT))
      expect(result.ok).toBe(true)
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationVerified).toBe(true)
    })

    // ── TC-C-23 ─────────────────────────────────────────────────────────────
    it('TC-C-23: phase_enter resets articulation failure counter', async () => {
      // 2 failures in phase 1
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))

      const badPayload = JSON.stringify({ phase: 1, articulation: 'Too short.' })
      await handler.handle('why_articulation' as any, badPayload, CONTEXT)

      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))
      await handler.handle('why_articulation' as any, badPayload, CONTEXT)

      // Complete phase 1 and enter phase 2
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'awaiting_approval',
        phases: { 1: { ...makePhaseRecord(1), ralphCompleted: true, ralphTermination: 'gate_pass', userApproved: true, approvedAt: NOW } },
      }))
      await handler.handle('phase_complete', JSON.stringify({ phase: 1 }), CONTEXT)

      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'complete',
        phases: { 1: { ...makePhaseRecord(1), ralphCompleted: true, ralphTermination: 'gate_pass', userApproved: true, approvedAt: NOW } },
      }))
      await handler.handle('phase_enter', JSON.stringify({ phase: 2 }), CONTEXT)

      // First articulation for phase 2 should NOT be degraded
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 2,
        phaseStatus: 'active',
        phases: {
          1: { ...makePhaseRecord(1), ralphCompleted: true, ralphTermination: 'gate_pass', userApproved: true, approvedAt: NOW },
          2: makePhaseRecord(2),
        },
      }))
      const badPayloadPhase2 = JSON.stringify({ phase: 2, articulation: 'Too short.' })
      const result = parseResult(await handler.handle('why_articulation' as any, badPayloadPhase2, CONTEXT))
      expect(result.ok).toBe(false)
      if (!result.ok && 'violation' in result) {
        expect(result.violation).not.toContain('escalated to Ralph review')
      }
      const state = getLastWrittenState(mockStore)
      expect(state.phases[2].articulationDegraded).toBe(false)
    })

    // ── TC-C-24 ─────────────────────────────────────────────────────────────
    it('TC-C-24: pipeline_start clears articulation failure counter', async () => {
      // Start a pipeline, trigger 2 failures
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      }))

      const badPayload = JSON.stringify({ phase: 1, articulation: 'Too short.' })
      await handler.handle('why_articulation' as any, badPayload, CONTEXT)

      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
      }))
      await handler.handle('why_articulation' as any, badPayload, CONTEXT)

      // pipeline_start for new run
      // First clear old state so pipeline_start can proceed
      mockStore.clearActiveRun(PROJECT_ID)
      const startResult = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'new run' }), CONTEXT))
      expect(startResult.ok).toBe(true)

      // Set up new run state
      const newRunId = getLastWrittenState(mockStore).runId
      mockStore._setActiveRun(PROJECT_ID, { runId: newRunId, projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, newRunId, makeState({
        runId: newRunId,
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
      }))

      // Next failure in same phase does NOT trigger degradation (counter was reset)
      const result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
      expect(result.ok).toBe(false)
      if (!result.ok && 'violation' in result) {
        expect(result.violation).not.toContain('escalated to Ralph review')
      }
      const state = getLastWrittenState(mockStore)
      expect(state.phases[1].articulationDegraded).toBe(false)
    })

    // ── TC-C-25 ─────────────────────────────────────────────────────────────
    it('TC-C-25: pipeline_start sets ownerSessionId via applyTransition', () => {
      const newState = applyTransition('pipeline_start', {
        description: 'test',
        _runId: 'r1',
        _projectId: 'p1',
        _ownerSessionId: 'sess-orch',
        _now: NOW,
      }, null)

      expect(newState.ownerSessionId).toBe('sess-orch')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  AC-2 enforcement — TC-C-26..29
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AC-2 enforcement', () => {
    // ── TC-C-26 ─────────────────────────────────────────────────────────────
    it('TC-C-26: round complete with matching observation passes', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'ralph_loop',
        phases: { 1: makePhaseRecord(1) },
        ralph: { phase: 1, round: 1, consecutiveZero: 1, tallyHistory: [], openContested: [], escalated: false, escalatedAt: null, termination: null },
      }))
      mockObserver.isDegraded.mockReturnValue(false)
      mockStore._addObservation(PROJECT_ID, 'run-001', {
        type: '_reviewer_spawned',
        round: 2,
        tool: 'Task',
        callID: 'call-1',
        timestamp: NOW,
      })

      const result = parseResult(await handler.handle(
        'ralph_round_complete',
        JSON.stringify({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
        CONTEXT,
      ))
      expect(result.ok).toBe(true)
    })

    // ── TC-C-27 ─────────────────────────────────────────────────────────────
    it('TC-C-27: round complete without observation fails', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'ralph_loop',
        phases: { 1: makePhaseRecord(1) },
        ralph: { phase: 1, round: 1, consecutiveZero: 1, tallyHistory: [], openContested: [], escalated: false, escalatedAt: null, termination: null },
      }))
      mockObserver.isDegraded.mockReturnValue(false)
      // No observations added

      const result = parseResult(await handler.handle(
        'ralph_round_complete',
        JSON.stringify({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
        CONTEXT,
      ))
      expect(result.ok).toBe(false)
      if (!result.ok && 'violation' in result) {
        expect(result.violation).toContain('Round 2 completed without a reviewer subagent')
      }
    })

    // ── TC-C-28 ─────────────────────────────────────────────────────────────
    it('TC-C-28: observer degraded skips AC-2 check', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'ralph_loop',
        phases: { 1: makePhaseRecord(1) },
        ralph: { phase: 1, round: 1, consecutiveZero: 1, tallyHistory: [], openContested: [], escalated: false, escalatedAt: null, termination: null },
      }))
      mockObserver.isDegraded.mockReturnValue(true)
      // No observations

      const result = parseResult(await handler.handle(
        'ralph_round_complete',
        JSON.stringify({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
        CONTEXT,
      ))
      expect(result.ok).toBe(true)
    })

    // ── TC-C-29 ─────────────────────────────────────────────────────────────
    it('TC-C-29: observation for wrong round fails', async () => {
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'ralph_loop',
        phases: { 1: makePhaseRecord(1) },
        ralph: { phase: 1, round: 1, consecutiveZero: 1, tallyHistory: [], openContested: [], escalated: false, escalatedAt: null, termination: null },
      }))
      mockObserver.isDegraded.mockReturnValue(false)
      // Observation exists but for round 3, not round 2
      mockStore._addObservation(PROJECT_ID, 'run-001', {
        type: '_reviewer_spawned',
        round: 3,
        tool: 'Task',
        callID: 'call-1',
        timestamp: NOW,
      })

      const result = parseResult(await handler.handle(
        'ralph_round_complete',
        JSON.stringify({ phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }),
        CONTEXT,
      ))
      expect(result.ok).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  Ownership — TC-C-30
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Ownership', () => {
    // ── TC-C-30 ─────────────────────────────────────────────────────────────
    it('TC-C-30: Phase 1 state (no ownerSessionId) skips ownership check', async () => {
      // State without ownerSessionId — Phase 1 backward compatibility
      mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
      mockStore._setState(PROJECT_ID, 'run-001', makeState({
        runId: 'run-001',
        currentPhase: 1,
        phaseStatus: 'active',
        phases: { 1: makePhaseRecord(1) },
        ownerSessionId: undefined,
      }))

      const result = parseResult(await handler.handle(
        'phase_enter',
        JSON.stringify({ phase: 2 }),
        CONTEXT,
      ))
      // With no ownerSessionId, the ownership check is skipped.
      // The transition may still fail for other reasons (phase 1 not complete),
      // but it should NOT fail with an ownership mismatch.
      if (!result.ok && 'violation' in result) {
        expect(result.violation).not.toContain('owner_mismatch')
        expect(result.violation).not.toContain('belongs to another session')
      }
    })

    // ── TC-C-32: Owner session checkpoint → allowed ─────────────────────────
    it('TC-C-32: Owner session can perform checkpoints', async () => {
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      localObserver.isDegraded.mockReturnValue(true)

      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(localStore, STALE_THRESHOLD_MS, localCache, localObserver)

      // Owner creates pipeline
      const ownerCtx = { worktree: WORKTREE, sessionID: 'sess-owner' }
      const startResult = parseResult(await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), ownerCtx))
      expect(startResult.ok).toBe(true)

      // Owner advances phase — should succeed
      const enterResult = parseResult(await localHandler.handle('phase_enter', JSON.stringify({ phase: 1 }), ownerCtx))
      expect(enterResult.ok).toBe(true)
    })

    // ── TC-C-33: Sub-agent checkpoint → rejected ────────────────────────────
    it('TC-C-33: Sub-agent checkpoint rejected with guidance', async () => {
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      localObserver.isDegraded.mockReturnValue(true)

      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(localStore, STALE_THRESHOLD_MS, localCache, localObserver)

      // Owner creates pipeline
      const ownerCtx = { worktree: WORKTREE, sessionID: 'sess-orchestrator' }
      await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), ownerCtx)

      // Sub-agent tries to advance phase
      const subAgentCtx = { worktree: WORKTREE, sessionID: 'sess-sub-agent' }
      const result = parseResult(await localHandler.handle(
        'phase_enter',
        JSON.stringify({ phase: 1 }),
        subAgentCtx,
      ))

      expect(result.ok).toBe(false)
      expect(result.violation).toContain('belongs to another session')
      expect(result.guidance).toBeDefined()
    })

    // ── TC-C-35: Audit BLOCK logged on owner_mismatch ──────────────────────
    it('TC-C-35: Owner mismatch logged as audit BLOCK', async () => {
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      localObserver.isDegraded.mockReturnValue(true)

      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(localStore, STALE_THRESHOLD_MS, localCache, localObserver)

      // Owner creates pipeline
      const ownerCtx = { worktree: WORKTREE, sessionID: 'sess-orchestrator' }
      await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), ownerCtx)

      // Sub-agent attempts checkpoint
      const subAgentCtx = { worktree: WORKTREE, sessionID: 'sess-sub-agent' }
      await localHandler.handle('phase_enter', JSON.stringify({ phase: 1 }), subAgentCtx)

      expect(localStore.appendAudit).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.any(String),
        expect.objectContaining({
          decision: 'BLOCK',
          violation: expect.stringContaining('owner_mismatch'),
        }),
      )
    })

    // ── TC-C-39: pipeline_start with empty sessionID → rejected ─────────────
    it('TC-C-39: pipeline_start with empty sessionID rejected', async () => {
      const emptyCtx = { worktree: WORKTREE, sessionID: '' }
      const result = parseResult(await handler.handle(
        'pipeline_start',
        JSON.stringify({ description: 'test' }),
        emptyCtx,
      ))

      expect(result.ok).toBe(false)
      expect(result.violation).toBeDefined()
    })

    // ── TC-C-40: Ownership check runs before stale check (C-1 defense) ────
    it('TC-C-40: Non-owner rejected on stale pipeline without seeing recovery prompt', async () => {
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      localObserver.isDegraded.mockReturnValue(true)

      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(localStore, STALE_THRESHOLD_MS, localCache, localObserver)

      // Owner creates pipeline
      const ownerCtx = { worktree: WORKTREE, sessionID: 'sess-orchestrator' }
      await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), ownerCtx)

      // Make the pipeline stale by writing a very old lastCheckpointAt
      const activeRun = activeRuns.get(PROJECT_ID)
      const state = states.get(`${PROJECT_ID}/${activeRun.runId}`)
      state.lastCheckpointAt = '2020-01-01T00:00:00.000Z' // 6 years ago

      // Sub-agent tries phase_enter on the stale pipeline
      const subAgentCtx = { worktree: WORKTREE, sessionID: 'sess-sub-agent' }
      const result = parseResult(await localHandler.handle(
        'phase_enter',
        JSON.stringify({ phase: 1 }),
        subAgentCtx,
      ))

      // Must be ownership rejection, NOT stale recovery prompt
      expect(result.ok).toBe(false)
      expect(result.violation).toContain('belongs to another session')
      expect(result).not.toHaveProperty('recovery')
    })

    // ── TC-C-41: Sub-agent pipeline_start rejected on non-stale active pipeline ──
    it('TC-C-41: Sub-agent pipeline_start rejected on non-stale active pipeline', async () => {
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      localObserver.isDegraded.mockReturnValue(true)

      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(localStore, STALE_THRESHOLD_MS, localCache, localObserver)

      // Owner creates pipeline
      const ownerCtx = { worktree: WORKTREE, sessionID: 'sess-orchestrator' }
      await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), ownerCtx)

      // Sub-agent tries pipeline_start — should be rejected (non-stale, active)
      const subAgentCtx = { worktree: WORKTREE, sessionID: 'sess-sub-agent' }
      const result = parseResult(await localHandler.handle(
        'pipeline_start',
        JSON.stringify({ description: 'hijack' }),
        subAgentCtx,
      ))

      expect(result.ok).toBe(false)
      expect(result.violation).toContain('already active')
    })

    // ── TC-C-42: Sub-agent pipeline_start rejected on stale pipeline (ownership) ──
    it('TC-C-42: Sub-agent pipeline_start rejected on stale pipeline (ownership)', async () => {
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      localObserver.isDegraded.mockReturnValue(true)

      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(localStore, STALE_THRESHOLD_MS, localCache, localObserver)

      // Owner creates pipeline
      const ownerCtx = { worktree: WORKTREE, sessionID: 'sess-orchestrator' }
      await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), ownerCtx)

      // Make pipeline stale
      const activeRun = activeRuns.get(PROJECT_ID)
      const state = states.get(`${PROJECT_ID}/${activeRun.runId}`)
      state.lastCheckpointAt = '2020-01-01T00:00:00.000Z'

      // Sub-agent tries pipeline_start on stale pipeline — should be rejected (ownership)
      const subAgentCtx = { worktree: WORKTREE, sessionID: 'sess-sub-agent' }
      const result = parseResult(await localHandler.handle(
        'pipeline_start',
        JSON.stringify({ description: 'hijack' }),
        subAgentCtx,
      ))

      expect(result.ok).toBe(false)
      expect(result.violation).toContain('belongs to another session')
    })

    // ── TC-C-43: Owner can restart own stale pipeline ──
    it('TC-C-43: Owner can restart own stale pipeline', async () => {
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      localObserver.isDegraded.mockReturnValue(true)

      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(localStore, STALE_THRESHOLD_MS, localCache, localObserver)

      const ownerCtx = { worktree: WORKTREE, sessionID: 'sess-orchestrator' }
      await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), ownerCtx)

      // Make pipeline stale
      const activeRun = activeRuns.get(PROJECT_ID)
      const state = states.get(`${PROJECT_ID}/${activeRun.runId}`)
      state.lastCheckpointAt = '2020-01-01T00:00:00.000Z'

      // Owner restarts — should succeed
      const result = parseResult(await localHandler.handle(
        'pipeline_start',
        JSON.stringify({ description: 'restart' }),
        ownerCtx,
      ))

      expect(result.ok).toBe(true)
    })
  })

  // ── Semantic Assertion Tests (SA) ────────────────────────────────────

  describe('design semantic assertions', () => {
    // ── SA-1: phase_complete(5) calls observer.clearDegradation ─────────
    it('SA-1: phase_complete(5) calls observer.clearDegradation', async () => {
      // Need fresh handler with observer attached — reset store state first
      const localStore = createMockStore()
      const localCache = createMockCache()
      const localObserver = createMockObserver()
      // Degraded observer skips AC-2 observation checks so we can walk the pipeline
      // without wiring up reviewer-spawn observations.
      localObserver.isDegraded.mockReturnValue(true)

      // Wire up real storage behavior
      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.clearActiveRun.mockImplementation((pid: string) => activeRuns.delete(pid))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))

      const localHandler = new CheckpointHandler(
        localStore, STALE_THRESHOLD_MS, localCache, localObserver,
      )

      await localHandler.handle('pipeline_start', JSON.stringify({ description: 'test' }), CONTEXT)
      for (let phase = 1; phase <= 5; phase++) {
        await localHandler.handle('phase_enter', JSON.stringify({ phase }), CONTEXT)
        await localHandler.handle('ralph_loop_start', JSON.stringify({ phase }), CONTEXT)
        // Two zero-tally rounds to satisfy early_stop termination requirement
        await localHandler.handle('ralph_round_complete', JSON.stringify({
          phase, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
        }), CONTEXT)
        await localHandler.handle('ralph_round_complete', JSON.stringify({
          phase, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
        }), CONTEXT)
        await localHandler.handle('ralph_terminate', JSON.stringify({
          phase, termination: 'early_stop',
        }), CONTEXT)
        await localHandler.handle('user_approval', JSON.stringify({ phase, approved: true }), CONTEXT)
        // test_evidence payload requires phase === 4 and a non-empty evidence_file
        if (phase === 4) {
          await localHandler.handle('test_evidence', JSON.stringify({ phase: 4, evidence_file: 'test.log' }), CONTEXT)
        }
        // Complete phases 1-4 so the next phase_enter is allowed
        if (phase < 5) {
          await localHandler.handle('phase_complete', JSON.stringify({ phase }), CONTEXT)
        }
      }

      const result = await localHandler.handle('phase_complete', JSON.stringify({ phase: 5 }), CONTEXT)
      expect(parseResult(result).ok).toBe(true)

      expect(localObserver.clearDegradation).toHaveBeenCalledWith(PROJECT_ID, expect.any(String))
    })

    // ── SA-2: why_articulation failure records audit decision PASS ──────
    it('SA-2: why_articulation failure records audit PASS (state was written)', async () => {
      const localObserver = createMockObserver()
      const localCache = createMockCache()
      // Use fresh store to avoid state leakage; wire up real Map-backed storage
      const localStore = createMockStore()
      const activeRuns = new Map<string, any>()
      const states = new Map<string, any>()
      localStore.getActiveRun.mockImplementation((pid: string) => activeRuns.get(pid) ?? null)
      localStore.setActiveRun.mockImplementation((pid: string, run: any) => activeRuns.set(pid, run))
      localStore.clearActiveRun.mockImplementation((pid: string) => activeRuns.delete(pid))
      localStore.readState.mockImplementation((pid: string, rid: string) => states.get(`${pid}/${rid}`) ?? null)
      localStore.writeState.mockImplementation((pid: string, rid: string, state: any) => states.set(`${pid}/${rid}`, state))
      localStore.appendAudit.mockImplementation(() => {})

      const handler = new CheckpointHandler(
        localStore, STALE_THRESHOLD_MS, localCache, localObserver,
      )

      // Setup pipeline: pipeline_start → phase_enter(1) leaves phaseStatus='active'
      await handler.handle('pipeline_start', JSON.stringify({ description: 'test' }), CONTEXT)
      await handler.handle('phase_enter', JSON.stringify({ phase: 1 }), CONTEXT)

      // Clear audit history so we only see the why_articulation audit
      localStore.appendAudit.mockClear()

      // Call why_articulation with insufficient text
      const result = await handler.handle(
        'why_articulation',
        JSON.stringify({ phase: 1, articulation: 'too short' }),
        CONTEXT,
      )
      const parsed = parseResult(result)
      expect(parsed.ok).toBe(false) // articulation content failed

      // Audit must record PASS — state was written (Phase 1 invariant: PASS = state written)
      // Use toHaveBeenCalledWith on the cleared mock so only why_articulation's audit is checked
      expect(localStore.appendAudit).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.any(String),
        expect.objectContaining({ decision: 'PASS' }),
      )
    })
  })
})
