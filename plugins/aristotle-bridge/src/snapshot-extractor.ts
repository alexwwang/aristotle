import { mkdirSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveConfig } from './config.js';

export class SnapshotExtractor {
  private readonly sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? resolveConfig().sessions_dir;
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  async extract(
    client: any,
    sessionId: string,
    focusHint: string = 'last 50 messages',
    limit: number = 50,
    workflowId?: string,
  ): Promise<string> {
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

    const suffix = workflowId ? `_${workflowId}` : '';
    const filePath = join(this.sessionsDir, `${sessionId}${suffix}_snapshot.json`);
    const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
    return filePath;
  }

  snapshotExists(sessionId: string, workflowId?: string): boolean {
    const suffix = workflowId ? `_${workflowId}` : '';
    return existsSync(join(this.sessionsDir, `${sessionId}${suffix}_snapshot.json`));
  }

  snapshotPath(sessionId: string, workflowId?: string): string | null {
    const suffix = workflowId ? `_${workflowId}` : '';
    const p = join(this.sessionsDir, `${sessionId}${suffix}_snapshot.json`);
    return existsSync(p) ? p : null;
  }
}
