// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved-views CRUD routes (M5-T06): create/list/rename/default/delete,
 * per-user ownership (a private view is invisible to other users), the
 * unique-name 409, and audit trail on mutations.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { viewsRoutes } from '../src/routes/views/index.js';
import { makeEnv, type InjectPayload } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  pageId: string;
  ava: User;
  noah: User;
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

const config = (search: string) => ({ v: 1 as const, search, sort: null, filters: [], pageSize: 50 });

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
  const ava = await makeUser('ava', 'admin');
  const noah = await makeUser('noah', 'editor');

  const page = await pagesRepo(meta).create({
    connectionId: null,
    slug: 'customers',
    type: 'page-crud',
    title: 'Customers',
    config: { v: 1, kind: 'page', id: 'page_customers', config: {} },
  });

  const app = await buildServer({ env: makeEnv(), logger: false });
  // Stub session auth: x-test-user-id → request.user + a live session.
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
  await app.register(async (api) => api.register(viewsRoutes({ meta })), { prefix: '/api/v1' });
  await app.ready();

  return { app, meta, pageId: page.id, ava, noah };
}

describe('saved-views routes', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const create = (user: User, body: InjectPayload) =>
    t.app.inject({ method: 'POST', url: `/api/v1/pages/${t.pageId}/views`, headers: asUser(user), payload: body });
  const list = (user: User) =>
    t.app.inject({ method: 'GET', url: `/api/v1/pages/${t.pageId}/views`, headers: asUser(user) });

  it('creates, lists, and round-trips the grid config', async () => {
    const res = await create(t.ava, { name: 'Acme', config: config('acme') });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.config).toEqual(config('acme'));

    const listed = await list(t.ava);
    expect(listed.json().data.views).toHaveLength(1);
    expect(listed.json().data.views[0].name).toBe('Acme');
  });

  it('rejects a duplicate name in the same scope with 409', async () => {
    await create(t.ava, { name: 'Recent', config: config('a') });
    const clash = await create(t.ava, { name: 'Recent', config: config('b') });
    expect(clash.statusCode).toBe(409);
    // Same name for a different user is fine (separate scope).
    const other = await create(t.noah, { name: 'Recent', config: config('c') });
    expect(other.statusCode).toBe(201);
  });

  it('keeps private views invisible to other users', async () => {
    const created = (await create(t.ava, { name: 'Ava only', config: config('a') })).json().data;
    // Noah does not see it, and cannot mutate/delete it (404, not 403).
    expect((await list(t.noah)).json().data.views).toHaveLength(0);
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${t.pageId}/views/${created.id}`,
      headers: asUser(t.noah),
      payload: { name: 'Hijack' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${t.pageId}/views/${created.id}`,
      headers: asUser(t.noah),
    });
    expect(del.statusCode).toBe(404);
  });

  it('renames, promotes a single default, and deletes', async () => {
    const first = (await create(t.ava, { name: 'First', config: config('a'), isDefault: true })).json().data;
    const second = (await create(t.ava, { name: 'Second', config: config('b') })).json().data;

    const renamed = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${t.pageId}/views/${first.id}`,
      headers: asUser(t.ava),
      payload: { name: 'First renamed' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.name).toBe('First renamed');

    // Promote the second — exactly one default remains.
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/pages/${t.pageId}/views/${second.id}`,
      headers: asUser(t.ava),
      payload: { isDefault: true },
    });
    const defaults = (await list(t.ava)).json().data.views.filter((v: { isDefault: boolean }) => v.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.id);

    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/pages/${t.pageId}/views/${first.id}`,
      headers: asUser(t.ava),
    });
    expect(del.statusCode).toBe(200);
    expect((await list(t.ava)).json().data.views).toHaveLength(1);
  });

  it('writes an audit entry on create', async () => {
    await create(t.ava, { name: 'Audited', config: config('a') });
    const rows = await t.meta.db
      .selectFrom('adminium_audit_log')
      .selectAll()
      .where('action', '=', 'view.create')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(t.ava.id);
  });
});
