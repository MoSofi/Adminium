// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keeping a copy of an installed package off the local disk, and putting it
 * back.
 *
 * The real store is used on both sides: a copy that cannot be staged back
 * through the same hardened path every package goes through is not a copy, and
 * a fake store would not notice. Only the file store is stood in for, because
 * what it does — spool, hash, hand to a driver — is its own suite's subject.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InstalledManifest } from '@adminium/meta';

import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { createPackageCopies, type PackageCopies } from '../src/add-ons/package-copies.js';
import { packStagedTree } from '../src/add-ons/pack.js';

let root: string;
let store: AddOnStore;
let copies: PackageCopies;

/** The stand-in destination: an id-keyed map, which is all a driver is here. */
let objects: Map<string, Buffer>;
let rows: Map<string, { id: string; storageKey: string; destinationId: string | null; deletedAt: number | null }>;
let destinationId: string | null;
let recorded: Array<{ id: string; copy: { fileId: string; integrity: string } | null }>;
let logs: Array<{ level: string; message: string }>;

const MANIFEST = { kind: 'add-on', manifestVersion: 1, key: 'render-kit', name: 'Render', version: '1.0.0' };

function installed(over: Partial<InstalledManifest['row']> = {}): InstalledManifest {
  return {
    row: {
      id: 'mft_01',
      manifestKey: 'render-kit',
      version: '1.0.0',
      kind: 'add-on',
      source: 'marketplace',
      manifest: MANIFEST,
      licenseKeyEncrypted: null,
      connectionId: null,
      status: 'installed',
      packageIntegrity: null,
      packageFileId: null,
      installedBy: null,
      installedAt: 0,
      updatedAt: 0,
      ...over,
    },
    document: MANIFEST,
    attachments: [],
  } as unknown as InstalledManifest;
}

/** Put a real staged tree in the store, the way an install would. */
async function stageTree(files: Record<string, string>): Promise<void> {
  const dir = await mkdtemp(join(root, 'src-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  const { tarball } = await packStagedTree(dir);
  await store.stage({
    key: 'render-kit',
    version: '1.0.0',
    tarball,
    expectedIntegrity: sha512Integrity(tarball),
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'package-copies-'));
  store = createAddOnStore({ dataDir: join(root, 'data') });
  objects = new Map();
  rows = new Map();
  destinationId = 'dst_remote';
  recorded = [];
  logs = [];

  copies = createPackageCopies({
    files: {
      defaultDestinationId: async () => destinationId,
      /*
       * BYTES ONLY, exactly like the real `FileStore.write`, which does NOT
       * create the `adminium_files` row — the caller does. An earlier version
       * of this fake created it too, which made `keep` look correct while it
       * was writing bytes nothing could ever find again. The two-boot test
       * caught that; this fake now refuses to hide it.
       */
      write: async ({ id, bytes }: { id: string; bytes: Buffer | string }) => {
        objects.set(id, Buffer.from(bytes as Buffer));
        return {
          storageKey: id,
          sizeBytes: Buffer.from(bytes as Buffer).byteLength,
          sha256: '',
          destinationId,
          storage: 'fake',
        };
      },
      read: async (file: { storageKey: string }) => {
        const bytes = objects.get(file.storageKey);
        if (bytes === undefined) throw new Error('no such object');
        const { Readable } = await import('node:stream');
        return Readable.from([bytes]);
      },
    } as never,
    filesRepo: {
      create: async (input: { id?: string; storageKey?: string }) => {
        const id = input.id as string;
        rows.set(id, { id, storageKey: input.storageKey ?? id, destinationId, deletedAt: null });
        return { id };
      },
      findById: async (id: string) => rows.get(id) ?? null,
    } as never,
    manifests: {
      setPackageCopy: async (id: string, copy: { fileId: string; integrity: string } | null) => {
        recorded.push({ id, copy });
      },
    } as never,
    storeFor: (kind) => (kind === 'add-on' ? store : null),
    log: (level, message) => logs.push({ level, message }),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('keeping a copy', () => {
  it('packs the staged tree, writes it and records both halves', async () => {
    await stageTree({ 'manifest.json': JSON.stringify(MANIFEST), 'dist/server.js': 'export default {};\n' });

    const kept = await copies.keep(installed());

    expect(kept?.fileCount).toBe(2);
    expect(kept?.integrity).toMatch(/^sha512-/);
    expect(objects.size).toBe(1);
    // Both columns, in one write: half a copy cannot be acted on.
    expect(recorded).toEqual([{ id: 'mft_01', copy: { fileId: kept?.fileId, integrity: kept?.integrity } }]);
  });

  it('keeps nothing when the only destination is the disk being emptied', async () => {
    await stageTree({ 'manifest.json': JSON.stringify(MANIFEST) });
    destinationId = null;

    expect(await copies.keep(installed())).toBeNull();
    // Nothing written and nothing RECORDED: a fingerprint here would claim the
    // package is protected by a copy that dies with the original.
    expect(objects.size).toBe(0);
    expect(recorded).toEqual([]);
  });

  it('skips a package that already has a copy, so the boot pass is cheap', async () => {
    await stageTree({ 'manifest.json': JSON.stringify(MANIFEST) });
    const already = installed({ packageFileId: 'file_01', packageIntegrity: 'sha512-x' });

    expect(await copies.keep(already)).toBeNull();
    expect(objects.size).toBe(0);
  });

  it('keeps nothing for a package whose files are already gone', async () => {
    // The wiped-volume case. This row needs RESTORING, not keeping, and the
    // pass must walk past it rather than fail the boot.
    expect(await copies.keep(installed())).toBeNull();
    expect(recorded).toEqual([]);
    expect(logs.some((l) => l.level === 'info' && /no staged files/.test(l.message))).toBe(true);
  });
});

describe('restoring from a copy', () => {
  async function keepThenWipe(): Promise<InstalledManifest> {
    await stageTree({ 'manifest.json': JSON.stringify(MANIFEST), 'dist/server.js': 'export default {};\n' });
    const kept = await copies.keep(installed());
    await store.removeKey('render-kit');
    expect(await store.versions('render-kit')).toEqual([]);
    return installed({ packageFileId: kept?.fileId ?? null, packageIntegrity: kept?.integrity ?? null });
  }

  it('stages the package back, byte for byte', async () => {
    const row = await keepThenWipe();

    expect(await copies.restore(row)).toBe(true);

    expect(await store.versions('render-kit')).toEqual(['1.0.0']);
    const served = await store.readFile('render-kit', '1.0.0', 'dist/server.js');
    expect(served.toString('utf8')).toBe('export default {};\n');
  });

  it('refuses a SWAPPED copy \u2014 a valid package that is not the recorded one', async () => {
    const row = await keepThenWipe();

    /*
     * Deliberately a well-formed tarball rather than rubbish. Rubbish is caught
     * by the archive reader and proves nothing about the fingerprint; a valid
     * package with different contents is caught ONLY by comparing against what
     * the meta row recorded, which is the property under test. The destination
     * is shared, writable storage, and this is what stops its contents being
     * re-trusted on the way back in.
     */
    const evil = await mkdtemp(join(root, 'evil-'));
    await writeFile(join(evil, 'manifest.json'), JSON.stringify(MANIFEST), 'utf8');
    await mkdir(join(evil, 'dist'), { recursive: true });
    await writeFile(join(evil, 'dist/server.js'), 'globalThis.pwned = true;\n', 'utf8');
    const swapped = await packStagedTree(evil);
    const [id] = [...objects.keys()];
    objects.set(id as string, Buffer.from(swapped.tarball));

    expect(await copies.restore(row)).toBe(false);
    expect(await store.versions('render-kit')).toEqual([]);
    expect(logs.some((l) => l.level === 'error' && /could not restore/.test(l.message))).toBe(true);
  });

  it('refuses bytes that are not an archive at all', async () => {
    const row = await keepThenWipe();
    const [id] = [...objects.keys()];
    objects.set(id as string, Buffer.from('not a tarball at all'));

    expect(await copies.restore(row)).toBe(false);
    expect(await store.versions('render-kit')).toEqual([]);
  });

  it('says so when no copy is held', async () => {
    expect(await copies.restore(installed())).toBe(false);
    expect(logs.some((l) => l.level === 'error' && /no copy of this package is held/.test(l.message))).toBe(true);
  });

  it('says so when the copy is gone from the library', async () => {
    const row = await keepThenWipe();
    rows.clear();

    expect(await copies.restore(row)).toBe(false);
    expect(logs.some((l) => l.level === 'error' && /gone from the file library/.test(l.message))).toBe(true);
  });

  it('round-trips a tree with a file whose length is not a block multiple', async () => {
    await stageTree({ 'manifest.json': JSON.stringify(MANIFEST), 'dist/odd.bin': 'x'.repeat(513) });
    const kept = await copies.keep(installed());
    await store.removeKey('render-kit');

    expect(
      await copies.restore(
        installed({ packageFileId: kept?.fileId ?? null, packageIntegrity: kept?.integrity ?? null }),
      ),
    ).toBe(true);
    const back = await store.readFile('render-kit', '1.0.0', 'dist/odd.bin');
    expect(back.byteLength).toBe(513);
  });
});
