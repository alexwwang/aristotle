import { mkdirSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class SnapshotExtractor {
  private readonly sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? join(homedir(), '.config', 'opencode', 'aristotle-sessions');
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  async extract(
    client: any,
    sessionId: string,
    focusHint: string = 'last 50 messages',
    limit: number = 50,
  ): Promise<void> {
    const effectiveLimit = Math.min(limit, 200);
    const messages = await client.session.messages({
      path: { id: sessionId },
      query: { limit: effectiveLimit },
    });

    const filtered = messages.data
      .filter((m: any) => {
        if (!m.parts) return false;
        return m.info.role === 'user' || m.info.role === 'assistant';
      })
      .slice(0, 200)
      .map((m: any, i: number) => ({
        index: i + 1,
        role: m.info.role,
        content: m.parts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n')
          .slice(0, 4000),
      }));

    const snapshot = {
      version: 1,
      session_id: sessionId,
      extracted_at: new Date().toISOString(),
      focus: focusHint,
      source: 'bridge-plugin-sdk',
      total_messages: filtered.length,
      messages: filtered,
    };

    const filePath = join(this.sessionsDir, `${sessionId}_snapshot.json`);
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  snapshotExists(sessionId: string): boolean {
    return existsSync(join(this.sessionsDir, `${sessionId}_snapshot.json`));
  }
}
