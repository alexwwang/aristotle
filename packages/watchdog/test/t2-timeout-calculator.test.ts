import { describe, it, expect } from 'vitest'
import { calculateT2Timeout } from '../src/t2-timeout.js'

describe('T-2 Timeout Calculator', () => {
  // TC-T2-001
  it('should_calculate_full_285s_timeout', () => {
    const result = calculateT2Timeout({
      budgetSeconds: 300,
      elapsedSeconds: 5,
      marginSeconds: 10,
      createdAt: '2026-06-06T10:00:00.000Z',
    })
    expect(result.timeout).toBe(285)
  })

  // TC-T2-002
  it('should_calculate_minimum_30s_timeout', () => {
    const result = calculateT2Timeout({
      budgetSeconds: 300,
      elapsedSeconds: 270,
      marginSeconds: 10,
      createdAt: '2026-06-06T10:00:00.000Z',
    })
    expect(result.timeout).toBe(30)
  })

  // TC-T2-003
  it('should_log_warning_below_60s', () => {
    const result = calculateT2Timeout({
      budgetSeconds: 300,
      elapsedSeconds: 240,
      marginSeconds: 10,
      createdAt: '2026-06-06T10:00:00.000Z',
    })
    expect(result.warning).toBeDefined()
  })

  // TC-T2-004
  it('should_use_current_time_when_createdat_missing', () => {
    const result = calculateT2Timeout({
      budgetSeconds: 300,
      elapsedSeconds: 0,
      marginSeconds: 10,
      createdAt: null,
    })
    expect(result.timeout).toBeGreaterThanOrEqual(30)
    expect(result.warning).toBeDefined()
  })

  // TC-T2-005
  it('should_calculate_child_pipeline_timeout', () => {
    const result = calculateT2Timeout({
      budgetSeconds: 300,
      elapsedSeconds: 0,
      marginSeconds: 10,
      createdAt: '2026-06-06T10:00:00.000Z',
      isChildPipeline: true,
      childCreatedAt: '2026-06-06T10:01:40.000Z',
    })
    expect(result.timeout).toBeGreaterThan(0)
  })
})
