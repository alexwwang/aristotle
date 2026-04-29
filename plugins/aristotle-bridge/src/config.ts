/**
 * Centralized path configuration for Aristotle Bridge Plugin.
 *
 * Reads from `~/.config/opencode/aristotle-config.json` (written by install.sh).
 * Falls back to env vars, then to auto-detection, then to defaults.
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

export interface AristotleConfig {
  /** MCP server install directory (has pyproject.toml + aristotle_mcp/) */
  mcp_dir: string;
  /** Sessions working directory (bridge-workflows.json, snapshots, markers) */
  sessions_dir: string;
}

const CONFIG_FILENAME = 'aristotle-config.json';
const DEFAULT_OPencode_DIR = join(homedir(), '.config', 'opencode');

function findConfigFile(): string | null {
  // 1. ARISTOTLE_CONFIG env var (explicit override)
  if (process.env.ARISTOTLE_CONFIG) return process.env.ARISTOTLE_CONFIG;
  // 2. Standard location
  const standard = join(DEFAULT_OPencode_DIR, CONFIG_FILENAME);
  if (existsSync(standard)) return standard;
  return null;
}

function readConfigFile(path: string): Partial<AristotleConfig> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function detectMcpDir(sessionsDir: string): string {
  // 1. Walk up from sessionsDir, check self and sibling "aristotle/"
  let dir = sessionsDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pyproject.toml')) && existsSync(join(dir, 'aristotle_mcp'))) {
      return dir;
    }
    const sibling = join(dir, 'aristotle');
    if (existsSync(join(sibling, 'pyproject.toml')) && existsSync(join(sibling, 'aristotle_mcp'))) {
      return sibling;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // 2. ARISTOTLE_PROJECT_DIR env var
  const envFallback = process.env.ARISTOTLE_PROJECT_DIR;
  if (envFallback && existsSync(join(envFallback, 'aristotle_mcp'))) return envFallback;
  // 3. Default (last resort)
  return join(DEFAULT_OPencode_DIR, 'aristotle');
}

let _cachedConfig: AristotleConfig | null = null;

/**
 * Resolve Aristotle paths. Results are cached after first call.
 *
 * Priority: config file > env vars > auto-detection > defaults
 */
export function resolveConfig(): AristotleConfig {
  if (_cachedConfig) return _cachedConfig;

  const configPath = findConfigFile();
  const fileConfig = configPath ? readConfigFile(configPath) : null;

  // Sessions dir: config file > env var > default
  const sessions_dir =
    fileConfig?.sessions_dir ??
    process.env.ARISTOTLE_SESSIONS_DIR ??
    join(DEFAULT_OPencode_DIR, 'aristotle-sessions');

  // MCP dir: config file > env var > auto-detect from sessions dir > default
  const mcp_dir =
    fileConfig?.mcp_dir ??
    process.env.ARISTOTLE_MCP_DIR ??
    detectMcpDir(sessions_dir);

  _cachedConfig = { mcp_dir, sessions_dir };
  return _cachedConfig;
}

/** Clear cached config (useful for testing) */
export function clearConfigCache(): void {
  _cachedConfig = null;
}

/**
 * Convenience wrapper for resolving MCP project directory.
 * Kept for backward compatibility with tests.
 */
export function resolveMcpProjectDir(sessionsDir: string): string {
  return detectMcpDir(sessionsDir);
}
