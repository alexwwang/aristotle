import { describe, it, expect } from 'vitest'
import { scanRPS, isRPSDisabled, resetRPSFailureCounter } from '../src/rps-scanner.js'

describe('RPS Scanner', () => {
  // RT-053a
  it('should_detect_all_12_rps_patterns_in_prompt', () => {
    const result = scanRPS('test pattern for bypass', 'prompt')
    expect(result.detected).toBe(true)
  })

  // RT-053b
  it('should_warn_but_not_block_on_rps_match', () => {
    const result = scanRPS('some prohibited pattern text', 'prompt')
    expect(result.detected).toBe(true)
  })

  // RT-053c
  it('should_skip_scan_on_empty_prompt', () => {
    const result = scanRPS('', 'prompt')
    expect(result.detected).toBe(false)
  })

  // RT-053d
  it('should_detect_rps_patterns_in_description_field', () => {
    const result = scanRPS('prohibited pattern text', 'description')
    expect(result.detected).toBe(true)
  })

  // RT-054a
  it('should_disable_rps_after_3_consecutive_failures', () => {
    const result = isRPSDisabled({ rpsConsecutiveFailures: 3 })
    expect(result).toBe(true)
  })

  // RT-054b
  it('should_skip_rps_scan_after_disabled', () => {
    const state = { rpsConsecutiveFailures: 3 }
    const isDisabled = isRPSDisabled(state)
    expect(isDisabled).toBe(true)
    const result = scanRPS('prohibited pattern text', 'prompt')
    expect(result.detected).toBe(false)
  })

  // RT-054c
  it('should_reset_consecutive_failure_counter_on_success', () => {
    const state = { rpsConsecutiveFailures: 2 }
    resetRPSFailureCounter(state)
    expect(state.rpsConsecutiveFailures).toBe(0)
  })
})
