// SPDX-License-Identifier: AGPL-3.0-only
/**
 * User-directory routes:
 *
 * - `GET /users` — keyset page on `(created_at, id)` descending, the same
 *   anchor `/audit` uses, with `q` / `status` / `roleId` filters
 * - `POST /users` — INVITE. No password parameter exists: the row lands
 *   `status='invited'` with a NULL `password_hash`. The invitation mail is
 *   queued when SMTP is configured (`emailSent`), and the reply carries the
 *   single-use activation link EITHER WAY (see invite.ts)
 * - `GET|PATCH|DELETE /users/:id`, `PUT /users/:id/roles`,
 *   `POST /users/:id/invite/resend`
 *
 * Everything here requires `system:users:manage` — the first enforcement point
 * that key has ever had. Anything that GRANTS a role additionally requires
 * `system:roles:manage`, because an actor that can invite a user AND pick that
 * user's roles can mint itself any privilege (it holds the activation token).
 *
 * `DELETE` suspends by default. Every mutation writes an `rbac`-category audit
 * entry (dotted verb — anatomy).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import {
  emailChangesRepo,
  passwordResetsRepo,
  rolesRepo,
  sessionsRepo,
  settingsRepo,
  usersRepo,
  type Role,
  type User,
} from '@adminium/meta';

import { USER_INVITE_TEMPLATE_KEY, enqueueEmail } from '../../email/send.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { recipientLocale, translatorFor } from '../../i18n/server-i18n.js';
import { scrubUrlForLog } from '../../log-scrub.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { getPrincipal, type RbacPrincipal } from '../../rbac/principal.js';
import { REACH_ABOVE_YOU } from '../../rbac/reach-held.js';
import { SUPER_ADMIN_SLUG } from '../../rbac/resolver.js';
import { linkOrigin } from '../../security/public-origin.js';
import { toUserView } from '../auth/handlers.js';
import { roleGiving } from '../roles/role-giving.js';
import { accountKeyAuditEntries, revokeAccountKeys } from './account-keys.js';
import { INVITE_TOKEN_TTL_MS, mintInvite, type MintedInvite } from './invite.js';
import { cursorText } from '../../security/nul-bytes.js';
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
  // U+0000 in a cursor is no cursor the server wrote, and would reach the database (`cursorText`).
  const decoded = cursorText(raw) ?? '';
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

  /**
   * The master secret, off the auth plugin's context rather than threaded in:
   * `usersRoutes` is registered as a bare plugin (compose passes it no deps at
   * all), and `app.authContext` is where a route already reaches for `Env`.
   * Absent only on a server built without a meta store, which cannot get here.
   */
  const emailSecret = app.authContext?.env.ADMINIUM_SECRET;

  /**
   * Stops an account in one transaction with its API keys (`account-keys.ts`):
   * no moment where the person is stopped and a key of theirs still works, and
   * no key revoked for a stop that did not happen. Then what is open closes.
   */
  async function stopAccount(request: FastifyRequest, user: User, how: 'suspend' | 'delete', at: number): Promise<void> {
    await meta.db.transaction().execute(async (trx) => {
      const inTransaction = { ...meta, db: trx };
      // First: a key being made for this person waits for the stop, and then sees it (`POST /api-keys`). SQLite has one writer.
      const held = trx.selectFrom('adminium_users').select('id').where('id', '=', user.id);
      await (meta.dialect === 'sqlite' ? held : held.forUpdate()).execute();
      const keys = await revokeAccountKeys(inTransaction, user.id, at);
      // What they could still use or hand on: their own reset links, invitations they issued, and connect links they made.
      const resets = passwordResetsRepo(inTransaction);
      await resets.retireFor([user.id], at);
      const invited = await trx
        .selectFrom('adminium_user_roles as granted')
        .innerJoin('adminium_users as person', 'person.id', 'granted.userId')
        .select('person.id')
        .where('granted.grantedBy', '=', user.id)
        .where('person.status', '=', 'invited')
        .execute();
      await resets.retireFor([...new Set(invited.map((person) => person.id))], at, 'invite');
      const links = await trx.selectFrom('adminium_connect_links').select('id').where('createdBy', '=', user.id).execute();
      if (links.length > 0) {
        const ids = links.map((link) => link.id);
        await trx.deleteFrom('adminium_oauth_flows').where('linkId', 'in', ids).execute();
        await trx.deleteFrom('adminium_connect_links').where('id', 'in', ids).execute();
      }
      if (how === 'delete') await trx.deleteFrom('adminium_users').where('id', '=', user.id).execute();
      else {
        await usersRepo(inTransaction).updateStatus(user.id, 'suspended', at);
        await sessionsRepo(inTransaction).revokeAllForUser(user.id, at);
      }
      // In the transaction: after a removal for good, this is all that says whose a key was.
      for (const entry of accountKeyAuditEntries(user, keys)) await app.rbac.audit(request, entry, inTransaction);
    });
    closeConnections(user.id);
  }

  /** Ends a person's open sockets and streams (`jobs/register.ts`); a server with no realtime has none. */
  const closeConnections = (userId: string): void => {
    (app as unknown as { closeUserConnections?: (id: string) => number }).closeUserConnections?.(userId);
  };

  /**
   * Queue the invitation mail. Returns whether it was QUEUED — not whether it
   * arrived; the relay owns that, and the job's retry/dead-letter state is
   * where an operator watches it. Never throws: the activation link in the
   * reply is the fallback, so a broken mail path must not fail the invite that
   * already created the user row.
   */
  /**
   * Who the invitation says it is from. An API-key principal is nobody's
   * session user (`actingUserId` returns null there), and a suspended or
   * deleted actor can vanish between the invite and the send — so this always
   * resolves to a printable noun rather than risking the empty string, which
   * would ship "  invited you to join Acme" to a stranger. The fallback is
   * translated into the RECIPIENT's locale, not the actor's.
   */
  async function inviterNameFor(request: FastifyRequest, recipientId: string): Promise<string> {
    const actorId = actingUserId(request);
    if (actorId !== null) {
      const actor = await users.findById(actorId);
      const name = actor?.name.trim() ?? '';
      if (name !== '') return name;
    }
    // i18next binds `t` during init, so destructuring it is safe (same note as
    // `email/builtins.ts`).
    const { t } = await translatorFor(meta, recipientId);
    return t('email:userInvite.inviterFallback', { defaultValue: 'An administrator' });
  }

  async function deliverInvite(
    request: FastifyRequest,
    user: User,
    invite: MintedInvite,
  ): Promise<boolean> {
    try {
      const queued = await enqueueEmail(
        {
          meta,
          ...(emailSecret === undefined ? {} : { secret: emailSecret }),
          logger: request.log,
        },
        {
          to: user.email,
          templateKey: USER_INVITE_TEMPLATE_KEY,
          account: true,
          locale: await recipientLocale(meta, user.id),
          // Names come from BUILTIN_EMAIL_TEMPLATE_VARS['user-invite'].
          vars: {
            appName: await settingsRepo(meta).get('branding.appName'),
            name: user.name,
            email: user.email,
            inviterName: await inviterNameFor(request, user.id),
            // Not the caller's `Origin`: an API key can send any it likes, and
            // the activation token would go to that host (security/public-origin.ts).
            activationUrl: `${await linkOrigin(meta, request)}${invite.activationPath}`,
          },
          counts: { expiresInDays: Math.round(INVITE_TOKEN_TTL_MS / 86_400_000) },
        },
      );
      return queued !== null;
    } catch (error) {
      request.log.warn({ err: error, userId: user.id }, 'could not queue the invitation email');
      return false;
    }
  }

  const giving = roleGiving(app);
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
   * `toUserView` is the audited safe projection — the repo row, with its
   * `passwordHash` / `totpSecretEncrypted` / `recoveryCodes`, is never
   * spread into a DTO.
   */
  function toDto(user: User, userRoles: readonly UserRoleRef[]): UserDto {
    return { ...toUserView(user), roles: [...userRoles] };
  }

  async function dtoFor(user: User): Promise<UserDto> {
    return toDto(user, (await roles.rolesForUser(user.id)).map(roleRef));
  }

  async function superAdminHolderCount(roleId: string): Promise<number> {
    // Those who can act: only somebody active can reinstate anybody.
    const rows = await meta.db
      .selectFrom('adminium_user_roles')
      .innerJoin('adminium_users', 'adminium_users.id', 'adminium_user_roles.userId')
      .select('adminium_user_roles.userId')
      .where('adminium_user_roles.roleId', '=', roleId)
      .where('adminium_users.status', '=', 'active')
      .execute();
    return rows.length;
  }

  /**
   * A Super Admin's account is changed only by a Super Admin.
   *
   * `users.manage` is the Admin role's key: it does not reach an account that
   * holds every permission there is. This is the same asymmetry `role-giving.ts`
   * holds for giving the role; an API-key principal never qualifies. Refusing is a 403, not the 409
   * the invariants below throw: it is about who is asking, not about state.
   */
  async function assertMayActOnAccount(request: FastifyRequest, user: User): Promise<void> {
    const target = await roles.rolesForUser(user.id);
    if (!target.some((role) => role.slug === SUPER_ADMIN_SLUG)) return;
    const actorId = actingUserId(request);
    const actorIsSuperAdmin =
      actorId !== null &&
      (await roles.rolesForUser(actorId)).some((role) => role.slug === SUPER_ADMIN_SLUG);
    if (!actorIsSuperAdmin) {
      throw new ForbiddenError('Only a Super Admin can change a Super Admin account.');
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
    // Somebody who is not active leaves the number who can act as it was.
    if (user.status !== 'active') return;
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
  /**
   * A person an app's sample data made is the sample's: not renamed, given a
   * password, suspended, deleted or re-roled by hand. Removing the sample
   * data removes them.
   */
  function assertNotSample(user: User): void {
    if (user.status === 'sample') {
      throw new ConflictError('This is a sample person. Removing the app\'s sample data removes them.', 'CONFLICT', { reason: 'SAMPLE_PERSON' });
    }
  }

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
      const locked = await giving.accountsAbove(request, byUser);
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;
      return {
        users: page.map((user) => ({ ...toDto(user, byUser.get(user.id) ?? []), signInLocked: locked.has(user.id) })),
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
      for (const role of granted) await giving.assertMayHandle(request, role);

      const now = app.rbac.now();
      // NULL passwordHash + status 'invited': there is no credential to set
      // until the invitee sets one, and login refuses both.
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
      const emailSent = await deliverInvite(request, user, invite);
      // The token is never logged and never returned again — a lost link is
      // re-minted by POST /users/:id/invite/resend.
      return reply
        .status(201)
        .send({ user: toDto(user, granted.map(roleRef)), invite, emailSent });
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
      await assertMayActOnAccount(request, user);
      assertNotSample(user);
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
          await giving.assertHoldsAccount(request, user.id, await roles.rolesForUser(user.id));
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
      // active user who cannot log in (login requires a hash).
      if (status === 'active' && user.passwordHash === null) {
        throw new ConflictError(
          'This account has never set a password — resend the invite instead.',
          'CONFLICT',
          { userId: user.id, status: user.status },
        );
      }

      const now = app.rbac.now();
      // One write: an address and the links that went to the one before it.
      await meta.db.transaction().execute(async (trx) => {
        const inTransaction = { ...meta, db: trx };
        if (Object.keys(patch).length > 0) await usersRepo(inTransaction).updateProfile(user.id, patch, now);
        if (patch.email !== undefined) {
          await emailChangesRepo(inTransaction).clear(user.id);
          await passwordResetsRepo(inTransaction).retireFor([user.id], now);
        }
      });
      // A suspended user must stop being logged in immediately, on what is already open and with their API keys too.
      if (status === 'suspended') await stopAccount(request, user, 'suspend', now);
      else if (status !== null) {
        await users.updateStatus(user.id, status, now);
        // A sign-in that raced the stop wrote its session after the stop's sweep: it stays dead when the account comes back.
        if (status === 'active') await sessionsRepo(meta).revokeAllForUser(user.id, now);
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
      await assertMayActOnAccount(request, user);
      assertNotSample(user);
      assertNotSelf(request, user, permanent ? 'delete' : 'suspend');
      await assertNotLastSuperAdmin(user);
      // Their rows go to whoever the caller names, now that every guard on the account has passed and before it changes:
      // a hand-over the server then refused the removal for would be rows moved for nothing, and it cannot be undone.
      const decorated = app as unknown as {
        rowsNamingUser?: (userId: string) => Promise<{ total: number; named: unknown[]; private: boolean }>;
        handUserRows?: (from: User, toId: string, audit: (entry: { action: string; changes: { before: Record<string, unknown>; after: Record<string, unknown> } }) => Promise<void>, by: { principal: RbacPrincipal | null; refused: () => Promise<void> }) => Promise<{ failed: unknown[] }>;
      };
      // Asked now: once their rows are handed on, nothing says which connections were theirs.
      const leaving = app as unknown as { connectionsLeavingWith?: (person: { id: string; email: string }) => Promise<() => Promise<void>> };
      const endConnections = permanent || request.query.handTo !== undefined ? await leaving.connectionsLeavingWith?.(user).catch(() => undefined) : undefined;
      if (request.query.handTo !== undefined) {
        if (decorated.handUserRows === undefined) throw new ConflictError('This server cannot hand rows over.', 'CONFLICT', { reason: 'HAND_OVER_UNAVAILABLE' });
        await decorated.handUserRows(user, request.query.handTo, (entry) => app.rbac.audit(request, { category: 'rbac', ...entry }), {
          principal: getPrincipal(request),
          refused: () => app.rbac.audit(request, { category: 'rbac', action: 'permission.denied', changes: { after: { reason: REACH_ABOVE_YOU, method: request.method, url: scrubUrlForLog(request.url), userId: user.id } } }),
        });
      }
      // Gone for good, the rows that are still theirs would be nobody's that a colleague limited to "their own" could
      // reach. A private table's rows stay where they are, and are said only to be there.
      if (permanent) {
        const held = decorated.rowsNamingUser === undefined ? null : await decorated.rowsNamingUser(user.id);
        if (held !== null && held.total > 0) {
          throw new ConflictError('Rows are still this person\'s. Hand them to somebody else as you remove them.', 'CONFLICT', { reason: 'HAS_ROWS', rows: held.total, named: held.named, private: held.private });
        }
      }

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
        await stopAccount(request, user, 'delete', now);
        await endConnections?.().catch((error: unknown) => request.log.warn({ err: error }, 'a removed person\'s calendar connections could not be queued to end'));
        await app.rbac.audit(request, {
          category: 'rbac',
          action: 'user.delete',
          changes: { before },
        });
        return { ok: true as const, permanent: true, user: null };
      }

      await stopAccount(request, user, 'suspend', now);
      await endConnections?.().catch((error: unknown) => request.log.warn({ err: error }, 'a stopped person\'s calendar connections could not be queued to end'));
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
      await assertMayActOnAccount(request, user);
      assertNotSample(user);
      const after = await resolveRoles(request.body.roleIds);
      const before = await roles.rolesForUser(user.id);
      // What this changes, in either direction: a role somebody keeps is not handed out again.
      const moved = [...after.filter((role) => !before.some((held) => held.id === role.id)), ...before.filter((role) => !after.some((kept) => kept.id === role.id))];
      for (const role of moved) await giving.assertMayHandle(request, role);
      await assertKeepsLastSuperAdmin(user, before, after);

      const now = app.rbac.now();
      const keep = new Set(after.map((role) => role.id));
      for (const role of before) {
        if (!keep.has(role.id)) await roles.removeFromUser(user.id, role.id);
      }
      for (const role of after) {
        await roles.assignToUser(user.id, role.id, actingUserId(request), now);
      }
      // An invitation opens the account as it now stands: one given more is invited again.
      if (user.status === 'invited' && after.some((role) => !before.some((held) => held.id === role.id))) {
        await passwordResetsRepo(meta).retireFor([user.id], now, 'invite');
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
      await assertMayActOnAccount(request, user);
      assertNotSample(user);
      await giving.assertHoldsAccount(request, user.id, await roles.rolesForUser(user.id));
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
      return { user: await dtoFor(user), invite, emailSent: await deliverInvite(request, user, invite) };
    },
  );
};
