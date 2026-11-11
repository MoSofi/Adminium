// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SQLite source may not open Adminium's own files.
 *
 * The meta store is a SQLite file on most installs, and a SQLite source opens
 * its file read-write with the data pragmas applied. `/data` and the schema
 * editor already keep every `adminium_*` table out of reach, so this is not a
 * way to edit roles; it is a second writer on the live meta file (and on its
 * backups), which can corrupt it. So the meta file, its companions, and the
 * data dir's own folders are refused on every way a SQLite path gets in, read
 * from the path the operating system will open: symlinks, `..`, hard links and
 * another spelling of the same name on a case-insensitive volume included.
 * `ADMINIUM_SQLITE_DIRS`, when set, pins sources to the operator's folders.
 *
 * Every front door runs against a fake adapter that records each dial, so a
 * refusal is proven to come before the driver opens anything.
 */
import BetterSqlite3 from 'better-sqlite3';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  type AdapterProvider,
  type DatabaseAdapter,
} from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/connections/introspect.js', () => ({ runIntrospection: vi.fn() }));
vi.mock('../src/generate/run.js', () => ({ runGeneration: vi.fn() }));

import { ADD_ONS_DIR } from '../src/add-ons/store.js';
import { BACKUPS_DIR } from '../src/backup/backup-service.js';
import { PRE_RESTORE_PREFIX } from '../src/backup/format.js';
import { KEPT_SECRET_FILE } from '../src/cli/kept-secret.js';
import { runCli } from '../src/cli/run.js';
import { sqliteSourcePolicyFor } from '../src/cli/runtime.js';
import { HOST_DECIDED_ENV } from '../src/cli/start-project.js';
import { BOOTSTRAP_FILENAME } from '../src/config/bootstrap.js';
import { loadEnv } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { seedSourceConnection } from '../src/connections/seed.js';
import {
  caseInsensitiveAt,
  OWN_DATA_DIR_FILES,
  OWN_DATA_DIR_FOLDER_PREFIXES,
  OWN_DATA_DIR_FOLDERS,
  ownPathRefusal,
  realPath,
  sqliteSourceRefusal,
  type SqliteSourcePolicy,
} from '../src/connections/sqlite-guard.js';
import { FILES_DIR } from '../src/files/drivers/local.js';
import { TMP_DIR } from '../src/files/spool.js';
import { syncProjectDatabases } from '../src/project/databases.js';
import { createLocalDatabaseHandler, LOCAL_DATABASE_DIR } from '../src/routes/desktop-local-db/handlers.js';

import { fakeDeps, fakeIo, fakeRuntime, TEST_SECRET } from './cli-helpers.js';
import { asUser, buildDataTestApp, type DataTestContext } from './connections-helpers.js';

// ── a data dir on disk ─────────────────────────────────────────────────────

function makeDb(file: string): string {
  const db = new BetterSqlite3(file);
  db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)');
  db.close();
  return file;
}

// Built while the file is collected, not in a hook: `it.each` reads the paths then.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'sqlite-guard-')));
const data = join(root, 'data');
const elsewhere = join(root, 'elsewhere');
for (const dir of [data, elsewhere, ...['backups', 'files', 'tmp', 'add-ons', 'databases', 'pre-restore-2026-11-11'].map((d) => join(data, d))]) {
  mkdirSync(dir, { recursive: true });
}
const meta = makeDb(join(data, 'meta.db'));
for (const suffix of ['-wal', '-shm', '-journal']) writeFileSync(`${meta}${suffix}`, 'x');
makeDb(join(data, 'backups', 'meta-before-upgrade.db'));
makeDb(join(data, 'files', 'upload.db'));
makeDb(join(data, 'tmp', 'spool.db'));
makeDb(join(data, 'add-ons', 'addon.db'));
makeDb(join(data, 'pre-restore-2026-11-11', 'meta.db'));
writeFileSync(join(data, 'adminium.json'), '{}');
const ordinary = makeDb(join(elsewhere, 'app.db'));
makeDb(join(data, 'databases', 'shop.sqlite'));
makeDb(join(data, 'app.sqlite'));
symlinkSync(meta, join(root, 'link.db'));
linkSync(meta, join(root, 'hard.db'));
symlinkSync(join(data, 'databases'), join(root, 'sneaky'));
symlinkSync(data, join(root, 'alias'));
const policy: SqliteSourcePolicy = { own: { dataDir: data, metaFile: meta } };

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Every way a path to one of Adminium's own files gets written, and what it is. */
function refusedPaths(): { label: string; path: string; reason: string }[] {
  return [
    { label: 'the meta file', path: meta, reason: 'meta-store' },
    { label: 'its -wal', path: `${meta}-wal`, reason: 'meta-companion' },
    { label: 'its -shm', path: `${meta}-shm`, reason: 'meta-companion' },
    { label: 'its -journal', path: `${meta}-journal`, reason: 'meta-companion' },
    { label: 'a backup', path: join(data, 'backups', 'meta-before-upgrade.db'), reason: 'data-folder' },
    { label: 'a symlink to the meta file', path: join(root, 'link.db'), reason: 'meta-store' },
    { label: 'a hard link to the meta file', path: join(root, 'hard.db'), reason: 'meta-store' },
    { label: 'a path with ..', path: `${data}/databases/../meta.db`, reason: 'meta-store' },
    // `sneaky` is a symlink to data/databases, so the OS reads `sneaky/..` as data/: a lexical
    // normalise would read root/meta.db, which does not exist.
    { label: 'a .. after a symlinked folder', path: `${root}/sneaky/../meta.db`, reason: 'meta-store' },
    { label: 'the meta file through a symlinked data dir', path: join(root, 'alias', 'meta.db'), reason: 'meta-store' },
    { label: 'a backup through a symlinked data dir', path: join(root, 'alias', 'backups', 'meta-before-upgrade.db'), reason: 'data-folder' },
    { label: 'a file in the storage folder', path: join(data, 'files', 'upload.db'), reason: 'data-folder' },
    { label: 'a file in the upload spool', path: join(data, 'tmp', 'spool.db'), reason: 'data-folder' },
    { label: 'a file in the add-ons folder', path: join(data, 'add-ons', 'addon.db'), reason: 'data-folder' },
    { label: 'a meta store a restore moved aside', path: join(data, 'pre-restore-2026-11-11', 'meta.db'), reason: 'data-folder' },
    { label: 'the bootstrap file', path: join(data, 'adminium.json'), reason: 'data-folder' },
  ];
}

const sqlite = (path: string): string => `sqlite:${path}`;

// ── the list itself ────────────────────────────────────────────────────────

describe("Adminium's own files", () => {
  it('names the folders and files the rest of the server writes there', () => {
    expect(OWN_DATA_DIR_FOLDERS).toEqual(expect.arrayContaining([BACKUPS_DIR, FILES_DIR, TMP_DIR, ADD_ONS_DIR]));
    expect(OWN_DATA_DIR_FILES).toEqual(expect.arrayContaining(['meta.db', BOOTSTRAP_FILENAME, KEPT_SECRET_FILE]));
    expect(OWN_DATA_DIR_FOLDER_PREFIXES).toContain(PRE_RESTORE_PREFIX);
    // The desktop app's databases live in the data dir and are sources.
    expect(OWN_DATA_DIR_FOLDERS).not.toContain(LOCAL_DATABASE_DIR);
  });

  it.each(refusedPaths())('refuses $label', ({ path, reason }) => {
    expect(ownPathRefusal(path, policy.own)?.reason).toBe(reason);
    expect(sqliteSourceRefusal(sqlite(path), policy)?.details).toMatchObject({ reason });
  });

  it('refuses the default meta.db in the data dir even when the meta store lives elsewhere', () => {
    expect(ownPathRefusal(meta, { dataDir: data, metaFile: null })?.reason).toBe('meta-store');
    expect(ownPathRefusal(ordinary, { dataDir: data, metaFile: ordinary })?.reason).toBe('meta-store');
  });

  it.skipIf(!caseInsensitiveAt(tmpdir()))('refuses another spelling of the name on a case-insensitive volume', () => {
    for (const path of [join(data, 'META.DB'), join(data, 'Meta.db-WAL'), join(data, 'BACKUPS', 'meta-before-upgrade.db'), join(root, 'DATA', 'meta.db'), join(data, 'Pre-Restore-2027', 'meta.db')]) {
      expect(ownPathRefusal(path, policy.own), path).not.toBeNull();
    }
  });

  it('refuses a file that does not exist yet in a symlinked folder of its own', () => {
    expect(ownPathRefusal(join(root, 'alias', 'backups', 'next.db'), policy.own)?.reason).toBe('data-folder');
    expect(ownPathRefusal(join(root, 'alias', 'meta.db-wal'), policy.own)?.reason).toBe('meta-companion');
  });

  it('refuses every spelling of a SQLite DSN for the meta file', () => {
    for (const dsn of [`sqlite:${meta}`, `sqlite://${meta}`, `file:${meta}`, `file://${meta}?mode=ro`, `SQLITE:${meta}`]) {
      expect(sqliteSourceRefusal(dsn, policy), dsn).not.toBeNull();
    }
  });

  it('accepts an ordinary file, the desktop databases folder, and a file next to the meta store', () => {
    for (const path of [ordinary, join(data, 'databases', 'shop.sqlite'), join(data, 'app.sqlite'), `${root}/sneaky/shop.sqlite`]) {
      expect(sqliteSourceRefusal(sqlite(path), policy), path).toBeNull();
    }
    expect(sqliteSourceRefusal('sqlite::memory:', policy)).toBeNull();
  });

  it('says what is wrong and what to do', () => {
    expect(sqliteSourceRefusal(sqlite(meta), policy)?.message).toBe(
      "This file is Adminium's own meta store. Adminium never opens it as a source database, because a second writer can damage it. Connect your app's own database file instead.",
    );
    expect(sqliteSourceRefusal(sqlite(join(data, 'backups', 'meta-before-upgrade.db')), policy)?.message).toContain(
      'Copy the database somewhere else and connect the copy.',
    );
  });

  it('reads a path the way the operating system opens it', () => {
    expect(realPath(`${root}/sneaky/../meta.db`)).toBe(meta);
    expect(realPath(join(root, 'alias', 'nothing', '..', 'meta.db'))).toBe(meta);
    expect(realPath(join(root, 'alias', 'new', 'x.db'))).toBe(join(data, 'new', 'x.db'));
  });
});

describe('a folder Adminium would write into (local storage roots)', () => {
  it('refuses a folder that holds the data dir or the meta store', () => {
    for (const folder of [data, root, parse(root).root, join(root, 'alias')]) {
      expect(ownPathRefusal(folder, policy.own, { folder: true })?.reason, folder).toBe('contains-data');
    }
    expect(ownPathRefusal(elsewhere, { dataDir: data, metaFile: ordinary }, { folder: true })?.reason).toBe('contains-data');
  });

  it("refuses the data dir's own folders and accepts one of its own", () => {
    expect(ownPathRefusal(join(data, 'backups'), policy.own, { folder: true })?.reason).toBe('data-folder');
    expect(ownPathRefusal(join(data, 'files', 'sub'), policy.own, { folder: true })?.reason).toBe('data-folder');
    expect(ownPathRefusal(join(elsewhere, 'uploads'), policy.own, { folder: true })).toBeNull();
  });
});

// ── ADMINIUM_SQLITE_DIRS ───────────────────────────────────────────────────

describe('ADMINIUM_SQLITE_DIRS', () => {
  const quiet = { write: () => true };

  it('parses absolute folders and refuses a relative one', () => {
    expect(loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_SQLITE_DIRS: ' /srv/db , /data/apps/ ' }, quiet).ADMINIUM_SQLITE_DIRS).toEqual([
      '/srv/db',
      '/data/apps',
    ]);
    expect(loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_SQLITE_DIRS: ' , ' }, quiet).ADMINIUM_SQLITE_DIRS).toBeUndefined();
    let table = '';
    expect(() =>
      loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_SQLITE_DIRS: '/srv/db,./db' }, { write: (chunk: string) => ((table += chunk), true) }),
    ).toThrow();
    expect(table).toContain('"./db" is not an absolute folder path');
  });

  it('is decided by the host, not by a project folder', () => {
    expect(HOST_DECIDED_ENV).toContain('ADMINIUM_SQLITE_DIRS');
  });

  it('accepts a file inside, refuses one outside, and follows a symlink out', () => {
    const pinned: SqliteSourcePolicy = { ...policy, dirs: [elsewhere] };
    expect(sqliteSourceRefusal(sqlite(ordinary), pinned)).toBeNull();
    const outside = sqliteSourceRefusal(sqlite(join(data, 'databases', 'shop.sqlite')), pinned);
    expect(outside?.details).toMatchObject({ reason: 'outside-sqlite-dirs', variable: 'ADMINIUM_SQLITE_DIRS', dirs: [elsewhere] });
    expect(outside?.message).toContain('add its folder to ADMINIUM_SQLITE_DIRS');
    const escape = join(elsewhere, 'escape.db');
    symlinkSync(join(data, 'databases', 'shop.sqlite'), escape);
    expect(sqliteSourceRefusal(sqlite(escape), pinned)?.details).toMatchObject({ reason: 'outside-sqlite-dirs' });
    expect(sqliteSourceRefusal(sqlite(`${elsewhere}/../data/app.sqlite`), pinned)?.details).toMatchObject({ reason: 'outside-sqlite-dirs' });
  });

  it('reads the folders through symlinks too, and never lets the own-files list go', () => {
    expect(sqliteSourceRefusal(sqlite(join(data, 'databases', 'shop.sqlite')), { ...policy, dirs: [join(root, 'sneaky')] })).toBeNull();
    expect(sqliteSourceRefusal(sqlite(meta), { ...policy, dirs: [data] })?.details).toMatchObject({ reason: 'meta-store' });
  });

  it('is built from the environment and the meta store by openRuntime', () => {
    const env = loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DATA_DIR: data, ADMINIUM_SQLITE_DIRS: elsewhere }, quiet);
    expect(sqliteSourcePolicyFor(env, { engine: 'sqlite', url: `sqlite://${ordinary}` })).toEqual({
      own: { dataDir: data, metaFile: ordinary },
      dirs: [elsewhere],
    });
    expect(sqliteSourcePolicyFor(env, { engine: 'postgres', url: 'postgres://u@db/meta' }).own.metaFile).toBeNull();
  });
});

// ── every front door ───────────────────────────────────────────────────────

const dials: string[] = [];

function recordingRegistry(): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'sqlite',
    create: (config: { role: string; dsn: string }) => {
      dials.push(config.dsn);
      return {
        dialect: 'sqlite',
        capabilities,
        role: config.role,
        connect: async () => undefined,
        test: async () => ({ ok: true, latencyMs: 1, serverVersion: 'SQLite 3', currentUser: null, canWrite: true, ssl: false }),
        probeCapabilities: async () => ({
          capabilities,
          privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
          serverVersion: 'SQLite 3',
          currentRole: { name: 'main', readOnly: false },
        }),
        close: async () => undefined,
      } as unknown as DatabaseAdapter as never;
    },
    createQueryEngine: (config: { dsn: string }) => {
      dials.push(config.dsn);
      return { dialect: {} };
    },
  } as unknown as AdapterProvider);
  return registry;
}

describe('the connection manager', () => {
  let metaDb: MetaDb;

  beforeEach(async () => {
    dials.length = 0;
    metaDb = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(metaDb);
  });

  afterEach(async () => {
    await metaDb.db.destroy();
  });

  /** `null`: a manager built by hand, with no policy, as before this guard. */
  const manager = (sqliteSources: SqliteSourcePolicy | null = policy): ConnectionManager =>
    new ConnectionManager({
      meta: metaDb,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      registry: recordingRegistry(),
      metaDsn: null,
      blockLoopback: false,
      ...(sqliteSources === null ? {} : { sqliteSources }),
    });

  it.each(refusedPaths())('testDsn refuses $label before it opens anything', async ({ path }) => {
    await expect(manager().testDsn('sqlite', sqlite(path))).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION_FAILED' });
    expect(dials).toEqual([]);
  });

  it('opens an ordinary file', async () => {
    expect((await manager().testDsn('sqlite', sqlite(ordinary))).ok).toBe(true);
    expect(dials).toEqual([sqlite(ordinary)]);
  });

  it('refuses a stored row on every later open (made before the guard, or restored)', async () => {
    const m = manager();
    const row = await m.connections.create({
      name: 'meta',
      engine: 'sqlite',
      sourceKind: 'dsn',
      introspectDsn: sqlite(join(root, 'link.db')),
      dataDsn: null,
      readOnly: false,
      settings: {},
      status: 'connected',
      createdBy: null,
    });
    await expect(m.introspectAdapter(row.id)).rejects.toMatchObject({ statusCode: 422 });
    await expect(m.dataAdapter(row.id)).rejects.toMatchObject({ statusCode: 422 });
    await expect(m.data(row.id)).rejects.toMatchObject({ statusCode: 422 });
    expect(await m.tablePrivileges(row)).toBeNull();
    expect(dials).toEqual([]);
    // Without the policy (a manager built by hand, as before) nothing is refused.
    await (await manager(null).introspectAdapter(row.id)).close();
    expect(dials).toHaveLength(1);
  });

  it('refuses outside ADMINIUM_SQLITE_DIRS', async () => {
    await expect(manager({ ...policy, dirs: [join(data, 'databases')] }).testDsn('sqlite', sqlite(ordinary))).rejects.toThrow('ADMINIUM_SQLITE_DIRS');
    expect(dials).toEqual([]);
  });

  it('refuses the ADMINIUM_SOURCE_URL seed, and says why', async () => {
    const warnings: string[] = [];
    const result = await seedSourceConnection({
      manager: manager(),
      meta: metaDb,
      sourceUrl: sqlite(meta),
      log: () => undefined,
      warn: (message) => warnings.push(message),
    });
    expect(result.kind).toBe('failed');
    expect(warnings.join('\n')).toContain("Adminium's own meta store");
    expect(dials).toEqual([]);
  });

  it("refuses a project's database on one of Adminium's files, and connects the others", async () => {
    const warnings: string[] = [];
    const outcomes = await syncProjectDatabases({
      manager: manager(),
      meta: metaDb,
      root: join(root, 'alias'),
      databases: new Map([
        ['main', 'sqlite:./app.sqlite'],
        ['sneaky', 'sqlite:./meta.db'],
        ['backup', 'sqlite:./backups/meta-before-upgrade.db'],
      ]),
      missing: [],
      log: () => undefined,
      warn: (message) => warnings.push(message),
    });
    expect(outcomes.find((o) => o.key === 'main')).toMatchObject({ ok: true });
    expect(outcomes.find((o) => o.key === 'sneaky')).toMatchObject({ ok: false });
    expect(outcomes.find((o) => o.key === 'backup')).toMatchObject({ ok: false });
    expect(warnings.join('\n')).toContain("Adminium's own meta store");
    expect(dials).toEqual([`sqlite:${join(root, 'alias', 'app.sqlite')}`]);
  });
});

describe('the connection routes (Studio, the desktop open-a-file card, adminium app try)', () => {
  let t: DataTestContext;

  beforeEach(async () => {
    dials.length = 0;
    t = await buildDataTestApp({ registry: recordingRegistry(), sqliteSources: policy });
  });

  afterEach(async () => {
    await t.app.close();
  });

  it.each(refusedPaths())('POST /connections/test and POST /connections refuse $label', async ({ path }) => {
    const test = await t.app.inject({
      method: 'POST',
      url: '/api/v1/connections/test',
      headers: asUser(t.users.admin),
      payload: { engine: 'sqlite', dsn: sqlite(path) },
    });
    expect(test.statusCode).toBe(422);
    for (const payload of [
      { name: 'one', engine: 'sqlite', dsn: sqlite(path) },
      { name: 'split', engine: 'sqlite', roles: { introspect: sqlite(path), data: sqlite(ordinary) } },
      { name: 'split2', engine: 'sqlite', roles: { introspect: sqlite(ordinary), data: sqlite(path) } },
    ]) {
      const res = await t.app.inject({ method: 'POST', url: '/api/v1/connections', headers: asUser(t.users.admin), payload });
      expect(res.statusCode, payload.name).toBe(422);
      expect((res.json() as { error: { message: string } }).error.message).toMatch(/Adminium's own/);
    }
    expect(dials).toEqual([]);
    expect(await t.manager.connections.list()).toEqual([]);
  });

  it('still connects an ordinary SQLite file', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/connections',
      headers: asUser(t.users.admin),
      payload: { name: 'app', engine: 'sqlite', dsn: sqlite(ordinary) },
    });
    expect(res.statusCode).toBe(201);
    expect(dials).toEqual([sqlite(ordinary)]);
  });
});

describe('adminium start with a SQLite ADMINIUM_SOURCE_URL', () => {
  it.each([
    { label: 'the meta file', file: () => meta },
    { label: 'a backup', file: () => join(data, 'backups', 'meta-before-upgrade.db') },
  ])('fails the boot on $label, saying why', async ({ file }) => {
    const io = fakeIo();
    const runtime = fakeRuntime();
    const deps = fakeDeps({ env: { ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DATA_DIR: data, ADMINIUM_SOURCE_URL: sqlite(file()) }, runtime });
    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.toBe(78);
    expect(io.stderr()).toContain('ADMINIUM_SOURCE_URL');
    expect(io.stderr()).toContain("Adminium's own");
    expect(deps.startServer).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalled();
  });

  it('fails the boot outside ADMINIUM_SQLITE_DIRS and boots inside', async () => {
    const env = { ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_DATA_DIR: data, ADMINIUM_SQLITE_DIRS: join(data, 'databases') };
    const refused = fakeDeps({ env: { ...env, ADMINIUM_SOURCE_URL: sqlite(ordinary) } });
    await expect(runCli(['start', '--skip-migrate'], { io: fakeIo(), deps: refused })).resolves.toBe(78);
    const booted = fakeDeps({ env: { ...env, ADMINIUM_SOURCE_URL: sqlite(join(data, 'databases', 'shop.sqlite')) } });
    await expect(runCli(['start', '--skip-migrate'], { io: fakeIo(), deps: booted })).resolves.toBe(0);
    expect(booted.startServer).toHaveBeenCalledOnce();
  });
});

describe('the desktop app', () => {
  it('still creates and opens its own databases in the data dir, with the real adapter', async () => {
    const metaDb = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(metaDb);
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    const m = new ConnectionManager({ meta: metaDb, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false, sqliteSources: policy });
    try {
      const created = await createLocalDatabaseHandler(
        { manager: m, dataDir: data, parseSchema: async () => Promise.reject(new Error('not used')) },
        { name: 'Notes', schemaFile: undefined, placeholderRows: false, actorId: null },
      );
      expect(created.file).toBe(resolve(data, 'databases', 'notes.sqlite'));
      expect((await m.connections.findById(created.connectionId))?.status).toBe('connected');
      // The open-a-file card: an ordinary file anywhere, through the real adapter.
      expect((await m.testDsn('sqlite', sqlite(ordinary))).ok).toBe(true);
      await expect(m.testDsn('sqlite', sqlite(meta))).rejects.toThrow("Adminium's own meta store");
    } finally {
      await m.disposeAll();
      await metaDb.db.destroy();
    }
  });
});
