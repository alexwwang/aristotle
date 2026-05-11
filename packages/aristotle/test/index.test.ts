import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAristotleRole } from '../src/index.js';
import { WorkflowStore } from '@opencode-ai/core/store/workflow-store';
import { AristotleExecutor } from '../src/executor.js';
import { IdleEventHandler } from '../src/idle-handler.js';
import { resolveConfig } from '../src/config.js';

vi.mock('@opencode-ai/core/store/workflow-store', () => ({
  WorkflowStore: vi.fn(),
}));

vi.mock('../src/executor.js', () => ({
  AristotleExecutor: vi.fn(),
}));

vi.mock('../src/idle-handler.js', () => ({
  IdleEventHandler: vi.fn(),
}));

vi.mock('../src/reflection/snapshot-extractor.js', () => ({
  SnapshotExtractor: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  resolveConfig: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    join: vi.fn(),
  };
});

describe('createAristotleRole', () => {
  let ctx: any;
  let mockStore: any;
  let mockExecutor: any;
  let mockIdleHandler: any;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const actualPath = await vi.importActual<typeof import('node:path')>('node:path');
    tempDir = mkdtempSync(actualPath.join(tmpdir(), 'aristotle-test-'));

    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(writeFileSync).mockImplementation(actualFs.writeFileSync);
    vi.mocked(readFileSync).mockImplementation(actualFs.readFileSync);
    vi.mocked(existsSync).mockImplementation(actualFs.existsSync);
    vi.mocked(unlinkSync).mockImplementation(actualFs.unlinkSync);
    vi.mocked(mkdirSync).mockImplementation(actualFs.mkdirSync);
    vi.mocked(readdirSync).mockImplementation(actualFs.readdirSync);
    vi.mocked(statSync).mockImplementation(actualFs.statSync);
    vi.mocked(join).mockImplementation(actualPath.join);

    mockStore = {
      register: vi.fn().mockReturnValue(true),
      findByWorkflowId: vi.fn(),
      findBySession: vi.fn(),
      retrieve: vi.fn(),
      getActive: vi.fn().mockReturnValue({ active: [] }),
      markCompleted: vi.fn(),
      markError: vi.fn(),
      markUndone: vi.fn(),
      cancel: vi.fn(),
      reconcileOnStartup: vi.fn().mockResolvedValue(undefined),
    };

    mockExecutor = {
      launch: vi.fn().mockResolvedValue({
        workflow_id: 'w1',
        session_id: 's1',
        status: 'running',
        message: 'launched',
      }),
    };

    mockIdleHandler = {
      handle: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(WorkflowStore).mockImplementation(() => mockStore);
    vi.mocked(AristotleExecutor).mockImplementation(() => mockExecutor);
    vi.mocked(IdleEventHandler).mockImplementation(() => mockIdleHandler);
    vi.mocked(resolveConfig).mockReturnValue({
      mcp_dir: '/tmp/test-mcp',
      sessions_dir: tempDir,
    });

    ctx = {
      client: {
        session: {
          promptAsync: vi.fn().mockResolvedValue(undefined),
          create: vi.fn().mockResolvedValue({ abort: vi.fn().mockResolvedValue(undefined) }),
          abort: vi.fn().mockResolvedValue(undefined),
        },
      },
      config: { aristotleBridge: { sessionsDir: tempDir } },
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.removeAllListeners('exit');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGHUP');
  });

  it('should_return_null_when_promptAsync_unavailable', async () => {
    ctx.client.session.promptAsync = undefined;

    const result = await createAristotleRole(ctx);

    expect(result).toBeNull();
  });

  it('should_return_RoleRegistration_with_tools_and_onIdle', async () => {
    const result = await createAristotleRole(ctx);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('tools');
    expect(result).toHaveProperty('onIdle');
  });

  it('should_have_three_tools', async () => {
    const result = await createAristotleRole(ctx);

    expect(Object.keys(result!.tools!)).toHaveLength(3);
    expect(result!.tools!).toHaveProperty('aristotle_fire_o');
    expect(result!.tools!).toHaveProperty('aristotle_check');
    expect(result!.tools!).toHaveProperty('aristotle_abort');
    expect(result!.tools!.aristotle_fire_o).toHaveProperty('description');
    expect(result!.tools!.aristotle_fire_o).toHaveProperty('args');
    expect(result!.tools!.aristotle_fire_o).toHaveProperty('execute');
  });

  it('should_call_idleHandler_handle_via_onIdle', async () => {
    const result = await createAristotleRole(ctx);

    await result!.onIdle!('session-abc', ctx.client);

    expect(mockIdleHandler.handle).toHaveBeenCalledTimes(1);
    expect(mockIdleHandler.handle).toHaveBeenCalledWith('session-abc');
  });

  it('should_create_bridge_active_marker_on_startup', async () => {
    await createAristotleRole(ctx);

    const markerPath = join(tempDir, '.bridge-active');
    expect(existsSync(markerPath)).toBe(true);

    const content = readFileSync(markerPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toHaveProperty('pid');
    expect(typeof parsed.pid).toBe('number');
    expect(parsed).toHaveProperty('startedAt');
    expect(typeof parsed.startedAt).toBe('number');
  });

  it('should_overwrite_stale_marker_on_startup', async () => {
    const markerPath = join(tempDir, '.bridge-active');
    const stale = JSON.stringify({ pid: 99999, startedAt: 1 });
    writeFileSync(markerPath, stale);

    await createAristotleRole(ctx);

    const content = readFileSync(markerPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.pid).not.toBe(99999);
    expect(parsed.startedAt).not.toBe(1);
  });

  it('should_remove_marker_on_exit', async () => {
    await createAristotleRole(ctx);

    const markerPath = join(tempDir, '.bridge-active');
    expect(existsSync(markerPath)).toBe(true);

    process.emit('exit');

    expect(existsSync(markerPath)).toBe(false);
  });

  it('should_remove_marker_on_SIGTERM', async () => {
    await createAristotleRole(ctx);

    const markerPath = join(tempDir, '.bridge-active');
    expect(existsSync(markerPath)).toBe(true);

    process.emit('SIGTERM');

    expect(existsSync(markerPath)).toBe(false);
  });

  it('should_remove_marker_on_SIGINT', async () => {
    await createAristotleRole(ctx);

    const markerPath = join(tempDir, '.bridge-active');
    expect(existsSync(markerPath)).toBe(true);

    process.emit('SIGINT');

    expect(existsSync(markerPath)).toBe(false);
  });

  it('should_remove_marker_on_SIGHUP', async () => {
    await createAristotleRole(ctx);

    const markerPath = join(tempDir, '.bridge-active');
    expect(existsSync(markerPath)).toBe(true);

    process.emit('SIGHUP');

    expect(existsSync(markerPath)).toBe(false);
  });

  it('should_use_config_sessionsDir_when_provided', async () => {
    const customDir = mkdtempSync(join(tmpdir(), 'aristotle-custom-'));
    ctx.config.aristotleBridge.sessionsDir = customDir;

    await createAristotleRole(ctx);

    expect(mkdirSync).toHaveBeenCalledWith(customDir, { recursive: true });

    rmSync(customDir, { recursive: true, force: true });
  });

  it('should_call_reconcileOnStartup_on_store', async () => {
    await createAristotleRole(ctx);

    expect(mockStore.reconcileOnStartup).toHaveBeenCalledTimes(1);
    expect(mockStore.reconcileOnStartup).toHaveBeenCalledWith(ctx.client);
  });

  it('should_return_all_running_workflows_when_no_workflow_id', async () => {
    const active = { active: [{ workflow_id: 'wf-1', status: 'running', started_at: 1000 }] };
    mockStore.getActive.mockReturnValue(active);

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_check.execute({}, {});

    expect(mockStore.getActive).toHaveBeenCalledTimes(1);
    expect(JSON.parse(toolResult)).toEqual(active);
  });

  it('should_delegate_check_to_retrieve_when_workflow_id_provided', async () => {
    const retrieved = { status: 'completed', result: 'done' };
    mockStore.retrieve.mockReturnValue(retrieved);

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_check.execute({ workflow_id: 'x' }, {});

    expect(mockStore.retrieve).toHaveBeenCalledTimes(1);
    expect(mockStore.retrieve).toHaveBeenCalledWith('x');
    expect(JSON.parse(toolResult)).toEqual(retrieved);
  });

  it('should_cancel_running_workflow', async () => {
    const mockAbort = vi.fn().mockResolvedValue(undefined);
    mockStore.findByWorkflowId.mockReturnValue({ status: 'running', sessionId: 's1' });
    ctx.client.session.abort = mockAbort;

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_abort.execute({ workflow_id: 'wf-1' }, {});

    expect(mockAbort).toHaveBeenCalledWith({ path: { id: 's1' } });
    expect(mockStore.cancel).toHaveBeenCalledTimes(1);
    expect(mockStore.cancel).toHaveBeenCalledWith('wf-1');
    expect(JSON.parse(toolResult)).toEqual({ status: 'cancelled', workflow_id: 'wf-1' });
  });

  it('should_return_cancelled_for_already_cancelled_workflow', async () => {
    mockStore.findByWorkflowId.mockReturnValue({ status: 'cancelled', sessionId: 's1' });

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_abort.execute({ workflow_id: 'wf-1' }, {});

    expect(JSON.parse(toolResult)).toEqual({ status: 'cancelled', workflow_id: 'wf-1' });
    expect(mockStore.cancel).not.toHaveBeenCalled();
  });

  it('should_return_current_status_for_completed_workflow', async () => {
    mockStore.findByWorkflowId.mockReturnValue({ status: 'completed', sessionId: 's1' });

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_abort.execute({ workflow_id: 'wf-1' }, {});

    expect(JSON.parse(toolResult)).toEqual({ status: 'completed', workflow_id: 'wf-1' });
    expect(mockStore.cancel).not.toHaveBeenCalled();
  });

  it('should_return_current_status_for_error_workflow', async () => {
    mockStore.findByWorkflowId.mockReturnValue({ status: 'error', sessionId: 's1' });

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_abort.execute({ workflow_id: 'wf-1' }, {});

    expect(JSON.parse(toolResult)).toEqual({ status: 'error', workflow_id: 'wf-1' });
    expect(mockStore.cancel).not.toHaveBeenCalled();
  });

  it('should_return_current_status_for_undone_workflow', async () => {
    mockStore.findByWorkflowId.mockReturnValue({ status: 'undone', sessionId: 's1' });

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_abort.execute({ workflow_id: 'wf-1' }, {});

    expect(JSON.parse(toolResult)).toEqual({ status: 'undone', workflow_id: 'wf-1' });
    expect(mockStore.cancel).not.toHaveBeenCalled();
  });

  it('should_return_error_for_unknown_workflow_id', async () => {
    mockStore.findByWorkflowId.mockReturnValue(undefined);

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_abort.execute({ workflow_id: 'unknown' }, {});

    expect(JSON.parse(toolResult)).toEqual({ error: 'Workflow not found' });
    expect(mockStore.cancel).not.toHaveBeenCalled();
  });

  it('should_succeed_even_if_abort_api_fails', async () => {
    const mockAbort = vi.fn().mockRejectedValue(new Error('abort failed'));
    mockStore.findByWorkflowId.mockReturnValue({ status: 'running', sessionId: 's1' });
    ctx.client.session.abort = mockAbort;

    const result = await createAristotleRole(ctx);
    const toolResult = await result!.tools!.aristotle_abort.execute({ workflow_id: 'wf-1' }, {});

    expect(mockStore.cancel).toHaveBeenCalledTimes(1);
    expect(mockStore.cancel).toHaveBeenCalledWith('wf-1');
    expect(JSON.parse(toolResult)).toEqual({ status: 'cancelled', workflow_id: 'wf-1' });
  });

  it('should_default_target_session_id_to_tool_context_sessionID_when_empty', async () => {
    const toolContext = { sessionID: 'tool-ctx-session-1', messageID: 'm1', agent: 'primary' };

    const result = await createAristotleRole(ctx);
    await result!.tools!.aristotle_fire_o.execute({
      workflow_id: 'w1',
      o_prompt: 'p',
    }, toolContext);

    expect(mockExecutor.launch).toHaveBeenCalledWith({
      workflowId: 'w1',
      oPrompt: 'p',
      agent: 'R',
      parentSessionId: 'tool-ctx-session-1',
      targetSessionId: 'tool-ctx-session-1',
    });
  });

  it('should_use_explicit_target_session_id_when_provided', async () => {
    const toolContext = { sessionID: 'tool-ctx-session-1', messageID: 'm1', agent: 'primary' };

    const result = await createAristotleRole(ctx);
    await result!.tools!.aristotle_fire_o.execute({
      workflow_id: 'w1',
      o_prompt: 'p',
      target_session_id: 'target-ses-123',
    }, toolContext);

    expect(mockExecutor.launch).toHaveBeenCalledWith({
      workflowId: 'w1',
      oPrompt: 'p',
      agent: 'R',
      parentSessionId: 'tool-ctx-session-1',
      targetSessionId: 'target-ses-123',
    });
  });
});
