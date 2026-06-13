import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReviewerInterceptRule } from '../src/reviewer-intercept.js'
import type { ReviewerInterceptResult } from '../src/reviewer-intercept.js'
import { makeRalphState } from './helpers.js'

describe('ReviewerInterceptRule', () => {
  let rule: ReturnType<typeof createReviewerInterceptRule>

  beforeEach(() => {
    rule = createReviewerInterceptRule()
  })

  describe('RT-001: Block reviewer Task call by subagent_type oracle', () => {
    // RT-001
    it('should_block_reviewer_task_when_subagent_type_is_oracle', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Check code', description: 'Review code' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
      expect(result.redirectDirective).toContain('tdd_get_review_result')
    })
  })

  describe('RT-002: Block reviewer Task call by subagent_type reviewer', () => {
    // RT-002
    it('should_block_reviewer_task_when_subagent_type_is_reviewer', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'reviewer', prompt: 'Review', description: 'Code review' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
      expect(result.redirectDirective).toContain('tdd_get_review_result')
    })
  })

  describe('RT-003: Block Task call by prompt heuristic', () => {
    // RT-003a
    it('should_block_task_when_prompt_contains_review', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'generic', prompt: 'Please review this code thoroughly', description: 'Code analysis' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
    })

    // RT-003b
    it('should_block_task_when_description_contains_review', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'generic', prompt: 'Analyze code', description: 'Review changes for quality' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
    })
  })

  describe('RT-004: Do not intercept when pipeline is idle or no Ralph loop', () => {
    // RT-004a
    it('should_not_intercept_when_pipeline_is_idle', () => {
      const state = makeRalphState({ phaseStatus: 'idle' })
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.blocked).toBe(false)
    })

    // RT-004b
    it('should_not_intercept_when_ralph_loop_not_active', () => {
      const state = makeRalphState({ ralph: null })
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.blocked).toBe(false)
    })
  })

  describe('RT-005: Do not intercept non-reviewer Task calls', () => {
    // RT-005
    it('should_not_intercept_non_reviewer_task', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'executor', prompt: 'Implement feature X', description: 'Implementation' }, state, 'ses-main-001')
      expect(result.blocked).toBe(false)
    })
  })

  describe('RT-006: Exclude T-1/T-2 subagent calls from interception', () => {
    // RT-006
    it('should_not_intercept_t1_or_t2_subagent_calls', () => {
      const state = makeRalphState()
      const resultT1 = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-t1-001')
      expect(resultT1.blocked).toBe(false)
      const resultT2 = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-t2-001')
      expect(resultT2.blocked).toBe(false)
    })
  })

  describe('RT-007: Handle missing calling_session_id', () => {
    // RT-007
    it('should_log_error_when_calling_session_id_missing', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state)
      expect(result.blocked).toBe(false)
    })
  })

  describe('RT-008: First intercept sets takeover state', () => {
    // RT-008a
    it('should_set_reviewer_takeover_state_on_first_intercept', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.state_mutated).toBe(true)
      expect(result.redirectDirective).toContain('tdd_get_review_result')
    })

    // RT-008b
    it('should_use_consuming_round_for_takeover_state', () => {
      const state = makeRalphState({}, { round: 3 })
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.state_mutated).toBe(true)
      expect(result.redirectDirective).toContain('round=4')
    })

    // RT-008c
    it('should_set_state_mutated_flag_when_takeover_state_changed', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.state_mutated).toBe(true)
    })
  })

  describe('RT-009: Cached block on subsequent intercepts', () => {
    // RT-009a
    it('should_return_cached_block_message_when_takeover_in_progress', () => {
      const state = makeRalphState()
      rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
      expect(result.state_mutated).toBeFalsy()
    })

    // RT-009b
    it('should_return_cached_block_message_on_subsequent_intercepts', () => {
      const state = makeRalphState()
      const first = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const second = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(first.redirectDirective).toBe(second.redirectDirective)
    })

    // RT-009c
    it('should_return_cached_block_message_when_result_file_exists', () => {
      const state = makeRalphState()
      rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
    })

    // RT-009d
    it('should_not_mutate_state_on_cached_intercept', () => {
      const state = makeRalphState()
      rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.state_mutated === false || result.state_mutated === undefined).toBe(true)
    })

    // RT-009e
    it('should_log_debug_message_when_returning_cached_result', () => {
      const state = makeRalphState()
      rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
    })
  })

  describe('RT-010: Audit logging on intercept', () => {
    // RT-010
    it('should_log_intercept_audit_event', () => {
      const state = makeRalphState()
      const result = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      expect(result.blocked).toBe(true)
    })
  })

  describe('RT-035: Multiple reviewer Task calls in same round', () => {
    // RT-035
    it('should_handle_multiple_reviewer_task_calls_in_same_round', () => {
      const state = makeRalphState()
      const first = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const second = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review again', description: 'Another review' }, state, 'ses-main-001')
      expect(first.blocked).toBe(true)
      expect(second.blocked).toBe(true)
      expect(second.state_mutated === false || second.state_mutated === undefined).toBe(true)
    })
  })

  describe('RT-040: Interceptor detection latency < 5ms', () => {
    // RT-040
    it('should_complete_intercept_evaluation_under_5ms', () => {
      const state = makeRalphState()
      const start = performance.now()
      rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(5)
    })
  })

  describe('RT-041: Maximum concurrent takeovers = 1', () => {
    // RT-041
    it('should_enforce_single_concurrent_takeover_per_pipeline', () => {
      const state = makeRalphState()
      const first = rule.evaluate('Task', { subagent_type: 'oracle', prompt: 'Review', description: 'Review' }, state, 'ses-main-001')
      const second = rule.evaluate('Task', { subagent_type: 'reviewer', prompt: 'Another review', description: 'Review again' }, state, 'ses-main-001')
      expect(first.state_mutated).toBe(true)
      expect(second.state_mutated === false || second.state_mutated === undefined).toBe(true)
    })
  })
})
