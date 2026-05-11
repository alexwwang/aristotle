import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionExtractor } from '../src/session/extractor.js'

describe('SessionExtractor', () => {
  let tmpDir: string
  let extractor: SessionExtractor
  let client: any

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-test-'))
    extractor = new SessionExtractor(tmpDir)
    client = {
      session: {
        messages: vi.fn(),
      },
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // SE-01: should_extract_messages_from_session
  it('SE-01 should_extract_messages_from_session', async () => {
    const messages = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hi' }] },
    ]
    client.session.messages.mockResolvedValue({ data: messages })

    const result = await extractor.extract(client, 'session-1')

    expect(client.session.messages).toHaveBeenCalledWith({ path: { id: 'session-1' } })
    expect(result.sessionId).toBe('session-1')
    expect(result.messages).toEqual(messages)
    expect(result.extractedAt).toBeDefined()
    expect(new Date(result.extractedAt).toISOString()).toBe(result.extractedAt)
  })

  // SE-02: should_filter_by_roles
  it('SE-02 should_filter_by_roles', async () => {
    const messages = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hi' }] },
      { info: { role: 'tool' }, parts: [{ type: 'tool_use', name: 'foo' }] },
    ]
    client.session.messages.mockResolvedValue({ data: messages })

    const result = await extractor.extract(client, 'session-1', { roles: ['assistant'] })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].info.role).toBe('assistant')
  })

  // SE-03: should_apply_limit
  it('SE-03 should_apply_limit', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      info: { role: 'user' },
      parts: [{ type: 'text', text: `msg-${i}` }],
    }))
    client.session.messages.mockResolvedValue({ data: messages })

    const result = await extractor.extract(client, 'session-1', { limit: 10 })

    expect(result.messages).toHaveLength(10)
    expect(result.messages[0].parts[0].text).toBe('msg-0')
    expect(result.messages[9].parts[0].text).toBe('msg-9')
  })

  // SE-04: should_truncate_content_to_max_length
  it('SE-04 should_truncate_content_to_max_length', async () => {
    const longText = 'a'.repeat(500)
    const messages = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: longText }] },
    ]
    client.session.messages.mockResolvedValue({ data: messages })

    const result = await extractor.extract(client, 'session-1', { maxContentLength: 100 })

    expect(result.messages[0].parts[0].text).toBe('a'.repeat(100))
  })

  // SE-05: should_apply_custom_transform
  it('SE-05 should_apply_custom_transform', async () => {
    const messages = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hi' }] },
    ]
    client.session.messages.mockResolvedValue({ data: messages })

    const result = await extractor.extract(client, 'session-1', {
      transform: (msg, index) => ({ ...msg, index }),
    })

    expect(result.messages[0].index).toBe(0)
    expect(result.messages[1].index).toBe(1)
  })

  // SE-06: should_use_key_as_filename_suffix
  it('SE-06 should_use_key_as_filename_suffix', () => {
    const cacheFile = path.join(tmpDir, 'session-1_workflow-1.json')
    fs.writeFileSync(cacheFile, JSON.stringify([]))

    expect(extractor.isCached('session-1', 'workflow-1')).toBe(true)
    expect(extractor.cachePath('session-1', 'workflow-1')).toBe(cacheFile)
  })

  // SE-07: should_use_default_filename_when_no_key
  it('SE-07 should_use_default_filename_when_no_key', () => {
    const cacheFile = path.join(tmpDir, 'session-1.json')
    fs.writeFileSync(cacheFile, JSON.stringify([]))

    expect(extractor.isCached('session-1')).toBe(true)
    expect(extractor.cachePath('session-1')).toBe(cacheFile)
  })

  // SE-08: should_return_extracted_at_timestamp
  it('SE-08 should_return_extracted_at_timestamp', async () => {
    client.session.messages.mockResolvedValue({ data: [] })

    const before = Date.now()
    const result = await extractor.extract(client, 'session-1')
    const after = Date.now()

    const extractedAt = new Date(result.extractedAt).getTime()
    expect(extractedAt).toBeGreaterThanOrEqual(before)
    expect(extractedAt).toBeLessThanOrEqual(after)
    expect(result.extractedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  // SE-09: should_handle_empty_session
  it('SE-09 should_handle_empty_session', async () => {
    client.session.messages.mockResolvedValue({ data: [] })

    const result = await extractor.extract(client, 'session-1')

    expect(result.messages).toEqual([])
  })

  // SE-10: should_return_cached_data_without_api_call
  it('SE-10 should_return_cached_data_without_api_call', async () => {
    const cachedMessages = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'cached' }] },
    ]
    const cacheFile = path.join(tmpDir, 'session-1.json')
    fs.writeFileSync(cacheFile, JSON.stringify(cachedMessages))

    const result = await extractor.extract(client, 'session-1')

    expect(client.session.messages).not.toHaveBeenCalled()
    expect(result.messages).toEqual(cachedMessages)
  })

  // SE-11: should_handle_undefined_baseDir_gracefully
  it('SE-11 should_handle_undefined_baseDir_gracefully', async () => {
    const noDirExtractor = new SessionExtractor(undefined)

    expect(noDirExtractor.isCached('session-1')).toBe(false)
    expect(noDirExtractor.isCached('session-1', 'key')).toBe(false)
    expect(noDirExtractor.cachePath('session-1')).toBeNull()
    expect(noDirExtractor.cachePath('session-1', 'key')).toBeNull()

    client.session.messages.mockResolvedValue({ data: [] })
    const result = await noDirExtractor.extract(client, 'session-1')
    expect(result.messages).toEqual([])
    expect(client.session.messages).toHaveBeenCalledTimes(1)
  })

  // SE-12: should_refetch_when_cache_file_corrupted
  it('SE-12 should_refetch_when_cache_file_corrupted', async () => {
    const cacheFile = path.join(tmpDir, 'session-1.json')
    fs.writeFileSync(cacheFile, 'not valid json {')

    const apiMessages = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'from api' }] },
    ]
    client.session.messages.mockResolvedValue({ data: apiMessages })

    const result = await extractor.extract(client, 'session-1')

    expect(client.session.messages).toHaveBeenCalledTimes(1)
    expect(result.messages).toEqual(apiMessages)
  })

  // SE-13: should_enforce_200_message_hard_limit_on_double_execution
  it('SE-13 should_enforce_200_message_hard_limit_on_double_execution', async () => {
    const messages = Array.from({ length: 250 }, (_, i) => ({
      info: { role: 'user' },
      parts: [{ type: 'text', text: `msg-${i}` }],
    }))
    client.session.messages.mockResolvedValue({ data: messages })

    const result = await extractor.extract(client, 'session-1', { limit: 200 })

    expect(result.messages).toHaveLength(200)
  })
})
