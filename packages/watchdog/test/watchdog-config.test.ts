import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadWatchdogConfig, FALLBACK_PATTERNS, DEFAULT_MONITORED_TOOLS } from '../src/watchdog-config.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

describe('WatchdogConfig', () => {
  let tmpDir: string
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-config-'))
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // TC-B-26: missing file -> defaults
  it('returns fallback defaults when config file is missing', () => {
    const config = loadWatchdogConfig(tmpDir, logger)
    expect(config.phaseDeliverables).toEqual(FALLBACK_PATTERNS)
    expect(config.ignorePatterns).toEqual([])
    expect(config.monitoredTools).toEqual(DEFAULT_MONITORED_TOOLS)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No watchdog.jsonc'), expect.anything())
  })

  // TC-B-27: valid file -> parsed
  it('parses valid watchdog.jsonc config', () => {
    const configPath = path.join(tmpDir, '.opencode')
    fs.mkdirSync(configPath, { recursive: true })
    fs.writeFileSync(
      path.join(configPath, 'watchdog.jsonc'),
      JSON.stringify({
        phaseDeliverables: {
          phase1: ['custom-*.md'],
        },
        ignorePatterns: ['notes.md'],
        monitoredTools: ['edit', 'write', 'hashline_edit'],
      }),
    )
    const config = loadWatchdogConfig(tmpDir, logger)
    expect(config.phaseDeliverables[1]).toEqual(['custom-*.md'])
    expect(config.ignorePatterns).toEqual(['notes.md'])
    expect(config.monitoredTools).toEqual(['edit', 'write', 'hashline_edit'])
    expect(logger.info).toHaveBeenCalled()
  })

  // TC-B-28: malformed JSONC -> defaults + warn
  it('returns defaults and logs warning for malformed JSONC', () => {
    const configPath = path.join(tmpDir, '.opencode')
    fs.mkdirSync(configPath, { recursive: true })
    fs.writeFileSync(path.join(configPath, 'watchdog.jsonc'), '{ invalid json }')
    const config = loadWatchdogConfig(tmpDir, logger)
    expect(config.phaseDeliverables).toEqual(FALLBACK_PATTERNS)
    expect(config.ignorePatterns).toEqual([])
    expect(config.monitoredTools).toEqual(DEFAULT_MONITORED_TOOLS)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to load'), expect.anything())
  })

  // TC-B-29: missing phaseDeliverables -> defaults
  it('returns fallback patterns when phaseDeliverables is missing', () => {
    const configPath = path.join(tmpDir, '.opencode')
    fs.mkdirSync(configPath, { recursive: true })
    fs.writeFileSync(
      path.join(configPath, 'watchdog.jsonc'),
      JSON.stringify({ ignorePatterns: ['x.md'] }),
    )
    const config = loadWatchdogConfig(tmpDir, logger)
    expect(config.phaseDeliverables).toEqual(FALLBACK_PATTERNS)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing phaseDeliverables'), expect.anything())
  })

  // TC-B-30: Extra phases preserved, never matched
  it('preserves extra phase deliverables beyond standard phases', () => {
    const configPath = path.join(tmpDir, '.opencode')
    fs.mkdirSync(configPath, { recursive: true })
    fs.writeFileSync(
      path.join(configPath, 'watchdog.jsonc'),
      JSON.stringify({
        phaseDeliverables: {
          phase1: ['a.md'],
          phase6: ['future.md'],
        },
      }),
    )
    const config = loadWatchdogConfig(tmpDir, logger)
    expect(config.phaseDeliverables[6]).toEqual(['future.md'])
    // Phase count is now dynamic — phase6+ is valid and will be matched
  })

  // TC-B-31: globToRegex -- *.md matches .md only
  it('glob pattern *.md matches .md files only', () => {
    const configPath = path.join(tmpDir, '.opencode')
    fs.mkdirSync(configPath, { recursive: true })
    fs.writeFileSync(
      path.join(configPath, 'watchdog.jsonc'),
      JSON.stringify({
        phaseDeliverables: {
          phase2: ['technical*.md'],
        },
      }),
    )
    const config = loadWatchdogConfig(tmpDir, logger)
    expect(config.phaseDeliverables[2]).toContain('technical*.md')
    // Classification behavior is tested in file-classifier.test.ts (TC-B-08)
  })

  // TC-B-41: Empty monitoredTools -> warning + fallback
  it('falls back to defaults when monitoredTools is empty', () => {
    const configPath = path.join(tmpDir, '.opencode')
    fs.mkdirSync(configPath, { recursive: true })
    fs.writeFileSync(
      path.join(configPath, 'watchdog.jsonc'),
      JSON.stringify({
        phaseDeliverables: { phase1: ['a.md'] },
        monitoredTools: [],
      }),
    )
    const config = loadWatchdogConfig(tmpDir, logger)
    expect(config.monitoredTools).toEqual(DEFAULT_MONITORED_TOOLS)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to defaults'), expect.anything())
  })
})
