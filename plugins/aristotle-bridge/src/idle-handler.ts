import { extractLastAssistantText } from './utils.js';
import type { WorkflowState } from './types.js';
import type { WorkflowStore } from './workflow-store.js';

export class IdleEventHandler {
  constructor(
    private client: any,
    private store: WorkflowStore,
  ) {}

  async handle(sessionID: string): Promise<void> {
    const wf: WorkflowState | undefined = this.store.findBySession(sessionID);
    if (!wf || wf.status !== 'running') return;

    try {
      const messages = await this.client.session.messages({ path: { id: sessionID } });
      const result = extractLastAssistantText(messages.data);
      this.store.markCompleted(wf.workflowId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markError(wf.workflowId, message);
    }
  }
}
