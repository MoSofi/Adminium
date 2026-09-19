// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Packing a staged tree back into the tarball it arrived as.
 *
 * The claim that matters is the ROUND TRIP: what `packStagedTree` emits must
 * go back through the same hardened reader every real package goes through,
 * and come out as the same files. A writer that only satisfies its own tests
 * is how you get an archive this server cannot read back — and the reader
 * refuses long-name blocks and directory members, so "some tar tool accepts
 * it" is not the bar.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_ARCHIVE_LIMITS, readAddOnTarball } from '../src/add-ons/archive.js';
import { packStagedTree, PackError } from '../src/add-ons/pack.js';

// The REAL limits, not a hand-copied set: a writer proved against looser
// numbers than production uses has not been proved against production.
const LIMITS = DEFAULT_ARCHIVE_LIMITS;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'add-on-pack-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function tree(files: Record<string, string>): Promise<string> {
  const dir = join(root, 'pkg');
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  return dir;
}

describe('packStagedTree', () => {
  it('round-trips through the hardened reader with every file intact', async () => {
    const dir = await tree({
      'manifest.json': '{"kind":"add-on"}',
      'dist/server.js': 'export default {};\n',
      'dist/nested/deep/client.js': 'export const register = () => {};\n',
    });

    const { tarball, fileCount } = await packStagedTree(dir);
    expect(fileCount).toBe(3);

    const entries = readAddOnTarball(tarball, LIMITS);
    const byPath = new Map(entries.map((e) => [e.path, Buffer.from(e.bytes).toString('utf8')]));
    expect([...byPath.keys()].sort()).toEqual([
      'dist/nested/deep/client.js',
      'dist/server.js',
      'manifest.json',
    ]);
    expect(byPath.get('manifest.json')).toBe('{"kind":"add-on"}');
    expect(byPath.get('dist/server.js')).toBe('export default {};\n');
  });

  it('survives a file whose length is not a block multiple', async () => {
    // Padding is where a hand-written tar writer goes wrong: one byte off and
    // the next header lands at the wrong offset, which the reader reports as a
    // bad checksum rather than as anything that names the real cause.
    for (const size of [0, 1, 511, 512, 513, 1024]) {
      const dir = await tree({ 'manifest.json': '{}', 'blob.bin': 'x'.repeat(size) });
      const entries = readAddOnTarball((await packStagedTree(dir)).tarball, LIMITS);
      const blob = entries.find((e) => e.path === 'blob.bin');
      expect(blob?.bytes.byteLength, `size ${size}`).toBe(size);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('packs the same bytes twice, so a re-upload is a no-op not churn', async () => {
    const dir = await tree({ 'manifest.json': '{}', 'dist/a.js': 'a', 'dist/b.js': 'b' });
    const first = await packStagedTree(dir);
    const second = await packStagedTree(dir);
    // gzip stamps the current second by default, which would make a tree packed
    // either side of a tick hash apart.
    expect(Buffer.from(second.tarball).equals(Buffer.from(first.tarball))).toBe(true);
  });

  it('splits a long path across name and prefix, and the reader rejoins it', async () => {
    const deep = `${'a'.repeat(60)}/${'b'.repeat(60)}/file.js`;
    const dir = await tree({ 'manifest.json': '{}', [deep]: 'deep' });
    const entries = readAddOnTarball((await packStagedTree(dir)).tarball, LIMITS);
    expect(entries.map((e) => e.path)).toContain(deep);
  });

  it('refuses a path no ustar header can hold, rather than emitting one the reader will reject', async () => {
    // A single component longer than the name field cannot be split at a `/`.
    // Emitting a GNU long-name block would produce an archive this server's own
    // reader refuses, so the refusal belongs here where the path is known.
    const dir = await tree({ 'manifest.json': '{}', [`${'z'.repeat(120)}.js`]: 'x' });
    await expect(packStagedTree(dir)).rejects.toThrow(PackError);
    await expect(packStagedTree(dir)).rejects.toThrow(/does not fit a ustar header/);
  });

  it('refuses an empty tree, which is not a package', async () => {
    const dir = join(root, 'empty');
    await mkdir(dir, { recursive: true });
    await expect(packStagedTree(dir)).rejects.toThrow(/holds no files/);
  });

  it('refuses a file over the cap', async () => {
    const dir = await tree({ 'manifest.json': '{}', 'big.bin': 'x'.repeat(2048) });
    await expect(packStagedTree(dir, { maxFileBytes: 1024 })).rejects.toThrow(/is 2048 bytes/);
  });
});
