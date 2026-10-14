/**
 * Plan 67, G3: the Sales CRM on the three words of 0.3.28 that came last (a board whose columns
 * are rows, a place and an area in a column, maps as one switch), against the whole server, on
 * SQLite, Postgres and MySQL, with the app's own manifest and its sample, SIGNED IN AS THE PEOPLE
 * IT IS ABOUT.
 *
 * What is on trial: the Pipeline page is a board over the stages; its columns are read as the
 * dashboard reads them (the stages in order, each with a count and a sum of the deals the reader
 * reaches); a stage added as a row is a column of the next read; a card's move is the ordinary
 * save, refused where the deal is closed and not there where it is somebody else's; a pasted
 * list says which of its lines are already here before anything is written; a company is placed
 * by a town of the list or by an exact point; a territory keeps an area; the way between stops
 * is straight lines marked as estimates; and an install that says no to maps names no outside
 * server.
 *
 * To run: copy into `~/Work/lanes/p67/apps/server/test/` as `zz-crm-g3.test.ts`, run, remove.
 *
 * THE BOARD AND THE LEDGER. The ledger's board (`figures.md` §2) is the OPEN deals: 14 · 286,300,
 * Dana 6 · 143,400. The app says so on its page (`config.board.only: { state: 'open' }`), and the
 * board answers the ledger's own figures, column by column, to the unit: the cards it lists are
 * those deals and no other, and each header's count and total are of those cards. The closed
 * deals still name a stage (26 · 424,400 for the team), and the same read with the condition
 * taken off counts them (40 · 710,700): that is asserted too, so what `only` does is on the page.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, manifestsRepo, pagesRepo, settingsRepo, snapshotsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// The server says the version it was built at (0.3.27 until the release); the app's floor is the release to come.
vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.3.28' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const PEOPLE = manifest()['sampleData'] as { people: { key: string; name: string; email: string; role: string }[] };

/** The map server an install draws its maps from when nobody set another. */
const MAP_SERVER = 'https://tiles.openfreemap.org';

/** The ledger's board, the open deals, column by column (`figures.md` §2): the team's, then Dana's. */
const STAGES = ['Discovery', 'Qualified', 'Proposal', 'Negotiation', 'Verbal'] as const;
const LEDGER_TEAM: [number, number][] = [[3, 36_350], [3, 32_950], [3, 87_000], [3, 105_400], [2, 24_600]];
// The ledger writes Dana's columns weighted (320 · 0 · 24,500 · 55,800 · 15,120 = 95,740); at full value they are these (143,400).
const LEDGER_DANA: [number, number][] = [[1, 3_200], [0, 0], [2, 49_000], [2, 74_400], [1, 16_800]];

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `crm_g3_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'source.db');
    new BetterSqlite3(file).close();
    return { dsn: `sqlite:${file}`, drop: async () => undefined };
  }
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    return {
      dsn: url.toString(),
      drop: async () => {
        const again = new Client({ connectionString: POSTGRES_URL });
        await again.connect();
        await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await again.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection(MYSQL_URL as string);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(MYSQL_URL as string);
  url.pathname = `/${name}`;
  return {
    dsn: url.toString(),
    drop: async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    },
  };
}

async function invoices(meta: MetaDb): Promise<void> {
  const document = JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  document['version'] = '1.1.0';
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

type Reply = Awaited<ReturnType<AdminiumServer['inject']>>;
interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  connectionId: string;
  /** The id of one of the app's tables, as the data routes name it. */
  t: (ref: string) => string;
  real: (ref: string) => string;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** Each person's user id and session, by the sample's key. Empty on an install with no sample. */
  id: Record<string, string>;
  cookie: Record<string, string>;
  owner: string;
  /** What the check step said before the install: whether it asks about maps. */
  asksAboutMaps: boolean | undefined;
  /** Run every job that is waiting, as the worker would. */
  jobs: () => Promise<void>;
  close: () => Promise<void>;
}

let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.14.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

/** The whole server with the real app installed through its routes: with its sample and its people signed in, or bare. */
async function stack(dialect: Dialect, opts: { maps: boolean; sample: boolean }): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-g3-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const hash = await adminPasswordHash();
  await createFirstSuperAdmin(meta, { email: 'owner@crm.test', name: 'Owner', passwordHash: hash });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Meridian', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  const app = composed.app;
  await app.ready();
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();
  const owner = await signIn(app, 'owner@crm.test');
  await invoices(meta);

  // The harness packs text only: the picture's bytes do not matter here, its place in the package does.
  const packed = JSON.parse(readFileSync(`${SEEDS}/meridian.json`, 'utf8')) as { assets?: Record<string, { file: string; sha256: string }> };
  for (const asset of Object.values(packed.assets ?? {})) asset.sha256 = createHash('sha256').update('png').digest('hex');
  const document = manifest();
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(document),
    'staff/index.html': '<!doctype html><html><body></body></html>',
    'seeds/meridian.json': JSON.stringify(packed),
    'seeds/assets/signature.png': 'png',
  });
  const staged = await app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
  expect(staged.statusCode, staged.body).toBe(200);
  const body = { key: 'crm', version: document['version'], connectionId: connection.id, addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } };
  const planned = await app.inject({ method: 'POST', url: '/api/v1/apps/plan', headers: { cookie: owner }, payload: { key: body.key, version: body.version, connectionId: body.connectionId, addOns: ['invoices'] } });
  expect(planned.statusCode, planned.body).toBe(200);
  const asksAboutMaps = (planned.json() as { plan: { maps?: boolean } }).plan.maps;
  // The tick of the check step: on, or taken off.
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { ...body, maps: opts.maps } });
  expect(installed.statusCode, installed.body).toBe(200);

  const id: Record<string, string> = {};
  const cookie: Record<string, string> = {};
  if (opts.sample) {
    const sample = await app.inject({ method: 'POST', url: '/api/v1/apps/crm/sample-data', headers: { cookie: owner }, payload: {} });
    expect(sample.statusCode, sample.body).toBe(200);
    while ((await composed.jobs.worker.runOnce()) > 0);
    // The sample's people become ordinary staff with a password, each under an address the test knows.
    const samplePeople = await usersRepo(meta).list({ status: 'sample', limit: 50 });
    expect(samplePeople).toHaveLength(PEOPLE.people.length);
    for (const person of PEOPLE.people) {
      const user = samplePeople.find((one) => one.name === person.name)!;
      expect(user, person.name).toBeDefined();
      await meta.db.updateTable('adminium_users').set({ status: 'active', passwordHash: hash, email: `${person.key}@crm.test` }).where('id', '=', user.id).execute();
      id[person.key] = user.id;
    }
    // Only the people this proof signs in as: a sign-in is not free.
    for (const key of ['dana', 'sam', 'ivy', 'tessa', 'ada', 'hugo', 'grace', 'lena']) cookie[key] = await signIn(app, `${key}@crm.test`);
  }

  const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const handle = await manager.data(connection.id);
  return {
    app,
    meta,
    connectionId: connection.id,
    t: (ref) => model.tables.find((table) => table.name === `crm_${ref}`)!.id,
    real: (ref) => `crm_${ref}`,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    id,
    cookie,
    owner,
    asksAboutMaps,
    jobs: async () => {
      for (let round = 0; round < 20; round += 1) {
        await meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).execute();
        if ((await composed.jobs.worker.runOnce()) === 0) break;
      }
    },
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** `ok`, or `<status> <code>`: what a try came back with. */
const said = (res: Reply): string => {
  if (res.statusCode < 300) return 'ok';
  try {
    return `${String(res.statusCode)} ${(res.json() as { error?: { code?: string } }).error?.code ?? ''}`.trim();
  } catch {
    return String(res.statusCode);
  }
};

/** Each directive of a policy that names `host`. */
const naming = (policy: unknown, host: string): string[] =>
  String(policy)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes(host))
    .map((part) => part.split(' ')[0]!);
/** Every source in a policy that is another site. */
const outside = (policy: unknown): string[] => String(policy).split(/[\s;]+/).filter((word) => /^https?:\/\//.test(word));

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's board, places, areas and maps, on ${dialect}`, () => {
    let s: Stack;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const get = (person: string, path: string) => s.app.inject({ method: 'GET', url: path, headers: { cookie: who(person) } });
    const send = (person: string, method: 'POST' | 'PATCH' | 'PUT', path: string, payload: unknown) => s.app.inject({ method, url: path, headers: { cookie: who(person) }, payload: payload as never });
    const post = (person: string, ref: string, values: Record<string, unknown>) => send(person, 'POST', url(ref), { values });
    const patch = (person: string, ref: string, key: unknown, values: Record<string, unknown>) => send(person, 'PATCH', url(ref, `/${String(key)}`), { values });
    const made = (res: Reply): number => Number((res.json() as { data: { id: unknown } }).data.id);
    const one = async (statement: string): Promise<Record<string, unknown>> => (await s.rows(statement))[0]!;
    /** A row as that person reads it through the data route. */
    const read = async (person: string, ref: string, key: unknown): Promise<Record<string, unknown>> => {
      const res = await get(person, url(ref, `/${String(key)}`));
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Record<string, unknown> }).data;
    };
    /** A json column as the database holds it, an object on every engine. */
    const stored = async (ref: string, column: string, key: unknown): Promise<unknown> => {
      const value = (await one(`SELECT ${column} AS v FROM ${s.real(ref)} WHERE id = ${String(key)}`))['v'];
      return typeof value === 'string' ? JSON.parse(value) : value;
    };
    /** The Pipeline page's board item, as the install stored it. */
    const pipeline = async (): Promise<{ i: string; config: Record<string, unknown> }> => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'crm-pipeline'))!;
      const kept = page.config as { config: { layout: { items: { i: string; widget: string; config: Record<string, unknown> }[] } } };
      return kept.config.layout.items.find((item) => item.widget === 'kanban-board')!;
    };
    /**
     * The read the dashboard makes for the board's columns (`boardColumns.ts`): the stages in the order of `position`,
     * each with a count of the deals in it and the board's one total, a sum of `amount` — both of the cards the
     * board keeps, by the tests its stored item carries (`only`). `every` takes the condition off: every deal.
     */
    const columns = async (person: string, every = false): Promise<[string, number, number][]> => {
      const only = (await pipeline()).config['only'] as { column: string; in: unknown[] }[] | undefined;
      const where = every || only === undefined ? {} : { where: only.map((test) => ({ column: test.column, in: test.in })) };
      const compute = encodeURIComponent(
        JSON.stringify({
          measures: [
            { id: 'board_count', table: s.t('deals'), fkColumn: 'stage_id', fn: 'count', ...where },
            { id: 'board_total_0', table: s.t('deals'), fkColumn: 'stage_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['amount'] }] }, ...where },
          ],
        }),
      );
      const res = await get(person, url('stages', `?select=id,label&order=position.asc&limit=100&compute=${compute}`));
      expect(res.statusCode, res.body).toBe(200);
      const rows = (res.json() as { data: Record<string, unknown>[] }).data;
      // A figure, never a refusal read as zero: nobody here is kept from the column the board chooses by.
      for (const row of rows) expect(row['_masked'], person).toBeUndefined();
      return rows.map((row) => [String(row['label']), Number(row['board_count']), Number(row['board_total_0'] ?? 0)]);
    };
    /** The cards the board lists for a person, as the page's batch asks for them: `[id, stage_id, amount]`. */
    const cards = async (person: string): Promise<[number, number | null, number][]> => {
      const board = await pipeline();
      const res = await s.app.inject({ method: 'POST', url: '/api/v1/widget-data/batch', headers: { cookie: who(person) }, payload: { requests: [{ instanceId: board.i, descriptor: board.config['binding'] }], params: {} } });
      expect(res.statusCode, res.body).toBe(200);
      const result = (res.json() as { results: Record<string, { ok: boolean; result?: { rows?: Record<string, unknown>[] } }> }).results[board.i]!;
      expect(result.ok, res.body).toBe(true);
      return (result.result?.rows ?? []).map((row): [number, number | null, number] => [Number(row['id']), row['stage_id'] === null ? null : Number(row['stage_id']), Number(row['amount'] ?? 0)]).sort((a, b) => a[0] - b[0]);
    };
    /** The closed deals (won and lost) that still name each stage, of one owner or of everybody: counted from the database. */
    const closedByStage = async (owner?: string): Promise<[number, number][]> => {
      const rows = await s.rows(
        `SELECT st.position AS p, COUNT(d.id) AS n, COALESCE(SUM(d.amount), 0) AS a FROM ${s.real('stages')} st LEFT JOIN ${s.real('deals')} d ON d.stage_id = st.id AND d.state <> 'open'${owner === undefined ? '' : ` AND d.owner_id = '${owner}'`} WHERE st.position < 5 GROUP BY st.position ORDER BY st.position`,
      );
      return rows.map((row) => [Number(row['n']), Number(row['a'])]);
    };
    const sum = (pairs: [number, number][]): [number, number] => [pairs.reduce((n, pair) => n + pair[0], 0), pairs.reduce((n, pair) => n + pair[1], 0)];

    beforeAll(async () => {
      s = await stack(dialect, { maps: true, sample: true });
    }, 600_000);
    afterAll(async () => {
      await s?.close();
    });

    it('the Pipeline page is a board that takes its columns from the stages, on the menu of who sells', async () => {
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'crm-pipeline'))!;
      expect(page.type).toBe('page-board');
      const kept = page.config as { source: { table: string }; config: { layout: { items: { widget: string; config: Record<string, unknown> }[] } } };
      expect(kept.source.table).toBe(s.t('deals'));
      const board = kept.config.layout.items.find((item) => item.widget === 'kanban-board');
      expect(board?.config).toMatchObject({
        statusColumn: 'stage_id',
        columnsFrom: { table: s.t('stages'), key: 'id', label: 'label', order: 'position' },
        titleColumn: 'name',
        totals: [{ column: 'amount', fn: 'sum' }],
        // The pipeline is the open deals: the tests each column's count and total are asked by.
        only: [{ column: 'state', in: ['open'] }],
      });
      // And the cards are asked for by the same condition.
      expect((board?.config['binding'] as { filters?: unknown }).filters).toEqual([{ column: 'state', op: 'in', value: ['open'] }]);
      // A rep finds it on the menu; the operations manager, who reads no deal, does not.
      const menu = async (person: string): Promise<boolean> => {
        const res = await get(person, '/api/v1/bootstrap');
        expect(res.statusCode, res.body).toBe(200);
        return JSON.stringify(res.json()).includes(`"pageId":"${page.id}"`);
      };
      expect([await menu('dana'), await menu('ivy'), await menu('tessa'), await menu('ada')]).toEqual([true, true, true, false]);
    });

    it('answers every stage in order with its count and its total, and they are the ledger\'s own: the open deals, the team\'s and a rep\'s', async () => {
      // The ledger's board, from the database: the open deals, stage by stage.
      const open = async (owner?: string): Promise<[number, number][]> =>
        (await s.rows(`SELECT st.position AS p, COUNT(d.id) AS n, COALESCE(SUM(d.amount), 0) AS a FROM ${s.real('stages')} st LEFT JOIN ${s.real('deals')} d ON d.stage_id = st.id AND d.state = 'open'${owner === undefined ? '' : ` AND d.owner_id = '${owner}'`} GROUP BY st.position ORDER BY st.position`)).map((row) => [Number(row['n']), Number(row['a'])]);
      expect(await open()).toEqual(LEDGER_TEAM);
      expect(sum(LEDGER_TEAM)).toEqual([14, 286_300]);
      expect(await open(s.id['dana'])).toEqual(LEDGER_DANA);
      expect(sum(LEDGER_DANA)).toEqual([6, 143_400]);

      // The sales manager reads her team's deals, and all forty are her team's: the board answers the fourteen open ones, 3 · 36,350, 3 · 32,950, 3 · 87,000, 3 · 105,400, 2 · 24,600.
      const team = await columns('ivy');
      expect(team).toEqual(STAGES.map((name, i) => [name, LEDGER_TEAM[i]![0], LEDGER_TEAM[i]![1]]));
      expect(team).toEqual([
        ['Discovery', 3, 36_350],
        ['Qualified', 3, 32_950],
        ['Proposal', 3, 87_000],
        ['Negotiation', 3, 105_400],
        ['Verbal', 2, 24_600],
      ]);
      expect(sum(team.map(([, n, a]) => [n, a]))).toEqual([14, 286_300]);

      // The rep: her own open deals and nobody else's, at full value.
      const dana = await columns('dana');
      expect(dana).toEqual(STAGES.map((name, i) => [name, LEDGER_DANA[i]![0], LEDGER_DANA[i]![1]]));
      expect(dana.map(([, , amount]) => amount)).toEqual([3_200, 0, 49_000, 74_400, 16_800]);
      expect(sum(dana.map(([, n, a]) => [n, a]))).toEqual([6, 143_400]);
      // The CRM admin reads every deal: the team's figures again.
      expect(await columns('tessa')).toEqual(team);

      // What `only` leaves out: the closed deals (won and lost) still name a stage, and the same read without the condition counts them.
      const closed = await closedByStage();
      expect(sum(closed)).toEqual([26, 130_000 + 294_400]);
      const every = await columns('ivy', true);
      expect(every).toEqual(STAGES.map((name, i) => [name, LEDGER_TEAM[i]![0] + closed[i]![0], LEDGER_TEAM[i]![1] + closed[i]![1]]));
      expect(sum(every.map(([, n, a]) => [n, a]))).toEqual([40, 710_700]);
      const hers = await closedByStage(s.id['dana']);
      // Her eight closed deals (three won, five lost) are on no column and in no figure.
      expect(sum(hers)).toEqual([8, 89_100]);
      expect(sum((await columns('dana', true)).map(([, n, a]) => [n, a]))).toEqual([14, 232_500]);
    });

    it('lists exactly those deals as its cards: the header and the cards say the same', async () => {
      const position = new Map((await s.rows(`SELECT id, position FROM ${s.real('stages')}`)).map((row) => [Number(row['id']), Number(row['position'])]));
      const keys = async (where: string): Promise<number[]> => (await s.rows(`SELECT id FROM ${s.real('deals')} WHERE ${where} ORDER BY id`)).map((row) => Number(row['id']));
      /** The cards, column by column: how many and what they are worth. */
      const byColumn = (listed: [number, number | null, number][]): [number, number][] =>
        STAGES.map((_, i) => {
          const inColumn = listed.filter(([, stage]) => stage !== null && position.get(stage) === i);
          return [inColumn.length, inColumn.reduce((total, [, , amount]) => total + amount, 0)];
        });

      // The team's: the fourteen open deals, by key, and not one of the twenty-six closed.
      const team = await cards('ivy');
      expect(team.map(([key]) => key)).toEqual(await keys(`state = 'open'`));
      expect(team).toHaveLength(14);
      expect(byColumn(team)).toEqual(LEDGER_TEAM);
      const closed = await keys(`state <> 'open'`);
      expect(closed).toHaveLength(26);
      expect(team.filter(([key]) => closed.includes(key))).toEqual([]);

      // Dana's: her six, and what her columns' headers say of them.
      const dana = await cards('dana');
      expect(dana.map(([key]) => key)).toEqual(await keys(`state = 'open' AND owner_id = '${s.id['dana']!}'`));
      expect(dana).toHaveLength(6);
      expect(byColumn(dana)).toEqual(LEDGER_DANA);
      expect(byColumn(dana)).toEqual((await columns('dana')).map(([, n, a]) => [n, a]));
    });

    it('a stage added as a row is a column of the very next read, empty, with no update of the app', async () => {
      const version = (await manifestsRepo(s.meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('crm'))?.version;
      // A rep and an account manager read the stages and may not add one; the CRM admin and the sales manager keep the list (F14).
      expect(said(await post('dana', 'stages', { label: 'Legal review', odds: 0.8, position: 5 }))).toMatch(/^403/);
      expect(said(await post('hugo', 'stages', { label: 'Legal review', odds: 0.8, position: 5 }))).toMatch(/^403/);
      const added = await post('tessa', 'stages', { label: 'Legal review', odds: 0.8, position: 5 });
      expect(added.statusCode, added.body).toBe(201);
      const now = await columns('dana');
      expect(now.map(([name]) => name)).toEqual([...STAGES, 'Legal review']);
      expect(now[5]).toEqual(['Legal review', 0, 0]);
      expect((await manifestsRepo(s.meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('crm'))?.version).toBe(version);
    });

    it('dropping a card is the ordinary save: Dana moves her own deal, a won deal stays where it is, and Sam\'s is not there', async () => {
      const legal = Number((await one(`SELECT id FROM ${s.real('stages')} WHERE label = 'Legal review'`))['id']);
      const before = await columns('dana');
      // Dana's open deal in Negotiation at 52,800 (the ledger's d1), dropped on the new column.
      const d1 = await one(`SELECT id, stage_id, amount FROM ${s.real('deals')} WHERE owner_id = '${s.id['dana']!}' AND state = 'open' AND amount = 52800`);
      expect(said(await patch('dana', 'deals', d1['id'], { stage_id: legal }))).toBe('ok');
      const after = await columns('dana');
      expect(after[5]).toEqual(['Legal review', 1, 52_800]);
      expect(after[3]).toEqual(['Negotiation', before[3]![1] - 1, before[3]![2] - 52_800]);

      // A won deal of hers: the app's states close it to every column but two, and the stage is not one of them.
      const won = await one(`SELECT id, stage_id FROM ${s.real('deals')} WHERE owner_id = '${s.id['dana']!}' AND state = 'won' ORDER BY id`);
      const refused = await patch('dana', 'deals', won['id'], { stage_id: legal });
      expect(said(refused)).toBe('409 RECORD_LOCKED');
      expect((refused.json() as { error: { message: string } }).error.message).toMatch(/won/);
      expect(Number((await one(`SELECT stage_id FROM ${s.real('deals')} WHERE id = ${String(won['id'])}`))['stage_id'])).toBe(Number(won['stage_id']));

      // Sam's open deal: for Dana it is a key that names no row.
      const sams = await one(`SELECT id, stage_id FROM ${s.real('deals')} WHERE owner_id = '${s.id['sam']!}' AND state = 'open' ORDER BY id`);
      const hidden = await patch('dana', 'deals', sams['id'], { stage_id: legal });
      const nothing = await patch('dana', 'deals', 999_999, { stage_id: legal });
      expect(hidden.statusCode, hidden.body).toBe(404);
      const plain = (text: string, key: string) => text.replace(/"requestId":"[^"]*"/, '"requestId":"R"').replaceAll(key, 'K');
      expect(plain(hidden.body, String(sams['id']))).toBe(plain(nothing.body, '999999'));
      expect(Number((await one(`SELECT stage_id FROM ${s.real('deals')} WHERE id = ${String(sams['id'])}`))['stage_id'])).toBe(Number(sams['stage_id']));
      // The columns as Dana reads them moved by her one card and nothing else.
      expect(await columns('dana')).toEqual(after);
    });

    it('a pasted list says which lines are already here before anything is written, then leaves those alone', async () => {
      const upload = (person: string, text: string) => s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=pasted.csv', headers: { cookie: who(person), 'content-type': 'text/csv' }, payload: text });
      const ready = (person: string, fileId: string) =>
        send(person, 'POST', '/api/v1/imports', {
          fileId,
          connectionId: s.connectionId,
          table: s.t('companies'),
          mapping: { columns: [{ from: 'Name', to: 'name' }, { from: 'Town', to: 'town' }, { from: 'Country', to: 'country' }, { from: 'Place', to: 'place' }] },
          options: { mode: 'skip', matchColumn: 'name' },
        });
      // Three companies as a sheet pastes them, tabs between the cells: the first is one of the sample's nine.
      const paste = 'Name\tTown\tCountry\tPlace\nCobalt Legal\tSomewhere else\tGB\t\nQuayside Print\tYork\tGB\t53.9590,-1.0815\nOrchard Dental\tDurham\tGB\thttps://www.google.com/maps/@54.7753,-1.5849,15z\n';

      // WHO BRINGS A LIST IN (F14): a rep, the sales manager and the CRM admin, for companies and contacts. Nobody else.
      for (const person of ['hugo', 'grace', 'lena']) {
        const up = await upload(person, paste);
        expect(up.statusCode, up.body).toBe(201);
        expect(said(await ready(person, (up.json() as { data: { fileId: string } }).data.fileId)), person).toBe('403 TABLE_FORBIDDEN');
      }

      // Dana, a rep, pastes.
      const up = await upload('dana', paste);
      expect(up.statusCode, up.body).toBe(201);
      expect((up.json() as { data: { delimiter: string; totalRows: number } }).data).toMatchObject({ delimiter: 'tab', totalRows: 3 });
      const import_ = await ready('dana', (up.json() as { data: { fileId: string } }).data.fileId);
      expect(import_.statusCode, import_.body).toBe(201);
      const id = (import_.json() as { data: { import: { id: string } } }).data.import.id;
      const names = async (): Promise<string[]> => (await s.rows(`SELECT name FROM ${s.real('companies')} ORDER BY name`)).map((row) => String(row['name']));
      const before = await names();
      expect(before).toHaveLength(9);

      const preview = await get('dana', `/api/v1/imports/${id}/preview`);
      expect(preview.statusCode, preview.body).toBe(200);
      const told = (preview.json() as { data: { total: number; counts: unknown; lines: { row: number; status: string }[] } }).data;
      expect(told.counts).toEqual({ new: 2, here: 1, refused: 0 });
      expect(told.lines).toMatchObject([{ row: 1, status: 'here' }, { row: 2, status: 'new' }, { row: 3, status: 'new' }]);
      // Asking wrote nothing.
      expect(await names()).toEqual(before);

      expect((await send('dana', 'POST', `/api/v1/imports/${id}/run`, undefined)).statusCode).toBe(202);
      await s.jobs();
      const ran = (await get('dana', `/api/v1/imports/${id}`)).json() as { data: { status: string; stats: Record<string, number> } };
      expect([ran.data.status, ran.data.stats]).toEqual(['succeeded', { total: 3, inserted: 2, updated: 0, skipped: 1, alreadyHere: 1 }]);
      expect(await names()).toEqual([...before, 'Orchard Dental', 'Quayside Print'].sort());
      // The one already here was left as it was.
      expect((await one(`SELECT town FROM ${s.real('companies')} WHERE name = 'Cobalt Legal'`))['town']).toBe('Leeds');
      // A pasted position, as two numbers or as a map link, is an exact place.
      const york = await one(`SELECT id FROM ${s.real('companies')} WHERE name = 'Quayside Print'`);
      const durham = await one(`SELECT id FROM ${s.real('companies')} WHERE name = 'Orchard Dental'`);
      expect(await stored('companies', 'place', york['id'])).toEqual({ lat: 53.959, lng: -1.0815, by: 'exact' });
      expect(await stored('companies', 'place', durham['id'])).toEqual({ lat: 54.7753, lng: -1.5849, by: 'exact' });
    });

    it('a company is placed by a town of the list or by an exact point, and never by a made-up town', async () => {
      type Place = { id: number; name: string; plainName: string; country: string; lat: number; lng: number };
      const search = async (typed: string, language?: string): Promise<Place[]> => {
        const res = await get('dana', `/api/v1/geo/places?q=${encodeURIComponent(typed)}${language === undefined ? '' : `&language=${language}`}`);
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: Place[] }).data;
      };
      // A small town in Brazil, typed in Portuguese without its accents; a small town in Egypt, typed in Arabic.
      const polesine = (await search('sao joao do polesine'))[0]!;
      expect(polesine).toMatchObject({ id: 6_318_464, plainName: 'São João do Polêsine', country: 'BR', lat: -29.61389, lng: -53.44556 });
      const kafr = (await search('كفر سعد', 'ar_EG')).find((place) => place.id === 354_123)!;
      expect(kafr).toMatchObject({ name: 'كفر سعد', country: 'EG', lat: 31.35573, lng: 31.68484 });

      // Dana places two companies by town: only the id is sent, and the list's position is what is kept.
      const vale = made(await post('dana', 'companies', { name: 'Vinhos do Vale', place: { placeId: polesine.id } }));
      const delta = made(await post('dana', 'companies', { name: 'Delta Print', place: { placeId: kafr.id } }));
      expect((await read('dana', 'companies', vale))['place']).toEqual({ lat: -29.61389, lng: -53.44556, by: 'town', placeId: 6_318_464, name: 'São João do Polêsine', country: 'BR' });
      expect((await read('dana', 'companies', delta))['place']).toMatchObject({ lat: 31.35573, lng: 31.68484, by: 'town', placeId: 354_123, country: 'EG' });
      expect(await stored('companies', 'place', vale)).toMatchObject({ by: 'town', placeId: 6_318_464 });

      // A pasted Google Maps link is an exact place: the pin's own position, read from the link's text.
      expect(said(await patch('dana', 'companies', vale, { place: 'https://www.google.com/maps/place/Tahrir+Square/@30.0501,31.2412,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d30.0444!4d31.2357' }))).toBe('ok');
      expect((await read('dana', 'companies', vale))['place']).toEqual({ lat: 30.0444, lng: 31.2357, by: 'exact' });

      // A position called a town's with no town named is refused, and a town's id with another position beside it is corrected.
      const refusal = async (value: unknown): Promise<unknown> => {
        const res = await patch('dana', 'companies', delta, { place: value });
        expect(res.statusCode, res.body).toBe(422);
        return (res.json() as { error: { code: string; details: { fields: Record<string, { code: string }> } } }).error.details.fields['place']?.code;
      };
      expect(await refusal({ lat: 51.5, lng: -0.12, by: 'town' })).toBe('place-unreadable');
      expect(await refusal('https://maps.app.goo.gl/AbCdEf123')).toBe('place-short-link');
      expect(await refusal({ placeId: 999_999_999 })).toBe('place-unknown');
      expect(await refusal('Somewhere near the river')).toBe('place-unreadable');
      expect((await read('dana', 'companies', delta))['place']).toMatchObject({ by: 'town', placeId: 354_123 });
      expect(said(await patch('dana', 'companies', delta, { place: { lat: 0, lng: 0, by: 'town', placeId: polesine.id } }))).toBe('ok');
      expect((await read('dana', 'companies', delta))['place']).toMatchObject({ lat: -29.61389, lng: -53.44556, by: 'town', placeId: 6_318_464 });

      // The sample's own: one company by an exact point, four by their town, as the list has them.
      const sample = async (name: string): Promise<unknown> => (await read('dana', 'companies', (await one(`SELECT id FROM ${s.real('companies')} WHERE name = '${name}'`))['id']))['place'];
      expect(await sample('Cobalt Legal')).toEqual({ lat: 53.8008, lng: -1.5491, by: 'exact' });
      expect(await sample('Fernway Clinics')).toEqual({ lat: 51.45523, lng: -2.59665, by: 'town', placeId: 2_654_675, name: 'Bristol', country: 'GB' });
      expect(await sample('Juno Analytics')).toMatchObject({ by: 'town', placeId: 2_643_123, name: 'Manchester' });
      expect(await sample('Nordwind Logistics')).toMatchObject({ by: 'town', placeId: 2_645_425, name: 'Kingston upon Hull', lat: 53.7446, lng: -0.33525 });
      expect(await sample('Veldt Studios')).toMatchObject({ by: 'town', placeId: 2_648_579, name: 'Glasgow' });
      expect(await sample('Tandem Robotics')).toBeNull();
    });

    it('puts the sample companies\' towns on the map in one request, and says which it could not place', async () => {
      // The nine of the sample as Dana reads them, and one town no list has.
      const list = await get('dana', url('companies', '?select=name,town,country&order=id.asc&limit=9'));
      expect(list.statusCode, list.body).toBe(200);
      const nine = (list.json() as { data: { name: string; town: string; country: string }[] }).data;
      expect(nine.map((company) => company.town)).toEqual(['Leeds', 'Bristol', 'Manchester', 'Hull', 'Glasgow', 'Birmingham', 'Edinburgh', 'Cambridge', 'Reading']);
      const items = [...nine.map((company) => ({ town: company.town, country: company.country })), { town: 'Nether Wallop-on-Sea', country: 'GB' }, { town: 'Leeds', country: 'FR' }];
      const res = await send('dana', 'POST', '/api/v1/geo/places/match', { items, language: 'en' });
      expect(res.statusCode, res.body).toBe(200);
      const placed = (res.json() as { data: ({ id: number; plainName: string; country: string } | null)[] }).data;
      expect(placed).toHaveLength(11);
      // Nine of nine (the ledger: "not on the map: 0 of 9"); "Hull" is found under the name the list keeps it by.
      expect(placed.slice(0, 9).map((place) => place?.id)).toEqual([2_644_688, 2_654_675, 2_643_123, 2_645_425, 2_648_579, 2_655_603, 2_650_225, 2_653_941, 2_639_577]);
      expect(placed[3]).toMatchObject({ plainName: 'Kingston upon Hull', country: 'GB' });
      // It never guesses: a town no list has, and a town named in a country it is not in.
      expect(placed.slice(9)).toEqual([null, null]);
    });

    it('a territory\'s area takes a closed shape and refuses an open one', async () => {
      const north = await one(`SELECT id FROM ${s.real('territories')} ORDER BY id`);
      // Roughly the north of England, east first: the last position is the first.
      const ring = [[-3.2, 53.3], [0.2, 53.3], [0.2, 55.0], [-3.2, 55.0], [-3.2, 53.3]];
      // The sales manager keeps the territories; a rep reads them.
      expect(said(await patch('dana', 'territories', north['id'], { area: { type: 'Polygon', coordinates: [ring] } }))).toMatch(/^403/);
      expect(said(await patch('ivy', 'territories', north['id'], { area: { type: 'Polygon', coordinates: [ring] } }))).toBe('ok');
      expect((await read('dana', 'territories', north['id']))['area']).toEqual({ type: 'Polygon', coordinates: [ring] });
      expect(await stored('territories', 'area', north['id'])).toEqual({ type: 'Polygon', coordinates: [ring] });
      // Left open, it is refused and the area stays.
      const open = await patch('ivy', 'territories', north['id'], { area: { type: 'Polygon', coordinates: [ring.slice(0, 4)] } });
      expect(open.statusCode, open.body).toBe(422);
      expect((open.json() as { error: { details: { fields: Record<string, { code: string }> } } }).error.details.fields['area']?.code).toBe('area-unreadable');
      expect(said(await patch('ivy', 'territories', north['id'], { area: 'the north' }))).toMatch(/^422/);
      expect((await read('ivy', 'territories', north['id']))['area']).toEqual({ type: 'Polygon', coordinates: [ring] });
    });

    it('the way from the depot round three job sites is straight lines marked as estimates; two stops known as the same town are an unknown leg', async () => {
      // The depot, from the settings row; three jobs' sites, as the operations manager reads them.
      const depot = await one(`SELECT depot_lat AS lat, depot_lng AS lng FROM ${s.real('settings')}`);
      const jobs = await get('ada', url('jobs', `?select=code,town,lat,lng&order=code.asc&limit=8`));
      expect(jobs.statusCode, jobs.body).toBe(200);
      const sites = (jobs.json() as { data: { code: string; town: string; lat: unknown; lng: unknown }[] }).data.filter((job) => ['J-02', 'J-03', 'J-04'].includes(job.code));
      expect(sites.map((job) => job.town)).toEqual(['Edinburgh', 'Manchester', 'Hull']);
      const stops = [{ lat: Number(depot['lat']), lng: Number(depot['lng']) }, ...sites.map((job) => ({ lat: Number(job.lat), lng: Number(job.lng) }))];
      const res = await send('ada', 'POST', '/api/v1/geo/route', { stops });
      expect(res.statusCode, res.body).toBe(200);
      const route = (res.json() as { data: { source: string; fellBack?: boolean; legs: { distanceM: number | null; durationS: number | null; estimate: boolean; unknown?: boolean }[] } }).data;
      expect(route.source).toBe('straight');
      expect(route.fellBack).toBeUndefined();
      expect(route.legs).toHaveLength(3);
      for (const leg of route.legs) expect(leg).toMatchObject({ durationS: null, estimate: true });
      // Leeds to Edinburgh, on to Manchester, on to Hull: as the crow flies, to within a few kilometres.
      const km = route.legs.map((leg) => Math.round((leg.distanceM ?? 0) / 1000));
      expect(km[0]).toBeGreaterThan(255);
      expect(km[0]).toBeLessThan(270);
      expect(km[1]).toBeGreaterThan(275);
      expect(km[1]).toBeLessThan(290);
      expect(km[2]).toBeGreaterThan(125);
      expect(km[2]).toBeLessThan(135);

      // Two companies known only as "somewhere in Bristol": no length anybody can honestly give.
      const bristol = { lat: 51.45523, lng: -2.59665, by: 'town', placeId: 2_654_675 };
      const same = await send('ada', 'POST', '/api/v1/geo/route', { stops: [bristol, { ...bristol }, stops[0]] });
      expect(same.statusCode, same.body).toBe(200);
      const legs = (same.json() as { data: { legs: Record<string, unknown>[] } }).data.legs;
      expect(legs[0]).toEqual({ distanceM: null, durationS: null, estimate: true, unknown: true });
      expect(legs[1]).toMatchObject({ durationS: null, estimate: true });
      expect(Number(legs[1]!['distanceM'])).toBeGreaterThan(250_000);
    });

    it('with the maps tick on, the policy names the map server for pictures and connections and nowhere else', async () => {
      // The first app that shows maps asks, with the tick on.
      expect(s.asksAboutMaps).toBe(true);
      expect(await settingsRepo(s.meta).get('maps.enabled')).toBe(true);
      const res = await get('dana', '/api/v1/bootstrap');
      expect(res.statusCode, res.body).toBe(200);
      const policy = res.headers['content-security-policy'];
      expect(naming(policy, MAP_SERVER).sort()).toEqual(['connect-src', 'img-src']);
      expect(outside(policy)).toEqual([MAP_SERVER, MAP_SERVER]);
      expect((res.json() as { data: { maps: { enabled: boolean; server: string | null; routing: boolean } } }).data.maps).toEqual({ enabled: true, server: MAP_SERVER, routing: false });
    });
  });

  describe.skipIf(!reachable)(`the CRM installed with the maps tick taken off, on ${dialect}`, () => {
    let s: Stack;
    beforeAll(async () => {
      s = await stack(dialect, { maps: false, sample: false });
    }, 600_000);
    afterAll(async () => {
      await s?.close();
    });

    it('the very next reply names no outside server, and the bootstrap hands the page no map server', async () => {
      expect(s.asksAboutMaps).toBe(true);
      expect(await settingsRepo(s.meta).get('maps.enabled')).toBe(false);
      const res = await s.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: s.owner } });
      expect(res.statusCode, res.body).toBe(200);
      expect(outside(res.headers['content-security-policy'])).toEqual([]);
      expect(String(res.headers['content-security-policy'])).not.toContain('openfreemap');
      expect((res.json() as { data: { maps: { enabled: boolean; server: string | null } } }).data.maps).toMatchObject({ enabled: false, server: null });
      // A signed-out page is told nothing either.
      const out = await s.app.inject({ method: 'GET', url: '/api/v1/healthz' });
      expect(outside(out.headers['content-security-policy'])).toEqual([]);
    });

    it('places are still found and kept, and a route still answered: none of it asks another server', async () => {
      const found = await s.app.inject({ method: 'GET', url: `/api/v1/geo/places?q=${encodeURIComponent('Bristol')}&country=GB&language=en`, headers: { cookie: s.owner } });
      expect(found.statusCode, found.body).toBe(200);
      expect((found.json() as { data: { id: number }[] }).data[0]?.id).toBe(2_654_675);
      const made = await s.app.inject({ method: 'POST', url: `/api/v1/data/${s.connectionId}/${s.t('companies')}`, headers: { cookie: s.owner }, payload: { values: { name: 'Fernway Clinics', place: { placeId: 2_654_675 } } } });
      expect(made.statusCode, made.body).toBe(201);
      expect((made.json() as { data: { place: unknown } }).data.place).toMatchObject({ by: 'town', placeId: 2_654_675, name: 'Bristol' });
      const route = await s.app.inject({ method: 'POST', url: '/api/v1/geo/route', headers: { cookie: s.owner }, payload: { stops: [{ lat: 53.8008, lng: -1.5491 }, { lat: 51.4545, lng: -2.5879 }] } });
      expect(route.statusCode, route.body).toBe(200);
      expect((route.json() as { data: { source: string; legs: { estimate: boolean }[] } }).data).toMatchObject({ source: 'straight', legs: [{ estimate: true }] });
    });
  });
}
