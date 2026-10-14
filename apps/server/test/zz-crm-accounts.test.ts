/**
 * Plan 67, P07: what the Accounts screens ask of the server, against the whole server on SQLite,
 * Postgres and MySQL, with the app's own manifest and its sample, at the ledger's moment, SIGNED
 * IN AS THE PEOPLE THE SCREENS ARE FOR AND AS THE ONES THEY ARE NOT FOR.
 *
 * ONE MANIFEST WORD IS ON TRIAL: `deal_marks.contact_id`, the main contact of a deal copied onto
 * its mark (the row every reader of Accounts may read of any deal). It is what lets a contact's
 * card say "main contact on 2 open deals" to somebody who may open neither. Proved: it is filled
 * for the sample, follows the deal when its contact changes, nobody writes it, and it carries no
 * more than the number of a contact (whom every reader of Accounts reads anyway): never a deal's
 * title, amount or owner. The marketer's mark still says nothing of whose a deal is.
 *
 * The rest grants nothing. It is here because the screens' figures are folds the server cuts to
 * the reader's rows (a measure over `deals` on the list of companies), and that cut is what a
 * company's page must be exactly right about: a rep is answered HER open value at a company, the
 * manager the team's, the account manager what was won, the marketer nothing but a count.
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
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, manifestsRepo, snapshotsRepo, usersRepo, type MetaDb } from '@adminium/meta';

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

// The sample's times of day are placed where the server is. The ledger's business is in London, as the stand's server is.
process.env.TZ = 'Europe/London';

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
/** 09:35 on Tuesday 28 July 2026, where the sample's business is: the moment every figure of the ledger is true at. */
const LEDGER_NOW = '2026-07-28T08:35:00.000Z';
const PEOPLE = manifest()['sampleData'] as { people: { key: string; name: string; email: string; role: string }[] };

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `crm_acc_${randomBytes(4).toString('hex')}`;
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
async function stack(dialect: Dialect): Promise<Stack> {
  const opts = { maps: true, sample: true };
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-acc-'));
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
    // THE LEDGER'S MOMENT. The sample's dates are placed from the day it is added, and a month's figure depends on which
    // month that is: the clock is held at 09:35 on Tuesday 28 July 2026, London, from here to the end of the file.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(LEDGER_NOW) });
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
    for (const key of ['dana', 'ivy', 'tessa', 'hugo', 'grace', 'lena', 'sam']) cookie[key] = await signIn(app, `${key}@crm.test`);
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
      vi.useRealTimers();
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}


const OPEN = { column: 'state', op: 'eq', value: 'open' };
/** Where the business is, a day begins at 23:00 UTC the evening before, in July: "sat 30 days or more" is "entered before this". */
const STALE_BEFORE = '2026-06-28T23:00:00.000Z';

interface Grouped { items: { key: string | number | null; label: string | null; value: number; values?: Record<string, number | null> }[] }
type Rows = Record<string, unknown>[];

/** The folds a company's card and page ask, as the screens send them. */
const measures = (deals: string) => {
  const fold = (id: string, fn: string, of: string | null, state: string) => ({ id, table: deals, fkColumn: 'company_id', fn, ...(of === null ? {} : { of: { terms: [{ sign: 'plus', factors: [of] }] } }), emptyAs: 'zero', where: [{ column: 'state', in: [state] }] });
  return encodeURIComponent(JSON.stringify({ measures: [fold('open_n', 'count', null, 'open'), fold('open_value', 'sum', 'amount', 'open'), fold('weighted', 'sum', 'weighted_value', 'open'), fold('won_value', 'sum', 'amount', 'won')] }));
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's Accounts screens, on ${dialect}`, () => {
    let s: Stack;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const get = (person: string, path: string) => s.app.inject({ method: 'GET', url: path, headers: { cookie: who(person) } });
    const send = (person: string, method: 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown) => s.app.inject({ method, url: path, headers: { cookie: who(person) }, ...(payload === undefined ? {} : { payload: payload as never }) });
    const asked = (person: string, table: string, descriptor: Record<string, unknown>): Promise<Reply> =>
      s.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie: who(person) }, payload: { descriptor: { connectionId: s.connectionId, source: { name: s.t(table) }, ...descriptor } } });
    const said = (res: Reply): string => (res.statusCode < 300 ? 'ok' : `${String(res.statusCode)} ${String((res.json() as { error?: { code?: string } }).error?.code)}`);
    const data = (res: Reply): Rows => {
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Rows }).data;
    };
    const one = async (statement: string): Promise<Record<string, unknown>> => (await s.rows(statement))[0]!;
    const byName = async (table: string): Promise<Record<string, number>> => Object.fromEntries((await s.rows(`SELECT id, name FROM ${s.real(table)}`)).map((row) => [String(row['name']), Number(row['id'])]));
    /** A count by a column of the marks, as `name of the row the column points at → count`. */
    const marksBy = async (person: string, column: string, names: Record<string, number>): Promise<Record<string, number>> => {
      const res = await asked(person, 'deal_marks', { shape: 'categorical', filters: [OPEN], groupBy: [column], aggregations: [{ fn: 'count', alias: 'n' }], limit: 200 });
      expect(res.statusCode, res.body).toBe(200);
      const counts = Object.fromEntries((res.json() as { result: Grouped }).result.items.map((item) => [String(item.key), Number(item.values?.['n'] ?? item.value)]));
      return Object.fromEntries(Object.entries(names).map(([name, id]) => [name, counts[String(id)] ?? 0]));
    };
    const companies = async (person: string): Promise<Record<string, { n: number | null; open: number | null; weighted: number | null; won: number | null }>> => {
      const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
      const rows = data(await get(person, url('companies', `?select=id,name&limit=200&compute=${measures(s.t('deals'))}`)));
      return Object.fromEntries(rows.map((row) => [String(row['name']), { n: num(row['open_n']), open: num(row['open_value']), weighted: num(row['weighted']), won: num(row['won_value']) }]));
    };

    beforeAll(async () => {
      s = await stack(dialect);
    }, 600_000);
    afterAll(async () => { await s?.close(); });

    it('a mark carries its deal\'s main contact: filled for the sample, and it follows the deal', async () => {
      const apart = await s.rows(`SELECT m.id FROM ${s.real('deal_marks')} m JOIN ${s.real('deals')} d ON d.id = m.deal_id WHERE COALESCE(m.contact_id, 0) <> COALESCE(d.contact_id, 0)`);
      expect(apart).toEqual([]);
      expect(Number((await one(`SELECT COUNT(*) AS n FROM ${s.real('deal_marks')} WHERE contact_id IS NOT NULL AND state = 'open'`))['n'])).toBe(14);

      // d1 (Nordwind, Dana's): Petra is its main contact. Dana names Jonas instead; the mark follows, and follows back.
      const people = await byName('contacts');
      const d1 = await one(`SELECT id, contact_id FROM ${s.real('deals')} WHERE name = 'Fourth-floor desk rows'`);
      expect(Number(d1['contact_id'])).toBe(people['Petra Lindqvist']);
      const mark = async (): Promise<number> => Number((await one(`SELECT contact_id FROM ${s.real('deal_marks')} WHERE deal_id = ${String(d1['id'])}`))['contact_id']);
      expect(said(await send('dana', 'PATCH', url('deals', `/${String(d1['id'])}`), { values: { contact_id: people['Jonas Reuter'] } }))).toBe('ok');
      expect(await mark()).toBe(people['Jonas Reuter']);
      expect(said(await send('dana', 'PATCH', url('deals', `/${String(d1['id'])}`), { values: { contact_id: people['Petra Lindqvist'] } }))).toBe('ok');
      expect(await mark()).toBe(people['Petra Lindqvist']);
      // Nobody types a mark's contact: it is the deal's.
      const markId = (await one(`SELECT id FROM ${s.real('deal_marks')} WHERE deal_id = ${String(d1['id'])}`))['id'];
      for (const person of ['dana', 'ivy', 'lena']) expect(said(await send(person, 'PATCH', url('deal_marks', `/${String(markId)}`), { values: { contact_id: people['Jonas Reuter'] } })), person).toMatch(/^403 /);
      expect(await mark()).toBe(people['Petra Lindqvist']);
    });

    it('answers "main contact on N open deals" from the marks, and never whose a deal is to the marketer', async () => {
      const people = await byName('contacts');
      // The ledger: two open deals each for Marta and Ruth, none for Kit, one for the other ten.
      const ledger = Object.fromEntries(Object.keys(people).map((name) => [name, name === 'Marta Kovac' || name === 'Ruth Adeyemi' ? 2 : name === 'Kit Delaney' ? 0 : 1]));
      expect(Object.keys(people)).toHaveLength(13);
      for (const person of ['dana', 'ivy', 'tessa', 'hugo', 'grace']) expect(await marksBy(person, 'contact_id', people), person).toEqual(ledger);

      // Dana may open six of the fourteen: the rest she is answered as a count and nothing else.
      const hers = data(await get('dana', url('deals', `?select=id,name,contact_id&limit=200&where=${encodeURIComponent(JSON.stringify(OPEN))}`)));
      expect(hers).toHaveLength(6);
      const ines = hers.filter((deal) => Number(deal['contact_id']) === people['Ines Vaughan']).map((deal) => deal['name']);
      // Ines is the main contact of d3 (Dana's own) only; Tomas of d10, Sam's, which Dana is not answered.
      expect(ines).toEqual(['Records-room lockers']);
      expect(hers.filter((deal) => Number(deal['contact_id']) === people['Tomas Reidy'])).toEqual([]);

      // The marketer: her mark says the company and the state, with the numbers of the rows it links (a link is always shown). Never whose the deal is.
      const marks = data(await get('lena', url('deal_marks', '?limit=200')));
      expect(marks).toHaveLength(40);
      const shown = [...new Set(marks.flatMap((row) => Object.keys(row)))].filter((key) => !key.startsWith('_'));
      expect(shown).toEqual(expect.arrayContaining(['company_id', 'state']));
      expect(shown.filter((key) => !['id', 'deal_id', 'company_id', 'contact_id', 'stage_id', 'state'].includes(key))).toEqual([]);
      expect(said(await get('lena', url('deal_marks', '?select=owner_id&limit=5')))).toBe('403 COLUMN_FORBIDDEN');
      expect(said(await asked('lena', 'deal_marks', { shape: 'categorical', filters: [OPEN], groupBy: ['owner_id'], aggregations: [{ fn: 'count', alias: 'n' }] }))).toBe('403 COLUMN_FORBIDDEN');
      // A contact she reads anyway (name, title, company): what the mark adds is that an open deal names them, not which deal's title, amount or owner.
      expect(said(await get('lena', url('deals', '?limit=5')))).toMatch(/^403 /);
    });

    it('answers each reader HER figures at a company: the team\'s, a rep\'s own, what was won, or nothing', async () => {
      // The ledger's table: open deals, open value, weighted, won to date. These are the whole team's.
      const ledger = {
        'Cobalt Legal': { n: 2, open: 40200, weighted: 17460, won: 36900 },
        'Fernway Clinics': { n: 1, open: 12400, weighted: 3100, won: 11200 },
        'Juno Analytics': { n: 1, open: 21600, weighted: 16200, won: 24800 },
        'Nordwind Logistics': { n: 2, open: 67050, weighted: 43162.5, won: 26400 },
        'Veldt Studios': { n: 2, open: 30700, weighted: 14070, won: 8900 },
        'Brightloom Foods': { n: 2, open: 45800, weighted: 26020, won: 0 },
        'Harbor & Finch': { n: 2, open: 40750, weighted: 24225, won: 6200 },
        'Tandem Robotics': { n: 1, open: 6300, weighted: 1575, won: 15600 },
        'Low Orbit': { n: 1, open: 21500, weighted: 10750, won: 0 },
      };
      for (const person of ['ivy', 'tessa', 'grace']) expect(await companies(person), person).toEqual(ledger);

      // Dana: her six open deals and her three wins, at the companies they are at.
      expect(await companies('dana')).toEqual({
        'Cobalt Legal': { n: 1, open: 16800, weighted: 15120, won: 36900 },
        'Fernway Clinics': { n: 0, open: 0, weighted: 0, won: 0 },
        'Juno Analytics': { n: 1, open: 21600, weighted: 16200, won: 0 },
        'Nordwind Logistics': { n: 1, open: 52800, weighted: 39600, won: 0 },
        'Veldt Studios': { n: 2, open: 30700, weighted: 14070, won: 8900 },
        'Brightloom Foods': { n: 0, open: 0, weighted: 0, won: 0 },
        'Harbor & Finch': { n: 0, open: 0, weighted: 0, won: 0 },
        'Tandem Robotics': { n: 0, open: 0, weighted: 0, won: 0 },
        'Low Orbit': { n: 1, open: 21500, weighted: 10750, won: 0 },
      });
      // The account manager reads a deal once it is won: nothing open, and what was won by anybody.
      expect(await companies('hugo')).toEqual(Object.fromEntries(Object.entries(ledger).map(([name, row]) => [name, { n: 0, open: 0, weighted: 0, won: row.won }])));
      // The marketer reads no deal: every fold is empty, and the row says which.
      const lena = data(await get('lena', url('companies', `?select=id,name&limit=200&compute=${measures(s.t('deals'))}`)));
      expect(lena).toHaveLength(9);
      for (const row of lena) {
        expect([row['open_n'], row['open_value'], row['weighted'], row['won_value']], String(row['name'])).toEqual([null, null, null, null]);
        expect(row['_masked']).toEqual(expect.arrayContaining(['open_n', 'open_value', 'weighted', 'won_value']));
      }

      // One company, as its page asks it: the same folds, and how many people are there.
      const nordwind = (await byName('companies'))['Nordwind Logistics']!;
      const page = async (person: string) => {
        const res = await get(person, url('companies', `/${String(nordwind)}?agg=${encodeURIComponent(`people:${s.t('contacts')}.company_id:count`)}&compute=${measures(s.t('deals'))}`));
        expect(res.statusCode, res.body).toBe(200);
        const row = (res.json() as { data: Record<string, unknown> }).data;
        return [Number(row['people']), Number(row['open_n']), Number(row['open_value']), Number(row['weighted']), Number(row['won_value'])];
      };
      expect(await page('ivy')).toEqual([2, 2, 67050, 43162.5, 26400]);
      expect(await page('dana')).toEqual([2, 1, 52800, 39600, 0]);
    });

    it('counts every open deal at a company for everybody who reads the marks, and whose is whose only for those who read deals', async () => {
      const names = await byName('companies');
      const ledger = { 'Cobalt Legal': 2, 'Fernway Clinics': 1, 'Juno Analytics': 1, 'Nordwind Logistics': 2, 'Veldt Studios': 2, 'Brightloom Foods': 2, 'Harbor & Finch': 2, 'Tandem Robotics': 1, 'Low Orbit': 1 };
      for (const person of ['dana', 'ivy', 'hugo', 'grace', 'lena']) expect(await marksBy(person, 'company_id', names), person).toEqual(ledger);

      // Nordwind's two open deals: d1 is Dana's, d12 is Leo's. Dana is answered Leo's as a mark: who and which stage, no more.
      const nordwind = names['Nordwind Logistics']!;
      const here = encodeURIComponent(JSON.stringify({ and: [{ column: 'company_id', op: 'eq', value: nordwind }, OPEN] }));
      const marks = data(await get('dana', url('deal_marks', `?select=deal_id,owner_id,stage_id,state&limit=200&where=${here}`)));
      const deals = data(await get('dana', url('deals', `?select=id,name&limit=200&where=${here}`)));
      expect(deals.map((deal) => deal['name'])).toEqual(['Fourth-floor desk rows']);
      const hidden = marks.filter((mark) => !deals.some((deal) => deal['id'] === mark['deal_id']));
      expect(hidden).toHaveLength(1);
      const leo = await one(`SELECT owner_id, stage_id FROM ${s.real('deals')} WHERE name = 'Depot supervisor stations'`);
      expect(hidden[0]).toMatchObject({ owner_id: leo['owner_id'], stage_id: Number(leo['stage_id']), state: 'open' });
      expect(Object.keys(hidden[0]!).filter((key) => !key.startsWith('_') && key !== 'id').sort()).toEqual(['deal_id', 'owner_id', 'stage_id', 'state']);
      // And the deal itself is, for her, a key that names no row.
      expect((await get('dana', url('deals', `/${String(hidden[0]!['deal_id'])}`))).statusCode).toBe(404);

      // The marketer asks for whose it is: refused.
      expect(said(await get('lena', url('deal_marks', '?select=owner_id&limit=5')))).toBe('403 COLUMN_FORBIDDEN');
    });

    it('counts the deals that have sat past the "stale" day, by company, for the reader\'s own', async () => {
      const names = await byName('companies');
      const stale = async (person: string): Promise<Record<string, number>> => {
        const res = await asked(person, 'deals', { shape: 'categorical', filters: [OPEN, { column: 'entered_stage_at', op: 'lt', value: STALE_BEFORE }], groupBy: ['company_id'], aggregations: [{ fn: 'count', alias: 'n' }], limit: 200 });
        expect(res.statusCode, res.body).toBe(200);
        const counts = Object.fromEntries((res.json() as { result: Grouped }).result.items.map((item) => [String(item.key), Number(item.values?.['n'] ?? item.value)]));
        return Object.fromEntries(Object.entries(names).flatMap(([name, id]) => (counts[String(id)] === undefined ? [] : [[name, counts[String(id)]!]])));
      };
      // The ledger: Nordwind 1 stale (d12, 34 days) and Brightloom 1 (d5, 32 days). Neither is Dana's.
      expect(await stale('ivy')).toEqual({ 'Nordwind Logistics': 1, 'Brightloom Foods': 1 });
      expect(await stale('dana')).toEqual({});
      expect(await stale('sam')).toEqual({ 'Brightloom Foods': 1 });
    });

    it('a pasted list: a rep brings companies in, the same list again brings nothing, and a contact\'s line needs its company', async () => {
      const upload = (person: string, text: string) => s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=pasted.csv', headers: { cookie: who(person), 'content-type': 'text/csv' }, payload: text });
      const ready = (person: string, fileId: string, table: string, columns: [string, string][], options: Record<string, unknown>) =>
        send(person, 'POST', '/api/v1/imports', { fileId, connectionId: s.connectionId, table: s.t(table), mapping: { columns: columns.map(([from, to]) => ({ from, to })) }, options });
      const run = async (person: string, text: string, table: string, columns: [string, string][], options: Record<string, unknown>): Promise<{ counts: unknown; stats: Record<string, number> } | string> => {
        const up = await upload(person, text);
        expect(up.statusCode, up.body).toBe(201);
        const made = await ready(person, (up.json() as { data: { fileId: string } }).data.fileId, table, columns, options);
        if (made.statusCode !== 201) return said(made);
        const id = (made.json() as { data: { import: { id: string } } }).data.import.id;
        const preview = await get(person, `/api/v1/imports/${id}/preview`);
        expect(preview.statusCode, preview.body).toBe(200);
        const counts = (preview.json() as { data: { counts: unknown } }).data.counts;
        expect((await send(person, 'POST', `/api/v1/imports/${id}/run`, undefined)).statusCode).toBe(202);
        await s.jobs();
        const ran = (await get(person, `/api/v1/imports/${id}`)).json() as { data: { status: string; stats: Record<string, number> } };
        return { counts, stats: ran.data.stats };
      };
      const COLS: [string, string][] = [['Name', 'name'], ['Sector', 'sector'], ['Town', 'town']];
      const paste = 'Name\tSector\tTown\nP07 Kestrel Print\tPrinting\tYork\nP07 Verity Insurance\tInsurance\tDurham\nP07 Halden Foods\tFood\tRipon\n';
      const count = async (table: string, like: string): Promise<number> => Number((await one(`SELECT COUNT(*) AS n FROM ${s.real(table)} WHERE name LIKE '${like}'`))['n']);

      // As the screen offers a rep: a line already here is left as it is, matched on the company's name.
      expect(await run('dana', paste, 'companies', COLS, { mode: 'skip', matchColumn: 'name' })).toMatchObject({ counts: { new: 3, here: 0, refused: 0 }, stats: { inserted: 3, skipped: 0 } });
      expect(await count('companies', 'P07 %')).toBe(3);
      // The same three again: nothing is brought in.
      expect(await run('dana', paste, 'companies', COLS, { mode: 'skip', matchColumn: 'name' })).toMatchObject({ counts: { new: 0, here: 3, refused: 0 }, stats: { inserted: 0, skipped: 3 } });
      expect(await count('companies', 'P07 %')).toBe(3);
      // With no match column every line is new: this is why the screen always names one for companies.
      expect(await run('ivy', 'Name\nP07 Kestrel Print\n', 'companies', [['Name', 'name']], { mode: 'insert' })).toMatchObject({ stats: { inserted: 1 } });
      expect(await count('companies', 'P07 Kestrel Print')).toBe(2);

      // THE SERVER LETS A REP UPDATE BY A LIST (she may change any company one at a time); the screen does not offer it to her.
      const changed = await run('dana', 'Name\tTown\nP07 Halden Foods\tHarrogate\n', 'companies', [['Name', 'name'], ['Town', 'town']], { mode: 'upsert', matchColumn: 'name' });
      expect(changed).toMatchObject({ stats: { inserted: 0, updated: 1 } });
      expect((await one(`SELECT town FROM ${s.real('companies')} WHERE name = 'P07 Halden Foods'`))['town']).toBe('Harrogate');

      // Nobody else brings a list in: the account manager (who may add a company by hand), Read-only, the marketer.
      for (const person of ['hugo', 'grace', 'lena']) expect(await run(person, paste, 'companies', COLS, { mode: 'skip', matchColumn: 'name' }), person).toBe('403 TABLE_FORBIDDEN');

      // Contacts: a line names its company by the company's number and says whether the person may be mailed.
      const halden = Number((await one(`SELECT id FROM ${s.real('companies')} WHERE name = 'P07 Halden Foods'`))['id']);
      const people = `Company\tName\tJob\tMay\n${String(halden)}\tP07 Ada Lowe\tBuyer\tyes\n\tP07 No Company\tBuyer\tyes\n999999\tP07 Wrong Company\tBuyer\tyes\n`;
      const CONTACT: [string, string][] = [['Company', 'company_id'], ['Name', 'name'], ['Job', 'job_title'], ['May', 'may_email']];
      const brought = await run('dana', people, 'contacts', CONTACT, { mode: 'insert' });
      // The line with no company is refused when it is looked at. The line whose company's number names no company is refused when it is written.
      expect((brought as { counts: { refused: number } }).counts.refused).toBeGreaterThanOrEqual(1);
      expect(brought).toMatchObject({ stats: { inserted: 1 } });
      expect(await count('contacts', 'P07 %')).toBe(1);
      expect(Number((await one(`SELECT company_id FROM ${s.real('contacts')} WHERE name = 'P07 Ada Lowe'`))['company_id'])).toBe(halden);
      for (const person of ['hugo', 'grace', 'lena']) expect(await run(person, people, 'contacts', CONTACT, { mode: 'insert' }), person).toBe('403 TABLE_FORBIDDEN');
    });

    it('a company and a contact are everybody\'s to read; who may change them is the server\'s', async () => {
      const names = await byName('companies');
      const cobalt = names['Cobalt Legal']!;
      for (const person of ['dana', 'ivy', 'tessa', 'hugo', 'grace', 'lena']) {
        // The sample's nine and thirteen (this file's own rows are called "P07 …").
        expect(data(await get(person, url('companies', '?select=id,name&limit=200'))).filter((row) => !String(row['name']).startsWith('P07 ')), person).toHaveLength(9);
        expect(data(await get(person, url('contacts', '?select=id,name&limit=200'))).filter((row) => !String(row['name']).startsWith('P07 ')), person).toHaveLength(13);
      }
      // A contact's e-mail and phone are personal: kept from the marketer and Read-only, who are refused a list that names them and answered the rest with them left empty.
      for (const person of ['lena', 'grace']) {
        expect(said(await get(person, url('contacts', '?select=id,name,email&limit=5'))), person).toBe('403 COLUMN_FORBIDDEN');
        const row = data(await get(person, url('contacts', '?limit=1')))[0]!;
        expect([row['email'], row['phone'], row['_masked']], person).toEqual([null, null, expect.arrayContaining(['email', 'phone'])]);
      }
      expect(data(await get('dana', url('contacts', '?select=id,name,email&limit=1')))[0]!['email']).toMatch(/@/);

      // Changing a company: a rep, the manager, the admin and the account manager; Read-only and the marketer are refused.
      const town = async (): Promise<string> => String((await one(`SELECT town FROM ${s.real('companies')} WHERE id = ${String(cobalt)}`))['town']);
      for (const person of ['dana', 'ivy', 'tessa', 'hugo']) expect(said(await send(person, 'PATCH', url('companies', `/${String(cobalt)}`), { values: { town: 'Leeds' } })), person).toBe('ok');
      for (const person of ['grace', 'lena']) {
        expect(said(await send(person, 'PATCH', url('companies', `/${String(cobalt)}`), { values: { town: 'Elsewhere' } })), person).toMatch(/^403 /);
        expect(said(await send(person, 'POST', url('companies'), { values: { name: 'P07 Refused' } })), person).toMatch(/^403 /);
        expect(said(await send(person, 'POST', url('contacts'), { values: { name: 'P07 Refused', company_id: cobalt, may_email: true } })), person).toMatch(/^403 /);
      }
      expect(await town()).toBe('Leeds');
      expect(Number((await one(`SELECT COUNT(*) AS n FROM ${s.real('companies')} WHERE name = 'P07 Refused'`))['n'])).toBe(0);

      // A NEW COMPANY SENT TWICE WITH ONE KEY IS ONE COMPANY: the reply to the first may never have arrived.
      const key = 'p07AccountsProofClientKey000000001';
      const first = await send('dana', 'POST', url('companies'), { values: { name: 'P07 Sent Twice', town: 'York' }, clientKey: key });
      const again = await send('dana', 'POST', url('companies'), { values: { name: 'P07 Sent Twice', town: 'York' }, clientKey: key });
      expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
      expect((again.json() as { replayed?: boolean; data: { id: number } }).replayed).toBe(true);
      expect((again.json() as { data: { id: number } }).data.id).toBe((first.json() as { data: { id: number } }).data.id);
      expect(Number((await one(`SELECT COUNT(*) AS n FROM ${s.real('companies')} WHERE name = 'P07 Sent Twice'`))['n'])).toBe(1);
    });
  });
}
