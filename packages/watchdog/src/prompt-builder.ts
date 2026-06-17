import type { TemplateSchema } from './registry.js'

export interface PromptBuilderResult {
  prompt: string
  token_estimate: number
  is_omo: boolean
}

const PLACEHOLDER_RE = /\{(\w+)\}/g
const CHARS_PER_TOKEN = 4

const CAPABILITY_MAP: Record<string, string> = {
  reviewer: 'oracle',
  test_writer: 'build',
  impl_writer: 'build',
  fact_gatherer: 'explore',
  file_splitter: 'deep',
  briefing_writer: 'oracle',
  quarantine_handler: 'MCP-internal',
  precision_filter: 'oracle',
  eval_fix: 'build',
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN))
}

export class PromptBuilder {
  build(template: TemplateSchema, params: Record<string, unknown>, isOmo: boolean): PromptBuilderResult {
    const tpl = template.instruction_template
    const missing: string[] = []
    const prompt = tpl.replace(PLACEHOLDER_RE, (_match, name: string) => {
      if (name in params) {
        return String(params[name])
      }
      missing.push(name)
      return ''
    })
    if (missing.length > 0) {
      throw new Error(`Missing required parameter for template ${template.id}: ${missing.join(', ')}`)
    }

    const fullPrompt = isOmo ? prompt : `${template.role_definition}\n\n${prompt}`
    return {
      prompt: fullPrompt,
      token_estimate: estimateTokens(fullPrompt),
      is_omo: isOmo,
    }
  }

  get_subagent_type(template: TemplateSchema): string {
    return CAPABILITY_MAP[template.subagent_type] ?? template.subagent_type
  }

  get_timeout(template: TemplateSchema): number {
    return template.timeout
  }
}
