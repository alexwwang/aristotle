/**
 * Detect multi-agent (OMO) environment by checking opencode.json.
 * §5.5a: One-time check at plugin init, result cached in PipelineStateCache.
 * Returns false conservatively if detection fails.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export function detectMultiAgent(ctx: { directory?: string }): boolean {
  if (!ctx.directory) return false
  try {
    const configPath = path.join(ctx.directory, 'opencode.json')
    if (!fs.existsSync(configPath)) return false
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const plugins: string[] = config?.plugin ?? []
    return plugins.some(p =>
      typeof p === 'string' && (
        p.includes('oh-my-opencode') || p.includes('oh-my-openagent')
      )
    )
  } catch {
    return false
  }
}
