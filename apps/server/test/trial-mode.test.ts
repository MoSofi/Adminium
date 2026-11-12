// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trial mode, one switch at a time: each section proves its switch OFF under
 * `ADMINIUM_TRIAL_MODE=on`, as the hosted profile has it, and as an ordinary
 * server has it, on a whole composed server.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { linkOrigin } from '../src/security/public-origin.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const PASSWORD = 'a-long-enough-test-password-1!';
const SETUP_TOKEN = 'a-long-enough-setup-token';

/** The operator's address for the instance, and two of the user's own verified domains. */
const ORIGIN_HOST = 'hollis.try.example.com';
const OWN = 'shop.hollis.example';
const OWN_TOO = 'www.hollis.example';

const TRIAL = {
  ADMINIUM_TRIAL_MODE: 'on',
  ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
  ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
};
const HOSTED = { ADMINIUM_HOSTED_MODE: 'on', ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`, ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432' };
const ORDINARY = {};
/** The public API registered, so its namespace answers too. */
const PUBLIC_API = { ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}` };

const NOINDEX = 'noindex, nofollow';
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const DASH_HTML = '<!doctype html><html><head><title>Adminium</title></head><body data-app="dashboard"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title></head><body data-app="clients-customer"></body></html>';
const SURFACE_ROBOTS = 'User-agent: *\nAllow: /\n';

let root: string;
let surfaces: HostedSurface[];
let dist: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'trial-mode-'));
  dist = join(root, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'index.html'), DASH_HTML);
  for (const side of ['customer', 'staff'] as const) {
    const dir = join(root, 'surfaces', 'clients', side);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), side === 'customer' ? CUSTOMER_HTML : CUSTOMER_HTML.replace('customer', 'staff'));
    await writeFile(join(dir, 'robots.txt'), SURFACE_ROBOTS);
  }
  surfaces = discoverSurfaces(join(root, 'surfaces'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let composed: ComposedServer | undefined;
let meta: MetaDb | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  await meta?.db.destroy();
  meta = undefined;
});

interface Answer {
  status: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => Record<string, unknown>;
}

interface CallOptions {
  host?: string;
  headers?: Record<string, string>;
  payload?: unknown;
  remoteAddress?: string;
  /** Without the first Super Admin's session. */
  anonymous?: boolean;
}

interface Server {
  meta: MetaDb;
  call(method: 'GET' | 'HEAD' | 'POST' | 'PUT', url: string, opts?: CallOptions): Promise<Answer>;
}

/** A composed server on `env`, with a dashboard build and one app's two sides, and its first Super Admin signed in. */
async function serve(env: Record<string, string>, before?: (store: MetaDb) => Promise<void>): Promise<Server> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  await before?.(store);
  // As the boot reads it: what the profile implies is enforced.
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  // The name a browser reaches it by: the operator's address, else the first listed domain.
  const home = env['ADMINIUM_PUBLIC_ORIGIN'] === undefined ? (env['ADMINIUM_OPERATOR_DOMAINS']?.split(',')[0] ?? ORIGIN_HOST) : new URL(env['ADMINIUM_PUBLIC_ORIGIN']).host;
  composed = await composeServer({
    env: parsed,
    metaStore,
    manager: new ConnectionManager({ meta: store, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null, blockLoopback: true, databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS }),
    runService,
    applyService: createApplyService({ meta: store, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    staticRoot: dist,
    surfaces,
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    // A browser on the instance's own address: the request a first-run capture would learn from.
    headers: { host: home, origin: `https://${home}` },
    payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    meta: store,
    call: async (method, url, opts = {}) => {
      const res = await app.inject({
        method,
        url,
        headers: { host: opts.host ?? home, ...(opts.anonymous === true ? {} : { cookie }), ...opts.headers },
        ...(opts.remoteAddress === undefined ? {} : { remoteAddress: opts.remoteAddress }),
        ...(opts.payload === undefined ? {} : { payload: opts.payload as object }),
      });
      return { status: res.statusCode, body: res.body, headers: res.headers, json: () => res.json() };
    },
  };
}

/** The user's own domain mapped to the app's customer side, before the boot. */
const mapOwnDomain = async (store: MetaDb) => {
  await settingsRepo(store).set('surfaces.domains', { [OWN]: { appKey: 'clients', side: 'customer' } }, { updatedBy: null });
};

/** Every kind of public door, and a staff page or two: a stranger's view of each. */
const DOORS: { name: string; url: string; host?: string }[] = [
  { name: 'the dashboard', url: '/' },
  { name: 'a customer side', url: '/apps/clients/customer/' },
  { name: 'a customer side on its own domain', url: '/', host: OWN },
  { name: 'a form', url: '/x/forms/spring-offer' },
  { name: 'the website loader', url: '/x/embed.js' },
  { name: 'the mail door', url: '/m/u/not-a-token' },
  { name: 'the public API', url: '/api/v1/public/nothing-here' },
  { name: 'the public API docs', url: '/api/v1/api-docs' },
  { name: 'a staff route', url: '/api/v1/system/info' },
  { name: 'an address nobody has', url: '/nowhere/at-all' },
];

describe('A4 public pages are hidden from search engines', { timeout: 60_000 }, () => {
  it('in trial mode: X-Robots-Tag on every response, the robots meta tag on every page, robots.txt disallows all', async () => {
    const s = await serve({ ...TRIAL, ADMINIUM_OPERATOR_DOMAINS: OWN, ...PUBLIC_API }, mapOwnDomain);
    for (const door of DOORS) {
      const res = await s.call('GET', door.url, { anonymous: true, headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' }, ...(door.host === undefined ? {} : { host: door.host }) });
      expect(res.status, `${door.name}: ${res.body.slice(0, 200)}`).not.toBe(421);
      expect(res.headers['x-robots-tag'], door.name).toBe(NOINDEX);
      if (String(res.headers['content-type']).startsWith('text/html')) {
        expect(res.body, door.name).toContain(ROBOTS_META);
        // Once, in the head.
        expect(res.body.split('name="robots"').length - 1, door.name).toBe(1);
        expect(res.body.indexOf(ROBOTS_META), door.name).toBeLessThan(res.body.search(/<\/head>|<body/i));
      }
    }
    // The pages that are HTML are read as pages, the dashboard and the customer side among them.
    expect((await s.call('GET', '/', { anonymous: true })).body).toContain(ROBOTS_META);
    expect((await s.call('GET', '/apps/clients/customer/', { anonymous: true })).body).toContain(ROBOTS_META);

    for (const host of [ORIGIN_HOST, OWN]) {
      const robots = await s.call('GET', '/robots.txt', { anonymous: true, host });
      expect(robots.status, host).toBe(200);
      expect(robots.headers['content-type'], host).toMatch(/^text\/plain/);
      // Over the app's own robots.txt on its domain, too.
      expect(robots.body, host).toBe('User-agent: *\nDisallow: /\n');
    }
  });

  for (const [profile, env] of [
    ['hosted', { ...HOSTED, ADMINIUM_OPERATOR_DOMAINS: OWN }],
    ['ordinary', ORDINARY],
  ] as const) {
    it(`on a ${profile} server: no noindex, and the app's own robots.txt`, async () => {
      const s = await serve({ ...env, ...PUBLIC_API }, mapOwnDomain);
      for (const door of DOORS) {
        const res = await s.call('GET', door.url, { anonymous: true, ...(door.host === undefined ? {} : { host: door.host }) });
        expect(res.headers['x-robots-tag'], door.name).not.toBe(NOINDEX);
        expect(res.body, door.name).not.toContain(ROBOTS_META);
      }
      const robots = await s.call('GET', '/robots.txt', { anonymous: true, host: OWN });
      expect(robots.body).toBe(SURFACE_ROBOTS);
    });
  }
});

describe("A4 the address in email links is the operator's", { timeout: 60_000 }, () => {
  const LOCK = { trial: { allowed: false, reason: 'trial-mode' }, hosted: { allowed: false, reason: 'hosted-mode' }, ordinary: { allowed: false, reason: 'not-allowed' } };

  for (const [profile, env] of [
    ['trial', TRIAL],
    ['hosted', HOSTED],
  ] as const) {
    it(`${profile}: ADMINIUM_PUBLIC_ORIGIN, held over what was stored, read-only, a change refused`, async () => {
      // A value saved before the operator set the server up this way.
      const s = await serve(env, async (store) => {
        await settingsRepo(store).set('system.publicOrigin', 'https://evil.example', { updatedBy: null });
      });
      expect(await settingsRepo(s.meta).get('system.publicOrigin')).toBe(`https://${ORIGIN_HOST}`);

      const view = await s.call('GET', '/api/v1/settings/email');
      expect(view.status, view.body).toBe(200);
      expect(view.json()['data']).toMatchObject({ publicOrigin: `https://${ORIGIN_HOST}`, locks: { publicOrigin: LOCK[profile] } });

      for (const publicOrigin of ['https://evil.example', null]) {
        const refused = await s.call('PUT', '/api/v1/settings/email', { payload: { publicOrigin } });
        expect(refused.status, refused.body).toBe(409);
        expect(refused.json()['error']).toMatchObject({ code: 'SET_BY_OPERATOR', details: { setting: 'system.publicOrigin', reason: LOCK[profile].reason } });
      }
      expect(await settingsRepo(s.meta).get('system.publicOrigin')).toBe(`https://${ORIGIN_HOST}`);
      // The value it is locked to is no change, so a page that saves a whole section still saves.
      expect((await s.call('PUT', '/api/v1/settings/email', { payload: { publicOrigin: `https://${ORIGIN_HOST}`, maxAttachmentBytes: 5_000_000 } })).status).toBe(200);

      // Links in email follow the lock, whatever the row says and whatever host a request names.
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://evil.example', { updatedBy: null });
      expect(await linkOrigin(s.meta, { protocol: 'https', host: 'evil.example', hostname: 'evil.example' })).toBe(`https://${ORIGIN_HOST}`);
    });
  }

  it('the first listed domain is the origin, and setup does not capture the browser’s', async () => {
    // Setup runs on the operator's address with a browser Origin there; the lock names the user's own domain.
    const s = await serve({ ...TRIAL, ADMINIUM_OPERATOR_DOMAINS: `${OWN},${OWN_TOO}` });
    expect(await settingsRepo(s.meta).get('system.publicOrigin')).toBe(`https://${OWN}`);
    expect((await s.call('GET', '/api/v1/settings/email')).json()['data']).toMatchObject({ publicOrigin: `https://${OWN}` });
  });

  it('an ordinary server with ADMINIUM_OPERATOR_DOMAINS keeps the lock too', async () => {
    const s = await serve({ ADMINIUM_OPERATOR_DOMAINS: OWN });
    expect(await settingsRepo(s.meta).get('system.publicOrigin')).toBe(`https://${OWN}`);
    expect((await s.call('GET', '/api/v1/settings/email', { host: OWN })).json()['data']).toMatchObject({ locks: { publicOrigin: LOCK.ordinary } });
    expect((await s.call('PUT', '/api/v1/settings/email', { host: OWN, payload: { publicOrigin: 'https://evil.example' } })).status).toBe(409);
  });

  it('an ordinary server: the Super Admin sets it, and setup learns it', async () => {
    const s = await serve(ORDINARY);
    // Learned from the setup request's browser.
    expect(await settingsRepo(s.meta).get('system.publicOrigin')).toBe(`https://${ORIGIN_HOST}`);
    expect((await s.call('GET', '/api/v1/settings/email')).json()['data']).toMatchObject({ locks: { publicOrigin: { allowed: true, reason: null } } });
    const saved = await s.call('PUT', '/api/v1/settings/email', { payload: { publicOrigin: 'https://admin.hollis.example' } });
    expect(saved.status, saved.body).toBe(200);
    expect(await settingsRepo(s.meta).get('system.publicOrigin')).toBe('https://admin.hollis.example');
  });
});

describe('A4 the instance answers only on its own addresses', { timeout: 60_000 }, () => {
  for (const [profile, env] of [
    ['trial', TRIAL],
    ['hosted', HOSTED],
  ] as const) {
    it(`${profile}: any other Host is a 421, the health checks answer everywhere`, async () => {
      const s = await serve({ ...env, ADMINIUM_OPERATOR_DOMAINS: `${OWN},${OWN_TOO}` });
      for (const host of [ORIGIN_HOST, `${ORIGIN_HOST}:443`, OWN, OWN_TOO.toUpperCase(), `${OWN}.`]) {
        expect((await s.call('GET', '/api/v1/system/info', { host })).status, host).toBe(200);
      }
      for (const host of ['evil.example', `${ORIGIN_HOST}.evil.example`, 'localhost:4600', '127.0.0.1', '[::1]:4600', '']) {
        for (const [method, url] of [
          ['GET', '/'],
          ['GET', '/api/v1/system/info'],
          ['POST', '/api/v1/auth/login'],
          ['GET', '/x/forms/spring-offer'],
          ['GET', '/robots.txt'],
        ] as const) {
          const res = await s.call(method, url, { host, anonymous: true, ...(method === 'POST' ? { payload: { email: 'a@b.c', password: 'x' } } : {}) });
          expect(res.status, `${host} ${method} ${url}`).toBe(421);
        }
      }
      // An orchestrator's probe dials the container by its address.
      expect((await s.call('GET', '/api/v1/healthz', { host: '10.0.0.7:4600', anonymous: true })).status).toBe(200);
      expect((await s.call('GET', '/api/v1/readyz', { host: 'localhost:4600', anonymous: true })).status).not.toBe(421);
    });
  }

  it('behind a trusted proxy the forwarded host decides, whatever Host the proxy writes', async () => {
    const s = await serve({ ...TRIAL, ADMINIUM_TRUST_PROXY: 'on' });
    const via = (host: string, forwarded: string) => s.call('GET', '/api/v1/system/info', { host, remoteAddress: '127.0.0.1', headers: { 'x-forwarded-host': forwarded } });
    expect((await via(ORIGIN_HOST, 'evil.example')).status).toBe(421);
    expect((await via('upstream:4600', ORIGIN_HOST)).status).toBe(200);
    // From a peer that is not the proxy, the header is nobody's word.
    expect((await s.call('GET', '/api/v1/system/info', { host: 'evil.example', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-host': ORIGIN_HOST } })).status).toBe(421);
  });

  it('ADMINIUM_OPERATOR_DOMAINS without trial mode: the same hosts', async () => {
    const s = await serve({ ADMINIUM_OPERATOR_DOMAINS: OWN });
    expect((await s.call('GET', '/api/v1/system/info', { host: OWN })).status).toBe(200);
    expect((await s.call('GET', '/api/v1/system/info', { host: 'evil.example' })).status).toBe(421);
  });

  it('an ordinary server answers any Host, as before', async () => {
    const s = await serve(ORDINARY);
    for (const host of ['evil.example', 'localhost:4600', '192.168.1.20:4600']) {
      expect((await s.call('GET', '/api/v1/system/info', { host })).status, host).toBe(200);
    }
  });
});

describe('A4 mapped domains come from the operator’s list only', { timeout: 60_000 }, () => {
  const map = (s: Server, host: string) => s.call('PUT', '/api/v1/surfaces/domains', { payload: { domains: { [host]: { appKey: 'clients', side: 'customer' } } } });
  const listWebsite = (s: Server, origin: string) => s.call('POST', '/api/v1/privacy/websites', { payload: { lines: [origin] } });

  for (const [profile, env, reason] of [
    ['trial', TRIAL, 'trial-mode'],
    ['hosted', HOSTED, 'hosted-mode'],
    ['ordinary with ADMINIUM_OPERATOR_DOMAINS', ORDINARY, 'not-allowed'],
  ] as const) {
    it(`${profile}: a listed domain maps, any other is refused`, async () => {
      const s = await serve({ ...env, ADMINIUM_OPERATOR_DOMAINS: `${OWN},${OWN_TOO}` }, async (store) => {
        // Mapped before the operator listed the domains: it never answers.
        await settingsRepo(store).set('surfaces.domains', { 'old.hollis.example': { appKey: 'clients', side: 'customer' } }, { updatedBy: null });
      });
      const refused = await map(s, 'evil.example');
      expect(refused.status, refused.body).toBe(403);
      expect(refused.json()['error']).toMatchObject({ code: 'FORBIDDEN', details: { reason, hosts: ['evil.example'] } });
      expect((await map(s, OWN_TOO)).status).toBe(200);
      expect((await s.call('GET', '/', { host: 'old.hollis.example', anonymous: true })).status).toBe(421);
    });
  }

  it('trial: a website that frames forms must be one of the listed domains', async () => {
    const s = await serve({ ...TRIAL, ADMINIUM_OPERATOR_DOMAINS: `${OWN},${OWN_TOO}` });
    const refused = await listWebsite(s, 'https://evil.example');
    expect(refused.status, refused.body).toBe(403);
    expect(refused.json()['error']).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'trial-mode', origins: ['https://evil.example'] } });
    expect((await listWebsite(s, `https://${OWN_TOO}`)).status).toBe(200);
  });

  it('an ordinary server maps and lists any domain, as before', async () => {
    const s = await serve(ORDINARY);
    expect((await map(s, 'shop.anywhere.example')).status).toBe(200);
    expect((await listWebsite(s, 'https://shop.anywhere.example')).status).toBe(200);
  });
});

describe('A4 pay pages and payment webhooks', { timeout: 60_000 }, () => {
  const pay = (s: Server) => s.call('GET', '/pay/not-a-real-token', { anonymous: true });
  const webhook = (s: Server) => s.call('POST', '/api/v1/payments/webhook/stripe/live', { anonymous: true, headers: { 'content-type': 'application/json' }, payload: '{}' });

  it('trial: both refused', async () => {
    const s = await serve(TRIAL);
    for (const res of [await pay(s), await webhook(s)]) {
      expect(res.status, res.body).toBe(403);
      expect(res.json()['error']).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'trial-mode' } });
    }
  });

  for (const [profile, env] of [
    ['hosted', HOSTED],
    ['ordinary', ORDINARY],
  ] as const) {
    it(`${profile}: both reach their routes`, async () => {
      const s = await serve(env);
      expect((await pay(s)).status).not.toBe(403);
      expect((await webhook(s)).status).not.toBe(403);
    });
  }
});
