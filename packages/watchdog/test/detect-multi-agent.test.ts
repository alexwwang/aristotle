import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import { detectMultiAgent } from '../src/multi-agent.js'

// Mock assumes detectMultiAgent uses sync fs API (existsSync/readFileSync).
// If Phase 5 implementation uses fs/promises, accessSync, or statSync,
// update this mock accordingly.
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

  // TC-OMO-006a
  it('should_not_detect_omo_when_unrecognized_plugin', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['/path/to/other-plugin/index.js'],
    }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  // TC-OMO-006b
  it('should_not_detect_omo_when_empty_plugin_array', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ plugin: [] }))
    expect(detectMultiAgent({ directory: '/project' })).toBe(false)
  })

  // TC-OMO-006c
  it('should_not_detect_omo_when_config_missing', () => {
    mockFs.existsSync.mockReturnValue(false)
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

  // TC-OMO-010
  it('should_use_default_directory_when_undefined', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      plugin: ['file:///path/to/oh-my-opencode/index.js'],
    }))
    expect(detectMultiAgent({})).toBe(true)
  })
})
