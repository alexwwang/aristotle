import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdleEventHandler } from '../src/idle-handler.js';
import type { WorkflowState } from '../src/types.js';
import { extractLastAssistantText } from '../src/utils.js';

vi.mock('../src/utils.js', () => ({
  extractLastAssistantText: vi.fn(),
}));

describe('IdleEventHandler', () => {
  let store: {
    findBySession: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markError: ReturnType<typeof vi.fn>;
  };
  let client: {
    session: {
      messages: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    store = {
      findBySession: vi.fn(),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markError: vi.fn().mockResolvedValue(undefined),
    };
    client = {
      session: {
        messages: vi.fn().mockResolvedValue([]),
      },
    };
    vi.mocked(extractLastAssistantText).mockReturnValue('extracted result');
  });

  it('should_skip_cancelled_workflow', async () => {
    store.findBySession.mockReturnValue({
      status: 'cancelled',
      workflowId: 'wf-1',
      sessionId: 'session-1',
    } as WorkflowState);

    const handler = new IdleEventHandler(client, store);
    await handler.handle('session-1');

    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_skip_completed_workflow', async () => {
    store.findBySession.mockReturnValue({
      status: 'completed',
      workflowId: 'wf-2',
      sessionId: 'session-2',
    } as WorkflowState);

    const handler = new IdleEventHandler(client, store);
    await handler.handle('session-2');

    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_collect_result_from_completed_session', async () => {
    store.findBySession.mockReturnValue({
      status: 'running',
      workflowId: 'wf-3',
      sessionId: 'session-3',
    } as WorkflowState);
    client.session.messages.mockResolvedValue([
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: 'Hello' }],
      },
    ]);

    const handler = new IdleEventHandler(client, store);
    await handler.handle('session-3');

    expect(client.session.messages).toHaveBeenCalled();
    expect(extractLastAssistantText).toHaveBeenCalled();
    expect(store.markCompleted).toHaveBeenCalledWith('wf-3', 'extracted result');
  });

  it('should_handle_message_fetch_error_gracefully', async () => {
    store.findBySession.mockReturnValue({
      status: 'running',
      workflowId: 'wf-4',
      sessionId: 'session-4',
    } as WorkflowState);
    client.session.messages.mockRejectedValue(new Error('fetch failed'));

    const handler = new IdleEventHandler(client, store);
    await handler.handle('session-4');

    expect(store.markError).toHaveBeenCalledWith('wf-4', expect.any(String));
  });

  it('should_skip_unknown_session', async () => {
    store.findBySession.mockReturnValue(undefined);

    const handler = new IdleEventHandler(client, store);
    await handler.handle('session-5');

    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_skip_undone_workflow', async () => {
    store.findBySession.mockReturnValue({
      status: 'undone',
      workflowId: 'wf-6',
      sessionId: 'session-6',
    } as WorkflowState);

    const handler = new IdleEventHandler(client, store);
    await handler.handle('session-6');

    expect(client.session.messages).not.toHaveBeenCalled();
  });

  it('should_skip_error_workflow', async () => {
    store.findBySession.mockReturnValue({
      status: 'error',
      workflowId: 'wf-7',
      sessionId: 'session-7',
    } as WorkflowState);

    const handler = new IdleEventHandler(client, store);
    await handler.handle('session-7');

    expect(client.session.messages).not.toHaveBeenCalled();
  });
});
