import { describe, it, expect } from 'vitest'
import {
  parseLoopPhases,
  getLoopType,
  isLoopConfigError,
  ConfigValidationError,
} from '../src/loop-config.js'
import {
  FIXTURES,
  VALID_CONFIG_MAP,
  VALID_CONFIG_MAP_RALPH_ONLY,
} from './helpers.js'

// ─── parseLoopPhases ──────────────────────────────────────────────────────

describe('parseLoopPhases', () => {
  it('should return correct map for valid config', () => {
    const result = parseLoopPhases(FIXTURES.VALID_CONFIG)
    if ('error' in result) throw new Error('Unexpected error: ' + result.message)
    expect(result.loopPhaseMap).toEqual(VALID_CONFIG_MAP)
    expect(result.maxPhase).toBe(7)
  })

  it('should return empty map and undefined maxPhase for missing config', () => {
    const result = parseLoopPhases(undefined)
    if ('error' in result) throw new Error('Unexpected error: ' + result.message)
    expect(result.loopPhaseMap).toEqual({})
    expect(result.maxPhase).toBeUndefined()
  })

  it('should reject empty object', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_EMPTY)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject unknown loopType', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_UNKNOWN_TYPE)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject overlapping phases', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_OVERLAP)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject gap in phases', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_GAP)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject phase sequence not starting at 1', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_START_GAP)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject Phase 4 as followup', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_PHASE4_FOLLOWUP)
    expect(result).toHaveProperty('error', true)
  })

  it.each([
    ['string value', { ralph: 'all' }],
    ['number value', { ralph: 123 }],
    ['boolean value', { ralph: true }],
  ])('should reject non-array value (%s)', (_label, config) => {
    const result = parseLoopPhases(config)
    expect(result).toHaveProperty('error', true)
  })

  it.each([
    ['float', { ralph: [1, 2.5, 3, 4, 5] }],
    ['NaN', { ralph: [1, NaN, 3, 4, 5] }],
    ['Infinity', { ralph: [1, Infinity, 3, 4, 5] }],
  ])('should reject non-integer phase (%s)', (_label, config) => {
    const result = parseLoopPhases(config)
    expect(result).toHaveProperty('error', true)
  })

  it.each([
    ['zero', { ralph: [0, 1, 2, 3, 4] }],
    ['negative', { ralph: [-1, 1, 2, 3, 4] }],
  ])('should reject zero or negative phase (%s)', (_label, config) => {
    const result = parseLoopPhases(config)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject duplicate within group', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_DUPLICATE)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject empty array', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_EMPTY_ARRAY)
    expect(result).toHaveProperty('error', true)
  })

  it('should accept single loopType only', () => {
    const result = parseLoopPhases(FIXTURES.VALID_CONFIG_RALPH_ONLY)
    if ('error' in result) throw new Error('Unexpected error: ' + result.message)
    expect(result.loopPhaseMap).toEqual(VALID_CONFIG_MAP_RALPH_ONLY)
    expect(result.maxPhase).toBe(5)
  })

  it('should accept single-phase config {ralph:[1]}', () => {
    const result = parseLoopPhases({ ralph: [1] })
    if ('error' in result) throw new Error('Unexpected error: ' + result.message)
    expect(result.loopPhaseMap).toEqual({ 1: 'ralph' })
    expect(result.maxPhase).toBe(1)
  })

  it('should reject all-followup config (Phase 4 invariant)', () => {
    const result = parseLoopPhases({ followup: [1, 2, 3, 4, 5] })
    expect(result).toHaveProperty('error', true)
    if ('message' in result) {
      expect((result as LoopConfigError).message).toContain('Phase 4')
    }
  })

  it.each([
    ['string element', { ralph: ['1', 2, 3] }],
    ['undefined element', { ralph: [undefined, 1, 2] }],
    ['null element', { ralph: [null, 1, 2] }],
  ])('should reject non-number element (%s)', (_label, config) => {
    const result = parseLoopPhases(config as any)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject null input', () => {
    const result = parseLoopPhases(FIXTURES.INVALID_NULL)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject nested array', () => {
    const result = parseLoopPhases({ ralph: [[1, 2]] as any })
    expect(result).toHaveProperty('error', true)
  })

  it.each([
    ['string', 'ralph'],
    ['number', 42],
    ['boolean', true],
  ])('should reject non-object primitive input (%s)', (_label, input) => {
    const result = parseLoopPhases(input)
    expect(result).toHaveProperty('error', true)
  })

  it('should reject array input with precise message', () => {
    const result = parseLoopPhases([1, 2, 3] as any)
    expect(result).toHaveProperty('error', true)
    if ('message' in result) {
      expect((result as LoopConfigError).message).toContain('not an array')
    }
  })
})

// ─── getLoopType ──────────────────────────────────────────────────────────

describe('getLoopType', () => {
  it('should return ralph when loopPhaseMap is undefined (legacy state)', () => {
    // Tech Solution: "If loopPhaseMap is undefined → treat as all-ralph"
    expect(getLoopType({}, 3)).toBe('ralph')
  })

  it('should return ralph for empty map', () => {
    expect(getLoopType({ loopPhaseMap: {} }, 3)).toBe('ralph')
  })

  it('should return ralph for phase not in non-empty map', () => {
    expect(getLoopType({ loopPhaseMap: VALID_CONFIG_MAP }, 99)).toBe('ralph')
  })

  it('should return correct type from map — followup', () => {
    expect(getLoopType({ loopPhaseMap: VALID_CONFIG_MAP }, 6)).toBe('followup')
  })

  it('should return correct type from map — ralph', () => {
    expect(getLoopType({ loopPhaseMap: VALID_CONFIG_MAP }, 1)).toBe('ralph')
  })

  it('should work with structural type (no full PipelineState)', () => {
    // Only needs { loopPhaseMap?: PhaseLoopMap } — not full PipelineState
    expect(getLoopType({ loopPhaseMap: VALID_CONFIG_MAP }, 7)).toBe('followup')
  })

  it('should work with JSON.parse\'d string keys', () => {
    // JS runtime: JSON.parse produces string keys, but number access coerces
    const parsed = JSON.parse('{"6":"followup"}')
    expect(getLoopType({ loopPhaseMap: parsed }, 6)).toBe('followup')
  })
})

// ─── ConfigValidationError ───────────────────────────────────────────────

describe('ConfigValidationError', () => {
  it('should be instanceof Error', () => {
    const err = new ConfigValidationError('test')
    expect(err).toBeInstanceOf(Error)
  })

  it('should have message property', () => {
    const err = new ConfigValidationError('test msg')
    expect(err.message).toBe('test msg')
  })

  it('should have correct name', () => {
    const err = new ConfigValidationError('x')
    expect(err.name).toBe('ConfigValidationError')
  })
})

// ─── isLoopConfigError ───────────────────────────────────────────────────

describe('isLoopConfigError', () => {
  it('should return true for LoopConfigError', () => {
    expect(isLoopConfigError({ error: true, message: 'x' })).toBe(true)
  })

  it('should return false for LoopConfigResult', () => {
    expect(isLoopConfigError({ loopPhaseMap: {}, maxPhase: 7 })).toBe(false)
  })
})
