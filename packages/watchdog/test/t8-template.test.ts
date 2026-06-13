import { describe, it, expect } from 'vitest'
import { processT8Response, buildT8Prompt } from '../src/t8-status.js'

describe('T-8 Implementation Test Writing', () => {
  // TC-T8-001
  it('should_construct_prompt_with_module_and_test_files', () => {
    const prompt = buildT8Prompt({
      module_path: 'src/business-logic.ts',
      test_files: ['tests/business-logic.test.ts'],
      design_doc: 'design_plan/phase-5/impl-design.md',
      language: 'typescript',
      isOmo: false,
    })
    expect(prompt).toContain('src/business-logic.ts')
    expect(prompt).toContain('tests/business-logic.test.ts')
  })

  // TC-T8-002
  it('should_include_design_doc_in_context', () => {
    const prompt = buildT8Prompt({
      module_path: 'src/module.ts',
      test_files: ['tests/module.test.ts'],
      design_doc: 'design_plan/phase-5/impl-design.md',
      language: 'typescript',
      isOmo: false,
    })
    expect(prompt).toContain('design_plan/phase-5/impl-design.md')
  })

  // TC-T8-003
  it('should_validate_t8_parameters', () => {
    const result = processT8Response({
      status: 'success', impl_files: ['src/module.ts'], all_passing: true,
    })
    expect(result.status).toBe('success')
    expect(result.impl_files).toContain('src/module.ts')
  })

  // TC-T8-004
  it('should_handle_t8_with_omo_detection', () => {
    const prompt = buildT8Prompt({
      module_path: 'src/module.ts',
      test_files: ['tests/module.test.ts'],
      design_doc: 'design_plan/phase-5/impl-design.md',
      language: 'typescript',
      isOmo: true,
    })
    expect(prompt.length).toBeGreaterThan(0)
  })

  // TC-T8-005
  it('should_return_impl_blocked_when_tests_cannot_pass', () => {
    const result = processT8Response({
      status: 'impl_blocked',
      failing_tests: ['tests/module.test.ts::test_case_1', 'tests/module.test.ts::test_case_3'],
    })
    expect(result.status).toBe('impl_blocked')
    expect(result.failing_tests).toHaveLength(2)
  })
})
