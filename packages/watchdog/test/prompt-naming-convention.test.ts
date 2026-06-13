import { describe, it, expect } from 'vitest'
import { TaskTemplateRegistry } from '../src/registry.js'

describe('Parameter Naming Convention', () => {
  const registry = new TaskTemplateRegistry()

  // TC-PNC-001
  it('should_accept_camelcase_for_t1', () => {
    const result = registry.validate_params('T-1', {
      phase: 1, round: 2, runId: 'run-abc123', projectId: 'project-xyz', scope: 'full',
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-002
  it('should_accept_camelcase_for_t2', () => {
    const result = registry.validate_params('T-2', {
      phase: 1, round: 2, runId: 'run-abc123', projectId: 'project-xyz',
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-003
  it('should_accept_snakecase_for_t3', () => {
    const result = registry.validate_params('T-3', {
      file_path: 'src/large-module.ts', size: 150000, language: 'typescript',
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-004
  it('should_accept_snakecase_for_t4', () => {
    const result = registry.validate_params('T-4', {
      files: ['src/violating-file.ts'], run_id: 'run-abc123', phase: 5,
      violation_type: 'REGRESSION', boundary_commit: 'abc123def456',
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-005
  it('should_accept_camelcase_for_t5', () => {
    const result = registry.validate_params('T-5', {
      violationType: 'REGRESSION', occurrences: 3, patternWindow: 10,
      runId: 'run-abc123', phase: 4,
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-006
  it('should_accept_snakecase_for_t6', () => {
    const result = registry.validate_params('T-6', {
      phase: 5, run_id: 'run-abc123', events: [],
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-007
  it('should_accept_snakecase_for_t7', () => {
    const result = registry.validate_params('T-7', {
      module_path: 'src/business-logic.ts', requirements: 'Implement feature X',
      design_doc: 'design_plan/phase-4/impl-design.md', language: 'typescript',
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-008
  it('should_accept_snakecase_for_t7b', () => {
    const result = registry.validate_params('T-7b', {
      violation_type: 'REGRESSION', files: ['src/violating-file.ts'],
      phase: 5, run_id: 'run-abc123', design_doc_path: 'design_plan/phase-5/impl-design.md',
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-009
  it('should_accept_snakecase_for_t8', () => {
    const result = registry.validate_params('T-8', {
      module_path: 'src/business-logic.ts',
      test_files: ['tests/business-logic.test.ts'],
      design_doc: 'design_plan/phase-5/impl-design.md', language: 'typescript',
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-010
  it('should_accept_snakecase_for_t9', () => {
    const result = registry.validate_params('T-9', {
      raw_findings: [{ id: 'F-01', severity: 'H', description: 'Missing error handling', location: 'src/main.ts:42', suggestion: 'Add try/catch' }],
      location_map: { 'src/main.ts': { line_ranges: [[40, 50]], exists: true } },
      review_scope: { in_scope: ['src/main.ts'], out_of_scope: ['src/vendor/'] },
    })
    expect(result.valid).toBe(true)
  })

  // TC-PNC-011
  it('should_accept_snakecase_for_t10', () => {
    const result = registry.validate_params('T-10', {
      confirmed_findings: [{ id: 'F-01', adjusted_severity: 'H', description: 'Missing error handling', location: 'src/main.ts:42', verdict: 'CONFIRM', verdict_reason: 'Confirmed by location_map' }],
      deliverable: { target_files: ['src/main.ts'], current_content_summary: 'Module with missing error handling' },
      context: { phase: 4, ralph_round: 2, task_description: 'Add error handling', prior_phase_outputs: { phase_outputs: [] } },
    })
    expect(result.valid).toBe(true)
  })
})
