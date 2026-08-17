// SPDX-License-Identifier: AGPL-3.0-only
/**
 * User-directory routes (08-server-api.md §2.15): the list page and its
 * filters, the invite → activation-token → `POST /auth/password/reset` round
 * trip (this build has no SMTP, so the token IS the delivery), the two
 * asymmetric role guards, suspend-vs-hard-delete, the permission matrix, and
 * audit coverage of every mutation.
 *
 * The harness mirrors `rbac-helpers.ts` but builds the server WITH a meta
 * store so the real `/auth/password/reset` handler is mounted — the invite
 * token has to drive it end to end, not a stub.
 */
import { createHash } from 'node:crypto';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  createSqliteMetaDb,
  destroyMetaDb,
  firstRun,
  initMetaDb,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createSession } from '../src/auth/sessions.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { permissionsRoutes } from '../src/routes/permissions/index.js';
import { INVITE_TOKEN_TTL_MS } from '../src/routes/users/invite.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { makeEnv } from './helpers.js';

interface UsersTestContext {
  app: AdminiumServer;
  meta: MetaDb;
  /** `peopleAdmin` holds users.manage + roles.manage but is NOT super-admin. */
  users: { superAdmin: User; admin: User; peopleAdmin: User; viewer: User };
  roles: { superAdmin: Role; admin: Role; viewer: Role; people: Role };
}

let ctx: UsersTestContext;

afterEach(async () => {
  await ctx.app.close();
  await destroyMetaDb(ctx.meta);
});

/** Header identifying the acting session user to the stub auth hook. */
function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildUsersTestApp(): Promise<UsersTestContext> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta); // FK cascade is load-bearing for the hard-delete case
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const permissions = permissionsRepo(meta);

  async function builtin(slug: string): Promise<Role> {
    const role = await roles.findBySlug(slug);
    if (role === null) throw new Error(`missing built-in role ${slug}`);
    return role;
  }
  const people = await roles.create({ slug: 'people-admin', name: 'People Admin' });
  await permissions.grant(people.id, 'system', 'users.manage', { allowed: true });
  await permissions.grant(people.id, 'system', 'roles.manage', { allowed: true });
  const roleSet = {
    superAdmin: await builtin('super-admin'),
    admin: await builtin('admin'),
    viewer: await builtin('viewer'),
    people,
  };

  async function makeUser(name: string, role: Role): Promise<User> {
    const user = await users.create({
      email: `${name.toLowerCase()}@adminium.test`,
      name,
      passwordHash: 'test-hash',
      status: 'active',
    });
    await roles.assignToUser(user.id, role.id);
    return user;
  }
  const userSet = {
    superAdmin: await makeUser('Ava', roleSet.superAdmin),
    admin: await makeUser('Noah', roleSet.admin),
    peopleAdmin: await makeUser('Iris', roleSet.people),
    viewer: await makeUser('Liam', roleSet.viewer),
  };

  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });

  // Stub for plugins/auth.ts: x-test-user-id → request.user. Runs after the
  // real auth hook, so the header wins when present and the cookie path is
  // untouched for the /auth/* routes this suite drives.
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });

  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(usersRoutes);
      await api.register(permissionsRoutes);
    },
    { prefix: '/api/v1' },
  );

  await app.ready();
  return { app, meta, users: userSet, roles: roleSet };
}

interface InviteReplyBody {
  user: { id: string; email: string; status: string; roles: { slug: string }[] };
  invite: { token: string; expiresAt: number; activationPath: string };
  emailSent: false;
}

async function invite(
  payload: { email: string; name: string; roleIds?: string[] },
  actor: User = ctx.users.superAdmin,
): Promise<InviteReplyBody> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/users',
    headers: asUser(actor),
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as InviteReplyBody;
}

describe('GET /users', () => {
  it('pages newest-first on a keyset cursor and reports whole-directory counts', async () => {
    ctx = await buildUsersTestApp();
    await invite({ email: 'kai@adminium.test', name: 'Kai' });

    const first = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/users?limit=2',
      headers: asUser(ctx.users.superAdmin),
    });
    expect(first.statusCode).toBe(200);
    const page1 = first.json() as {
      users: { id: string; roles: { slug: string }[] }[];
      nextCursor: string | null;
      counts: { active: number; invited: number; suspended: number };
    };
    expect(page1.users).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    // Counts are directory-wide, not page-scoped.
    expect(page1.counts).toEqual({ active: 4, invited: 1, suspended: 0 });

    const second = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/users?limit=10&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
      headers: asUser(ctx.users.superAdmin),
    });
    const page2 = second.json() as { users: { id: string }[]; nextCursor: string | null };
    expect(page2.nextCursor).toBeNull();
    const seen = new Set([...page1.users, ...page2.users].map((u) => u.id));
    expect(seen.size).toBe(5); // four seeded + the invitee, no repeats

    // Role chips ride along so the page renders without system:roles:manage.
    const ava = [...page1.users, ...page2.users].find((u) => u.id === ctx.users.superAdmin.id);
    expect(ava?.roles.map((role) => role.slug)).toEqual(['super-admin']);
  });

  it('filters by q, status, and roleId', async () => {
    ctx = await buildUsersTestApp();
    await invite({ email: 'kai@adminium.test', name: 'Kai Ito' });

    const list = async (query: string) => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/users?${query}`,
        headers: asUser(ctx.users.superAdmin),
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { users: { email: string }[] }).users.map((u) => u.email);
    };

    expect(await list('q=KAI')).toEqual(['kai@adminium.test']); // case-insensitive
    expect(await list('q=adminium.test')).toHaveLength(5); // matches on email too
    expect(await list('status=invited')).toEqual(['kai@adminium.test']);
    expect(await list(`roleId=${ctx.roles.viewer.id}`)).toEqual(['liam@adminium.test']);
    expect(await list('q=%25')).toEqual([]); // LIKE wildcards are escaped
  });
});

describe('POST /users — invite', () => {
  it('creates an invited user with no credential and a hashed single-use token', async () => {
    ctx = await buildUsersTestApp();
    const created = await invite({ email: 'Kai@Adminium.Test', name: 'Kai' });

    expect(created.user.status).toBe('invited');
    expect(created.user.email).toBe('kai@adminium.test');
    expect(created.emailSent).toBe(false);
    expect(created.invite.activationPath).toBe(`/reset/${created.invite.token}`);

    const row = await usersRepo(ctx.meta).findById(created.user.id);
    expect(row?.passwordHash).toBeNull();
    // No secret material in the projection — not even the columns that hold it.
    expect(created.user).not.toHaveProperty('passwordHash');
    expect(created.user).not.toHaveProperty('totpSecretEncrypted');
    expect(created.user).not.toHaveProperty('recoveryCodes');

    const resets = await ctx.meta.db
      .selectFrom('adminium_password_resets')
      .selectAll()
      .where('userId', '=', created.user.id)
      .execute();
    expect(resets).toHaveLength(1);
    const reset = resets[0];
    expect(reset?.kind).toBe('invite');
    expect(reset?.tokenHash).toBe(
      createHash('sha256').update(created.invite.token, 'utf8').digest('hex'),
    );
    // The plaintext lands nowhere at rest.
    expect(JSON.stringify(reset)).not.toContain(created.invite.token);
    expect(reset?.expiresAt).toBe((reset?.createdAt ?? 0) + INVITE_TOKEN_TTL_MS);
  });

  it('the returned token completes POST /auth/password/reset and activates the account', async () => {
    ctx = await buildUsersTestApp();
    const created = await invite({ email: 'kai@adminium.test', name: 'Kai' });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token: created.invite.token, newPassword: 'correct-horse-battery-staple' },
    });
    expect(res.statusCode, res.body).toBe(200);

    const activated = await usersRepo(ctx.meta).findById(created.user.id);
    expect(activated?.status).toBe('active');
    expect(activated?.passwordHash).not.toBeNull();

    // Single-use: the replay is refused.
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token: created.invite.token, newPassword: 'another-passphrase-entirely' },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('409s on a duplicate email and 404s on an unknown role', async () => {
    ctx = await buildUsersTestApp();
    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: asUser(ctx.users.superAdmin),
      payload: { email: 'AVA@adminium.test', name: 'Impostor' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as { error: { code: string } }).error.code).toBe('UNIQUE_VIOLATION');

    const missingRole = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: asUser(ctx.users.superAdmin),
      payload: { email: 'kai@adminium.test', name: 'Kai', roleIds: ['role_missing'] },
    });
    expect(missingRole.statusCode).toBe(404);
    // The refused invite left no half-created account behind.
    expect(await usersRepo(ctx.meta).findByEmail('kai@adminium.test')).toBeNull();
  });

  it('resend mints a fresh token and refuses an already-activated account', async () => {
    ctx = await buildUsersTestApp();
    const created = await invite({ email: 'kai@adminium.test', name: 'Kai' });

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${created.user.id}/invite/resend`,
      headers: asUser(ctx.users.superAdmin),
    });
    expect(again.statusCode, again.body).toBe(200);
    const resent = again.json() as InviteReplyBody;
    expect(resent.invite.token).not.toBe(created.invite.token);
    expect(resent.emailSent).toBe(false);

    const activeUser = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${ctx.users.viewer.id}/invite/resend`,
      headers: asUser(ctx.users.superAdmin),
    });
    expect(activeUser.statusCode).toBe(409);
  });
});

describe('PUT /users/:id/roles — the two asymmetric guards', () => {
  it('only a super admin may mint one', async () => {
    ctx = await buildUsersTestApp();
    // Iris holds users.manage + roles.manage but not super-admin.
    const escalate = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/users/${ctx.users.peopleAdmin.id}/roles`,
      headers: asUser(ctx.users.peopleAdmin),
      payload: { roleIds: [ctx.roles.people.id, ctx.roles.superAdmin.id] },
    });
    expect(escalate.statusCode).toBe(403);

    const allowed = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/users/${ctx.users.peopleAdmin.id}/roles`,
      headers: asUser(ctx.users.superAdmin),
      payload: { roleIds: [ctx.roles.superAdmin.id] },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect((allowed.json() as { roles: { slug: string }[] }).roles.map((r) => r.slug)).toEqual([
      'super-admin',
    ]);
  });

  it('refuses to strip the last super admin, then allows it once there are two', async () => {
    ctx = await buildUsersTestApp();
    const strip = async () =>
      ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/users/${ctx.users.superAdmin.id}/roles`,
        headers: asUser(ctx.users.superAdmin),
        payload: { roleIds: [ctx.roles.admin.id] },
      });

    const refused = await strip();
    expect(refused.statusCode).toBe(409);

    await rolesRepo(ctx.meta).assignToUser(ctx.users.admin.id, ctx.roles.superAdmin.id);
    const allowed = await strip();
    expect(allowed.statusCode, allowed.body).toBe(200);
  });

  it('replaces the whole set and requires system:roles:manage on top of users.manage', async () => {
    ctx = await buildUsersTestApp();
    // Noah is an Admin: users.manage (so he can invite) but no roles.manage.
    const refused = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/users/${ctx.users.viewer.id}/roles`,
      headers: asUser(ctx.users.admin),
      payload: { roleIds: [ctx.roles.admin.id] },
    });
    expect(refused.statusCode).toBe(403);

    // …and the same key gates picking roles at invite time.
    const refusedInvite = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: asUser(ctx.users.admin),
      payload: { email: 'kai@adminium.test', name: 'Kai', roleIds: [ctx.roles.admin.id] },
    });
    expect(refusedInvite.statusCode).toBe(403);
    // An Admin can still invite — that is the whole point of the new grant.
    await invite({ email: 'kai@adminium.test', name: 'Kai' }, ctx.users.admin);

    const replaced = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/users/${ctx.users.viewer.id}/roles`,
      headers: asUser(ctx.users.superAdmin),
      payload: { roleIds: [ctx.roles.admin.id] },
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect((replaced.json() as { roles: { slug: string }[] }).roles.map((r) => r.slug)).toEqual([
      'admin',
    ]);
  });
});

describe('DELETE /users/:id', () => {
  it('suspends by default and revokes every session', async () => {
    ctx = await buildUsersTestApp();
    const { session } = await createSession(ctx.meta, ctx.users.viewer.id);

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ctx.users.viewer.id}`,
      headers: asUser(ctx.users.superAdmin),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, permanent: false });

    expect((await usersRepo(ctx.meta).findById(ctx.users.viewer.id))?.status).toBe('suspended');
    const stored = await ctx.meta.db
      .selectFrom('adminium_sessions')
      .selectAll()
      .where('id', '=', session.id)
      .executeTakeFirst();
    expect(stored?.revokedAt).not.toBeNull();
    // The row — and the history hanging off it — survives.
    expect(await usersRepo(ctx.meta).findById(ctx.users.viewer.id)).not.toBeNull();
  });

  it('hard-deletes only behind ?permanent=true', async () => {
    ctx = await buildUsersTestApp();
    const created = await invite({ email: 'kai@adminium.test', name: 'Kai' });

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${created.user.id}?permanent=true`,
      headers: asUser(ctx.users.superAdmin),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, permanent: true, user: null });

    expect(await usersRepo(ctx.meta).findById(created.user.id)).toBeNull();
    // ON DELETE CASCADE took the pending invite with it.
    const resets = await ctx.meta.db
      .selectFrom('adminium_password_resets')
      .selectAll()
      .where('userId', '=', created.user.id)
      .execute();
    expect(resets).toHaveLength(0);
  });

  it('refuses to remove the last super admin or the caller', async () => {
    ctx = await buildUsersTestApp();
    const lastSuperAdmin = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ctx.users.superAdmin.id}`,
      headers: asUser(ctx.users.peopleAdmin),
    });
    expect(lastSuperAdmin.statusCode).toBe(409);

    const self = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ctx.users.peopleAdmin.id}`,
      headers: asUser(ctx.users.peopleAdmin),
    });
    expect(self.statusCode).toBe(409);
  });
});

describe('PATCH /users/:id', () => {
  it('renames, rejects a taken email, and refuses to activate a never-set credential', async () => {
    ctx = await buildUsersTestApp();
    const created = await invite({ email: 'kai@adminium.test', name: 'Kai' });

    const renamed = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.user.id}`,
      headers: asUser(ctx.users.superAdmin),
      payload: { name: 'Kai Ito' },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((renamed.json() as { name: string }).name).toBe('Kai Ito');

    const taken = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.user.id}`,
      headers: asUser(ctx.users.superAdmin),
      payload: { email: 'ava@adminium.test' },
    });
    expect(taken.statusCode).toBe(409);

    const activate = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.user.id}`,
      headers: asUser(ctx.users.superAdmin),
      payload: { status: 'active' },
    });
    expect(activate.statusCode).toBe(409);
  });

  it('reinstates a suspended user', async () => {
    ctx = await buildUsersTestApp();
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ctx.users.viewer.id}`,
      headers: asUser(ctx.users.superAdmin),
    });
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${ctx.users.viewer.id}`,
      headers: asUser(ctx.users.superAdmin),
      payload: { status: 'active' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { status: string }).status).toBe('active');
  });
});

describe('GET /permissions/catalog', () => {
  it('offers the grantable keys only — never the reserved four', async () => {
    ctx = await buildUsersTestApp();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/permissions/catalog',
      headers: asUser(ctx.users.superAdmin),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      system: { key: string; label: string; category: string }[];
      tableActions: string[];
      pageActions: string[];
    };
    const keys = body.system.map((entry) => entry.key);
    expect(keys).toContain('system:users:manage');
    expect(keys).toContain('system:roles:manage');
    for (const reserved of [
      'system:automations:manage',
      'system:webhooks:manage',
      'system:manifests:manage',
      'system:sql:run',
    ]) {
      expect(keys, reserved).not.toContain(reserved);
    }
    expect(body.system.every((entry) => entry.label.length > 0)).toBe(true);
    expect(body.tableActions).toContain('read');
    expect(body.pageActions).toEqual(['view', 'edit']);

    // Reading the catalog is a roles:manage power.
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/permissions/catalog',
      headers: asUser(ctx.users.admin),
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('permission enforcement + audit', () => {
  it('a viewer is refused on every verb', async () => {
    ctx = await buildUsersTestApp();
    const target = ctx.users.admin.id;
    const calls: { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; url: string; payload?: unknown }[] = [
      { method: 'GET', url: '/api/v1/users' },
      { method: 'POST', url: '/api/v1/users', payload: { email: 'kai@adminium.test', name: 'Kai' } },
      { method: 'GET', url: `/api/v1/users/${target}` },
      { method: 'PATCH', url: `/api/v1/users/${target}`, payload: { name: 'Nope' } },
      { method: 'DELETE', url: `/api/v1/users/${target}` },
      { method: 'PUT', url: `/api/v1/users/${target}/roles`, payload: { roleIds: [] } },
      { method: 'POST', url: `/api/v1/users/${target}/invite/resend` },
      { method: 'GET', url: '/api/v1/permissions/catalog' },
    ];
    for (const call of calls) {
      const res = await ctx.app.inject({
        method: call.method,
        url: call.url,
        headers: asUser(ctx.users.viewer),
        ...(call.payload === undefined ? {} : { payload: call.payload }),
      });
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(403);
    }
    // Nothing slipped through.
    expect(await usersRepo(ctx.meta).findByEmail('kai@adminium.test')).toBeNull();
  });

  it('every mutation lands an rbac audit row, and never the token', async () => {
    ctx = await buildUsersTestApp();
    const created = await invite({ email: 'kai@adminium.test', name: 'Kai' });
    const headers = asUser(ctx.users.superAdmin);

    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${created.user.id}/invite/resend`,
      headers,
    });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${created.user.id}`,
      headers,
      payload: { name: 'Kai Ito' },
    });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/users/${ctx.users.viewer.id}/roles`,
      headers,
      payload: { roleIds: [ctx.roles.admin.id] },
    });
    await ctx.app.inject({ method: 'DELETE', url: `/api/v1/users/${ctx.users.viewer.id}`, headers });
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${created.user.id}?permanent=true`,
      headers,
    });

    const entries = await auditRepo(ctx.meta).list({ category: 'rbac' });
    const actions = entries.map((entry) => entry.action);
    for (const action of [
      'user.invite',
      'user.invite.resend',
      'user.update',
      'user.roles.replace',
      'user.suspend',
      'user.delete',
    ]) {
      expect(actions, action).toContain(action);
    }
    expect(JSON.stringify(entries)).not.toContain(created.invite.token);
  });
});
