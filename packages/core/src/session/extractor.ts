import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logger.js'

export interface ExtractOptions {
  roles?: ('user' | 'assistant' | 'tool')[]
  limit?: number
  maxContentLength?: number
  transform?: (msg: any, index: number) => any
}

export class SessionExtractor {
  constructor(private baseDir?: string) {}

  async extract(
    client: any,
    sessionId: string,
    options?: ExtractOptions,
  ): Promise<{ messages: any[]; sessionId: string; extractedAt: string }> {
    let messages: any[] | undefined

    // Check cache first (default cache key — no suffix)
    const cacheFile = this.cachePath(sessionId)
    if (this.baseDir && cacheFile && fs.existsSync(cacheFile)) {
      try {
        const raw = fs.readFileSync(cacheFile, 'utf-8')
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          messages = parsed
        }
      } catch {
        // DC-06: corrupted cache file — skip and refetch from API
        logger.warn('Cache file corrupted for session %s, refetching from API', sessionId)
        messages = undefined
      }
    }

    // Fetch from API if no valid cache
    if (messages === undefined) {
      const response = await client.session.messages({ path: { id: sessionId } })
      messages = response.data || []

      // Write to cache for future use
      if (this.baseDir && cacheFile) {
        try {
          fs.mkdirSync(this.baseDir, { recursive: true })
          fs.writeFileSync(cacheFile, JSON.stringify(messages))
        } catch (err) {
          logger.error('Failed to write cache for session %s: %s', sessionId, err)
        }
      }
    }

    // Defensive: TypeScript can't infer messages is always defined here
    messages = messages || []

    // Apply roles filter
    if (options?.roles && options.roles.length > 0) {
      messages = messages.filter((msg) => options.roles!.includes(msg.info?.role))
    }

    // Apply limit with hard cap at 200
    if (options?.limit !== undefined) {
      messages = messages.slice(0, Math.min(options.limit, 200))
    }

    // Apply maxContentLength truncation to text parts
    if (options?.maxContentLength !== undefined && options.maxContentLength > 0) {
      messages = messages.map((msg) => {
        if (!msg.parts || !Array.isArray(msg.parts)) return msg
        const truncatedParts = msg.parts.map((part: any) => {
          if (
            part.type === 'text' &&
            typeof part.text === 'string' &&
            part.text.length > options.maxContentLength!
          ) {
            return { ...part, text: part.text.slice(0, options.maxContentLength!) }
          }
          return part
        })
        return { ...msg, parts: truncatedParts }
      })
    }

    // Apply custom transform
    if (options?.transform) {
      messages = messages.map((msg, index) => options.transform!(msg, index))
    }

    return {
      messages,
      sessionId,
      extractedAt: new Date().toISOString(),
    }
  }

  isCached(sessionId: string, key?: string): boolean {
    if (!this.baseDir) return false
    const cacheFile = this.cachePath(sessionId, key)
    if (!cacheFile) return false
    return fs.existsSync(cacheFile)
  }

  cachePath(sessionId: string, key?: string): string | null {
    if (!this.baseDir) return null
    const fileName = key ? `${sessionId}_${key}.json` : `${sessionId}.json`
    return path.join(this.baseDir, fileName)
  }
}
