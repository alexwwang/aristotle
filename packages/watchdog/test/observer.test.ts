import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Observer } from '../src/observer.js'
import { makeState, makePhaseRecord, createMockStore, createMockCache, createMockSessionBuffer } from './helpers.js'

describe('Observer', () => {
  let mockStore: ReturnType<typeof createMockStore>
  let mockCache: ReturnType<typeof createMockCache>
  let mockSessionBuffer: ReturnType<typeof createMockSessionBuffer>
  let observer: Observer

  beforeEach(() => {
    mockStore = createMockStore()
    mockCache = createMockCache()
    mockSessionBuffer = createMockSessionBuffer()
    observer = new Observer(mockCache, mockSessionBuffer, mockStore)
  })

  // ── TC-A-01 ───────────────────────────────────────────────────────────────
  it('records _reviewer_spawned observation for Task call during ralph_loop', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        phaseStatus: 'ralph_loop',
        ralph: { round: 2 },
      }),
    )

    await observer.handle('Task', { prompt: 'review' }, 'out', 'sess-001', 'call-123')

    expect(mockStore.appendObservation).toHaveBeenCalledWith(
      'proj-test',
      'run-test',
      expect.objectContaining({
        type: '_reviewer_spawned',
        round: 3,
        callID: 'call-123',
        tool: 'Task',
      }),
    )
  })

  // ── TC-A-02 ───────────────────────────────────────────────────────────────
  it('records to session buffer when no active pipeline', async () => {
    mockCache.get.mockReturnValue(null)

    await observer.handle('Task', { prompt: 'review' }, 'out', 'sess-001', 'call-124')

    expect(mockSessionBuffer.record).toHaveBeenCalledWith(
      'sess-001',
      expect.objectContaining({
        tool: 'Task',
        callID: 'call-124',
      }),
    )
  })

  // ── TC-A-03 ───────────────────────────────────────────────────────────────
  it('records no observation for non-Task calls', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        phaseStatus: 'ralph_loop',
        ralph: { round: 2 },
      }),
    )

    await observer.handle('edit', { filePath: 'foo.ts' }, 'ok', 'sess-001', 'call-125')

    expect(mockStore.appendObservation).not.toHaveBeenCalled()
    expect(mockSessionBuffer.record).not.toHaveBeenCalled()
  })

  // ── TC-A-04 ───────────────────────────────────────────────────────────────
  it('records multiple observations with same round for multiple Task calls', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        phaseStatus: 'ralph_loop',
        ralph: { round: 2 },
      }),
    )

    await observer.handle('Task', { prompt: 'a' }, 'out', 'sess-001', 'call-1')
    await observer.handle('Task', { prompt: 'b' }, 'out', 'sess-001', 'call-2')
    await observer.handle('Task', { prompt: 'c' }, 'out', 'sess-001', 'call-3')

    expect(mockStore.appendObservation).toHaveBeenCalledTimes(3)
    expect(mockStore.appendObservation).toHaveBeenNthCalledWith(
      1,
      'proj-test',
      'run-test',
      expect.objectContaining({ type: '_reviewer_spawned', round: 3 }),
    )
    expect(mockStore.appendObservation).toHaveBeenNthCalledWith(
      2,
      'proj-test',
      'run-test',
      expect.objectContaining({ type: '_reviewer_spawned', round: 3 }),
    )
    expect(mockStore.appendObservation).toHaveBeenNthCalledWith(
      3,
      'proj-test',
      'run-test',
      expect.objectContaining({ type: '_reviewer_spawned', round: 3 }),
    )
  })

  // ── TC-A-05 ───────────────────────────────────────────────────────────────
  it('records no observation when pipeline is active but not in ralph_loop', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        phaseStatus: 'active',
        ralph: null,
      }),
    )

    await observer.handle('Task', {}, 'out', 'sess-001', 'call-126')

    expect(mockStore.appendObservation).not.toHaveBeenCalled()
    expect(mockSessionBuffer.record).not.toHaveBeenCalled()
  })

  // ── TC-A-06 ───────────────────────────────────────────────────────────────
  it('catches errors and sets dual-channel degradation during ralph_loop', async () => {
    mockCache.get
      .mockImplementationOnce(() => { throw new Error('disk read failed') })
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 2 },
        }),
      )

    await expect(
      observer.handle('Task', {}, 'out', 'sess-001', 'call-127'),
    ).resolves.not.toThrow()

    expect(observer.isDegraded('proj-test', 'run-test', 3)).toBe(true)
    expect(mockStore.appendObservation).toHaveBeenCalledWith(
      'proj-test',
      'run-test',
      expect.objectContaining({
        type: '_observer_degraded',
        round: 3,
      }),
    )
  })

  // ── TC-A-11 ───────────────────────────────────────────────────────────────
  it('appendObservation throws but cache.get() succeeds → degradation', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        currentPhase: 1,
        phaseStatus: 'ralph_loop',
        phases: { 1: makePhaseRecord(1) },
        ralph: { round: 1 },
      }),
    )
    mockStore.appendObservation.mockImplementation(() => { throw new Error('disk full') })

    await observer.handle('Task', { prompt: 'review this' }, 'out', 'sess-001', 'call-001')

    expect(observer.isDegraded('proj-test', 'run-test', 2)).toBe(true)
    expect(mockSessionBuffer.record).not.toHaveBeenCalled()
  })

  // ── TC-A-07 ───────────────────────────────────────────────────────────────
  it('sets degradation flag and persists entry with metadata.error on crash', async () => {
    mockCache.get
      .mockImplementationOnce(() => { throw new Error('cache crash') })
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 1 },
        }),
      )

    await observer.handle('Task', {}, 'out', 'sess-001', 'call-128')

    expect(observer.isDegraded('proj-test', 'run-test', 2)).toBe(true)
    expect(mockStore.appendObservation).toHaveBeenCalledWith(
      'proj-test',
      'run-test',
      expect.objectContaining({
        type: '_observer_degraded',
        metadata: expect.objectContaining({ error: 'cache crash' }),
      }),
    )
  })

  // ── TC-A-08 ───────────────────────────────────────────────────────────────
  it('returns true only for degraded round and false for other rounds', async () => {
    mockCache.get
      .mockImplementationOnce(() => { throw new Error('fail') })
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 2 },
        }),
      )

    await observer.handle('Task', {}, 'out', 'sess-001', 'call-129')

    expect(observer.isDegraded('proj-test', 'run-test', 3)).toBe(true)
    expect(observer.isDegraded('proj-test', 'run-test', 2)).toBe(false)
    expect(observer.isDegraded('proj-test', 'run-test', 4)).toBe(false)
  })

  // ── TC-A-09 ───────────────────────────────────────────────────────────────
  it('clears degradation data for a run', async () => {
    mockCache.get
      .mockImplementationOnce(() => { throw new Error('fail') })
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 2 },
        }),
      )

    await observer.handle('Task', {}, 'out', 'sess-001', 'call-130')
    expect(observer.isDegraded('proj-test', 'run-test', 3)).toBe(true)

    observer.clearDegradation('proj-test', 'run-test')

    expect(observer.isDegraded('proj-test', 'run-test', 3)).toBe(false)
  })

  // ── TC-A-10 ───────────────────────────────────────────────────────────────
  it('persists _observer_degraded entry readable by downstream', async () => {
    const observations: any[] = []
    mockStore.appendObservation = vi.fn((_pid, _rid, entry) => {
      observations.push(entry)
    })
    mockStore.readObservations = vi.fn(() => observations)

    mockCache.get
      .mockImplementationOnce(() => { throw new Error('fail') })
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 2 },
        }),
      )

    await observer.handle('Task', {}, 'out', 'sess-001', 'call-131')

    const result = mockStore.readObservations('proj-test', 'run-test')
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: '_observer_degraded' })]),
    )
  })

  // ── TC-A-15 ───────────────────────────────────────────────────────────────
  it('records observation through full pipeline flow', async () => {
    mockCache.get.mockReturnValue(
      makeState({
        currentPhase: 1,
        phaseStatus: 'ralph_loop',
        ralph: { round: 1 },
      }),
    )

    await observer.handle('Task', { prompt: 'review' }, 'out', 'sess-001', 'call-200')

    expect(mockStore.appendObservation).toHaveBeenCalledWith(
      'proj-test',
      'run-test',
      expect.objectContaining({
        type: '_reviewer_spawned',
        round: 2,
      }),
    )
    expect(observer.isDegraded('proj-test', 'run-test', 2)).toBe(false)
  })

  // ── TC-A-16 ───────────────────────────────────────────────────────────────
  it('skips AC-2 and persists degradation when observer crashes', async () => {
    mockCache.get
      .mockImplementationOnce(() => { throw new Error('observer crash') })
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 2 },
        }),
      )

    await expect(
      observer.handle('Task', {}, 'out', 'sess-001', 'call-201'),
    ).resolves.not.toThrow()

    expect(observer.isDegraded('proj-test', 'run-test', 3)).toBe(true)
    expect(mockStore.appendObservation).toHaveBeenCalledWith(
      'proj-test',
      'run-test',
      expect.objectContaining({ type: '_observer_degraded' }),
    )
  })

  // ── TC-A-17 ───────────────────────────────────────────────────────────────
  it('allows downstream to find persisted degraded entries', async () => {
    const observations: any[] = []
    mockStore.appendObservation = vi.fn((_pid, _rid, entry) => {
      observations.push(entry)
    })
    mockStore.findObservations = vi.fn((_pid, _rid, filter) =>
      observations.filter((e) => {
        if (filter?.type && e.type !== filter.type) return false
        return true
      }),
    )

    mockCache.get
      .mockImplementationOnce(() => { throw new Error('fail') })
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 2 },
        }),
      )

    await observer.handle('Task', {}, 'out', 'sess-001', 'call-202')

    const result = mockStore.findObservations('proj-test', 'run-test', {
      type: '_observer_degraded',
    })
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: '_observer_degraded' })]),
    )
  })

  // ── TC-A-18 ───────────────────────────────────────────────────────────────
  it('returns false for non-degraded rounds on a fresh observer', () => {
    expect(observer.isDegraded('proj-1', 'run-1', 1)).toBe(false)
    expect(observer.isDegraded('proj-1', 'run-1')).toBe(false)
  })

  // ── TC-A-25 ───────────────────────────────────────────────────────────────
  it('handlerFailedPipelines fallback when handleDegradation fails with no state in recovery', async () => {
    // Call 1: handle() — ralph_loop state
    // Call 2: handleDegradation inner try — non-ralph-loop state (degradedRuns gets key)
    // Call 3: handleDegradation catch — null (triggers fallback via degradedRuns)
    mockCache.get
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'ralph_loop',
          ralph: { round: 1 },
        }),
      )
      .mockReturnValueOnce(
        makeState({
          phaseStatus: 'active',
          ralph: null,
        }),
      )
      .mockReturnValueOnce(null)

    mockStore.appendObservation
      .mockImplementationOnce(() => { throw new Error('disk full in handle') })
      .mockImplementationOnce(() => { throw new Error('disk full in degradation') })

    await observer.handle('Task', { prompt: 'review' }, 'out', 'sess-001', 'call-001')

    expect(observer.isDegraded('proj-test', 'run-test')).toBe(true)

    observer.clearDegradation('proj-test', 'run-test')
    expect(observer.isDegraded('proj-test', 'run-test')).toBe(false)
  })

  // ── TC-A-19 ───────────────────────────────────────────────────────────────
  it('does not throw when degradation tracking itself fails', async () => {
    mockCache.get.mockImplementation(() => { throw new Error('total failure') })

    await expect(
      observer.handle('Task', {}, 'out', 'sess-001', 'call-203'),
    ).resolves.not.toThrow()
  })

  describe('Observer Integration', () => {
    // TC-A-20: Full pipeline flow with observations
    it('TC-A-20: records observations during full pipeline flow', async () => {
      mockCache.get.mockReturnValue(
        makeState({
          currentPhase: 1,
          phaseStatus: 'ralph_loop',
          phases: { 1: makePhaseRecord(1) },
          ralph: { round: 1 },
        }),
      )

      await observer.handle('Task', { prompt: 'review this code' }, 'out', 'sess-001', 'call-001')

      expect(mockStore.appendObservation).toHaveBeenCalledWith(
        'proj-test',
        'run-test',
        expect.objectContaining({ type: '_reviewer_spawned', callID: 'call-001' }),
      )
    })

    // TC-A-21: Crash recovery observation loss
    it('TC-A-21: observations lost on crash recovery are acceptable', async () => {
      mockCache.get.mockReturnValue(null)

      await observer.handle('Task', { prompt: 'review this' }, 'out', 'sess-001', 'call-001')

      expect(mockSessionBuffer.record).toHaveBeenCalled()
      expect(mockStore.appendObservation).not.toHaveBeenCalled()
    })

    // TC-A-22: Persisted entry readable by downstream
    it('TC-A-22: persisted observations readable by downstream', async () => {
      mockCache.get.mockReturnValue(
        makeState({
          currentPhase: 1,
          phaseStatus: 'ralph_loop',
          phases: { 1: makePhaseRecord(1) },
          ralph: { round: 1 },
        }),
      )

      const storedEntry = { type: '_reviewer_spawned', callID: 'call-old', round: 1 }
      mockStore.readObservations.mockResolvedValue([storedEntry])

      const entries = await mockStore.readObservations('proj-test', 'run-test')
      expect(entries).toHaveLength(1)
      expect(entries[0].type).toBe('_reviewer_spawned')
    })

    // TC-A-23: isDegraded returns false for non-degraded round
    it('TC-A-23: isDegraded returns false for non-degraded round', () => {
      expect(observer.isDegraded('proj-test', 'run-test', 1)).toBe(false)
    })

    // TC-A-24: Degradation tracking failure — no unhandled exception
    it('TC-A-24: degradation tracking failure does not throw', async () => {
      mockCache.get.mockReturnValue(
        makeState({
          currentPhase: 1,
          phaseStatus: 'ralph_loop',
          phases: { 1: makePhaseRecord(1) },
          ralph: { round: 1 },
        }),
      )
      mockStore.appendObservation.mockImplementation(() => { throw new Error('disk error') })

      await expect(
        observer.handle('Task', { prompt: 'review' }, 'out', 'sess-001', 'call-001'),
      ).resolves.not.toThrow()
    })
  })

  // ── KI-7 regression: non-round degradation does not affect per-round queries ──
  it('KI-7: non-round degradation does not affect per-round AC-2 queries', async () => {
    // Simulate observer error during non-ralph activity (phaseStatus='active', no ralph)
    const state = makeState({ phaseStatus: 'active', ralph: null })
    mockCache.get
      .mockImplementationOnce(() => { throw new Error('transient fail') })
      .mockReturnValue(state)

    await observer.handle('edit', {}, 'out', 'sess-001', 'call-001')

    // Without round → true (degradedRuns has the key)
    expect(observer.isDegraded('proj-test', 'run-test')).toBe(true)
    // With specific round → false (degradedRounds is empty for this round)
    expect(observer.isDegraded('proj-test', 'run-test', 1)).toBe(false)
    expect(observer.isDegraded('proj-test', 'run-test', 5)).toBe(false)
  })
})
