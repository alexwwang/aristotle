import type { PipelineState } from './schema.js'
import type { ReviewerTakeoverState, DualPassPhase } from './reviewer-intercept.js'

export interface ReviewerSpawnResult {
  success: boolean
  t1SessionId?: string
  t2SessionId?: string
  t1Degraded?: boolean
  pipelineAction?: 'suspend' | 'resume' | 'block' | 'auto-commit'
  action?: 'blocked' | 'auto-committed' | 'suspended' | 'resumed'
  error?: string
}

export function createReviewerSpawnHandler(): {
  onIdle(state: PipelineState): Promise<ReviewerSpawnResult>
  spawnT1(state: PipelineState): Promise<string>
  spawnT2(state: PipelineState, factContextPath: string): Promise<string>
  waitForIdle(sessionId: string): Promise<void>
  writeResultFile(state: PipelineState, findings: unknown[], decisions?: unknown[]): void
  writeFailedResultFile(state: PipelineState, error: string): void
  convertLegacyAction(legacy: { action: string }): ReviewerSpawnResult
} {
  throw new Error('Not implemented: createReviewerSpawnHandler')
}
