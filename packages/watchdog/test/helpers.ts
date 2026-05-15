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
    ...overrides,
  }
}

// ── Mock factories ─────────────────────────────────────────────────────────

export function createMockStore() {
  return {
    readState: vi.fn().mockResolvedValue(null),
    writeState: vi.fn().mockResolvedValue(undefined),
    appendAudit: vi.fn().mockResolvedValue(undefined),
    getActiveRun: vi.fn().mockReturnValue(null),
    setActiveRun: vi.fn(),
    clearActiveRun: vi.fn(),
    archiveRun: vi.fn(),
    getProjectIds: vi.fn().mockReturnValue([]),
    // Phase 2 observation methods
    appendObservation: vi.fn().mockResolvedValue(undefined),
    readObservations: vi.fn().mockResolvedValue([]),
    findObservations: vi.fn().mockResolvedValue([]),
  }
}

export function createMockCache(overrides: { getReturn?: any } = {}) {
  return {
    get: vi.fn().mockResolvedValue(overrides.getReturn ?? null),
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
