/**
 * Plan 67, F16: the customer's door. Somebody with no account opens ONE quote by the code of its
 * own link, reads the quote's own figures and nothing of the business's side, and answers it once:
 * Accept (with a name) or Decline, while it is still in date. Against the whole server, on SQLite,
 * Postgres and MySQL, with the app installed through its routes and its sample in.
 *
 * To run: `npm run proofs -- customer` (copied into the engine's `apps/server/test/`, run, removed).
 * Its harness is the roles proof's, with the public API switched on and the app's keys read back.
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
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, manifestsRepo, publicKeysRepo, rolesRepo, settingsRepo, snapshotsRepo, teamsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { openPublishableKey } from '../src/public-api/keys.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// The server says the version it was built at (0.3.26 until the release); the app's floor is the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const ORIGIN = 'https://quotes.example.com';
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
  const name = `crm_customer_${randomBytes(4).toString('hex')}`;
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
  /** The app's browser keys as the install made them, by name: what a page sends as its key. */
  token: Record<string, string>;
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
  const dataDir = await mkdtemp(join(tmpdir(), 'crm-customer-'));
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
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir, ADMINIUM_PUBLIC_API_ORIGINS: ORIGIN, ADMINIUM_SECRET: TEST_SECRET }),
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
    'customer/index.html': '<!doctype html><html><body></body></html>',
    'seeds/meridian.json': JSON.stringify(packed),
    'seeds/assets/signature.png': 'png',
  });
  const staged = await app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: owner, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
  expect(staged.statusCode, staged.body).toBe(200);
  const installed = await app.inject({ method: 'POST', url: '/api/v1/apps/install', headers: { cookie: owner }, payload: { key: 'crm', version: document['version'], connectionId: connection.id, addOns: [{ key: 'invoices', version: '1.1.0' }], modules: { quotes: true, inbox: true, showroom: true, jobs: true, aftercare: true, supply: true, fleet: true } } });
  expect(installed.statusCode, installed.body).toBe(200);
  await settingsRepo(meta).set('publicApi.enabled', true);
  const keyIds = ((installed.json() as { publicAccess?: { keys?: Record<string, string> } }).publicAccess?.keys ?? {}) as Record<string, string>;
  const token: Record<string, string> = {};
  for (const [name, keyId] of Object.entries(keyIds)) token[name] = openPublishableKey(dsnCryptoFromSecret(TEST_SECRET), (await publicKeysRepo(meta).findById(keyId))!.tokenEncrypted!);
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
    token,
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

/** Everything a customer may ever read of a quote and of a line (F16's list, and the keys that tie a line to its quote). */
const QUOTE = ['id', 'number', 'version', 'status', 'valid_until', 'currency', 'tax_name', 'tax_rate', 'subtotal', 'tax', 'total', 'notes', 'sent_at', 'decided_at', 'accepted_name'];
const LINE = ['id', 'document_id', 'position', 'description', 'qty', 'rate', 'discount_kind', 'discount', 'currency', 'amount'];

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the customer's door on a quote, on ${dialect}`, () => {
    let s: Stack;
    let refs: { quotes: string; lines: string };
    let item: number;
    let contact: number;
    let deal: number;
    let visitors = 0;
    const who = (person: string) => (person === 'owner' ? s.owner : s.cookie[person]!);
    const url = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const get = (person: string, ref: string, rest = '') => s.app.inject({ method: 'GET', url: url(ref, rest), headers: { cookie: who(person) } });
    const post = (person: string, ref: string, values: Record<string, unknown>) => s.app.inject({ method: 'POST', url: url(ref), headers: { cookie: who(person) }, payload: { values } });
    const patch = (person: string, ref: string, key: unknown, values: Record<string, unknown>) => s.app.inject({ method: 'PATCH', url: url(ref, `/${String(key)}`), headers: { cookie: who(person) }, payload: { values } });
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBeLessThan(300);
      return Number((res.json() as { data: { id: unknown } }).data.id);
    };
    const one = async (statement: string): Promise<Record<string, unknown>> => (await s.rows(statement))[0]!;
    const quoteRow = (id: number) => one(`SELECT * FROM ${s.real('quotes')} WHERE id = ${String(id)}`);
    /** A call as somebody with no account, through a key of the app: each from an address of its own. */
    const pub = (method: 'GET' | 'POST' | 'PATCH', path: string, opts: { key?: string; session?: string; payload?: Record<string, unknown> } = {}) => {
      visitors += 1;
      return s.app.inject({
        method,
        url: `/api/v1/public${path}`,
        remoteAddress: `10.77.${String(Math.floor(visitors / 250))}.${String(visitors % 250)}`,
        headers: { authorization: `Bearer ${s.token[opts.key ?? 'quote']!}`, origin: ORIGIN, ...(opts.session === undefined ? {} : { 'x-adminium-public-session': opts.session }) },
        ...(opts.payload === undefined ? {} : { payload: opts.payload }),
      });
    };
    const open = async (code: string): Promise<string> => {
      const res = await pub('POST', '/claim/token', { payload: { token: code } });
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as { data: { session: string; level: string } }).data;
      expect(data.level).toBe('verified');
      return data.session;
    };
    const listed = async (ref: string, session: string): Promise<Record<string, unknown>[]> => {
      const res = await pub('GET', `/records/${ref}`, { session });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data?: Record<string, unknown>[] } | Record<string, unknown>[];
      return Array.isArray(body) ? body : (body.data ?? []);
    };
    const answer = (id: number, session: string, values: Record<string, unknown>) => pub('PATCH', `/records/${refs.quotes}/${String(id)}`, { session, payload: { values } });
    /** A quote of Dana's at list price (so it needs no approval), with one line, to a contact who has an address. `sent`: taken to the customer. */
    const quoteOf = async (sent = true): Promise<{ id: number; code: string }> => {
      const id = made(await post('dana', 'quotes', { deal_id: deal, sent_to_contact_id: contact }));
      made(await post('dana', 'quote_lines', { document_id: id, qty: 10, rate: 100, price_id: item }));
      if (sent) expect(said(await patch('dana', 'quotes', id, { status: 'sent' }))).toBe('ok');
      return { id, code: String((await quoteRow(id))['share_code']) };
    };

    beforeAll(async () => {
      s = await stack(dialect);
      const config = await pub('GET', '/config');
      expect(config.statusCode, config.body).toBe(200);
      const names = Object.keys(((config.json() as { data?: { refs: Record<string, unknown> }; refs?: Record<string, unknown> }).data ?? (config.json() as { refs: Record<string, unknown> })).refs);
      const named = (real: string) => names.find((ref) => ref === real || ref.startsWith(`${real}_`))!;
      refs = { quotes: named(s.real('quotes')), lines: named(s.real('quote_lines')) };
      item = made(await post('ivy', 'price_list', { name: 'Stacking chair', list_rate: 100 }));
      contact = Number((await one(`SELECT id FROM ${s.real('contacts')} WHERE email IS NOT NULL ORDER BY id`))['id']);
      deal = Number((await one(`SELECT id FROM ${s.real('deals')} WHERE owner_id = '${s.id['dana']!}' AND state = 'open' ORDER BY id`))['id']);
    }, 600_000);
    afterAll(async () => {
      await s?.close();
    });

    it('names on a quote line only a price-list line still offered, for every writer; a line already naming one retired since keeps it', async () => {
      const id = made(await post('dana', 'quotes', { deal_id: deal, sent_to_contact_id: contact }));
      const kept = made(await post('dana', 'quote_lines', { document_id: id, qty: 1, rate: 100, price_id: item }));
      const retired = made(await post('ivy', 'price_list', { name: 'Old bench', list_rate: 40 }));
      expect(said(await patch('ivy', 'price_list', retired, { active: false }))).toBe('ok');
      for (const person of ['dana', 'tessa']) {
        const refused = await post(person, 'quote_lines', { document_id: id, qty: 1, rate: 40, price_id: retired });
        expect(refused.statusCode, `${person}: ${refused.body}`).toBe(422);
        expect(refused.body, person).toContain('not-allowed');
        // …and nothing of the retired line is told back.
        expect(refused.body, person).not.toContain('Old bench');
        expect((await patch(person, 'quote_lines', kept, { price_id: retired })).statusCode, person).toBe(422);
      }
      // Retired after the line named it: the line still changes its quantity.
      expect(said(await patch('ivy', 'price_list', item, { active: false }))).toBe('ok');
      expect(said(await patch('dana', 'quote_lines', kept, { qty: 2 }))).toBe('ok');
      expect(said(await patch('ivy', 'price_list', item, { active: true }))).toBe('ok');
    });

    it('the install makes the quote\'s own key, and that key serves two refs and no other', async () => {
      // The app has nothing for a customer who holds no link, so the install hands back the quote's key alone.
      expect(Object.keys(s.token)).toEqual(['quote']);
      const config = (await pub('GET', '/config')).json() as { data?: { refs: Record<string, unknown> }; refs?: Record<string, unknown> };
      expect(Object.keys((config.data ?? config).refs as Record<string, unknown>).sort()).toEqual([refs.lines, refs.quotes].sort());
    });

    it('a sent quote opens by its code: its own figures and lines, exactly the allowed columns, and never the code', async () => {
      const quote = await quoteOf();
      const session = await open(quote.code);
      const rows = await listed(refs.quotes, session);
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]!).sort()).toEqual([...QUOTE].sort());
      expect(rows[0]).toMatchObject({ id: quote.id, status: 'sent' });
      expect(Number(rows[0]!['total'])).toBe(1000);
      const lines = await listed(refs.lines, session);
      expect(lines).toHaveLength(1);
      expect(Object.keys(lines[0]!).sort()).toEqual([...LINE].sort());
      expect(Number(lines[0]!['amount'])).toBe(1000);
      // Nothing either answer says holds the code, whatever is asked for.
      for (const path of [`/records/${refs.quotes}`, `/records/${refs.quotes}/${String(quote.id)}`, `/records/${refs.lines}`]) expect((await pub('GET', path, { session })).body).not.toContain(quote.code);
      for (const asked of ['?select=id,share_code', '?order=share_code.asc', `?filter[share_code]=${quote.code}`]) {
        const res = await pub('GET', `/records/${refs.quotes}${asked}`, { session });
        expect(res.body, asked).not.toContain(quote.code);
      }
    });

    it('one link opens one quote: no other quote, no line of another, no other table', async () => {
      const mine = await quoteOf();
      const other = await quoteOf();
      const session = await open(mine.code);
      expect((await listed(refs.quotes, session)).map((row) => row['id'])).toEqual([mine.id]);
      expect((await pub('GET', `/records/${refs.quotes}/${String(other.id)}`, { session })).statusCode).toBe(404);
      const lineOfOther = Number((await one(`SELECT id FROM ${s.real('quote_lines')} WHERE document_id = ${String(other.id)}`))['id']);
      expect((await pub('GET', `/records/${refs.lines}/${String(lineOfOther)}`, { session })).statusCode).toBe(404);
      expect((await listed(refs.lines, session)).every((line) => Number(line['document_id']) === mine.id)).toBe(true);
      for (const table of ['deals', 'contacts', 'companies', 'price_list', 'quote_approvals', 'settings']) expect((await pub('GET', `/records/${s.real(table)}`, { session })).statusCode, table).toBe(404);
      // And another quote's answer is not this session's to give.
      expect((await answer(other.id, session, { status: 'declined' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await quoteRow(other.id))['status']).toBe('sent');
    });

    it('no code, a made-up code and no session read nothing', async () => {
      expect((await pub('POST', '/claim/token', { payload: { token: 'AAAAAAAAAAAAAAAA' } })).statusCode).toBe(404);
      expect((await pub('GET', `/records/${refs.quotes}`)).statusCode).toBeGreaterThanOrEqual(400);
      expect((await pub('GET', `/records/${refs.quotes}`, { session: 'not-a-session' })).statusCode).toBeGreaterThanOrEqual(400);
    });

    it('a draft, and a version a newer one replaced, answer nothing of themselves', async () => {
      const draft = await quoteOf(false);
      const first = await pub('POST', '/claim/token', { payload: { token: draft.code } });
      if (first.statusCode === 200) {
        const session = (first.json() as { data: { session: string } }).data.session;
        expect(await listed(refs.quotes, session)).toEqual([]);
        expect(await listed(refs.lines, session)).toEqual([]);
        expect((await answer(draft.id, session, { status: 'accepted', accepted_name: 'Too Early' })).statusCode).toBeGreaterThanOrEqual(400);
      } else expect(first.statusCode).toBe(404);
      expect((await quoteRow(draft.id))['status']).toBe('draft');

      // Version 1 sent and opened; version 2 sent, which withdraws version 1 in the same write.
      const v1 = await quoteOf();
      const held = await open(v1.code);
      expect(await listed(refs.quotes, held)).toHaveLength(1);
      const v2 = made(await post('dana', 'quotes', { deal_id: deal, sent_to_contact_id: contact, version: 2, replaces_id: v1.id }));
      made(await post('dana', 'quote_lines', { document_id: v2, qty: 10, rate: 100, price_id: item }));
      expect(said(await patch('dana', 'quotes', v2, { status: 'sent' }))).toBe('ok');
      expect((await quoteRow(v1.id))['status']).toBe('withdrawn');
      // The session the old link opened, and the old link itself, now reach nothing of either version.
      for (const session of [held, undefined]) {
        const opened = session ?? (await (async () => {
          const again = await pub('POST', '/claim/token', { payload: { token: v1.code } });
          return again.statusCode === 200 ? (again.json() as { data: { session: string } }).data.session : null;
        })());
        if (opened === null) continue;
        const quotes = await pub('GET', `/records/${refs.quotes}`, { session: opened });
        const lines = await pub('GET', `/records/${refs.lines}`, { session: opened });
        for (const res of [quotes, lines]) {
          if (res.statusCode === 200) expect(((res.json() as { data?: unknown[] }).data ?? res.json()) as unknown[]).toEqual([]);
          expect(res.body).not.toContain(String((await quoteRow(v2))['number']));
        }
        expect((await answer(v1.id, opened, { status: 'accepted', accepted_name: 'Old Link' })).statusCode).toBeGreaterThanOrEqual(400);
      }
      expect((await quoteRow(v1.id))['status']).toBe('withdrawn');
      expect((await quoteRow(v1.id))['accepted_name']).toBeNull();
    });

    it('Accept takes a name, is stamped by the server as the customer\'s, and is taken once', async () => {
      const quote = await quoteOf();
      const session = await open(quote.code);
      const res = await answer(quote.id, session, { status: 'accepted', accepted_name: 'Petra Lindqvist' });
      expect(res.statusCode, res.body).toBe(200);
      const row = await quoteRow(quote.id);
      expect([row['status'], row['accepted_name'], row['accepted_via']]).toEqual(['accepted', 'Petra Lindqvist', 'customer']);
      expect(row['decided_at']).not.toBeNull();
      // The page reads it back as accepted, by whom.
      expect((await listed(refs.quotes, session))[0]).toMatchObject({ status: 'accepted', accepted_name: 'Petra Lindqvist' });
      // A second Accept, under another name, and a Decline after the Accept: refused, nothing changed.
      expect((await answer(quote.id, session, { status: 'accepted', accepted_name: 'Somebody Else' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await answer(quote.id, session, { status: 'declined' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await answer(quote.id, session, { accepted_name: 'Renamed Later' })).statusCode).toBeGreaterThanOrEqual(400);
      const after = await quoteRow(quote.id);
      expect([after['status'], after['accepted_name'], String(after['decided_at'])]).toEqual(['accepted', 'Petra Lindqvist', String(row['decided_at'])]);
      // The address the quote went to is told that it was accepted: an acceptance nobody there made does not pass unseen.
      await s.jobs();
      const told = await s.rows(`SELECT * FROM ${s.real('outbox')} WHERE quote_id = ${String(quote.id)} AND kind = 'quote-accepted'`);
      expect(told).toHaveLength(1);
      expect(told[0]!['to']).toBe(row['sent_to_email']);
      // Staff read who accepted and how; nobody on the staff rewrites it.
      const seen = ((await get('dana', 'quotes', `/${String(quote.id)}`)).json() as { data: Record<string, unknown> }).data;
      expect([seen['accepted_name'], seen['accepted_via']]).toEqual(['Petra Lindqvist', 'customer']);
      for (const person of ['dana', 'ivy', 'tessa']) expect((await patch(person, 'quotes', quote.id, { accepted_name: 'Rewritten' })).statusCode, person).toBeGreaterThanOrEqual(400);
      for (const person of ['dana', 'ivy', 'tessa']) expect((await patch(person, 'quotes', quote.id, { accepted_via: 'staff' })).statusCode, person).toBeGreaterThanOrEqual(400);
    });

    it('Accept with no name, a blank name, or a name that is a link is refused; the quote stays open', async () => {
      const quote = await quoteOf();
      const session = await open(quote.code);
      for (const values of [{ status: 'accepted' }, { status: 'accepted', accepted_name: '' }, { status: 'accepted', accepted_name: '   ' }, { status: 'accepted', accepted_name: 'see https://evil.example/pay' }, { status: 'accepted', accepted_name: '<b>Petra</b>' }, { status: 'accepted', accepted_name: 'x'.repeat(121) }]) {
        const res = await answer(quote.id, session, values);
        expect(res.statusCode, JSON.stringify(values)).toBeGreaterThanOrEqual(400);
      }
      const row = await quoteRow(quote.id);
      expect([row['status'], row['accepted_name'], row['accepted_via']]).toEqual(['sent', null, null]);
    });

    it('Decline needs no name and keeps none; Accept after Decline is refused', async () => {
      const quote = await quoteOf();
      const session = await open(quote.code);
      // A name sent with a Decline is not kept under a declined quote.
      const named = await answer(quote.id, session, { status: 'declined', accepted_name: 'Mallory' });
      if (named.statusCode < 300) expect((await quoteRow(quote.id))['accepted_name']).toBeNull();
      else {
        const res = await answer(quote.id, session, { status: 'declined' });
        expect(res.statusCode, res.body).toBe(200);
      }
      const row = await quoteRow(quote.id);
      expect([row['status'], row['accepted_name'], row['accepted_via']]).toEqual(['declined', null, null]);
      expect((await answer(quote.id, session, { status: 'accepted', accepted_name: 'Petra Lindqvist' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await quoteRow(quote.id))['status']).toBe('declined');
    });

    it('the customer writes nothing else: no figure, no day, no note, no other state', async () => {
      const quote = await quoteOf();
      const session = await open(quote.code);
      const before = await quoteRow(quote.id);
      for (const values of [
        { total: 1 }, { subtotal: 1 }, { valid_until: '2099-01-01' }, { notes: 'half price agreed' }, { currency: 'XXX' }, { tax_rate: 0 }, { deal_id: 1 }, { sent_to_email: 'mallory@evil.example' }, { approval: 'approved' },
        { status: 'withdrawn' }, { status: 'draft' }, { status: 'sent' },
        { status: 'accepted', accepted_name: 'Petra Lindqvist', total: 1 }, { status: 'accepted', accepted_name: 'Petra Lindqvist', valid_until: '2099-01-01' }, { status: 'accepted', accepted_name: 'Petra Lindqvist', accepted_via: 'staff' },
      ]) {
        const res = await answer(quote.id, session, values);
        expect(res.statusCode, JSON.stringify(values)).toBeGreaterThanOrEqual(400);
      }
      for (const [method, path] of [['POST', `/records/${refs.quotes}`], ['POST', `/records/${refs.lines}`], ['PATCH', `/records/${refs.lines}/1`]] as const) {
        expect((await pub(method, path, { session, payload: { values: { description: 'free', qty: 1, rate: 0, document_id: quote.id } } })).statusCode, `${method} ${path}`).toBeGreaterThanOrEqual(400);
      }
      const after = await quoteRow(quote.id);
      for (const column of ['status', 'total', 'subtotal', 'valid_until', 'notes', 'currency', 'accepted_name', 'accepted_via', 'sent_to_email']) expect(String(after[column]), column).toBe(String(before[column]));
    });

    it('after its last day the link still opens the quote, and neither answer is taken', async () => {
      const quote = await quoteOf();
      // The day passes (the only clock this proof moves: the quote's own last day, set behind today).
      await s.rows(`UPDATE ${s.real('quotes')} SET valid_until = '2020-01-01' WHERE id = ${String(quote.id)}`);
      const session = await open(quote.code);
      const rows = await listed(refs.quotes, session);
      expect(rows).toHaveLength(1);
      expect(String(rows[0]!['valid_until']).slice(0, 10)).toBe('2020-01-01');
      expect(await listed(refs.lines, session)).toHaveLength(1);
      const late = await answer(quote.id, session, { status: 'accepted', accepted_name: 'Petra Lindqvist' });
      expect([late.statusCode, (late.json() as { error?: { code?: string } }).error?.code]).toEqual([409, 'PUBLIC_TOO_LATE']);
      expect((await answer(quote.id, session, { status: 'declined' })).statusCode).toBe(409);
      const row = await quoteRow(quote.id);
      expect([row['status'], row['accepted_name']]).toEqual(['sent', null]);
    });

    it('the office\'s own late "accepted" is refused too; in date it is stamped as the office\'s, with who, and with no name', async () => {
      const lateOne = await quoteOf();
      await s.rows(`UPDATE ${s.real('quotes')} SET valid_until = '2020-01-01' WHERE id = ${String(lateOne.id)}`);
      for (const person of ['dana', 'ivy', 'tessa']) {
        for (const to of ['accepted', 'declined']) expect(said(await patch(person, 'quotes', lateOne.id, { status: to })), `${person} ${to}`).toBe('409 STATE_DATE_PASSED');
      }
      // Withdrawing a quote that ran out is still the office's to do.
      expect((await quoteRow(lateOne.id))['status']).toBe('sent');
      const rang = await quoteOf();
      expect(said(await patch('dana', 'quotes', rang.id, { status: 'accepted' }))).toBe('ok');
      const row = await quoteRow(rang.id);
      expect([row['status'], row['accepted_via'], row['answered_by_id'], row['accepted_name']]).toEqual(['accepted', 'staff', s.id['dana'], null]);
      // The customer's own answer names nobody on the staff.
      const theirs = await quoteOf();
      expect((await answer(theirs.id, await open(theirs.code), { status: 'declined' })).statusCode).toBe(200);
      expect((await quoteRow(theirs.id))['answered_by_id']).toBeNull();
      // Nobody types who answered.
      for (const person of ['dana', 'ivy', 'tessa']) expect((await patch(person, 'quotes', rang.id, { answered_by_id: s.id['ivy'] })).statusCode, person).toBeGreaterThanOrEqual(400);
    });

    it('the quote\'s e-mail goes to the address it was sent to, and nobody on the staff reads the code', async () => {
      const quote = await quoteOf();
      await s.jobs();
      const outbox = await s.rows(`SELECT * FROM ${s.real('outbox')} WHERE quote_id = ${String(quote.id)}`);
      expect(outbox).toHaveLength(1);
      const row = await quoteRow(quote.id);
      expect(outbox[0]!['to']).toBe(row['sent_to_email']);
      // The code is the customer's alone: nobody on the staff reads it, the rep who sent the quote and the install's owner included.
      for (const person of ['dana', 'ivy', 'tessa', 'grace', 'owner']) {
        for (const rest of [`/${String(quote.id)}`, '?limit=200', '?limit=200&select=id,share_code', `/${String(quote.id)}/history?limit=100`]) {
          expect((await get(person, 'quotes', rest)).body, `${person} ${rest}`).not.toContain(quote.code);
        }
      }
      expect((await get('sam', 'quotes', `/${String(quote.id)}`)).statusCode).toBe(404);
      expect((await get('lena', 'quotes', `/${String(quote.id)}`)).statusCode).toBe(403);
    });

    it('with the Quotes part switched off the link opens nothing; switched on again it opens', async () => {
      const quote = await quoteOf();
      expect((await pub('POST', '/claim/token', { payload: { token: quote.code } })).statusCode).toBe(200);
      const off = await s.app.inject({ method: 'PUT', url: '/api/v1/apps/crm/parts/quotes', headers: { cookie: s.owner }, payload: { on: false } });
      expect(off.statusCode, off.body).toBeLessThan(300);
      const closed = await pub('POST', '/claim/token', { payload: { token: quote.code } });
      expect(closed.statusCode, closed.body).toBeGreaterThanOrEqual(400);
      expect(closed.body).not.toContain('"session"');
      const on = await s.app.inject({ method: 'PUT', url: '/api/v1/apps/crm/parts/quotes', headers: { cookie: s.owner }, payload: { on: true } });
      expect(on.statusCode, on.body).toBeLessThan(300);
      expect((await pub('POST', '/claim/token', { payload: { token: quote.code } })).statusCode).toBe(200);
    });
  });
}
