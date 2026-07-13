/**
 * Auth flow helpers against `/api/v1/auth/*` (apps/server/src/routes/auth).
 * The ui auth screens are controlled compositions — these functions own the
 * requests; pages own error/loading state.
 */
import { api } from '../app/api.js';
import type { SessionUser } from '../app/bootstrap.js';

export type LoginResult =
  | { kind: 'session'; user: SessionUser }
  | { kind: 'challenge'; challengeToken: string };

interface LoginReplyData {
  user?: SessionUser;
  twoFactorRequired?: true;
  challengeToken?: string;
}

/** POST /auth/login → 200 session or 202 2FA challenge (§2.1 step-up). */
export async function login(email: string, password: string): Promise<LoginResult> {
  const { data } = await api.post<{ data: LoginReplyData }>('/api/v1/auth/login', { email, password });
  if (data.twoFactorRequired === true && typeof data.challengeToken === 'string') {
    return { kind: 'challenge', challengeToken: data.challengeToken };
  }
  return { kind: 'session', user: data.user as SessionUser };
}

export async function verify2fa(challengeToken: string, code: string): Promise<SessionUser> {
  const { data } = await api.post<{ data: { user: SessionUser } }>('/api/v1/auth/2fa/verify', {
    challengeToken,
    code,
  });
  return data.user;
}

export async function logout(): Promise<void> {
  await api.post('/api/v1/auth/logout');
}

export async function forgotPassword(email: string): Promise<void> {
  await api.post('/api/v1/auth/password/forgot', { email });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post('/api/v1/auth/password/reset', { token, newPassword });
}

/**
 * The 202 challenge token survives an /otp reload via sessionStorage (it is
 * single-use and expires server-side in 5 minutes — low-sensitivity).
 */
const CHALLENGE_KEY = 'adminium-2fa-challenge';

export function storeChallenge(challengeToken: string, returnTo: string | undefined): void {
  try {
    sessionStorage.setItem(CHALLENGE_KEY, JSON.stringify({ challengeToken, returnTo: returnTo ?? null }));
  } catch {
    // Private mode: /otp will bounce back to /login.
  }
}

export function readChallenge(): { challengeToken: string; returnTo: string | null } | null {
  try {
    const raw = sessionStorage.getItem(CHALLENGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { challengeToken?: unknown; returnTo?: unknown };
    if (typeof parsed.challengeToken !== 'string') return null;
    return {
      challengeToken: parsed.challengeToken,
      returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : null,
    };
  } catch {
    return null;
  }
}

export function clearChallenge(): void {
  try {
    sessionStorage.removeItem(CHALLENGE_KEY);
  } catch {
    // ignore
  }
}
