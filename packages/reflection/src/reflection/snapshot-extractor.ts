import { SessionExtractor } from '@opencode-ai/core/session/extractor';
import { createStateStore, type StateStore } from '@opencode-ai/core/store/state-store';
import path from 'node:path';

export class SnapshotExtractor {
  private extractor: SessionExtractor;
  private store: StateStore;
  private sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir || '';
    this.extractor = new SessionExtractor(sessionsDir);
    this.store = createStateStore(this.sessionsDir);
  }

  private buildKey(sessionId: string, workflowId?: string): string {
    const suffix = workflowId ? `_${workflowId}` : '';
    return `${sessionId}${suffix}_snapshot`;
  }

  snapshotExists(sessionId: string, workflowId?: string): boolean {
    const key = this.buildKey(sessionId, workflowId);
    return this.store.read<unknown>(key) !== null;
  }

  snapshotPath(sessionId: string, workflowId?: string): string | null {
    const key = this.buildKey(sessionId, workflowId);
    const data = this.store.read<unknown>(key);
    if (data === null) return null;
    return path.join(this.sessionsDir, `${key}.json`);
  }

  async extract(
    client: any,
    sessionId: string,
    focusHint: string = 'last 50 messages',
    limit: number = 50,
    workflowId?: string,
  ): Promise<string> {
    const effectiveLimit = Math.min(limit, 200);

    const raw = await this.extractor.extract(client, sessionId, {
      roles: ['user', 'assistant'],
      limit: effectiveLimit,
    });

    // Filter out messages without parts (backward compatibility)
    const filtered = raw.messages.filter(
      (msg: any) => msg.parts && Array.isArray(msg.parts),
    );

    const messages = filtered.map((msg: any, index: number) => ({
      index: index + 1,
      role: msg.info?.role,
      content: msg.parts
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
      total_messages: messages.length,
      messages,
    };

    const key = this.buildKey(sessionId, workflowId);
    this.store.write(key, snapshot);
    return path.join(this.sessionsDir, `${key}.json`);
  }
}
