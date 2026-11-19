// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A trial booted by `adminium start` as an operator project (plan build-box
 * E2, E3), on a real port:
 *
 *  - a trial that was seeded before (the classic `ADMINIUM_SOURCE_URL` boot)
 *    and is then started as an operator project keeps ONE `main`;
 *  - the user's database is never on the boot path: with a `yours` that does
 *    not resolve, the server is ready at once, and `/system/info` says the
 *    database is down with a coarse reason, never its host.
 *
 * The operator's database is a real Postgres on this machine, listed in
 * `ADMINIUM_DATABASE_HOSTS` (TEST_POSTGRES_URL; the test skips without one).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { connectionsRepo, createSqliteMetaDb, firstRun, pagesRepo } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { afterEach, describe, expect, it } from 'vitest';

import { startUp, type StartedUp } from '../src/cli/commands/start.js';
import { defaultCliDeps } from '../src/cli/runtime.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { seedSourceConnection } from '../src/connections/seed.js';
import { forgetOperatorProjects } from '../src/project/operator-project.js';
import { fakeIo, TEST_SECRET } from './cli-helpers.js';

const PG = process.env['TEST_POSTGRES_URL'] || undefined;
const run = PG === undefined ? it.skip : it;

const anyPort = async (): Promise<number> =>
  new Promise((done) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

/** A GET with the operator's Host (the instance answers only its own). */
const get = async (port: number, path: string): Promise<{ status: number; body: string }> =>
  new Promise((done, fail) => {
    request({ host: '127.0.0.1', port, path, headers: { host: 'hollis.try.example.com' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, body }));
    })
      .once('error', fail)
      .end();
  });

let live: StartedUp | null = null;
let dir: string;
const drops: (() => Promise<void>)[] = [];
afterEach(async (context) => {
  // What the server said, when it went wrong: the boot's own lines are the first clue.
  if (context.task.result?.state === 'fail') for (const io of ios) console.error(io.stdout(), io.stderr());
  ios.length = 0;
  if (live !== null) await Promise.race([live.close(), new Promise((done) => setTimeout(done, 30_000))]);
  live = null;
  forgetOperatorProjects();
  while (drops.length > 0) await drops.pop()?.();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

async function operatorDatabase(): Promise<string> {
  const { default: pg } = await import('pg');
  const database = `trial_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: PG });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();
  const url = new URL(PG as string);
  url.pathname = `/${database}`;
  url.hostname = '127.0.0.1';
  if (url.username === '') url.username = process.env.USER ?? 'postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query('CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL)');
  await client.end();
  drops.push(async () => {
    const drop = new pg.Client({ connectionString: PG });
    await drop.connect();
    await drop.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await drop.end();
  });
  return url.toString();
}

const ios: ReturnType<typeof fakeIo>[] = [];
const start = async (env: Record<string, string | undefined>): Promise<StartedUp> => {
  const io = fakeIo();
  ios.push(io);
  return startUp({ io, deps: { ...defaultCliDeps(), env, cwd: dir } }, { port: await anyPort(), host: '127.0.0.1', logLevel: 'warn' });
};

describe('a trial started as an operator project', () => {
  run('adopts the classic seed as main, and is ready while its user database is down', { timeout: 600_000 }, async () => {
    dir = mkdtempSync(join(tmpdir(), 'adminium-operator-boot-'));
    const source = await operatorDatabase();
    const port = new URL(source).port || '5432';
    const base: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'production',
      ADMINIUM_SECRET: TEST_SECRET,
      ADMINIUM_DATA_DIR: join(dir, 'data'),
      ADMINIUM_TRIAL_MODE: 'on',
      ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
      ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com',
      ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
      ADMINIUM_DATABASE_HOSTS: `127.0.0.1:${port}`,
      ADMINIUM_SOURCE_URL: source,
      ADMINIUM_SCHEDULER: 'off',
    };

    // 1. The trial as it was made before: the classic seed, as `adminium start` runs it, on the trial's own store.
    mkdirSync(join(dir, 'data'), { recursive: true });
    const before = createSqliteMetaDb({ database: new BetterSqlite3(join(dir, 'data', 'meta.db')) });
    try {
      await firstRun(before);
      const registry = new AdapterRegistry<AdapterProvider>();
      await registerAdapters(registry);
      const manager = new ConnectionManager({ meta: before, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
      const said: string[] = [];
      const seeded = await seedSourceConnection({ manager, meta: before, sourceUrl: source, log: (line) => said.push(line), warn: (line) => said.push(line) });
      expect(seeded.kind, said.join('\n')).toBe('seeded');
      await manager.disposeAll();
    } finally {
      await before.db.destroy();
    }

    // 2. The same trial, now an operator project with the user's database.
    const env = {
      ...base,
      ADMINIUM_OPERATOR_PROJECT: 'on',
      ADMINIUM_YOUR_DATABASE: JSON.stringify({ url: 'postgres://ava:pw@db.invalid:5432/shop', label: 'Harbor books', intent: 'read-only-analytics' }),
      ADMINIUM_DATABASE_USER_HOST: 'db.invalid:5432',
    };
    const began = Date.now();
    live = await start(env);
    const output = ios.at(-1);
    expect(output?.stdout() ?? '').toContain('the seeded connection is now the project\'s main');
    const ready = await get(live.port, '/api/v1/readyz');
    expect(ready.status).toBe(200);
    // Ready without waiting on a database the operator does not run (its probe alone may take 5 s).
    expect(Date.now() - began).toBeLessThan(60_000);

    // The user's database goes down in the background, and says so without its host.
    let info: { ownDatabase: { state: string; reason: string | null; readOnly: boolean } | null } = { ownDatabase: null };
    for (let tries = 0; tries < 50; tries += 1) {
      info = JSON.parse((await get(live.port, '/api/v1/system/info')).body) as typeof info;
      if (info.ownDatabase?.state === 'down') break;
      await new Promise((done) => setTimeout(done, 200));
    }
    expect(info.ownDatabase).toMatchObject({ state: 'down', readOnly: true });
    expect(['dns', 'refused-by-us']).toContain(info.ownDatabase?.reason);
    expect(JSON.stringify(info)).not.toContain('db.invalid');
    // Bounded: a close that hangs is reported, not waited on for the whole run.
    const closing = live;
    live = null;
    const closed = await Promise.race([closing.close().then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), 30_000))]);
    if (!closed) console.error('[operator-project-boot] close() did not finish within 30 s');

    // One `main` (the seeded one, adopted), one `yours`; the main's pages were not made twice.
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(join(dir, 'data', 'meta.db')) });
    try {
      const connections = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).list();
      expect(connections.map((row) => row.projectKey).sort()).toEqual(['main', 'yours']);
      const main = connections.find((row) => row.projectKey === 'main');
      const pages = await pagesRepo(meta).listForConnection(main!.id);
      expect(new Set(pages.map((page) => page.slug)).size).toBe(pages.length);
    } finally {
      await meta.db.destroy();
    }
  });
});
