/**
 * Observer Phase 1 — Bash/Write interception, auto-resolve, timeout degradation.
 * Tests AC-1 (JSON/YAML syntax), AC-2 (Bash failure), AC-3 (false positive),
 * AC-5 (performance baseline), AC-6 (auto-resolve), AC-7 (timeout degradation),
 * plus PipelineState field lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Observer } from '../src/observer.js'
import { makeState as _makeState, createMockStore, createMockCache, createMockSessionBuffer } from './helpers.js'
import type { PipelineState } from '../src/schema.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<PipelineState> = {}): PipelineState {
  return _makeState({ projectId: 'proj-test', runId: 'run-test', ...overrides })
}

/** Active pipeline state (NOT ralph_loop) — Phase 1 observes here. */
function makeActiveState(overrides: Partial<PipelineState> = {}): PipelineState {
  return makeState({ phaseStatus: 'active', ralph: null, ...overrides })
}

/** Create a mock store with Phase 1 methods.
 *  C2: getUnresolvedViolations and resolveViolations are SYNC. */
interface Phase1Store extends ReturnType<typeof createMockStore> {
  getUnresolvedViolations: ReturnType<typeof vi.fn>
  resolveViolations: ReturnType<typeof vi.fn>
}
function createPhase1Store(): Phase1Store {
  const store = createMockStore() as Phase1Store
  store.getUnresolvedViolations = vi.fn().mockReturnValue([])
  store.resolveViolations = vi.fn().mockReturnValue(undefined)
  return store
}

/** Create a mock rule config loader for Phase 1.
 *  C5: Per spec §3.0.5, RuleConfigLoader.load(ruleName) returns a single RuleConfig. */
function createMockRuleConfigLoader(overrides?: {
  ignoreCommands?: string[]
  ignoreExitCodes?: number[]
}) {
  return {
    load: vi.fn().mockImplementation((name: string) => {
      const defaults = {
        enabled: true,
        severity: 'block' as const,
        ignoreExitCodes: [] as number[],
        ignoreCommands: [] as string[],
      }
      if (name === 'COMMAND_RESULT_CHECK') return { ...defaults, ...(overrides ?? {}) }
      if (name === 'SYNTAX_CHECK_POST_WRITE') return { ...defaults, extensions: ['.json', '.yaml', '.yml'] }
      if (name === 'FILE_SIZE_CHECK') return { ...defaults, severity: 'warn' as const, maxFileSize: 102400 }
      if (name === 'OBSERVER_TIMEOUT') return { ...defaults }
      return defaults
    }),
  }
}

/** Normalize a Bash command string (trim whitespace, collapse spaces). */
function normalizeCommand(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ')
}

/** Make a Bash output string with exit code. */
function bashOutput(exitCode: number, stdout = ''): string {
  return stdout + (stdout ? '\n' : '') + `exit code: ${exitCode}`
}

/** Create an Observer with Phase 1 constructor (ruleConfigLoader injected as 5th arg). */
function createPhase1Observer(
  store: ReturnType<typeof createPhase1Store>,
  cache: ReturnType<typeof createMockCache>,
  sessionBuffer: ReturnType<typeof createMockSessionBuffer>,
  ruleLoader?: ReturnType<typeof createMockRuleConfigLoader>,
): Observer {
  // C5: Observer constructor accepts 5th parameter: ruleConfigLoader
  const Ctor = Observer as any
  return new Ctor(cache, sessionBuffer, store, undefined, ruleLoader) as Observer
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('Observer Phase 1', () => {
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
  // AC-1: JSON/YAML syntax interception (12 patterns + 1 negative)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('AC-1: JSON syntax interception', () => {
    const invalidJsonCases: Array<{ id: string; content: string; filePath?: string; desc: string }> = [
      { id: '01', content: '{"key": "value"', desc: 'missing closing brace' },
      { id: '02', content: '{"key": "value",}', desc: 'trailing comma' },
      { id: '03', content: "{'key': 'value'}", desc: 'single quotes' },
      { id: '04', content: '{"key": undefined}', desc: 'undefined value' },
      { id: '05', content: '{"key": }', desc: 'missing value' },
      { id: '06', content: '{"key": "val"}]', desc: 'extra closing bracket' },
      { id: '07', content: '{"key": "\x00"}', desc: 'control character' },
      { id: '09', content: '{"key": "\\q"}', desc: 'invalid escape' },
      { id: '10', content: '{key: "value"}', desc: 'non-string key' },
      // M5: YAML syntax error tests
      { id: '11', content: 'key: [unclosed', filePath: 'bad.yaml', desc: 'invalid YAML array' },
      { id: '12', content: 'key: !!js/function "f()"', filePath: 'bad.yml', desc: 'YAML JS type injection' },
    ]

    for (const { id, content, filePath, desc } of invalidJsonCases) {
      it(`TC-OBS1-${id}: detects ${desc}`, async () => {
        cache.get.mockReturnValue(makeActiveState())
        const fp = filePath ?? 'config.json'
        await observer.handle('Write', { filePath: fp }, content, 'sess-1', 'call-1')
        expect(store.appendAudit).toHaveBeenCalledWith(
          'proj-test', 'run-test',
          expect.objectContaining({
            event: 'SYNTAX_ERROR_POST_WRITE',
            filePath: fp,
            severity: 'block',
          }),
        )
      })
    }

    // ── TC-OBS1-08 ──
    it('TC-OBS1-08: duplicate keys (valid JSON) → no audit entry', async () => {
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Write', { filePath: 'dup.json' }, '{"a":1,"a":2}', 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'SYNTAX_ERROR_POST_WRITE' }),
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-2: Bash failure detection (20 scenarios)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('AC-2: Bash failure detection', () => {
    const exitCodes = [1, 2, 127, 128, 130, 255, 137, 126, 139, 3]

    // TC-OBS1-11 through TC-OBS1-20: various exit codes
    for (let i = 0; i < exitCodes.length; i++) {
      const code = exitCodes[i]
      it(`TC-OBS1-${11 + i}: exit code ${code} → COMMAND_FAILED`, async () => {
        cache.get.mockReturnValue(makeActiveState())
        await observer.handle('Bash', { command: 'npm test' }, bashOutput(code), 'sess-1', `call-${code}`)
        expect(store.appendAudit).toHaveBeenCalledWith(
          'proj-test', 'run-test',
          expect.objectContaining({
            event: 'COMMAND_FAILED',
            command: expect.any(String),
            severity: 'block',
          }),
        )
      })
    }

    // ── TC-OBS1-21 ──
    it('TC-OBS1-21: output with "exit code: N" format', async () => {
      cache.get.mockReturnValue(makeActiveState())
      for (const code of [1, 2, 127]) {
        store.appendAudit.mockClear()
        await observer.handle('Bash', { command: 'run' }, `stdout\nexit code: ${code}`, 'sess-1', `call-${code}`)
        expect(store.appendAudit).toHaveBeenCalledWith(
          'proj-test', 'run-test',
          expect.objectContaining({ event: 'COMMAND_FAILED' }),
        )
      }
    })

    // ── TC-OBS1-22 ──
    it('TC-OBS1-22: multiline output with exit code in different positions', async () => {
      cache.get.mockReturnValue(makeActiveState())
      const outputs = [
        `line1\nline2\nexit code: 1`,
        `exit code: 1\nline1\nline2`,
        `line1\nexit code: 1\nline2`,
      ]
      for (const output of outputs) {
        store.appendAudit.mockClear()
        await observer.handle('Bash', { command: 'test' }, output, 'sess-1', 'call-1')
        expect(store.appendAudit).toHaveBeenCalledWith(
          'proj-test', 'run-test',
          expect.objectContaining({ event: 'COMMAND_FAILED' }),
        )
      }
    })

    // ── TC-OBS1-23 ──
    it('TC-OBS1-23: very long output with exit code', async () => {
      cache.get.mockReturnValue(makeActiveState())
      const longOutput = 'x'.repeat(10000) + '\nexit code: 1'
      await observer.handle('Bash', { command: 'test' }, longOutput, 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'COMMAND_FAILED' }),
      )
    })

    // ── TC-OBS1-24 ──
    it('TC-OBS1-24: mixed line endings (CRLF/LF) with exit code', async () => {
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Bash', { command: 'test' }, 'line1\r\nexit code: 1', 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'COMMAND_FAILED' }),
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-3: False interception rate (8 cases)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('AC-3: False interception rate', () => {
    // ── TC-OBS1-25 ──
    it('TC-OBS1-25: successful Bash (exit 0) → no COMMAND_FAILED', async () => {
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Bash', { command: 'echo ok' }, bashOutput(0, 'ok'), 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'COMMAND_FAILED' }),
      )
    })

    // ── TC-OBS1-26 ──
    it('TC-OBS1-26: command in ignoreCommands list → no audit', async () => {
      // C5: ignoreCommands set on mock loader, NOT on state.observerConfig
      const loaderWithIgnores = createMockRuleConfigLoader({ ignoreCommands: ['git status', 'ls*'] })
      observer = createPhase1Observer(store, cache, sessionBuffer, loaderWithIgnores)
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Bash', { command: 'git status' }, bashOutput(1), 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'COMMAND_FAILED' }),
      )
    })

    // ── TC-OBS1-27 ──
    it('TC-OBS1-27: exit code in ignoreExitCodes list → no audit', async () => {
      // C5: ignoreExitCodes set on mock loader, NOT on state.observerConfig
      const loaderWithIgnores = createMockRuleConfigLoader({ ignoreExitCodes: [130] })
      observer = createPhase1Observer(store, cache, sessionBuffer, loaderWithIgnores)
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Bash', { command: 'test' }, bashOutput(130), 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'COMMAND_FAILED' }),
      )
    })

    // ── TC-OBS1-28 ──
    it('TC-OBS1-28: Write with valid JSON → no SYNTAX_ERROR', async () => {
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Write', { filePath: 'ok.json' }, '{"valid": true}', 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'SYNTAX_ERROR_POST_WRITE' }),
      )
    })

    // ── TC-OBS1-29 ──
    it('TC-OBS1-29: Write with valid YAML → no SYNTAX_ERROR', async () => {
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Write', { filePath: 'ok.yaml' }, 'key: value\nlist:\n  - a', 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'SYNTAX_ERROR_POST_WRITE' }),
      )
    })

    // ── TC-OBS1-30 ──
    it('TC-OBS1-30: Write to non-.json/.yaml file → no syntax check', async () => {
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Write', { filePath: 'style.css' }, '{{invalid json}}', 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'SYNTAX_ERROR_POST_WRITE' }),
      )
    })

    // ── TC-OBS1-31 ──
    it('TC-OBS1-31: Write with empty content → no audit', async () => {
      cache.get.mockReturnValue(makeActiveState())
      await observer.handle('Write', { filePath: 'empty.json' }, '', 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'SYNTAX_ERROR_POST_WRITE' }),
      )
    })

    // ── TC-OBS1-32 ──
    it('TC-OBS1-32: Write with content under 100KB → no FILE_TOO_LARGE', async () => {
      cache.get.mockReturnValue(makeActiveState())
      const content = '{ "data": "' + 'x'.repeat(1000) + '" }'
      await observer.handle('Write', { filePath: 'small.json' }, content, 'sess-1', 'call-1')
      expect(store.appendAudit).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'FILE_TOO_LARGE_FOR_CHECK' }),
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-6: Auto-resolve (5 sequences)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('AC-6: Auto-resolve', () => {
    // ── TC-OBS1-33 ──
    it('TC-OBS1-33: Bash fail → Bash success → resolved', async () => {
      cache.get.mockReturnValue(makeActiveState())

      // Fail
      await observer.handle('Bash', { command: 'npm test' }, bashOutput(1), 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'COMMAND_FAILED', resolved: false }),
      )

      // Success — mock returns entries WITH timestamps
      const ts = '2026-01-01T00:00:00.000Z'
      store.getUnresolvedViolations.mockReturnValue([
        { event: 'COMMAND_FAILED', command: normalizeCommand('npm test'), timestamp: ts },
      ])
      await observer.handle('Bash', { command: 'npm test' }, bashOutput(0, 'ok'), 'sess-1', 'call-2')
      // C1: resolveViolations called with timestamps string array, NOT object
      expect(store.resolveViolations).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        [ts],
      )
    })

    // ── TC-OBS1-34 ──
    it('TC-OBS1-34: Write syntax error → Write success → resolved', async () => {
      cache.get.mockReturnValue(makeActiveState())

      // Error
      await observer.handle('Write', { filePath: 'data.json' }, '{bad', 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'SYNTAX_ERROR_POST_WRITE', resolved: false }),
      )

      // Fix — entries with timestamps
      const ts = '2026-01-01T00:00:01.000Z'
      store.getUnresolvedViolations.mockReturnValue([
        { event: 'SYNTAX_ERROR_POST_WRITE', filePath: 'data.json', timestamp: ts },
      ])
      await observer.handle('Write', { filePath: 'data.json' }, '{"good": true}', 'sess-1', 'call-2')
      // C1: resolveViolations called with timestamps string array
      expect(store.resolveViolations).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        [ts],
      )
    })

    // ── TC-OBS1-35 ──
    it('TC-OBS1-35: OBSERVER_TIMEOUT → any success → resolved', async () => {
      cache.get.mockReturnValue(makeActiveState())

      // Simulate a pre-existing timeout violation with timestamp
      const ts = '2026-01-01T00:00:02.000Z'
      store.getUnresolvedViolations.mockReturnValue([
        { event: 'OBSERVER_TIMEOUT', severity: 'block', timestamp: ts },
      ])
      await observer.handle('Bash', { command: 'echo ok' }, bashOutput(0, 'ok'), 'sess-1', 'call-1')
      // C1: resolveViolations called with timestamps string array
      expect(store.resolveViolations).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        [ts],
      )
    })

    // ── TC-OBS1-36 ──
    it('TC-OBS1-36: Bash fail for cmd A → success for cmd B → A NOT resolved', async () => {
      cache.get.mockReturnValue(makeActiveState())

      // Fail for cmd A
      await observer.handle('Bash', { command: 'npm test' }, bashOutput(1), 'sess-1', 'call-1')

      // Success for cmd B (different command)
      const ts = '2026-01-01T00:00:03.000Z'
      store.getUnresolvedViolations.mockReturnValue([
        { event: 'COMMAND_FAILED', command: normalizeCommand('npm test'), timestamp: ts },
      ])
      await observer.handle('Bash', { command: 'npm build' }, bashOutput(0, 'ok'), 'sess-1', 'call-2')

      // resolveViolations should NOT be called for cmd A (different normalized command)
      expect(store.resolveViolations).not.toHaveBeenCalledWith(
        'proj-test', 'run-test',
        [ts],
      )
    })

    // ── TC-OBS1-37 ──
    it('TC-OBS1-37: >100 unresolved → skip resolve, log RESOLVE_SKIPPED_TOO_MANY', async () => {
      cache.get.mockReturnValue(makeActiveState({
        auditEntryCount: 150,
        evictionNeeded: true,
      } as any))
      store.getUnresolvedViolations.mockReturnValue(
        Array.from({ length: 101 }, (_, i) => ({
          event: 'COMMAND_FAILED',
          command: `cmd-${i}`,
          timestamp: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
        })),
      )

      await observer.handle('Bash', { command: 'echo ok' }, bashOutput(0, 'ok'), 'sess-1', 'call-1')
      // When >100 violations, resolve should be skipped
      expect(store.resolveViolations).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-7: Timeout degradation (6 cases)
  // C3: Test via public API by making _handleObservations slow (exceeds 20ms budget).
  //     No _recordTimeout or _timedOut — these methods don't exist.
  // ═══════════════════════════════════════════════════════════════════════════
  describe('AC-7: Timeout degradation', () => {
    /** Make _handleObservations slow to trigger timeout (>20ms budget). */
    function makeSlowObserver(obs: Observer) {
      ;(obs as any)._handleObservations = vi.fn().mockImplementation(
        () => new Promise(r => setTimeout(r, 50)),
      )
    }

    // ── TC-OBS1-38 ──
    it('TC-OBS1-38: observerTimeoutCount=0 → timeout → severity=block', async () => {
      const state = makeActiveState({ observerTimeoutCount: 0 } as any)
      cache.get.mockReturnValue(state)
      makeSlowObserver(observer)
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'OBSERVER_TIMEOUT', severity: 'block' }),
      )
    })

    // ── TC-OBS1-39 ──
    it('TC-OBS1-39: observerTimeoutCount=1 → timeout → severity=block', async () => {
      const state = makeActiveState({ observerTimeoutCount: 1 } as any)
      cache.get.mockReturnValue(state)
      makeSlowObserver(observer)
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'OBSERVER_TIMEOUT', severity: 'block' }),
      )
    })

    // ── TC-OBS1-40 ──
    it('TC-OBS1-40: observerTimeoutCount=2 → timeout → severity=warn (degraded)', async () => {
      const state = makeActiveState({ observerTimeoutCount: 2 } as any)
      cache.get.mockReturnValue(state)
      makeSlowObserver(observer)
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'OBSERVER_TIMEOUT', severity: 'warn' }),
      )
    })

    // ── TC-OBS1-41 ──
    it('TC-OBS1-41: observerTimeoutCount=2 → timeout → also writes OBSERVER_TIMEOUT_DEGRADED event', async () => {
      const state = makeActiveState({ observerTimeoutCount: 2 } as any)
      cache.get.mockReturnValue(state)
      makeSlowObserver(observer)
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'OBSERVER_TIMEOUT_DEGRADED' }),
      )
    })

    // ── TC-OBS1-42 ──
    it('TC-OBS1-42: after auto-resolving OBSERVER_TIMEOUT, next timeout is block (count was reset)', async () => {
      // Start with count=2, resolve the timeout via success
      const state = makeActiveState({ observerTimeoutCount: 2 } as any)
      cache.get.mockReturnValue(state)

      const ts = '2026-01-01T00:00:00.000Z'
      store.getUnresolvedViolations.mockReturnValue([
        { event: 'OBSERVER_TIMEOUT', severity: 'block', timestamp: ts },
      ])
      // A successful Bash that resolves the timeout (count should reset to 0)
      await observer.handle('Bash', { command: 'echo ok' }, bashOutput(0, 'ok'), 'sess-1', 'call-1')
      expect(store.resolveViolations).toHaveBeenCalledWith('proj-test', 'run-test', [ts])

      // Now simulate next timeout — count should be 0 again, so severity=block
      cache.get.mockReturnValue(makeActiveState({ observerTimeoutCount: 0 } as any))
      makeSlowObserver(observer)
      store.appendAudit.mockClear()
      await observer.handle('Bash', { command: 'test' }, 'output', 'sess-1', 'call-2')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'OBSERVER_TIMEOUT', severity: 'block' }),
      )
    })

    // ── TC-OBS1-43 ──
    it('TC-OBS1-43: after timeout, _timedOut prevents subsequent COMMAND_FAILED in same handle() call', async () => {
      // Trigger timeout via slow _handleObservations — the Bash also has exit code 1
      const state = makeActiveState({ observerTimeoutCount: 0 } as any)
      cache.get.mockReturnValue(state)
      makeSlowObserver(observer)
      await observer.handle('Bash', { command: 'npm test' }, bashOutput(1), 'sess-1', 'call-1')

      // Timeout should fire, but COMMAND_FAILED should NOT fire in the same handle() call
      const calls = (store.appendAudit as ReturnType<typeof vi.fn>).mock.calls
      const timeoutCalls = calls.filter((c: any[]) => c[2]?.event === 'OBSERVER_TIMEOUT')
      const failedCalls = calls.filter((c: any[]) => c[2]?.event === 'COMMAND_FAILED')
      expect(timeoutCalls.length).toBeGreaterThanOrEqual(1)
      expect(failedCalls.length).toBe(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // M6: FILE_TOO_LARGE_FOR_CHECK positive test
  // ═══════════════════════════════════════════════════════════════════════════
  describe('FILE_TOO_LARGE_FOR_CHECK', () => {
    it('TC-OBS1-44: Write with content >100KB → FILE_TOO_LARGE_FOR_CHECK', async () => {
      cache.get.mockReturnValue(makeActiveState())
      const largeContent = 'x'.repeat(101 * 1024)
      await observer.handle('Write', { filePath: 'big.json' }, largeContent, 'sess-1', 'call-1')
      expect(store.appendAudit).toHaveBeenCalledWith(
        'proj-test', 'run-test',
        expect.objectContaining({ event: 'FILE_TOO_LARGE_FOR_CHECK', severity: 'warn' }),
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-5: Performance baseline
  // ═══════════════════════════════════════════════════════════════════════════
  describe('AC-5: Performance baseline', () => {
    it('TC-OBS1-45: Observer handle completes within 20ms for typical Bash call', async () => {
      cache.get.mockReturnValue(makeActiveState())
      const start = performance.now()
      await observer.handle('Bash', { command: 'echo ok' }, bashOutput(0, 'ok'), 'sess-1', 'call-1')
      expect(performance.now() - start).toBeLessThan(20)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PipelineState field lifecycle
  // ═══════════════════════════════════════════════════════════════════════════
  describe('PipelineState field lifecycle', () => {
    it('TC-OBS1-46: observerTimeoutCount increments on timeout', async () => {
      const state = makeActiveState()
      cache.get.mockReturnValue(state)
      // Trigger timeout via slow _handleObservations
      ;(observer as any)._handleObservations = vi.fn().mockImplementation(
        () => new Promise(r => setTimeout(r, 50)),
      )
      await observer.handle('Bash', { command: 'test' }, 'out', 'sess-1', 'call-1')
      // After timeout, state.observerTimeoutCount should be 1
      expect((state as any).observerTimeoutCount).toBe(1)
    })
  })
})
