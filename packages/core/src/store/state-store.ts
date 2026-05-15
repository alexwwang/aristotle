import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';
import type { Logger } from '../logger.js';

export interface StateStore {
  read<T>(key: string): T | null;
  write<T>(key: string, value: T): void;
  appendLog(key: string, entry: unknown): void;
  readLog<T>(key: string): T[];
  list(prefix: string): string[];
}

function validateKey(key: string): void {
  if (key.includes('../') || key.includes('..\\')) {
    throw new Error(`Path traversal detected in key: ${key}`);
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function getFilePath(baseDir: string, key: string): string {
  const cleanKey = stripTrailingSlash(key).split('/').join(path.sep);
  return path.join(baseDir, `${cleanKey}.json`);
}

function getLogPath(baseDir: string, key: string): string {
  const cleanKey = stripTrailingSlash(key).split('/').join(path.sep);
  return path.join(baseDir, `${cleanKey}.jsonl`);
}

function listDir(
  baseDir: string,
  dirPath: string,
  result: string[],
  prefix: string,
): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return;
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isFile() &&
      (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')) &&
      !entry.name.endsWith('.tmp')
    ) {
      const relativePath = path.relative(
        baseDir,
        path.join(dirPath, entry.name),
      );
      const key = relativePath
        .replace(/\\/g, '/')
        .replace(/\.jsonl?$/, '');
      result.push(key);
    }
  }
}

export function createStateStore(
  baseDir: string,
  logger?: Logger,
): StateStore {
  const log = logger || createLogger('state-store', 'AGENT_PLATFORM_LOG');

  return {
    read<T>(key: string): T | null {
      validateKey(key);
      const filePath = getFilePath(baseDir, key);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as T;
      } catch {
        return null;
      }
    },

    write<T>(key: string, value: T): void {
      validateKey(key);
      const filePath = getFilePath(baseDir, key);
      const tmpPath = `${filePath}.tmp`;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(value));
        fs.renameSync(tmpPath, filePath);
      } catch (err) {
        log.error('Failed to write key %s: %s', key, String(err));
      }
    },

    appendLog(key: string, entry: unknown): void {
      validateKey(key);
      const logPath = getLogPath(baseDir, key);
      try {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
      } catch (err) {
        log.error('Failed to append log key %s: %s', key, String(err));
      }
    },

    readLog<T>(key: string): T[] {
      validateKey(key);
      const logPath = getLogPath(baseDir, key);
      try {
        const content = fs.readFileSync(logPath, 'utf-8').trim();
        if (!content) return [];
        return content.split('\n').map((line) => JSON.parse(line) as T);
      } catch {
        return [];
      }
    },

    list(prefix: string): string[] {
      if (prefix.includes('../') || prefix.includes('..\\')) {
        throw new Error(`Path traversal detected in prefix: ${prefix}`);
      }
      const normalized = stripTrailingSlash(prefix).split('/').join(path.sep);
      const dirPath = path.join(baseDir, normalized);
      const result: string[] = [];
      listDir(baseDir, dirPath, result, '');
      return result;
    },
  };
}
