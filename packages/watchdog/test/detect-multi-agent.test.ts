import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import { detectMultiAgent } from '../src/multi-agent.js'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

const mockFs = vi.mocked(fs)

describe('detectMultiAgent', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // TC-OMO-001
  it('should_detect_oh_my_opencode', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['file:///path/to/oh-my-opencode/index.js'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  // TC-OMO-002
  it('should_detect_oh_my_openagent', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['/custom/location/oh-my-openagent/dist/main.js'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  // TC-OMO-003
  it('should_detect_oh_my_claudecode', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['oh-my-claudecode/src/index.ts'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  // TC-OMO-004
  it('should_detect_superpowers', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['packages/superpowers/main.ts'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  // TC-OMO-005
  it('should_detect_multiple_omo_plugins', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['/path/to/oh-my-opencode/index.js', '/path/to/superpowers/main.ts'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  // TC-OMO-006
  it('should_not_detect_omo_when_none_installed', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['/path/to/other-plugin/index.js'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  // TC-OMO-007
  it('should_not_detect_wrong_casing', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['/path/to/Oh-My-Opencode/index.js'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  // TC-OMO-008
  it('should_detect_non_standard_location', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['/custom/weird/path/oh-my-opencode/dist/main.js'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(true)
  })

  // TC-OMO-009
  it('should_safely_degrade_to_non_omo_on_error', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockImplementation(() => { throw new Error('read error') })
    const result = detectMultiAgent({ directory: '/project' })
    expect(result).toBe(false)
  })
})
