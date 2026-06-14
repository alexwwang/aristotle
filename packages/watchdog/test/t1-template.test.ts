import { describe, it, expect } from 'vitest'
import { TaskTemplateRegistry } from '../src/registry.js'
import { PromptBuilder } from '../src/prompt-builder.js'

describe('T-1 Fact Gather', () => {
  const registry = new TaskTemplateRegistry()
  const builder = new PromptBuilder()

  // TC-T1-001
  // code_changes is an OUTPUT field (spec L385), not in T-1 input_schema.
  // Input validation uses only input fields; builder.build accepts extras
  // for placeholder substitution. Removing code_changes from validate_params
  // avoids contradiction with TC-REG-006 (extra fields → invalid).
  it('should_accept_empty_code_changes_as_valid', () => {
    const t1 = registry.get_template('T-1')
    const validation = registry.validate_params('T-1', {
      phase: 1, round: 1, runId: 'run-1', projectId: 'proj-1', scope: 'full',
    })
    expect(validation.valid).toBe(true)
    const result = builder.build(t1, {
      phase: 1, round: 1, runId: 'run-1', projectId: 'proj-1', scope: 'full',
      code_changes: [],
    }, true)
    expect(result).toBeDefined()
    expect(result.prompt).toBeDefined()
  })

  // TC-T1-002
  it('should_operate_in_standalone_mode_without_location_map', () => {
    const t1 = registry.get_template('T-1')
    const result = builder.build(t1, {
      phase: 1, round: 1, runId: 'run-1', projectId: 'proj-1', scope: 'full',
    }, true)
    expect(result.prompt.length).toBeGreaterThan(0)
    expect(result.prompt).toContain('full')
    expect(result.token_estimate).toBeGreaterThan(0)
  })
})
