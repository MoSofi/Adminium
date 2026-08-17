/**
 * Account-security data layer: password change, the active-session list, and
 * the 2FA enrolment calls that have existed in `routes/auth` since M2 with no
 * screen behind them (`/auth/2fa/enroll`, `/activate`, `/disable`).
 *
 * TWO ONE-TIME SECRETS LIVE HERE, and neither may be cached. `2fa/enroll`
 * returns the TOTP `secret` once (it is encrypted at rest and never re-read)
 * and `2fa/activate` returns ten recovery codes once (stored hashed). Both are
 * lifted into component state by `SecurityPage` and never become mutation
 * data — the same rule, and the same reasoning, as the plaintext key in
 * `api-keys/apiKeysApi.ts`.
 *
 * SYNC NOTE: the reply shapes mirror `apps/server/src/routes/auth/schema.ts`.
 * Everything under `/auth` uses the §1.4 `{ data: … }` envelope (unlike
 * `/api-keys` and `/audit`, which return bare objects), so these unwrap `.data`
 * exactly where the auth schemas wrap it.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';
import { formatSince, formatStamp } from '../team/teamApi.js';

export { formatSince, formatStamp };

export interface SessionDto {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  ip: string | null;
  userAgent: string | null;
  /** The session this browser tab is signed in with — never offer "revoke". */
  current: boolean;
}

export const SESSIONS_QUERY_KEY = ['auth', 'sessions'] as const;

export function sessionsQuery() {
  return queryOptions({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: async () =>
      (await api.get<{ data: { sessions: SessionDto[] } }>('/api/v1/auth/sessions')).data.sessions,
  });
}

export function revokeSession(id: string): Promise<unknown> {
  return api.delete<unknown>(`/api/v1/auth/sessions/${id}`);
}

export interface PasswordChangeBody {
  currentPassword: string;
  newPassword: string;
}

export function changePassword(body: PasswordChangeBody): Promise<unknown> {
  return api.post<unknown>('/api/v1/auth/password/change', body);
}

/** `{ secret, otpauthUrl }` — shown once, then unrecoverable. */
export interface TotpEnrollment {
  secret: string;
  otpauthUrl: string;
}

export async function enroll2fa(): Promise<TotpEnrollment> {
  return (await api.post<{ data: TotpEnrollment }>('/api/v1/auth/2fa/enroll')).data;
}

/** Ten single-use recovery codes — returned exactly once, stored hashed. */
export async function activate2fa(code: string): Promise<string[]> {
  return (await api.post<{ data: { recoveryCodes: string[] } }>('/api/v1/auth/2fa/activate', { code }))
    .data.recoveryCodes;
}

export function disable2fa(body: { password: string; code?: string }): Promise<unknown> {
  return api.post<unknown>('/api/v1/auth/2fa/disable', body);
}

// --- derived state (pure — unit-tested without a DOM) ------------------------

/**
 * This browser first, then most-recently-seen.
 *
 * The current session leads because it is the one row the user can identify
 * with certainty, and a list of near-identical user-agent strings is only
 * readable once you know which one is you. It is also the row that must never
 * be revoked by accident, so it is the row that gets the top of the list and
 * no revoke control.
 */
export function sortSessions(sessions: readonly SessionDto[]): SessionDto[] {
  return [...sessions].sort((a, b) => {
    const currentDelta = Number(b.current) - Number(a.current);
    return currentDelta !== 0 ? currentDelta : b.lastSeenAt - a.lastSeenAt;
  });
}

const BROWSERS: readonly [string, RegExp][] = [
  // Order matters: every Chromium UA also says "Safari", and Edge says both.
  ['Edge', /\bEdg[e/]/],
  ['Opera', /\bOPR\//],
  ['Firefox', /\bFirefox\//],
  ['Chrome', /\bChrome\//],
  ['Safari', /\bSafari\//],
];

const PLATFORMS: readonly [string, RegExp][] = [
  ['iOS', /\b(iPhone|iPad|iPod)\b/],
  ['Android', /\bAndroid\b/],
  ['macOS', /\bMac OS X\b/],
  ['Windows', /\bWindows\b/],
  ['Linux', /\bLinux\b/],
];

/**
 * A coarse "Chrome · macOS" from a user-agent string, or `null`.
 *
 * DELIBERATELY COARSE, and `null` rather than a guess when nothing matches: a
 * session list is something a user reads to decide whether to revoke, and a
 * confidently wrong device name ("Safari · Windows" for a curl) is how someone
 * kills their own session or leaves an attacker's alone. The raw UA is still
 * shown alongside — this only saves the reader from parsing it first.
 */
export function deviceLabel(userAgent: string | null): string | null {
  if (userAgent === null || userAgent.trim() === '') return null;
  const browser = BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0];
  const platform = PLATFORMS.find(([, pattern]) => pattern.test(userAgent))?.[0];
  if (browser === undefined && platform === undefined) return null;
  if (browser === undefined) return platform ?? null;
  if (platform === undefined) return browser;
  return `${browser} · ${platform}`;
}
