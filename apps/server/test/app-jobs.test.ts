// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two app acquisition job kinds (b G8-D3/D5).
 *
 * The add-on jobs' twin suite (`add-on-jobs.test.ts`), run the same way: the
 * real registry, a real in-memory meta store, a REAL app store on a temp dir,
 * and a stub catalog client. What is new for apps is the minimum (G8-D2): a
 * release above this server's version is refused before a byte is fetched.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { gzipSync } from 'fflate';
import { auditRepo, createSqliteMetaDb, firstRun, jobsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddOnCatalogError } from '../src/add-ons/catalog.js';
import { createAddOnStore, sha512Integrity } from '../src/add-ons/store.js';
import type { AppCatalog, AppCatalogClient, AppCatalogEntry } from '../src/apps/catalog.js';
import { createAppStore, type AppStore } from '../src/apps/store.js';
import {
  APP_CATALOG_REFRESH_KIND,
  APP_DOWNLOAD_KIND,
  appDownloadDedupeKey,
  enqueueAppCatalogRefresh,
  enqueueAppDownload,
  registerAppAcquireHandlers,
} from '../src/jobs/app-acquire.js';
import { enqueueAddOnDownload } from '../src/jobs/add-on-acquire.js';
import { createJobRegistry, type JobHandlerContext } from '../src/jobs/registry.js';

const BLOCK = 512;

function put(block: Uint8Array, at: number, length: number, value: string): void {
  block.set(Buffer.from(value, 'latin1').subarray(0, length), at);
}

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
  // `mtime: 0` leaves the gzip header's timestamp at zero, as `npm pack` does.
  // fflate's default is the current second, so the same files packed a second
  // apart would hash differently.
  return gzipSync(out, { mtime: 0 });
}

const TARBALL = packageTarball({
  'manifest.json': JSON.stringify({ kind: 'app', key: 'clinic', version: '0.1.2' }),
  'staff/index.html': '<!doctype html><body data-side="staff"></body>',
  'customer/index.html': '<!doctype html><body data-side="customer"></body>',
});
const INTEGRITY = sha512Integrity(TARBALL);

const ENTRY: AppCatalogEntry = {
  key: 'clinic',
  version: '0.1.2',
  integrity: INTEGRITY,
  name: { en: 'Clinic Desk' },
  tagline: { en: 'Appointments for small practices.' },
  categories: ['health'],
  capabilities: [],
  publisher: 'Adminium',
  sides: ['staff', 'customer'],
  minAdminiumVersion: '0.2.8',
};

const CATALOG: AppCatalog = { schemaVersion: 2, generatedAt: '2026-09-16T00:00:00Z', apps: [ENTRY] };

function stubCatalog(overrides: Partial<AppCatalogClient> = {}): AppCatalogClient {
  return {
    isEnabled: async () => true,
    networkFeaturesAllowed: () => true,
    fetchCatalog: async () => CATALOG,
    fetchTarball: async () => TARBALL,
    ...overrides,
  };
}

function context(overrides: Partial<JobHandlerContext> = {}): JobHandlerContext & {
  steps: Array<{ pct: number; step?: string | undefined }>;
} {
  const steps: Array<{ pct: number; step?: string | undefined }> = [];
  return {
    jobId: 'job_test',
    kind: APP_DOWNLOAD_KIND,
    attempt: 1,
    maxAttempts: 1,
    signal: new AbortController().signal,
    progress: (pct, info) => steps.push({ pct, step: info?.step }),
    log: () => {},
    steps,
    ...overrides,
  } as JobHandlerContext & { steps: typeof steps };
}

let meta: MetaDb;
let dataDir: string;
let store: AppStore;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  dataDir = await mkdtemp(join(tmpdir(), 'adminium-app-jobs-'));
  store = createAppStore({ dataDir });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function registryWith(catalog: AppCatalogClient, serverVersion = '0.2.9') {
  const registry = createJobRegistry();
  registerAppAcquireHandlers(registry, { meta, store, catalog, serverVersion });
  return registry;
}

const auditRows = async () => auditRepo(meta).list({ category: 'app', limit: 50 });
const download = (registry: ReturnType<typeof registryWith>, version = '0.1.2', ctx = context()) =>
  registry.get(APP_DOWNLOAD_KIND)!.run({ key: 'clinic', version }, ctx);

describe('app-catalog-refresh', () => {
  it('caches the app feed in the APP store and audits the refresh', async () => {
    const registry = registryWith(stubCatalog());
    const result = await registry
      .get(APP_CATALOG_REFRESH_KIND)!
      .run({}, context({ kind: APP_CATALOG_REFRESH_KIND }));

    expect(result).toEqual({ refreshed: true, count: 1 });
    expect((await store.readCatalogCache())?.document).toEqual(CATALOG);
    // Not the add-on store's cache, which lives beside it in the same data dir.
    expect(await createAddOnStore({ dataDir }).readCatalogCache()).toBeNull();

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['app.catalog-refreshed']);
    expect(rows[0]?.changes).toMatchObject({ after: { count: 1 } });
  });

  it('is a no-op — not a failure — when the app catalog is off', async () => {
    const fetchCatalog = vi.fn();
    const registry = registryWith(
      stubCatalog({ isEnabled: async () => false, fetchCatalog: fetchCatalog as never }),
    );
    const result = await registry
      .get(APP_CATALOG_REFRESH_KIND)!
      .run({}, context({ kind: APP_CATALOG_REFRESH_KIND }));

    expect(result).toEqual({ refreshed: false, reason: 'disabled' });
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(await store.readCatalogCache()).toBeNull();
    expect(await auditRows()).toEqual([]);
  });

  it('audits a failed refresh', async () => {
    const registry = registryWith(
      stubCatalog({
        fetchCatalog: async () => {
          throw new AddOnCatalogError('CATALOG_MALFORMED', 'not the app feed');
        },
      }),
    );
    await expect(
      registry.get(APP_CATALOG_REFRESH_KIND)!.run({}, context({ kind: APP_CATALOG_REFRESH_KIND })),
    ).rejects.toMatchObject({ reason: 'CATALOG_MALFORMED' });
    expect((await auditRows()).map((r) => r.action)).toEqual(['app.catalog-refresh-failed']);
  });

  it('is an ordinary kind, enqueueable by its route', () => {
    expect(registryWith(stubCatalog()).get(APP_CATALOG_REFRESH_KIND)?.internal).toBe(false);
  });
});

describe('app-download', () => {
  beforeEach(async () => {
    await store.writeCatalogCache(CATALOG, 1_700_000_000_000);
  });

  it('is INTERNAL-ONLY, so POST /jobs cannot hand-craft its payload', () => {
    expect(registryWith(stubCatalog()).get(APP_DOWNLOAD_KIND)?.internal).toBe(true);
  });

  it('downloads, verifies, unpacks and stages the release', async () => {
    const registry = registryWith(stubCatalog());
    const ctx = context();
    const result = await download(registry, '0.1.2', ctx);

    expect(result).toMatchObject({ key: 'clinic', version: '0.1.2' });
    expect(await store.versions('clinic')).toEqual(['0.1.2']);
    expect((await store.readFile('clinic', '0.1.2', 'staff/index.html')).toString('utf8')).toContain(
      'data-side="staff"',
    );
    await expect(store.verifyTree('clinic', '0.1.2')).resolves.toBeDefined();
    expect(ctx.steps.map((s) => s.step)).toEqual(['catalog', 'download', 'verify', 'staged']);

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['app.staged']);
    expect(rows[0]?.changes).toMatchObject({
      after: { key: 'clinic', version: '0.1.2', source: 'download' },
    });
  });

  it('hands the client the cached row and the job cancellation signal', async () => {
    const asked: Array<{ key: string; version: string; signal: AbortSignal | undefined }> = [];
    const registry = registryWith(
      stubCatalog({
        fetchTarball: async (entry, signal) => {
          asked.push({ key: entry.key, version: entry.version, signal });
          return TARBALL;
        },
      }),
    );
    const ctx = context();
    await download(registry, '0.1.2', ctx);
    expect(asked).toEqual([{ key: 'clinic', version: '0.1.2', signal: ctx.signal }]);
  });

  it('refuses a release above this server, before fetching a byte (G8-D2)', async () => {
    const fetchTarball = vi.fn();
    const registry = registryWith(stubCatalog({ fetchTarball: fetchTarball as never }), '0.2.7');

    const failure = download(registry);
    await expect(failure).rejects.toMatchObject({ reason: 'REQUIRES_NEWER_ADMINIUM' });
    await expect(failure).rejects.toThrow(/needs Adminium 0\.2\.8 or later; this server is 0\.2\.7/);
    expect(fetchTarball).not.toHaveBeenCalled();
    expect(await store.keys()).toEqual([]);

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['app.download-failed']);
    expect(rows[0]?.changes).toMatchObject({
      after: { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.2.8', serverVersion: '0.2.7' },
    });
  });

  it('accepts a server exactly at the minimum', async () => {
    await expect(download(registryWith(stubCatalog(), '0.2.8'))).resolves.toMatchObject({ key: 'clinic' });
  });

  it('refuses a version the cached app catalog does not offer', async () => {
    await expect(download(registryWith(stubCatalog()), '9.9.9')).rejects.toMatchObject({
      reason: 'UNKNOWN_APP',
    });
    expect(await store.keys()).toEqual([]);
  });

  it('asks for a refresh, without downloading, when no app catalog is cached', async () => {
    const fresh = createAppStore({ dataDir: await mkdtemp(join(tmpdir(), 'adminium-app-empty-')) });
    const fetchTarball = vi.fn();
    const registry = createJobRegistry();
    registerAppAcquireHandlers(registry, {
      meta,
      store: fresh,
      catalog: stubCatalog({ fetchTarball: fetchTarball as never }),
    });
    const failure = registry.get(APP_DOWNLOAD_KIND)!.run({ key: 'clinic', version: '0.1.2' }, context());
    await expect(failure).rejects.toMatchObject({ reason: 'UNKNOWN_APP' });
    await expect(failure).rejects.toThrow(/refresh the app catalog/);
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it('does not take an ADD-ON feed cached in the app store as an app catalog', async () => {
    await store.writeCatalogCache(
      { schemaVersion: 2, generatedAt: CATALOG.generatedAt, addOns: [ENTRY] },
      1_700_000_000_000,
    );
    await expect(download(registryWith(stubCatalog()))).rejects.toMatchObject({ reason: 'UNKNOWN_APP' });
  });

  it('audits a verify refusal when the bytes are not what the row names', async () => {
    const tampered = packageTarball({ 'manifest.json': '{}', 'staff/index.html': 'PWNED' });
    const registry = registryWith(stubCatalog({ fetchTarball: async () => tampered }));

    await expect(download(registry)).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['app.verify-refused']);
    expect(await store.keys()).toEqual([]);
  });

  it('audits an unpack refusal when matching bytes are a hostile archive', async () => {
    const hostile = packageTarball({ '../escape.txt': 'x', 'manifest.json': '{}' });
    await store.writeCatalogCache(
      { ...CATALOG, apps: [{ ...ENTRY, integrity: sha512Integrity(hostile) }] },
      1_700_000_000_000,
    );
    const registry = registryWith(stubCatalog({ fetchTarball: async () => hostile }));

    await expect(download(registry)).rejects.toMatchObject({ reason: 'PATH_TRAVERSAL' });
    expect((await auditRows()).map((r) => r.action)).toEqual(['app.unpack-refused']);
    expect(await store.keys()).toEqual([]);
  });

  it('audits a release file the download host does not have', async () => {
    const registry = registryWith(
      stubCatalog({
        fetchTarball: async () => {
          throw new AddOnCatalogError('TARBALL_NOT_FOUND', 'the download host answered 404');
        },
      }),
    );
    await expect(download(registry)).rejects.toMatchObject({ reason: 'TARBALL_NOT_FOUND' });
    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['app.download-failed']);
    expect(rows[0]?.changes).toMatchObject({ after: { reason: 'TARBALL_NOT_FOUND' } });
  });

  it('stops on cancellation without staging anything', async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(download(registryWith(stubCatalog()), '0.1.2', context({ signal: aborted.signal }))).rejects.toThrow(
      /cancelled/,
    );
    expect(await store.keys()).toEqual([]);
  });

  it('refuses a payload whose key is not a legal app key', () => {
    const schema = registryWith(stubCatalog()).get(APP_DOWNLOAD_KIND)!.schema;
    expect(schema.safeParse({ key: '../etc', version: '0.1.2' }).success).toBe(false);
    expect(schema.safeParse({ key: 'clinic', version: '0.1.2' }).success).toBe(true);
  });
});

describe('enqueue', () => {
  it('returns the same job for a second download of the same key@version', async () => {
    const first = await enqueueAppDownload(meta, { key: 'clinic', version: '0.1.2' });
    const second = await enqueueAppDownload(meta, { key: 'clinic', version: '0.1.2' });
    expect(second.id).toBe(first.id);
    expect(first.dedupeKey).toBe(appDownloadDedupeKey('clinic', '0.1.2'));
  });

  it('does not collide with an add-on download of the same key@version', async () => {
    const app = await enqueueAppDownload(meta, { key: 'clinic', version: '0.1.2' });
    const addOn = await enqueueAddOnDownload(meta, { key: 'clinic', version: '0.1.2' });
    expect(addOn.id).not.toBe(app.id);
  });

  it('gives a download exactly one attempt (R5), and keeps one refresh in flight', async () => {
    const job = await enqueueAppDownload(meta, { key: 'clinic', version: '0.1.2', userId: 'usr_1' });
    const stored = await jobsRepo(meta).findById(job.id);
    expect(stored).toMatchObject({ kind: APP_DOWNLOAD_KIND, maxAttempts: 1 });
    expect(stored?.payload).toMatchObject({ key: 'clinic', userId: 'usr_1' });

    const first = await enqueueAppCatalogRefresh(meta);
    const second = await enqueueAppCatalogRefresh(meta, { userId: 'usr_1' });
    expect(second.id).toBe(first.id);
  });
});
