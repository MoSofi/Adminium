// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The member-by-member reader a workspace file is read with: the same
 * members as the whole-archive reader, the same refusals, a member handed out
 * before the next is expanded, and the gzip footer still checked.
 */
import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARCHIVE_LIMITS, readAddOnTarball, tarballMembers, type ArchiveEntry } from '../src/add-ons/archive.js';
import { packageTarball } from './app-bundle-helpers.js';

async function all(bytes: Uint8Array, limits = DEFAULT_ARCHIVE_LIMITS): Promise<ArchiveEntry[]> {
  const out: ArchiveEntry[] = [];
  for await (const entry of tarballMembers(bytes, limits)) out.push(entry);
  return out;
}

async function refusal(bytes: Uint8Array, limits = DEFAULT_ARCHIVE_LIMITS): Promise<string | undefined> {
  try {
    await all(bytes, limits);
    return undefined;
  } catch (error) {
    return (error as { reason?: string }).reason;
  }
}

describe('tarballMembers', () => {
  it('reads the same members as the whole-archive reader', async () => {
    const big = new Uint8Array(300_000).map((_, i) => (i * 7919) % 251);
    const tarball = packageTarball({ 'manifest.json': '{"key":"a"}', 'apps/a-1.0.0.tgz': big, 'workspace.json': '{}' });
    const whole = readAddOnTarball(tarball);
    const streamed = await all(tarball);
    expect(streamed.map((entry) => entry.path)).toEqual(whole.map((entry) => entry.path));
    for (const [n, entry] of streamed.entries()) expect(Buffer.from(entry.bytes).equals(Buffer.from(whole[n]!.bytes))).toBe(true);
  });

  it('hands out a member before the rest is expanded', async () => {
    const tarball = packageTarball({ 'a.txt': 'first', 'b.bin': new Uint8Array(2_000_000).map((_, i) => i % 13) });
    const reader = tarballMembers(tarball);
    const first = await reader.next();
    expect(first.value?.path).toBe('a.txt');
    await reader.return(undefined);
  });

  it('refuses what the whole-archive reader refuses', async () => {
    expect(await refusal(new TextEncoder().encode('not gzip'))).toBe('NOT_GZIP');
    const tarball = packageTarball({ 'a.txt': 'aaaa', 'b.txt': 'bbbb', 'c.txt': 'cccc' });
    expect(await refusal(tarball, { ...DEFAULT_ARCHIVE_LIMITS, maxEntries: 2 })).toBe('TOO_MANY_ENTRIES');
    expect(await refusal(tarball, { ...DEFAULT_ARCHIVE_LIMITS, maxEntryBytes: 3 })).toBe('ENTRY_TOO_LARGE');
    expect(await refusal(tarball, { ...DEFAULT_ARCHIVE_LIMITS, maxCompressedBytes: 10 })).toBe('COMPRESSED_TOO_LARGE');
    const bomb = gzipSync(new Uint8Array(4 * 1024 * 1024));
    expect(await refusal(bomb, { ...DEFAULT_ARCHIVE_LIMITS, maxUncompressedBytes: 1024 * 1024 })).toBe('UNCOMPRESSED_TOO_LARGE');
  });

  it('checks the gzip footer at the end', async () => {
    const tarball = packageTarball({ 'a.txt': 'hello' });
    const broken = new Uint8Array(tarball);
    broken[broken.length - 8] = broken[broken.length - 8]! ^ 0xff;
    expect(await refusal(broken)).toBe('CORRUPT_GZIP');
  });

  it('refuses a path outside the package', async () => {
    expect(await refusal(packageTarball({ '../x': 'no' }))).toBe('PATH_TRAVERSAL');
  });
});
