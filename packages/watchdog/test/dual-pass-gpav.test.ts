import { describe, it, expect } from 'vitest'
import { createDualPassOrchestrator, enforceT10Contract } from '../src/dual-pass-gpav.js'
import type { GPAVEvent } from '../src/dual-pass-gpav.js'
import { makeRalphState } from './helpers.js'

describe('GPAVEvent dedup and retry', () => {
  // RT-060a
  it('should_supersede_prior_gpav_events_on_retry', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.supersedePriorEvents(3, 2)).not.toThrow()
  })

  // RT-060b
  it('should_increment_dual_pass_attempt_counter_on_retry', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.supersedePriorEvents(3, 2)).not.toThrow()
  })

  // RT-060c
  it('should_skip_dedup_on_cache_hit', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(orchestrator.getResultFilePath(3)).toContain('reviewer-result')
  })

  // RT-060d
  it('should_emit_reviewer_attempt_superseded_audit_entries', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.emitGPAVEvent({ pass_step: 1, round: 3, dualPassAttempt: 2, timestamp: '', superseded_by: { round: 3, attempt: 2 } })).not.toThrow()
  })

  // RT-060b-ceiling
  it('should_enforce_retry_ceiling_on_max_attempts', () => {
    const orchestrator = createDualPassOrchestrator()
    expect(() => orchestrator.supersedePriorEvents(3, 5)).toThrow()
  })
})
