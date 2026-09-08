// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `local` driver's fail-closed key guard, and the byte-identity claim
 * (37-files-and-storage.md D3, 37-T07).
 *
 * SUCCEEDS `files-storage.test.ts`, which tested `files/storage.ts` before wave
 * 0024 folded it into `drivers/local.ts`. The round-trip, incremental-writer
 * and idempotent-remove assertions it carried now live in the shared driver
 * contract (`helpers/file-driver-contract.ts`), which runs them against all
 * three drivers rather than one. What is kept HERE is the part that is
 * local-specific and must not be diluted into a contract every driver shares:
 *
 *  1. THE GRAMMAR IS THE GUARD. On a filesystem the key is a bare
 *     `file_<ULID>` — no separators, no dots, no traversal — and that is why
 *     nothing outside `<dataDir>/files` can be named. The remote drivers get a
 *     different guard because their keys are paths by design.
 *  2. BYTE IDENTITY. With no destination configured, a file still lands at
 *     `<dataDir>/files/<file_ULID>`, 0o600, with the same content — which is
 *     the claim that lets every pre-wave suite pass unchanged.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { newId } from '@adminium/meta';

import { FileDriverError } from '../src/files/drivers/driver.js';
import { createLocalDriver, FILES_DIR, isSafeStorageKey } from '../src/files/drivers/local.js';
import { createTestFileStore } from './helpers/file-store.js';

const dataDir = mkdtempSync(join(tmpdir(), 'adminium-files-'));
const root = join(dataDir, FILES_DIR);
const driver = createLocalDriver({ root });

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

async function readAll(key: string): Promise<string> {
  const { stream } = await driver.open(key);
  stream.setEncoding('utf8');
  let out = '';
  for await (const chunk of stream) out += chunk as string;
  return out;
}

describe('local driver — byte identity with no destination configured', () => {
  it('writes bytes at <dataDir>/files/<id>, 0o600, through the store', async () => {
    const store = createTestFileStore({ dataDir });
    const id = newId('file');
    const written = await store.write({ id, kind: 'export', filename: 'orders.csv', mime: 'text/csv', bytes: 'hello world' });

    // The row would say: local disk, key = the id. Exactly what it said before
    // wave 0024, which is the whole point of the implicit destination.
    expect(written.destinationId).toBeNull();
    expect(written.storage).toBe('local');
    expect(written.storageKey).toBe(id);
    expect(written.sizeBytes).toBe(11);
    expect(written.sha256).toBe(createHash('sha256').update('hello world').digest('hex'));

    expect(await readAll(id)).toBe('hello world');
    expect((await stat(join(root, id))).mode & 0o777).toBe(0o600);
    // …and the spool it passed through left nothing behind.
    expect(await readdir(join(dataDir, 'tmp'))).toEqual([]);
  });

  it('streams an incremental artifact to the same place', async () => {
    const store = createTestFileStore({ dataDir });
    const id = newId('file');
    const writer = await store.openWriter({ id, kind: 'export', filename: 'big.csv', mime: 'text/csv' });
    await writer.write('chunk one\n');
    await writer.write(Buffer.from('chunk two', 'utf8'));
    const written = await writer.close();

    expect(written.storageKey).toBe(id);
    expect(written.sha256).toBe(createHash('sha256').update('chunk one\nchunk two').digest('hex'));
    expect(await readAll(id)).toBe('chunk one\nchunk two');
  });

  it('abort leaves neither an artifact nor a spool file', async () => {
    const store = createTestFileStore({ dataDir });
    const id = newId('file');
    const writer = await store.openWriter({ id, kind: 'export', filename: 'x.csv', mime: 'text/csv' });
    await writer.write('partial');
    await writer.abort();

    expect(await driver.head(id)).toBeNull();
    expect(await readdir(join(dataDir, 'tmp'))).toEqual([]);
  });
});

describe('local driver — the grammar IS the guard', () => {
  it('fails closed on anything that is not a file_<ULID> key', async () => {
    const spool = join(dataDir, 'hostile-spool');
    await writeFile(spool, 'x');
    const source = { path: spool, sizeBytes: 1, mime: 'text/plain', sha256: 'a'.repeat(64) };

    for (const hostile of [
      '../adminium.json',
      'file_../../etc/passwd',
      'file_00000000000000000000000000/../x',
      'not-a-key',
      // A real prefix from another table: valid ULID grammar, wrong space.
      'usr_00000000000000000000000000',
      '',
      // I, L, O and U are not in the Crockford alphabet.
      'file_0000000000000000000000000O',
      'file_0000000000000000000000000I',
      // One character short, and one too long.
      'file_0000000000000000000000000',
      'file_000000000000000000000000000',
    ]) {
      expect(isSafeStorageKey(hostile), hostile).toBe(false);
      await expect(driver.put(hostile, source), hostile).rejects.toThrow(FileDriverError);
      await expect(driver.open(hostile), hostile).rejects.toThrow(FileDriverError);
      await expect(driver.head(hostile), hostile).rejects.toThrow(FileDriverError);
      await expect(driver.remove(hostile), hostile).rejects.toThrow(FileDriverError);
    }

    // Nothing escaped: the root holds only the artifacts the suite above wrote.
    for (const entry of await readdir(root)) expect(isSafeStorageKey(entry)).toBe(true);
  });

  it('accepts a well-formed id and only that', () => {
    expect(isSafeStorageKey(newId('file'))).toBe(true);
    expect(isSafeStorageKey(newId('exp'))).toBe(false);
  });
});

describe('local driver — a configured root is a normal destination', () => {
  it('honours an explicit root and keeps the same guard', async () => {
    const other = mkdtempSync(join(tmpdir(), 'adminium-files-alt-'));
    try {
      const alt = createLocalDriver({ root: other });
      const id = newId('file');
      const spool = join(dataDir, `alt-spool-${id}`);
      await writeFile(spool, 'elsewhere');
      await alt.put(id, { path: spool, sizeBytes: 9, mime: 'text/plain', sha256: 'b'.repeat(64) });

      expect(await readdir(other)).toEqual([id]);
      // The default root did not gain the file.
      expect(await readdir(root)).not.toContain(id);
      await expect(alt.head('../escape')).rejects.toThrow(FileDriverError);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
