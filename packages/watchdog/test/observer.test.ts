import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Observer } from '../src/observer.js'
import { makeState, createMockStore, createMockCache, createMockSessionBuffer } from './helpers.js'

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
    mockCache.get.mockResolvedValue(
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
    mockCache.get.mockResolvedValue(null)

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
    mockCache.get.mockResolvedValue(
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
    mockCache.get.mockResolvedValue(
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
    mockCache.get.mockResolvedValue(
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
      .mockRejectedValueOnce(new Error('disk read failed'))
      .mockResolvedValueOnce(
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

  // ── TC-A-07 ───────────────────────────────────────────────────────────────
  it('sets degradation flag and persists entry with metadata.error on crash', async () => {
    mockCache.get
      .mockRejectedValueOnce(new Error('cache crash'))
      .mockResolvedValueOnce(
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
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(
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
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(
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
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(
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
    mockCache.get.mockResolvedValue(
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
      .mockRejectedValueOnce(new Error('observer crash'))
      .mockResolvedValueOnce(
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
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(
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

  // ── TC-A-19 ───────────────────────────────────────────────────────────────
  it('does not throw when degradation tracking itself fails', async () => {
    mockCache.get.mockRejectedValue(new Error('total failure'))

    await expect(
      observer.handle('Task', {}, 'out', 'sess-001', 'call-203'),
    ).resolves.not.toThrow()
  })
})
