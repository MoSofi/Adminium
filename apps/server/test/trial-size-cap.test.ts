// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial's size caps: each database on the operator's host and the data
 * folder, measured and held; the per-file upload limit; the pools.
 *
 * Every switch is shown both ways: on in trial mode, absent on an ordinary
 * server and under the hosted profile (which drops the caps). The hold is
 * proved on a real Postgres through the data routes: inserts and updates
 * refused, deletes allowed, a connection probe leaves it in place, and it lets
 * go below 90% of the limit. The measurement itself runs against real Postgres
 * and MySQL: a delete shows, and a vacuum does not undo it.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, sql } from 'kysely';
import { connectionsRepo, createSqliteMetaDb, firstRun, newId, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile, loadEnv } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { providerFromModule } from '../src/connections/register-adapters.js';
import { statementEffect } from '../src/connections/write-hold.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import type { HostLookup } from '../src/net/address-guard.js';
import { trialPolicy } from '../src/trial/policy.js';
import { OffByOperatorError } from '../src/trial/refuse.js';
import { createSizeCap, measureMysql, measurePostgres, refuseDesignerWrite, useStorageHold, type SizeCap, type SizeCapSources } from '../src/trial/size-cap.js';
import { createJail } from '../src/designer/jail.js';
import { createTestFileStore } from './helpers/file-store.js';
import { asUser, buildDataTestApp, createConnectionViaApi, createNorthwindDb, introspectViaApi, PG_HOST, PG_PORT, pgAvailable, psql, type DataTestContext, type TestPg } from './connections-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const MB = 1024 * 1024;
const PASSWORD = 'a-long-enough-test-password-1!';
const SETUP_TOKEN = 'a-long-enough-setup-token';
const ORIGIN_HOST = 'hollis.try.example.com';

const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543',
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
  ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis',
};
const HOSTED = {
  ADMINIUM_HOSTED_MODE: 'on',
  ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543',
  ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis',
};
const ORDINARY = { ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543' };
const PROFILES = { trial: TRIAL, hosted: HOSTED, off: ORDINARY } as const;

const NOTHING_RESOLVES: HostLookup = async () => Promise.reject(new Error('ENOTFOUND'));

const refusal = (question: string) => ({ code: 'OFF_BY_OPERATOR', details: { question, reason: 'size-cap' } });

// ─── What a statement does ────────────────────────────────────────────────────

describe('what a statement does to the size of a database', () => {
  it.each([
    ['insert into "orders" ("id") values ($1)', 'grow'],
    ['INSERT INTO t VALUES (1) ON CONFLICT (id) DO UPDATE SET a = 1', 'grow'],
    ['  /* a note */ -- and another\n  insert into t values (1)', 'grow'],
    ['merge into t using s on t.id = s.id when matched then update set a = 1', 'grow'],
    ['replace into t values (1)', 'grow'],
    ['copy t from stdin', 'grow'],
    ['create table "notes" ("id" integer)', 'grow'],
    ['create index "i" on "t" ("a")', 'grow'],
    ['create schema "more"', 'grow'],
    ['alter table "t" add column "c" text', 'grow'],
    ['ALTER TABLE `t` DROP COLUMN `a`, ADD COLUMN `b` text', 'grow'],
    ['alter table "t" alter column "a" type bigint', 'grow'],
    ['with moved as (delete from a returning *) insert into b select * from moved', 'grow'],
    ['select 1; insert into t values (1)', 'grow'],
    ['update "t" set "a" = $1 where "id" = $2', 'update'],
    ['delete from "t" where "id" = $1', 'shrink'],
    ['truncate table "t"', 'shrink'],
    ['drop table "t"', 'shrink'],
    ['alter table "public"."t" drop column "type"', 'shrink'],
    ['alter table t rename to u', 'shrink'],
    ['select * from "t" for update', 'read'],
    ['with x as (select 1) select * from x', 'read'],
    ['set session information_schema_stats_expiry = 0', 'read'],
    ['begin', 'read'],
  ] as const)('%s → %s', (text, effect) => {
    expect(statementEffect(text)).toBe(effect);
  });
});

// ─── The hold, its measure and its release ────────────────────────────────────

/** Sources for a size cap: one connection per id, every one on the operator's host but `own`. */
function fakeSources(ids: readonly string[], own: readonly string[] = []): SizeCapSources {
  const row = (id: string) => ({ id, engine: 'postgres', sourceKind: 'dsn', disabled: false });
  return {
    connections: {
      list: async () => ids.map(row),
      findById: async (id) => (ids.includes(id) ? row(id) : null),
      getDsns: async (id) => ({ dataDsn: own.includes(id) ? 'postgres://me:pw@db.abcdefgh.supabase.co:5432/postgres' : 'postgres://trial_hollis:pw@pg-trials:5432/trial_hollis' }),
    },
    data: async () => ({ db: {} as Kysely<never> }),
    databaseHosts: [
      { host: 'pg-trials', port: 5432, wildcard: false },
      { host: 'supabase.co', port: 5432, wildcard: true },
    ],
  };
}

describe('a database held by the size cap', () => {
  let sizes: Map<string, number>;
  let cap: SizeCap;
  let measured: string[];
  const make = (delays = {}) => {
    sizes = new Map([['conn_a', 400 * MB]]);
    measured = [];
    cap = createSizeCap({
      limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 1000 * MB },
      sources: fakeSources(['conn_a', 'conn_own'], ['conn_own']),
      dataDir: '/nonexistent',
      measureWith: async () => {
        measured.push('conn_a');
        return sizes.get('conn_a') ?? 0;
      },
      delays,
    });
  };
  afterEach(() => {
    cap.stop();
  });

  it('holds past the limit and lets go only below 90% of it', async () => {
    make();
    expect((await cap.measure('conn_a'))?.held).toBe(false);
    expect(cap.held('conn_a')).toBeNull();
    sizes.set('conn_a', 501 * MB);
    expect((await cap.measure('conn_a'))?.held).toBe(true);
    expect(cap.held('conn_a')).toMatchObject({ question: 'dataOverCap', reason: 'size-cap' });
    expect(cap.held('conn_a')?.message).toBe("This database is over the trial's 500 MB limit, so it is read-only. Delete some rows to continue.");
    // Back under the limit but not under 90%: still held, so it does not flap at the line.
    sizes.set('conn_a', 460 * MB);
    expect((await cap.measure('conn_a'))?.held).toBe(true);
    sizes.set('conn_a', 449 * MB);
    expect((await cap.measure('conn_a'))?.held).toBe(false);
    expect(cap.held('conn_a')).toBeNull();
  });

  it('never measures the person’s own Supabase project', async () => {
    make();
    expect(await cap.measure('conn_own')).toBeNull();
    expect(measured).toEqual([]);
    // A write to it asks nothing more.
    cap.wrote('conn_own', 'grow');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(measured).toEqual([]);
  });

  it('measures again soon after a delete, and after a write that adds once the last reading is old enough', async () => {
    make({ afterDelete: 10, afterGrowth: 200 });
    sizes.set('conn_a', 600 * MB);
    await cap.measure('conn_a');
    expect(cap.held('conn_a')).not.toBeNull();
    sizes.set('conn_a', 100 * MB);
    cap.wrote('conn_a', 'shrink');
    await vi.waitFor(() => expect(cap.held('conn_a')).toBeNull(), { timeout: 2000 });
    // A stream of writes that add: one reading, after the gap.
    const before = measured.length;
    for (let i = 0; i < 20; i += 1) cap.wrote('conn_a', 'grow');
    await vi.waitFor(() => expect(measured.length).toBe(before + 1), { timeout: 2000 });
  });

  it('measures before an import, and refuses one while held', async () => {
    make();
    sizes.set('conn_a', 501 * MB);
    await expect(cap.beforeImport('conn_a')).rejects.toMatchObject({ statusCode: 403, ...refusal('dataOverCap') });
    sizes.set('conn_a', 10 * MB);
    await expect(cap.beforeImport('conn_a')).resolves.toBeUndefined();
  });

  it('keeps a hold through a pause and a resume, and measures again before the next write adds anything', async () => {
    const row = { id: 'conn_a', engine: 'postgres', sourceKind: 'dsn', disabled: false };
    const sources: SizeCapSources = { ...fakeSources(['conn_a']), connections: { list: async () => [row], findById: async () => row, getDsns: async () => ({ dataDsn: 'postgres://u:p@pg-trials:5432/db' }) } };
    let measures = 0;
    cap = createSizeCap({ limits: { dataMaxBytes: 100, storageMaxBytes: 1e12 }, sources, dataDir: '/nonexistent', measureWith: async () => ((measures += 1), 1000), delays: { afterGrowth: 0 } });
    await cap.measureAll();
    expect(cap.held('conn_a')).not.toBeNull();
    row.disabled = true;
    // The ten-minute round while it is paused.
    await cap.measureAll();
    row.disabled = false;
    expect(cap.held('conn_a')).not.toBeNull();
    // Resumed: its data handle opens again, and the first write that adds waits for a reading.
    cap.opened('conn_a');
    const before = measures;
    await cap.settle('conn_a');
    expect(measures).toBe(before + 1);
    expect(cap.held('conn_a')).not.toBeNull();
    // Measured since it opened: the next write asks nothing more.
    await cap.settle('conn_a');
    expect(measures).toBe(before + 1);
  });

  it('after a restart, holds nothing back from a write until the database is measured, then holds it', async () => {
    make();
    sizes.set('conn_a', 501 * MB);
    expect(measured).toEqual([]);
    await cap.settle('conn_a');
    expect(measured).toEqual(['conn_a']);
    expect(cap.held('conn_a')).not.toBeNull();
    // Not on an operator host: one look, and nothing to wait for after.
    await cap.settle('conn_own');
    await cap.settle('conn_own');
    expect(measured).toEqual(['conn_a']);
  });

  it('refuses a write it could not measure the database for', async () => {
    cap = createSizeCap({
      limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 1000 * MB },
      sources: fakeSources(['conn_a']),
      dataDir: '/nonexistent',
      measureWith: async () => Promise.reject(new Error('unreachable')),
    });
    await expect(cap.settle('conn_a')).rejects.toMatchObject(refusal('dataOverCap'));
    cap.stop();
    cap = createSizeCap({
      limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 1000 * MB },
      sources: fakeSources(['conn_a']),
      dataDir: '/nonexistent',
      measureWith: async () => new Promise(() => undefined),
      delays: { settleWait: 20 },
    });
    await expect(cap.settle('conn_a')).rejects.toThrow(/being measured/);
  });

  it('reads every table again after a delete while held, and once more once the database’s own counts have caught up', async () => {
    const fresh: boolean[] = [];
    cap = createSizeCap({
      limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 1000 * MB },
      sources: fakeSources(['conn_a']),
      dataDir: '/nonexistent',
      measureWith: async (_engine, _db, options) => (fresh.push(options.fresh === true), 600 * MB),
      delays: { afterDelete: 10, afterDeleteLate: 40 },
    });
    await cap.measure('conn_a');
    cap.wrote('conn_a', 'shrink');
    await vi.waitFor(() => expect(fresh).toEqual([false, true, true]), { timeout: 2000 });
  });

  it('leaves Adminium’s own tables out only where the meta store shares the database', async () => {
    const skipped: boolean[] = [];
    for (const shares of [false, true]) {
      cap = createSizeCap({
        limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 1000 * MB },
        sources: { ...fakeSources(['conn_a']), metaSharesDatabaseWith: () => shares },
        dataDir: '/nonexistent',
        measureWith: async (_engine, _db, options) => (skipped.push(options.skipMetaTables === true), 1),
      });
      await cap.measure('conn_a');
      cap.stop();
    }
    expect(skipped).toEqual([false, true]);
  });

  it('tells a listener every reading, the data folder’s too', async () => {
    make();
    const heard: string[] = [];
    const stop = cap.listen((event) => heard.push(event.kind));
    await cap.measureAll();
    stop();
    await cap.measureAll();
    expect(heard).toEqual(['data', 'storage']);
  });
});

// ─── The data folder ──────────────────────────────────────────────────────────

describe('the data folder’s cap', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'size-cap-folder-'));
  });
  afterAll(async () => {
    useStorageHold(null);
    await rm(dir, { recursive: true, force: true });
  });

  it('counts what the Designer writes, and keeps room for writes under way', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'size-cap-empty-'));
    const project = await mkdtemp(join(tmpdir(), 'size-cap-project-'));
    try {
      const cap = createSizeCap({ limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 100 * MB }, sources: fakeSources([]), dataDir: empty, delays: { afterStore: 60_000 } });
      await cap.measureStorage();
      useStorageHold(cap);
      createJail(project, 'shop').write('apps/shop/pages/home.json', 'x'.repeat(1000));
      expect(cap.storage().usedBytes).toBe(1000);
      useStorageHold(null);
      cap.stored(90 * MB);
      // Two uploads side by side: the first keeps its room, the second finds none left.
      const first = cap.reserve(10 * MB);
      expect(() => cap.reserve(10 * MB)).toThrow(expect.objectContaining(refusal('storageOverCap')) as Error);
      first.cancel();
      const again = cap.reserve(10 * MB);
      again.done(11 * MB);
      expect(cap.storage().over).toBe(true);
      expect(() => cap.reserve(0)).toThrow(OffByOperatorError);
      cap.stop();
    } finally {
      useStorageHold(null);
      await rm(empty, { recursive: true, force: true });
      await rm(project, { recursive: true, force: true });
    }
  });

  it('walks the project the Designer writes to, less its packages and history', async () => {
    const project = await mkdtemp(join(tmpdir(), 'size-cap-walk-'));
    const data = await mkdtemp(join(tmpdir(), 'size-cap-walk-data-'));
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(project, '.adminium', 'designer'), { recursive: true });
      await writeFile(join(project, '.adminium', 'designer', 'picture.png'), Buffer.alloc(3000));
      await mkdir(join(project, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(join(project, 'node_modules', 'pkg', 'index.js'), Buffer.alloc(50_000));
      await mkdir(join(project, '.git'), { recursive: true });
      await writeFile(join(project, '.git', 'pack'), Buffer.alloc(50_000));
      await writeFile(join(data, 'upload.bin'), Buffer.alloc(2000));
      const cap = createSizeCap({ limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 100 * MB }, sources: fakeSources([]), dataDir: data, folders: [project] });
      expect((await cap.measureStorage()).usedBytes).toBe(5000);
      cap.stop();
    } finally {
      await rm(project, { recursive: true, force: true });
      await rm(data, { recursive: true, force: true });
    }
  });

  it('refuses uploads, the Designer’s writes and exports past its limit, and counts what is stored', async () => {
    await writeFile(join(dir, 'big.bin'), Buffer.alloc(2 * MB));
    const cap = createSizeCap({ limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 1 * MB }, sources: fakeSources([]), dataDir: dir, delays: { afterStore: 60_000 } });
    expect(cap.storage().over).toBe(false);
    expect((await cap.measureStorage()).usedBytes).toBeGreaterThanOrEqual(2 * MB);
    expect(() => cap.refuseStorage()).toThrow(OffByOperatorError);
    expect(() => cap.refuseStorage()).toThrow(expect.objectContaining(refusal('storageOverCap')) as Error);
    useStorageHold(cap);
    const project = await mkdtemp(join(tmpdir(), 'size-cap-project-'));
    try {
      expect(() => refuseDesignerWrite(1)).toThrow(OffByOperatorError);
      expect(() => createJail(project, 'shop').write('apps/shop/pages/home.json', '{}')).toThrow(OffByOperatorError);
      useStorageHold(null);
      expect(() => createJail(project, 'shop').write('apps/shop/pages/home.json', '{}')).not.toThrow();
    } finally {
      await rm(project, { recursive: true, force: true });
    }
    cap.stop();
  });

  it('holds every write the file store makes, and no upload past the per-file limit', async () => {
    const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(store);
    let full = false;
    let stored = 0;
    let kept = 0;
    const files = createTestFileStore({
      dataDir: dir,
      meta: store,
      guard: {
        reserve: (bytes) => {
          if (full) throw new OffByOperatorError('storageOverCap', 'size-cap', 'full');
          kept += bytes;
          let open = true;
          return {
            done: (actual) => {
              if (open) stored += actual;
              open = false;
            },
            cancel: () => {
              open = false;
            },
          };
        },
        uploadMaxBytes: 1000,
      },
    });
    const { Readable } = await import('node:stream');
    const csv = (bytes: number) => ({ id: newId('file'), kind: 'import', filename: 'a.csv', mime: 'text/csv', bytes: 'a\n'.padEnd(bytes, 'x') });
    await expect(files.write(csv(1001))).rejects.toMatchObject({ statusCode: 413, code: 'FILE_TOO_LARGE', details: { maxBytes: 1000 } });
    await files.write(csv(900));
    // An export is Adminium's own file: not an upload, held only by the folder's limit.
    await files.write({ ...csv(5000), kind: 'export' });
    expect(stored).toBe(5900);
    // Room was kept for each before it was written: its own size, known up front.
    expect(kept).toBe(1001 + 900 + 5000);
    // An upload asks the smaller of its own limit and the trial's.
    await expect(files.putUpload({ kind: 'upload', filename: 'a.csv', source: Readable.from([Buffer.alloc(1500, 0x61)]), maxBytes: 1_000_000, allowedTypes: ['csv'] })).rejects.toThrow(/1000/);
    full = true;
    await expect(files.write(csv(10))).rejects.toThrow(OffByOperatorError);
    await expect(files.openWriter({ id: 'file_x', kind: 'export', filename: 'x.csv', mime: 'text/csv' })).rejects.toThrow(OffByOperatorError);
    await expect(files.putUpload({ kind: 'upload', filename: 'a.csv', source: Readable.from([Buffer.from('a')]), maxBytes: 1_000_000, allowedTypes: ['csv'] })).rejects.toThrow(OffByOperatorError);
    await store.db.destroy();
  });

  it('adds what is stored between walks, and walks again after a burst', async () => {
    const cap = createSizeCap({ limits: { dataMaxBytes: 500 * MB, storageMaxBytes: 100 * MB }, sources: fakeSources([]), dataDir: dir, delays: { afterStore: 10 } });
    const walked = await cap.measureStorage();
    cap.stored(150 * MB);
    expect(cap.storage().over).toBe(true);
    // The walk finds the folder as it is: nothing that large was written.
    await vi.waitFor(() => expect(cap.storage().usedBytes).toBe(walked.usedBytes), { timeout: 2000 });
    expect(cap.storage().over).toBe(false);
    cap.stop();
  });
});

// ─── A composed server, in each profile ───────────────────────────────────────

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
  useStorageHold(null);
});

interface Served {
  store: MetaDb;
  call(method: 'GET' | 'POST', url: string, payload?: string | object, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }>;
}

/** A composed server on `env`, its first Super Admin signed in, its data folder `dataDir`. */
async function serve(env: Record<string, string>, dataDir: string, before?: (store: MetaDb) => Promise<void>): Promise<Served> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  await before?.(store);
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir, ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager: new ConnectionManager({
      meta: store,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
      blockLoopback: true,
      databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS,
      networkPolicy: parsed.ADMINIUM_NETWORK_POLICY,
      lookup: NOTHING_RESOLVES,
      policy: trialPolicy(parsed),
      operatorSourceUrl: parsed.ADMINIUM_SOURCE_URL,
    }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    headers: { host: ORIGIN_HOST, origin: `https://${ORIGIN_HOST}` },
    payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    store,
    call: async (method, url, payload, headers = {}) => {
      const res = await app.inject({ method, url, headers: { host: ORIGIN_HOST, cookie, ...headers }, ...(payload === undefined ? {} : { payload }) });
      return { status: res.statusCode, body: res.body === '' ? {} : (res.json() as Record<string, unknown>) };
    },
  };
}

describe('the caps on a composed server', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'size-cap-server-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each(['trial', 'hosted', 'off'] as const)('%s: says what it measured, to whoever is signed in', async (profile) => {
    const server = await serve(PROFILES[profile], dir);
    const caps = await server.call('GET', '/api/v1/system/size-caps');
    expect(caps.status).toBe(200);
    expect(caps.body['data']).toEqual([]);
    if (profile === 'trial') {
      expect(composed?.app.sizeCap).not.toBeNull();
      await vi.waitFor(() => expect(composed?.app.sizeCap?.storage().measuredAt).not.toBeNull());
      expect((await server.call('GET', '/api/v1/system/size-caps')).body['storage']).toMatchObject({ limitBytes: 1000 * MB, over: false });
    } else {
      expect(composed?.app.sizeCap).toBeNull();
      expect(caps.body['storage']).toBeNull();
    }
    const stranger = await composed?.app.inject({ method: 'GET', url: '/api/v1/system/size-caps', headers: { host: ORIGIN_HOST } });
    expect(stranger?.statusCode).toBe(401);
  });

  it.each(['trial', 'hosted', 'off'] as const)('%s: a CSV larger than the trial’s per-file limit', async (profile) => {
    const server = await serve({ ...PROFILES[profile], ...(profile === 'trial' ? { ADMINIUM_TRIAL_UPLOAD_MAX_MB: '1' } : {}) }, dir);
    const csv = `name,note\n${'Ada,' + 'x'.repeat(100) + '\n'}`.repeat(1).concat(Array.from({ length: 12_000 }, (_, i) => `row${String(i)},${'y'.repeat(100)}`).join('\n'));
    expect(Buffer.byteLength(csv)).toBeGreaterThan(MB);
    const up = await server.call('POST', '/api/v1/imports/upload?filename=big.csv', csv, { 'content-type': 'text/csv' });
    if (profile === 'trial') {
      expect(up.status).toBe(413);
      expect(up.body['error']).toMatchObject({ code: 'FILE_TOO_LARGE', details: { maxBytes: MB } });
    } else {
      expect(up.status, JSON.stringify(up.body)).toBe(201);
    }
  });

  it.each(['trial', 'hosted', 'off'] as const)('%s: past the data folder’s limit, uploads refused, everything still exported', async (profile) => {
    const full = await mkdtemp(join(tmpdir(), 'size-cap-full-'));
    try {
      await writeFile(join(full, 'big.bin'), Buffer.alloc(2 * MB));
      const server = await serve({ ...PROFILES[profile], ...(profile === 'trial' ? { ADMINIUM_TRIAL_STORAGE_MAX_MB: '1' } : {}) }, full);
      if (profile === 'trial') await vi.waitFor(() => expect(composed?.app.sizeCap?.storage().over).toBe(true));
      const up = await server.call('POST', '/api/v1/imports/upload?filename=small.csv', 'name\nAda\n', { 'content-type': 'text/csv' });
      const exported = await server.call('POST', '/api/v1/export/zip');
      if (profile === 'trial') {
        expect(up.status).toBe(403);
        expect(up.body['error']).toMatchObject(refusal('storageOverCap'));
        // Exporting everything is the way out: never refused by the cap.
        expect(exported.status, JSON.stringify(exported.body)).toBe(202);
      } else {
        expect(up.status, JSON.stringify(up.body)).toBe(201);
        expect(exported.status, JSON.stringify(exported.body)).toBe(202);
      }
    } finally {
      await composed?.app.close();
      composed = undefined;
      // An export may still be writing its file into the folder.
      await rm(full, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it.each(['trial', 'hosted', 'off'] as const)('%s: a fourth source connection', async (profile) => {
    const server = await serve(PROFILES[profile], dir, async (store) => {
      const repo = connectionsRepo(store, dsnCryptoFromSecret(TEST_SECRET));
      for (const name of ['one', 'two', 'three']) {
        await repo.create({ name, engine: 'postgres', dataDsn: HOSTED.ADMINIUM_SOURCE_URL, introspectDsn: HOSTED.ADMINIUM_SOURCE_URL });
      }
    });
    const res = await server.call('POST', '/api/v1/connections', { name: 'four', engine: 'postgres', dsn: HOSTED.ADMINIUM_SOURCE_URL });
    if (profile === 'trial') {
      expect(res.status).toBe(403);
      expect(res.body['error']).toMatchObject(refusal('extraSourceConnections'));
    } else {
      // Past the count: the host's lookup is what stops it here, never the cap.
      expect(res.status).not.toBe(403);
    }
  });
});

describe('the count of sources in a trial', () => {
  it('lets one of three side-by-side requests take the last room', async () => {
    const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(store);
    try {
      const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...TRIAL }));
      const manager = new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null, policy: trialPolicy(parsed), lookup: NOTHING_RESOLVES });
      for (const name of ['one', 'two']) {
        await manager.connections.create({ name, engine: 'postgres', dataDsn: HOSTED.ADMINIUM_SOURCE_URL, introspectDsn: HOSTED.ADMINIUM_SOURCE_URL });
      }
      // Each waits on its connection test before it creates, as the routes do.
      const add = (name: string) =>
        manager.withRoomForSource(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return manager.connections.create({ name, engine: 'postgres', dataDsn: HOSTED.ADMINIUM_SOURCE_URL, introspectDsn: HOSTED.ADMINIUM_SOURCE_URL });
        });
      const outcomes = await Promise.allSettled([add('three'), add('four'), add('five')]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      for (const outcome of outcomes.filter((one) => one.status === 'rejected')) expect(outcome.reason).toMatchObject(refusal('extraSourceConnections'));
      expect((await manager.connections.list()).filter((connection) => connection.sourceKind === 'dsn')).toHaveLength(3);
    } finally {
      await store.db.destroy();
    }
  });
});

describe('the pools', () => {
  const quiet = { write: () => true };
  const env = (vars: Record<string, string>) => loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ...vars }, quiet);

  it('are 3 against a source and the meta store in a trial, unless set lower', () => {
    const trial = env(TRIAL);
    expect([trial.ADMINIUM_SOURCE_POOL_MAX, trial.ADMINIUM_META_POOL_MAX]).toEqual([3, 3]);
    const lower = env({ ...TRIAL, ADMINIUM_SOURCE_POOL_MAX: '2', ADMINIUM_META_POOL_MAX: '8' });
    expect([lower.ADMINIUM_SOURCE_POOL_MAX, lower.ADMINIUM_META_POOL_MAX]).toEqual([2, 8]);
  });

  it('refuse a source pool above 3 in a trial', () => {
    let table = '';
    expect(() => loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ...TRIAL, ADMINIUM_SOURCE_POOL_MAX: '4' }, { write: (chunk: string) => ((table += chunk), true) })).toThrow();
    expect(table).toContain('ADMINIUM_SOURCE_POOL_MAX');
  });

  it.each(['hosted', 'off'] as const)('%s: keep their own defaults and any size', (profile) => {
    const vars = profile === 'hosted' ? HOSTED : ORDINARY;
    expect([env(vars).ADMINIUM_SOURCE_POOL_MAX, env(vars).ADMINIUM_META_POOL_MAX]).toEqual([undefined, undefined]);
    expect(env({ ...vars, ADMINIUM_SOURCE_POOL_MAX: '20' }).ADMINIUM_SOURCE_POOL_MAX).toBe(20);
  });
});

// ─── A real Postgres ──────────────────────────────────────────────────────────

const adapterReady = await (async () => {
  try {
    return providerFromModule(await import('@adminium/adapter-postgres')) !== null;
  } catch {
    return false;
  }
})();

describe.skipIf(!(adapterReady && pgAvailable()))('the size cap on a live Postgres (Northwind)', () => {
  let pg: TestPg;
  let t: DataTestContext;
  let id: string;
  let cap: SizeCap;
  let dir: string;
  const sources = (): SizeCapSources => ({
    connections: t.manager.connections,
    data: (connectionId) => t.manager.data(connectionId),
    databaseHosts: [{ host: PG_HOST, port: Number(PG_PORT), wildcard: false }],
  });
  const insert = (productId: number) =>
    t.app.inject({ method: 'POST', url: `/api/v1/data/${id}/public.products`, headers: asUser(t.users.admin), payload: { values: { product_id: productId, product_name: `Brew ${String(productId)}`, discontinued: 0 } } });
  const raw = async (text: string) => sql.raw(text).execute((await t.manager.data(id)).db);
  /** Measured until the database's row counts have caught up with `done` (Postgres sends them about once a second). */
  const measureUntil = async (done: (bytes: number) => boolean): Promise<number> => {
    let bytes = 0;
    await vi.waitFor(
      async () => {
        bytes = (await cap.measure(id))?.usedBytes ?? 0;
        expect(done(bytes)).toBe(true);
      },
      { timeout: 8000, interval: 300 },
    );
    return bytes;
  };

  beforeAll(async () => {
    pg = createNorthwindDb();
    // A table of known weight: 4,000 rows of about 1 KB each.
    psql(pg.database, "CREATE TABLE notes (id integer PRIMARY KEY, body text NOT NULL); INSERT INTO notes SELECT i, repeat(md5(i::text), 32) FROM generate_series(1, 4000) AS i; ANALYZE notes;");
    psql(pg.database, 'CREATE TABLE spare (id integer PRIMARY KEY); INSERT INTO spare VALUES (1), (2);');
    t = await buildDataTestApp();
    id = await createConnectionViaApi(t, pg.dsn);
    await introspectViaApi(t, id);
    await t.grantTable(t.roles.admin, id, '*', { read: true, create: true, update: true, delete: true });
    dir = await mkdtemp(join(tmpdir(), 'size-cap-pg-'));
  }, 60_000);

  afterAll(async () => {
    cap.stop();
    await t.app.close();
    pg.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('measures live data: a delete shows, and a vacuum does not undo it', async () => {
    cap = createSizeCap({ limits: { dataMaxBytes: 10_000 * MB, storageMaxBytes: 1000 * MB }, sources: sources(), dataDir: dir });
    const full = (await cap.measure(id))?.usedBytes ?? 0;
    const notesSize = (): number => Number(psql(pg.database, "SELECT pg_total_relation_size('notes')").trim());
    const physical = notesSize();
    // Every other row: no page is emptied, so a vacuum gives nothing back to the disk.
    psql(pg.database, 'DELETE FROM notes WHERE id % 2 = 0');
    const half = await measureUntil((bytes) => bytes < full - 1_500_000);
    // About 2,000 rows of about 1 KB went.
    expect(full - half).toBeGreaterThan(1_500_000);
    expect(full - half).toBeLessThan(3_200_000);
    psql(pg.database, 'VACUUM notes');
    // The table's files are as large as before (the vacuum adds its maps): only its live rows went down.
    expect(notesSize()).toBeGreaterThanOrEqual(physical);
    const vacuumed = (await cap.measure(id))?.usedBytes ?? 0;
    expect(Math.abs(vacuumed - half)).toBeLessThan(300_000);
    expect(await measurePostgres((await t.manager.data(id)).db)).toBe(vacuumed);
  });

  it('holds a database past its limit: inserts, updates and DDL that adds refused', async () => {
    // Before the hold: a product to delete later.
    expect((await insert(901)).statusCode).toBe(201);
    const used = (await cap.measure(id))?.usedBytes ?? 0;
    cap.stop();
    cap = createSizeCap({ limits: { dataMaxBytes: Math.floor(used * 0.8), storageMaxBytes: 1000 * MB }, sources: sources(), dataDir: dir, delays: { afterDelete: 50, afterGrowth: 50 } });
    t.manager.watchWrites(cap);
    expect((await cap.measure(id))?.held).toBe(true);

    const created = await insert(902);
    expect(created.statusCode).toBe(403);
    expect(created.json().error).toMatchObject(refusal('dataOverCap'));
    const changed = await t.app.inject({ method: 'PATCH', url: `/api/v1/data/${id}/public.products/901`, headers: asUser(t.users.admin), payload: { values: { product_name: 'Renamed' } } });
    expect(changed.statusCode).toBe(403);
    expect(changed.json().error).toMatchObject(refusal('dataOverCap'));
    // Whatever the door: a statement that adds never leaves.
    for (const text of ["insert into notes values (99999, 'x')", 'create table more (id int)', 'create index notes_body on notes (body)', 'alter table spare add column extra text']) {
      await expect(raw(text), text).rejects.toThrow(OffByOperatorError);
    }
    expect(psql(pg.database, "SELECT count(*) FROM products WHERE product_id = 902").trim()).toBe('0');
  });

  it('lets deletes, TRUNCATE and DROP through while held', async () => {
    const deleted = await t.app.inject({ method: 'DELETE', url: `/api/v1/data/${id}/public.products/901`, headers: asUser(t.users.admin) });
    expect(deleted.statusCode, deleted.body).toBe(200);
    await raw('truncate table spare');
    await raw('alter table spare drop column id');
    await raw('drop table spare');
    expect(cap.held(id)).not.toBeNull();
  });

  it('keeps the hold through a connection probe, which rewrites only the read-only flag', async () => {
    const probe = await t.app.inject({ method: 'POST', url: `/api/v1/connections/${id}/test`, headers: asUser(t.users.admin) });
    expect(probe.statusCode, probe.body).toBe(200);
    expect((await t.manager.mustFind(id)).readOnly).toBe(false);
    expect(cap.held(id)).not.toBeNull();
    expect((await insert(903)).statusCode).toBe(403);
    await expect(t.manager.beforeImport(id)).rejects.toMatchObject(refusal('dataOverCap'));
  });

  it('measures again right after a delete, and lets go below 90% of the limit', async () => {
    const limit = cap.reading(id)?.limitBytes ?? 0;
    // Most of what is left of the notes, by hand; then one row through the data route, which is told.
    psql(pg.database, 'DELETE FROM notes WHERE id > 10');
    const before = cap.reading(id)?.measuredAt;
    const deleted = await t.app.inject({ method: 'DELETE', url: `/api/v1/data/${id}/public.notes/1`, headers: asUser(t.users.admin) });
    expect(deleted.statusCode, deleted.body).toBe(200);
    await vi.waitFor(() => expect(cap.reading(id)?.measuredAt).not.toBe(before), { timeout: 5000 });
    await measureUntil((bytes) => bytes < limit * 0.9);
    expect(cap.held(id)).toBeNull();
    expect((await insert(904)).statusCode).toBe(201);
    await expect(t.manager.beforeImport(id)).resolves.toBeUndefined();
  });

  it('measures again after a write that adds', async () => {
    const before = cap.reading(id)?.measuredAt;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await insert(905)).statusCode).toBe(201);
    await vi.waitFor(() => expect(cap.reading(id)?.measuredAt).not.toBe(before), { timeout: 5000 });
  });

  it('after a restart, holds a database over its limit from its first write, before any round has measured it', async () => {
    const used = (await cap.measure(id))?.usedBytes ?? 0;
    cap.stop();
    // A server started again: no reading yet, and no round started.
    cap = createSizeCap({ limits: { dataMaxBytes: Math.floor(used * 0.8), storageMaxBytes: 1000 * MB }, sources: sources(), dataDir: dir });
    t.manager.watchWrites(cap);
    expect(cap.reading(id)).toBeNull();
    const created = await insert(906);
    expect(created.statusCode).toBe(403);
    expect(created.json().error).toMatchObject(refusal('dataOverCap'));
    await expect(raw("insert into notes values (99998, 'x')")).rejects.toThrow(OffByOperatorError);
    expect(cap.held(id)).not.toBeNull();
  });

  it('lets go soon after a delete through its own connection, without being measured by hand', async () => {
    psql(pg.database, 'CREATE TABLE bulk (id integer PRIMARY KEY, body text NOT NULL); INSERT INTO bulk SELECT i, repeat(md5(i::text), 32) FROM generate_series(1, 8000) i');
    cap.stop();
    const before = await measurePostgres((await t.manager.data(id)).db);
    // The delays a server runs with: no test seam.
    cap = createSizeCap({ limits: { dataMaxBytes: before - 4 * MB, storageMaxBytes: 1000 * MB }, sources: sources(), dataDir: dir });
    t.manager.watchWrites(cap);
    expect((await cap.measure(id))?.held).toBe(true);
    // A bulk delete through the person's own pooled connection, which then sits idle.
    await raw('delete from bulk where id > 100');
    await vi.waitFor(() => expect(cap.held(id)).toBeNull(), { timeout: 15_000, interval: 250 });
  }, 30_000);
});

// ─── A real MySQL ─────────────────────────────────────────────────────────────

// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

describe.skipIf(MYSQL_URL === undefined)('the measure on a live MySQL', () => {
  it('counts live rows: a delete shows although InnoDB keeps its pages', async () => {
    const mysql = await import('mysql2');
    const database = `adminium_test_p75t16_${randomBytes(4).toString('hex')}`;
    const admin = mysql.createPool({ uri: MYSQL_URL as string, connectionLimit: 1 }).promise();
    await admin.query(`CREATE DATABASE \`${database}\``);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${database}`;
    const db = new Kysely<never>({ dialect: new MysqlDialect({ pool: mysql.createPool({ uri: url.toString(), multipleStatements: false }) }) });
    try {
      await sql`create table notes (id int primary key, body text not null)`.execute(db);
      await sql`create table adminium_own (id int primary key, body text)`.execute(db);
      for (let batch = 0; batch < 4; batch += 1) {
        const values = Array.from({ length: 1000 }, (_, i) => sql`(${batch * 1000 + i + 1}, ${'n'.repeat(1000)})`);
        await sql`insert into notes values ${sql.join(values)}`.execute(db);
      }
      await sql`insert into adminium_own values (1, ${'a'.repeat(60_000)})`.execute(db);
      await sql`analyze table notes`.execute(db);
      const full = await measureMysql(db);
      expect(full).toBeGreaterThan(3_500_000);
      expect(full).toBeLessThan(6_000_000);
      await sql`delete from notes where id % 4 <> 0`.execute(db);
      await sql`analyze table notes`.execute(db);
      const left = await measureMysql(db);
      expect(left).toBeLessThan(full * 0.4);
    } finally {
      await db.destroy();
      await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });
});
