/**
 * Detect multi-agent (OMO) environment by checking opencode.json.
 * §5.5a: One-time check at plugin init, result cached in PipelineStateCache.
 * Returns false conservatively if detection fails.
 */

export function detectMultiAgent(ctx: { directory?: string }): boolean {
  throw new Error('detectMultiAgent not implemented')
}
