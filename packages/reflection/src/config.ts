/**
 * Centralized path configuration for Aristotle.
 *
 * Reads from `~/.config/opencode/aristotle-config.json` (written by install.sh).
 * Falls back to env vars, then to auto-detection, then to defaults.
 *
 * Uses core's `createConfigResolver` generic mechanism.
 *
 * Config schema:
 * ```json
 * {
 *   "mcp_dir": "~/.config/opencode/aristotle",
 *   "sessions_dir": "~/.config/opencode/aristotle-sessions"
 * }
 * ```
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConfigResolver } from '@opencode-ai/core';

export interface AristotleConfig {
  /** MCP server install directory (has pyproject.toml + aristotle_mcp/) */
  mcp_dir: string;
  /** Sessions working directory (bridge-workflows.json, snapshots, markers) */
  sessions_dir: string;
}

const CONFIG_FILENAME = 'aristotle-config.json';
const DEFAULT_OPENCODE_DIR = join(homedir(), '.config', 'opencode');

function findConfigFile(): string | null {
  // 1. ARISTOTLE_CONFIG env var (explicit override)
  if (process.env.ARISTOTLE_CONFIG) {
    if (!existsSync(process.env.ARISTOTLE_CONFIG)) {
      console.warn(
        `[aristotle-config] ARISTOTLE_CONFIG=${process.env.ARISTOTLE_CONFIG} does not exist, ignoring`,
      );
    }
    return process.env.ARISTOTLE_CONFIG;
  }
  // 2. Standard location
  const standard = join(DEFAULT_OPENCODE_DIR, CONFIG_FILENAME);
  if (existsSync(standard)) return standard;
  return null;
}

export function detectMcpDir(sessionsDir: string): string {
  // 1. Walk up from sessionsDir, check self and sibling "aristotle/"
  let dir = sessionsDir;
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, 'pyproject.toml')) &&
      existsSync(join(dir, 'aristotle_mcp'))
    ) {
      return dir;
    }
    const sibling = join(dir, 'aristotle');
    if (
      existsSync(join(sibling, 'pyproject.toml')) &&
      existsSync(join(sibling, 'aristotle_mcp'))
    ) {
      return sibling;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // 2. ARISTOTLE_PROJECT_DIR env var
  const envFallback = process.env.ARISTOTLE_PROJECT_DIR;
  if (envFallback && existsSync(join(envFallback, 'aristotle_mcp')))
    return envFallback;
  // 3. Default (last resort)
  return join(DEFAULT_OPENCODE_DIR, 'aristotle');
}

const resolver: import('@opencode-ai/core').ConfigResolver<AristotleConfig> = createConfigResolver<AristotleConfig>({
  configPath: findConfigFile,
  readFile: readFileSync as (path: string, encoding: string) => string,
  envMappings: {
    mcp_dir: 'ARISTOTLE_MCP_DIR',
    sessions_dir: 'ARISTOTLE_SESSIONS_DIR',
  },
  resolvers: {
    sessions_dir(fileValue, envValue) {
      return (
        fileValue || envValue || join(DEFAULT_OPENCODE_DIR, 'aristotle-sessions')
      );
    },
    mcp_dir(fileValue, envValue) {
      if (fileValue) return fileValue;
      if (envValue) return envValue;
      const sessionsDir = resolver.resolve().sessions_dir;
      return detectMcpDir(sessionsDir);
    },
  },
});

/**
 * Resolve Aristotle paths. Results are cached after first call.
 * Results are cached for the lifetime of the process. If install.sh re-runs
 * with different paths, restart the host process to pick up changes.
 *
 * Priority: config file > env vars > auto-detection > defaults
 */
export function resolveConfig(): AristotleConfig {
  return resolver.resolve();
}

/** Clear cached config (useful for testing).
 *  Wrapped in arrow function to avoid `this` binding loss. */
export const clearConfigCache = (): void => resolver.clearCache();
