/**
 * Roles & permission-matrix routes (08-server-api.md §2.3, M2-T05/08-T08):
 *
 * - `GET /roles` (list + member counts), `POST /roles` (custom roles, with
 *   optional clone), `PATCH /roles/:id`, `DELETE /roles/:id?reassignTo=`
 * - `GET|PUT /roles/:id/permissions` — full-matrix replace in §5.1 grant
 *   strings; the super-admin column is hard-locked (`Roles
 *   Permissions.dc.html`)
 * - `POST /users/:id/roles`, `DELETE /users/:id/roles/:roleId` — assign /
 *   unassign with the last-super-admin guard
 *
 * Built-ins cannot be renamed or deleted (409). Every mutation writes an
 * `rbac`-category audit entry (dotted verb + resource — 07 §3.11 anatomy).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { permissionsRepo, rolesRepo, usersRepo, type Role } from '@adminium/meta';

import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import {
  PERMISSIONS,
  grantsFromMatrixRows,
  matrixRowsFromGrants,
} from '../../rbac/permissions.js';
import { SUPER_ADMIN_SLUG } from '../../rbac/resolver.js';
import {
  roleCreateBody,
  roleDeleteQuery,
  roleIdParams,
  roleListReply,
  roleOkReply,
  rolePatchBody,
  rolePermissionsPutBody,
  rolePermissionsReply,
  roleReply,
  userRoleDeleteParams,
  userRolesParams,
  userRolesPostBody,
  userRolesReply,
  type RoleDto,
} from './schema.js';

function toDto(role: Role): RoleDto {
  return {
    id: role.id,
    slug: role.slug,
    name: role.name,
    description: role.description,
    isBuiltin: role.isBuiltin,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/** `Custom Support Role` → `custom-support-role` (slug column is str(40)). */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'role';
}

export const rolesRoutes: FastifyPluginAsyncZod = async (app) => {
  const { meta } = app.rbac;
  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const permissions = permissionsRepo(meta);

  async function mustFindRole(id: string): Promise<Role> {
    const role = await roles.findById(id);
    if (role === null) throw new NotFoundError('Role not found.', { roleId: id });
    return role;
  }

  async function memberCountFor(roleId: string): Promise<number> {
    const rows = await meta.db
      .selectFrom('adminium_user_roles')
      .select('userId')
      .where('roleId', '=', roleId)
      .execute();
    return rows.length;
  }

  app.get(
    '/roles',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { response: { 200: roleListReply } },
    },
    async () => {
      const [all, counts] = await Promise.all([
        roles.list(),
        meta.db
          .selectFrom('adminium_user_roles')
          .select(['roleId', (eb) => eb.fn.countAll().as('memberCount')])
          .groupBy('roleId')
          .execute(),
      ]);
      const countByRole = new Map(counts.map((row) => [row.roleId, Number(row.memberCount)]));
      return {
        roles: all.map((role) => ({ ...toDto(role), memberCount: countByRole.get(role.id) ?? 0 })),
      };
    },
  );

  app.post(
    '/roles',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { body: roleCreateBody, response: { 201: roleReply } },
    },
    async (request, reply) => {
      const { name, description, cloneFromRoleId } = request.body;
      const slug = slugify(name);
      if ((await roles.findBySlug(slug)) !== null) {
        throw new ConflictError(`A role with slug "${slug}" already exists.`, 'UNIQUE_VIOLATION', {
          slug,
        });
      }
      const source = cloneFromRoleId === undefined ? null : await mustFindRole(cloneFromRoleId);
      const role = await roles.create({ slug, name, description: description ?? null }, app.rbac.now());
      if (source !== null) {
        for (const row of await permissions.listForRole(source.id)) {
          await permissions.grant(role.id, row.resourceKind, row.resourceRef, row.actions);
        }
      }
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'role.create',
        changes: { after: { roleId: role.id, slug, name, clonedFrom: source?.id ?? null } },
      });
      return reply.status(201).send(toDto(role));
    },
  );

  app.patch(
    '/roles/:id',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { params: roleIdParams, body: rolePatchBody, response: { 200: roleReply } },
    },
    async (request) => {
      const role = await mustFindRole(request.params.id);
      if (role.isBuiltin) {
        throw new ConflictError('Built-in roles cannot be renamed or edited.', 'CONFLICT', {
          slug: role.slug,
        });
      }
      const patch: { name?: string; description?: string | null } = {};
      if (request.body.name !== undefined) patch.name = request.body.name;
      if (request.body.description !== undefined) patch.description = request.body.description;
      await meta.db
        .updateTable('adminium_roles')
        .set({ ...patch, updatedAt: app.rbac.now() })
        .where('id', '=', role.id)
        .execute();
      const updated = await mustFindRole(role.id);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'role.update',
        changes: {
          before: { name: role.name, description: role.description },
          after: { name: updated.name, description: updated.description },
        },
      });
      return toDto(updated);
    },
  );

  app.delete(
    '/roles/:id',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { params: roleIdParams, querystring: roleDeleteQuery, response: { 200: roleOkReply } },
    },
    async (request) => {
      const role = await mustFindRole(request.params.id);
      if (role.isBuiltin) {
        throw new ConflictError('Built-in roles cannot be deleted.', 'CONFLICT', { slug: role.slug });
      }
      const memberCount = await memberCountFor(role.id);
      const { reassignTo } = request.query;
      if (memberCount > 0 && reassignTo === undefined) {
        throw new ConflictError(
          'Role has members — pass ?reassignTo=<roleId> to move them first.',
          'CONFLICT',
          { memberCount },
        );
      }
      if (memberCount > 0 && reassignTo !== undefined) {
        if (reassignTo === role.id) {
          throw new ValidationFailedError('reassignTo must be a different role.', { reassignTo });
        }
        const target = await mustFindRole(reassignTo);
        const members = await meta.db
          .selectFrom('adminium_user_roles')
          .select('userId')
          .where('roleId', '=', role.id)
          .execute();
        for (const member of members) {
          await roles.assignToUser(member.userId, target.id, null, app.rbac.now());
        }
        await meta.db.deleteFrom('adminium_user_roles').where('roleId', '=', role.id).execute();
      }
      // FK CASCADE removes the role's adminium_role_permissions rows.
      await meta.db.deleteFrom('adminium_roles').where('id', '=', role.id).execute();
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'role.delete',
        changes: {
          before: { roleId: role.id, slug: role.slug, name: role.name, memberCount },
          after: { reassignedTo: memberCount > 0 ? (reassignTo ?? null) : null },
        },
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/roles/:id/permissions',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { params: roleIdParams, response: { 200: rolePermissionsReply } },
    },
    async (request) => {
      const role = await mustFindRole(request.params.id);
      return { roleId: role.id, grants: grantsFromMatrixRows(await permissions.listForRole(role.id)) };
    },
  );

  app.put(
    '/roles/:id/permissions',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: {
        params: roleIdParams,
        body: rolePermissionsPutBody,
        response: { 200: rolePermissionsReply },
      },
    },
    async (request) => {
      const role = await mustFindRole(request.params.id);
      if (role.slug === SUPER_ADMIN_SLUG) {
        // Hard-locked column per Roles Permissions.dc.html / 07 §3.8.
        throw new ConflictError('The Super Admin permission column is locked.', 'CONFLICT', {
          slug: role.slug,
        });
      }
      const { rows, invalid } = matrixRowsFromGrants(request.body.grants);
      if (invalid.length > 0) {
        throw new ValidationFailedError('One or more grants are outside the permission grammar.', {
          invalidGrants: invalid,
        });
      }
      const before = grantsFromMatrixRows(await permissions.listForRole(role.id));
      await meta.db.deleteFrom('adminium_role_permissions').where('roleId', '=', role.id).execute();
      for (const row of rows) {
        await permissions.grant(role.id, row.resourceKind, row.resourceRef, row.actions);
      }
      const after = grantsFromMatrixRows(await permissions.listForRole(role.id));
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'role.permission.change',
        changes: { before: { grants: before }, after: { grants: after } },
      });
      return { roleId: role.id, grants: after };
    },
  );

  // --- user-role assignment ----------------------------------------------------

  app.post(
    '/users/:id/roles',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { params: userRolesParams, body: userRolesPostBody, response: { 200: userRolesReply } },
    },
    async (request) => {
      const user = await users.findById(request.params.id);
      if (user === null) throw new NotFoundError('User not found.', { userId: request.params.id });
      const role = await mustFindRole(request.body.roleId);
      // granted_by is the acting *user* id when the actor is a session user.
      const actingUserId =
        request.apiKeyPrincipal === null
          ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
          : null;
      // Minting a new Super Admin is a super-admin-only power. `roles:manage`
      // is a grantable key a custom role can hold, so without this a
      // roles:manage holder could assign the Super Admin role to themselves and
      // escalate to allow-all. Mirrors the asymmetry the DELETE/PUT handlers
      // already encode. Only a session user who *holds* Super Admin qualifies —
      // an API-key principal never mints a Super Admin.
      if (role.slug === SUPER_ADMIN_SLUG) {
        const actorIsSuperAdmin =
          actingUserId !== null &&
          (await roles.rolesForUser(actingUserId)).some((r) => r.slug === SUPER_ADMIN_SLUG);
        if (!actorIsSuperAdmin) {
          throw new ForbiddenError('Only a Super Admin can grant the Super Admin role.');
        }
      }
      await roles.assignToUser(user.id, role.id, actingUserId, app.rbac.now());
      const roleIds = (await roles.rolesForUser(user.id)).map((r) => r.id);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'user.role.assign',
        changes: { after: { userId: user.id, roleId: role.id, roleSlug: role.slug } },
      });
      return { userId: user.id, roleIds };
    },
  );

  app.delete(
    '/users/:id/roles/:roleId',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { params: userRoleDeleteParams, response: { 200: userRolesReply } },
    },
    async (request) => {
      const user = await users.findById(request.params.id);
      if (user === null) throw new NotFoundError('User not found.', { userId: request.params.id });
      const role = await mustFindRole(request.params.roleId);
      if (role.slug === SUPER_ADMIN_SLUG) {
        const holders = await memberCountFor(role.id);
        const userHolds = (await roles.rolesForUser(user.id)).some((r) => r.id === role.id);
        if (userHolds && holders <= 1) {
          throw new ConflictError('Cannot remove the last Super Admin.', 'CONFLICT', {
            roleId: role.id,
          });
        }
      }
      const removed = await roles.removeFromUser(user.id, role.id);
      if (!removed) {
        throw new NotFoundError('The user does not hold this role.', {
          userId: user.id,
          roleId: role.id,
        });
      }
      const roleIds = (await roles.rolesForUser(user.id)).map((r) => r.id);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'user.role.unassign',
        changes: { before: { userId: user.id, roleId: role.id, roleSlug: role.slug } },
      });
      return { userId: user.id, roleIds };
    },
  );
};
