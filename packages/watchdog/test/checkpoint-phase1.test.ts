/**
 * CheckpointHandler Phase 1 Gate Tests — violation gate blocking on phase_complete.
 *
 * Tests the Phase 1 enhancement (design spec §3.1) that inserts a violation gate check
 * BEFORE the archive/clear logic on phase_complete events.
 *
 * New execution order:
 *   validate → violation gate check → apply → writeState → audit → archive → resolveViolations
 *
 * Covers:
 * - AC-8: Gate blocking (7 cases)
 * - Gate pass behavior (6 cases)
 * - Severity filtering (4 cases)
 * - Edge cases (4 cases)
 *
 * Mock store adds: getUnresolvedViolations, resolveViolations
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CheckpointResult, AuditLogEntry, PipelineState } from '../src/schema.js'
import { SCHEMA_VERSION, STALE_THRESHOLD_MS, NOW, makeState, makeRalphLoop, createMockStore, createMockCache, createMockObserver } from './helpers.js'
import { computeProjectId } from '../src/project-id.js'
import { CheckpointHandler } from '../src/checkpoint.js'
import type { PipelineStore } from '../src/pipeline-store.js'

// ── Types for Phase 1 violation gate ────────────────────────────────────────

interface ViolationRecord {
  violation: string
  severity: 'block' | 'warn'
  resolved: boolean
}

interface CheckpointGateResult {
  ok: boolean
  violation?: string
  guidance?: string
  violations?: string[]
  state?: PipelineState
}

// ── Mock store with Phase 1 methods ────────────────────────────────────────

interface MockStoreWithViolations extends ReturnType<typeof createMockStore> {
  getUnresolvedViolations: ReturnType<typeof vi.fn>
  resolveViolations: ReturnType<typeof vi.fn>
}

function createPhase1MockStore(): MockStoreWithViolations {
  const base = createMockStore()
  return {
    ...base,
    getUnresolvedViolations: vi.fn().mockReturnValue([]),
    resolveViolations: vi.fn(),
  }
}

// ── Constants & helpers ──────────────────────────────────────────────────────

const WORKTREE = '/Users/test/my-project'
const SESSION_ID = 'sess-001'
const CONTEXT = { worktree: WORKTREE, sessionID: SESSION_ID }
const PROJECT_ID = computeProjectId(WORKTREE)
const FRESH_NOW = new Date().toISOString()

function checkpointState(overrides: Partial<PipelineState> = {}): PipelineState {
  return makeState({
    projectId: PROJECT_ID,
    startedAt: FRESH_NOW,
    lastCheckpointAt: FRESH_NOW,
    description: 'test',
    ...overrides,
  })
}

function parseResult(raw: string): CheckpointResult {
  return JSON.parse(raw) as CheckpointResult
}

/**
 * Set up a pipeline at the final phase, ready for phase_complete.
 * Returns the mock store and handler.
 */
function setupFinalPhasePipeline(store: MockStoreWithViolations) {
  store.getActiveRun.mockReturnValue({
    runId: 'run-001', projectId: PROJECT_ID, startedAt: FRESH_NOW,
  })
  store.readState.mockReturnValue(checkpointState({
    runId: 'run-001',
    currentPhase: 5,
    phaseStatus: 'awaiting_approval',
    testEvidenceConfirmed: true,
    phases: {
      5: {
        phase: 5,
        enteredAt: FRESH_NOW,
        ralphCompleted: true,
        ralphTermination: 'gate_pass',
        userApproved: true,
        approvedAt: FRESH_NOW,
        articulationAttempted: false,
        articulationVerified: false,
        articulationDegraded: false,
        articulationFailures: 0,
      },
    },
    ralph: makeRalphLoop({ phase: 5, round: 5, consecutiveZero: 5, termination: 'gate_pass' }),
  }))
  return store
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CheckpointHandler Phase 1 — violation gate', () => {
  let mockStore: MockStoreWithViolations
  let mockCache: ReturnType<typeof createMockCache>
  let mockObserver: ReturnType<typeof createMockObserver>
  let handler: CheckpointHandler

  beforeEach(() => {
    mockStore = createPhase1MockStore()
    mockCache = createMockCache()
    mockObserver = createMockObserver()
    handler = new CheckpointHandler(
      mockStore as unknown as PipelineStore,
      STALE_THRESHOLD_MS,
      undefined,
      mockCache as any,
      mockObserver as any,
    )
  })

  // ══════════════════════════════════════════════════════════════════════════
  // AC-8: Gate Blocking (7 cases)
  // ══════════════════════════════════════════════════════════════════════════

  describe('AC-8: Gate blocking', () => {
    // TC-CP1-01: phase_complete with 0 unresolved violations → passes (ok=true)
    it('TC-CP1-01: passes when 0 unresolved violations exist', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([])

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      expect(parsed.ok).toBe(true)
    })

    // TC-CP1-02: phase_complete with 1 unresolved block violation → blocked (ok=false)
    it('TC-CP1-02: blocked when 1 unresolved block violation exists', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code committed', severity: 'block', resolved: false },
      ])

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok && 'violation' in parsed) {
        expect(parsed.violation).toContain('1')
      }
    })

    // TC-CP1-03: phase_complete with multiple unresolved block violations → blocked with count
    it('TC-CP1-03: blocked with correct count for multiple violations', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code committed', severity: 'block', resolved: false },
        { violation: 'Skip red phase', severity: 'block', resolved: false },
        { violation: 'No refactor step', severity: 'block', resolved: false },
      ])

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok && 'violation' in parsed) {
        expect(parsed.violation).toContain('3')
      }
    })

    // TC-CP1-04: Blocked response includes violation descriptions
    it('TC-CP1-04: blocked response includes violation descriptions', async () => {
      setupFinalPhasePipeline(mockStore)
      const violations = [
        { violation: 'Untested code committed', severity: 'block', resolved: false },
        { violation: 'Skip red phase', severity: 'block', resolved: false },
      ]
      mockStore.getUnresolvedViolations.mockReturnValue(violations)

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok && 'violation' in parsed) {
        // The violation message should reference the unresolved violations
        expect(parsed.violation).toBeTruthy()
        // If a violations array is included, check descriptions
        const gateResult = JSON.parse(result) as CheckpointGateResult
        if (gateResult.violations) {
          expect(gateResult.violations).toContain('Untested code committed')
          expect(gateResult.violations).toContain('Skip red phase')
        }
      }
    })

    // TC-CP1-05: Blocked response does NOT call archiveRun
    it('TC-CP1-05: blocked gate does not call archiveRun', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code', severity: 'block', resolved: false },
      ])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      expect(mockStore.archiveRun).not.toHaveBeenCalled()
    })

    // TC-CP1-06: Blocked response does NOT call clearActiveRun
    it('TC-CP1-06: blocked gate does not call clearActiveRun', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code', severity: 'block', resolved: false },
      ])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      expect(mockStore.clearActiveRun).not.toHaveBeenCalled()
    })

    // TC-CP1-07: Blocked response does NOT modify state (no applyTransition write)
    it('TC-CP1-07: blocked gate does not write state', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code', severity: 'block', resolved: false },
      ])

      const writeCallsBefore = mockStore.writeState.mock.calls.length

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      // writeState should NOT have been called for the blocked transition
      // (it may have been called from earlier setup, but no NEW calls)
      expect(mockStore.writeState.mock.calls.length).toBe(writeCallsBefore)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Gate Pass Behavior (6 cases)
  // ══════════════════════════════════════════════════════════════════════════

  describe('gate pass behavior', () => {
    // TC-CP1-08: Gate passes → resolveViolations called for all remaining violations
    it('TC-CP1-08: resolveViolations called when gate passes', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      // resolveViolations should be called to mark all remaining violations as resolved
      expect(mockStore.resolveViolations).toHaveBeenCalled()
    })

    // TC-CP1-09: Gate passes → archiveRun called (existing behavior preserved)
    it('TC-CP1-09: archiveRun called on final phase when gate passes', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      expect(mockStore.archiveRun).toHaveBeenCalledWith(PROJECT_ID, expect.any(String))
    })

    // TC-CP1-10: Gate passes → clearActiveRun called (existing behavior preserved)
    it('TC-CP1-10: clearActiveRun called on final phase when gate passes', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      expect(mockStore.clearActiveRun).toHaveBeenCalledWith(PROJECT_ID)
    })

    // TC-CP1-11: Gate passes → cache cleared (existing behavior preserved)
    it('TC-CP1-11: cache cleared on final phase when gate passes', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      expect(mockCache.clear).toHaveBeenCalled()
    })

    // TC-CP1-12: Gate passes → observer degradation cleared (existing behavior preserved)
    it('TC-CP1-12: observer degradation cleared on final phase when gate passes', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      expect(mockObserver.clearDegradation).toHaveBeenCalled()
    })

    // TC-CP1-13: Final phase (maxPhase) gate pass → full cleanup
    it('TC-CP1-13: full cleanup on final phase with maxPhase', async () => {
      mockStore.getActiveRun.mockReturnValue({
        runId: 'run-001', projectId: PROJECT_ID, startedAt: FRESH_NOW,
      })
      mockStore.readState.mockReturnValue(checkpointState({
        runId: 'run-001',
        currentPhase: 7,
        phaseStatus: 'awaiting_approval',
        maxPhase: 7,
        totalPhases: 5, // totalPhases < maxPhase, effectiveMax should use maxPhase
        testEvidenceConfirmed: true,
        phases: {
          7: {
            phase: 7,
            enteredAt: FRESH_NOW,
            ralphCompleted: true,
            ralphTermination: 'gate_pass',
            userApproved: true,
            approvedAt: FRESH_NOW,
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
          },
        },
        ralph: makeRalphLoop({ phase: 7, round: 5, consecutiveZero: 5, termination: 'gate_pass' }),
      }))
      mockStore.getUnresolvedViolations.mockReturnValue([])

      await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 7 }),
        CONTEXT,
      )

      // All cleanup should happen
      expect(mockStore.archiveRun).toHaveBeenCalled()
      expect(mockStore.clearActiveRun).toHaveBeenCalled()
      expect(mockCache.clear).toHaveBeenCalled()
      expect(mockObserver.clearDegradation).toHaveBeenCalled()
      expect(mockStore.resolveViolations).toHaveBeenCalled()
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Severity Filtering (4 cases)
  // ══════════════════════════════════════════════════════════════════════════

  describe('severity filtering', () => {
    // TC-CP1-14: Only 'block' severity checked — 'warn' violations don't block
    it('TC-CP1-14: warn-only violations do not block gate', async () => {
      setupFinalPhasePipeline(mockStore)
      // getUnresolvedViolations with 'block' filter returns empty
      mockStore.getUnresolvedViolations.mockImplementation(
        (_projectId: string, _runId: string, severity?: string) => {
          if (severity === 'block') return []
          // Without filter, return the warn violations
          return [
            { violation: 'Minor code smell', severity: 'warn', resolved: false },
          ]
        },
      )

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      // Gate check should pass since only block severity is checked
      expect(parsed.ok).toBe(true)
    })

    // TC-CP1-15: Mixed block+warn — only block violations checked
    it('TC-CP1-15: mixed block+warn only checks block severity', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockImplementation(
        (_projectId: string, _runId: string, severity?: string) => {
          if (severity === 'block') {
            return [
              { violation: 'Untested code', severity: 'block', resolved: false },
            ]
          }
          return [
            { violation: 'Untested code', severity: 'block', resolved: false },
            { violation: 'Code smell', severity: 'warn', resolved: false },
          ]
        },
      )

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok && 'violation' in parsed) {
        // Should report 1 block violation, not 2 total
        expect(parsed.violation).toContain('1')
      }
    })

    // TC-CP1-16: All warn, no block → passes
    it('TC-CP1-16: all warn violations pass gate', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockImplementation(
        (_projectId: string, _runId: string, severity?: string) => {
          if (severity === 'block') return []
          return [
            { violation: 'Warning 1', severity: 'warn', resolved: false },
            { violation: 'Warning 2', severity: 'warn', resolved: false },
          ]
        },
      )

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      expect(parsed.ok).toBe(true)
    })

    // TC-CP1-17: Resolved block violations excluded from gate check
    it('TC-CP1-17: resolved block violations excluded from gate', async () => {
      setupFinalPhasePipeline(mockStore)
      // getUnresolvedViolations should only return unresolved ones
      mockStore.getUnresolvedViolations.mockImplementation(
        (_projectId: string, _runId: string, severity?: string) => {
          // All block violations are resolved, so none returned
          if (severity === 'block') return []
          return []
        },
      )

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      expect(parsed.ok).toBe(true)
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Edge Cases (4 cases)
  // ══════════════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    // TC-CP1-18: getUnresolvedViolations throws → gate fails-closed (blocks)
    it('TC-CP1-18: fail-closed when getUnresolvedViolations throws', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockImplementation(() => {
        throw new Error('Storage error')
      })

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      // Fail-closed: should block despite the error (per spec §4.2)
      const parsed = parseResult(result)
      expect(parsed.ok).toBe(false)
    })

    // TC-CP1-19: No store available → gate check skipped
    it('TC-CP1-19: gate skipped when store has no getUnresolvedViolations', async () => {
      // Use the base mock store WITHOUT getUnresolvedViolations
      const baseStore = createMockStore()
      baseStore.getActiveRun.mockReturnValue({
        runId: 'run-001', projectId: PROJECT_ID, startedAt: FRESH_NOW,
      })
      baseStore.readState.mockReturnValue(checkpointState({
        runId: 'run-001',
        currentPhase: 5,
        phaseStatus: 'awaiting_approval',
        testEvidenceConfirmed: true,
        phases: {
          5: {
            phase: 5,
            enteredAt: FRESH_NOW,
            ralphCompleted: true,
            ralphTermination: 'gate_pass',
            userApproved: true,
            approvedAt: FRESH_NOW,
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
          },
        },
        ralph: makeRalphLoop({ phase: 5, round: 5, consecutiveZero: 5, termination: 'gate_pass' }),
      }))

      const legacyHandler = new CheckpointHandler(
        baseStore as unknown as PipelineStore,
        STALE_THRESHOLD_MS,
      )

      const result = await legacyHandler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )

      // Should proceed normally (gate skipped)
      const parsed = parseResult(result)
      expect(parsed.ok).toBe(true)
      expect(baseStore.archiveRun).toHaveBeenCalled()
    })

    // TC-CP1-20: Empty projectId/runId → no crash
    it('TC-CP1-20: no crash with empty projectId/runId', async () => {
      const emptyContext = { worktree: '', sessionID: 'sess-001' }
      // Empty worktree → projectId will be computed from empty string
      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        emptyContext,
      )

      // Should handle gracefully — either violation for no active run or similar
      const parsed = parseResult(result)
      // Should not throw, just return a result
      expect(parsed).toBeDefined()
      expect(parsed.ok).toBe(false) // No active run for this project
    })

    // TC-CP1-21: Multiple phase_complete calls — idempotent gate check
    it('TC-CP1-21: multiple phase_complete calls produce consistent gate checks', async () => {
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code', severity: 'block', resolved: false },
      ])

      // First call
      const result1 = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )
      const parsed1 = parseResult(result1)

      // Reset mock for second call
      setupFinalPhasePipeline(mockStore)
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code', severity: 'block', resolved: false },
      ])

      // Second call — same result
      const result2 = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 5 }),
        CONTEXT,
      )
      const parsed2 = parseResult(result2)

      expect(parsed1.ok).toBe(false)
      expect(parsed2.ok).toBe(false)
      // Both should produce the same violation
      if (!parsed1.ok && 'violation' in parsed1 && !parsed2.ok && 'violation' in parsed2) {
        expect(parsed1.violation).toBe(parsed2.violation)
      }
    })
  })

  // ══════════════════════════════════════════════════════════════════════════
  // Non-final phase_complete (gate applies to ALL phases)
  // ══════════════════════════════════════════════════════════════════════════

  describe('intermediate phase_complete', () => {
    // TC-CP1-22: Non-final phase_complete should also be blocked by unresolved violations
    it('TC-CP1-22: non-final phase_complete blocked by unresolved violations', async () => {
      mockStore.getActiveRun.mockReturnValue({
        runId: 'run-001', projectId: PROJECT_ID, startedAt: FRESH_NOW,
      })
      mockStore.readState.mockReturnValue(checkpointState({
        runId: 'run-001',
        currentPhase: 3,
        phaseStatus: 'awaiting_approval',
        testEvidenceConfirmed: true,
        phases: {
          3: {
            phase: 3,
            enteredAt: FRESH_NOW,
            ralphCompleted: true,
            ralphTermination: 'gate_pass',
            userApproved: true,
            approvedAt: FRESH_NOW,
            articulationAttempted: false,
            articulationVerified: false,
            articulationDegraded: false,
            articulationFailures: 0,
          },
        },
        ralph: makeRalphLoop({ phase: 3, round: 5, consecutiveZero: 5, termination: 'gate_pass' }),
      }))
      mockStore.getUnresolvedViolations.mockReturnValue([
        { violation: 'Untested code', severity: 'block', resolved: false },
      ])

      const result = await handler.handle(
        'phase_complete',
        JSON.stringify({ phase: 3 }),
        CONTEXT,
      )

      const parsed = parseResult(result)
      // Gate applies to ALL phase_complete events — should block
      expect(parsed.ok).toBe(false)
      // archiveRun should NOT be called when blocked
      expect(mockStore.archiveRun).not.toHaveBeenCalled()
    })
  })
})
