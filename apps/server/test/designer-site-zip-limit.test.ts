// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The zip reader never lets an entry inflate past what it declares: zlib is asked for at most the
 * declared size, so a bomb stops at its first extra byte instead of filling memory first.
 */
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

const asked: number[] = [];
vi.mock('node:zlib', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:zlib')>();
  return {
    ...real,
    inflateRaw: (buffer: Buffer, options: { maxOutputLength?: number }, done: (error: Error | null, out?: Buffer) => void) => {
      asked.push(options.maxOutputLength ?? Number.POSITIVE_INFINITY);
      real.inflateRaw(buffer, options, done);
    },
  };
});

const { readZipDirectory, readZipEntry } = await import('../src/designer/site/zip.js');
const { makeZip } = await import('./zip-maker.js');

describe('an entry that inflates past what it declares', () => {
  it('is inflated with zlib told its declared size as the most it may give', async () => {
    const zip = makeZip([{ name: 'x.js', stored: deflateRawSync(Buffer.alloc(8 * 1024 * 1024)), size: 2048, crc: 0 }]);
    const entry = readZipDirectory(zip, 'bomb.zip')[0]!;
    await expect(readZipEntry(zip, entry, 'bomb.zip')).rejects.toMatchObject({ reason: 'ZIP_DAMAGED' });
    expect(asked).toEqual([2048]);
  });
});
