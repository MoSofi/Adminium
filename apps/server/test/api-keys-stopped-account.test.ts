// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STOPPED PERSON'S API KEYS. An API key acts with its own role, so nothing
 * about suspending or removing the person who made it used to touch it. Now
 * every way of stopping an account revokes every key that person made, in the
 * transaction that stops them, whoever or whatever does the stopping.
 *
 * Signed in as the real roles throughout: stopping somebody takes the people
 * permission and no other, and a Super Admin's session would hide that.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiKeysRepo, createFirstSuperAdmin, permissionsRepo, rolesRepo, usersRepo, type MetaDb, type Role, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { matrixRowsFromGrants, PERMISSIONS } from '../src/rbac/permissions.js';
import { apiKeysRoutes } from '../src/routes/api-keys/index.js';
import { usersRoutes } from '../src/routes/users/index.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

/** Set to make the next stop fail after its keys were revoked, or to run something at that moment, inside its transaction. */
const failing = vi.hoisted(() => ({ next: false, duringRevoke: null as null | (() => Promise<void>) }));
vi.mock('@adminium/meta', async (original) => {
  const real = await original<typeof import('@adminium/meta')>();
  return {
    ...real,
    apiKeysRepo: (meta: Parameters<typeof real.apiKeysRepo>[0]) => {
      const repo = real.apiKeysRepo(meta);
      return {
        ...repo,
        revokeAllBy: async (...args: Parameters<typeof repo.revokeAllBy>) => {
          const during = failing.duringRevoke;
          failing.duringRevoke = null;
          const done = await repo.revokeAllBy(...args);
          await during?.();
          return done;
        },
      };
    },
    sessionsRepo: (meta: Parameters<typeof real.sessionsRepo>[0]) => {
      const repo = real.sessionsRepo(meta);
      return {
        ...repo,
        revokeAllForUser: async (...args: Parameters<typeof repo.revokeAllForUser>) => {
          if (failing.next) {
            failing.next = false;
            throw new Error('the store went away mid-stop');
          }
          return repo.revokeAllForUser(...args);
        },
      };
    },
  };
});

describe.each(META_ENGINES.map((engine) => [engine.name, engine] as const))('a stopped person’s API keys — %s', (_name, engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  let seq = 0;
  let adminCookie = '';
  let peopleCookie = '';
  let viewerRole: Role;
  let superRole: Role;
  let keysRole: Role;
  /** A key that may manage people, for the case of a key doing the stopping. */
  let machine = '';
  /** Runs once, inside the next request: after it was signed in, before its route writes anything. */
  let midRequest: (() => Promise<unknown>) | null = null;

  const next = () => {
    seq += 1;
    return seq;
  };

  async function signIn(email: string): Promise<string> {
    const n = next();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.66.${String(Math.floor(n / 200))}.${String(n % 200)}`, payload: { email, password: ADMIN_PASSWORD } });
    expect(res.statusCode, res.body).toBe(200);
    return sessionCookie(res.headers['set-cookie']);
  }

  async function person(role?: Role): Promise<User> {
    const user = await usersRepo(meta).create({ email: `person${String(next())}@example.com`, name: 'Sam Lee', passwordHash: await adminPasswordHash() });
    if (role !== undefined) await rolesRepo(meta).assignToUser(user.id, role.id);
    return user;
  }

  async function keyOf(creator: string, name: string, role: Role = viewerRole, expiresAt: number | null = null): Promise<{ id: string; key: string }> {
    const generated = generateApiKey();
    const row = await apiKeysRepo(meta).create({ name, prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: role.id, createdBy: creator, expiresAt });
    return { id: row.id, key: generated.key };
  }

  /** Whether the key still signs a request in: a role it lacks answers 403, a dead key 401. */
  const works = async (key: string): Promise<boolean> => (await app.inject({ method: 'GET', url: '/api/v1/api-keys', headers: { authorization: `Bearer ${key}` } })).statusCode !== 401;
  const suspend = (headers: Record<string, string>, id: string) => app.inject({ method: 'PATCH', url: `/api/v1/users/${id}`, headers, payload: { status: 'suspended' } });
  const remove = (cookie: string, id: string, permanent: boolean) => app.inject({ method: 'DELETE', url: `/api/v1/users/${id}${permanent ? '?permanent=true' : ''}`, headers: { cookie } });

  async function auditOf(apiKeyId: string): Promise<{ action: string; before: Record<string, unknown>; after: Record<string, unknown> }[]> {
    const rows = await meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', '=', 'api-key.revoke').execute();
    return rows
      .map((entry) => ({ action: entry.action, changes: (typeof entry.changes === 'string' ? JSON.parse(entry.changes) : entry.changes) as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null }))
      .filter((entry) => entry.changes?.before?.['apiKeyId'] === apiKeyId)
      .map((entry) => ({ action: entry.action, before: entry.changes?.before ?? {}, after: entry.changes?.after ?? {} }));
  }

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: 'Ava Reyes', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    await app.register(rbacPlugin, { meta });
    app.addHook('preValidation', async () => {
      const run = midRequest;
      midRequest = null;
      await run?.();
    });
    await app.register(
      async (api) => {
        await api.register(usersRoutes);
        await api.register(apiKeysRoutes);
      },
      { prefix: '/api/v1' },
    );
    await app.ready();

    const roles = rolesRepo(meta);
    superRole = (await roles.findBySlug('super-admin'))!;
    viewerRole = (await roles.findBySlug('viewer'))!;
    const grant = async (role: Role, grants: string[]) => {
      for (const one of matrixRowsFromGrants(grants).rows) await permissionsRepo(meta).grant(role.id, one.resourceKind, one.resourceRef, one.actions as never);
    };
    keysRole = await roles.create({ slug: 'people-and-keys', name: 'People and keys' });
    await grant(keysRole, [PERMISSIONS.usersManage, PERMISSIONS.apiKeysManage]);
    const peopleOnly = await roles.create({ slug: 'people-only', name: 'People only' });
    await grant(peopleOnly, [PERMISSIONS.usersManage]);

    adminCookie = await signIn((await person(keysRole)).email);
    peopleCookie = await signIn((await person(peopleOnly)).email);
    const generated = generateApiKey();
    await apiKeysRepo(meta).create({ name: 'people bot', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: keysRole.id, createdBy: null });
    machine = generated.key;
  }, 120_000);

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  it.skipIf(!engine.available)('suspending revokes every key the person made, and nobody else’s, and the audit says who made it', async () => {
    const sam = await person();
    const other = await person();
    const first = await keyOf(sam.id, 'laptop');
    const second = await keyOf(sam.id, 'deploy bot', superRole);
    const theirs = await keyOf(other.id, 'not sam’s');
    expect(await works(first.key)).toBe(true);
    // Someone with the people permission alone: stopping a person needs no permission over keys.
    const res = await suspend({ cookie: peopleCookie }, sam.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(await works(first.key)).toBe(false);
    expect(await works(second.key)).toBe(false);
    expect(await works(theirs.key)).toBe(true);
    expect(await auditOf(first.id)).toMatchObject([{ action: 'api-key.revoke', before: { apiKeyId: first.id, createdBy: sam.id, createdByEmail: sam.email, createdByName: sam.name }, after: { reason: 'creator-stopped' } }]);
  });

  it.skipIf(!engine.available)('DELETE revokes them too, as a suspension and as a removal for good, and the audit still says whose they were', async () => {
    for (const permanent of [false, true]) {
      const sam = await person();
      const made = await keyOf(sam.id, 'laptop');
      const res = await remove(adminCookie, sam.id, permanent);
      expect(res.statusCode, res.body).toBe(200);
      expect(await works(made.key)).toBe(false);
      // A removal for good empties `created_by`: the audit entry is what still says who made it.
      if (permanent) expect((await apiKeysRepo(meta).findById(made.id))?.createdBy).toBeNull();
      expect((await auditOf(made.id))[0]).toMatchObject({ before: { createdBy: sam.id, createdByEmail: sam.email, createdByName: sam.name } });
    }
  });

  it.skipIf(!engine.available)('a key doing the stopping revokes them the same', async () => {
    const sam = await person();
    const made = await keyOf(sam.id, 'laptop');
    const res = await suspend({ authorization: `Bearer ${machine}` }, sam.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(await works(made.key)).toBe(false);
    expect(await works(machine)).toBe(true);
  });

  it.skipIf(!engine.available)('a key that had already expired is revoked as well, and a revoked one keeps its first date', async () => {
    const sam = await person();
    const lapsed = await keyOf(sam.id, 'lapsed', viewerRole, Date.now() - 1_000);
    const old = await keyOf(sam.id, 'old');
    await apiKeysRepo(meta).revoke(old.id, 1_000);
    expect((await suspend({ cookie: adminCookie }, sam.id)).statusCode).toBe(200);
    expect((await apiKeysRepo(meta).findById(lapsed.id))?.revokedAt).not.toBeNull();
    expect((await apiKeysRepo(meta).findById(old.id))?.revokedAt).toBe(1_000);
    expect(await auditOf(old.id)).toEqual([]);
  });

  it.skipIf(!engine.available)('a stop that is refused touches no key', async () => {
    const root = await person(superRole);
    const made = await keyOf(root.id, 'root bot');
    // An Admin may not stop a Super Admin.
    expect((await suspend({ cookie: adminCookie }, root.id)).statusCode).toBe(403);
    expect((await remove(adminCookie, root.id, true)).statusCode).toBe(403);
    expect((await usersRepo(meta).findById(root.id))?.status).toBe('active');
    expect(await works(made.key)).toBe(true);
  });

  it.skipIf(!engine.available)('reactivating the person does not bring a key back', async () => {
    const sam = await person();
    const made = await keyOf(sam.id, 'laptop');
    await suspend({ cookie: adminCookie }, sam.id);
    const back = await app.inject({ method: 'PATCH', url: `/api/v1/users/${sam.id}`, headers: { cookie: adminCookie }, payload: { status: 'active' } });
    expect(back.statusCode, back.body).toBe(200);
    expect(await works(made.key)).toBe(false);
  });

  it.skipIf(!engine.available)('an edit that stops nobody leaves their keys alone', async () => {
    const sam = await person();
    const made = await keyOf(sam.id, 'laptop');
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/users/${sam.id}`, headers: { cookie: adminCookie }, payload: { name: 'Sam L.' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await works(made.key)).toBe(true);
  });

  it.skipIf(!engine.available)('a stop that fails part way leaves the person, their keys and the audit as they were', async () => {
    const sam = await person();
    const made = await keyOf(sam.id, 'laptop');
    failing.next = true;
    expect((await suspend({ cookie: adminCookie }, sam.id)).statusCode).toBe(500);
    expect((await usersRepo(meta).findById(sam.id))?.status).toBe('active');
    expect(await works(made.key)).toBe(true);
    expect(await auditOf(made.id)).toEqual([]);
  });

  it.skipIf(!engine.available)('a key made by a key belongs to the person behind it, and stops with them', async () => {
    const sam = await person(keysRole);
    const first = await keyOf(sam.id, 'first', keysRole);
    const res = await app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { authorization: `Bearer ${first.key}` }, payload: { name: 'second', roleId: keysRole.id } });
    expect(res.statusCode, res.body).toBe(201);
    const second = res.json() as { apiKey: { id: string }; key: string };
    expect((await apiKeysRepo(meta).findById(second.apiKey.id))?.createdBy).toBe(sam.id);
    expect((await suspend({ cookie: adminCookie }, sam.id)).statusCode).toBe(200);
    expect(await works(first.key)).toBe(false);
    expect(await works(second.key)).toBe(false);
  });

  it.skipIf(!engine.available)('a key left over from a stopped person cannot make another', async () => {
    const sam = await person(keysRole);
    const leftover = await keyOf(sam.id, 'from before', keysRole);
    await usersRepo(meta).updateStatus(sam.id, 'suspended');
    const res = await app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { authorization: `Bearer ${leftover.key}` }, payload: { name: 'another', roleId: keysRole.id } });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).toContain('no longer active');
    expect(res.body).not.toContain('adm_sk_');
  });

  it.skipIf(!engine.available || engine.name === 'sqlite')('a key being made while the stop is in flight waits for it, and is refused', async () => {
    const maker = await person(keysRole);
    const cookie = await signIn(maker.email);
    let creating: Promise<{ statusCode: number; body: string }> | undefined;
    // After the stop has revoked the keys it could see, and before it has changed the account.
    failing.duringRevoke = async () => {
      creating = Promise.resolve(app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { cookie }, payload: { name: 'racing', roleId: keysRole.id } }));
      await new Promise((resolve) => setTimeout(resolve, 500));
    };
    const stopped = await suspend({ cookie: adminCookie }, maker.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
    const res = await creating!;
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).toContain('no longer active');
    expect(await meta.db.selectFrom('adminium_api_keys').select('id').where('createdBy', '=', maker.id).where('revokedAt', 'is', null).execute()).toEqual([]);
  });

  it.skipIf(!engine.available)('a key made in the moment its maker was stopped does not survive', async () => {
    const maker = await person(keysRole);
    const cookie = await signIn(maker.email);
    // Signed in when the request began, stopped by the time the key is written.
    midRequest = () => usersRepo(meta).updateStatus(maker.id, 'suspended');
    const res = await app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: { cookie }, payload: { name: 'late', roleId: keysRole.id } });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).toContain('no longer active');
    expect(res.body).not.toContain('adm_sk_');
    const live = await meta.db.selectFrom('adminium_api_keys').select('id').where('createdBy', '=', maker.id).where('revokedAt', 'is', null).execute();
    expect(live).toEqual([]);
  });
});
