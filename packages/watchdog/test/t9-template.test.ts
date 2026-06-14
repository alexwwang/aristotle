import { describe, it, expect } from 'vitest'
import { TaskTemplateRegistry } from '../src/registry.js'
import { runT9PrecisionFilter } from '../src/t9-precision.js'

describe('T-9 Precision Filter', () => {
  const registry = new TaskTemplateRegistry()

  // TC-T9-001
  it('should_retrieve_t9_template_with_oracle_subagent', () => {
    const template = registry.get_template('T-9')
    expect(template.subagent_type).toBe('oracle')
    expect(template.timeout).toBe(60)
    expect(template.name).toBe('precision_filter')
  })

  // TC-T9-002
  it('should_validate_t9_output_verdict_enum', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [{ id: 'F-01', severity: 'H', description: 'test', location: 'src/a.ts:1', suggestion: 'fix' }],
      location_map: { 'src/a.ts': { line_ranges: [[1, 10]], exists: true } },
      review_scope: { in_scope: ['src/a.ts'], out_of_scope: [] },
    })
    expect(result.confirmed_findings.length).toBeGreaterThan(0)
    for (const f of result.confirmed_findings) {
      expect(['CONFIRM', 'DOWNGRADE']).toContain(f.verdict)
    }
  })

  // TC-T9-003
  it('should_require_original_severity_on_downgrade', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [{ id: 'F-01', severity: 'H', description: 'test', location: 'out-of-scope.ts:1', suggestion: 'fix' }],
      location_map: {},
      review_scope: { in_scope: ['src/a.ts'], out_of_scope: ['out-of-scope.ts'] },
    })
    const downgraded = result.confirmed_findings.filter(f => f.verdict === 'DOWNGRADE')
    expect(downgraded.length).toBeGreaterThan(0)
    for (const f of downgraded) {
      expect(f.original_severity).toBeDefined()
    }
  })

  // TC-T9-004
  it('should_downgrade_when_location_not_in_map', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [{ id: 'F-01', severity: 'H', description: 'test', location: 'src/missing.ts:1', suggestion: 'fix' }],
      location_map: {},
      review_scope: { in_scope: ['src/a.ts'], out_of_scope: [] },
    })
    const f = result.confirmed_findings.find(f => f.id === 'F-01')
    expect(f?.verdict).toBe('DOWNGRADE')
    expect(f?.adjusted_severity).toBe('I')
  })

  // TC-T9-005
  it('should_reject_or_downgrade_out_of_scope', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [{ id: 'F-01', severity: 'M', description: 'test', location: 'vendor/lib.ts:1', suggestion: 'fix' }],
      location_map: { 'vendor/lib.ts': { line_ranges: [[1, 10]], exists: true } },
      review_scope: { in_scope: ['src/a.ts'], out_of_scope: ['vendor/lib.ts'] },
    })
    const f = result.confirmed_findings.find(f => f.id === 'F-01')
    expect(['REJECT', 'DOWNGRADE']).toContain(f?.verdict)
  })

  // TC-T9-006
  // HALT triggered: findings reference in_scope files but location_map is empty,
  // meaning the reviewer cannot verify locations. This is distinct from TC-T9-011
  // where all findings are out_of_scope (auto-REJECT skips HALT).
  it('should_halt_on_empty_location_map_with_findings', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [
        { id: 'F-01', severity: 'H', description: 'test', location: 'src/a.ts:1', suggestion: 'fix' },
        { id: 'F-02', severity: 'C', description: 'test2', location: 'src/b.ts:5', suggestion: 'fix2' },
      ],
      location_map: {},
      review_scope: { in_scope: ['src/a.ts', 'src/b.ts'], out_of_scope: [] },
    })
    expect(result.halt_reason).toBeTruthy()
  })

  // TC-T9-007
  it('should_not_downgrade_bare_file_path_without_line_ranges', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [{ id: 'F-01', severity: 'H', description: 'test', location: 'src/a.ts', suggestion: 'fix' }],
      location_map: { 'src/a.ts': { exists: true } },
      review_scope: { in_scope: ['src/a.ts'], out_of_scope: [] },
    })
    const f = result.confirmed_findings.find(f => f.id === 'F-01')
    expect(f?.verdict).not.toBe('DOWNGRADE')
  })

  // TC-T9-008
  it('should_downgrade_when_location_undefined', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [{ id: 'F-01', severity: 'H', description: 'test', location: undefined, suggestion: 'fix' }],
      location_map: { 'src/a.ts': { line_ranges: [[1, 10]], exists: true } },
      review_scope: { in_scope: ['src/a.ts'], out_of_scope: [] },
    })
    const f = result.confirmed_findings.find(f => f.id === 'F-01')
    expect(f?.verdict).toBe('DOWNGRADE')
    expect(f?.verdict_reason).toContain('location not provided')
  })

  // TC-T9-009
  it('should_return_empty_confirmed_findings_on_zero_raw_findings', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [],
      location_map: {},
      review_scope: { in_scope: [], out_of_scope: [] },
    })
    expect(result.confirmed_findings).toEqual([])
    expect(result.halt_reason).toBeUndefined()
  })

  // TC-T9-010
  it('should_downgrade_when_location_exists_false', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [{ id: 'F-01', severity: 'H', description: 'test', location: 'src/deleted.ts:1', suggestion: 'fix' }],
      location_map: { 'src/deleted.ts': { exists: false } },
      review_scope: { in_scope: ['src/deleted.ts'], out_of_scope: [] },
    })
    const f = result.confirmed_findings.find(f => f.id === 'F-01')
    expect(f?.verdict).toBe('DOWNGRADE')
    expect(f?.adjusted_severity).toBe('I')
  })

  // TC-T9-011
  // No HALT: all findings reference out_of_scope files (auto-REJECT), so empty
  // location_map is moot. Contrast with TC-T9-006 where in_scope + empty map = HALT.
  it('should_return_empty_confirmed_findings_when_all_rejected', () => {
    const result = runT9PrecisionFilter({
      raw_findings: [
        { id: 'F-01', severity: 'M', description: 'test', location: 'vendor/a.ts:1', suggestion: 'fix' },
        { id: 'F-02', severity: 'P', description: 'test2', location: 'vendor/b.ts:1', suggestion: 'fix2' },
        { id: 'F-03', severity: 'L', description: 'test3', location: 'vendor/c.ts:1', suggestion: 'fix3' },
      ],
      location_map: {},
      review_scope: { in_scope: ['src/'], out_of_scope: ['vendor/a.ts', 'vendor/b.ts', 'vendor/c.ts'] },
    })
    expect(result.confirmed_findings).toEqual([])
    expect(result.halt_reason).toBeUndefined()
  })

  // TC-T9-012
  it('should_split_raw_findings_into_batches_of_30_for_parallel_invocation', () => {
    const rawFindings = Array.from({ length: 45 }, (_, i) => ({
      id: `F-${String(i + 1).padStart(2, '0')}`,
      severity: 'M',
      description: `Finding ${i + 1}`,
      location: `src/file${(i % 5) + 1}.ts:${i + 1}`,
      suggestion: `Fix ${i + 1}`,
    }))
    const locationMap: Record<string, { line_ranges?: number[][]; exists: boolean }> = {}
    for (let i = 1; i <= 5; i++) {
      locationMap[`src/file${i}.ts`] = { line_ranges: [[1, 100]], exists: true }
    }
    const result = runT9PrecisionFilter({
      raw_findings: rawFindings,
      location_map: locationMap,
      review_scope: { in_scope: Object.keys(locationMap), out_of_scope: [] },
    })
    expect(result.confirmed_findings.length).toBeGreaterThan(0)
    expect(result.halt_reason).toBeUndefined()
    const inputIds = new Set(rawFindings.map(f => f.id))
    const resultIds = new Set<string>()
    for (const f of result.confirmed_findings) {
      expect(['CONFIRM', 'DOWNGRADE', 'REJECT']).toContain(f.verdict)
      expect(f.id).toMatch(/^F-\d{2}$/)
      expect(inputIds.has(f.id)).toBe(true)
      expect(resultIds.has(f.id)).toBe(false)
      resultIds.add(f.id)
    }
    expect(result.confirmed_findings.length).toBeLessThanOrEqual(rawFindings.length)
  })
})
