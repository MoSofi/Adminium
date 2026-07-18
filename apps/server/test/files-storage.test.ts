/**
 * Local file storage (M7-T07, files/storage.ts): sha256/size on write, the
 * incremental writer, and the fail-closed storage-key guard.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { newId } from '@adminium/meta';

import { FileStorageError, createFileStorage, isSafeStorageKey } from '../src/files/storage.js';

const dataDir = mkdtempSync(join(tmpdir(), 'adminium-files-'));
const storage = createFileStorage({ dataDir });

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function readAll(key: string): Promise<string> {
  const stream = await storage.read(key);
  stream.setEncoding('utf8');
  let out = '';
  for await (const chunk of stream) out += chunk as string;
  return out;
}

describe('createFileStorage', () => {
  it('writes bytes under <dataDir>/files/<id> with sha256 + size', async () => {
    const key = newId('file');
    const written = await storage.write(key, 'hello world');
    expect(written.sizeBytes).toBe(11);
    expect(written.sha256).toBe(createHash('sha256').update('hello world').digest('hex'));
    expect(await readAll(key)).toBe('hello world');
    expect(await storage.size(key)).toBe(11);
  });

  it('openWriter accumulates size + sha256 across chunks', async () => {
    const key = newId('file');
    const writer = await storage.openWriter(key);
    await writer.write('chunk one\n');
    await writer.write(Buffer.from('chunk two', 'utf8'));
    const written = await writer.close();
    expect(written.sizeBytes).toBe('chunk one\nchunk two'.length);
    expect(written.sha256).toBe(createHash('sha256').update('chunk one\nchunk two').digest('hex'));
    expect(await readAll(key)).toBe('chunk one\nchunk two');
  });

  it('abort removes the partial artifact', async () => {
    const key = newId('file');
    const writer = await storage.openWriter(key);
    await writer.write('partial');
    await writer.abort();
    await expect(storage.read(key)).rejects.toThrow(FileStorageError);
  });

  it('remove is idempotent; reading missing bytes throws', async () => {
    const key = newId('file');
    await storage.write(key, 'x');
    await storage.remove(key);
    await storage.remove(key);
    await expect(storage.read(key)).rejects.toThrow(FileStorageError);
  });

  it('fails closed on anything that is not a file_<ULID> key', async () => {
    for (const hostile of [
      '../adminium.json',
      'file_../../etc/passwd',
      'file_00000000000000000000000000/../x',
      'not-a-key',
      'usr_00000000000000000000000000', // wrong prefix
      '',
      'file_0000000000000000000000000O', // O outside the Crockford charset? (O excluded)
    ]) {
      expect(isSafeStorageKey(hostile), hostile).toBe(false);
      await expect(storage.write(hostile, 'x'), hostile).rejects.toThrow(FileStorageError);
      await expect(storage.read(hostile), hostile).rejects.toThrow(FileStorageError);
      await expect(storage.remove(hostile), hostile).rejects.toThrow(FileStorageError);
    }
  });
});
