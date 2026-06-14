import { describe, it, expect, vi } from 'vitest'
import { createDualPassOrchestrator } from '../src/dual-pass-gpav.js'
import type { GPAVEvent } from '../src/dual-pass-gpav.js'

// Spec Constraint #5: 1 initial + 3 retries = 4 total Dual-Pass attempts
const MAX_DUAL_PASS_ATTEMPTS = 4

describe('GPAVEvent dedup and retry', () => {
  // RT-060a — F-016: prior event's superseded_by must equal new {round, attempt}
  it('should_supersede_prior_gpav_events_on_retry', () => {
    const orchestrator = createDualPassOrchestrator()
    const ts = new Date().toISOString()
    orchestrator.emitGPAVEvent({ pass_step: 1, round: 3, dualPassAttempt: 1, timestamp: ts })
    orchestrator.emitGPAVEvent({ pass_step: 2, round: 3, dualPassAttempt: 1, timestamp: ts })
    orchestrator.supersedePriorEvents(3, 2)
    const events = orchestrator.getEmittedEvents() as GPAVEvent[]
    expect(events.length).toBeGreaterThanOrEqual(2)
    for (const ev of events) {
      expect(ev.superseded_by).toEqual({ round: 3, attempt: 2 })
    }
  })

  // RT-060b — F-016: state.dualPassAttempt must equal new attempt
  it('should_increment_dual_pass_attempt_counter_on_retry', () => {
    const orchestrator = createDualPassOrchestrator()
    const ts = new Date().toISOString()
    orchestrator.emitGPAVEvent({ pass_step: 1, round: 3, dualPassAttempt: 1, timestamp: ts })
    orchestrator.emitGPAVEvent({ pass_step: 2, round: 3, dualPassAttempt: 1, timestamp: ts })
    orchestrator.supersedePriorEvents(3, 2)
    const attempt = orchestrator.getCurrentAttempt()
    expect(attempt).toBe(2)
  })

  // RT-060c — F-016: cache-hit: no new GPAVEvents added
  it('should_skip_dedup_on_cache_hit', () => {
    const orchestrator = createDualPassOrchestrator()
    const ts = new Date().toISOString()
    orchestrator.emitGPAVEvent({ pass_step: 1, round: 3, dualPassAttempt: 1, timestamp: ts })
    orchestrator.emitGPAVEvent({ pass_step: 2, round: 3, dualPassAttempt: 1, timestamp: ts })
    orchestrator.emitGPAVEvent({ pass_step: 3, round: 3, dualPassAttempt: 1, timestamp: ts })
    orchestrator.emitGPAVEvent({ pass_step: 4, round: 3, dualPassAttempt: 1, timestamp: ts })
    const beforeCount = (orchestrator.getEmittedEvents() as GPAVEvent[]).length
    orchestrator.supersedePriorEvents(3, 2)
    const afterCount = (orchestrator.getEmittedEvents() as GPAVEvent[]).length
    expect(afterCount).toBe(beforeCount)
  })

  // RT-060d — F-016: filter audit log for REVIEWER_ATTEMPT_SUPERSEDED entries
  it('should_emit_reviewer_attempt_superseded_audit_entries', () => {
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const orchestrator = createDualPassOrchestrator()
    orchestrator.emitGPAVEvent({ pass_step: 1, round: 3, dualPassAttempt: 2, timestamp: '', superseded_by: { round: 3, attempt: 2 } })
    const supersededCalls = auditSpy.mock.calls.filter(
      call => call.some(arg => String(arg).includes('REVIEWER_ATTEMPT_SUPERSEDED')),
    )
    expect(supersededCalls.length).toBeGreaterThanOrEqual(1)
    auditSpy.mockRestore()
  })

  // RT-060b-ceiling — F-015: retry ceiling enforcement; no new GPAVEvents above MAX
  it('should_enforce_retry_ceiling_on_max_attempts', () => {
    const orchestrator = createDualPassOrchestrator()
    const auditSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const beforeEvents = (orchestrator.getEmittedEvents() as GPAVEvent[]).length
    expect(() => orchestrator.supersedePriorEvents(3, MAX_DUAL_PASS_ATTEMPTS + 1)).toThrow()
    const afterEvents = (orchestrator.getEmittedEvents() as GPAVEvent[]).length
    expect(afterEvents).toBe(beforeEvents)
    const ceilingCalls = auditSpy.mock.calls.filter(
      call => call.some(arg => String(arg).includes('REVIEWER_RETRY_CEILING')),
    )
    expect(ceilingCalls.length).toBeGreaterThanOrEqual(1)
    auditSpy.mockRestore()
  })
})
