/**
 * SessionBuffer — per-session call recording with global FIFO eviction.
 * Design: Phase2-ActiveMonitoring.md §6.3
 */
export class SessionBuffer {
  private maxSize: number
  private sessions: Map<string, any[]>
  private chronological: Array<{ sessionID: string; entry: any }>

  constructor(maxSize: number) {
    this.maxSize = maxSize
    this.sessions = new Map()
    this.chronological = []
  }

  record(
    sessionID: string,
    entry: { tool: string; callID: string; timestamp: string }
  ): void {
    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, [])
    }
    this.sessions.get(sessionID)!.push(entry)
    this.chronological.push({ sessionID, entry })

    // FIFO eviction across all sessions when total exceeds maxSize
    while (this.chronological.length > this.maxSize) {
      const oldest = this.chronological.shift()!
      const sessionEntries = this.sessions.get(oldest.sessionID)!
      sessionEntries.shift()
      if (sessionEntries.length === 0) {
        this.sessions.delete(oldest.sessionID)
      }
    }
  }

  getSession(sessionID: string): any[] {
    return this.sessions.get(sessionID) ?? []
  }

  clearSession(sessionID: string): void {
    if (!this.sessions.has(sessionID)) return

    this.chronological = this.chronological.filter(
      (item) => item.sessionID !== sessionID
    )
    this.sessions.delete(sessionID)
  }

  sessionCount(): number {
    return this.sessions.size
  }
}
