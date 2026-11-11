// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Allow databases on this server" (`connections.allowLocalDatabases`): a
 * Super Admin's switch, which the operator can lock off with
 * `ADMINIUM_LOCAL_DATABASES=off`, that lets a production server's SOURCE
 * connections reach any database on its own loopback.
 *
 * What is proved here, on a whole composed server in production (loopback
 * refused):
 *   - off by default; on only with the Super Admin's password, every change and
 *     every refusal in the audit log;
 *   - on, a loopback source on any port passes, the cloud-metadata address and
 *     name never do, and storage, webhook and AI addresses keep refusing
 *     loopback;
 *   - the operator's `off` refuses the switch with `not-allowed`, ignores a
 *     stored `on`, and leaves only ADMINIUM_DATABASE_HOSTS;
 *   - nobody but a Super Admin reads or writes it;
 *   - it never travels: not in an export bundle, and a bundle carrying it is
 *     not imported.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import {
  createSqliteMetaDb,
  firstRun,
  isPortableSettingKey,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { SqliteDialect, sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../src/auth/passwords.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { loadEnv } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { checkDsn, guardDsn, guardOutboundUrl, parseDsn, type DatabaseHost } from '../src/connections/dsn.js';
import { databaseHostText, localDatabasesMode, readLocalDatabases } from '../src/connections/local-databases.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { sanitizeDump } from '../src/archive/policy.js';
import { resourcePath } from '../src/export/bundle.js';
import { importZip } from '../src/export/import-service.js';
import { exportZip } from '../src/export/zip-service.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PASSWORD = 'a-long-enough-test-password-1!';
const SETTING = 'connections.allowLocalDatabases';
const quiet = { write: () => true };

function hosts(value: string): DatabaseHost[] {
  return loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DATABASE_HOSTS: value }, quiet).ADMINIUM_DATABASE_HOSTS ?? [];
}

/** An adapter that answers a test without dialling, recording the strings it was handed. */
function recordingProvider(dialled: string[]): AdapterProvider {
  return {
    dialect: 'postgres',
    create: (config: { dsn: string }) => {
      dialled.push(config.dsn);
      return {
        test: async () => ({ ok: true, latencyMs: 1, serverVersion: 'PostgreSQL 18', canWrite: true }),
        probeCapabilities: async () => ({
          capabilities: {},
          privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
          serverVersion: 'PostgreSQL 18',
          currentRole: { name: 'app', readOnly: false },
        }),
        close: async () => undefined,
      };
    },
    // A pool that really answers (SQLite in memory), whatever it was pointed at: what a data handle is built on.
    createQueryEngine: () => ({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }), destroy: async () => undefined }),
  } as unknown as AdapterProvider;
}

// ── the guard ─────────────────────────────────────────────────────────────

describe('the guard with the switch', () => {
  const PROD = { blockLoopback: true, engine: 'postgres' } as const;

  it('lets any loopback host and port through when on, and none when off', () => {
    for (const dsn of ['postgres://u@localhost:6379/x', 'postgres://u@127.0.0.1:5432/x', 'postgres://u@[::1]:5433/x', 'postgres://u@db.localhost/x']) {
      expect(() => guardDsn(dsn, PROD), dsn).toThrow('Loopback hosts are not allowed');
      expect(guardDsn(dsn, { ...PROD, localDatabases: true }).host, dsn).not.toBeNull();
    }
  });

  it('never lets a cloud-metadata address or name through', () => {
    for (const dsn of ['postgres://u@169.254.169.254:5432/x', 'postgres://u@metadata.google.internal/x', 'postgres://u@[fd00:ec2::254]/x']) {
      expect(() => guardDsn(dsn, { ...PROD, localDatabases: true, databaseHosts: hosts('localhost:5432') }), dsn).toThrow('blocked address range');
    }
  });

  it('is the list, or the switch: either lets the listed host through', () => {
    expect(guardDsn('postgres://u@localhost:5432/x', { ...PROD, databaseHosts: hosts('localhost:5432') }).host).toBe('localhost');
    expect(guardDsn('postgres://u@localhost:5432/x', { ...PROD, localDatabases: true }).host).toBe('localhost');
  });

  it('holds on the resolved address too: a name on loopback passes on, a metadata or (strict) private answer never', async () => {
    const answers: Record<string, string[]> = {
      'db.internal': ['127.0.0.1'],
      'meta.internal': ['169.254.169.254'],
      'lan.internal': ['10.0.0.7'],
    };
    const lookup = async (host: string) => Promise.resolve(answers[host] ?? []);
    const on = { ...PROD, localDatabases: true, lookup };
    await expect(checkDsn('postgres://u@db.internal:6379/x', { ...PROD, lookup })).rejects.toThrow('Loopback hosts are not allowed');
    const passed = await checkDsn('postgres://u@db.internal:6379/x', on);
    expect(passed.endpoint?.addresses).toEqual(['127.0.0.1']);
    await expect(checkDsn('postgres://u@meta.internal:5432/x', on)).rejects.toThrow('blocked address range');
    await expect(checkDsn('postgres://u@lan.internal:5432/x', { ...on, blockPrivate: true })).rejects.toThrow('ADMINIUM_NETWORK_POLICY=strict');
  });

  it('never reaches a webhook, storage or AI address: those guards take no switch', () => {
    for (const url of ['http://127.0.0.1:5432/hook', 'http://localhost:11434/v1']) {
      expect(() => guardOutboundUrl(url, { blockLoopback: true }), url).toThrow('Loopback');
    }
  });
});

describe('ADMINIUM_LOCAL_DATABASES', () => {
  it('is `setting` unless the operator says `off`, and refuses anything else', () => {
    expect(localDatabasesMode(loadEnv({ ADMINIUM_SECRET: TEST_SECRET }, quiet))).toBe('setting');
    expect(loadEnv({ ADMINIUM_SECRET: TEST_SECRET }, quiet).ADMINIUM_LOCAL_DATABASES).toBeUndefined();
    expect(localDatabasesMode(loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_LOCAL_DATABASES: 'setting' }, quiet))).toBe('setting');
    expect(localDatabasesMode(loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_LOCAL_DATABASES: 'off' }, quiet))).toBe('off');
    expect(() => loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_LOCAL_DATABASES: 'on' }, quiet)).toThrow();
  });

  it('writes the host list back the way the operator wrote it', () => {
    expect(hosts('localhost:5432,postgres,[::1]:5433,::1,*.pooler.supabase.com:6543').map(databaseHostText)).toEqual([
      'localhost:5432',
      'postgres',
      '[::1]:5433',
      '::1',
      '*.pooler.supabase.com:6543',
    ]);
  });

  it('ignores a stored `on` when the operator locked it off', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    try {
      await firstRun(meta);
      expect(await readLocalDatabases(meta, 'setting')).toBe(false);
      await settingsRepo(meta).set(SETTING, true);
      expect(await readLocalDatabases(meta, 'setting')).toBe(true);
      expect(await readLocalDatabases(meta, 'off')).toBe(false);
    } finally {
      await meta.db.destroy();
    }
  });
});

// ── a whole server in production ──────────────────────────────────────────

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
});

interface Server {
  call(method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown, as?: string): Promise<{ status: number; body: Record<string, unknown> }>;
  manager: ConnectionManager;
  meta: MetaDb;
  dialled: string[];
  login(email: string, password: string): Promise<string>;
}

async function server(env: Record<string, string> = {}, before?: (meta: MetaDb) => Promise<void>): Promise<Server> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  await before?.(store);
  const dialled: string[] = [];
  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register(recordingProvider(dialled));
  const parsed = makeEnv({ HOST: '127.0.0.1', ...env });
  // Production: loopback refused, as on the Docker image.
  const manager = new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: true, databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS });
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager,
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    manager,
    meta: store,
    dialled,
    call: async (method, url, payload, as = owner) => {
      const res = await app.inject({ method, url, headers: { cookie: as }, ...(payload === undefined ? {} : { payload: payload as object }) });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    },
    login: async (email, password) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
      expect(res.statusCode, res.body).toBe(200);
      return String(res.headers['set-cookie']).split(';')[0] ?? '';
    },
  };
}

const test = (s: Server, dsn: string) => s.call('POST', '/api/v1/connections/test', { engine: 'postgres', dsn });

async function auditActions(store: MetaDb): Promise<{ action: string; changes: unknown }[]> {
  const rows = await store.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', 'like', `${SETTING}.%`).orderBy('createdAt').orderBy('id').execute();
  return rows.map((row) => ({ action: row.action, changes: typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes }));
}

describe('the switch on a production server', { timeout: 60_000 }, () => {
  it('is off by default, and a loopback source is refused', async () => {
    const s = await server();
    expect((await s.call('GET', '/api/v1/settings/local-databases')).body).toEqual({
      allowed: true,
      on: false,
      reason: null,
      hosts: [],
      turnedOn: null,
      loopbackAllowed: false,
    });
    expect((await test(s, 'postgres://u@localhost:6379/x')).status).toBe(422);
    expect(s.dialled).toEqual([]);
  });

  it('asks for the password to switch on, keeps every refusal, and names who switched it', async () => {
    const s = await server();
    for (const password of [undefined, 'not-the-password']) {
      const wrong = await s.call('PUT', '/api/v1/settings/local-databases', { on: true, ...(password === undefined ? {} : { password }) });
      expect(wrong.status, String(password)).toBe(403);
      expect(wrong.body).toMatchObject({ error: { details: { reason: 'PASSWORD' } } });
    }
    expect(await settingsRepo(s.meta).get(SETTING)).toBe(false);
    expect((await test(s, 'postgres://u@localhost:6379/x')).status).toBe(422);

    const on = await s.call('PUT', '/api/v1/settings/local-databases', { on: true, password: PASSWORD });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toMatchObject({ allowed: true, on: true, reason: null, turnedOn: { by: 'Dana Price' } });
    expect(typeof (on.body['turnedOn'] as { at: unknown }).at).toBe('number');

    // Off needs no password.
    const off = await s.call('PUT', '/api/v1/settings/local-databases', { on: false });
    expect(off.body).toMatchObject({ on: false, turnedOn: null });

    const audit = await auditActions(s.meta);
    expect(audit.map((row) => row.action)).toEqual([`${SETTING}.refused`, `${SETTING}.refused`, `${SETTING}.on`, `${SETTING}.off`]);
    expect(audit.slice(0, 2).map((row) => row.changes)).toEqual([{ after: { reason: 'password' } }, { after: { reason: 'password' } }]);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit)).not.toContain('not-the-password');
  });

  it('on: any loopback source passes, the metadata address never does, and storage and webhooks still refuse loopback', async () => {
    const s = await server();
    expect((await s.call('PUT', '/api/v1/settings/local-databases', { on: true, password: PASSWORD })).status).toBe(200);
    expect(s.manager.localDatabases).toBe(true);

    for (const dsn of ['postgres://u@localhost:6379/x', 'postgres://u@127.0.0.1:5432/x', 'postgres://u@[::1]:15432/x']) {
      const ok = await test(s, dsn);
      expect(ok.status, `${dsn} ${JSON.stringify(ok.body)}`).toBe(200);
    }
    expect(s.dialled).toHaveLength(3);
    for (const dsn of ['postgres://u@169.254.169.254:5432/x', 'postgres://u@metadata.google.internal/x']) {
      const refused = await test(s, dsn);
      expect(refused.status, dsn).toBe(422);
      expect(JSON.stringify(refused.body)).toContain('blocked address range');
    }
    expect(s.dialled).toHaveLength(3);

    // Storage reads the server's own loopback rule, never this switch.
    const storage = await s.call('POST', '/api/v1/storage/destinations/test', { driver: 'webdav', config: { url: 'http://127.0.0.1:8080/dav', prefix: 'adminium' } });
    expect(storage.status, JSON.stringify(storage.body)).toBe(422);
    expect(JSON.stringify(storage.body)).toContain('Loopback');
    // Webhooks and AI addresses are held to the same rule the manager reports, which the switch leaves alone.
    expect(s.manager.blockLoopback).toBe(true);
    expect(() => guardOutboundUrl('http://127.0.0.1:5432/hook', { blockLoopback: s.manager.blockLoopback })).toThrow('Loopback');

    // Off again: refused again.
    await s.call('PUT', '/api/v1/settings/local-databases', { on: false });
    expect((await test(s, 'postgres://u@localhost:6379/x')).status).toBe(422);
  });

  it('off again: a pool already open to a loopback source is closed, and the next request refused', async () => {
    const s = await server();
    expect((await s.call('PUT', '/api/v1/settings/local-databases', { on: true, password: PASSWORD })).status).toBe(200);
    const row = await s.manager.connections.create({
      name: 'shop',
      engine: 'postgres',
      sourceKind: 'dsn',
      introspectDsn: 'postgres://app@127.0.0.1:5432/shop',
      dataDsn: 'postgres://app@127.0.0.1:5432/shop',
      readOnly: false,
      settings: {},
      status: 'connected',
      createdBy: null,
    });
    const handle = await s.manager.data(row);
    expect((await sql<{ one: number }>`select 1 as one`.execute(handle.db)).rows).toEqual([{ one: 1 }]);

    expect((await s.call('PUT', '/api/v1/settings/local-databases', { on: false })).status).toBe(200);
    // The open pool no longer answers, and a new one is refused by the guard.
    await vi.waitFor(async () => {
      await expect(sql`select 1`.execute(handle.db)).rejects.toThrow();
    });
    await expect(s.manager.data(row)).rejects.toThrow('Loopback');
  });

  it('is read at boot: a server that starts with it on lets a loopback source through', async () => {
    const s = await server({}, async (store) => {
      await settingsRepo(store).set(SETTING, true);
    });
    expect((await test(s, 'postgres://u@localhost:6379/x')).status).toBe(200);
  });

  it('locked off by the operator: refused with not-allowed, a stored on ignored, only the list counts', async () => {
    const s = await server({ ADMINIUM_LOCAL_DATABASES: 'off', ADMINIUM_DATABASE_HOSTS: 'localhost:5432,postgres' }, async (store) => {
      await settingsRepo(store).set(SETTING, true);
    });
    expect((await s.call('GET', '/api/v1/settings/local-databases')).body).toEqual({
      allowed: false,
      on: false,
      reason: 'not-allowed',
      hosts: ['localhost:5432', 'postgres'],
      turnedOn: null,
      loopbackAllowed: false,
    });
    expect(s.manager.localDatabases).toBe(false);

    const refused = await s.call('PUT', '/api/v1/settings/local-databases', { on: true, password: PASSWORD });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { details: { reason: 'not-allowed' } } });
    expect((await auditActions(s.meta)).map((row) => [row.action, row.changes])).toEqual([[`${SETTING}.refused`, { after: { reason: 'not-allowed' } }]]);

    expect((await test(s, 'postgres://u@localhost:6379/x')).status).toBe(422);
    expect((await test(s, 'postgres://u@localhost:5432/x')).status).toBe(200);
  });

  it('is a Super Admin’s alone: neither an Admin nor a role holding settings.manage reads or writes it', async () => {
    const s = await server();
    const users = usersRepo(s.meta);
    const roles = rolesRepo(s.meta);
    const admin = await users.create({ email: 'admin@example.test', name: 'Admin', passwordHash: await hashPassword('another-long-test-password-2!') });
    await roles.assignToUser(admin.id, (await roles.findBySlug('admin'))!.id);
    const settingsRole = await roles.create({ slug: 'settings-keeper', name: 'Settings keeper' });
    await permissionsRepo(s.meta).grant(settingsRole.id, 'system', 'settings.manage', { allowed: true });
    const keeper = await users.create({ email: 'keeper@example.test', name: 'Keeper', passwordHash: await hashPassword('another-long-test-password-3!') });
    await roles.assignToUser(keeper.id, settingsRole.id);

    // Two sign-ins and two tries: the switch shares the sign-in's bucket, five a minute.
    for (const [email, password] of [
      ['admin@example.test', 'another-long-test-password-2!'],
      ['keeper@example.test', 'another-long-test-password-3!'],
    ] as const) {
      const cookie = await s.login(email, password);
      expect((await s.call('GET', '/api/v1/settings/local-databases', undefined, cookie)).status, email).toBe(403);
      const put = await s.call('PUT', '/api/v1/settings/local-databases', { on: true, password }, cookie);
      expect(put.status, email).toBe(403);
      // Holding settings.manage gets past the permission, and no further.
      if (email.startsWith('keeper')) expect(put.body, email).toMatchObject({ error: { details: { reason: 'SUPER_ADMIN' } } });
    }
    expect(await settingsRepo(s.meta).get(SETTING)).toBe(false);
  });
});

// ── it never travels ──────────────────────────────────────────────────────

describe('the switch never travels', () => {
  it('is not portable', () => {
    expect(isPortableSettingKey(SETTING)).toBe(false);
  });

  it('is not in an archive or an Export everything file, and a restore never writes it', () => {
    for (const kind of ['full', 'export'] as const) {
      const tables = new Map([
        [
          'adminium_settings',
          {
            table: 'adminium_settings',
            kinds: {},
            columns: ['key', 'value', 'updatedAt'],
            rows: [
              [SETTING, 'true', 1],
              ['branding.appName', '"Hollis Bakery"', 1],
            ],
          },
        ],
      ]);
      const report = sanitizeDump(tables, { kind, dialect: 'sqlite' });
      expect(report.droppedSettings, kind).toContain(SETTING);
      expect(tables.get('adminium_settings')?.rows.map((row) => row[0]), kind).toEqual(['branding.appName']);
    }
  });

  it('is not in an export bundle, and a bundle carrying it is not imported', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adminium-local-dbs-'));
    const source = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    const target = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    try {
      await firstRun(source);
      await settingsRepo(source).set(SETTING, true);
      await settingsRepo(source).set('branding.appName', 'Hollis Bakery');
      const out = join(dir, 'bundle.zip');
      await exportZip({ meta: source, outPath: out, dataDir: dir });
      const entries = unzipSync(new Uint8Array(await readFile(out)));
      const settings = JSON.parse(strFromU8(entries[resourcePath('settings')] as Uint8Array)) as { key: string; value: unknown }[];
      expect(settings.map((row) => row.key)).toContain('branding.appName');
      expect(settings.map((row) => row.key)).not.toContain(SETTING);

      // A bundle someone wrote by hand to carry it.
      entries[resourcePath('settings')] = new TextEncoder().encode(JSON.stringify([...settings, { key: SETTING, value: true }]));
      const crafted = join(dir, 'crafted.zip');
      await writeFile(crafted, zipSync(entries));
      const result = await importZip({ meta: target, inPath: crafted });
      expect(await settingsRepo(target).get('branding.appName')).toBe('Hollis Bakery');
      expect(await settingsRepo(target).get(SETTING)).toBe(false);
      expect(result.warnings.join('\n')).toContain(SETTING);
    } finally {
      await source.db.destroy();
      await target.db.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── a real database on this machine ────────────────────────────────────────

const LIVE = [
  { engine: 'postgres', url: process.env['TEST_POSTGRES_URL'] || undefined },
  { engine: 'mysql', url: process.env['TEST_MYSQL_URL'] || undefined },
] as const;

describe.each(LIVE)('a $engine source on loopback, in production, with the switch', ({ engine, url }) => {
  const loopback = url !== undefined && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname);

  it.skipIf(!loopback)('is refused while off and connects while on', async () => {
    const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(store);
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    const m = new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: true });
    try {
      expect(parseDsn(url as string).host).not.toBeNull();
      await expect(m.testDsn(engine, url as string)).rejects.toThrow('Loopback hosts are not allowed');
      m.localDatabases = true;
      const summary = await m.testDsn(engine, url as string);
      expect(summary.error).toBeNull();
      expect(summary.ok).toBe(true);
    } finally {
      await store.db.destroy();
    }
  });
});
