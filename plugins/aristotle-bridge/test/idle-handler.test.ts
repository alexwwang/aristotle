import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleEventHandler, resolveMcpProjectDir } from '../src/idle-handler.js';
import type { WorkflowState } from '../src/types.js';
import { extractLastAssistantText } from '../src/utils.js';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../src/utils.js', () => ({
  extractLastAssistantText: vi.fn(),
}));

// Mock spawn: returns a child-like EventEmitter with stdout/stderr/stdin
let mockSpawnResult: { stdout: string; stderr: string; exitCode: number | null; signal: string | null; error: Error | null };

function createMockChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };

  // Simulate async close event on next tick
  process.nextTick(() => {
    if (mockSpawnResult.error) {
      child.emit('error', mockSpawnResult.error);
    } else {
      // Emit stdout/stderr data first
      if (mockSpawnResult.stdout) child.stdout.emit('data', Buffer.from(mockSpawnResult.stdout));
      if (mockSpawnResult.stderr) child.stderr.emit('data', Buffer.from(mockSpawnResult.stderr));
      child.emit('close', mockSpawnResult.exitCode, mockSpawnResult.signal);
    }
  });

  return child;
}

const mockSpawn = vi.fn(createMockChild);

vi.mock('node:child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe('IdleEventHandler', () => {
  let store: {
    findBySession: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markError: ReturnType<typeof vi.fn>;
    markChainPending: ReturnType<typeof vi.fn>;
    markChainBroken: ReturnType<typeof vi.fn>;
    getActive: ReturnType<typeof vi.fn>;
    findByWorkflowId: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let client: {
    session: {
      messages: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
      prompt: ReturnType<typeof vi.fn>;
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
      getActive: vi.fn().mockReturnValue({ active: [] }),
      findByWorkflowId: vi.fn(),
      cancel: vi.fn(),
    };
    client = {
      session: {
        messages: vi.fn().mockResolvedValue({ data: [] }),
        abort: vi.fn().mockResolvedValue(undefined),
        prompt: vi.fn().mockResolvedValue(undefined),
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
    // Default: subprocess returns { action: 'done' }
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };
    mockSpawn.mockImplementation(createMockChild);
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
    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

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
    mockSpawnResult = {
      stdout: '',
      stderr: 'fatal error',
      exitCode: 1,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainPending).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(store.markChainBroken).toHaveBeenCalledWith('wf-1', expect.any(String));
  });

  it('should_mark_chain_broken_on_workflow_id_mismatch', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wrong-wf',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

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
    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };
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
    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 'check this',
        sub_role: 'C',
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };
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
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(executor.launch).not.toHaveBeenCalled();
  });

  it('should_mark_chain_broken_on_notify_action', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'notify', message: 'something went wrong' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith('wf-1', 'something went wrong');
  });

  it('should_mark_chain_broken_on_unexpected_action', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'weird_action' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

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
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
  });

  it('should_mark_chain_broken_on_C_notify', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'C', status: 'running' }));
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'notify', message: 'C error' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markChainBroken).toHaveBeenCalledWith('wf-1', 'C error');
  });

  it('should_handle_C_fire_sub_rereflect', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'C', status: 'running' }));
    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 're-reflect',
        sub_role: 'R',
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

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
    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf-1',
        sub_prompt: 're-reflect',
        sub_role: 'R',
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };
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
    mockSpawnResult = {
      stdout: 'not-valid-json',
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

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
    mockSpawnResult = {
      stdout: JSON.stringify({ error: 'MCP validation failed' }),
      stderr: '',
      exitCode: 1,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    const result = await (handler as any).callMCP('subagent_done', {
      workflow_id: 'wf-1',
      result: 'test',
      session_id: 's-1',
    });

    expect(result).toEqual({ error: 'MCP validation failed' });
  });

  it('should_return_node_error_when_no_stdout', async () => {
    mockSpawnResult = {
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      error: new Error('spawn uv ENOENT'),
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    const result = await (handler as any).callMCP('subagent_done', {
      workflow_id: 'wf-1',
      result: 'test',
      session_id: 's-1',
    });

    expect(result).toEqual({ error: 'spawn uv ENOENT' });
  });

  // ── Trigger file tests ────────────────────────────────────────────────

  it('should_ignore_when_no_trigger_file', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    store.findBySession.mockReturnValue(undefined);
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');
    // readFileSync should not be called since trigger file doesn't exist
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('should_process_trigger_and_launch_R', async () => {
    const triggerData = {
      session_id: 'ses_target123',
      project_directory: '/tmp/test-project',
    };
    const triggerPath = join(sessionsDir, '.trigger-reflect.json');

    // existsSync: true for trigger file, false for mcpProjectDir walk
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('.trigger-reflect.json')) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(triggerData));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    // orchestrate_start subprocess returns fire_sub
    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf_trigger_001',
        sub_prompt: 'Reflect on session...',
        sub_role: 'R',
        use_bridge: true,
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    executor.launch.mockResolvedValue({
      workflow_id: 'wf_trigger_001',
      session_id: 'new-r-session',
      status: 'running',
      message: 'launched',
    });

    store.findBySession.mockReturnValue(undefined);
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    // Should have called orchestrate_start subprocess
    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall[1]).toContain('orchestrate_start');
    expect(spawnCall[1]).toContain('reflect');

    // Should have launched R
    expect(executor.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf_trigger_001',
        agent: 'R',
        parentSessionId: 'ses_target123',
        targetSessionId: 'ses_target123',
      }),
    );

    // Should have deleted trigger file
    expect(unlinkSync).toHaveBeenCalledWith(triggerPath);
  });

  it('should_delete_trigger_on_parse_error', async () => {
    const triggerPath = join(sessionsDir, '.trigger-reflect.json');

    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-reflect.json');
    });
    vi.mocked(readFileSync).mockReturnValue('not valid json {{{');
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.findBySession.mockReturnValue(undefined);
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(unlinkSync).toHaveBeenCalledWith(triggerPath);
    expect(executor.launch).not.toHaveBeenCalled();
  });

  it('should_delete_trigger_on_subprocess_error', async () => {
    const triggerPath = join(sessionsDir, '.trigger-reflect.json');

    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-reflect.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ session_id: 'ses_1' }));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    mockSpawnResult = {
      stdout: JSON.stringify({ error: 'MCP init failed' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    store.findBySession.mockReturnValue(undefined);
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(unlinkSync).toHaveBeenCalledWith(triggerPath);
    expect(executor.launch).not.toHaveBeenCalled();
  });

  it('should_delete_trigger_on_R_launch_failure', async () => {
    const triggerPath = join(sessionsDir, '.trigger-reflect.json');

    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-reflect.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ session_id: 'ses_1' }));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    mockSpawnResult = {
      stdout: JSON.stringify({
        action: 'fire_sub',
        workflow_id: 'wf_t1',
        sub_prompt: 'prompt',
        sub_role: 'R',
      }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    executor.launch.mockResolvedValue({
      status: 'error',
      message: 'promptAsync unavailable',
    });

    store.findBySession.mockReturnValue(undefined);
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(unlinkSync).toHaveBeenCalledWith(triggerPath);
  });

  // ── Abort trigger tests ────────────────────────────────────────────────

  it('should_abort_all_active_workflows', async () => {
    const abortPath = join(sessionsDir, '.trigger-abort.json');
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({
      active: [
        { workflow_id: 'wf-1', status: 'running' },
        { workflow_id: 'wf-2', status: 'chain_pending' },
      ],
    });
    store.findByWorkflowId
      .mockReturnValueOnce({ sessionId: 'ses-1' })
      .mockReturnValueOnce({ sessionId: 'ses-2' });
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(unlinkSync).toHaveBeenCalledWith(abortPath);
    expect(store.cancel).toHaveBeenCalledWith('wf-1');
    expect(store.cancel).toHaveBeenCalledWith('wf-2');
    expect(client.session.abort).toHaveBeenCalledTimes(2);
  });

  it('should_abort_specific_workflow_ids_only', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ workflow_ids: ['wf-1'] }));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({
      active: [
        { workflow_id: 'wf-1', status: 'running' },
        { workflow_id: 'wf-2', status: 'running' },
      ],
    });
    store.findByWorkflowId.mockReturnValue({ sessionId: 'ses-1' });
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(store.cancel).toHaveBeenCalledWith('wf-1');
    expect(store.cancel).not.toHaveBeenCalledWith('wf-2');
  });

  it('should_skip_non_running_workflows', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({
      active: [
        { workflow_id: 'wf-1', status: 'completed' },
        { workflow_id: 'wf-2', status: 'error' },
        { workflow_id: 'wf-3', status: 'running' },
      ],
    });
    store.findByWorkflowId.mockReturnValue({ sessionId: 'ses-3' });
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(store.cancel).toHaveBeenCalledTimes(1);
    expect(store.cancel).toHaveBeenCalledWith('wf-3');
  });

  it('should_delete_trigger_file_after_processing', async () => {
    const abortPath = join(sessionsDir, '.trigger-abort.json');
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({ active: [] });
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(unlinkSync).toHaveBeenCalledWith(abortPath);
  });

  it('should_delete_trigger_file_on_parse_error', async () => {
    const abortPath = join(sessionsDir, '.trigger-abort.json');
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue('not valid json {{{');
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.findBySession.mockReturnValue(undefined);
    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(unlinkSync).toHaveBeenCalledWith(abortPath);
    expect(store.cancel).not.toHaveBeenCalled();
  });

  it('should_call_session_abort_for_each_workflow', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({
      active: [
        { workflow_id: 'wf-1', status: 'running' },
        { workflow_id: 'wf-2', status: 'running' },
      ],
    });
    store.findByWorkflowId
      .mockReturnValueOnce({ sessionId: 'ses-1' })
      .mockReturnValueOnce({ sessionId: 'ses-2' });
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(client.session.abort).toHaveBeenCalledWith({ path: { id: 'ses-1' } });
    expect(client.session.abort).toHaveBeenCalledWith({ path: { id: 'ses-2' } });
  });

  it('should_cancel_without_abort_when_sessionId_missing', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({
      active: [
        { workflow_id: 'wf-1', status: 'running' },
      ],
    });
    // findByWorkflowId returns undefined — no session to abort
    store.findByWorkflowId.mockReturnValue(undefined);
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    // cancel still called, but session.abort skipped
    expect(store.cancel).toHaveBeenCalledWith('wf-1');
    expect(client.session.abort).not.toHaveBeenCalled();
  });

  it('should_not_cancel_when_no_active_workflows', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({ active: [] });
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    expect(store.cancel).not.toHaveBeenCalled();
    expect(client.session.abort).not.toHaveBeenCalled();
  });

  it('should_continue_cancelling_when_one_fails', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('.trigger-abort.json');
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));
    vi.mocked(unlinkSync).mockReturnValue(undefined);

    store.getActive.mockReturnValue({
      active: [
        { workflow_id: 'wf-1', status: 'running' },
        { workflow_id: 'wf-2', status: 'running' },
      ],
    });
    store.findByWorkflowId
      .mockReturnValueOnce({ sessionId: 'ses-1' })
      .mockReturnValueOnce({ sessionId: 'ses-2' });
    // First cancel throws, second succeeds
    store.cancel
      .mockImplementationOnce(() => { throw new Error('cancel failed'); })
      .mockImplementationOnce(() => {});
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-parent');

    // Both should have been attempted
    expect(store.cancel).toHaveBeenCalledWith('wf-1');
    expect(store.cancel).toHaveBeenCalledWith('wf-2');
  });

  // ── notifyParent tests ────────────────────────────────────────────────

  it('should_notify_parent_on_R_done', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'parent-1' },
      body: {
        noReply: true,
        parts: [{ type: 'text', text: expect.stringContaining('no issues found') }],
      },
    });
  });

  it('should_notify_parent_on_C_done', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'C', status: 'running' }));
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: 'parent-1' },
      body: {
        noReply: true,
        parts: [{ type: 'text', text: expect.stringContaining('review') }],
      },
    });
  });

  it('should_not_notify_when_parentSessionId_empty', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running', parentSessionId: '' }));
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  it('should_not_throw_when_notify_fails', async () => {
    store.findBySession.mockReturnValue(baseWf({ agent: 'R', status: 'running' }));
    client.session.prompt.mockRejectedValue(new Error('network error'));
    mockSpawnResult = {
      stdout: JSON.stringify({ action: 'done' }),
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
    };

    const handler = new IdleEventHandler(client, store, executor, sessionsDir);
    // Should NOT throw — notification is best-effort
    await handler.handle('session-1');

    expect(store.markCompleted).toHaveBeenCalledWith('wf-1', 'extracted result');
    expect(client.session.prompt).toHaveBeenCalled();
  });
});
