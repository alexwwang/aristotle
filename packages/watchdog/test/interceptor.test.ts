import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Interceptor, WatchdogInterceptError } from '../src/interceptor.js'
import { extractFilePath } from '../src/path-extractor.js'
import { classifyFile } from '../src/file-classifier.js'
import { type InterceptRule } from '../src/intercept-rules.js'
import { FALLBACK_PATTERNS } from '../src/watchdog-config.js'
import { PipelineStateCache } from '../src/state-cache.js'
import { makeState, createMockStore } from './helpers.js'

describe('Interceptor', () => {
  let mockCache: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> }
  let mockStore: ReturnType<typeof createMockStore>
  let mockLogger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  let config: Record<string, unknown>
  let ac3Rule: InterceptRule
  let ac4Rule: InterceptRule

  beforeEach(() => {
    mockCache = {
      get: vi.fn().mockReturnValue(null),
      update: vi.fn(),
      clear: vi.fn(),
    }
    mockStore = createMockStore()
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }
    config = {
      worktreeRoot: '/project',
      monitoredTools: ['edit', 'write'],
      deliverablePatterns: FALLBACK_PATTERNS,
      ignorePatterns: [],
      store: mockStore,
      logger: mockLogger,
    }

    // AC-3: Test Evidence Gate
    ac3Rule = {
      id: 'NO_BUSINESS_CODE_BEFORE_FAILING_TESTS',
      evaluate(_tool: string, _path: string, classification: any, state: any) {
        if ((state.currentPhase === 4 || state.currentPhase === 5) && classification.category === 'business_code') {
          if (state.testEvidenceConfirmed === false) {
            return {
              blocked: true,
              reason: `⛔ [TDD Watchdog] Phase ${state.currentPhase} violation: business code write blocked. Failing tests must be confirmed before writing implementation. Call tdd_checkpoint('test_evidence', ...) with your test output.`,
            }
          }
        }
        return { blocked: false }
      },
    }

    // AC-4: Phase Gate
    ac4Rule = {
      id: 'NO_PHASE_ADVANCE_WITHOUT_GATE',
      evaluate(_tool: string, _path: string, classification: any, state: any) {
        if (state.currentPhase === 4 && classification.category === 'business_code') {
          const rec = state.phases?.[state.currentPhase]
          if (!rec || !rec.ralphCompleted || !rec.userApproved) {
            const status = !rec ? 'phase not entered' : rec.ralphCompleted ? 'awaiting user approval' : 'Ralph loop incomplete'
            return {
              blocked: true,
              reason: `⛔ [TDD Watchdog] Phase transition blocked: Phase ${state.currentPhase} Ralph loop gate has not been passed (status: ${status}). Complete the Ralph loop and obtain user approval before starting Phase ${state.currentPhase + 1}.`,
            }
          }
        }
        if (state.currentPhase >= 1 && classification.category === 'phase_deliverable' && classification.phase === state.currentPhase + 1) {
          const rec = state.phases?.[state.currentPhase]
          if (!rec || !rec.ralphCompleted || !rec.userApproved) {
            const status = !rec ? 'phase not entered' : rec.ralphCompleted ? 'awaiting user approval' : 'Ralph loop incomplete'
            return {
              blocked: true,
              reason: `⛔ [TDD Watchdog] Phase transition blocked: Phase ${state.currentPhase} Ralph loop gate has not been passed (status: ${status}). Complete the Ralph loop and obtain user approval before starting Phase ${state.currentPhase + 1}.`,
            }
          }
        }
        return { blocked: false }
      },
    }
  })

  // ── TC-B-01 ───────────────────────────────────────────────────────────────
  it('returns without reading cache for non-monitored tools', async () => {
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    await interceptor.handle('read', { filePath: 'foo.ts' }, 'sess-001', 'call-300')
    expect(mockCache.get).not.toHaveBeenCalled()
  })

  // ── TC-B-02 ───────────────────────────────────────────────────────────────
  it('returns silently when cache returns null (no active pipeline)', async () => {
    mockCache.get.mockReturnValue(null)
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    await expect(interceptor.handle('edit', { filePath: 'foo.ts' }, 'sess-001', 'call-301')).resolves.toBeUndefined()
  })

  // ── TC-B-14 ───────────────────────────────────────────────────────────────
  it('Rule 1: throws for Phase 4 business code without test evidence', async () => {
    mockCache.get.mockReturnValue(makeState({ currentPhase: 4, testEvidenceConfirmed: false }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule, ac4Rule])
    await expect(
      interceptor.handle('edit', { filePath: '/project/src/foo.ts' }, 'sess-001', 'call-302'),
    ).rejects.toThrow(WatchdogInterceptError)
    await expect(
      interceptor.handle('edit', { filePath: '/project/src/foo.ts' }, 'sess-001', 'call-302'),
    ).rejects.toThrow(/business code write blocked/)
  })

  // ── TC-B-15 ───────────────────────────────────────────────────────────────
  it('Rule 1: allows business code when test evidence is confirmed', async () => {
    mockCache.get.mockReturnValue(makeState({
      currentPhase: 4,
      testEvidenceConfirmed: true,
      phases: { 4: { ralphCompleted: true, userApproved: true } },
    }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule, ac4Rule])
    await expect(
      interceptor.handle('edit', { filePath: '/project/src/foo.ts' }, 'sess-001', 'call-303'),
    ).resolves.toBeUndefined()
  })

  // ── TC-B-16 ───────────────────────────────────────────────────────────────
  it('Rule 1: allows test files even without test evidence', async () => {
    mockCache.get.mockReturnValue(makeState({ currentPhase: 4, testEvidenceConfirmed: false }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule, ac4Rule])
    await expect(
      interceptor.handle('edit', { filePath: '/project/tests/foo.test.ts' }, 'sess-001', 'call-304'),
    ).resolves.toBeUndefined()
  })

  // ── TC-B-17 ───────────────────────────────────────────────────────────────
  it('Rule 2: throws when writing next-phase deliverable before gate passes', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        currentPhase: 2,
        phases: { 2: { ralphCompleted: false, userApproved: false } },
      }),
    )
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule, ac4Rule])
    await expect(
      interceptor.handle('write', { file: 'test-plan.md' }, 'sess-001', 'call-305'),
    ).rejects.toThrow(WatchdogInterceptError)
    await expect(
      interceptor.handle('write', { file: 'test-plan.md' }, 'sess-001', 'call-305'),
    ).rejects.toThrow(/Phase transition blocked/)
  })

  // ── TC-B-18 ───────────────────────────────────────────────────────────────
  it('Rule 2: allows next-phase deliverable when current phase gate passed', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        currentPhase: 2,
        phases: { 2: { ralphCompleted: true, userApproved: true } },
      }),
    )
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule, ac4Rule])
    await expect(
      interceptor.handle('write', { file: 'test-plan.md' }, 'sess-001', 'call-306'),
    ).resolves.toBeUndefined()
  })

  // ── TC-B-19 ───────────────────────────────────────────────────────────────
  it('Rule order: AC-3 fires before AC-4 when both would apply', async () => {
    // Phase 4 + no evidence + business_code: both AC-3 and AC-4 could apply
    mockCache.get.mockReturnValue(
      makeState({
        currentPhase: 4,
        testEvidenceConfirmed: false,
        phases: { 4: { ralphCompleted: false, userApproved: false } },
      }),
    )
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule, ac4Rule])
    await expect(
      interceptor.handle('edit', { filePath: '/project/src/foo.ts' }, 'sess-001', 'call-307'),
    ).rejects.toThrow(/business code write blocked/)
  })

  // ── TC-B-20 ───────────────────────────────────────────────────────────────
  it('disk read returns state for active run in multi-agent mode', () => {
    const store = createMockStore()
    store.getActiveRun.mockReturnValue({ runId: 'run-1', projectId: 'proj-test', startedAt: new Date().toISOString() })
    store.readState.mockReturnValue(makeState())

    const cache = new PipelineStateCache(store as any, mockLogger as any, '/project', true)
    const state = cache.get()
    expect(state).not.toBeNull()
    expect(state?.runId).toBe('run-test')
  })

  // ── TC-B-21 ───────────────────────────────────────────────────────────────
  it('disk read failure returns null and logs warning', () => {
    const store = createMockStore()
    store.getActiveRun.mockImplementation(() => {
      throw new Error('corrupt state')
    })
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }

    const cache = new PipelineStateCache(store as any, logger as any, '/project', true)
    const state = cache.get()
    expect(state).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('disk read failed'), expect.anything())
  })

  // ── TC-B-22 ───────────────────────────────────────────────────────────────
  it('unexpected error throws plain Error with TDD Watchdog prefix', async () => {
    const badExtractor = vi.fn().mockImplementation(() => {
      throw new Error('classification boom')
    })
    mockCache.get.mockReturnValue(makeState({ currentPhase: 4 }))
    const interceptor = new Interceptor(mockCache, config, badExtractor, classifyFile, [ac3Rule])
    await expect(
      interceptor.handle('edit', { filePath: 'foo.ts' }, 'sess-001', 'call-308'),
    ).rejects.toThrow(/\[TDD Watchdog\]/)
  })

  // ── TC-B-23 ───────────────────────────────────────────────────────────────
  it('unexpected error message includes restart pipeline guidance', async () => {
    const badExtractor = vi.fn().mockImplementation(() => {
      throw new Error('classification boom')
    })
    mockCache.get.mockReturnValue(makeState({ currentPhase: 4 }))
    const interceptor = new Interceptor(mockCache, config, badExtractor, classifyFile, [ac3Rule])
    await expect(
      interceptor.handle('edit', { filePath: 'foo.ts' }, 'sess-001', 'call-309'),
    ).rejects.toThrow(/restart the pipeline/)
  })

  // ── TC-B-24 ───────────────────────────────────────────────────────────────
  it('thrown violation is instanceof WatchdogInterceptError', async () => {
    mockCache.get.mockReturnValue(makeState({ currentPhase: 4, testEvidenceConfirmed: false }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    await expect(
      interceptor.handle('edit', { filePath: '/project/src/foo.ts' }, 'sess-001', 'call-310'),
    ).rejects.toBeInstanceOf(WatchdogInterceptError)
  })

  // ── TC-B-25 ───────────────────────────────────────────────────────────────
  it('unexpected error is NOT instanceof WatchdogInterceptError', async () => {
    mockCache.get.mockImplementation(() => {
      throw new Error('cache explosion')
    })
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    try {
      await interceptor.handle('edit', { filePath: 'foo.ts' }, 'sess-001', 'call-311')
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).not.toBeInstanceOf(WatchdogInterceptError)
    }
  })

  // ── TC-B-32 ───────────────────────────────────────────────────────────────
  it('intercepts hashline_edit when in custom monitoredTools', async () => {
    const customConfig = { ...config, monitoredTools: ['edit', 'write', 'hashline_edit'] }
    mockCache.get.mockReturnValue(makeState({ currentPhase: 4, testEvidenceConfirmed: false }))
    const interceptor = new Interceptor(mockCache, customConfig, extractFilePath, classifyFile, [ac3Rule])
    await expect(
      interceptor.handle('hashline_edit', { filePath: '/project/src/foo.ts' }, 'sess-001', 'call-312'),
    ).rejects.toThrow(WatchdogInterceptError)
  })

  // ── TC-B-33 ───────────────────────────────────────────────────────────────
  it('does not intercept hashline_edit with default monitoredTools', async () => {
    mockCache.get.mockReturnValue(makeState({ currentPhase: 4, testEvidenceConfirmed: false }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    await interceptor.handle('hashline_edit', { filePath: '/project/src/foo.ts' }, 'sess-001', 'call-313')
    expect(mockCache.get).not.toHaveBeenCalled()
  })

  // ── TC-B-36 ───────────────────────────────────────────────────────────────
  it('allows tool calls from pipeline owner session', async () => {
    mockCache.get.mockReturnValue(makeState({ ownerSessionId: 'sess-orchestrator' }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    await expect(
      interceptor.handle('edit', { filePath: 'foo.ts' }, 'sess-orchestrator', 'call-314'),
    ).resolves.toBeUndefined()
  })

  // ── TC-B-37 (updated: ownership NOT in interceptor per H-1 fix) ────────
  it('does NOT block non-owner session — ownership is checkpoint-only', async () => {
    mockCache.get.mockReturnValue(makeState({ ownerSessionId: 'sess-orchestrator' }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    // Interceptor does NOT check ownership — it only checks TDD invariants
    // Ownership enforcement belongs to CheckpointHandler (§15a L2)
    await expect(
      interceptor.handle('edit', { filePath: '/project/tests/foo.test.ts' }, 'sess-sub-agent', 'call-315'),
    ).resolves.toBeUndefined()
  })

  // ── TC-B-38 (updated: single-pipeline constraint is checkpoint-only) ──
  it('does NOT enforce single-pipeline constraint — that is checkpoint-only', async () => {
    mockCache.get.mockReturnValue(makeState({ ownerSessionId: 'sess-orchestrator' }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    await expect(
      interceptor.handle('edit', { filePath: '/project/tests/foo.test.ts' }, 'sess-sub-agent', 'call-316'),
    ).resolves.toBeUndefined()
  })

  // ── TC-B-39 (updated: ownership audit is checkpoint-only) ──────────────
  it('does NOT log ownership audit in interceptor — that is checkpoint-only', async () => {
    mockCache.get.mockReturnValue(makeState({ ownerSessionId: 'sess-orchestrator' }))
    const interceptor = new Interceptor(mockCache, config, extractFilePath, classifyFile, [ac3Rule])
    await interceptor.handle('edit', { filePath: '/project/tests/foo.test.ts' }, 'sess-sub-agent', 'call-317')
    // Interceptor does NOT call appendAudit for ownership — that's checkpoint's job
    expect(mockStore.appendAudit).not.toHaveBeenCalled()
  })

  // ── TC-B-40 ───────────────────────────────────────────────────────────────
  it('disk read consistency: sub-agent sees orchestrator writes', () => {
    const store = createMockStore()
    store.getActiveRun.mockReturnValue({ runId: 'run-test', projectId: 'proj-test', startedAt: new Date().toISOString() })

    const state1 = makeState({ currentPhase: 2 })
    store.readState.mockReturnValue(state1)

    const cache = new PipelineStateCache(store as any, mockLogger as any, '/project', true)
    expect(cache.get()?.currentPhase).toBe(2)

    // Simulate orchestrator writing new state
    const state2 = makeState({ currentPhase: 3 })
    store.readState.mockReturnValue(state2)
    expect(cache.get()?.currentPhase).toBe(3)
  })
})
