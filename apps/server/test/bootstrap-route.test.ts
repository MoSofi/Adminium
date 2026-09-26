// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /api/v1/bootstrap: auth gating, resolved prefs, nav-tree derivation
 * from adminium_pages (fixed group order, disabled rows dropped, navOrder
 * sort), and the version/configVersion stamps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_PAGES_REF,
  connectionsRepo,
  newId,
  permissionsRepo,
  rolesRepo,
  settingsRepo,
  SYSTEM_ACTION_KEYS,
  usersRepo,
  writeBool,
  type MetaDb,
} from '@adminium/meta';

import { rbacPlugin } from '../src/plugins/rbac.js';
import { APP_VERSION } from '../src/version.js';
import { ADMIN_PASSWORD, adminPasswordHash, buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

async function insertPage(
  meta: MetaDb,
  row: {
    slug: string;
    title: string;
    navGroup: string | null;
    navOrder?: number;
    icon?: string | null;
    isEnabled?: boolean;
    updatedAt?: number;
    connectionId?: string | null;
  },
): Promise<string> {
  const id = newId('page');
  const now = row.updatedAt ?? Date.now();
  await meta.db
    .insertInto('adminium_pages')
    .values({
      id,
      connectionId: row.connectionId ?? null,
      slug: row.slug,
      type: 'page-crud',
      title: row.title,
      icon: row.icon ?? null,
      navGroup: row.navGroup,
      navOrder: row.navOrder ?? 0,
      config: JSON.stringify({ v: 1, kind: 'page', template: 'page-crud' }),
      origin: 'generated',
      manifestId: null,
      generatedFromSnapshotId: null,
      revision: 1,
      isEnabled: writeBool(meta, row.isEnabled ?? true),
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

describe('GET /api/v1/bootstrap', () => {
  let t: AuthTestApp;

  beforeEach(async () => {
    t = await buildAuthApp();
  });
  afterEach(async () => {
    await t.destroy();
  });

  it('requires a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/bootstrap' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns user, roles, resolved prefs and an empty nav tree', async () => {
    const { cookie } = await login(t.app);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.user.email).toBe(t.admin.email);
    expect(data.roles).toContain('super-admin');
    // Fresh install: every axis resolves from the system defaults.
    expect(data.prefs.theme).toBe('system');
    expect(data.prefs.accent).toBe('indigo');
    expect(data.prefs.source.theme).toBe('system');
    expect(data.nav).toEqual({ groups: [] });
    expect(data.version).toBe(APP_VERSION);
    expect(data.configVersion).toBe(0);
    expect(data.llm).toEqual({ enabled: false });
  });

  it('systemActions: every key for a Super Admin, exactly the seeded set for an Admin', async () => {
    // `buildServer` alone mounts no RBAC; the composition root adds it after,
    // exactly like this (compose.ts). Without it every key reads as not held.
    await t.app.register(rbacPlugin, { meta: t.meta });
    const asSuper = await login(t.app);
    const superReply = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: asSuper.cookie ?? '' },
    });
    expect(superReply.json().data.systemActions).toEqual([...SYSTEM_ACTION_KEYS]);

    // A second account holding only the built-in Admin role. What the rail and
    // the Team page offer it is read off this list, so it has to be the grants
    // the route guards will honour — not "admin, therefore everything".
    const adminRole = await rolesRepo(t.meta).findBySlug('admin');
    const ian = await usersRepo(t.meta).create({
      email: 'ian@example.com',
      name: 'Ian',
      passwordHash: await adminPasswordHash(),
    });
    await rolesRepo(t.meta).assignToUser(ian.id, adminRole!.id);
    const asAdmin = await login(t.app, 'ian@example.com', ADMIN_PASSWORD);
    const adminReply = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: asAdmin.cookie ?? '' },
    });
    const held: string[] = adminReply.json().data.systemActions;
    expect(held).toEqual(
      expect.arrayContaining(['users.manage', 'audit.read', 'connections.manage']),
    );
    for (const refused of ['roles.manage', 'api-keys.manage', 'automations.manage', 'pages.manage', 'schema.ddl']) {
      expect(held, refused).not.toContain(refused);
    }
  });

  it('hasConnections: true once any database is connected, paused or not', async () => {
    const { cookie } = await login(t.app);
    const connected = async (): Promise<boolean> =>
      (await t.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie ?? '' } })).json().data.hasConnections;
    expect(await connected()).toBe(false);
    const connections = connectionsRepo(t.meta, { encrypt: (v: string) => v, decrypt: (v: string) => v });
    const studio = await connections.create({ name: 'studio', engine: 'sqlite', introspectDsn: 'file:studio.db', dataDsn: 'file:studio.db' });
    await connections.setDisabled(studio.id, true);
    // Paused, and with no pages: a database is still connected.
    expect(await connected()).toBe(true);
  });

  it('pagesWithheld: true only when enabled pages exist that the session cannot view', async () => {
    await t.app.register(rbacPlugin, { meta: t.meta });
    const adminRole = await rolesRepo(t.meta).findBySlug('admin');
    const ian = await usersRepo(t.meta).create({
      email: 'ian@example.com',
      name: 'Ian',
      passwordHash: await adminPasswordHash(),
    });
    await rolesRepo(t.meta).assignToUser(ian.id, adminRole!.id);
    const asSuper = await login(t.app);
    const asAdmin = await login(t.app, 'ian@example.com', ADMIN_PASSWORD);
    const withheld = async (cookie: string | null): Promise<boolean> =>
      (
        await t.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: cookie ?? '' } })
      ).json().data.pagesWithheld;

    // No pages at all: nothing is withheld from anyone — the rail's
    // "connect a database" is the true sentence.
    expect(await withheld(asAdmin.cookie)).toBe(false);

    // A disabled page withholds nothing either: nobody sees it.
    await insertPage(t.meta, { slug: 'off', title: 'Off', navGroup: 'workspace', isEnabled: false });
    expect(await withheld(asAdmin.cookie)).toBe(false);

    await insertPage(t.meta, { slug: 'orders', title: 'Orders', navGroup: 'workspace' });
    // The seeded default: the built-in Admin views every page.
    expect(await withheld(asAdmin.cookie)).toBe(false);

    // An operator narrows the Admin's pages to none.
    await permissionsRepo(t.meta).revoke(adminRole!.id, 'page', ALL_PAGES_REF);
    expect(await withheld(asAdmin.cookie)).toBe(true);
    expect(await withheld(asSuper.cookie)).toBe(false);
  });

  it('llm.enabled mirrors the provider config (true once llm.provider is set)', async () => {
    // The regression this pins: llm.enabled was hard-coded false ("lands in
    // M6") long after M6 shipped, so the wizard's provider card and the
    // palette's Ask AI footer could never enable.
    await settingsRepo(t.meta).set('llm.provider', 'openai', { updatedBy: null });
    const { cookie } = await login(t.app);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.llm).toEqual({ enabled: true });
  });

  it('derives the nav tree: fixed group order, navOrder sort, disabled dropped', async () => {
    const t2 = Date.now();
    await insertPage(t.meta, { slug: 'orders', title: 'Orders', navGroup: 'workspace', navOrder: 2 });
    await insertPage(t.meta, {
      slug: 'customers',
      title: 'Customers',
      navGroup: 'workspace',
      navOrder: 1,
      icon: 'users',
    });
    await insertPage(t.meta, { slug: 'exports', title: 'Data exports', navGroup: 'library' });
    await insertPage(t.meta, { slug: 'profile', title: 'Profile', navGroup: 'account' });
    await insertPage(t.meta, {
      slug: 'hidden',
      title: 'Hidden',
      navGroup: 'workspace',
      isEnabled: false,
      updatedAt: t2 + 5_000,
    });
    // Not nav-visible (no group) but still bumps configVersion.
    await insertPage(t.meta, { slug: 'detached', title: 'Detached', navGroup: null });

    const { cookie } = await login(t.app);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();

    // Empty groups omitted; fixed order workspace → library → … → account.
    expect(data.nav.groups.map((g: { key: string }) => g.key)).toEqual([
      'workspace',
      'library',
      'account',
    ]);
    const workspace = data.nav.groups[0];
    expect(workspace.items.map((i: { slug: string }) => i.slug)).toEqual(['customers', 'orders']);
    expect(workspace.items[0]).toMatchObject({
      slug: 'customers',
      labelKey: 'nav.customers',
      fallback: 'Customers',
      icon: 'users',
      order: 1,
    });
    // Icon falls back to a neutral glyph when the row has none.
    expect(workspace.items[1].icon).toBe('file');
    // configVersion tracks the max updatedAt across ALL rows, disabled included.
    expect(data.configVersion).toBeGreaterThanOrEqual(t2 + 5_000);
  });

  /**
   * Pausing a connection (meta wave 0019) takes its pages out of the SIDEBAR
   * and out of `hiddenPages` — the list record-page related tabs and
   * cross-links enumerate — leaving them only in `pausedPages`, which nothing
   * but the `/p/<slug>` URL resolver reads.
   *
   * The first cut of the pause left the nav alone, so a paused source kept a
   * full rail of entries that all landed on "This connection is paused". A
   * pause that only greys out the Studio card is half a pause.
   */
  it('a paused connection leaves the nav and hiddenPages, and lands in pausedPages', async () => {
    async function makeConnection(name: string, disabledAt: number | null): Promise<string> {
      const id = newId('conn');
      await t.meta.db
        .insertInto('adminium_connections')
        .values({
          id,
          name,
          engine: 'postgres',
          sourceKind: 'dsn',
          introspectDsnEncrypted: 'sealed',
          settings: '{}',
          status: 'connected',
          disabledAt,
          createdAt: 1,
          updatedAt: 1,
        } as never)
        .execute();
      return id;
    }
    const live = await makeConnection('Live', null);
    const paused = await makeConnection('Paused', Date.now());

    await insertPage(t.meta, { slug: 'orders', title: 'Orders', navGroup: 'workspace', connectionId: live });
    // A hidden (group-less) page on the LIVE connection stays enumerable.
    await insertPage(t.meta, { slug: 'order-items', title: 'Items', navGroup: null, connectionId: live });
    // Both of the paused connection's pages go, grouped or not.
    await insertPage(t.meta, { slug: 'clients', title: 'Clients', navGroup: 'workspace', connectionId: paused });
    await insertPage(t.meta, { slug: 'client-notes', title: 'Notes', navGroup: null, connectionId: paused });

    const { cookie } = await login(t.app);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();

    const navSlugs = data.nav.groups.flatMap((g: { items: Array<{ slug: string }> }) =>
      g.items.map((i) => i.slug),
    );
    expect(navSlugs).toEqual(['orders']);
    // NOT folded into `hiddenPages`: that list is still enumerated by related
    // tabs and cross-links, and a paused source must be enumerable by nothing.
    expect(data.hiddenPages.map((i: { slug: string }) => i.slug)).toEqual(['order-items']);
    // …but they still travel, so a bookmark resolves and can explain itself.
    expect(data.pausedPages.map((i: { slug: string }) => i.slug).sort()).toEqual([
      'client-notes',
      'clients',
    ]);
    expect(data.pausedPages[0]).toMatchObject({ connectionId: paused, connectionName: 'Paused' });
  });
});
