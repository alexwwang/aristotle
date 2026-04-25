import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleEventHandler, resolveMcpProjectDir } from '../src/idle-handler.js';
import type { WorkflowState } from '../src/types.js';
import { extractLastAssistantText } from '../src/utils.js';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../src/utils.js', () => ({
  extractLastAssistantText: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: vi.fn(),
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

function getPromisifiedExecFile(): ReturnType<typeof vi.fn> {
  return (execFile as any)[Symbol.for('nodejs.util.promisify.custom')];
}

describe('IdleEventHandler', () => {
  let store: {
    findBySession: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markError: ReturnType<typeof vi.fn>;
    markChainPending: ReturnType<typeof vi.fn>;
    markChainBroken: ReturnType<typeof vi.fn>;
  };
  let client: {
    session: {
      messages: ReturnType<typeof vi.fn>;
    };
  };
  let executor: {
    launch: ReturnType<typeof vi.fn>;
  };
  const sessionsDir = '/tmp/test-sessions';

  const baseWf = (overrides: Partial<WorkflowState> = {}): WorkflowState => ({
    status: 'running',
    workflowId: 'wf-1',
    sessionId: 'session-1',
    parentSessionId: 'parent-1',
    startedAt: Date.now(),
    agent: 'O',
    ...overrides,
  });

  beforeEach(() => {
    store = {
      findBySession: vi.fn(),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn().mockResolvedValue(undefined),
      markChainPending: vi.fn().mockResolvedValue(undefined),
      markChainBroken: vi.fn().mockResolvedValue(undefined),
    };
    client = {
      session: {
        messages: vi.fn().mockResolvedValue({ data: [] }),
      },
    };
    executor = {
      launch: vi.fn().mockResolvedValue({
        workflow_id: 'wf-1',
        session_id: 'new-session-1',
        status: 'running',
        message: 'launched',
      }),
    };
    vi.mocked(extractLastAssistantText).mockReturnValue('extracted result');
    vi.mocked(existsSync).mockReturnValue(false);
    delete process.env.ARISTOTLE_MCP_DIR;
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARISTOTLE_MCP_DIR;
  });

  // ── Basic status guards ────────────────────────────────────────────────

  it('should_skip_cancelled_workflow', async () => {
    store.findBySession.mockReturnValue(baseWf({ status: 'cancelled' }));
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');
    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_skip_completed_workflow', async () => {
    store.findBySession.mockReturnValue(baseWf({ status: 'completed' }));
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');
    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_skip_undone_workflow', async () => {
    store.findBySession.mockReturnValue(baseWf({ status: 'undone' }));
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');
    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_skip_error_workflow', async () => {
    store.findBySession.mockReturnValue(baseWf({ status: 'error' }));
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');
    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_skip_unknown_session', async () => {
    store.findBySession.mockReturnValue(undefined);
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');
    expect(client.session.messages).not.toHaveBeenCalled();
  });

  // ── Non-chain agent (fallback) ─────────────────────────────────────────

  it('should_mark_completed_for_non_chain_agent', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'O', status: 'running' }));
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');
    expect(client.session.messages).toHaveBeenCalledWith({ path: { id: 'session-1' } });
    expect(extractLastAssistantText).toHaveBeenCalledWith([]);
    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(store.markChainPending).not.toHaveBeenCalled();
  });

  // ── R→C chain (driveChainTransition) ───────────────────────────────────

  it('should_drive_R_to_C_chain', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainPending).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(executor.launch).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      oPrompt: 'check this',
      agent: 'C',
      parentSessionId: 'parent-1',
    });
    expect(store.markCompleted).not.toHaveBeenCalled();
  });

  it('should_mark_chain_broken_on_subprocess_error', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    const err = Object.assign(new Error('MCP subprocess crashed'), {
      stdout: '',
      stderr: 'fatal error',
    });
    getPromisifiedExecFile().mockRejectedValue(err);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainPending).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(store.markChainBroken).toHaveBeenCalledWith('wf-1', expect.any(String));
  });

  it('should_mark_chain_broken_on_workflow_id_mismatch', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wrong-wf',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith(
      'wf-1',
      expect.stringContaining('mismatched workflow_id')
    );
    expect(executor.launch).not.toHaveBeenCalled();
  });

  it('should_mark_chain_broken_on_executor_launch_error_status', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
    });
    executor.launch.mockResolvedValue({
      workflow_id: 'wf-1',
      session_id: '',
      status: 'error',
      message: 'launch failed',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith(
      'wf-1',
      expect.stringContaining('launch failed')
    );
  });

  it('should_mark_chain_broken_on_executor_launch_throw', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
    });
    executor.launch.mockRejectedValue(new Error('network timeout'));

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith(
      'wf-1',
      expect.stringContaining('network timeout')
    );
  });

  it('should_mark_completed_on_done_action', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(executor.launch).not.toHaveBeenCalled();
  });

  it('should_mark_chain_broken_on_notify_action', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({ action: 'notify', message: 'something went wrong' }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith('wf-1', 'something went wrong');
  });

  it('should_mark_chain_broken_on_unexpected_action', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({ action: 'weird_action' }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith(
      'wf-1',
      expect.stringContaining('Unexpected MCP action')
    );
  });

  // ── C completion (driveChainCompletion) ────────────────────────────────

  it('should_complete_on_C_done', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'C', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
  });

  it('should_mark_chain_broken_on_C_notify', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'C', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({ action: 'notify', message: 'C error' }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith('wf-1', 'C error');
  });

  it('should_handle_C_fire_sub_rereflect', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'C', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 're-reflect',
        sub_role: 'R',
      }),
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(executor.launch).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      oPrompt: 're-reflect',
      agent: 'R',
      parentSessionId: 'parent-1',
    });
    expect(store.markCompleted).not.toHaveBeenCalled();
  });

  it('should_mark_chain_broken_on_C_launch_error_status', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'C', status: 'running' }));
    getPromisifiedExecFile().mockResolvedValue({
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 're-reflect',
        sub_role: 'R',
      }),
      stderr: '',
    });
    executor.launch.mockResolvedValue({
      workflow_id: 'wf-1',
      session_id: '',
      status: 'error',
      message: 're-reflect failed',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith(
      'wf-1',
      expect.stringContaining('re-reflect failed')
    );
  });

  // ── Error handling ─────────────────────────────────────────────────────

  it('should_mark_chain_broken_when_error_after_chain_pending', async () => {
    // First call returns running, second call (in catch) returns chain_pending
    store.findBySession
      .mockReturnValueOnce(baseWf({ agent: 'R', status: 'running' }))
      .mockReturnValueOnce(baseWf({ agent: 'R', status: 'chain_pending' }));
    // Make execFile succeed but return invalid JSON so JSON.parse throws
    getPromisifiedExecFile().mockResolvedValue({
      stdout: 'not-valid-json',
      stderr: '',
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainPending).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(store.markChainBroken).toHaveBeenCalledWith('wf-1', expect.any(String));
  });

  it('should_preserve_cancelled_when_abort_race', async () => {
    store.findBySession
      .mockReturnValueOnce(baseWf({ agent: 'R', status: 'running' }))
      .mockReturnValueOnce(baseWf({ agent: 'R', status: 'cancelled' }));
    store.markChainPending.mockImplementation(() => {
      throw new Error('simulated abort race');
    });

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainPending).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(store.markChainBroken).not.toHaveBeenCalled();
    expect(store.markError).not.toHaveBeenCalled();
  });

  it('should_mark_error_for_non_chain_failure', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'O', status: 'running' }));
    client.session.messages.mockRejectedValue(new Error('fetch failed'));

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markError).toHaveBeenCalledWith('wf-1', 'fetch failed');
  });

  // ── resolveMcpProjectDir ───────────────────────────────────────────────

  it('should_use_env_var_when_set', () => {
    const envDir = '/custom/mcp/dir';
    process.env.ARISTOTLE_MCP_DIR = envDir;
    vi.mocked(existsSync).mockImplementation((p: string) => {
      return p === join(envDir, 'pyproject.toml') || p === join(envDir, 'aristotle_mcp');
    });

    const result = resolveMcpProjectDir(sessionsDir);
    expect(result).toBe(envDir);
  });

  it('should_fallback_to_cwd_when_no_env', () => {
    delete process.env.ARISTOTLE_MCP_DIR;
    delete process.env.ARISTOTLE_PROJECT_DIR;
    vi.mocked(existsSync).mockReturnValue(false);

    const result = resolveMcpProjectDir(sessionsDir);
    expect(result).toBe(process.cwd());
  });

  it('should_fallback_to_aristotle_project_dir_env', () => {
    delete process.env.ARISTOTLE_MCP_DIR;
    process.env.ARISTOTLE_PROJECT_DIR = '/tmp/mock-project';
    // Make existsSync return true only for the env fallback check
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).includes('mock-project/aristotle_mcp');
    });

    const result = resolveMcpProjectDir(sessionsDir);
    expect(result).toBe('/tmp/mock-project');
    delete process.env.ARISTOTLE_PROJECT_DIR;
  });

  // ── callMCP error handling ─────────────────────────────────────────────

  it('should_parse_stdout_error_on_nonzero_exit', async () => {
    const err = Object.assign(new Error('Command failed with exit code 1'), {
      stdout: JSON.stringify({ error: 'MCP validation failed' }),
      stderr: '',
    });
    getPromisifiedExecFile().mockRejectedValue(err);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    const result = await (handler as any).callMCP('subagent_done', {
      workflow_id: 'wf-1',
      result: 'test',
      session_id: 's-1',
    });

    expect(result).toEqual({ error: 'MCP validation failed' });
  });

  it('should_return_node_error_when_no_stdout', async () => {
    const err = new Error('spawn uv ENOENT');
    getPromisifiedExecFile().mockRejectedValue(err);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    const result = await (handler as any).callMCP('subagent_done', {
      workflow_id: 'wf-1',
      result: 'test',
      session_id: 's-1',
    });

    expect(result).toEqual({ error: 'spawn uv ENOENT' });
  });
});
