import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AristotleBridgePlugin from '../src/index.js';
import { detectApiMode } from '../src/api-probe.js';
import { WorkflowStore } from '../src/workflow-store.js';
import { AsyncTaskExecutor } from '../src/executor.js';
import { IdleEventHandler } from '../src/idle-handler.js';

vi.mock('../src/api-probe.js', () => ({
  detectApiMode: vi.fn(),
}));

vi.mock('../src/workflow-store.js', () => ({
  WorkflowStore: vi.fn(),
}));

vi.mock('../src/executor.js', () => ({
  AsyncTaskExecutor: vi.fn(),
}));

vi.mock('../src/idle-handler.js', () => ({
  IdleEventHandler: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    join: vi.fn(),
  };
});

describe('AristotleBridgePlugin', () => {
  let ctx: any;
  let mockStore: any;
  let mockExecutor: any;
  let mockIdleHandler: any;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const actualPath = await vi.importActual<typeof import('node:path')>('node:path');
    tempDir = mkdtempSync(actualPath.join(tmpdir(), 'bridge-test-'));

    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(writeFileSync).mockImplementation(actualFs.writeFileSync);
    vi.mocked(readFileSync).mockImplementation(actualFs.readFileSync);
    vi.mocked(existsSync).mockImplementation(actualFs.existsSync);
    vi.mocked(unlinkSync).mockImplementation(actualFs.unlinkSync);
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
    vi.mocked(AsyncTaskExecutor).mockImplementation(() => mockExecutor);
    vi.mocked(IdleEventHandler).mockImplementation(() => mockIdleHandler);

    ctx = {
      client: {
        session: {
          create: vi.fn().mockResolvedValue({ abort: vi.fn().mockResolvedValue(undefined) }),
        },
      },
      session: { id: 'parent-session-1' },
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

  /* ── Group 1: Tool registration ── */
  describe('tool registration', () => {
    it('should_register_fire_o_check_abort_tools', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const plugin = await AristotleBridgePlugin(ctx);

      expect(plugin).toHaveProperty('tool');
      expect(plugin).toHaveProperty('event');

      const tools = plugin.tool;
      expect(tools).toHaveProperty('aristotle_fire_o');
      expect(tools).toHaveProperty('aristotle_check');
      expect(tools).toHaveProperty('aristotle_abort');
      expect(tools.aristotle_fire_o).toHaveProperty('description');
      expect(tools.aristotle_fire_o).toHaveProperty('args');
      expect(tools.aristotle_fire_o).toHaveProperty('execute');
    });

    it('should_return_empty_tools_when_promptAsync_unavailable', async () => {
      vi.mocked(detectApiMode).mockResolvedValue(null);

      const plugin = await AristotleBridgePlugin(ctx);

      expect(plugin).toEqual({});
      expect(plugin.tool).toBeUndefined();
      expect(plugin.event).toBeUndefined();
    });
  });

  /* ── Group 2: Event dispatch ── */
  describe('event dispatch', () => {
    it('should_dispatch_session_idle_to_idle_handler', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const plugin = await AristotleBridgePlugin(ctx);
      const event = { type: 'session.idle', properties: { sessionID: 'abc' } };

      await plugin.event(event);

      expect(mockIdleHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockIdleHandler.handle).toHaveBeenCalledWith('abc');
    });

    it('should_ignore_non_idle_events', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const plugin = await AristotleBridgePlugin(ctx);
      const event = { type: 'session.created' };

      await plugin.event(event);

      expect(mockIdleHandler.handle).not.toHaveBeenCalled();
    });

    it('should_ignore_idle_event_without_string_sessionID', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const plugin = await AristotleBridgePlugin(ctx);
      const event = { type: 'session.idle', properties: { sessionID: 123 } };

      await plugin.event(event);

      expect(mockIdleHandler.handle).not.toHaveBeenCalled();
    });

    it('should_ignore_idle_event_when_sessionID_is_undefined', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const plugin = await AristotleBridgePlugin(ctx);
      const event = { type: 'session.idle', properties: {} };

      await plugin.event(event);

      expect(mockIdleHandler.handle).not.toHaveBeenCalled();
    });
  });

  /* ── Group 3: Marker lifecycle ── */
  describe('marker lifecycle', () => {
    it('should_create_bridge_active_marker_on_startup', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      await AristotleBridgePlugin(ctx);

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
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const markerPath = join(tempDir, '.bridge-active');
      const stale = JSON.stringify({ pid: 99999, startedAt: 1 });
      writeFileSync(markerPath, stale);

      await AristotleBridgePlugin(ctx);

      const content = readFileSync(markerPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.pid).not.toBe(99999);
      expect(parsed.startedAt).not.toBe(1);
    });

    it('should_remove_marker_on_exit', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      await AristotleBridgePlugin(ctx);

      const markerPath = join(tempDir, '.bridge-active');
      expect(existsSync(markerPath)).toBe(true);

      process.emit('exit');

      expect(existsSync(markerPath)).toBe(false);
    });

    it('should_remove_marker_on_SIGTERM', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      await AristotleBridgePlugin(ctx);

      const markerPath = join(tempDir, '.bridge-active');
      expect(existsSync(markerPath)).toBe(true);

      process.emit('SIGTERM');

      expect(existsSync(markerPath)).toBe(false);
    });

    it('should_remove_marker_on_SIGINT', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      await AristotleBridgePlugin(ctx);

      const markerPath = join(tempDir, '.bridge-active');
      expect(existsSync(markerPath)).toBe(true);

      process.emit('SIGINT');

      expect(existsSync(markerPath)).toBe(false);
    });

    it('should_remove_marker_on_SIGHUP', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      await AristotleBridgePlugin(ctx);

      const markerPath = join(tempDir, '.bridge-active');
      expect(existsSync(markerPath)).toBe(true);

      process.emit('SIGHUP');

      expect(existsSync(markerPath)).toBe(false);
    });
  });

  /* ── Group 4: aristotle_check ── */
  describe('aristotle_check', () => {
    it('should_return_all_running_workflows_when_no_workflow_id', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      const active = { active: [{ workflow_id: 'wf-1', status: 'running', started_at: 1000 }] };
      mockStore.getActive.mockReturnValue(active);

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_check.execute({});

      expect(mockStore.getActive).toHaveBeenCalledTimes(1);
      expect(JSON.parse(result)).toEqual(active);
      expect(mockStore.getActive).toHaveBeenCalledTimes(1);
    });

    it('should_delegate_to_retrieve_when_workflow_id_provided', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      const retrieved = { status: 'completed', result: 'done' };
      mockStore.retrieve.mockReturnValue(retrieved);

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_check.execute({ workflow_id: 'x' });

      expect(mockStore.retrieve).toHaveBeenCalledTimes(1);
      expect(mockStore.retrieve).toHaveBeenCalledWith('x');
      expect(JSON.parse(result)).toEqual(retrieved);
    });
  });

  /* ── Group 5: aristotle_abort ── */
  describe('aristotle_abort', () => {
    it('should_cancel_running_workflow', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      const mockAbort = vi.fn().mockResolvedValue(undefined);
      mockStore.findByWorkflowId.mockReturnValue({ status: 'running', sessionId: 's1' });
      ctx.client.session.abort = mockAbort;

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_abort.execute({ workflow_id: 'wf-1' });

      expect(mockAbort).toHaveBeenCalledWith({ path: { id: 's1' } });
      expect(mockStore.cancel).toHaveBeenCalledTimes(1);
      expect(mockStore.cancel).toHaveBeenCalledWith('wf-1');
      expect(JSON.parse(result)).toEqual({ status: 'cancelled', workflow_id: 'wf-1' });
    });

    it('should_return_cancelled_for_already_cancelled_workflow', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      mockStore.findByWorkflowId.mockReturnValue({ status: 'cancelled', sessionId: 's1' });

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_abort.execute({ workflow_id: 'wf-1' });

      expect(JSON.parse(result)).toEqual({ status: 'cancelled', workflow_id: 'wf-1' });
      expect(mockStore.cancel).not.toHaveBeenCalled();
    });

    it('should_return_current_status_for_completed_workflow', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      mockStore.findByWorkflowId.mockReturnValue({ status: 'completed', sessionId: 's1' });

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_abort.execute({ workflow_id: 'wf-1' });

      expect(JSON.parse(result)).toEqual({ status: 'completed', workflow_id: 'wf-1' });
      expect(mockStore.cancel).not.toHaveBeenCalled();
    });

    it('should_return_current_status_for_error_workflow', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      mockStore.findByWorkflowId.mockReturnValue({ status: 'error', sessionId: 's1' });

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_abort.execute({ workflow_id: 'wf-1' });

      expect(JSON.parse(result)).toEqual({ status: 'error', workflow_id: 'wf-1' });
      expect(mockStore.cancel).not.toHaveBeenCalled();
    });

    it('should_return_current_status_for_undone_workflow', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      mockStore.findByWorkflowId.mockReturnValue({ status: 'undone', sessionId: 's1' });

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_abort.execute({ workflow_id: 'wf-1' });

      expect(JSON.parse(result)).toEqual({ status: 'undone', workflow_id: 'wf-1' });
      expect(mockStore.cancel).not.toHaveBeenCalled();
    });

    it('should_return_error_for_unknown_workflow_id', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      mockStore.findByWorkflowId.mockReturnValue(undefined);

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_abort.execute({ workflow_id: 'unknown' });

      expect(JSON.parse(result)).toEqual({ error: 'Workflow not found' });
      expect(mockStore.cancel).not.toHaveBeenCalled();
    });

    it('should_succeed_even_if_abort_api_fails', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');
      const mockAbort = vi.fn().mockRejectedValue(new Error('abort failed'));
      mockStore.findByWorkflowId.mockReturnValue({ status: 'running', sessionId: 's1' });
      ctx.client.session.abort = mockAbort;

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      const result = await tools.aristotle_abort.execute({ workflow_id: 'wf-1' });

      expect(mockStore.cancel).toHaveBeenCalledTimes(1);
      expect(mockStore.cancel).toHaveBeenCalledWith('wf-1');
      expect(JSON.parse(result)).toEqual({ status: 'cancelled', workflow_id: 'wf-1' });
    });
  });

  /* ── Group 6: fire_o handler ── */
  describe('aristotle_fire_o', () => {
    const toolContext = { sessionID: 'tool-ctx-session-1', messageID: 'm1', agent: 'primary' };

    it('should_default_target_session_id_to_tool_context_sessionID_when_empty', async () => {
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      await tools.aristotle_fire_o.execute({
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
      vi.mocked(detectApiMode).mockResolvedValue('promptAsync');

      const plugin = await AristotleBridgePlugin(ctx);
      const tools = plugin.tool;
      await tools.aristotle_fire_o.execute({
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
});
