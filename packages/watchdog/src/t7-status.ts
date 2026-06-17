export interface T7Result {
  status: 'success' | 'invalid_test'
  test_files?: string[]
  all_failing?: boolean
  test_file?: string
  message?: string
}

export function processT7Response(response: Record<string, unknown>): T7Result {
  return response as unknown as T7Result
}
