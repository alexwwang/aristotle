import { AsyncTaskExecutor } from '@opencode-ai/core/executor';
import type { WorkflowStore } from '@opencode-ai/core/store/workflow-store';
import type { LaunchResult } from '@opencode-ai/core/types';
import { SnapshotExtractor } from './reflection/snapshot-extractor.js';

export interface AristotleLaunchArgs {
  workflowId: string;
  oPrompt: string;
  agent?: string;
  parentSessionId?: string;
  targetSessionId?: string;
  focusHint?: string;
}

export class AristotleExecutor {
  private coreExecutor: AsyncTaskExecutor;

  constructor(
    private client: any,
    private store: WorkflowStore,
    private snapshotExtractor: SnapshotExtractor,
  ) {
    this.coreExecutor = new AsyncTaskExecutor(client);
  }

  async launch(
    args: AristotleLaunchArgs,
    context?: { sessionID?: string },
  ): Promise<LaunchResult> {
    const workflowId = args.workflowId;
    const oPrompt = args.oPrompt;
    const agent = args.agent ?? 'R';
    const parentSessionId =
      args.parentSessionId || context?.sessionID || '';
    const targetSessionId =
      args.targetSessionId || context?.sessionID || '';
    const focusHint = args.focusHint;

    // 1. Snapshot extraction (non-blocking, per-workflow naming)
    let preparedPrompt = oPrompt;
    if (targetSessionId) {
      try {
        if (
          !this.snapshotExtractor.snapshotExists(targetSessionId, workflowId)
        ) {
          await Promise.race([
            this.snapshotExtractor.extract(
              this.client,
              targetSessionId,
              focusHint ?? 'last 50 messages',
              50,
              workflowId,
            ),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('snapshot extraction timed out')),
                10000,
              ),
            ),
          ]);
        }
        const snapshotFilePath = this.snapshotExtractor.snapshotPath(
          targetSessionId,
          workflowId,
        );
        if (snapshotFilePath) {
          preparedPrompt = preparedPrompt.replace(
            'SESSION_FILE: ',
            `SESSION_FILE: ${snapshotFilePath}`,
          );
        }
      } catch (e) {
        console.warn('[aristotle] snapshot extraction failed:', e);
      }
    }

    // 2. Call core executor with onSessionCreated for store registration
    //    DC-02: crash-safety — register before promptAsync
    const coreResult = await this.coreExecutor.launch({
      oPrompt: preparedPrompt,
      parentSessionId,
      title: `aristotle-${workflowId}`,
      onSessionCreated: (sessionId) => {
        let registered: boolean;
        try {
          registered = this.store.register({
            workflowId,
            sessionId,
            parentSessionId,
            status: 'running',
            startedAt: Date.now(),
            agent,
            ...(targetSessionId ? { targetSessionId } : {}),
          });
        } catch (e) {
          this.client.session
            .abort({ path: { id: sessionId } })
            .catch(() => {});
          throw e;
        }
        if (!registered) {
          this.client.session
            .abort({ path: { id: sessionId } })
            .catch(() => {});
          throw new Error(
            'Store full: too many concurrent workflows (max 50). Try again later.',
          );
        }
      },
    });

    // 3. Format result
    if (coreResult.status === 'error') {
      return {
        workflow_id: workflowId,
        session_id: coreResult.sessionId,
        status: 'error',
        message: coreResult.message,
      };
    }

    return {
      workflow_id: workflowId,
      session_id: coreResult.sessionId,
      status: 'running',
      message:
        '🦉 Task launched. workflow_id: ' +
        workflowId +
        '. ' +
        'Bridge plugin handles the R→C chain automatically via session.idle events. ' +
        'Do NOT call aristotle_check to poll. Just inform the user and STOP.',
    };
  }
}
