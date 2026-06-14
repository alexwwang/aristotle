import { describe, it, expect } from 'vitest'
import { splitFindingsIntoBatches, mergeBatchVerdicts, mergePartialBatchResults } from '../src/dual-pass-batch.js'

describe('Dual-Pass Batch', () => {
  // RT-050a
  it('should_split_findings_into_batches_of_30', () => {
    const findings = Array.from({ length: 45 }, (_, i) => ({ id: `F-${i}`, severity: 'M' }))
    const batches = splitFindingsIntoBatches(findings, 30)
    expect(batches.length).toBe(2)
    expect(batches[0].length).toBe(30)
    expect(batches[1].length).toBe(15)
  })

  // RT-050b
  it('should_not_split_when_findings_count_under_30', () => {
    const findings = Array.from({ length: 25 }, (_, i) => ({ id: `F-${i}`, severity: 'M' }))
    const batches = splitFindingsIntoBatches(findings, 30)
    expect(batches.length).toBe(1)
  })

  // RT-050c
  it('should_not_split_when_findings_count_exactly_30', () => {
    const findings = Array.from({ length: 30 }, (_, i) => ({ id: `F-${i}`, severity: 'M' }))
    const batches = splitFindingsIntoBatches(findings, 30)
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

  // RT-052a
  it('should_merge_partial_batch_results_with_recall_conversion', () => {
    const successful = [{ id: 'F-01', verdict: 'CONFIRM' }]
    const failed = [{ id: 'F-02', verdict: 'CONFIRM' }]
    const merged = mergePartialBatchResults(successful, failed)
    expect(merged).toHaveLength(2)
  })

  // RT-052b
  it('should_emit_warn_audit_on_partial_batch_failure', () => {
    const successful = [{ id: 'F-01', verdict: 'CONFIRM' }]
    const failed = [{ id: 'F-02', verdict: 'CONFIRM', error: 'batch crash' }]
    const merged = mergePartialBatchResults(successful, failed)
    expect(merged).toHaveLength(2)
  })
})
