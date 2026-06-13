/**
 * TaskTemplateRegistry — stores and retrieves task template schemas.
 * Phase 3 ST stub: all methods throw Error (TDD Red phase).
 */

export interface TemplateSchema {
  id: string
  name: string
  trigger: string
  subagent_type: string
  timeout: number
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown>
  role_definition: string
  instruction_template: string
  is_mcp_internal: boolean
}

export interface ValidationResult {
  valid: boolean
  errors?: string[]
}

export class TaskTemplateRegistry {
  get_template(id: string): TemplateSchema {
    throw new Error('TaskTemplateRegistry.get_template not implemented')
  }

  list_templates(): string[] {
    throw new Error('TaskTemplateRegistry.list_templates not implemented')
  }

  validate_params(templateId: string, params: Record<string, unknown>): ValidationResult {
    throw new Error('TaskTemplateRegistry.validate_params not implemented')
  }
}
