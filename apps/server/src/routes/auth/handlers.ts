/**
 * Auth handlers (08-server-api.md §2.1): login (with 2FA step-up), 2FA
 * verify/enroll/activate/disable, logout, current session, own-session list
 * and revoke, password forgot/reset/change. Every mutation writes an `auth`
 * audit entry; login failures are uniform INVALID_CREDENTIALS regardless of
 * which check failed.
 *
 * The workspace's `auth.*` policy (07-meta-store.md §7.1) is read here rather
 * than assumed: `auth.passwordMinLength` gates every password write, and
 * `auth.require2fa` both flags accounts that have no TOTP and refuses to let
 * one turn TOTP off. (`auth.sessionTtlHours` is applied by createSession.)
 */
import { randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  passwordResetsRepo,
  rolesRepo,
  sessionsRepo,
  settingsRepo,
  usersRepo,
  writeBool,
  type MetaDb,
  type User,
} from '@adminium/meta';

import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationFailedError,
} from '../../errors.js';
import { auditAuth } from '../../auth/audit.js';
import { hashPassword, needsRehash, verifyPassword } from '../../auth/passwords.js';
import {
  RESET_TOKEN_PREFIX,
  RESET_TOKEN_TTL_MS,
  SESSION_IDLE_TTL_MS,
  clearSessionCookie,
  consumeChallenge,
  createChallenge,
  createSession,
  hashToken,
  isChallengeSession,
  mintToken,
  setSessionCookie,
} from '../../auth/sessions.js';
import {
  consumeRecoveryCode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpEnrollment,
  hashRecoveryCodes,
  verifyTotpCode,
} from '../../auth/totp.js';
import type { AuthContext } from '../../plugins/auth.js';
import type {
  Auth2faActivateBody,
  Auth2faActivateReply,
  Auth2faDisableBody,
  Auth2faEnrollReply,
  Auth2faVerifyBody,
  AuthForgotBody,
  AuthLoginBody,
  AuthLoginChallengeReply,
  AuthLoginReply,
  AuthPasswordChangeBody,
  AuthResetBody,
  AuthSessionListReply,
  AuthSessionReply,
  AuthSessionRevokeParams,
  AuthUserView,
  OkReply,
} from './schema.js';

/** Uniform credential failure — no user enumeration (§2.1). */
function invalidCredentials(message = 'Invalid email or password.'): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', message);
}

/**
 * The workspace password policy (`auth.passwordMinLength`, §7.1) applied to a
 * password the caller is choosing. Every write path runs this — the setup
 * wizard has its own copy in setup/service.ts, so an invited user finishing a
 * reset can no longer land under the floor an admin set.
 *
 * 422 in the setup route's shape, so one client-side renderer covers both.
 */
async function assertPasswordPolicy(meta: MetaDb, password: string, field: string): Promise<void> {
  const minLength = await settingsRepo(meta).get('auth.passwordMinLength');
  if (password.length >= minLength) return;
  const message = `Password must be at least ${String(minLength)} characters.`;
  throw new ValidationFailedError(message, {
    in: 'body',
    issues: [{ path: field, message, code: 'too_small' }],
  });
}

/**
 * `auth.require2fa` is on and this account has no TOTP yet.
 *
 * Deliberately NOT a denial: the account keeps its session, which is exactly
 * what the existing enroll flow needs (`POST /auth/2fa/enroll` →
 * `/auth/2fa/activate` are both `requireAuth`). Locking the user out at login
 * would leave them no door at all — there is no second channel to enroll
 * through. The flag is what the client uses to route them there instead, and
 * disable2faHandler is what keeps them from walking back out.
 */
async function needsTwoFactorSetup(meta: MetaDb, user: User): Promise<boolean> {
  if (user.totpEnabled) return false;
  return settingsRepo(meta).get('auth.require2fa');
}

/**
 * A valid argon2id hash of a random string, computed once. login always runs a
 * full verify against SOMETHING so the argon2 cost (~tens of ms) is spent on
 * every attempt — a missing/suspended/SSO-only account no longer returns before
 * the KDF and so cannot be distinguished by response latency (user enumeration).
 */
let decoyHashPromise: Promise<string> | undefined;
function decoyPasswordHash(): Promise<string> {
  decoyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return decoyHashPromise;
}

export function toUserView(user: User): AuthUserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    totpEnabled: user.totpEnabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

const OK: OkReply = { data: { ok: true } };

function requestMeta(request: FastifyRequest) {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  };
}

/** The authenticated user/session, guaranteed by the requireAuth preHandler. */
function principal(request: FastifyRequest): { user: User; sessionId: string } {
  if (request.user === null || request.session === null) {
    throw new UnauthorizedError('UNAUTHENTICATED');
  }
  return { user: request.user, sessionId: request.session.id };
}

export async function loginHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  reply: FastifyReply,
  body: AuthLoginBody,
): Promise<AuthLoginReply | AuthLoginChallengeReply> {
  const now = Date.now();
  const users = usersRepo(ctx.meta);
  const user = await users.findByEmail(body.email);
  // Spend the argon2 cost on EVERY path (real hash for an active user, a decoy
  // otherwise) so login latency cannot enumerate accounts. The `&&` chain still
  // decides the outcome; only the timing is equalized.
  const eligible = user !== null && user.status === 'active' && user.passwordHash !== null;
  const candidateHash = eligible ? (user.passwordHash as string) : await decoyPasswordHash();
  const passwordVerified = await verifyPassword(candidateHash, body.password);
  const passwordOk = eligible && passwordVerified;

  if (!passwordOk) {
    await auditAuth(ctx.meta, request, {
      action: 'login_failed',
      actorId: user?.id ?? null,
      actorLabel: user?.name ?? body.email.trim().toLowerCase(),
    });
    throw invalidCredentials();
  }
  // `user` is non-null with a non-null hash beyond this point.
  const activeUser = user;

  // Transparent parameter upgrades on successful verify (§7 item 7).
  if (activeUser.passwordHash !== null && needsRehash(activeUser.passwordHash)) {
    await users.updatePassword(activeUser.id, await hashPassword(body.password), now);
  }

  if (activeUser.totpEnabled) {
    const challenge = await createChallenge(ctx.meta, activeUser.id, requestMeta(request), now);
    await auditAuth(ctx.meta, request, {
      action: '2fa_challenge',
      actorId: activeUser.id,
      actorLabel: activeUser.name,
    });
    void reply.status(202);
    return { data: { twoFactorRequired: true, challengeToken: challenge.token } };
  }

  const { token } = await createSession(ctx.meta, activeUser.id, requestMeta(request), now);
  await users.recordLogin(activeUser.id, now);
  setSessionCookie(reply, token, request);
  await auditAuth(ctx.meta, request, {
    action: 'login',
    actorId: activeUser.id,
    actorLabel: activeUser.name,
  });
  const fresh = (await users.findById(activeUser.id)) ?? activeUser;
  const setupRequired = await needsTwoFactorSetup(ctx.meta, fresh);
  return {
    data: { user: toUserView(fresh), ...(setupRequired ? { twoFactorSetupRequired: true } : {}) },
  };
}

export async function verify2faHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  reply: FastifyReply,
  body: Auth2faVerifyBody,
): Promise<AuthLoginReply> {
  const now = Date.now();
  const users = usersRepo(ctx.meta);

  const challenge = await consumeChallenge(ctx.meta, body.challengeToken, now);
  if (challenge === null) {
    throw invalidCredentials('Invalid or expired challenge.');
  }

  const user = await users.findById(challenge.userId);
  if (user === null || user.status !== 'active' || !user.totpEnabled) {
    throw invalidCredentials('Invalid or expired challenge.');
  }

  let codeOk = false;
  if (/^\d{6}$/.test(body.code.replaceAll(/[\s-]/g, ''))) {
    if (user.totpSecretEncrypted !== null) {
      codeOk = verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted, ctx.totpKey), body.code, now);
    }
  } else if (user.recoveryCodes !== null) {
    // Recovery path: single-use — the matched hash is removed from the list.
    const remaining = await consumeRecoveryCode(user.recoveryCodes, body.code);
    if (remaining !== null) {
      await users.setRecoveryCodes(user.id, remaining, now);
      codeOk = true;
    }
  }

  if (!codeOk) {
    await auditAuth(ctx.meta, request, {
      action: '2fa_failed',
      actorId: user.id,
      actorLabel: user.name,
    });
    throw invalidCredentials('Invalid authentication code.');
  }

  // Fresh token on successful 2FA verify — fixation defense (§2.1).
  const { token } = await createSession(ctx.meta, user.id, requestMeta(request), now);
  await users.recordLogin(user.id, now);
  setSessionCookie(reply, token, request);
  await auditAuth(ctx.meta, request, { action: 'login', actorId: user.id, actorLabel: user.name });
  const fresh = (await users.findById(user.id)) ?? user;
  return { data: { user: toUserView(fresh) } };
}

export async function logoutHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<OkReply> {
  const { user, sessionId } = principal(request);
  await sessionsRepo(ctx.meta).revoke(sessionId);
  clearSessionCookie(reply, request);
  await auditAuth(ctx.meta, request, { action: 'logout', actorId: user.id, actorLabel: user.name });
  return OK;
}

export async function sessionHandler(
  ctx: AuthContext,
  request: FastifyRequest,
): Promise<AuthSessionReply> {
  const { user } = principal(request);
  const roles = await rolesRepo(ctx.meta).rolesForUser(user.id);
  return {
    data: {
      user: toUserView(user),
      roles: roles.map((role) => role.slug),
      twoFactorSetupRequired: await needsTwoFactorSetup(ctx.meta, user),
    },
  };
}

export async function forgotPasswordHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: AuthForgotBody,
): Promise<OkReply> {
  const now = Date.now();
  const user = await usersRepo(ctx.meta).findByEmail(body.email);
  // Always 200 — the response never reveals whether the account exists (§2.1).
  if (user === null || user.status === 'suspended') return OK;

  const token = mintToken(RESET_TOKEN_PREFIX);
  const expiresAt = now + RESET_TOKEN_TTL_MS;
  await passwordResetsRepo(ctx.meta).create(
    { userId: user.id, kind: 'reset', tokenHash: hashToken(token), expiresAt },
    now,
  );
  ctx.deliverResetToken?.({ userId: user.id, email: user.email, token, expiresAt });
  await auditAuth(ctx.meta, request, {
    action: 'password_reset_requested',
    actorId: user.id,
    actorLabel: user.name,
  });
  return OK;
}

export async function resetPasswordHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: AuthResetBody,
): Promise<OkReply> {
  const now = Date.now();
  const resets = passwordResetsRepo(ctx.meta);
  const users = usersRepo(ctx.meta);

  // Policy BEFORE the token is consumed: a rejected password must not burn the
  // one single-use token an invited user has, or the only way back in is
  // another forgot-password round trip.
  await assertPasswordPolicy(ctx.meta, body.newPassword, 'newPassword');

  const row = await resets.findValidByTokenHash(hashToken(body.token), now);
  // `consume` is the single-use guard: only the first request wins.
  if (row === null || !(await resets.consume(row.id, now))) {
    throw invalidCredentials('Invalid or expired reset token.');
  }

  const user = await users.findById(row.userId);
  if (user === null || user.status === 'suspended') {
    throw invalidCredentials('Invalid or expired reset token.');
  }

  await users.updatePassword(user.id, await hashPassword(body.newPassword), now);
  // Invite-activation path (§2.1): first password set activates the account.
  if (user.status === 'invited') await users.updateStatus(user.id, 'active', now);
  // Credential change revokes every existing session (§7 item 7).
  await sessionsRepo(ctx.meta).revokeAllForUser(user.id, now);
  await auditAuth(ctx.meta, request, {
    action: 'password_reset',
    actorId: user.id,
    actorLabel: user.name,
  });
  return OK;
}

/**
 * `GET /auth/sessions` — the caller's own live sessions, current one flagged.
 *
 * Two filters the repo cannot apply: the sliding idle window (a row inside its
 * absolute deadline but untouched for 7 days is dead to
 * {@link resolveSessionByToken}, so listing it would offer a revoke that
 * changes nothing), and the 2FA challenge rows that share the table.
 */
export async function listSessionsHandler(
  ctx: AuthContext,
  request: FastifyRequest,
): Promise<AuthSessionListReply> {
  const now = Date.now();
  const { user, sessionId } = principal(request);
  const rows = await sessionsRepo(ctx.meta).listForUser(user.id, now);
  return {
    data: {
      sessions: rows
        .filter((row) => !isChallengeSession(row) && now < row.lastSeenAt + SESSION_IDLE_TTL_MS)
        .map((row) => ({
          id: row.id,
          ip: row.ip,
          userAgent: row.userAgent,
          createdAt: row.createdAt,
          lastSeenAt: row.lastSeenAt,
          expiresAt: row.expiresAt,
          current: row.id === sessionId,
        })),
    },
  };
}

/**
 * `DELETE /auth/sessions/:id` — sign a device out.
 *
 * Someone else's session id answers 404, never 403: a 403 would confirm the id
 * exists and belongs to somebody, which is a probe for valid ids. Revoking the
 * current session clears the cookie too, so the caller's own tab does not keep
 * presenting a token the server has already forgotten.
 */
export async function revokeSessionHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  reply: FastifyReply,
  params: AuthSessionRevokeParams,
): Promise<OkReply> {
  const now = Date.now();
  const { user, sessionId } = principal(request);
  const target = await sessionsRepo(ctx.meta).findById(params.id);
  if (target === null || target.userId !== user.id || isChallengeSession(target)) {
    throw new NotFoundError('No such session.');
  }

  const isCurrent = target.id === sessionId;
  await sessionsRepo(ctx.meta).revoke(target.id, now);
  if (isCurrent) clearSessionCookie(reply, request);
  await auditAuth(ctx.meta, request, {
    action: 'session_revoked',
    actorId: user.id,
    actorLabel: user.name,
    changes: { after: { sessionId: target.id, current: isCurrent } },
  });
  return OK;
}

/**
 * `POST /auth/password/change` — the signed-in equivalent of a reset.
 *
 * Knowing the current password is the whole authorization: this acts on the
 * caller's own account, so no RBAC grant applies. The change revokes every
 * session (§7 item 7) and then mints a fresh one for this request, because
 * signing someone out of the tab they just typed their new password into
 * reads as a failure and sends them looking for what broke.
 */
export async function changePasswordHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  reply: FastifyReply,
  body: AuthPasswordChangeBody,
): Promise<OkReply> {
  const now = Date.now();
  const { user } = principal(request);
  if (
    user.passwordHash === null ||
    !(await verifyPassword(user.passwordHash, body.currentPassword))
  ) {
    throw invalidCredentials('Invalid password.');
  }
  await assertPasswordPolicy(ctx.meta, body.newPassword, 'newPassword');

  await usersRepo(ctx.meta).updatePassword(user.id, await hashPassword(body.newPassword), now);
  await sessionsRepo(ctx.meta).revokeAllForUser(user.id, now);
  const { token } = await createSession(ctx.meta, user.id, requestMeta(request), now);
  setSessionCookie(reply, token, request);
  await auditAuth(ctx.meta, request, {
    action: 'password_changed',
    actorId: user.id,
    actorLabel: user.name,
  });
  return OK;
}

export async function enroll2faHandler(
  ctx: AuthContext,
  request: FastifyRequest,
): Promise<Auth2faEnrollReply> {
  const now = Date.now();
  const { user } = principal(request);
  if (user.totpEnabled) {
    throw new ConflictError('Two-factor authentication is already enabled.');
  }

  const enrollment = generateTotpEnrollment(user.email);
  // Secret encrypted at rest; not yet active until /auth/2fa/activate (§2.1).
  await ctx.meta.db
    .updateTable('adminium_users')
    .set({
      totpSecretEncrypted: encryptTotpSecret(enrollment.secret, ctx.totpKey),
      updatedAt: now,
    })
    .where('id', '=', user.id)
    .execute();
  await auditAuth(ctx.meta, request, {
    action: '2fa_enroll_started',
    actorId: user.id,
    actorLabel: user.name,
  });
  return { data: { secret: enrollment.secret, otpauthUrl: enrollment.otpauthUrl } };
}

export async function activate2faHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: Auth2faActivateBody,
): Promise<Auth2faActivateReply> {
  const now = Date.now();
  const { user } = principal(request);
  if (user.totpEnabled) {
    throw new ConflictError('Two-factor authentication is already enabled.');
  }
  if (user.totpSecretEncrypted === null) {
    throw new ConflictError('Enroll first: POST /auth/2fa/enroll.');
  }
  const secret = decryptTotpSecret(user.totpSecretEncrypted, ctx.totpKey);
  if (!verifyTotpCode(secret, body.code, now)) {
    throw invalidCredentials('Invalid authentication code.');
  }

  const recoveryCodes = generateRecoveryCodes();
  await usersRepo(ctx.meta).setRecoveryCodes(user.id, await hashRecoveryCodes(recoveryCodes), now);
  await ctx.meta.db
    .updateTable('adminium_users')
    .set({ totpEnabled: writeBool(ctx.meta, true), updatedAt: now })
    .where('id', '=', user.id)
    .execute();
  await auditAuth(ctx.meta, request, {
    action: '2fa_enrolled',
    actorId: user.id,
    actorLabel: user.name,
  });
  return { data: { recoveryCodes } };
}

export async function disable2faHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: Auth2faDisableBody,
): Promise<OkReply> {
  const now = Date.now();
  const { user } = principal(request);
  // The other half of `auth.require2fa`: a workspace that requires a second
  // factor cannot have accounts opting out of it. Checked before the password
  // verify — the answer does not depend on the credential, and it spares the
  // argon2 cost on a call that was never going to succeed.
  if (await settingsRepo(ctx.meta).get('auth.require2fa')) {
    throw new ForbiddenError('This workspace requires two-factor authentication.');
  }
  if (user.passwordHash === null || !(await verifyPassword(user.passwordHash, body.password))) {
    throw invalidCredentials('Invalid password.');
  }
  if (body.code !== undefined && user.totpSecretEncrypted !== null) {
    const secret = decryptTotpSecret(user.totpSecretEncrypted, ctx.totpKey);
    if (!verifyTotpCode(secret, body.code, now)) {
      throw invalidCredentials('Invalid authentication code.');
    }
  }

  await usersRepo(ctx.meta).setRecoveryCodes(user.id, null, now);
  await ctx.meta.db
    .updateTable('adminium_users')
    .set({
      totpEnabled: writeBool(ctx.meta, false),
      totpSecretEncrypted: null,
      updatedAt: now,
    })
    .where('id', '=', user.id)
    .execute();
  await auditAuth(ctx.meta, request, {
    action: '2fa_disabled',
    actorId: user.id,
    actorLabel: user.name,
  });
  return OK;
}
