import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AsyncTaskExecutor } from '../src/executor.js';
import type { LaunchArgs, LaunchResult } from '../src/types.js';
import { SnapshotExtractor } from '../src/snapshot-extractor.js';
import { WorkflowStore } from '../src/workflow-store.js';

vi.mock('../src/snapshot-extractor.js', () => ({
  SnapshotExtractor: vi.fn(),
}));

describe('AsyncTaskExecutor', () => {
  let client: {
    session: {
      create: ReturnType<typeof vi.fn>;
      promptAsync: ReturnType<typeof vi.fn>;
      abort: ReturnType<typeof vi.fn>;
    };
  };
  let store: {
    register: ReturnType<typeof vi.fn>;
    markError: ReturnType<typeof vi.fn>;
    findByWorkflowId: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    client = {
      session: {
        create: vi.fn().mockResolvedValue({ data: { id: 'sess-created-1' } }),
        promptAsync: vi.fn().mockResolvedValue(undefined),
        abort: vi.fn().mockResolvedValue(undefined),
      },
    };

    store = {
      register: vi.fn().mockReturnValue(true),
      markError: vi.fn(),
      findByWorkflowId: vi.fn().mockReturnValue(undefined),
    };

    vi.mocked(SnapshotExtractor).mockImplementation(
      () =>
        ({
          extract: vi.fn().mockResolvedValue(undefined),
          snapshotExists: vi.fn().mockReturnValue(false),
        }) as any,
    );
  });

  it('should_create_session_promptAsync_and_register', async () => {
    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
    };

    const result = await executor.launch(args);

    expect(client.session.create).toHaveBeenCalledTimes(1);
    expect(store.register).toHaveBeenCalledTimes(1);
    expect(client.session.promptAsync).toHaveBeenCalledTimes(1);

    const createCallOrder = client.session.create.mock.invocationCallOrder[0];
    const registerCallOrder = store.register.mock.invocationCallOrder[0];
    const promptAsyncCallOrder = client.session.promptAsync.mock.invocationCallOrder[0];
    expect(createCallOrder).toBeLessThan(registerCallOrder);
    expect(registerCallOrder).toBeLessThan(promptAsyncCallOrder);

    expect(result).toEqual({
      workflow_id: 'wf-1',
      session_id: expect.any(String),
      status: 'running',
      message: expect.any(String),
    } as LaunchResult);

    // Regression: message must NOT instruct LLM to poll (causes main session blocking)
    // Old bug: "Call aristotle_check(…) to poll status" caused LLM to block the main session
    expect(result.message).not.toMatch(/^Call aristotle_check/);
    expect(result.message).toContain('STOP');
  });

  it('should_extract_snapshot_when_targetSessionId', async () => {
    const mockExtract = vi.fn().mockResolvedValue('/path/to/snapshot.json');
    const mockSnapshotExists = vi.fn().mockReturnValue(false);
    const mockSnapshotPath = vi.fn().mockReturnValue(null);

    vi.mocked(SnapshotExtractor).mockImplementation(
      () =>
        ({
          extract: mockExtract,
          snapshotExists: mockSnapshotExists,
          snapshotPath: mockSnapshotPath,
        }) as any,
    );

    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
      targetSessionId: 'target-1',
    };

    await executor.launch(args);

    expect(SnapshotExtractor).toHaveBeenCalled();
    expect(mockSnapshotExists).toHaveBeenCalledWith('target-1', 'wf-1');
    expect(mockExtract).toHaveBeenCalledWith(
      client,
      'target-1',
      expect.any(String),
      expect.any(Number),
      'wf-1',
    );
  });

  it('should_reuse_snapshot_when_exists_for_this_workflow', async () => {
    const mockExtract = vi.fn().mockResolvedValue('/path/to/snapshot.json');
    const mockSnapshotExists = vi.fn().mockReturnValue(true);
    const mockSnapshotPath = vi.fn().mockReturnValue('/path/to/snapshot.json');

    vi.mocked(SnapshotExtractor).mockImplementation(
      () =>
        ({
          extract: mockExtract,
          snapshotExists: mockSnapshotExists,
          snapshotPath: mockSnapshotPath,
        }) as any,
    );

    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
      targetSessionId: 'target-1',
    };

    await executor.launch(args);

    // Snapshot exists for this workflowId → should NOT re-extract
    expect(mockSnapshotExists).toHaveBeenCalledWith('target-1', 'wf-1');
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockSnapshotPath).toHaveBeenCalledWith('target-1', 'wf-1');
  });

  it('should_continue_launch_when_snapshot_extraction_fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockExtract = vi.fn().mockRejectedValue(new Error('extract failed'));
    const mockSnapshotExists = vi.fn().mockReturnValue(false);

    vi.mocked(SnapshotExtractor).mockImplementation(
      () =>
        ({
          extract: mockExtract,
          snapshotExists: mockSnapshotExists,
        }) as any,
    );

    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
      targetSessionId: 'target-1',
    };

    const result = await executor.launch(args);

    expect(warnSpy).toHaveBeenCalled();
    expect(client.session.create).toHaveBeenCalled();
    expect(client.session.promptAsync).toHaveBeenCalled();
    expect(result.status).toBe('running');

    warnSpy.mockRestore();
  });

  it('should_skip_snapshot_when_no_target_session_id', async () => {
    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
    };

    await executor.launch(args);

    expect(SnapshotExtractor).not.toHaveBeenCalled();
  });

  it('should_reject_and_abort_session_when_store_full', async () => {
    store.register.mockReturnValue(false);

    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
    };

    const result = await executor.launch(args);

    expect(client.session.abort).toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/full|reject/i);
  });

  it('should_abort_session_and_mark_error_on_promptAsync_failure', async () => {
    client.session.promptAsync.mockRejectedValue(new Error('prompt failed'));

    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
    };

    const result = await executor.launch(args);

    expect(client.session.abort).toHaveBeenCalled();
    expect(store.markError).toHaveBeenCalledWith(
      'wf-1',
      expect.stringContaining('prompt failed'),
    );
    expect(result.status).toBe('error');
  });

  it('should_map_snake_case_params_to_camel_case_launch_args', async () => {
    const executor = new AsyncTaskExecutor(client, store);

    // Executor receives camelCase args (index.ts does the snake→camel mapping)
    const camelCaseArgs: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
      targetSessionId: 'target-1',
    };

    await executor.launch(camelCaseArgs);

    expect(client.session.create).toHaveBeenCalled();
    expect(store.register).toHaveBeenCalled();

    const registeredState = store.register.mock.calls[0][0];
    expect(registeredState).toMatchObject({
      workflowId: 'wf-1',
      parentSessionId: 'parent-1',
      targetSessionId: 'target-1',
      agent: 'R',
    });
  });

  it('should_default_agent_to_R_when_not_provided', async () => {
    const executor = new AsyncTaskExecutor(client, store);

    const args = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      parentSessionId: 'parent-1',
    };

    await executor.launch(args as any);

    const registeredState = store.register.mock.calls[0][0];
    expect(registeredState.agent).toBe('R');
  });

  it('should_register_to_store_before_promptAsync', async () => {
    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
    };

    await executor.launch(args);

    const registerCallOrder = store.register.mock.invocationCallOrder[0];
    const promptAsyncCallOrder = client.session.promptAsync.mock.invocationCallOrder[0];
    expect(registerCallOrder).toBeLessThan(promptAsyncCallOrder);
  });

  it('should_return_error_when_session_create_fails', async () => {
    client.session.create.mockRejectedValue(new Error('create failed'));

    const executor = new AsyncTaskExecutor(client, store);

    const args: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'test prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
    };

    const result = await executor.launch(args);

    expect(result.status).toBe('error');
    expect(result.message).toContain('create failed');
  });

  it('should_overwrite_existing_workflow_on_re_register', async () => {
    let createCount = 0;
    client.session.create.mockImplementation(async () => {
      createCount++;
      return { data: { id: `sess-re-${createCount}` } };
    });

    const executor = new AsyncTaskExecutor(client, store);

    const args1: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'first prompt',
      agent: 'R',
      parentSessionId: 'parent-1',
    };

    const args2: LaunchArgs = {
      workflowId: 'wf-1',
      oPrompt: 'second prompt',
      agent: 'R',
      parentSessionId: 'parent-2',
    };

    const result1 = await executor.launch(args1);
    const result2 = await executor.launch(args2);

    expect(store.register).toHaveBeenCalledTimes(2);
    expect(store.register.mock.calls[0][0].workflowId).toBe('wf-1');
    expect(store.register.mock.calls[1][0].workflowId).toBe('wf-1');
    expect(result2.session_id).not.toBe(result1.session_id);
  });
});
