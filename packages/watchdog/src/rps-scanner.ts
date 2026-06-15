export function scanRPS(
  text: string,
  fieldName: 'prompt' | 'description',
  context?: { rpsConsecutiveFailures: number },
): { detected: boolean; patterns: string[]; skipped?: boolean } {
  throw new Error('Not implemented: scanRPS')
}

export function isRPSDisabled(state: { rpsConsecutiveFailures: number }): boolean {
  throw new Error('Not implemented: isRPSDisabled')
}

export function resetRPSFailureCounter(state: { rpsConsecutiveFailures: number }): void {
  throw new Error('Not implemented: resetRPSFailureCounter')
}
