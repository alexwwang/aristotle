import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import { detectMultiAgent } from '../src/multi-agent.js'

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

const mockFs = vi.mocked(fs)

describe('detectMultiAgent', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns false when ctx.directory is undefined', () => {
    expect(detectMultiAgent({})).toBe(false)
    expect(mockFs.existsSync).not.toHaveBeenCalled()
  })

  it('returns false when opencode.json does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  it('returns false when opencode.json has no plugin field', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({}))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  it('returns false when plugins array is empty', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ plugin: [] }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  it('returns false for non-OMO plugins', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ plugin: ['other-plugin', 'yet-another'] }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  it('returns true when oh-my-opencode is in plugins', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ plugin: ['@anthropic/oh-my-opencode'] }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  it('returns true when oh-my-openagent is in plugins', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ plugin: ['oh-my-openagent@latest'] }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  it('returns false conservatively on malformed JSON', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('not valid json {{{')
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  it('returns false conservatively on fs error', () => {
    mockFs.existsSync.mockImplementation(() => { throw new Error('permission denied') })
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  it('handles plugins array with mixed types', () => {
    mockFs.existsSync.mockReturnValue(true)
    // plugin array might contain objects too
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ plugin: [{ name: 'oh-my-opencode' }, 'other', 42] }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  it('detects oh-my-opencode in a path-like plugin string', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ plugin: ['./node_modules/oh-my-opencode/index.js'] }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })
})
