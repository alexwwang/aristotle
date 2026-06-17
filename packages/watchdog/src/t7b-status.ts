export interface T7BResult {
  status: 'success' | 'invalid_test' | 'blocked'
  test_files?: string[]
  all_failing?: boolean
  phase_results?: Record<string, unknown> | null
  message?: string
}

export function processT7BResponse(
  response: Record<string, unknown>,
  _violationType: string,
  _phase: number,
): T7BResult {
  return response as unknown as T7BResult
}
