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

  // F-026: spec ID needed — suspended→active transition. Supplemental coverage;
  // assign #161 during next spec coverage matrix update.
  // Transition matrix: suspended→active is valid (precondition for #30 defaulting).
  it('validateNestingTransition: suspended→active is valid', () => {
    const result = validateNestingTransition('suspended', 'active')
    expect(result.valid).toBe(true)
  })

  // F-007: removed duplicate 'suspended→paused is rejected' test — it was
  // identical to #52 above (same input, same assertion, no spec ID annotation).

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
  // F-021: split into parameterized test — first assertion failure was masking second.
  it.each(['active', 'awaiting_approval'])('should allow %s → suspended transition', (from) => {
    const result = validateNestingTransition(from, 'suspended')
    expect(result.valid).toBe(true)
  })

  // #138
  it('should allow transition to paused from active status', () => {
    const result = validateNestingTransition('active', 'paused')
    expect(result.valid).toBe(true)
  })

  // #128 — F-005: explicit spec ID + reason assertion. The transition itself
  // was already tested above (unlabeled), but #128 specifically requires the
  // rejection reason to mention 'pause' so future refactors can't accidentally
  // permit resume_from_pause from a non-paused status.
  // Operation-level guard (resumeFromPause checks phaseStatus==='paused') is in PipelineStore.
  it('#128 should reject resume_from_pause when not paused', () => {
    const result = validateNestingTransition('active', 'ralph_loop')
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/pause|paused/i)
  })

  // #54
  // F-001: spec #54 requires preSuspendStatus to default to 'active' when invalid
  // or undefined during recovery. The validator must REJECT unknown target statuses
  // so the recovery path can fall back to 'active'. Without this rejection, the
  // fallback branch would never fire (false-green risk in Green Phase).
  // F-026: spec ID #54 confirmed; supplemental coverage for unknown status rejection.
  it('should reject transition to unknown status (#54 fallback precondition)', () => {
    const result = validateNestingTransition('suspended', 'bogus_status')
    expect(result.valid).toBe(false)
  })
})
