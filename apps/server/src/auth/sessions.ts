/**
 * Session mechanics (08-server-api.md §2.1, 07-meta-store.md §3.5).
 *
 * Opaque tokens: `adms_` + 32 random bytes base64url; only the SHA-256 hex of
 * the full token string is stored in `adminium_sessions`. The cookie
 * `adminium_session` is httpOnly, SameSite=Lax, signed, path `/`, and Secure
 * whenever the request arrived over https. Expiry is sliding: 7 days idle
 * (from `last_seen_at`) and an absolute lifetime the workspace sets
 * (`auth.sessionTtlHours`, default 720 h = 30 days) counted from `created_at`
 * and persisted as `expires_at`. 2FA login challenges reuse the same table
 * with an `admc_` token prefix and a 5-minute TTL — the prefix guarantees a
 * challenge token can never authenticate as a session.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessionsRepo, settingsRepo, type MetaDb, type Session } from '@adminium/meta';

export const SESSION_COOKIE = 'adminium_session';

export const SESSION_TOKEN_PREFIX = 'adms_';
export const CHALLENGE_TOKEN_PREFIX = 'admc_';
export const RESET_TOKEN_PREFIX = 'admr_';

/** Sliding-expiry defaults (08-server-api.md §2.1). */
export const SESSION_IDLE_TTL_MS = 7 * 86_400_000; // 7 days idle
/** Absolute-lifetime fallback when `auth.sessionTtlHours` cannot be read. */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 86_400_000; // 30 days absolute
/** 2FA login challenge: 5 minutes, single-use (§2.1). */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** Password-reset tokens: single-use, 30-minute TTL (§7 item 7). */
export const RESET_TOKEN_TTL_MS = 30 * 60_000;

/** `<prefix>` + 32 random bytes base64url (43 chars of payload). */
export function mintToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

/** SHA-256 hex of the full token string — the only form stored at rest. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface RequestMeta {
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export interface MintedSession {
  token: string;
  session: Session;
}

const HOUR_MS = 3_600_000;

/**
 * The workspace's absolute session lifetime (`auth.sessionTtlHours`,
 * 07-meta-store.md §7.1), read per mint rather than cached: an admin who
 * shortens the policy expects the very next sign-in to obey it, and sessions
 * are minted rarely enough that one indexed read costs nothing. Unset ⇒ the
 * registry default (720 h), which is {@link SESSION_ABSOLUTE_TTL_MS}.
 */
export async function sessionAbsoluteTtlMs(meta: MetaDb): Promise<number> {
  return (await settingsRepo(meta).get('auth.sessionTtlHours')) * HOUR_MS;
}

/**
 * Creates a full session row and returns the plaintext token exactly once.
 * `absoluteDeadline` caps `expires_at` below the workspace's horizon so
 * rotation never extends the original absolute lifetime.
 */
export async function createSession(
  meta: MetaDb,
  userId: string,
  reqMeta: RequestMeta = {},
  at: number = Date.now(),
  absoluteDeadline?: number,
): Promise<MintedSession> {
  const token = mintToken(SESSION_TOKEN_PREFIX);
  const expiresAt = Math.min(
    at + (await sessionAbsoluteTtlMs(meta)),
    absoluteDeadline ?? Number.MAX_SAFE_INTEGER,
  );
  const session = await sessionsRepo(meta).create(
    {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: reqMeta.ip ?? null,
      userAgent: reqMeta.userAgent ?? null,
    },
    at,
  );
  return { token, session };
}

export type SessionResolution =
  | { state: 'none' }
  | { state: 'expired'; session: Session }
  | { state: 'active'; session: Session };

/**
 * Resolves a cookie token to a session, distinguishing "no such session"
 * (`none` → UNAUTHENTICATED) from "existed but timed out" (`expired` →
 * SESSION_EXPIRED). Revoked sessions resolve to `none` — sign-out is not the
 * expired-session UX. Idle timeout: `last_seen_at + 7d`; absolute: `expires_at`.
 */
export async function resolveSessionByToken(
  meta: MetaDb,
  token: string,
  at: number = Date.now(),
): Promise<SessionResolution> {
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) return { state: 'none' };
  const session = await meta.db
    .selectFrom('adminium_sessions')
    .selectAll()
    .where('tokenHash', '=', hashToken(token))
    .executeTakeFirst();
  if (session === undefined || session.revokedAt !== null) return { state: 'none' };
  if (at >= session.expiresAt || at >= session.lastSeenAt + SESSION_IDLE_TTL_MS) {
    return { state: 'expired', session };
  }
  return { state: 'active', session };
}

/**
 * Privilege-boundary rotation hook (§7 item 7): revokes the old row and mints
 * a fresh token for the same user, keeping the original absolute deadline.
 * Call on login step-ups, role changes, and password changes that keep the
 * current session alive.
 */
export async function rotateSession(
  meta: MetaDb,
  session: Session,
  reqMeta: RequestMeta = {},
  at: number = Date.now(),
): Promise<MintedSession> {
  await sessionsRepo(meta).revoke(session.id, at);
  return createSession(meta, session.userId, reqMeta, at, session.expiresAt);
}

/** Mints a 5-minute single-use 2FA challenge row (`admc_` prefix). */
export async function createChallenge(
  meta: MetaDb,
  userId: string,
  reqMeta: RequestMeta = {},
  at: number = Date.now(),
): Promise<MintedSession> {
  const token = mintToken(CHALLENGE_TOKEN_PREFIX);
  const session = await sessionsRepo(meta).create(
    {
      userId,
      tokenHash: hashToken(token),
      expiresAt: at + CHALLENGE_TTL_MS,
      ip: reqMeta.ip ?? null,
      userAgent: reqMeta.userAgent ?? null,
    },
    at,
  );
  return { token, session };
}

/**
 * True for the 2FA-challenge rows that share `adminium_sessions`, which would
 * otherwise show up in a user's device list for their five-minute life.
 *
 * The test is exact, not a threshold: {@link createChallenge} is the only
 * writer whose window is precisely {@link CHALLENGE_TTL_MS}, while a real
 * session's is `auth.sessionTtlHours` (registry floor 1 h) or — when rotation
 * caps it at an older deadline — an arbitrary millisecond value that would
 * have to land on exactly five minutes to collide.
 */
export function isChallengeSession(session: Session): boolean {
  return session.expiresAt - session.createdAt === CHALLENGE_TTL_MS;
}

/**
 * Atomically consumes a challenge token: the first caller revokes the row and
 * wins; replays, expired, or non-challenge tokens return `null`.
 */
export async function consumeChallenge(
  meta: MetaDb,
  token: string,
  at: number = Date.now(),
): Promise<Session | null> {
  if (!token.startsWith(CHALLENGE_TOKEN_PREFIX)) return null;
  const row = await sessionsRepo(meta).findValidByTokenHash(hashToken(token), at);
  if (row === null) return null;
  const consumed = await sessionsRepo(meta).revoke(row.id, at);
  return consumed ? row : null;
}

/** True when the request arrived over TLS (directly or via trusted proxy). */
export function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

/**
 * Cookie contract (§2.1): httpOnly, SameSite=Lax, signed, path /.
 *
 * `maxAge` stays the 30-day ceiling even when `auth.sessionTtlHours` is
 * shorter: the row's `expires_at` is the authority, and a cookie that outlives
 * it resolves to `expired` — "your session has expired" — instead of silently
 * vanishing into "you were never signed in".
 */
export function sessionCookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    secure,
    maxAge: Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000),
  } as const;
}

export function setSessionCookie(reply: FastifyReply, token: string, request: FastifyRequest): void {
  void reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(isSecureRequest(request)));
}

export function clearSessionCookie(reply: FastifyReply, request: FastifyRequest): void {
  const { path, httpOnly, sameSite, signed, secure } = sessionCookieOptions(isSecureRequest(request));
  void reply.clearCookie(SESSION_COOKIE, { path, httpOnly, sameSite, signed, secure });
}

/** Reads and unsigns the session cookie; `null` on absent/tampered values. */
export function readSessionCookie(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (raw === undefined) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value !== null ? unsigned.value : null;
}
