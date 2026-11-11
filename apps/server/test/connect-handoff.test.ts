// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect Supabase": the operator hand-off (`connect/handoff.ts`,
 * `connect/redeem.ts`, `routes/connect/`), against the fake operator in
 * `scripts/dev/fake-connect-operator.mjs`.
 *
 * Proved on a whole composed server in production (loopback refused unless
 * listed):
 *   - `ADMINIUM_SUPABASE_CONNECT_URL` must be https, or the boot fails; set,
 *     `/system/info` lists the provider;
 *   - the full flow ends in a working, introspected connection (live on a
 *     local Postgres, through a TLS front, since the answer asks for TLS); an
 *     existing project asks for its password here and never sends it out;
 *   - a replayed or expired state, and another session's or user's state,
 *     are refused; `connections.manage` and a session are required;
 *   - a redirected, oversized, slow or malformed answer, a wrong engine, a `?`
 *     in `database`, a host the guard refuses: each refused, nothing created;
 *   - no password and no connection string in a log line or an audit row.
 */
import { request } from 'node:https';
import { userInfo } from 'node:os';
import { Writable } from 'node:stream';

import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, rolesRepo, snapshotsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/auth/passwords.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { loadEnv } from '../src/config/env.js';
import { createHandoffStore, HANDOFF_TTL_MS, s256 } from '../src/connect/handoff.js';
import { connectionDsn, isPlainHostName, redeemAnswerSchema } from '../src/connect/redeem.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { selfSignedTls, startFakeOperator, startPostgresTlsFront, type FakeOperator } from '../../../scripts/dev/fake-connect-operator.mjs';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PASSWORD = 'a-long-enough-test-password-1!';
const OPERATOR_PASSWORD = 'operator-made-password-7f3a';
const TYPED_PASSWORD = 'typed-into-this-instance-9c2e';
const quiet = { write: () => true };

// ── the environment ─────────────────────────────────────────────────────────

describe('ADMINIUM_SUPABASE_CONNECT_URL', () => {
  const load = (value: string) => loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ADMINIUM_SUPABASE_CONNECT_URL: value }, quiet);

  it('takes one https address, its path kept', () => {
    expect(load('https://connect.example.com/supabase/').ADMINIUM_SUPABASE_CONNECT_URL).toBe('https://connect.example.com/supabase');
    expect(loadEnv({ ADMINIUM_SECRET: TEST_SECRET }, quiet).ADMINIUM_SUPABASE_CONNECT_URL).toBeUndefined();
  });

  it('fails the boot on http, a name or password, a query, a fragment or no address at all', () => {
    for (const value of ['http://connect.example.com', 'http://localhost:4790/supabase', 'https://user:pw@connect.example.com', 'https://connect.example.com/?x=1', 'https://connect.example.com/#a', 'connect.example.com', 'ftp://connect.example.com']) {
      expect(() => load(value), value).toThrow('ADMINIUM_SUPABASE_CONNECT_URL');
    }
  });
});

// ── the pieces ──────────────────────────────────────────────────────────────

describe('the redeem answer', () => {
  const good = { engine: 'postgres', host: 'aws-0-eu-central-1.pooler.supabase.com', port: 5432, database: 'postgres', user: 'postgres.abcdefgh', sslmode: 'require' };

  it('takes a plain host name only', () => {
    for (const host of ['db.example.com', 'localhost', 'a-b.c9']) expect(isPlainHostName(host), host).toBe(true);
    for (const host of ['10.0.0.5', '127.1', '0x7f.1', '2130706433', '[::1]', '::1', 'db.example.com:5432', 'db/x', 'DB.example.com', 'db..x', '-db.x', 'db.example.com.', '']) {
      expect(isPlainHostName(host), host).toBe(false);
    }
  });

  it('refuses every field that could move or widen the connection', () => {
    expect(redeemAnswerSchema.safeParse(good).success).toBe(true);
    const bad: Record<string, unknown>[] = [
      { engine: 'mysql' },
      { host: '10.0.0.5' },
      { host: 'db.example.com?host=10.0.0.5' },
      { port: '5432' },
      { port: 5432.5 },
      { port: 70_000 },
      { sslmode: 'disable' },
      { sslmode: 'prefer' },
      { database: 'postgres?host=10.0.0.5' },
      { database: 'a/b' },
      { database: 'a@b' },
      { database: 'a#b' },
      { database: 'a%2Fb' },
      { user: 'u@x' },
      { user: 'u:x' },
      { password: 'line\nbreak' },
      { password: '' },
    ];
    for (const change of bad) expect(redeemAnswerSchema.safeParse({ ...good, ...change }).success, JSON.stringify(change)).toBe(false);
    // An unknown field is dropped, never read.
    expect(redeemAnswerSchema.parse({ ...good, host_override: '10.0.0.5' })).not.toHaveProperty('host_override');
  });

  it('builds the string from the fields, every part encoded, and reads it back the same', () => {
    const answer = redeemAnswerSchema.parse({ ...good, password: 'p@ss/w?rd#%&' });
    const dsn = connectionDsn(answer, answer.password);
    expect(dsn).toBe('postgres://postgres.abcdefgh:p%40ss%2Fw%3Frd%23%25%26@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true');
    expect(connectionDsn(redeemAnswerSchema.parse({ ...good, sslmode: 'verify-full' }), undefined)).toBe(
      'postgres://postgres.abcdefgh@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full',
    );
  });
});

describe('the hand-off store', () => {
  const owner = { sessionId: 'session-a', userId: 'user-a' };

  it('spends a state once, and gives the verifier whose S256 was the challenge', () => {
    const store = createHandoffStore({ secret: TEST_SECRET });
    const { state, challenge } = store.start('supabase', owner);
    const taken = store.take('supabase', state, owner);
    expect(taken.ok).toBe(true);
    if (taken.ok) expect(s256(taken.value.verifier)).toBe(challenge);
    expect(store.take('supabase', state, owner)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('refuses another session or user, and spends the state doing so', () => {
    const store = createHandoffStore({ secret: TEST_SECRET });
    const first = store.start('supabase', owner);
    expect(store.take('supabase', first.state, { ...owner, sessionId: 'session-b' })).toEqual({ ok: false, reason: 'not-yours' });
    expect(store.take('supabase', first.state, owner).ok).toBe(false);
    const second = store.start('supabase', owner);
    expect(store.take('supabase', second.state, { ...owner, userId: 'user-b' })).toEqual({ ok: false, reason: 'not-yours' });
  });

  it('expires a state and a held answer after ten minutes', () => {
    let clock = 1_000_000;
    const store = createHandoffStore({ secret: TEST_SECRET, now: () => clock });
    const { state } = store.start('supabase', owner);
    const held = store.hold('supabase', owner, redeemAnswerSchema.parse({ engine: 'postgres', host: 'db.example.com', port: 5432, database: 'd', user: 'u', sslmode: 'require' }));
    clock += HANDOFF_TTL_MS;
    expect(store.take('supabase', state, owner)).toEqual({ ok: false, reason: 'expired' });
    expect(store.pending(held, owner)).toEqual({ ok: false, reason: 'expired' });
  });

  it('keeps no verifier: a store under another secret cannot redeem a state it did not make', () => {
    const store = createHandoffStore({ secret: TEST_SECRET });
    const { state } = store.start('supabase', owner);
    expect(createHandoffStore({ secret: 'another-secret-entirely-1234' }).take('supabase', state, owner).ok).toBe(false);
  });
});

// ── a whole server in production ────────────────────────────────────────────

const PG_URL = process.env['TEST_POSTGRES_URL'] || undefined;
const pgLoopback = PG_URL !== undefined && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(PG_URL).hostname);
const pg = PG_URL === undefined ? null : new URL(PG_URL);

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
let operator: FakeOperator | undefined;
let front: { close(): Promise<void> } | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
  await operator?.close();
  operator = undefined;
  await front?.close();
  front = undefined;
});

interface Server {
  call(method: 'GET' | 'POST', url: string, payload?: unknown, as?: string): Promise<{ status: number; body: Record<string, unknown> }>;
  owner: string;
  meta: MetaDb;
  manager: ConnectionManager;
  operator: FakeOperator;
  logs: string[];
  clock: { now: number };
  login(email: string, password: string): Promise<string>;
}

interface ServerOptions {
  /** Where the operator's answers point; a host the guard refuses by default (this machine, unlisted). */
  answer?: { host: string; port: number; database: string; user: string } | undefined;
  /** `ADMINIUM_DATABASE_HOSTS`. */
  databaseHosts?: string | undefined;
  connectUrl?: boolean | undefined;
  slowMs?: number | undefined;
}

/** The local Postgres behind a TLS front: the answer asks for `sslmode=require`, and a local server has no TLS. */
async function livePostgres(): Promise<{ host: string; port: number; database: string; user: string }> {
  const url = pg as URL;
  const tls = selfSignedTls();
  const started = await startPostgresTlsFront({ target: { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432) }, tls });
  front = started;
  return { host: 'localhost', port: started.port, database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres', user: decodeURIComponent(url.username) || userInfo().username };
}

async function server(opts: ServerOptions = {}): Promise<Server> {
  const answer = opts.answer ?? { host: 'localhost', port: 5432, database: 'postgres', user: 'postgres' };
  operator = await startFakeOperator({ instance: 'http://localhost', answer: { ...answer, password: OPERATOR_PASSWORD, project: 'hollis-orders' }, slowMs: opts.slowMs ?? 3_000 });
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const parsed = makeEnv({
    HOST: '127.0.0.1',
    ...(opts.connectUrl === false ? {} : { ADMINIUM_SUPABASE_CONNECT_URL: operator.url }),
    ...(opts.databaseHosts === undefined ? {} : { ADMINIUM_DATABASE_HOSTS: opts.databaseHosts }),
  });
  // Production: loopback refused unless listed, as on the Docker image.
  const manager = new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: true, databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS });
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  const clock = { now: Date.now() };
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager,
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: pino({ level: 'trace' }, sink),
    telemetry: false,
    onMetaRelocated: () => undefined,
    connectSeam: { redeemCa: operator.cert, redeemTimeoutMs: 500, now: () => clock.now },
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price' } });
  expect(setup.statusCode, setup.body).toBe(201);
  const owner = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    owner,
    meta: store,
    manager,
    operator,
    logs,
    clock,
    call: async (method, url, payload, as = owner) => {
      const res = await app.inject({ method, url, headers: as === '' ? {} : { cookie: as }, ...(payload === undefined ? {} : { payload: payload as object }) });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    },
    login: async (email, password) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
      expect(res.statusCode, res.body).toBe(200);
      return String(res.headers['set-cookie']).split(';')[0] ?? '';
    },
  };
}

/** GET an address on the fake operator, trusting its certificate; the status and the Location. */
function operatorGet(url: string, ca: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: typeof res.headers.location === 'string' ? res.headers.location : null });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Start, and play the person at the operator's page: the state and the code the browser comes back with. */
async function signIn(s: Server, scenario: string, as = s.owner): Promise<{ state: string; code: string }> {
  const start = await s.call('POST', '/api/v1/connect/start', { provider: 'supabase' }, as);
  expect(start.status, JSON.stringify(start.body)).toBe(200);
  const url = new URL(String(start.body['redirectUrl']));
  url.searchParams.set('scenario', scenario);
  const page = await operatorGet(url.toString(), s.operator.cert);
  expect(page.status).toBe(302);
  const back = new URL(page.location as string);
  expect(back.origin + back.pathname).toBe('http://localhost/connect/supabase/return');
  return { state: back.searchParams.get('state') as string, code: back.searchParams.get('code') as string };
}

const finish = (s: Server, back: { state: string; code: string }, as = s.owner) => s.call('POST', '/api/v1/connect/return', { provider: 'supabase', ...back }, as);

async function handoffAudit(store: MetaDb): Promise<{ action: string; changes: string }[]> {
  const rows = await store.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', 'like', 'connection.%').orderBy('createdAt').orderBy('id').execute();
  return rows.map((row) => ({ action: row.action, changes: typeof row.changes === 'string' ? row.changes : JSON.stringify(row.changes) }));
}

async function connectionCount(store: MetaDb): Promise<number> {
  const rows = await store.db.selectFrom('adminium_connections').select('id').execute();
  return rows.length;
}

describe('the hand-off on a production server', { timeout: 60_000 }, () => {
  it('lists the provider in /system/info only when the operator set it', async () => {
    const s = await server();
    expect((await s.call('GET', '/api/v1/system/info', undefined, '')).body['connect']).toEqual([{ provider: 'supabase' }]);
    await composed?.app.close();
    composed = undefined;
    await meta?.db.destroy();
    meta = undefined;
    await operator?.close();
    const unset = await server({ connectUrl: false });
    expect((await unset.call('GET', '/api/v1/system/info', undefined, '')).body['connect']).toEqual([]);
    const start = await unset.call('POST', '/api/v1/connect/start', { provider: 'supabase' });
    expect(start.status).toBe(404);
  });

  it('sends the browser to the operator with this instance, a state and the challenge, and audits the start', async () => {
    const s = await server();
    const start = await s.call('POST', '/api/v1/connect/start', { provider: 'supabase' });
    const url = new URL(String(start.body['redirectUrl']));
    expect(`${url.origin}${url.pathname}`).toBe(s.operator.url);
    expect(url.searchParams.get('instance')).toBe('http://localhost');
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get('challenge')).toMatch(/^[\w-]{43}$/);
    expect((await handoffAudit(s.meta)).map((row) => row.action)).toEqual(['connection.handoff.start']);
  });

  it('needs a signed-in person holding connections.manage', async () => {
    const s = await server();
    expect((await s.call('POST', '/api/v1/connect/start', { provider: 'supabase' }, '')).status).toBe(401);
    expect((await s.call('POST', '/api/v1/connect/return', { provider: 'supabase', state: 'x', code: 'y' }, '')).status).toBe(401);
    expect((await s.call('POST', '/api/v1/connect/complete', { pendingId: 'x', password: 'y' }, '')).status).toBe(401);
    const roles = rolesRepo(s.meta);
    const reader = await roles.create({ slug: 'reader', name: 'Reader' });
    const user = await usersRepo(s.meta).create({ email: 'reader@example.test', name: 'Reader', passwordHash: await hashPassword('another-long-test-password-2!') });
    await roles.assignToUser(user.id, reader.id);
    const cookie = await s.login('reader@example.test', 'another-long-test-password-2!');
    expect((await s.call('POST', '/api/v1/connect/start', { provider: 'supabase' }, cookie)).status).toBe(403);
    expect((await s.call('POST', '/api/v1/connect/return', { provider: 'supabase', state: 'x', code: 'y' }, cookie)).status).toBe(403);
  });

  it('refuses a replayed state, an expired one, and another session’s or user’s', async () => {
    const s = await server();
    // Replayed: the state is spent at the first return, whatever the operator answered.
    const once = await signIn(s, 'expired');
    expect((await finish(s, once)).status).toBe(410);
    expect((await finish(s, once)).body).toMatchObject({ error: { code: 'CONNECT_EXPIRED' } });
    expect(s.operator.redeems).toHaveLength(1);

    // Expired: ten minutes later.
    const late = await signIn(s, 'new');
    s.clock.now += 10 * 60_000 + 1;
    expect((await finish(s, late)).body).toMatchObject({ error: { code: 'CONNECT_EXPIRED' } });
    s.clock.now = Date.now();

    // Another session of the same person.
    const mine = await signIn(s, 'new');
    const otherSession = await s.login('owner@example.test', PASSWORD);
    expect((await finish(s, mine, otherSession)).body).toMatchObject({ error: { code: 'CONNECT_EXPIRED' } });
    // ...and spent by that try: the right session cannot use it after.
    expect((await finish(s, mine)).body).toMatchObject({ error: { code: 'CONNECT_EXPIRED' } });

    // Another user, an Admin who holds connections.manage.
    const roles = rolesRepo(s.meta);
    const admin = await usersRepo(s.meta).create({ email: 'admin@example.test', name: 'Admin', passwordHash: await hashPassword('another-long-test-password-3!') });
    await roles.assignToUser(admin.id, (await roles.findBySlug('admin'))!.id);
    const adminCookie = await s.login('admin@example.test', 'another-long-test-password-3!');
    const owners = await signIn(s, 'new');
    expect((await finish(s, owners, adminCookie)).body).toMatchObject({ error: { code: 'CONNECT_EXPIRED' } });

    // None of the refused states reached the operator.
    expect(s.operator.redeems).toHaveLength(1);
    expect(await connectionCount(s.meta)).toBe(0);
    const refusals = (await handoffAudit(s.meta)).filter((row) => row.action === 'connection.handoff.refused');
    expect(refusals).toHaveLength(6);
    for (const row of refusals) expect(JSON.parse(row.changes)).toMatchObject({ after: { provider: 'supabase', reason: 'expired' } });
  });

  it.each([
    ['redirect', 'CONNECT_REFUSED', 'redirect'],
    ['oversized', 'CONNECT_REFUSED', 'too-large'],
    ['slow', 'CONNECT_REFUSED', 'timeout'],
    ['malformed', 'CONNECT_REFUSED', 'malformed'],
    ['wrong-engine', 'CONNECT_REFUSED', 'fields'],
    ['question', 'CONNECT_REFUSED', 'fields'],
  ])('refuses a %s answer and makes nothing', async (scenario, code, reason) => {
    const s = await server();
    const reply = await finish(s, await signIn(s, scenario));
    expect(reply.status, JSON.stringify(reply.body)).toBe(502);
    expect(reply.body).toMatchObject({ error: { code, details: { reason } } });
    expect(await connectionCount(s.meta)).toBe(0);
    const audit = await handoffAudit(s.meta);
    expect(audit.map((row) => row.action)).toEqual(['connection.handoff.start', 'connection.handoff.refused']);
    expect(JSON.parse(audit[1]!.changes)).toMatchObject({ after: { provider: 'supabase', reason } });
  });

  it('refuses a host the database guard refuses: the cloud metadata name', async () => {
    const s = await server();
    const reply = await finish(s, await signIn(s, 'bad-host'));
    expect(reply.status).toBe(422);
    expect(String((reply.body['error'] as { message: string }).message)).toContain('blocked address range');
    expect(await connectionCount(s.meta)).toBe(0);
  });

  it('refuses a host the database guard refuses: this machine, unlisted, in production', async () => {
    const s = await server({ answer: { host: 'localhost', port: 5432, database: 'postgres', user: 'postgres' } });
    const reply = await finish(s, await signIn(s, 'new'));
    expect(reply.status).toBe(422);
    expect(String((reply.body['error'] as { message: string }).message)).toContain('ADMINIUM_DATABASE_HOSTS');
    expect(await connectionCount(s.meta)).toBe(0);
    const refused = (await handoffAudit(s.meta)).at(-1)!;
    expect(refused.action).toBe('connection.handoff.refused');
    expect(JSON.parse(refused.changes)).toMatchObject({ after: { reason: 'validation_failed', host: 'localhost' } });
  });

  it('refuses an existing project on a refused host before anyone types its password', async () => {
    const s = await server({ answer: { host: 'localhost', port: 5432, database: 'postgres', user: 'postgres' } });
    const reply = await finish(s, await signIn(s, 'existing'));
    expect(reply.status).toBe(422);
    expect(reply.body).not.toHaveProperty('pendingId');
    expect(await connectionCount(s.meta)).toBe(0);
  });

  describe.skipIf(!pgLoopback)('live, on the local Postgres', () => {
    it('ends in a working, introspected connection, and logs no password or string', async () => {
      const db = await livePostgres();
      const s = await server({ answer: db, databaseHosts: `localhost:${String(db.port)}` });
      const back = await signIn(s, 'new');
      const reply = await finish(s, back);
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body).toMatchObject({ status: 'connected', connection: { name: 'hollis-orders', engine: 'postgres', introspected: true } });
      const id = (reply.body['connection'] as { id: string }).id;
      expect(await snapshotsRepo(s.meta).latest(id)).not.toBeNull();
      // Working: the stored connection tests green, and asks for TLS (the front hangs up on anything else).
      expect((await s.call('POST', `/api/v1/connections/${id}/test`)).body).toMatchObject({ ok: true });
      const listed = await s.call('GET', `/api/v1/connections/${id}`);
      expect(listed.body).toMatchObject({ status: 'connected', dsnMasked: `postgres://${db.user}@localhost:${String(db.port)}/${db.database}` });
      expect((await handoffAudit(s.meta)).map((row) => row.action)).toEqual(['connection.handoff.start', 'connection.create', 'connection.handoff.success']);
      const everything = [...s.logs, ...(await handoffAudit(s.meta)).map((row) => row.changes)].join('\n');
      expect(everything).not.toContain(OPERATOR_PASSWORD);
      expect(everything).not.toContain('postgres://');
      expect(everything).not.toContain(back.code);
      expect(everything).not.toContain(String(s.operator.redeems[0]?.verifier));
    });

    it('asks for an existing project’s password here, only from whoever started it, and never sends it to the operator', async () => {
      const db = await livePostgres();
      const s = await server({ answer: db, databaseHosts: `localhost:${String(db.port)}` });
      const reply = await finish(s, await signIn(s, 'existing'));
      expect(reply.body).toEqual({ status: 'needs-password', pendingId: expect.any(String), project: 'hollis-orders' });
      const pendingId = String(reply.body['pendingId']);
      expect(await connectionCount(s.meta)).toBe(0);

      // Not another person's to finish.
      const roles = rolesRepo(s.meta);
      const admin = await usersRepo(s.meta).create({ email: 'admin@example.test', name: 'Admin', passwordHash: await hashPassword('another-long-test-password-3!') });
      await roles.assignToUser(admin.id, (await roles.findBySlug('admin'))!.id);
      const adminCookie = await s.login('admin@example.test', 'another-long-test-password-3!');
      expect((await s.call('POST', '/api/v1/connect/complete', { pendingId, password: TYPED_PASSWORD }, adminCookie)).body).toMatchObject({ error: { code: 'CONNECT_EXPIRED' } });

      // The local server takes any password, so the one typed here lands the connection.
      const done = await s.call('POST', '/api/v1/connect/complete', { pendingId, password: TYPED_PASSWORD });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body).toMatchObject({ status: 'connected', connection: { name: 'hollis-orders', introspected: true } });
      // Finished: the held answer is gone.
      expect((await s.call('POST', '/api/v1/connect/complete', { pendingId, password: TYPED_PASSWORD })).status).toBe(410);

      expect(JSON.stringify(s.operator.redeems)).not.toContain(TYPED_PASSWORD);
      const everything = [...s.logs, ...(await handoffAudit(s.meta)).map((row) => row.changes)].join('\n');
      expect(everything).not.toContain(TYPED_PASSWORD);
      expect(everything).not.toContain('postgres://');
    });
  });
});
