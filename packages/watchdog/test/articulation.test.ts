import { describe, it, expect } from 'vitest'
import { validateArticulation } from '../src/articulation.js'

describe('validateArticulation', () => {
  // ── TC-C-01: All 3 dimensions pass ────────────────────────────────────────
  it('TC-C-01: returns verified=true when all 3 dimensions are present', () => {
    const text =
      'This protects user data from breaches because it guards against SQL injection. ' +
      'Key risks include edge cases in input validation. ' +
      'The approach works because parameterized queries are effective.'
    const result = validateArticulation(text)
    expect(result.verified).toBe(true)
    expect(result.dimensions.what_it_protects).toBe(true)
    expect(result.dimensions.key_risks).toBe(true)
    expect(result.dimensions.why_approach_works).toBe(true)
    expect(result.missingDimension).toBeUndefined()
  })

  // ── TC-C-02: Missing what_it_protects ─────────────────────────────────────
  it('TC-C-02: returns verified=false when what_it_protects is missing', () => {
    const text =
      'Key risks include data loss and race conditions. ' +
      'The approach works because transactions ensure consistency.'
    const result = validateArticulation(text)
    expect(result.verified).toBe(false)
    expect(result.missingDimension).toBe('what_it_protects')
    expect(result.dimensions.what_it_protects).toBe(false)
    expect(result.dimensions.key_risks).toBe(true)
    expect(result.dimensions.why_approach_works).toBe(true)
  })

  // ── TC-C-03: Missing key_risks ────────────────────────────────────────────
  it('TC-C-03: returns verified=false when key_risks is missing', () => {
    const text =
      'This protects user privacy by encrypting data at rest. ' +
      'The approach works because AES-256 is effective.'
    const result = validateArticulation(text)
    expect(result.verified).toBe(false)
    expect(result.missingDimension).toBe('key_risks')
    expect(result.dimensions.what_it_protects).toBe(true)
    expect(result.dimensions.key_risks).toBe(false)
    expect(result.dimensions.why_approach_works).toBe(true)
  })

  // ── TC-C-04: Missing why_approach_works ───────────────────────────────────
  it('TC-C-04: returns verified=false when why_approach_works is missing', () => {
    const text =
      'This protects against XSS attacks. ' +
      'Key risks include untrusted user input and DOM manipulation.'
    const result = validateArticulation(text)
    expect(result.verified).toBe(false)
    expect(result.missingDimension).toBe('why_approach_works')
    expect(result.dimensions.what_it_protects).toBe(true)
    expect(result.dimensions.key_risks).toBe(true)
    expect(result.dimensions.why_approach_works).toBe(false)
  })

  // ── TC-C-05: Text too short (< 50 chars) ──────────────────────────────────
  it('TC-C-05: returns verified=false when text is too short', () => {
    const text = 'I will write tests for this.'
    expect(text.length).toBeLessThan(50)
    const result = validateArticulation(text)
    expect(result.verified).toBe(false)
    expect(result.dimensions.what_it_protects).toBe(false)
    expect(result.dimensions.key_risks).toBe(false)
    expect(result.dimensions.why_approach_works).toBe(false)
    expect(result.missingDimension).toBe('all')
    expect(result.guidance).toContain('too short')
  })

  // ── TC-C-06: Empty string ─────────────────────────────────────────────────
  it('TC-C-06: returns verified=false for empty string', () => {
    const result = validateArticulation('')
    expect(result.verified).toBe(false)
    expect(result.dimensions.what_it_protects).toBe(false)
    expect(result.dimensions.key_risks).toBe(false)
    expect(result.dimensions.why_approach_works).toBe(false)
    expect(result.missingDimension).toBe('all')
  })

  // ── TC-C-07: All dimensions missing ───────────────────────────────────────
  it('TC-C-07: returns verified=false when no dimensions are detected', () => {
    const text =
      'The weather today is quite pleasant with a gentle breeze. ' +
      'I spent the morning gardening and watering the plants in the backyard.'
    const result = validateArticulation(text)
    expect(result.verified).toBe(false)
    expect(result.dimensions.what_it_protects).toBe(false)
    expect(result.dimensions.key_risks).toBe(false)
    expect(result.dimensions.why_approach_works).toBe(false)
    expect(result.missingDimension).toBe('what_it_protects')
  })

  // ── TC-C-08: Minimum length boundary (exactly 50 chars) ───────────────────
  it('TC-C-08: passes length check at exactly 50 characters', () => {
    const text = 'a'.repeat(50)
    expect(text.length).toBe(50)
    const result = validateArticulation(text)
    // At exactly 50 chars, length check passes (text.length < 50 is false)
    // Should proceed to keyword checks; since no keywords, dimensions fail
    expect(result.verified).toBe(false)
    expect(result.dimensions.what_it_protects).toBe(false)
    // The missingDimension should be the first failing dimension, not a length error
    expect(result.missingDimension).toBeDefined()
  })

  // ── SC-2: dimensions output shape matches schema contract ────────────────
  it('SC-2: validateArticulation returns boolean map matching PhaseRecord schema', () => {
    const text =
      'This protects user data because it guards against injection. ' +
      'Key risks include edge cases. The approach works because parameterized queries are effective.'
    const result = validateArticulation(text)

    // Verify dimensions is a boolean map (not a string array)
    expect(typeof result.dimensions).toBe('object')
    expect(Array.isArray(result.dimensions)).toBe(false)

    // Verify all 3 required keys exist with boolean values
    expect(result.dimensions).toHaveProperty('what_it_protects')
    expect(result.dimensions).toHaveProperty('key_risks')
    expect(result.dimensions).toHaveProperty('why_approach_works')
    expect(typeof result.dimensions.what_it_protects).toBe('boolean')
    expect(typeof result.dimensions.key_risks).toBe('boolean')
    expect(typeof result.dimensions.why_approach_works).toBe('boolean')

    // Verify no extra keys
    expect(Object.keys(result.dimensions)).toHaveLength(3)
  })
})
