// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Domain attachment (29-app-surfaces.md D3/D4, 29-T06) and the served customer
 * config (D10, 29-T16).
 *
 * The two invariance properties §3.1 demands are tests here, not prose:
 *
 *  1. no request on a MAPPED host can reach the dashboard bundle outside the
 *     reserved set;
 *  2. no request on an UNMAPPED host behaves differently from before the wave
 *     — asserted by capturing responses before any mapping exists and
 *     re-issuing the same requests after one does.
 *
 * The staff-domain half uses the REAL login flow (cookie minted by
 * `POST /auth/login`), because the ordering it proves — auth hook populates
 * `request.user` before the serve hook's gate reads it — is exactly what a
 * stubbed principal would fake.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { publicKeysRepo, publicScopesRepo, connectionsRepo, settingsRepo } from '@adminium/meta';

import type { AdminiumServer } from '../src/app.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { isHostReservedPath, RESERVED_AUTH_PATHS } from '../src/plugins/surfaces.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const DASH_HTML = '<!doctype html><html><body data-app="dashboard"></body></html>';
const STAFF_HTML = '<!doctype html><html><body data-app="clients-staff"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><body data-app="clients-customer"></body></html>';

const NAVIGATE = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };
const CUSTOMER_HOST = 'shop.example.test';
const STAFF_HOST = 'staff.example.test';

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), DASH_HTML, 'utf8');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'assets', 'app.js'), 'export const dashboard = 1;', 'utf8');

  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  const staff = join(surfacesDir, 'clients', 'staff');
  const customer = join(surfacesDir, 'clients', 'customer');
  await mkdir(staff, { recursive: true });
  await mkdir(join(customer, 'assets'), { recursive: true });
  await writeFile(join(staff, 'index.html'), STAFF_HTML, 'utf8');
  await writeFile(join(customer, 'index.html'), CUSTOMER_HTML, 'utf8');
  await writeFile(join(customer, 'robots.txt'), 'User-agent: *\n', 'utf8');
  await writeFile(join(customer, 'assets', 'customer.js'), 'export const c = 1;', 'utf8');
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
  await rm(surfacesDir, { recursive: true, force: true });
});

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

async function build(): Promise<AuthTestApp> {
  t = await buildAuthApp({ staticRoot: dist, surfaces });
  return t;
}

/** Write the domain map directly and drop the cache, as the admin route does. */
async function setDomains(
  fixture: AuthTestApp,
  domains: Record<string, { appKey: string; side: 'staff' | 'customer' }>,
): Promise<void> {
  await settingsRepo(fixture.meta).set('surfaces.domains', domains, { updatedBy: null });
  fixture.app.surfaceSettings?.invalidate();
}

const get = (app: AdminiumServer, url: string, host: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { host, ...headers } });

describe('isHostReservedPath — the D4 set, walked', () => {
  it('reserves the auth set, /api, /apps and the dashboard build directory', () => {
    for (const path of RESERVED_AUTH_PATHS) {
      expect(isHostReservedPath(path), path).toBe(true);
      expect(isHostReservedPath(`${path}/deeper`), `${path}/deeper`).toBe(true);
    }
    expect(isHostReservedPath('/api/v1/auth/login')).toBe(true);
    expect(isHostReservedPath('/apps/clients/customer/assets/x.js')).toBe(true);
    expect(isHostReservedPath('/assets/index-abc.js')).toBe(true);
    // Deliberately NOT reserved (D4): the rest of the dashboard.
    for (const path of ['/', '/state', '/account', '/settings/team', '/p/invoices', '/loginx']) {
      expect(isHostReservedPath(path), path).toBe(false);
    }
  });
});

describe('mapped CUSTOMER host (D3)', () => {
  it('serves the surface at /, on deep paths, and for real files — the dashboard only inside the reserved set', async () => {
    const { app } = await build();
    await setDomains(t!, { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } });

    expect((await get(app, '/', CUSTOMER_HOST)).body).toContain('clients-customer');
    expect((await get(app, '/track/42', CUSTOMER_HOST, NAVIGATE)).body).toContain(
      'clients-customer',
    );
    // A real file under the surface root is the file, not the SPA fallback.
    expect((await get(app, '/robots.txt', CUSTOMER_HOST)).body).toContain('User-agent');
    // The bundle's absolute asset paths keep resolving — no rewrite, no rebuild.
    expect((await get(app, '/apps/clients/customer/assets/customer.js', CUSTOMER_HOST)).body).toContain(
      'const c',
    );
    // The dashboard shell is NOT reachable outside the reserved set …
    expect((await get(app, '/settings/team', CUSTOMER_HOST, NAVIGATE)).body).not.toContain(
      'data-app="dashboard"',
    );
    // … but the reserved set still serves it: login page + its own bundle.
    expect((await get(app, '/login', CUSTOMER_HOST, NAVIGATE)).body).toContain('data-app="dashboard"');
    expect((await get(app, '/assets/app.js', CUSTOMER_HOST)).body).toContain('const dashboard');
    // /api/* is untouched — host-agnostic, as today.
    const api = await get(app, '/api/v1/nope', CUSTOMER_HOST);
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
  });

  it('a non-GET verb keeps its normal meaning on a mapped host', async () => {
    const { app } = await build();
    await setDomains(t!, { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } });
    const res = await app.inject({ method: 'POST', url: '/', headers: { host: CUSTOMER_HOST } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('matches the host port-insensitively and case-insensitively', async () => {
    const { app } = await build();
    await setDomains(t!, { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } });
    expect((await get(app, '/', `${CUSTOMER_HOST}:443`)).body).toContain('clients-customer');
    expect((await get(app, '/', 'Shop.Example.Test')).body).toContain('clients-customer');
    // A DIFFERENT explicit port is a different host — no accidental widening.
    expect((await get(app, '/', `${CUSTOMER_HOST}:8443`)).body).toContain('data-app="dashboard"');
  });

  it('a mapping to an undiscovered surface is inert, never an error', async () => {
    const { app } = await build();
    await setDomains(t!, { [CUSTOMER_HOST]: { appKey: 'ghost', side: 'customer' } });
    const res = await get(app, '/', CUSTOMER_HOST);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-app="dashboard"');
  });
});

describe('mapped STAFF host (D4) — sign-in on the mapped host', () => {
  it('gates anonymously, then serves with the cookie minted ON that host', async () => {
    const { app } = await build();
    await setDomains(t!, { [STAFF_HOST]: { appKey: 'clients', side: 'staff' } });

    // Anonymous document navigation → the dashboard login, on this host.
    const anon = await get(app, '/schedule', STAFF_HOST, NAVIGATE);
    expect(anon.statusCode).toBe(302);
    expect(anon.headers['location']).toBe('/login?next=%2Fschedule');
    expect((await get(app, '/login', STAFF_HOST, NAVIGATE)).body).toContain('data-app="dashboard"');

    // An anonymous fetch gets the coded envelope, not a redirect.
    const fetchRes = await get(app, '/schedule', STAFF_HOST, {
      accept: '*/*',
      'sec-fetch-mode': 'cors',
    });
    expect(fetchRes.statusCode).toBe(401);

    // POST /api/v1/auth/login on the mapped host (the /api/* pass-through)
    // mints the session; the same cookie then opens the surface.
    const { res: loginRes, cookie } = await (async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { host: STAFF_HOST },
        payload: { email: 'ava@example.com', password: 'correct-horse-battery-staple' },
      });
      const pair = (Array.isArray(res.headers['set-cookie'])
        ? res.headers['set-cookie']
        : [res.headers['set-cookie'] ?? '']
      )
        .map((header) => String(header).split(';')[0] ?? '')
        .find((p) => p.startsWith('adminium_session='));
      return { res, cookie: pair ?? '' };
    })();
    expect(loginRes.statusCode).toBe(200);
    expect(cookie).not.toBe('');

    const authed = await get(app, '/schedule', STAFF_HOST, { ...NAVIGATE, cookie });
    expect(authed.statusCode).toBe(200);
    expect(authed.body).toContain('clients-staff');
    expect((await get(app, '/', STAFF_HOST, { ...NAVIGATE, cookie })).body).toContain(
      'clients-staff',
    );
  });
});

describe('unmapped hosts are byte-identical before and after a mapping exists', () => {
  it('captures responses with no mappings, adds one, and re-issues them', async () => {
    const { app } = await build();
    const PROBES: Array<[string, Record<string, string>]> = [
      ['/', {}],
      ['/settings/team', NAVIGATE],
      ['/apps/clients/customer/', {}],
      ['/login', NAVIGATE],
      ['/api/v1/nope', {}],
    ];
    // The request id is per-request by design; identical modulo that.
    const scrub = (body: string) => body.replace(/req_[0-9a-f]{8}/g, 'req_x');
    const before = [];
    for (const [url, headers] of PROBES) {
      const res = await get(app, url, 'admin.example.test', headers);
      before.push([res.statusCode, scrub(res.body)]);
    }
    await setDomains(t!, { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } });
    const after = [];
    for (const [url, headers] of PROBES) {
      const res = await get(app, url, 'admin.example.test', headers);
      after.push([res.statusCode, scrub(res.body)]);
    }
    expect(after).toEqual(before);
  });
});

describe('surface-config.json (D10, 29-T16)', () => {
  const CONFIG_URL = '/apps/clients/customer/surface-config.json';

  async function seedBoundKey(fixture: AuthTestApp, at: number, revoked = false) {
    const env = makeEnv();
    const crypto = dsnCryptoFromSecret(env.ADMINIUM_SECRET);
    const conn = await connectionsRepo(fixture.meta, crypto).create({
      name: 'src',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/prod',
      dataDsn: 'postgres://rw:s@db/prod',
    });
    const scope = await publicScopesRepo(fixture.meta).create(
      {
        connectionId: conn.id,
        side: 'customer',
        name: 'portal',
        timezone: 'Europe/London',
        document: JSON.stringify({ version: 1 }),
      },
      at,
    );
    const generated = generatePublishableKey();
    const key = await publicKeysRepo(fixture.meta).create(
      {
        name: 'portal key',
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        tokenEncrypted: sealPublishableKey(crypto, generated.token),
        scopeId: scope.id,
        side: 'customer',
        appKey: 'clients',
      },
      at,
    );
    if (revoked) await publicKeysRepo(fixture.meta).revoke(key.id, at + 1);
    return { scope, key, token: generated.token, crypto };
  }

  it('404s with the coded envelope while nothing is bound', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: CONFIG_URL });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('serves the newest live bound key, uncached, and falls back when it is revoked', async () => {
    const { app } = await build();
    const older = await seedBoundKey(t!, 1_000);
    const newer = await (async () => {
      const generated = generatePublishableKey();
      const key = await publicKeysRepo(t!.meta).create(
        {
          name: 'replacement',
          prefix: generated.prefix,
          tokenHash: generated.tokenHash,
          tokenEncrypted: sealPublishableKey(older.crypto, generated.token),
          scopeId: older.scope.id,
          side: 'customer',
          appKey: 'clients',
        },
        2_000,
      );
      return { key, token: generated.token };
    })();

    const res = await app.inject({ method: 'GET', url: CONFIG_URL });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ baseUrl: '', publishableKey: newer.token });

    // Rotation-by-revocation: the older live key takes over on the next load —
    // zero rebuilds, which is the whole point of serving this (criterion 9).
    await publicKeysRepo(t!.meta).revoke(newer.key.id);
    expect((await app.inject({ method: 'GET', url: CONFIG_URL })).json()).toEqual({
      baseUrl: '',
      publishableKey: older.token,
    });
  });

  it('answers on a mapped host through the /apps pass-through', async () => {
    const { app } = await build();
    const seeded = await seedBoundKey(t!, 3_000);
    await setDomains(t!, { [CUSTOMER_HOST]: { appKey: 'clients', side: 'customer' } });
    const res = await get(app, CONFIG_URL, CUSTOMER_HOST);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ baseUrl: '', publishableKey: seeded.token });
  });

  it('the staff variant carries NO key — that half is still customer-only', async () => {
    /*
     * This asserted that no staff variant existed AT ALL, which was true while
     * the document's only job was to carry a publishable key. It now also
     * answers "which connection does this app read" (29 D9), a question the
     * staff side had no way to answer and was guessing at.
     *
     * The invariant that mattered is unchanged and still asserted: whatever the
     * staff document grows, a key is never in it.
     */
    const { app } = await build();
    await seedBoundKey(t!, 4_000);
    const { cookie } = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: '/apps/clients/staff/surface-config.json',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('adm_pub_');
    expect(res.json()).toEqual({ connectionId: null });
  });

  it('serves an INSTANCE its own connection, at /apps/<key>/<slug>/<side>/', async () => {
    /*
     * The same app over a second database (29 D9). One bundle, two mounts, two
     * answers — which is the whole reason instances are a setting and not a
     * second build.
     */
    const { app } = await build();
    const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
    const root = await connectionsRepo(t!.meta, crypto).create({
      name: 'root db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/root',
    });
    const berlin = await connectionsRepo(t!.meta, crypto).create({
      name: 'berlin db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/berlin',
    });
    await settingsRepo(t!.meta).set('surfaces.apps', {
      clients: { connectionId: root.id, instances: [{ slug: 'berlin', connectionId: berlin.id }] },
    });
    t!.app.surfaceSettings?.invalidate();
    const { cookie } = await login(app);

    const rootRes = await app.inject({
      method: 'GET',
      url: '/apps/clients/staff/surface-config.json',
      headers: { cookie: cookie ?? '' },
    });
    expect(rootRes.json()).toEqual({ connectionId: root.id });

    const instRes = await app.inject({
      method: 'GET',
      url: '/apps/clients/berlin/staff/surface-config.json',
      headers: { cookie: cookie ?? '' },
    });
    expect(instRes.json()).toEqual({ connectionId: berlin.id });

    // The instance serves the app itself, from the SAME bundle on disk.
    const page = await app.inject({
      method: 'GET',
      url: '/apps/clients/berlin/staff/invoices',
      headers: { cookie: cookie ?? '', ...NAVIGATE },
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('clients-staff');
  });

  it('a mapped host serves its INSTANCE config at the root (29 D9)', async () => {
    /*
     * A mapped domain serves the app at `/`, and the bundle never sees the
     * domain map — so the root document is the only thing that can tell it
     * which database this host is for. Without this the host would render the
     * app and read the app's OWN connection, which is the wrong business.
     */
    const { app } = await build();
    const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
    const berlin = await connectionsRepo(t!.meta, crypto).create({
      name: 'berlin db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/berlin',
    });
    await settingsRepo(t!.meta).set('surfaces.apps', {
      clients: { instances: [{ slug: 'berlin', connectionId: berlin.id }] },
    });
    await setDomains(t!, {
      'berlin.example.test': { appKey: 'clients', side: 'staff', instance: 'berlin' },
    });
    const { cookie } = await login(app);

    const res = await app.inject({
      method: 'GET',
      url: '/surface-config.json',
      headers: { host: 'berlin.example.test', cookie: cookie ?? '' },
    });
    expect(res.json()).toEqual({ connectionId: berlin.id });
  });

  it('an UNMAPPED-to-instance host keeps serving the app\'s own connection', async () => {
    const { app } = await build();
    const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
    const own = await connectionsRepo(t!.meta, crypto).create({
      name: 'own db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/own',
    });
    await settingsRepo(t!.meta).set('surfaces.apps', { clients: { connectionId: own.id } });
    await setDomains(t!, { 'plain.example.test': { appKey: 'clients', side: 'staff' } });
    const { cookie } = await login(app);

    const res = await app.inject({
      method: 'GET',
      url: '/surface-config.json',
      headers: { host: 'plain.example.test', cookie: cookie ?? '' },
    });
    expect(res.json()).toEqual({ connectionId: own.id });
  });

  it('serves a CUSTOMER instance the key bound to its own connection', async () => {
    /*
     * The customer half never names a connection — it names a key, and the key
     * names a scope, and the scope names the connection. So an instance is
     * served by narrowing that same lookup from "this app" to "this app on this
     * database", and two instances hand out two different keys.
     */
    const { app } = await build();
    await seedBoundKey(t!, 4_000);
    const rootKey = await publicKeysRepo(t!.meta).newestLiveByApp('clients', 'customer');
    const rootScope = await publicScopesRepo(t!.meta).findById(rootKey!.scopeId);

    // A second business: its own connection, scope and key, same app.
    const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
    const other = await connectionsRepo(t!.meta, crypto).create({
      name: 'berlin db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/berlin',
    });
    const otherScope = await publicScopesRepo(t!.meta).create(
      {
        connectionId: other.id,
        side: 'customer',
        name: 'berlin portal',
        timezone: 'Europe/Berlin',
        document: JSON.stringify({ version: 1 }),
      },
      3_000,
    );
    const token = generatePublishableKey();
    await publicKeysRepo(t!.meta).create(
      {
        name: 'berlin key',
        prefix: token.prefix,
        tokenHash: token.tokenHash,
        tokenEncrypted: sealPublishableKey(crypto, token.token),
        scopeId: otherScope.id,
        side: 'customer',
        appKey: 'clients',
      },
      3_500,
    );

    await settingsRepo(t!.meta).set('surfaces.apps', {
      clients: { instances: [{ slug: 'berlin', connectionId: other.id }] },
    });
    t!.app.surfaceSettings?.invalidate();

    const root = await app.inject({
      method: 'GET',
      url: '/apps/clients/customer/surface-config.json',
    });
    const inst = await app.inject({
      method: 'GET',
      url: '/apps/clients/berlin/customer/surface-config.json',
    });
    expect(root.statusCode).toBe(200);
    expect(inst.statusCode).toBe(200);
    // Two mounts, two businesses, two keys — never the same one twice.
    /*
     * The berlin key is OLDER than the root one on purpose. "Newest key for
     * this app" would therefore return the ROOT key for both mounts, and the
     * test would pass while proving nothing. Selecting on the CONNECTION is the
     * only thing that can pick the older key here.
     */
    expect(inst.json().publishableKey).toBe(token.token);
    expect(inst.json().publishableKey).not.toBe(root.json().publishableKey);
    expect(rootScope!.connectionId).not.toBe(other.id);
  });

  it('404s a customer instance with no key bound to its connection', async () => {
    // Silence would be worse: the app would fall to its not-connected screen
    // with no hint that the instance exists but has never been given a key.
    const { app } = await build();
    const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
    const other = await connectionsRepo(t!.meta, crypto).create({
      name: 'keyless db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/keyless',
    });
    await settingsRepo(t!.meta).set('surfaces.apps', {
      clients: { instances: [{ slug: 'keyless', connectionId: other.id }] },
    });
    t!.app.surfaceSettings?.invalidate();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/clients/keyless/customer/surface-config.json',
    });
    expect(res.statusCode).toBe(404);
  });

  it('an unknown slug is a normal 404, not somebody else\'s database', async () => {
    // Falling through to the dashboard is the safe direction: inventing a mount
    // for an unrecognised slug is how one app ends up serving another's data.
    const { app } = await build();
    const { cookie } = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: '/apps/clients/nosuch/staff/surface-config.json',
      headers: { cookie: cookie ?? '' },
    });
    // HTML from the dashboard's own fallback — never a config document.
    expect(res.body).not.toContain('connectionId');
  });

  it('serves the bound connection to the staff surface once one is set', async () => {
    // The end of the chain: what Studio stores is what the app reads at boot.
    const { app } = await build();
    const conn = await connectionsRepo(
      t!.meta,
      dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET),
    ).create({ name: 'clients db', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/c' });
    await settingsRepo(t!.meta).set('surfaces.apps', { clients: { connectionId: conn.id } });
    t!.app.surfaceSettings?.invalidate();

    const { cookie } = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: '/apps/clients/staff/surface-config.json',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.json()).toEqual({ connectionId: conn.id });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
