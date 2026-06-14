import { describe, it, expect } from 'vitest'
import { TaskTemplateRegistry } from '../src/registry.js'
import { PromptBuilder } from '../src/prompt-builder.js'

describe('T-1 Fact Gather', () => {
  const registry = new TaskTemplateRegistry()
  const builder = new PromptBuilder()

  // TC-T1-001
  it('should_accept_empty_code_changes_as_valid', () => {
    const t1 = registry.get_template('T-1')
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
  })
})
