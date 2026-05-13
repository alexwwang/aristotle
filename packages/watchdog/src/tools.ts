/**
 * Watchdog plugin tool registration.
 *
 * Follows the same pattern as packages/reflection/src/tools.ts.
 * Defines the `tdd_checkpoint` tool that the LLM calls during tdd-pipeline execution.
 */
import { z } from 'zod'
import type { ToolDefinition } from '@opencode-ai/core/plugin/registration'
import type { CheckpointHandler } from './checkpoint.js'

export interface CreateWatchdogToolsDeps {
  checkpointHandler: CheckpointHandler
}

export function createWatchdogTools(deps: CreateWatchdogToolsDeps): Record<string, ToolDefinition> {
  const { checkpointHandler } = deps

  return {
    tdd_checkpoint: {
      description: 'Report a checkpoint event to the TDD pipeline watchdog. Call this at mandatory points during tdd-pipeline execution: pipeline_start, phase_enter, ralph_loop_start, ralph_round_complete, ralph_terminate, test_evidence, user_approval, phase_complete.',
      args: {
        event: z.string().describe('Checkpoint event type: pipeline_start | phase_enter | ralph_loop_start | ralph_round_complete | ralph_terminate | test_evidence | user_approval | phase_complete'),
        payload: z.string().describe('JSON string with event-specific data. See tdd-pipeline SKILL.md for payload schemas.'),
      },
      execute: async (args: any, context: any) => {
        const worktree = context?.worktree ?? context?.directory ?? ''
        const sessionID = context?.sessionID ?? context?.session?.id ?? ''

        // H-fix #1: Defensive guard — reject if project root cannot be determined.
        // Prevents silent fallback to process.cwd() producing wrong project ID
        // when neither worktree nor directory exist on OpenCode's context.
        if (!worktree) {
          return JSON.stringify({
            ok: false,
            violation: 'Cannot determine project root: context provides neither worktree nor directory. Report this to the user.',
            guidance: 'The checkpoint tool requires a workspace context. Ensure you are running in a project directory.',
          })
        }

        return checkpointHandler.handle(
          args.event as any,
          args.payload ?? '{}',
          { worktree, sessionID },
        )
      },
    },
  }
}
