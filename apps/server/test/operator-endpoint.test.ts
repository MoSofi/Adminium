// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The operator endpoint: served on `ADMINIUM_OPERATOR_LISTEN` only, never on
 * the public listener; the bearer token alone lets anyone in, compared in
 * constant time and rate-limited; the status says totals and the Super
 * Admins' sign-ins, nothing more; hiding the public pages is kept in a row no
 * settings route, config import, export or archive touches, survives a
 * restart and is audited; the public content is what strangers are served.
 *
 * The status and the hold are proved on every engine this run reaches.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditRepo, operatorHoldsRepo, operatorTalliesRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createArchive } from '../src/archive/create.js';
import { NEVER_ARCHIVED_TABLES, sanitizeDump } from '../src/archive/policy.js';
import { listenOrClose } from '../src/cli/runtime.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { exportZip } from '../src/export/zip-service.js';
import { importZip } from '../src/export/import-service.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { AI_TOKENS_TALLY } from '../src/llm/operator-ai.js';
import { createRunService } from '../src/llm/run-service.js';
import { FAILURES_ALLOWED, OPERATOR_ACTOR_LABEL, tokenMatches } from '../src/operator/endpoint.js';
import { createOperatorHolds, PUBLIC_PAGES_HOLD } from '../src/operator/holds.js';
import { SIGN_INS_REPORTED } from '../src/operator/status.js';
import { AVAILABLE, CRYPTO, makeStore, SECRET, SIGNING, type EngineName } from './archive.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const TOKEN = 'a1'.repeat(32);
const ORIGIN_HOST = 'hollis.try.example.com';
const CUSTOMER_HTML = '<!doctype html><html><head><title>Hollis Bakery</title></head><body>Fresh bread every morning</body></html>';
const REASON = 'The page review found a sign-in form that looks like another company’s.';

let root: string;
let surfaces: HostedSurface[];
let dataDir: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'operator-endpoint-'));
  dataDir = join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'kept.bin'), Buffer.alloc(4096, 1));
  for (const side of ['customer', 'staff'] as const) {
    const dir = join(root, 'surfaces', 'shop', side);
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'index.html'), side === 'customer' ? CUSTOMER_HTML : '<!doctype html><title>Till</title>');
    await writeFile(join(dir, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  surfaces = discoverSurfaces(join(root, 'surfaces'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A port nothing listens on, for a listener the test opens for real. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

interface Served {
  composed: ComposedServer;
  meta: MetaDb;
}

/** The whole server on `meta`, as the boot composes it: the operator endpoint built when the env asks. */
async function serve(meta: MetaDb, engine: EngineName, env: Record<string, string> = {}): Promise<Served> {
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir, ...env }));
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: parsed,
    metaStore: { meta, url: `${engine}::test`, engine, source: 'embedded', close: async () => Promise.resolve() },
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    surfaces,
  });
  await composed.app.ready();
  cleanups.push(async () => composed.app.close());
  return { composed, meta };
}

async function store(engine: EngineName): Promise<MetaDb> {
  const made = await makeStore(engine, true);
  cleanups.push(made.destroy);
  return made.meta;
}

const OPERATOR = (port = 4799) => ({ ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_LISTEN: `127.0.0.1:${String(port)}` });

/** A call on the operator's own listener, by address, with the token unless told otherwise. */
async function ask(served: Served, method: 'GET' | 'POST', url: string, opts: { token?: string | null; payload?: unknown; from?: string; host?: string } = {}) {
  const endpoint = served.composed.app.operatorEndpoint;
  expect(endpoint).not.toBeNull();
  const token = opts.token === undefined ? TOKEN : opts.token;
  return endpoint!.server.inject({
    method,
    url,
    headers: { host: opts.host ?? '127.0.0.1:4799', ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
    remoteAddress: opts.from ?? '10.0.0.9',
    ...(opts.payload === undefined ? {} : { payload: opts.payload as object }),
  });
}

describe('the operator endpoint is on its own listener only', () => {
  it('is not built without the token, and the public listener never answers its paths', async () => {
    const plain = await serve(await store('sqlite'), 'sqlite');
    expect(plain.composed.app.operatorEndpoint).toBeNull();
    // One server at a time: their schedules share one name space.
    await plain.composed.app.close();

    const served = await serve(await store('sqlite'), 'sqlite', OPERATOR());
    expect(served.composed.app.operatorEndpoint).not.toBeNull();
    for (const [method, url] of [
      ['GET', '/api/v1/operator/status'],
      ['POST', '/api/v1/operator/public-pages'],
      ['GET', '/api/v1/operator/public-content'],
    ] as const) {
      const res = await served.composed.app.inject({ method, url, headers: { authorization: `Bearer ${TOKEN}` }, ...(method === 'POST' ? { payload: { hidden: true, reason: REASON } } : {}) });
      expect(res.statusCode, `${method} ${url} on the public listener`).toBe(404);
      expect(served.composed.app.hasRoute({ method, url })).toBe(false);
    }
    expect((await operatorHoldsRepo(served.meta).get(PUBLIC_PAGES_HOLD))).toBeNull();
  });

  it('answers only its own paths, by address, where the public listener answers its host only (421)', async () => {
    const served = await serve(await store('sqlite'), 'sqlite', { ...OPERATOR(), ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}` });
    // The control service dials the instance by address: the public listener's host gate is not this listener's.
    expect((await ask(served, 'GET', '/api/v1/operator/status', { host: '10.0.0.2:4601' })).statusCode).toBe(200);
    // The public listener still refuses a name it was not given, exactly as before.
    expect((await served.composed.app.inject({ method: 'GET', url: '/api/v1/system/info', headers: { host: '10.0.0.2:4601' } })).statusCode).toBe(421);
    // Nothing of the public server is served here: not its API, not its pages.
    for (const url of ['/api/v1/system/info', '/api/v1/healthz', '/', '/apps/shop/customer/', '/api/v1/operator']) {
      expect((await ask(served, 'GET', url)).statusCode, url).toBe(404);
    }
  });

  it('listens for real beside the public listener, and closes with it', async () => {
    const [port, operatorPort] = [await freePort(), await freePort()];
    const served = await serve(await store('sqlite'), 'sqlite', { ...OPERATOR(operatorPort), PORT: String(port) });
    const { app } = served.composed;
    await listenOrClose(app, { PORT: port, HOST: '127.0.0.1' });
    const get = (at: number, path: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: at, path, headers: { authorization: `Bearer ${TOKEN}` } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.once('error', reject);
        req.end();
      });
    expect(await get(operatorPort, '/api/v1/operator/status')).toBe(200);
    expect(await get(port, '/api/v1/operator/status')).toBe(404);
    await app.close();
    await expect(get(operatorPort, '/api/v1/operator/status')).rejects.toThrow();
  });
});

describe('the token', () => {
  it('is required, compared whole, and a wrong one counts against its address', async () => {
    const served = await serve(await store('sqlite'), 'sqlite', OPERATOR());
    expect((await ask(served, 'GET', '/api/v1/operator/status', { token: null })).statusCode).toBe(401);
    expect((await ask(served, 'GET', '/api/v1/operator/status', { token: TOKEN.slice(0, -1) })).statusCode).toBe(401);
    expect((await ask(served, 'GET', '/api/v1/operator/status', { token: `${TOKEN}0` })).statusCode).toBe(401);
    const wrong = await ask(served, 'GET', '/api/v1/operator/status', { token: 'b2'.repeat(32) });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers['www-authenticate']).toBe('Bearer');
    // No session stands in for it.
    expect((await ask(served, 'GET', '/api/v1/operator/status', { token: null, host: ORIGIN_HOST })).statusCode).toBe(401);

    // Spent: the address is refused unheard, even with the right token, and another address is not.
    for (let i = 4; i < FAILURES_ALLOWED; i += 1) await ask(served, 'GET', '/api/v1/operator/status', { token: 'wrong' });
    const refused = await ask(served, 'GET', '/api/v1/operator/status');
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect((await ask(served, 'GET', '/api/v1/operator/status', { from: '10.0.0.10' })).statusCode).toBe(200);
  });

  it('is compared in constant time: digests of equal length, whatever was sent', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    // A plain timingSafeEqual throws on unequal lengths, and a length check returns early: neither here.
    expect(tokenMatches('', TOKEN)).toBe(false);
    expect(tokenMatches(`${TOKEN}${TOKEN}`, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.toUpperCase(), TOKEN)).toBe(false);
  });
});

for (const engine of ['sqlite', 'postgres', 'mysql'] as const) {
  describe.skipIf(!AVAILABLE[engine])(`status and the hold [${engine}]`, { timeout: 120_000 }, () => {
    it('says the totals and the Super Admins’ last sign-ins, and no name', async () => {
      const meta = await store(engine);
      const roles = rolesRepo(meta);
      const users = usersRepo(meta);
      const hash = await adminPasswordHash();
      const owner = await users.create({ email: 'dana@hollis.test', name: 'Dana Price', passwordHash: hash, status: 'active' });
      await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
      const staff = await users.create({ email: 'sam@hollis.test', name: 'Sam Staff', passwordHash: hash, status: 'active' });
      await roles.assignToUser(staff.id, (await roles.findBySlug('admin'))!.id);
      const audit = auditRepo(meta);
      // More sign-ins than are reported, and a staff member's in between that never is.
      for (let i = 0; i < SIGN_INS_REPORTED + 5; i += 1) {
        await audit.append({ actorKind: 'user', actorId: owner.id, actorLabel: owner.name, category: 'auth', action: 'login', ip: `10.1.0.${String(i)}` });
        await audit.append({ actorKind: 'user', actorId: staff.id, actorLabel: staff.name, category: 'auth', action: 'login', ip: '10.9.9.9' });
      }
      await audit.append({ actorKind: 'user', actorId: owner.id, actorLabel: owner.name, category: 'auth', action: 'logout', ip: '10.7.7.7' });

      const served = await serve(meta, engine, OPERATOR());
      // A real sign-in, from its own address: the newest.
      const signIn = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '203.0.113.7', payload: { email: owner.email, password: ADMIN_PASSWORD } });
      expect(signIn.statusCode, signIn.body).toBe(200);
      sessionCookie(signIn.headers['set-cookie']);

      const res = await ask(served, 'GET', '/api/v1/operator/status');
      expect(res.statusCode, res.body).toBe(200);
      const status = res.json().data;
      expect(status.superAdminSignIns).toHaveLength(SIGN_INS_REPORTED);
      expect(status.superAdminSignIns[0].ip).toBe('203.0.113.7');
      expect(status.superAdminSignIns.map((row: { ip: string }) => row.ip)).not.toContain('10.9.9.9');
      expect(status.superAdminSignIns.map((row: { ip: string }) => row.ip)).not.toContain('10.7.7.7');
      expect(status.superAdminSignIns[1].ip).toBe(`10.1.0.${String(SIGN_INS_REPORTED + 4)}`);
      const times = status.superAdminSignIns.map((row: { at: number }) => row.at);
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(status.lastSignInAt).toBeGreaterThan(0);
      expect(status.storage.dataDir).toBeGreaterThanOrEqual(4096);
      expect(status.storage.files).toBe(0);
      expect(status.storage.projectFolder).toBeNull();
      // Counted elsewhere, and not yet on this instance: said as unknown, never as a guess.
      expect(status.emails).toEqual({ today: null, thisHour: null });
      expect(status.operatorAiTokens).toBeNull();
      expect(status.publicPages).toEqual({ hidden: false, reason: null, changedAt: null });
      for (const word of ['Dana', 'Price', 'dana@hollis.test', 'Sam', 'sam@hollis.test']) expect(res.body).not.toContain(word);
    });

    it('says the relay’s mail and the operator’s AI as numbers where this instance counts them', async () => {
      const meta = await store(engine);
      const served = await serve(meta, engine, {
        ...OPERATOR(),
        ADMINIUM_TRIAL_MODE: 'on',
        ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
        ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
        ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
        ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
        ADMINIUM_TRIAL_SMTP_URL: 'smtp://127.0.0.1:2525',
        ADMINIUM_TRIAL_MAIL_FROM: 'i-7f3a9c@relay.example.com',
        ADMINIUM_AI_OPERATOR_BUDGET_TOKENS: '5000',
      });
      const before = (await ask(served, 'GET', '/api/v1/operator/status')).json().data;
      expect(before.emails).toEqual({ today: 0, thisHour: 0 });
      expect(before.operatorAiTokens).toBe(0);
      // The AI client adds to the same tally the status reads.
      await operatorTalliesRepo(meta).add(AI_TOKENS_TALLY, 120);
      expect((await ask(served, 'GET', '/api/v1/operator/status')).json().data.operatorAiTokens).toBe(120);
    });

    it('hides the public pages with a reason, audited, and they stay hidden after a restart', async () => {
      const meta = await store(engine);
      const first = await serve(meta, engine, OPERATOR());
      // Hiding needs a reason; the body says nothing else.
      expect((await ask(first, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: true } })).statusCode).toBe(422);
      expect((await ask(first, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: true, reason: REASON, also: 1 } })).statusCode).toBe(422);
      expect((await ask(first, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: true, reason: 'x'.repeat(501) } })).statusCode).toBe(422);
      const hide = await ask(first, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: true, reason: REASON } });
      expect(hide.statusCode, hide.body).toBe(200);
      expect(hide.json().data).toMatchObject({ hidden: true, reason: REASON });
      const rows = await auditRepo(meta).list({ category: 'system' });
      expect(rows[0]).toMatchObject({ actorKind: 'system', actorLabel: OPERATOR_ACTOR_LABEL, action: 'operator.public_pages.hidden', ip: '10.0.0.9' });
      expect(rows[0]?.changes).toMatchObject({ before: { hidden: false, reason: null }, after: { hidden: true, reason: REASON } });
      await first.composed.app.close();

      const again = await serve(meta, engine, OPERATOR());
      expect(again.composed.app.operatorHolds.publicPages()).toMatchObject({ hidden: true, reason: REASON });
      expect((await ask(again, 'GET', '/api/v1/operator/status')).json().data.publicPages).toMatchObject({ hidden: true, reason: REASON });
      const show = await ask(again, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: false } });
      expect(show.json().data).toMatchObject({ hidden: false, reason: null });
      expect((await auditRepo(meta).list({ category: 'system' }))[0]).toMatchObject({ action: 'operator.public_pages.shown' });
    });
  });
}

describe('a hold the boot cannot read', () => {
  const page = (served: Served) => served.composed.app.inject({ method: 'GET', url: '/apps/shop/customer/', headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } });

  it('keeps every public page hidden until it has been read once', async () => {
    const meta = await store('sqlite');
    // A store the hold cannot be read from: its table is not where the boot looks.
    await sql`alter table adminium_operator_holds rename to adminium_operator_holds_aside`.execute(meta.db);
    const served = await serve(meta, 'sqlite');
    expect(served.composed.app.operatorHolds.unread()).toBe(true);
    const hidden = await page(served);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain('Fresh bread');
    // Staff pages are not public doors: they answer on.
    expect((await served.composed.app.inject({ method: 'GET', url: '/api/v1/system/info' })).statusCode).toBe(200);
  });

  it('shows them as before once the store reads', async () => {
    const served = await serve(await store('sqlite'), 'sqlite');
    expect(served.composed.app.operatorHolds.unread()).toBe(false);
    const shown = await page(served);
    expect(shown.statusCode).toBe(200);
    expect(shown.body).toContain('Fresh bread');
  });

  it('tries again until the read works, then stops', async () => {
    const meta = await store('sqlite');
    await sql`alter table adminium_operator_holds rename to adminium_operator_holds_aside`.execute(meta.db);
    const failures: Error[] = [];
    const holds = createOperatorHolds(meta, { retryMs: 20, onRetryFailed: (error) => failures.push(error) });
    cleanups.push(async () => holds.close());
    expect(await holds.load()).not.toBeNull();
    expect(holds.unread()).toBe(true);
    await vi.waitFor(() => expect(failures.length).toBeGreaterThan(0));
    await sql`alter table adminium_operator_holds_aside rename to adminium_operator_holds`.execute(meta.db);
    await vi.waitFor(() => expect(holds.unread()).toBe(false));
    const seen = failures.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(failures.length).toBe(seen);
  });
});

describe('nothing but the operator endpoint touches the hold', () => {
  it('no settings write, config export, config import or archive reads or writes it', async () => {
    const meta = await store('sqlite');
    const served = await serve(meta, 'sqlite', OPERATOR());
    expect((await ask(served, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: true, reason: REASON } })).statusCode).toBe(200);
    const held = await operatorHoldsRepo(meta).get(PUBLIC_PAGES_HOLD);

    // Not a setting: the registry has no such key, and every setting written leaves it as it was.
    await settingsRepo(meta).set('branding.appName', 'Hollis Bakery', { updatedBy: null });
    expect(await operatorHoldsRepo(meta).get(PUBLIC_PAGES_HOLD)).toEqual(held);

    // The config bundle neither carries it nor, imported, changes it.
    const out = join(root, `bundle-${String(Date.now())}.zip`);
    const exported = await exportZip({ meta, outPath: out, dataDir });
    const { unzipSync, strFromU8 } = await import('fflate');
    const { readFile } = await import('node:fs/promises');
    const files = unzipSync(new Uint8Array(await readFile(exported.path)));
    for (const [name, bytes] of Object.entries(files)) {
      expect(name).not.toContain('operator');
      expect(strFromU8(bytes)).not.toContain(REASON);
    }
    await operatorHoldsRepo(meta).set({ name: PUBLIC_PAGES_HOLD, held: false, reason: null }, 1);
    await importZip({ meta, inPath: exported.path });
    expect(await operatorHoldsRepo(meta).get(PUBLIC_PAGES_HOLD)).toEqual({ name: PUBLIC_PAGES_HOLD, held: false, reason: null, changedAt: 1 });

    // An archive, of either kind, leaves the table out, and a restore drops it whatever the file says.
    expect(NEVER_ARCHIVED_TABLES).toContain('adminium_operator_holds');
    await operatorHoldsRepo(meta).set({ name: PUBLIC_PAGES_HOLD, held: true, reason: REASON });
    for (const kind of ['full', 'export'] as const) {
      const archive = join(root, `archive-${kind}-${String(Date.now())}.zip`);
      const created = await createArchive({ meta, outPath: archive, dataDir, projectRoot: null, kind, secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING });
      expect(JSON.stringify(created.manifest)).not.toContain('adminium_operator_holds');
      const entries = Object.keys(unzipSync(new Uint8Array(await readFile(archive))));
      expect(entries.some((entry) => entry.includes('operator_holds'))).toBe(false);
      const tables = new Map([['adminium_operator_holds', { columns: ['name', 'held', 'reason', 'changed_at'], kinds: {}, rows: [[PUBLIC_PAGES_HOLD, 1, REASON, 1]] }]]);
      const report = sanitizeDump(tables as never, { kind, dialect: 'sqlite' });
      expect(report.droppedTables).toContain('adminium_operator_holds');
      expect(tables.has('adminium_operator_holds')).toBe(false);
    }
  });
});

describe('public content', () => {
  it('is every customer side’s files, with their text, and the live forms', async () => {
    const served = await serve(await store('sqlite'), 'sqlite', OPERATOR());
    const res = await ask(served, 'GET', '/api/v1/operator/public-content');
    expect(res.statusCode, res.body).toBe(200);
    const content = res.json().data;
    // The customer side only: the staff side is nobody's public page.
    expect(content.sides.map((side: { appKey: string; path: string }) => `${side.appKey} ${side.path}`)).toEqual(['shop /apps/shop/customer/']);
    const files = content.sides[0].files as { path: string; bytes: number; sha256: string; text?: string }[];
    expect(files.map((file) => file.path)).toEqual(['assets/logo.png', 'index.html']);
    expect(files.find((file) => file.path === 'index.html')?.text).toBe(CUSTOMER_HTML);
    // A picture is listed by its size and hash, never sent as text.
    expect(files.find((file) => file.path === 'assets/logo.png')).toMatchObject({ bytes: 4 });
    expect(files.find((file) => file.path === 'assets/logo.png')?.text).toBeUndefined();
    expect(content.forms).toEqual([]);
  });
});

describe('a trial past its end date', () => {
  const ENDED = {
    ADMINIUM_TRIAL_MODE: 'on',
    ADMINIUM_TRIAL_ENDS_AT: '2020-01-01T00:00:00Z',
    ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
    ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
    ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
  };

  it('is read-only on the public listener, never on the operator’s', async () => {
    const served = await serve(await store('sqlite'), 'sqlite', { ...ENDED, ...OPERATOR() });
    // The public listener refuses a write, a delete included.
    const write = await served.composed.app.inject({ method: 'DELETE', url: '/api/v1/connections/00000000-0000-0000-0000-000000000000', headers: { host: ORIGIN_HOST } });
    expect(write.statusCode, write.body).toBe(403);
    expect(write.json().error).toMatchObject({ code: 'OFF_BY_OPERATOR', details: { question: 'writes' } });
    // The operator still hides and shows the public pages.
    const hide = await ask(served, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: true, reason: REASON } });
    expect(hide.statusCode, hide.body).toBe(200);
    const show = await ask(served, 'POST', '/api/v1/operator/public-pages', { payload: { hidden: false } });
    expect(show.statusCode, show.body).toBe(200);
  });
});
