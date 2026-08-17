/**
 * User-directory routes (08-server-api.md §2.15, 07-meta-store.md §3.3):
 *
 * - `GET /users` — keyset page on `(created_at, id)` descending, the same
 *   anchor `/audit` uses, with `q` / `status` / `roleId` filters
 * - `POST /users` — INVITE. No password parameter exists: the row lands
 *   `status='invited'` with a NULL `password_hash` and the reply carries a
 *   single-use activation link (see invite.ts — this build has no SMTP)
 * - `GET|PATCH|DELETE /users/:id`, `PUT /users/:id/roles`,
 *   `POST /users/:id/invite/resend`
 *
 * Everything here requires `system:users:manage` — the first enforcement point
 * that key has ever had. Anything that GRANTS a role additionally requires
 * `system:roles:manage`, because an actor that can invite a user AND pick that
 * user's roles can mint itself any privilege (it holds the activation token).
 *
 * `DELETE` suspends by default. Every mutation writes an `rbac`-category audit
 * entry (dotted verb — 07 §3.11 anatomy).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { rolesRepo, sessionsRepo, usersRepo, type Role, type User } from '@adminium/meta';

import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { SUPER_ADMIN_SLUG } from '../../rbac/resolver.js';
import { toUserView } from '../auth/handlers.js';
import { mintInvite } from './invite.js';
import {
  userDeleteQuery,
  userDeleteReply,
  userIdParams,
  userInviteBody,
  userInviteReply,
  userListQuery,
  userListReply,
  userPatchBody,
  userReply,
  userRolesPutBody,
  type UserDto,
  type UserRoleRef,
} from './schema.js';

/** Keyset anchor, encoded exactly as `/audit` encodes its own. */
interface Cursor {
  createdAt: number;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}:${cursor.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  const createdAt = separator > 0 ? Number(decoded.slice(0, separator)) : Number.NaN;
  const id = separator > 0 ? decoded.slice(separator + 1) : '';
  if (!Number.isFinite(createdAt) || id.length === 0) {
    throw new ValidationFailedError('Malformed pagination cursor.', { cursor: raw });
  }
  return { createdAt, id };
}

function roleRef(role: Role): UserRoleRef {
  return { id: role.id, slug: role.slug, name: role.name };
}

/** The acting *user* id — an API-key principal is nobody's session user. */
function actingUserId(request: FastifyRequest): string | null {
  return request.apiKeyPrincipal === null
    ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
    : null;
}

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  const { meta } = app.rbac;
  const users = usersRepo(meta);
  const roles = rolesRepo(meta);
  const sessions = sessionsRepo(meta);

  const guarded = { preHandler: app.rbac.require(PERMISSIONS.usersManage) };
  /** Role assignment is a `roles:manage` power even on a users route. */
  const roleGuarded = {
    preHandler: [app.rbac.require(PERMISSIONS.usersManage), app.rbac.require(PERMISSIONS.rolesManage)],
  };

  async function mustFindUser(id: string): Promise<User> {
    const user = await users.findById(id);
    if (user === null) throw new NotFoundError('User not found.', { userId: id });
    return user;
  }

  /** Role chips for a whole page in one query — never one lookup per row. */
  async function rolesByUser(userIds: readonly string[]): Promise<Map<string, UserRoleRef[]>> {
    const byUser = new Map<string, UserRoleRef[]>();
    if (userIds.length === 0) return byUser;
    const rows = await meta.db
      .selectFrom('adminium_user_roles')
      .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
      .select([
        'adminium_user_roles.userId as userId',
        'adminium_roles.id as id',
        'adminium_roles.slug as slug',
        'adminium_roles.name as name',
      ])
      .where('adminium_user_roles.userId', 'in', [...userIds])
      .orderBy('adminium_roles.slug', 'asc')
      .execute();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push({ id: row.id, slug: row.slug, name: row.name });
      byUser.set(row.userId, list);
    }
    return byUser;
  }

  /**
   * `toUserView` is the audited safe projection (§7 item 6) — the repo row,
   * with its `passwordHash` / `totpSecretEncrypted` / `recoveryCodes`, is
   * never spread into a DTO.
   */
  function toDto(user: User, userRoles: readonly UserRoleRef[]): UserDto {
    return { ...toUserView(user), roles: [...userRoles] };
  }

  async function dtoFor(user: User): Promise<UserDto> {
    return toDto(user, (await roles.rolesForUser(user.id)).map(roleRef));
  }

  async function superAdminHolderCount(roleId: string): Promise<number> {
    const rows = await meta.db
      .selectFrom('adminium_user_roles')
      .select('userId')
      .where('roleId', '=', roleId)
      .execute();
    return rows.length;
  }

  /**
   * Minting guard, as `POST /users/:id/roles` carries it: only a session user
   * who HOLDS super-admin may hand it out, so a `roles:manage` holder cannot
   * promote itself to allow-all. An API-key principal never qualifies.
   */
  async function assertMayMintSuperAdmin(
    request: FastifyRequest,
    before: readonly Role[],
    after: readonly Role[],
  ): Promise<void> {
    const held = before.some((role) => role.slug === SUPER_ADMIN_SLUG);
    const keeps = after.some((role) => role.slug === SUPER_ADMIN_SLUG);
    if (held || !keeps) return;
    const actorId = actingUserId(request);
    const actorIsSuperAdmin =
      actorId !== null &&
      (await roles.rolesForUser(actorId)).some((role) => role.slug === SUPER_ADMIN_SLUG);
    if (!actorIsSuperAdmin) {
      throw new ForbiddenError('Only a Super Admin can grant the Super Admin role.');
    }
  }

  /**
   * Last-super-admin guard, as `DELETE /users/:id/roles/:roleId` carries it:
   * the workspace must never be left without one.
   */
  async function assertKeepsLastSuperAdmin(
    user: User,
    before: readonly Role[],
    after: readonly Role[],
  ): Promise<void> {
    const superAdmin = before.find((role) => role.slug === SUPER_ADMIN_SLUG);
    if (superAdmin === undefined) return;
    if (after.some((role) => role.slug === SUPER_ADMIN_SLUG)) return;
    if ((await superAdminHolderCount(superAdmin.id)) > 1) return;
    throw new ConflictError('Cannot remove the last Super Admin.', 'CONFLICT', {
      userId: user.id,
      roleId: superAdmin.id,
    });
  }

  /**
   * Losing the account is the same event as losing the role, so the
   * last-super-admin guard covers suspension and deletion too.
   */
  async function assertNotLastSuperAdmin(user: User): Promise<void> {
    await assertKeepsLastSuperAdmin(user, await roles.rolesForUser(user.id), []);
  }

  /** Locking yourself out is never the intent behind a click. */
  function assertNotSelf(request: FastifyRequest, user: User, action: string): void {
    if (actingUserId(request) === user.id) {
      throw new ConflictError(`You cannot ${action} your own account.`, 'CONFLICT', {
        userId: user.id,
      });
    }
  }

  /** Resolve requested role ids, 404ing on the first unknown one. */
  async function resolveRoles(roleIds: readonly string[]): Promise<Role[]> {
    const resolved: Role[] = [];
    for (const roleId of new Set(roleIds)) {
      const role = await roles.findById(roleId);
      if (role === null) throw new NotFoundError('Role not found.', { roleId });
      resolved.push(role);
    }
    return resolved;
  }

  app.get(
    '/users',
    { ...guarded, schema: { querystring: userListQuery, response: { 200: userListReply } } },
    async (request) => {
      const { q, status, roleId, cursor, limit } = request.query;
      const rows = await users.list({
        q,
        status,
        roleId,
        cursor: cursor === undefined ? undefined : decodeCursor(cursor),
        limit: limit + 1, // one extra row is how the next page is detected
      });

      const page = rows.slice(0, limit);
      const byUser = await rolesByUser(page.map((user) => user.id));
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;
      return {
        users: page.map((user) => toDto(user, byUser.get(user.id) ?? [])),
        nextCursor,
        counts: await users.countByStatus(),
      };
    },
  );

  app.post(
    '/users',
    { ...guarded, schema: { body: userInviteBody, response: { 201: userInviteReply } } },
    async (request, reply) => {
      const { email, name } = request.body;
      const roleIds = request.body.roleIds ?? [];
      if (roleIds.length > 0 && !(await request.can(PERMISSIONS.rolesManage))) {
        throw new ForbiddenError('Assigning roles requires the roles permission.', 'FORBIDDEN', {
          permission: PERMISSIONS.rolesManage,
        });
      }
      if ((await users.findByEmail(email)) !== null) {
        throw new ConflictError('A user with that email already exists.', 'UNIQUE_VIOLATION', {
          email: email.trim().toLowerCase(),
        });
      }
      const granted = await resolveRoles(roleIds);
      // Checked before the row exists — a refused invite leaves nothing behind.
      await assertMayMintSuperAdmin(request, [], granted);

      const now = app.rbac.now();
      // NULL passwordHash + status 'invited': there is no credential to set
      // until the invitee sets one, and login refuses both (§2.1).
      const user = await users.create({ email, name, passwordHash: null, status: 'invited' }, now);
      for (const role of granted) {
        await roles.assignToUser(user.id, role.id, actingUserId(request), now);
      }
      const invite = await mintInvite(meta, user.id, now);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'user.invite',
        changes: {
          after: {
            userId: user.id,
            email: user.email,
            status: user.status,
            roleIds: granted.map((role) => role.id),
            inviteExpiresAt: invite.expiresAt,
          },
        },
      });
      // The token is never logged and never returned again — a lost link is
      // re-minted by POST /users/:id/invite/resend.
      return reply
        .status(201)
        .send({ user: toDto(user, granted.map(roleRef)), invite, emailSent: false as const });
    },
  );

  app.get(
    '/users/:id',
    { ...guarded, schema: { params: userIdParams, response: { 200: userReply } } },
    async (request) => dtoFor(await mustFindUser(request.params.id)),
  );

  app.patch(
    '/users/:id',
    { ...guarded, schema: { params: userIdParams, body: userPatchBody, response: { 200: userReply } } },
    async (request) => {
      const user = await mustFindUser(request.params.id);
      const { name, email } = request.body;
      /** `null` when the body omits status or restates the current one. */
      const status =
        request.body.status !== undefined && request.body.status !== user.status
          ? request.body.status
          : null;

      const patch: { name?: string; email?: string } = {};
      if (name !== undefined && name !== user.name) patch.name = name;
      if (email !== undefined) {
        const next = email.trim().toLowerCase();
        if (next !== user.email) {
          const taken = await users.findByEmail(next);
          if (taken !== null && taken.id !== user.id) {
            throw new ConflictError('That email is already in use.', 'UNIQUE_VIOLATION', {
              email: next,
            });
          }
          patch.email = next;
        }
      }

      if (status === 'suspended') {
        assertNotSelf(request, user, 'suspend');
        await assertNotLastSuperAdmin(user);
      }
      // Reinstating an account that never had a credential would produce an
      // active user who cannot log in (login requires a hash, §2.1).
      if (status === 'active' && user.passwordHash === null) {
        throw new ConflictError(
          'This account has never set a password — resend the invite instead.',
          'CONFLICT',
          { userId: user.id, status: user.status },
        );
      }

      const now = app.rbac.now();
      if (Object.keys(patch).length > 0) await users.updateProfile(user.id, patch, now);
      if (status !== null) {
        await users.updateStatus(user.id, status, now);
        // A suspended user must stop being logged in immediately (§7 item 7).
        if (status === 'suspended') await sessions.revokeAllForUser(user.id, now);
      }

      const updated = await mustFindUser(user.id);
      await app.rbac.audit(request, {
        category: 'rbac',
        action:
          status === 'suspended'
            ? 'user.suspend'
            : status === 'active'
              ? 'user.reactivate'
              : 'user.update',
        changes: {
          before: { userId: user.id, name: user.name, email: user.email, status: user.status },
          after: { name: updated.name, email: updated.email, status: updated.status },
        },
      });
      return dtoFor(updated);
    },
  );

  app.delete(
    '/users/:id',
    {
      ...guarded,
      schema: { params: userIdParams, querystring: userDeleteQuery, response: { 200: userDeleteReply } },
    },
    async (request) => {
      const user = await mustFindUser(request.params.id);
      const permanent = request.query.permanent === true;
      assertNotSelf(request, user, permanent ? 'delete' : 'suspend');
      await assertNotLastSuperAdmin(user);

      const now = app.rbac.now();
      const before = {
        userId: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        roleIds: (await roles.rolesForUser(user.id)).map((role) => role.id),
      };

      if (permanent) {
        // Explicitly asked for. FK CASCADE takes the user's prefs, sessions
        // and reset tokens with it, and `adminium_settings.updated_by` goes
        // NULL — audited under its own verb precisely because it is lossy.
        await meta.db.deleteFrom('adminium_users').where('id', '=', user.id).execute();
        await app.rbac.audit(request, {
          category: 'rbac',
          action: 'user.delete',
          changes: { before },
        });
        return { ok: true as const, permanent: true, user: null };
      }

      await users.updateStatus(user.id, 'suspended', now);
      await sessions.revokeAllForUser(user.id, now);
      const suspended = await mustFindUser(user.id);
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'user.suspend',
        changes: { before, after: { status: suspended.status } },
      });
      return { ok: true as const, permanent: false, user: await dtoFor(suspended) };
    },
  );

  app.put(
    '/users/:id/roles',
    {
      ...roleGuarded,
      schema: { params: userIdParams, body: userRolesPutBody, response: { 200: userReply } },
    },
    async (request) => {
      const user = await mustFindUser(request.params.id);
      const after = await resolveRoles(request.body.roleIds);
      const before = await roles.rolesForUser(user.id);
      await assertMayMintSuperAdmin(request, before, after);
      await assertKeepsLastSuperAdmin(user, before, after);

      const now = app.rbac.now();
      const keep = new Set(after.map((role) => role.id));
      for (const role of before) {
        if (!keep.has(role.id)) await roles.removeFromUser(user.id, role.id);
      }
      for (const role of after) {
        await roles.assignToUser(user.id, role.id, actingUserId(request), now);
      }

      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'user.roles.replace',
        changes: {
          before: { userId: user.id, roleIds: before.map((role) => role.id) },
          after: { roleIds: after.map((role) => role.id) },
        },
      });
      return dtoFor(await mustFindUser(user.id));
    },
  );

  app.post(
    '/users/:id/invite/resend',
    { ...guarded, schema: { params: userIdParams, response: { 200: userInviteReply } } },
    async (request) => {
      const user = await mustFindUser(request.params.id);
      if (user.status !== 'invited') {
        throw new ConflictError('This account has already been activated.', 'CONFLICT', {
          userId: user.id,
          status: user.status,
        });
      }
      // A fresh token rather than a re-read: the old one is only stored
      // hashed, so nothing can hand back the plaintext that was minted before.
      const invite = await mintInvite(meta, user.id, app.rbac.now());
      await app.rbac.audit(request, {
        category: 'rbac',
        action: 'user.invite.resend',
        changes: { after: { userId: user.id, inviteExpiresAt: invite.expiresAt } },
      });
      return { user: await dtoFor(user), invite, emailSent: false as const };
    },
  );
};
