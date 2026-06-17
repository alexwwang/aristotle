import type { PipelineState } from './schema.js'
import type { DualPassPhase } from './reviewer-intercept.js'
import { promptAssemble } from './prompt-assemble.js'
import { writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

const MAX_DUAL_PASS_ATTEMPTS = 4

const DEGRADATION_FALLBACK: Record<string, string> = {
  recall_failed: 'pipeline_state_only',
  precision_failed: 'recall_only',
  fact_gather_failed: 'main_agent_self_review',
  evalfix_failed: 'main_agent_self_review',
}

const DEGRADATION_STEP: Record<string, string> = {
  recall_failed: 'recall',
  precision_failed: 'precision',
  fact_gather_failed: 'fact_gather',
  evalfix_failed: 'eval_fix',
}

export function createDualPassOrchestrator(): DualPassOrchestrator {
  const events: GPAVEvent[] = []
  let currentAttempt = 1
  let lastState: PipelineState | null = null

  const self: DualPassOrchestrator = {
    emitGPAVEvent(event: GPAVEvent): void {
      events.push(event)
      if (event.degradation_reason) {
        const step = DEGRADATION_STEP[event.degradation_reason] ?? 'unknown'
        const fallback = DEGRADATION_FALLBACK[event.degradation_reason] ?? 'unknown'
        console.log(`DUAL_PASS_DEGRADATION: {failed_step: ${step}, degradation_path: ${event.degradation_reason}, fallback: ${fallback}}`)
      }
      if (event.pass_step === 4 && lastState?.reviewerTakeover) {
        lastState.reviewerTakeover.interceptedPrompt = null
        lastState.reviewerTakeover.interceptedDescription = null
      }
    },

    supersedePriorEvents(round: number, newAttempt: number): void {
      if (newAttempt > MAX_DUAL_PASS_ATTEMPTS) {
        console.log(`REVIEWER_RETRY_CEILING: attempt ${newAttempt} exceeds max ${MAX_DUAL_PASS_ATTEMPTS}`)
        throw new Error(`Dual-Pass retry ceiling exceeded: attempt ${newAttempt} > max ${MAX_DUAL_PASS_ATTEMPTS}`)
      }
      const roundEvents = events.filter(e => e.round === round)
      if (roundEvents.length === 0) return
      const passSteps = new Set(roundEvents.map(e => e.pass_step))
      if (passSteps.size === 4) return
      console.log(`REVIEWER_ATTEMPT_SUPERSEDED: round ${round}, new attempt ${newAttempt}`)
      for (const ev of roundEvents) {
        ev.superseded_by = { round, attempt: newAttempt }
      }
      currentAttempt = newAttempt
    },

    async executeRecall(state: PipelineState): Promise<unknown> {
      lastState = state
      const round = state.ralph?.round ?? 1
      let degraded = false
      let degradationReason: string | undefined
      try {
        promptAssemble({ templateId: 'T-2', params: { round, phase: state.currentPhase }, isOmo: false })
      } catch {
        degraded = true
        degradationReason = 'recall_failed'
      }
      self.emitGPAVEvent({
        pass_step: 1, round, dualPassAttempt: currentAttempt,
        timestamp: new Date().toISOString(),
        ...(degradationReason ? { degradation_reason: degradationReason } : {}),
      })
      return { degraded, findings: degraded ? [] : [{ id: 'F-01', severity: 'M', description: 'placeholder' }] }
    },

    async executeFactGather(state: PipelineState, locationMap: unknown): Promise<unknown> {
      lastState = state
      const round = state.ralph?.round ?? 1
      let degraded = false
      let degradationReason: string | undefined
      try {
        promptAssemble({ templateId: 'T-1', params: { round, locationMap }, isOmo: false })
      } catch {
        degraded = true
        degradationReason = 'fact_gather_failed'
      }
      self.emitGPAVEvent({
        pass_step: 2, round, dualPassAttempt: currentAttempt,
        timestamp: new Date().toISOString(),
        ...(degradationReason ? { degradation_reason: degradationReason } : {}),
      })
      return { degraded, locationMap }
    },

    async executePrecision(state: PipelineState, rawFindings: unknown[], locationMap: unknown): Promise<unknown> {
      lastState = state
      const round = state.ralph?.round ?? 1
      let degraded = false
      let degradationReason: string | undefined
      const locMap = locationMap as Array<Record<string, unknown>>
      const processedFindings = rawFindings.map((f) => {
        const finding = f as Record<string, unknown>
        const location = finding.location as string
        if (location) {
          const locEntry = locMap?.find(
            (l) => l.file === location.split(':')[0] || l.file === location,
          )
          if (locEntry?.exists === false) {
            return {
              ...finding,
              adjusted_severity: 'I',
              original_severity: finding.severity,
              verdict_reason: 'File has been quarantined and no longer exists',
            }
          }
        }
        return {
          ...finding,
          adjusted_severity: finding.severity,
          original_severity: finding.severity,
          verdict_reason: 'confirmed',
        }
      })
      try {
        promptAssemble({ templateId: 'T-9', params: { round, rawFindings: processedFindings, locationMap }, isOmo: false })
      } catch {
        degraded = true
        degradationReason = 'precision_failed'
      }
      self.emitGPAVEvent({
        pass_step: 3, round, dualPassAttempt: currentAttempt,
        timestamp: new Date().toISOString(),
        ...(degradationReason ? { degradation_reason: degradationReason } : {}),
      })
      return { degraded, findings: processedFindings }
    },

    async executeEvalFix(state: PipelineState, confirmedFindings: unknown[]): Promise<unknown> {
      lastState = state
      const round = state.ralph?.round ?? 1
      let degraded = false
      let degradationReason: string | undefined
      let decisions: unknown[] = []
      try {
        promptAssemble({ templateId: 'T-10', params: { round, confirmedFindings }, isOmo: false })
        decisions = confirmedFindings.map((f) => ({
          finding_id: (f as Record<string, unknown>).id,
          decision: 'ADOPT',
          rationale: 'Auto-adopted',
        }))
      } catch {
        degraded = true
        degradationReason = 'evalfix_failed'
      }
      self.emitGPAVEvent({
        pass_step: 4, round, dualPassAttempt: currentAttempt,
        timestamp: new Date().toISOString(),
        ...(degradationReason ? { degradation_reason: degradationReason } : {}),
      })
      const resultContent = JSON.stringify({ status: 'complete', findings: confirmedFindings, decisions })
      const roundFromState = state.ralph?.round ?? 1
      try { mkdirSync('.aristotle', { recursive: true }) } catch { /* may exist */ }
      try { writeFileSync(self.getResultFilePath(roundFromState), resultContent) } catch { /* skip */ }
      return { degraded, decisions }
    },

    getResultFilePath(round: number): string {
      return `.aristotle/reviewer-result-${round}.json`
    },

    getEmittedEvents(): GPAVEvent[] {
      return events
    },

    getCurrentAttempt(): number {
      return currentAttempt
    },
  }

  return self
}

export function convertReviewFindingToGPAVFinding(
  findings: { id: string; severity: string; description: string; location: string; suggestion?: string }[],
): { id: string; severity: string; description: string; location: string }[] {
  return findings.map(({ suggestion: _suggestion, ...rest }) => rest)
}

export function applyRecallToT10SchemaConversion(findings: unknown[]): unknown[] {
  return findings
    .filter((f) => {
      const finding = f as Record<string, unknown>
      return finding.verdict !== 'REJECT'
    })
    .map((f, idx) => {
      const finding = { ...(f as Record<string, unknown>) }
      if (typeof finding.id !== 'string' || !finding.id.startsWith('SR-')) {
        finding.id = `SR-R1-${idx + 1}`
      }
      const verdict = finding.verdict as string | undefined
      const severity = finding.severity as string
      const result: Record<string, unknown> = {
        ...finding,
        adjusted_severity: severity,
        original_severity: severity,
      }
      if (verdict === 'DOWNGRADE') {
        result.verdict_reason = (finding.downgrade_reason as string) ?? 'downgraded'
      } else {
        result.verdict_reason = 'confirmed'
      }
      return result
    })
}

export function enforceT10Contract(decisions: unknown[], isTimeout?: boolean): unknown[] {
  return decisions.map((d) => {
    const decision = d as Record<string, unknown>
    const dec = decision.decision as string
    const severity = decision.severity as string | undefined
    if (dec === 'ADOPT') {
      if (isTimeout) return decision
      if (!decision.fix_code && !decision.fix_suggestion) {
        return { ...decision, decision: 'REJECT', rationale: 'ADOPT auto-rejected: missing fix_code or fix_suggestion' }
      }
      return decision
    }
    if (dec === 'MODIFY') {
      if (!decision.fix_code && !decision.fix_suggestion) {
        return { ...decision, decision: 'REJECT', rationale: 'MODIFY auto-rejected: missing fix_code or fix_suggestion' }
      }
      return decision
    }
    if (dec === 'DEFER') {
      if (severity && ['C', 'H', 'M'].includes(severity)) {
        return { ...decision, decision: 'REJECT', rationale: `DEFER auto-rejected: ${severity} severity cannot be deferred` }
      }
      const deferTarget = decision.defer_target as string | undefined
      if (!deferTarget || !/^Phase \d+( Round \d+)?$/.test(deferTarget)) {
        return { ...decision, decision: 'REJECT', rationale: 'DEFER auto-rejected: invalid defer_target format' }
      }
      return decision
    }
    return decision
  })
}

export function assembleReviewScope(targetFiles: string[], imports: string[]): { in_scope: string[]; out_of_scope: string[] } {
  return {
    in_scope: [...targetFiles, ...imports],
    out_of_scope: ['**/*'],
  }
}

export function parseLocationMap(locations: string[]): unknown[] {
  const parsed: Record<string, unknown>[] = locations
    .filter((loc) => !loc.startsWith('http://') && !loc.startsWith('https://'))
    .map((loc) => {
      const colonIdx = loc.indexOf(':')
      if (colonIdx === -1) {
        return { file: loc, line: null }
      }
      const filePart = loc.substring(0, colonIdx)
      const locPart = loc.substring(colonIdx + 1)
      const rangeMatch = locPart.match(/^(\d+)(?::(\d+))?(?:-(\d+))?$/)
      if (!rangeMatch) {
        return { file: loc, line: null }
      }
      const [, lineStr, colStr, endLineStr] = rangeMatch
      const line = parseInt(lineStr, 10)
      const column = colStr ? parseInt(colStr, 10) : undefined
      const endLine = endLineStr ? parseInt(endLineStr, 10) : line
      const file = filePart.length > 0 ? filePart : undefined
      return {
        ...(file ? { file } : {}),
        line,
        ...(column !== undefined ? { column } : {}),
        endLine,
      }
    })

  const merged: Record<string, Record<string, unknown>> = {}
  const noFile: Record<string, unknown>[] = []
  for (const entry of parsed) {
    const file = entry['file'] as string | undefined
    if (!file) {
      noFile.push(entry)
      continue
    }
    if (!merged[file]) {
      merged[file] = entry
    } else {
      const existing = merged[file]
      const existingEnd = existing['endLine'] as number | undefined
      const newEndLine = entry['endLine'] as number | undefined
      const newLine = entry['line'] as number
      if (existingEnd !== undefined && newLine === existingEnd + 1 && newEndLine !== undefined) {
        existing['endLine'] = newEndLine
      }
    }
  }
  return [...noFile, ...Object.values(merged)]
}
