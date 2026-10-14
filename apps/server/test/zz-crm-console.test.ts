/**
 * Plan 67, P17: THE CONSOLE'S "SALES CRM" SECTION, against the whole server on SQLite, Postgres and
 * MySQL, with the app's own manifest and its sample, at the ledger's moment, SIGNED IN AS THE
 * PEOPLE IT IS FOR AND AS THE ONES IT IS NOT FOR.
 *
 * - The section's rail is the twelve entries drawn (D10; ruling Q4 of §0.16): Overview, Pipeline,
 *   Deals, Companies, Contacts, Quotes, Approvals, Enquiries, Jobs, then Rules, Emails and Sample
 *   data under Setup; every other page is kept off it and still opens. Each person is listed only
 *   what they may open.
 * - The Overview's cards, read as the installed page holds them: each answers its reader's own
 *   rows (the ledger's whole-team figures to the owner, the CRM admin and Read-only; a rep's own to
 *   a rep), and the two whole-team cards (target cover, the reps) answer the whole team or refuse:
 *   never a part of it under the team's heading.
 * - Approvals: the quotes waiting for an answer, and the sent ones running out first.
 * - The two pages are refused to the roles they are not for, by the server.
 *
 * A manifest change that grants pages: so it is proved on three engines, not only in a browser.
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
  const name = `crm_con_${randomBytes(4).toString('hex')}`;
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
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.17.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

/** The whole server with the real app installed through its routes: with its sample and its people signed in, or bare. */
async function stack(dialect: Dialect): Promise<Stack> {
  const opts = { maps: true, sample: true };
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-con-'));
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
    for (const key of ['dana', 'ivy', 'tessa', 'hugo', 'grace', 'ada']) cookie[key] = await signIn(app, `${key}@crm.test`);
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


type Card = { i: string; widget: string; config: { binding?: Record<string, unknown> } };
type NavItem = { slug: string; fallback: string; offRail?: boolean; pageId: string };
type Section = { appKey: string; groups: { key: string; label: string | null; items: NavItem[] }[] };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the console's Sales CRM section, on ${dialect}`, () => {
    let s: Stack;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const get = (person: string, path: string) => s.app.inject({ method: 'GET', url: path, headers: { cookie: who(person) } });
    /** The CRM's section of the console's sidebar, as the bootstrap answers it to this person: each group's entries on the rail. */
    const rail = async (person: string): Promise<[string, string[]][]> => {
      const res = await get(person, '/api/v1/bootstrap');
      expect(res.statusCode, res.body).toBe(200);
      const section = ((res.json() as { data: { appSections?: Section[] } }).data.appSections ?? []).find((one) => one.appKey === 'crm');
      return (section?.groups ?? []).map((group) => [group.label ?? '', group.items.filter((item) => item.offRail !== true).map((item) => item.fallback)] as [string, string[]]).filter(([, items]) => items.length > 0);
    };
    let pageIds: Record<string, string> = {};
    /** A page as the server hands it to this person: its cards, or the refusal. */
    const page = async (person: string, slug: string): Promise<{ status: number; cards: Card[]; config: Record<string, unknown> }> => {
      const res = await get(person, `/api/v1/pages/${pageIds[slug]!}`);
      if (res.statusCode !== 200) return { status: res.statusCode, cards: [], config: {} };
      const config = (res.json() as { data: { config: Record<string, unknown> } }).data.config;
      // The stored envelope keeps the page's own body one level down.
      const layout = ((config['layout'] ?? (config['config'] as Record<string, unknown> | undefined)?.['layout']) ?? {}) as { items?: Card[] };
      return { status: 200, cards: layout.items ?? [], config };
    };
    /** One card's figure, asked as the person, exactly as the installed page asks it. */
    const answer = async (person: string, card: Card): Promise<{ status: number; code?: string; result?: Record<string, unknown> }> => {
      const res = await s.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie: who(person) }, payload: { descriptor: { connectionId: s.connectionId, ...card.config.binding } } });
      if (res.statusCode !== 200) return { status: res.statusCode, code: (res.json() as { error?: { code?: string } }).error?.code };
      return { status: 200, result: (res.json() as { result: Record<string, unknown> }).result };
    };
    let cards: Record<string, Card> = {};
    const value = async (person: string, key: string): Promise<number | string> => {
      const got = await answer(person, cards[key]!);
      return got.status === 200 ? Number((got.result as { value: number }).value) : `${String(got.status)} ${String(got.code)}`;
    };

    beforeAll(async () => {
      s = await stack(dialect);
      const listed = await get('owner', '/api/v1/pages');
      expect(listed.statusCode, listed.body).toBe(200);
      pageIds = Object.fromEntries((listed.json() as { data: { id: string; slug: string }[] }).data.map((one) => [one.slug, one.id]));
      const overview = await page('owner', 'crm-overview');
      expect(overview.status).toBe(200);
      cards = Object.fromEntries(overview.cards.map((card) => [card.i, card]));
    }, 600_000);
    afterAll(async () => { await s?.close(); });

    it('lists the twelve entries drawn to the install\'s owner, in order, and keeps every other page off the rail and still open', async () => {
      expect(await rail('owner')).toEqual([
        ['', ['Overview', 'Pipeline', 'Deals', 'Companies', 'Contacts', 'Quotes', 'Approvals', 'Enquiries', 'Jobs']],
        ['Setup', ['Rules', 'Emails', 'Sample data']],
      ]);
      // A page kept off the rail is a page all the same: Stages, which the board's note opens, is there for whoever may view it.
      expect((await page('owner', 'crm-stages')).status).toBe(200);
      expect((await page('tessa', 'crm-stages')).status).toBe(200);
    });

    it('lists each person only what they may open: the pages of their role, and none of the three console screens an app role does not manage', async () => {
      const app = ['Overview', 'Pipeline', 'Deals', 'Companies', 'Contacts', 'Quotes', 'Approvals', 'Enquiries', 'Jobs'];
      // The CRM admin, the sales manager and Read-only: the nine pages; Rules, Emails and Sample data are the owner's screens.
      for (const person of ['tessa', 'ivy', 'grace']) expect([person, await rail(person)]).toEqual([person, [['', app]]]);
      // A rep: no Overview and no Approvals (she asks; she does not answer).
      expect(await rail('dana')).toEqual([['', ['Pipeline', 'Deals', 'Companies', 'Contacts', 'Quotes', 'Enquiries', 'Jobs']]]);
      // The account manager: the won deals' board and list, and the accounts.
      expect(await rail('hugo')).toEqual([['', ['Pipeline', 'Deals', 'Companies', 'Contacts', 'Jobs']]]);
      // The operations manager reads no deal: no page of the section's first run but Jobs.
      expect(await rail('ada')).toEqual([['', ['Jobs']]]);
    });

    it('answers the Overview\'s figures to the owner, the CRM admin and Read-only as the ledger has them for the whole team', async () => {
      expect(Object.keys(cards).sort()).toEqual(['by-stage', 'forecast', 'jobs-this-week', 'open-deals', 'open-pipeline', 'reps', 'sitting', 'team-cover', 'unclaimed-enquiries', 'weighted', 'won-this-year']);
      for (const person of ['owner', 'tessa', 'grace']) {
        expect([person, await value(person, 'open-pipeline'), await value(person, 'weighted'), await value(person, 'open-deals'), await value(person, 'won-this-year')]).toEqual([person, 286300, 156562.5, 14, 81600]);
        // Target cover: 81,600 booked plus 156,562.50 weighted, of 450,000 (§14: 53 %).
        expect(Math.round(Number(await value(person, 'team-cover')) * 100), person).toBe(53);
        expect([person, await value(person, 'unclaimed-enquiries')]).toEqual([person, 4]);
        // No job visit is booked in the week of 27 July (§33: the three booked are 4, 5 and 6 August).
        expect([person, await value(person, 'jobs-this-week')]).toEqual([person, 0]);
      }
      // Pipeline by stage (§2): each stage's value and weighted value, in the stages' order.
      const stages = (await answer('owner', cards['by-stage']!)).result as { items: { label: string; values: { value: number; weighted: number } }[] };
      expect(stages.items.map((item) => [item.label, Number(item.values.value), Number(item.values.weighted)])).toEqual([
        ['Discovery', 36350, 3635],
        ['Qualified', 32950, 8237.5],
        ['Proposal', 87000, 43500],
        ['Negotiation', 105400, 79050],
        ['Verbal', 24600, 22140],
      ]);
      // The forecast by month of expected close (§5): July to October.
      const months = (await answer('owner', cards['forecast']!)).result as { points: { t: string; v: number }[] };
      expect(months.points.map((point) => [point.t.slice(0, 7), Number(point.v)])).toEqual([['2026-07', 38340], ['2026-08', 87670], ['2026-09', 28212.5], ['2026-10', 2340]]);
      // The reps (§14): open deals, weighted, booked this year, target, cover; the team's line under them.
      const reps = (await answer('owner', cards['reps']!)).result as { rows: { name: string; open: number; weighted: number; booked: number; target: number; cover: number }[]; totals: Record<string, number> };
      expect(reps.rows.map((row) => [row.name.split(' ')[0], Number(row.open), Number(row.weighted), Number(row.booked), Number(row.target), Math.round(Number(row.cover) * 100)])).toEqual([
        ['Dana', 6, 95740, 28400, 140000, 89],
        ['Leo', 2, 4537.5, 15600, 85000, 24],
        ['Priya', 3, 11695, 11200, 95000, 24],
        ['Sam', 3, 44590, 26400, 130000, 55],
      ]);
      expect([Number(reps.totals['open']), Number(reps.totals['weighted']), Number(reps.totals['booked']), Number(reps.totals['target']), Math.round(Number(reps.totals['cover']) * 100)]).toEqual([14, 156562.5, 81600, 450000, 53]);
      // Sitting longest (§5, §2): d12 34 days, d5 32, d2 20, then d8 19 and d1 14.
      const sitting = (await answer('owner', cards['sitting']!)).result as { rows: { name: string; days: number; stage: string }[] };
      expect(sitting.rows.map((row) => [row.name, Number(row.days), row.stage])).toEqual([
        ['Depot supervisor stations', 34, 'Qualified'],
        ['Showroom refit, phase one', 32, 'Proposal'],
        ['Acoustic booths for the studio floor', 20, 'Proposal'],
        [expect.any(String), 19, expect.any(String)],
        ['Fourth-floor desk rows', 14, expect.any(String)],
      ]);
    });

    it('answers each other reader their own rows, and the whole team\'s two cards whole or not at all', async () => {
      // Ivy leads every rep of the sample: her own reach is the team's, so her figures are the ledger's…
      expect([await value('ivy', 'open-pipeline'), await value('ivy', 'weighted'), await value('ivy', 'open-deals'), await value('ivy', 'won-this-year')]).toEqual([286300, 156562.5, 14, 81600]);
      // …but a row limit holds her, so the whole team's cover and reps are refused, never her part shown as the whole.
      for (const key of ['team-cover', 'reps']) expect([key, (await answer('ivy', cards[key]!)).code]).toEqual([key, 'TEAM_FIGURE_WHOLE_ONLY']);
      // Dana, a rep, reaches her own (§1, §2): 6 deals, 143,400, 95,740 weighted, 28,400 won this year; the team's two refused.
      expect([await value('dana', 'open-pipeline'), await value('dana', 'weighted'), await value('dana', 'open-deals'), await value('dana', 'won-this-year')]).toEqual([143400, 95740, 6, 28400]);
      for (const key of ['team-cover', 'reps']) expect([key, (await answer('dana', cards[key]!)).code]).toEqual([key, 'TEAM_FIGURE_WHOLE_ONLY']);
      // Her columns, weighted (§2): Discovery 320, Proposal 24,500, Negotiation 55,800, Verbal 15,120; no deal of hers is Qualified.
      const danas = (await answer('dana', cards['by-stage']!)).result as { items: { label: string; values: { weighted: number } }[] };
      expect(danas.items.map((item) => [item.label, Number(item.values.weighted)])).toEqual([['Discovery', 320], ['Proposal', 24500], ['Negotiation', 55800], ['Verbal', 15120]]);
      // The account manager reads won deals only: no open deal at all, and the whole team's two refused.
      expect([await value('hugo', 'open-pipeline'), await value('hugo', 'open-deals')]).toEqual([0, 0]);
      // (He reads no target at all: refused as a table he may not read, before any figure is worked out.)
      expect((await answer('hugo', cards['team-cover']!)).code).toBe('TABLE_FORBIDDEN');
      // The operations manager reads no deal: refused, card by card.
      for (const key of ['open-pipeline', 'by-stage', 'team-cover']) expect([key, (await answer('ada', cards[key]!)).status]).toEqual([key, 403]);
    });

    it('shows Approvals the quotes waiting for an answer and the sent ones running out first, to the owner and the sales manager', async () => {
      const approvals = await page('owner', 'crm-approvals');
      expect(approvals.status).toBe(200);
      const card = (key: string) => approvals.cards.find((one) => one.i === key)!;
      for (const person of ['owner', 'ivy', 'tessa', 'grace']) {
        // §27: one waiting, Q-1001 v2 (d5, Sam), 10.5 % off list.
        // A quote is named as the screens name it: its family's number and its version (the document's own number is Q-1008).
        const waiting = (await answer(person, card('waiting'))).result as { rows: { family_no: string; version: number; number: string; deal: string; under_list_pct: number }[] };
        expect([person, waiting.rows.map((row) => [row.family_no, Number(row.version), row.number, row.deal, Math.round(Number(row.under_list_pct) * 10) / 10])]).toEqual([person, [['Q-1001', 2, 'Q-1008', 'Showroom refit, phase one', 10.5]]]);
        // §9: the newest sent versions, running out first: Q-1001 ran out on 26 July, Q-1002 runs out on 30 July, Q-1003 on 7 August.
        const out = (await answer(person, card('running-out'))).result as { rows: { family_no: string; version: number; valid_until: unknown }[] };
        const day = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
        expect([person, out.rows.slice(0, 3).map((row) => [row.family_no, Number(row.version), day(row.valid_until)])]).toEqual([person, [['Q-1001', 1, '2026-07-26'], ['Q-1002', 1, '2026-07-30'], ['Q-1003', 1, '2026-08-07']]]);
      }
    });

    it('refuses the two pages to the roles they are not for, by the server, and keeps the Pipeline page\'s words as the app wrote them', async () => {
      for (const person of ['dana', 'hugo', 'ada']) {
        for (const slug of ['crm-overview', 'crm-approvals']) expect([person, slug, (await page(person, slug)).status >= 403]).toEqual([person, slug, true]);
      }
      for (const person of ['tessa', 'ivy', 'grace']) for (const slug of ['crm-overview', 'crm-approvals']) expect([person, slug, (await page(person, slug)).status]).toEqual([person, slug, 200]);
      // The board was built as the app named it (not "created empty"): its odds, its two totals, its card and its note.
      const board = await page('owner', 'crm-pipeline');
      const text = JSON.stringify(board.config);
      for (const word of ['"badge"', '"weighted_value"', '"daysSince"', '"Columns come from Stages"', '"/p/crm-stages"']) expect(text, word).toContain(word);
    });
  });
}
