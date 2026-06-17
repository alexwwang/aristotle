import { TaskTemplateRegistry } from './registry.js'
import { PromptBuilder } from './prompt-builder.js'
import type { TemplateSchema, ValidationResult } from './registry.js'
import type { PromptBuilderResult } from './prompt-builder.js'

export interface PromptAssembleResult {
  action: 'execute_internal' | 'spawn_subagent' | 'error'
  prompt?: string
  template?: TemplateSchema
  error?: string
  details?: string
}

export function promptAssemble(params: {
  templateId: string
  params: Record<string, unknown>
  isOmo: boolean
  internalParams?: string[]
}): PromptAssembleResult {
  const registry = new TaskTemplateRegistry()
  const builder = new PromptBuilder()

  let schema: TemplateSchema
  try {
    schema = registry.get_template(params.templateId)
  } catch {
    return { action: 'error', error: `template_not_found: ${params.templateId}` }
  }

  const validationParams = stripInternalParams(params.params, params.internalParams)
  const validation = registry.validate_params(params.templateId, validationParams)
  if (!validation.valid) {
    return { action: 'error', details: (validation.errors ?? []).join('; ') }
  }

  if (schema.is_mcp_internal) {
    return { action: 'execute_internal', template: schema }
  }

  let built: PromptBuilderResult
  try {
    built = builder.build(schema, params.params, params.isOmo)
  } catch (e) {
    return { action: 'error', error: `template_build_failed: ${String((e as Error).message ?? e)}` }
  }

  return { action: 'spawn_subagent', prompt: built.prompt, template: schema }
}

function stripInternalParams(
  params: Record<string, unknown>,
  internalParams?: string[],
): Record<string, unknown> {
  if (!internalParams || internalParams.length === 0) return params
  const stripped: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (!internalParams.includes(k)) {
      stripped[k] = v
    }
  }
  return stripped
}
