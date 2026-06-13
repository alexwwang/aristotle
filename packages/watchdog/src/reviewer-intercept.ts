/**
 * Reviewer intercept rule — blocks reviewer Task calls during active Ralph loops.
 * Stub for Phase 4 TDD Red Phase.
 */

import type { PipelineState } from './schema.js'

export interface ReviewerInterceptResult {
  blocked: boolean
  reason?: string
  state_mutated?: boolean
  redirectDirective?: string
}

export type SpawnPhase = 'pending' | 't1_running' | 't1_done' | 't2_running' | 'done' | 'failed'

export interface ReviewerTakeoverState {
  round: number
  interceptAt: string
  spawnPhase: SpawnPhase
  t1SessionId?: string
  t2SessionId?: string
  t1Degraded?: boolean
  dualPassMode?: boolean
  dualPassPhase?: DualPassPhase
  dualPassAttempt?: number
  interceptedPrompt?: string | null
  interceptedDescription?: string | null
  factContextPath?: string
}

export type DualPassPhase =
  | 'pending'
  | 'recall_running'
  | 'recall_done'
  | 'factgather_running'
  | 'factgather_done'
  | 'precision_running'
  | 'precision_done'
  | 'evalfix_running'
  | 'evalfix_done'
  | 'd2_running'
  | 'd25_running'
  | 'done'
  | 'failed'

export function createReviewerInterceptRule(): {
  id: string
  evaluate(
    tool: string,
    args: Record<string, unknown>,
    state: PipelineState,
    callingSessionId?: string,
  ): ReviewerInterceptResult
} {
  throw new Error('Not implemented: createReviewerInterceptRule')
}
