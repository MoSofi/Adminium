// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /api/v1/bootstrap (09-generated-app.md §2.1): auth gating, resolved
 * prefs, nav-tree derivation from adminium_pages (fixed group order, disabled
 * rows dropped, navOrder sort), and the version/configVersion stamps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, settingsRepo, writeBool, type MetaDb } from '@adminium/meta';

import { APP_VERSION } from '../src/version.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

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
    // Fresh install: every axis resolves from the system defaults (§7.2).
    expect(data.prefs.theme).toBe('system');
    expect(data.prefs.accent).toBe('indigo');
    expect(data.prefs.source.theme).toBe('system');
    expect(data.nav).toEqual({ groups: [] });
    expect(data.version).toBe(APP_VERSION);
    expect(data.configVersion).toBe(0);
    expect(data.llm).toEqual({ enabled: false });
  });

  it('llm.enabled mirrors the §3.2 provider config (true once llm.provider is set)', async () => {
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
