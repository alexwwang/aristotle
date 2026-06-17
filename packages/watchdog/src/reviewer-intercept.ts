import type { PipelineState } from './schema.js'

export interface ReviewerInterceptResult {
  blocked: boolean
  reason?: string
  state_mutated?: boolean
  redirectDirective?: string
  auditType?: 'first_intercept' | 'cached' | 'missing_session_id'
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
  return {
    id: 'reviewer-intercept',
    evaluate(tool, args, state, callingSessionId) {
      if (!callingSessionId) {
        return { blocked: false, auditType: 'missing_session_id' }
      }
      if (state.phaseStatus === 'idle' || !state.ralph) {
        return { blocked: false }
      }
      if (state.reviewerTakeover) {
        if (callingSessionId === state.reviewerTakeover.t1SessionId ||
            callingSessionId === state.reviewerTakeover.t2SessionId) {
          return { blocked: false }
        }
      }
      const subagentType = args.subagent_type as string | undefined
      const prompt = (args.prompt as string | undefined) ?? ''
      const description = (args.description as string | undefined) ?? ''
      const isReviewer =
        subagentType === 'oracle' ||
        subagentType === 'reviewer' ||
        /review/i.test(prompt) ||
        /review/i.test(description)
      if (!isReviewer) {
        return { blocked: false }
      }
      const nextRound = (state.ralph?.round ?? 0) + 1
      if (!state.reviewerTakeover) {
        state.reviewerTakeover = {
          round: nextRound,
          interceptAt: new Date().toISOString(),
          spawnPhase: 'pending',
        }
        return {
          blocked: true,
          state_mutated: true,
          auditType: 'first_intercept',
          redirectDirective: `Use tdd_get_review_result to get review results (round=${nextRound})`,
        }
      }
      return {
        blocked: true,
        auditType: 'cached',
        redirectDirective: `Use tdd_get_review_result to get review results (round=${state.reviewerTakeover.round})`,
      }
    },
  }
}

export function logInterceptAudit(result: ReviewerInterceptResult): void {
  if (result.auditType === 'missing_session_id') {
    console.error('ERROR: calling_session_id missing in intercept evaluation')
  } else if (result.auditType === 'first_intercept') {
    console.log(`INTERCEPT: reviewer_takeover detected`)
  } else if (result.auditType === 'cached') {
    console.debug('CACHED: returning cached block for reviewer intercept')
  }
}
