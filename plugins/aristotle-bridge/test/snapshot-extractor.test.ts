import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotExtractor } from '../src/snapshot-extractor.js';

vi.mock('node:fs');
vi.mock('node:path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}));

import { existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedRenameSync = vi.mocked(renameSync);
const mockedExistsSync = vi.mocked(existsSync);
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

  beforeEach(() => {
    tempDir = `/tmp/snapshot-extractor-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mockedExistsSync.mockReturnValue(false);
    mockedWriteFileSync.mockReturnValue(undefined);
    mockedRenameSync.mockReturnValue(undefined);
    mockedMkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should_produce_valid_snapshot_json', async () => {
    const messages = [
      buildMessage('hello', 'user'),
      buildMessage('hi there', 'assistant'),
    ];
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);
    const sessionId = 'session-abc';
    const focusHint = 'last 50 messages';

    await extractor.extract(client, sessionId, focusHint);

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const call = mockedWriteFileSync.mock.calls[0];
    const filePath = call[0] as string;
    const snapshot = JSON.parse(call[1] as string);

    expect(filePath).toContain(sessionId);
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

    const call = mockedWriteFileSync.mock.calls[0];
    const snapshot = JSON.parse(call[1] as string);

    expect(snapshot.messages[0].content).toHaveLength(4000);
    expect(snapshot.messages[0].content).toBe('a'.repeat(4000));
  });

  it('should_limit_messages_to_200', async () => {
    const messages = Array.from({ length: 250 }, (_, i) =>
      buildMessage(`msg ${i}`, i % 2 === 0 ? 'user' : 'assistant'),
    );
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-2');

    const call = mockedWriteFileSync.mock.calls[0];
    const snapshot = JSON.parse(call[1] as string);

    expect(snapshot.messages).toHaveLength(200);
    expect(snapshot.total_messages).toBe(200);
  });

  it('should_write_via_tmp_file_and_rename', async () => {
    const client = createMockClient([buildMessage('test', 'user')]);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-3');

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockedRenameSync).toHaveBeenCalledTimes(1);

    const writePath = mockedWriteFileSync.mock.calls[0][0] as string;
    const renameFrom = mockedRenameSync.mock.calls[0][0] as string;
    const renameTo = mockedRenameSync.mock.calls[0][1] as string;

    expect(writePath).toContain('.tmp');
    expect(writePath).toBe(renameFrom);
    expect(renameTo).not.toContain('.tmp');
    expect(renameTo).toContain('session-3');
  });

  it('should_return_true_when_snapshot_exists', () => {
    mockedExistsSync.mockReturnValue(true);
    const extractor = new SnapshotExtractor(tempDir);

    const result = extractor.snapshotExists('session-4');

    expect(result).toBe(true);
    expect(mockedExistsSync).toHaveBeenCalledWith(expect.stringContaining('session-4'));
  });

  it('should_return_false_when_snapshot_missing', () => {
    mockedExistsSync.mockReturnValue(false);
    const extractor = new SnapshotExtractor(tempDir);

    const result = extractor.snapshotExists('session-5');

    expect(result).toBe(false);
    expect(mockedExistsSync).toHaveBeenCalledWith(expect.stringContaining('session-5'));
  });

  it('should_use_custom_sessions_dir', async () => {
    const customDir = `/custom/sessions/${Date.now()}`;
    const client = createMockClient([buildMessage('hello', 'user')]);
    const extractor = new SnapshotExtractor(customDir);

    await extractor.extract(client, 'session-6');

    const call = mockedWriteFileSync.mock.calls[0];
    const filePath = call[0] as string;

    expect(filePath.startsWith(customDir)).toBe(true);
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

    const call = mockedWriteFileSync.mock.calls[0];
    const snapshot = JSON.parse(call[1] as string);

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

    const call = mockedWriteFileSync.mock.calls[0];
    const snapshot = JSON.parse(call[1] as string);

    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].content).toBe('with parts');
  });

  it('should_handle_empty_session_gracefully', async () => {
    const client = createMockClient([]);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-9');

    const call = mockedWriteFileSync.mock.calls[0];
    const snapshot = JSON.parse(call[1] as string);

    expect(snapshot.total_messages).toBe(0);
    expect(snapshot.messages).toHaveLength(0);
  });

  it('should_use_custom_focusHint_in_snapshot', async () => {
    const client = createMockClient([buildMessage('hello', 'user')]);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-10', 'custom hint');

    const call = mockedWriteFileSync.mock.calls[0];
    const snapshot = JSON.parse(call[1] as string);

    expect(snapshot.focus).toBe('custom hint');
  });

  it('should_cap_limit_at_200_even_when_higher', async () => {
    const messages = Array.from({ length: 250 }, (_, i) =>
      buildMessage(`msg ${i}`, 'user'),
    );
    const client = createMockClient(messages);
    const extractor = new SnapshotExtractor(tempDir);

    await extractor.extract(client, 'session-11', 'last 50 messages', 300);

    const call = mockedWriteFileSync.mock.calls[0];
    const snapshot = JSON.parse(call[1] as string);

    expect(snapshot.messages).toHaveLength(200);
  });
});
