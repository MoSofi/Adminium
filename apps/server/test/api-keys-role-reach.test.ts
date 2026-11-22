// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH ROLE A NEW API KEY MAY BE GIVEN.
 *
 * A key acts with its role, so choosing a role is handing out that role's
 * power. A caller may give only a role whose permissions they already hold,
 * limits included. Only a signed-in Super Admin may give Super Admin, as on
 * `POST /users/:id/roles`. A key is held to its own permissions and to those
 * of the person behind it. The callers are real sessions and real keys, on
 * every meta engine.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  apiKeysRepo,
  permissionsRepo,
  rolesRepo,
  usersRepo,
  type MetaDb,
  type Role,
  type TableActions,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { apiKeysRoutes } from '../src/routes/api-keys/index.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaEngine, type MetaHandle } from './meta-dialects.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  superAdminRole: Role;
  adminRole: Role;
  keeperRole: Role;
  superAdmin: User;
  keeper: User;
}

/** A caller's credentials, as `inject` takes them. */
type Caller = { cookies: Record<string, string> } | { headers: Record<string, string> };

interface MintReply {
  apiKey: { id: string };
  key: string;
  scopes: string[];
}

const probeReply = z.object({ ok: z.literal(true) });
const DEALS = 'c1/public.deals';
const NO_ACTIONS: TableActions = { read: false, create: false, update: false, delete: false, export: false, import: false };

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
  const user = await usersRepo(meta).create({
    email: `person${String(seq)}@adminium.test`,
    name: `Person ${String(seq)}`,
    passwordHash: 'test-hash',
    status: 'active',
  });
  await rolesRepo(meta).assignToUser(user.id, role.id);
  return user;
}

/** A custom role holding `api-keys.manage` (unless told not to) and these rows on the deals table. */
async function roleWith(
  meta: MetaDb,
  table: Partial<TableActions> | null,
  opts: { keys?: boolean; system?: string[]; ref?: string } = {},
): Promise<Role> {
  seq += 1;
  const role = await rolesRepo(meta).create({ slug: `custom-${String(seq)}`, name: `Custom ${String(seq)}` });
  const permissions = permissionsRepo(meta);
  if (opts.keys !== false) await permissions.grant(role.id, 'system', 'api-keys.manage', { allowed: true });
  for (const key of opts.system ?? []) await permissions.grant(role.id, 'system', key, { allowed: true });
  if (table !== null) await permissions.grant(role.id, 'table', opts.ref ?? DEALS, { ...NO_ACTIONS, ...table });
  return role;
}

async function build(engine: MetaEngine): Promise<Harness> {
  handle = await engine.make();
  const { meta } = handle;
  const roles = rolesRepo(meta);
  const superAdminRole = await roles.findBySlug('super-admin');
  const adminRole = await roles.findBySlug('admin');
  if (superAdminRole === null || adminRole === null) throw new Error('missing a built-in role');
  const keeperRole = await roleWith(meta, null);
  const superAdmin = await person(meta, superAdminRole);
  const keeper = await person(meta, keeperRole);

  app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
  await app.register(rbacPlugin, { meta });
  await app.register(
    async (api) => {
      await api.register(apiKeysRoutes);
      // Settings: Super Admin alone here. Users: the built-in Admin as well.
      api.get('/probe/settings', { preHandler: api.rbac.require(PERMISSIONS.settingsManage), schema: { response: { 200: probeReply } } }, async () => ({ ok: true as const }));
      api.get('/probe/users', { preHandler: api.rbac.require(PERMISSIONS.usersManage), schema: { response: { 200: probeReply } } }, async () => ({ ok: true as const }));
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
  return { app, meta, superAdminRole, adminRole, keeperRole, superAdmin, keeper };
}

async function signedIn(h: Harness, user: User): Promise<Caller> {
  const { token } = await createSession(h.meta, user.id);
  return { cookies: { [SESSION_COOKIE]: h.app.signCookie(token) } };
}

const withKey = (key: string): Caller => ({ headers: { authorization: `Bearer ${key}` } });

function mint(h: Harness, caller: Caller, roleId: string) {
  return h.app.inject({ method: 'POST', url: '/api/v1/api-keys', ...caller, payload: { name: 'minted', roleId } });
}

async function mintOk(h: Harness, caller: Caller, roleId: string): Promise<MintReply> {
  const res = await mint(h, caller, roleId);
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as MintReply;
}

/** A key written straight to the store, as one made before this rule was. */
async function storedKey(h: Harness, roleId: string, createdBy: string | null): Promise<string> {
  const generated = generateApiKey();
  await apiKeysRepo(h.meta).create({ name: 'stored', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId, createdBy });
  return generated.key;
}

async function probe(h: Harness, caller: Caller, what: 'settings' | 'users'): Promise<number> {
  return (await h.app.inject({ method: 'GET', url: `/api/v1/probe/${what}`, ...caller })).statusCode;
}

/**
 * The refusal, and what a key handed back could have done, so a failure names
 * the escalation and not only a status code.
 */
async function expectRefused(h: Harness, caller: Caller, roleId: string): Promise<void> {
  const before = (await apiKeysRepo(h.meta).list()).length;
  const res = await mint(h, caller, roleId);
  const minted = res.statusCode === 201 ? withKey((res.json() as MintReply).key) : null;
  const mintedKeyReaches = minted === null ? null : { settings: await probe(h, minted, 'settings'), users: await probe(h, minted, 'users') };
  expect({ status: res.statusCode, mintedKeyReaches }).toEqual({ status: 403, mintedKeyReaches: null });
  expect(res.body).not.toContain('adm_sk_');
  expect(await apiKeysRepo(h.meta).list()).toHaveLength(before);
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`POST /api-keys: which role (${engine.name})`, () => {
    describe('Super Admin', () => {
      it('refuses a signed-in custom role that holds api-keys.manage', async () => {
        const h = await build(engine);
        const caller = await signedIn(h, h.keeper);
        expect(await probe(h, caller, 'settings')).toBe(403);
        await expectRefused(h, caller, h.superAdminRole.id);
      });

      it('refuses a key of that custom role', async () => {
        const h = await build(engine);
        const { key } = await mintOk(h, await signedIn(h, h.superAdmin), h.keeperRole.id);
        await expectRefused(h, withKey(key), h.superAdminRole.id);
      });

      it('refuses a Super Admin key, because a key never qualifies', async () => {
        const h = await build(engine);
        const { key } = await mintOk(h, await signedIn(h, h.superAdmin), h.superAdminRole.id);
        expect(await probe(h, withKey(key), 'settings')).toBe(200);
        await expectRefused(h, withKey(key), h.superAdminRole.id);
      });

      it('lets a signed-in Super Admin give it', async () => {
        const h = await build(engine);
        const created = await mintOk(h, await signedIn(h, h.superAdmin), h.superAdminRole.id);
        expect(created.scopes).toEqual(['*']);
        expect(await probe(h, withKey(created.key), 'settings')).toBe(200);
      });
    });

    describe('a role above the caller', () => {
      it('refuses the built-in Admin to a keys-only custom role', async () => {
        const h = await build(engine);
        const caller = await signedIn(h, h.keeper);
        expect(await probe(h, caller, 'users')).toBe(403);
        await expectRefused(h, caller, h.adminRole.id);
      });

      it('refuses it to a key of that role, though its maker holds it', async () => {
        const h = await build(engine);
        const { key } = await mintOk(h, await signedIn(h, h.superAdmin), h.keeperRole.id);
        await expectRefused(h, withKey(key), h.adminRole.id);
      });

      it('refuses a role one system permission wider', async () => {
        const h = await build(engine);
        const wider = await roleWith(h.meta, null, { system: ['users.manage'] });
        await expectRefused(h, await signedIn(h, h.keeper), wider.id);
      });

      it('lets a Super Admin session and a Super Admin key give any other role', async () => {
        const h = await build(engine);
        const owner = await signedIn(h, h.superAdmin);
        await mintOk(h, owner, h.adminRole.id);
        const { key } = await mintOk(h, owner, h.superAdminRole.id);
        await mintOk(h, withKey(key), h.adminRole.id);
      });

      it('lets a caller give their own role, and a narrower one', async () => {
        const h = await build(engine);
        const role = await roleWith(h.meta, { read: true, update: true });
        const narrower = await roleWith(h.meta, { read: true }, { keys: false });
        const caller = await signedIn(h, await person(h.meta, role));
        await mintOk(h, caller, role.id);
        await mintOk(h, caller, narrower.id);
      });
    });

    describe('a key is held to its maker too', () => {
      it('refuses a role the key holds and its maker no longer does', async () => {
        const h = await build(engine);
        const wide = await roleWith(h.meta, null, { system: ['users.manage'] });
        const maker = await person(h.meta, wide);
        const { key } = await mintOk(h, await signedIn(h, maker), wide.id);
        await rolesRepo(h.meta).removeFromUser(maker.id, wide.id);
        await rolesRepo(h.meta).assignToUser(maker.id, h.keeperRole.id);
        expect(await probe(h, withKey(key), 'users')).toBe(200);
        await expectRefused(h, withKey(key), wide.id);
      });

      it('refuses a key with nobody behind it, which still works otherwise', async () => {
        const h = await build(engine);
        const key = await storedKey(h, h.keeperRole.id, null);
        const listed = await h.app.inject({ method: 'GET', url: '/api/v1/api-keys', ...withKey(key) });
        expect(listed.statusCode).toBe(200);
        await expectRefused(h, withKey(key), h.keeperRole.id);
      });

      it('lets a key give a role both it and its maker hold', async () => {
        const h = await build(engine);
        const narrower = await roleWith(h.meta, null, { keys: false });
        const { key } = await mintOk(h, await signedIn(h, h.keeper), h.keeperRole.id);
        const created = await mintOk(h, withKey(key), narrower.id);
        expect((await apiKeysRepo(h.meta).findById(created.apiKey.id))?.createdBy).toBe(h.keeper.id);
      });

      it('never lets a key outlive the key that made it', async () => {
        const h = await build(engine);
        const ends = Date.now() + 3_600_000;
        const res = await h.app.inject({ method: 'POST', url: '/api/v1/api-keys', ...(await signedIn(h, h.keeper)), payload: { name: 'short', roleId: h.keeperRole.id, expiresAt: ends } });
        expect(res.statusCode, res.body).toBe(201);
        const parent = withKey((res.json() as MintReply).key);
        const expiryOf = async (expiresAt?: number): Promise<number | null> => {
          const made = await h.app.inject({ method: 'POST', url: '/api/v1/api-keys', ...parent, payload: { name: 'child', roleId: h.keeperRole.id, ...(expiresAt === undefined ? {} : { expiresAt }) } });
          expect(made.statusCode, made.body).toBe(201);
          return (await apiKeysRepo(h.meta).findById((made.json() as MintReply).apiKey.id))?.expiresAt ?? null;
        };
        expect(await expiryOf()).toBe(ends);
        expect(await expiryOf(ends + 86_400_000)).toBe(ends);
        expect(await expiryOf(ends - 60_000)).toBe(ends - 60_000);
      });
    });

    describe('limits count', () => {
      it('refuses every column to a caller who reads some, and gives fewer', async () => {
        const h = await build(engine);
        const role = await roleWith(h.meta, { read: true, readLimit: { readable: ['id', 'name'] } });
        const caller = await signedIn(h, await person(h.meta, role));
        await expectRefused(h, caller, (await roleWith(h.meta, { read: true }, { keys: false })).id);
        await expectRefused(h, caller, (await roleWith(h.meta, { read: true, readLimit: { readable: ['id', 'price'] } }, { keys: false })).id);
        await mintOk(h, caller, (await roleWith(h.meta, { read: true, readLimit: { readable: ['id'] } }, { keys: false })).id);
      });

      it('refuses every row to a caller who reaches their own', async () => {
        const h = await build(engine);
        const role = await roleWith(h.meta, { read: true, rowLimit: { read: { reach: 'own' } } });
        const caller = await signedIn(h, await person(h.meta, role));
        await expectRefused(h, caller, (await roleWith(h.meta, { read: true }, { keys: false })).id);
        await expectRefused(h, caller, (await roleWith(h.meta, { read: true, rowLimit: { read: { reach: 'team' } } }, { keys: false })).id);
        await mintOk(h, caller, (await roleWith(h.meta, { read: true, rowLimit: { read: { reach: 'own' } } }, { keys: false })).id);
      });

      it('refuses a wider update or create limit, and gives the same', async () => {
        const h = await build(engine);
        const limit = { writable: ['status'], writableValues: { status: ['open'] } };
        const role = await roleWith(h.meta, { update: true, updateLimit: limit, create: true, createLimit: limit });
        const caller = await signedIn(h, await person(h.meta, role));
        const wider = { writable: ['status'], writableValues: { status: ['open', 'closed'] } };
        await expectRefused(h, caller, (await roleWith(h.meta, { update: true, updateLimit: wider }, { keys: false })).id);
        await expectRefused(h, caller, (await roleWith(h.meta, { create: true, createLimit: wider }, { keys: false })).id);
        await expectRefused(h, caller, (await roleWith(h.meta, { update: true }, { keys: false })).id);
        await mintOk(h, caller, (await roleWith(h.meta, { update: true, updateLimit: limit }, { keys: false })).id);
        await mintOk(h, caller, (await roleWith(h.meta, { create: true, createLimit: limit }, { keys: false })).id);
      });

      it('refuses a write-only role to a caller whose read is limited, because a write answers with the row', async () => {
        const h = await build(engine);
        const byRows = await roleWith(h.meta, { read: true, rowLimit: { read: { reach: 'own' } }, create: true, update: true, delete: true, import: true });
        const rowsCaller = await signedIn(h, await person(h.meta, byRows));
        for (const action of ['update', 'delete', 'create', 'import'] as const) {
          await expectRefused(h, rowsCaller, (await roleWith(h.meta, { [action]: true }, { keys: false })).id);
        }
        const byColumns = await roleWith(h.meta, { read: true, readLimit: { readable: ['id', 'name'] }, update: true, export: true });
        const columnsCaller = await signedIn(h, await person(h.meta, byColumns));
        await expectRefused(h, columnsCaller, (await roleWith(h.meta, { update: true }, { keys: false })).id);
        await expectRefused(h, columnsCaller, (await roleWith(h.meta, { export: true }, { keys: false })).id);
        await mintOk(h, columnsCaller, (await roleWith(h.meta, { read: true, readLimit: { readable: ['id'] }, update: true }, { keys: false })).id);
      });

      it('refuses a write on every table to a caller whose read of one table is limited', async () => {
        const h = await build(engine);
        const role = await roleWith(h.meta, { update: true }, { ref: '*/*' });
        await permissionsRepo(h.meta).grant(role.id, 'table', DEALS, { ...NO_ACTIONS, read: true, readLimit: { readable: ['id'] } });
        const caller = await signedIn(h, await person(h.meta, role));
        await expectRefused(h, caller, (await roleWith(h.meta, { update: true }, { keys: false, ref: '*/*' })).id);
      });

      it('refuses "which rows" a caller’s update limit does not reach', async () => {
        const h = await build(engine);
        const limit = { writable: ['status'], writableFrom: { status: ['open'] } };
        const role = await roleWith(h.meta, { update: true, updateLimit: limit });
        const caller = await signedIn(h, await person(h.meta, role));
        await expectRefused(h, caller, (await roleWith(h.meta, { update: true, updateLimit: { writable: ['status'] } }, { keys: false })).id);
        await mintOk(h, caller, (await roleWith(h.meta, { update: true, updateLimit: limit }, { keys: false })).id);
      });

      it('refuses every table to a caller who holds one, and personal columns by name', async () => {
        const h = await build(engine);
        const role = await roleWith(h.meta, { read: true });
        const caller = await signedIn(h, await person(h.meta, role));
        await expectRefused(h, caller, (await roleWith(h.meta, { read: true }, { keys: false, ref: '*/*' })).id);
        await expectRefused(h, caller, (await roleWith(h.meta, { read: true, read_pii: true }, { keys: false })).id);
        const everyTable = await signedIn(h, await person(h.meta, await roleWith(h.meta, { read: true }, { ref: '*/*' })));
        await expectRefused(h, everyTable, (await roleWith(h.meta, { read: true, read_pii: true }, { keys: false })).id);
      });

      it('holds page, app, add-on, refund and account grants to what the caller has', async () => {
        const h = await build(engine);
        const grants = [
          ['page', 'p1', { view: true, edit: false }],
          ['app', 'shop', { staff: true }],
          ['app', 'add-on/loyalty', { staff: true }],
          ['app', 'payments-refund/shop', { staff: true }],
          ['app', 'accounts-connect/shop', { staff: true }],
        ] as const;
        const holder = await roleWith(h.meta, null);
        for (const [kind, ref, actions] of grants) await permissionsRepo(h.meta).grant(holder.id, kind, ref, actions);
        const caller = await signedIn(h, await person(h.meta, holder));
        const bare = await signedIn(h, h.keeper);
        for (const [kind, ref, actions] of grants) {
          const target = await roleWith(h.meta, null, { keys: false });
          await permissionsRepo(h.meta).grant(target.id, kind, ref, actions);
          await expectRefused(h, bare, target.id);
          await mintOk(h, caller, target.id);
        }
      });

      it('lets a caller with every table give one table', async () => {
        const h = await build(engine);
        const role = await roleWith(h.meta, { read: true }, { ref: '*/*' });
        const caller = await signedIn(h, await person(h.meta, role));
        await mintOk(h, caller, (await roleWith(h.meta, { read: true }, { keys: false })).id);
      });
    });

    it('leaves a key made before this rule working', async () => {
      const h = await build(engine);
      const key = await storedKey(h, h.adminRole.id, h.keeper.id);
      expect(await probe(h, withKey(key), 'users')).toBe(200);
    });

    it('writes a refusal to the audit log', async () => {
      const h = await build(engine);
      await expectRefused(h, await signedIn(h, h.keeper), h.adminRole.id);
      const rows = await h.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', '=', 'permission.denied').execute();
      const changes = rows.map((row) => (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) as { after?: Record<string, unknown> });
      expect(changes.some((entry) => entry.after?.['reason'] === 'role-above-you' && entry.after?.['roleId'] === h.adminRole.id)).toBe(true);
      expect(changes.some((entry) => entry.after?.['permission'] === PERMISSIONS.apiKeysManage)).toBe(false);
    });
  });
}
