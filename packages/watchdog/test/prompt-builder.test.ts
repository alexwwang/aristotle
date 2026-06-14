import { describe, it, expect, beforeEach } from 'vitest'
import { PromptBuilder } from '../src/prompt-builder.js'
import { TaskTemplateRegistry } from '../src/registry.js'

describe('PromptBuilder', () => {
  let registry: TaskTemplateRegistry
  let builder: PromptBuilder
  beforeEach(() => {
    registry = new TaskTemplateRegistry()
    builder = new PromptBuilder()
  })

  // TC-PB-001
  it('should_generate_short_prompt_when_omo_detected', () => {
    const template = registry.get_template('T-2')
    const result = builder.build(template, { phase: 1, round: 2, runId: 'run-001', projectId: 'proj-1' }, true)
    expect(result.is_omo).toBe(true)
    expect(result.token_estimate).toBeLessThanOrEqual(330)
    expect(result.prompt).not.toContain('You are a strict code reviewer')
  })

  // TC-PB-002
  it('should_generate_long_prompt_with_role_definition', () => {
    const template = registry.get_template('T-2')
    const result = builder.build(template, { phase: 1, round: 2, runId: 'run-001', projectId: 'proj-1' }, false)
    expect(result.is_omo).toBe(false)
    expect(result.prompt).toContain('You are a strict code reviewer')
    expect(result.token_estimate).toBeLessThanOrEqual(1500)
  })

  // TC-PB-003
  it('should_substitute_template_parameters', () => {
    const template = registry.get_template('T-1')
    const result = builder.build(template, { phase: 3, round: 5, runId: 'run-001', projectId: 'proj-1', scope: 'full' }, true)
    expect(result.prompt).toContain('Phase 3')
    expect(result.prompt).toContain('Round 5')
  })

  // TC-PB-004
  it('should_raise_keyerror_on_missing_parameter', () => {
    const template = registry.get_template('T-1')
    expect(() => builder.build(template, {}, true)).toThrow()
  })

  // TC-PB-005
  it('should_get_subagent_type_from_schema', () => {
    const template = registry.get_template('T-2')
    const subagentType = builder.get_subagent_type(template)
    expect(subagentType).toBe('oracle')
  })

  // TC-PB-006
  it('should_get_timeout_from_schema', () => {
    const template = registry.get_template('T-2')
    const timeout = builder.get_timeout(template)
    expect(timeout).toBeGreaterThanOrEqual(30)
    expect(timeout).toBeLessThanOrEqual(285)
  })

  // TC-PB-007
  it('should_include_tdd_protocol_summary_in_prompt', () => {
    const template = registry.get_template('T-2')
    const result = builder.build(template, { phase: 4, round: 1, runId: 'run-001', projectId: 'proj-1' }, false)
    expect(result.prompt).toContain('TDD')
    // Verify TDD protocol-specific terms, not just the acronym.
    const tddTerms = ['Red', 'Green', 'Refactor']
    const hasProtocolTerm = tddTerms.some(term => result.prompt.includes(term))
    expect(hasProtocolTerm).toBe(true)
  })
})
