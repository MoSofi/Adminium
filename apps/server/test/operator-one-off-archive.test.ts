// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The archive one-offs of an operator-project trial, through the real CLI.
 *
 * The operator runs `adminium archive create` and `archive restore` beside a
 * stopped trial, with `ADMINIUM_OPERATOR_PROJECT=on` and `ADMINIUM_PROJECT_DIR`
 * but neither trial nor hosted mode. Those two commands open the operator
 * project from the environment (no config file is looked for, none is run, its
 * `.env` is not read); every other command, `start` included, still refuses the
 * switch outside trial and hosted mode.
 *
 * On each meta engine: `--without-your-database` leaves `yours`' string out,
 * the restore brings it back as a draft, and the next boot's registration fills
 * the same row from `ADMINIUM_YOUR_DATABASE` and connects it (a real Postgres
 * when TEST_POSTGRES_URL is set). The schema assistant's notes run, which ran
 * on the trial, does not run again: no archive carries its tally, but its
 * record comes back and says it ran.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { connectionsRepo, firstRun, operatorTalliesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { ARCHIVE_MANIFEST } from '../src/archive/format.js';
import { parseYourDatabase } from '../src/config/your-database.js';
import { defaultCliDeps } from '../src/cli/runtime.js';
import { runCli } from '../src/cli/run.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createYoursAssist, YOURS_ASSIST_TALLY, type YoursAssistDeps } from '../src/llm/yours-assist.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { openMetaStore } from '../src/meta/store.js';
import { forgetOperatorProjects } from '../src/project/operator-project.js';
import { connectYourDatabase, registerYourDatabase, YOURS_KEY } from '../src/project/your-database.js';
import { yourDatabaseStatus } from '../src/project/your-database-state.js';
import { fakeIo } from './cli-helpers.js';

const SECRET = 'one-off-archive-secret-0123456789';
const CRYPTO = dsnCryptoFromSecret(SECRET);
const PG = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL = process.env['TEST_MYSQL_URL'] || undefined;

const YOURS_URL = 'postgres://ava:her-password@db.example.com:6543/shop';
const MAIN_URL = 'postgres://trial_7f3a:pw@127.0.0.1:5432/trial_7f3a';

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** A meta store's URL on an engine, in a database of its own; undefined is the data folder's SQLite. */
interface MetaLeg {
  name: 'sqlite' | 'postgres' | 'mysql';
  available: boolean;
  make: () => Promise<{ url: string | undefined; drop: () => Promise<void> }>;
}

const META: MetaLeg[] = [
  { name: 'sqlite', available: true, make: async () => ({ url: undefined, drop: async () => undefined }) },
  {
    name: 'postgres',
    available: PG !== undefined,
    async make() {
      const { default: pg } = await import('pg');
      const database = `oneoff_${randomBytes(4).toString('hex')}`;
      const admin = new pg.Client({ connectionString: PG });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${database}"`);
      await admin.end();
      return {
        url: withDatabase(PG as string, database),
        drop: async () => {
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
    available: MYSQL !== undefined,
    async make() {
      const mysqlP = await import('mysql2/promise');
      const database = `oneoff_${randomBytes(4).toString('hex')}`;
      const admin = await mysqlP.createConnection({ uri: MYSQL as string });
      await admin.query(`CREATE DATABASE \`${database}\``);
      await admin.end();
      return {
        url: withDatabase(MYSQL as string, database),
        drop: async () => {
          const drop = await mysqlP.createConnection({ uri: MYSQL as string });
          await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
          await drop.end();
        },
      };
    },
  },
];

/** The user's own database for the boot after the restore: a real Postgres with one table. */
async function yoursDatabase(): Promise<{ url: string; drop: () => Promise<void> } | null> {
  if (PG === undefined) return null;
  const { default: pg } = await import('pg');
  const database = `yours_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: PG });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();
  const url = withDatabase(PG, database);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('CREATE TABLE orders (id serial PRIMARY KEY, total numeric NOT NULL)');
  await client.end();
  return {
    url,
    drop: async () => {
      const drop = new pg.Client({ connectionString: PG });
      await drop.connect();
      await drop.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await drop.end();
    },
  };
}

let root: string;
const drops: (() => Promise<void>)[] = [];
afterEach(async () => {
  forgetOperatorProjects();
  while (drops.length > 0) await drops.pop()?.();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

/** A one-off's environment: the switch and the project folder, no trial or hosted mode. */
function oneOffEnv(dataDir: string, metaUrl: string | undefined): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ADMINIUM_SECRET: SECRET,
    ADMINIUM_DATA_DIR: dataDir,
    ADMINIUM_PROJECT_DIR: join(dataDir, 'project'),
    ADMINIUM_OPERATOR_PROJECT: 'on',
    // What the trial ran with; a one-off reads none of it.
    ADMINIUM_YOUR_DATABASE: JSON.stringify({ url: YOURS_URL, label: 'Harbor books' }),
    ...(metaUrl === undefined ? {} : { ADMINIUM_META_URL: metaUrl }),
  };
}

async function cli(argv: string[], env: Record<string, string | undefined>): Promise<{ code: number; out: string; err: string }> {
  const io = fakeIo();
  const code = await runCli(argv, { io, deps: { ...defaultCliDeps(), env, cwd: root } });
  return { code, out: io.stdout(), err: io.stderr() };
}

describe.each(META.filter((leg) => leg.available))('an operator-project trial’s archive one-offs, meta on $name', (leg) => {
  it('archive create leaves yours’ string out, restore makes it a draft, the next boot fills and connects it', { timeout: 600_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), 'adminium-one-off-'));
    const fromData = join(root, 'from', 'data');
    const fromMeta = await leg.make();
    drops.push(fromMeta.drop);
    mkdirSync(fromData, { recursive: true });

    // The trial as it stopped: main, yours, and what the Designer built in the project folder.
    const before = await openMetaStore({ metaUrl: fromMeta.url, dataDir: fromData, secret: SECRET });
    try {
      await firstRun(before.meta);
      const connections = connectionsRepo(before.meta, CRYPTO);
      await connections.create({ name: 'main', engine: 'postgres', sourceKind: 'dsn', introspectDsn: MAIN_URL, dataDsn: null, readOnly: false, settings: {}, status: 'connected', projectKey: 'main', createdBy: null });
      const yours = await connections.create({ name: 'Harbor books', engine: 'postgres', sourceKind: 'dsn', introspectDsn: YOURS_URL, dataDsn: null, readOnly: false, settings: { intent: 'full-admin' }, status: 'connected', projectKey: YOURS_KEY, createdBy: null });
      // The owner, and the notes run the trial made and applied.
      await usersRepo(before.meta).create({ email: 'ava@harbor.test', name: 'Ava' });
      expect(await operatorTalliesRepo(before.meta).claim(YOURS_ASSIST_TALLY)).toBe(true);
      await settingsRepo(before.meta).set('llm.yoursAssist', { state: 'applied', runId: 'run_trial', connectionId: yours.id, at: Date.now(), counts: { overrides: 4, pages: 2, navGroupUpdates: 1 }, undo: { insertedOverrideIds: [] }, reason: null });
    } finally {
      await before.close();
    }
    const project = join(fromData, 'project');
    mkdirSync(join(project, 'apps', 'shop'), { recursive: true });
    writeFileSync(join(project, 'apps', 'shop', 'adminium.app.json'), '{"key":"shop"}\n');
    // Written by the trial's user: never run, never read.
    const ran = join(root, 'config-ran');
    writeFileSync(join(project, 'adminium.config.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(ran)}, 'ran');\nexport default {};\n`);
    writeFileSync(join(project, '.env'), 'ADMINIUM_ARCHIVE_KEY=a-key-the-trial-user-planted-0123456789\n');

    const archive = join(root, 'trial.zip');
    const made = await cli(['archive', 'create', archive, '--without-your-database'], oneOffEnv(fromData, fromMeta.url));
    expect(made.code, made.err).toBe(0);
    expect(existsSync(ran)).toBe(false);
    expect(made.err).toContain('Left out the connection string of “Harbor books”');
    const members = unzipSync(readFileSync(archive));
    const manifest = JSON.parse(Buffer.from(members[ARCHIVE_MANIFEST] ?? new Uint8Array()).toString('utf8')) as {
      meta: { table: string; path: string }[];
      project?: { files: string[] };
    };
    expect(manifest.project?.files).toContain('apps/shop/adminium.app.json');
    const dumpPath = manifest.meta.find((entry) => entry.table === 'adminium_connections')?.path ?? '';
    const dump = JSON.parse(Buffer.from(members[dumpPath] ?? new Uint8Array()).toString('utf8')) as { columns: string[]; rows: unknown[][] };
    const at = (name: string): number => dump.columns.indexOf(name);
    const yoursRow = dump.rows.find((row) => row[at('projectKey')] === YOURS_KEY);
    expect(yoursRow?.[at('introspectDsnEncrypted')]).toBeNull();
    expect(Buffer.from(readFileSync(archive)).includes('her-password')).toBe(false);

    // The nightly backup check: a dry run into a scratch data folder of its own (`/tmp/check` there).
    const checkData = join(root, 'tmp', 'check');
    const checkMeta = await leg.make();
    drops.push(checkMeta.drop);
    const dry = await cli(['archive', 'restore', archive, '--dry-run'], oneOffEnv(checkData, checkMeta.url));
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toContain('Dry run — nothing was written.');
    expect(dry.out).toContain(join(checkData, 'project'));
    expect(existsSync(join(checkData, 'project', 'apps'))).toBe(false);

    // A fresh instance, restored by the same kind of one-off.
    const toData = join(root, 'to', 'data');
    const toMeta = await leg.make();
    drops.push(toMeta.drop);
    const restored = await cli(['archive', 'restore', archive], oneOffEnv(toData, toMeta.url));
    expect(restored.code, restored.err).toBe(0);
    expect(existsSync(join(toData, 'project', 'apps', 'shop', 'adminium.app.json'))).toBe(true);
    expect(existsSync(ran)).toBe(false);

    const after = await openMetaStore({ metaUrl: toMeta.url, dataDir: toData, secret: SECRET });
    const yoursDb = await yoursDatabase();
    if (yoursDb !== null) drops.push(yoursDb.drop);
    const registry = new AdapterRegistry<AdapterProvider>();
    await registerAdapters(registry);
    const manager = new ConnectionManager({ meta: after.meta, crypto: CRYPTO, registry, metaDsn: null, blockLoopback: false });
    try {
      const repo = connectionsRepo(after.meta, CRYPTO);
      const draft = (await repo.list()).find((row) => row.projectKey === YOURS_KEY);
      expect(draft).toMatchObject({ name: 'Harbor books', status: 'unconfigured' });
      expect((await repo.getDsns(draft!.id))?.introspectDsn ?? null).toBeNull();

      // The next operator-project boot: the environment fills the same row, and it connects.
      const parsed = parseYourDatabase(JSON.stringify({ url: yoursDb?.url ?? YOURS_URL, label: 'Harbor books' }));
      if (!parsed.ok) throw new Error(parsed.problem);
      const opts = { manager, meta: after.meta, yours: parsed.value, status: yourDatabaseStatus(), log: () => undefined, warn: () => undefined };
      const registered = await registerYourDatabase(opts);
      expect(registered?.connectionId).toBe(draft!.id);
      expect((await repo.list()).filter((row) => row.projectKey === YOURS_KEY)).toHaveLength(1);
      expect((await repo.getDsns(draft!.id))?.introspectDsn).toBe(parsed.value.url);
      if (yoursDb !== null) {
        expect(await connectYourDatabase(opts, registered!)).toBe(true);
        expect(opts.status.current()).toMatchObject({ state: 'ready' });
      }

      // The notes run on the restored deployment (hosted, `ADMINIUM_YOUR_DATABASE` without notes), once the database is
      // back: the tally did not travel, the record did, and it says the run happened. Nothing is asked of the model.
      const tallies = operatorTalliesRepo(after.meta);
      expect(await tallies.get(YOURS_ASSIST_TALLY)).toBeNull();
      expect(await settingsRepo(after.meta).get('llm.yoursAssist')).toMatchObject({ state: 'applied', runId: 'run_trial' });
      const ready = yourDatabaseStatus();
      ready.set({ state: 'ready', reason: null, host: 'db.example.com', label: 'Harbor books', readOnly: false });
      const never = (): never => {
        throw new Error('the notes run ran again');
      };
      const assist = createYoursAssist({
        meta: after.meta,
        yoursConnectionId: async () => draft!.id,
        notes: null,
        operatorKey: true,
        status: ready,
        promptService: { createRunForConnection: never },
        runService: {} as YoursAssistDeps['runService'],
        applyService: { applyRun: never, buildPlanForRun: never },
        resolve: never,
      });
      expect(await assist.maybeStart()).toEqual({ started: false, reason: 'taken' });
      expect((await tallies.get(YOURS_ASSIST_TALLY))?.amount).toBe(1);
      expect(await settingsRepo(after.meta).get('llm.yoursAssist')).toMatchObject({ state: 'applied', runId: 'run_trial' });
      assist.stop();
    } finally {
      await manager.disposeAll();
      await after.close();
    }
  });
});

describe('the one-off switch is for the archive commands only', () => {
  it('start still refuses ADMINIUM_OPERATOR_PROJECT without trial or hosted mode', async () => {
    root = mkdtempSync(join(tmpdir(), 'adminium-one-off-'));
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    const env = { ...oneOffEnv(dataDir, undefined), ADMINIUM_YOUR_DATABASE: undefined, ADMINIUM_PROJECT_DIR: undefined };
    const started = await cli(['start', '--port', '0', '--host', '127.0.0.1'], env);
    expect(started.code).not.toBe(0);
    expect(started.err).toContain('ADMINIUM_OPERATOR_PROJECT');
    expect(started.err).toContain('neither ADMINIUM_TRIAL_MODE nor ADMINIUM_HOSTED_MODE');
    // With the one-off's project folder named, start does not open it as an operator project either.
    const named = await cli(['start', '--port', '0', '--host', '127.0.0.1'], { ...env, ADMINIUM_PROJECT_DIR: join(dataDir, 'project') });
    expect(named.code).not.toBe(0);
    expect(named.err).toContain('has no adminium.config.ts');
  });
});
