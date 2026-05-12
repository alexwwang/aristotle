import { describe, it, expect } from 'vitest'
import { computeProjectId } from '../src/project-id.js'

describe('computeProjectId', () => {
  it('returns deterministic ID for same path', () => {
    const a = computeProjectId('/Users/alex/my-project')
    const b = computeProjectId('/Users/alex/my-project')
    expect(a).toBe(b)
    expect(a).toHaveLength(8)
  })

  it('returns different IDs for different paths', () => {
    const a = computeProjectId('/Users/alex/project-a')
    const b = computeProjectId('/Users/alex/project-b')
    expect(a).not.toBe(b)
  })

  it('normalizes trailing slash', () => {
    const a = computeProjectId('/Users/alex/my-project')
    const b = computeProjectId('/Users/alex/my-project/')
    expect(a).toBe(b)
  })

  it('normalizes double slashes', () => {
    const a = computeProjectId('/Users/alex/my-project')
    const b = computeProjectId('/Users//alex//my-project')
    expect(a).toBe(b)
  })

  it('returns 8 hex chars', () => {
    const id = computeProjectId('/any/path')
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })
})
