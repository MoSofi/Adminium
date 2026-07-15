/**
 * Dashboard layout persistence (04-widget-registry.md §6.3, 04-T13):
 *
 * - the RBAC split — a viewer may save a personal override but NOT the shared
 *   default (viewer PUT /me/views 200; viewer PATCH /pages/:id/layout 403);
 *   super-admins and page-edit grantees may PATCH the shared default;
 * - resolution order — a per-user override wins over the shared default on GET,
 *   and reset (DELETE) restores the shared default without touching it;
 * - `pageLayoutSchema` rejects an out-of-range item (422);
 * - the shared PATCH is idempotent and audited.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { meViewsRoutes } from '../src/routes/me-views/index.js';
import { pagesRoutes } from '../src/routes/pages/index.js';
import { makeEnv } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  pageId: string;
  superAdmin: User;
  editor: User;
  viewer: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

const item = (i: string, x = 0) => ({ i, widget: 'kpi-stat-card', x, y: 0, w: 4, h: 3, config: {} });
const layout = (i: string) => ({ version: 1 as const, items: [item(i)] });

const SHARED = layout('shared');

function envelope(): unknown {
  return {
    v: 1,
    kind: 'dashboard',
    id: 'page_dash',
    template: 'page-dashboard',
    title: { key: 'nav.overview', fallback: 'Overview' },
    config: { layout: SHARED },
  };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  async function makeUser(name: string, roleSlug: string): Promise<User> {
    const role: Role | null = await roles.findBySlug(roleSlug);
    if (role === null) throw new Error(`missing built-in role ${roleSlug}`);
    const user = await users.create({ email: `${name}@adminium.test`, name, passwordHash: 'h', status: 'active' });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const superAdmin = await makeUser('ava', 'super-admin');
  const editor = await makeUser('noah', 'editor');
  const viewer = await makeUser('liam', 'viewer');

  const page = await pagesRepo(meta).create({
    connectionId: null,
    slug: 'overview',
    type: 'page-dashboard',
    title: 'Overview',
    config: envelope(),
  });

  // Grant page-EDIT to the editor's built-in role for this page only.
  const editorRole = await roles.findBySlug('editor');
  if (editorRole === null) throw new Error('missing editor role');
  await permissionsRepo(meta).grant(editorRole.id, 'page', page.id, { view: true, edit: true });

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  // Stub session auth: x-test-user-id → request.user + a live session so
  // `app.requireAuth` (which checks both) passes.
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        const req = request as unknown as { user: unknown; session: unknown };
        req.user = { id: user.id, name: user.name, email: user.email };
        req.session = { id: 'test-session', userId: user.id };
      }
    }
  });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(pagesRoutes({ meta }));
      await api.register(meViewsRoutes({ meta }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, pageId: page.id, superAdmin, editor, viewer };
}

describe('dashboard layout persistence', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const patchShared = (user: User, body: unknown) =>
    t.app.inject({ method: 'PATCH', url: `/api/v1/pages/${t.pageId}/layout`, headers: asUser(user), payload: body });
  const putPersonal = (user: User, body: unknown) =>
    t.app.inject({ method: 'PUT', url: `/api/v1/me/views/${t.pageId}/layout`, headers: asUser(user), payload: body });
  const del = (user: User) =>
    t.app.inject({ method: 'DELETE', url: `/api/v1/me/views/${t.pageId}/layout`, headers: asUser(user) });
  const get = (user: User) =>
    t.app.inject({ method: 'GET', url: `/api/v1/pages/${t.pageId}`, headers: asUser(user) });

  const layoutOf = (res: Awaited<ReturnType<typeof get>>) => res.json().data.config.layout;

  it('gates the shared default on page-edit: viewer 403, editor + super-admin 200', async () => {
    const next = layout('by-admin');

    const denied = await patchShared(t.viewer, next);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('PAGE_FORBIDDEN');
    // The denied write never touched the stored default.
    expect(layoutOf(await get(t.viewer))).toEqual(SHARED);

    // A page-edit grantee and a super-admin both succeed.
    expect((await patchShared(t.editor, next)).statusCode).toBe(200);
    expect((await patchShared(t.superAdmin, next)).statusCode).toBe(200);
    // The shared default now resolves for everyone without an override.
    expect(layoutOf(await get(t.viewer))).toEqual(next);
  });

  it('returns the per-caller page:<id>:edit capability on GET (canEditLayout)', async () => {
    // The dashboard builder routes shared-vs-personal on THIS flag, matching the
    // PATCH gate exactly — a granted editor + super-admin true, a viewer false.
    expect((await get(t.viewer)).json().canEditLayout).toBe(false);
    expect((await get(t.editor)).json().canEditLayout).toBe(true);
    expect((await get(t.superAdmin)).json().canEditLayout).toBe(true);
  });

  it('lets any viewer save a personal override, which wins over the shared default', async () => {
    const mine = layout('by-viewer');
    const saved = await putPersonal(t.viewer, mine);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.layout).toEqual(mine);

    // The viewer sees their override; other users still see the shared default.
    expect(layoutOf(await get(t.viewer))).toEqual(mine);
    expect(layoutOf(await get(t.editor))).toEqual(SHARED);
  });

  it('reset (DELETE) restores the shared default without a reload', async () => {
    await putPersonal(t.viewer, layout('by-viewer'));
    expect(layoutOf(await get(t.viewer))).toEqual(layout('by-viewer'));

    const reset = await del(t.viewer);
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data).toEqual({ ok: true });
    expect(layoutOf(await get(t.viewer))).toEqual(SHARED);
  });

  it('a personal override survives a change to the shared default (override wins)', async () => {
    await putPersonal(t.viewer, layout('by-viewer'));
    await patchShared(t.superAdmin, layout('by-admin'));

    expect(layoutOf(await get(t.viewer))).toEqual(layout('by-viewer')); // override wins
    expect(layoutOf(await get(t.editor))).toEqual(layout('by-admin')); // follows default
  });

  it('rejects an out-of-range layout item with 422 (both write paths)', async () => {
    const bad = { version: 1, items: [{ ...item('bad'), x: 12 }] }; // x max is 11
    const shared = await patchShared(t.superAdmin, bad);
    expect(shared.statusCode).toBe(422);
    expect(shared.json().error.code).toBe('VALIDATION_FAILED');

    const personal = await putPersonal(t.viewer, bad);
    expect(personal.statusCode).toBe(422);
    expect(personal.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('is idempotent: PATCHing the same layout twice yields the same stored default', async () => {
    const next = layout('by-admin');
    const first = await patchShared(t.superAdmin, next);
    const second = await patchShared(t.superAdmin, next);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().data.layout).toEqual(second.json().data.layout);
    expect(layoutOf(await get(t.superAdmin))).toEqual(next);
  });

  it('audits shared-default writes (category data, action page.layout.update)', async () => {
    await patchShared(t.superAdmin, layout('by-admin'));
    const rows = await auditRepo(t.meta).list({ category: 'data' });
    const entry = rows.find((e) => e.action === 'page.layout.update');
    expect(entry).toBeDefined();
    expect(entry?.actorId).toBe(t.superAdmin.id);

    // Personal overrides are private + reversible — not audited.
    await putPersonal(t.viewer, layout('by-viewer'));
    const after = await auditRepo(t.meta).list({ category: 'data' });
    expect(after.filter((e) => e.action === 'page.layout.update')).toHaveLength(1);
  });

  it('404s a layout write against a missing page (both paths)', async () => {
    const shared = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/pages/page_missing/layout',
      headers: asUser(t.superAdmin),
      payload: layout('x'),
    });
    expect(shared.statusCode).toBe(404);

    const personal = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/me/views/page_missing/layout',
      headers: asUser(t.viewer),
      payload: layout('x'),
    });
    expect(personal.statusCode).toBe(404);
  });
});
