import { describe, it, expect } from 'vitest'
import { scanPrompt, DEFAULT_PROHIBITED_PATTERNS } from '../src/prompt-scanner.js'

describe('Phase 2.1 RPS — PromptScanner', () => {
  it('TC-R-01: detects "R1 found 3 issues"', () => {
    const result = scanPrompt('Please review the code. R1 found 3 issues in the module.')
    expect(result.flagged).toBe(true)
    expect(result.matchedPatterns.length).toBeGreaterThanOrEqual(1)
    expect(result.matchedPatterns[0].match).toMatch(/R1.*found/)
  })

  it('TC-R-02: detects "consecutive zero rounds"', () => {
    const result = scanPrompt('Check if we have consecutive zero rounds for early stop.')
    expect(result.flagged).toBe(true)
    expect(result.matchedPatterns.some(m => m.match.includes('consecutive'))).toBe(true)
  })

  it('TC-R-03: does not flag "review the design doc" (AC-R5)', () => {
    const result = scanPrompt('Review the design document and check for issues.')
    expect(result.flagged).toBe(false)
    expect(result.matchedPatterns).toEqual([])
  })

  it('TC-R-04: detects "previous review identified"', () => {
    const result = scanPrompt('The previous review identified several code quality issues.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-05: empty prompt returns not flagged', () => {
    expect(scanPrompt('').flagged).toBe(false)
  })

  it('TC-R-06: detects "early stop" pattern', () => {
    const result = scanPrompt('Check if early stop conditions are met.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-07: detects "gate pass" pattern', () => {
    const result = scanPrompt('Ready for gate pass declaration.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-08: detects "verify that no issues remain"', () => {
    const result = scanPrompt('Please verify that no issues remain in the codebase.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-09: detects "should find no" pattern', () => {
    const result = scanPrompt('You should find no issues in this clean code.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-10: does not flag "review scope" (AC-R5 false positive budget)', () => {
    const result = scanPrompt('Review the following files for correctness: src/main.ts, src/utils.ts')
    expect(result.flagged).toBe(false)
  })

  it('TC-R-11: does not flag severity definitions (AC-R5)', () => {
    const result = scanPrompt('Use severity levels: C=Critical, H=High, M=Medium, L=Low, I=Info')
    expect(result.flagged).toBe(false)
  })

  it('TC-R-12: detects multiple patterns in one prompt', () => {
    const result = scanPrompt('R2 found 2 issues. The previous review identified more. Check early stop.')
    expect(result.flagged).toBe(true)
    expect(result.matchedPatterns.length).toBeGreaterThanOrEqual(3)
  })

  it('TC-R-13: detects "round 3 found" pattern', () => {
    const result = scanPrompt('Round 3 found a critical bug in the auth module.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-14: detects "fix list" pattern', () => {
    const result = scanPrompt('Here is the fix list from the previous round.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-15: custom patterns override defaults', () => {
    const customPattern = [/CUSTOM_PATTERN_123/]
    const result = scanPrompt('This has the CUSTOM_PATTERN_123 in it.', customPattern)
    expect(result.flagged).toBe(true)
  })

  it('TC-R-16: custom patterns do not include defaults', () => {
    const customPattern = [/CUSTOM_PATTERN_123/]
    const result = scanPrompt('R1 found 3 issues', customPattern)
    expect(result.flagged).toBe(false)
  })

  it('TC-R-17: "running total" detected', () => {
    const result = scanPrompt('The running total of issues is 5.')
    expect(result.flagged).toBe(true)
  })

  it('TC-R-18: empty string prompt returns clean (not bypass) — R6 regression', () => {
    const result = scanPrompt('')
    expect(result.flagged).toBe(false)
    expect(result.matchedPatterns).toEqual([])
  })

  it('TC-R-19: whitespace-only prompt returns clean', () => {
    const result = scanPrompt('   \n\t  ')
    expect(result.flagged).toBe(false)
  })
})
