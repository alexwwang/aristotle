import { describe, it, expect } from 'vitest'
import type { PhaseStatus, CheckpointEvent, PipelineState, SuspendedPipeline } from '../src/schema.js'
import { SCHEMA_VERSION } from '../src/schema.js'

describe('types - pipeline nesting', () => {
  // #40
  it('should accept suspended in PhaseStatus union', () => {
    const status: PhaseStatus = 'suspended'
    expect(status).toBe('suspended')
  })

  // #41
  it('should accept paused in PhaseStatus union', () => {
    const status: PhaseStatus = 'paused'
    expect(status).toBe('paused')
  })

  // #42
  it('should have correct PipelineState nesting fields', () => {
    const state: PipelineState = {
      version: SCHEMA_VERSION,
      projectId: 'proj-1',
      runId: 'run-123',
      startedAt: '2026-01-01T00:00:00Z',
      description: 'test',
      currentPhase: 5,
      phaseStatus: 'suspended',
      totalPhases: 8,
      phases: {},
      ralph: null,
      testEvidenceConfirmed: false,
      lastCheckpointAt: '2026-01-01T00:00:00Z',
      depth: 1,
      parentRunId: 'parent-1',
      parentPipelineProjectId: 'proj-parent',
      childPipelineRunId: 'child-1',
      suspendedReason: 'test_modification',
      suspendedAt: '2026-01-01T00:00:00Z',
      suspendedPhase: 5,
      prePauseStatus: 'ralph_loop',
      preSuspendStatus: 'ralph_loop',
      pausedAt: '2026-01-01T00:00:00Z',
      pending_pause: { reason: 'pattern_cycle', violation_type: 'REGRESSION', files: ['a.ts'] },
      child_pause_timer_started_at: '2026-01-01T00:00:00Z',
    }
    // F-028: assert all nesting fields explicitly
    expect(state.depth).toBe(1)
    expect(state.parentRunId).toBe('parent-1')
    expect(state.parentPipelineProjectId).toBe('proj-parent')
    expect(state.childPipelineRunId).toBe('child-1')
    expect(state.suspendedReason).toBe('test_modification')
    expect(state.suspendedAt).toBe('2026-01-01T00:00:00Z')
    expect(state.suspendedPhase).toBe(5)
    expect(state.prePauseStatus).toBe('ralph_loop')
    expect(state.preSuspendStatus).toBe('ralph_loop')
    expect(state.pausedAt).toBe('2026-01-01T00:00:00Z')
    expect(state.pending_pause?.reason).toBe('pattern_cycle')
    expect(state.child_pause_timer_started_at).toBe('2026-01-01T00:00:00Z')
  })

  // #43
  it('should have correct SuspendedPipeline interface', () => {
    const entry: SuspendedPipeline = {
      runId: 'run-123',
      suspendedAt: '2026-01-01T00:00:00Z',
      suspendedPhase: 5,
      depth: 0,
      childDepth: 1,
      parentRunId: 'parent-1',
      parentPipelineProjectId: 'proj-parent',
      parentRegressionHistory: [],
      suspendedReason: 'test_modification',
      childRunId: 'child-456',
      quarantineSuccess: true,
    }
    // F-028: assert all SuspendedPipeline fields explicitly
    expect(entry.runId).toBe('run-123')
    expect(entry.suspendedAt).toBe('2026-01-01T00:00:00Z')
    expect(entry.suspendedPhase).toBe(5)
    expect(entry.depth).toBe(0)
    expect(entry.childDepth).toBe(1)
    expect(entry.parentRunId).toBe('parent-1')
    expect(entry.parentPipelineProjectId).toBe('proj-parent')
    expect(entry.parentRegressionHistory).toEqual([])
    expect(entry.suspendedReason).toBe('test_modification')
    expect(entry.childRunId).toBe('child-456')
    expect(entry.quarantineSuccess).toBe(true)
  })

  // #44
  it('should accept pipeline_suspend in CheckpointEvent union', () => {
    const event: CheckpointEvent = 'pipeline_suspend'
    expect(event).toBe('pipeline_suspend')
  })

  // #45
  it('should accept pipeline_resume in CheckpointEvent union', () => {
    const event: CheckpointEvent = 'pipeline_resume'
    expect(event).toBe('pipeline_resume')
  })

  // #113
  it('should accept all new PhaseStatus and CheckpointEvent union members', () => {
    const failedStatus: PhaseStatus = 'failed'
    expect(failedStatus).toBe('failed')
    const cancelledStatus: PhaseStatus = 'cancelled'
    expect(cancelledStatus).toBe('cancelled')

    const events: CheckpointEvent[] = [
      'pipeline_suspend',
      'pipeline_resume',
      'pipeline_pause',
      'pipeline_unpause',
      'ralph_loop_start',
      'd2_complete',
      'phase_fail',
    ]
    expect(events).toHaveLength(7)
  })
})
