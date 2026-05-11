import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAristotleTools } from '../src/tools.js';
import type { WorkflowState } from '@opencode-ai/core';
import type { WorkflowStore } from '@opencode-ai/core/store/workflow-store';

function createMockStore(overrides: Partial<WorkflowStore> = {}) {
  return {
    getActive: vi.fn().mockReturnValue({ active: [] }),
    retrieve: vi.fn().mockReturnValue({ error: 'Workflow not found' }),
    findByWorkflowId: vi.fn().mockReturnValue(undefined),
    cancel: vi.fn(),
    ...overrides,
  } as any;
}

function createMockExecutor(overrides: any = {}) {
  return {
    launch: vi.fn().mockResolvedValue({
      workflow_id: 'wf-123',
      session_id: 'sess-456',
      status: 'running',
      message: 'Task launched',
    }),
    ...overrides,
  };
}

function createMockClient(overrides: any = {}) {
  return {
    session: {
      abort: vi.fn().mockResolvedValue(undefined),
      ...overrides.session,
    },
    ...overrides,
  };
}

function createMockContext(sessionID: string = 'parent-sess-1') {
  return { sessionID };
}

describe('createAristotleTools', () => {
  let mockStore: ReturnType<typeof createMockStore>;
  let mockExecutor: ReturnType<typeof createMockExecutor>;
  let mockClient: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof createAristotleTools>;

  beforeEach(() => {
    mockStore = createMockStore();
    mockExecutor = createMockExecutor();
    mockClient = createMockClient();
    tools = createAristotleTools({
      store: mockStore,
      executor: mockExecutor,
      client: mockClient,
    });
  });

  describe('aristotle_fire_o', () => {
    it('TL-01: should_fire_o_create_session_and_return_workflow_id', async () => {
      mockExecutor.launch.mockResolvedValue({
        workflow_id: 'wf-test-1',
        session_id: 'sess-789',
        status: 'running',
        message: '🦉 Task launched.',
      });

      const result = await tools.aristotle_fire_o.execute(
        {
          workflow_id: 'wf-test-1',
          o_prompt: 'Reflect on this code',
        },
        createMockContext('parent-sess-1'),
      );

      expect(mockExecutor.launch).toHaveBeenCalledWith({
        workflowId: 'wf-test-1',
        oPrompt: 'Reflect on this code',
        agent: 'R',
        parentSessionId: 'parent-sess-1',
        targetSessionId: 'parent-sess-1',
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual({
        workflow_id: 'wf-test-1',
        session_id: 'sess-789',
        status: 'running',
        message: '🦉 Task launched.',
      });
    });

    it('TL-02: should_fire_o_reject_when_store_full', async () => {
      mockExecutor.launch.mockResolvedValue({
        workflow_id: 'wf-test-2',
        session_id: '',
        status: 'error',
        message: 'Store full: too many concurrent workflows (max 50). Try again later.',
      });

      const result = await tools.aristotle_fire_o.execute(
        {
          workflow_id: 'wf-test-2',
          o_prompt: 'Reflect on this code',
        },
        createMockContext(),
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.message).toContain('Store full');
    });
  });

  describe('aristotle_check', () => {
    it('TL-03: should_check_return_status_for_existing_workflow', async () => {
      mockStore.retrieve.mockReturnValue({ status: 'running' });

      const result = await tools.aristotle_check.execute(
        { workflow_id: 'wf-test-3' },
        createMockContext(),
      );

      expect(mockStore.retrieve).toHaveBeenCalledWith('wf-test-3');
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ status: 'running' });
    });

    it('TL-04: should_check_return_not_found_for_unknown_workflow', async () => {
      mockStore.retrieve.mockReturnValue({ error: 'Workflow not found' });

      const result = await tools.aristotle_check.execute(
        { workflow_id: 'wf-unknown' },
        createMockContext(),
      );

      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ error: 'Workflow not found' });
    });
  });

  describe('aristotle_abort', () => {
    it('TL-05: should_abort_cancel_running_workflow', async () => {
      mockStore.findByWorkflowId.mockReturnValue({
        workflowId: 'wf-test-5',
        sessionId: 'sess-abc',
        status: 'running',
      } as WorkflowState);

      const result = await tools.aristotle_abort.execute(
        { workflow_id: 'wf-test-5' },
        createMockContext(),
      );

      expect(mockClient.session.abort).toHaveBeenCalledWith({
        path: { id: 'sess-abc' },
      });
      expect(mockStore.cancel).toHaveBeenCalledWith('wf-test-5');
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ status: 'cancelled', workflow_id: 'wf-test-5' });
    });

    it('TL-06: should_abort_handle_chain_pending_specially', async () => {
      mockStore.findByWorkflowId.mockReturnValue({
        workflowId: 'wf-test-6',
        sessionId: 'sess-def',
        status: 'chain_pending',
      } as WorkflowState);

      const result = await tools.aristotle_abort.execute(
        { workflow_id: 'wf-test-6' },
        createMockContext(),
      );

      expect(mockClient.session.abort).toHaveBeenCalledWith({
        path: { id: 'sess-def' },
      });
      expect(mockStore.cancel).toHaveBeenCalledWith('wf-test-6');
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ status: 'cancelled', workflow_id: 'wf-test-6' });
    });

    it('TL-07: should_abort_skip_non_running_workflows', async () => {
      mockStore.findByWorkflowId.mockReturnValue({
        workflowId: 'wf-test-7',
        sessionId: 'sess-ghi',
        status: 'completed',
        result: 'all good',
      } as WorkflowState);

      const result = await tools.aristotle_abort.execute(
        { workflow_id: 'wf-test-7' },
        createMockContext(),
      );

      expect(mockClient.session.abort).not.toHaveBeenCalled();
      expect(mockStore.cancel).not.toHaveBeenCalled();
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ status: 'completed', workflow_id: 'wf-test-7' });
    });

    it('TL-08: should_abort_return_error_for_unknown_workflow', async () => {
      mockStore.findByWorkflowId.mockReturnValue(undefined);

      const result = await tools.aristotle_abort.execute(
        { workflow_id: 'wf-unknown' },
        createMockContext(),
      );

      expect(mockClient.session.abort).not.toHaveBeenCalled();
      expect(mockStore.cancel).not.toHaveBeenCalled();
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ error: 'Workflow not found' });
    });

    it('TL-09: should_abort_return_chain_broken_without_cancelling', async () => {
      mockStore.findByWorkflowId.mockReturnValue({
        workflowId: 'wf-test-9',
        sessionId: 'sess-jkl',
        status: 'chain_broken',
        error: 'chain was broken due to timeout',
      } as WorkflowState);

      const result = await tools.aristotle_abort.execute(
        { workflow_id: 'wf-test-9' },
        createMockContext(),
      );

      expect(mockClient.session.abort).not.toHaveBeenCalled();
      expect(mockStore.cancel).not.toHaveBeenCalled();
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({
        status: 'chain_broken',
        error: 'chain was broken due to timeout',
      });
    });

    it('TL-10: should_abort_succeed_even_if_session_abort_fails', async () => {
      mockStore.findByWorkflowId.mockReturnValue({
        workflowId: 'wf-test-10',
        sessionId: 'sess-mno',
        status: 'running',
      } as WorkflowState);

      mockClient.session.abort.mockRejectedValue(new Error('session already closed'));

      const result = await tools.aristotle_abort.execute(
        { workflow_id: 'wf-test-10' },
        createMockContext(),
      );

      expect(mockClient.session.abort).toHaveBeenCalledWith({
        path: { id: 'sess-mno' },
      });
      expect(mockStore.cancel).toHaveBeenCalledWith('wf-test-10');
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ status: 'cancelled', workflow_id: 'wf-test-10' });
    });
  });
});
