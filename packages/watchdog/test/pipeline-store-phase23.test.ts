import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineStore } from '../src/pipeline-store.js'
import type { StateStore } from '@opencode-ai/core/store/state-store'
import type { Logger } from '@opencode-ai/core/logger'
import { makeState, makeLegacyState, SCHEMA_VERSION } from './helpers.js'

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function createMockStateStore(): StateStore {
  const store = new Map<string, any>()
  const logs = new Map<string, any[]>()
  return {
    read<T>(key: string): T | null {
      return (store.get(key) ?? null) as T | null
    },
    write<T>(key: string, value: T): void {
      store.set(key, value)
    },
    appendLog(key: string, entry: unknown): void {
      if (!logs.has(key)) logs.set(key, [])
      logs.get(key)!.push(entry)
    },
    readLog<T>(key: string): T[] {
      return (logs.get(key) ?? []) as T[]
    },
    readLogSafe<T>(key: string): T[] {
      return (logs.get(key) ?? []) as T[]
    },
    list(_prefix: string): string[] {
      return []
    },
    _store: store,
    _logs: logs,
  } as any
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('Phase 2.3 — P Severity Persistence', () => {
  let mockStore: StateStore
  let mockLogger: Logger
  let pipelineStore: PipelineStore

  beforeEach(() => {
    mockStore = createMockStateStore()
    mockLogger = createMockLogger()
    pipelineStore = new PipelineStore(mockStore, mockLogger)
  })

  // ── TC-21 (AC-17): readState migrates pre-v4 roundRecords counts → adds P:0 ──
  it('TC-21 (AC-17): readState migrates pre-v4 roundRecords counts → adds P:0', () => {
    const legacyState = makeLegacyState({
      version: 3,
      ralph: {
        phase: 1,
        round: 2,
        consecutiveZero: 0,
        tallyHistory: [],
        openContested: [],
        escalated: false,
        escalatedAt: null,
        termination: null,
        roundRecords: [
          { round: 1, counts: { C: 1, H: 0, M: 0, L: 0, I: 0 }, submittedAt: '2026-01-01T00:00:00.000Z' },
          { round: 2, counts: { C: 0, H: 1, M: 0, L: 0, I: 0 }, submittedAt: '2026-01-01T01:00:00.000Z' },
        ],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, legacyState)

    const result = pipelineStore.readState('testproj', 'run-001')

    expect(result).not.toBeNull()
    expect(result!.ralph).not.toBeNull()
    expect(result!.ralph!.roundRecords).toHaveLength(2)
    expect(result!.ralph!.roundRecords[0].counts.P).toBe(0)
    expect(result!.ralph!.roundRecords[1].counts.P).toBe(0)
  })

  // ── TC-21b (AC-12): readState migrates pre-v4 tallyHistory entries → adds P:0 ──
  it('TC-21b (AC-12): readState migrates pre-v4 tallyHistory entries → adds P:0', () => {
    const legacyState = makeLegacyState({
      version: 3,
      ralph: {
        phase: 1,
        round: 2,
        consecutiveZero: 0,
        tallyHistory: [
          { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
          { round: 2, C: 0, H: 1, M: 0, L: 0, I: 0, timestamp: '2026-01-01T01:00:00.000Z' },
        ],
        openContested: [],
        escalated: false,
        escalatedAt: null,
        termination: null,
        roundRecords: [],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, legacyState)

    const result = pipelineStore.readState('testproj', 'run-001')

    expect(result).not.toBeNull()
    expect(result!.ralph).not.toBeNull()
    expect(result!.ralph!.tallyHistory).toHaveLength(2)
    expect(result!.ralph!.tallyHistory[0].P).toBe(0)
    expect(result!.ralph!.tallyHistory[1].P).toBe(0)
  })

  // ── TC-21c (Phase 2 R1 F-6 regression): readState handles corrupted roundRecords with missing counts field ──
  it('TC-21c (F-6 regression): readState does not throw when roundRecord.counts is missing', () => {
    const corruptedState = makeLegacyState({
      version: 3,
      ralph: {
        phase: 1,
        round: 2,
        consecutiveZero: 0,
        tallyHistory: [],
        openContested: [],
        escalated: false,
        escalatedAt: null,
        termination: null,
        roundRecords: [
          { round: 1, counts: { C: 1, H: 0, M: 0, L: 0, I: 0 }, submittedAt: '2026-01-01T00:00:00.000Z' },
          { round: 2, counts: undefined as unknown as { C: number; H: number; M: number; L: number; I: number }, submittedAt: '2026-01-01T01:00:00.000Z' },
          { round: 3, counts: null as unknown as { C: number; H: number; M: number; L: number; I: number }, submittedAt: '2026-01-01T02:00:00.000Z' },
        ],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, corruptedState)

    expect(() => pipelineStore.readState('testproj', 'run-001')).not.toThrow()

    const result = pipelineStore.readState('testproj', 'run-001')
    expect(result!.ralph!.roundRecords[0].counts.P).toBe(0)
    expect(result!.ralph!.roundRecords[1].counts).toBeFalsy()
    expect(result!.ralph!.roundRecords[2].counts).toBeFalsy()
  })

  // ── TC-21d (Phase 2 R2 F-1 regression): readState handles null tallyHistory entries ──
  it('TC-21d (F-1 regression): readState does not throw when tallyHistory contains null entries', () => {
    const corruptedState = makeLegacyState({
      version: 3,
      ralph: {
        phase: 1,
        round: 2,
        consecutiveZero: 0,
        tallyHistory: [
          { round: 1, C: 1, H: 0, M: 0, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
          null as unknown as { round: number; C: number; H: number; M: number; L: number; I: number; timestamp: string },
        ],
        openContested: [],
        escalated: false,
        escalatedAt: null,
        termination: null,
        roundRecords: [],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, corruptedState)

    expect(() => pipelineStore.readState('testproj', 'run-001')).not.toThrow()

    const result = pipelineStore.readState('testproj', 'run-001')
    expect(result!.ralph!.tallyHistory[0].P).toBe(0)
    expect(result!.ralph!.tallyHistory[1]).toBeFalsy()
  })

  // ── TC-21e (Phase 2 R4 F-2 regression): readState handles non-object roundRecord.counts (string/number primitive) ──
  it('TC-21e (F-2 regression): readState does not throw when roundRecord.counts is a non-object primitive', () => {
    const corruptedState = makeLegacyState({
      version: 3,
      ralph: {
        phase: 1,
        round: 2,
        consecutiveZero: 0,
        tallyHistory: [],
        openContested: [],
        escalated: false,
        escalatedAt: null,
        termination: null,
        roundRecords: [
          { round: 1, counts: 'corrupted-string' as unknown as { C: number; H: number; M: number; L: number; I: number }, submittedAt: '2026-01-01T00:00:00.000Z' },
          { round: 2, counts: 42 as unknown as { C: number; H: number; M: number; L: number; I: number }, submittedAt: '2026-01-01T01:00:00.000Z' },
          { round: 3, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: '2026-01-01T02:00:00.000Z' },
        ],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, corruptedState)

    expect(() => pipelineStore.readState('testproj', 'run-001')).not.toThrow()

    const result = pipelineStore.readState('testproj', 'run-001')
    expect(typeof result!.ralph!.roundRecords[0].counts).toBe('string')
    expect(typeof result!.ralph!.roundRecords[1].counts).toBe('number')
    expect(result!.ralph!.roundRecords[2].counts.P).toBe(0)
  })

  // ── TC-22 (AC-13): readState throws when state.version > SCHEMA_VERSION ──
  it('TC-22 (AC-13): readState throws when state.version > SCHEMA_VERSION', () => {
    const futureState = makeLegacyState({
      version: 99,
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, futureState)

    expect(() => pipelineStore.readState('testproj', 'run-001')).toThrow(/newer than supported/i)
  })

  // ── TC-23 (AC-13): readState accepts state with version === SCHEMA_VERSION ──
  it('TC-23 (AC-13): readState accepts state with version === SCHEMA_VERSION', () => {
    const currentState = makeState({
      version: SCHEMA_VERSION,
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, currentState)

    const result = pipelineStore.readState('testproj', 'run-001')

    expect(result).not.toBeNull()
    expect(result!.version).toBe(SCHEMA_VERSION)
  })

  // ── TC-39 (C9 invariant): readState with valid v4 state → P values preserved unchanged ──
  it('TC-39 (C9 invariant): readState with valid v4 state → P values preserved unchanged', () => {
    const v4State = makeState({
      version: SCHEMA_VERSION,
      ralph: {
        phase: 1,
        round: 1,
        consecutiveZero: 0,
        tallyHistory: [
          { round: 1, C: 0, H: 0, M: 0, P: 2, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
        ],
        openContested: [],
        escalated: false,
        escalatedAt: null,
        termination: null,
        roundRecords: [
          { round: 1, counts: { C: 0, H: 0, M: 0, P: 3, L: 0, I: 0 }, submittedAt: '2026-01-01T00:00:00.000Z' },
        ],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, v4State)

    const result = pipelineStore.readState('testproj', 'run-001')

    expect(result).not.toBeNull()
    expect(result!.ralph).not.toBeNull()
    expect(result!.ralph!.roundRecords[0].counts.P).toBe(3)
    expect(result!.ralph!.tallyHistory[0].P).toBe(2)
  })

  // ── TC-21g (C8 combined): readState migrates both roundRecords AND tallyHistory in single load ──
  it('TC-21g (C8 combined): readState migrates both roundRecords AND tallyHistory in single load', () => {
    const legacyState = makeLegacyState({
      version: 3,
      ralph: {
        phase: 1,
        round: 1,
        consecutiveZero: 0,
        tallyHistory: [
          { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
        ],
        openContested: [],
        escalated: false,
        escalatedAt: null,
        termination: null,
        roundRecords: [
          { round: 1, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: '2026-01-01T00:00:00.000Z' },
        ],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, legacyState)

    const result = pipelineStore.readState('testproj', 'run-001')

    expect(result).not.toBeNull()
    expect(result!.ralph).not.toBeNull()
    expect(result!.ralph!.roundRecords[0].counts.P).toBe(0)
    expect(result!.ralph!.tallyHistory[0].P).toBe(0)
  })

  it('R4-F26 regression: primitive tallyHistory entry (number) does not throw during P migration', () => {
    const corruptedState = makeLegacyState({
      version: 3,
      ralph: {
        round: 1,
        phase: 1,
        consecutiveZero: 0,
        tallyHistory: [
          42 as any,
          { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
        ],
        roundRecords: [],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, corruptedState)

    expect(() => pipelineStore.readState('testproj', 'run-001')).not.toThrow()
    const result = pipelineStore.readState('testproj', 'run-001')
    expect(result).not.toBeNull()
    expect(result!.ralph).not.toBeNull()
    expect(typeof result!.ralph!.tallyHistory[0]).toBe('number')
    expect(result!.ralph!.tallyHistory[1].P).toBe(0)
  })

  it('R5-F1 regression: null roundRecords entry does not throw during P migration', () => {
    const corruptedState = makeLegacyState({
      version: 3,
      ralph: {
        round: 1,
        phase: 1,
        consecutiveZero: 0,
        tallyHistory: [
          { round: 1, C: 0, H: 0, M: 0, L: 0, I: 0, timestamp: '2026-01-01T00:00:00.000Z' },
        ],
        roundRecords: [
          null as any,
          { round: 1, counts: { C: 0, H: 0, M: 0, L: 0, I: 0 }, submittedAt: '2026-01-01T00:00:00.000Z' },
        ],
        autoValidated: false,
      },
    })

    const stateKey = 'watchdog/testproj/run-001/state'
    mockStore.write(stateKey, corruptedState)

    expect(() => pipelineStore.readState('testproj', 'run-001')).not.toThrow()
    const result = pipelineStore.readState('testproj', 'run-001')
    expect(result).not.toBeNull()
    expect(result!.ralph).not.toBeNull()
    expect(result!.ralph!.roundRecords[0]).toBeNull()
    expect(result!.ralph!.roundRecords[1].counts.P).toBe(0)
  })
})
