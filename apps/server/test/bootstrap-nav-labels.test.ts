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
  row: { slug: string; title: string; connectionId?: string | null; navGroup?: string },
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
      navGroup: row.navGroup ?? 'workspace',
      navOrder: 0,
      config: JSON.stringify({ v: 1, kind: 'page', template: 'page-crud' }),
      origin: 'generated',
      manifestId: null,
      generatedFromSnapshotId: null,
      revision: 1,
      isEnabled: writeBool(meta, true),
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
    };
    const { nav } = buildNavTree([row], new Map());
    expect(nav.groups[0]?.items[0]).toMatchObject({
      connectionId: row.connectionId,
      connectionName: null,
    });
  });
});
