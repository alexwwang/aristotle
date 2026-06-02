import { describe, it, expect } from 'vitest'
import { createWatchdogTools } from '../src/tools.js'

// Mock handler — tools.ts only needs the shape, not real behavior
const mockHandler: any = { handle: (() => Promise.resolve('{}')), articulationFailures: new Map(), store: null, staleThresholdMs: 0, getFailureCount: () => 0 }
const mockPipelineStore: any = { readAuditLog: () => [] }

describe('tools.ts: ralph_round_finding registration', () => {
  const tools = createWatchdogTools({ checkpointHandler: mockHandler, pipelineStore: mockPipelineStore })
  const checkpointTool = tools.tdd_checkpoint

  it('should accept ralph_round_finding in event enum', () => {
    // AC-4: Bug fix — ralph_round_finding is currently missing from z.enum
    // Will FAIL until tools.ts adds 'ralph_round_finding' to the enum array
    const eventSchema = checkpointTool.args.event
    const result = eventSchema.safeParse('ralph_round_finding')
    expect(result.success).toBe(true)
  })

  it('should include ralph_round_finding in description string', () => {
    // AC-4: Bug fix — description string omits ralph_round_finding
    // Will FAIL until tools.ts updates the description
    expect(checkpointTool.description).toContain('ralph_round_finding')
  })
})
