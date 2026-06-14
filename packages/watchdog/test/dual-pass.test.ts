import { describe, it, expect } from 'vitest'
import { runDualPass } from '../src/dual-pass.js'
import type { GPAVFinding, DualPassConfig } from '../src/dual-pass.js'

describe('Dual-Pass Integration', () => {
  const findings: GPAVFinding[] = [
    { id: 'F-01', severity: 'H', description: 'Missing error handling', location: 'src/main.ts:42' },
    { id: 'F-02', severity: 'M', description: 'Unused variable', location: 'src/util.ts:10' },
    { id: 'F-03', severity: 'C', description: 'SQL injection', location: 'src/db.ts:55' },
    { id: 'F-04', severity: 'P', description: 'Refactor suggestion', location: 'src/api.ts:100' },
  ]
  const config: DualPassConfig = {
    maxRounds: 1,
    recallTimeout: 55,
    precisionTimeout: 60,
    evalFixTimeout: 120,
  }

  // TC-DP-001
  it('should_emit_4_gpav_events_per_round', () => {
    const result = runDualPass(config, findings)
    expect(result.events).toHaveLength(4)
    expect(result.events.map(e => e.pass_step)).toEqual([1, 2, 3, 4])
  })

  // TC-DP-002
  it('should_degrade_recall_failed_to_pipeline_state', () => {
    const failConfig: DualPassConfig = { ...config, recallTimeout: 0 }
    const result = runDualPass(failConfig, findings)
    const recallEvent = result.events.find(e => e.pass_step === 1)
    expect(recallEvent).toBeDefined()
    expect(recallEvent?.degradation).toBeDefined()
  })

  // TC-DP-003
  it('should_degrade_fact_gather_failed_to_main_agent', () => {
    const result = runDualPass(config, findings)
    const fgEvent = result.events.find(e => e.pass_step === 2)
    expect(fgEvent).toBeDefined()
    expect(fgEvent?.degradation).toContain('main-agent')
  })

  // TC-DP-004
  it('should_degrade_precision_failed_to_recall_only', () => {
    const failConfig: DualPassConfig = { ...config, precisionTimeout: 0 }
    const result = runDualPass(failConfig, findings)
    const precisionEvent = result.events.find(e => e.pass_step === 3)
    expect(precisionEvent).toBeDefined()
    expect(precisionEvent?.degradation).toContain('recall_only')
  })

  // TC-DP-005
  it('should_degrade_eval_fix_failed_to_confirmed_findings', () => {
    const failConfig: DualPassConfig = { ...config, evalFixTimeout: 0 }
    const result = runDualPass(failConfig, findings)
    const evalEvent = result.events.find(e => e.pass_step === 4)
    expect(evalEvent).toBeDefined()
    expect(evalEvent?.degradation).toContain('confirmed_findings')
  })

  // TC-DP-006
  it('should_propagate_originating_reason_in_cascade_skip', () => {
    const result = runDualPass(config, findings)
    expect(result.originatingReason).toBeDefined()
    expect(result.originatingReason.length).toBeGreaterThan(0)
  })
})
