// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Roles & permission-matrix routes:
 *
 * - `GET /roles` (list + member counts), `POST /roles` (custom roles, with
 *   optional clone), `PATCH /roles/:id`, `DELETE /roles/:id?reassignTo=`
 * - `GET|PUT /roles/:id/permissions` — full-matrix replace grant
 * strings; the super-admin column is hard-locked (`Roles
 * Permissions.dc.html`)
 * - `POST /users/:id/roles`, `DELETE /users/:id/roles/:roleId` — assign /
 *   unassign with the last-super-admin guard
 *
 * Built-ins cannot be renamed or deleted (409). Every mutation writes an
 * `rbac`-category audit entry (dotted verb + resource — anatomy).
 */
import { sameLanguage } from '../../i18n/bcp47.js';
import { loadAppParts, roleIsOffered } from '../../rbac/app-parts.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { permissionsRepo, rolesRepo, rowReachList, usersRepo, type Role, type TableActions, type ReadLimit, type RowLimit, type UpdateLimit, roleNameFor, userPrefsRepo } from '@adminium/meta';

import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import {
  PERMISSIONS,
  grantMatches,
  grantsFromMatrixRows,
  matrixRowsFromGrants,
} from '../../rbac/permissions.js';
import type { EffectiveModel } from '../../connections/effective-schema.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { SUPER_ADMIN_SLUG } from '../../rbac/resolver.js';
import { rowLimitIssue } from '../../rbac/row-limit-check.js';
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

function toDto(role: Role, locale?: string): RoleDto {
  return {
    id: role.id,
    slug: role.slug,
    // An app's role under its name in the reader's language, until the owner renames it.
    name: locale === undefined ? role.name : roleNameFor(role, (names) => sameLanguage(names, locale)),
    description: role.description,
    isBuiltin: role.isBuiltin,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/** The row limits a role's matrix rows carry, by table. */
function rowLimitsOf(rows: readonly { resourceKind: string; resourceRef: string; actions: unknown }[]): Record<string, RowLimit> {
  const out: Record<string, RowLimit> = {};
  for (const row of rows) {
    const limit = row.resourceKind === 'table' ? (row.actions as TableActions).rowLimit : undefined;
    if (limit !== undefined) out[row.resourceRef] = limit;
  }
  return out;
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
    async (request) => {
      const locale = request.user === null || request.user === undefined ? undefined : (await userPrefsRepo(meta).resolve(request.user.id)).locale;
      const [all, counts] = await Promise.all([
        roles.list(),
        meta.db
          .selectFrom('adminium_user_roles')
          .select(['roleId', (eb) => eb.fn.countAll().as('memberCount')])
          .groupBy('roleId')
          .execute(),
      ]);
      const countByRole = new Map(counts.map((row) => [row.roleId, Number(row.memberCount)]));
      // A role of an app's parts is offered while one of them is on: one that is not says so, and is given to nobody new.
      const parts = await loadAppParts(meta, [...new Set(all.flatMap((role) => (role.appKey === null || role.modules === null ? [] : [role.appKey])))]);
      return {
        roles: all.map((role) => ({
          ...toDto(role, locale),
          memberCount: countByRole.get(role.id) ?? 0,
          ...(role.appKey === null ? {} : { appKey: role.appKey }),
          ...(roleIsOffered(role, parts) ? {} : { partsOff: true as const }),
        })),
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
      const held = await permissions.listForRole(role.id);
      return { roleId: role.id, grants: grantsFromMatrixRows(held), rows: rowLimitsOf(held) };
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
        // Hard-locked column per Roles Permissions.dc.html /.
        throw new ConflictError('The Super Admin permission column is locked.', 'CONFLICT', {
          slug: role.slug,
        });
      }
      const models = new Map<string, EffectiveModel | null>();
      const modelOf = async (connectionId: string): Promise<EffectiveModel | null> => {
        if (!models.has(connectionId)) models.set(connectionId, await loadSnapshotView(meta, connectionId).then((view) => view.model, () => null));
        return models.get(connectionId) ?? null;
      };
      const { rows, invalid } = matrixRowsFromGrants(request.body.grants);
      if (invalid.length > 0) {
        throw new ValidationFailedError('One or more grants are outside the permission grammar.', {
          invalidGrants: invalid,
        });
      }
      const held = await permissions.listForRole(role.id);
      const before = grantsFromMatrixRows(held);
      /*
       * A limit on an update (an app's clinician may only move a visit along)
       * is not a grant string, so the matrix cannot send it back. It stays on
       * its table's row through a save: dropping it would quietly let the
       * role rewrite every column the moment anyone ticked a box.
       */
      const limits = new Map<string, UpdateLimit>();
      // …and so does a limit on a read (housekeeping reads a stay's room, not its guest): dropped, the role would read every column.
      const reads = new Map<string, ReadLimit>();
      // …and a limit on a create (a kitchen tablet never picks an order's channel or its link code).
      const creates = new Map<string, UpdateLimit>();
      // …and which rows a read, an update or a delete reaches (a rep reads their own deals): dropped, the role would reach every row.
      const rowLimits = new Map<string, RowLimit>();
      for (const row of held) {
        const rows = row.resourceKind === 'table' ? (row.actions as TableActions).rowLimit : undefined;
        if (rows !== undefined) rowLimits.set(row.resourceRef, rows);
        const limit = row.resourceKind === 'table' ? (row.actions as TableActions).updateLimit : undefined;
        if (limit !== undefined) limits.set(row.resourceRef, limit);
        const read = row.resourceKind === 'table' ? (row.actions as TableActions).readLimit : undefined;
        if (read !== undefined) reads.set(row.resourceRef, read);
        const create = row.resourceKind === 'table' ? (row.actions as TableActions).createLimit : undefined;
        if (create !== undefined) creates.set(row.resourceRef, create);
      }
      // What the editor changed of "which rows": set, or taken off; a table it did not send keeps its own.
      const granted = new Set(rows.filter((row) => row.resourceKind === 'table').map((row) => row.resourceRef));
      for (const [ref, limit] of Object.entries(request.body.rows ?? {})) {
        if (limit === null || Object.keys(limit).length === 0) {
          rowLimits.delete(ref);
          continue;
        }
        if (!granted.has(ref)) {
          throw new ValidationFailedError('A row limit narrows a grant: the role holds nothing on that table.', { fields: { rows: { code: 'not-granted', table: ref } } });
        }
        // The table itself: there, saying whose its rows are, not private, and told apart by a column everybody who reads it sees.
        const [connectionId, ...rest] = ref.split('/');
        const tableId = rest.join('/');
        const model = connectionId === undefined || connectionId === '' ? null : await modelOf(connectionId);
        const wrong = model === null ? ({ code: 'no-such-table', message: 'That table is not there.', action: '' } as const) : rowLimitIssue(model, tableId, limit);
        if (wrong !== null) throw new ValidationFailedError(wrong.message, { fields: { rows: { code: wrong.code, table: ref, ...(wrong.action === '' ? {} : { action: wrong.action }), ...('column' in wrong && wrong.column !== undefined ? { column: wrong.column } : {}) } } });
        const own = rows.find((row) => row.resourceKind === 'table' && row.resourceRef === ref)?.actions as TableActions | undefined;
        for (const [action, written] of Object.entries(limit)) {
          // A limit is stored on the table's own row and read from it: an action that row does not give is given, if at all, by a
          // wider grant, which no limit here narrows. The screen would say "their own rows" and the role would reach every row.
          if (written !== undefined && own?.[action as 'read' | 'update' | 'delete'] !== true) {
            throw new ValidationFailedError(`A row limit narrows an action the role is given on that table itself: it is not given "${action}" there.`, { fields: { rows: { code: 'action-not-granted', table: ref, action } } });
          }
          // "Every row" is the plain grant; it is written as a limit only to say "only while". Each of several reaches alike:
          // one of them that reached every row would make the others say nothing.
          if (rowReachList(written).some((reach) => reach.reach === 'all' && reach.while === undefined && reach.notBy === undefined)) {
            throw new ValidationFailedError('"Every row" is the grant itself: take the limit off, or say only while.', { fields: { rows: { code: 'all-without-while', table: ref, action } } });
          }
        }
        rowLimits.set(ref, limit);
      }
      // A limited table whose own row this save takes away, while a wider grant still gives the action there: the limit would
      // go with the row and the role reach every row, with nothing said. Refused, unless the limit is taken off by name.
      for (const [ref, limit] of rowLimits) {
        if (granted.has(ref) || request.body.rows?.[ref] === null) continue;
        const [connectionId, ...rest] = ref.split('/');
        const lifted = Object.keys(limit).filter((action) => request.body.grants.some((grant) => grantMatches(grant, `table:${connectionId ?? ''}:${rest.join('/')}:${action}`)));
        if (lifted.length > 0) {
          throw new ValidationFailedError('That table is held to some of its rows, and a wider grant would still give it: keep its own row, or take the row limit off first.', { fields: { rows: { code: 'limit-would-lift', table: ref, actions: lifted } } });
        }
      }
      const beforeRows = rowLimitsOf(held);
      await meta.db.deleteFrom('adminium_role_permissions').where('roleId', '=', role.id).execute();
      for (const row of rows) {
        const limit = row.resourceKind === 'table' ? limits.get(row.resourceRef) : undefined;
        const read = row.resourceKind === 'table' ? reads.get(row.resourceRef) : undefined;
        const create = row.resourceKind === 'table' ? creates.get(row.resourceRef) : undefined;
        const rowLimit = row.resourceKind === 'table' ? rowLimits.get(row.resourceRef) : undefined;
        const actions =
          limit === undefined && read === undefined && create === undefined && rowLimit === undefined
            ? row.actions
            : {
                ...(row.actions as TableActions),
                ...(limit === undefined ? {} : { updateLimit: limit }),
                ...(read === undefined ? {} : { readLimit: read }),
                ...(create === undefined ? {} : { createLimit: create }),
                ...(rowLimit === undefined ? {} : { rowLimit }),
              };
        await permissions.grant(role.id, row.resourceKind, row.resourceRef, actions);
      }
      const saved = await permissions.listForRole(role.id);
      const after = grantsFromMatrixRows(saved);
      const afterRows = rowLimitsOf(saved);
      const rowsChanged = JSON.stringify(beforeRows) !== JSON.stringify(afterRows);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'role.permission.change',
        changes: { before: { grants: before, ...(rowsChanged ? { rows: beforeRows } : {}) }, after: { grants: after, ...(rowsChanged ? { rows: afterRows } : {}) } },
      });
      return { roleId: role.id, grants: after, rows: afterRows };
    },
  );

  // --- user-role assignment ----------------------------------------------------

  /**
   * A person an app's sample data made holds the roles the sample gave them
   * and no other: given one by hand (Super Admin among them) they would
   * count as a holder who can never sign in. Removing the sample removes them.
   */
  const assertNotSample = (user: { status: string }): void => {
    if (user.status === 'sample') throw new ConflictError('This is a sample person. Removing the app\'s sample data removes them.', 'CONFLICT', { reason: 'SAMPLE_PERSON' });
  };

  app.post(
    '/users/:id/roles',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { params: userRolesParams, body: userRolesPostBody, response: { 200: userRolesReply } },
    },
    async (request) => {
      const user = await users.findById(request.params.id);
      if (user === null) throw new NotFoundError('User not found.', { userId: request.params.id });
      assertNotSample(user);
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
      assertNotSample(user);
      const role = await mustFindRole(request.params.roleId);
      if (role.slug === SUPER_ADMIN_SLUG) {
        // Demoting a Super Admin is as much a super-admin-only power as
        // minting one (POST above): `roles:manage` is grantable to a custom
        // role, whose holder could otherwise strip every Super Admin but one.
        const actingUserId =
          request.apiKeyPrincipal === null
            ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
            : null;
        const actorIsSuperAdmin =
          actingUserId !== null &&
          (await roles.rolesForUser(actingUserId)).some((r) => r.slug === SUPER_ADMIN_SLUG);
        if (!actorIsSuperAdmin) {
          throw new ForbiddenError('Only a Super Admin can remove the Super Admin role.');
        }
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
