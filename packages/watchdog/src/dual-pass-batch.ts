export interface DualPassBatchResult {
  findings: unknown[]
  errors: unknown[]
}

export function splitFindingsIntoBatches(findings: unknown[], maxBatchSize: number): unknown[][] {
  throw new Error('Not implemented: splitFindingsIntoBatches')
}

export function mergeBatchVerdicts(batches: unknown[][]): unknown[] {
  throw new Error('Not implemented: mergeBatchVerdicts')
}

export function mergePartialBatchResults(successfulBatch: unknown[], failedBatch: unknown[]): unknown[] {
  throw new Error('Not implemented: mergePartialBatchResults')
}
