import { describe, it, expect } from 'vitest'
import { TaskTemplateRegistry } from '../src/registry.js'

describe('TaskTemplateRegistry', () => {
  const registry = new TaskTemplateRegistry()

  // TC-REG-001
  it('should_retrieve_template_by_valid_id', () => {
    const template = registry.get_template('T-1')
    expect(template.id).toBe('T-1')
    expect(template.name).toBe('fact_gather')
    expect(template.subagent_type).toBe('explore')
    expect(template.timeout).toBe(55)
    expect(template.input_schema).toBeDefined()
    expect(template.output_schema).toBeDefined()
    expect(template.role_definition).toBeDefined()
    expect(template.instruction_template).toBeDefined()
  })

  // TC-REG-002
  it('should_list_all_template_ids', () => {
    const ids = registry.list_templates()
    expect(ids).toContain('T-1')
    expect(ids).toContain('T-2')
    expect(ids).toContain('T-3')
    expect(ids).toContain('T-4')
    expect(ids).toContain('T-5')
    expect(ids).toContain('T-6')
    expect(ids).toContain('T-7')
    expect(ids).toContain('T-7b')
    expect(ids).toContain('T-8')
    expect(ids).toContain('T-9')
    expect(ids).toContain('T-10')
    expect(ids).toHaveLength(11)
  })

  // TC-REG-003
  it('should_validate_correct_params', () => {
    const result = registry.validate_params('T-1', {
      phase: 1, round: 2, runId: 'run-abc123', projectId: 'project-xyz', scope: 'full',
    })
    expect(result.valid).toBe(true)
  })

  // TC-REG-004
  it('should_reject_unknown_template_id', () => {
    expect(() => registry.get_template('T-99')).toThrow()
  })

  // TC-REG-005
  it('should_detect_missing_required_params', () => {
    const result = registry.validate_params('T-1', { phase: 1 })
    expect(result.valid).toBe(false)
    expect(result.errors?.length).toBeGreaterThan(0)
  })

  // TC-REG-006
  it('should_detect_unexpected_params', () => {
    const result = registry.validate_params('T-1', {
      phase: 1, round: 2, runId: 'run-abc123', projectId: 'project-xyz', scope: 'full',
      unexpected_field: 'value',
    })
    expect(result.valid).toBe(false)
  })

  // TC-REG-007
  it('should_reject_parameter_type_mismatch', () => {
    const result = registry.validate_params('T-1', {
      phase: 'not-a-number', round: 2, runId: 'run-abc123', projectId: 'project-xyz', scope: 'full',
    })
    expect(result.valid).toBe(false)
  })
})
