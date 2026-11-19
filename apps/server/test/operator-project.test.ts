// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An operator project (plan build-box E2, E3): a trial run as a project whose
 * config is the environment's, and the user's own database connected as
 * `yours` off the boot path.
 *
 * The meta store runs on each dialect (`META_ENGINES`); the user's database is
 * a real Postgres or MySQL (TEST_POSTGRES_URL / TEST_MYSQL_URL), each leg
 * skipping green without one. The guard is an ordinary server's here (loopback
 * allowed): what is proved is the project's behaviour, not the trial's hosts,
 * which `trial` tests and the guard's own suite prove.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { operatorTalliesRepo, pagesRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseYourDatabase, cleanNotes, type YourDatabase } from '../src/config/your-database.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { seedSourceConnection } from '../src/connections/seed.js';
import { prepareProject } from '../src/project/boot.js';
import { loadProjectConfig } from '../src/project/build.js';
import { syncProjectDatabases } from '../src/project/databases.js';
import { findProject } from '../src/project/locate.js';
import { adoptSeededMain } from '../src/project/operator-adopt.js';
import { forgetOperatorProjects, isOperatorLocation, OPERATOR_CONFIG_NAME, operatorProjectOn } from '../src/project/operator-project.js';
import { connectYourDatabase, registerYourDatabase, startYourDatabase, YOURS_CHOICE_TALLY, yoursDataDsn } from '../src/project/your-database.js';
import { yourDatabaseStatus } from '../src/project/your-database-state.js';
import { META_ENGINES } from './meta-dialects.js';

const TRIAL_ENV = { ADMINIUM_TRIAL_MODE: 'on', ADMINIUM_OPERATOR_PROJECT: 'on' };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-operator-project-'));
  forgetOperatorProjects();
});
afterEach(() => {
  forgetOperatorProjects();
  rmSync(dir, { recursive: true, force: true });
});

describe('the operator project switch', () => {
  it('holds only in trial or hosted mode', () => {
    expect(operatorProjectOn({ ADMINIUM_OPERATOR_PROJECT: 'on' })).toBe(false);
    expect(operatorProjectOn(TRIAL_ENV)).toBe(true);
    expect(operatorProjectOn({ ADMINIUM_HOSTED_MODE: 'on', ADMINIUM_OPERATOR_PROJECT: 'on' })).toBe(true);
    expect(operatorProjectOn({ ADMINIUM_TRIAL_MODE: 'on' })).toBe(false);
  });
});

describe('an operator project has no config file', () => {
  it('is found under the data folder, with no file, from any folder; then by its root with no environment (the Designer)', () => {
    const data = join(dir, 'data');
    const found = findProject('/app', { ...TRIAL_ENV, ADMINIUM_DATA_DIR: data });
    expect(found).toEqual({ root: join(data, 'project'), configFile: join(data, 'project', OPERATOR_CONFIG_NAME) });
    expect(isOperatorLocation(found!)).toBe(true);
    expect(findProject(join(data, 'project', 'apps', 'shop'), {})?.root).toBe(join(data, 'project'));
  });

  it('never runs a config file written into its folder, and builds the config from the environment', async () => {
    const data = join(dir, 'data');
    const root = join(data, 'project');
    mkdirSync(root, { recursive: true });
    const marker = join(dir, 'ran');
    // A config file a Super Admin might plant: importing it would write the marker.
    writeFileSync(join(root, 'adminium.config.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'x'); export default {};\n`);
    const warned: string[] = [];
    const env: Record<string, string | undefined> = { ...TRIAL_ENV, ADMINIUM_DATA_DIR: data, ADMINIUM_SOURCE_URL: 'postgres://trial_1:pw@pg-trials:5432/trial_1' };
    const prepared = await prepareProject({ cwd: '/', env, version: '0.0.0-test', warn: (message) => warned.push(message) });
    expect(prepared?.operator).toBe(true);
    expect(prepared?.project.root).toBe(root);
    expect([...(prepared?.databases.ready.entries() ?? [])]).toEqual([['main', 'postgres://trial_1:pw@pg-trials:5432/trial_1']]);
    expect(prepared?.env.ADMINIUM_DATA_DIR).toBe(data);
    expect(existsSync(join(root, 'apps'))).toBe(true);
    expect(existsSync(join(root, '.adminium', 'build', 'manifest.json'))).toBe(true);
    expect(warned.join('\n')).toMatch(/adminium\.config\.mjs; it is not read/);
    // And the build path refuses it too.
    const loaded = await loadProjectConfig(prepared!.project, { version: '0.0.0-test' });
    expect(loaded.from).toBe('source');
    expect(existsSync(marker)).toBe(false);
  });
});

async function registry(): Promise<AdapterRegistry<AdapterProvider>> {
  const made = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(made);
  return made;
}

const managerFor = async (meta: MetaDb): Promise<ConnectionManager> =>
  new ConnectionManager({ meta, crypto: dsnCryptoFromSecret('operator-project-test-secret'), registry: await registry(), metaDsn: null, blockLoopback: false });

describe.each(META_ENGINES.filter((engine) => engine.available))('an existing trial opened as a project, meta on $name', (engine) => {
  it('adopts the seeded connection as main: no second main, no second set of pages', async () => {
    const handle = await engine.make();
    const manager = await managerFor(handle.meta);
    try {
      const file = join(dir, 'shop.db');
      const source = new BetterSqlite3(file);
      source.exec('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
      source.close();
      const url = `sqlite:${file}`;
      const seeded = await seedSourceConnection({ manager, meta: handle.meta, sourceUrl: url, log: () => undefined, warn: () => undefined });
      if (seeded.kind !== 'seeded') throw new Error(`not seeded: ${seeded.kind}`);
      const pagesBefore = (await pagesRepo(handle.meta).listForConnection(seeded.connectionId)).length;
      expect(pagesBefore).toBeGreaterThan(0);

      expect(await adoptSeededMain(manager, handle.meta)).toBe('adopted');
      const outcomes = await syncProjectDatabases({ manager, meta: handle.meta, root: dir, databases: new Map([['main', url]]), missing: [], log: () => undefined, warn: () => undefined });
      expect(outcomes).toMatchObject([{ key: 'main', kind: 'unchanged' }]);
      const connections = await manager.connections.list();
      expect(connections).toHaveLength(1);
      expect(connections[0]?.projectKey).toBe('main');
      expect((await pagesRepo(handle.meta).listForConnection(seeded.connectionId)).length).toBe(pagesBefore);
      // Idempotent: the next boot finds it already.
      expect(await adoptSeededMain(manager, handle.meta)).toBe('already');
    } finally {
      await manager.disposeAll().catch(() => undefined);
      await handle.destroy();
    }
  });
});

describe('ADMINIUM_YOUR_DATABASE', () => {
  it('reads the JSON, forces read-only for read-only analytics, and never repeats the URL in a problem', () => {
    const parsed = parseYourDatabase(JSON.stringify({ url: 'postgres://u:secret@db.example.com:6543/shop', intent: 'read-only-analytics', tables: ['public.orders', 'public.orders'], label: 'Shop' }));
    expect(parsed.ok && parsed.value).toMatchObject({ engine: 'postgres', host: 'db.example.com', port: 6543, database: 'shop', readOnly: true, tables: ['public.orders'], label: 'Shop', notes: null });
    for (const bad of ['nope', '[]', JSON.stringify({ url: 'sqlite:/x.db' }), JSON.stringify({ url: 'postgres://u:secret@h/db', intent: 'x' }), JSON.stringify({ url: 'postgres://u:secret@h/db', extra: 1 })]) {
      const result = parseYourDatabase(bad);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  });

  it('cleans the notes: no address, password or control character, 2,000 characters at most', () => {
    const notes = cleanNotes('orders link to customers\u0007. url postgres://ava:pw@db.acme.io:5432/shop password=hunter2 also 10.0.0.5:5432 and db.acme.io:6543');
    expect(notes).toBe('orders link to customers. url [address removed] password: [removed] also [address removed] and [address removed]');
    expect([...(cleanNotes('é'.repeat(3000)) ?? '')]).toHaveLength(2000);
    expect(cleanNotes('  \u0001 ')).toBeNull();
  });
});

/** A Postgres or MySQL database of its own with a small shop in it. */
interface SourceLeg {
  name: 'postgres' | 'mysql';
  base: string | undefined;
  make: () => Promise<{ url: string; destroy: () => Promise<void> }>;
}

const PG = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL = process.env['TEST_MYSQL_URL'] || undefined;

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const SOURCES: SourceLeg[] = [
  {
    name: 'postgres',
    base: PG,
    async make() {
      const { default: pg } = await import('pg');
      const database = `yours_${randomBytes(4).toString('hex')}`;
      const admin = new pg.Client({ connectionString: PG });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${database}"`);
      await admin.end();
      const url = withDatabase(PG as string, database);
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      await client.query('CREATE TABLE customers (id serial PRIMARY KEY, name text NOT NULL); CREATE TABLE orders (id serial PRIMARY KEY, customer_id int NOT NULL REFERENCES customers(id), total numeric NOT NULL);');
      await client.end();
      return {
        url,
        destroy: async () => {
          const drop = new pg.Client({ connectionString: PG });
          await drop.connect();
          await drop.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
          await drop.end();
        },
      };
    },
  },
  {
    name: 'mysql',
    base: MYSQL,
    async make() {
      const mysqlP = await import('mysql2/promise');
      const database = `yours_${randomBytes(4).toString('hex')}`;
      const admin = await mysqlP.createConnection({ uri: MYSQL as string, multipleStatements: true });
      await admin.query(`CREATE DATABASE \`${database}\`; USE \`${database}\`; CREATE TABLE customers (id int AUTO_INCREMENT PRIMARY KEY, name varchar(80) NOT NULL); CREATE TABLE orders (id int AUTO_INCREMENT PRIMARY KEY, customer_id int NOT NULL, total decimal(10,2) NOT NULL, FOREIGN KEY (customer_id) REFERENCES customers(id));`);
      await admin.end();
      return {
        url: withDatabase(MYSQL as string, database),
        destroy: async () => {
          const drop = await mysqlP.createConnection({ uri: MYSQL as string });
          await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
          await drop.end();
        },
      };
    },
  },
];

const yoursOf = (url: string, more: Record<string, unknown> = {}): YourDatabase => {
  const parsed = parseYourDatabase(JSON.stringify({ url, label: 'Harbor books', ...more }));
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.value;
};

const LEGS = META_ENGINES.filter((engine) => engine.available).flatMap((meta) => SOURCES.map((source) => ({ meta, source, label: `${source.name} on ${meta.name} meta` })));

describe.each(LEGS)('yours: $label', ({ meta: metaEngine, source }) => {
  const run = source.base === undefined ? it.skip : it;

  run('is registered before listen without a dial, then connected, introspected and generated after it', { timeout: 60_000 }, async () => {
    const handle = await metaEngine.make();
    const db = await source.make();
    const manager = await managerFor(handle.meta);
    try {
      const status = yourDatabaseStatus();
      const warned: string[] = [];
      const tests = vi.spyOn(manager, 'testDsn');
      const schema = source.name === 'postgres' ? 'public' : new URL(db.url).pathname.slice(1);
      const opts = { manager, meta: handle.meta, yours: yoursOf(db.url, { tables: [`${schema}.orders`, `${schema}.nope`] }), status, log: () => undefined, warn: (message: string) => warned.push(message) };

      const registered = await registerYourDatabase(opts);
      expect(registered?.changed).toBe(true);
      expect(tests).not.toHaveBeenCalled();
      expect(status.current()?.state).toBe('connecting');
      const row = await manager.connections.findByProjectKey('yours');
      expect(row).toMatchObject({ name: 'Harbor books', engine: source.name, readOnly: false });

      expect(await connectYourDatabase(opts, registered!)).toBe(true);
      expect(status.current()).toMatchObject({ state: 'ready', reason: null, host: '127.0.0.1' });
      const after = await manager.connections.findByProjectKey('yours');
      expect(after?.settings.includedTables).toEqual([`${schema}.orders`]);
      expect(warned.join('\n')).toContain('1 chosen table(s) were not found');
      expect((await pagesRepo(handle.meta).listForConnection(after!.id)).length).toBeGreaterThan(0);
      expect((await operatorTalliesRepo(handle.meta).get(YOURS_CHOICE_TALLY))?.amount).toBeGreaterThan(0);

      // The next boot with the same choice: nothing to redo.
      const again = await registerYourDatabase(opts);
      expect(again).toEqual({ connectionId: registered!.connectionId, changed: false });

      // A changed choice (all tables now, none of the ids match): regenerated with every table.
      const changedOpts = { ...opts, yours: yoursOf(db.url, { tables: [`${schema}.ghost`] }) };
      const changed = await registerYourDatabase(changedOpts);
      expect(changed?.changed).toBe(true);
      expect(await connectYourDatabase(changedOpts, changed!)).toBe(true);
      expect((await manager.connections.findByProjectKey('yours'))?.settings.includedTables).toBeUndefined();
      expect(warned.join('\n')).toContain('pages are made for every table');
      expect(await manager.connections.list()).toHaveLength(1);
    } finally {
      await manager.disposeAll().catch(() => undefined);
      await db.destroy();
      await handle.destroy();
    }
  });

  run('read-only is sticky over probes (and on Postgres the session refuses a write)', { timeout: 60_000 }, async () => {
    const handle = await metaEngine.make();
    const db = await source.make();
    const manager = await managerFor(handle.meta);
    try {
      const status = yourDatabaseStatus();
      const opts = { manager, meta: handle.meta, yours: yoursOf(db.url, { readOnly: true }), status, log: () => undefined, warn: () => undefined };
      const registered = await registerYourDatabase(opts);
      expect(await connectYourDatabase(opts, registered!)).toBe(true);
      // The probe found a login that may write; the row stays read-only.
      const row = await manager.connections.findByProjectKey('yours');
      expect(row?.readOnly).toBe(true);
      await manager.connections.recordTestResult(row!.id, { ok: true, latencyMs: 1, error: null, errorHint: null, readOnly: false });
      expect((await manager.connections.findByProjectKey('yours'))?.readOnly).toBe(true);
      expect(status.current()?.readOnly).toBe(true);
      if (source.name === 'postgres') {
        expect(yoursDataDsn(opts.yours)).toContain('default_transaction_read_only');
        const data = await manager.data(row!.id);
        await expect(data.db.insertInto('customers' as never).values({ name: 'Ada' } as never).execute()).rejects.toThrow(/read-only/);
      }
    } finally {
      await manager.disposeAll().catch(() => undefined);
      await db.destroy();
      await handle.destroy();
    }
  });
});

describe.each(META_ENGINES.filter((engine) => engine.available))('yours that cannot be reached, meta on $name', (engine) => {
  it('is down with a coarse reason, and tried again later: never a failed boot', { timeout: 30_000 }, async () => {
    const handle = await engine.make();
    const manager = await managerFor(handle.meta);
    try {
      const status = yourDatabaseStatus();
      const changes: string[] = [];
      status.onChange((state) => changes.push(`${state.state}:${state.reason ?? ''}`));
      // A closed port on this machine: refused at once.
      const opts = { manager, meta: handle.meta, yours: yoursOf('postgres://nobody:pw@127.0.0.1:9/none'), status, log: () => undefined, warn: () => undefined };
      const registered = await registerYourDatabase(opts);
      const scheduled: number[] = [];
      const job = startYourDatabase(opts, registered!, (_run, ms) => {
        scheduled.push(ms);
        return { cancel: () => undefined };
      });
      expect(await job.firstTry).toBe(false);
      job.close();
      expect(status.current()).toMatchObject({ state: 'down', reason: 'unreachable' });
      expect(changes).toEqual(['connecting:', 'down:unreachable']);
      expect(scheduled).toEqual([60_000]);
      // The row is there, in error, for the next try.
      expect((await manager.connections.findByProjectKey('yours'))?.status).toBe('error');
    } finally {
      await manager.disposeAll().catch(() => undefined);
      await handle.destroy();
    }
  });
});
