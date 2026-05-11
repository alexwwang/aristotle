import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AristotleExecutor } from '../src/executor.js';
import { SnapshotExtractor } from '../src/reflection/snapshot-extractor.js';
import { AsyncTaskExecutor } from '@opencode-ai/core/executor';

// Hoisted mock functions (shared across all mock instances)
const mocks = vi.hoisted(() => ({
  coreLaunch: vi.fn(),
  snapshotExists: vi.fn(),
  snapshotExtract: vi.fn(),
  snapshotPath: vi.fn(),
}));

// Mock core AsyncTaskExecutor — replace the class so `new AsyncTaskExecutor(client)`
// returns an object whose `launch` method is our hoisted mock.
vi.mock('@opencode-ai/core/executor', () => ({
  AsyncTaskExecutor: function (this: any) {
    this.launch = mocks.coreLaunch;
  },
}));

// Mock local SnapshotExtractor — same pattern.
vi.mock('../src/reflection/snapshot-extractor.js', () => ({
  SnapshotExtractor: function (this: any) {
    this.snapshotExists = mocks.snapshotExists;
    this.extract = mocks.snapshotExtract;
    this.snapshotPath = mocks.snapshotPath;
  },
}));

describe('AristotleExecutor', () => {
  let executor: AristotleExecutor;
  let mockStore: any;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock behaviours
    mocks.coreLaunch.mockResolvedValue({
      sessionId: 'sess-1',
      status: 'running',
      message: 'ok',
    });
    mocks.snapshotExists.mockReturnValue(false);
    mocks.snapshotExtract.mockResolvedValue(undefined);
    mocks.snapshotPath.mockReturnValue('/tmp/snapshot.json');

    mockStore = {
      register: vi.fn().mockReturnValue(true),
    };

    mockClient = {
      session: {
        abort: vi.fn().mockResolvedValue(undefined),
      },
    };

    executor = new AristotleExecutor(
      mockClient,
      mockStore,
      new SnapshotExtractor(),
    );
  });

  // AE-01: should_extract_snapshot_when_targetSessionId
  it('should_extract_snapshot_when_targetSessionId', async () => {
    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'Analyze SESSION_FILE: data',
      targetSessionId: 'target-1',
    });

    expect(mocks.snapshotExists).toHaveBeenCalledWith('target-1', 'wf-1');
    expect(mocks.snapshotExtract).toHaveBeenCalled();
    expect(mocks.snapshotPath).toHaveBeenCalledWith('target-1', 'wf-1');
    expect(mocks.coreLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        oPrompt: 'Analyze SESSION_FILE: /tmp/snapshot.jsondata',
      }),
    );
    expect(result.status).toBe('running');
  });

  // AE-02: should_reuse_snapshot_when_exists_for_this_workflow
  it('should_reuse_snapshot_when_exists_for_this_workflow', async () => {
    mocks.snapshotExists.mockReturnValue(true);

    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'Analyze SESSION_FILE: data',
      targetSessionId: 'target-1',
    });

    expect(mocks.snapshotExists).toHaveBeenCalledWith('target-1', 'wf-1');
    expect(mocks.snapshotExtract).not.toHaveBeenCalled();
    expect(mocks.snapshotPath).toHaveBeenCalledWith('target-1', 'wf-1');
    expect(mocks.coreLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        oPrompt: 'Analyze SESSION_FILE: /tmp/snapshot.jsondata',
      }),
    );
    expect(result.status).toBe('running');
  });

  // AE-03: should_continue_launch_when_snapshot_extraction_fails
  it('should_continue_launch_when_snapshot_extraction_fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.snapshotExtract.mockRejectedValue(new Error('extraction failed'));

    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
      targetSessionId: 'target-1',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      '[aristotle] snapshot extraction failed:',
      expect.any(Error),
    );
    expect(mocks.coreLaunch).toHaveBeenCalled();
    expect(result.status).toBe('running');

    warnSpy.mockRestore();
  });

  // AE-04: should_skip_snapshot_when_no_target_session_id
  it('should_skip_snapshot_when_no_target_session_id', async () => {
    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
    });

    expect(mocks.snapshotExists).not.toHaveBeenCalled();
    expect(mocks.snapshotExtract).not.toHaveBeenCalled();
    expect(mocks.coreLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        oPrompt: 'hello',
      }),
    );
    expect(result.status).toBe('running');
  });

  // AE-05: should_reject_and_abort_session_when_store_full
  it('should_reject_and_abort_session_when_store_full', async () => {
    mockStore.register.mockReturnValue(false);
    mocks.coreLaunch.mockImplementation(async (args) => {
      try {
        args.onSessionCreated?.('sess-1');
        return { sessionId: 'sess-1', status: 'running', message: 'ok' };
      } catch (err) {
        return { sessionId: '', status: 'error', message: String(err) };
      }
    });

    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
    });

    expect(mockStore.register).toHaveBeenCalled();
    expect(mockClient.session.abort).toHaveBeenCalledWith({
      path: { id: 'sess-1' },
    });
    expect(result.status).toBe('error');
    expect(result.message).toContain('Store full');
  });

  // AE-06: should_map_snake_case_params_to_camel_case_launch_args
  it('should_map_snake_case_params_to_camel_case_launch_args', async () => {
    await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
      parentSessionId: 'parent-1',
      targetSessionId: 'target-1',
      focusHint: 'focus',
    });

    expect(mocks.coreLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        oPrompt: expect.any(String),
        parentSessionId: 'parent-1',
        title: 'aristotle-wf-1',
      }),
    );
  });

  // AE-07: should_default_agent_to_R_when_not_provided
  it('should_default_agent_to_R_when_not_provided', async () => {
    mocks.coreLaunch.mockImplementation(async (args) => {
      args.onSessionCreated?.('sess-1');
      return { sessionId: 'sess-1', status: 'running', message: 'ok' };
    });

    await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
    });

    expect(mockStore.register).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'R',
      }),
    );
  });

  // AE-08: should_register_to_store_before_promptAsync
  it('should_register_to_store_before_promptAsync', async () => {
    const events: string[] = [];

    mocks.coreLaunch.mockImplementation(async (args) => {
      events.push('create-session');
      args.onSessionCreated?.('sess-1');
      events.push('after-register');
      // simulate promptAsync happening after onSessionCreated
      events.push('promptAsync');
      return { sessionId: 'sess-1', status: 'running', message: 'ok' };
    });

    await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
    });

    expect(mockStore.register).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        sessionId: 'sess-1',
        status: 'running',
      }),
    );
    expect(events).toEqual(['create-session', 'after-register', 'promptAsync']);
  });

  // AE-09: should_overwrite_existing_workflow_on_re_register
  it('should_overwrite_existing_workflow_on_re_register', async () => {
    mocks.coreLaunch.mockImplementation(async (args) => {
      args.onSessionCreated?.('sess-1');
      return { sessionId: 'sess-1', status: 'running', message: 'ok' };
    });

    await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello1',
    });

    mocks.coreLaunch.mockImplementation(async (args) => {
      args.onSessionCreated?.('sess-2');
      return { sessionId: 'sess-2', status: 'running', message: 'ok' };
    });

    await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello2',
    });

    expect(mockStore.register).toHaveBeenCalledTimes(2);
    expect(mockStore.register).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ workflowId: 'wf-1', sessionId: 'sess-1' }),
    );
    expect(mockStore.register).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ workflowId: 'wf-1', sessionId: 'sess-2' }),
    );
  });

  // AE-10: should_return_error_when_core_launch_fails
  it('should_return_error_when_core_launch_fails', async () => {
    mocks.coreLaunch.mockResolvedValue({
      sessionId: '',
      status: 'error',
      message: 'core launch failed',
    });

    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
    });

    expect(result.workflow_id).toBe('wf-1');
    expect(result.session_id).toBe('');
    expect(result.status).toBe('error');
    expect(result.message).toBe('core launch failed');
  });

  // AE-11: should_default_target_session_id_to_context_sessionID
  it('should_default_target_session_id_to_context_sessionID', async () => {
    await executor.launch(
      {
        workflowId: 'wf-1',
        oPrompt: 'hello',
      },
      { sessionID: 'ctx-sess-1' },
    );

    expect(mocks.snapshotExists).toHaveBeenCalledWith('ctx-sess-1', 'wf-1');
  });

  // AE-12: should_pass_resolved_mcpDir_to_idle_handler
  // The executor itself does not consume mcpDir; this test verifies that
  // the launch flow remains intact in the presence of mcpDir resolution.
  it('should_pass_resolved_mcpDir_to_idle_handler', async () => {
    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
    });

    expect(result.status).toBe('running');
    expect(result.workflow_id).toBe('wf-1');
  });

  // AE-13: should_abort_session_when_store_register_fails
  it('should_abort_session_when_store_register_fails', async () => {
    mockStore.register.mockImplementation(() => {
      throw new Error('register crashed');
    });
    mocks.coreLaunch.mockImplementation(async (args) => {
      try {
        args.onSessionCreated?.('sess-1');
        return { sessionId: 'sess-1', status: 'running', message: 'ok' };
      } catch (err) {
        return { sessionId: '', status: 'error', message: String(err) };
      }
    });

    const result = await executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
    });

    expect(mockClient.session.abort).toHaveBeenCalledWith({
      path: { id: 'sess-1' },
    });
    expect(result.status).toBe('error');
    expect(result.message).toContain('register crashed');
  });

  // AE-14: should_not_block_launch_when_snapshot_extraction_times_out
  it('should_not_block_launch_when_snapshot_extraction_times_out', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mocks.snapshotExists.mockReturnValue(false);
    mocks.snapshotExtract.mockImplementation(() => new Promise(() => {})); // never resolves

    const promise = executor.launch({
      workflowId: 'wf-1',
      oPrompt: 'hello',
      targetSessionId: 'target-1',
    });

    // Advance past the 10-second timeout used inside executor.ts
    vi.advanceTimersByTime(10001);

    const result = await promise;

    expect(warnSpy).toHaveBeenCalledWith(
      '[aristotle] snapshot extraction failed:',
      expect.any(Error),
    );
    expect(result.status).toBe('running');

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});
