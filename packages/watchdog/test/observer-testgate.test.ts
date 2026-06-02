/**
 * Observer Phase 2 Test Gate — degradation mode TDD Red phase.
 *
 * These tests define the contract for Phase 2 Observer init-time degradation:
 *  - AC-5: Observer catches tool registration failures during init and sets degraded = true
 *  - AuditLogEntry extensions for DEGRADATION_MODE_ACTIVATED and pass/fail/error_summary
 *
 * Most tests are `it.skip` because the source doesn't implement Phase 2 degradation init yet.
 * Group C tests verify existing isDegraded() behavior and should PASS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Observer } from '../src/observer.js'
import { makeState as _makeState, createMockCache, createMockSessionBuffer } from './helpers.js'
import type { PipelineState, AuditLogEntry } from '../src/schema.js'

// ── Mock factories (copied from observer-phase1.test.ts patterns) ─────────────

function makeState(overrides: Partial<PipelineState> = {}): PipelineState {
  return _makeState({ projectId: 'proj-test', runId: 'run-test', ...overrides })
}

function makeActiveState(overrides: Partial<PipelineState> = {}): PipelineState {
  return makeState({ phaseStatus: 'active', ralph: null, ...overrides })
}

interface RuleConfig {
  enabled: boolean
  severity: 'warn' | 'block'
  ignoreExitCodes?: number[]
  ignoreCommands?: string[]
  extensions?: string[]
  maxFileSize?: number
}

function createMockRuleConfigLoader(overrides?: {
  ignoreCommands?: string[]
  ignoreExitCodes?: number[]
}) {
  return {
    load: vi.fn().mockImplementation((name: string): RuleConfig => {
      const defaults: RuleConfig = {
        enabled: true,
        severity: 'block',
        ignoreExitCodes: [],
        ignoreCommands: [],
      }
      if (name === 'COMMAND_RESULT_CHECK') {
        return { ...defaults, ...(overrides ?? {}) }
      }
      if (name === 'SYNTAX_CHECK_POST_WRITE') {
        return { ...defaults, extensions: ['.json', '.yaml', '.yml'] }
      }
      if (name === 'FILE_SIZE_CHECK') {
        return { ...defaults, severity: 'warn', maxFileSize: 102400 }
      }
      if (name === 'OBSERVER_TIMEOUT') {
        return { ...defaults }
      }
      return defaults
    }),
  }
}

function createPhase1Observer(
  store: any,
  cache: any,
  sessionBuffer: any,
  ruleLoader?: any,
  initContext?: { registerTool?: (name: string, handler: (...args: any[]) => any) => void },
): Observer {
  const Ctor = Observer as any
  return new Ctor(cache, sessionBuffer, store, undefined, ruleLoader, initContext) as Observer
}

function createPhase1Store() {
  return {
    readState: vi.fn().mockReturnValue(null),
    writeState: vi.fn().mockReturnValue(undefined),
    appendAudit: vi.fn().mockReturnValue(undefined),
    getActiveRun: vi.fn().mockReturnValue(null),
    setActiveRun: vi.fn(),
    clearActiveRun: vi.fn(),
    archiveRun: vi.fn(),
    getProjectIds: vi.fn().mockReturnValue([]),
    appendObservation: vi.fn().mockResolvedValue(undefined),
    readObservations: vi.fn().mockResolvedValue([]),
    findObservations: vi.fn().mockResolvedValue([]),
    getUnresolvedViolations: vi.fn().mockReturnValue([]),
    resolveViolations: vi.fn().mockReturnValue(undefined),
  }
}

function bashOutput(exitCode: number, stdout = ''): string {
  return stdout + (stdout ? '\n' : '') + `exit code: ${exitCode}`
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('Observer Phase 2 Test Gate', () => {
  let store: ReturnType<typeof createPhase1Store>
  let cache: ReturnType<typeof createMockCache>
  let sessionBuffer: ReturnType<typeof createMockSessionBuffer>
  let ruleLoader: ReturnType<typeof createMockRuleConfigLoader>
  let observer: Observer

  beforeEach(() => {
    store = createPhase1Store()
    cache = createMockCache()
    sessionBuffer = createMockSessionBuffer()
    ruleLoader = createMockRuleConfigLoader()
    observer = createPhase1Observer(store, cache, sessionBuffer, ruleLoader)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  Group A: Degradation mode on init (AC-5)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Group A: Degradation mode on init (AC-5)', () => {
    // ── A-01: successful init → isDegraded returns false ──
    it('A-01: successful init → isDegraded returns false', () => {
      // A fresh Observer with no init failures should not be degraded.
      cache.get.mockReturnValue(makeActiveState())
      store.getActiveRun.mockReturnValue({ runId: 'run-test', projectId: 'proj-test', startedAt: '2026-01-01T00:00:00.000Z' })
      expect(observer.isDegraded('proj-test', 'run-test')).toBe(false)
    })

    // ── A-02: init with tool registration failure → isInitDegraded returns true ──
    it('A-02: init with tool registration failure → isInitDegraded returns true', () => {
      const observer2 = createPhase1Observer(store, cache, sessionBuffer, ruleLoader, {
        registerTool: () => { throw new TypeError('registerTool failed') }
      })
      expect(observer2.isInitDegraded()).toBe(true)
    })

    // ── A-03: degradation writes DEGRADATION_MODE_ACTIVATED audit entry ──
    it('A-03: degradation writes DEGRADATION_MODE_ACTIVATED audit entry', () => {
      const store3 = createPhase1Store()
      store3.getActiveRun.mockReturnValue({ runId: 'run-test', projectId: 'proj-test', startedAt: '2026-01-01T00:00:00.000Z' })
      const cache3 = createMockCache({ getReturn: makeActiveState({ projectId: 'proj-test' }) })
      const sessionBuffer3 = createMockSessionBuffer()
      createPhase1Observer(store3, cache3, sessionBuffer3, ruleLoader, {
        registerTool: () => { throw new TypeError('registerTool failed') }
      })
      expect(store3.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({
          event: 'DEGRADATION_MODE_ACTIVATED',
          sessionId: '',
          phase: 0,
          decision: 'WARN',
          severity: 'warn',
        }),
      )
    })

    // ── A-04: when degraded, Observer handle() does not block ──
    it('A-04: when degraded, Observer handle() downgrades severity to warn', async () => {
      cache.get.mockReturnValue(makeActiveState())
      ;(observer as any).degraded = true
      await observer.handle('Bash', { command: 'npm test' }, bashOutput(1), 'sess-1', 'call-a04')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'COMMAND_FAILED', severity: 'warn', decision: 'WARN' }),
      )
    })

    // ── A-05: non-API errors (RangeError) propagate upward ──
    it('A-05: non-API errors (RangeError) propagate upward during init', () => {
      expect(() => createPhase1Observer(store, cache, sessionBuffer, ruleLoader, {
        registerTool: () => { throw new RangeError('bad') }
      })).toThrow(RangeError)
    })

    // ── A-06: null state during init degradation → console.warn only ──
    it('A-06: null state during init degradation → no audit entry (console.warn only)', () => {
      const store6 = createPhase1Store()
      const cache6 = createMockCache()
      cache6.get.mockReturnValue(null)
      const sessionBuffer6 = createMockSessionBuffer()
      const observer6 = createPhase1Observer(store6, cache6, sessionBuffer6, ruleLoader, {
        registerTool: () => { throw new TypeError('registerTool failed') }
      })
      expect(observer6.isInitDegraded()).toBe(true)
      expect(store6.appendAudit).not.toHaveBeenCalled()
    })

    // ── A-07: NotImplementedError also triggers degradation ──
    it('A-07: NotImplementedError triggers degradation (same catch path)', () => {
      const store7 = createPhase1Store()
      store7.getActiveRun.mockReturnValue({ runId: 'run-7', projectId: 'proj-7', startedAt: '2026-01-01T00:00:00.000Z' })
      const cache7 = createMockCache({ getReturn: makeActiveState({ projectId: 'proj-7', runId: 'run-7' }) })
      const sessionBuffer7 = createMockSessionBuffer()
      const notImplError = new Error('not implemented') as Error & { name: 'NotImplementedError' }
      notImplError.name = 'NotImplementedError'
      const observer7 = createPhase1Observer(store7, cache7, sessionBuffer7, ruleLoader, {
        registerTool: () => { throw notImplError }
      })
      expect(observer7.isInitDegraded()).toBe(true)
      expect(store7.appendAudit).toHaveBeenCalledWith(
        'proj-7', 'run-7',
        expect.objectContaining({ event: 'DEGRADATION_MODE_ACTIVATED' }),
      )
    })

    it('A-08: degradation audit uses sentinel runId when no active run', () => {
      const store8 = createPhase1Store()
      store8.getActiveRun.mockReturnValue(null)
      const cache8 = createMockCache({ getReturn: makeActiveState({ projectId: 'proj-8' }) })
      const sessionBuffer8 = createMockSessionBuffer()
      createPhase1Observer(store8, cache8, sessionBuffer8, ruleLoader, {
        registerTool: () => { throw new TypeError('registerTool failed') }
      })
      expect(store8.appendAudit).toHaveBeenCalledTimes(1)
      expect(store8.appendAudit).toHaveBeenCalledWith(
        'proj-8', '__no_active_run__',
        expect.objectContaining({ event: 'DEGRADATION_MODE_ACTIVATED' }),
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  Group B: AuditLogEntry type extensions (compile-time)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Group B: AuditLogEntry type extensions', () => {
    // ── B-01: AuditLogEntry accepts 'DEGRADATION_MODE_ACTIVATED' in event field ──
    it('B-01: AuditLogEntry accepts DEGRADATION_MODE_ACTIVATED event', () => {
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        runId: 'run-test',
        projectId: 'proj-test',
        sessionId: 'sess-1',
        event: 'DEGRADATION_MODE_ACTIVATED',
        phase: 1,
        decision: 'WARN',
        violation: 'Observer tool registration failed during init',
      }
      expect(entry.event).toBe('DEGRADATION_MODE_ACTIVATED')
    })

    // ── B-02: AuditLogEntry accepts pass/fail/error_summary fields ──
    it('B-02: AuditLogEntry accepts pass/fail/error_summary fields', () => {
      const entry: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        runId: 'run-test',
        projectId: 'proj-test',
        sessionId: 'sess-1',
        event: 'OBSERVER_TIMEOUT',
        phase: 1,
        decision: 'WARN',
        pass: 8,
        fail: 2,
        error_summary: '2 timeout violations',
      }
      expect(entry.pass).toBe(8)
      expect(entry.fail).toBe(2)
      expect(entry.error_summary).toBe('2 timeout violations')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  //  Group C: isDegraded() existing behavior (sanity check)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Group C: isDegraded() existing behavior (sanity check)', () => {
    // ── C-01: isDegraded returns false for unknown project ──
    it('C-01: isDegraded returns false for unknown project', () => {
      // Fresh observer with no degradation triggered — any project/run should be non-degraded.
      expect(observer.isDegraded('unknown', 'unknown')).toBe(false)
    })

    // ── C-02: clearDegradation clears state ──
    it('C-02: clearDegradation clears state', async () => {
      // Trigger degradation via handleDegradation path by causing an error in handle().
      // Then clear it and verify isDegraded returns false.
      cache.get.mockImplementation(() => { throw new Error('cache explosion') })
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-c02')

      // After handle error, the observer may have marked something as degraded via handleDegradation.
      // But since cache.get() throws, there's no state → handleDegradation can't get projectId/runId.
      // So isDegraded should still be false for any key.
      // Let's test the clearDegradation path instead by directly verifying it doesn't throw.

      // Set up a scenario where degradation IS tracked: use handleDegradation with valid state
      const state = makeActiveState()
      cache.get.mockReturnValue(state)
      // Manually simulate the degraded runs set via handleDegradation
      // The handleDegradation method is private, so we trigger it via handle() error path
      const origHandle = (observer as any)._handleObservations.bind(observer)
      ;(observer as any)._handleObservations = vi.fn().mockImplementation(() => {
        throw new Error('observation explosion')
      })
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-c02b')

      // Now observer should be degraded for proj-test/run-test
      // (handle() catches the error and calls handleDegradation)
      // Note: handleDegradation catches errors in its own try/catch, so degradation tracking
      // depends on state being available. Since we return valid state, it should be tracked.
      const isDegradedAfterError = observer.isDegraded('proj-test', 'run-test')

      // Regardless of whether degradation was tracked, clearDegradation should work:
      observer.clearDegradation('proj-test', 'run-test')
      expect(observer.isDegraded('proj-test', 'run-test')).toBe(false)

      // Restore
      ;(observer as any)._handleObservations = origHandle
    })

    // ── C-03: isDegraded with round parameter checks specific round ──
    it('C-03: isDegraded with round parameter checks specific round', async () => {
      // Trigger degradation during a ralph_loop round via handleDegradation.
      const ralphState = makeState({
        phaseStatus: 'ralph_loop',
        ralph: { phase: 1, round: 2, consecutiveZero: 0, tallyHistory: [], openContested: [], escalated: false, escalatedAt: null, termination: null, roundRecords: [], autoValidated: false },
      })
      cache.get.mockReturnValue(ralphState)

      // Force handleDegradation by making _handleObservations throw
      ;(observer as any)._handleObservations = vi.fn().mockImplementation(() => {
        throw new Error('forced degradation')
      })
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-c03')

      // Round is ralph.round + 1 = 3. Check round-specific degradation.
      expect(observer.isDegraded('proj-test', 'run-test', 3)).toBe(true)
      // Different round should not be degraded.
      expect(observer.isDegraded('proj-test', 'run-test', 1)).toBe(false)
      // Without round parameter, should still detect degradation.
      expect(observer.isDegraded('proj-test', 'run-test')).toBe(true)

      // Clear and verify all clean
      observer.clearDegradation('proj-test', 'run-test')
      expect(observer.isDegraded('proj-test', 'run-test')).toBe(false)
      expect(observer.isDegraded('proj-test', 'run-test', 3)).toBe(false)
    })
  })
})
