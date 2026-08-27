// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bootstrap nav connection labels (M5-T05): every nav item carries its
 * owning `connectionId` + `connectionName` so multi-connection sidebars can
 * group unambiguously; connection-less (user/system) pages stay null; an
 * unknown connection id degrades to a null name instead of failing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectionsRepo, newId, writeBool, type MetaDb, type PageNavRow } from '@adminium/meta';

import { buildNavTree } from '../src/routes/bootstrap/handlers.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

/** Plain-text stand-in crypto — names only are read back by bootstrap. */
const NOOP_CRYPTO = { encrypt: (s: string) => s, decrypt: (s: string) => s };

async function insertPage(
  meta: MetaDb,
  row: {
    slug: string;
    title: string;
    connectionId?: string | null;
    /** `null` = hidden from the sidebar (30 follow-up); default 'workspace'. */
    navGroup?: string | null;
    enabled?: boolean;
    sourceTable?: string;
  },
): Promise<string> {
  const id = newId('page');
  const now = Date.now();
  await meta.db
    .insertInto('adminium_pages')
    .values({
      id,
      connectionId: row.connectionId ?? null,
      slug: row.slug,
      type: 'page-crud',
      title: row.title,
      icon: null,
      navGroup: row.navGroup === undefined ? 'workspace' : row.navGroup,
      navOrder: 0,
      config: JSON.stringify({
        v: 1,
        kind: 'page',
        template: 'page-crud',
        ...(row.sourceTable === undefined
          ? {}
          : { source: { connectionId: row.connectionId ?? null, table: row.sourceTable } }),
      }),
      origin: 'generated',
      manifestId: null,
      generatedFromSnapshotId: null,
      revision: 1,
      isEnabled: writeBool(meta, row.enabled ?? true),
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

describe('GET /api/v1/bootstrap nav connection labels', () => {
  let t: AuthTestApp;

  beforeEach(async () => {
    t = await buildAuthApp();
  });
  afterEach(async () => {
    await t.destroy();
  });

  it('annotates items with connectionId + connectionName; shared pages stay null', async () => {
    const repo = connectionsRepo(t.meta, NOOP_CRYPTO);
    const prod = await repo.create({
      name: 'Production Postgres',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@db.internal:5432/prod',
    });
    const warehouse = await repo.create({
      name: 'Analytics MySQL',
      engine: 'mysql',
      introspectDsn: 'mysql://ro@replica.internal:3306/wh',
    });

    await insertPage(t.meta, { slug: 'customers', title: 'Customers', connectionId: prod.id });
    await insertPage(t.meta, { slug: 'events', title: 'Events', connectionId: warehouse.id });
    await insertPage(t.meta, { slug: 'exports', title: 'Data exports', connectionId: null, navGroup: 'library' });

    const { cookie } = await login(t.app);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);

    const items = (res.json().data.nav.groups as Array<{ items: Array<Record<string, unknown>> }>)
      .flatMap((group) => group.items);
    const bySlug = new Map(items.map((item) => [item.slug, item]));

    expect(bySlug.get('customers')).toMatchObject({
      connectionId: prod.id,
      connectionName: 'Production Postgres',
    });
    expect(bySlug.get('events')).toMatchObject({
      connectionId: warehouse.id,
      connectionName: 'Analytics MySQL',
    });
    expect(bySlug.get('exports')).toMatchObject({ connectionId: null, connectionName: null });
  });

  it('buildNavTree degrades an unknown connection id to a null name', () => {
    const row: PageNavRow = {
      id: newId('page'),
      connectionId: newId('conn'),
      slug: 'ghost',
      title: 'Ghost',
      icon: null,
      navGroup: 'workspace',
      navOrder: 0,
      isEnabled: true,
      updatedAt: 1,
      sourceTable: null,
    };
    const { nav } = buildNavTree([row], new Map());
    expect(nav.groups[0]?.items[0]).toMatchObject({
      connectionId: row.connectionId,
      connectionName: null,
    });
  });
});

describe('hidden pages on /bootstrap (30-record-pages.md follow-up)', () => {
  let t: AuthTestApp;
  beforeEach(async () => {
    t = await buildAuthApp();
  });
  afterEach(async () => {
    await t.destroy();
  });

  it('a null-group page rides hiddenPages — full item shape, absent from nav; disabled pages are in neither', async () => {
    await insertPage(t.meta, { slug: 'invoices', title: 'Invoices', navGroup: 'library' });
    await insertPage(t.meta, {
      slug: 'invoice-items',
      title: 'Invoice Items',
      navGroup: null,
      sourceTable: 'public.invoice_items',
    });
    await insertPage(t.meta, {
      slug: 'retired',
      title: 'Retired',
      navGroup: null,
      enabled: false,
    });

    const { cookie } = await login(t.app);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: cookie ?? '' },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as {
      nav: { groups: Array<{ items: Array<{ slug: string }> }> };
      hiddenPages: Array<Record<string, unknown>>;
    };

    const navSlugs = data.nav.groups.flatMap((group) => group.items.map((item) => item.slug));
    expect(navSlugs).toContain('invoices');
    expect(navSlugs).not.toContain('invoice-items');
    expect(navSlugs).not.toContain('retired');

    // The hidden entry carries everything resolution needs — slug for the
    // URL, labelKey/fallback for the tab title, sourceTable for the
    // record-page cross-link map.
    expect(data.hiddenPages).toHaveLength(1);
    expect(data.hiddenPages[0]).toMatchObject({
      slug: 'invoice-items',
      labelKey: 'nav.invoice-items',
      fallback: 'Invoice Items',
      sourceTable: 'public.invoice_items',
    });
  });

  it('buildNavTree splits hidden from nav and still counts hidden rows into configVersion', () => {
    const base = {
      connectionId: null,
      icon: null,
      navOrder: 0,
      isEnabled: true,
      sourceTable: null,
    };
    const rows: PageNavRow[] = [
      { ...base, id: 'page_a', slug: 'a', title: 'A', navGroup: 'library', updatedAt: 5 },
      { ...base, id: 'page_b', slug: 'b', title: 'B', navGroup: null, updatedAt: 9 },
    ];
    const { nav, hidden, configVersion } = buildNavTree(rows, new Map());
    expect(nav.groups.flatMap((group) => group.items.map((item) => item.slug))).toEqual(['a']);
    expect(hidden.map((item) => item.slug)).toEqual(['b']);
    // A hidden page's regeneration must still bump the client cache stamp.
    expect(configVersion).toBe(9);
  });
});
