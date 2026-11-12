// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Trial mode's switches, one `describe` each: every switch OFF under
 * `ADMINIUM_TRIAL_MODE=on`, ON without it, and as the hosted profile keeps or
 * drops it. Proved on a whole composed server wherever a route is the door,
 * and on the hook itself where the door is a job or a client.
 *
 * Connections (A1), storage (A1b), outgoing traffic and AI (A2), and the
 * operator's addresses and public pages (A4).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { llmKeyCryptoFromSecret, ProviderError, type ProviderClient } from '@adminium/llm';
import { createSqliteMetaDb, firstRun, settingsRepo, type Automation, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ActionFailure, type ActionContext } from '../src/automations/actions/types.js';
import { runWebhookAction } from '../src/automations/actions/webhook.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { resolveRule } from '../src/automations/validate.js';
import { createAddOnHttpClient, AddOnEgressError } from '../src/add-ons/egress.js';
import { openRuntime } from '../src/cli/runtime.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile, type Env } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { createAiEnv } from '../src/llm/ai-env.js';
import { createAiConnections } from '../src/llm/connections.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { guardBootMetaUrl, MetaUrlError, type MetaStoreHandle } from '../src/meta/store.js';
import type { HostLookup } from '../src/net/address-guard.js';
import { linkOrigin } from '../src/security/public-origin.js';
import { trialPolicy } from '../src/trial/policy.js';
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
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543',
  ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
  ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis',
};
const HOSTED = {
  ADMINIUM_HOSTED_MODE: 'on',
  ADMINIUM_PUBLIC_ORIGIN: `https://${ORIGIN_HOST}`,
  ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543',
  ADMINIUM_SOURCE_URL: 'postgres://trial_hollis:secret@pg-trials:5432/trial_hollis',
};
/** An ordinary server with the same host list, so only the profile differs. */
const ORDINARY = { ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432,*.pooler.supabase.com:6543' };
/** The public API registered, so its namespace answers too. */
const PUBLIC_API = { ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}` };

/** No name resolves: a DSN that gets past the profile ends at the lookup (502), never at a database. */
const NOTHING_RESOLVES: HostLookup = async () => Promise.reject(new Error('ENOTFOUND'));

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
/** Close the server a case made, before it makes the next one. */
async function closeServer(): Promise<void> {
  await composed?.app.close();
  composed = undefined;
}
afterEach(async () => {
  await closeServer();
  await meta?.db.destroy();
  meta = undefined;
});

type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH';

interface Answer {
  status: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => Record<string, unknown>;
}

/** An API answer, its body read as JSON. */
interface Reply {
  status: number;
  body: Record<string, unknown>;
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
  env: Env;
  /** Any request, on the instance's own address and as the first Super Admin unless `opts` says otherwise. */
  call(method: Method, url: string, opts?: CallOptions): Promise<Answer>;
  /** An API call as the first Super Admin, once there is one; anonymous before. */
  api(method: Method, url: string, payload?: unknown): Promise<Reply>;
}

interface ServeOptions {
  /** Run on the meta store before the server boots. */
  before?: (store: MetaDb) => Promise<void>;
  /** False: no first account, so every call is anonymous. */
  account?: boolean;
}

/**
 * A composed server on `env`, its manager built as the boot builds it, with a
 * dashboard build and one app's two sides; its first Super Admin signed in
 * unless `account` is false.
 */
async function serve(env: Record<string, string>, opts: ServeOptions = {}): Promise<Server> {
  const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  meta = store;
  await firstRun(store);
  await opts.before?.(store);
  // As the boot reads it: what the profile implies is enforced.
  const parsed = enforceProfile(makeEnv({ HOST: '127.0.0.1', ...env }));
  const runService = createRunService({ meta: store });
  const metaStore: MetaStoreHandle = { meta: store, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  // The name a browser reaches it by: the operator's address, else the first listed domain.
  const home = env['ADMINIUM_PUBLIC_ORIGIN'] === undefined ? (env['ADMINIUM_OPERATOR_DOMAINS']?.split(',')[0] ?? ORIGIN_HOST) : new URL(env['ADMINIUM_PUBLIC_ORIGIN']).host;
  composed = await composeServer({
    env: parsed,
    metaStore,
    // As `openRuntime` builds it: the profile, the host list and the operator's login.
    manager: new ConnectionManager({
      meta: store,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
      blockLoopback: true,
      databaseHosts: parsed.ADMINIUM_DATABASE_HOSTS,
      networkPolicy: parsed.ADMINIUM_NETWORK_POLICY,
      lookup: NOTHING_RESOLVES,
      policy: trialPolicy(parsed),
      operatorSourceUrl: parsed.ADMINIUM_SOURCE_URL,
    }),
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
  let cookie = '';
  if (opts.account !== false) {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      // A browser on the instance's own address: the request a first-run capture would learn from.
      headers: { host: home, origin: `https://${home}` },
      payload: { email: 'owner@example.test', password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  }
  const call: Server['call'] = async (method, url, callOpts = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { host: callOpts.host ?? home, ...(callOpts.anonymous === true || cookie === '' ? {} : { cookie }), ...callOpts.headers },
      ...(callOpts.remoteAddress === undefined ? {} : { remoteAddress: callOpts.remoteAddress }),
      ...(callOpts.payload === undefined ? {} : { payload: callOpts.payload as object }),
    });
    return { status: res.statusCode, body: res.body, headers: res.headers, json: () => res.json() };
  };
  return {
    meta: store,
    env: parsed,
    call,
    api: async (method, url, payload) => {
      const res = await call(method, url, payload === undefined ? {} : { payload });
      return { status: res.status, body: res.json() };
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
    const s = await serve({ ...TRIAL, ADMINIUM_OPERATOR_DOMAINS: OWN, ...PUBLIC_API }, { before: mapOwnDomain });
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
      const s = await serve({ ...env, ...PUBLIC_API }, { before: mapOwnDomain });
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
      const s = await serve(env, {
        before: async (store) => {
          await settingsRepo(store).set('system.publicOrigin', 'https://evil.example', { updatedBy: null });
        },
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
      const s = await serve(
        { ...env, ADMINIUM_OPERATOR_DOMAINS: `${OWN},${OWN_TOO}` },
        {
          before: async (store) => {
            // Mapped before the operator listed the domains: it never answers.
            await settingsRepo(store).set('surfaces.domains', { 'old.hollis.example': { appKey: 'clients', side: 'customer' } }, { updatedBy: null });
          },
        },
      );
      const refused = await map(s, 'evil.example');
      expect(refused.status, refused.body).toBe(403);
      expect(refused.json()['error']).toMatchObject({ code: 'FORBIDDEN', details: { reason, hosts: ['evil.example'] } });
      // The first listed domain is where links in email point: Studio and the reset page stay there.
      expect((await map(s, OWN)).status).toBe(403);
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

const offBy = (question: string, reason = 'trial-mode') => ({ error: { code: 'OFF_BY_OPERATOR', details: { question, reason } } });
const code = (reply: Reply): unknown => (reply.body['error'] as { code?: unknown } | undefined)?.code;

// ── A1 connections ─────────────────────────────────────────────────────────

describe('A1 connections', { timeout: 60_000 }, () => {
  const test = (s: Server, engine: string, dsn: string) => s.api('POST', '/api/v1/connections/test', { engine, dsn });

  it('a SQLite source: refused in trial mode and the hosted profile, opened as before on an ordinary server', async () => {
    for (const [env, reason] of [
      [TRIAL, 'trial-mode'],
      [HOSTED, 'hosted-mode'],
    ] as const) {
      const s = await serve(env);
      const refused = await test(s, 'sqlite', 'sqlite:/tmp/p75-t11-anything.db');
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject(offBy('sqliteSources', reason));
      // Said before anyone signs in, so the connect wizards draw the choice disabled with the reason.
      expect((await s.api('GET', '/api/v1/system/info')).body).toMatchObject({ offByOperator: { sqliteSources: { allowed: false, reason }, metaStore: { allowed: false, reason } } });
      // The other front door, saving one, is the same guard.
      expect((await s.api('POST', '/api/v1/connections', { name: 'Local', engine: 'sqlite', dsn: 'sqlite:/tmp/p75-t11-anything.db' })).body).toMatchObject(offBy('sqliteSources', reason));
      await closeServer();
    }
    const open = await test(await serve(ORDINARY), 'sqlite', 'sqlite:/tmp/p75-t11-missing.db');
    expect(code(open)).not.toBe('OFF_BY_OPERATOR');
  });

  it('a host not on the list: refused in trial mode before any lookup; an ordinary server looks it up', async () => {
    const trial = await serve(TRIAL);
    expect((await test(trial, 'postgres', 'postgres://me:pw@db.elsewhere.example:5432/shop')).body).toMatchObject(offBy('unlistedDatabaseHosts'));
    // MySQL passes only through a listed entry that takes MySQL: this list names Postgres's port.
    expect((await test(trial, 'mysql', 'mysql://trial_hollis:pw@pg-trials:3306/trial_hollis')).body).toMatchObject(offBy('unlistedDatabaseHosts'));
    await closeServer();

    const open = await test(await serve(ORDINARY), 'postgres', 'postgres://me:pw@db.elsewhere.example:5432/shop');
    expect(open.status).toBe(502);
    expect(code(open)).toBe('HOST_LOOKUP_FAILED');
  });

  it('on an operator host only the operator\'s login: another refused in trial mode, the person\'s own Supabase project left alone', async () => {
    const trial = await serve(TRIAL);
    for (const dsn of [
      'postgres://trial_other:pw@pg-trials:5432/trial_other',
      'postgres://trial_hollis:pw@pg-trials:5432/trial_other',
      'postgres://postgres:pw@pg-trials:5432/trial_hollis',
    ]) {
      expect((await test(trial, 'postgres', dsn)).body, dsn).toMatchObject(offBy('anyDatabaseLogin'));
    }
    // The operator's own login (any password: the database checks that) passes on to the lookup.
    expect(code(await test(trial, 'postgres', 'postgres://trial_hollis:typed@pg-trials:5432/trial_hollis'))).toBe('HOST_LOOKUP_FAILED');
    // A Supabase pooler on the list is the person's own project: any login of theirs.
    expect(code(await test(trial, 'postgres', 'postgres://postgres.abcd:pw@aws-0-eu.pooler.supabase.com:6543/postgres'))).toBe('HOST_LOOKUP_FAILED');
    await closeServer();

    const open = await serve(ORDINARY);
    expect(code(await test(open, 'postgres', 'postgres://trial_other:pw@pg-trials:5432/trial_other'))).toBe('HOST_LOOKUP_FAILED');
  });

  it('connection tests: one budget for the whole installation in trial mode, none on an ordinary server', async () => {
    const trial = await serve(TRIAL);
    for (let i = 0; i < 10; i += 1) expect((await test(trial, 'postgres', 'postgres://trial_hollis:pw@pg-trials:5432/trial_hollis')).status).toBe(502);
    const limited = await test(trial, 'postgres', 'postgres://trial_hollis:pw@pg-trials:5432/trial_hollis');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: { code: 'RATE_LIMITED', details: { scope: 'instance', limit: 10 } } });
    await closeServer();

    const open = await serve(ORDINARY);
    for (let i = 0; i < 11; i += 1) expect((await test(open, 'postgres', 'postgres://trial_hollis:pw@pg-trials:5432/trial_hollis')).status).toBe(502);
  });

  it('the meta store is fixed: relocate, probe and adopt answer 403 in trial mode, the setup token opening none of them', async () => {
    // Before the first account, with the right token: the token is the trial user's, so it must not open these.
    const fresh = await serve(TRIAL, { account: false });
    const dsn = 'postgres://u:p@pg-trials:5432/other';
    expect(await fresh.api('POST', '/api/v1/setup/probe', { dsn, setupToken: SETUP_TOKEN })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes') });
    expect(await fresh.api('POST', '/api/v1/setup/adopt', { dsn, setupToken: SETUP_TOKEN })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes') });
    await closeServer();

    const trial = await serve(TRIAL);
    expect(await trial.api('POST', '/api/v1/meta/relocate', { dsn })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes') });
    expect((await trial.api('GET', '/api/v1/meta/placement')).body).toMatchObject({ data: { canRelocate: false, reason: expect.stringContaining('operator') } });
    await closeServer();

    const hosted = await serve(HOSTED, { account: false });
    expect(await hosted.api('POST', '/api/v1/setup/probe', { dsn, setupToken: SETUP_TOKEN })).toMatchObject({ status: 403, body: offBy('metaStoreRoutes', 'hosted-mode') });
    await closeServer();

    // An ordinary server: the probe answers (the host does not resolve, so it says it could not reach it).
    const open = await serve(ORDINARY, { account: false });
    const probe = await open.api('POST', '/api/v1/setup/probe', { dsn: 'sqlite::memory:', setupToken: SETUP_TOKEN });
    expect(probe.status, JSON.stringify(probe.body)).toBe(200);
    expect((await open.api('GET', '/api/v1/setup/state')).status).toBe(200);
  });
});

// ── the meta store's address at boot ───────────────────────────────────────

describe('the meta store address at boot', () => {
  const resolved = (url: string) => ({ url, engine: 'postgres' as const, source: 'env' as const });
  const answers =
    (table: Record<string, string[]>): HostLookup =>
    async (host) =>
      table[host] ?? Promise.reject(new Error('ENOTFOUND'));

  it('every install refuses a name, an address or a host parameter that reaches cloud metadata', async () => {
    const lookup = answers({ 'meta.internal.example': ['169.254.169.254'] });
    for (const url of [
      'postgres://u:p@meta.internal.example:5432/adminium',
      'postgres://u:p@169.254.169.254:5432/adminium',
      'postgres://u:p@db.example:5432/adminium?host=169.254.169.254',
    ]) {
      await expect(guardBootMetaUrl(resolved(url), { lookup }), url).rejects.toThrow(MetaUrlError);
    }
  });

  it('every install keeps a meta store on this machine, its own network, or a name that does not resolve yet', async () => {
    const lookup = answers({ postgres: ['172.18.0.2'], localhost: ['127.0.0.1'] });
    for (const url of ['postgres://u:p@localhost:5432/adminium', 'postgres://u:p@postgres:5432/adminium', 'postgres://u:p@not-up-yet:5432/adminium']) {
      await expect(guardBootMetaUrl(resolved(url), { lookup }), url).resolves.toBeUndefined();
    }
    await expect(guardBootMetaUrl({ url: 'sqlite:/elsewhere/meta.db', engine: 'sqlite', source: 'env' })).resolves.toBeUndefined();
  });

  it('trial mode holds it to the typed meta DSN guard before it dials; an ordinary server goes on to dial', async () => {
    // A parameter the source guard refuses (it would have the driver read a file); a missing file, so nothing here can hang.
    const url = 'postgres://u:p@localhost:1/adminium?sslrootcert=/nonexistent/p75-t11-root.pem';
    const trial = enforceProfile(makeEnv({ ...TRIAL, ADMINIUM_META_URL: url, ADMINIUM_DATA_DIR: '/tmp/p75-t11-boot' }));
    await expect(openRuntime(trial)).rejects.toThrow(/ADMINIUM_META_URL is refused/);
    // Without the profile the parameter is the operator's business: the boot reaches the database (nothing listens on port 1).
    const open = makeEnv({ ADMINIUM_META_URL: url, ADMINIUM_DATA_DIR: '/tmp/p75-t11-boot' });
    await expect(openRuntime(open)).rejects.not.toThrow(/is refused/);
  });
});

// ── A1b storage ────────────────────────────────────────────────────────────

describe('A1b storage', { timeout: 60_000 }, () => {
  const s3 = { name: 'Bucket', driver: 's3', config: { bucket: 'b', region: 'eu-west-1', endpoint: 'https://s3.example.com', prefix: 'files', forcePathStyle: false }, secret: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'example-secret' } };

  it('in trial mode and the hosted profile: no destination made, tested or picked; only local', async () => {
    for (const [env, reason] of [
      [TRIAL, 'trial-mode'],
      [HOSTED, 'hosted-mode'],
    ] as const) {
      const s = await serve(env);
      expect(await s.api('POST', '/api/v1/storage/destinations', s3)).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      expect(await s.api('POST', '/api/v1/storage/destinations/test', s3)).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      expect(await s.api('POST', '/api/v1/storage/destinations/dst_any/test')).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      expect(await s.api('POST', '/api/v1/storage/destinations/dst_any/default')).toMatchObject({ status: 403, body: offBy('storageDestinations', reason) });
      // The default local destination is still listed.
      expect((await s.api('GET', '/api/v1/storage/destinations')).status).toBe(200);
      await closeServer();
    }
  });

  it('on an ordinary server: the same calls reach the destination code', async () => {
    const s = await serve(ORDINARY);
    expect(code(await s.api('POST', '/api/v1/storage/destinations/dst_any/test'))).toBe('NOT_FOUND');
    expect(code(await s.api('POST', '/api/v1/storage/destinations/dst_any/default'))).toBe('NOT_FOUND');
    expect(code(await s.api('POST', '/api/v1/storage/destinations', s3))).not.toBe('OFF_BY_OPERATOR');
  });
});

// ── A2 outgoing traffic ────────────────────────────────────────────────────

describe('A2 the webhook step', () => {
  const webhook = { kind: 'webhook', url: 'https://hooks.example.com/in', method: 'POST', bodyKind: 'json', body: null, headerName: null, headerValueEncrypted: null } as const;
  const graph = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'Trigger' }, { id: 'n2', kind: 'action', title: 'Tell', onError: false, action: webhook }] } as never;
  const trigger = { kind: 'schedule', connectionId: null, schedule: { kind: 'interval', everyMinutes: '15' } } as never;
  const save = (env: Record<string, string>) => () => resolveRule(trigger, graph, { view: null, templateKeys: new Set<string>(), blockLoopback: false, policy: trialPolicy(makeEnv(env)) });

  it('is refused at the save in trial mode, kept by the hosted profile and an ordinary server', () => {
    expect(save(TRIAL)).toThrow(expect.objectContaining({ code: 'OFF_BY_OPERATOR', details: { question: 'webhooks', reason: 'trial-mode' } }));
    expect(save(HOSTED)).not.toThrow();
    expect(save(ORDINARY)).not.toThrow();
  });

  it('is refused at the run in trial mode, before anything is sent; sent otherwise', async () => {
    const sent: string[] = [];
    const ctx = (env: Record<string, string>) =>
      ({
        meta: null,
        manager: { outboundPolicy: { blockLoopback: false, blockPrivate: false, lookup: async () => ['203.0.113.7'] } },
        app: { trialPolicy: trialPolicy(makeEnv(env)) },
        rule: { id: 'rule_1', name: 'Tell the hook' } as Automation,
        runId: 'run_1',
        hops: 0,
        now: Date.now(),
        source: null,
        tokens: {},
        text: TRACE_EN,
        secret: 's'.repeat(32),
        fetch: async (url: string | URL) => {
          sent.push(String(url));
          return new Response('ok');
        },
      }) as unknown as ActionContext;
    await expect(runWebhookAction(webhook as never, ctx(TRIAL))).rejects.toThrow(ActionFailure);
    expect(sent).toEqual([]);
    await runWebhookAction(webhook as never, ctx(ORDINARY));
    await runWebhookAction(webhook as never, ctx(HOSTED));
    expect(sent).toHaveLength(2);
  });
});

describe('A2 add-on HTTP', () => {
  it('every add-on is refused in trial mode, a declared host included; the hosted profile and an ordinary server call it', async () => {
    let calls = 0;
    const client = (env: Record<string, string>) =>
      createAddOnHttpClient({
        key: 'payments-stripe',
        allow: ['api.stripe.com'],
        hasOutboundHttp: true,
        policy: trialPolicy(makeEnv(env)),
        fetchImpl: async () => {
          calls += 1;
          return new Response('{}');
        },
      });
    await expect(client(TRIAL)('https://api.stripe.com/v1/balance')).rejects.toMatchObject({ name: 'AddOnEgressError', reason: 'OFF_BY_OPERATOR' });
    await expect(client(TRIAL)('https://api.stripe.com/v1/balance')).rejects.toBeInstanceOf(AddOnEgressError);
    expect(calls).toBe(0);
    expect((await client(HOSTED)('https://api.stripe.com/v1/balance')).status).toBe(200);
    expect((await client(ORDINARY)('https://api.stripe.com/v1/balance')).status).toBe(200);
    expect(calls).toBe(2);
  });
});

describe('A2 payment services, maps, the update check and telemetry', { timeout: 60_000 }, () => {
  it('in trial mode: payments say the operator switched them off and refuse a key; maps and routing are off; both calls home locked off', async () => {
    const s = await serve(TRIAL);
    expect((await s.api('GET', '/api/v1/payments/setup')).body).toMatchObject({ data: { reachability: { state: 'operator-off' } } });
    expect(await s.api('PUT', '/api/v1/payments/services/payments-stripe/modes/test/fields/secret_key', { value: 'rk_test_abc' })).toMatchObject({
      status: 403,
      body: offBy('paymentProviders'),
    });
    expect((await s.api('GET', '/api/v1/settings/maps')).body).toMatchObject({ data: { mapServerOff: true, routingServerOff: true } });
    expect((await s.api('GET', '/api/v1/settings/telemetry')).body).toMatchObject({ data: { telemetry: false, updateCheck: false } });
    expect(await s.api('GET', '/api/v1/about/update-check')).toEqual({ status: 200, body: { data: { status: 'disabled' } } });
    expect(s.env.ADMINIUM_TELEMETRY).toBe(false);
  });

  it('on an ordinary server and a hosted one: payments reach the service code, maps keep their servers', async () => {
    for (const env of [ORDINARY, HOSTED]) {
      const s = await serve(env);
      expect((await s.api('GET', '/api/v1/payments/setup')).body).not.toMatchObject({ data: { reachability: { state: 'operator-off' } } });
      expect(code(await s.api('PUT', '/api/v1/payments/services/payments-stripe/modes/test/fields/secret_key', { value: 'rk_test_abc' }))).not.toBe('OFF_BY_OPERATOR');
      expect((await s.api('GET', '/api/v1/settings/maps')).body).toMatchObject({ data: { mapServerOff: false } });
      await closeServer();
    }
  });
});

describe('A2 the Designer\'s picture search and Figma', () => {
  it('call out only where the server does, and never in trial mode', async () => {
    const { designerCallsOut } = await import('../src/trial/refuse.js');
    expect(designerCallsOut(true, trialPolicy(makeEnv(TRIAL)))).toBe(false);
    expect(designerCallsOut(true, trialPolicy(makeEnv(HOSTED)))).toBe(true);
    expect(designerCallsOut(true, trialPolicy(makeEnv(ORDINARY)))).toBe(true);
    expect(designerCallsOut(false, trialPolicy(makeEnv(ORDINARY)))).toBe(false);
  });
});

// ── A2 AI ──────────────────────────────────────────────────────────────────

describe('A2 AI addresses', { timeout: 60_000 }, () => {
  it('in trial mode: no typed address and no provider reached at one; the person\'s own key to a fixed provider stays', async () => {
    const s = await serve(TRIAL);
    expect(await s.api('PUT', '/api/v1/llm/config', { provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1', model: 'm' })).toMatchObject({
      status: 403,
      body: offBy('customAiProviders'),
    });
    expect(await s.api('PUT', '/api/v1/llm/config', { provider: 'ollama' })).toMatchObject({ status: 403, body: offBy('customAiProviders') });
    expect(await s.api('PUT', '/api/v1/llm/config', { provider: 'anthropic', baseUrl: 'https://proxy.example.com' })).toMatchObject({
      status: 409,
      body: { error: { code: 'SET_BY_OPERATOR', details: { setting: 'llm.baseUrl', reason: 'trial-mode' } } },
    });
    const own = await s.api('PUT', '/api/v1/llm/config', { provider: 'anthropic', apiKey: 'sk-ant-own-key-1234', model: 'claude-sonnet-5-5' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body).toMatchObject({
      provider: 'anthropic',
      baseUrl: null,
      locks: { baseUrl: { allowed: false, reason: 'trial-mode' }, customProviders: { allowed: false, reason: 'trial-mode' } },
    });
  });

  it('a model connection: a typed address refused in a test and a save, a saved one never dialled, in trial mode only', async () => {
    const store = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    meta = store;
    await firstRun(store);
    const keyCrypto = llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret });
    let listed = 0;
    const connections = (env: Record<string, string>) =>
      createAiConnections({
        settings: settingsRepo(store),
        keyCrypto,
        aiEnv: createAiEnv({ root: null, fromEnvironment: {} }),
        networkFeatures: true,
        production: false,
        resolve: async () => ['93.184.216.34'],
        createClient: () => ({ listModels: async () => { listed += 1; return []; } }) as unknown as ProviderClient,
        policy: trialPolicy(makeEnv(env)),
      });
    const draft = { provider: 'openai-compatible' as const, baseUrl: 'https://models.example.com/v1' };
    expect(await connections(TRIAL).test(draft)).toMatchObject({ ok: false, error: { code: 'config' } });
    await expect(connections(TRIAL).save({ ...draft, model: 'm' })).rejects.toMatchObject({ code: 'OFF_BY_OPERATOR', details: { question: 'aiBaseUrl' } });
    expect(listed).toBe(0);
    expect(await connections(ORDINARY).test(draft)).toMatchObject({ ok: true });
    expect(listed).toBe(1);

    // Saved before the switch (or carried in): refused where it would be dialled.
    await settingsRepo(store).set('llm.provider', 'openai-compatible');
    await settingsRepo(store).set('llm.baseUrl', 'https://models.example.com/v1');
    await expect(connections(TRIAL).client('database')).rejects.toBeInstanceOf(ProviderError);
    await expect(connections(ORDINARY).client('database')).resolves.toMatchObject({ provider: 'openai-compatible' });
  });

  it('on an ordinary server: an address of one\'s own is saved as before', async () => {
    const s = await serve(ORDINARY);
    const saved = await s.api('PUT', '/api/v1/llm/config', { provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1', model: 'm' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ provider: 'openai-compatible', baseUrl: 'https://models.example.com/v1', locks: { baseUrl: { allowed: true }, customProviders: { allowed: true } } });
  });
});
