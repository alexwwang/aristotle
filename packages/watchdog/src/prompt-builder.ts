import type { TemplateSchema, ValidationResult } from './registry.js'

export interface PromptBuilderResult {
  prompt: string
  token_estimate: number
  is_omo: boolean
}

export class PromptBuilder {
  build(template: TemplateSchema, params: Record<string, unknown>, isOmo: boolean): PromptBuilderResult {
    throw new Error('PromptBuilder.build not implemented')
  }

  get_subagent_type(template: TemplateSchema): string {
    throw new Error('PromptBuilder.get_subagent_type not implemented')
  }

  get_timeout(template: TemplateSchema): number {
    throw new Error('PromptBuilder.get_timeout not implemented')
  }
}
