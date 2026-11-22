// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `me` handlers: profile view/patch and per-user preference axes with the
 * server-side resolution. Prefs writes go through `userPrefsRepo`; `null`
 * clears an axis back to "inherit".
 *
 * A NEW SIGN-IN ADDRESS IS PROVED, NOT TYPED. The current password starts the
 * change and a link goes to the new address; the account keeps its old address
 * until that link is opened BY THE SAME ACCOUNT. Without the first half anyone
 * signed in could claim an unused address, and whatever is matched by address
 * would then be theirs. Without the second, somebody who merely received the
 * mail could hand their own address to a stranger's account by clicking it.
 * An address waiting here reserves nothing: whoever confirms first holds it.
 */
import type { FastifyRequest } from 'fastify';
import {
  emailChangesRepo,
  settingsRepo,
  userPrefsRepo,
  usersRepo,
  type UserPrefs,
  type UserPrefsPatch,
  type User,
} from '@adminium/meta';

import { AppError, ConflictError, NotFoundError, RateLimitedError, UnauthorizedError } from '../../errors.js';
import { isUniqueViolation } from '../../crud/decided-columns.js';
import { EMAIL_CHANGE_CONFIRM_TEMPLATE_KEY, enqueueEmail } from '../../email/send.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { linkOrigin } from '../../security/public-origin.js';
import { visibleWorkspaceIds } from '../../workspaces/visibility.js';
import { auditAuth } from '../../auth/audit.js';
import { verifyPassword } from '../../auth/passwords.js';
import { hashToken, mintToken } from '../../auth/sessions.js';
import type { AuthContext } from '../../plugins/auth.js';
import { toUserView } from '../auth/handlers.js';
import type { MeEmailConfirmBody, MePatchBody, MePatchReply, MePrefsPatchBody, MePrefsReply, MeReply } from './schema.js';

const EMAIL_CHANGE_TOKEN_PREFIX = 'adme_';
/** A day: the person may need to reach another mailbox, and the link is useless without their session. */
const EMAIL_CHANGE_TTL_MS = 24 * 3_600_000;

function principal(request: FastifyRequest): User {
  if (request.user === null) throw new UnauthorizedError('UNAUTHENTICATED');
  return request.user;
}

export async function getMeHandler(_ctx: AuthContext, request: FastifyRequest): Promise<MeReply> {
  return { data: { user: toUserView(principal(request)) } };
}

export async function patchMeHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: MePatchBody,
): Promise<MePatchReply> {
  const now = Date.now();
  const user = principal(request);
  const users = usersRepo(ctx.meta);

  const patch: { name?: string } = {};
  let emailChange: { pendingEmail: string; expiresAt: number } | undefined;
  if (body.name !== undefined && body.name !== user.name) patch.name = body.name;

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (email !== user.email) {
      // Email is a credential — re-authenticate before changing it.
      const passwordOk =
        body.password !== undefined &&
        user.passwordHash !== null &&
        (await verifyPassword(user.passwordHash, body.password));
      if (!passwordOk) {
        throw new UnauthorizedError('UNAUTHENTICATED', 'Password verification failed.');
      }
      const taken = await users.findByEmail(email);
      if (taken !== null && taken.id !== user.id) {
        throw new ConflictError('That email is already in use.', 'UNIQUE_VIOLATION');
      }
      // Before the name is saved: a change refused here saves nothing of the request.
      emailChange = await askEmailChange(ctx, request, user, email, now);
    }
  }

  if (Object.keys(patch).length > 0) {
    await ctx.meta.db
      .updateTable('adminium_users')
      .set({ ...patch, updatedAt: now })
      .where('id', '=', user.id)
      .execute();
    await auditAuth(ctx.meta, request, {
      action: 'me_updated',
      actorId: user.id,
      actorLabel: user.name,
      changes: {
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, user[k as 'name']])),
        after: { ...patch },
      },
    });
  }

  const fresh = (await users.findById(user.id)) ?? user;
  return { data: { user: toUserView(fresh), ...(emailChange === undefined ? {} : { emailChange }) } };
}

/** Records the waiting change and mails its link to the new address. Nothing is left waiting if no mail can go. */
async function askEmailChange(
  ctx: AuthContext,
  request: FastifyRequest,
  user: User,
  email: string,
  now: number,
): Promise<{ pendingEmail: string; expiresAt: number }> {
  const changes = emailChangesRepo(ctx.meta);
  const token = mintToken(EMAIL_CHANGE_TOKEN_PREFIX);
  const tokenHash = hashToken(token);
  const expiresAt = now + EMAIL_CHANGE_TTL_MS;
  const asked = await changes.ask({ userId: user.id, newEmail: email, tokenHash, expiresAt }, now);
  if (asked === null) throw new RateLimitedError('Too many address changes were asked for. Try again in an hour.');

  ctx.deliverEmailChangeToken?.({ userId: user.id, email, token, expiresAt });
  let queued = false;
  try {
    const job = await enqueueEmail(
      { meta: ctx.meta, secret: ctx.env.ADMINIUM_SECRET, logger: request.log },
      {
        to: email,
        templateKey: EMAIL_CHANGE_CONFIRM_TEMPLATE_KEY,
        account: true,
        locale: await recipientLocale(ctx.meta, user.id),
        vars: {
          appName: await settingsRepo(ctx.meta).get('branding.appName'),
          name: user.name,
          email,
          currentEmail: user.email,
          // The configured public origin, never this request's `Origin` (security/public-origin.ts).
          confirmUrl: `${await linkOrigin(ctx.meta, request)}/account/confirm-email/${token}`,
        },
        counts: { expiresInHours: Math.round(EMAIL_CHANGE_TTL_MS / 3_600_000) },
      },
    );
    queued = job !== null;
  } catch (error) {
    request.log.warn({ err: error }, 'could not queue the address-confirmation email');
  }
  if (!queued && ctx.deliverEmailChangeToken === undefined) {
    await changes.drop(user.id, tokenHash);
    throw new ConflictError(
      'This server cannot send email, so your address cannot be confirmed. Ask an administrator to change it from the Team page.',
      'CONFLICT',
      { reason: 'EMAIL_NOT_CONFIGURED' },
    );
  }
  await auditAuth(ctx.meta, request, {
    action: 'email_change_requested',
    actorId: user.id,
    actorLabel: user.name,
    changes: { before: { email: user.email }, after: { pendingEmail: email } },
  });
  return { pendingEmail: email, expiresAt };
}

/**
 * Opens the mailed link. Another account's token answers exactly as a dead one
 * does and is not spent. One transaction: the link goes, the address moves, and
 * any password-reset link already mailed to the old address stops working, or
 * the old mailbox could still take the account back.
 */
export async function confirmEmailChangeHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: MeEmailConfirmBody,
): Promise<MeReply> {
  const now = Date.now();
  const user = principal(request);
  const tokenHash = hashToken(body.token);
  const dead = () => new AppError(410, 'CONFLICT', 'This link is no longer valid.');
  const pending = await emailChangesRepo(ctx.meta).findValid(tokenHash, now);
  if (pending === null || pending.userId !== user.id) throw dead();
  const taken = () => new ConflictError('That email is already in use.', 'UNIQUE_VIOLATION');
  try {
    await ctx.meta.db.transaction().execute(async (trx) => {
      const spent = await trx.deleteFrom('adminium_email_changes').where('userId', '=', user.id).where('tokenHash', '=', tokenHash).executeTakeFirst();
      if (Number(spent.numDeletedRows) !== 1) throw dead();
      const holder = await trx.selectFrom('adminium_users').select('id').where('email', '=', pending.newEmail).executeTakeFirst();
      if (holder !== undefined && holder.id !== user.id) throw taken();
      await trx.updateTable('adminium_users').set({ email: pending.newEmail, updatedAt: now }).where('id', '=', user.id).execute();
      await trx.updateTable('adminium_password_resets').set({ usedAt: now }).where('userId', '=', user.id).where('usedAt', 'is', null).execute();
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw taken();
    throw error;
  }
  await auditAuth(ctx.meta, request, {
    action: 'me_updated',
    actorId: user.id,
    actorLabel: user.name,
    changes: { before: { email: user.email }, after: { email: pending.newEmail } },
  });
  const fresh = (await usersRepo(ctx.meta).findById(user.id)) ?? user;
  return { data: { user: toUserView(fresh) } };
}

function prefsView(prefs: UserPrefs | null) {
  return {
    theme: prefs?.theme ?? null,
    accent: prefs?.accent ?? null,
    density: prefs?.density ?? null,
    locale: prefs?.locale ?? null,
    dir: prefs?.dir ?? null,
    workspaceId: prefs?.workspaceId ?? null,
  };
}

export async function getMePrefsHandler(
  ctx: AuthContext,
  request: FastifyRequest,
): Promise<MePrefsReply> {
  const user = principal(request);
  const repo = userPrefsRepo(ctx.meta);
  const [prefs, resolved] = await Promise.all([repo.get(user.id), repo.resolve(user.id)]);
  return { data: { prefs: prefsView(prefs), resolved } };
}

/**
 * A workspace the person may choose: one that exists and that they can see
 * (the same rule the menu shows by). Anything else is refused, never stored.
 */
async function chosenWorkspace(ctx: AuthContext, request: FastifyRequest, workspaceId: string | null): Promise<string | null> {
  if (workspaceId === null) return null;
  const visible = await visibleWorkspaceIds(ctx.meta, request);
  if (!visible.has(workspaceId)) throw new NotFoundError('There is no such workspace.', { workspaceId });
  return workspaceId;
}

export async function patchMePrefsHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: MePrefsPatchBody,
): Promise<MePrefsReply> {
  const now = Date.now();
  const user = principal(request);
  const repo = userPrefsRepo(ctx.meta);

  // Absent = unchanged; explicit `null` = clear back to inherit.
  const patch: UserPrefsPatch = {
    ...(body.theme !== undefined ? { theme: body.theme } : {}),
    ...(body.accent !== undefined ? { accent: body.accent } : {}),
    ...(body.density !== undefined ? { density: body.density } : {}),
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.dir !== undefined ? { dir: body.dir } : {}),
    ...(body.workspaceId !== undefined ? { workspaceId: await chosenWorkspace(ctx, request, body.workspaceId) } : {}),
  };
  const prefs = await repo.set(user.id, patch, now);
  const resolved = await repo.resolve(user.id);
  return { data: { prefs: prefsView(prefs), resolved } };
}
