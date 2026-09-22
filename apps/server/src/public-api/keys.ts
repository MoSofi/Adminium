// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Publishable keys — mint, verify, rotate.
 *
 * ── THE LOAD-BEARING PROPERTY ────────────────────────────────────── An
 * `adm_pub_` token is NEVER an `RbacPrincipal`. That is not enforced here; it
 * falls out of `parseBearerApiKey` gating on `adm_sk_`, so a publishable token
 * cannot resolve through the rbac plugin at all and `request.can()` is false
 * for it on every route in the server. This module must never widen that: do
 * not teach `rbac/api-keys.ts` about this prefix, and do not store these rows
 * in `adminium_api_keys`. The off switch covers exactly one namespace because
 * of that property, not because of an allow-list somebody maintains.
 *
 * ── WHY THE SECRET IS RE-READABLE ──────────────────────────────────────────
 * `adminium_api_keys` reveals once and never again, which is right for a
 * server-side credential a human pastes into a deployment. This secret lives in
 * a public JS bundle and has to survive a rebuild months later on a machine
 * nobody kept notes on. So the row stores BOTH a SHA-256 hash (what a request
 * is verified against — constant work, no decryption on the hot path) and an
 * AES-256-GCM envelope (what an authenticated admin can read back).
 *
 * That is a deliberate weakening relative to `adm_sk_`, and it is bounded by
 * what the key can do: nothing outside `/api/v1/public/*`, nothing outside one
 * scope, nothing outside one connection. A leaked publishable key is a leaked
 * public web page — which is what it already was.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import type { DsnCrypto } from '@adminium/meta';

/** Distinct from `adm_sk_` by design — see the header. */
export const PUBLISHABLE_KEY_PREFIX = 'adm_pub_';

/**
 * A SERVER key: the same public gate, valid with no `Origin`,
 * refused from a browser, shown once and stored hash-only. The prefix decides
 * the kind before anything is looked up, and the stored row must agree.
 * `parseBearerApiKey` and `plugins/auth.ts` accept `adm_sk_` only, so this is
 * never an RBAC principal, by construction.
 */
export const SERVER_KEY_PREFIX = 'adm_srv_';

/** `token_encrypted` for a server key: there is nothing to reveal (NOT NULL column). */
export const SERVER_KEY_SEALED_SENTINEL = '';

export type PublicKeyKind = 'browser' | 'server';

/** The kind a token's prefix claims, or null for anything else. */
export function keyKindOf(token: string): PublicKeyKind | null {
  if (token.startsWith(PUBLISHABLE_KEY_PREFIX)) return 'browser';
  if (token.startsWith(SERVER_KEY_PREFIX)) return 'server';
  return null;
}

/** Secret length after the prefix; matches `adm_sk_` (≈238 bits of base62). */
export const PUBLISHABLE_KEY_SECRET_LENGTH = 40;

/** Stored display fragment: `adm_pub_` + first 8 secret chars. */
export const PUBLISHABLE_DISPLAY_PREFIX_LENGTH = PUBLISHABLE_KEY_PREFIX.length + 8;

/** Session token minted by `POST /public/claim`. */
export const PUBLIC_SESSION_PREFIX = 'adm_pubs_';
export const PUBLIC_SESSION_SECRET_LENGTH = 40;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * `randomInt` rather than `randomBytes() % 62`: the modulo of a uniform byte
 * over 62 is biased toward the first 8 symbols, which costs real entropy at 40
 * characters. `randomInt` rejection-samples.
 */
function secret(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += BASE62[randomInt(BASE62.length)];
  return out;
}

/** SHA-256 hex of the full token — the stored `token_hash`. */
export function hashPublishableKey(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface GeneratedPublishableKey {
  /** The full secret. Returned to the admin, and re-readable later. */
  token: string;
  /** Display/lookup fragment persisted in `prefix`. */
  prefix: string;
  /** SHA-256 hex persisted in `token_hash`. */
  tokenHash: string;
}

export function generatePublishableKey(kind: PublicKeyKind = 'browser'): GeneratedPublishableKey {
  const head = kind === 'server' ? SERVER_KEY_PREFIX : PUBLISHABLE_KEY_PREFIX;
  const token = `${head}${secret(PUBLISHABLE_KEY_SECRET_LENGTH)}`;
  return {
    token,
    prefix: token.slice(0, PUBLISHABLE_DISPLAY_PREFIX_LENGTH),
    tokenHash: hashPublishableKey(token),
  };
}

export function generatePublicSessionToken(): { token: string; tokenHash: string } {
  const token = `${PUBLIC_SESSION_PREFIX}${secret(PUBLIC_SESSION_SECRET_LENGTH)}`;
  return { token, tokenHash: hashPublishableKey(token) };
}

/**
 * Extract a publishable key from an `Authorization` header.
 *
 * Returns `null` unless the scheme is Bearer AND the token carries the
 * `adm_pub_` prefix. An `adm_sk_` token presented here is `null` too: a secret
 * key must not become usable on the public surface just because someone pasted
 * it into a browser bundle, and the public routes have no business accepting a
 * credential that outranks them.
 */
export function parseBearerPublishableKey(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (match === null) return null;
  const token = match[1] as string;
  return keyKindOf(token) === null ? null : token;
}

/** Same, for the end-customer session token (a separate header). */
export function parsePublicSessionToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const token = header.trim();
  return token.startsWith(PUBLIC_SESSION_PREFIX) ? token : null;
}

/**
 * Constant-time compare of two hex digests.
 *
 * Lookup is by `prefix` (indexed) and the hash decides, so a byte-wise `===`
 * would leak the digest a character at a time to an attacker who can measure
 * it. `timingSafeEqual` throws on a length mismatch, hence the guard — and the
 * guard is safe to make early because the length of a SHA-256 hex string is not
 * a secret.
 */
export function tokenHashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Whether a key row is usable right now.
 *
 * Revocation and expiry are checked here rather than in the query so that the
 * reason is available to the caller — but the caller must still answer every
 * failure identically on the wire (enumeration rule). Do not surface
 * "revoked" and "expired" as different statuses to an anonymous client.
 */
export function keyIsLive(
  row: { revokedAt: number | null; expiresAt: number | null },
  now: number,
): boolean {
  if (row.revokedAt !== null) return false;
  if (row.expiresAt !== null && row.expiresAt <= now) return false;
  return true;
}

/* ------------------------------------------------------------- at rest */

/**
 * The re-readable copy. Uses the same AES-256-GCM envelope as connection DSNs,
 * so a publishable secret is exactly as recoverable as the database credentials
 * already stored beside it — and exactly as unrecoverable if `ADMINIUM_SECRET`
 * changes, which is the documented, understood failure mode rather than a new
 * one invented for this wave.
 */
export function sealPublishableKey(crypto: DsnCrypto, token: string): string {
  return crypto.encrypt(token);
}

export function openPublishableKey(crypto: DsnCrypto, sealed: string): string {
  return crypto.decrypt(sealed);
}

/**
 * Rotate: a NEW secret against the SAME row.
 *
 * Deliberately not "revoke and create". The scope, the side and the origin
 * narrowing are what an operator configured and reviewed; forcing them to
 * re-create the key to change the secret means re-making those decisions under
 * time pressure, which is how a rotation ends up wider than the key it
 * replaced. The old secret stops working the moment this is persisted — there
 * is no overlap window, because the consumer is a static bundle that is
 * redeployed rather than a fleet of long-lived clients.
 */
export function rotatePublishableKey(kind: PublicKeyKind = 'browser'): GeneratedPublishableKey {
  return generatePublishableKey(kind);
}
