// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ACCOUNT CHANGES ARE HELD TO WHAT THE CALLER HOLDS.
 *
 * "Manage users" changes a person's email and sends them a new sign-in link
 * only when the caller holds everything that person does. Renaming, suspending
 * and reactivating stay open, so a leaver can always be stopped. The callers
 * are real sessions and real keys, on every meta engine.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { apiKeysRepo, passwordResetsRepo, permissionsRepo, rolesRepo, usersRepo, type MetaDb, type Role, type User } from '@adminium/meta';
import { z } from 'zod';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createSession, hashToken, SESSION_COOKIE } from '../src/auth/sessions.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { rolesRoutes } from '../src/routes/roles/index.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaEngine, type MetaHandle } from './meta-dialects.js';

type Caller = { cookies: Record<string, string> } | { headers: Record<string, string> };
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const probeReply = z.object({ ok: z.literal(true) });

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  people: Role;
  above: Role;
  root: User;
  asRoot: Caller;
  mia: User;
  asMia: Caller;
}

let handle: MetaHandle | undefined;
let app: AdminiumServer | undefined;
let seq = 0;

afterEach(async () => {
  await app?.close();
  await handle?.destroy();
  app = undefined;
  handle = undefined;
});

async function person(meta: MetaDb, roles: readonly Role[], status: 'active' | 'invited' = 'active'): Promise<User> {
  seq += 1;
  const user = await usersRepo(meta).create({ email: `p${String(seq)}@adminium.test`, name: `P ${String(seq)}`, passwordHash: status === 'active' ? 'test-hash' : null, status });
  for (const role of roles) await rolesRepo(meta).assignToUser(user.id, role.id);
  return user;
}

async function roleOf(meta: MetaDb, system: readonly string[]): Promise<Role> {
  seq += 1;
  const role = await rolesRepo(meta).create({ slug: `custom-${String(seq)}`, name: `Custom ${String(seq)}` });
  for (const key of system) await permissionsRepo(meta).grant(role.id, 'system', key, { allowed: true });
  return role;
}

async function signedIn(meta: MetaDb, server: AdminiumServer, user: User): Promise<Caller> {
  const { token } = await createSession(meta, user.id);
  return { cookies: { [SESSION_COOKIE]: server.signCookie(token) } };
}

async function build(engine: MetaEngine): Promise<Harness> {
  handle = await engine.make();
  const { meta } = handle;
  const superAdmin = (await rolesRepo(meta).findBySlug('super-admin'))!;
  const people = await roleOf(meta, ['users.manage']);
  const above = await roleOf(meta, ['users.manage', 'settings.manage']);
  const root = await person(meta, [superAdmin]);
  const mia = await person(meta, [people]);
  app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(usersRoutes);
      api.get('/probe/settings', { preHandler: api.rbac.require(PERMISSIONS.settingsManage), schema: { response: { 200: probeReply } } }, async () => ({ ok: true as const }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, meta, people, above, root, asRoot: await signedIn(meta, app, root), mia, asMia: await signedIn(meta, app, mia) };
}

const call = (h: Harness, caller: Caller, method: Method, url: string, payload?: unknown) =>
  h.app.inject({ method, url: `/api/v1${url}`, ...caller, ...(payload === undefined ? {} : { payload: payload as never }) });

function expectRefused(res: { statusCode: number; body: string }): void {
  expect(res.statusCode, res.body).toBe(403);
  expect((JSON.parse(res.body) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('account-above-you');
  expect(res.body).not.toContain('"token"');
}

async function storedKey(h: Harness, roleId: string, createdBy: string | null): Promise<Caller> {
  const generated = generateApiKey();
  await apiKeysRepo(h.meta).create({ name: 'stored', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId, createdBy });
  return { headers: { authorization: `Bearer ${generated.key}` } };
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`account changes above the caller (${engine.name})`, () => {
    it('refuses a new sign-in link for somebody who holds more than the caller', async () => {
      const h = await build(engine);
      const target = await person(h.meta, [h.above], 'invited');
      expect((await call(h, h.asMia, 'GET', '/probe/settings')).statusCode).toBe(403);
      expectRefused(await call(h, h.asMia, 'POST', `/users/${target.id}/invite/resend`));
    });

    it('refuses changing the email of somebody who holds more than the caller', async () => {
      const h = await build(engine);
      const target = await person(h.meta, [h.above]);
      expectRefused(await call(h, h.asMia, 'PATCH', `/users/${target.id}`, { email: 'moved@adminium.test' }));
      expect((await usersRepo(h.meta).findById(target.id))?.email).toBe(target.email);
    });

    it('counts every role the person holds, not only one of them', async () => {
      const h = await build(engine);
      const target = await person(h.meta, [h.people, h.above], 'invited');
      expectRefused(await call(h, h.asMia, 'POST', `/users/${target.id}/invite/resend`));
      expectRefused(await call(h, h.asMia, 'PATCH', `/users/${target.id}`, { email: 'moved@adminium.test' }));
    });

    it('refuses a key held to its maker, and a key with nobody behind it', async () => {
      const h = await build(engine);
      const target = await person(h.meta, [h.above]);
      // This key holds all the target does; the person who made it does not.
      expectRefused(await call(h, await storedKey(h, h.above.id, h.mia.id), 'PATCH', `/users/${target.id}`, { email: 'moved@adminium.test' }));
      expectRefused(await call(h, await storedKey(h, h.above.id, null), 'PATCH', `/users/${target.id}`, { email: 'moved@adminium.test' }));
      expect((await usersRepo(h.meta).findById(target.id))?.email).toBe(target.email);
    });

    it('writes the refusal to the audit log', async () => {
      const h = await build(engine);
      const target = await person(h.meta, [h.above]);
      expectRefused(await call(h, h.asMia, 'PATCH', `/users/${target.id}`, { email: 'moved@adminium.test' }));
      const rows = await h.meta.db.selectFrom('adminium_audit_log').select(['changes']).where('action', '=', 'permission.denied').execute();
      const after = rows.map((row) => ((typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) as { after?: Record<string, unknown> }).after);
      expect(after.find((one) => one?.['reason'] === 'account-above-you')?.['userId']).toBe(target.id);
      expect(JSON.stringify(after)).not.toContain('moved@adminium.test');
    });

    it('tells the People page whose sign-in the caller cannot change', async () => {
      const h = await build(engine);
      const higher = await person(h.meta, [h.above], 'invited');
      const peer = await person(h.meta, [h.people], 'invited');
      const listed = (await call(h, h.asMia, 'GET', '/users')).json<{ users: { id: string; signInLocked: boolean }[] }>().users;
      const locked = (user: User) => listed.find((one) => one.id === user.id)?.signInLocked;
      expect([locked(higher), locked(peer), locked(h.mia)]).toEqual([true, false, false]);
      const asRoot = (await call(h, h.asRoot, 'GET', '/users')).json<{ users: { id: string; signInLocked: boolean }[] }>().users;
      expect(asRoot.find((one) => one.id === higher.id)?.signInLocked).toBe(false);
    });

    it('still lets the caller rename, suspend and reactivate somebody above them', async () => {
      const h = await build(engine);
      const target = await person(h.meta, [h.above]);
      expect((await call(h, h.asMia, 'PATCH', `/users/${target.id}`, { name: 'Renamed' })).statusCode).toBe(200);
      expect((await call(h, h.asMia, 'PATCH', `/users/${target.id}`, { email: target.email, name: 'Renamed again' })).statusCode).toBe(200);
      expect((await call(h, h.asMia, 'PATCH', `/users/${target.id}`, { status: 'suspended' })).statusCode).toBe(200);
      expect((await usersRepo(h.meta).findById(target.id))?.status).toBe('suspended');
      expect((await call(h, h.asMia, 'PATCH', `/users/${target.id}`, { status: 'active' })).statusCode).toBe(200);
    });

    it('still lets the caller change the sign-in of somebody they hold all of', async () => {
      const h = await build(engine);
      const peer = await person(h.meta, [h.people], 'invited');
      const noRoles = await person(h.meta, []);
      expect((await call(h, h.asMia, 'POST', `/users/${peer.id}/invite/resend`)).statusCode).toBe(200);
      expect((await call(h, h.asMia, 'PATCH', `/users/${noRoles.id}`, { email: 'moved@adminium.test' })).statusCode).toBe(200);
    });

    it('ends an invitation when an admin corrects the address it went to', async () => {
      const h = await build(engine);
      const made = await call(h, h.asRoot, 'POST', '/users', { email: 'first@adminium.test', name: 'First' });
      expect(made.statusCode, made.body).toBe(201);
      const { user, invite } = made.json<{ user: { id: string }; invite: { token: string } }>();
      expect((await call(h, h.asRoot, 'PATCH', `/users/${user.id}`, { email: 'second@adminium.test' })).statusCode).toBe(200);
      const redeemed = await h.app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token: invite.token, newPassword: 'a-new-password-here' } });
      expect(redeemed.statusCode, redeemed.body).toBe(401);
      expect((await usersRepo(h.meta).findById(user.id))?.status).toBe('invited');
    });

    it('ends a reset link when an admin changes the address', async () => {
      const h = await build(engine);
      const target = await person(h.meta, [h.people]);
      const token = `reset-${String(++seq)}-token`;
      await passwordResetsRepo(h.meta).create({ userId: target.id, kind: 'reset', tokenHash: hashToken(token), expiresAt: Date.now() + 3_600_000 });
      expect((await call(h, h.asRoot, 'PATCH', `/users/${target.id}`, { email: 'moved@adminium.test' })).statusCode).toBe(200);
      const redeemed = await h.app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token, newPassword: 'a-new-password-here' } });
      expect(redeemed.statusCode, redeemed.body).toBe(401);
    });

    it('ends an invitation when the person invited is given another role', async () => {
      const h = await build(engine);
      const made = await call(h, h.asMia, 'POST', '/users', { email: 'raised@adminium.test', name: 'Raised' });
      expect(made.statusCode, made.body).toBe(201);
      const { user, invite } = made.json<{ user: { id: string }; invite: { token: string } }>();
      await h.app.close();
      app = await buildServer({ env: makeEnv(), logger: false, metaDb: h.meta });
      await app.register(rbacPlugin, { meta: h.meta });
      await app.register(async (api) => {
        await api.register(usersRoutes);
        await api.register(rolesRoutes);
      }, { prefix: '/api/v1' });
      await app.ready();
      const root = await createSession(h.meta, h.root.id);
      const raised = await app.inject({ method: 'POST', url: `/api/v1/users/${user.id}/roles`, cookies: { [SESSION_COOKIE]: app.signCookie(root.token) }, payload: { roleId: h.above.id } });
      expect(raised.statusCode, raised.body).toBe(200);
      const redeemed = await app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token: invite.token, newPassword: 'a-new-password-here' } });
      expect(redeemed.statusCode, redeemed.body).toBe(401);
    });

    it('ends an invitation when a replaced role list gives the person more', async () => {
      const h = await build(engine);
      const made = await call(h, h.asMia, 'POST', '/users', { email: 'replaced@adminium.test', name: 'Replaced' });
      const { user, invite } = made.json<{ user: { id: string }; invite: { token: string } }>();
      const manages = await roleOf(h.meta, ['users.manage', 'roles.manage', 'settings.manage']);
      const admin = await signedIn(h.meta, h.app, await person(h.meta, [manages]));
      const raised = await call(h, admin, 'PUT', `/users/${user.id}/roles`, { roleIds: [h.above.id] });
      expect(raised.statusCode, raised.body).toBe(200);
      const redeemed = await h.app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token: invite.token, newPassword: 'a-new-password-here' } });
      expect(redeemed.statusCode, redeemed.body).toBe(401);
    });

    it('lets a signed-in Super Admin do both', async () => {
      const h = await build(engine);
      const invited = await person(h.meta, [h.above], 'invited');
      const active = await person(h.meta, [h.above]);
      expect((await call(h, h.asRoot, 'POST', `/users/${invited.id}/invite/resend`)).statusCode).toBe(200);
      expect((await call(h, h.asRoot, 'PATCH', `/users/${active.id}`, { email: 'moved@adminium.test' })).statusCode).toBe(200);
    });
  });
}
