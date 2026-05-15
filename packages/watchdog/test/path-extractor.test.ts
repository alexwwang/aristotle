import { describe, it, expect } from 'vitest'
import { extractFilePath } from '../src/path-extractor.js'

describe('PathExtractor', () => {
  // TC-B-03: edit with filePath
  it('extracts filePath from edit tool args', () => {
    expect(extractFilePath('edit', { filePath: 'src/foo.ts' })).toBe('src/foo.ts')
  })

  // TC-B-04: write with file
  it('extracts file from write tool args', () => {
    expect(extractFilePath('write', { file: 'src/bar.ts' })).toBe('src/bar.ts')
  })

  // TC-B-05: edit with empty args returns null
  it('returns null for empty args', () => {
    expect(extractFilePath('edit', {})).toBeNull()
  })

  // TC-B-34: hashline_edit generic fallback
  it('falls back to generic path extraction for hashline_edit', () => {
    expect(extractFilePath('hashline_edit', { filePath: 'x.ts' })).toBe('x.ts')
  })

  // TC-B-35: custom_tool path field
  it('extracts path field for custom tools', () => {
    expect(extractFilePath('custom_tool', { path: 'y.ts' })).toBe('y.ts')
  })

  // TC-B-44: first field wins
  it('prefers filePath over path when both present', () => {
    expect(extractFilePath('custom', { filePath: 'a', path: 'b' })).toBe('a')
  })

  // TC-B-45: null args returns null
  it('returns null when args is null', () => {
    expect(extractFilePath('edit', null)).toBeNull()
  })

  // TC-B-46: string args returns null
  it('returns null when args is not an object', () => {
    expect(extractFilePath('edit', 'not-an-object')).toBeNull()
  })
})
