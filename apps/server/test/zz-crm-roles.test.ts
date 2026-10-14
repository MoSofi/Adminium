/**
 * Plan 67, F08: the nine roles of the Sales CRM, each tried SIGNED IN AS A PERSON WHO HOLDS IT,
 * against the whole server, on SQLite, Postgres and MySQL.
 *
 * The app is installed through its routes with the sample in; the sample's sixteen people are
 * then given a password (a sample person cannot sign in, so the test makes them ordinary staff:
 * the only thing here that the product itself does not do).
 *
 * To run: copy into `~/Work/lanes/p67/apps/server/test/` as `zz-crm-roles.test.ts`, run, remove.
 *
 * One table of tries: who, what they try, what must come back. `ok` is a 2xx; a refusal is
 * written `<status> <code>`. A row out of reach must answer exactly as a key that does not
 * exist (`gone`). The three engine holes E1–E3 are at the end, each asserted AS IT IS TODAY:
 * the test fails the day the engine closes one, and its expectation is then turned round.
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
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, manifestsRepo, rolesRepo, snapshotsRepo, teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';

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

// The server says the version it was built at (0.3.26 until the release); the app's floor is the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
// The sample the app ships, and the people its manifest lists.
const SEEDS = process.env.CRM_SEEDS ?? `${APP}/whole/seeds`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const PEOPLE = manifest()['sampleData'] as { people: { key: string; name: string; email: string; role: string }[]; teams: unknown[] };

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `crm_roles_${randomBytes(4).toString('hex')}`;
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
  dialect: Dialect;
  app: AdminiumServer;
  meta: MetaDb;
  connectionId: string;
  /** The id of one of the app's tables, as the data routes name it. */
  t: (ref: string) => string;
  real: (ref: string) => string;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** Each person's user id, by the sample's key; `noor` is a rep in no team, made here. */
  id: Record<string, string>;
  cookie: Record<string, string>;
  owner: string;
  /** Run every job that is waiting, as the worker would: a rule's run, a mail's send. */
  jobs: () => Promise<void>;
  close: () => Promise<void>;
}

let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.11.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`, payload: { email, password: ADMIN_PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

async function stack(dialect: Dialect): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-roles-'));
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
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key: 'crm', version: document['version'], connectionId: connection.id, addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } });
  expect(installed.statusCode, installed.body).toBe(200);
  const sample = await app.inject({ method: 'POST', url: '/api/v1/apps/crm/sample-data', headers: { cookie: owner }, payload: {} });
  expect(sample.statusCode, sample.body).toBe(200);
  while ((await composed.jobs.worker.runOnce()) > 0);

  // The sample's people become ordinary staff with a password, each under an address the test knows.
  const users = usersRepo(meta);
  const samplePeople = await users.list({ status: 'sample', limit: 50 });
  expect(samplePeople).toHaveLength(PEOPLE.people.length);
  const id: Record<string, string> = {};
  const cookie: Record<string, string> = {};
  for (const person of PEOPLE.people) {
    const user = samplePeople.find((one) => one.name === person.name)!;
    expect(user, person.name).toBeDefined();
    await meta.db.updateTable('adminium_users').set({ status: 'active', passwordHash: hash, email: `${person.key}@crm.test` }).where('id', '=', user.id).execute();
    id[person.key] = user.id;
  }
  // A rep outside Ivy's team, so that "her team's" is not the same as "everybody's".
  const noor = await users.create({ email: 'noor@crm.test', name: 'Noor Haddad', passwordHash: hash });
  await rolesRepo(meta).assignToUser(noor.id, (await rolesRepo(meta).findBySlug('crm-rep'))!.id);
  const west = await teamsRepo(meta).create('West');
  await teamsRepo(meta).setMember(west.id, noor.id, false);
  id['noor'] = noor.id;
  for (const key of Object.keys(id)) cookie[key] = await signIn(app, `${key}@crm.test`);

  const model = parseDatabaseModel((await snapshotsRepo(meta).latest(connection.id))!.schema);
  const handle = await manager.data(connection.id);
  return {
    dialect,
    app,
    meta,
    connectionId: connection.id,
    t: (ref) => model.tables.find((table) => table.name === `crm_${ref}`)!.id,
    real: (ref) => `crm_${ref}`,
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    id,
    cookie,
    owner,
    jobs: async () => {
      // A rule set off by a person's write waits out the minute in which the write can be undone: the test does not, and
      // makes every waiting job due now (the only clock it moves).
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
  let code = '';
  try {
    const error = (res.json() as { error?: { code?: string } }).error;
    code = error?.code ?? '';
  } catch {
    code = '';
  }
  return `${String(res.statusCode)} ${code}`.trim();
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's nine roles, signed in as each, on ${dialect}`, () => {
    let s: Stack;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const get = (person: string, ref: string, rest = '') => s.app.inject({ method: 'GET', url: url(ref, rest), headers: { cookie: who(person) } });
    const post = (person: string, ref: string, values: Record<string, unknown>) => s.app.inject({ method: 'POST', url: url(ref), headers: { cookie: who(person) }, payload: { values } });
    const patch = (person: string, ref: string, key: unknown, values: Record<string, unknown>) => s.app.inject({ method: 'PATCH', url: url(ref, `/${String(key)}`), headers: { cookie: who(person) }, payload: { values } });
    const del = (person: string, ref: string, key: unknown) => s.app.inject({ method: 'DELETE', url: url(ref, `/${String(key)}`), headers: { cookie: who(person) } });
    /** Every key a person's list returns (the sample is small: one page of 200 holds any table). */
    const keys = async (person: string, ref: string): Promise<number[] | string> => {
      const res = await get(person, ref, '?limit=200&select=id');
      if (res.statusCode !== 200) return said(res);
      return (res.json() as { data: { id: unknown }[] }).data.map((row) => Number(row.id)).sort((a, b) => a - b);
    };
    const ids = async (statement: string): Promise<number[]> => (await s.rows(statement)).map((row) => Number(row['id'])).sort((a, b) => a - b);
    const one = async (statement: string): Promise<Record<string, unknown>> => (await s.rows(statement))[0]!;
    const made = (res: Reply): number => Number((res.json() as { data: { id: unknown } }).data.id);
    /** A row out of reach answers, to the byte, as a key that names no row. */
    const gone = async (person: string, ref: string, key: unknown): Promise<void> => {
      const hidden = await get(person, ref, `/${String(key)}`);
      const nothing = await get(person, ref, '/999999');
      expect(hidden.statusCode, `${person} ${ref}/${String(key)}: ${hidden.body}`).toBe(404);
      const plain = (body: string, k: string) => body.replace(/"requestId":"[^"]*"/, '"requestId":"R"').replaceAll(k, 'K');
      expect(plain(hidden.body, String(key))).toBe(plain(nothing.body, '999999'));
    };
    const yes = (value: boolean): string => (dialect === 'postgres' ? String(value) : value ? '1' : '0');

    beforeAll(async () => {
      s = await stack(dialect);
    }, 600_000);
    afterAll(async () => {
      await s?.close();
    });

    it('each role opens the pages of its tables, and no other', async () => {
      const counts: Record<string, number> = {};
      for (const [person, role] of [['tessa', 'admin'], ['ivy', 'sales-manager'], ['dana', 'rep'], ['hugo', 'account-manager'], ['lena', 'marketer'], ['corin', 'front-desk'], ['ada', 'ops-manager'], ['f_yusuf', 'crew'], ['grace', 'read-only']] as const) {
        const res = await s.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: who(person) } });
        expect(res.statusCode, res.body).toBe(200);
        // Every menu entry of the app, wherever the reply files it.
        const seen = new Set<string>();
        const walk = (node: unknown): void => {
          if (Array.isArray(node)) return node.forEach(walk);
          if (node === null || typeof node !== 'object') return;
          const item = node as { pageId?: unknown; appKey?: unknown };
          if (typeof item.pageId === 'string' && item.appKey === 'crm') seen.add(item.pageId);
          Object.values(node).forEach(walk);
        };
        walk(res.json());
        counts[role] = seen.size;
      }
      // A records page per table the role reads, the Pipeline board for the five roles that open the deals list, and the
      // console's Overview and Approvals for the CRM admin, the sales manager and Read-only (P17). A page kept off the
      // rail is still one of the role's pages: it is listed with the section, and only not drawn.
      expect(counts).toEqual({ admin: 74, 'sales-manager': 62, rep: 60, 'account-manager': 30, marketer: 8, 'front-desk': 11, 'ops-manager': 24, crew: 16, 'read-only': 68 });
    });

    it('nobody reads a private table but the two people of a row: not the CRM admin, not Read-only, not the Super Admin', async () => {
      const mine = await ids(`SELECT id FROM ${s.real('one_to_ones')} WHERE manager_id = '${s.id['ivy']!}'`);
      expect(mine.length).toBeGreaterThan(0);
      expect(await keys('ivy', 'one_to_ones')).toEqual(mine);
      const danas = await ids(`SELECT id FROM ${s.real('one_to_ones')} WHERE rep_id = '${s.id['dana']!}'`);
      expect(await keys('dana', 'one_to_ones')).toEqual(danas);
      const sessions = await ids(`SELECT id FROM ${s.real('one_to_one_sessions')} WHERE rep_id = '${s.id['dana']!}'`);
      expect(await keys('dana', 'one_to_one_sessions')).toEqual(sessions);
      const outcomes: Record<string, unknown> = {};
      for (const person of ['tessa', 'grace', 'hugo', 'ada']) for (const ref of ['one_to_ones', 'one_to_one_sessions', 'coaching_plans', 'coaching_areas']) outcomes[`${person} ${ref}`] = await keys(person, ref);
      for (const [label, outcome] of Object.entries(outcomes)) expect(typeof outcome === 'string' ? outcome.slice(0, 3) : outcome, label).toBe('403');
      // The Super Admin holds every grant, and a private table is still "the rows that name you": none.
      for (const ref of ['one_to_ones', 'one_to_one_sessions', 'coaching_plans', 'coaching_areas']) expect(await keys('owner', ref), `owner ${ref}`).toEqual([]);
      await gone('owner', 'one_to_ones', danas[0]);
      // A rep reads their one-to-one and may not change it.
      expect(said(await patch('dana', 'one_to_ones', danas[0], { cadence: 'weekly' }))).toMatch(/^403/);
      // Another rep gets "not there".
      await gone('sam', 'one_to_ones', danas[0]);
    });

    it('every table, read as each of the sixteen people: the keys a list returns are the matrix\'s, no more and no fewer', async () => {
      // WHO READS WHAT: typed here from the plan's matrix (Part 2, section 7), not read from the manifest's roles.
      // Columns: CRM admin, Sales manager, rep, account manager, marketer, front desk, operations manager, crew, Read-only.
      // `-` no grant · `all` every row · `own` the rows that are theirs · `team` theirs and those of people they lead ·
      // `+free` and the rows that are nobody's · `won` every row while its state is "won".
      const ROLES = ['admin', 'sales-manager', 'rep', 'account-manager', 'marketer', 'front-desk', 'ops-manager', 'crew', 'read-only'] as const;
      const MATRIX: [string, string][] = [
        ['stages lost_reasons', 'all all all all - - - - all'],
        ['price_list', 'all all all - - - - - all'],
        ['deals', 'all team own won - - - - all'],
        ['deal_stage_changes deal_amount_changes activities comments quotes quote_lines', 'all team own - - - - - all'],
        ['follow_ups', 'all team own own - - - - all'],
        ['saved_views saved_searches', 'own+free own+free own+free own+free - - - - own+free'],
        ['nudge_snoozes', 'own own own - - - - - -'],
        // F14: who is on a deal is read by whoever is on it (and by who leads its owner).
        ['deal_members', 'all team own all - - - - all'],
        // F14: the marketer reads a deal's mark (which company, open or closed) and nothing else of a deal.
        ['deal_marks', 'all all all all all - - - all'],
        ['site_visits visit_notes visit_agreed', 'all team own - - - - - all'],
        ['companies contacts', 'all all all all all all - - all'],
        ['territories territory_places', 'all all all all all - - - all'],
        ['renewals referrals reps covers', 'all all all all - - - - all'],
        ['targets cover_notes', 'all team own - - - - - all'],
        ['one_to_ones one_to_one_sessions coaching_plans coaching_areas', '- own own - - - - - -'],
        ['actions', 'own own own - - - - - -'],
        ['meetings meeting_slots meeting_decisions starters starter_steps', 'all all all - - - - - all'],
        ['threads messages', 'own own own own - - - - -'],
        ['thread_members', 'all all all all - - - - -'],
        ['enquiries', 'all team+free own+free - all own+free - - all'],
        ['shows', 'all all all - all all - - all'],
        ['showroom_spaces samples display_pieces showroom_bookings sample_loans sample_chases', 'all all all - - all - - all'],
        ['jobs feedback complaints warranty_claims', 'all team own all - - all - all'],
        ['job_visits sign_offs snags', 'all team own all - - all own all'],
        ['delivery_notes delivery_note_lines', 'all - - all - - all own all'],
        ['crews crew_members crew_days vehicles vehicle_faults', 'all - - - - - all all all'],
        ['waste_removals subcontractors insurance_incidents', 'all - - - - - all - all'],
        // Supply is on only with Inventory, which is not here: its own roles (CRM admin, Operations manager, Read-only) hold
        // nothing on its table, and the sales roles, of other parts, go on reading it.
        ['deal_stock_needs', '- team own - - - - - -'],
        ['vehicle_checks fuel_fills time_sheets time_sheet_lines certificates', 'all - - - - - all own all'],
        ['outbox', 'all - - - - - - - -'],
        ['settings', 'all all all all all all all all all'],
      ];
      const reads: Record<string, Record<string, string>> = {};
      for (const [refs, cells] of MATRIX) {
        const each = cells.split(' ');
        expect(each, refs).toHaveLength(ROLES.length);
        for (const ref of refs.split(' ')) {
          expect(reads[ref], `${ref} is typed twice`).toBeUndefined();
          reads[ref] = Object.fromEntries(ROLES.map((role, at) => [role, each[at]!]));
        }
      }

      // WHOSE A ROW IS: the ways of each table, from the app's manifest; what a way means is worked out here, by hand.
      interface Way { column?: string; via?: string; through?: { table: string; link: string; on?: string; user: string; from?: string; to?: string } }
      const tables = (manifest()['requiredSchema'] as { tables: { ref: string; belongs?: Way[]; columns: { ref: string; references?: string }[] }[] }).tables;
      expect(Object.keys(reads).sort(), 'the matrix names every table of the app, and no other').toEqual(tables.map((table) => table.ref).sort());
      // The typed matrix opens as many tables to each role as the role's menu holds pages (the test above).
      const opened = Object.fromEntries(ROLES.map((role) => [role, Object.values(reads).filter((row) => row[role] !== '-').length]));
      expect(opened).toEqual({ admin: 70, 'sales-manager': 59, rep: 59, 'account-manager': 29, marketer: 8, 'front-desk': 11, 'ops-manager': 23, crew: 16, 'read-only': 64 });

      // Every row of every table, read as nobody (SQL).
      const raw: Record<string, Record<string, unknown>[]> = {};
      for (const table of tables) raw[table.ref] = await s.rows(`SELECT * FROM ${s.real(table.ref)}`);
      const day = (value: unknown): string => {
        if (value instanceof Date) return `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        return String(value).slice(0, 10);
      };
      const today = day(new Date());
      // Who leads whom: the sample's one team, and the test's "West" (Noor, who leads nobody and is led by nobody).
      const led: Record<string, Set<string>> = {};
      for (const team of PEOPLE.teams as { lead: string; members: string[] }[]) led[s.id[team.lead]!] = new Set(team.members.map((member) => s.id[member]!));

      const reaches = (ref: string, row: Record<string, unknown>, me: string, wide: boolean, depth = 0): boolean => {
        const table = tables.find((one) => one.ref === ref)!;
        if (table.belongs === undefined) return true;
        expect(depth, `${ref}: a row is reached through at most two links`).toBeLessThan(3);
        return table.belongs.some((way) => {
          if (way.column !== undefined) {
            const person = row[way.column];
            return person === me || (wide && typeof person === 'string' && (led[me]?.has(person) ?? false));
          }
          if (way.through !== undefined) {
            const { table: listing, link, on, user, from, to } = way.through;
            const mine = String(row[on ?? 'id']);
            return raw[listing]!.some((listed) => String(listed[link]) === mine && listed[user] === me && (from === undefined || day(listed[from]) <= today) && (to === undefined || listed[to] === null || day(listed[to]) >= today));
          }
          const parent = table.columns.find((column) => column.ref === way.via)!.references!;
          const above = raw[parent]!.find((one) => String(one['id']) === String(row[way.via!]));
          return above !== undefined && reaches(parent, above, me, wide, depth + 1);
        });
      };
      const free = (ref: string, row: Record<string, unknown>): boolean => {
        const columns = (tables.find((one) => one.ref === ref)!.belongs ?? []).flatMap((way) => (way.column === undefined ? [] : [way.column]));
        return columns.length > 0 && columns.every((column) => row[column] === null);
      };

      const wrong: string[] = [];
      let lists = 0;
      let limited = 0;
      const people = [...PEOPLE.people.map((person) => [person.key, person.role] as const), ['noor', 'rep'] as const];
      for (const [person, role] of people) {
        const me = s.id[person]!;
        for (const table of tables) {
          const cell = reads[table.ref]![role]!;
          const got = await keys(person, table.ref);
          lists += 1;
          if (cell === '-') {
            if (typeof got !== 'string' || !got.startsWith('403')) wrong.push(`${person} (${role}) ${table.ref}: no grant, and the list answered ${JSON.stringify(got).slice(0, 80)}`);
            continue;
          }
          const [reach, plus] = cell.split('+') as [string, string | undefined];
          const want = raw[table.ref]!
            .filter((row) => {
              if (reach === 'all') return true;
              if (reach === 'won') return row['state'] === 'won';
              return reaches(table.ref, row, me, reach === 'team') || (plus === 'free' && free(table.ref, row));
            })
            .map((row) => Number(row['id']))
            .sort((a, b) => a - b);
          if (reach !== 'all' && want.length < raw[table.ref]!.length) limited += 1;
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            const have = typeof got === 'string' ? [] : got;
            const extra = have.filter((id) => !want.includes(id));
            const missing = want.filter((id) => !have.includes(id));
            wrong.push(`${person} (${role}) ${table.ref} [${cell}]: ${typeof got === 'string' ? got : `${String(have.length)} rows`}, wanted ${String(want.length)}; too many ${JSON.stringify(extra.slice(0, 8))}, missing ${JSON.stringify(missing.slice(0, 8))}`);
          }
        }
      }
      expect(wrong, wrong.join('\n')).toEqual([]);
      expect(lists).toBe(people.length * tables.length);
      // The proof is not hollow: a good share of the lists really are cut down to fewer rows than the table holds.
      expect(limited).toBeGreaterThan(150);
    }, 600_000);

    it('what to try first, signed in as each role', async () => {
      const R: [string, unknown, unknown][] = [];
      const t = (label: string, got: unknown, want: unknown) => R.push([label, got, want]);
      const refused = (res: Reply) => said(res).slice(0, 3);

      // ── What is in the sample, read as nobody (SQL) ──────────────────────────
      const all = await ids(`SELECT id FROM ${s.real('deals')}`);
      const of = async (person: string) => ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id[person]!}'`);
      const danas = await of('dana');
      const sams = await of('sam');
      const won = await ids(`SELECT id FROM ${s.real('deals')} WHERE state = 'won'`);
      const stage = (await ids(`SELECT id FROM ${s.real('stages')}`))[0]!;
      const company = (await ids(`SELECT id FROM ${s.real('companies')}`))[0]!;
      const samOpen = (await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['sam']!}' AND state = 'open'`))[0]!;
      const danaOpen = (await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['dana']!}' AND state = 'open'`))[0]!;

      // ── CRM admin (Tessa) ────────────────────────────────────────────────────
      t('1 admin reads every deal', await keys('tessa', 'deals'), all);
      t('2 admin reads no action that is not hers', await keys('tessa', 'actions'), await ids(`SELECT id FROM ${s.real('actions')} WHERE owner_id = '${s.id['tessa']!}'`));
      t('3 admin reads no conversation she is not in', await keys('tessa', 'messages'), []);
      const sheet = (await ids(`SELECT id FROM ${s.real('time_sheets')} WHERE state = 'sent'`))[0]!;
      t('4 admin does not sign a time sheet off', refused(await patch('tessa', 'time_sheets', sheet, { state: 'signed-off' })), '403');
      t('5 admin reads the outbox; nobody else does', [await keys('tessa', 'outbox'), String(await keys('ivy', 'outbox')).slice(0, 3)], [[], '403']);

      // ── Sales manager (Ivy), and a rep in no team of hers (Noor) ──────────────
      const noorDeal = made(await post('noor', 'deals', { name: 'Noor: reception desks', company_id: company, stage_id: stage, owner_id: s.id['noor'], typed_amount: 9000 }));
      t('6 a rep makes a deal and it is hers', String((await one(`SELECT owner_id FROM ${s.real('deals')} WHERE id = ${String(noorDeal)}`))['owner_id']), s.id['noor']);
      t('7 the manager reads her team\'s deals, not another team\'s', await keys('ivy', 'deals'), all);
      await gone('ivy', 'deals', noorDeal);
      t('8 the manager does not delete a deal', refused(await del('ivy', 'deals', danaOpen)), '403');
      t('9 the manager changes the approval threshold', said(await patch('ivy', 'settings', 1, { approval_threshold_pct: 5 })), 'ok');
      t('10 the manager does not change the week\'s first day', refused(await patch('ivy', 'settings', 1, { week_starts: 'sun' })), '403');
      t('11 the manager writes cover for one of her people', said(await post('ivy', 'covers', { owner_id: s.id['leo'], cover_id: s.id['sam'], starts_on: '2027-01-04', ends_on: '2027-01-08' })), 'ok');
      t('12 the manager does not write cover for another team\'s rep', refused(await post('ivy', 'covers', { owner_id: s.id['noor'], cover_id: s.id['ivy'], starts_on: '2027-01-04', ends_on: '2027-01-08' })), '403');
      t('13 the manager sets a target for her rep; the rep reads only their own', [said(await post('ivy', 'targets', { rep_id: s.id['dana'], year: 2031, amount: 150000 })), await keys('dana', 'targets')], ['ok', await ids(`SELECT id FROM ${s.real('targets')} WHERE rep_id = '${s.id['dana']!}'`)]);
      t('14 a rep does not set a target', refused(await post('dana', 'targets', { rep_id: s.id['dana'], year: 2032, amount: 1 })), '403');

      // ── Sales rep (Dana) ─────────────────────────────────────────────────────
      t('15 a rep reads their own deals', await keys('dana', 'deals'), danas);
      await gone('dana', 'deals', samOpen);
      t('16 a rep does not change a colleague\'s deal', refused(await patch('dana', 'deals', samOpen, { name: 'Mine now' })), '404');
      const onSams = await post('dana', 'follow_ups', { deal_id: samOpen, owner_id: s.id['dana'], due_at: '2027-01-05T10:00:00Z', text: 'Ring them', kind: 'step' });
      const onNothing = await post('dana', 'follow_ups', { deal_id: 999999, owner_id: s.id['dana'], due_at: '2027-01-05T10:00:00Z', text: 'Ring them', kind: 'step' });
      t('17 a rep cannot hang a follow-up on a colleague\'s deal, and is told what a missing deal is told', [onSams.statusCode >= 400, onSams.body.replace(/"requestId":"[^"]*"/, '').replaceAll(String(samOpen), 'K')], [true, onNothing.body.replace(/"requestId":"[^"]*"/, '').replaceAll('999999', 'K')]);
      t('18 a rep does not give a new deal to somebody else', refused(await post('dana', 'deals', { name: 'For Sam', company_id: company, stage_id: stage, owner_id: s.id['sam'], typed_amount: 1 })), '403');
      t('19 a rep does not type a kept figure', refused(await patch('dana', 'deals', danaOpen, { weighted_value: 1 })), '403');
      t('20 a rep does not delete a deal', refused(await del('dana', 'deals', danaOpen)), '403');
      // A quote 9 % under list on Dana's deal: she asks, she cannot approve, it does not go unapproved; Ivy approves; it goes.
      // The list price is the price list's (ruling F): the manager writes it, a rep reads it and types none.
      const listed = await post('ivy', 'price_list', { name: 'Stacking chair', list_rate: 100 });
      t('20a the manager writes the price list; a rep reads it and writes none of it', [said(listed), (await get('dana', 'price_list', `/${String(made(listed))}`)).statusCode, refused(await post('dana', 'price_list', { name: 'My own price', list_rate: 1 })), refused(await patch('dana', 'price_list', made(listed), { list_rate: 1 }))], ['ok', 200, '403', '403']);
      // F20, who writes the price list: the manager and the CRM admin add, reprice and retire a line; the admin alone removes one; a price is never below nothing; Read-only reads; who has no business with prices reads none.
      const unlist = (person: string, key: number) => s.app.inject({ method: 'DELETE', url: url('price_list', `/${String(key)}?confirm=true`), headers: { cookie: who(person) } });
      const desk = await post('tessa', 'price_list', { name: 'Bench desk (F20)', list_rate: 480 });
      t('20c the price list: who reprices, retires and removes a line', [
        said(desk), said(await patch('ivy', 'price_list', made(desk), { list_rate: 495.5 })), said(await patch('ivy', 'price_list', made(desk), { active: false })),
        refused(await patch('ivy', 'price_list', made(desk), { list_rate: -1 })), refused(await post('tessa', 'price_list', { name: 'Free chair', list_rate: -5 })),
        refused(await unlist('ivy', made(desk))), refused(await unlist('dana', made(desk))), refused(await unlist('grace', made(desk))),
        (await get('grace', 'price_list', `/${String(made(desk))}`)).statusCode, refused(await patch('grace', 'price_list', made(desk), { list_rate: 1 })), refused(await post('grace', 'price_list', { name: 'Read-only price', list_rate: 1 })),
        ...(await Promise.all(['hugo', 'lena', 'corin'].map(async (person) => (await get(person, 'price_list', '?limit=5')).statusCode))),
        Number((await one(`SELECT list_rate FROM ${s.real('price_list')} WHERE id = ${String(made(desk))}`))['list_rate']),
        said(await unlist('tessa', made(desk))), (await get('ivy', 'price_list', `/${String(made(desk))}`)).statusCode,
      ], ['ok', 'ok', 'ok', '422', '422', '403', '403', '403', 200, '403', '403', 403, 403, 403, 495.5, 'ok', 404]);
      const quote = made(await post('dana', 'quotes', { deal_id: danaOpen, sent_to_contact_id: Number((await one(`SELECT id FROM ${s.real('contacts')} WHERE email IS NOT NULL ORDER BY id`))['id']) }));
      t('20b a rep does not type a line\'s list price', refused(await post('dana', 'quote_lines', { document_id: quote, qty: 10, rate: 91, list_rate: 91 })), '403');
      const line = made(await post('dana', 'quote_lines', { document_id: quote, qty: 10, rate: 91, price_id: made(listed) }));
      t('20c the line takes the list price of the row it names', Number((await one(`SELECT list_rate FROM ${s.real('quote_lines')} WHERE id = ${String(line)}`))['list_rate']), 100);
      t('21 a rep does not send a quote under list unapproved', (await patch('dana', 'quotes', quote, { status: 'sent' })).statusCode >= 400, true);
      t('22 a rep does not approve their own discount', refused(await patch('dana', 'quotes', quote, { approval: 'approved' })), '403');
      t('23 a rep asks; a colleague cannot see the quote; the manager approves; it is sent', [
        said(await patch('dana', 'quotes', quote, { approval: 'asked', ask_reason: 'Another supplier is cheaper' })),
        (await get('sam', 'quotes', `/${String(quote)}`)).statusCode,
        said(await patch('ivy', 'quotes', quote, { approval: 'approved' })),
        // Cut to half after the approval: it no longer covers the quote, and the send is refused; put back, it goes.
        said(await patch('dana', 'quote_lines', line, { rate: 50 })),
        (await patch('dana', 'quotes', quote, { status: 'sent' })).statusCode >= 400,
        said(await patch('dana', 'quote_lines', line, { rate: 91 })),
        said(await patch('dana', 'quotes', quote, { status: 'sent' })),
      ], ['ok', 404, 'ok', 'ok', true, 'ok', 'ok']);
      t('23a nobody types what an approval covered: not the rep, not the manager', [refused(await post('dana', 'quotes', { deal_id: danaOpen, approved_pct: 99 })), refused(await post('ivy', 'quotes', { deal_id: danaOpen, approved_pct: 99 }))], ['403', '403']);
      const danaWonJob = (await ids(`SELECT j.id FROM ${s.real('jobs')} j JOIN ${s.real('deals')} d ON d.id = j.deal_id WHERE d.owner_id = '${s.id['dana']!}'`))[0];
      const otherJob = (await ids(`SELECT j.id FROM ${s.real('jobs')} j JOIN ${s.real('deals')} d ON d.id = j.deal_id WHERE d.owner_id <> '${s.id['dana']!}'`))[0];
      if (danaWonJob !== undefined) {
        t('24 a rep reads the job of their own won deal and changes nothing of it', [(await get('dana', 'jobs', `/${String(danaWonJob)}`)).statusCode, refused(await patch('dana', 'jobs', danaWonJob, { access_note: 'x' }))], [200, '403']);
      }
      if (otherJob !== undefined) await gone('dana', 'jobs', otherJob);
      const starter = (await get('dana', 'starters', '?limit=1')).json() as { data: Record<string, unknown>[] };
      t('25 a rep reads a starter\'s name and day, nothing else', Object.keys(starter.data[0] ?? {}).filter((column) => !column.startsWith('_')).sort(), ['id', 'manager_id', 'name', 'starts_on', 'user_id']);
      const step = (await ids(`SELECT id FROM ${s.real('starter_steps')}`))[0]!;
      t('26 a rep ticks a starter\'s step and does not reword it', [said(await patch('dana', 'starter_steps', step, { done: true })), refused(await patch('dana', 'starter_steps', step, { text: 'Skip this' }))], ['ok', '403']);
      t('27 a rep does not change a setting', refused(await patch('dana', 'settings', 1, { approval_threshold_pct: 90 })), '403');

      // ── Account manager (Hugo) ───────────────────────────────────────────────
      t('28 the account manager reads deals only once they are won', await keys('hugo', 'deals'), won);
      await gone('hugo', 'deals', danaOpen);
      t('29 the account manager reads no activity and no quote', [String(await keys('hugo', 'activities')).slice(0, 3), String(await keys('hugo', 'quotes')).slice(0, 3)], ['403', '403']);
      t('30 the account manager writes a renewal', said(await post('hugo', 'renewals', { company_id: company, kind: 'reorder', title: 'Service plan', due_on: '2027-03-01' })), 'ok');

      // ── Marketer (Lena) ──────────────────────────────────────────────────────
      const contact = (await get('lena', 'contacts', '?limit=1')).json() as { data: Record<string, unknown>[] };
      t('31 the marketer reads contacts with the address and phone masked', [contact.data[0]?.['email'] ?? null, contact.data[0]?.['phone'] ?? null].map((value) => (value === null ? 'masked' : /\*|•|…/.test(String(value)) ? 'masked' : 'shown')), ['masked', 'masked']);
      t('32 the marketer reads no deal, quote or follow-up', ['deals', 'quotes', 'follow_ups'].map(async (ref) => String(await keys('lena', ref)).slice(0, 3)), ['403', '403', '403']);
      const enquiry = await post('lena', 'enquiries', { source: 'form', company_name: 'Quay Dental', person: 'A. Reed', warmth: 'warm' });
      t('33 the marketer writes an enquiry in and cannot claim it', [said(enquiry), refused(await patch('lena', 'enquiries', enquiry.statusCode < 300 ? made(enquiry) : 1, { state: 'claimed' }))], ['ok', '403']);

      // ── Front desk (Corin) ───────────────────────────────────────────────────
      t('34 the front desk makes a contact for a visitor and reads no deal', [said(await post('corin', 'contacts', { company_id: company, name: 'Walk-in visitor', may_email: false })), String(await keys('corin', 'deals')).slice(0, 3)], ['ok', '403']);
      const space = (await ids(`SELECT id FROM ${s.real('showroom_spaces')}`))[0]!;
      t('35 the front desk books the showroom', said(await post('corin', 'showroom_bookings', { space_id: space, party: 2, starts_at: '2027-02-02T10:00:00Z', minutes: 60, visitor_name: 'Walk-in visitor' })), 'ok');
      const free = (await ids(`SELECT id FROM ${s.real('enquiries')} WHERE state = 'open' AND claimed_by_id IS NULL AND passed_to_id IS NULL`))[0]!;
      t('36 the front desk does not tie an enquiry to a deal', refused(await patch('corin', 'enquiries', free, { deal_id: danaOpen })), '403');

      // ── Operations manager (Ada) ─────────────────────────────────────────────
      t('37 the operations manager reads no deal, company or contact', ['deals', 'companies', 'contacts'].map(async (ref) => String(await keys('ada', ref)).slice(0, 3)), ['403', '403', '403']);
      t('38 sending a time sheet back needs a note, and is hers alone', [
        (await patch('ada', 'time_sheets', sheet, { state: 'sent-back' })).statusCode >= 400,
        refused(await patch('f_yusuf', 'time_sheets', sheet, { state: 'sent-back', sent_back_note: 'Mine' })).replace('404', '403'),
        said(await patch('ada', 'time_sheets', sheet, { state: 'sent-back', sent_back_note: 'Tuesday looks short' })),
      ], [true, '403', 'ok']);
      const hoursLine = (await ids(`SELECT id FROM ${s.real('time_sheet_lines')}`))[0]!;
      t('39 the operations manager does not change a line of hours', refused(await patch('ada', 'time_sheet_lines', hoursLine, { hours: 1 })), '403');

      // ── Field crew (Yusuf leads Blue; Rina leads Red) ────────────────────────
      const crewOf = async (person: string) => Number((await one(`SELECT crew_id FROM ${s.real('crew_members')} WHERE user_id = '${s.id[person]!}'`))['crew_id']);
      const blue = await crewOf('f_yusuf');
      const red = await crewOf('rina');
      const blueVisits = await ids(`SELECT id FROM ${s.real('job_visits')} WHERE crew_id = ${String(blue)}`);
      const redVisits = await ids(`SELECT id FROM ${s.real('job_visits')} WHERE crew_id = ${String(red)}`);
      t('40 a fitter reads their crew\'s visits', await keys('f_yusuf', 'job_visits'), blueVisits);
      await gone('f_yusuf', 'job_visits', redVisits[0]);
      t('41 a fitter ticks "arrived", and does not move the day', [said(await patch('f_yusuf', 'job_visits', blueVisits[0], { tick_arrived: true })), refused(await patch('f_yusuf', 'job_visits', blueVisits[0], { day: '2027-01-01' }))], ['ok', '403']);
      t('42 a fitter reads no job, company or deal', ['jobs', 'companies', 'deals'].map(async (ref) => String(await keys('f_yusuf', ref)).slice(0, 3)), ['403', '403', '403']);
      const yusufSheets = await ids(`SELECT id FROM ${s.real('time_sheets')} WHERE user_id = '${s.id['f_yusuf']!}'`);
      const calSheet = (await ids(`SELECT id FROM ${s.real('time_sheets')} WHERE user_id = '${s.id['cal']!}'`))[0];
      t('43 a fitter reads their own time sheet', await keys('f_yusuf', 'time_sheets'), yusufSheets);
      if (calSheet !== undefined) await gone('f_yusuf', 'time_sheets', calSheet);
      t('44 a fitter reads their own certificates', await keys('f_yusuf', 'certificates'), await ids(`SELECT id FROM ${s.real('certificates')} WHERE user_id = '${s.id['f_yusuf']!}'`));
      const blueSnag = (await ids(`SELECT id FROM ${s.real('snags')} WHERE crew_id = ${String(blue)}`))[0];
      if (blueSnag !== undefined) t('45 a fitter does not change whether a snag stops sign-off', refused(await patch('f_yusuf', 'snags', blueSnag, { stops_sign_off: false })), '403');

      // ── Read-only (Grace) ────────────────────────────────────────────────────
      t('46 Read-only reads every deal and writes none', [await keys('grace', 'deals'), refused(await post('grace', 'deals', { name: 'x', company_id: company, stage_id: stage })), refused(await patch('grace', 'deals', danaOpen, { name: 'x' }))], [[...all, noorDeal].sort((a, b) => a - b), '403', '403']);
      t('47 Read-only reads no action and no message', [String(await keys('grace', 'actions')).slice(0, 3), String(await keys('grace', 'messages')).slice(0, 3)], ['403', '403']);

      const settled: [string, unknown, unknown][] = [];
      for (const [label, got, want] of R) settled.push([label, Array.isArray(got) ? await Promise.all(got) : await got, want]);
      const wrong = settled.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want)).map(([label, got, want]) => `${label}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
      expect(wrong.join('\n')).toBe('');
      void sams;
      void yes;
    }, 300_000);

    it('cover reaches a colleague\'s deals between its two days and not after; a helper reaches a deal and its quotes', async () => {
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const leos = await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['leo']!}'`);
      const priyas = await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['priya']!}'`);
      expect(leos.length).toBeGreaterThan(0);
      expect(await keys('priya', 'deals')).toEqual(priyas);
      // Ivy has Priya cover Leo from two days ago to two days on.
      const cover = await post('ivy', 'covers', { owner_id: s.id['leo'], cover_id: s.id['priya'], starts_on: day(-2), ends_on: day(2) });
      expect(said(cover)).toBe('ok');
      expect(await keys('priya', 'deals')).toEqual([...priyas, ...leos].sort((x, y) => x - y));
      // She works one of them, and it stays Leo's.
      const open = (await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['leo']!}' AND state = 'open'`))[0];
      if (open !== undefined) {
        expect(said(await post('priya', 'follow_ups', { deal_id: open, owner_id: s.id['priya'], due_at: `${day(3)}T10:00:00Z`, text: 'Ring while Leo is away', kind: 'step' }))).toBe('ok');
        expect(String((await one(`SELECT owner_id FROM ${s.real('deals')} WHERE id = ${String(open)}`))['owner_id'])).toBe(s.id['leo']);
      }
      // The cover ended three days ago: the deals are not there for her any more. (Three, not two: a later test covers Leo
      // again from two days ago, and since F17 two covers of one person may not share a day.)
      expect(said(await patch('ivy', 'covers', made(cover), { starts_on: day(-9), ends_on: day(-3) }))).toBe('ok');
      expect(await keys('priya', 'deals')).toEqual(priyas);
      await gone('priya', 'deals', leos[0]);

      // A helper: Dana adds Leo to a deal of hers that has a quote. He reads the deal and its quotes; the amount stays in Dana's figures.
      const quoted = await one(`SELECT d.id, d.amount FROM ${s.real('deals')} d WHERE d.owner_id = '${s.id['dana']!}' AND d.quoted_amount IS NOT NULL ORDER BY d.id`);
      const quotes = await ids(`SELECT id FROM ${s.real('quotes')} WHERE deal_id = ${String(quoted['id'])}`);
      await gone('leo', 'deals', quoted['id']);
      await gone('leo', 'quotes', quotes[0]);
      const helper = await post('dana', 'deal_members', { deal_id: quoted['id'], user_id: s.id['leo'] });
      expect(said(helper)).toBe('ok');
      expect((await get('leo', 'deals', `/${String(quoted['id'])}`)).statusCode).toBe(200);
      expect((await keys('leo', 'quotes')) as number[]).toEqual(expect.arrayContaining(quotes));
      expect(String((await one(`SELECT owner_id FROM ${s.real('deals')} WHERE id = ${String(quoted['id'])}`))['owner_id'])).toBe(s.id['dana']);
      // Taken off again, it is gone for him.
      expect(said(await del('dana', 'deal_members', made(helper)))).toBe('ok');
      await gone('leo', 'deals', quoted['id']);
    });

    it('F14: who adds somebody to a deal, who brings a list in, who keeps the stages, and what three columns show', async () => {
      const R: [string, unknown, unknown][] = [];
      const t = (label: string, got: unknown, want: unknown) => R.push([label, got, want]);
      const refused = (res: Reply) => said(res).slice(0, 3);
      const reason = (res: Reply): unknown => (res.json() as { error?: { details?: { reason?: unknown; fields?: Record<string, { code?: unknown }> } } }).error?.details;
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const count = async (ref: string): Promise<number> => Number((await one(`SELECT COUNT(*) AS n FROM ${s.real(ref)}`))['n']);

      // ── A DEAL'S PEOPLE ──────────────────────────────────────────────────────
      const danas = (await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['dana']!}' AND state = 'open'`))[0]!;
      const leos = (await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['leo']!}' AND state = 'open'`))[0]!;
      const before = await count('deal_members');
      // The owner adds a colleague; the row says whose deal it is on without being told.
      const helper = await post('dana', 'deal_members', { deal_id: danas, user_id: s.id['sam'] });
      t('1 the owner adds a colleague to her deal', said(helper), 'ok');
      t('1 the row is the deal\'s owner\'s', String((await one(`SELECT deal_owner_id FROM ${s.real('deal_members')} WHERE id = ${String(made(helper))}`))['deal_owner_id']), s.id['dana']);
      // Sam now helps on it: he reads it, and lists nobody on it, himself included.
      t('2 the helper reads the deal', (await get('sam', 'deals', `/${String(danas)}`)).statusCode, 200);
      const byHelper = await post('sam', 'deal_members', { deal_id: danas, user_id: s.id['leo'] });
      t('2 a helper adds nobody', [refused(byHelper), (reason(byHelper) as { reason?: unknown }).reason], ['403', 'parent-not-theirs']);
      t('2 a helper removes nobody', (await del('sam', 'deal_members', made(helper))).statusCode >= 400, true);
      t('2 the helper reads who is on the deal', ((await keys('sam', 'deal_members')) as number[]).includes(made(helper)), true);
      t('2 a rep who is not on it reads nobody on it', ((await keys('leo', 'deal_members')) as number[]).includes(made(helper)), false);
      t('2 nobody says who added a row, or since when', (await post('dana', 'deal_members', { deal_id: danas, user_id: s.id['leo'], added_by_id: s.id['sam'] })).statusCode >= 400, true);
      t('2 a helper moves no row to a deal of his own', (await patch('sam', 'deal_members', made(helper), { user_id: s.id['leo'] })).statusCode >= 400, true);
      // Priya covers Leo from two days ago: his deals are on her desk, and she adds nobody to one, herself included.
      const cover = await post('ivy', 'covers', { owner_id: s.id['leo'], cover_id: s.id['priya'], starts_on: day(-2), ends_on: day(2), note: 'Leo is at the hospital' });
      t('3 the manager writes the cover', said(cover), 'ok');
      t('3 the covering rep reads the deal', (await get('priya', 'deals', `/${String(leos)}`)).statusCode, 200);
      for (const person of ['priya', 'dana']) {
        const byCover = await post('priya', 'deal_members', { deal_id: leos, user_id: s.id[person] });
        t(`3 the covering rep does not add ${person}`, [refused(byCover), (reason(byCover) as { reason?: unknown }).reason], ['403', 'parent-not-theirs']);
      }
      // Whoever leads the owner adds and removes; the owner removes what the manager added.
      const byLead = await post('ivy', 'deal_members', { deal_id: danas, user_id: s.id['leo'] });
      t('4 who leads the owner adds a colleague', said(byLead), 'ok');
      t('4 the owner removes whoever was added, by anybody', said(await del('dana', 'deal_members', made(byLead))), 'ok');
      // Noor is a rep of another team: the manager reaches no deal of hers.
      const noors = made(await post('noor', 'deals', { name: 'Noor: a deal of the West', company_id: (await one(`SELECT company_id FROM ${s.real('deals')} WHERE id = ${String(danas)}`))['company_id'], stage_id: (await ids(`SELECT id FROM ${s.real('stages')} ORDER BY position`))[0], owner_id: s.id['noor'], typed_amount: '100.00' }));
      t('4 a manager adds nobody to a deal of a rep she does not lead', (await post('ivy', 'deal_members', { deal_id: noors, user_id: s.id['dana'] })).statusCode >= 400, true);
      // Nobody is listed who could not open a deal: not by the owner, not by the CRM admin, not by the install's owner.
      for (const [writer, deal] of [['dana', danas], ['tessa', danas], ['owner', danas]] as const) {
        for (const person of ['lena', 'corin', 'ada', 'cal']) {
          const listed = await post(writer, 'deal_members', { deal_id: deal, user_id: s.id[person] });
          t(`5 ${writer} does not list ${person}, who reads no deal`, [refused(listed), (reason(listed) as { fields?: Record<string, { code?: unknown }> }).fields?.['user_id']?.code], ['422', 'cannot-open']);
        }
      }
      // The same for cover: whoever covers reads deals.
      const badCover = await post('tessa', 'covers', { owner_id: s.id['sam'], cover_id: s.id['corin'], starts_on: '2027-02-01', ends_on: '2027-02-05' });
      t('5 the front desk covers for nobody', [refused(badCover), (reason(badCover) as { fields?: Record<string, { code?: unknown }> }).fields?.['cover_id']?.code], ['422', 'cannot-open']);
      // The account manager reads deals (the won ones): he may be listed, and reads no open deal for it (R6, until T37).
      const hugo = await post('dana', 'deal_members', { deal_id: danas, user_id: s.id['hugo'] });
      t('6 the account manager may be listed', said(hugo), 'ok');
      await gone('hugo', 'deals', danas);
      await del('dana', 'deal_members', made(hugo));
      await del('dana', 'deal_members', made(helper));
      t('7 the listing is as it was', await count('deal_members'), before);

      // ── WHY SOMEBODY IS AWAY ─────────────────────────────────────────────────
      const coverRow = async (person: string) => ((await get(person, 'covers', `/${String(made(cover))}`)).json() as { data: Record<string, unknown> }).data;
      for (const person of ['ivy', 'tessa']) t(`8 ${person} reads why`, (await coverRow(person))['note'], 'Leo is at the hospital');
      for (const person of ['priya', 'dana', 'hugo', 'grace']) {
        const row = await coverRow(person);
        t(`8 ${person} reads who and when`, [String(row['cover_id']), 'note' in row], [s.id['priya'], false]);
      }
      t('8 the cover is taken away again', said(await del('ivy', 'covers', made(cover))), 'ok');
      await gone('priya', 'deals', leos);

      // ── A QUOTE'S LINK CODE ──────────────────────────────────────────────────
      const quote = await one(`SELECT q.id, q.share_code FROM ${s.real('quotes')} q JOIN ${s.real('deals')} d ON d.id = q.deal_id WHERE d.owner_id = '${s.id['dana']!}' ORDER BY q.id`);
      const quoteRow = async (person: string) => ((await get(person, 'quotes', `/${String(quote['id'])}`)).json() as { data: Record<string, unknown> }).data;
      t('9 the sample quote has a code', String(quote['share_code']).length >= 16, true);
      // The code is the customer's own link (F16): nobody on the staff reads it, the rep who owns the quote and the install's owner included.
      for (const person of ['dana', 'ivy', 'tessa', 'owner']) t(`9 ${person} reads the quote and not its code`, ['number' in (await quoteRow(person)), 'share_code' in (await quoteRow(person))], [true, false]);
      const graces = await quoteRow('grace');
      t('9 Read-only reads the quote and not its code', ['number' in graces, 'share_code' in graces], [true, false]);
      const listed = (await get('grace', 'quotes', '?limit=200')).body;
      t('9 no list of hers holds a code', listed.includes(String(quote['share_code'])), false);
      // Every other door she has onto a quote: none of them holds a code of any quote.
      const codes = (await s.rows(`SELECT share_code FROM ${s.real('quotes')} WHERE share_code IS NOT NULL`)).map((row) => String(row['share_code']));
      const doors: [string, string][] = [
        ['a list that asks for the column', (await get('grace', 'quotes', '?limit=200&select=id,share_code')).body],
        ['a list in the code\'s order', (await get('grace', 'quotes', '?limit=200&order=share_code.asc')).body],
        ['a search', (await get('grace', 'quotes', `?q=${encodeURIComponent(String(quote['share_code']).slice(0, 8))}`)).body],
        ['a line that looks its quote\'s code up', (await get('grace', 'quote_lines', `?limit=200&lookup=${encodeURIComponent('code:document_id.share_code')}`)).body],
        ['the quote\'s history', (await get('grace', 'quotes', `/${String(quote['id'])}/history?limit=100`)).body],
        ['a figure grouped by the code', (await s.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie: who('grace') }, payload: { descriptor: { connectionId: s.connectionId, source: { name: s.t('quotes') }, shape: 'table', groupBy: ['share_code'], aggregations: [{ fn: 'count', alias: 'n' }] } } })).body],
      ];
      const asked = await s.app.inject({ method: 'POST', url: '/api/v1/exports', headers: { cookie: who('grace') }, payload: { connectionId: s.connectionId, source: { kind: 'table', table: s.t('quotes') }, format: 'csv' } });
      t('9 Read-only may take the quotes out as a file', asked.statusCode, 202);
      await s.jobs();
      const exported = await s.app.inject({ method: 'GET', url: `/api/v1/exports/${String((asked.json() as { data: { id: unknown } }).data.id)}/download`, headers: { cookie: who('grace') } });
      t('9 the file comes', exported.statusCode, 200);
      doors.push(['her file of the quotes', exported.body]);
      t('9 the file names the quote', exported.body.includes(String((await one(`SELECT number FROM ${s.real('quotes')} WHERE id = ${String(quote['id'])}`))['number'])), true);
      t('9 no door of hers holds a code', doors.filter(([, body]) => codes.some((code) => body.includes(code))).map(([door]) => door), []);
      t('9 she finds no quote by its code', ((await get('grace', 'quotes', `?where=${encodeURIComponent(JSON.stringify({ column: 'share_code', op: 'eq', value: quote['share_code'] }))}`)).json() as { data?: unknown[] }).data?.length ?? 0, 0);

      // ── THE STAGES AND THE REASONS A DEAL IS LOST FOR ────────────────────────
      const position = Number((await one(`SELECT MAX(position) AS p FROM ${s.real('stages')}`))['p']) + 1;
      const stage = await post('ivy', 'stages', { label: 'Legal review', odds: '0.60', position });
      t('10 the sales manager adds a stage', said(stage), 'ok');
      t('10 and renames it', said(await patch('ivy', 'stages', made(stage), { label: 'With legal' })), 'ok');
      t('10 and does not take one away', refused(await del('ivy', 'stages', made(stage))), '403');
      t('10 a rep adds none', refused(await post('dana', 'stages', { label: 'Mine', odds: '0.10', position: position + 1 })), '403');
      const why = await post('ivy', 'lost_reasons', { label: 'Went quiet', position: 99 });
      t('10 the sales manager adds a reason', said(why), 'ok');
      t('10 a rep changes none', refused(await patch('dana', 'lost_reasons', made(why), { label: 'Mine' })), '403');
      t('10 the CRM admin takes both away', [said(await del('tessa', 'stages', made(stage))), said(await del('tessa', 'lost_reasons', made(why)))], ['ok', 'ok']);

      // ── THE MARKETER'S COUNT ─────────────────────────────────────────────────
      const marks = (await get('lena', 'deal_marks', '?limit=200')).json() as { data: Record<string, unknown>[] };
      t('11 the marketer reads a mark per deal', marks.data.length, await count('deal_marks'));
      // A link is always shown, so she also reads the number of the deal, of its stage and of its main contact (whom she reads anyway); she reads no stage's name (she holds nothing on `stages`).
      t('11 each says which company and whether it is open: no owner, no title, no amount', [...new Set(marks.data.flatMap((row) => Object.keys(row)))].filter((key) => !key.startsWith('_')).sort(), ['company_id', 'contact_id', 'deal_id', 'id', 'stage_id', 'state']);
      t('11 she reads no stage', refused(await get('lena', 'stages', '?limit=5')), '403');
      t('11 she opens no deal', refused(await get('lena', 'deals', `/${String(danas)}`)), '403');
      t('11 she writes no mark', refused(await patch('lena', 'deal_marks', marks.data[0]!['id'], { state: 'won' })), '403');

      // ── AN ENQUIRY TAKEN AT THE DESK ─────────────────────────────────────────
      const enquiry = await post('corin', 'enquiries', { source: 'phone', company_name: 'Walk-in: Tide Mill Bakery', person: 'Ana', phone: '0117 496 0000', text: 'Rang about a counter' });
      t('12 the front desk types an enquiry in', said(enquiry), 'ok');
      t('12 a rep finds it in the inbox', ((await keys('dana', 'enquiries')) as number[]).includes(made(enquiry)), true);
      t('12 the operations manager types none', refused(await post('ada', 'enquiries', { source: 'phone', company_name: 'No' })), '403');

      // ── A LIST BROUGHT IN ────────────────────────────────────────────────────
      const upload = (person: string, text: string) => s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=pasted.csv', headers: { cookie: who(person), 'content-type': 'text/csv' }, payload: text });
      const ready = (person: string, fileId: string, ref: string, columns: { from: string; to: string }[], options: Record<string, unknown>) =>
        s.app.inject({ method: 'POST', url: '/api/v1/imports', headers: { cookie: who(person) }, payload: { fileId, connectionId: s.connectionId, table: s.t(ref), mapping: { columns }, options } });
      const fileOf = (res: Reply): string => (res.json() as { data: { fileId?: string; id?: string } }).data.fileId ?? (res.json() as { data: { id: string } }).data.id;
      const companies = 'Name\tTown\nF14 Kiln Street Pottery\tLeeds\n';
      const nameTown = [{ from: 'Name', to: 'name' }, { from: 'Town', to: 'town' }];
      for (const person of ['dana', 'ivy', 'tessa']) {
        const made = await ready(person, fileOf(await upload(person, companies)), 'companies', nameTown, { mode: 'skip', matchColumn: 'name' });
        t(`13 ${person} may bring companies in`, made.statusCode < 300, true);
      }
      for (const person of ['hugo', 'lena', 'corin', 'grace', 'ada', 'cal']) {
        const up = await upload(person, companies);
        const made = up.statusCode >= 300 ? up : await ready(person, fileOf(up), 'companies', nameTown, { mode: 'skip', matchColumn: 'name' });
        t(`13 ${person} brings no company in`, refused(made), '403');
      }
      const leads = 'Company\tPerson\nF14 Harbour Stoves\tKit\n';
      const lead = [{ from: 'Company', to: 'company_name' }, { from: 'Person', to: 'person' }];
      const hers = await upload('lena', leads);
      t('13 the marketer may bring enquiries in', hers.statusCode >= 300 ? said(hers) : (await ready('lena', fileOf(hers), 'enquiries', lead, { mode: 'insert' })).statusCode < 300, true);
      const his = await upload('dana', leads);
      t('13 a rep brings no enquiries in', refused(his.statusCode >= 300 ? his : await ready('dana', fileOf(his), 'enquiries', lead, { mode: 'insert' })), '403');
      t('13 nothing was written by a list that was only made ready', Number((await one(`SELECT COUNT(*) AS n FROM ${s.real('companies')} WHERE name LIKE 'F14 %'`))['n']), 0);

      expect(R.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want)).map(([label, got, want]) => `${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)).toEqual([]);
      expect(R.length).toBeGreaterThan(60);
    });

    it('the buttons, pressed as the role: a deal lost, reopened and handed over; an approval and a send-back kept for their role', async () => {
      const press = (person: string, ref: string, key: unknown, action: string, from: string, values?: Record<string, unknown>) =>
        s.app.inject({ method: 'POST', url: url(ref, `/${String(key)}/actions/${action}`), headers: { cookie: who(person) }, payload: { from, ...(values === undefined ? {} : { values }) } });
      const stage = (await ids(`SELECT id FROM ${s.real('stages')}`))[0]!;
      const company = (await ids(`SELECT id FROM ${s.real('companies')}`))[0]!;
      const reason = (await ids(`SELECT id FROM ${s.real('lost_reasons')}`))[0]!;
      const deal = made(await post('leo', 'deals', { name: 'Leo: breakout chairs', company_id: company, stage_id: stage, owner_id: s.id['leo'], typed_amount: 4000 }));
      const now = async () => one(`SELECT state, closed_at, lost_reason_id, close_note, owner_id, name FROM ${s.real('deals')} WHERE id = ${String(deal)}`);
      // Lost needs its reason.
      expect((await press('leo', 'deals', deal, 'mark-lost', 'open')).statusCode).toBeGreaterThanOrEqual(400);
      expect((await now())['state']).toBe('open');
      expect(said(await press('leo', 'deals', deal, 'mark-lost', 'open', { lost_reason_id: reason, close_note: 'Went with the incumbent' }))).toBe('ok');
      let d = await now();
      expect([d['state'], d['closed_at'] !== null, Number(d['lost_reason_id'])]).toEqual(['lost', true, reason]);
      // Closed is locked, but for its closing note.
      expect((await patch('leo', 'deals', deal, { name: 'Renamed after the fact' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await patch('leo', 'deals', deal, { stage_id: stage, typed_amount: 1 })).statusCode).toBeGreaterThanOrEqual(400);
      expect(said(await patch('leo', 'deals', deal, { close_note: 'They may come back in the spring' }))).toBe('ok');
      // Reopening is a move back: a bare write of "open" that does not say what it saw is refused; the button says it.
      expect((await patch('leo', 'deals', deal, { state: 'open' })).statusCode).toBeGreaterThanOrEqual(400);
      expect(said(await press('leo', 'deals', deal, 'reopen', 'lost'))).toBe('ok');
      d = await now();
      expect([d['state'], d['closed_at'], d['lost_reason_id'], d['name']]).toEqual(['open', null, null, 'Leo: breakout chairs']);
      // Handed over: a rep may not write another owner on a deal, and the button that is marked a hand-over may.
      expect((await patch('leo', 'deals', deal, { owner_id: s.id['sam'] })).statusCode).toBe(403);
      expect(said(await press('leo', 'deals', deal, 'hand-over', 'open', { owner_id: s.id['sam'] }))).toBe('ok');
      expect(String((await now())['owner_id'])).toBe(s.id['sam']);
      await gone('leo', 'deals', deal);
      expect((await get('sam', 'deals', `/${String(deal)}`)).statusCode).toBe(200);
      // Won, by its new owner: stamped, and locked.
      expect(said(await press('sam', 'deals', deal, 'mark-won', 'open', { close_note: 'Signed on the day' }))).toBe('ok');
      expect([(await now())['state'], (await now())['closed_at'] !== null]).toEqual(['won', true]);
      expect((await press('sam', 'deals', deal, 'hand-over', 'won', { owner_id: s.id['leo'] })).statusCode).toBeGreaterThanOrEqual(400);

      // The approval's buttons: a rep presses "Ask", and neither "Approve" nor "Refuse"; the Sales manager presses both.
      const priced = made(await post('ivy', 'price_list', { name: 'Coat stand', list_rate: 200 }));
      const mine = made(await post('priya', 'deals', { name: 'Priya: coat stands', company_id: company, stage_id: stage, owner_id: s.id['priya'], typed_amount: 1500 }));
      const quote = made(await post('priya', 'quotes', { deal_id: mine, sent_to_contact_id: Number((await one(`SELECT id FROM ${s.real('contacts')} WHERE email IS NOT NULL ORDER BY id`))['id']) }));
      expect(said(await post('priya', 'quote_lines', { document_id: quote, qty: 10, rate: 150, price_id: priced }))).toBe('ok');
      expect((await press('priya', 'quotes', quote, 'approve', 'draft', { decision_note: 'Fine by me' })).statusCode).toBe(403);
      expect((await press('priya', 'quotes', quote, 'refuse', 'draft', { decision_note: 'No' })).statusCode).toBe(403);
      expect(said(await press('priya', 'quotes', quote, 'ask-approval', 'draft', { ask_reason: 'A long-standing customer' }))).toBe('ok');
      expect(said(await press('ivy', 'quotes', quote, 'refuse', 'draft', { decision_note: 'Too far under' }))).toBe('ok');
      const q = await one(`SELECT approval, may_send, asked_by_id, decided_by_id FROM ${s.real('quotes')} WHERE id = ${String(quote)}`);
      expect([q['approval'], Number(q['may_send']), q['asked_by_id'], q['decided_by_id']]).toEqual(['refused', 0, s.id['priya'], s.id['ivy']]);

      // A time sheet: its fitter sends it; signing it off and sending it back are the Operations manager's buttons.
      const sheet = made(await post('cal', 'time_sheets', { user_id: s.id['cal'], week_of: '2027-03-01' }));
      expect(said(await press('cal', 'time_sheets', sheet, 'send', 'open'))).toBe('ok');
      expect((await press('cal', 'time_sheets', sheet, 'sign-off', 'sent')).statusCode).toBeGreaterThanOrEqual(400);
      expect((await press('ada', 'time_sheets', sheet, 'send-back', 'sent')).statusCode).toBeGreaterThanOrEqual(400);
      expect(said(await press('ada', 'time_sheets', sheet, 'send-back', 'sent', { sent_back_note: 'Thursday is missing' }))).toBe('ok');
      expect(said(await press('cal', 'time_sheets', sheet, 'send', 'sent-back'))).toBe('ok');
      expect(said(await press('ada', 'time_sheets', sheet, 'sign-off', 'sent'))).toBe('ok');
      expect((await one(`SELECT state, signed_by_id FROM ${s.real('time_sheets')} WHERE id = ${String(sheet)}`))).toMatchObject({ state: 'signed-off', signed_by_id: s.id['ada'] });
    });

    it('an export file holds the rows its asker reaches, and a masked column stays masked in it', async () => {
      const asked = (person: string, ref: string) => s.app.inject({ method: 'POST', url: '/api/v1/exports', headers: { cookie: who(person) }, payload: { connectionId: s.connectionId, source: { kind: 'table', table: s.t(ref) }, format: 'csv' } });
      const file = async (person: string, ref: string): Promise<string> => {
        const requested = await asked(person, ref);
        expect(requested.statusCode, `${person} ${ref}: ${requested.body}`).toBe(202);
        await s.jobs();
        const got = await s.app.inject({ method: 'GET', url: `/api/v1/exports/${String((requested.json() as { data: { id: unknown } }).data.id)}/download`, headers: { cookie: who(person) } });
        expect(got.statusCode, got.body).toBe(200);
        return got.body;
      };
      // Every deal by its name (read as nobody); a name two deals share proves nothing and is left out.
      const deals = await s.rows(`SELECT name, owner_id FROM ${s.real('deals')}`);
      const once = deals.filter((deal) => deals.filter((other) => other['name'] === deal['name']).length === 1);
      expect(once.length).toBeGreaterThan(30);
      const team = new Set(['ivy', 'dana', 'priya', 'sam', 'leo'].map((person) => s.id[person]!));
      const outside = once.filter((deal) => !team.has(String(deal['owner_id'])));
      expect(outside.length, 'a deal outside the manager\'s team exists (Noor\'s, made by the tries)').toBeGreaterThan(0);
      const names = (body: string) => once.filter((deal) => body.includes(String(deal['name']))).map((deal) => String(deal['name'])).sort();
      // The Sales manager's file: her team's deals, and none of another team's.
      expect(names(await file('ivy', 'deals'))).toEqual(once.filter((deal) => team.has(String(deal['owner_id']))).map((deal) => String(deal['name'])).sort());
      // The CRM admin's and Read-only's: every deal.
      expect(names(await file('tessa', 'deals'))).toHaveLength(once.length);
      expect(names(await file('grace', 'deals'))).toHaveLength(once.length);
      // Nobody else exports: a rep (who reads their deals), the account manager, the marketer, the front desk.
      const refusals: Record<string, string> = {};
      for (const [person, ref] of [['dana', 'deals'], ['hugo', 'companies'], ['lena', 'contacts'], ['corin', 'contacts'], ['ivy', 'quotes'], ['ada', 'jobs'], ['tessa', 'one_to_ones'], ['ivy', 'one_to_ones']] as const) refusals[`${person} ${ref}`] = said(await asked(person, ref)).slice(0, 3);
      expect(refusals).toEqual({ 'dana deals': '403', 'hugo companies': '403', 'lena contacts': '403', 'corin contacts': '403', 'ivy quotes': '403', 'ada jobs': '403', 'tessa one_to_ones': '403', 'ivy one_to_ones': '403' });
      // A contact's address and phone: whole in the CRM admin's file, in none of Read-only's lines.
      const contacts = (await s.rows(`SELECT name, email, phone FROM ${s.real('contacts')} WHERE email IS NOT NULL`)).map((row) => ({ name: String(row['name']), email: String(row['email']), phone: row['phone'] === null ? null : String(row['phone']) }));
      expect(contacts.length).toBeGreaterThan(5);
      const whole = await file('tessa', 'contacts');
      const masked = await file('grace', 'contacts');
      for (const contact of contacts) {
        expect(whole, contact.email).toContain(contact.email);
        expect(masked, `Read-only's file names ${contact.name}`).toContain(contact.name);
        expect(masked, `Read-only's file holds ${contact.email}`).not.toContain(contact.email);
        if (contact.phone !== null) expect(masked, `Read-only's file holds ${contact.phone}`).not.toContain(contact.phone);
      }
    }, 120_000);

    it('the shipped rules run by themselves, and a sent quote is queued for the contact it was sent to', async () => {
      const press = (person: string, ref: string, key: unknown, action: string, from: string, values?: Record<string, unknown>) =>
        s.app.inject({ method: 'POST', url: url(ref, `/${String(key)}/actions/${action}`), headers: { cookie: who(person) }, payload: { from, ...(values === undefined ? {} : { values }) } });
      const stages = await ids(`SELECT id FROM ${s.real('stages')} ORDER BY position`);
      const contact = await one(`SELECT id, company_id, email, name FROM ${s.real('contacts')} WHERE email IS NOT NULL ORDER BY id`);
      const count = async (table: string, where: string) => Number((await one(`SELECT COUNT(*) AS n FROM ${s.real(table)} WHERE ${where}`))['n']);
      await s.jobs();

      // A deal made: its mark (carrying its owner and stage) and the first line of its history.
      const deal = made(await post('dana', 'deals', { name: 'Dana: rule check', company_id: contact['company_id'], contact_id: contact['id'], stage_id: stages[0], owner_id: s.id['dana'], typed_amount: 6000 }));
      await s.jobs();
      const mark = await one(`SELECT owner_id, stage_id, state FROM ${s.real('deal_marks')} WHERE deal_id = ${String(deal)}`);
      expect(mark, 'the rule "deal-made" made no mark').toBeDefined();
      expect([mark['owner_id'], Number(mark['stage_id']), mark['state']]).toEqual([s.id['dana'], stages[0], 'open']);
      expect(await count('deal_stage_changes', `deal_id = ${String(deal)} AND to_stage_id = ${String(stages[0])}`)).toBe(1);
      // It changes stage: one more line. A change of anything else writes none.
      expect(said(await patch('dana', 'deals', deal, { stage_id: stages[1] }))).toBe('ok');
      expect(said(await patch('dana', 'deals', deal, { typed_amount: 6500 }))).toBe('ok');
      await s.jobs();
      expect(await count('deal_stage_changes', `deal_id = ${String(deal)}`)).toBe(2);
      expect(await count('deal_stage_changes', `deal_id = ${String(deal)} AND to_stage_id = ${String(stages[1])}`)).toBe(1);

      // A quote on it, at list, sent to the contact: one mail waits in the outbox, for the address kept on the quote.
      const priced = made(await post('ivy', 'price_list', { name: 'Rule check item', list_rate: 300 }));
      const quote = made(await post('dana', 'quotes', { deal_id: deal, sent_to_contact_id: contact['id'] }));
      expect(said(await post('dana', 'quote_lines', { document_id: quote, qty: 2, rate: 300, price_id: priced }))).toBe('ok');
      // A line of a draft is taken out by the rep whose deal it is, and by nobody who does not reach the deal.
      const del = (person: string, ref: string, key: unknown) => s.app.inject({ method: 'DELETE', url: url(ref, `/${String(key)}?confirm=true`), headers: { cookie: who(person) } });
      const spare = made(await post('dana', 'quote_lines', { document_id: quote, qty: 1, rate: 300, price_id: priced }));
      expect((await del('sam', 'quote_lines', spare)).statusCode, 'Sam removes a line of Dana\'s quote').toBeGreaterThanOrEqual(403);
      expect((await del('grace', 'quote_lines', spare)).statusCode, 'Read-only removes a line').toBe(403);
      expect((await del('dana', 'quote_lines', spare)).statusCode, 'Dana removes a line of her draft').toBeLessThan(300);
      expect(await count('quote_lines', `document_id = ${String(quote)}`)).toBe(1);
      // Not sent yet: it shows where it will go, and says nothing of where it went.
      expect((await one(`SELECT to_email, to_name, sent_to_email, sent_to_name FROM ${s.real('quotes')} WHERE id = ${String(quote)}`))).toMatchObject({ to_email: contact['email'], to_name: contact['name'], sent_to_email: null, sent_to_name: null });
      expect(await count('outbox', `quote_id = ${String(quote)}`)).toBe(0);
      // A rep may not type who accepted (the customer's own page does), and so cannot accept under a name of her choosing.
      expect(said(await patch('dana', 'quotes', quote, { accepted_name: 'A name she made up' }))).not.toBe('ok');
      expect(said(await patch('dana', 'quotes', quote, { status: 'sent' }))).toBe('ok');
      await s.jobs();
      // Sent: the address it went to is stamped, and the deal's history has its amount line (600 before tax, from this quote).
      expect((await one(`SELECT sent_to_email, sent_to_name FROM ${s.real('quotes')} WHERE id = ${String(quote)}`))).toMatchObject({ sent_to_email: contact['email'], sent_to_name: contact['name'] });
      const lines = await s.rows(`SELECT quote_id, amount FROM ${s.real('deal_amount_changes')} WHERE deal_id = ${String(deal)}`);
      expect(lines.map((row) => [Number(row['quote_id']), Number(row['amount'])])).toEqual([[quote, 600]]);
      // Sent: its lines are kept. Nobody takes one out, the rep and the CRM admin included.
      const keptLine = Number((await one(`SELECT id FROM ${s.real('quote_lines')} WHERE document_id = ${String(quote)}`))['id']);
      for (const person of ['dana', 'ivy', 'tessa']) expect((await del(person, 'quote_lines', keptLine)).statusCode, `${person} removes a line of a sent quote`).toBeGreaterThanOrEqual(400);
      expect(await count('quote_lines', `document_id = ${String(quote)}`)).toBe(1);
      // Dana reads the line of her own deal; a rep whose deal it is not reads none, and nobody writes one by hand.
      const seenBy = async (person: string) => ((await get(person, 'deal_amount_changes', '?limit=200')).json() as { data: { quote_id: number }[] }).data.map((row) => Number(row.quote_id));
      expect(await seenBy('dana')).toContain(quote);
      expect(await seenBy('sam')).not.toContain(quote);
      expect(await seenBy('ivy')).toContain(quote);
      // Nobody writes, changes or removes a line by hand: not the rep, not her manager, not the CRM admin.
      const line = Number((await one(`SELECT id FROM ${s.real('deal_amount_changes')} WHERE quote_id = ${String(quote)}`))['id']);
      for (const person of ['dana', 'ivy', 'tessa']) {
        expect((await post(person, 'deal_amount_changes', { deal_id: deal, quote_id: quote, amount: 1 })).statusCode, `${person} makes one`).toBe(403);
        expect((await patch(person, 'deal_amount_changes', line, { amount: 1 })).statusCode, `${person} changes one`).toBe(403);
        expect((await s.app.inject({ method: 'DELETE', url: url('deal_amount_changes', `/${String(line)}?confirm=true`), headers: { cookie: who(person) } })).statusCode, `${person} removes one`).toBe(403);
      }
      expect(Number((await one(`SELECT amount FROM ${s.real('deal_amount_changes')} WHERE id = ${String(line)}`))['amount'])).toBe(600);
      // Nobody on the staff types who accepted, on a draft, a new quote or a sent one: not the rep, not her manager, not the CRM admin.
      for (const person of ['dana', 'ivy', 'tessa']) {
        expect(said(await patch(person, 'quotes', quote, { accepted_name: 'A name' })), `${person}, on the sent quote`).not.toBe('ok');
        expect(said(await post(person, 'quotes', { deal_id: deal, accepted_name: 'A name' })), `${person}, on a new quote`).not.toBe('ok');
      }
      expect((await one(`SELECT accepted_name FROM ${s.real('quotes')} WHERE id = ${String(quote)}`))['accepted_name']).toBeNull();
      // A quote does not change deals, and a version may not name a quote its writer cannot open.
      const sams = await one(`SELECT q.id, q.deal_id FROM ${s.real('quotes')} q JOIN ${s.real('deals')} d ON d.id = q.deal_id WHERE d.owner_id = '${s.id['sam']!}' ORDER BY q.id`);
      expect(sams, 'the sample has a quote of Sam\'s').toBeDefined();
      expect(said(await patch('dana', 'quotes', quote, { deal_id: sams['deal_id'] })), 'Dana moves her quote to Sam\'s deal').not.toBe('ok');
      expect(said(await post('dana', 'quotes', { deal_id: deal, version: 9, replaces_id: sams['id'] })), 'Dana names Sam\'s quote as the one hers replaces').not.toBe('ok');
      expect((await one(`SELECT status FROM ${s.real('quotes')} WHERE id = ${String(sams['id'])}`))['status']).not.toBe('withdrawn');
      const mail = await s.rows(`SELECT kind, status, ${dialect === 'mysql' ? '`to`' : '"to"'} AS sent_to, error FROM ${s.real('outbox')} WHERE quote_id = ${String(quote)}`);
      expect(mail.map((row) => [row['kind'], row['sent_to']])).toEqual([['quote-sent', contact['email']]]);
      // Read-only reads the quote with the address masked, as on the contact.
      const asGrace = ((await get('grace', 'quotes', `/${String(quote)}`)).json() as { data: Record<string, unknown> }).data;
      expect(asGrace['sent_to_email']).not.toBe(contact['email']);
      expect(asGrace['to_email']).not.toBe(contact['email']);
      // The contact's address changes afterwards: the record of where the quote went does not.
      // Dana may not move it (decision 117: where a quote and its link are mailed); the manager may.
      expect((await patch('dana', 'contacts', contact['id'], { email: 'moved@elsewhere.example' })).statusCode).toBe(403);
      expect(said(await patch('ivy', 'contacts', contact['id'], { email: 'moved@elsewhere.example' }))).toBe('ok');
      expect((await one(`SELECT to_email, sent_to_email FROM ${s.real('quotes')} WHERE id = ${String(quote)}`))).toMatchObject({ to_email: 'moved@elsewhere.example', sent_to_email: contact['email'] });
      expect(said(await patch('ivy', 'contacts', contact['id'], { email: contact['email'] }))).toBe('ok');

      // A discount put to approval: the asker's team lead is told; never the asker, never another team's manager; the CRM
      // admin when nobody leads the asker (the ruling of §0, decision 136; the engine's `lead` and `else` on a notice).
      const second = made(await post('dana', 'quotes', { deal_id: deal, version: 2, replaces_id: quote }));
      expect(said(await post('dana', 'quote_lines', { document_id: second, qty: 2, rate: 200, price_id: priced }))).toBe('ok');
      type Told = { title: string; body: string | null };
      const toldOf = async (person: string): Promise<Told[]> => (await s.meta.db.selectFrom('adminium_notifications').select(['title', 'body']).where('userId', '=', s.id[person]!).where('title', 'like', '%needs your approval').execute()) as Told[];
      // A second sales manager, Omar, leads West (Noor's team): made here, for this rule, and taken off his team and role at the end.
      const users = usersRepo(s.meta);
      const omar = await users.create({ email: 'omar@crm.test', name: 'Omar Said', passwordHash: await adminPasswordHash() });
      const managerRole = (await rolesRepo(s.meta).findBySlug('crm-sales-manager'))!;
      await rolesRepo(s.meta).assignToUser(omar.id, managerRole.id);
      const west = (await teamsRepo(s.meta).findByName('West'))!;
      await teamsRepo(s.meta).setMember(west.id, omar.id, true);
      s.id['omar'] = omar.id;
      const before = Object.fromEntries(await Promise.all(['dana', 'ivy', 'tessa', 'omar', 'noor', 'grace'].map(async (person) => [person, (await toldOf(person)).length] as const)));
      const grown = async (): Promise<Record<string, number>> => Object.fromEntries(await Promise.all(Object.entries(before).map(async ([person, was]) => [person, (await toldOf(person)).length - was] as const)));

      // Dana asks: Ivy leads her, and is told who asked; Dana is not; Omar, who leads another team, is not, nor the CRM admin.
      expect(said(await press('dana', 'quotes', second, 'ask-approval', 'draft', { ask_reason: 'They buy every year' }))).toBe('ok');
      await s.jobs();
      expect(await grown()).toEqual({ dana: 0, ivy: 1, tessa: 0, omar: 0, noor: 0, grace: 0 });
      const [ivys] = (await toldOf('ivy')).slice(-1);
      expect(ivys!.body).toContain('Dana Whitlock');
      expect(ivys!.body).toContain('They buy every year');

      // Noor asks: Omar leads her, and is told; Ivy is not (she cannot open Noor's quote, and is not her lead).
      const noorsDeal = made(await post('noor', 'deals', { name: 'Noor: her discount', company_id: contact['company_id'], stage_id: stages[0], owner_id: s.id['noor'], typed_amount: 800 }));
      const noors = made(await post('noor', 'quotes', { deal_id: noorsDeal }));
      expect(said(await post('noor', 'quote_lines', { document_id: noors, qty: 2, rate: 150, price_id: priced }))).toBe('ok');
      expect(said(await press('noor', 'quotes', noors, 'ask-approval', 'draft', { ask_reason: 'A first order' }))).toBe('ok');
      await s.jobs();
      expect(await grown()).toEqual({ dana: 0, ivy: 1, tessa: 0, omar: 1, noor: 0, grace: 0 });

      // Ivy asks about her own deal: she leads her team and nobody leads her, so the CRM admin is told; Ivy never is.
      const hers = made(await post('ivy', 'deals', { name: 'Ivy: her own discount', company_id: contact['company_id'], stage_id: stages[0], owner_id: s.id['ivy'], typed_amount: 900 }));
      const own = made(await post('ivy', 'quotes', { deal_id: hers }));
      expect(said(await post('ivy', 'quote_lines', { document_id: own, qty: 2, rate: 150, price_id: priced }))).toBe('ok');
      expect(said(await press('ivy', 'quotes', own, 'ask-approval', 'draft', { ask_reason: 'A long-standing customer' }))).toBe('ok');
      await s.jobs();
      expect(await grown()).toEqual({ dana: 0, ivy: 1, tessa: 1, omar: 1, noor: 0, grace: 0 });
      expect((await toldOf('tessa')).slice(-1)[0]!.body).toContain('Ivy Sandoval');

      // Omar leaves West: Noor is led by nobody, and her next request goes to the CRM admin, not to Ivy, not to Omar.
      await teamsRepo(s.meta).removeMember(west.id, omar.id);
      await rolesRepo(s.meta).removeFromUser(omar.id, managerRole.id);
      const laterDeal = made(await post('noor', 'deals', { name: 'Noor: a later discount', company_id: contact['company_id'], stage_id: stages[0], owner_id: s.id['noor'], typed_amount: 700 }));
      const again = made(await post('noor', 'quotes', { deal_id: laterDeal }));
      expect(said(await post('noor', 'quote_lines', { document_id: again, qty: 2, rate: 140, price_id: priced }))).toBe('ok');
      expect(said(await press('noor', 'quotes', again, 'ask-approval', 'draft', { ask_reason: 'Still a first order' }))).toBe('ok');
      await s.jobs();
      expect(await grown()).toEqual({ dana: 0, ivy: 1, tessa: 2, omar: 1, noor: 0, grace: 0 });

      // The deal is won: its job is made, once, named after the deal; won again after a reopen, no second job.
      expect(said(await press('dana', 'deals', deal, 'mark-won', 'open', { close_note: 'Signed' }))).toBe('ok');
      await s.jobs();
      const job = await s.rows(`SELECT site_name, title, state FROM ${s.real('jobs')} WHERE deal_id = ${String(deal)}`);
      expect(job).toHaveLength(1);
      expect(job[0]).toMatchObject({ site_name: 'Dana: rule check', title: 'Dana: rule check', state: 'open' });
      expect(said(await press('dana', 'deals', deal, 'reopen', 'won'))).toBe('ok');
      expect(said(await press('dana', 'deals', deal, 'mark-won', 'open'))).toBe('ok');
      await s.jobs();
      expect(await count('jobs', `deal_id = ${String(deal)}`)).toBe(1);
    }, 120_000);

    it('P00: a save sent again after a lost reply answers the row the first one made', async () => {
      const R: [string, unknown, unknown][] = [];
      const t = (label: string, got: unknown, want: unknown) => R.push([label, got, want]);
      const send = (person: string, ref: string, values: Record<string, unknown>, clientKey: string) => s.app.inject({ method: 'POST', url: url(ref), headers: { cookie: who(person) }, payload: { values, clientKey } });
      const count = async (ref: string, where: string): Promise<number> => Number((await one(`SELECT COUNT(*) AS n FROM ${s.real(ref)} WHERE ${where}`))['n']);
      const key = (label: string) => `${label}-${randomBytes(12).toString('hex')}`;
      const stage = (await ids(`SELECT id FROM ${s.real('stages')} ORDER BY position`))[0];
      const company = (await ids(`SELECT id FROM ${s.real('companies')}`))[0];

      // A rep's deal: her role names the columns a new row may be given, and the key is not one of them.
      const dealKey = key('deal');
      const deal = { name: 'P00: sent twice', company_id: company, stage_id: stage, owner_id: s.id['dana'], typed_amount: '900.00' };
      const first = await send('dana', 'deals', deal, dealKey);
      t('1 the first save makes the row', first.statusCode, 201);
      const again = await send('dana', 'deals', deal, dealKey);
      t('1 the same save again answers that row', [again.statusCode, (again.json() as { replayed?: unknown }).replayed, made(again)], [200, true, made(first)]);
      t('1 one row, not two', await count('deals', `name = 'P00: sent twice'`), 1);
      // The key is one person's: a colleague who happens to send the same letters makes a row of her own.
      const sams = await send('sam', 'deals', { ...deal, owner_id: s.id['sam'] }, dealKey);
      t('2 the same letters from somebody else are another save', [sams.statusCode, made(sams) !== made(first)], [201, true]);
      // A key that is no key is refused, and nothing is written.
      const bad = await send('dana', 'deals', { ...deal, name: 'P00: bad key' }, 'short');
      t('3 a key too short is refused', said(bad).slice(0, 3), '422');
      t('3 and nothing was written', await count('deals', `name = 'P00: bad key'`), 0);
      // The other roles that type rows in: the front desk and the marketer (an enquiry), the manager (a cover), the crew (a snag).
      for (const person of ['corin', 'lena']) {
        const k = key(person);
        const values = { source: 'phone', company_name: `P00: ${person}` };
        const one_ = await send(person, 'enquiries', values, k);
        const two = await send(person, 'enquiries', values, k);
        t(`4 ${person}: an enquiry sent twice is one enquiry`, [one_.statusCode, two.statusCode, await count('enquiries', `company_name = 'P00: ${person}'`)], [201, 200, 1]);
      }
      // Nobody reads the kept key back as they sent it: the column holds a hash.
      const kept = String((await one(`SELECT retry_key FROM ${s.real('deals')} WHERE id = ${String(made(first))}`))['retry_key']);
      t('5 the column holds a hash, not the key', [kept.length, kept === dealKey], [43, false]);
      await s.rows(`DELETE FROM ${s.real('deal_marks')} WHERE deal_id IN (SELECT id FROM ${s.real('deals')} WHERE name LIKE 'P00:%')`).catch(() => undefined);

      expect(R.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want)).map(([label, got, want]) => `${label}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)).toEqual([]);
    });

    describe('the three holes the engine had, each closed', () => {
      it('E1, CLOSED: a link into a table the writer cannot read names a row that is theirs, or none', async () => {
        // The operations manager reads no deal, so she names none: a job is made by the rule when its deal is won.
        const deal = await one(`SELECT d.id FROM ${s.real('deals')} d WHERE d.state = 'open' AND NOT EXISTS (SELECT 1 FROM ${s.real('jobs')} j WHERE j.deal_id = d.id) ORDER BY d.id`);
        expect(String(await keys('ada', 'deals')).slice(0, 3)).toBe('403');
        expect((await post('ada', 'jobs', { deal_id: deal['id'], site_name: 'Anywhere' })).statusCode).toBe(403);
        // Two visits she books: one for Red crew on any job, one for Blue on the job that is not signed off yet.
        const crewOf = async (person: string) => Number((await one(`SELECT crew_id FROM ${s.real('crew_members')} WHERE user_id = '${s.id[person]!}'`))['crew_id']);
        const [red, blue] = [await crewOf('rina'), await crewOf('f_yusuf')];
        const unsigned = Number((await one(`SELECT j.id FROM ${s.real('jobs')} j WHERE NOT EXISTS (SELECT 1 FROM ${s.real('sign_offs')} o WHERE o.job_id = j.id) ORDER BY j.id`))['id']);
        const other = Number((await one(`SELECT id FROM ${s.real('jobs')} WHERE id <> ${String(unsigned)} ORDER BY id`))['id']);
        const redVisit = await post('ada', 'job_visits', { job_id: other, kind: 'return', what: 'Red crew goes back', day: '2027-02-01', crew_id: red });
        const blueVisit = await post('ada', 'job_visits', { job_id: unsigned, kind: 'install', what: 'Blue crew fits it', day: '2027-02-02', crew_id: blue });
        expect([said(redVisit), said(blueVisit)]).toEqual(['ok', 'ok']);
        await gone('f_yusuf', 'job_visits', made(redVisit));
        const blocking = async (job: number) => Number((await one(`SELECT blocking_snags FROM ${s.real('jobs')} WHERE id = ${String(job)}`))['blocking_snags']);
        const before = await blocking(other);
        const ticks = { check_1: true, check_2: true, check_3: true, check_4: true, check_5: true, signer_name: 'Somebody', signature: 'file_x' };
        // A fitter of Blue names no job himself (he reads none), and no visit of Red's: neither a sign-off nor a snag lands on Red's job.
        expect((await post('f_yusuf', 'sign_offs', { job_id: other, ...ticks })).statusCode).toBe(403);
        expect((await post('f_yusuf', 'snags', { job_id: other, text: 'Made up', stops_sign_off: true })).statusCode).toBe(403);
        const refused = await post('f_yusuf', 'snags', { visit_id: made(redVisit), text: 'Made up', stops_sign_off: true });
        const nowhere = await post('f_yusuf', 'snags', { visit_id: 999999, text: 'Made up', stops_sign_off: true });
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.body.replace(/"requestId":"[^"]*"/, '').replaceAll(String(made(redVisit)), 'K')).toBe(nowhere.body.replace(/"requestId":"[^"]*"/, '').replaceAll('999999', 'K'));
        expect((await post('f_yusuf', 'sign_offs', { visit_id: made(redVisit), ...ticks })).statusCode).toBe(409);
        expect(await blocking(other)).toBe(before);
        // His own crew's visit: he signs it off and raises a snag on it, and each finds its job through the visit.
        const snag = await post('f_yusuf', 'snags', { visit_id: made(blueVisit), text: 'A scuffed panel', stops_sign_off: false });
        expect(said(snag), snag.body).toBe('ok');
        expect(Number((await one(`SELECT job_id FROM ${s.real('snags')} WHERE id = ${String(made(snag))}`))['job_id'])).toBe(unsigned);
        const signOff = await post('f_yusuf', 'sign_offs', { visit_id: made(blueVisit), ...ticks });
        expect(said(signOff), signOff.body).toBe('ok');
        expect(Number((await one(`SELECT job_id FROM ${s.real('sign_offs')} WHERE id = ${String(made(signOff))}`))['job_id'])).toBe(unsigned);
        // Hours against a visit of one's crew find their job; against Red's visit they are refused. Cal is Blue too; his
        // sheet is sent, so the operations manager sends it back first, and then its lines are his to write.
        const sheet = Number((await one(`SELECT id FROM ${s.real('time_sheets')} WHERE user_id = '${s.id['cal']!}' AND state = 'sent' ORDER BY id`))['id']);
        expect(said(await patch('ada', 'time_sheets', sheet, { state: 'sent-back', sent_back_note: 'Add the Tuesday' }))).toBe('ok');
        const hours = { sheet_id: sheet, day: '2027-02-02', what: 'Fitting', hours: 4, travel_hours: 1 };
        const line = await post('cal', 'time_sheet_lines', { ...hours, visit_id: made(blueVisit) });
        expect(said(line), line.body).toBe('ok');
        expect(Number((await one(`SELECT job_id FROM ${s.real('time_sheet_lines')} WHERE id = ${String(made(line))}`))['job_id'])).toBe(unsigned);
        expect((await post('cal', 'time_sheet_lines', { ...hours, visit_id: made(redVisit) })).statusCode).toBe(409);
        expect((await post('cal', 'time_sheet_lines', { ...hours, job_id: other })).statusCode).toBe(403);
      });

      it('E2, CLOSED: a helper works on a deal and does not take it, and a note is its writer\'s to change', async () => {
        // Dana adds Priya as a helper on one of her deals. Priya reads it and works on it, and cannot make herself its owner.
        const deal = (await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['dana']!}' AND state = 'open' ORDER BY id DESC`))[0]!;
        expect((await get('priya', 'deals', `/${String(deal)}`)).statusCode).toBe(404);
        expect(said(await post('dana', 'deal_members', { deal_id: deal, user_id: s.id['priya'] }))).toBe('ok');
        expect((await get('priya', 'deals', `/${String(deal)}`)).statusCode).toBe(200);
        expect(said(await patch('priya', 'deals', deal, { scope: 'Desks for the second floor too' }))).toBe('ok');
        const taken = await patch('priya', 'deals', deal, { owner_id: s.id['priya'] });
        expect(taken.statusCode, taken.body).toBe(403);
        expect(taken.body).toContain('not-theirs-to-give');
        expect(String((await one(`SELECT owner_id FROM ${s.real('deals')} WHERE id = ${String(deal)}`))['owner_id'])).toBe(s.id['dana']);
        // Sam is made a helper on a deal of Dana's that holds a note: he reads the note, writes one of his own, and
        // changes his own; Dana's is hers to change, and his is not hers.
        const noted = await one(`SELECT a.id, a.deal_id, a.text FROM ${s.real('activities')} a JOIN ${s.real('deals')} d ON d.id = a.deal_id WHERE d.owner_id = '${s.id['dana']!}' AND a.author_id = '${s.id['dana']!}' ORDER BY a.id`);
        expect(said(await post('dana', 'deal_members', { deal_id: noted['deal_id'], user_id: s.id['sam'] }))).toBe('ok');
        expect((await get('sam', 'activities', `/${String(noted['id'])}`)).statusCode).toBe(200);
        expect((await patch('sam', 'activities', noted['id'], { text: 'Rewritten by a helper' })).statusCode).toBeGreaterThanOrEqual(400);
        expect((await one(`SELECT text FROM ${s.real('activities')} WHERE id = ${String(noted['id'])}`))['text']).toBe(noted['text']);
        const his = await post('sam', 'activities', { deal_id: noted['deal_id'], kind: 'note', text: 'Sam looked at the floor plan' });
        expect(said(his), his.body).toBe('ok');
        expect(said(await patch('sam', 'activities', made(his), { text: 'Sam looked at the floor plan, twice' }))).toBe('ok');
        expect((await patch('dana', 'activities', made(his), { text: 'Rewritten by the owner' })).statusCode).toBeGreaterThanOrEqual(400);
        expect(said(await patch('dana', 'activities', noted['id'], { text: String(noted['text']) }))).toBe('ok');
        // Their manager leads them both, and changes either.
        expect(said(await patch('ivy', 'activities', made(his), { text: 'Sam looked at the floor plan (noted by Ivy)' }))).toBe('ok');
      });

      it('E3, CLOSED: a new row is somebody\'s, unless its writer\'s reach includes the rows nobody owns', async () => {
        // A rep changes and deletes only their own views: one that is nobody's is not theirs to make.
        const loose = await post('dana', 'saved_views', { name: 'Everybody\'s board', filters: {} });
        expect(loose.statusCode, loose.body).toBe(422);
        expect(loose.body).toContain('"owner_id":{"code":"required"}');
        const hers = await post('dana', 'saved_views', { name: 'Dana\'s board', filters: {}, owner_id: s.id['dana'] });
        expect(said(hers), hers.body).toBe('ok');
        expect(said(await del('dana', 'saved_views', made(hers)))).toBe('ok');
        // The Sales manager's reach includes the views nobody owns: she makes a shared one, every rep sees it, and only
        // she or the CRM admin takes it away.
        const shared = await post('ivy', 'saved_views', { name: 'The team\'s board', filters: {} });
        expect(said(shared), shared.body).toBe('ok');
        expect((await one(`SELECT owner_id FROM ${s.real('saved_views')} WHERE id = ${String(made(shared))}`))['owner_id']).toBeNull();
        expect(await keys('sam', 'saved_views')).toContain(made(shared));
        expect((await del('sam', 'saved_views', made(shared))).statusCode).toBeGreaterThanOrEqual(400);
        expect(said(await del('tessa', 'saved_views', made(shared)))).toBe('ok');
        // A deal must name its owner, and a rep may name only themselves.
        const company = (await ids(`SELECT id FROM ${s.real('companies')}`))[0]!;
        const stage = (await ids(`SELECT id FROM ${s.real('stages')}`))[0]!;
        expect((await post('dana', 'deals', { name: 'Nobody\'s deal', company_id: company, stage_id: stage, typed_amount: 5000 })).statusCode).toBeGreaterThanOrEqual(400);
        expect(await ids(`SELECT id FROM ${s.real('deals')} WHERE owner_id IS NULL`)).toEqual([]);
      });
    });
  });
}
