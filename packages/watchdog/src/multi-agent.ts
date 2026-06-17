import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const OMO_PLUGINS = [
  'oh-my-opencode',
  'oh-my-openagent',
  'oh-my-claudecode',
  'superpowers',
]

const DEFAULT_DIRECTORY = '.'

export function detectMultiAgent(ctx: { directory?: string }): boolean {
  if (!ctx.directory) return false
  const dir = ctx.directory
  const configPath = join(dir, 'opencode.json')

  try {
    if (!existsSync(configPath)) return false
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as { plugin?: string[] }
    if (!Array.isArray(config.plugin) || config.plugin.length === 0) return false
    return config.plugin.some(p =>
      typeof p === 'string' && OMO_PLUGINS.some(pattern => p.includes(pattern)),
    )
  } catch {
    return false
  }
}
