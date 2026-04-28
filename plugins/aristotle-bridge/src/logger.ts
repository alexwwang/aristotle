/**
 * Simple logger controlled by ARISTOTLE_LOG env var.
 * Set ARISTOTLE_LOG=debug for verbose output, otherwise only error/warn.
 * Output goes to stderr (not stdout) to avoid polluting subprocess JSON.
 */
const level = (process.env.ARISTOTLE_LOG ?? 'warn').toLowerCase();
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(l: string): boolean {
  return (LEVELS[l] ?? 99) >= (LEVELS[level] ?? 1);
}

export const logger = {
  debug: (fmt: string, ...args: unknown[]) => shouldLog('debug') && console.error(`[aristotle:debug] ${fmt}`, ...args),
  info:  (fmt: string, ...args: unknown[]) => shouldLog('info')  && console.error(`[aristotle:info] ${fmt}`, ...args),
  warn:  (fmt: string, ...args: unknown[]) => shouldLog('warn')  && console.error(`[aristotle:warn] ${fmt}`, ...args),
  error: (fmt: string, ...args: unknown[]) => shouldLog('error') && console.error(`[aristotle:error] ${fmt}`, ...args),
};
