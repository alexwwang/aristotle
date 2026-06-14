import { describe, it, expect } from 'vitest'
import { validateNestingTransition } from '../src/transitions.js'

describe('transitions - pipeline nesting', () => {
  // #46
  it('should allow transition from active to suspended', () => {
    const result = validateNestingTransition('ralph_loop', 'suspended')
    expect(result.valid).toBe(true)
  })

  // #47
  it('should allow transition from suspended to preSuspendStatus', () => {
    const result = validateNestingTransition('suspended', 'ralph_loop')
    expect(result.valid).toBe(true)
  })

  // #48
  it('should allow transition from active to paused', () => {
    const result = validateNestingTransition('ralph_loop', 'paused')
    expect(result.valid).toBe(true)
  })

  // #49
  it('should allow transition from paused to prePauseStatus', () => {
    const result = validateNestingTransition('paused', 'ralph_loop')
    expect(result.valid).toBe(true)
  })

  // #50
  it('should reject transition from suspended to suspended', () => {
    const result = validateNestingTransition('suspended', 'suspended')
    expect(result.valid).toBe(false)
  })

  // #51
  it('should reject transition from paused to suspended', () => {
    const result = validateNestingTransition('paused', 'suspended')
    expect(result.valid).toBe(false)
  })

  // #52
  it('should reject transition from suspended to paused', () => {
    const result = validateNestingTransition('suspended', 'paused')
    expect(result.valid).toBe(false)
  })

  // #53
  it('should reject transition from awaiting_approval to paused', () => {
    const result = validateNestingTransition('awaiting_approval', 'paused')
    expect(result.valid).toBe(false)
  })

  // #54 — validateNestingTransition('suspended','active') verifies the resumed
  // transition is valid after corruption recovery defaults preSuspendStatus to
  // 'active'. The defaulting logic itself is tested in pipeline-store-pn #30.
  it('should default to active and return valid when preSuspendStatus is invalid during corruption recovery', () => {
    const result = validateNestingTransition('suspended', 'active')
    expect(result.valid).toBe(true)
  })

  // #98
  it('should reject transition from paused to paused', () => {
    const result = validateNestingTransition('paused', 'paused')
    expect(result.valid).toBe(false)
  })

  // #107
  it.each(['ralph_loop', 'active', 'awaiting_approval', 'suspended'])(
    'should allow phase_fail transition from %s to failed',
    (from) => {
      const result = validateNestingTransition(from, 'failed')
      expect(result.valid).toBe(true)
    },
  )

  // #131
  it('should allow transition from active to cancelled', () => {
    const result = validateNestingTransition('active', 'cancelled')
    expect(result.valid).toBe(true)
  })

  // #132
  it('should allow transition from ralph_loop to cancelled', () => {
    const result = validateNestingTransition('ralph_loop', 'cancelled')
    expect(result.valid).toBe(true)
  })

  // #133
  it('should allow transition from suspended to cancelled', () => {
    const result = validateNestingTransition('suspended', 'cancelled')
    expect(result.valid).toBe(true)
  })

  // #134
  it('should reject transition from idle to cancelled', () => {
    const result = validateNestingTransition('idle', 'cancelled')
    expect(result.valid).toBe(false)
  })

  // #135
  it('should reject transition from complete to cancelled', () => {
    const result = validateNestingTransition('complete', 'cancelled')
    expect(result.valid).toBe(false)
  })

  // #136
  it('should reject transition from paused to cancelled', () => {
    const result = validateNestingTransition('paused', 'cancelled')
    expect(result.valid).toBe(false)
  })

  // #137
  it('should allow transition to suspended from active and awaiting_approval', () => {
    const resultActive = validateNestingTransition('active', 'suspended')
    expect(resultActive.valid).toBe(true)
    const resultAwaiting = validateNestingTransition('awaiting_approval', 'suspended')
    expect(resultAwaiting.valid).toBe(true)
  })

  // #138
  it('should allow transition to paused from active status', () => {
    const result = validateNestingTransition('active', 'paused')
    expect(result.valid).toBe(true)
  })

  // #128 — validateNestingTransition('active','ralph_loop') is rejected because
  // active→ralph_loop is not a direct transition (requires phase_enter first).
  // This covers the resume_from_pause guard at transition level; the operation-
  // level guard (resumeFromPause checks phaseStatus==='paused') is in PipelineStore.
  it('should reject resume from pause when not paused', () => {
    const result = validateNestingTransition('active', 'ralph_loop')
    expect(result.valid).toBe(false)
  })
})
