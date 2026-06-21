/**
 * TS→Python intervention bridge — subprocess call into InterventionCoordinator.
 *
 * Mirrors packages/reflection/src/idle-handler.ts runSubprocess pattern:
 * spawns `uv run --project <mcpProjectDir> python -m aristotle_mcp._cli intervene_batch`,
 * writes JSON payload to stdin, parses JSON envelope from stdout.
 *
 * Fault-tolerant by design: never throws. Any error (subprocess failure,
 * timeout, invalid JSON) returns an empty result envelope with `error` set,
 * so the watchdog can continue its normal violation-gate behavior when
 * Python is unavailable.
 */
import { spawn } from 'node:child_process'
import { createLogger } from '@opencode-ai/core/logger'

const logger = createLogger('watchdog', 'AGENT_PLATFORM_LOG')

const SUBPROCESS_TIMEOUT_MS = 30000

export interface InterventionResultItem {
  violation_type: string
  action: string
  success: boolean
  user_message: string
  files_affected: string[]
  pipeline_action: string | null
}

export interface InterventionBatchResult {
  results: InterventionResultItem[]
  total: number
  succeeded: number
  failed: number
  error: string | null
}

export interface InterventionViolationPayload {
  signal: string
  context?: Record<string, unknown>
  affected_file_path?: string
  affected_file_paths?: string[]
}

export interface InterventionBatchPayload {
  context: {
    project_id?: string
    run_id?: string
    phase?: number
    current_phase?: number
    ki_doc_path?: string
  }
  violations: InterventionViolationPayload[]
}

function emptyResult(error: string | null = null): InterventionBatchResult {
  return { results: [], total: 0, succeeded: 0, failed: 0, error }
}

/**
 * Invoke the Python intervention engine via subprocess.
 *
 * Returns a structured result envelope. Never throws — any failure
 * (spawn error, non-zero exit, timeout, invalid JSON) yields an empty
 * envelope with `error` set so the watchdog continues normally.
 */
export async function callIntervention(
  payload: InterventionBatchPayload,
  mcpProjectDir: string,
): Promise<InterventionBatchResult> {
  if (!mcpProjectDir) {
    return emptyResult('mcpProjectDir is empty')
  }

  const args = [
    'run',
    '--project', mcpProjectDir,
    'python', '-m', 'aristotle_mcp._cli', 'intervene_batch',
  ]
  const stdinData = JSON.stringify(payload)

  return new Promise<InterventionBatchResult>((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('uv', args, { timeout: SUBPROCESS_TIMEOUT_MS })
    } catch (err) {
      resolve(emptyResult(`spawn failed: ${err instanceof Error ? err.message : String(err)}`))
      return
    }

    let stdout = ''
    let stderr = ''
    if (child.stdout) child.stdout.on('data', (d: Buffer) => { stdout += d })
    if (child.stderr) child.stderr.on('data', (d: Buffer) => { stderr += d })
    if (child.stdin) child.stdin.on('error', () => { /* pipe closed; close handler resolves */ })

    child.on('close', (code, signal) => {
      if (signal) {
        logger.error('intervention-bridge subprocess killed by signal %s (timeout?) stderr=%s', signal, stderr)
        resolve(emptyResult(`Process killed by signal ${signal} (timeout?)`))
        return
      }
      if (code !== 0) {
        // Python may have written error JSON to stdout before exit(1)
        try {
          const parsed = JSON.parse(stdout.trim()) as InterventionBatchResult
          if (parsed && typeof parsed === 'object' && 'results' in parsed) {
            resolve(parsed)
            return
          }
        } catch { /* fall through to generic error */ }
        logger.error('intervention-bridge subprocess exit=%d stderr=%s', code, stderr)
        resolve(emptyResult(`Process exited with code ${code}: ${stderr}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as InterventionBatchResult
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) {
          resolve(emptyResult(`Invalid JSON envelope: ${stdout.substring(0, 200)}`))
          return
        }
        resolve(parsed)
      } catch (e) {
        resolve(emptyResult(`Invalid JSON output: ${stdout.substring(0, 200)}`))
      }
    })

    child.on('error', (err) => {
      resolve(emptyResult(err.message))
    })

    if (child.stdin) {
      child.stdin.write(stdinData)
      child.stdin.end()
    }
  })
}
