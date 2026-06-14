import type { PipelineState } from './schema.js'
import type { DualPassPhase, ReviewerTakeoverState } from './reviewer-intercept.js'

export interface GPAVEvent {
  pass_step: 1 | 2 | 3 | 4
  round: number
  dualPassAttempt: number
  timestamp: string
  degradation_reason?: string
  cascade_skipped?: boolean
  superseded_by?: { round: number; attempt: number }
}

export interface DualPassConfig {
  dualPassMode: boolean
  dualPassPhase: DualPassPhase
  dualPassAttempt: number
}

export interface GPAVResult {
  findings: unknown[]
  decisions: unknown[]
  gpavEvents: GPAVEvent[]
}

export interface DualPassOrchestrator {
  executeRecall(state: PipelineState): Promise<unknown>
  executeFactGather(state: PipelineState, locationMap: unknown): Promise<unknown>
  executePrecision(state: PipelineState, rawFindings: unknown[], locationMap: unknown): Promise<unknown>
  executeEvalFix(state: PipelineState, confirmedFindings: unknown[]): Promise<unknown>
  emitGPAVEvent(event: GPAVEvent): void
  supersedePriorEvents(round: number, newAttempt: number): void
  getResultFilePath(round: number): string
  getEmittedEvents(): GPAVEvent[]
  getCurrentAttempt(): number
}

export function createDualPassOrchestrator(): DualPassOrchestrator {
  throw new Error('Not implemented: createDualPassOrchestrator')
}

export function convertReviewFindingToGPAVFinding(findings: { id: string; severity: string; description: string; location: string; suggestion?: string }[]): { id: string; severity: string; description: string; location: string }[] {
  throw new Error('Not implemented: convertReviewFindingToGPAVFinding')
}

export function applyRecallToT10SchemaConversion(findings: unknown[]): unknown[] {
  throw new Error('Not implemented: applyRecallToT10SchemaConversion')
}

export function enforceT10Contract(decisions: unknown[], isTimeout?: boolean): unknown[] {
  throw new Error('Not implemented: enforceT10Contract')
}

export function assembleReviewScope(targetFiles: string[], imports: string[]): { in_scope: string[]; out_of_scope: string[] } {
  throw new Error('Not implemented: assembleReviewScope')
}

export function parseLocationMap(locations: string[]): unknown[] {
  throw new Error('Not implemented: parseLocationMap')
}
