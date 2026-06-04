/**
 * Watchdog plugin tool registration.
 *
 * Follows the same pattern as packages/reflection/src/tools.ts.
 * Defines the `tdd_checkpoint` tool that the LLM calls during tdd-pipeline execution.
 */
import * as z from 'zod'
import type { ToolDefinition } from '@opencode-ai/core/plugin/registration'
import type { CheckpointHandler } from './checkpoint.js'
import type { PipelineStore } from './pipeline-store.js'
import { computeProjectId } from './project-id.js'

export interface CreateWatchdogToolsDeps {
  checkpointHandler: CheckpointHandler
  pipelineStore: PipelineStore
}

export function createWatchdogTools(deps: CreateWatchdogToolsDeps): Record<string, ToolDefinition> {
  const { checkpointHandler, pipelineStore } = deps

  return {
    tdd_checkpoint: {
      description: 'Report a checkpoint event to the TDD pipeline watchdog. Call this at mandatory points during tdd-pipeline execution: pipeline_start, phase_enter, ralph_loop_start, ralph_round_complete, ralph_round_finding, ralph_terminate, user_approval, phase_complete. NOTE: test_evidence and why_articulation are also accepted but test_evidence is DEPRECATED (no longer gates behavior).',
      args: {
        // NOTE: When adding new event types (e.g. Phase 3 escalation),
        // update this enum array and the CheckpointEvent type in schema.ts.
        event: z.enum([
          'pipeline_start', 'phase_enter', 'ralph_loop_start',
          'ralph_round_complete', 'ralph_round_finding', 'ralph_terminate', 'test_evidence',
          'user_approval', 'why_articulation', 'phase_complete',
        ]).describe('Checkpoint event type'),
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
    read_audit_log: {
      description: 'Read audit log entries for a pipeline run. Returns entries sorted by timestamp descending (newest first).',
      args: {
        projectId: z.string().describe('Project ID'),
        runId: z.string().describe('Run ID'),
        filter: z.object({
          event: z.string().optional(),
          severity: z.string().optional(),
          resolved: z.boolean().optional(),
          limit: z.number().int().min(0).optional(),
        }).optional().describe('Optional filters for audit log entries'),
      },
      execute: async (args: any, context: any) => {
        const worktree = context?.worktree ?? context?.directory ?? ''
        if (!worktree) {
          return JSON.stringify({ ok: false, error: 'Cannot determine project root' })
        }
        // F-04: Derive projectId from worktree and enforce matching — prevents
        // cross-project audit log access from arbitrary LLM-supplied IDs.
        const computedProjectId = computeProjectId(worktree)
        if (args.projectId !== computedProjectId) {
          return JSON.stringify({ ok: false, error: `projectId mismatch: tool caller must use the project's own ID (${computedProjectId})` })
        }
        const entries = pipelineStore.readAuditLog(args.projectId, args.runId, args.filter)
        return JSON.stringify({ ok: true, entries })
      },
    },
  }
}
