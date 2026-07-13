/**
 * API-key lifecycle tests (08-server-api.md §2.16, M2-T06): one-time secret
 * reveal, hashed-at-rest storage, the bearer request-auth path (create →
 * authenticate → revoke → 401), role-scoped permissions, expiry, the
 * throttled `last_used_at` touch, and audit coverage of the mutations.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { apiKeysRepo, auditRepo, destroyMetaDb } from '@adminium/meta';

import { API_KEY_PREFIX } from '../src/rbac/api-keys.js';
import { asApiKey, asUser, buildRbacTestApp, type RbacTestContext } from './rbac-helpers.js';

let ctx: RbacTestContext;

afterEach(async () => {
  await ctx.app.close();
  await destroyMetaDb(ctx.meta);
});

interface CreateReplyBody {
  apiKey: Record<string, unknown> & { id: string; prefix: string; roleId: string };
  key: string;
  scopes: string[];
}

async function createKey(
  payload: { name: string; roleId: string; expiresAt?: number },
): Promise<CreateReplyBody> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/api-keys',
    headers: asUser(ctx.users.superAdmin),
    payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as CreateReplyBody;
}

describe('POST /api-keys — one-time reveal', () => {
  it('returns the full key exactly once; stores only hash + prefix', async () => {
    ctx = await buildRbacTestApp();
    const created = await createKey({ name: 'CI deploy key', roleId: ctx.roles.admin.id });

    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.key).toHaveLength(API_KEY_PREFIX.length + 40);
    expect(created.apiKey.prefix).toBe(created.key.slice(0, created.apiKey.prefix.length));
    // No secret material beside the documented one-time `key` field.
    expect(created.apiKey).not.toHaveProperty('tokenHash');
    expect(created.apiKey).not.toHaveProperty('key');

    // The stored row carries the hash, never the key itself.
    const row = await apiKeysRepo(ctx.meta).findById(created.apiKey.id);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.key);

    // A subsequent list never returns the secret (second GET reveals nothing).
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: asUser(ctx.users.superAdmin),
    });
    expect(list.statusCode).toBe(200);
    const body = list.body;
    expect(body).toContain(created.apiKey.prefix);
    expect(body).not.toContain(created.key);
    expect(body).not.toContain(row?.tokenHash);
  });

  it('scopes echo the role grant set; super-admin keys report *', async () => {
    ctx = await buildRbacTestApp();
    const adminKey = await createKey({ name: 'Admin key', roleId: ctx.roles.admin.id });
    expect(adminKey.scopes).toContain('system:users:manage');
    const rootKey = await createKey({ name: 'Root key', roleId: ctx.roles.superAdmin.id });
    expect(rootKey.scopes).toEqual(['*']);
  });

  it('404s on an unknown role and requires system:api-keys:manage', async () => {
    ctx = await buildRbacTestApp();
    const missingRole = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: asUser(ctx.users.superAdmin),
      payload: { name: 'Orphan', roleId: 'role_missing' },
    });
    expect(missingRole.statusCode).toBe(404);

    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: asUser(ctx.users.viewer),
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('bearer request-auth path', () => {
  it('created → authenticates → revoked → 401', async () => {
    ctx = await buildRbacTestApp();
    const created = await createKey({ name: 'Lifecycle key', roleId: ctx.roles.admin.id });

    // The key acts with the admin role → passes the users-manage guard.
    const allowed = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/users-manage',
      headers: asApiKey(created.key),
    });
    expect(allowed.statusCode).toBe(200);

    const revoked = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${created.apiKey.id}`,
      headers: asUser(ctx.users.superAdmin),
    });
    expect(revoked.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/users-manage',
      headers: asApiKey(created.key),
    });
    expect(after.statusCode).toBe(401);
    expect((after.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');

    // Double revoke → 409.
    const again = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${created.apiKey.id}`,
      headers: asUser(ctx.users.superAdmin),
    });
    expect(again.statusCode).toBe(409);
  });

  it('key permissions are the role permissions — no more, no less', async () => {
    ctx = await buildRbacTestApp();
    // Custom role that can only read the audit log.
    const roleRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: asUser(ctx.users.superAdmin),
      payload: { name: 'Log Reader' },
    });
    const roleId = (roleRes.json() as { id: string }).id;
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${roleId}/permissions`,
      headers: asUser(ctx.users.superAdmin),
      payload: { grants: ['system:audit:read'] },
    });

    const created = await createKey({ name: 'Log key', roleId });
    expect(created.scopes).toEqual(['system:audit:read']);

    const audit = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit', headers: asApiKey(created.key) });
    expect(audit.statusCode).toBe(200);
    const roles = await ctx.app.inject({ method: 'GET', url: '/api/v1/roles', headers: asApiKey(created.key) });
    expect(roles.statusCode).toBe(403);
  });

  it('an unknown adm_sk_ token and an expired key both 401', async () => {
    let at = 1_700_000_000_000;
    ctx = await buildRbacTestApp({ now: () => at });

    const bogus = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/users-manage',
      headers: asApiKey(`${API_KEY_PREFIX}${'x'.repeat(40)}`),
    });
    expect(bogus.statusCode).toBe(401);

    const created = await createKey({
      name: 'Short-lived',
      roleId: ctx.roles.admin.id,
      expiresAt: at + 60_000,
    });
    const before = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/users-manage',
      headers: asApiKey(created.key),
    });
    expect(before.statusCode).toBe(200);

    at += 61_000; // past expiresAt
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/users-manage',
      headers: asApiKey(created.key),
    });
    expect(after.statusCode).toBe(401);
  });

  it('throttles the last_used_at touch', async () => {
    let at = 1_700_000_000_000;
    ctx = await buildRbacTestApp({ now: () => at });
    const created = await createKey({ name: 'Busy key', roleId: ctx.roles.admin.id });
    const repo = apiKeysRepo(ctx.meta);

    const hit = () =>
      ctx.app.inject({ method: 'GET', url: '/api/v1/probe/users-manage', headers: asApiKey(created.key) });

    await hit();
    const first = (await repo.findById(created.apiKey.id))?.lastUsedAt;
    expect(first).toBe(at);

    at += 5_000; // within the 60 s window → no write
    await hit();
    expect((await repo.findById(created.apiKey.id))?.lastUsedAt).toBe(first);

    at += 60_000; // past the window → touched again
    await hit();
    expect((await repo.findById(created.apiKey.id))?.lastUsedAt).toBe(at);
  });
});

describe('audit coverage', () => {
  it('audits create and revoke under the system category', async () => {
    ctx = await buildRbacTestApp();
    const created = await createKey({ name: 'Audited key', roleId: ctx.roles.admin.id });
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${created.apiKey.id}`,
      headers: asUser(ctx.users.superAdmin),
    });

    const entries = await auditRepo(ctx.meta).list({ category: 'system' });
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('api-key.create');
    expect(actions).toContain('api-key.revoke');
    // No secret material ever lands in the log.
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(created.key);
    expect(serialized).toContain(created.apiKey.prefix);
  });
});
