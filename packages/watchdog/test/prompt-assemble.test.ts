import { describe, it, expect, vi, afterEach } from 'vitest'
import { promptAssemble } from '../src/prompt-assemble.js'
import { PromptBuilder } from '../src/prompt-builder.js'

describe('Prompt Assemble MCP Tool', () => {
  afterEach(() => { vi.restoreAllMocks() })
  // TC-MCP-001
  it('should_return_execute_internal_for_t4', () => {
    const result = promptAssemble({
      templateId: 'T-4',
      params: { files: ['src/a.ts'], run_id: 'run-1', phase: 5, violation_type: 'REGRESSION', boundary_commit: 'abc123' },
      isOmo: false,
    })
    expect(result.action).toBe('execute_internal')
  })

  // TC-MCP-002
  it('should_return_execute_internal_for_t6', () => {
    const result = promptAssemble({
      templateId: 'T-6',
      params: { phase: 5, run_id: 'run-1', events: [] },
      isOmo: false,
    })
    expect(result.action).toBe('execute_internal')
  })

  // TC-MCP-003
  it('should_return_spawn_subagent_with_omo', () => {
    const result = promptAssemble({
      templateId: 'T-5',
      params: { violationType: 'REGRESSION', occurrences: 3, patternWindow: 10, runId: 'run-1', phase: 4 },
      isOmo: true,
    })
    expect(result.action).toBe('spawn_subagent')
  })

  // TC-MCP-004
  it('should_return_spawn_subagent_without_omo', () => {
    const result = promptAssemble({
      templateId: 'T-5',
      params: { violationType: 'REGRESSION', occurrences: 3, patternWindow: 10, runId: 'run-1', phase: 4 },
      isOmo: false,
    })
    expect(result.action).toBe('spawn_subagent')
  })

  // TC-MCP-005
  it('should_validate_params_before_build', () => {
    const result = promptAssemble({
      templateId: 'T-1',
      params: {},
      isOmo: false,
    })
    expect(result.action).toBe('error')
  })

  // TC-MCP-006
  it('should_return_validation_error', () => {
    const result = promptAssemble({
      templateId: 'T-1',
      params: { phase: 'wrong-type' },
      isOmo: false,
    })
    expect(result.action).toBe('error')
    expect(result.details).toBeDefined()
  })

  // TC-MCP-007
  it('should_return_template_not_found_error', () => {
    const result = promptAssemble({
      templateId: 'T-99',
      params: {},
      isOmo: false,
    })
    expect(result.action).toBe('error')
    expect(result.error).toBeDefined()
    expect(typeof result.error).toBe('string')
  })

  // TC-MCP-008: trigger build failure via PromptBuilder.prototype.build mock
  it('should_return_template_build_failed_error', () => {
    const buildSpy = vi.spyOn(PromptBuilder.prototype, 'build').mockImplementationOnce(() => { throw new Error('build failed') })
    const result = promptAssemble({
      templateId: 'T-1',
      params: { phase: 1, round: 2, runId: 'run-1', projectId: 'proj-1', scope: 'full' },
      isOmo: false,
    })
    expect(result.action).toBe('error')
    expect(result.error).toBeDefined()
  })

  // TC-MCP-009
  it('should_strip_internal_fields_before_validation', () => {
    const result = promptAssemble({
      templateId: 'T-2',
      params: { phase: 1, round: 2, runId: 'run-1', projectId: 'proj-1', fact_context: 'internal data' },
      isOmo: false,
      internalParams: ['fact_context'],
    })
    expect(result.action).toBe('spawn_subagent')
  })
})
