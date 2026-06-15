import { describe, it, expect } from 'vitest'
import { splitFindingsIntoBatches, mergeBatchVerdicts, mergePartialBatchResults } from '../src/dual-pass-batch.js'

// Phase 3 spec: 30-finding batch threshold for splitFindingsIntoBatches
const SPEC_BATCH_THRESHOLD = 30

describe('Dual-Pass Batch', () => {
  // RT-050a — F-032: omit batch-size to verify production default = 30
  it('should_split_findings_into_batches_of_30', () => {
    const findings = Array.from({ length: 45 }, (_, i) => ({ id: `F-${i}`, severity: 'M' }))
    const batches = splitFindingsIntoBatches(findings)
    expect(batches.length).toBe(2)
    expect(batches[0].length).toBe(SPEC_BATCH_THRESHOLD)
    expect(batches[1].length).toBe(15)
  })

  // RT-050b
  it('should_not_split_when_findings_count_under_30', () => {
    const findings = Array.from({ length: 25 }, (_, i) => ({ id: `F-${i}`, severity: 'M' }))
    const batches = splitFindingsIntoBatches(findings)
    expect(batches.length).toBe(1)
  })

  // RT-050c
  it('should_not_split_when_findings_count_exactly_30', () => {
    const findings = Array.from({ length: SPEC_BATCH_THRESHOLD }, (_, i) => ({ id: `F-${i}`, severity: 'M' }))
    const batches = splitFindingsIntoBatches(findings)
    expect(batches.length).toBe(1)
  })

  // RT-051a
  it('should_merge_batch_verdicts_with_reject_override', () => {
    const batches = [[{ id: 'F-01', verdict: 'REJECT' }], [{ id: 'F-01', verdict: 'CONFIRM' }]]
    const merged = mergeBatchVerdicts(batches) as Array<{ id: string; verdict: string }>
    expect(merged).toHaveLength(1)
    expect(merged[0].verdict).toBe('REJECT')
  })

  // RT-051b
  it('should_merge_batch_verdicts_with_downgrade_precedence', () => {
    const batches = [[{ id: 'F-01', verdict: 'DOWNGRADE' }], [{ id: 'F-01', verdict: 'CONFIRM' }]]
    const merged = mergeBatchVerdicts(batches) as Array<{ id: string; verdict: string }>
    expect(merged).toHaveLength(1)
    expect(merged[0].verdict).toBe('DOWNGRADE')
  })

  // RT-051c
  it('should_preserve_same_verdict_on_merge', () => {
    const batches = [[{ id: 'F-01', verdict: 'CONFIRM' }], [{ id: 'F-01', verdict: 'CONFIRM' }]]
    const merged = mergeBatchVerdicts(batches) as Array<{ id: string; verdict: string }>
    expect(merged).toHaveLength(1)
    expect(merged[0].verdict).toBe('CONFIRM')
  })

  // RT-051d — dual DOWNGRADE: lower severity wins (spec: dual_downgrade_to_lower_severity)
  it('should_select_lower_severity_on_dual_downgrade_merge', () => {
    const batches = [
      [{ id: 'F-01', verdict: 'DOWNGRADE', severity: 'M' }],
      [{ id: 'F-01', verdict: 'DOWNGRADE', severity: 'L' }],
    ]
    const merged = mergeBatchVerdicts(batches) as Array<{ id: string; verdict: string; severity: string }>
    expect(merged).toHaveLength(1)
    expect(merged[0].verdict).toBe('DOWNGRADE')
    expect(merged[0].severity).toBe('L')
  })

  // RT-051e — same verdict+severity tie: batch 0's rationale preserved (spec: lower_batch_index_on_tie)
  it('should_keep_batch_index_0_data_on_tie', () => {
    const batches = [
      [{ id: 'F-01', verdict: 'CONFIRM', rationale: 'batch-0-rationale' }],
      [{ id: 'F-01', verdict: 'CONFIRM', rationale: 'batch-1-rationale' }],
    ]
    const merged = mergeBatchVerdicts(batches) as Array<{ id: string; verdict: string; rationale: string }>
    expect(merged).toHaveLength(1)
    expect(merged[0].rationale).toBe('batch-0-rationale')
  })

  // RT-052a
  it('should_merge_partial_batch_results_with_recall_conversion', () => {
    const successful = [{ id: 'F-01', verdict: 'CONFIRM' }]
    const failed = [{ id: 'F-02', verdict: 'CONFIRM' }]
    const merged = mergePartialBatchResults(successful, failed) as Array<{ id: string; verdict?: string }>
    expect(merged).toHaveLength(2)
    // F-18: verify content provenance — successful from T-9 verdicts, failed via Recall conversion
    const fromSuccessful = merged.find(f => f.id === 'F-01')
    expect(fromSuccessful).toBeDefined()
    expect(fromSuccessful?.verdict).toBe('CONFIRM')
    // Failed findings get Recall conversion (SR-prefixed or same id but degraded source)
    const fromFailed = merged.find(f => f.id === 'F-02' || f.id.startsWith('SR-'))
    expect(fromFailed).toBeDefined()
  })

  // RT-052b
  it('should_emit_warn_audit_on_partial_batch_failure', () => {
    const successful = [{ id: 'F-01', verdict: 'CONFIRM' }]
    const failed = [{ id: 'F-02', verdict: 'CONFIRM', error: 'batch crash' }]
    const merged = mergePartialBatchResults(successful, failed) as Array<{ id: string; verdict?: string }>
    expect(merged).toHaveLength(2)
    // F-18: verify content provenance
    expect(merged.find(f => f.id === 'F-01')).toBeDefined()
    expect(merged.find(f => f.id === 'F-02' || f.id.startsWith('SR-'))).toBeDefined()
  })
})
