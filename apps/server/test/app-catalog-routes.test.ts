// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app catalog routes and the update route (b G8-D2, D3, D5, D6).
 *
 * Run against the real `appRoutes`, a real in-memory meta store, a REAL app
 * store on a temp dir, real `applyInstall` DDL against an in-memory source
 * database, and a stub catalog client — the same split `app-install.test.ts`
 * makes. Bundles are real npm-shaped archives, uploaded through the route, so
 * every package on disk went through the hardened unpack.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { gzipSync } from 'fflate';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  auditRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  jobsRepo,
  manifestsRepo,
  settingsRepo,
  userPrefsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';

import { CATALOG_ENABLED_SETTING } from '../src/add-ons/catalog.js';
import { applyInstall, type ExistingTable } from '../src/add-ons/install-ddl.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import {
  APP_CATALOG_ENABLED_SETTING,
  type AppCatalog,
  type AppCatalogClient,
  type AppCatalogEntry,
} from '../src/apps/catalog.js';
import { createInstalledApps, type InstalledApps } from '../src/apps/installed.js';
import type { AppSchemaTarget } from '../src/apps/schema-target.js';
import { createAppStore, type AppStore } from '../src/apps/store.js';
import { AppError, errorEnvelope } from '../src/errors.js';
import { APP_CATALOG_REFRESH_KIND, APP_DOWNLOAD_KIND } from '../src/jobs/app-acquire.js';
import { appRoutes } from '../src/routes/apps/index.js';

const BLOCK = 512;

function put(b: Uint8Array, at: number, len: number, v: string): void {
  b.set(Buffer.from(v, 'latin1').subarray(0, len), at);
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
  members.push(new Uint8Array(BLOCK * 2));
  const flat = new Uint8Array(members.reduce((n, m) => n + m.length, 0));
  let offset = 0;
  for (const member of members) {
    flat.set(member, offset);
    offset += member.length;
  }
  // `mtime: 0` leaves the gzip header's timestamp at zero, as `npm pack` does.
  // fflate's default is the current second, so the same files packed a second
  // apart would hash differently.
  return gzipSync(flat, { mtime: 0 });
}

type Table = { ref: string; columns: Array<{ ref: string; type: string; role?: string }> };

const CLINICIANS: Table = {
  ref: 'clinicians',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'name', type: 'text' },
  ],
};

/** A manifest that validates (derived from `app-install.test.ts`'s, from clinic-desk). */
function manifestFor(key: string, version: string, tables: Table[] = [CLINICIANS]) {
  return {
    kind: 'app',
    manifestVersion: 1,
    key,
    name: 'Sample Desk',
    version,
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.sample.desc', fallback: 'A sample desk.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.2.8', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: { tables },
    pages: [
      {
        ref: 'sample-dashboard',
        template: 'page-dashboard',
        title: { key: 'mft.sample.page.dashboard', fallback: 'Dashboard' },
        nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 },
      },
    ],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } },
      { side: 'customer', kind: 'spa', entry: 'index.html', routes: { book: '/' } },
    ],
  };
}

function bundleFor(key: string, version: string, tables?: Table[]): Record<string, string> {
  return {
    'manifest.json': JSON.stringify(manifestFor(key, version, tables)),
    'staff/index.html': `<!doctype html><body data-version="${version}"></body>`,
    'customer/index.html': `<!doctype html><body data-version="${version}"></body>`,
  };
}

/** A catalog row as the website's `v2/apps.json` emits it. */
function row(overrides: Partial<AppCatalogEntry> = {}): AppCatalogEntry {
  return {
    key: 'clinic',
    version: '0.1.2',
    integrity: 'sha512-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+/==',
    name: { en: 'Clinic Desk', fr: 'Cabinet' },
    tagline: { en: 'Appointments for small practices.', fr: 'Rendez-vous pour petits cabinets.' },
    categories: ['health'],
    capabilities: ['email-delivery'],
    publisher: 'Adminium',
    sides: ['staff', 'customer'],
    minAdminiumVersion: '0.2.8',
    ...overrides,
  };
}

const feed = (...apps: AppCatalogEntry[]): AppCatalog => ({
  schemaVersion: 2,
  generatedAt: '2026-09-16T00:00:00Z',
  apps,
});

let meta: MetaDb;
let dataDir: string;
let store: AppStore;
let installed: InstalledApps;
let user: { id: string; email: string };
let sourceDb: Kysely<Record<string, Record<string, unknown>>>;
let existingTables: ExistingTable[] = [];
let CONNECTION: string;
/** The stub catalog's answers; `null` = the composition has no catalog client. */
let catalogState: { enabled: boolean; networkFeatures: boolean } | null;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const created = await usersRepo(meta).create({ email: 'owner@test', name: 'Owner' });
  user = { id: created.id, email: created.email };
  dataDir = await mkdtemp(join(tmpdir(), 'app-catalog-routes-'));
  store = createAppStore({ dataDir });
  installed = createInstalledApps({
    store,
    list: async () =>
      (await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app')).map((m) => ({
        key: m.row.manifestKey,
        version: m.row.version,
      })),
  });
  existingTables = [];
  catalogState = { enabled: true, networkFeatures: true };
  CONNECTION = (
    await connectionsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).create({
      name: 'Practice',
      engine: 'sqlite',
      introspectDsn: 'sqlite::memory:',
      dataDsn: 'sqlite::memory:',
    })
  ).id;
  sourceDb = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function stubCatalog(): AppCatalogClient | undefined {
  if (catalogState === null) return undefined;
  const state = catalogState;
  return {
    isEnabled: async () => state.enabled && state.networkFeatures,
    networkFeaturesAllowed: () => state.networkFeatures,
    fetchCatalog: async () => {
      throw new Error('a route must never fetch inline');
    },
    fetchTarball: async () => {
      throw new Error('a route must never download inline');
    },
  };
}

async function buildApp(serverVersion = '0.2.9') {
  const Fastify = (await import('fastify')).default;
  const { serializerCompiler, validatorCompiler } = await import('fastify-type-provider-zod');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('rbac', { require: () => async () => {} } as never);
  app.decorate('requireAuth', (async () => {}) as never);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, 'req_test', error.details));
    }
    return reply.status(500).send(errorEnvelope('INTERNAL', String(error), 'req_test'));
  });
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    (request as { user?: unknown }).user = user;
  });
  await app.register(
    appRoutes({
      meta,
      store,
      installed,
      credentialCrypto: { encrypt: (v) => v, decrypt: (v) => v },
      directoryKeys: () => [],
      schemaTarget: {
        read: async () => existingTables.map((table) => ({ ...table, columns: [...table.columns] })),
        apply: async (plan, manifest) =>
          applyInstall({
            plan,
            tables: manifest.requiredSchema?.tables ?? [],
            db: sourceDb,
            dialect: 'sqlite',
            existing: existingTables,
          }),
      } satisfies AppSchemaTarget,
      catalog: stubCatalog(),
      serverVersion,
    }),
  );
  await app.ready();
  return app;
}

type App = Awaited<ReturnType<typeof buildApp>>;

async function upload(app: App, key: string, version: string, tables?: Table[]) {
  const tarball = packageTarball(bundleFor(key, version, tables));
  const res = await app.inject({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function install(app: App, key: string, version: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/apps/install',
    payload: { key, version, connectionId: CONNECTION },
  });
  expect(res.statusCode, res.body).toBe(200);
}

const catalogOf = async (app: App) => {
  const res = await app.inject({ method: 'GET', url: '/apps/catalog' });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    apps: Array<Record<string, unknown> & { key: string }>;
    catalogFetchedAt: number | null;
    onlineEnabled: boolean;
  };
};

const appAudit = async () => auditRepo(meta).list({ category: 'app', limit: 50 });

describe('GET /apps/catalog', () => {
  it('lists the store alone, with no cached catalog', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', '1.0.0');
    const body = await catalogOf(app);
    expect(body.catalogFetchedAt).toBeNull();
    expect(body.onlineEnabled).toBe(true);
    expect(body.apps).toEqual([
      expect.objectContaining({
        key: 'sample-desk',
        version: '1.0.0',
        source: 'disk',
        state: 'staged',
        description: 'A sample desk.',
        updateTo: null,
        updateStaged: false,
        needsNewerAdminium: null,
      }),
    ]);
    await app.close();
  });

  it('adds what only the cached catalog offers, in the operator’s language, by key', async () => {
    await userPrefsRepo(meta).set(user.id, { locale: 'fr_FR' });
    const app = await buildApp();
    await upload(app, 'sample-desk', '1.0.0');
    await store.writeCatalogCache(feed(row(), row({ key: 'hotel', version: '0.1.1' })), 1_700_000_000_000);

    const body = await catalogOf(app);
    expect(body.catalogFetchedAt).toBe(1_700_000_000_000);
    expect(body.apps.map((a) => [a.key, a.source, a.state])).toEqual([
      ['clinic', 'catalog', 'available'],
      ['hotel', 'catalog', 'available'],
      ['sample-desk', 'disk', 'staged'],
    ]);
    expect(body.apps[0]).toMatchObject({
      version: '0.1.2',
      name: 'Cabinet',
      description: 'Rendez-vous pour petits cabinets.',
      publisher: 'Adminium',
      capabilities: ['email-delivery'],
      sides: ['staff', 'customer'],
      installed: false,
      updateTo: null,
      needsNewerAdminium: null,
    });
    await app.close();
  });

  it('lists a release above this server as not installable, and says why (G8-D2)', async () => {
    const app = await buildApp('0.2.7');
    await store.writeCatalogCache(feed(row()), 1_700_000_000_000);
    const [clinic] = (await catalogOf(app)).apps;
    expect(clinic).toMatchObject({
      key: 'clinic',
      state: 'available',
      needsNewerAdminium: { version: '0.1.2', minAdminiumVersion: '0.2.8' },
    });
    await app.close();
  });

  it('offers an installed app the catalog’s newer release, and whether it is on disk yet', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', '1.0.0');
    await install(app, 'sample-desk', '1.0.0');
    await store.writeCatalogCache(feed(row({ key: 'sample-desk', version: '1.1.0' })), 1);

    expect((await catalogOf(app)).apps[0]).toMatchObject({
      key: 'sample-desk',
      source: 'disk',
      state: 'installed',
      version: '1.0.0',
      updateTo: '1.1.0',
      updateStaged: false,
    });

    // Downloaded (here: uploaded) — the same update, now needing no network.
    await upload(app, 'sample-desk', '1.1.0');
    expect((await catalogOf(app)).apps[0]).toMatchObject({
      version: '1.1.0',
      installedVersion: '1.0.0',
      updateTo: '1.1.0',
      updateStaged: true,
    });
    await app.close();
  });

  it('prefers a staged update to a newer catalog release this server cannot take', async () => {
    const app = await buildApp('0.2.8');
    await upload(app, 'sample-desk', '1.0.0');
    await install(app, 'sample-desk', '1.0.0');
    await upload(app, 'sample-desk', '1.1.0');
    await store.writeCatalogCache(
      feed(row({ key: 'sample-desk', version: '2.0.0', minAdminiumVersion: '0.3.0' })),
      1,
    );
    expect((await catalogOf(app)).apps[0]).toMatchObject({
      updateTo: '1.1.0',
      updateStaged: true,
      needsNewerAdminium: { version: '2.0.0', minAdminiumVersion: '0.3.0' },
    });
    await app.close();
  });

  it('offers nothing from a cache in another format, and says it was never fetched', async () => {
    const app = await buildApp();
    await store.writeCatalogCache({ schemaVersion: 2, generatedAt: 'x', addOns: [row()] }, 1);
    const body = await catalogOf(app);
    expect(body.apps).toEqual([]);
    expect(body.catalogFetchedAt).toBeNull();
    await app.close();
  });

  it('offers nothing from the cache while the switch is off, but still translates disk rows', async () => {
    // A cache written while the switch was on outlives it being turned off.
    catalogState = { enabled: false, networkFeatures: true };
    await userPrefsRepo(meta).set(user.id, { locale: 'fr_FR' });
    const app = await buildApp('0.2.7');
    await upload(app, 'sample-desk', '1.0.0');
    await install(app, 'sample-desk', '1.0.0');
    await store.writeCatalogCache(
      feed(
        row({ key: 'sample-desk', version: '1.1.0', tagline: { en: 'Desk.', fr: 'Bureau.' } }),
        row({ key: 'hotel', version: '0.1.1' }),
        row({ key: 'clinic', version: '0.1.2', minAdminiumVersion: '0.2.8' }),
      ),
      1,
    );

    const body = await catalogOf(app);
    expect(body.onlineEnabled).toBe(false);
    expect(body.apps.map((a) => a.key)).toEqual(['sample-desk']);
    expect(body.apps[0]).toMatchObject({
      description: 'Bureau.',
      updateTo: null,
      needsNewerAdminium: null,
    });
    await app.close();
  });

  it('reports online browsing off when the composition has no catalog client', async () => {
    catalogState = null;
    const app = await buildApp();
    expect((await catalogOf(app)).onlineEnabled).toBe(false);
    await app.close();
  });
});

describe('PUT /apps/catalog', () => {
  it('stores the app switch, never the add-on one, and audits the change', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/apps/catalog', payload: { enabled: true } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ onlineEnabled: true, vetoed: false });

    expect(await settingsRepo(meta).get(APP_CATALOG_ENABLED_SETTING)).toBe(true);
    expect(await settingsRepo(meta).get(CATALOG_ENABLED_SETTING)).toBe(false);

    const [audit] = await appAudit();
    expect(audit).toMatchObject({
      action: 'app.catalog-toggled',
      changes: { before: { onlineEnabled: false }, after: { onlineEnabled: true } },
    });
    await app.close();
  });

  it('says so when ADMINIUM_NETWORK_FEATURES vetoes the stored answer', async () => {
    catalogState = { enabled: true, networkFeatures: false };
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/apps/catalog', payload: { enabled: true } });
    expect(res.json()).toEqual({ onlineEnabled: false, vetoed: true });
    await app.close();
  });
});

describe('POST /apps/catalog/refresh and /apps/download', () => {
  it('refuses both with a reason while the catalog is off, and enqueues nothing', async () => {
    catalogState = { enabled: false, networkFeatures: true };
    const app = await buildApp();
    await store.writeCatalogCache(feed(row()), 1);

    const refresh = await app.inject({ method: 'POST', url: '/apps/catalog/refresh' });
    expect(refresh.statusCode).toBe(422);
    expect(refresh.json().error.details.reason).toBe('CATALOG_DISABLED');

    const download = await app.inject({
      method: 'POST',
      url: '/apps/download',
      payload: { key: 'clinic', version: '0.1.2' },
    });
    expect(download.statusCode).toBe(422);
    expect(download.json().error.details.reason).toBe('CATALOG_DISABLED');

    expect(await meta.db.selectFrom('adminium_jobs').selectAll().execute()).toEqual([]);
    await app.close();
  });

  it('enqueues a refresh', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/apps/catalog/refresh' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await jobsRepo(meta).findById(res.json().jobId))?.kind).toBe(APP_CATALOG_REFRESH_KIND);
    await app.close();
  });

  it('enqueues one download of a cached row, with one attempt', async () => {
    const app = await buildApp();
    await store.writeCatalogCache(feed(row()), 1);
    const res = await app.inject({
      method: 'POST',
      url: '/apps/download',
      payload: { key: 'clinic', version: '0.1.2' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await jobsRepo(meta).findById(res.json().jobId)).toMatchObject({
      kind: APP_DOWNLOAD_KIND,
      maxAttempts: 1,
      payload: { key: 'clinic', version: '0.1.2', userId: user.id },
    });
    await app.close();
  });

  it('refuses at once a release the cache does not offer, or that needs a newer Adminium', async () => {
    const app = await buildApp('0.2.7');
    const none = await app.inject({
      method: 'POST',
      url: '/apps/download',
      payload: { key: 'clinic', version: '0.1.2' },
    });
    expect(none.statusCode).toBe(422);
    expect(none.json().error.details.reason).toBe('UNKNOWN_APP');

    await store.writeCatalogCache(feed(row()), 1);
    const newer = await app.inject({
      method: 'POST',
      url: '/apps/download',
      payload: { key: 'clinic', version: '0.1.2' },
    });
    expect(newer.statusCode).toBe(422);
    expect(newer.json().error).toMatchObject({
      message: expect.stringContaining('needs Adminium 0.2.8 or later; this server is 0.2.7'),
      details: { reason: 'REQUIRES_NEWER_ADMINIUM', minAdminiumVersion: '0.2.8', serverVersion: '0.2.7' },
    });
    expect(await meta.db.selectFrom('adminium_jobs').selectAll().execute()).toEqual([]);
    await app.close();
  });
});

describe('POST /apps/:key/update', () => {
  const VISITS: Table = {
    ref: 'visits',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'note', type: 'text' },
    ],
  };

  it('moves the installed row to the newest staged version, keeping its connection', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', '1.0.0');
    await install(app, 'sample-desk', '1.0.0');
    const repo = manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v });
    const [before] = await repo.list('app');
    // The operator's database now holds what 1.0.0 created.
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];

    await upload(app, 'sample-desk', '1.1.0', [CLINICIANS, VISITS]);
    const res = await app.inject({ method: 'POST', url: '/apps/sample-desk/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      from: '1.0.0',
      to: '1.1.0',
      pruned: ['1.0.0'],
      app: {
        key: 'sample-desk',
        version: '1.1.0',
        connectionId: CONNECTION,
        schema: { created: ['visits'], reused: ['clinicians'] },
      },
    });

    // The SAME row, at the new version: an update is not a reinstall.
    const after = await repo.list('app');
    expect(after).toHaveLength(1);
    expect(after[0]?.row).toMatchObject({
      id: before!.row.id,
      version: '1.1.0',
      connectionId: CONNECTION,
      installedAt: before!.row.installedAt,
    });
    // Served from the new tree without a restart, and the old one is gone.
    expect(installed.current().map((s) => s.root)).toEqual([
      expect.stringContaining(join('sample-desk', '1.1.0')),
      expect.stringContaining(join('sample-desk', '1.1.0')),
    ]);
    expect(await store.versions('sample-desk')).toEqual(['1.1.0']);

    const tables = await sourceDb.introspection.getTables();
    expect(tables.map((t) => t.name).sort()).toEqual(['clinicians', 'visits']);

    const updated = (await appAudit()).find((r) => r.action === 'app.updated');
    expect(updated?.changes).toMatchObject({
      after: { key: 'sample-desk', from: '1.0.0', to: '1.1.0', pruned: ['1.0.0'], created: ['visits'] },
    });
    await app.close();
  });

  it('refuses an update that needs columns an existing table lacks, and changes nothing', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', '1.0.0');
    await install(app, 'sample-desk', '1.0.0');
    existingTables = [{ ref: 'clinicians', columns: [{ ref: 'id' }, { ref: 'name' }] }];

    const wider: Table = { ...CLINICIANS, columns: [...CLINICIANS.columns, { ref: 'email', type: 'text' }] };
    await upload(app, 'sample-desk', '1.1.0', [wider]);
    const res = await app.inject({ method: 'POST', url: '/apps/sample-desk/update' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toMatchObject({
      reason: 'COLUMNS_REQUIRED',
      tables: [{ ref: 'clinicians', missingColumns: ['email'] }],
    });

    const [row0] = await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app');
    expect(row0?.row.version).toBe('1.0.0');
    // Nothing pruned: the running version is still on disk.
    expect(await store.versions('sample-desk')).toEqual(['1.1.0', '1.0.0']);
    expect((await appAudit()).map((r) => r.action)).not.toContain('app.updated');
    await app.close();
  });

  it('refuses when nothing newer is staged, or the app is not installed', async () => {
    const app = await buildApp();
    const missing = await app.inject({ method: 'POST', url: '/apps/sample-desk/update' });
    expect(missing.statusCode).toBe(404);

    await upload(app, 'sample-desk', '1.0.0');
    await install(app, 'sample-desk', '1.0.0');
    const none = await app.inject({ method: 'POST', url: '/apps/sample-desk/update' });
    expect(none.statusCode).toBe(404);
    expect(none.json().error.message).toContain('No newer version of "sample-desk" than 1.0.0 is staged');
    await app.close();
  });

  it('refuses a staged tree that no longer matches its unpack, and audits it', async () => {
    const app = await buildApp();
    await upload(app, 'sample-desk', '1.0.0');
    await install(app, 'sample-desk', '1.0.0');
    await upload(app, 'sample-desk', '1.1.0');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dataDir, 'apps', 'sample-desk', '1.1.0', 'staff', 'index.html'), 'PWNED');

    const res = await app.inject({ method: 'POST', url: '/apps/sample-desk/update' });
    expect(res.statusCode).toBe(422);
    const refused = (await appAudit()).find((r) => r.action === 'app.verify-refused');
    expect(refused?.changes).toMatchObject({ after: { key: 'sample-desk', version: '1.1.0', from: '1.0.0' } });
    expect((await store.versions('sample-desk'))).toEqual(['1.1.0', '1.0.0']);
    await app.close();
  });
});
