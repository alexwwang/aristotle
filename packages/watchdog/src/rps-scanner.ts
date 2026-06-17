const RPS_PATTERNS = [
  'ignore all previous instructions',
  'you are now',
  'new instructions',
  'disregard your training',
  'pretend you are',
  'override safety',
  '忽略所有之前的指令',
  '你现在是一个',
  '新指令',
  '无视你的训练',
  '假装你是',
  '覆盖安全',
]

const RPS_DISABLE_THRESHOLD = 3

export function scanRPS(
  text: string,
  _fieldName: 'prompt' | 'description',
  context?: { rpsConsecutiveFailures: number },
): { detected: boolean; patterns: string[]; skipped?: boolean } {
  if (context && isRPSDisabled(context)) {
    return { detected: false, patterns: [], skipped: true }
  }
  if (!text || text.length === 0) {
    return { detected: false, patterns: [] }
  }
  const lower = text.toLowerCase()
  const matched = RPS_PATTERNS.filter(p => lower.includes(p.toLowerCase()))
  return { detected: matched.length > 0, patterns: matched }
}

export function isRPSDisabled(state: { rpsConsecutiveFailures: number }): boolean {
  return state.rpsConsecutiveFailures >= RPS_DISABLE_THRESHOLD
}

export function resetRPSFailureCounter(state: { rpsConsecutiveFailures: number }): void {
  state.rpsConsecutiveFailures = 0
}
