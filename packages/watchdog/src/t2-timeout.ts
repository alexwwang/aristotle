export function calculateT2Timeout(params: {
  budgetSeconds: number
  elapsedSeconds: number
  marginSeconds: number
  createdAt?: string | null
  isChildPipeline?: boolean
  childCreatedAt?: string
}): { timeout: number; warning?: string } {
  throw new Error('calculateT2Timeout not implemented')
}
