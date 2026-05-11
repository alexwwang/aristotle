import { describe, it, expect, vi } from 'vitest';
import { AsyncTaskExecutor } from '../src/executor/index.js';

describe('AsyncTaskExecutor', () => {
  // EX-01: should_create_session_promptAsync_and_return_running
  it('should_create_session_promptAsync_and_return_running', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ data: { id: 'sess-1' } });
    const mockPromptAsync = vi.fn().mockResolvedValue(undefined);
    const client = {
      session: {
        create: mockCreate,
        promptAsync: mockPromptAsync,
      },
    };
    const executor = new AsyncTaskExecutor(client);

    const result = await executor.launch({
      oPrompt: 'hello',
      parentSessionId: 'parent-1',
      title: 'test-title',
    });

    expect(result).toEqual({
      sessionId: 'sess-1',
      status: 'running',
      message: 'Sub-session launched successfully',
    });
    expect(mockCreate).toHaveBeenCalledWith({
      body: { title: 'test-title', parentID: 'parent-1' },
    });
    expect(mockPromptAsync).toHaveBeenCalledWith({
      path: { id: 'sess-1' },
      body: { parts: [{ type: 'text', text: 'hello' }] },
    });
  });

  // EX-02: should_return_error_when_session_create_fails
  it('should_return_error_when_session_create_fails', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('create failed'));
    const mockPromptAsync = vi.fn().mockResolvedValue(undefined);
    const client = {
      session: {
        create: mockCreate,
        promptAsync: mockPromptAsync,
      },
    };
    const executor = new AsyncTaskExecutor(client);

    const result = await executor.launch({
      oPrompt: 'hello',
      parentSessionId: 'parent-1',
      title: 'test-title',
    });

    expect(result.status).toBe('error');
    expect(result.sessionId).toBe('');
    expect(result.message).toContain('create failed');
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });

  // EX-03: should_abort_and_return_error_when_promptAsync_fails
  it('should_abort_and_return_error_when_promptAsync_fails', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ data: { id: 'sess-1' } });
    const mockPromptAsync = vi.fn().mockRejectedValue(new Error('promptAsync failed'));
    const client = {
      session: {
        create: mockCreate,
        promptAsync: mockPromptAsync,
      },
    };
    const executor = new AsyncTaskExecutor(client);

    const result = await executor.launch({
      oPrompt: 'hello',
      parentSessionId: 'parent-1',
      title: 'test-title',
    });

    expect(result.status).toBe('error');
    expect(result.sessionId).toBe('');
    expect(result.message).toContain('promptAsync failed');
    expect(mockCreate).toHaveBeenCalled();
    expect(mockPromptAsync).toHaveBeenCalled();
  });

  // EX-04: should_invoke_onSessionCreated_callback_before_promptAsync
  it('should_invoke_onSessionCreated_callback_before_promptAsync', async () => {
    const onSessionCreated = vi.fn();
    const mockCreate = vi.fn().mockResolvedValue({ data: { id: 'sess-1' } });
    const mockPromptAsync = vi.fn().mockResolvedValue(undefined);
    const client = {
      session: {
        create: mockCreate,
        promptAsync: mockPromptAsync,
      },
    };
    const executor = new AsyncTaskExecutor(client);

    await executor.launch({
      oPrompt: 'hello',
      parentSessionId: 'parent-1',
      title: 'test-title',
      onSessionCreated,
    });

    // Verify callback was called with correct sessionId
    expect(onSessionCreated).toHaveBeenCalledWith('sess-1');
    // Verify callback was called before promptAsync (call order)
    const createCallOrder = mockCreate.mock.invocationCallOrder![0];
    const callbackCallOrder = onSessionCreated.mock.invocationCallOrder![0];
    const promptAsyncCallOrder = mockPromptAsync.mock.invocationCallOrder![0];
    expect(callbackCallOrder).toBeGreaterThan(createCallOrder);
    expect(callbackCallOrder).toBeLessThan(promptAsyncCallOrder);
  });
});
