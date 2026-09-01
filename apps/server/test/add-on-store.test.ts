// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-on package store (32-add-on-distribution.md §4.1, D11).
 *
 * These assert the store's own guarantees rather than the archive reader's
 * (`add-on-archive.test.ts` owns those): the path grammar, the atomic swap,
 * the tree pin that closes the stage-to-install TOCTOU window, the lifecycle
 * rules that differ between disable, uninstall and upgrade, and the bundled
 * seed's copy-if-absent behaviour.
 */

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identitySchema } from '@adminium/manifest';

import { AddOnArchiveError } from '../src/add-ons/archive.js';
import {
  AddOnStoreError,
  createAddOnStore,
  seedBundledPackages,
  sha512Integrity,
  TREE_PIN_SUFFIX,
  type AddOnStore,
} from '../src/add-ons/store.js';

const BLOCK = 512;

function put(block: Uint8Array, at: number, length: number, value: string): void {
  block.set(Buffer.from(value, 'latin1').subarray(0, length), at);
}

/** Builds a real npm-shaped tarball from `path -> content`. */
function packageTarball(files: Record<string, string>): Uint8Array {
  const members: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const header = new Uint8Array(BLOCK);
    put(header, 0, 100, `package/${path}`);
    put(header, 100, 8, '0000644\0');
    put(header, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(header, 136, 12, '00000000000\0');
    put(header, 156, 1, '0');
    put(header, 257, 6, 'ustar\0');
    put(header, 263, 2, '00');
    header.set(Buffer.from('        ', 'latin1'), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
    put(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);

    const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const member = new Uint8Array(BLOCK + body.length + padding);
    member.set(header, 0);
    member.set(body, BLOCK);
    members.push(member);
  }
  const out = new Uint8Array(members.reduce((n, m) => n + m.byteLength, 0) + BLOCK * 2);
  let at = 0;
  for (const member of members) {
    out.set(member, at);
    at += member.byteLength;
  }
  return gzipSync(out);
}

const GOOD_FILES = {
  'manifest.json': JSON.stringify({ kind: 'add-on', key: 'design-studio', version: '1.0.0' }),
  'package.json': JSON.stringify({ name: '@adminiumjs/add-on-design-studio' }),
  'dist/client.js': 'export const mount = () => {};',
  'README.md': '# Design Studio\n',
};

let dataDir: string;
let store: AddOnStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'adminium-add-ons-'));
  store = createAddOnStore({ dataDir });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Stages GOOD_FILES under `key@version` with a correct integrity value. */
async function stageGood(key = 'design-studio', version = '1.0.0', extra = {}) {
  const tarball = packageTarball({ ...GOOD_FILES, ...extra });
  return store.stage({
    key,
    version,
    tarball,
    expectedIntegrity: sha512Integrity(tarball),
  });
}

describe('store: path grammar fails closed', () => {
  const badKeys = [
    ['..', 'traversal'],
    ['../../etc', 'traversal with separators'],
    ['/etc/passwd', 'absolute'],
    ['Design-Studio', 'uppercase'],
    ['design_studio', 'underscore'],
    ['9lives', 'leading digit'],
    ['', 'empty'],
    ['.hidden', 'dotfile'],
  ] as const;

  for (const [key, why] of badKeys) {
    it(`refuses a ${why} key`, () => {
      expect(() => store.dirFor(key, '1.0.0')).toThrow(AddOnStoreError);
      expect(() => store.dirFor(key, '1.0.0')).toThrow(/unsafe add-on key/);
    });
  }

  const badVersions = [
    ['..', 'traversal'],
    ['../1.0.0', 'traversal with separators'],
    ['latest', 'a floating pointer'],
    ['1.0', 'a partial version'],
    ['v1.0.0', 'a v prefix'],
    ['01.0.0', 'a leading zero'],
  ] as const;

  for (const [version, why] of badVersions) {
    it(`refuses ${why} as a version`, () => {
      expect(() => store.dirFor('design-studio', version)).toThrow(/unsafe version/);
    });
  }

  it('accepts the shapes strict semver allows', () => {
    for (const version of ['1.0.0', '0.2.2', '1.0.0-rc.1', '1.0.0+build.7']) {
      expect(store.dirFor('design-studio', version)).toContain(version);
    }
  });

  it('keeps the key grammar in step with the manifest package', () => {
    // The store restates the grammar because it guards a path; this asserts the
    // restatement still matches the schema it mirrors.
    const identity = {
      name: 'Design Studio',
      version: '1.0.0',
      publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
      license: 'AGPL-3.0-only',
      description: { key: 'a.b', fallback: 'x' },
      // `identitySchema` carries the APP category list; add-ons have their own.
      // Irrelevant here — this asserts the KEY grammar, nothing else.
      categories: ['operations'],
    };
    for (const key of ['design-studio', 'ab', 'a1-b2']) {
      expect(identitySchema.safeParse({ ...identity, key }).success).toBe(true);
      expect(() => store.dirFor(key, '1.0.0')).not.toThrow();
    }
    for (const key of ['A', 'a_b', '1ab', 'a']) {
      expect(identitySchema.safeParse({ ...identity, key }).success).toBe(false);
      expect(() => store.dirFor(key, '1.0.0')).toThrow();
    }
  });

  it('refuses to read a file that escapes its package directory', async () => {
    await stageGood();
    await expect(store.readFile('design-studio', '1.0.0', '../../../etc/passwd')).rejects.toThrow(
      /escapes its directory/,
    );
  });
});

describe('store: staging', () => {
  it('unpacks a verified tarball into <key>/<version>/', async () => {
    const staged = await stageGood();
    expect(staged.dir).toBe(join(dataDir, 'add-ons', 'design-studio', '1.0.0'));
    const client = await store.readFile('design-studio', '1.0.0', 'dist/client.js');
    expect(client.toString('utf8')).toBe('export const mount = () => {};');
  });

  it('refuses a tarball whose hash does not match the expected integrity', async () => {
    const tarball = packageTarball(GOOD_FILES);
    const wrong = sha512Integrity(packageTarball({ ...GOOD_FILES, 'dist/client.js': 'other' }));
    await expect(
      store.stage({ key: 'design-studio', version: '1.0.0', tarball, expectedIntegrity: wrong }),
    ).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
  });

  it('refuses a bit-flipped tarball', async () => {
    const tarball = packageTarball(GOOD_FILES);
    const expectedIntegrity = sha512Integrity(tarball);
    const flipped = Uint8Array.from(tarball);
    flipped[flipped.length - 5] = flipped[flipped.length - 5]! ^ 0xff;
    await expect(
      store.stage({ key: 'design-studio', version: '1.0.0', tarball: flipped, expectedIntegrity }),
    ).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
  });

  it('refuses a package with no manifest.json and leaves nothing behind', async () => {
    const tarball = packageTarball({ 'dist/client.js': 'x' });
    await expect(
      store.stage({
        key: 'design-studio',
        version: '1.0.0',
        tarball,
        expectedIntegrity: sha512Integrity(tarball),
      }),
    ).rejects.toMatchObject({ reason: 'MANIFEST_MISSING' });
    expect(await store.keys()).toEqual([]);
    expect(await readdir(join(dataDir, 'add-ons'))).toEqual([]);
  });

  it('writes nothing at all when the archive is refused mid-unpack', async () => {
    // A hostile archive that passes the integrity check (the attacker computed
    // it) but is refused by the unpack hardening: the store root must be empty.
    const empty = gzipSync(new Uint8Array(BLOCK * 2));
    await expect(
      store.stage({
        key: 'design-studio',
        version: '1.0.0',
        tarball: empty,
        expectedIntegrity: sha512Integrity(empty),
      }),
    ).rejects.toBeInstanceOf(AddOnArchiveError);
    // Stronger than "the root is empty": the unpack is refused in memory, so
    // the store root is never even created for a hostile archive.
    await expect(readdir(join(dataDir, 'add-ons'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves no temp directory behind on success or failure', async () => {
    await stageGood();
    const bad = packageTarball({ 'dist/client.js': 'x' });
    await store
      .stage({
        key: 'other-thing',
        version: '1.0.0',
        tarball: bad,
        expectedIntegrity: sha512Integrity(bad),
      })
      .catch(() => undefined);
    const items = await readdir(join(dataDir, 'add-ons'));
    expect(items.filter((n) => n.startsWith('.staging-'))).toEqual([]);
  });

  it('replaces a re-staged version atomically rather than merging into it', async () => {
    await stageGood('design-studio', '1.0.0', { 'dist/extra.js': 'first' });
    await stageGood('design-studio', '1.0.0');
    await expect(store.readFile('design-studio', '1.0.0', 'dist/extra.js')).rejects.toThrow();
    // The tree pin agrees: no orphan from the previous staging survives.
    const tree = await store.verifyTree('design-studio', '1.0.0');
    expect(Object.keys(tree.files)).not.toContain('dist/extra.js');
  });

  it('records the tarball integrity and a per-file pin', async () => {
    const staged = await stageGood();
    expect(staged.tree.integrity).toMatch(/^sha512-/);
    expect(Object.keys(staged.tree.files)).toEqual([
      'README.md',
      'dist/client.js',
      'manifest.json',
      'package.json',
    ]);
    // The pin is a SIBLING of the tree, not a member of it.
    const onDisk = JSON.parse(
      await readFile(`${staged.dir}${TREE_PIN_SUFFIX}`, 'utf8'),
    ) as typeof staged.tree;
    expect(onDisk).toEqual(staged.tree);
    expect(await readdir(staged.dir)).not.toContain(`.adminium-tree.json`);
  });
});

describe('store: the tree pin closes the stage-to-install window', () => {
  it('verifies an untouched tree', async () => {
    const staged = await stageGood();
    await expect(store.verifyTree('design-studio', '1.0.0')).resolves.toMatchObject({
      integrity: staged.tree.integrity,
    });
  });

  it('refuses a tree whose file was modified after unpack', async () => {
    const staged = await stageGood();
    await writeFile(join(staged.dir, 'dist', 'client.js'), 'globalThis.pwned = true;');
    await expect(store.verifyTree('design-studio', '1.0.0')).rejects.toMatchObject({
      reason: 'TREE_MODIFIED',
    });
  });

  it('refuses a tree whose file was deleted after unpack', async () => {
    const staged = await stageGood();
    await rm(join(staged.dir, 'dist', 'client.js'));
    await expect(store.verifyTree('design-studio', '1.0.0')).rejects.toThrow(/missing/);
  });

  it('refuses an unpinned file that appeared beside the pinned ones', async () => {
    // The attack the per-file map alone would miss: nothing pinned changed, but
    // a new module was dropped in for the runtime to pick up.
    const staged = await stageGood();
    await writeFile(join(staged.dir, 'dist', 'backdoor.js'), 'export const x = 1;');
    await expect(store.verifyTree('design-studio', '1.0.0')).rejects.toThrow(/unpinned file/);
  });

  it('cannot be fooled by a package that ships its own pin file', async () => {
    // THE HOLE THIS FIX CLOSES. The pin used to live inside the tree, written
    // by the same unpack that wrote the files — so an archive carrying its own
    // `.adminium-tree.json` had its forgery recorded AS the pin, and the walk
    // that detects added files skipped that exact path. A package could vouch
    // for itself.
    const forged = JSON.stringify({
      key: 'design-studio',
      version: '1.0.0',
      integrity: 'sha512-forged',
      files: { 'manifest.json': 'deadbeef' },
    });
    const staged = await stageGood('design-studio', '1.0.0', {
      '.adminium-tree.json': forged,
      'dist/backdoor.js': 'globalThis.pwned = true;',
    });

    // The real pin sits outside and describes the real tree, backdoor included.
    const tree = await store.verifyTree('design-studio', '1.0.0');
    expect(tree.integrity).toBe(staged.tree.integrity);
    expect(tree.integrity).not.toBe('sha512-forged');
    expect(Object.keys(tree.files)).toContain('dist/backdoor.js');
    // And the shipped file is pinned like any other, not treated as metadata.
    expect(Object.keys(tree.files)).toContain('.adminium-tree.json');
  });

  it('refuses a pin that describes a different package', async () => {
    const a = await stageGood('design-studio', '1.0.0');
    await stageGood('shipping-dhl', '1.0.0');
    // Swap the pins: each now names the other's package.
    const pinA = `${a.dir}${TREE_PIN_SUFFIX}`;
    const pinB = `${store.dirFor('shipping-dhl', '1.0.0')}${TREE_PIN_SUFFIX}`;
    const rawB = await readFile(pinB, 'utf8');
    await writeFile(pinA, rawB);
    await expect(store.verifyTree('design-studio', '1.0.0')).rejects.toThrow(/claims to describe/);
  });

  it('refuses a pin that is not readable JSON', async () => {
    const staged = await stageGood();
    await writeFile(`${staged.dir}${TREE_PIN_SUFFIX}`, 'not json at all');
    await expect(store.verifyTree('design-studio', '1.0.0')).rejects.toMatchObject({
      reason: 'TREE_MODIFIED',
    });
  });

  it('refuses to verify a tree with no pin at all', async () => {
    const dir = store.dirFor('design-studio', '1.0.0');
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'manifest.json'), '{}');
    await expect(store.verifyTree('design-studio', '1.0.0')).rejects.toMatchObject({
      reason: 'TREE_MISSING',
    });
  });
});

describe('store: lifecycle', () => {
  it('lists keys and versions, newest first', async () => {
    await stageGood('design-studio', '1.0.0');
    await stageGood('design-studio', '1.0.1');
    await stageGood('shipping-dhl', '2.0.0');
    expect(await store.keys()).toEqual(['design-studio', 'shipping-dhl']);
    expect(await store.versions('design-studio')).toEqual(['1.0.1', '1.0.0']);
  });

  it('orders versions by the release triple, not lexicographically', async () => {
    // A `.sort().reverse()` puts 1.9.0 above 1.10.0 and 0.2.2 above 0.10.0, so
    // "the newest version on disk" was wrong for any package that reached a
    // double-digit minor or patch.
    for (const version of ['1.9.0', '1.10.0', '1.10.2', '0.2.2', '0.10.0', '2.0.0']) {
      await stageGood('design-studio', version);
    }
    expect(await store.versions('design-studio')).toEqual([
      '2.0.0',
      '1.10.2',
      '1.10.0',
      '1.9.0',
      '0.10.0',
      '0.2.2',
    ]);
  });

  it('sorts a pre-release below its own release', async () => {
    await stageGood('design-studio', '1.2.0');
    await stageGood('design-studio', '1.2.0-rc.1');
    expect(await store.versions('design-studio')).toEqual(['1.2.0', '1.2.0-rc.1']);
  });

  it('takes the pin with a discarded version', async () => {
    const staged = await stageGood('design-studio', '1.0.0');
    await store.removeVersion('design-studio', '1.0.0');
    await expect(readFile(`${staged.dir}${TREE_PIN_SUFFIX}`, 'utf8')).rejects.toThrow();
    expect(await store.versions('design-studio')).toEqual([]);
  });

  it('keeps the outgoing tree when a replacement fails mid-swap', async () => {
    // A bare rm-then-rename is two operations, and a failure between them used
    // to leave a working install DELETED with nothing to roll back to.
    await stageGood('design-studio', '1.0.0', { 'dist/original.js': 'the good one' });
    const empty = gzipSync(new Uint8Array(BLOCK * 2));
    await expect(
      store.stage({
        key: 'design-studio',
        version: '1.0.0',
        tarball: empty,
        expectedIntegrity: sha512Integrity(empty),
      }),
    ).rejects.toThrow();

    // The install that was already there is intact and still verifies.
    await expect(
      store.readFile('design-studio', '1.0.0', 'dist/original.js'),
    ).resolves.toBeDefined();
    await expect(store.verifyTree('design-studio', '1.0.0')).resolves.toBeDefined();
  });

  it('keeps the previous version when a newer one is staged (upgrade safety)', async () => {
    await stageGood('design-studio', '1.0.0');
    await stageGood('design-studio', '1.0.1');
    await expect(store.readFile('design-studio', '1.0.0', 'manifest.json')).resolves.toBeDefined();
  });

  it('removes one version without touching its siblings (staged discard)', async () => {
    await stageGood('design-studio', '1.0.0');
    await stageGood('design-studio', '1.0.1');
    await store.removeVersion('design-studio', '1.0.1');
    expect(await store.versions('design-studio')).toEqual(['1.0.0']);
  });

  it('removes the whole package directory (uninstall)', async () => {
    await stageGood('design-studio', '1.0.0');
    await stageGood('shipping-dhl', '1.0.0');
    await store.removeKey('design-studio');
    expect(await store.keys()).toEqual(['shipping-dhl']);
  });

  it('refuses to remove a key that is not a legal key', async () => {
    await expect(store.removeKey('../..')).rejects.toMatchObject({ reason: 'UNSAFE_KEY' });
  });

  it('reports no versions for a key that was never staged', async () => {
    expect(await store.versions('never-installed')).toEqual([]);
    expect(await store.keys()).toEqual([]);
  });

  it('prunes orphaned temp and superseded directories from an interrupted unpack', async () => {
    await mkdir(join(dataDir, 'add-ons', '.staging-design-studio-abc'), { recursive: true });
    await mkdir(join(dataDir, 'add-ons', '.staging-other-def'), { recursive: true });
    // A tree renamed aside for a replacement that never landed.
    await mkdir(join(dataDir, 'add-ons', '.replaced-design-studio-1.0.0-ff'), { recursive: true });
    await stageGood();
    expect(await store.pruneTemp()).toBe(3);
    expect(await store.pruneTemp()).toBe(0);
    // Real packages are untouched by the prune.
    expect(await store.keys()).toEqual(['design-studio']);
  });

  it('ignores directories that are not legal keys or versions when listing', async () => {
    await mkdir(join(dataDir, 'add-ons', 'Not_A_Key'), { recursive: true });
    await mkdir(join(dataDir, 'add-ons', 'design-studio', 'nonsense'), { recursive: true });
    await stageGood();
    expect(await store.keys()).toEqual(['design-studio']);
    expect(await store.versions('design-studio')).toEqual(['1.0.0']);
  });
});

describe('store: the bundled seed', () => {
  let bundleDir: string;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), 'adminium-bundle-'));
  });

  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
  });

  async function bundle(key: string, version: string, files = GOOD_FILES, integrity?: string) {
    const tarball = packageTarball(files);
    await writeFile(join(bundleDir, `${key}-${version}.tgz`), tarball);
    await writeFile(
      join(bundleDir, `${key}-${version}.tgz.integrity`),
      `${integrity ?? sha512Integrity(tarball)}\n`,
    );
  }

  it('seeds every bundled package on a fresh install', async () => {
    await bundle('design-studio', '1.0.0');
    await bundle('shipping-dhl', '1.0.0');
    const result = await seedBundledPackages(store, bundleDir);
    expect(result.seeded.sort()).toEqual(['design-studio@1.0.0', 'shipping-dhl@1.0.0']);
    expect(await store.keys()).toEqual(['design-studio', 'shipping-dhl']);
  });

  it('is copy-if-absent: an already-present version is skipped, not overwritten', async () => {
    await stageGood('design-studio', '1.0.0', { 'dist/local.js': 'operator edit' });
    await bundle('design-studio', '1.0.0');
    const result = await seedBundledPackages(store, bundleDir);
    expect(result.skipped).toEqual(['design-studio@1.0.0']);
    expect(result.seeded).toEqual([]);
    await expect(store.readFile('design-studio', '1.0.0', 'dist/local.js')).resolves.toBeDefined();
  });

  it('re-verifies hashes on the way in: a corrupt bundle is reported, not installed', async () => {
    await bundle('design-studio', '1.0.0', GOOD_FILES, 'sha512-AAAAwrongAAAA');
    const result = await seedBundledPackages(store, bundleDir);
    expect(result.failed).toEqual(['design-studio-1.0.0.tgz']);
    expect(await store.keys()).toEqual([]);
  });

  it('reports an unreadable bundle filename rather than guessing', async () => {
    await writeFile(join(bundleDir, 'not-a-package.tgz'), packageTarball(GOOD_FILES));
    const result = await seedBundledPackages(store, bundleDir);
    expect(result.failed).toEqual(['not-a-package.tgz']);
  });

  it('splits a hyphenated key at the version, not at the first hyphen', async () => {
    // The regex used to be lazy, so it stopped at the FIRST hyphen that left a
    // parseable remainder: `design-studio-1.0.0.tgz` seeded under the key
    // `design`, and the package landed somewhere nothing would ever look. Every
    // first-party key has a hyphen in it, so this was most of them.
    await bundle('design-studio', '1.0.0');
    await bundle('holiday-calendars', '2.1.0');
    const result = await seedBundledPackages(store, bundleDir);
    expect(result.seeded.sort()).toEqual(['design-studio@1.0.0', 'holiday-calendars@2.1.0']);
    expect(await store.keys()).toEqual(['design-studio', 'holiday-calendars']);
  });

  it('keeps seeding the rest when one bundled package is unusable', async () => {
    // A boot seed that aborts on the first bad entry leaves an air-gapped
    // install partly populated with no signal about what never arrived.
    await bundle('design-studio', '1.0.0', GOOD_FILES, 'sha512-wrong');
    await bundle('shipping-dhl', '1.0.0');
    await writeFile(join(bundleDir, 'nonsense.tgz'), Buffer.from('junk'));
    const result = await seedBundledPackages(store, bundleDir);
    expect(result.seeded).toEqual(['shipping-dhl@1.0.0']);
    expect(result.failed.sort()).toEqual(['design-studio-1.0.0.tgz', 'nonsense.tgz']);
  });

  it('is a no-op when the image ships no bundle directory', async () => {
    const result = await seedBundledPackages(store, join(bundleDir, 'absent'));
    expect(result).toEqual({ seeded: [], skipped: [], failed: [] });
  });
});
