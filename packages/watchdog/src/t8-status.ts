export interface T8Result {
  status: 'success' | 'impl_blocked'
  impl_files?: string[]
  all_passing?: boolean
  failing_tests?: string[]
}

export function processT8Response(response: Record<string, unknown>): T8Result {
  throw new Error('processT8Response not implemented')
}

export function buildT8Prompt(params: {
  module_path: string
  test_files: string[]
  design_doc: string
  language: string
  isOmo: boolean
}): string {
  throw new Error('buildT8Prompt not implemented')
}
