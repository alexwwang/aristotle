import type { PipelineState } from './schema.js'

export function cleanupStaleState(
  trigger: 'suspend' | 'resume' | 'start' | 'ralph_loop_start' | 'phase_complete' | 'ralph_terminate',
  state: PipelineState,
): PipelineState {
  throw new Error('Not implemented: cleanupStaleState')
}

export function generateCleanupToken(): string {
  throw new Error('Not implemented: generateCleanupToken')
}

export function validateCleanupToken(state: PipelineState, token: string): boolean {
  throw new Error('Not implemented: validateCleanupToken')
}

export function deleteResultFiles(runId: string, round: number, verifySessionId?: boolean): void {
  throw new Error('Not implemented: deleteResultFiles')
}
