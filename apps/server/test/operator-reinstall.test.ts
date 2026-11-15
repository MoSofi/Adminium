// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /api/v1/operator/reinstall`: the catalog packages a restored (or
 * wiped) server lacks are downloaded again without a person.
 *
 * The reinstaller runs against a real meta store, a REAL app store on a temp
 * dir and the download job's own function (`downloadAppRelease`), with a stub
 * catalog client serving real npm-shaped archives: so a package that comes
 * back went through the integrity check and the hardened unpack, as Studio's
 * Download does. The route is then checked on the composed server: only with
 * the operator's token, audited as the operator, and a package it cannot fetch
 * is reported, never a failed call.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { gzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditRepo, createSqliteMetaDb, firstRun, manifestsRepo, settingsRepo, type InstalledManifest, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import { APP_CATALOG_ENABLED_SETTING, type AppCatalog, type AppCatalogClient, type AppCatalogEntry } from '../src/apps/catalog.js';
import { createAppStore, type AppStore } from '../src/apps/store.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { OPERATOR_ACTOR_LABEL } from '../src/operator/endpoint.js';
import { appReinstallSide, createPackageReinstaller, type ReinstallSide } from '../src/operator/reinstall.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const BLOCK = 512;

function put(b: Uint8Array, at: number, len: number, v: string): void {
  b.set(Buffer.from(v, 'latin1').subarray(0, len), at);
}

/** An npm-shaped `.tgz` of `files` under `package/` (as `app-catalog-routes.test.ts` builds them). */
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
  return gzipSync(flat, { mtime: 0 });
}

function manifestFor(key: string, version: string) {
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
    requiredSchema: { tables: [{ ref: 'clinicians', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text' }] }] },
    pages: [],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const tarballFor = (key: string, version: string): Uint8Array =>
  packageTarball({ 'manifest.json': JSON.stringify(manifestFor(key, version)), 'staff/index.html': `<!doctype html><body data-version="${version}"></body>` });

function row(key: string, version: string, integrity: string): AppCatalogEntry {
  return {
    key,
    version,
    integrity,
    name: { en: key },
    tagline: { en: 'A desk.' },
    categories: ['operations'],
    capabilities: [],
    publisher: 'Adminium',
    sides: ['staff'],
    minAdminiumVersion: '0.2.8',
  };
}

let meta: MetaDb;
let dataDir: string;
let store: AppStore;
/** What the stub catalog was asked. */
let calls: { catalog: number; tarballs: string[] };
let catalogOn: boolean;
/** What the stub catalog offers: key → version. */
let offers: Map<string, string>;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  dataDir = await mkdtemp(join(tmpdir(), 'operator-reinstall-'));
  store = createAppStore({ dataDir });
  calls = { catalog: 0, tarballs: [] };
  catalogOn = true;
  offers = new Map([
    ['clinic', '0.1.2'],
    ['kept', '1.0.0'],
  ]);
});

afterEach(async () => {
  await meta.db.destroy();
  await rm(dataDir, { recursive: true, force: true });
});

function stubCatalog(): AppCatalogClient {
  return {
    isEnabled: async () => catalogOn,
    networkFeaturesAllowed: () => true,
    fetchCatalog: async (): Promise<AppCatalog> => {
      calls.catalog += 1;
      return {
        format: 'adminium-marketplace/1',
        unavailable: [],
        skipped: [],
        generatedAt: '2026-11-15T00:00:00Z',
        apps: [...offers].map(([key, version]) => row(key, version, sha512Integrity(tarballFor(key, version)))),
      };
    },
    fetchTarball: async (entry) => {
      calls.tarballs.push(`${entry.key}@${entry.version}`);
      return tarballFor(entry.key, entry.version);
    },
    fetchPicture: async () => {
      throw new Error('no pictures here');
    },
  };
}

async function installRow(key: string, version: string, source = 'marketplace'): Promise<InstalledManifest> {
  return manifestsRepo(meta, PLAIN).install({ manifestKey: key, version, kind: 'app', source, document: manifestFor(key, version) });
}

function reinstaller(extra: { sides?: ReinstallSide[]; changed?: () => void; kept?: InstalledManifest[] } = {}) {
  const repo = manifestsRepo(meta, PLAIN);
  const apps = appReinstallSide(
    { meta, store, catalog: stubCatalog(), serverVersion: '0.3.58', actorLabel: OPERATOR_ACTOR_LABEL },
    {
      installed: () => repo.list('app'),
      skip: ({ row: installed }) => installed.source === 'folder',
      changed: async () => extra.changed?.(),
    },
  );
  return createPackageReinstaller({
    sides: [...(extra.sides ?? []), apps],
    keepCopy: async (installed) => {
      extra.kept?.push(installed);
    },
    log: () => undefined,
  });
}

describe('the package reinstaller', () => {
  it('downloads the missing ones through the download job, reports what is here and what the catalog lacks', async () => {
    await installRow('clinic', '0.1.2');
    await installRow('kept', '1.0.0');
    await installRow('gone', '2.0.0');
    await installRow('own', '0.0.1', 'folder');
    // `kept` is on this server already.
    const keptBytes = tarballFor('kept', '1.0.0');
    await store.stage({ key: 'kept', version: '1.0.0', tarball: keptBytes, expectedIntegrity: sha512Integrity(keptBytes) });

    let changed = 0;
    const kept: InstalledManifest[] = [];
    const result = await reinstaller({ changed: () => (changed += 1), kept }).reinstall();

    expect(result.reinstalled).toEqual([{ kind: 'app', key: 'clinic', version: '0.1.2' }]);
    expect(result.present).toEqual([{ kind: 'app', key: 'kept', version: '1.0.0' }]);
    expect(result.failed).toEqual([expect.objectContaining({ kind: 'app', key: 'gone', version: '2.0.0', reason: 'UNKNOWN_APP' })]);
    // The folder app was never asked about.
    expect(calls.tarballs).toEqual(['clinic@0.1.2']);
    // Nothing was cached: the catalog was read once, for both missing packages.
    expect(calls.catalog).toBe(1);
    expect(await store.versions('clinic')).toContain('0.1.2');
    expect(changed).toBe(1);
    expect(kept.map((installed) => installed.row.manifestKey)).toEqual(['clinic']);

    // Audited as the operator, under the download's own actions.
    const audit = await auditRepo(meta).list({ limit: 50 });
    const staged = audit.find((entry) => entry.action === 'app.staged');
    expect(staged?.actorLabel).toBe(OPERATOR_ACTOR_LABEL);
    expect(audit.find((entry) => entry.action === 'app.catalog-refreshed')?.actorLabel).toBe(OPERATOR_ACTOR_LABEL);
  });

  it('is idempotent: a second call finds everything it put back already here', async () => {
    await installRow('clinic', '0.1.2');
    const run = reinstaller();
    expect((await run.reinstall()).reinstalled).toHaveLength(1);
    const again = await run.reinstall();
    expect(again).toEqual({ reinstalled: [], present: [{ kind: 'app', key: 'clinic', version: '0.1.2' }], failed: [] });
    expect(calls.tarballs).toEqual(['clinic@0.1.2']);
  });

  it('runs one call at a time: two at once download once', async () => {
    await installRow('clinic', '0.1.2');
    const run = reinstaller();
    const [first, second] = await Promise.all([run.reinstall(), run.reinstall()]);
    expect(first.reinstalled).toHaveLength(1);
    expect(second.present).toEqual([{ kind: 'app', key: 'clinic', version: '0.1.2' }]);
    expect(calls.tarballs).toEqual(['clinic@0.1.2']);
  });

  it('reports every package when the catalog is off, a version it no longer offers, and a side that throws, without failing', async () => {
    await installRow('clinic', '0.1.2');
    catalogOn = false;
    const off = await reinstaller().reinstall();
    expect(off.failed).toEqual([expect.objectContaining({ key: 'clinic', reason: 'CATALOG_DISABLED' })]);
    expect(calls.catalog).toBe(0);

    catalogOn = true;
    offers.set('clinic', '0.2.0');
    const moved = await reinstaller().reinstall();
    expect(moved.failed).toEqual([expect.objectContaining({ key: 'clinic', version: '0.1.2', reason: 'UNKNOWN_APP' })]);

    // An add-on side whose catalog cannot be read: its package fails, the apps still come back.
    offers.set('clinic', '0.1.2');
    const broken: ReinstallSide = {
      kind: 'add-on',
      store: { versions: async () => [] },
      installed: async () => [{ row: { manifestKey: 'stamps', version: '1.0.0' } } as InstalledManifest],
      catalogOn: async () => true,
      offered: async () => false,
      refresh: async () => {
        throw Object.assign(new Error('the catalog host did not answer'), { reason: 'FETCH_FAILED' });
      },
      download: async () => undefined,
      changed: async () => undefined,
    };
    const mixed = await reinstaller({ sides: [broken] }).reinstall();
    expect(mixed.failed).toEqual([{ kind: 'add-on', key: 'stamps', version: '1.0.0', reason: 'FETCH_FAILED', message: 'the catalog host did not answer' }]);
    expect(mixed.reinstalled).toEqual([{ kind: 'app', key: 'clinic', version: '0.1.2' }]);
  });
});

describe('POST /api/v1/operator/reinstall', () => {
  const TOKEN = 'c3'.repeat(32);
  let composed: ComposedServer | null = null;

  afterEach(async () => {
    await composed?.app.close();
    composed = null;
  });

  async function serve(): Promise<ComposedServer> {
    const env = enforceProfile(
      makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir, ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: '127.0.0.1:4798' }),
    );
    const runService = createRunService({ meta });
    composed = await composeServer({
      env,
      metaStore: { meta, url: 'sqlite::test', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: { templates: [], widgets: [], widgetContracts: {} },
      logger: false,
      telemetry: false,
      onMetaRelocated: () => undefined,
    });
    await composed.app.ready();
    return composed;
  }

  const ask = (server: ComposedServer, token: string | null) =>
    server.app.operatorEndpoint!.server.inject({
      method: 'POST',
      url: '/api/v1/operator/reinstall',
      headers: { host: '127.0.0.1:4798', ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      remoteAddress: '10.0.0.9',
    });

  it('is refused without the operator token, and is not on the public listener', async () => {
    const server = await serve();
    expect((await ask(server, null)).statusCode).toBe(401);
    expect((await ask(server, 'd4'.repeat(32))).statusCode).toBe(401);
    const res = await server.app.inject({ method: 'POST', url: '/api/v1/operator/reinstall', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(404);
    expect((await auditRepo(meta).list({ limit: 50 })).some((entry) => entry.action === 'operator.packages.reinstalled')).toBe(false);
  });

  it('answers what it did for each Missing install, and audits the call as the operator', async () => {
    // A restored install whose files are not here, on a server with its app list switched off.
    await settingsRepo(meta).set(APP_CATALOG_ENABLED_SETTING, false);
    await installRow('clinic', '0.1.2');
    const server = await serve();
    const res = await ask(server, TOKEN);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { reinstalled: unknown[]; present: unknown[]; failed: { key: string; reason: string }[] } };
    expect(body.data.reinstalled).toEqual([]);
    expect(body.data.failed).toEqual([expect.objectContaining({ kind: 'app', key: 'clinic', version: '0.1.2', reason: 'CATALOG_DISABLED' })]);

    const audit = (await auditRepo(meta).list({ limit: 50 })).find((entry) => entry.action === 'operator.packages.reinstalled');
    expect(audit?.actorLabel).toBe(OPERATOR_ACTOR_LABEL);
    expect(audit?.actorKind).toBe('system');
    expect(JSON.stringify(audit?.changes)).toContain('CATALOG_DISABLED');
  });
});
