/**
 * API-key secret handling (08-server-api.md §2.16): `adm_sk_` + 40 base62
 * chars, shown exactly once at create time; only the SHA-256 hex hash and a
 * short display/lookup prefix are stored (07-meta-store.md §3.7).
 */

import { createHash, randomInt } from 'node:crypto';

export const API_KEY_PREFIX = 'adm_sk_';

/** Secret length after the prefix. */
export const API_KEY_SECRET_LENGTH = 40;

/** Stored display fragment: `adm_sk_` + first 8 secret chars (fits str(16)). */
export const API_KEY_DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

/** `last_used_at` write throttle (07 §3.7 "throttled"). */
export const API_KEY_TOUCH_INTERVAL_MS = 60_000;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** SHA-256 hex of the full key string — the stored `token_hash`. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export interface GeneratedApiKey {
  /** The full secret — returned to the caller once, never stored. */
  key: string;
  /** Display/lookup fragment persisted in the `prefix` column. */
  prefix: string;
  /** SHA-256 hex persisted in the `token_hash` column. */
  tokenHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  let secret = '';
  for (let i = 0; i < API_KEY_SECRET_LENGTH; i += 1) {
    secret += BASE62[randomInt(BASE62.length)];
  }
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, prefix: key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH), tokenHash: hashApiKey(key) };
}

/**
 * Extract an Adminium API key from an `Authorization` header. Returns `null`
 * unless the scheme is Bearer *and* the token carries the `adm_sk_` prefix —
 * other bearer tokens fall through to the session/auth plugin untouched.
 */
export function parseBearerApiKey(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (match === null) return null;
  const token = match[1] as string;
  return token.startsWith(API_KEY_PREFIX) ? token : null;
}
