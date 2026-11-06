// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Servers and databases of their own, for the "your own apps" specs.
 *
 * A saved app is made on one server and installed on ANOTHER: a fresh server
 * that has never seen it, with an empty database of another engine. The shared
 * e2e server cannot be either of them. The Kiln fixture switches its languages
 * and its public API, a workspace regroups everyone's menu, and an install
 * leaves tables behind; every later spec would meet all of it. So these specs
 * start their own servers here, each the same boot script on a port of its
 * own, with its own data directory, SMTP sink and sign-in budget, and stop
 * them when the file ends.
 *
 * Each child server's own seeded database (Northwind) is always SQLite: the
 * engine under test is the one of the databases these specs add, which follow
 * the run's `E2E_ENGINE` (and reach the other engines when their URLs are set).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

import { signIn as apiSignIn, type Client } from '../fixtures/own-apps-kiln/client.mjs';
import { bundleOf } from './appBundle.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  E2E_DATABASE,
  ENGINE,
  PORT,
  TEST_MYSQL_URL,
  TEST_POSTGRES_URL,
  type E2eEngine,
  type SinkMessage,
} from './constants.js';

const require = createRequire(import.meta.url);
const BOOT = fileURLToPath(new URL('../scripts/e2e-server.mjs', import.meta.url));

/** The add-on bundle (a folder holding `invoices-<v>.tgz` and its `.integrity`), when this run has one. */
export const ADD_ONS_BUNDLE = process.env['E2E_ADD_ONS_BUNDLE'] ?? '';

export interface ChildServer {
  name: string;
  url: string;
  sinkUrl: string;
  /** The seeded super admin, signed in once over the API (each server has its own sign-in budget). */
  api: Client;
  /** A browser context signed in as that admin, with this server as its base. */
  context(browser: Browser): Promise<BrowserContext>;
  messages(): Promise<SinkMessage[]>;
  stop(): Promise<void>;
}

/**
 * Start a server of its own, `offset` above the run's port.
 *
 * The run already uses +0 (the shared server), +20 (first run) and +40 (the
 * project specs); each child takes +60 or more, and its SMTP sink and scripted
 * model take the next three ports above +100 of it, as the shared server's do.
 */
export async function startServer(name: string, offset: number, options: { addOns?: boolean } = {}): Promise<ChildServer> {
  const port = PORT + offset;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('ADMINIUM_')) env[key] = value;
  Object.assign(env, {
    E2E_ENGINE: 'sqlite',
    E2E_PORT: String(port),
    E2E_SMTP_PORT: String(port + 100),
    E2E_SINK_PORT: String(port + 101),
    E2E_FAKE_LLM_PORT: String(port + 102),
    E2E_DATABASE: `${E2E_DATABASE}_${name}`,
    // A folder that does not exist seeds nothing, as on a from-source server.
    ADMINIUM_BUNDLED_ADD_ONS: options.addOns === true && ADD_ONS_BUNDLE !== '' ? ADD_ONS_BUNDLE : join(tmpdir(), 'adminium-e2e-no-add-ons'),
  });
  const child: ChildProcess = spawn(process.execPath, [BOOT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const url = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the ${name} server exited ${String(child.exitCode)}:\n${output.slice(-3000)}`);
    const up = await fetch(`${url}/api/v1/healthz`).then((res) => res.ok, () => false);
    if (up) break;
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`the ${name} server did not answer in 180 s:\n${output.slice(-3000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const api = await apiSignIn({ url, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const sinkUrl = `http://127.0.0.1:${String(port + 101)}`;
  return {
    name,
    url,
    sinkUrl,
    api,
    async context(browser) {
      // An empty state, stated: the project's saved session belongs to the shared server.
      const context = await browser.newContext({ baseURL: url, storageState: { cookies: [], origins: [] } });
      await context.addCookies([...api.cookies].map(([cookie, value]) => ({ name: cookie, value, url })));
      return context;
    },
    async messages() {
      return (await (await fetch(`${sinkUrl}/messages`)).json()) as SinkMessage[];
    },
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}

// ── databases ──────────────────────────────────────────────────────────────

/** The slices of the drivers used here; neither `better-sqlite3` nor `pg` ships its types. */
interface SqliteDb {
  prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): unknown };
  exec(sql: string): void;
  close(): void;
}
type SqliteModule = new (file: string, options?: { fileMustExist?: boolean }) => SqliteDb;
interface PgClient {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}
type PgModule = { Client: new (options: { connectionString: string }) => PgClient };

/** The engines this run can reach: its own, and the others whose URLs are set. */
export function enginesHere(): E2eEngine[] {
  return (['sqlite', 'postgres', 'mysql'] as const).filter((engine) => engine === 'sqlite' || (engine === 'postgres' ? TEST_POSTGRES_URL !== '' : TEST_MYSQL_URL !== ''));
}

/** Where a target goes: every engine reachable but the source's, or the source's own when it is the only one. */
export function targetEngines(source: E2eEngine = ENGINE): E2eEngine[] {
  const others = enginesHere().filter((engine) => engine !== source);
  return others.length > 0 ? others : [source];
}

const work = mkdtempSync(join(tmpdir(), 'adminium-e2e-own-apps-'));

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export interface Database {
  engine: E2eEngine;
  /** The plain name: the database on Postgres and MySQL, the file's stem on SQLite. */
  name: string;
  dsn: string;
  /** The schema as the engine describes it: tables, columns, keys and indexes, in a stable order. */
  dump(): Promise<string>;
  /** A copy beside it, tables and rows, made with the engine's own tools. */
  copy(name: string): Promise<Database>;
  /** A SQLite write lock held from outside the server, for an install that must stop. */
  lock?(): () => void;
  drop(): Promise<void>;
}

/** An empty database on `engine`, named apart from any other run's. */
export async function emptyDatabase(engine: E2eEngine, stem: string): Promise<Database> {
  const name = `${E2E_DATABASE}_${stem}`;
  if (engine === 'sqlite') {
    const file = join(work, `${name}.db`);
    rmSync(file, { force: true });
    writeFileSync(file, '');
    return sqliteDatabase(name, file);
  }
  if (engine === 'postgres') {
    await pgAdmin(async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name}`);
    });
    return pgDatabase(name);
  }
  await mysqlAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.query(`CREATE DATABASE \`${name}\``);
  });
  return mysqlDatabase(name);
}

function sqliteDatabase(name: string, file: string): Database {
  const Sqlite = require('better-sqlite3') as SqliteModule;
  const open = () => new Sqlite(file, { fileMustExist: true });
  return {
    engine: 'sqlite',
    name,
    dsn: `sqlite:${file}`,
    async dump() {
      const db = open();
      try {
        const rows = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
        return JSON.stringify(rows, null, 1);
      } finally {
        db.close();
      }
    },
    async copy(copyName) {
      const target = join(work, `${E2E_DATABASE}_${copyName}.db`);
      rmSync(target, { force: true });
      const db = open();
      try {
        db.prepare('VACUUM INTO ?').run(target);
      } finally {
        db.close();
      }
      return sqliteDatabase(`${E2E_DATABASE}_${copyName}`, target);
    },
    lock() {
      const db = open();
      db.exec('BEGIN IMMEDIATE');
      return () => {
        db.exec('ROLLBACK');
        db.close();
      };
    },
    async drop() {
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
    },
  };
}

async function pgAdmin<T>(run: (client: PgClient) => Promise<T>, database?: string): Promise<T> {
  const pg = require('pg') as PgModule;
  const client = new pg.Client({ connectionString: database === undefined ? TEST_POSTGRES_URL : urlFor(TEST_POSTGRES_URL, database) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function pgDatabase(name: string): Database {
  return {
    engine: 'postgres',
    name,
    dsn: urlFor(TEST_POSTGRES_URL, name),
    dump: () =>
      pgAdmin(async (client) => {
        const columns = await client.query(
          `SELECT table_name, column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
             FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_name, ordinal_position`,
        );
        const constraints = await client.query(
          `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
             FROM pg_constraint WHERE connamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace) ORDER BY 1, 2`,
        );
        const indexes = await client.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2`);
        return JSON.stringify({ columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows }, null, 1);
      }, name),
    async copy(copyName) {
      const target = `${E2E_DATABASE}_${copyName}`;
      await pgAdmin(async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
        // A template must have no other session: the server's pool is closed off for the moment of the copy.
        await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
        await admin.query(`CREATE DATABASE ${target} TEMPLATE ${name}`);
      });
      return pgDatabase(target);
    },
    drop: () => pgAdmin(async (admin) => void (await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))),
  };
}

type MysqlConnection = { query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>; end(): Promise<void> };

async function mysqlAdmin<T>(run: (client: MysqlConnection) => Promise<T>, database?: string): Promise<T> {
  const mysql = (await import('mysql2/promise')) as unknown as { createConnection(options: { uri: string; multipleStatements?: boolean }): Promise<MysqlConnection> };
  const client = await mysql.createConnection({ uri: database === undefined ? TEST_MYSQL_URL : urlFor(TEST_MYSQL_URL, database), multipleStatements: true });
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function mysqlDatabase(name: string): Database {
  return {
    engine: 'mysql',
    name,
    dsn: urlFor(TEST_MYSQL_URL, name),
    dump: () =>
      mysqlAdmin(async (client) => {
        const [tables] = (await client.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`, [name])) as [{ t: string }[], unknown];
        const out: string[] = [];
        for (const { t } of tables) {
          const [rows] = (await client.query(`SHOW CREATE TABLE \`${name}\`.\`${t}\``)) as [Record<string, string>[], unknown];
          // The counter moves with every row; it is no part of the table's shape.
          out.push((rows[0]?.['Create Table'] ?? '').replace(/ AUTO_INCREMENT=\d+/, ''));
        }
        return out.join('\n\n');
      }),
    async copy(copyName) {
      const target = `${E2E_DATABASE}_${copyName}`;
      await mysqlAdmin(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS \`${target}\``);
        await client.query(`CREATE DATABASE \`${target}\``);
        const [tables] = (await client.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`, [name])) as [{ t: string }[], unknown];
        await client.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const { t } of tables) {
          const [rows] = (await client.query(`SHOW CREATE TABLE \`${name}\`.\`${t}\``)) as [Record<string, string>[], unknown];
          await client.query(`USE \`${target}\``);
          await client.query(rows[0]?.['Create Table'] ?? '');
          await client.query(`INSERT INTO \`${target}\`.\`${t}\` SELECT * FROM \`${name}\`.\`${t}\``);
        }
        await client.query('SET FOREIGN_KEY_CHECKS = 1');
      });
      return mysqlDatabase(target);
    },
    drop: () => mysqlAdmin(async (admin) => void (await admin.query(`DROP DATABASE IF EXISTS \`${name}\``))),
  };
}

/** A connection on `server` to `database`, introspected; returns its id. */
export async function connect(server: ChildServer, database: Database, name: string): Promise<string> {
  const made = (await server.api.post('/connections', { name, engine: database.engine, dsn: database.dsn })) as { id: string; readOnly: boolean };
  expect(made.readOnly, `${name} is writable`).toBe(false);
  await server.api.post(`/connections/${made.id}/generate`, {});
  return made.id;
}

// ── the app file itself ──────────────────────────────────────────────────────

const semver = (version: string): number[] => version.split(/[.-]/).slice(0, 3).map(Number);
/** Whether `a` is older than `b`. */
export function olderThan(a: string, b: string): boolean {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i += 1) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** The version a server reports. */
export async function versionOf(server: ChildServer): Promise<string> {
  return ((await server.api.get('/bootstrap')) as { data: { version: string } }).data.version;
}

/** The Adminium a saved file asks for (its `minAdminiumVersion`). */
export function floorOf(files: Record<string, string>): string {
  const manifest = JSON.parse(files['manifest.json'] ?? files['app.json'] ?? '{}') as { compatibility?: { minAdminiumVersion?: string } };
  return manifest.compatibility?.minAdminiumVersion ?? '0.0.0';
}

/**
 * Skip, saying why, when this server is older than the words a saved file
 * uses. Before the release that carries them, a build of this tree still
 * calls itself the last release, and refuses its own saved files with
 * "needs Adminium X", as any older server does.
 */
export async function skipUnlessInstallable(server: ChildServer, file: Buffer): Promise<void> {
  const [running, floor] = [await versionOf(server), floorOf(membersOf(file))];
  test.skip(olderThan(running, floor), `this build calls itself ${running}; the saved file needs ${floor}, the release that carries its words`);
}

export const fingerprintOf = (bytes: Buffer): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

/** The members of a package (`package/` taken off each path), as text. */
export function membersOf(tgz: Buffer): Record<string, string> {
  const tar = gunzipSync(tgz);
  const files: Record<string, string> = {};
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (from: number, length: number) => header.subarray(from, from + length).toString('latin1').replace(/\0.*$/s, '');
    const path = `${field(345, 155) === '' ? '' : `${field(345, 155)}/`}${field(0, 100)}`;
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    if (type === '0' || type === '') files[path.replace(/^package\//, '')] = tar.subarray(at + 512, at + 512 + size).toString('utf8');
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** A package made again from its members, as a person editing the file by hand would. */
export const repack = (files: Record<string, string>): { buffer: Buffer; integrity: string } => bundleOf(files);

/** A table made the way Studio makes one (plan, then apply that plan), with its page adopted. Returns its id. */
export async function addTable(server: ChildServer, connectionId: string, table: Record<string, unknown>): Promise<string> {
  const schema = (await server.api.get(`/connections/${connectionId}/schema`)) as { snapshotId: string };
  const edit = { baseSnapshotId: schema.snapshotId, upsertTables: [table] };
  const plan = (await server.api.post(`/connections/${connectionId}/schema/plan`, edit)) as { checksum: string; refusals: unknown[] };
  expect(plan.refusals, 'the schema plan').toEqual([]);
  const applied = (await server.api.post(`/connections/${connectionId}/schema/apply`, { ...edit, checksum: plan.checksum, acknowledgeRows: true })) as { status: string; createdTables: string[] };
  expect(applied.status).toBe('applied');
  await server.api.post(`/connections/${connectionId}/schema/adopt`, { tables: applied.createdTables });
  return applied.createdTables[0]!;
}

/** The tables of a connection, by name: columns in order, with what an install must keep the same on any engine. */
export async function tablesOf(server: ChildServer, connectionId: string, names: readonly string[]): Promise<Record<string, string[]>> {
  const schema = (await server.api.get(`/connections/${connectionId}/schema`)) as {
    model: { tables: { name: string; columns: { name: string; nullable: boolean; isPrimaryKey: boolean; logicalType: string; references: Record<string, unknown> | null }[] }[] };
  };
  // A coarse kind per column: engines spell a type their own way (an enum is a varchar with a check on SQLite).
  const kind = (logical: string): string =>
    /int|serial/.test(logical) ? 'integer' : /dec|num|money|float|double|real/.test(logical) ? 'number' : /date|time/.test(logical) ? logical.replace(/tz$/, '') : /bool/.test(logical) ? 'boolean' : 'text';
  // The table a column points at, by its plain name: ids carry the engine's schema (`main.`, `public.`, `<db>.`).
  const pointsAt = (ref: Record<string, unknown> | null): string => {
    if (ref === null) return '';
    const to = ref['table'] ?? ref['toTable'] ?? ref['tableId'] ?? ref['name'];
    return ` -> ${typeof to === 'string' ? (to.split('.').at(-1) ?? '') : JSON.stringify(ref)}`;
  };
  const out: Record<string, string[]> = {};
  for (const name of names) {
    const table = schema.model.tables.find((one) => one.name === name);
    out[name] = table === undefined ? [] : table.columns.map((c) => `${c.name} ${kind(c.logicalType)}${c.nullable ? ' null' : ''}${c.isPrimaryKey ? ' pk' : ''}${pointsAt(c.references)}`);
  }
  return out;
}

/** Upload a package over the API as the signed-in admin (the reply as it is, for a spec that reads a refusal's details). */
export async function uploadFile(server: ChildServer, bytes: Buffer): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${server.url}/api/v1/apps/upload?expectedSha512=${encodeURIComponent(fingerprintOf(bytes))}`, {
    method: 'POST',
    headers: {
      origin: server.url,
      'content-type': 'application/octet-stream',
      cookie: [...server.api.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(server.api.csrf === null ? {} : { 'x-adminium-csrf': server.api.csrf }),
    },
    body: new Uint8Array(bytes),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}
