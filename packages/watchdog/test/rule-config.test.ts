import { describe, it, expect } from 'vitest'
import {
  extractExitCode,
  quickSyntaxCheck,
  yamlSyntaxCheck,
  matchPattern,
  normalizeCommand,
  ObserverTimeoutError,
} from '../src/rule-config.js'

// ═══════════════════════════════════════════════════════════════════════════════
// extractExitCode
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractExitCode', () => {
  // TC-RC-01: Standard format with descriptive text
  it('extracts exit code from standard format', () => {
    expect(extractExitCode('Command failed with exit code: 1')).toBe(1)
  })

  // TC-RC-02: Zero exit code
  it('extracts zero exit code', () => {
    expect(extractExitCode('exit code: 0')).toBe(0)
  })

  // TC-RC-03: Large exit code
  it('extracts large exit code', () => {
    expect(extractExitCode('exit code: 137')).toBe(137)
  })

  // TC-RC-04: Empty output → fallback 1 (fail-safe)
  it('returns fallback 1 for empty output', () => {
    expect(extractExitCode('')).toBe(1)
  })

  // TC-RC-05: No match in random text → fallback 1
  it('returns fallback 1 for output with no exit code pattern', () => {
    expect(extractExitCode('build successful')).toBe(1)
  })

  // TC-RC-06: Multiple matches → first match
  it('returns first match when multiple exit codes present', () => {
    expect(extractExitCode('exit code: 2 then exit code: 5')).toBe(2)
  })

  // TC-RC-07: Exit code embedded in middle of output
  it('extracts exit code from middle of multi-line output', () => {
    const output = 'Running tests...\nCommand failed with exit code: 42\nDone.'
    expect(extractExitCode(output)).toBe(42)
  })

  // TC-RC-08: Negative exit code text → fallback 1 (only non-negative integers)
  it('returns fallback 1 for negative exit code text', () => {
    expect(extractExitCode('exit code: -1')).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// quickSyntaxCheck
// ═══════════════════════════════════════════════════════════════════════════════

describe('quickSyntaxCheck', () => {
  // TC-RC-09: Valid JSON object
  it('returns ok for valid JSON object', () => {
    const result = quickSyntaxCheck('{"key": "value"}')
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  // TC-RC-10: Invalid JSON
  it('returns not ok for invalid JSON', () => {
    const result = quickSyntaxCheck('{broken')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTypeOf('string')
    expect(result.error!.length).toBeGreaterThan(0)
  })

  // TC-RC-11: Valid JSON array
  it('returns ok for valid JSON array', () => {
    const result = quickSyntaxCheck('[1,2,3]')
    expect(result.ok).toBe(true)
  })

  // TC-RC-12: Empty string → ok (no content to check)
  it('returns ok for empty string', () => {
    const result = quickSyntaxCheck('')
    expect(result.ok).toBe(true)
  })

  // TC-RC-13: Null byte in JSON → not ok
  it('returns not ok for null byte in JSON', () => {
    const result = quickSyntaxCheck('{"key": "\u0000value"}')
    expect(result.ok).toBe(false)
  })

  // TC-RC-14: Deeply nested valid JSON → ok
  it('returns ok for deeply nested valid JSON', () => {
    const nested = { a: { b: { c: { d: { e: 'deep' } } } } }
    const result = quickSyntaxCheck(JSON.stringify(nested))
    expect(result.ok).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// yamlSyntaxCheck
// ═══════════════════════════════════════════════════════════════════════════════

describe('yamlSyntaxCheck', () => {
  // TC-RC-15: Valid YAML key-value
  it('returns ok for valid YAML', () => {
    const result = yamlSyntaxCheck('key: value')
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })

  // TC-RC-16: Invalid YAML
  it('returns not ok for invalid YAML', () => {
    const result = yamlSyntaxCheck('key: [unclosed')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTypeOf('string')
    expect(result.error!.length).toBeGreaterThan(0)
  })

  // TC-RC-17: YAML with !!js/function → MUST reject (security)
  it('rejects YAML with JS-specific type tags', () => {
    const result = yamlSyntaxCheck('fn: !!js/function "function() { return 1 }"')
    expect(result.ok).toBe(false)
  })

  // TC-RC-18: Valid multi-doc YAML with --- separator
  it('returns ok for valid multi-document YAML', () => {
    const yaml = `---
key: value1
---
key: value2`
    const result = yamlSyntaxCheck(yaml)
    expect(result.ok).toBe(true)
  })

  // TC-RC-19: Empty string → ok (no content = no error)
  it('returns ok for empty string', () => {
    const result = yamlSyntaxCheck('')
    expect(result.ok).toBe(true)
  })

  // TC-RC-20: YAML with anchors and aliases → ok
  it('returns ok for YAML with anchors and aliases', () => {
    const yaml = `defaults: &defaults
  timeout: 30
  retries: 3

production:
  <<: *defaults
  timeout: 60`
    const result = yamlSyntaxCheck(yaml)
    expect(result.ok).toBe(true)
  })

  // TC-RC-21: YAML with custom tag !custom
  it('handles YAML with custom tags under JSON_SCHEMA safety', () => {
    const result = yamlSyntaxCheck('value: !custom tagged')
    // Under JSON_SCHEMA mode, custom tags should be rejected
    expect(result.ok).toBe(false)
  })

  // TC-RC-22: Complex nested YAML → ok
  it('returns ok for complex nested YAML', () => {
    const yaml = `services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    environment:
      NODE_ENV: production
      DEBUG: false
    volumes:
      - ./data:/app/data`
    const result = yamlSyntaxCheck(yaml)
    expect(result.ok).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// matchPattern
// ═══════════════════════════════════════════════════════════════════════════════

describe('matchPattern', () => {
  // TC-RC-23: Exact match
  it('matches exact command string', () => {
    expect(matchPattern('npm test', 'npm test')).toBe(true)
  })

  // TC-RC-24: Glob star pattern
  it('matches with glob star pattern', () => {
    expect(matchPattern('npm run test', 'npm *')).toBe(true)
  })

  // TC-RC-25: No match
  it('returns false for non-matching pattern', () => {
    expect(matchPattern('npm test', 'yarn *')).toBe(false)
  })

  // TC-RC-26: Question mark single-char wildcard
  it('matches with question mark single-char wildcard', () => {
    expect(matchPattern('npm', 'np?')).toBe(true)
  })

  // TC-RC-27: Complex pattern with path separators
  it('handles complex pattern with path separators', () => {
    const result = matchPattern('src/test/file.ts', 'src/**/*.ts')
    // Double-star should match across path separators
    expect(result).toBe(true)
  })

  // TC-RC-28: Empty pattern behavior
  it('returns false for empty pattern', () => {
    expect(matchPattern('npm test', '')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// normalizeCommand
// ═══════════════════════════════════════════════════════════════════════════════

describe('normalizeCommand', () => {
  // TC-RC-29: Trim and collapse whitespace
  it('trims and collapses whitespace', () => {
    expect(normalizeCommand('  npm   test  ')).toBe('npm test')
  })

  // TC-RC-30: Remove sudo prefix
  it('removes sudo prefix', () => {
    expect(normalizeCommand('sudo npm test')).toBe('npm test')
  })

  // TC-RC-31: Remove env prefix (KEY=VALUE format)
  it('removes env prefix', () => {
    expect(normalizeCommand('NODE_ENV=test npm test')).toBe('npm test')
  })

  // TC-RC-32: Collapse mixed whitespace (tabs, newlines)
  it('collapses mixed whitespace characters', () => {
    expect(normalizeCommand('npm\t\ttest\n--flag')).toBe('npm test --flag')
  })

  // TC-RC-33: Already normalized → unchanged
  it('returns already-normalized command unchanged', () => {
    expect(normalizeCommand('npm test')).toBe('npm test')
  })

  // TC-RC-34: Empty string → empty string
  it('returns empty string for empty input', () => {
    expect(normalizeCommand('')).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ObserverTimeoutError
// ═══════════════════════════════════════════════════════════════════════════════

describe('ObserverTimeoutError', () => {
  // TC-RC-35: instanceof Error
  it('is an instance of Error', () => {
    const err = new ObserverTimeoutError('observer timed out')
    expect(err).toBeInstanceOf(Error)
  })

  // TC-RC-36: Has correct name property
  it('has correct name property', () => {
    const err = new ObserverTimeoutError('observer timed out')
    expect(err.name).toBe('ObserverTimeoutError')
  })

  // TC-RC-37: Can be caught with instanceof in catch block
  it('can be caught with instanceof in catch block', () => {
    const catchResult = (() => {
      try {
        throw new ObserverTimeoutError('timeout exceeded')
      } catch (e) {
        if (e instanceof ObserverTimeoutError) {
          return 'caught'
        }
        return 'missed'
      }
    })()
    expect(catchResult).toBe('caught')
  })
})
