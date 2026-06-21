/**
 * Tests for packages/watchdog/src/intervention-bridge.ts callIntervention.
 *
 * Mocks node:child_process.spawn to verify the bridge:
 * 1. Successful subprocess call → parses JSON envelope
 * 2. Subprocess exit-nonzero → returns empty envelope with error
 * 3. Signal kill (timeout) → returns empty envelope with signal message
 * 4. Empty mcpProjectDir → returns empty envelope without spawning
 *
 * The mock mirrors the EventEmitter pattern used in
 * packages/reflection/test/idle-handler.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { callIntervention, type InterventionBatchPayload, type InterventionBatchResult } from '../src/intervention-bridge.js'

interface MockSpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  error: Error | null
}

let mockSpawnResult: MockSpawnResult

function createMockChild(): EventEmitter {
  const child = new EventEmitter()
  ;(child as any).stdout = new EventEmitter()
  ;(child as any).stderr = new EventEmitter()
  ;(child as any).stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() }

  process.nextTick(() => {
    if (mockSpawnResult.error) {
      child.emit('error', mockSpawnResult.error)
    } else {
      if (mockSpawnResult.stdout) (child as any).stdout.emit('data', Buffer.from(mockSpawnResult.stdout))
      if (mockSpawnResult.stderr) (child as any).stderr.emit('data', Buffer.from(mockSpawnResult.stderr))
      child.emit('close', mockSpawnResult.exitCode, mockSpawnResult.signal)
    }
  })

  return child
}

const mockSpawn = vi.fn((..._args: any[]) => createMockChild())

vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}))

const basePayload: InterventionBatchPayload = {
  context: { project_id: 'p1', run_id: 'r1', phase: 5, current_phase: 5 },
  violations: [{ signal: 'violation-gate-block', context: { phase: 5, run_id: 'r1' } }],
}

const okEnvelope: InterventionBatchResult = {
  results: [
    {
      violation_type: 'UNFIXED_ISSUES',
      action: 'instructed',
      success: true,
      user_message: 'proceed',
      files_affected: [],
      pipeline_action: null,
    },
  ],
  total: 1,
  succeeded: 1,
  failed: 0,
  error: null,
}

describe('callIntervention', () => {
  beforeEach(() => {
    mockSpawnResult = {
      stdout: JSON.stringify(okEnvelope),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    }
    mockSpawn.mockImplementation(createMockChild)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('successful_call_parses_json_envelope', async () => {
    const result = await callIntervention(basePayload, '/tmp/mcp')

    expect(mockSpawn).toHaveBeenCalledOnce()
    const spawnArgs = mockSpawn.mock.calls[0]
    expect(spawnArgs[0]).toBe('uv')
    expect(spawnArgs[1]).toContain('intervene_batch')
    expect(spawnArgs[2]).toMatchObject({ timeout: 30000 })

    expect(result.total).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.error).toBeNull()
    expect(result.results[0].action).toBe('instructed')
    expect(result.results[0].success).toBe(true)
  })

  it('subprocess_nonzero_exit_returns_empty_envelope_with_error', async () => {
    mockSpawnResult = {
      stdout: '',
      stderr: 'python module not found',
      exitCode: 1,
      signal: null,
      error: null,
    }

    const result = await callIntervention(basePayload, '/tmp/mcp')

    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.error).toContain('exited with code 1')
  })

  it('subprocess_signal_kill_returns_empty_envelope_with_error', async () => {
    mockSpawnResult = {
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: 'SIGTERM',
      error: null,
    }

    const result = await callIntervention(basePayload, '/tmp/mcp')

    expect(result.results).toEqual([])
    expect(result.error).toContain('SIGTERM')
  })

  it('empty_mcp_project_dir_returns_empty_envelope_without_spawning', async () => {
    const result = await callIntervention(basePayload, '')

    expect(mockSpawn).not.toHaveBeenCalled()
    expect(result.results).toEqual([])
    expect(result.error).toContain('mcpProjectDir')
  })
})
