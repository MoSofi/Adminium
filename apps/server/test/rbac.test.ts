/**
 * RBAC enforcement integration tests (08-server-api.md §5, M2-T05): the
 * permission matrix over real routes, denied-audit rows, role lifecycle,
 * hard-locked built-ins, immediate grant/revoke effect, and the
 * last-super-admin guard.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditRepo, destroyMetaDb } from '@adminium/meta';

import { asUser, buildRbacTestApp, type RbacTestContext } from './rbac-helpers.js';

let ctx: RbacTestContext;

beforeEach(async () => {
  ctx = await buildRbacTestApp();
});

afterEach(async () => {
  await ctx.app.close();
  await destroyMetaDb(ctx.meta);
});

describe('permission matrix', () => {
  it('denies a Viewer system:users:manage with 403 + audit denied row', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/users-manage',
      headers: asUser(ctx.users.viewer),
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; details: { permission: string } } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.details.permission).toBe('system:users:manage');

    const denied = await auditRepo(ctx.meta).list({ actorId: ctx.users.viewer.id, category: 'rbac' });
    expect(denied).toHaveLength(1);
    expect(denied[0]?.action).toBe('permission.denied');
    expect(denied[0]?.actorKind).toBe('user');
    expect(denied[0]?.changes).toMatchObject({ after: { permission: 'system:users:manage' } });
  });

  it('allows an Admin system:users:manage', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/users-manage',
      headers: asUser(ctx.users.admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('Super Admin bypasses every check', async () => {
    for (const url of ['/api/v1/probe/users-manage', '/api/v1/probe/orders-read', '/api/v1/roles', '/api/v1/audit', '/api/v1/api-keys']) {
      const res = await ctx.app.inject({ method: 'GET', url, headers: asUser(ctx.users.superAdmin) });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('401 UNAUTHENTICATED without any principal', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/roles' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('wildcard table grant satisfies a concrete table permission', async () => {
    const superAdmin = asUser(ctx.users.superAdmin);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: superAdmin,
      payload: { name: 'Analyst' },
    });
    expect(created.statusCode).toBe(201);
    const roleId = (created.json() as { id: string }).id;

    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${roleId}/permissions`,
      headers: superAdmin,
      payload: { grants: ['table:*:*:read'] },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${ctx.users.editor.id}/roles`,
      headers: superAdmin,
      payload: { roleId },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/probe/orders-read',
      headers: asUser(ctx.users.editor),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('roles routes', () => {
  it('lists roles with member counts', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: asUser(ctx.users.superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const { roles } = res.json() as { roles: { slug: string; memberCount: number; isBuiltin: boolean }[] };
    expect(roles.map((role) => role.slug).sort()).toEqual(['admin', 'editor', 'super-admin', 'viewer']);
    expect(roles.find((role) => role.slug === 'viewer')?.memberCount).toBe(1);
    expect(roles.every((role) => role.isBuiltin)).toBe(true);
  });

  it('custom role grant → allowed, revoke → denied, effective immediately', async () => {
    const superAdmin = asUser(ctx.users.superAdmin);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: superAdmin,
      payload: { name: 'Audit Reader', description: 'Sees the log' },
    });
    expect(created.statusCode).toBe(201);
    const roleId = (created.json() as { id: string }).id;

    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${ctx.users.editor.id}/roles`,
      headers: superAdmin,
      payload: { roleId },
    });

    // Not granted yet → denied.
    const before = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit', headers: asUser(ctx.users.editor) });
    expect(before.statusCode).toBe(403);

    // Grant → allowed on the very next request.
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${roleId}/permissions`,
      headers: superAdmin,
      payload: { grants: ['system:audit:read'] },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { grants: string[] }).grants).toEqual(['system:audit:read']);
    const during = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit', headers: asUser(ctx.users.editor) });
    expect(during.statusCode).toBe(200);

    // Revoke (empty matrix) → denied again.
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${roleId}/permissions`,
      headers: superAdmin,
      payload: { grants: [] },
    });
    const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/audit', headers: asUser(ctx.users.editor) });
    expect(after.statusCode).toBe(403);
  });

  it('PUT permissions 422s on grants outside the grammar', async () => {
    const superAdmin = asUser(ctx.users.superAdmin);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: superAdmin,
      payload: { name: 'Broken' },
    });
    const roleId = (created.json() as { id: string }).id;
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${roleId}/permissions`,
      headers: superAdmin,
      payload: { grants: ['system:audit:read', 'table:x', 'system:made-up:manage'] },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; details: { invalidGrants: string[] } } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.invalidGrants).toEqual(['table:x', 'system:made-up:manage']);
  });

  it('refuses editing/renaming/deleting built-ins and the Super Admin column', async () => {
    const superAdmin = asUser(ctx.users.superAdmin);
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/roles/${ctx.roles.viewer.id}`,
      headers: superAdmin,
      payload: { name: 'Renamed Viewer' },
    });
    expect(patch.statusCode).toBe(409);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/roles/${ctx.roles.admin.id}`,
      headers: superAdmin,
    });
    expect(del.statusCode).toBe(409);

    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/roles/${ctx.roles.superAdmin.id}/permissions`,
      headers: superAdmin,
      payload: { grants: [] },
    });
    expect(put.statusCode).toBe(409);
  });

  it('deletes a role with members only via ?reassignTo=', async () => {
    const superAdmin = asUser(ctx.users.superAdmin);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: superAdmin,
      payload: { name: 'Temp Crew' },
    });
    const roleId = (created.json() as { id: string }).id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${ctx.users.editor.id}/roles`,
      headers: superAdmin,
      payload: { roleId },
    });

    const refused = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/roles/${roleId}`,
      headers: superAdmin,
    });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: { details: { memberCount: number } } }).error.details.memberCount).toBe(1);

    const ok = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/roles/${roleId}?reassignTo=${ctx.roles.viewer.id}`,
      headers: superAdmin,
    });
    expect(ok.statusCode).toBe(200);

    // Members moved to the target role; the deleted role is gone from the list.
    const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/roles', headers: superAdmin });
    const roles = (list.json() as { roles: { id: string; slug: string; memberCount: number }[] }).roles;
    expect(roles.find((role) => role.id === roleId)).toBeUndefined();
    expect(roles.find((role) => role.slug === 'viewer')?.memberCount).toBe(2);
  });

  it('refuses unassigning the last Super Admin, allows once another exists', async () => {
    const superAdmin = asUser(ctx.users.superAdmin);
    const refused = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ctx.users.superAdmin.id}/roles/${ctx.roles.superAdmin.id}`,
      headers: superAdmin,
    });
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { error: { message: string } }).error.message).toMatch(/last super admin/i);

    // Promote the admin user, then the original unassign succeeds.
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${ctx.users.admin.id}/roles`,
      headers: superAdmin,
      payload: { roleId: ctx.roles.superAdmin.id },
    });
    const ok = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ctx.users.superAdmin.id}/roles/${ctx.roles.superAdmin.id}`,
      headers: superAdmin,
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { roleIds: string[] }).roleIds).not.toContain(ctx.roles.superAdmin.id);
  });

  it('audits role mutations with dotted verbs (07 §3.11 anatomy)', async () => {
    const superAdmin = asUser(ctx.users.superAdmin);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: superAdmin,
      payload: { name: 'Audited Role' },
    });
    const entries = await auditRepo(ctx.meta).list({ actorId: ctx.users.superAdmin.id, category: 'rbac' });
    const created = entries.find((entry) => entry.action === 'role.create');
    expect(created).toBeDefined();
    expect(created?.actorLabel).toBe(ctx.users.superAdmin.name);
    expect(created?.requestId).toMatch(/^req_/);
    expect(created?.changes).toMatchObject({ after: { name: 'Audited Role', slug: 'audited-role' } });
  });

  it('viewer cannot reach any roles route', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/roles',
      headers: asUser(ctx.users.viewer),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('super-admin assignment guard (security review 2026-07-23)', () => {
  it('a roles:manage holder that is not super-admin cannot grant the Super Admin role', async () => {
    const { permissionsRepo, rolesRepo } = await import('@adminium/meta');
    // Give the admin role roles:manage — a supported delegation — but it is
    // NOT super-admin.
    await permissionsRepo(ctx.meta).grant(ctx.roles.admin.id, 'system', 'roles.manage', {
      allowed: true,
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${ctx.users.admin.id}/roles`,
      headers: asUser(ctx.users.admin),
      payload: { roleId: ctx.roles.superAdmin.id },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');

    // The escalation did not happen — the admin never gained super-admin.
    const held = (await rolesRepo(ctx.meta).rolesForUser(ctx.users.admin.id)).map((r) => r.slug);
    expect(held).not.toContain('super-admin');
  });

  it('a super-admin can still grant the Super Admin role', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/users/${ctx.users.editor.id}/roles`,
      headers: asUser(ctx.users.superAdmin),
      payload: { roleId: ctx.roles.superAdmin.id },
    });
    expect(res.statusCode).toBe(200);
  });
});
