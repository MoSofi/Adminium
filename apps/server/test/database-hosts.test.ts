// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `ADMINIUM_DATABASE_HOSTS`: the database hosts the operator lets a production
 * server reach, its own loopback included.
 *
 * Production refuses a source database on loopback, so that nobody signed in
 * can point the server at the services on its own box. A one-server install
 * (Postgres next to Adminium on a droplet) needs exactly one of those reached,
 * so the operator names it by host AND port, and the guard lets that one
 * through and nothing else. The cloud-metadata address is never let through,
 * listed or not.
 *
 * The host and port matched are the ones the driver dials: the DSN's own, read
 * through the parameter allow-list, so a `?host=` behind a listed name cannot
 * borrow the entry.
 */
import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider, type DatabaseEndpoint } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/connections/introspect.js', () => ({ runIntrospection: vi.fn() }));
vi.mock('../src/generate/run.js', () => ({ runGeneration: vi.fn() }));

import { runCli } from '../src/cli/run.js';
import { loadEnv } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import {
  databaseHostListed,
  guardDsn,
  parseDatabaseHost,
  parseDsn,
  unlistedLoopbackEntry,
  type DatabaseHost,
} from '../src/connections/dsn.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { seedSourceConnection } from '../src/connections/seed.js';
import { syncProjectDatabases } from '../src/project/databases.js';

import { fakeDeps, fakeIo, fakeRuntime, TEST_SECRET } from './cli-helpers.js';

const SECRET = 'a-sufficiently-long-dev-secret';
const quiet = { write: () => true };

/** The list as the env parser hands it over. */
function hosts(value: string): DatabaseHost[] {
  const env = loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_DATABASE_HOSTS: value }, quiet);
  return env.ADMINIUM_DATABASE_HOSTS ?? [];
}

function envProblem(value: string): string {
  let table = '';
  try {
    loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_DATABASE_HOSTS: value }, { write: (chunk: string) => ((table += chunk), true) });
  } catch {
    return table;
  }
  throw new Error(`expected ${value} to be refused`);
}

const PROD = (list: string) => ({ blockLoopback: true, databaseHosts: hosts(list) });

describe('parsing the list', () => {
  it('reads names, addresses and ports, normalised', () => {
    expect(hosts('localhost:5432, Postgres ,DB.Internal.:6543,127.0.0.1,[::1]:5433,::1')).toEqual([
      { host: 'localhost', port: 5432, wildcard: false },
      { host: 'postgres', port: null, wildcard: false },
      { host: 'db.internal', port: 6543, wildcard: false },
      { host: '127.0.0.1', port: null, wildcard: false },
      { host: '::1', port: 5433, wildcard: false },
      { host: '::1', port: null, wildcard: false },
    ]);
  });

  it('accepts a Docker service name with an underscore', () => {
    expect(hosts('my_db:5432')).toEqual([{ host: 'my_db', port: 5432, wildcard: false }]);
  });

  it('reads an address the way the resolver does', () => {
    expect(hosts('127.1:5432')).toEqual([{ host: '127.0.0.1', port: 5432, wildcard: false }]);
  });

  it('takes a wildcard with at least two labels after "*."', () => {
    expect(hosts('*.pooler.supabase.com:6543')).toEqual([{ host: 'pooler.supabase.com', port: 6543, wildcard: true }]);
    expect(envProblem('*.com')).toContain('"*.com"');
    expect(envProblem('*')).toContain('"*"');
    expect(envProblem('*.0.0.1')).toContain('"*.0.0.1"');
  });

  it('refuses junk, naming every bad entry at once', () => {
    const table = envProblem('localhost:5432,http://db:5432,db:0,db:70000,db:port,db/x,a..b,[::1');
    expect(table).toContain('ADMINIUM_DATABASE_HOSTS');
    for (const bad of ['http://db:5432', 'db:0', 'db:70000', 'db:port', 'db/x', 'a..b', '[::1']) {
      expect(table).toContain(`"${bad}"`);
    }
    expect(table).not.toContain('"localhost:5432"');
  });

  it('refuses a cloud-metadata address however it is written, and says why', () => {
    for (const entry of ['169.254.169.254', '169.254.169.254:80', 'metadata.google.internal', 'Metadata.Google.Internal.:5432', '[fd00:ec2::254]', '*.google.internal', '0xa9fea9fe']) {
      const table = envProblem(entry);
      expect(table, entry).toContain('metadata');
    }
  });

  it('treats an empty value as unset', () => {
    expect(loadEnv({ ADMINIUM_SECRET: SECRET, ADMINIUM_DATABASE_HOSTS: ' , ' }, quiet).ADMINIUM_DATABASE_HOSTS).toBeUndefined();
    expect(loadEnv({ ADMINIUM_SECRET: SECRET }, quiet).ADMINIUM_DATABASE_HOSTS).toBeUndefined();
  });

  it('parses one entry on its own', () => {
    expect(parseDatabaseHost('Localhost.:5432')).toEqual({ ok: true, entry: { host: 'localhost', port: 5432, wildcard: false } });
    expect(parseDatabaseHost('169.254.169.254')).toEqual({ ok: false, reason: 'metadata' });
    expect(parseDatabaseHost('db:abc')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('matching a connection string', () => {
  it('matches by host and port, the port defaulting per engine', () => {
    const list = hosts('localhost,db.internal:6543');
    expect(databaseHostListed(list, parseDsn('postgres://u@localhost/app'))).toBe(true);
    expect(databaseHostListed(list, parseDsn('postgres://u@localhost:5432/app'))).toBe(true);
    expect(databaseHostListed(list, parseDsn('mysql://u@localhost/app'))).toBe(true);
    expect(databaseHostListed(list, parseDsn('mysql://u@localhost:3306/app'))).toBe(true);
    // The list's default port is the engine's, never "any".
    expect(databaseHostListed(list, parseDsn('postgres://u@localhost:3306/app'))).toBe(false);
    expect(databaseHostListed(list, parseDsn('mysql://u@localhost:5432/app'))).toBe(false);
    expect(databaseHostListed(list, parseDsn('postgres://u@db.internal:6543/app'))).toBe(true);
    expect(databaseHostListed(list, parseDsn('postgres://u@db.internal:5432/app'))).toBe(false);
  });

  it('compares hosts normalised', () => {
    const list = hosts('localhost:5432,[::1]:5432');
    expect(databaseHostListed(list, parseDsn('postgres://u@LOCALHOST.:5432/app'))).toBe(true);
    expect(databaseHostListed(list, parseDsn('postgres://u@[::1]:5432/app'))).toBe(true);
    expect(databaseHostListed(list, parseDsn('postgres://u@127.0.0.1:5432/app'))).toBe(false);
  });

  it('matches a wildcard on subdomains only, and never on an address', () => {
    const list = hosts('*.pooler.supabase.com:6543');
    expect(databaseHostListed(list, parseDsn('postgres://u@aws-0-eu.pooler.supabase.com:6543/postgres'))).toBe(true);
    expect(databaseHostListed(list, parseDsn('postgres://u@pooler.supabase.com:6543/postgres'))).toBe(false);
    expect(databaseHostListed(list, parseDsn('postgres://u@evilpooler.supabase.com:6543/postgres'))).toBe(false);
    expect(databaseHostListed(list, parseDsn('postgres://u@aws-0-eu.pooler.supabase.com:5432/postgres'))).toBe(false);
  });

  it('never lists SQLite or a string without a host', () => {
    const list = hosts('localhost');
    expect(databaseHostListed(list, parseDsn('sqlite:/tmp/x.db'))).toBe(false);
    expect(databaseHostListed(list, parseDsn('postgres:///app'))).toBe(false);
  });
});

describe('the guard in production', () => {
  it('refuses loopback without the list, and names the entry to add', () => {
    expect(() => guardDsn('postgres://u@localhost:5432/app', { blockLoopback: true })).toThrow(
      'add localhost:5432 to ADMINIUM_DATABASE_HOSTS',
    );
    expect(() => guardDsn('mysql://u@127.0.0.1/app', { blockLoopback: true })).toThrow(
      'add 127.0.0.1:3306 to ADMINIUM_DATABASE_HOSTS',
    );
    expect(() => guardDsn('postgres://u@[::1]/app', { blockLoopback: true })).toThrow('add [::1]:5432 to ADMINIUM_DATABASE_HOSTS');
    // The troubleshooting docs quote the old opening; it stays.
    expect(() => guardDsn('postgres://u@localhost/app', { blockLoopback: true })).toThrow('Loopback hosts are not allowed in production');
  });

  it('lets the listed host and port through', () => {
    expect(guardDsn('postgres://u@localhost:5432/app', PROD('localhost:5432')).host).toBe('localhost');
    expect(guardDsn('postgres://u@localhost/app', PROD('localhost')).host).toBe('localhost');
    expect(guardDsn('mysql://u@localhost/app', PROD('localhost')).host).toBe('localhost');
    expect(guardDsn('postgres://u@127.0.0.1/app', PROD('127.1')).host).toBe('127.0.0.1');
  });

  it('still refuses another port on the same host', () => {
    expect(() => guardDsn('postgres://u@localhost:6379/app', PROD('localhost:5432'))).toThrow('add localhost:6379');
    expect(() => guardDsn('mysql://u@localhost/app', PROD('localhost:5432'))).toThrow('add localhost:3306');
  });

  it('still refuses another loopback spelling of the listed one', () => {
    expect(() => guardDsn('postgres://u@127.0.0.1:5432/app', PROD('localhost:5432'))).toThrow('Loopback');
  });

  it('a ?host= or ?port= behind a listed name cannot borrow the entry', () => {
    expect(() => guardDsn('postgres://u@localhost:5432/app?host=10.0.0.5', PROD('localhost:5432'))).toThrow('"host"');
    expect(() => guardDsn('postgres://u@localhost:5432/app?host=/var/run/postgresql', PROD('localhost:5432'))).toThrow('"host"');
    expect(() => guardDsn('postgres://u@localhost:5432/app?port=6379', PROD('localhost:5432'))).toThrow('"port"');
    expect(() => guardDsn('mysql://u@localhost:3306/app?socketPath=/tmp/mysql.sock', PROD('localhost:3306'))).toThrow('"socketPath"');
  });

  it('never lets a metadata address through, even listed', () => {
    // The env parser refuses such an entry; a list built another way is not trusted either.
    const listed: DatabaseHost[] = [
      { host: '169.254.169.254', port: null, wildcard: false },
      { host: 'metadata.google.internal', port: null, wildcard: false },
      { host: 'google.internal', port: null, wildcard: true },
    ];
    for (const dsn of ['postgres://u@169.254.169.254/app', 'postgres://u@metadata.google.internal/app', 'mysql://u@metadata.google.internal/app']) {
      expect(databaseHostListed(listed, parseDsn(dsn)), dsn).toBe(true);
      expect(() => guardDsn(dsn, { blockLoopback: true, databaseHosts: listed }), dsn).toThrow('blocked address range');
      expect(() => guardDsn(dsn, { blockLoopback: false, databaseHosts: listed }), dsn).toThrow('blocked address range');
    }
  });

  it('changes nothing outside production, and nothing for a host that is not loopback', () => {
    expect(guardDsn('postgres://u@localhost:6379/app', { blockLoopback: false, databaseHosts: hosts('localhost:5432') }).host).toBe('localhost');
    expect(guardDsn('postgres://u@db.example.com/app', PROD('localhost:5432')).host).toBe('db.example.com');
    expect(guardDsn('postgres://u@10.0.0.5/app', PROD('localhost:5432')).host).toBe('10.0.0.5');
  });

  it('names the entry the seed would need', () => {
    expect(unlistedLoopbackEntry('postgres://u@localhost/app', undefined)).toBe('localhost:5432');
    expect(unlistedLoopbackEntry('mysql://u@127.0.0.1:3307/app', hosts('127.0.0.1'))).toBe('127.0.0.1:3307');
    expect(unlistedLoopbackEntry('postgres://u@localhost/app', hosts('localhost'))).toBeNull();
    expect(unlistedLoopbackEntry('postgres://u@db:5432/app', undefined)).toBeNull();
    expect(unlistedLoopbackEntry('sqlite:/tmp/x.db', undefined)).toBeNull();
    expect(unlistedLoopbackEntry('mongodb://localhost/x', undefined)).toBeNull();
  });
});

// ── the source-connection front doors ──────────────────────────────────────

/**
 * An adapter that answers a test without dialling, recording where it was
 * sent: the fields it was handed (never a string), written back as a URL.
 */
function recordingProvider(dialled: string[]): AdapterProvider {
  return {
    dialect: 'postgres',
    create: (config: { dsn?: string; endpoint?: DatabaseEndpoint }) => {
      const at = config.endpoint;
      if (config.dsn !== undefined || at === undefined) throw new Error('the adapter was handed a connection string');
      dialled.push(`postgres://${at.user ?? ''}@${at.host}:${String(at.port)}/${at.database ?? ''}`);
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
    createQueryEngine: () => ({}),
  } as unknown as AdapterProvider;
}

describe('the connection manager', () => {
  let meta: MetaDb;
  let dialled: string[];

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    dialled = [];
  });

  afterEach(async () => {
    await meta.db.destroy();
  });

  function manager(list: string | undefined): ConnectionManager {
    const registry = new AdapterRegistry<AdapterProvider>();
    registry.register(recordingProvider(dialled));
    return new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret('db-hosts-test-secret'),
      registry,
      metaDsn: null,
      blockLoopback: true,
      lookup: async () => ['127.0.0.1'],
      ...(list === undefined ? {} : { databaseHosts: hosts(list) }),
    });
  }

  it('refuses a loopback source without the list, before it dials', async () => {
    await expect(manager(undefined).testDsn('postgres', 'postgres://u@localhost:5432/app')).rejects.toThrow('ADMINIUM_DATABASE_HOSTS');
    await expect(manager(undefined).checkDsnAllowed('postgres://u@localhost:5432/app', 'postgres')).rejects.toThrow('ADMINIUM_DATABASE_HOSTS');
    expect(dialled).toEqual([]);
  });

  it('tests a listed one, and still refuses another port', async () => {
    const m = manager('localhost:5432');
    expect((await m.testDsn('postgres', 'postgres://u@localhost:5432/app')).ok).toBe(true);
    expect(dialled).toEqual(['postgres://u@localhost:5432/app']);
    await expect(m.testDsn('postgres', 'postgres://u@localhost:6379/app')).rejects.toThrow('add localhost:6379');
    expect(dialled).toHaveLength(1);
  });

  it('applies the list on every later dial of a stored connection', async () => {
    const listed = manager('localhost:5432');
    const row = await listed.connections.create({
      name: 'app',
      engine: 'postgres',
      sourceKind: 'dsn',
      introspectDsn: 'postgres://u@localhost:5432/app',
      dataDsn: null,
      readOnly: false,
      settings: {},
      status: 'connected',
      createdBy: null,
    });
    await (await listed.introspectAdapter(row.id)).close();
    await (await listed.dataAdapter(row.id)).close();
    expect(dialled).toHaveLength(2);
    // The same row on a server whose operator took the entry out.
    await expect(manager(undefined).introspectAdapter(row.id)).rejects.toThrow('ADMINIUM_DATABASE_HOSTS');
    await expect(manager(undefined).dataAdapter(row.id)).rejects.toThrow('ADMINIUM_DATABASE_HOSTS');
    expect(dialled).toHaveLength(2);
  });

  it('seeds ADMINIUM_SOURCE_URL on a listed host', async () => {
    const result = await seedSourceConnection({
      manager: manager('localhost:5432'),
      meta,
      sourceUrl: 'postgres://u@localhost:5432/shop',
      log: () => undefined,
      warn: () => undefined,
    });
    expect(result.kind).toBe('seeded');
  });

  it('records the seed refused, with what to add, on an unlisted one', async () => {
    const warnings: string[] = [];
    const result = await seedSourceConnection({
      manager: manager(undefined),
      meta,
      sourceUrl: 'postgres://u@localhost:5432/shop',
      log: () => undefined,
      warn: (message) => warnings.push(message),
    });
    expect(result.kind).toBe('failed');
    expect(warnings.join('\n')).toContain('add localhost:5432 to ADMINIUM_DATABASE_HOSTS');
    expect(dialled).toEqual([]);
  });

  it('connects a project database on a listed host, and not on an unlisted port', async () => {
    const warnings: string[] = [];
    const outcomes = await syncProjectDatabases({
      manager: manager('localhost:5432'),
      meta,
      root: '/srv/project',
      databases: new Map([
        ['main', 'postgres://u@localhost:5432/shop'],
        ['cache', 'postgres://u@localhost:6379/x'],
      ]),
      missing: [],
      log: () => undefined,
      warn: (message) => warnings.push(message),
    });
    expect(outcomes.find((o) => o.key === 'main')).toMatchObject({ kind: 'created', ok: true });
    expect(outcomes.find((o) => o.key === 'cache')).toMatchObject({ kind: 'created', ok: false });
    expect(warnings.join('\n')).toContain('add localhost:6379 to ADMINIUM_DATABASE_HOSTS');
    expect(dialled).toEqual(['postgres://u@localhost:5432/shop']);
  });
});

// ── a real database on this machine ────────────────────────────────────────
// The point of the variable: production reaching the database next to it. Run
// against the local test servers when they are configured, and skipped green
// otherwise, like every other dialect leg.

const LIVE = [
  { engine: 'postgres', url: process.env['TEST_POSTGRES_URL'] || undefined },
  { engine: 'mysql', url: process.env['TEST_MYSQL_URL'] || undefined },
] as const;

describe.each(LIVE)('a $engine source on loopback, in production', ({ engine, url }) => {
  const loopback = url !== undefined && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname);

  it.skipIf(!loopback)('is refused without the list and connects with it', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    const parsed = parseDsn(url as string);
    const entry = `${new URL(url as string).hostname}:${String(parsed.port)}`;
    const make = (databaseHosts?: DatabaseHost[]) =>
      new ConnectionManager({
        meta,
        crypto: dsnCryptoFromSecret('db-hosts-test-secret'),
        registry,
        metaDsn: null,
        blockLoopback: true,
        ...(databaseHosts === undefined ? {} : { databaseHosts }),
      });
    try {
      await expect(make().testDsn(engine, url as string)).rejects.toThrow(`add ${entry} to ADMINIUM_DATABASE_HOSTS`);
      const summary = await make(hosts(entry)).testDsn(engine, url as string);
      expect(summary.error).toBeNull();
      expect(summary.ok).toBe(true);
    } finally {
      await meta.db.destroy();
    }
  });
});

// ── adminium start ─────────────────────────────────────────────────────────

describe('adminium start with ADMINIUM_SOURCE_URL on loopback', () => {
  const ENV = { ADMINIUM_SECRET: TEST_SECRET };

  function productionRuntime() {
    const runtime = fakeRuntime();
    (runtime.manager as unknown as { blockLoopback: boolean }).blockLoopback = true;
    return runtime;
  }

  it('fails the boot with a row naming the entry to add', async () => {
    const io = fakeIo();
    const runtime = productionRuntime();
    const deps = fakeDeps({ env: { ...ENV, ADMINIUM_SOURCE_URL: 'postgres://app:secret@localhost/shop' }, runtime });
    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.toBe(78);
    const said = io.stderr();
    expect(said).toContain('ADMINIUM_SOURCE_URL');
    expect(said).toContain('points at loopback; add `localhost:5432` to ADMINIUM_DATABASE_HOSTS');
    expect(said).not.toContain('secret');
    expect(deps.startServer).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalled();
  });

  it('boots when the list names it', async () => {
    const io = fakeIo();
    const deps = fakeDeps({
      env: { ...ENV, ADMINIUM_SOURCE_URL: 'postgres://app@localhost/shop', ADMINIUM_DATABASE_HOSTS: 'localhost:5432' },
      runtime: productionRuntime(),
    });
    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.toBe(0);
    expect(deps.startServer).toHaveBeenCalledOnce();
  });

  it('boots where loopback is not refused (a server on this computer)', async () => {
    const io = fakeIo();
    const deps = fakeDeps({ env: { ...ENV, ADMINIUM_SOURCE_URL: 'postgres://app@localhost/shop' } });
    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.toBe(0);
    expect(deps.startServer).toHaveBeenCalledOnce();
  });

  it('refuses a metadata address in the list before anything opens', async () => {
    const io = fakeIo();
    const deps = fakeDeps({ env: { ...ENV, ADMINIUM_DATABASE_HOSTS: '169.254.169.254' } });
    await expect(runCli(['start', '--skip-migrate'], { io, deps })).resolves.not.toBe(0);
    expect(io.stderr()).toContain('ADMINIUM_DATABASE_HOSTS');
    expect(deps.openRuntime).not.toHaveBeenCalled();
  });
});
