// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NOBODY HANDS OUT POWER THEY DO NOT HOLD.
 *
 * Somebody who manages roles and is not a signed-in Super Admin may create,
 * clone or edit a role only with permissions they fully hold, limits included;
 * may not change or delete a role above them; and may not give or take such a
 * role from anybody, themselves included. A key is held to its own permissions
 * and to those of the person who made it. What is already stored stays. The
 * callers are real sessions and real keys, on every meta engine.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  apiKeysRepo,
  manifestsRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type TableActions,
  type User,
} from '@adminium/meta';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { buildServer, type AdminiumServer } from '../src/app.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { apiKeysRoutes } from '../src/routes/api-keys/index.js';
import { rolesRoutes } from '../src/routes/roles/index.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaEngine, type MetaHandle } from './meta-dialects.js';

const DEALS = 'c1/public.deals';
const DEALS_READ = 'table:c1:public.deals:read';
const DEALS_UPDATE = 'table:c1:public.deals:update';
const SETTINGS = 'system:settings:manage';
const MANAGER_GRANTS = ['system:roles:manage', 'system:users:manage', 'system:api-keys:manage', DEALS_READ, DEALS_UPDATE];
const NO_ACTIONS: TableActions = { read: false, create: false, update: false, delete: false, export: false, import: false };

type Caller = { cookies: Record<string, string> } | { headers: Record<string, string> };
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdminRole: Role;
  manager: Role;
  above: Role;
  within: Role;
  root: User;
  mia: User;
  other: User;
  holder: User;
  asRoot: Caller;
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

async function person(meta: MetaDb, role: Role): Promise<User> {
  seq += 1;
  const user = await usersRepo(meta).create({ email: `p${String(seq)}@adminium.test`, name: `P ${String(seq)}`, passwordHash: 'test-hash', status: 'active' });
  await rolesRepo(meta).assignToUser(user.id, role.id);
  return user;
}

async function roleOf(meta: MetaDb, system: readonly string[], table: Partial<TableActions> | null = null): Promise<Role> {
  seq += 1;
  const role = await rolesRepo(meta).create({ slug: `custom-${String(seq)}`, name: `Custom ${String(seq)}` });
  for (const key of system) await permissionsRepo(meta).grant(role.id, 'system', key, { allowed: true });
  if (table !== null) await permissionsRepo(meta).grant(role.id, 'table', DEALS, { ...NO_ACTIONS, ...table });
  return role;
}

async function signedIn(meta: MetaDb, server: AdminiumServer, user: User): Promise<Caller> {
  const { token } = await createSession(meta, user.id);
  return { cookies: { [SESSION_COOKIE]: server.signCookie(token) } };
}

async function build(engine: MetaEngine): Promise<Harness> {
  handle = await engine.make();
  const { meta } = handle;
  const superAdminRole = (await rolesRepo(meta).findBySlug('super-admin'))!;
  const manager = await roleOf(meta, ['roles.manage', 'users.manage', 'api-keys.manage'], { read: true, update: true });
  const above = await roleOf(meta, ['settings.manage']);
  const within = await roleOf(meta, [], { read: true });
  const root = await person(meta, superAdminRole);
  const mia = await person(meta, manager);
  const other = await person(meta, within);
  const holder = await person(meta, above);

  app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(rolesRoutes);
      await api.register(usersRoutes);
      await api.register(apiKeysRoutes);
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, meta, superAdminRole, manager, above, within, root, mia, other, holder, asRoot: await signedIn(meta, app, root), asMia: await signedIn(meta, app, mia) };
}

const call = (h: Harness, caller: Caller, method: Method, url: string, payload?: unknown) =>
  h.app.inject({ method, url: `/api/v1${url}`, ...caller, ...(payload === undefined ? {} : { payload: payload as never }) });

function expectRefused(res: { statusCode: number; body: string }): void {
  expect(res.statusCode, res.body).toBe(403);
  expect((JSON.parse(res.body) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('role-above-you');
}

async function storedKey(h: Harness, roleId: string, createdBy: string | null): Promise<Caller> {
  const generated = generateApiKey();
  await apiKeysRepo(h.meta).create({ name: 'stored', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId, createdBy });
  return { headers: { authorization: `Bearer ${generated.key}` } };
}

const grantsOf = async (h: Harness, role: Role): Promise<string[]> =>
  (await call(h, h.asRoot, 'GET', `/roles/${role.id}/permissions`)).json<{ grants: string[] }>().grants.sort();
const rolesHeld = async (h: Harness, user: User): Promise<string[]> =>
  (await rolesRepo(h.meta).rolesForUser(user.id)).map((role) => role.id).sort();

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`who may hand out a role (${engine.name})`, () => {
    describe('creating and cloning', () => {
      it('refuses a clone of Super Admin or of a role above the caller, and makes no role', async () => {
        const h = await build(engine);
        const before = (await rolesRepo(h.meta).list()).length;
        expectRefused(await call(h, h.asMia, 'POST', '/roles', { name: 'Root copy', cloneFromRoleId: h.superAdminRole.id }));
        expectRefused(await call(h, h.asMia, 'POST', '/roles', { name: 'Above copy', cloneFromRoleId: h.above.id }));
        expect(await rolesRepo(h.meta).list()).toHaveLength(before);
      });

      it('clones a role the caller fully holds, and makes an empty one', async () => {
        const h = await build(engine);
        const cloned = await call(h, h.asMia, 'POST', '/roles', { name: 'Readers', cloneFromRoleId: h.within.id });
        expect(cloned.statusCode, cloned.body).toBe(201);
        expect((await call(h, h.asMia, 'POST', '/roles', { name: 'Empty' })).statusCode).toBe(201);
      });
    });

    describe('editing', () => {
      it('refuses adding a permission the caller lacks, to any role, their own included', async () => {
        const h = await build(engine);
        expectRefused(await call(h, h.asMia, 'PUT', `/roles/${h.within.id}/permissions`, { grants: [DEALS_READ, SETTINGS] }));
        expectRefused(await call(h, h.asMia, 'PUT', `/roles/${h.manager.id}/permissions`, { grants: [...MANAGER_GRANTS, SETTINGS] }));
        expect(await grantsOf(h, h.within)).toEqual([DEALS_READ]);
        expect(await grantsOf(h, h.manager)).toEqual([...MANAGER_GRANTS].sort());
      });

      it('refuses taking a row limit off the caller’s own role', async () => {
        const h = await build(engine);
        const limited = await roleOf(h.meta, ['roles.manage'], { read: true, rowLimit: { read: { reach: 'own' } } });
        const caller = await signedIn(h.meta, h.app, await person(h.meta, limited));
        expectRefused(await call(h, caller, 'PUT', `/roles/${limited.id}/permissions`, { grants: ['system:roles:manage', DEALS_READ], rows: { [DEALS]: null } }));
        const stored = (await permissionsRepo(h.meta).listForRole(limited.id)).find((row) => row.resourceKind === 'table');
        expect((stored?.actions as TableActions).rowLimit).toEqual({ read: { reach: 'own' } });
      });

      it('refuses renaming, editing or deleting a role above the caller', async () => {
        const h = await build(engine);
        expectRefused(await call(h, h.asMia, 'PATCH', `/roles/${h.above.id}`, { name: 'Renamed' }));
        expectRefused(await call(h, h.asMia, 'PUT', `/roles/${h.above.id}/permissions`, { grants: [] }));
        expectRefused(await call(h, h.asMia, 'DELETE', `/roles/${h.above.id}?reassignTo=${h.within.id}`));
        expect((await rolesRepo(h.meta).findById(h.above.id))?.name).toBe(h.above.name);
        expect(await grantsOf(h, h.above)).toEqual([SETTINGS]);
        expect(await rolesHeld(h, h.holder)).toEqual([h.above.id]);
      });

      it('refuses moving a deleted role’s members onto a role above the caller', async () => {
        const h = await build(engine);
        expectRefused(await call(h, h.asMia, 'DELETE', `/roles/${h.within.id}?reassignTo=${h.above.id}`));
        expect(await rolesHeld(h, h.other)).toEqual([h.within.id]);
      });

      it('edits, renames and deletes a role within the caller', async () => {
        const h = await build(engine);
        const saved = await call(h, h.asMia, 'PUT', `/roles/${h.within.id}/permissions`, { grants: [DEALS_READ, DEALS_UPDATE] });
        expect(saved.statusCode, saved.body).toBe(200);
        expect((await call(h, h.asMia, 'PATCH', `/roles/${h.within.id}`, { name: 'Deal desk' })).statusCode).toBe(200);
        const spare = await roleOf(h.meta, [], { read: true });
        expect((await call(h, h.asMia, 'DELETE', `/roles/${spare.id}`)).statusCode).toBe(200);
      });

      it('keeps a save of the caller’s own role that changes nothing it does not hold', async () => {
        const h = await build(engine);
        const shaped = await roleOf(h.meta, ['roles.manage']);
        await permissionsRepo(h.meta).grant(shaped.id, 'table', '*/*', { ...NO_ACTIONS, read: true });
        await permissionsRepo(h.meta).grant(shaped.id, 'table', DEALS, { ...NO_ACTIONS, read: true, rowLimit: { read: { reach: 'own' } } });
        const caller = await signedIn(h.meta, h.app, await person(h.meta, shaped));
        const res = await call(h, caller, 'PUT', `/roles/${shaped.id}/permissions`, { grants: ['system:roles:manage', 'table:*:*:read', DEALS_READ] });
        expect(res.statusCode, res.body).toBe(200);
      });

      it('lets the caller take a permission off a role beside a limit', async () => {
        const h = await build(engine);
        const shaped = await roleOf(h.meta, ['roles.manage']);
        await permissionsRepo(h.meta).grant(shaped.id, 'table', '*/*', { ...NO_ACTIONS, read: true, update: true });
        await permissionsRepo(h.meta).grant(shaped.id, 'table', DEALS, { ...NO_ACTIONS, read: true, rowLimit: { read: { reach: 'own' } } });
        const caller = await signedIn(h.meta, h.app, await person(h.meta, shaped));
        const res = await call(h, caller, 'PUT', `/roles/${shaped.id}/permissions`, { grants: ['system:roles:manage', 'table:*:*:read', DEALS_READ] });
        expect(res.statusCode, res.body).toBe(200);
        expect(await grantsOf(h, shaped)).not.toContain('table:*:*:update');
      });

      it('refuses dropping a limited row when a wider grant would then reach it', async () => {
        const h = await build(engine);
        const shaped = await roleOf(h.meta, ['roles.manage']);
        await permissionsRepo(h.meta).grant(shaped.id, 'table', '*/*', { ...NO_ACTIONS, read: true });
        await permissionsRepo(h.meta).grant(shaped.id, 'table', DEALS, { ...NO_ACTIONS, read: true, rowLimit: { read: { reach: 'own' } } });
        const caller = await signedIn(h.meta, h.app, await person(h.meta, shaped));
        expectRefused(await call(h, caller, 'PUT', `/roles/${shaped.id}/permissions`, { grants: ['system:roles:manage', 'table:*:*:read'], rows: { [DEALS]: null } }));
        expect(await grantsOf(h, shaped)).toContain(DEALS_READ);
      });

      it('copies a role only within the caller’s column and value limits', async () => {
        const h = await build(engine);
        const limit = { writable: ['status'], writableValues: { status: ['open'] } };
        const limited = await roleOf(h.meta, ['roles.manage'], { read: true, readLimit: { readable: ['id', 'name'] }, update: true, updateLimit: limit });
        const caller = await signedIn(h.meta, h.app, await person(h.meta, limited));
        const copy = async (actions: Partial<TableActions>) => call(h, caller, 'POST', '/roles', { name: `Copy ${String(++seq)}`, cloneFromRoleId: (await roleOf(h.meta, [], actions)).id });
        expectRefused(await copy({ read: true, readLimit: { readable: ['id', 'price'] } }));
        expectRefused(await copy({ read: true, readLimit: { readable: ['id'] }, update: true, updateLimit: { writable: ['status'], writableValues: { status: ['open', 'closed'] } } }));
        expect((await copy({ read: true, readLimit: { readable: ['id'] }, update: true, updateLimit: limit })).statusCode).toBe(201);
      });

      it('refuses a copy that would bring a switched-off app’s role to life', async () => {
        const h = await build(engine);
        const repo = manifestsRepo(h.meta, addOnCredentialCryptoFromSecret('roles-reach-test-secret'));
        const install = await repo.install({ manifestKey: 'shop', version: '1.0.0', kind: 'app', source: 'file', document: {} });
        const appRole = await rolesRepo(h.meta).create({ slug: 'shop-clerk', name: 'Clerk', appKey: 'shop', manifestId: install.row.id });
        await permissionsRepo(h.meta).grant(appRole.id, 'system', 'settings.manage', { allowed: true });
        const manages = await roleOf(h.meta, ['roles.manage']);
        const clerk = await person(h.meta, manages);
        await rolesRepo(h.meta).assignToUser(clerk.id, appRole.id);
        const caller = await signedIn(h.meta, h.app, clerk);
        await repo.setStatus(install.row.id, 'disabled');
        expectRefused(await call(h, caller, 'POST', '/roles', { name: 'Clerk copy', cloneFromRoleId: appRole.id }));
      });

      it('keeps somebody held to an app’s screens from opening the rest of the dashboard', async () => {
        const h = await build(engine);
        const screens = await rolesRepo(h.meta).create({ slug: 'till-only', name: 'Till', screensOnly: true });
        await permissionsRepo(h.meta).grant(screens.id, 'system', 'roles.manage', { allowed: true });
        const cashier = await person(h.meta, screens);
        const caller = await signedIn(h.meta, h.app, cashier);
        const empty = await roleOf(h.meta, []);
        expectRefused(await call(h, caller, 'POST', `/users/${cashier.id}/roles`, { roleId: empty.id }));
        expectRefused(await call(h, caller, 'POST', '/roles', { name: 'Till copy', cloneFromRoleId: screens.id }));
        expect(await rolesHeld(h, cashier)).toEqual([screens.id]);
      });
    });

    describe('assigning', () => {
      it('refuses giving a role above the caller to anybody, themselves included', async () => {
        const h = await build(engine);
        expectRefused(await call(h, h.asMia, 'POST', `/users/${h.mia.id}/roles`, { roleId: h.above.id }));
        expectRefused(await call(h, h.asMia, 'POST', `/users/${h.other.id}/roles`, { roleId: h.above.id }));
        expectRefused(await call(h, h.asMia, 'PUT', `/users/${h.other.id}/roles`, { roleIds: [h.within.id, h.above.id] }));
        expect(await rolesHeld(h, h.mia)).toEqual([h.manager.id]);
        expect(await rolesHeld(h, h.other)).toEqual([h.within.id]);
      });

      it('refuses taking a role above the caller from anybody', async () => {
        const h = await build(engine);
        expectRefused(await call(h, h.asMia, 'DELETE', `/users/${h.holder.id}/roles/${h.above.id}`));
        expectRefused(await call(h, h.asMia, 'PUT', `/users/${h.holder.id}/roles`, { roleIds: [h.within.id] }));
        expect(await rolesHeld(h, h.holder)).toEqual([h.above.id]);
      });

      it('refuses an invitation with a role above the caller, and invites nobody', async () => {
        const h = await build(engine);
        expectRefused(await call(h, h.asMia, 'POST', '/users', { email: 'new@adminium.test', name: 'New', roleIds: [h.above.id] }));
        expect(await usersRepo(h.meta).findByEmail('new@adminium.test')).toBeNull();
      });

      it('gives and takes roles within the caller, and leaves a higher one a person holds alone', async () => {
        const h = await build(engine);
        const given = await call(h, h.asMia, 'POST', `/users/${h.holder.id}/roles`, { roleId: h.within.id });
        expect(given.statusCode, given.body).toBe(200);
        const replaced = await call(h, h.asMia, 'PUT', `/users/${h.holder.id}/roles`, { roleIds: [h.above.id] });
        expect(replaced.statusCode, replaced.body).toBe(200);
        expect(await rolesHeld(h, h.holder)).toEqual([h.above.id]);
        const invited = await call(h, h.asMia, 'POST', '/users', { email: 'ok@adminium.test', name: 'Ok', roleIds: [h.within.id] });
        expect(invited.statusCode, invited.body).toBe(201);
      });
    });

    describe('a key', () => {
      it('cannot widen an empty role it was minted on', async () => {
        const h = await build(engine);
        const made = await call(h, h.asMia, 'POST', '/roles', { name: 'Blank' });
        expect(made.statusCode, made.body).toBe(201);
        const blank = made.json<{ id: string }>();
        const minted = await call(h, h.asMia, 'POST', '/api-keys', { name: 'blank key', roleId: blank.id });
        expect(minted.statusCode, minted.body).toBe(201);
        expectRefused(await call(h, h.asMia, 'PUT', `/roles/${blank.id}/permissions`, { grants: [SETTINGS] }));
        expect(minted.json<{ scopes: string[] }>().scopes).toEqual([]);
        expect((await permissionsRepo(h.meta).listForRole(blank.id))).toEqual([]);
      });

      it('is held to its own permissions', async () => {
        const h = await build(engine);
        const key = await storedKey(h, h.manager.id, h.root.id);
        expectRefused(await call(h, key, 'PUT', `/roles/${h.within.id}/permissions`, { grants: [DEALS_READ, SETTINGS] }));
        expectRefused(await call(h, key, 'POST', `/users/${h.other.id}/roles`, { roleId: h.above.id }));
      });

      it('is held to its maker, who no longer holds what it does', async () => {
        const h = await build(engine);
        // It holds everything the two refusals below ask for, so only its maker can be what stops them.
        const wide = await roleOf(h.meta, ['roles.manage', 'settings.manage'], { read: true });
        const maker = await person(h.meta, wide);
        const key = await storedKey(h, wide.id, maker.id);
        await rolesRepo(h.meta).removeFromUser(maker.id, wide.id);
        await rolesRepo(h.meta).assignToUser(maker.id, h.manager.id);
        expectRefused(await call(h, key, 'POST', `/users/${h.other.id}/roles`, { roleId: h.above.id }));
        expectRefused(await call(h, key, 'PUT', `/roles/${h.within.id}/permissions`, { grants: [DEALS_READ, SETTINGS] }));
      });

      it('with nobody behind it gives nothing', async () => {
        const h = await build(engine);
        const key = await storedKey(h, h.manager.id, null);
        expectRefused(await call(h, key, 'POST', `/users/${h.other.id}/roles`, { roleId: h.within.id }));
        expectRefused(await call(h, key, 'PUT', `/roles/${h.within.id}/permissions`, { grants: [] }));
      });

      it('of Super Admin gives other roles, and never Super Admin', async () => {
        const h = await build(engine);
        const key = await storedKey(h, h.superAdminRole.id, h.root.id);
        expect((await call(h, key, 'POST', `/users/${h.other.id}/roles`, { roleId: h.above.id })).statusCode).toBe(200);
        expectRefused(await call(h, key, 'POST', `/users/${h.other.id}/roles`, { roleId: h.superAdminRole.id }));
        expectRefused(await call(h, key, 'POST', '/roles', { name: 'Root copy', cloneFromRoleId: h.superAdminRole.id }));
      });
    });

    describe('a signed-in Super Admin', () => {
      it('can do all of it, and the last Super Admin stays', async () => {
        const h = await build(engine);
        expect((await call(h, h.asRoot, 'POST', '/roles', { name: 'Root copy', cloneFromRoleId: h.superAdminRole.id })).statusCode).toBe(201);
        expect((await call(h, h.asRoot, 'PUT', `/roles/${h.within.id}/permissions`, { grants: [SETTINGS] })).statusCode).toBe(200);
        expect((await call(h, h.asRoot, 'PATCH', `/roles/${h.above.id}`, { name: 'Top' })).statusCode).toBe(200);
        expect((await call(h, h.asRoot, 'POST', `/users/${h.other.id}/roles`, { roleId: h.above.id })).statusCode).toBe(200);
        expect((await call(h, h.asRoot, 'DELETE', `/users/${h.holder.id}/roles/${h.above.id}`)).statusCode).toBe(200);
        expect((await call(h, h.asRoot, 'DELETE', `/users/${h.root.id}/roles/${h.superAdminRole.id}`)).statusCode).toBe(409);
      });
    });

    it('leaves what is stored as it is: a role, its holder and its key keep working', async () => {
      const h = await build(engine);
      // A key above the person who made it, from before this rule: it goes on answering with its role.
      const wide = await roleOf(h.meta, ['roles.manage', 'settings.manage']);
      const key = await storedKey(h, wide.id, h.mia.id);
      expect((await call(h, key, 'GET', '/roles')).statusCode).toBe(200);
      expect(await rolesHeld(h, h.holder)).toEqual([h.above.id]);
      expect(await grantsOf(h, h.above)).toEqual([SETTINGS]);
      expect(await grantsOf(h, wide)).toEqual(['system:roles:manage', SETTINGS].sort());
    });

    it('writes a refusal to the audit log, naming no grant', async () => {
      const h = await build(engine);
      expectRefused(await call(h, h.asMia, 'POST', `/users/${h.other.id}/roles`, { roleId: h.above.id }));
      const rows = await h.meta.db.selectFrom('adminium_audit_log').select(['changes']).where('action', '=', 'permission.denied').execute();
      const changes = rows.map((row) => (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) as { after?: Record<string, unknown> });
      const entry = changes.find((one) => one.after?.['reason'] === 'role-above-you');
      expect(entry?.after?.['roleId']).toBe(h.above.id);
      expect(JSON.stringify(entry)).not.toContain(SETTINGS);
    });

    it('tells the screens what the caller may change and give', async () => {
      const h = await build(engine);
      const listed = (await call(h, h.asMia, 'GET', '/roles')).json<{ roles: { id: string; mayChange?: boolean }[] }>().roles;
      const may = (role: Role) => listed.find((one) => one.id === role.id)?.mayChange;
      expect([may(h.superAdminRole), may(h.above), may(h.within), may(h.manager)]).toEqual([false, false, true, true]);
      const grantable = (await call(h, h.asMia, 'GET', '/roles/grantable')).json<{ all: boolean; grants: string[] }>();
      expect(grantable.all).toBe(false);
      expect(grantable.grants).toEqual(expect.arrayContaining(MANAGER_GRANTS));
      expect(grantable.grants).not.toContain(SETTINGS);
      expect((await call(h, h.asRoot, 'GET', '/roles/grantable')).json<{ all: boolean }>().all).toBe(true);
    });
  });
}
