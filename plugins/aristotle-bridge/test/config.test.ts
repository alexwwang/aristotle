import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveConfig,
  clearConfigCache,
} from '../src/config.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const DEFAULT_OPENCODE_DIR = join(homedir(), '.config', 'opencode');
const DEFAULT_CONFIG_PATH = join(DEFAULT_OPENCODE_DIR, 'aristotle-config.json');
const DEFAULT_SESSIONS_DIR = join(DEFAULT_OPENCODE_DIR, 'aristotle-sessions');
const DEFAULT_MCP_DIR = join(DEFAULT_OPENCODE_DIR, 'aristotle');

describe('config', () => {
  beforeEach(() => {
    clearConfigCache();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('File not found');
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARISTOTLE_CONFIG;
    delete process.env.ARISTOTLE_SESSIONS_DIR;
    delete process.env.ARISTOTLE_MCP_DIR;
    delete process.env.ARISTOTLE_PROJECT_DIR;
  });

  // ── resolveConfig() — config file reads correctly ──────────────────────

  it('should read config from file', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) === DEFAULT_CONFIG_PATH;
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ mcp_dir: '/custom/mcp', sessions_dir: '/custom/sessions' })
    );

    const config = resolveConfig();
    expect(config.sessions_dir).toBe('/custom/sessions');
    expect(config.mcp_dir).toBe('/custom/mcp');
  });

  // ── resolveConfig() — env var override (no config file) ────────────────

  it('should use env vars when no config file exists', () => {
    process.env.ARISTOTLE_SESSIONS_DIR = '/env/sessions';
    process.env.ARISTOTLE_MCP_DIR = '/env/mcp';

    const config = resolveConfig();
    expect(config.sessions_dir).toBe('/env/sessions');
    expect(config.mcp_dir).toBe('/env/mcp');
  });

  // ── resolveConfig() — config file takes priority over env vars ─────────

  it('should prefer config file over env vars', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) === DEFAULT_CONFIG_PATH;
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ mcp_dir: '/file/mcp', sessions_dir: '/file/sessions' })
    );
    process.env.ARISTOTLE_SESSIONS_DIR = '/env/sessions';
    process.env.ARISTOTLE_MCP_DIR = '/env/mcp';

    const config = resolveConfig();
    expect(config.sessions_dir).toBe('/file/sessions');
    expect(config.mcp_dir).toBe('/file/mcp');
  });

  // ── resolveConfig() — auto-detection fallback (no config, no env) ──────

  it('should fallback to defaults when no config and no env vars', () => {
    const config = resolveConfig();
    expect(config.sessions_dir).toBe(DEFAULT_SESSIONS_DIR);
    expect(config.mcp_dir).toBe(DEFAULT_MCP_DIR);
  });

  // ── detectMcpDir — walk up and find pyproject.toml ─────────────────────

  it('should walk up from sessions dir and find pyproject.toml + aristotle_mcp', () => {
    const sessionsDir = '/projects/myapp/aristotle-sessions';
    const parentDir = '/projects/myapp';
    process.env.ARISTOTLE_SESSIONS_DIR = sessionsDir;

    vi.mocked(existsSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.endsWith('aristotle-config.json')) return false;
      if (s === join(parentDir, 'pyproject.toml')) return true;
      if (s === join(parentDir, 'aristotle_mcp')) return true;
      return false;
    });

    const result = resolveConfig().mcp_dir;
    expect(result).toBe(parentDir);
  });

  // ── detectMcpDir — sibling check ───────────────────────────────────────

  it('should detect sibling aristotle dir', () => {
    const sessionsDir = '/projects/myapp/aristotle-sessions';
    const siblingDir = '/projects/myapp/aristotle';
    process.env.ARISTOTLE_SESSIONS_DIR = sessionsDir;

    vi.mocked(existsSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.endsWith('aristotle-config.json')) return false;
      if (s === join(siblingDir, 'pyproject.toml')) return true;
      if (s === join(siblingDir, 'aristotle_mcp')) return true;
      return false;
    });

    const result = resolveConfig().mcp_dir;
    expect(result).toBe(siblingDir);
  });

  // ── detectMcpDir — ARISTOTLE_PROJECT_DIR fallback ──────────────────────

  it('should use ARISTOTLE_PROJECT_DIR env fallback', () => {
    const sessionsDir = '/tmp/test-sessions';
    process.env.ARISTOTLE_SESSIONS_DIR = sessionsDir;
    process.env.ARISTOTLE_PROJECT_DIR = '/tmp/mock-project';

    vi.mocked(existsSync).mockImplementation((p: any) => {
      const s = String(p);
      if (s.endsWith('aristotle-config.json')) return false;
      return String(p) === join('/tmp/mock-project', 'aristotle_mcp');
    });

    const result = resolveConfig().mcp_dir;
    expect(result).toBe('/tmp/mock-project');
  });

  // ── detectMcpDir — default fallback ────────────────────────────────────

  it('should fallback to default when nothing is found', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = resolveConfig().mcp_dir;
    expect(result).toBe(DEFAULT_MCP_DIR);
  });

  // ── clearConfigCache() ─────────────────────────────────────────────────

  it('should cache config and clear cache on demand', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) === DEFAULT_CONFIG_PATH;
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ mcp_dir: '/cached/mcp', sessions_dir: '/cached/sessions' })
    );

    const config1 = resolveConfig();
    const config2 = resolveConfig();
    expect(config1).toBe(config2); // same cached object

    clearConfigCache();

    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ mcp_dir: '/new/mcp', sessions_dir: '/new/sessions' })
    );
    const config3 = resolveConfig();
    expect(config3).not.toBe(config1);
    expect(config3.mcp_dir).toBe('/new/mcp');
    expect(config3.sessions_dir).toBe('/new/sessions');
  });

  // ── resolveConfig() — corrupted config file ────────────────────────────

  it('should fallback gracefully when config file is corrupted', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) === DEFAULT_CONFIG_PATH;
    });
    vi.mocked(readFileSync).mockReturnValue('not valid json {{{');

    const config = resolveConfig();
    expect(config.sessions_dir).toBe(DEFAULT_SESSIONS_DIR);
    expect(config.mcp_dir).toBe(DEFAULT_MCP_DIR);
  });

  it('should fallback gracefully when readFileSync throws', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) === DEFAULT_CONFIG_PATH;
    });
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const config = resolveConfig();
    expect(config.sessions_dir).toBe(DEFAULT_SESSIONS_DIR);
    expect(config.mcp_dir).toBe(DEFAULT_MCP_DIR);
  });

  // ── resolveConfig() — ARISTOTLE_CONFIG env var override ────────────────

  it('should use ARISTOTLE_CONFIG env var as config file path', () => {
    process.env.ARISTOTLE_CONFIG = '/custom/path/config.json';

    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) === '/custom/path/config.json';
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ mcp_dir: '/override/mcp', sessions_dir: '/override/sessions' })
    );

    const config = resolveConfig();
    expect(config.sessions_dir).toBe('/override/sessions');
    expect(config.mcp_dir).toBe('/override/mcp');
  });

  // ── ARISTOTLE_CONFIG pointing to nonexistent file ──────────────────────

  it('should warn when ARISTOTLE_CONFIG points to nonexistent file', () => {
    process.env.ARISTOTLE_CONFIG = '/nonexistent/config.json';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) !== '/nonexistent/config.json';
    });

    resolveConfig();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ARISTOTLE_CONFIG'));
    warnSpy.mockRestore();
  });

  // ── partial config file — only mcp_dir set ─────────────────────────────

  it('should auto-detect sessions_dir when config only has mcp_dir', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p) === DEFAULT_CONFIG_PATH;
    });
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ mcp_dir: '/custom/mcp' })
    );

    const config = resolveConfig();
    expect(config.mcp_dir).toBe('/custom/mcp');
    expect(config.sessions_dir).toBe(DEFAULT_SESSIONS_DIR);
  });
});
