// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `routes/surfaces-admin` (29-app-surfaces.md §3.1, 29-T17): the surface list,
 * the placement toggle, and domain attachment — including the property the
 * whole write path exists for: a saved mapping takes effect on the NEXT
 * request, because the route invalidates the same cache Host routing reads.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  publicKeysRepo,
  publicScopesRepo,
  settingsRepo,
  usersRepo,
  rolesRepo,
  type User,
} from '@adminium/meta';

import type { AdminiumServer } from '../src/app.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { surfacesAdminRoutes } from '../src/routes/surfaces-admin/index.js';
import { buildAuthApp, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const DASH_HTML = '<!doctype html><html><body data-app="dashboard"></body></html>';
const STAFF_HTML = '<!doctype html><html><body data-app="clients-staff"></body></html>';
const CUSTOMER_HTML = '<!doctype html><html><body data-app="clients-customer"></body></html>';

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;
let viewer: User;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), DASH_HTML, 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  const staff = join(surfacesDir, 'clients', 'staff');
  const customer = join(surfacesDir, 'clients', 'customer');
  await mkdir(staff, { recursive: true });
  await mkdir(customer, { recursive: true });
  await writeFile(join(staff, 'index.html'), STAFF_HTML, 'utf8');
  await writeFile(
    join(staff, 'surface.json'),
    JSON.stringify({
      v: 1,
      appLabels: { 'en-US': 'Outline' },
      nav: [{ id: 'home', path: 'home', labels: { 'en-US': 'Home' } }],
    }),
    'utf8',
  );
  await writeFile(join(customer, 'index.html'), CUSTOMER_HTML, 'utf8');
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

/**
 * buildAuthApp + the x-test-user-id stub + rbac + the routes under test. The
 * stub hook is added AFTER the surfaces plugin's serve hook, which is fine
 * here: every route in this suite is under `/api/`, the pass-through the serve
 * hook honours before it ever reads the principal.
 */
async function build(): Promise<{ app: AdminiumServer; fixture: AuthTestApp }> {
  t = await buildAuthApp({ staticRoot: dist, surfaces });
  const users = usersRepo(t.meta);
  const roles = rolesRepo(t.meta);
  const viewerRole = await roles.findBySlug('viewer');
  if (viewerRole === null) throw new Error('missing built-in viewer role');
  viewer = await users.create({
    email: 'viewer@example.com',
    name: 'Vi Ewer',
    passwordHash: 'h',
    status: 'active',
  });
  await roles.assignToUser(viewer.id, viewerRole.id);

  t.app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        const req = request as unknown as { user: unknown; session: unknown };
        req.user = user;
        req.session = { id: 'test-session', userId: user.id };
      }
    }
  });
  await t.app.register(rbacPlugin, { meta: t.meta });
  await t.app.register(
    async (api) => {
      await api.register(surfacesAdminRoutes({ meta: t!.meta }));
    },
    { prefix: '/api/v1' },
  );
  await t.app.ready();
  return { app: t.app, fixture: t };
}

const asUser = (user: User) => ({ 'x-test-user-id': user.id });

describe('GET /api/v1/surfaces', () => {
  it('lists discovered surfaces with placement, nav availability, key binding and domains', async () => {
    const { app, fixture } = await build();

    // Bind a live key to the customer side so the summary has something to say.
    const crypto = dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET);
    const conn = await connectionsRepo(fixture.meta, crypto).create({
      name: 'src',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/prod',
      dataDsn: 'postgres://rw:s@db/prod',
    });
    const scope = await publicScopesRepo(fixture.meta).create({
      connectionId: conn.id,
      side: 'customer',
      name: 'portal',
      timezone: 'Europe/London',
      document: '{}',
    });
    const generated = generatePublishableKey();
    await publicKeysRepo(fixture.meta).create({
      name: 'portal key',
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
      tokenEncrypted: sealPublishableKey(crypto, generated.token),
      scopeId: scope.id,
      side: 'customer',
      appKey: 'clients',
    });
    await settingsRepo(fixture.meta).set(
      'surfaces.domains',
      { 'shop.example.test': { appKey: 'clients', side: 'customer' } },
      { updatedBy: null },
    );
    app.surfaceSettings?.invalidate();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/surfaces',
      headers: asUser(fixture.admin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.surfaces).toEqual([
      {
        appKey: 'clients',
        side: 'staff',
        prefix: '/apps/clients/staff',
        navAvailable: true,
        navItems: 1,
        staffPlacement: 'internal',
        connectionId: null,
        boundKey: null,
        domains: [],
      },
      {
        appKey: 'clients',
        side: 'customer',
        prefix: '/apps/clients/customer',
        navAvailable: false,
        navItems: 0,
        staffPlacement: null,
        connectionId: null,
        boundKey: { id: expect.any(String), name: 'portal key', prefix: generated.prefix },
        domains: ['shop.example.test'],
      },
    ]);
    expect(body.domains).toEqual({
      'shop.example.test': { appKey: 'clients', side: 'customer' },
    });
  });

  it('403s a viewer', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/surfaces',
      headers: asUser(viewer),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /api/v1/surfaces/:appKey/placement', () => {
  it('stores the opt-out, audits it, and bootstrap sees it at once', async () => {
    const { app, fixture } = await build();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/placement',
      headers: asUser(fixture.admin),
      payload: { staff: 'external' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ appKey: 'clients', staff: 'external' });

    expect(await settingsRepo(fixture.meta).get('surfaces.apps')).toEqual({
      clients: { staff: 'external' },
    });
    // The write invalidated the SHARED cache — the next read is the new value,
    // not a stale TTL hit.
    expect(await app.surfaceSettings?.read()).toMatchObject({
      apps: { clients: { staff: 'external' } },
    });
    const audit = await fixture.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', '=', 'surfaces.placement')
      .execute();
    expect(audit).toHaveLength(1);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/surfaces',
      headers: asUser(fixture.admin),
    });
    expect(list.json().surfaces[0].staffPlacement).toBe('external');
  });

  it('404s an app with no discovered staff surface', async () => {
    const { app, fixture } = await build();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/ghost/placement',
      headers: asUser(fixture.admin),
      payload: { staff: 'external' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PUT /api/v1/surfaces/:appKey/connection', () => {
  it('binds a staff surface to a connection, audits it, and serves it to the app', async () => {
    /*
     * The whole point of the binding: the app stops having to infer its
     * database. Asserted end to end — stored, cache-invalidated, reported in
     * the summary, and readable by the surface itself at the URL it fetches.
     */
    const { app, fixture } = await build();
    const conn = await connectionsRepo(fixture.meta, dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET)).create({
      name: 'clients db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/clients',
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/connection',
      headers: asUser(fixture.admin),
      payload: { connectionId: conn.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ appKey: 'clients', connectionId: conn.id });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/surfaces',
      headers: asUser(fixture.admin),
    });
    const staff = list.json().surfaces.find(
      (s: { appKey: string; side: string }) => s.appKey === 'clients' && s.side === 'staff',
    );
    expect(staff.connectionId).toBe(conn.id);


    const audit = await fixture.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', '=', 'surfaces.connection')
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('leaves the placement stored beside it alone', async () => {
    // One record holds both. A binding that clobbered the placement would move
    // a blended app out of the sidebar as a side effect of naming its database.
    const { app, fixture } = await build();
    const conn = await connectionsRepo(fixture.meta, dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET)).create({
      name: 'clients db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/clients',
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/placement',
      headers: asUser(fixture.admin),
      payload: { staff: 'external' },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/connection',
      headers: asUser(fixture.admin),
      payload: { connectionId: conn.id },
    });
    expect(await settingsRepo(fixture.meta).get('surfaces.apps')).toEqual({
      clients: { staff: 'external', connectionId: conn.id },
    });
  });

  it('clearing the binding restores the inference, keeping the placement', async () => {
    const { app, fixture } = await build();
    const conn = await connectionsRepo(fixture.meta, dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET)).create({
      name: 'clients db',
      engine: 'postgres',
      introspectDsn: 'postgres://ro:s@db/clients',
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/placement',
      headers: asUser(fixture.admin),
      payload: { staff: 'external' },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/connection',
      headers: asUser(fixture.admin),
      payload: { connectionId: conn.id },
    });
    const cleared = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/connection',
      headers: asUser(fixture.admin),
      payload: { connectionId: null },
    });
    expect(cleared.json()).toEqual({ appKey: 'clients', connectionId: null });
    expect(await settingsRepo(fixture.meta).get('surfaces.apps')).toEqual({
      clients: { staff: 'external' },
    });
  });

  it('refuses a connection id that does not exist', async () => {
    // Validated on the way IN. Stored unchecked, it would fail later inside the
    // app and look like a broken app rather than a bad setting.
    const { app, fixture } = await build();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/connection',
      headers: asUser(fixture.admin),
      payload: { connectionId: 'con_nope' },
    });
    expect(res.statusCode).toBe(422);
  });

});

describe('PUT /api/v1/surfaces/instances', () => {
  const mkConn = (fixture: { meta: Parameters<typeof connectionsRepo>[0] }, name: string) =>
    connectionsRepo(fixture.meta, dsnCryptoFromSecret(makeEnv().ADMINIUM_SECRET)).create({
      name,
      engine: 'postgres',
      introspectDsn: `postgres://ro:s@db/${name}`,
    });

  it('stores instances, reports them, and leaves placement alone', async () => {
    const { app, fixture } = await build();
    const berlin = await mkConn(fixture, 'berlin');
    await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/clients/placement',
      headers: asUser(fixture.admin),
      payload: { staff: 'external' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/instances',
      headers: asUser(fixture.admin),
      payload: { instances: { clients: [{ slug: 'berlin', connectionId: berlin.id }] } },
    });
    expect(res.statusCode).toBe(200);
    // The placement this screen does not own survives its write.
    expect(await settingsRepo(fixture.meta).get('surfaces.apps')).toEqual({
      clients: { staff: 'external', instances: [{ slug: 'berlin', connectionId: berlin.id }] },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/surfaces',
      headers: asUser(fixture.admin),
    });
    expect(list.json().instances).toEqual({
      clients: [{ slug: 'berlin', connectionId: berlin.id }],
    });
  });

  it('removing a row is expressible by saving the map without it', async () => {
    const { app, fixture } = await build();
    const berlin = await mkConn(fixture, 'berlin');
    const put = (instances: unknown) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/surfaces/instances',
        headers: asUser(fixture.admin),
        payload: { instances },
      });
    await put({ clients: [{ slug: 'berlin', connectionId: berlin.id }] });
    await put({ clients: [] });
    expect(await settingsRepo(fixture.meta).get('surfaces.apps')).toEqual({ clients: {} });
  });

  it('names every problem at once and stores NONE of them', async () => {
    /*
     * All-or-nothing on purpose. A half-applied map leaves the screen
     * disagreeing with the URLs the instances are actually served on, and
     * nothing tells the operator which half won.
     */
    const { app, fixture } = await build();
    const ok = await mkConn(fixture, 'ok');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/instances',
      headers: asUser(fixture.admin),
      payload: {
        instances: {
          clients: [
            { slug: 'Berlin', connectionId: ok.id },
            { slug: 'staff', connectionId: ok.id },
            { slug: 'ghost', connectionId: 'con_nope' },
          ],
          nosuchapp: [{ slug: 'x', connectionId: ok.id }],
        },
      },
    });
    expect(res.statusCode).toBe(422);
    const codes = (res.json().error.details.issues as { code: string }[]).map((i) => i.code);
    expect(codes).toContain('invalid_slug');
    expect(codes).toContain('unknown_connection');
    expect(codes).toContain('unknown_surface');
    // `{}` is the registry default — i.e. nothing was written at all.
    expect(await settingsRepo(fixture.meta).get('surfaces.apps')).toEqual({});
  });

  it('refuses a slug that names a side', async () => {
    // `/apps/clients/staff/` would then mean two things at once.
    const { app, fixture } = await build();
    const conn = await mkConn(fixture, 'x');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/instances',
      headers: asUser(fixture.admin),
      payload: { instances: { clients: [{ slug: 'customer', connectionId: conn.id }] } },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('PUT /api/v1/surfaces/domains', () => {
  const put = (app: AdminiumServer, admin: User, domains: unknown, host = 'admin.example.test') =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/domains',
      headers: { ...asUser(admin), host },
      payload: { domains },
    });

  it('normalizes, stores, audits — and the mapping serves on the very next request', async () => {
    const { app, fixture } = await build();
    const res = await put(app, fixture.admin, {
      // Mixed case and a default port: stored normalized.
      'Shop.Example.Test:443': { appKey: 'clients', side: 'customer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      domains: { 'shop.example.test': { appKey: 'clients', side: 'customer' } },
    });

    // No TTL wait: the write path invalidated the cache Host routing reads.
    const serve = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'shop.example.test' },
    });
    expect(serve.body).toContain('clients-customer');

    const audit = await fixture.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', '=', 'surfaces.domains')
      .execute();
    expect(audit).toHaveLength(1);

    // Full-map semantics: writing {} detaches everything.
    expect((await put(app, fixture.admin, {})).statusCode).toBe(200);
    const detached = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'shop.example.test' },
    });
    expect(detached.body).toContain('data-app="dashboard"');
  });

  it('refuses bad hosts, duplicates, unknown surfaces and the Studio host — naming each', async () => {
    const { app, fixture } = await build();
    const res = await put(app, fixture.admin, {
      'not a host': { appKey: 'clients', side: 'customer' },
      'https://shop.example.test': { appKey: 'clients', side: 'customer' },
      'dupe.example.test': { appKey: 'clients', side: 'customer' },
      'Dupe.Example.Test:443': { appKey: 'clients', side: 'staff' },
      'ghost.example.test': { appKey: 'ghost', side: 'customer' },
      'admin.example.test': { appKey: 'clients', side: 'customer' },
    });
    expect(res.statusCode).toBe(422);
    const issues = (res.json().error.details?.issues ?? []) as Array<{ code: string }>;
    const codes = issues.map((issue) => issue.code).sort();
    expect(codes).toEqual([
      'duplicate_host',
      'invalid_host',
      'invalid_host',
      'request_host',
      'unknown_surface',
    ]);
    // A refused write changes nothing — the registry default is still served.
    expect(await settingsRepo(fixture.meta).get('surfaces.domains')).toEqual({});
  });

  it('403s a viewer', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/surfaces/domains',
      headers: asUser(viewer),
      payload: { domains: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});
