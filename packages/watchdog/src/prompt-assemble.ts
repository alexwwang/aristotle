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
  throw new Error('promptAssemble not implemented')
}
