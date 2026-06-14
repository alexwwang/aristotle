import { describe, it, expect, beforeEach } from 'vitest'
import { PromptBuilder } from '../src/prompt-builder.js'
import { TaskTemplateRegistry } from '../src/registry.js'

describe('Template Independence', () => {
  let registry: TaskTemplateRegistry
  let builder: PromptBuilder
  beforeEach(() => {
    registry = new TaskTemplateRegistry()
    builder = new PromptBuilder()
  })

  // TC-IND-001
  // Template-level independence: T-9 and T-2 have distinct id/name/timeout/
  // subagent_type/instruction_template. Session-level independence (different
  // session IDs at spawn time) is an integration concern tested elsewhere.
  // Session-level independence (different session IDs at spawn time) is an
  //  integration concern — this test verifies template-level isolation only.
  it('should_have_distinct_template_properties_for_t9_vs_t2', () => {
    const t2Template = registry.get_template('T-2')
    const t9Template = registry.get_template('T-9')
    expect(t2Template.id).not.toBe(t9Template.id)
    expect(t2Template.name).toBe('reviewer')
    expect(t9Template.name).toBe('precision_filter')
    expect(t2Template.timeout).not.toBe(t9Template.timeout)
    expect(t2Template.subagent_type).not.toBe(t9Template.subagent_type)
    expect(t2Template.instruction_template).not.toBe(t9Template.instruction_template)
  })

  // TC-IND-002
  it('should_not_contain_t2_context_in_t9_prompt', () => {
    const t9Template = registry.get_template('T-9')
    const result = builder.build(t9Template, {
      raw_findings: [],
      location_map: {},
      review_scope: { in_scope: [], out_of_scope: [] },
    }, true)
    expect(result.prompt).not.toContain('fact_context')
  })
})
