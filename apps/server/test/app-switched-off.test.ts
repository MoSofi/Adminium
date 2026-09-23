// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app, or one side of it, switched off: every way in answers "not
 * available", a page load with the script-free page, anything else with the
 * coded 503 — and switching it back on serves it again at once.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  manifestsRepo,
  pagesRepo,
  permissionsRepo,
  publicKeysRepo,
  rolesRepo,
  usersRepo,
  publicScopesRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';

import type { AdminiumServer } from '../src/app.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { negotiateLocale, SURFACE_SIGN_OUT_PATH } from '../src/plugins/surfaces.js';
import { generatePublishableKey } from '../src/public-api/keys.js';
import { renderUnavailablePage } from '../src/surfaces/unavailable-page.js';
import { adminPasswordHash, ADMIN_PASSWORD, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const NAVIGATE = { 'sec-fetch-mode': 'navigate', accept: 'text/html' };
const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><body data-app="dashboard"></body>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'clients', side), { recursive: true });
    await writeFile(join(surfacesDir, 'clients', side, 'index.html'), `<body data-app="clients-${side}"></body>`, 'utf8');
  }
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

/** The app's manifest row, switched to `status`, and the cache dropped as a write would. */
async function setStatus(fixture: AuthTestApp, status: 'installed' | 'disabled'): Promise<void> {
  const repo = manifestsRepo(fixture.meta, IDENTITY);
  const existing = (await repo.list('app')).find((m) => m.row.manifestKey === 'clients');
  const id =
    existing?.row.id ??
    (await repo.install({ manifestKey: 'clients', version: '1.0.0', kind: 'app', source: 'file', document: {} })).row.id;
  await repo.setStatus(id, status);
  fixture.app.surfaceSettings?.invalidate();
}

async function setOff(fixture: AuthTestApp, off: ('staff' | 'customer')[]): Promise<void> {
  await settingsRepo(fixture.meta).set('surfaces.apps', { clients: { off } });
  fixture.app.surfaceSettings?.invalidate();
}

const get = (app: AdminiumServer, url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers });

describe('the gate', () => {
  it('answers a page load of a disabled app with the script-free page, and anything else with the code', async () => {
    const { app } = await build();
    await setStatus(t!, 'disabled');

    const page = await get(app, '/apps/clients/customer/', { ...NAVIGATE, 'accept-language': 'de-DE,de;q=0.9' });
    expect(page.statusCode).toBe(503);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-robots-tag']).toBe('noindex');
    expect(page.body).not.toMatch(/<script/i);
    expect(page.body).toContain('<html lang="de-DE"');
    // In the reader's language, from the server's own bundles.
    expect(page.body).toContain('clients ist gerade nicht verfügbar.');
    // The workspace never named itself, so the page does not name the platform.
    expect(page.body).not.toContain('Adminium');

    const fetched = await get(app, '/apps/clients/customer/surface-config.json');
    expect(fetched.statusCode).toBe(503);
    expect(fetched.json().error.code).toBe('APP_DISABLED');

    // Staff too, before any sign-in: switched off is not a sign-in question.
    const staff = await get(app, '/apps/clients/staff/', NAVIGATE);
    expect(staff.statusCode).toBe(503);
    expect(staff.body).not.toContain('<form');

    await setStatus(t!, 'installed');
    expect((await get(app, '/apps/clients/customer/', NAVIGATE)).body).toContain('clients-customer');
  });

  it('switches one side off and leaves the other served', async () => {
    const { app } = await build();
    await setOff(t!, ['customer']);
    const customer = await get(app, '/apps/clients/customer/assets/x.js');
    expect(customer.statusCode).toBe(503);
    expect(customer.json().error.code).toBe('SURFACE_OFF');
    const { cookie } = await login(app);
    const staff = await get(app, '/apps/clients/staff/', { ...NAVIGATE, cookie: cookie! });
    expect(staff.body).toContain('clients-staff');
  });

  it('shows a signed-in person who they are, and signs them out with a plain form post', async () => {
    const { app, admin } = await build();
    await setOff(t!, ['staff']);
    const { cookie } = await login(app);
    const page = await get(app, '/apps/clients/staff/', { ...NAVIGATE, cookie: cookie! });
    expect(page.statusCode).toBe(503);
    expect(page.body).toContain(admin.email);
    expect(page.body).toContain(`action="${SURFACE_SIGN_OUT_PATH}"`);
    expect(page.body).toContain('enctype="text/plain"');
    const token = /name="csrf" value="([^"]+)"/.exec(page.body)?.[1];
    expect(token).toBeTruthy();

    const post = (body: string) =>
      app.inject({
        method: 'POST',
        url: SURFACE_SIGN_OUT_PATH,
        headers: { cookie: cookie!, 'content-type': 'text/plain', origin: 'http://localhost', host: 'localhost' },
        payload: body,
      });
    // The same two legs as any mutation: a wrong token is refused.
    expect((await post('csrf=not-the-token\r\n')).statusCode).toBe(403);
    const out = await post(`csrf=${token!}\r\n`);
    expect(out.statusCode).toBe(303);
    expect(out.headers.location).toBe('/login');
    const after = await get(app, '/api/v1/bootstrap', { cookie: cookie! });
    expect(after.statusCode).toBe(401);
  });
});

describe('the staff screens’ own grant', () => {
  /** A signed-in person holding one role, and that role's grants. */
  async function person(fixture: AuthTestApp, email: string, grant: 'none' | 'app' | 'every') {
    const role = await rolesRepo(fixture.meta).create({ slug: `role-${grant}`, name: `Role ${grant}` });
    if (grant !== 'none') {
      await permissionsRepo(fixture.meta).grant(role.id, 'app', grant === 'app' ? 'clients' : '*', { staff: true });
    }
    const user = await usersRepo(fixture.meta).create({ email, name: email, passwordHash: await adminPasswordHash() });
    await rolesRepo(fixture.meta).assignToUser(user.id, role.id);
    return (await login(fixture.app, email, ADMIN_PASSWORD)).cookie!;
  }

  /** The composed server's permission checks, which the bare harness does not register. */
  async function buildWithRbac(): Promise<AuthTestApp> {
    const fixture = await build();
    await fixture.app.register(rbacPlugin, { meta: fixture.meta });
    return fixture;
  }

  it('opens an app’s staff screens only for a role that holds app:<key>:staff', async () => {
    const { app } = await buildWithRbac();
    const without = await person(t!, 'cara@example.com', 'none');
    const refused = await get(app, '/apps/clients/staff/surface-config.json', { cookie: without });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toMatchObject({ reason: 'NO_STAFF_ACCESS', appKey: 'clients' });

    for (const [email, grant] of [['dan@example.com', 'app'], ['eve@example.com', 'every']] as const) {
      const cookie = await person(t!, email, grant);
      expect((await get(app, '/apps/clients/staff/', { cookie, ...NAVIGATE })).statusCode).toBe(200);
    }
    // The customer side is the public's: no grant is asked there.
    expect((await get(app, '/apps/clients/customer/', NAVIGATE)).statusCode).not.toBe(403);
  });

  it('gives the built-in roles every app’s staff screens, as before the grant existed', async () => {
    const { app } = await buildWithRbac();
    const editor = (await rolesRepo(t!.meta).findBySlug('editor'))!;
    const user = await usersRepo(t!.meta).create({ email: 'fay@example.com', name: 'Fay', passwordHash: await adminPasswordHash() });
    await rolesRepo(t!.meta).assignToUser(user.id, editor.id);
    const { cookie } = await login(app, 'fay@example.com', ADMIN_PASSWORD);
    expect((await get(app, '/apps/clients/staff/', { cookie: cookie!, ...NAVIGATE })).statusCode).toBe(200);
  });
});

describe('the bootstrap', () => {
  it('drops a disabled app’s section and pages, and says why', async () => {
    const { app } = await build();
    await pagesRepo(t!.meta).create({
      connectionId: null,
      slug: 'clients-list',
      type: 'page-crud',
      title: 'Clients',
      navGroup: 'library',
      config: { app: 'clients' },
      origin: 'manifest',
    });
    await setStatus(t!, 'disabled');
    const { cookie } = await login(app);
    const data = (await get(app, '/api/v1/bootstrap', { cookie: cookie! })).json().data;
    expect(data.unavailableApps).toEqual([{ appKey: 'clients', label: 'clients', reason: 'app-disabled' }]);
    expect(data.disabledAppPages.map((p: { slug: string }) => p.slug)).toEqual(['clients-list']);
    const navSlugs = (data.nav.groups as { items: { slug: string }[] }[]).flatMap((g) => g.items.map((i) => i.slug));
    expect(navSlugs).not.toContain('clients-list');
  });

  it('says which app a page belongs to while the app is on', async () => {
    const { app } = await build();
    await pagesRepo(t!.meta).create({
      connectionId: null,
      slug: 'clients-list',
      type: 'page-crud',
      title: 'Clients',
      navGroup: 'library',
      config: { app: 'clients' },
      origin: 'manifest',
    });
    await pagesRepo(t!.meta).create({
      connectionId: null,
      slug: 'my-notes',
      type: 'page-crud',
      title: 'Notes',
      navGroup: 'library',
      config: {},
      origin: 'user',
    });
    const { cookie } = await login(app);
    const data = (await get(app, '/api/v1/bootstrap', { cookie: cookie! })).json().data;
    const items = (data.nav.groups as { items: { slug: string; appKey: string | null }[] }[]).flatMap((g) => g.items);
    expect(items.find((i) => i.slug === 'clients-list')?.appKey).toBe('clients');
    expect(items.find((i) => i.slug === 'my-notes')?.appKey).toBeNull();
  });

  it('gives an installed app its own section: its pages under its groups, and its staff screens', async () => {
    const { app } = await build();
    const repo = manifestsRepo(t!.meta, IDENTITY);
    const installed = await repo.install({
      manifestKey: 'clients',
      version: '1.2.0',
      kind: 'app',
      source: 'file',
      document: { name: 'Clients', navGroups: [{ key: 'manage', label: { 'en-US': 'Manage', 'de-DE': 'Verwalten' }, order: 1 }] },
    });
    await repo.setStatus(installed.row.id, 'installed');
    const page = (slug: string, group: string | null, order: number) =>
      pagesRepo(t!.meta).create({
        connectionId: null,
        slug,
        type: 'page-crud',
        title: slug,
        navGroup: 'app',
        navOrder: order,
        config: { app: 'clients', nav: group === null ? { order } : { group, order } },
        origin: 'manifest',
      });
    await page('clients-list', 'manage', 2);
    await page('clients-overview', null, 0);
    t!.app.surfaceSettings?.invalidate();
    const { cookie } = await login(app);
    const data = (await get(app, '/api/v1/bootstrap', { cookie: cookie! })).json().data;
    expect(data.appSections).toEqual([
      {
        appKey: 'clients',
        label: 'Clients',
        version: '1.2.0',
        groups: [
          { key: '', label: null, items: [expect.objectContaining({ slug: 'clients-overview', appKey: 'clients' })] },
          { key: 'manage', label: 'Manage', items: [expect.objectContaining({ slug: 'clients-list' })] },
        ],
        staff: null,
      },
    ]);
    // Out of the five groups, and not lost among the hidden ones.
    const navSlugs = (data.nav.groups as { items: { slug: string }[] }[]).flatMap((g) => g.items.map((i) => i.slug));
    expect(navSlugs).not.toContain('clients-list');
    expect(data.hiddenPages.map((p: { slug: string }) => p.slug)).not.toContain('clients-list');

    // Placed on its own address: the section links there.
    await settingsRepo(t!.meta).set('surfaces.apps', { clients: { staff: 'external' } });
    t!.app.surfaceSettings?.invalidate();
    const external = (await get(app, '/api/v1/bootstrap', { cookie: cookie! })).json().data;
    expect(external.appSections[0].staff).toMatchObject({ placement: 'external', url: '/apps/clients/staff/' });

    // Switched off: no section at all.
    await setStatus(t!, 'disabled');
    const off = (await get(app, '/api/v1/bootstrap', { cookie: cookie! })).json().data;
    expect(off.appSections).toEqual([]);
    expect(off.disabledAppPages.map((p: { slug: string }) => p.slug).sort()).toEqual(['clients-list', 'clients-overview']);
  });

  it('names an app placed on its own address, with the address', async () => {
    const { app } = await build();
    await settingsRepo(t!.meta).set('surfaces.apps', { clients: { staff: 'external' } });
    t!.app.surfaceSettings?.invalidate();
    const { cookie } = await login(app);
    const data = (await get(app, '/api/v1/bootstrap', { cookie: cookie! })).json().data;
    expect(data.unavailableApps).toEqual([
      { appKey: 'clients', label: 'clients', reason: 'external', href: '/apps/clients/staff/' },
    ]);
  });
});

describe('an app’s own public key', () => {
  function memoryStore(meta: MetaDb): MetaStoreHandle {
    return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  }

  it('stops with the app; an operator’s own key does not', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await settingsRepo(meta).set('publicApi.enabled', true);
    const runService = createRunService({ meta });
    const composed = await composeServer({
      env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: 'https://shop.example.com', HOST: '127.0.0.1' }),
      metaStore: memoryStore(meta),
      manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: { templates: [], widgets: [], widgetContracts: {} },
      logger: false,
      telemetry: false,
      onMetaRelocated: () => undefined,
    });
    await composed.app.ready();
    try {
      const connection = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({
        name: 'Shop',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@db.internal:5432/shop',
      });
      const scope = await publicScopesRepo(meta).create({
        connectionId: connection.id,
        side: 'customer',
        name: 'storefront',
        timezone: 'Europe/London',
        document: JSON.stringify({
          version: 1,
          side: 'customer',
          timezone: 'Europe/London',
          resources: [{ ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id', 'name'] }],
        }),
      });
      const mint = async (managedBy: string | null): Promise<string> => {
        const { token, prefix, tokenHash } = generatePublishableKey('browser');
        await publicKeysRepo(meta).create({
          name: managedBy ?? 'web',
          prefix,
          tokenHash,
          tokenEncrypted: 'sealed',
          scopeId: scope.id,
          side: 'customer',
          managedBy,
        });
        return token;
      };
      const appKey = await mint('clients');
      const ownKey = await mint(null);
      const config = (token: string) =>
        composed.app.inject({
          method: 'GET',
          url: '/api/v1/public/config',
          headers: { origin: 'https://shop.example.com', authorization: `Bearer ${token}` },
        });
      expect((await config(appKey)).statusCode).toBe(200);

      await manifestsRepo(meta, IDENTITY).install({
        manifestKey: 'clients',
        version: '1.0.0',
        kind: 'app',
        source: 'file',
        document: {},
        status: 'installing',
      });
      const row = (await manifestsRepo(meta, IDENTITY).list('app'))[0]!;
      await manifestsRepo(meta, IDENTITY).setStatus(row.row.id, 'disabled');
      composed.app.surfaceSettings?.invalidate();
      const refused = await config(appKey);
      expect(refused.statusCode).toBe(503);
      expect(refused.json().error.code).toBe('APP_DISABLED');
      expect((await config(ownKey)).statusCode).toBe(200);

      await manifestsRepo(meta, IDENTITY).setStatus(row.row.id, 'installed');
      await settingsRepo(meta).set('surfaces.apps', { clients: { off: ['customer'] } });
      composed.app.surfaceSettings?.invalidate();
      expect((await config(appKey)).json().error.code).toBe('SURFACE_OFF');
    } finally {
      await composed.app.close();
      await meta.db.destroy();
    }
  }, 60_000);
});

describe('the page and its language', () => {
  const t0 = (_key: string, fallback: string, args: Record<string, unknown> = {}) =>
    fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(args[name] ?? ''));

  it('escapes what it prints, and turns Arabic right to left', () => {
    const html = renderUnavailablePage({
      side: 'staff',
      reason: 'side-off',
      appName: '<b>POS</b>',
      venueName: 'Café "Daybreak"',
      user: { name: 'Ava <Reyes>', email: 'ava@example.test' },
      signOut: { action: '/surface-sign-out', field: 'csrf', token: 'abc' },
      lang: 'ar-EG',
      t: t0,
    });
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain('<b>POS</b>');
    expect(html).toContain('&lt;b&gt;POS&lt;/b&gt;');
    expect(html).toContain('Ava &lt;Reyes&gt;');
    expect(html).not.toMatch(/<script/i);
  });

  it('picks the reader’s language from the built-in eight, by preference', () => {
    expect(negotiateLocale('fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr_FR');
    expect(negotiateLocale('xx,da;q=0.5,de;q=0.7')).toBe('de_DE');
    expect(negotiateLocale('zh-TW')).toBe('zh_TW');
    expect(negotiateLocale('xx, *')).toBeNull();
    expect(negotiateLocale(undefined)).toBeNull();
  });
});

describe('the app’s own settings in its surface config', () => {
  it('serves its declared settings with their defaults, and never a secret', async () => {
    const { app } = await build();
    const repo = manifestsRepo(t!.meta, IDENTITY);
    // The database it was installed into keeps its venue on Lisbon time, in euros.
    const connections = connectionsRepo(t!.meta, dsnCryptoFromSecret(TEST_SECRET));
    const venue = await connections.create({
      name: 'Cafe',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/cafe',
      timezone: 'Europe/Lisbon',
    });
    await connections.update(venue.id, { currency: 'EUR' });
    await repo.install({
      manifestKey: 'clients',
      version: '1.0.0',
      kind: 'app',
      source: 'file',
      connectionId: venue.id,
      document: {
        settings: [
          { key: 'business_type', type: 'enum', enum: ['restaurant', 'retail'], default: 'restaurant' },
          { key: 'api_token', type: 'string', secret: true },
        ],
      },
    });
    const { cookie } = await login(app);
    const config = await get(app, '/apps/clients/staff/surface-config.json', { cookie: cookie! });
    expect(config.statusCode, config.body).toBe(200);
    expect(config.json().settings).toEqual({ business_type: 'restaurant' });
    // The venue's clock and money, so the screens need not read the connections list.
    expect(config.json()).toMatchObject({
      connectionId: venue.id,
      timezone: 'Europe/Lisbon',
      currency: 'EUR',
      serverTimezone: expect.any(String),
    });
  });
});

