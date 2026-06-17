export interface DualPassBatchResult {
  findings: unknown[]
  errors: unknown[]
}

const DEFAULT_BATCH_SIZE = 30

const VERDICT_PRECEDENCE: Record<string, number> = {
  REJECT: 3,
  DOWNGRADE: 2,
  CONFIRM: 1,
}

const SEVERITY_ORDER: Record<string, number> = { C: 5, H: 4, M: 3, P: 2, L: 1, I: 0 }

export function splitFindingsIntoBatches(findings: unknown[], maxBatchSize?: number): unknown[][] {
  const size = maxBatchSize ?? DEFAULT_BATCH_SIZE
  if (findings.length <= size) {
    return [findings]
  }
  const batches: unknown[][] = []
  for (let i = 0; i < findings.length; i += size) {
    batches.push(findings.slice(i, i + size))
  }
  return batches
}

export function mergeBatchVerdicts(batches: unknown[][]): unknown[] {
  const byId = new Map<string, { finding: Record<string, unknown>; batchIdx: number }>()

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    for (const f of batches[batchIdx]) {
      const finding = f as Record<string, unknown>
      const id = finding.id as string
      const existing = byId.get(id)
      if (!existing) {
        byId.set(id, { finding, batchIdx })
        continue
      }
      const existingVerdict = existing.finding.verdict as string
      const newVerdict = finding.verdict as string
      const existingPrec = VERDICT_PRECEDENCE[existingVerdict] ?? 0
      const newPrec = VERDICT_PRECEDENCE[newVerdict] ?? 0
      if (newPrec > existingPrec) {
        byId.set(id, { finding, batchIdx })
      } else if (newPrec === existingPrec) {
        if (newVerdict === 'DOWNGRADE' && existingVerdict === 'DOWNGRADE') {
          const existingSev = SEVERITY_ORDER[existing.finding.severity as string] ?? 99
          const newSev = SEVERITY_ORDER[finding.severity as string] ?? 99
          if (newSev < existingSev) {
            byId.set(id, { finding, batchIdx })
          }
        }
      }
    }
  }
  return [...byId.values()].map(v => v.finding)
}

export function mergePartialBatchResults(successfulBatch: unknown[], failedBatch: unknown[]): unknown[] {
  return [...successfulBatch, ...failedBatch]
}
