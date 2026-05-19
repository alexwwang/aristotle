/**
 * Shared test helpers for watchdog tests.
 * Phase 1: re-exports from source modules.
 * Phase 2: adds mock factories used across Module A/B/C test files.
 */
import { vi } from 'vitest'
import { SCHEMA_VERSION } from '../src/schema.js'

export { SCHEMA_VERSION } from '../src/schema.js'
export { STALE_THRESHOLD_MS, MAX_RALPH_ROUNDS, MIN_GATE_ROUNDS, EARLY_STOP_CONSECUTIVE } from '../src/constants.js'

// ── Schema helpers ─────────────────────────────────────────────────────────

const FRESH_NOW = new Date().toISOString()

export function makeState(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    version: SCHEMA_VERSION,
    projectId: 'proj-test',
    runId: 'run-test',
    startedAt: FRESH_NOW,
    description: 'test',
    currentPhase: 0,
    phaseStatus: 'idle' as const,
    totalPhases: 5,
    phases: {},
    ralph: null,
    testEvidenceConfirmed: false,
    lastCheckpointAt: FRESH_NOW,
    // Phase 2 field — optional in schema, defaults for convenience
    ...overrides,
  }
}

export function makePhaseRecord(phase: number, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    phase,
    enteredAt: FRESH_NOW,
    ralphCompleted: false,
    ralphTermination: null,
    userApproved: false,
    approvedAt: null,
    // Phase 2 articulation fields (must match transitions.ts phase_enter defaults)
    articulationVerified: false,
    articulationAttempted: false,
    articulationDegraded: false,
    articulationFailures: 0,
    ...overrides,
  }
}

// ── Mock factories ─────────────────────────────────────────────────────────
// NOTE (C-2): PipelineStateCache.get() and PipelineStore read/write/audit methods
// are SYNCHRONOUS in production. Mocks below use mockReturnValue for sync methods
// and mockResolvedValue for truly async methods (observations).
// Observer tests use mockImplementationOnce(() => { throw ... }) for error injection
// since cache.get() is sync and does not return a Promise.

export function createMockStore() {
  return {
    // Synchronous methods (match production PipelineStore signatures)
    readState: vi.fn().mockReturnValue(null),
    writeState: vi.fn().mockReturnValue(undefined),
    appendAudit: vi.fn().mockReturnValue(undefined),
    getActiveRun: vi.fn().mockReturnValue(null),
    setActiveRun: vi.fn(),
    clearActiveRun: vi.fn(),
    archiveRun: vi.fn(),
    getProjectIds: vi.fn().mockReturnValue([]),
    // async — matches production PipelineStore observation methods
    // (async for future StateStore async migration; internal ops currently sync)
    appendObservation: vi.fn().mockResolvedValue(undefined),
    readObservations: vi.fn().mockResolvedValue([]),
    findObservations: vi.fn().mockResolvedValue([]),
  }
}

export function createMockCache(overrides: { getReturn?: any } = {}) {
  return {
    // Synchronous — matches production PipelineStateCache.get()
    get: vi.fn().mockReturnValue(overrides.getReturn ?? null),
    update: vi.fn(),
    clear: vi.fn(),
  }
}

export function createMockObserver(overrides: { isDegradedReturn?: boolean } = {}) {
  return {
    handle: vi.fn(),
    isDegraded: vi.fn().mockReturnValue(overrides.isDegradedReturn ?? false),
    clearDegradation: vi.fn(),
  }
}

export function createMockSessionBuffer() {
  return {
    record: vi.fn(),
    getSession: vi.fn().mockReturnValue([]),
    clearSession: vi.fn(),
    sessionCount: vi.fn().mockReturnValue(0),
  }
}
