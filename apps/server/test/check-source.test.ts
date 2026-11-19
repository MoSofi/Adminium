// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium check-source`.
 *
 * The guard's refusals run without a database. The classes a real server
 * answers run against Postgres (TEST_POSTGRES_URL) and MySQL (TEST_MYSQL_URL),
 * each in a throwaway database, and skip green without them. A real check
 * refuses this machine, so those runs name the test server's host through the
 * test-only `testListedHosts` seam, which no flag or variable reaches.
 */
import { randomBytes } from 'node:crypto';

import { adapterRegistry } from '@adminium/engine/adapter';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { oneDsn, runCheckSource } from '../src/cli/commands/check-source.js';
import { CliError } from '../src/cli/exit.js';
import type { CliIo } from '../src/cli/io.js';
import { checkSource, shortVersion, type CheckSourceResult } from '../src/connections/check-source.js';
import { parseDatabaseHost, type DatabaseHost } from '../src/connections/dsn.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { parseDenyAddresses } from '../src/connections/user-host.js';
import type { HostLookup } from '../src/net/address-guard.js';

const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const lookup: HostLookup = async (host) => {
  const answers: Record<string, readonly string[]> = {
    'db.user.example': ['93.184.215.40'],
    'fleet.user.example': ['203.0.113.250'],
    'lan.user.example': ['10.1.2.3'],
  };
  const answer = answers[host];
  if (answer === undefined) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return answer;
};

function listedFor(url: string): DatabaseHost[] {
  const parsed = new URL(url);
  const port = parsed.port === '' ? (url.startsWith('mysql') ? '3306' : '5432') : parsed.port;
  const entry = parseDatabaseHost(`${parsed.hostname}:${port}`);
  if (!entry.ok) throw new Error('bad test url');
  return [entry.entry];
}

function withDatabase(url: string, database: string, user?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user !== undefined) {
    parsed.username = user;
    parsed.password = 'not-the-password';
  }
  return parsed.toString();
}

/** Never the server's own words or the login: only the shape. */
function expectNoLeak(result: CheckSourceResult, ...secrets: string[]): void {
  const said = JSON.stringify(result);
  for (const secret of secrets) expect(said).not.toContain(secret);
  expect(said).not.toMatch(/password|authentication|does not exist|denied/i);
}

beforeAll(async () => {
  await registerAdapters(adapterRegistry);
});

describe('refused before any dial', () => {
  it.each([
    ['a SQLite file', 'sqlite:///etc/passwd'],
    ['a parameter that moves the host', 'postgres://u:p@db.user.example:5432/app?host=/var/run/postgresql'],
    ['port 22', 'postgres://u:p@db.user.example:22/app'],
    ['port 2376 (Docker)', 'mysql://u:p@db.user.example:2376/app'],
    ['port 8443', 'postgres://u:p@db.user.example:8443/app'],
    ['loopback', 'postgres://u:p@localhost:5432/app'],
    ['a private address', 'postgres://u:p@lan.user.example:5432/app'],
    ['the fleet', 'postgres://u:p@fleet.user.example:5432/app'],
    ['metadata', 'postgres://u:p@169.254.169.254:5432/app'],
    ['a reserved range', 'postgres://u:p@192.0.2.10:5432/app'],
    ['not a URL', 'host=db.example.com user=u'],
  ])('%s', async (_what, dsn) => {
    const deny = parseDenyAddresses('203.0.113.250');
    if (!deny.ok) throw new Error('deny');
    const result = await checkSource(dsn, { lookup, denyAddresses: deny.ranges });
    expect(result).toMatchObject({ ok: false, class: 'refused-by-us', tables: [], schemas: [] });
  });

  it('a name that does not resolve is dns', async () => {
    expect(await checkSource('postgres://u:p@nowhere.user.example:5432/app', { lookup })).toMatchObject({ ok: false, class: 'dns', engine: 'postgres' });
  });

  it('a port nobody answers on is unreachable', async () => {
    const result = await checkSource('postgres://u:p@127.0.0.1:1/app', { testListedHosts: listedFor('postgres://127.0.0.1:1') });
    expect(result).toMatchObject({ ok: false, class: 'unreachable', engine: 'postgres' });
  });

  it('a check that outlives the deadline answers unreachable', async () => {
    const slow: HostLookup = () => new Promise((resolve) => setTimeout(() => resolve(['93.184.215.40']), 500));
    expect(await checkSource('postgres://u:p@db.user.example:5432/app', { lookup: slow, deadlineMs: 50 })).toMatchObject({ class: 'unreachable' });
  });

  it('versions keep their number only', () => {
    expect(shortVersion('PostgreSQL 16.4 (Homebrew) on aarch64-apple-darwin')).toBe('16.4');
    expect(shortVersion('16.4')).toBe('16.4');
    expect(shortVersion('8.4.0')).toBe('8.4.0');
    expect(shortVersion('10.11.6-MariaDB-0+deb12u1')).toBe('10.11.6 MariaDB');
    expect(shortVersion(null)).toBeNull();
  });
});

describe('the command', () => {
  const capture = (): { io: CliIo; out: string[] } => {
    const out: string[] = [];
    return { io: { out: (line: string) => out.push(line), err: () => undefined } as unknown as CliIo, out };
  };

  it('reads one connection string and prints exactly one JSON line', async () => {
    const { io, out } = capture();
    const { code } = await runCheckSource({ io, deps: { env: {} } as never }, 'sqlite:///tmp/x.db\n');
    expect(code).toBe(1);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] ?? '')).toEqual({ ok: false, class: 'refused-by-us', engine: null, version: null, tables: [], schemas: [] });
  });

  it('two strings, or none, are refused', () => {
    expect(oneDsn('postgres://a\npostgres://b\n')).toBeNull();
    expect(oneDsn('\n\n')).toBeNull();
    expect(oneDsn('  postgres://a  \r\n')).toBe('postgres://a');
  });

  it('a deny list that does not parse stops it', async () => {
    const { io } = capture();
    await expect(runCheckSource({ io, deps: { env: { ADMINIUM_DATABASE_DENY_ADDRESSES: 'nope' } } as never }, 'postgres://u@db.user.example:5432/a')).rejects.toBeInstanceOf(CliError);
  });

  it('the deny list from the environment is applied', async () => {
    const { io, out } = capture();
    await runCheckSource({ io, deps: { env: { ADMINIUM_DATABASE_DENY_ADDRESSES: '93.184.215.0/24' } } as never }, 'postgres://u@db.user.example:5432/a', { lookup });
    expect(JSON.parse(out[0] ?? '')).toMatchObject({ class: 'refused-by-us' });
  });
});

describe.skipIf(POSTGRES_URL === undefined)('Postgres', () => {
  const base = POSTGRES_URL ?? 'postgres://localhost:5432/postgres';
  const tag = randomBytes(4).toString('hex');
  const shop = `cs_shop_${tag}`;
  const empty = `cs_empty_${tag}`;
  const many = `cs_many_${tag}`;
  const listed = listedFor(base);
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: base });
    await admin.connect();
    for (const name of [shop, empty, many]) await admin.query(`CREATE DATABASE ${name}`);
    const c = new pg.Client({ connectionString: withDatabase(base, shop) });
    await c.connect();
    await c.query(`
      CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL, email text);
      CREATE TABLE orders (id serial PRIMARY KEY, customer_id int REFERENCES customers(id), total numeric);
      CREATE SCHEMA billing;
      CREATE TABLE billing.invoices (id serial PRIMARY KEY, order_id int REFERENCES public.orders(id));
      CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
      CREATE TABLE wide (${Array.from({ length: 250 }, (_, i) => `c${String(i)} int`).join(', ')});
      INSERT INTO customers (name) SELECT 'n' || g FROM generate_series(1, 50) g;
      ANALYZE customers;`);
    await c.end();
    const m = new pg.Client({ connectionString: withDatabase(base, many) });
    await m.connect();
    await m.query(`DO $$ BEGIN FOR i IN 1..501 LOOP EXECUTE format('CREATE TABLE t%s (id int)', i); END LOOP; END $$;`);
    await m.end();
  }, 120_000);

  afterAll(async () => {
    for (const name of [shop, empty, many]) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  });

  it('ok: tables by schema, columns in order (200 at most), links, estimates, views; never a row', async () => {
    const result = await checkSource(withDatabase(base, shop), { testListedHosts: listed });
    expect(result).toMatchObject({ ok: true, class: 'ok', engine: 'postgres' });
    expect(result.version).toMatch(/^\d+(\.\d+)*$/);
    expect(result.schemas).toEqual(expect.arrayContaining(['public', 'billing']));
    const byId = new Map(result.tables.map((table) => [table.id, table]));
    expect([...byId.keys()]).toEqual(expect.arrayContaining(['public.customers', 'public.orders', 'billing.invoices', 'public.big_orders', 'public.wide']));
    expect(byId.get('public.customers')).toMatchObject({ schema: 'public', name: 'customers', columns: ['id', 'name', 'email'], links: [], estimate: 50 });
    expect(byId.get('public.orders')?.links).toEqual(['public.customers']);
    expect(byId.get('billing.invoices')?.links).toEqual(['public.orders']);
    expect(byId.get('public.wide')?.columns).toHaveLength(200);
    expect(JSON.stringify(result)).not.toContain("'n1'");
  });

  it('empty, too-many, no-database, auth and tls', async () => {
    expect(await checkSource(withDatabase(base, empty), { testListedHosts: listed })).toMatchObject({ ok: false, class: 'empty', engine: 'postgres' });
    const tooMany = await checkSource(withDatabase(base, many), { testListedHosts: listed });
    expect(tooMany).toMatchObject({ ok: false, class: 'too-many' });
    expect(tooMany.tables).toHaveLength(500);
    const missing = await checkSource(withDatabase(base, `cs_none_${tag}`), { testListedHosts: listed });
    expect(missing).toMatchObject({ ok: false, class: 'no-database' });
    expectNoLeak(missing, `cs_none_${tag}`);
    const stranger = await checkSource(withDatabase(base, shop, `nobody_${tag}`), { testListedHosts: listed });
    expect(stranger).toMatchObject({ ok: false, class: 'auth' });
    expectNoLeak(stranger, `nobody_${tag}`, 'not-the-password');
    const tls = await checkSource(`${withDatabase(base, shop)}?sslmode=verify-full`, { testListedHosts: listed });
    expect(['tls', 'ok']).toContain(tls.class);
  }, 60_000);
});

describe.skipIf(MYSQL_URL === undefined)('MySQL', () => {
  const base = MYSQL_URL ?? 'mysql://root@127.0.0.1:3306';
  const tag = randomBytes(4).toString('hex');
  const shop = `cs_shop_${tag}`;
  const empty = `cs_empty_${tag}`;
  const listed = listedFor(base);
  let admin: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection({ uri: base, multipleStatements: true });
    await admin.query(`CREATE DATABASE \`${shop}\`; CREATE DATABASE \`${empty}\`;`);
    await admin.query(`
      CREATE TABLE \`${shop}\`.customers (id int PRIMARY KEY AUTO_INCREMENT, name varchar(80) NOT NULL, email varchar(120)) ENGINE=InnoDB;
      CREATE TABLE \`${shop}\`.orders (id int PRIMARY KEY AUTO_INCREMENT, customer_id int, total decimal(10,2), FOREIGN KEY (customer_id) REFERENCES \`${shop}\`.customers(id)) ENGINE=InnoDB;
      CREATE VIEW \`${shop}\`.big_orders AS SELECT * FROM \`${shop}\`.orders WHERE total > 100;`);
  }, 60_000);

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS \`${shop}\`; DROP DATABASE IF EXISTS \`${empty}\`;`).catch(() => undefined);
    await admin.end();
  });

  it('ok: the database as the schema, columns, links, views', async () => {
    const result = await checkSource(withDatabase(base, shop), { testListedHosts: listed });
    expect(result).toMatchObject({ ok: true, class: 'ok', engine: 'mysql', schemas: [shop] });
    expect(result.version).toMatch(/^\d+(\.\d+)*( MariaDB)?$/);
    const byId = new Map(result.tables.map((table) => [table.id, table]));
    expect(byId.get(`${shop}.customers`)).toMatchObject({ schema: shop, name: 'customers', columns: ['id', 'name', 'email'], links: [] });
    expect(byId.get(`${shop}.orders`)?.links).toEqual([`${shop}.customers`]);
    expect(byId.get(`${shop}.big_orders`)?.estimate).toBeNull();
  });

  it('empty, no-database and auth', async () => {
    expect(await checkSource(withDatabase(base, empty), { testListedHosts: listed })).toMatchObject({ ok: false, class: 'empty', engine: 'mysql' });
    const missing = await checkSource(withDatabase(base, `cs_none_${tag}`), { testListedHosts: listed });
    expect(missing).toMatchObject({ ok: false, class: 'no-database' });
    expectNoLeak(missing, `cs_none_${tag}`);
    const stranger = await checkSource(withDatabase(base, shop, `nobody_${tag}`), { testListedHosts: listed });
    expect(stranger).toMatchObject({ ok: false, class: 'auth' });
    expectNoLeak(stranger, `nobody_${tag}`, 'not-the-password');
  }, 60_000);
});
