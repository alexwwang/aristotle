/**
 * Integration Tests Phase 2 — TC-I-01 through TC-I-10
 *
 * End-to-end tests for CheckpointHandler + Observer + Interceptor + PipelineStateCache.
 * TDD Red phase — some tests may fail until source modules are updated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckpointResult } from '../src/schema.js'
import { CheckpointHandler } from '../src/checkpoint.js'
import { Observer } from '../src/observer.js'
import { Interceptor, WatchdogInterceptError } from '../src/interceptor.js'
import { PipelineStateCache } from '../src/state-cache.js'
import { SessionBuffer } from '../src/session-buffer.js'
import { extractFilePath } from '../src/path-extractor.js'
import { classifyFile } from '../src/file-classifier.js'
import { createRules } from '../src/intercept-rules.js'
import { FALLBACK_PATTERNS } from '../src/watchdog-config.js'
import { computeProjectId } from '../src/project-id.js'
import {
  makeState,
  makePhaseRecord,
  createMockStore,
  createMockCache,
  createMockObserver,
  createMockSessionBuffer,
  STALE_THRESHOLD_MS,
} from './helpers.js'
import { applyTransition } from '../src/transitions.js'

const WORKTREE = '/workspace/my-project'
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

// ═════════════════════════════════════════════════════════════════════════════
//  Integration Tests Phase 2
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration Tests Phase 2', () => {
  let mockStore: ReturnType<typeof createMockStore>
  let mockCache: ReturnType<typeof createMockCache>
  let mockObserver: ReturnType<typeof createMockObserver>

  beforeEach(() => {
    mockStore = createMockStore()
    mockCache = createMockCache()
    mockObserver = createMockObserver()

    // Wire up Map-backed synchronous storage (same pattern as checkpoint-phase2.test.ts)
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
  })

  // ── TC-I-01: Full pipeline with observations ──────────────────────────────
  it('TC-I-01: Full pipeline with observations', async () => {
    // Use real Observer + real SessionBuffer + real PipelineStateCache
    const sessionBuffer = new SessionBuffer({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any)
    const cache = new PipelineStateCache(mockStore as any, WORKTREE, undefined, false)
    const observer = new Observer(cache, sessionBuffer, mockStore as any)
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, cache, observer)

    // Start pipeline
    let result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'integration test' }), CONTEXT))
    expect(result.ok).toBe(true)

    const runId = getLastWrittenState(mockStore).runId

    // Phase 1
    result = parseResult(await handler.handle('phase_enter', JSON.stringify({ phase: 1 }), CONTEXT))
    expect(result.ok).toBe(true)

    result = parseResult(await handler.handle('ralph_loop_start', JSON.stringify({ phase: 1 }), CONTEXT))
    expect(result.ok).toBe(true)

    // Simulate Task tool call during ralph_loop round 1 → observer records observation
    await observer.handle('Task', { prompt: 'review' }, 'out', SESSION_ID, 'call-1')

    // Round 1 complete
    result = parseResult(await handler.handle('ralph_round_complete', JSON.stringify({
      phase: 1, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), CONTEXT))
    expect(result.ok).toBe(true)

    // Simulate Task tool call during ralph_loop round 2
    await observer.handle('Task', { prompt: 'review' }, 'out', SESSION_ID, 'call-2')

    // Round 2 complete (early_stop after 2 consecutive zero rounds)
    result = parseResult(await handler.handle('ralph_round_complete', JSON.stringify({
      phase: 1, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), CONTEXT))
    expect(result.ok).toBe(true)

    // Terminate
    result = parseResult(await handler.handle('ralph_terminate', JSON.stringify({
      phase: 1, termination: 'early_stop',
    }), CONTEXT))
    expect(result.ok).toBe(true)

    // Approval
    result = parseResult(await handler.handle('user_approval', JSON.stringify({ phase: 1 }), CONTEXT))
    expect(result.ok).toBe(true)

    // Complete phase 1
    result = parseResult(await handler.handle('phase_complete', JSON.stringify({ phase: 1 }), CONTEXT))
    expect(result.ok).toBe(true)

    // Verify observations exist for Task calls
    const obs = mockStore.readObservations(PROJECT_ID, runId)
    expect(obs.length).toBeGreaterThanOrEqual(2)
    expect(obs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: '_reviewer_spawned', round: 1 }),
      expect.objectContaining({ type: '_reviewer_spawned', round: 2 }),
    ]))

    // Phase 2 (simplified)
    result = parseResult(await handler.handle('phase_enter', JSON.stringify({ phase: 2 }), CONTEXT))
    expect(result.ok).toBe(true)

    result = parseResult(await handler.handle('ralph_loop_start', JSON.stringify({ phase: 2 }), CONTEXT))
    expect(result.ok).toBe(true)

    // Early stop in one round (simplified)
    await observer.handle('Task', { prompt: 'review' }, 'out', SESSION_ID, 'call-3')
    result = parseResult(await handler.handle('ralph_round_complete', JSON.stringify({
      phase: 2, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), CONTEXT))
    expect(result.ok).toBe(true)

    await observer.handle('Task', { prompt: 'review' }, 'out', SESSION_ID, 'call-4')
    result = parseResult(await handler.handle('ralph_round_complete', JSON.stringify({
      phase: 2, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), CONTEXT))
    expect(result.ok).toBe(true)

    result = parseResult(await handler.handle('ralph_terminate', JSON.stringify({
      phase: 2, termination: 'early_stop',
    }), CONTEXT))
    expect(result.ok).toBe(true)

    result = parseResult(await handler.handle('user_approval', JSON.stringify({ phase: 2 }), CONTEXT))
    expect(result.ok).toBe(true)

    result = parseResult(await handler.handle('phase_complete', JSON.stringify({ phase: 2 }), CONTEXT))
    expect(result.ok).toBe(true)

    const finalState = getLastWrittenState(mockStore)
    expect(finalState.currentPhase).toBe(2)
    expect(finalState.phaseStatus).toBe('complete')
  })

  // ── TC-I-02: Articulation full cycle ──────────────────────────────────────
  it('TC-I-02: Articulation full cycle', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)

    // Setup active pipeline at phase 1
    mockStore._setActiveRun(PROJECT_ID, { runId: 'run-001', projectId: PROJECT_ID, startedAt: NOW })
    mockStore._setState(PROJECT_ID, 'run-001', makeState({
      runId: 'run-001',
      currentPhase: 1,
      phaseStatus: 'active',
      phases: { 1: makePhaseRecord(1) },
    }))

    // 1) Bad articulation → ok=false, guidance present, audit PASS
    const badPayload = JSON.stringify({ phase: 1, articulation: 'Too short.' })
    let result = parseResult(await handler.handle('why_articulation' as any, badPayload, CONTEXT))
    expect(result.ok).toBe(false)
    if (!result.ok && 'violation' in result) {
      expect(result.guidance).toBeTruthy()
    }

    // Verify articulationAttempted=true, articulationVerified=false
    let state = getLastWrittenState(mockStore)
    expect(state.phases[1].articulationAttempted).toBe(true)
    expect(state.phases[1].articulationVerified).toBe(false)

    // Audit PASS recorded
    const audits = mockStore._getAudits(PROJECT_ID, 'run-001')
    const articulationAudits = audits.filter((a: any) => a.event === 'why_articulation')
    expect(articulationAudits.length).toBeGreaterThanOrEqual(1)
    expect(articulationAudits[articulationAudits.length - 1].decision).toBe('PASS')

    // Feed state forward for second attempt
    mockStore._setState(PROJECT_ID, 'run-001', makeState({
      runId: 'run-001',
      currentPhase: 1,
      phaseStatus: 'active',
      phases: { 1: { ...makePhaseRecord(1), articulationAttempted: true, articulationVerified: false } },
    }))

    // 2) Good articulation → ok=true
    const goodPayload = JSON.stringify({
      phase: 1,
      articulation: 'This protects user data from unauthorized access. Key risks include XSS injection and SQL injection. The approach works because input validation ensures only safe data reaches the database.',
    })
    result = parseResult(await handler.handle('why_articulation' as any, goodPayload, CONTEXT))
    expect(result.ok).toBe(true)

    // Verify articulationVerified transitions false→true
    state = getLastWrittenState(mockStore)
    expect(state.phases[1].articulationVerified).toBe(true)
    expect(state.phases[1].articulationAttempted).toBe(true)
  })

  // ── TC-I-03: Interceptor block -> address -> retry ────────────────────────
  it('TC-I-03: Interceptor block -> address -> retry', async () => {
    // Shared cache for interceptor and checkpoint handler
    const cache = new PipelineStateCache(mockStore as any, WORKTREE, undefined, false)
    const rules = createRules()
    const config = {
      worktreeRoot: WORKTREE,
      monitoredTools: ['edit', 'write'],
      phaseDeliverables: FALLBACK_PATTERNS,
      ignorePatterns: [],
    }
    const interceptor = new Interceptor(cache, config, extractFilePath, classifyFile, rules)
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, cache, mockObserver)
    mockObserver.isDegraded.mockReturnValue(true)

    // Setup: start pipeline, advance to phase 4
    let result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'TC-I-03' }), CONTEXT))
    expect(result.ok).toBe(true)

    // Fast-forward through phases 1-3
    for (let phase = 1; phase <= 3; phase++) {
      await handler.handle('phase_enter', JSON.stringify({ phase }), CONTEXT)
      await handler.handle('ralph_loop_start', JSON.stringify({ phase }), CONTEXT)
      await handler.handle('ralph_round_complete', JSON.stringify({
        phase, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
      }), CONTEXT)
      await handler.handle('ralph_round_complete', JSON.stringify({
        phase, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
      }), CONTEXT)
      await handler.handle('ralph_terminate', JSON.stringify({
        phase, termination: 'early_stop',
      }), CONTEXT)
      await handler.handle('user_approval', JSON.stringify({ phase }), CONTEXT)
      if (phase < 3) {
        await handler.handle('phase_complete', JSON.stringify({ phase }), CONTEXT)
      }
    }

    // Complete phase 3
    result = parseResult(await handler.handle('phase_complete', JSON.stringify({ phase: 3 }), CONTEXT))
    expect(result.ok).toBe(true)

    // Enter Phase 4
    result = parseResult(await handler.handle('phase_enter', JSON.stringify({ phase: 4 }), CONTEXT))
    expect(result.ok).toBe(true)

    // Step 1: edit on business code in Phase 4 → should throw (unconditional block)
    await expect(
      interceptor.handle('edit', { filePath: `${WORKTREE}/src/app.ts` }, SESSION_ID, 'call-i03-1'),
    ).rejects.toThrow(WatchdogInterceptError)

    // Step 2: Complete Phase 4 Ralph loop + user approval
    await handler.handle('ralph_loop_start', JSON.stringify({ phase: 4 }), CONTEXT)
    await handler.handle('ralph_round_complete', JSON.stringify({
      phase: 4, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), CONTEXT)
    await handler.handle('ralph_round_complete', JSON.stringify({
      phase: 4, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), CONTEXT)
    await handler.handle('ralph_terminate', JSON.stringify({
      phase: 4, termination: 'early_stop',
    }), CONTEXT)
    await handler.handle('user_approval', JSON.stringify({ phase: 4 }), CONTEXT)
    await handler.handle('phase_complete', JSON.stringify({ phase: 4 }), CONTEXT)

    // Step 3: Enter Phase 5
    result = parseResult(await handler.handle('phase_enter', JSON.stringify({ phase: 5 }), CONTEXT))
    expect(result.ok).toBe(true)

    // Step 4: retry edit in Phase 5 → should succeed (Phase 4 gate passed)
    await expect(
      interceptor.handle('edit', { filePath: `${WORKTREE}/src/app.ts` }, SESSION_ID, 'call-i03-2'),
    ).resolves.toBeUndefined()
  })

  // ── TC-I-04: Multi-agent ownership ────────────────────────────────────────
  it('TC-I-04: Multi-agent ownership', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)
    mockObserver.isDegraded.mockReturnValue(true)

    // Step 1: owner starts pipeline
    const ownerCtx = { worktree: WORKTREE, sessionID: 'owner' }
    let result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'owner run' }), ownerCtx))
    expect(result.ok).toBe(true)

    // Step 2: sub-agent tries to use checkpoint → rejected
    const subCtx = { worktree: WORKTREE, sessionID: 'sub-agent' }
    result = parseResult(await handler.handle('phase_enter', JSON.stringify({ phase: 1 }), subCtx))
    expect(result.ok).toBe(false)
    if (!result.ok && 'violation' in result) {
      expect(result.violation).toContain('belongs to another session')
    }

    // Step 3: owner continues → allowed
    result = parseResult(await handler.handle('phase_enter', JSON.stringify({ phase: 1 }), ownerCtx))
    expect(result.ok).toBe(true)
  })

  // ── TC-I-05: Adaptive cache single-agent ──────────────────────────────────
  it('TC-I-05: Adaptive cache single-agent', () => {
    const store = createMockStore()
    const expectedState = makeState({ runId: 'run-cache-test' })

    // Single-agent mode (multiAgent=false)
    const cache = new PipelineStateCache(store as any, WORKTREE, undefined, false)

    // Single-agent mode lazy-loads from disk on first get() (§5.1 ensurePopulated)
    // No active run → returns null, store was queried once
    expect(cache.get()).toBeNull()
    expect(store.getActiveRun).toHaveBeenCalledTimes(1)

    // Second get() does NOT re-read disk (already populated)
    store.getActiveRun.mockClear()
    expect(cache.get()).toBeNull()
    expect(store.getActiveRun).not.toHaveBeenCalled()

    // After update(), get() returns cached value without additional store read
    cache.update(expectedState as any)
    store.getActiveRun.mockClear()
    expect(cache.get()).toEqual(expectedState)
    expect(store.getActiveRun).not.toHaveBeenCalled()
  })

  // ── TC-I-06: Adaptive cache multi-agent ───────────────────────────────────
  it('TC-I-06: Adaptive cache multi-agent', () => {
    const store = createMockStore()
    const state1 = makeState({ runId: 'run-1', currentPhase: 2 })
    store.getActiveRun.mockReturnValue({ runId: 'run-1', projectId: PROJECT_ID, startedAt: NOW })
    store.readState.mockReturnValue(state1)

    // Multi-agent mode
    const cache = new PipelineStateCache(store as any, WORKTREE, undefined, true)

    // Every get() reads from store
    expect(cache.get()).toEqual(state1)
    expect(store.getActiveRun).toHaveBeenCalledTimes(1)
    expect(store.readState).toHaveBeenCalledTimes(1)

    // Simulate state change on disk
    const state2 = makeState({ runId: 'run-1', currentPhase: 3 })
    store.readState.mockReturnValue(state2)

    // Next get() should reflect the new disk state
    expect(cache.get()).toEqual(state2)
    expect(store.getActiveRun).toHaveBeenCalledTimes(2)
    expect(store.readState).toHaveBeenCalledTimes(2)
  })

  // ── TC-I-07: Cache update on checkpoint ───────────────────────────────────
  it('TC-I-07: Cache update on checkpoint', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)
    mockObserver.isDegraded.mockReturnValue(true)

    await handler.handle('pipeline_start', JSON.stringify({ description: 'cache test' }), CONTEXT)
    await handler.handle('phase_enter', JSON.stringify({ phase: 1 }), CONTEXT)

    // Verify cache.update was called after writeState
    expect(mockCache.update).toHaveBeenCalled()
    // writeState should have been called before or at the same time as update
    const writeCalls = mockStore.writeState.mock.calls.length
    const updateCalls = mockCache.update.mock.calls.length
    expect(updateCalls).toBeGreaterThanOrEqual(1)
    expect(writeCalls).toBeGreaterThanOrEqual(updateCalls)
  })

  // ── TC-I-08: Cache clear on completion ────────────────────────────────────
  it('TC-I-08: Cache clear on completion', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)
    mockObserver.isDegraded.mockReturnValue(true)

    await handler.handle('pipeline_start', JSON.stringify({ description: 'completion test' }), CONTEXT)

    for (let phase = 1; phase <= 5; phase++) {
      await handler.handle('phase_enter', JSON.stringify({ phase }), CONTEXT)
      await handler.handle('ralph_loop_start', JSON.stringify({ phase }), CONTEXT)
      await handler.handle('ralph_round_complete', JSON.stringify({
        phase, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
      }), CONTEXT)
      await handler.handle('ralph_round_complete', JSON.stringify({
        phase, round: 2, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
      }), CONTEXT)
      await handler.handle('ralph_terminate', JSON.stringify({
        phase, termination: 'early_stop',
      }), CONTEXT)
      await handler.handle('user_approval', JSON.stringify({ phase }), CONTEXT)
      if (phase === 4) {
        await handler.handle('test_evidence', JSON.stringify({
          phase: 4, evidence_file: 'test.log',
        }), CONTEXT)
      }
      if (phase < 5) {
        await handler.handle('phase_complete', JSON.stringify({ phase }), CONTEXT)
      }
    }

    // Phase 5 complete → cache.clear() called
    const result = parseResult(await handler.handle('phase_complete', JSON.stringify({ phase: 5 }), CONTEXT))
    expect(result.ok).toBe(true)
    expect(mockCache.clear).toHaveBeenCalled()
  })

  // ── TC-I-09: Observer + AC-2 cycle ────────────────────────────────────────
  it('TC-I-09: Observer + AC-2 cycle', async () => {
    const sessionBuffer = new SessionBuffer({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any)
    const cache = new PipelineStateCache(mockStore as any, WORKTREE, undefined, false)
    const observer = new Observer(cache, sessionBuffer, mockStore as any)
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, cache, observer)

    // Setup pipeline in ralph_loop
    await handler.handle('pipeline_start', JSON.stringify({ description: 'ac2 test' }), CONTEXT)
    await handler.handle('phase_enter', JSON.stringify({ phase: 1 }), CONTEXT)
    await handler.handle('ralph_loop_start', JSON.stringify({ phase: 1 }), CONTEXT)

    const runId = getLastWrittenState(mockStore).runId

    // Simulate Task tool call → observer records _reviewer_spawned
    await observer.handle('Task', { prompt: 'review code' }, 'output', SESSION_ID, 'call-ac2-1')

    // Verify observation was recorded
    const obsBefore = mockStore.findObservations(PROJECT_ID, runId, { type: '_reviewer_spawned', round: 1 })
    expect(obsBefore.length).toBeGreaterThanOrEqual(1)

    // ralph_round_complete → AC-2 check passes because observation exists
    const result = parseResult(await handler.handle('ralph_round_complete', JSON.stringify({
      phase: 1, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 },
    }), CONTEXT))
    expect(result.ok).toBe(true)
  })

  // ── TC-I-10: Custom monitoredTools ────────────────────────────────────────
  it('TC-I-10: Custom monitoredTools', async () => {
    const localCache = createMockCache()
    const config = {
      worktreeRoot: WORKTREE,
      monitoredTools: ['edit', 'write', 'custom_edit'],
      phaseDeliverables: FALLBACK_PATTERNS,
      ignorePatterns: [],
    }
    const rules = createRules()
    const interceptor = new Interceptor(localCache, config, extractFilePath, classifyFile, rules)

    // Set state to Phase 4 with no test evidence
    localCache.get.mockReturnValue(makeState({
      currentPhase: 4,
      testEvidenceConfirmed: false,
      phases: { 4: makePhaseRecord(4) },
    }))

    // custom_edit should be intercepted (not skipped as unknown tool)
    await expect(
      interceptor.handle('custom_edit', { filePath: `${WORKTREE}/src/app.ts` }, SESSION_ID, 'call-i10-1'),
    ).rejects.toThrow(WatchdogInterceptError)

    // Verify it was processed by checking the error message
    try {
      await interceptor.handle('custom_edit', { filePath: `${WORKTREE}/src/app.ts` }, SESSION_ID, 'call-i10-2')
      expect.fail('should have thrown')
    } catch (err: any) {
      expect(err).toBeInstanceOf(WatchdogInterceptError)
      expect(err.message).toContain('business code write blocked')
    }
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  TC-I-11 through TC-I-18
  // ═══════════════════════════════════════════════════════════════════════════

  // ── TC-I-11: Pipeline completes without articulation (AC-6 soft gate) ──────
  it('TC-I-11: pipeline completes without articulation', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)

    // Start pipeline
    const result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'test' }), CONTEXT))
    expect(result.ok).toBe(true)
    let state = getLastWrittenState(mockStore)
    expect(state).not.toBeNull()

    // Phase 1: enter → ralph loop → round → terminate → approve → complete
    await handler.handle('phase_enter', JSON.stringify({ phase: 1 }), CONTEXT)
    await handler.handle('ralph_loop_start', JSON.stringify({ phase: 1 }), CONTEXT)

    // Add reviewer observation for AC-2
    mockStore._addObservation(PROJECT_ID, state.runId, { type: '_reviewer_spawned', tool: 'Task', callID: 'call-001', round: 1 })

    await handler.handle('ralph_round_complete', JSON.stringify({ phase: 1, round: 1, tally: { C: 0, H: 0, M: 0, L: 0, I: 0 } }), CONTEXT)
    await handler.handle('ralph_terminate', JSON.stringify({ phase: 1, termination: 'gate_pass' }), CONTEXT)
    await handler.handle('user_approval', JSON.stringify({ phase: 1 }), CONTEXT)
    await handler.handle('phase_complete', JSON.stringify({ phase: 1 }), CONTEXT)

    state = getLastWrittenState(mockStore)
    // No articulation was called — both fields remain false
    expect(state.phases[1].articulationAttempted).toBe(false)
    expect(state.phases[1].articulationVerified).toBe(false)
  })

  // TC-I-12 and TC-I-14 may already exist in checkpoint-phase2.test.ts — skip if so

  // ── TC-I-13: pipeline_start deterministic timestamp/ID injection ──────────
  it('TC-I-13: pipeline_start deterministic timestamp/ID injection', async () => {
    const newState = applyTransition('pipeline_start',
      { description: 'test', _now: '2026-06-01T00:00:00Z', _runId: 'run-deterministic', _ownerSessionId: SESSION_ID, _projectId: PROJECT_ID },
      null)

    expect(newState.startedAt).toBe('2026-06-01T00:00:00Z')
    expect(newState.runId).toBe('run-deterministic')
  })

  // ── TC-I-15: Stale pipeline — owner can restart ──────────────────────────
  it('TC-I-15: stale pipeline — owner can restart', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)
    const staleTime = new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString()
    mockStore._setActiveRun(PROJECT_ID, { runId: 'run-stale', projectId: PROJECT_ID, startedAt: staleTime })
    mockStore._setState(PROJECT_ID, 'run-stale', makeState({
      runId: 'run-stale',
      startedAt: staleTime,
      lastCheckpointAt: staleTime,
      ownerSessionId: SESSION_ID,
    }))

    const result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'restart' }), CONTEXT))
    expect(result.ok).toBe(true)
    const state = getLastWrittenState(mockStore)
    expect(state).not.toBeNull()
    expect(state.runId).not.toBe('run-stale') // new pipeline created
  })

  // ── TC-I-16: Stale pipeline — non-owner rejected ─────────────────────────
  it('TC-I-16: stale pipeline — non-owner rejected', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)
    const staleTime = new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString()
    mockStore._setActiveRun(PROJECT_ID, { runId: 'run-stale', projectId: PROJECT_ID, startedAt: staleTime })
    mockStore._setState(PROJECT_ID, 'run-stale', makeState({
      runId: 'run-stale',
      startedAt: staleTime,
      lastCheckpointAt: staleTime,
      ownerSessionId: 'sess-original',
    }))

    const otherContext = { worktree: WORKTREE, sessionID: 'sess-other' }
    const result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'hijack' }), otherContext))
    expect(result.ok).toBe(false)
  })

  // ── TC-I-17: Corrupted state — active run exists but state unreadable ────
  it('TC-I-17: corrupted state — fail-closed', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)
    mockStore._setActiveRun(PROJECT_ID, { runId: 'run-corrupt', projectId: PROJECT_ID, startedAt: NOW })
    // State is null (corrupted) but activeRun exists
    mockStore._setState(PROJECT_ID, 'run-corrupt', null)

    const result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'test' }), CONTEXT))
    expect(result.ok).toBe(false)
  })

  // ── TC-I-18: Non-stale active pipeline — owner also rejected ─────────────
  it('TC-I-18: non-stale active pipeline — owner also rejected', async () => {
    const handler = new CheckpointHandler(mockStore as any, STALE_THRESHOLD_MS, mockCache, mockObserver)
    mockStore._setActiveRun(PROJECT_ID, { runId: 'run-active', projectId: PROJECT_ID, startedAt: NOW })
    mockStore._setState(PROJECT_ID, 'run-active', makeState({
      runId: 'run-active',
      startedAt: NOW,
      ownerSessionId: SESSION_ID,
    }))

    const result = parseResult(await handler.handle('pipeline_start', JSON.stringify({ description: 'duplicate' }), CONTEXT))
    expect(result.ok).toBe(false)
  })
})
