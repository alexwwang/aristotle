export type T3Status = 'success' | 'unsplittable' | 'tests_failed' | 'rollback_failed'

export interface T3Result {
  status: T3Status
  split_plan?: Record<string, unknown>
  new_files?: string[]
  tests_pass?: boolean | 'timeout' | 'skipped'
  warnings?: string[]
  reason?: string
  rolled_back?: boolean
  error?: string
}

export function processT3Response(response: Record<string, unknown>): T3Result {
  return response as unknown as T3Result
}
