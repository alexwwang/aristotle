import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStateStore } from '../src/store/state-store.js';
import type { Logger } from '../src/logger.js';

describe('StateStore', () => {
  let tmpDir: string;
  let store: ReturnType<typeof createStateStore>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-store-test-'));
    store = createStateStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // SS-01: Write and read back a JSON object
  it('SS-01 should write and read back a JSON object', () => {
    store.write('role/scope/item', { foo: 'bar', num: 42 });
    const result = store.read('role/scope/item');
    expect(result).toEqual({ foo: 'bar', num: 42 });
  });

  // SS-02: Read non-existent key returns null
  it('SS-02 should return null for non-existent key', () => {
    const result = store.read('non/existent/key');
    expect(result).toBeNull();
  });

  // SS-03: Write overwrites previous value
  it('SS-03 should overwrite previous value', () => {
    store.write('role/item', { v: 1 });
    store.write('role/item', { v: 2 });
    const result = store.read('role/item');
    expect(result).toEqual({ v: 2 });
  });

  // SS-04: Write handles nested objects
  it('SS-04 should handle nested objects', () => {
    const nested = { a: { b: { c: [1, 2, 3] } }, d: 'hello' };
    store.write('role/nested', nested);
    const result = store.read('role/nested');
    expect(result).toEqual(nested);
  });

  // SS-05: Keys from different roles are isolated
  it('SS-05 should isolate keys from different roles', () => {
    store.write('roleA/item', { role: 'A' });
    store.write('roleB/item', { role: 'B' });
    expect(store.read('roleA/item')).toEqual({ role: 'A' });
    expect(store.read('roleB/item')).toEqual({ role: 'B' });
  });

  // SS-06: Atomic write uses tmp-then-rename
  it('SS-06 should use tmp-then-rename for atomic write', () => {
    const renameSpy = vi.spyOn(fs, 'renameSync');
    store.write('role/atomic', { data: true });
    expect(renameSpy).toHaveBeenCalledTimes(1);
    const [src, dest] = renameSpy.mock.calls[0];
    expect(String(src)).toMatch(/\.tmp$/);
    expect(String(dest)).not.toMatch(/\.tmp$/);
    renameSpy.mockRestore();
  });

  // SS-07: No .tmp file left after successful write
  it('SS-07 should not leave .tmp file after successful write', () => {
    store.write('role/item', { data: true });
    const dir = path.join(tmpDir, 'role');
    const files = fs.readdirSync(dir);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  // SS-08: Stale .tmp file from crashed write does not block next write
  it('SS-08 should not be blocked by stale .tmp file', () => {
    const filePath = path.join(tmpDir, 'role', 'item.json');
    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, '{"stale":true}');
    store.write('role/item', { fresh: true });
    expect(store.read('role/item')).toEqual({ fresh: true });
  });

  // SS-09: Read after stale .tmp + missing final file returns null
  it('SS-09 should return null when only .tmp exists', () => {
    const filePath = path.join(tmpDir, 'role', 'item.json');
    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, '{"stale":true}');
    const result = store.read('role/item');
    expect(result).toBeNull();
  });

  // SS-10: AppendLog creates file on first write
  it('SS-10 should create file on first appendLog', () => {
    store.appendLog('role/log', { event: 'start' });
    const logPath = path.join(tmpDir, 'role', 'log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
  });

  // SS-11: AppendLog appends, not overwrites
  it('SS-11 should append entries to jsonl file', () => {
    store.appendLog('role/log', { n: 1 });
    store.appendLog('role/log', { n: 2 });
    store.appendLog('role/log', { n: 3 });
    const logPath = path.join(tmpDir, 'role', 'log.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
  });

  // SS-12: AppendLog entries are valid JSON
  it('SS-12 should write valid JSON entries in jsonl', () => {
    const entries = [{ a: 1 }, { b: 2 }, { c: [3, 4] }];
    for (const entry of entries) {
      store.appendLog('role/log', entry);
    }
    const logPath = path.join(tmpDir, 'role', 'log.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    expect(lines.map((l) => JSON.parse(l))).toEqual(entries);
  });

  // SS-13: AppendLog handles concurrent appends without corruption
  it('SS-13 should handle concurrent appends', () => {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          store.appendLog('role/concurrent', { i });
          resolve();
        }),
      );
    }
    Promise.all(promises);
    const logPath = path.join(tmpDir, 'role', 'concurrent.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').trimEnd().split('\n');
    expect(lines).toHaveLength(20);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  // SS-14: Read handles corrupted JSON file gracefully
  it('SS-14 should return null for corrupted JSON', () => {
    const filePath = path.join(tmpDir, 'role', 'corrupt.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not valid json {');
    const result = store.read('role/corrupt');
    expect(result).toBeNull();
  });

  // SS-15: Write to read-only directory logs error, does not crash
  it('SS-15 should log error on write to read-only dir', () => {
    const errors: string[] = [];
    const mockLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (fmt, ...args) => {
        errors.push(
          typeof fmt === 'string' ? fmt.replace(/%s/g, () => String(args.shift())) : String(fmt),
        );
      },
    };
    const readOnlyDir = path.join(tmpDir, 'readonly');
    fs.mkdirSync(readOnlyDir, { recursive: true });
    fs.chmodSync(readOnlyDir, 0o555);
    const s = createStateStore(readOnlyDir, mockLogger);
    s.write('role/item', { data: true });
    fs.chmodSync(readOnlyDir, 0o755);
    expect(errors.length).toBeGreaterThan(0);
  });

  // SS-16: should_list_json_and_jsonl_files_matching_prefix
  it('SS-16 should list json and jsonl files matching prefix', () => {
    store.write('role/scope/a', { n: 1 });
    store.write('role/scope/b', { n: 2 });
    store.appendLog('role/scope/c', { n: 3 });
    const result = store.list('role/scope');
    expect(result.sort()).toEqual(['role/scope/a', 'role/scope/b', 'role/scope/c']);
  });

  // SS-17: should_list_ignore_tmp_and_subdirs
  it('SS-17 should ignore .tmp files and subdirs', () => {
    store.write('role/scope/a', { n: 1 });
    const tmpFile = path.join(tmpDir, 'role', 'scope', 'stale.json.tmp');
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
    fs.writeFileSync(tmpFile, '{}');
    fs.mkdirSync(path.join(tmpDir, 'role', 'scope', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'role', 'scope', 'sub', 'deep.json'), '{}');
    const result = store.list('role/scope');
    expect(result).toEqual(['role/scope/a']);
  });

  // SS-18: should_list_return_empty_for_nonexistent_dir
  it('SS-18 should return empty for nonexistent directory', () => {
    const result = store.list('nonexistent/path');
    expect(result).toEqual([]);
  });

  // SS-19: should_list_treat_trailing_slash_as_idempotent
  it('SS-19 should treat trailing slash as idempotent', () => {
    store.write('role/scope/item', { n: 1 });
    const resultWithSlash = store.list('role/scope/');
    const resultWithoutSlash = store.list('role/scope');
    expect(resultWithSlash).toEqual(resultWithoutSlash);
  });

  // SS-20: should_reject_path_traversal_in_key
  it('SS-20 should reject path traversal in key', () => {
    expect(() => store.read('role/../evil')).toThrow('Path traversal');
    expect(() => store.write('role/../evil', {})).toThrow('Path traversal');
    expect(() => store.appendLog('role/../evil', {})).toThrow('Path traversal');
  });

  // SS-21: should_reject_path_traversal_in_list_prefix
  it('SS-21 should reject path traversal in list prefix', () => {
    expect(() => store.list('role/../evil')).toThrow('Path traversal');
  });

  // SS-22: should_log_error_and_not_crash_on_write_failure
  it('SS-22 should log error and not crash on write failure', () => {
    const errors: string[] = [];
    const mockLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (fmt, ...args) => {
        errors.push(
          typeof fmt === 'string' ? fmt.replace(/%s/g, () => String(args.shift())) : String(fmt),
        );
      },
    };
    const writeSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => {
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      });
    const s = createStateStore(tmpDir, mockLogger);
    s.write('role/item', { data: true });
    writeSpy.mockRestore();
    expect(errors.length).toBeGreaterThan(0);
  });

  // SS-23: should_log_error_and_not_crash_on_appendLog_failure
  it('SS-23 should log error and not crash on appendLog failure', () => {
    const errors: string[] = [];
    const mockLogger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (fmt, ...args) => {
        errors.push(
          typeof fmt === 'string' ? fmt.replace(/%s/g, () => String(args.shift())) : String(fmt),
        );
      },
    };
    const appendSpy = vi
      .spyOn(fs, 'appendFileSync')
      .mockImplementation(() => {
        throw new Error('disk full');
      });
    const s = createStateStore(tmpDir, mockLogger);
    s.appendLog('role/log', { event: 'x' });
    appendSpy.mockRestore();
    expect(errors.length).toBeGreaterThan(0);
  });

  // SS-24: readLog returns parsed JSONL entries
  it('SS-24 should read log entries written by appendLog', () => {
    store.appendLog('role/log', { n: 1 });
    store.appendLog('role/log', { n: 2 });
    const entries = store.readLog<{ n: number }>('role/log');
    expect(entries).toEqual([{ n: 1 }, { n: 2 }]);
  });

  // SS-25: readLog returns empty array for non-existent key
  it('SS-25 should return empty array for non-existent log key', () => {
    const entries = store.readLog('non/existent/log');
    expect(entries).toEqual([]);
  });

  // SS-26: readLog rejects path traversal
  it('SS-26 should reject path traversal in readLog', () => {
    expect(() => store.readLog('role/../evil')).toThrow('Path traversal');
  });
});
