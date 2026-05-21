import { describe, it, expect } from 'vitest'
import { CheckpointHandler } from '../src/checkpoint.js'
import { applyTransition, validateTransition } from '../src/transitions.js'
import { createRules } from '../src/intercept-rules.js'
import {
  createMockStore,
  createMockCache,
  createMockObserver,
  createMockLoopConfig,
  makeStateWithConfig,
  makePhaseRecord,
  VALID_CONFIG_MAP,
  mockClassification,
} from './helpers.js'

// ─── Constructor: loopConfig injection (DC-14) ───────────────────────────
// NOTE: All tests inline their own CheckpointHandler construction to ensure
// each test has full control over mock setup and can verify store calls independently.

describe('CheckpointHandler constructor — loopConfig injection', () => {
  it('should inject loopPhaseMap into pipeline_start via handle()', async () => {
    // Per Tech Solution §D.2: constructor receives LoopConfigResult as 3rd param.
    // Per §D.2 Change 1: handle() injects _loopPhaseMap/_maxPhase into pipeline_start payload.
    // This test verifies the full chain: constructor stores loopConfig → handle injects it.
    const loopConfig = createMockLoopConfig({ maxPhase: 7 })
    const store = createMockStore()
    const cache = createMockCache()
    const observer = createMockObserver()
    // Phase 5: constructor accepts loopConfig as 3rd param.
    // After Phase 5: CheckpointHandler(store, staleThresholdMs, loopConfig, cache, observer)
    const handler = new CheckpointHandler(store, 300_000, loopConfig, cache, observer)

    // Call handle('pipeline_start', ...) and verify loopPhaseMap is injected
    const payload = JSON.stringify({
      description: 'test',
      totalPhases: 7,
      _projectId: 'test-proj',
      _runId: 'test-run',
    })
    await handler.handle('pipeline_start', payload, { worktree: '/test', sessionID: 's1' })

    // Verify writeState was called with loopPhaseMap in the new state
    expect(store.writeState).toHaveBeenCalled()
    const writtenState = store.writeState.mock.calls[0][2] as Record<string, unknown>
    // Phase 5: handle() injects loopPhaseMap from loopConfig.
    expect(writtenState.loopPhaseMap).toEqual(VALID_CONFIG_MAP)
    expect(writtenState.maxPhase).toBe(7)
  })

  it('should use empty loopPhaseMap for default config', async () => {
    const defaultConfig = { loopPhaseMap: {} as Record<number, never>, maxPhase: undefined }
    const store = createMockStore()
    const cache = createMockCache()
    const observer = createMockObserver()
    const handler = new CheckpointHandler(store, 300_000, defaultConfig, cache, observer)

    await handler.handle('pipeline_start', JSON.stringify({
      description: 'test',
      totalPhases: 5,
      _projectId: 'test-proj',
      _runId: 'test-run',
    }), { worktree: '/test', sessionID: 's1' })

    const writtenState = store.writeState.mock.calls[0][2] as Record<string, unknown>
    expect(writtenState.loopPhaseMap).toEqual({})
    // Per Tech Solution §B.3: maxPhase = payload._maxPhase ?? totalPhases
    // When maxPhase is undefined (missing config), should fall back to totalPhases
    expect(writtenState.maxPhase).toBe(5)
  })
})

// ─── Pipeline completion — archive trigger via effectiveMax ────────────────
// Tests the actual archive trigger at checkpoint.ts:365.
// Per Tech Solution §D.2 Change 2: `totalPhases` → `effectiveMax = maxPhase ?? totalPhases`.
// These tests drive CheckpointHandler.handle() end-to-end to verify archive fires
// at the correct phase boundary.

describe('pipeline completion — archive trigger uses effectiveMax', () => {
  it('should archive at maxPhase when maxPhase < totalPhases', async () => {
    // Pipeline with maxPhase=7 but totalPhases=9.
    // After completing phase 7 (=maxPhase), archive must fire even though 7 < 9.
    const loopConfig = createMockLoopConfig({ maxPhase: 7 })
    const store = createMockStore()
    const cache = createMockCache()
    const observer = createMockObserver()
    const handler = new CheckpointHandler(store, 300_000, loopConfig, cache, observer)

    // Step 1: pipeline_start with totalPhases=9
    await handler.handle('pipeline_start', JSON.stringify({
      description: 'test', totalPhases: 9, _projectId: 'p', _runId: 'r',
    }), { worktree: '/t', sessionID: 's1' })

    // Read the state that was written
    const startState = store.writeState.mock.calls[0][2] as Record<string, any>
    // Put it in the store for subsequent reads
    store.readState.mockReturnValue(startState)
    // MUST set getActiveRun so phase_complete can find the active run
    store.getActiveRun.mockReturnValue({ projectId: 'p', runId: startState.runId, startedAt: startState.startedAt })

    // Step 2: Simulate phases 1-7 all complete (ralph done + approved)
    startState.currentPhase = 7
    startState.phaseStatus = 'awaiting_approval'
    for (let i = 1; i <= 7; i++) {
      startState.phases[i] = {
        ...makePhaseRecord(i, { ralphCompleted: true, userApproved: true, approvedAt: 'now' }),
      }
    }

    // Step 3: phase_complete(7) — 7 === maxPhase, should trigger archive
    // even though 7 !== totalPhases(9)
    await handler.handle('phase_complete', JSON.stringify({ phase: 7 }),
      { worktree: '/t', sessionID: 's1' })

    // Phase 5: archive triggers at effectiveMax (maxPhase ?? totalPhases), not raw totalPhases.
    // so phase 7 !== 9 → archive NOT called. New code uses effectiveMax (7) → archive called.
    expect(store.archiveRun).toHaveBeenCalled()
  })

  it('should NOT archive before reaching maxPhase', async () => {
    // Same pipeline (maxPhase=7, totalPhases=9).
    // Completing phase 6 should NOT trigger archive.
    const loopConfig = createMockLoopConfig({ maxPhase: 7 })
    const store = createMockStore()
    const cache = createMockCache()
    const observer = createMockObserver()
    const handler = new CheckpointHandler(store, 300_000, loopConfig, cache, observer)

    await handler.handle('pipeline_start', JSON.stringify({
      description: 'test', totalPhases: 9, _projectId: 'p', _runId: 'r',
    }), { worktree: '/t', sessionID: 's1' })

    const startState = store.writeState.mock.calls[0][2] as Record<string, any>
    store.readState.mockReturnValue(startState)
    // MUST set getActiveRun so phase_complete can find the active run
    store.getActiveRun.mockReturnValue({ projectId: 'p', runId: startState.runId, startedAt: startState.startedAt })

    startState.currentPhase = 6
    startState.phaseStatus = 'awaiting_approval'
    for (let i = 1; i <= 6; i++) {
      startState.phases[i] = {
        ...makePhaseRecord(i, { ralphCompleted: true, userApproved: true, approvedAt: 'now' }),
      }
    }

    await handler.handle('phase_complete', JSON.stringify({ phase: 6 }),
      { worktree: '/t', sessionID: 's1' })

    // Phase 6 < maxPhase(7) → should NOT archive
    expect(store.archiveRun).not.toHaveBeenCalled()
  })

  it('should archive at totalPhases for legacy state (no maxPhase)', async () => {
    // Legacy: maxPhase=undefined → effectiveMax = totalPhases(5)
    const defaultConfig = { loopPhaseMap: {} as Record<number, never>, maxPhase: undefined }
    const store = createMockStore()
    const cache = createMockCache()
    const observer = createMockObserver()
    const handler = new CheckpointHandler(store, 300_000, defaultConfig, cache, observer)

    await handler.handle('pipeline_start', JSON.stringify({
      description: 'test', totalPhases: 5, _projectId: 'p', _runId: 'r',
    }), { worktree: '/t', sessionID: 's1' })

    const startState = store.writeState.mock.calls[0][2] as Record<string, any>
    store.readState.mockReturnValue(startState)
    // MUST set getActiveRun so phase_complete can find the active run
    store.getActiveRun.mockReturnValue({ projectId: 'p', runId: startState.runId, startedAt: startState.startedAt })

    startState.currentPhase = 5
    startState.phaseStatus = 'awaiting_approval'
    for (let i = 1; i <= 5; i++) {
      startState.phases[i] = {
        ...makePhaseRecord(i, { ralphCompleted: true, userApproved: true, approvedAt: 'now' }),
      }
    }

    await handler.handle('phase_complete', JSON.stringify({ phase: 5 }),
      { worktree: '/t', sessionID: 's1' })

    // Phase 5 === totalPhases(5) → archive should fire (legacy behavior preserved)
    expect(store.archiveRun).toHaveBeenCalled()
  })
})

// ─── effectiveMax boundary (phase_enter) ──────────────────────────────────
// NOTE: effectiveMax boundary tests for validateTransition are in
// transitions-loop-type.test.ts (describe 'phase_enter validate — effectiveMax boundary').
// This file focuses on CheckpointHandler integration, not validateTransition unit tests.

// ─── parseLoopPhases unit tests ──────────────────────────────────────────
// NOTE: parseLoopPhases unit tests (valid/missing/invalid config) are in
// loop-config.test.ts. Those tests provide comprehensive coverage of all
// parseLoopPhases paths. Removed from this file to eliminate duplication.

// ─── Security regression: payload injection defense ────────────────────────
// R5 fix: CheckpointHandler unconditionally overwrites _loopPhaseMap/_maxPhase
// in pipeline_start payload, preventing malicious caller from injecting arbitrary
// values. This test ensures the defense is not accidentally removed.

describe('security: payload injection defense for _loopPhaseMap/_maxPhase', () => {
  it('should overwrite malicious _loopPhaseMap in pipeline_start payload', async () => {
    const loopConfig = createMockLoopConfig({ maxPhase: 7 })
    const store = createMockStore()
    const cache = createMockCache()
    const observer = createMockObserver()
    const handler = new CheckpointHandler(store, 300_000, loopConfig, cache, observer)

    // Caller injects malicious _loopPhaseMap and _maxPhase in payload
    const maliciousMap = { 1: 'followup', 2: 'followup', 999: 'ralph' }
    const payload = JSON.stringify({
      description: 'test',
      totalPhases: 9,
      _projectId: 'test-proj',
      _runId: 'test-run',
      _loopPhaseMap: maliciousMap,  // should be overwritten
      _maxPhase: 999,                // should be overwritten
    })

    await handler.handle('pipeline_start', payload, { worktree: '/test', sessionID: 's1' })

    const writtenState = store.writeState.mock.calls[0][2] as Record<string, unknown>
    // Must be the config values, NOT the injected ones
    expect(writtenState.loopPhaseMap).toEqual(VALID_CONFIG_MAP)
    expect(writtenState.maxPhase).toBe(7)
  })
})

// ─── Integration: followup full flow with Rule 2 intercept ────────────────

describe('integration: followup phase full lifecycle', () => {
  it('should complete enter → approval → complete for followup phase with Rule 2 intercept', () => {
    // Drive the full followup phase lifecycle using applyTransition chain:
    // 1. pipeline_start with config
    // 2. user_approval(6) → sets phaseStatus=awaiting_approval
    // 3. phase_complete(6) → accepted
    // 4. Rule 2 allows Phase 7 deliverable with ralphCompleted=false

    // Step 1: pipeline_start
    const initialState = null as any
    const startPayload = {
      description: 'test',
      totalPhases: 7,
      _loopPhaseMap: VALID_CONFIG_MAP,
      _maxPhase: 7,
    }
    const afterStart = applyTransition('pipeline_start', startPayload, initialState)
    expect(afterStart.loopPhaseMap).toEqual(VALID_CONFIG_MAP)

    // Step 2: simulate phases 1-5 complete, enter phase 6
    afterStart.currentPhase = 6
    afterStart.phaseStatus = 'active'
    afterStart.phases[6] = makePhaseRecord(6, { ralphCompleted: false })

    // Step 3: user_approval for followup phase 6
    const afterApproval = applyTransition('user_approval', { phase: 6 }, afterStart)
    // Phase 5: followup user_approval sets phaseStatus to awaiting_approval.
    expect(afterApproval.phaseStatus).toBe('awaiting_approval')

    // Step 4: phase_complete(6) — should be accepted after approval
    const result = validateTransition('phase_complete', { phase: 6 }, afterApproval)
    // Phase 5: followup phaseStatus=awaiting_approval allows phase_complete.
    expect(result.valid).toBe(true)

    // Step 5: Rule 2 intercept — Phase 7 deliverable must NOT be blocked
    // even though phase 6 has ralphCompleted=false (followup phase skips ralph gate)
    // Note: afterApproval already has userApproved=true, approvedAt set by applyTransition,
    // and currentPhase=6 from the initial setup — no additional mutations needed.
    const rules = createRules()
    const rule2 = rules.find(r => r.id === 'NO_PHASE_ADVANCE_WITHOUT_GATE')!
    const classification = mockClassification('phase_deliverable', 7)
    const interceptResult = rule2.evaluate('write', 'src/feature.ts', classification, afterApproval)
    // Phase 5: Rule 2 allows Phase 7 deliverable when followup phase has userApproved=true.
    expect(interceptResult.blocked).toBe(false)
  })
})
