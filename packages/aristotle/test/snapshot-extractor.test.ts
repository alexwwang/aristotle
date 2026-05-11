import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotExtractor } from '../src/reflection/snapshot-extractor.js';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from 'node:fs';

vi.mock('node:fs');

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedRenameSync = vi.mocked(renameSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

function createMockClient(messages: any[] = []) {
  return {
    session: {
      messages: vi.fn().mockResolvedValue({ data: messages }),
    },
  };
}

function buildMessage(content: string, role = 'user', parts?: any[]) {
  return {
    info: { role },
    parts: parts ?? [{ type: 'text', text: content }],
  };
}

describe('SnapshotExtractor', () => {
  let tempDir: string;
  let fsState: Map<string, string>;

  beforeEach(() => {
    tempDir = `/tmp/snapshot-extractor-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fsState = new Map();

    mockedExistsSync.mockImplementation((p: any) => fsState.has(p as string));
    mockedReadFileSync.mockImplementation((p: any) => {
      const path = p as string;
      if (!fsState.has(path)) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
        (err as any).code = 'ENOENT';
        throw err;
      }
      return fsState.get(path)!;
    });
    mockedWriteFileSync.mockImplementation((p: any, data: any) => {
      fsState.set(p as string, data as string);
    });
    mockedRenameSync.mockImplementation((from: any, to: any) => {
      const data = fsState.get(from as string);
      if (data !== undefined) {
        fsState.set(to as string, data);
        fsState.delete(from as string);
      }
    });
    mockedMkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function getSnapshot(sessionId: string, workflowId?: string): any {
    const suffix = workflowId ? `_${workflowId}` : '';
    const key = `${sessionId}${suffix}_snapshot`;
    const filePath = `${tempDir}/${key}.json`;
    const content = fsState.get(filePath);
    if (!content) throw new Error(`Snapshot not found at ${filePath}`);
    return JSON.parse(content);
  }

  it('should_produce_valid_snapshot_json', async () => {
    const messages = [
      buildMessage('hello', 'user'),
      buildMessage('hi there', 'assistant'),
    ];
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);
    const sessionId = 'session-abc';
    const focusHint = 'last 50 messages';

    const filePath = await extractor.extract(client, sessionId, focusHint);

    expect(filePath).toContain(sessionId);
    const snapshot = getSnapshot(sessionId);
    expect(snapshot.version).toBe(1);
    expect(snapshot.source).toBe('bridge-plugin-sdk');
    expect(snapshot.session_id).toBe(sessionId);
    expect(typeof snapshot.extracted_at).toBe('string');
    expect(snapshot.focus).toBe(focusHint);
    expect(snapshot.total_messages).toBe(2);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[0].role).toBe('user');
    expect(snapshot.messages[0].content).toBe('hello');
    expect(snapshot.messages[1].role).toBe('assistant');
    expect(snapshot.messages[1].content).toBe('hi there');
  });

  it('should_truncate_message_content_at_4000_chars', async () => {
    const longContent = 'a'.repeat(5000);
    const messages = [buildMessage(longContent, 'user')];
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-1');

    const snapshot = getSnapshot('session-1');
    expect(snapshot.messages[0].content).toHaveLength(4000);
    expect(snapshot.messages[0].content).toBe('a'.repeat(4000));
  });

  it('should_limit_messages_to_200', async () => {
    const messages = Array.from({ length: 250 }, (_, i) =>
      buildMessage(`msg ${i}`, i % 2 === 0 ? 'user' : 'assistant'),
    );
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-2', 'last 50 messages', 250);

    const snapshot = getSnapshot('session-2');
    expect(snapshot.messages).toHaveLength(200);
    expect(snapshot.total_messages).toBe(200);
  });

  it('should_write_snapshot_via_state_store_atomic_write', async () => {
    const client = createMockClient([buildMessage('test', 'user')]);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-3');

    // StateStore.write does: mkdirSync + writeFileSync(tmp) + renameSync(tmp, final)
    const snapshotKey = 'session-3_snapshot';
    const tmpPath = `${tempDir}/${snapshotKey}.json.tmp`;
    const finalPath = `${tempDir}/${snapshotKey}.json`;

    expect(fsState.has(finalPath)).toBe(true);
    expect(fsState.has(tmpPath)).toBe(false);
  });

  it('should_detect_snapshot_exists_and_return_path', () => {
    const extractor = new SnapshotExtractor(tempDir);

    // Missing snapshot
    expect(extractor.snapshotExists('missing')).toBe(false);
    expect(extractor.snapshotPath('missing')).toBeNull();

    // Existing snapshot
    const sessionId = 'existing';
    const filePath = `${tempDir}/${sessionId}_snapshot.json`;
    fsState.set(filePath, JSON.stringify({ version: 1 }));

    expect(extractor.snapshotExists(sessionId)).toBe(true);
    expect(extractor.snapshotPath(sessionId)).toBe(filePath);

    // With workflowId
    const wfFilePath = `${tempDir}/${sessionId}_wf1_snapshot.json`;
    fsState.set(wfFilePath, JSON.stringify({ version: 1 }));
    expect(extractor.snapshotExists(sessionId, 'wf1')).toBe(true);
    expect(extractor.snapshotPath(sessionId, 'wf1')).toBe(wfFilePath);
  });

  it('should_filter_to_user_and_assistant_roles', async () => {
    const messages = [
      buildMessage('user msg', 'user'),
      buildMessage('tool msg', 'tool'),
      buildMessage('assistant msg', 'assistant'),
      buildMessage('system msg', 'system'),
    ];
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-7');

    const snapshot = getSnapshot('session-7');
    const roles = snapshot.messages.map((m: any) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(roles).not.toContain('tool');
    expect(roles).not.toContain('system');
  });

  it('should_handle_message_with_missing_parts_gracefully', async () => {
    const messages = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'with parts' }] },
      { info: { role: 'user' }, parts: undefined as any },
    ];
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-8');

    const snapshot = getSnapshot('session-8');
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].content).toBe('with parts');
  });

  it('should_handle_empty_session_gracefully', async () => {
    const client = createMockClient([]);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-9');

    const snapshot = getSnapshot('session-9');
    expect(snapshot.total_messages).toBe(0);
    expect(snapshot.messages).toHaveLength(0);
  });

  it('should_use_custom_focusHint_in_snapshot', async () => {
    const client = createMockClient([buildMessage('hello', 'user')]);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-10', 'custom hint');

    const snapshot = getSnapshot('session-10');
    expect(snapshot.focus).toBe('custom hint');
  });

  it('should_cap_limit_at_200_even_when_higher', async () => {
    const messages = Array.from({ length: 250 }, (_, i) =>
      buildMessage(`msg ${i}`, 'user'),
    );
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-11', 'last 50 messages', 300);

    const snapshot = getSnapshot('session-11');
    expect(snapshot.messages).toHaveLength(200);
  });

  it('should_reuse_core_cache_when_available', async () => {
    const sessionId = 'session-cache';
    const cachedMessages = [
      buildMessage('cached msg', 'user'),
      buildMessage('cached reply', 'assistant'),
    ];

    // Pre-populate core cache file
    const cacheFilePath = `${tempDir}/${sessionId}.json`;
    fsState.set(cacheFilePath, JSON.stringify(cachedMessages));

    const client = createMockClient([]); // API returns empty, but cache should be used
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, sessionId);

    // API should NOT be called because core cache is hit
    expect(client.session.messages).not.toHaveBeenCalled();

    const snapshot = getSnapshot(sessionId);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[0].content).toBe('cached msg');
    expect(snapshot.messages[1].content).toBe('cached reply');
  });

  it('should_handle_api_errors_gracefully', async () => {
    const client = {
      session: {
        messages: vi.fn().mockRejectedValue(new Error('API error')),
      },
    };
    const extractor = new SnapshotExtractor(tempDir);

    await expect(
      extractor.extract(client, 'session-err'),
    ).rejects.toThrow('API error');
  });
});
