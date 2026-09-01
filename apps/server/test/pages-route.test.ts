// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GET /api/v1/pages/:pageId (08-server-api.md §2.6 read surface): returns the
 * stored envelope verbatim under `data`, 404s on missing/disabled pages, and
 * requires an authenticated principal. This is the endpoint the dashboard's
 * PageRenderer loads every /p/$slug route through (09-generated-app.md §2.3).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pagesRepo, writeBool, type MetaDb } from '@adminium/meta';

import { pagesRoutes } from '../src/routes/pages/index.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

const ENVELOPE = {
  v: 1,
  kind: 'page',
  id: 'page_customers',
  template: 'page-crud',
  title: { key: 'nav.customers', fallback: 'Customers' },
  source: { connectionId: 'conn_test', table: 'public.customers' },
  nav: { group: 'library', icon: 'table', order: 10, slug: 'customers' },
  access: { minRole: 'viewer', permissions: [] },
  config: { columns: [] },
};

async function insertPage(
  meta: MetaDb,
  opts: { slug: string; isEnabled?: boolean; config?: unknown },
): Promise<string> {
  const pages = pagesRepo(meta);
  // connectionId null: adminium_connections has an FK and this suite runs on a
  // bare meta db; universal (connection-less) pages exercise the same read path.
  const page = await pages.create({
    connectionId: null,
    slug: opts.slug,
    type: 'page-crud',
    title: opts.slug,
    navGroup: 'library',
    config: opts.config ?? ENVELOPE,
    origin: 'generated',
  });
  const id = page.id;
  if (opts.isEnabled === false) {
    await meta.db
      .updateTable('adminium_pages')
      .set({ isEnabled: writeBool(meta, false) } as never)
      .where('id', '=', id)
      .execute();
  }
  return id;
}

describe('lifecycle routes without rbacPlugin', () => {
  // This harness mounts `pagesRoutes` with no RBAC plugin — the minimal
  // read-only shape. The lifecycle routes must still REGISTER: a 404 here is
  // indistinguishable from a server that predates the feature, which is
  // exactly the confusion an earlier early-return version caused. Fail closed
  // with a 403, but fail *legibly*.
  let t: AuthTestApp;
  let cookie: string;

  beforeEach(async () => {
    t = await buildAuthApp();
    await t.app.register(
      async (api) => {
        await api.register(pagesRoutes({ meta: t.meta }));
      },
      { prefix: '/api/v1' },
    );
    const auth = await login(t.app);
    cookie = auth.cookie ?? '';
  });
  afterEach(async () => {
    await t.destroy();
  });

  it('registers every lifecycle route — none of them 404', async () => {
    // The invariant is REGISTRATION. Bodyless verbs land on the preHandler and
    // give the clean 403; the others carry a body, and Fastify runs schema
    // validation *before* preHandler, so a deliberately-empty payload 422s
    // first. Either way the route exists, which is the thing a stale
    // deployment cannot fake.
    for (const [method, url] of [
      ['GET', '/api/v1/pages'],
      ['POST', '/api/v1/pages'],
      ['PUT', '/api/v1/pages/nav-order'],
      ['PATCH', '/api/v1/pages/page_x'],
      ['DELETE', '/api/v1/pages/page_x'],
    ] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: { cookie },
        ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
      });
      expect({ url, is404: res.statusCode === 404 }).toEqual({ url, is404: false });
    }
  });

  it('refuses the bodyless lifecycle verbs with 403', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/pages'],
      ['DELETE', '/api/v1/pages/page_x'],
    ] as const) {
      const res = await t.app.inject({ method, url, headers: { cookie } });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 403 });
    }
  });
});

describe('GET /api/v1/pages/:pageId', () => {
  let t: AuthTestApp;
  let cookie: string;

  beforeEach(async () => {
    t = await buildAuthApp();
    await t.app.register(
      async (api) => {
        await api.register(pagesRoutes({ meta: t.meta }));
      },
      { prefix: '/api/v1' },
    );
    const auth = await login(t.app);
    cookie = auth.cookie ?? '';
  });

  afterEach(async () => {
    await t.destroy();
  });

  it('returns the stored envelope verbatim under data', async () => {
    const id = await insertPage(t.meta, { slug: 'customers' });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    // The stored envelope is returned verbatim under `data`, alongside the
    // per-caller `canEditLayout` capability (false without rbac in this harness).
    expect(res.json()).toEqual({ data: ENVELOPE, canEditLayout: false });
  });

  it('404s on an unknown page id', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/pages/page_missing',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('404s on a disabled page (never leaks its existence)', async () => {
    const id = await insertPage(t.meta, { slug: 'hidden', isEnabled: false });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/pages/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const id = await insertPage(t.meta, { slug: 'products' });
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/pages/${id}` });
    expect(res.statusCode).toBe(401);
  });
});
