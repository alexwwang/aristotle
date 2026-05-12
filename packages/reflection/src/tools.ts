import { z } from 'zod';
import type { ToolDefinition } from '@opencode-ai/core/plugin/registration';
import type { WorkflowStore } from '@opencode-ai/core/store/workflow-store';

export interface CreateAristotleToolsDeps {
  store: WorkflowStore;
  executor: {
    launch(args: {
      workflowId: string;
      oPrompt: string;
      agent: string;
      parentSessionId: string;
      targetSessionId?: string;
    }): Promise<{
      workflow_id: string;
      session_id: string;
      status: 'running' | 'error';
      message: string;
    }>;
  };
  client: {
    session: {
      abort(args: { path: { id: string } }): Promise<unknown>;
    };
  };
}

export function createAristotleTools(deps: CreateAristotleToolsDeps): Record<string, ToolDefinition> {
  const { store, executor, client } = deps;

  return {
    aristotle_fire_o: {
      description: 'Launch an Aristotle workflow sub-agent (Reflector) via the Bridge plugin',
      args: {
        workflow_id: z.string().describe('Unique workflow identifier'),
        o_prompt: z.string().describe('The orchestrator prompt to send to the sub-agent'),
        agent: z.string().optional().describe('Agent role: R (reflector, default) or C (checker)'),
        target_session_id: z.string().optional().describe('Target session ID to analyze'),
      },
      execute: async (args: any, context: any) => {
        const sessionId = context?.sessionID || '';
        const result = await executor.launch({
          workflowId: args.workflow_id,
          oPrompt: args.o_prompt,
          agent: args.agent ?? 'R',
          parentSessionId: sessionId,
          targetSessionId: args.target_session_id || sessionId,
        });
        return JSON.stringify(result);
      },
    },

    aristotle_check: {
      description: 'Check the status of an Aristotle workflow, or list all active workflows',
      args: {
        workflow_id: z.string().optional().describe('Workflow ID to check; omit to list all active'),
      },
      execute: async (args: any) => {
        if (!args.workflow_id) {
          return JSON.stringify(store.getActive());
        }
        return JSON.stringify(store.retrieve(args.workflow_id));
      },
    },

    aristotle_abort: {
      description: 'Cancel a running Aristotle workflow',
      args: {
        workflow_id: z.string().describe('Workflow ID to cancel'),
      },
      execute: async (args: any) => {
        const wf = store.findByWorkflowId(args.workflow_id);
        if (!wf) {
          return JSON.stringify({ error: 'Workflow not found' });
        }
        if (wf.status === 'cancelled') {
          return JSON.stringify({ status: 'cancelled', workflow_id: args.workflow_id });
        }
        if (wf.status === 'chain_broken') {
          return JSON.stringify({ status: 'chain_broken', error: wf.error });
        }
        if (wf.status === 'chain_pending') {
          await client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
          store.cancel(args.workflow_id);
          return JSON.stringify({ status: 'cancelled', workflow_id: args.workflow_id });
        }
        if (wf.status !== 'running') {
          return JSON.stringify({ status: wf.status, workflow_id: args.workflow_id });
        }
        await client.session.abort({ path: { id: wf.sessionId } }).catch(() => {});
        store.cancel(args.workflow_id);
        return JSON.stringify({ status: 'cancelled', workflow_id: args.workflow_id });
      },
    },
  };
}
