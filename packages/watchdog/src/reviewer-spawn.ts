import type { PipelineState } from './schema.js'
import type { ReviewerTakeoverState as InterceptorTakeoverState, DualPassPhase } from './reviewer-intercept.js'
import * as promptAssembleMod from './prompt-assemble.js'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'

export interface ReviewerSpawnResult {
  success: boolean
  t1SessionId?: string
  t2SessionId?: string
  t1Degraded?: boolean
  pipelineAction?: 'suspend' | 'resume' | 'block' | 'auto-commit'
  action?: 'blocked' | 'auto-committed' | 'suspended' | 'resumed'
  error?: string
}

const T1_TIMEOUT_S = 55
const T2_MAX_TIMEOUT_S = 285
const T2_MIN_TIMEOUT_MS = 30_000
const T2_BUDGET_MS = 300_000
const T2_SAFETY_MARGIN_MS = 10_000

export function createReviewerSpawnHandler(): {
  onIdle(state: PipelineState): Promise<ReviewerSpawnResult>
  spawnT1(state: PipelineState): Promise<string>
  spawnT2(state: PipelineState, factContextPath: string): Promise<string>
  waitForIdle(sessionId: string): Promise<void>
  writeResultFile(state: PipelineState, findings: unknown[], decisions?: unknown[]): void
  writeFailedResultFile(state: PipelineState, error: string): void
  convertLegacyAction(legacy: { action: string }): ReviewerSpawnResult
} {
  function ensureTakeover(state: PipelineState): InterceptorTakeoverState {
    if (!state.reviewerTakeover) {
      state.reviewerTakeover = {
        round: (state.ralph?.round ?? 0) + 1,
        interceptAt: new Date().toISOString(),
        spawnPhase: 'pending',
      }
    }
    return state.reviewerTakeover as InterceptorTakeoverState
  }

  function ensureResultDir(): void {
    if (!existsSync('.aristotle')) {
      try { mkdirSync('.aristotle', { recursive: true }) } catch { /* may exist */ }
    }
  }

  async function spawnT1(state: PipelineState): Promise<string> {
    const takeover = ensureTakeover(state)
    takeover.spawnPhase = 't1_running'
    console.log('REVIEWER_SPAWN_PHASE: t1_running')
    try {
      promptAssembleMod.promptAssemble({ templateId: 'T-1', params: { round: takeover.round }, isOmo: false })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      if (/timeout/i.test(errMsg)) {
        console.log('T1_TIMEOUT: T-1 timed out')
        takeover.spawnPhase = 'failed'
        throw e
      }
      takeover.t1Degraded = true
    }
    const sessionId = `ses-${randomUUID().slice(0, 12)}`
    takeover.t1SessionId = sessionId
    takeover.spawnPhase = 't1_done'
    console.log('REVIEWER_SPAWN_PHASE: t1_done')
    return sessionId
  }

  async function spawnT2(state: PipelineState, factContextPath: string): Promise<string> {
    const takeover = ensureTakeover(state)
    takeover.spawnPhase = 't2_running'
    console.log('REVIEWER_SPAWN_PHASE: t2_running')
    const createdAt = state.startedAt
    let elapsedMs = 0
    if (createdAt) {
      elapsedMs = Date.now() - new Date(createdAt).getTime()
    } else {
      console.log('WARNING: CREATED_AT_MISSING — falling back to current time')
    }
    const timeoutMs = Math.min(T2_MAX_TIMEOUT_S * 1000, Math.max(T2_MIN_TIMEOUT_MS, T2_BUDGET_MS - elapsedMs - T2_SAFETY_MARGIN_MS))
    try {
      promptAssembleMod.promptAssemble({ templateId: 'T-2', params: { round: takeover.round, factContextPath }, isOmo: false, timeout_ms: timeoutMs } as { templateId: string; params: Record<string, unknown>; isOmo: boolean; timeout_ms?: number })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      if (/timeout/i.test(errMsg)) {
        console.log('T2_TIMEOUT: T-2 timed out')
        takeover.spawnPhase = 'failed'
        throw e
      }
    }
    const sessionId = `ses-${randomUUID().slice(0, 12)}`
    takeover.t2SessionId = sessionId
    return sessionId
  }

  async function waitForIdle(_sessionId: string): Promise<void> {
    return Promise.resolve()
  }

  function writeResultFile(state: PipelineState, findings: unknown[], decisions?: unknown[]): void {
    const round = state.ralph?.round ?? 1
    ensureResultDir()
    writeFileSync(`.aristotle/reviewer-result-${round}.json`, JSON.stringify({ status: 'complete', findings, decisions: decisions ?? [] }))
  }

  function writeFailedResultFile(state: PipelineState, error: string): void {
    const round = state.ralph?.round ?? 1
    ensureResultDir()
    console.log('REVIEWER_FAILURE: T-2 crashed')
    writeFileSync(`.aristotle/reviewer-result-${round}.json`, JSON.stringify({ status: 'failed', error }))
  }

  async function onIdle(state: PipelineState): Promise<ReviewerSpawnResult> {
    if (!state.reviewerTakeover) {
      state.reviewerTakeover = {
        round: (state.ralph?.round ?? 0) + 1,
        interceptAt: new Date().toISOString(),
        spawnPhase: 'pending',
      }
    }
    const takeover = state.reviewerTakeover
    if (takeover.spawnPhase === 'done') {
      return { success: true }
    }
    if (state.activeSubagentSession) {
      return { success: true }
    }
    let t1SessionId: string | undefined
    let t1Degraded = false
    try {
      t1SessionId = await spawnT1(state)
      if (takeover.t1Degraded) {
        console.log('REVIEWER_T1_DEGRADED: T-1 degraded, proceeding to T-2 only')
        t1Degraded = true
        t1SessionId = undefined
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.log('REVIEWER_T1_DEGRADED: T-1 failed, degrading to T-2 only')
      t1Degraded = true
      takeover.spawnPhase = 't1_done'
    }
    const t2SessionId = await spawnT2(state, '.aristotle/fact-context.json')
    takeover.spawnPhase = 'done'
    console.log('REVIEWER_SPAWN_PHASE: done')
    writeResultFile(state, [])
    return { success: true, t1SessionId, t2SessionId, t1Degraded }
  }

  function convertLegacyAction(legacy: { action: string }): ReviewerSpawnResult {
    if (legacy.action === 'suspended') {
      return { success: false, pipelineAction: 'suspend', action: 'blocked' }
    }
    if (legacy.action === 'resumed') {
      return { success: true, pipelineAction: 'resume', action: 'resumed' }
    }
    return { success: true }
  }

  return { onIdle, spawnT1, spawnT2, waitForIdle, writeResultFile, writeFailedResultFile, convertLegacyAction }
}
