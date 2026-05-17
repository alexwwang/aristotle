import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/**
 * Compute a deterministic project identifier from git worktree root.
 * SHA256 of the absolute path, first 8 hex chars.
 *
 * This is watchdog POLICY — it's how watchdog identifies "a project".
 * Core doesn't know what a "project" is.
 */
export function computeProjectId(worktree: string): string {
  // TechSpec §3.1.1: normalize to lowercase for case-insensitive FS (macOS)
  const absolute = resolve(worktree).toLowerCase()
  return createHash('sha256').update(absolute).digest('hex').slice(0, 8)
}
