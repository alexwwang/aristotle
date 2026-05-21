/**
 * Shared test helpers for watchdog tests.
 * Phase 1: re-exports from source modules.
 * Phase 2: adds mock factories used across Module A/B/C test files.
 */
import { vi } from 'vitest'
import { SCHEMA_VERSION } from '../src/schema.js'
import type { FileClassification } from '../src/file-classifier.js'

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

// ── Phase 2.2: Checkpoint Integration helpers ──────────────────────────────

import type { PhaseLoopMap, LoopConfigResult } from '../src/loop-config.js'

/** Standard valid loopPhases map: ralph=[1-5], followup=[6-7] */
export const VALID_CONFIG_MAP: PhaseLoopMap = {
  1: 'ralph', 2: 'ralph', 3: 'ralph', 4: 'ralph', 5: 'ralph',
  6: 'followup', 7: 'followup',
}

/** Standard valid loopPhases map: ralph=[1-5] only (no followup) */
export const VALID_CONFIG_MAP_RALPH_ONLY: PhaseLoopMap = {
  1: 'ralph', 2: 'ralph', 3: 'ralph', 4: 'ralph', 5: 'ralph',
}

/** Create a state with loopPhaseMap and maxPhase for loopType-aware tests. */
export function makeStateWithConfig(phaseLoopMap: PhaseLoopMap, maxPhase: number): Record<string, any> {
  return makeState({ loopPhaseMap: phaseLoopMap, maxPhase, totalPhases: maxPhase })
}

/** Create a mock LoopConfigResult for checkpoint integration tests. */
export function createMockLoopConfig(overrides?: Partial<LoopConfigResult>): LoopConfigResult {
  return {
    loopPhaseMap: VALID_CONFIG_MAP,
    maxPhase: 7,
    ...overrides,
  }
}

// ── Phase 2.2: Fixtures for loop-config tests ──────────────────────────────

export const FIXTURES = {
  // Valid configs
  VALID_CONFIG: { ralph: [1, 2, 3, 4, 5], followup: [6, 7] },
  VALID_CONFIG_RALPH_ONLY: { ralph: [1, 2, 3, 4, 5] },

  // Invalid configs
  INVALID_EMPTY: {},
  INVALID_UNKNOWN_TYPE: { ralph: [1, 2], custom: [3, 4] },
  INVALID_OVERLAP: { ralph: [1, 2, 3], followup: [3, 4, 5] },
  INVALID_GAP: { ralph: [1, 3, 4, 5], followup: [6, 7] },
  INVALID_PHASE4_FOLLOWUP: { ralph: [1, 2, 3, 5], followup: [4, 6, 7] },
  INVALID_START_GAP: { ralph: [2, 3, 4, 5], followup: [6, 7] },
  INVALID_EMPTY_ARRAY: { ralph: [] as number[], followup: [1, 2, 3] },
  INVALID_DUPLICATE: { ralph: [1, 2, 2, 3, 4, 5] },
  INVALID_NULL: null,
} as const

/** Create a mock FileClassification for intercept-rule tests. */
export function mockClassification(category: string, phase: number): FileClassification {
  return {
    category: category as FileClassification['category'],
    phase,
    confidence: 1,
    reason: 'test',
  }
}
