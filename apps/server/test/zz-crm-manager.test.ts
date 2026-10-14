/**
 * Plan 67, P11: what the manager's screens ask of the server, against the whole server on SQLite,
 * Postgres and MySQL, with the app's own manifest and its sample, at the ledger's moment, SIGNED
 * IN AS THE PEOPLE THE SCREENS ARE FOR AND AS THE ONES THEY ARE NOT FOR.
 *
 * The screens add up nothing: every count, sum and average is one of these figures. So what is on
 * trial is that each engine answers the ledger's number for each: the forecast by month of a DATE
 * column, the figure "expected to have closed by a day", how long deals have sat (a condition on
 * a moment), two-way counts, an average, a count over an OR of the three nudge checks; that each
 * is cut to the reader's rows; and that the people with none of these screens are refused by the
 * server, whatever a menu shows.
 *
 * It grants nothing and changes no manifest word. It is here because a browser spec runs on
 * SQLite only, and a month's bucket or a moment's comparison is where engines differ.
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
  const name = `crm_mgr_${randomBytes(4).toString('hex')}`;
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
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-mgr-'));
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
    for (const key of ['dana', 'ivy', 'tessa', 'hugo', 'grace', 'lena', 'corin']) cookie[key] = await signIn(app, `${key}@crm.test`);
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
/** Where the business is, a day begins at 23:00 UTC the evening before, in July. "Sat N days or more" is "entered before this". */
const SAT = { d14: '2026-07-14T23:00:00.000Z', d30: '2026-06-28T23:00:00.000Z', d21: '2026-07-07T23:00:00.000Z', quiet7: '2026-07-21T23:00:00.000Z' };
const NUDGES = {
  quiet: [{ column: 'last_activity_at', op: 'lt', value: SAT.quiet7 }],
  stuck: [{ column: 'entered_stage_at', op: 'lt', value: SAT.d21 }],
  soon: [{ column: 'expected_close', op: 'gte', value: '2026-07-28' }, { column: 'expected_close', op: 'lte', value: '2026-08-04' }, { column: 'stage_odds', op: 'lt', value: 0.9 }],
};
const TABLES = ['deals', 'stages', 'lost_reasons', 'activities', 'deal_stage_changes', 'deal_amount_changes', 'nudge_snoozes', 'reps', 'follow_ups'];

interface Grouped { items: { key: string | number | null; label: string | null; value: number; values?: Record<string, number | null> }[] }
interface Series { points: { t: string; v: number | null }[] }
interface Matrix { rowKeys: (string | number | null)[]; colKeys: (string | number | null)[]; cells: (number | null)[][] }

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's manager's screens, on ${dialect}`, () => {
    let s: Stack;
    let stages: Record<string, string>;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const get = (person: string, path: string) => s.app.inject({ method: 'GET', url: path, headers: { cookie: who(person) } });
    const send = (person: string, method: 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown) => s.app.inject({ method, url: path, headers: { cookie: who(person) }, ...(payload === undefined ? {} : { payload: payload as never }) });
    const asked = (person: string, table: string, descriptor: Record<string, unknown>): Promise<Reply> =>
      s.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie: who(person) }, payload: { descriptor: { connectionId: s.connectionId, source: { name: s.t(table) }, ...descriptor } } });
    const figure = async <T>(person: string, table: string, descriptor: Record<string, unknown>): Promise<T> => {
      const res = await asked(person, table, descriptor);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { result: T }).result;
    };
    const count = async (person: string, table: string, filters: unknown[]): Promise<number> => Number((await figure<{ value: number }>(person, table, { shape: 'single-metric', filters, aggregations: [{ fn: 'count', alias: 'n' }] })).value);
    const sum = async (person: string, column: string, filters: unknown[]): Promise<number> => Number((await figure<{ value: number }>(person, 'deals', { shape: 'single-metric', filters, aggregations: [{ fn: 'sum', column, alias: 'v' }] })).value);
    const list = async (person: string, ref: string, where: unknown, more = ''): Promise<{ data: Record<string, unknown>[]; total: number }> => {
      const res = await get(person, url(ref, `?limit=200&count=exact&where=${encodeURIComponent(JSON.stringify(where))}${more}`));
      expect(res.statusCode, res.body).toBe(200);
      const doc = res.json() as { data: Record<string, unknown>[]; page: { total: number } };
      return { data: doc.data, total: doc.page.total };
    };
    /** A grouped figure as `label → alias → number`. */
    const byLabel = (grouped: Grouped, alias: string): Record<string, number> => Object.fromEntries(grouped.items.map((item) => [String(item.label), Number(item.values?.[alias] ?? item.value)]));

    beforeAll(async () => {
      s = await stack(dialect);
      const rows = await s.rows(`SELECT id, label FROM ${s.real('stages')}`);
      stages = Object.fromEntries(rows.map((row) => [String(row['id']), String(row['label'])]));
    }, 600_000);
    afterAll(async () => { await s?.close(); });

    it('answers the sales manager the ledger\'s forecast, month by month, and what is expected to have closed by each month\'s end', async () => {
      // The furthest day a deal is expected on says how many months the strip holds: d10, 16 October.
      const furthest = await get('ivy', url('deals', `?limit=1&order=expected_close.desc,id&select=expected_close&where=${encodeURIComponent(JSON.stringify({ and: [OPEN, { column: 'expected_close', op: 'not_null' }] }))}`));
      expect(String((furthest.json() as { data: { expected_close: string }[] }).data[0]!.expected_close).slice(0, 10)).toBe('2026-10-16');
      // Each month between two days, as the screen asks it: a count and a sum in one figure.
      const months: [number, number][] = [];
      const upTo: number[] = [];
      for (const [from, end] of [['2026-07-01', '2026-07-31'], ['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31']] as const) {
        const one = (await figure<Grouped>('ivy', 'deals', { shape: 'categorical', filters: [OPEN, { column: 'expected_close', op: 'between', value: [from, end] }], groupBy: ['state'], aggregations: [{ fn: 'count', alias: 'n' }, { fn: 'sum', column: 'weighted_value', alias: 'w' }] })).items[0]!.values!;
        months.push([Number(one['n']), Number(one['w'])]);
        upTo.push(await sum('ivy', 'weighted_value', [OPEN, { column: 'expected_close', op: 'between', value: ['2026-07-01', end] }]));
      }
      expect(months).toEqual([[3, 38340], [5, 87670], [5, 28212.5], [1, 2340]]);
      expect(upTo).toEqual([38340, 126010, 154222.5, 156562.5]);
      /*
       * WHY NOT "A FIGURE BY MONTH". The same sums come back from the timeseries shape on every engine, but the moment
       * each month's bucket is named by differs: SQLite and MySQL answer the month's first midnight in UTC, Postgres the
       * first midnight where the server is (30 June, 22:00 or 23:00 UTC, for July). A screen that reads the month off
       * the bucket's name shows July's figure under June there. The values are asserted; the names are only described.
       */
      const series = await figure<Series>('ivy', 'deals', { shape: 'timeseries', filters: [OPEN, { column: 'expected_close', op: 'gte', value: '2026-07-01' }], bucket: { column: 'expected_close', unit: 'month' }, aggregations: [{ fn: 'sum', column: 'weighted_value', alias: 'w' }] });
      expect(series.points.map((point) => Number(point.v))).toEqual([38340, 87670, 28212.5, 2340]);
      // No open deal of the sample is past its day or without one.
      expect(await count('ivy', 'deals', [OPEN, { or: [{ column: 'expected_close', op: 'lt', value: '2026-07-01' }, { column: 'expected_close', op: 'is_null' }] }])).toBe(0);
    });

    it('answers who has what open, both ways at once, and the win rate\'s two counts', async () => {
      const byOwner = await figure<Grouped>('ivy', 'deals', { shape: 'categorical', filters: [OPEN], groupBy: ['owner_id'], aggregations: [{ fn: 'count', alias: 'n' }, { fn: 'sum', column: 'weighted_value', alias: 'w' }], limit: 200 });
      const of = (person: string) => byOwner.items.find((item) => item.key === s.id[person])!.values;
      expect([of('dana'), of('priya'), of('sam'), of('leo')]).toEqual([{ n: 6, w: 95740 }, { n: 3, w: 11695 }, { n: 3, w: 44590 }, { n: 2, w: 4537.5 }]);
      const matrix = await figure<Matrix>('ivy', 'deals', { shape: 'matrix', filters: [OPEN], groupBy: ['owner_id', 'stage_id'], aggregations: [{ fn: 'count', alias: 'n' }] });
      const row = (person: string): Record<string, number> => {
        const r = matrix.rowKeys.findIndex((key) => key === s.id[person]);
        return Object.fromEntries(matrix.colKeys.map((key, c) => [stages[String(key)]!, Number(matrix.cells[r]![c] ?? 0)]).filter(([, n]) => n !== 0));
      };
      expect(row('dana')).toEqual({ Discovery: 1, Proposal: 2, Negotiation: 2, Verbal: 1 });
      expect(row('leo')).toEqual({ Discovery: 1, Qualified: 1 });
      const closed = async (between: [string, string]) => {
        const grouped = await figure<Grouped>('ivy', 'deals', { shape: 'categorical', filters: [{ column: 'state', op: 'in', value: ['won', 'lost'] }, { column: 'closed_on', op: 'between', value: between }], groupBy: ['state'], aggregations: [{ fn: 'count', alias: 'n' }, { fn: 'sum', column: 'amount', alias: 'amount' }, { fn: 'avg', column: 'cycle_days', alias: 'cycle' }] });
        const state = (key: string) => grouped.items.find((item) => item.key === key)!.values!;
        return [Number(state('won')['n']), Number(state('lost')['n']), Math.round(Number(state('won')['cycle']))];
      };
      // Twelve months back from the 28th: 8 of 26, 54 days; this year: 5 of 17, 54 days.
      expect(await closed(['2025-07-28', '2026-07-28'])).toEqual([8, 18, 54]);
      expect(await closed(['2026-01-01', '2026-12-31'])).toEqual([5, 12, 54]);
    });

    it('counts how long deals have sat in each stage, from a condition on the moment they entered it', async () => {
      const sat = async (more: unknown[]) => byLabel(await figure<Grouped>('ivy', 'deals', { shape: 'categorical', filters: [OPEN, ...more], groupBy: ['stage_id'], groupLabel: 'stage_id.label', aggregations: [{ fn: 'count', alias: 'n' }], limit: 50 }), 'n');
      expect(await sat([{ column: 'entered_stage_at', op: 'gte', value: SAT.d14 }])).toEqual({ Discovery: 3, Qualified: 1, Proposal: 1, Negotiation: 2, Verbal: 2 });
      // d1 entered Negotiation on the 14th, in the morning: fourteen days, so it is in the middle band.
      expect(await sat([{ column: 'entered_stage_at', op: 'lt', value: SAT.d14 }, { column: 'entered_stage_at', op: 'gte', value: SAT.d30 }])).toEqual({ Qualified: 1, Proposal: 1, Negotiation: 1 });
      expect(await sat([{ column: 'entered_stage_at', op: 'lt', value: SAT.d30 }])).toEqual({ Qualified: 1, Proposal: 1 });
      // The three sitting longest, in the order the Team view lists them.
      const longest = await get('ivy', url('deals', `?limit=3&order=entered_stage_at,id&select=name&where=${encodeURIComponent(JSON.stringify(OPEN))}`));
      expect((longest.json() as { data: { name: string }[] }).data.map((deal) => deal.name)).toEqual(['Depot supervisor stations', 'Showroom refit, phase one', 'Acoustic booths for the studio floor']);
    });

    it('groups twelve months of lost deals by reason, and by reason and stage', async () => {
      const lost = [{ column: 'state', op: 'eq', value: 'lost' }, { column: 'closed_on', op: 'gte', value: '2025-07-28' }];
      const byReason = await figure<Grouped>('ivy', 'deals', { shape: 'categorical', filters: lost, groupBy: ['lost_reason_id'], groupLabel: 'lost_reason_id.label', aggregations: [{ fn: 'count', alias: 'n' }, { fn: 'sum', column: 'amount', alias: 'v' }], limit: 100 });
      expect(byLabel(byReason, 'v')).toEqual({ 'Went with another supplier': 111100, 'Wrong fit for us': 77300, 'Lost on timing': 49800, 'Budget pulled': 33300, 'No decision made': 22900 });
      expect(byLabel(byReason, 'n')).toEqual({ 'Went with another supplier': 6, 'Wrong fit for us': 3, 'Lost on timing': 3, 'Budget pulled': 3, 'No decision made': 3 });
      const whole = (await figure<Grouped>('ivy', 'deals', { shape: 'categorical', filters: lost, groupBy: ['state'], aggregations: [{ fn: 'count', alias: 'n' }, { fn: 'sum', column: 'amount', alias: 'v' }, { fn: 'avg', column: 'amount', alias: 'a' }] })).items[0]!.values!;
      expect([Number(whole['n']), Number(whole['v']), Math.round(Number(whole['a']))]).toEqual([18, 294400, 16356]);
      const matrix = await figure<Matrix>('ivy', 'deals', { shape: 'matrix', filters: lost, groupBy: ['lost_reason_id', 'stage_id'], aggregations: [{ fn: 'count', alias: 'n' }] });
      const supplier = byReason.items.find((item) => item.label === 'Went with another supplier')!.key;
      const r = matrix.rowKeys.findIndex((key) => String(key) === String(supplier));
      expect(Object.fromEntries(matrix.colKeys.map((key, c) => [stages[String(key)]!, Number(matrix.cells[r]![c] ?? 0)]).filter(([, n]) => n !== 0))).toEqual({ Proposal: 4, Negotiation: 2 });
      // Six months and three, from the same day of the month.
      expect(await sum('ivy', 'amount', [{ column: 'state', op: 'eq', value: 'lost' }, { column: 'closed_on', op: 'gte', value: '2026-01-28' }])).toBe(135100);
      expect(await sum('ivy', 'amount', [{ column: 'state', op: 'eq', value: 'lost' }, { column: 'closed_on', op: 'gte', value: '2026-04-28' }])).toBe(95500);
    });

    it('catches the ledger\'s four deals with the three nudge checks, each deal once', async () => {
      expect(await count('ivy', 'deals', [OPEN, { or: [{ and: NUDGES.quiet }, { and: NUDGES.stuck }, { and: NUDGES.soon }] }])).toBe(4);
      const names = async (rule: keyof typeof NUDGES) => (await list('ivy', 'deals', { and: [OPEN, ...NUDGES[rule]] }, '&select=name&order=id')).data.map((deal) => deal['name']);
      expect(await names('quiet')).toEqual(['Lab bench stools', 'Depot supervisor stations']);
      expect(await names('stuck')).toEqual(['Showroom refit, phase one', 'Depot supervisor stations']);
      expect(await names('soon')).toEqual(['Analyst pods, second floor']);
      // A snoozed deal is taken out of one check by its number: three are left.
      const d6 = (await list('ivy', 'deals', { column: 'name', op: 'eq', value: 'Analyst pods, second floor' })).data[0]!['id'];
      expect(await count('ivy', 'deals', [OPEN, { or: [{ and: NUDGES.quiet }, { and: NUDGES.stuck }, { and: [...NUDGES.soon, { column: 'id', op: 'neq', value: d6 }] }] }])).toBe(3);
    });

    it('reads the feed from the app\'s own tables, on the open deals, with the deal and its company beside each line', async () => {
      const open = (await list('ivy', 'deals', OPEN, '&select=id')).data.map((deal) => deal['id']);
      expect(open).toHaveLength(14);
      const onOpen = { column: 'deal_id', op: 'in', value: open };
      const kinds = await figure<Grouped>('ivy', 'activities', { shape: 'categorical', filters: [onOpen], groupBy: ['kind'], aggregations: [{ fn: 'count', alias: 'n' }], limit: 20 });
      expect(Object.fromEntries(kinds.items.map((item) => [String(item.key), Number(item.values?.['n'] ?? item.value)]))).toEqual({ call: 8, email: 7, meeting: 4, note: 7 });
      expect(await count('ivy', 'deal_stage_changes', [onOpen])).toBe(40);
      expect(await count('ivy', 'deal_stage_changes', [onOpen, { column: 'from_stage_id', op: 'is_null' }])).toBe(14);
      expect(await count('ivy', 'activities', [onOpen, { column: 'author_id', op: 'eq', value: s.id['dana'] }])).toBe(12);
      const newest = await get('ivy', url('activities', `?limit=1&order=at.desc,id.desc&lookup=deal:deal_id.name&lookup=company:deal_id.company_id.name&where=${encodeURIComponent(JSON.stringify(onOpen))}`));
      expect(newest.statusCode, newest.body).toBe(200);
      const first = (newest.json() as { data: Record<string, unknown>[] }).data[0]!;
      expect([first['deal'], first['company'], first['kind']]).toEqual(['Records-room lockers', 'Cobalt Legal', 'call']);
      const move = await get('ivy', url('deal_stage_changes', `?limit=1&order=at.desc,id.desc&lookup=from:from_stage_id.label&lookup=to:to_stage_id.label&where=${encodeURIComponent(JSON.stringify({ and: [onOpen, { column: 'from_stage_id', op: 'not_null' }] }))}`));
      const moved = (move.json() as { data: Record<string, unknown>[] }).data[0]!;
      expect(typeof moved['from'] === 'string' && typeof moved['to'] === 'string', JSON.stringify(moved)).toBe(true);
    });

    it('cuts every figure to the reader: a rep\'s are her own, the admin\'s and Read-only\'s everybody\'s, the account manager\'s the won deals', async () => {
      expect([await count('dana', 'deals', [OPEN]), await sum('dana', 'weighted_value', [OPEN])]).toEqual([6, 95740]);
      // Asked for somebody else's, a rep is answered nothing, not refused: the rows are not hers to count.
      expect(await count('dana', 'deals', [OPEN, { column: 'owner_id', op: 'eq', value: s.id['sam'] }])).toBe(0);
      expect(await count('dana', 'activities', [])).toBe(12);
      for (const person of ['ivy', 'tessa', 'grace']) expect([person, await count(person, 'deals', [OPEN]), await sum(person, 'weighted_value', [OPEN])]).toEqual([person, 14, 156562.5]);
      // A rep's one-to-one, as her manager reads it: seven steps queued, three of them overdue at 09:35.
      const steps = [{ column: 'owner_id', op: 'eq', value: s.id['dana'] }, { column: 'kind', op: 'eq', value: 'step' }, { column: 'done', op: 'eq', value: false }];
      expect((await list('ivy', 'follow_ups', { and: steps })).total).toBe(7);
      expect((await list('ivy', 'follow_ups', { and: [...steps, { column: 'due_at', op: 'lt', value: LEDGER_NOW }] })).total).toBe(3);
      // The account manager (ruling R6): no open deal and no lost one, by a list or by a figure.
      expect([await count('hugo', 'deals', [OPEN]), await count('hugo', 'deals', [{ column: 'state', op: 'eq', value: 'lost' }]), await count('hugo', 'deals', [{ column: 'state', op: 'eq', value: 'won' }])]).toEqual([0, 0, 8]);
      expect((await list('hugo', 'deals', { column: 'state', op: 'in', value: ['open', 'lost'] })).total).toBe(0);
    });

    it('refuses the people these screens are not for, by a list and by a figure, table by table', async () => {
      const refused: string[] = [];
      const tried = async (person: string, table: string): Promise<void> => {
        const read = await get(person, url(table, '?limit=1'));
        const fig = await asked(person, table, { shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }] });
        if (read.statusCode !== 403 || fig.statusCode !== 403) refused.push(`${person} ${table}: list ${String(read.statusCode)}, figure ${String(fig.statusCode)}`);
      };
      for (const person of ['lena', 'corin']) for (const table of TABLES) await tried(person, table);
      for (const table of ['activities', 'deal_stage_changes', 'deal_amount_changes', 'nudge_snoozes']) await tried('hugo', table);
      await tried('grace', 'nudge_snoozes');
      expect(refused).toEqual([]);
    });

    it('holds the writes: a threshold is the manager\'s and the admin\'s to move, a snooze is its maker\'s own, and Read-only writes nothing', async () => {
      const settings = Number((await s.rows(`SELECT id FROM ${s.real('settings')}`))[0]!['id']);
      const quiet = async () => Number((await s.rows(`SELECT nudge_quiet_days AS n FROM ${s.real('settings')}`))[0]!['n']);
      for (const person of ['dana', 'grace', 'hugo', 'lena', 'corin']) expect([person, (await send(person, 'PATCH', url('settings', `/${String(settings)}`), { values: { nudge_quiet_days: 3 } })).statusCode]).toEqual([person, 403]);
      expect(await quiet()).toBe(7);
      expect((await send('ivy', 'PATCH', url('settings', `/${String(settings)}`), { values: { nudge_quiet_days: 3 } })).statusCode).toBe(200);
      expect(await quiet()).toBe(3);
      // The list follows the setting: seven deals have had nothing logged for three days.
      expect(await count('ivy', 'deals', [OPEN, { column: 'last_activity_at', op: 'lt', value: '2026-07-25T23:00:00.000Z' }])).toBe(7);
      expect((await send('tessa', 'PATCH', url('settings', `/${String(settings)}`), { values: { nudge_quiet_days: 7 } })).statusCode).toBe(200);

      const d6 = (await list('ivy', 'deals', { column: 'name', op: 'eq', value: 'Analyst pods, second floor' })).data[0]!['id'];
      const snooze = { values: { rule: 'soon', deal_id: d6, until: '2026-08-04T08:35:00.000Z' } };
      expect((await send('grace', 'POST', url('nudge_snoozes'), snooze)).statusCode).toBe(403);
      expect((await send('grace', 'PATCH', url('deals', `/${String(d6)}`), { values: { name: 'Renamed' } })).statusCode).toBe(403);
      const made = await send('ivy', 'POST', url('nudge_snoozes'), snooze);
      expect(made.statusCode, made.body).toBe(201);
      const id = (made.json() as { data: { id: number; person_id: string } }).data;
      expect(id.person_id).toBe(s.id['ivy']);
      // Hers alone: the CRM admin, who reads everybody's deals, reads none of her snoozes and cannot remove one.
      expect((await list('tessa', 'nudge_snoozes', { column: 'until', op: 'gt', value: LEDGER_NOW })).total).toBe(0);
      expect((await send('tessa', 'DELETE', url('nudge_snoozes', `/${String(id.id)}?confirm=true`))).statusCode).toBe(404);
      expect((await list('ivy', 'nudge_snoozes', { column: 'until', op: 'gt', value: LEDGER_NOW })).total).toBe(1);
      expect((await send('ivy', 'DELETE', url('nudge_snoozes', `/${String(id.id)}?confirm=true`))).statusCode).toBeLessThan(300);
    });

    it('answers a rule\'s on/off to whoever may manage automations and to nobody of the app\'s roles (the gap the Nudges page speaks to)', async () => {
      const path = `/api/v1/automations?connectionId=${s.connectionId}`;
      for (const person of ['ivy', 'tessa', 'grace', 'dana']) expect([person, (await get(person, path)).statusCode]).toEqual([person, 403]);
      const rules = ((await get('owner', path)).json() as { rules: { enabled: boolean; managed: { templateKey: string } | null }[] }).rules;
      const state = Object.fromEntries(rules.filter((rule) => rule.managed?.templateKey.startsWith('nudge-') === true).map((rule) => [rule.managed!.templateKey, rule.enabled]));
      expect(state).toEqual({ 'nudge-quiet': false, 'nudge-stuck': false, 'nudge-soon': false });
      // The staff side's own config names no rule.
      const config = (await get('ivy', '/apps/crm/staff/surface-config.json')).json() as Record<string, unknown>;
      expect(JSON.stringify(config)).not.toContain('nudge-quiet');
      expect(Object.keys(config)).not.toContain('rules');
    });
  });
}
