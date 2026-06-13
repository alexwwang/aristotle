export interface T7BResult {
  status: 'success' | 'invalid_test' | 'blocked'
  test_files?: string[]
  all_failing?: boolean
  phase_results?: Record<string, unknown> | null
  message?: string
}

export function processT7BResponse(
  response: Record<string, unknown>,
  violationType: string,
  phase: number,
): T7BResult {
  throw new Error('processT7BResponse not implemented')
}
