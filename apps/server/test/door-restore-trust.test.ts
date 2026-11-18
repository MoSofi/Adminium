// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A door package (forms, chat) keeps serving across a redeploy that empties
 * the data directory.
 *
 * A package is put back from its kept copy (`add-ons/package-copies.ts`), and
 * that copy is a repack: its hash is neither a bundled pin nor the hash the
 * catalogue recorded at download. These prove the copy of a trusted package is
 * trusted as its original was, and nothing more: a copy of a package uploaded
 * by hand stays untrusted, a copy of a tree that changed on disk is not
 * trusted, and a copy whose bytes changed is refused. On every engine this run
 * can reach, since the trust is kept in the meta store.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { manifestsRepo, settingsRepo, type InstalledManifest } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAddOn } from '../../../packages/manifest/test/chat-fixture.js';
import { formsAddOn } from '../../../packages/manifest/test/forms-fixture.js';
import { BUNDLED_PINS } from '../src/add-ons/bundled-pins.js';
import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { deciderTrusted } from '../src/add-ons/decide.js';
import { keptCopyTrust, recordDeciderTrust, trustSources, type KeptCopyTrust } from '../src/add-ons/decider-trust.js';
import { createPackageCopies, type PackageCopies } from '../src/add-ons/package-copies.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { doorPackageVouched } from '../src/forms/vouched.js';
import { packageTarball } from './app-bundle-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

type Doc = Record<string, unknown>;

/** The doors a package can declare. A pages door is one more line here. */
const DOORS: { door: string; manifest: () => Doc }[] = [
  { door: 'a live form', manifest: formsAddOn },
  { door: 'a live chat', manifest: chatAddOn },
];

/** A version past the one this build bundles of a key (or any version, for a key it does not bundle). */
function pastBundled(key: string): string {
  const pin = BUNDLED_PINS.find((one) => one.key === key);
  if (pin === undefined) return '1.0.1';
  const [major, minor, patch] = pin.version.split('.').map(Number) as [number, number, number];
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

describe('the judgement of a kept copy', () => {
  const copy = { key: 'forms', version: '1.0.0', integrity: `sha512-${'C'.repeat(86)}==` };

  it('trusts a kept copy for its own key, version and hash only', () => {
    const sources = { bundled: [], recorded: {}, kept: { 'forms@1.0.0': copy.integrity } };
    expect(deciderTrusted(copy, sources)).toBe(true);
    expect(deciderTrusted({ ...copy, integrity: `sha512-${'D'.repeat(86)}==` }, sources)).toBe(false);
    expect(deciderTrusted({ ...copy, version: '1.0.1' }, sources)).toBe(false);
    expect(deciderTrusted({ ...copy, key: 'live-chat' }, sources)).toBe(false);
    expect(deciderTrusted(copy, { bundled: [], recorded: {} })).toBe(false);
  });
});

describe.each(META_ENGINES)('a door package across a redeploy — $name', (engine) => {
  let handle: MetaHandle;
  let root: string;
  let dataDir: string;
  let store: AddOnStore;
  let copies: PackageCopies;
  /** The storage destination: survives the wipe, as a bucket does. */
  let objects: Map<string, Buffer>;
  let fileRows: Map<string, { id: string; storageKey: string; deletedAt: number | null }>;
  /** Anything that reaches for the network, the catalogue included. */
  let fetcher: ReturnType<typeof vi.fn>;

  const repo = () => manifestsRepo(handle.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));

  /** The store as a fresh boot sees it. */
  const openStore = (): AddOnStore => createAddOnStore({ dataDir });

  function makeCopies(opts: { trust?: KeptCopyTrust; store?: () => AddOnStore } = {}): PackageCopies {
    return createPackageCopies({
      files: {
        defaultDestinationId: async () => 'dst_remote',
        write: async ({ id, bytes }: { id: string; bytes: Buffer }) => {
          objects.set(id, Buffer.from(bytes));
          return { storageKey: id, sizeBytes: bytes.byteLength, sha256: '', destinationId: 'dst_remote', storage: 'fake' };
        },
        read: async (file: { storageKey: string }) => {
          const bytes = objects.get(file.storageKey);
          if (bytes === undefined) throw new Error('no such object');
          return Readable.from([bytes]);
        },
      } as never,
      filesRepo: {
        create: async (input: { id: string; storageKey: string }) => {
          fileRows.set(input.id, { id: input.id, storageKey: input.storageKey, deletedAt: null });
          return { id: input.id };
        },
        findById: async (id: string) => fileRows.get(id) ?? null,
      } as never,
      manifests: repo(),
      storeFor: (kind) => (kind === 'add-on' ? (opts.store?.() ?? store) : null),
      log: () => undefined,
      trust: opts.trust ?? keptCopyTrust(handle.meta),
    });
  }

  /** A package's tarball, as a publisher (or someone uploading by hand) made it. */
  function tarballOf(doc: Doc, version: string): Uint8Array {
    return packageTarball({ 'manifest.json': JSON.stringify({ ...doc, version }), 'dist/server.js': 'export default {};\n' });
  }

  /** Staged and recorded as the catalogue's download does (`jobs/add-on-acquire.ts`). */
  async function stageFromCatalogue(doc: Doc, version: string): Promise<void> {
    const tarball = tarballOf(doc, version);
    const integrity = sha512Integrity(tarball);
    const key = doc['key'] as string;
    await store.stage({ key, version, tarball, expectedIntegrity: integrity });
    await recordDeciderTrust(handle.meta, { key, version, integrity });
  }

  const install = (doc: Doc, version: string): Promise<InstalledManifest> =>
    repo().install({ manifestKey: doc['key'] as string, version, kind: 'add-on', source: 'marketplace', document: { ...doc, version } });

  async function installFromCatalogue(doc: Doc, version: string): Promise<InstalledManifest> {
    await stageFromCatalogue(doc, version);
    return install(doc, version);
  }

  /** Staged and installed, as a hand upload is: recorded nowhere as trusted. */
  async function installByHand(doc: Doc, version: string): Promise<InstalledManifest> {
    const tarball = tarballOf(doc, version);
    await store.stage({ key: doc['key'] as string, version, tarball, expectedIntegrity: sha512Integrity(tarball) });
    return install(doc, version);
  }

  const reread = async (row: InstalledManifest): Promise<InstalledManifest> => (await repo().findById(row.row.id)) as InstalledManifest;

  /** The deploy: the data directory is emptied; the meta store and the bucket are not. */
  async function redeploy(): Promise<void> {
    await rm(join(dataDir, 'add-ons'), { recursive: true, force: true });
    store = openStore();
    copies = makeCopies();
  }

  const vouched = (row: InstalledManifest): Promise<boolean> =>
    doorPackageVouched(store, handle.meta, { key: row.row.manifestKey, version: row.row.version });

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    root = await mkdtemp(join(tmpdir(), 'door-restore-trust-'));
    dataDir = join(root, 'data');
    await mkdir(dataDir);
    store = openStore();
    objects = new Map();
    fileRows = new Map();
    copies = makeCopies();
    fetcher = vi.fn(() => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (!engine.available) return;
    await handle.destroy();
    await rm(root, { recursive: true, force: true });
  });

  describe.each(DOORS)('$door', ({ manifest }) => {
    it.skipIf(!engine.available)('restored on a fresh disk from its kept copy, is served with no catalogue call', async () => {
      const installed = await installFromCatalogue(manifest(), '1.0.0');
      expect(await vouched(installed)).toBe(true);
      expect(await copies.keep(installed)).not.toBeNull();

      await redeploy();
      expect(await copies.restore(await reread(installed))).toBe(true);
      expect(await store.versions(installed.row.manifestKey)).toEqual(['1.0.0']);
      expect(await vouched(installed)).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.skipIf(!engine.available)('updated past its bundled version, then restored, is still served', async () => {
      const doc = manifest();
      const key = doc['key'] as string;
      const first = await installFromCatalogue(doc, '1.0.0');
      await copies.keep(first);

      // The update: the new version downloaded and recorded, the row moved on (which drops the old copy), a copy kept.
      const version = pastBundled(key);
      await stageFromCatalogue(doc, version);
      await repo().setVersion(first.row.id, { version, document: { ...doc, version } });
      const updated = await reread(first);
      expect(updated.row.packageIntegrity).toBeNull();
      expect(await copies.keep(updated)).not.toBeNull();

      await redeploy();
      expect(await copies.restore(await reread(updated))).toBe(true);
      expect(BUNDLED_PINS.some((pin) => pin.key === key && pin.version === version)).toBe(false);
      expect(await vouched(updated)).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.skipIf(!engine.available)('uploaded by hand, its restored copy stays not vouched, and so does its missing tree', async () => {
      const installed = await installByHand(manifest(), '1.0.0');
      expect(await vouched(installed)).toBe(false);
      expect(await copies.keep(installed)).not.toBeNull();
      expect(await keptCopyTrust(handle.meta).kept(installed.row.manifestKey, '1.0.0')).toBeUndefined();

      await redeploy();
      expect(await vouched(installed)).toBe(false);
      expect(await copies.restore(await reread(installed))).toBe(true);
      expect(await vouched(installed)).toBe(false);
    });
  });

  it.skipIf(!engine.available)('refuses a copy with one byte changed: nothing is staged, and those bytes are trusted for nothing', async () => {
    const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
    const kept = await copies.keep(installed);
    expect(kept).not.toBeNull();
    const bytes = objects.get(kept?.fileId ?? '') as Buffer;
    const tampered = Buffer.from(bytes);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;
    objects.set(kept?.fileId ?? '', tampered);

    await redeploy();
    expect(await copies.restore(await reread(installed))).toBe(false);
    expect(await store.versions('forms')).toEqual([]);
    const sources = await trustSources(handle.meta, {});
    expect(deciderTrusted({ key: 'forms', version: '1.0.0', integrity: sha512Integrity(tampered) }, sources)).toBe(false);
    // The door reads no file of the package: with nothing on disk it is judged by the install's trusted record, never by these bytes.
    expect(await vouched(installed)).toBe(true);
  });

  it.skipIf(!engine.available)('does not trust the copy of a tree that changed on disk after it was installed', async () => {
    const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
    await writeFile(join(store.dirFor('forms', '1.0.0'), 'dist/server.js'), 'export default { changed: true };\n');
    expect(await vouched(installed)).toBe(false);
    expect(await copies.keep(installed)).not.toBeNull();
    expect(await keptCopyTrust(handle.meta).kept('forms', '1.0.0')).toBeUndefined();

    await redeploy();
    expect(await copies.restore(await reread(installed))).toBe(true);
    expect(await vouched(installed)).toBe(false);
  });

  it.skipIf(!engine.available)('does not trust a copy whose files changed between the check and the pack', async () => {
    const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
    // A store that changes a file the moment its tree has verified, before the pack reads it.
    const racing = (): AddOnStore => ({
      ...store,
      verifyTree: async (key, version) => {
        const tree = await store.verifyTree(key, version);
        await writeFile(join(store.dirFor(key, version), 'dist/server.js'), 'export default { swapped: true };\n');
        return tree;
      },
    });
    expect(await makeCopies({ store: racing }).keep(installed)).not.toBeNull();
    expect(await keptCopyTrust(handle.meta).kept('forms', '1.0.0')).toBeUndefined();

    await redeploy();
    expect(await copies.restore(await reread(installed))).toBe(true);
    expect(await vouched(installed)).toBe(false);
  });

  it.skipIf(!engine.available)('does not carry a developer\'s trust into the copy', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ADMINIUM_ADD_ON_DEV_TRUST', 'forms');
    const installed = await installByHand(formsAddOn(), '1.0.0');
    expect(await vouched(installed)).toBe(true);
    await copies.keep(installed);
    expect(await keptCopyTrust(handle.meta).kept('forms', '1.0.0')).toBeUndefined();

    vi.unstubAllEnvs();
    await redeploy();
    expect(await copies.restore(await reread(installed))).toBe(true);
    expect(await vouched(installed)).toBe(false);
  });

  it.skipIf(!engine.available)('records the trust of a copy kept before trust was recorded, on the next keep', async () => {
    const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
    // An older server kept the copy and recorded no trust for it.
    const nothing: KeptCopyTrust = { kept: async () => undefined, original: async () => false, record: async () => undefined };
    expect(await makeCopies({ trust: nothing }).keep(installed)).not.toBeNull();
    const held = await reread(installed);
    expect(await keptCopyTrust(handle.meta).kept('forms', '1.0.0')).toBeUndefined();

    // This server's next boot keeps nothing new, and records the held copy's trust.
    expect(await copies.keep(held)).toBeNull();
    expect(await keptCopyTrust(handle.meta).kept('forms', '1.0.0')).toBe(held.row.packageIntegrity);

    await redeploy();
    expect(await copies.restore(held)).toBe(true);
    expect(await vouched(held)).toBe(true);
  });

  it.skipIf(!engine.available)('does not record a held copy\'s trust when the copy is of other bytes than the tree', async () => {
    const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
    await copies.keep(installed);
    const held = await reread(installed);
    await settingsRepo(handle.meta).set('addOns.keptCopyTrust', {});
    await repo().setPackageCopy(held.row.id, { fileId: held.row.packageFileId as string, integrity: `sha512-${'E'.repeat(86)}==` });

    expect(await copies.keep(await reread(installed))).toBeNull();
    expect(await keptCopyTrust(handle.meta).kept('forms', '1.0.0')).toBeUndefined();
  });

  describe('with its files missing altogether', () => {
    it.skipIf(!engine.available)('is served by its trusted kept copy before (or without) the restore', async () => {
      const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
      await copies.keep(installed);
      await redeploy();
      expect(await vouched(installed)).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
    });

    it.skipIf(!engine.available)('is not served when no copy is held, since nothing records what was installed', async () => {
      const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
      await redeploy();
      expect(await vouched(installed)).toBe(false);
    });

    it.skipIf(!engine.available)('is not served when the install names a copy other than the trusted one', async () => {
      const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
      await copies.keep(installed);
      const held = await reread(installed);
      await repo().setPackageCopy(held.row.id, { fileId: held.row.packageFileId as string, integrity: `sha512-${'F'.repeat(86)}==` });
      await redeploy();
      expect(await vouched(installed)).toBe(false);
    });

    it.skipIf(!engine.available)('is not served once no install of it is left, whatever trust was recorded', async () => {
      const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
      await copies.keep(installed);
      await repo().uninstall(installed.row.id);
      await redeploy();
      expect(await vouched(installed)).toBe(false);
    });

    it.skipIf(!engine.available)('is not served when another install of the same version names another copy, or none', async () => {
      const doc = formsAddOn();
      const installed = await installFromCatalogue(doc, '1.0.0');
      await copies.keep(installed);
      const second = await repo().install({ manifestKey: 'forms', version: '1.0.0', kind: 'add-on', source: 'marketplace', document: { ...doc, version: '1.0.0' }, scopeKey: 'second-database', instanceSlug: 'second' });
      await redeploy();
      expect(await vouched(installed)).toBe(false);
      await repo().setPackageCopy(second.row.id, { fileId: 'file_other', integrity: `sha512-${'G'.repeat(86)}==` });
      expect(await vouched(installed)).toBe(false);
      const held = await reread(installed);
      await repo().setPackageCopy(second.row.id, { fileId: held.row.packageFileId as string, integrity: held.row.packageIntegrity as string });
      expect(await vouched(installed)).toBe(true);
    });

    it.skipIf(!engine.available)('is not served when only part of it is missing: a directory without its pin is drift', async () => {
      const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
      await copies.keep(installed);
      await redeploy();
      await mkdir(store.dirFor('forms', '1.0.0'), { recursive: true });
      expect(await vouched(installed)).toBe(false);
    });

    it.skipIf(!engine.available)('is not served when its pin is left but its files are gone: that is drift too', async () => {
      const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
      await copies.keep(installed);
      await rm(store.dirFor('forms', '1.0.0'), { recursive: true, force: true });
      expect(await store.versions('forms')).toEqual([]);
      expect(await vouched(installed)).toBe(false);
    });

    it.skipIf(!engine.available)('is not served when a file inside its tree is missing', async () => {
      const installed = await installFromCatalogue(formsAddOn(), '1.0.0');
      await copies.keep(installed);
      await rm(join(store.dirFor('forms', '1.0.0'), 'dist/server.js'));
      expect(await vouched(installed)).toBe(false);
      // The tree is still there to be read: this is drift, not a redeploy.
      expect((await readFile(join(store.dirFor('forms', '1.0.0'), 'manifest.json'))).byteLength).toBeGreaterThan(0);
    });
  });
});
