/**
 * Hierarchical logger factory for the core package.
 *
 * Design notes (Phase0-Core-Extraction.md v3.6 §3.2.1, DC-03):
 * - Uses `||` (not `??`) when reading env vars so that empty strings are
 *   treated as unset and fall back to the next source.
 * - All output goes to stderr to avoid polluting subprocess JSON.
 */

export interface Logger {
  debug(fmt: string, ...args: unknown[]): void
  info(fmt: string, ...args: unknown[]): void
  warn(fmt: string, ...args: unknown[]): void
  error(fmt: string, ...args: unknown[]): void
}

const LEVELS: { [key: string]: number } = { debug: 0, info: 1, warn: 2, error: 3 }

function shouldLog(level: string, configured: string): boolean {
  return (LEVELS[level] ?? 99) >= (LEVELS[configured] ?? 1)
}

/**
 * 创建分层 logger。
 * @param prefix - 日志前缀，如 'aristotle', 'workflow', 'platform'
 * @param envVar - 该层的控制环境变量，如 'ARISTOTLE_LOG'
 *                 fallback 到 AGENT_PLATFORM_LOG，再 fallback 到 'warn'
 */
export function createLogger(prefix: string, envVar: string): Logger {
  // DC-03: 使用 || 而非 ??。?? 不跳过空字符串，空字符串 env var 会导致
  // toLowerCase() 返回 ''，最终 shouldLog 对所有级别返回 true（意外 debug-all）。
  // || 正确跳过空字符串回退到 warn。
  const configured = (process.env[envVar] || process.env.AGENT_PLATFORM_LOG || 'warn').toLowerCase()
  return {
    debug: (fmt, ...args) => shouldLog('debug', configured) && console.error(`[${prefix}:debug] ${fmt}`, ...args),
    info:  (fmt, ...args) => shouldLog('info', configured)  && console.error(`[${prefix}:info] ${fmt}`, ...args),
    warn:  (fmt, ...args) => shouldLog('warn', configured)  && console.error(`[${prefix}:warn] ${fmt}`, ...args),
    error: (fmt, ...args) => shouldLog('error', configured) && console.error(`[${prefix}:error] ${fmt}`, ...args),
  }
}

// core 自身使用的 logger
export const logger = createLogger('platform', 'AGENT_PLATFORM_LOG')
