// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE GATE OVER EVERY PUBLIC PAGE.
 *
 * The server's operator can hide every public page at once. That is worth as
 * much as the door it forgets, so no list of public paths decides it: every
 * route carries its audience from registration (`security/route-audience.ts`)
 * and the gate asks the route (`trial/public-pages.ts`).
 *
 *  - Every registered route of the widest server is tagged staff or public; a
 *    route without a tag fails here, and at run time counts as public.
 *  - While hidden, every public door answers 404 with the bare unavailable
 *    page and `noindex`, on every host, the user's own domains included:
 *    customer sides, forms and their loader and file uploads, the mail door,
 *    pay pages, the public API and its docs, a host mapped to the add-on pages.
 *  - Staff pages keep working, and the reason is never on a public page.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, translationsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildServer } from '../src/app.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const ORIGIN_HOST = 'hollis.try.example.com';
const OWN = 'shop.hollis.example';
const PAGES = 'forms.hollis.example';
const REASON = 'The page review found a sign-in form that looks like another company’s.';
const DASH_HTML = '<!doctype html><html><head><title>Adminium</title></head><body data-app="dashboard"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><head><title>Shop</title></head><body data-app="clients-customer"></body></html>';
const PAGE = { accept: 'text/html', 'sec-fetch-mode': 'navigate' };

let root: string;
let dist: string;
let surfaces: HostedSurface[];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'public-route-tags-'));
  dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), DASH_HTML);
  for (const side of ['customer', 'staff'] as const) {
    const dir = join(root, 'surfaces', 'clients', side);
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'index.html'), side === 'customer' ? CUSTOMER_HTML : CUSTOMER_HTML.replace('customer', 'staff'));
    await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
  }
  surfaces = discoverSurfaces(join(root, 'surfaces'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let open: { composed: ComposedServer; meta: MetaDb }[] = [];
afterEach(async () => {
  for (const { composed, meta } of open) {
    await composed.app.close();
    await meta.db.destroy();
  }
  open = [];
});

async function compose(env: Record<string, string>, opts: { project?: boolean; before?: (meta: MetaDb) => Promise<void> } = {}): Promise<{ composed: ComposedServer; meta: MetaDb }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await opts.before?.(meta);
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env })),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    staticRoot: dist,
    surfaces,
    ...(opts.project === true ? { project: { root: tmpdir(), mode: 'server' as const, log: () => undefined, warn: () => undefined } } : {}),
  });
  await composed.app.ready();
  open.push({ composed, meta });
  return { composed, meta };
}

/** Each topology registers routes the other does not: a desktop app's doors, a server's setup, the public API. */
const TOPOLOGIES: Record<string, Record<string, string>> = {
  'a server with the public API': { ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}` },
  'the desktop app with a bridge': { ADMINIUM_RUNTIME: 'desktop', ADMINIUM_BOOT_TOKEN: 'a'.repeat(64), ADMINIUM_BRIDGE_ORIGINS: 'https://adminium.dev' },
};

describe('every route says who it is for', { timeout: 120_000 }, () => {
  for (const [name, env] of Object.entries(TOPOLOGIES)) {
    it(`${name}: no route is untagged`, async () => {
      const { composed } = await compose(env, { project: true });
      const rows = composed.app.routeAudience.rows();
      // The sweep sees the server: a registry that recorded nothing would pass everything.
      expect(rows.length).toBeGreaterThan(400);
      const untagged = rows.filter((row) => row.audience === null).map((row) => `${row.method} ${row.url}`);
      expect(untagged).toEqual([]);
    });
  }

  it('the doors a stranger opens are public, and the instance’s own are staff', async () => {
    const { composed } = await compose(TOPOLOGIES['a server with the public API']!);
    const audience = new Map(composed.app.routeAudience.rows().map((row) => [`${row.method} ${row.url}`, row.audience]));
    for (const door of [
      'GET /apps/clients/customer/',
      'GET /apps/clients/customer/*',
      'GET /x/forms/:slug',
      'POST /x/forms/api/:slug/answers',
      'POST /x/forms/api/:slug/files',
      'GET /x/embed.js',
      'GET /m/u/*',
      'POST /m/u/*',
      'GET /pay/:token',
      'POST /pay/api/:token/checkout',
      'GET /api/v1/public/records/:ref',
      'POST /api/v1/public/uploads',
      'GET /api/v1/api-docs',
      'GET /api/v1/privacy/notice/public',
    ]) {
      expect(audience.get(door), door).toBe('public');
    }
    for (const door of [
      'GET /*',
      'GET /apps/clients/staff/',
      'POST /api/v1/auth/login',
      'GET /api/v1/system/info',
      'GET /api/v1/healthz',
      'GET /api/v1/branding',
      'GET /api/v1/bootstrap',
      'POST /api/v1/payments/webhook/:provider/:mode',
      'GET /ws',
    ]) {
      expect(audience.get(door), door).toBe('staff');
    }
  });

  it('a route nobody tagged counts as public: hidden with the rest', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    const reply = { response: { 200: z.object({ ok: z.boolean() }) } };
    app.get('/api/v1/nobody-said', { schema: reply }, async () => ({ ok: true }));
    app.get('/api/v1/staff-said', { schema: reply, config: { audience: 'staff' } }, async () => ({ ok: true }));
    await app.ready();
    try {
      expect(app.routeAudience.rows().find((row) => row.url === '/api/v1/nobody-said')?.audience).toBeNull();
      expect((await app.inject('/api/v1/nobody-said')).statusCode).toBe(200);
      await app.operatorHolds.setPublicPages({ hidden: true, reason: REASON });
      expect((await app.inject('/api/v1/nobody-said')).statusCode).toBe(404);
      expect((await app.inject('/api/v1/staff-said')).statusCode).toBe(200);
    } finally {
      await app.close();
      await meta.db.destroy();
    }
  });
});

describe('the page a hidden door answers with', () => {
  it('says the shipped words, never the instance’s own translation of them', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    app.get('/x/public-door', { schema: { response: { 200: z.object({ ok: z.boolean() }) } }, config: { audience: 'public' } }, async () => ({ ok: true }));
    await app.ready();
    try {
      // What a Super Admin's translation override stores (`PUT /i18n/keys`).
      await translationsRepo(meta).upsert(
        { locale: 'en_US', namespace: 'studio', key: 'surfacePages.hidden.title', value: 'We moved. Sign in at https://evil.example/login to keep your order.', sourceText: 'This page is unavailable.' },
        { updatedBy: null, at: Date.now() },
      );
      await app.operatorHolds.setPublicPages({ hidden: true, reason: REASON });
      const res = await app.inject({ url: '/x/public-door', headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' } });
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('This page is unavailable.');
      expect(res.body).not.toContain('evil.example');
    } finally {
      await app.close();
      await meta.db.destroy();
    }
  });
});

/** Every kind of public door, on the instance's own address or the user's domain. */
const DOORS: { name: string; method?: 'GET' | 'POST'; url: string; host?: string }[] = [
  { name: 'a customer side', url: '/apps/clients/customer/' },
  { name: 'a customer side’s file', url: '/apps/clients/customer/assets/app.js' },
  { name: 'a customer side on its own domain', url: '/', host: OWN },
  { name: 'a deep link on its own domain', url: '/menu/today', host: OWN },
  { name: 'the public API on the own domain', url: '/api/v1/public/config', host: OWN },
  { name: 'the add-on pages’ domain', url: '/x/forms/spring-offer', host: PAGES },
  { name: 'a form', url: '/x/forms/spring-offer' },
  { name: 'a form’s answers', method: 'POST', url: '/x/forms/api/spring-offer/answers' },
  { name: 'a form’s file upload', method: 'POST', url: '/x/forms/api/spring-offer/files' },
  { name: 'the website loader', url: '/x/embed.js' },
  { name: 'the mail door', url: '/m/u/not-a-token' },
  { name: 'a survey link', url: '/m/l/not-a-token' },
  { name: 'a pay page', url: '/pay/not-a-token' },
  { name: 'a payment link’s checkout', method: 'POST', url: '/pay/api/not-a-token/checkout' },
  { name: 'the public API', url: '/api/v1/public/config' },
  { name: 'a guest’s files', url: '/api/v1/public/files/orders/1/photo' },
  { name: 'the public API docs', url: '/api/v1/api-docs' },
  { name: 'the privacy notice strangers read', url: '/api/v1/privacy/notice/public' },
];

/** Staff pages, which keep working while the public ones are hidden. */
const STAFF: { name: string; url: string; status: number }[] = [
  { name: 'the dashboard', url: '/', status: 200 },
  { name: 'a Studio deep link', url: '/studio/settings', status: 200 },
  { name: 'the sign-in page', url: '/login', status: 200 },
  // Its own gate answers, as always: a stranger is sent to sign in.
  { name: 'a staff side', url: '/apps/clients/staff/', status: 302 },
  { name: 'system info', url: '/api/v1/system/info', status: 200 },
  { name: 'the health check', url: '/api/v1/healthz', status: 200 },
  { name: 'the sign-in branding', url: '/api/v1/branding', status: 200 },
];

const mapDomains = async (meta: MetaDb) => {
  await settingsRepo(meta).set('surfaces.domains', { [OWN]: { appKey: 'clients', side: 'customer' } }, { updatedBy: null });
  await settingsRepo(meta).set('surfaces.pageHosts', { [PAGES]: { home: '/x/forms/spring-offer' } }, { updatedBy: null });
  await settingsRepo(meta).set('branding.appName', 'Hollis Bakery', { updatedBy: null });
  await settingsRepo(meta).set('publicApi.enabled', true, { updatedBy: null });
};

for (const [profile, env] of Object.entries({
  'an ordinary server': { ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}` },
  'trial mode on the operator’s addresses': {
    ADMINIUM_TRIAL_MODE: 'on',
    ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
    ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
    ADMINIUM_OPERATOR_DOMAINS: `${OWN},${PAGES}`,
    ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
    ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token',
    ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis',
    ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}`,
  },
})) {
  describe(`while hidden: ${profile}`, { timeout: 120_000 }, () => {
    const home = 'ADMINIUM_PUBLIC_ORIGIN' in env ? ORIGIN_HOST : 'localhost';

    it('every public door answers 404 with the bare unavailable page, on every host; staff pages work', async () => {
      const { composed } = await compose(env, { before: mapDomains });
      const { app } = composed;
      const call = (method: 'GET' | 'POST', url: string, host: string, headers: Record<string, string> = PAGE) => app.inject({ method, url, headers: { host, ...headers }, ...(method === 'POST' ? { payload: {} } : {}) });

      // Before: a door answers as it always does (whatever that is, not the hidden page).
      const before = await call('GET', '/apps/clients/customer/', home);
      expect(before.statusCode).toBe(200);
      expect(before.body).toContain('clients-customer');

      await app.operatorHolds.setPublicPages({ hidden: true, reason: REASON });
      for (const door of DOORS) {
        const host = door.host ?? home;
        const res = await call(door.method ?? 'GET', door.url, host);
        expect(res.statusCode, `${door.name}: ${res.body.slice(0, 160)}`).toBe(404);
        expect(res.headers['x-robots-tag'], door.name).toMatch(/noindex/);
        expect(res.headers['cache-control'], door.name).toBe('no-store');
        expect(res.body, door.name).not.toContain(REASON);
        if ((door.method ?? 'GET') === 'GET' && !door.url.startsWith('/api/')) {
          // A browser gets the page: the instance's own name, one sentence, no platform.
          expect(res.headers['content-type'], door.name).toMatch(/^text\/html/);
          expect(res.body, door.name).toContain('This page is unavailable.');
          expect(res.body, door.name).toContain('Hollis Bakery');
          expect(res.body, door.name).toContain('<meta name="robots" content="noindex');
          expect(res.body, door.name).not.toMatch(/adminium/i);
          expect(res.body, door.name).not.toContain('<script');
        } else {
          expect(res.json(), door.name).toMatchObject({ error: { code: 'NOT_FOUND' } });
        }
      }
      // A script or a stylesheet a hidden page asks for gets the envelope, not a page.
      const asset = await call('GET', '/apps/clients/customer/assets/app.js', home, { accept: '*/*', 'sec-fetch-mode': 'no-cors' });
      expect(asset.statusCode).toBe(404);
      expect(asset.headers['content-type']).toMatch(/json/);

      for (const page of STAFF) {
        const res = await call('GET', page.url, home);
        expect(res.statusCode, `${page.name}: ${res.body.slice(0, 160)}`).toBe(page.status);
        expect(res.body, page.name).not.toContain('This page is unavailable.');
      }

      // Shown again: every door is back.
      await app.operatorHolds.setPublicPages({ hidden: false, reason: null });
      const after = await call('GET', '/apps/clients/customer/', home);
      expect(after.statusCode).toBe(200);
      expect(after.body).toContain('clients-customer');
    });

    it('without a name of its own, the page says the sentence alone', async () => {
      const { composed } = await compose(env);
      await composed.app.operatorHolds.setPublicPages({ hidden: true, reason: REASON });
      const res = await composed.app.inject({ method: 'GET', url: '/x/forms/spring-offer', headers: { host: home, ...PAGE } });
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('This page is unavailable.');
      expect(res.body).not.toContain('class="venue"');
      expect(res.body).not.toMatch(/adminium/i);
    });
  });
}

describe('Studio is told', () => {
  it('the bootstrap carries the reason while hidden, and nothing while shown', async () => {
    const { composed, meta } = await compose({});
    const { app } = composed;
    const { createFirstSuperAdmin } = await import('@adminium/meta');
    const { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } = await import('./auth-helpers.js');
    await createFirstSuperAdmin(meta, { email: 'dana@hollis.test', name: 'Dana Price', passwordHash: await adminPasswordHash() });
    const signIn = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'dana@hollis.test', password: ADMIN_PASSWORD } });
    const cookie = sessionCookie(signIn.headers['set-cookie']);
    const bootstrap = async () => (await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } })).json().data;
    expect((await bootstrap()).publicPagesHidden).toBeUndefined();
    await app.operatorHolds.setPublicPages({ hidden: true, reason: REASON });
    expect((await bootstrap()).publicPagesHidden).toEqual({ reason: REASON });
  });
});
