export function calculateT2Timeout(params: {
  budgetSeconds: number
  elapsedSeconds: number
  marginSeconds: number
  createdAt?: string | null
  isChildPipeline?: boolean
  childCreatedAt?: string
}): { timeout: number; warning?: string } {
  let effectiveElapsed: number
  let warning: string | undefined

  if (params.isChildPipeline && params.childCreatedAt) {
    const childStart = Date.parse(params.childCreatedAt)
    effectiveElapsed = Math.max(0, (Date.now() - childStart) / 1000)
  } else if (params.createdAt) {
    effectiveElapsed = params.elapsedSeconds
  } else {
    effectiveElapsed = 0
    warning = 'Missing pipeline_state.createdAt, using current time for T-2 timeout'
  }

  const remaining = params.budgetSeconds - effectiveElapsed - params.marginSeconds
  const timeout = Math.max(30, Math.floor(remaining))

  if (remaining < 60 && !warning) {
    warning = `T-2 timeout budget tight: ${remaining}s remaining`
  }

  return { timeout, warning }
}
