import { describe, it, expect } from 'vitest'
import { classifyFile } from '../src/file-classifier.js'
import { FALLBACK_PATTERNS } from '../src/watchdog-config.js'

describe('FileClassifier', () => {
  // TC-B-06: src directory -> business_code
  it('classifies src directory as business_code', () => {
    const result = classifyFile('/project/src/utils/helper.ts', FALLBACK_PATTERNS, [])
    expect(result).toEqual({ category: 'business_code' })
  })

  // TC-B-07: tests directory -> test_file
  it('classifies tests directory as test_file', () => {
    const result = classifyFile('/project/tests/auth.test.ts', FALLBACK_PATTERNS, [])
    expect(result).toEqual({ category: 'test_file' })
  })

  // TC-B-08: technical-spec.md -> phase_deliverable(2)
  it('classifies technical-spec.md as phase 2 deliverable', () => {
    const result = classifyFile('/project/docs/technical-spec.md', FALLBACK_PATTERNS, [])
    expect(result).toEqual({ category: 'phase_deliverable', phase: 2 })
  })

  // TC-B-09: random.md -> unknown
  it('classifies unmatched files as unknown', () => {
    const result = classifyFile('/project/random.md', FALLBACK_PATTERNS, [])
    expect(result).toEqual({ category: 'unknown' })
  })

  // TC-B-10: prd-v2.md -> phase_deliverable(1)
  it('classifies prd-v2.md as phase 1 deliverable', () => {
    const result = classifyFile('/project/docs/prd-v2.md', FALLBACK_PATTERNS, [])
    expect(result).toEqual({ category: 'phase_deliverable', phase: 1 })
  })

  // TC-B-11: user-stories.md -> phase_deliverable(1)
  it('classifies user-stories.md as phase 1 deliverable', () => {
    const result = classifyFile('/project/docs/user-stories.md', FALLBACK_PATTERNS, [])
    expect(result).toEqual({ category: 'phase_deliverable', phase: 1 })
  })

  // TC-B-12: ignorePatterns override
  it('respects ignorePatterns and returns unknown for matched files', () => {
    const result = classifyFile('/project/docs/technical-notes.md', FALLBACK_PATTERNS, ['technical-notes.md'])
    expect(result).toEqual({ category: 'unknown' })
  })

  // TC-B-13: custom config override
  it('uses custom deliverable patterns when provided', () => {
    const customPatterns = { 2: ['api-design*.md'] }
    const result = classifyFile('/project/api-design.md', customPatterns, [])
    expect(result).toEqual({ category: 'phase_deliverable', phase: 2 })
  })
})
