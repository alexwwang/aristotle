/**
 * SessionBuffer — per-session call recording with per-session FIFO eviction.
 * Design: Phase2-ActiveMonitoring.md §6.3
 *
 * Each session has an independent buffer. When record() pushes the buffer
 * past SESSION_BUFFER_MAX_SIZE (1000), oldest entries are evicted (FIFO).
 * NOT persisted — cleared on session end or plugin restart.
 */
import type { Logger } from '@opencode-ai/core/logger'
import { SESSION_BUFFER_MAX_SIZE, MAX_TRACKED_SESSIONS } from './constants.js'

export interface SessionBufferEntry {
  tool: string
  callID: string
  timestamp: string
}

export class SessionBuffer {
  private buffers = new Map<string, SessionBufferEntry[]>()
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /**
   * Record a tool call observation for a session.
   * If the session's buffer exceeds SESSION_BUFFER_MAX_SIZE, oldest entries
   * are evicted (FIFO).
   */
  record(sessionId: string, entry: SessionBufferEntry): void {
    let buffer = this.buffers.get(sessionId)
    if (!buffer) {
      buffer = []
      this.buffers.set(sessionId, buffer)
    }

    buffer.push(entry)

    // Per-session FIFO eviction
    while (buffer.length > SESSION_BUFFER_MAX_SIZE) {
      buffer.shift()
      this.logger.debug('SessionBuffer: FIFO eviction for session %s', sessionId)
    }

    // LRU eviction: re-insert to move accessed session to end of Map iteration order
    if (this.buffers.has(sessionId)) {
      const existing = this.buffers.get(sessionId)!
      this.buffers.delete(sessionId)
      this.buffers.set(sessionId, existing)
    }

    // Evict least-recently-used session if total session count exceeds limit
    while (this.buffers.size > MAX_TRACKED_SESSIONS) {
      const lruKey = this.buffers.keys().next().value
        if (lruKey !== undefined) {
          this.buffers.delete(lruKey)
        this.logger.debug('SessionBuffer: evicted LRU session %s (limit %d)', lruKey, MAX_TRACKED_SESSIONS)
      } else {
        break
      }
    }
  }

  /** Get all buffered entries for a session. Returns empty array if none. */
  getSession(sessionId: string): SessionBufferEntry[] {
    return this.buffers.get(sessionId)?.slice() ?? []
  }

  /** Clear all entries for a session. Called on session end. */
  clearSession(sessionId: string): void {
    this.buffers.delete(sessionId)
  }

  /** Get count of tracked sessions (for diagnostics). */
  sessionCount(): number {
    return this.buffers.size
  }
}
