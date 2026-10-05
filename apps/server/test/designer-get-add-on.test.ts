// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on got from inside a Designer turn (65 spec 18, D99).
 *
 * A real meta store, a real add-on store on a temp dir, the real download and
 * refresh jobs run by a small stand-in for the worker, and a stub for the
 * client that would reach adminium.dev. The installer is the one part stubbed:
 * what it is called with is what this file is about.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { gzipSync } from 'fflate';
import { auditRepo, createSqliteMetaDb, firstRun, jobsRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CATALOG_ENABLED_SETTING, type Catalog, type CatalogClient, type CatalogEntry } from '../src/add-ons/catalog.js';
import type { AddOnInstallerDeps } from '../src/add-ons/install.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { addOnLines } from '../src/designer/add-on-lines.js';
import { createAddOnGetter } from '../src/designer/get-add-on.js';
import { registerAddOnAcquireHandlers } from '../src/jobs/add-on-acquire.js';
import { createJobRegistry } from '../src/jobs/registry.js';

const installAddOn = vi.hoisted(() => vi.fn());
vi.mock('../src/add-ons/install.js', async (original) => ({ ...(await original<typeof import('../src/add-ons/install.js')>()), installAddOn }));

function tarball(files: Record<string, string>): Uint8Array {
  const BLOCK = 512;
  const put = (block: Uint8Array, at: number, length: number, value: string) => block.set(Buffer.from(value, 'latin1').subarray(0, length), at);
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
    const member = new Uint8Array(BLOCK + body.length + ((BLOCK - (body.length % BLOCK)) % BLOCK));
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
  return gzipSync(out, { mtime: 0 });
}

const TARBALL = tarball({
  'manifest.json': JSON.stringify({ kind: 'add-on', key: 'design-studio', version: '1.0.0', name: 'Design Studio' }),
  'package.json': JSON.stringify({ name: '@adminiumjs/add-on-design-studio' }),
  'dist/client.js': 'export const mount = () => {};',
});

const ENTRY: CatalogEntry = {
  key: 'design-studio',
  version: '1.0.0',
  integrity: sha512Integrity(TARBALL),
  provides: [],
  attaches: [],
  categories: ['design'],
  capabilities: [],
  connect: { kind: 'none' },
  network: { allow: [] },
  name: { en: 'Design Studio' },
  tagline: { en: 'A small in-browser artwork editor.' },
  minAdminiumVersion: '0.1.0',
};
const CATALOG: Catalog = { format: 'adminium-marketplace/1', unavailable: [], skipped: [], generatedAt: '2026-08-29T00:00:00Z', addOns: [ENTRY, { ...ENTRY, key: 'from-the-future', minAdminiumVersion: '9.0.0' }] };

let meta: MetaDb;
let dataDir: string;
let store: AddOnStore;
let fetched: string[];
let networkFeatures: boolean;
let may: boolean;
let worker: ReturnType<typeof setInterval>;

let OWNER: { id: string; label: string };

const catalog = (): CatalogClient => ({
  isEnabled: async () => networkFeatures && (await settingsRepo(meta).get(CATALOG_ENABLED_SETTING)) === true,
  networkFeaturesAllowed: () => networkFeatures,
  fetchCatalog: async () => {
    fetched.push('list');
    return CATALOG;
  },
  fetchTarball: async () => {
    fetched.push('tarball');
    return TARBALL;
  },
});

const getterDeps = () => ({
  meta,
  installer: { meta, store, credentialCrypto: { encrypt: (v: string) => v, decrypt: (v: string) => v } } as unknown as AddOnInstallerDeps,
  catalog: catalog(),
  serverVersion: '0.3.16',
  allowed: async () => may,
  pollMs: 5,
  jobTimeoutMs: 4000,
});
const getter = () => createAddOnGetter(getterDeps());

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  OWNER = { id: (await usersRepo(meta).create({ email: 'owner@example.test', name: 'Owner' })).id, label: 'owner@example.test' };
  dataDir = await mkdtemp(join(tmpdir(), 'adminium-designer-get-'));
  store = createAddOnStore({ dataDir });
  fetched = [];
  networkFeatures = true;
  may = true;
  installAddOn.mockReset();
  installAddOn.mockResolvedValue({});
  await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, true, { updatedBy: null });

  // The worker, in small: claim what is queued and run it through the real handlers.
  const registry = createJobRegistry();
  registerAddOnAcquireHandlers(registry, { meta, store, catalog: catalog(), serverVersion: '0.3.16' });
  let busy = false;
  worker = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      const jobs = jobsRepo(meta);
      const job = await jobs.claim('test-worker');
      if (job === null) return;
      try {
        await registry.get(job.kind)!.run(job.payload, { jobId: job.id, kind: job.kind, attempt: 1, maxAttempts: 1, signal: new AbortController().signal, progress: () => undefined, log: () => undefined } as never);
        await jobs.complete(job.id);
      } catch (error) {
        await jobs.fail(job.id, error instanceof Error ? error.message : String(error), { retry: false } as never);
      }
    })().finally(() => {
      busy = false;
    });
  }, 5);
});

afterEach(async () => {
  clearInterval(worker);
  await rm(dataDir, { recursive: true, force: true });
});

const signal = () => new AbortController().signal;
const actions = async () => (await auditRepo(meta).list({ category: 'add-on', limit: 50 })).map((row) => row.action);

describe('what this server knows of an add-on', () => {
  it('reads the list only while it is on', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    expect(await getter().look('design-studio')).toEqual({ state: 'listed', name: 'Design Studio', version: '1.0.0', line: 'A small in-browser artwork editor.' });
    expect(await getter().look('nope')).toEqual({ state: 'unknown' });
    expect(await getter().look('from-the-future')).toEqual({ state: 'too-new', name: 'Design Studio', needs: '9.0.0' });
    // A key is a key: never a path, an address or a version.
    expect(await getter().look('../etc')).toEqual({ state: 'unknown' });
    expect(await getter().look('https://example.test/x')).toEqual({ state: 'unknown' });

    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, false, { updatedBy: null });
    // Off: the list on disk is not read, so nothing of it is said.
    expect(await getter().look('design-studio')).toEqual({ state: 'off', vetoed: false });
    networkFeatures = false;
    expect(await getter().look('design-studio')).toEqual({ state: 'off', vetoed: true });
    expect(fetched).toEqual([]);
  });
});

describe('getting one', () => {
  const V = { version: '1.0.0' };

  it('downloads what the list names, at the version the person was shown, and installs it as the person', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    expect(await getter().get('design-studio', OWNER, signal(), V)).toEqual({ ok: true, name: 'Design Studio', version: '1.0.0' });
    expect(fetched).toEqual(['tarball']);
    expect(await store.versions('design-studio')).toEqual(['1.0.0']);
    expect(installAddOn).toHaveBeenCalledTimes(1);
    expect(installAddOn.mock.calls[0]?.[1]).toEqual({ key: 'design-studio', version: '1.0.0', attachTo: [], actor: OWNER });
  });

  it('an add-on got while an app is being built goes to that app\'s database, named to the installer', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    const asked: string[] = [];
    const withApp = createAddOnGetter({ ...getterDeps(), connectionFor: async (appKey) => (asked.push(appKey), appKey === 'shop' ? 'conn_shop' : null) });
    expect((await withApp.get('design-studio', OWNER, signal(), { ...V, appKey: 'shop' })).ok).toBe(true);
    expect(asked).toEqual(['shop']);
    expect(installAddOn.mock.calls[0]?.[1]).toEqual({ key: 'design-studio', version: '1.0.0', attachTo: [], connectionId: 'conn_shop', actor: OWNER });
    // An app with no database yet, or no app at all: nothing is named, and the installer asks or works it out.
    installAddOn.mockClear();
    await withApp.get('design-studio', OWNER, signal(), { ...V, appKey: 'new-app' });
    await withApp.get('design-studio', OWNER, signal(), V);
    expect(installAddOn.mock.calls.map((call) => (call[1] as { connectionId?: string }).connectionId)).toEqual([undefined, undefined]);
  });

  it('does not follow a list that moved between the card and the yes', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    const result = await getter().get('design-studio', OWNER, signal(), { version: '0.9.0' });
    expect(result).toMatchObject({ ok: false });
    expect((result as { why: string }).why).toContain('now at version 1.0.0, not the 0.9.0 the person was shown');
    expect(fetched).toEqual([]);
    expect(installAddOn).not.toHaveBeenCalled();
  });

  it('installs one already in the store without asking adminium.dev for anything', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    await getter().get('design-studio', OWNER, signal(), V);
    fetched = [];
    installAddOn.mockClear();
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, false, { updatedBy: null });
    expect(await getter().look('design-studio')).toMatchObject({ state: 'here', version: '1.0.0' });
    expect(await getter().get('design-studio', OWNER, signal(), V)).toMatchObject({ ok: true });
    expect(fetched).toEqual([]);
    expect(installAddOn).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a person who may not add an add-on, checked when the answer comes', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    may = false;
    expect(await getter().get('design-studio', OWNER, signal(), V)).toMatchObject({ ok: false });
    expect(await getter().switchOn(OWNER, signal())).toMatchObject({ ok: false });
    expect(fetched).toEqual([]);
    expect(installAddOn).not.toHaveBeenCalled();
  });

  it('a list that is off stays off when an add-on is asked for: getting never switches it on', async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, false, { updatedBy: null });
    expect(await getter().get('design-studio', OWNER, signal(), V)).toMatchObject({ ok: false });
    expect(await settingsRepo(meta).get(CATALOG_ENABLED_SETTING)).toBe(false);
    expect(fetched).toEqual([]);
  });

  it('switching the list on is its own step: audited as the page’s switch, the list read, nothing downloaded', async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, false, { updatedBy: null });
    expect(await getter().switchOn(OWNER, signal())).toEqual({ ok: true });
    expect(await settingsRepo(meta).get(CATALOG_ENABLED_SETTING)).toBe(true);
    expect(fetched).toEqual(['list']);
    expect(installAddOn).not.toHaveBeenCalled();
    const toggled = (await auditRepo(meta).list({ category: 'add-on', limit: 50 })).find((row) => row.action === 'add-on.catalog-toggled');
    expect(toggled).toMatchObject({ actorId: OWNER.id, changes: { before: { onlineEnabled: false }, after: { onlineEnabled: true, from: 'designer' } } });
    expect(await actions()).toContain('add-on.catalog-refreshed');
    // Then the add-on is in the list, to be shown by its own name and version before it is got.
    expect(await getter().look('design-studio')).toMatchObject({ state: 'listed', name: 'Design Studio', version: '1.0.0' });
  });

  it('the environment’s off outranks any yes', async () => {
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, false, { updatedBy: null });
    networkFeatures = false;
    expect(await getter().switchOn(OWNER, signal())).toMatchObject({ ok: false });
    expect(await settingsRepo(meta).get(CATALOG_ENABLED_SETTING)).toBe(false);
    expect(fetched).toEqual([]);
  });

  it('says so when the list does not name it, and installs nothing', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    expect(await getter().get('nope', OWNER, signal(), V)).toEqual({ ok: false, why: 'adminium.dev lists no add-on "nope".' });
    expect(await getter().get('from-the-future', OWNER, signal(), V)).toMatchObject({ ok: false });
    expect(installAddOn).not.toHaveBeenCalled();
    expect(fetched).toEqual([]);
  });

  it('carries the installer’s own refusal back in words', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    installAddOn.mockRejectedValueOnce(new Error('its tables do not fit'));
    const result = await getter().get('design-studio', OWNER, signal(), V);
    expect(result).toEqual({ ok: false, why: 'Design Studio was downloaded and could not be installed: its tables do not fit' });
  });
});

describe('the add-ons a model is told of (D100)', () => {
  const lines = () => addOnLines({ meta, credentialCrypto: { encrypt: (v: string) => v, decrypt: (v: string) => v }, store, catalogEnabled: () => catalog().isEnabled() });

  it('names what the list holds only while the list is on, and as not here yet', async () => {
    await store.writeCatalogCache(CATALOG, Date.now());
    expect((await lines()).find((line) => line.key === 'design-studio')).toMatchObject({ state: 'listed', version: '1.0.0' });
    await settingsRepo(meta).set(CATALOG_ENABLED_SETTING, false, { updatedBy: null });
    // The file is still on disk; a list someone switched off is not read from it.
    expect(await lines()).toEqual([]);
  });
});
