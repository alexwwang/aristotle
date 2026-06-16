import { describe, it, expect } from 'vitest'
import { processT3Response } from '../src/t3-status.js'

describe('T-3 Status Variants', () => {
  // TC-T3-001
  it('should_return_success_when_split_and_tests_pass', () => {
    const result = processT3Response({
      status: 'success', split_plan: {}, new_files: ['a.ts', 'b.ts'], tests_pass: true, warnings: [],
    })
    expect(result.status).toBe('success')
    expect(result.tests_pass).toBe(true)
  })

  // TC-T3-002
  it('should_return_timeout_when_tests_timeout', () => {
    const result = processT3Response({
      status: 'success', split_plan: {}, new_files: ['a.ts'], tests_pass: 'timeout', warnings: ['Tests timed out after 30s'],
    })
    expect(result.status).toBe('success')
    expect(result.tests_pass).toBe('timeout')
  })

  // TC-T3-003
  it('should_return_unsplittable_status', () => {
    const result = processT3Response({
      status: 'unsplittable', reason: 'File size below 100KB threshold',
    })
    expect(result.status).toBe('unsplittable')
    expect(result.reason).toBe('File size below 100KB threshold')
  })

  // TC-T3-004
  it('should_return_tests_failed_status', () => {
    const result = processT3Response({
      status: 'tests_failed', new_files: ['a.ts'], tests_pass: false, rolled_back: true,
    })
    expect(result.status).toBe('tests_failed')
    expect(result.tests_pass).toBe(false)
    expect(result.rolled_back).toBe(true)
  })

  // TC-T3-005
  it('should_return_rollback_failed_status', () => {
    const result = processT3Response({
      status: 'rollback_failed', new_files: ['a.ts'], error: 'Git conflict during rollback',
    })
    expect(result.status).toBe('rollback_failed')
    expect(result.error).toBe('Git conflict during rollback')
  })

  // TC-T3-006
  it('should_include_warnings_in_success', () => {
    const result = processT3Response({
      status: 'success', split_plan: {}, new_files: ['a.ts'], tests_pass: true, warnings: ['Warning 1'],
    })
    expect(result.warnings).toContain('Warning 1')
  })

  // TC-T3-007
  it('should_return_skipped_when_tests_skipped', () => {
    const result = processT3Response({
      status: 'success', split_plan: {}, new_files: ['a.ts'], tests_pass: 'skipped', warnings: [],
    })
    expect(result.status).toBe('success')
    expect(result.tests_pass).toBe('skipped')
  })
})
