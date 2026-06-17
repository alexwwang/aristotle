import type { PipelineState } from './schema.js'
import { unlinkSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const CLEANUP_TRIGGERS = new Set(['suspend', 'resume', 'start', 'ralph_loop_start', 'phase_complete', 'ralph_terminate'])
const RESULT_FILE_PATTERN = (round: number) => `reviewer-result-${round}.json`

function findAndDeleteResultFiles(round: number, verifySessionId?: boolean, expectedSessionId?: string): void {
  const pattern = RESULT_FILE_PATTERN(round)
  const filePath = join('.aristotle', pattern)
  if (!existsSync(filePath)) return
  if (verifySessionId) {
    try {
      const content = JSON.parse(readFileSync(filePath, 'utf-8'))
      if (expectedSessionId && content.sessionId === expectedSessionId) {
        return
      }
    } catch {
      // Can't parse — proceed with deletion
    }
  }
  try {
    unlinkSync(filePath)
  } catch {
    // Already deleted or permission error — skip
  }
}

export function cleanupStaleState(
  trigger: 'suspend' | 'resume' | 'start' | 'ralph_loop_start' | 'phase_complete' | 'ralph_terminate',
  state: PipelineState,
): PipelineState {
  const result = { ...state }
  const takeover = result.reviewerTakeover

  if (!takeover && !result.cleanupToken) {
    return result
  }

  if (trigger === 'resume') {
    if (takeover && takeover.spawnPhase === 't2_running') {
      console.log(`WARNING: T2_WAIT — active T-2 session during resume, deferring cleanup (round ${takeover.round})`)
      result.deferred = true
      return result
    }
    if (takeover && takeover.spawnPhase === 't1_done' && takeover.t2SessionId) {
      return result
    }
  }

  if (!CLEANUP_TRIGGERS.has(trigger)) {
    return result
  }

  if (takeover) {
    console.log(`TAKEOVER_STALE_CLEANUP: trigger=${trigger} round=${takeover.round} spawnPhase=${takeover.spawnPhase}`)
    if (takeover.round !== undefined) {
      console.log(`STALE_CLEANUP_DELETE: deleting result files for round ${takeover.round}`)
      findAndDeleteResultFiles(takeover.round, trigger === 'resume', takeover.t2SessionId)
    }
    result.reviewerTakeover = null
  }
  result.cleanupToken = undefined
  result.deferred = undefined
  return result
}

export function generateCleanupToken(): string {
  return randomUUID()
}

export function validateCleanupToken(state: PipelineState, token: string): boolean {
  return state.cleanupToken === token
}

export function deleteResultFiles(runId: string, round: number, verifySessionId?: boolean): void {
  findAndDeleteResultFiles(round, verifySessionId)
}
