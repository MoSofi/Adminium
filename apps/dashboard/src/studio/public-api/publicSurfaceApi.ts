// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Public-surface data layer (28-T13) over `/api/v1/public-api`,
 * `/api/v1/public-scopes` and `/api/v1/public-keys`
 * (`apps/server/src/routes/public-admin/`).
 *
 * ── THE SECRET IS RE-READABLE HERE, AND THAT INVERTS ONE CONVENTION ────────
 * `api-keys/apiKeysApi.ts` deliberately keeps its one-time plaintext OUT of the
 * react-query cache, because a cached secret outlives its render. A publishable
 * key is the opposite by design (28 §3.3): it lives in a public JS bundle and
 * has to be recoverable months later for a rebuild, so `GET /public-keys/:id/
 * reveal` exists and is audited server-side.
 *
 * The cache rule still holds, for a different reason. A revealed token is
 * fetched on demand and held in component state, never in a query — not to
 * protect it from devtools, but so that "show me the key" is always a fresh
 * audited read rather than a silent cache hit that leaves no trail.
 *
 * Shapes mirror the server's Zod replies (`routes/public-admin/schema.ts`) —
 * the copied-mirror convention: change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

export type PublicSide = 'staff' | 'customer';

/** Mirrors `publicApiStateReply`. */
export interface PublicApiState {
  /** Level 2 — the settings toggle this page owns. */
  enabled: boolean;
  /**
   * Level 1 — whether `ADMINIUM_PUBLIC_API_ORIGINS` opted this instance in.
   * READ-ONLY: it is an env var and a restart, so the page reports it as a fact
   * rather than rendering a control that would silently do nothing.
   */
  registered: boolean;
  origins: string[];
}

/** Mirrors `publicScopeDto`. */
export interface PublicScopeDto {
  id: string;
  connectionId: string;
  side: PublicSide;
  name: string;
  /** Canonical IANA zone, as the compiler resolved it. */
  timezone: string;
  /** The scope document verbatim; the operator authored it and may read it. */
  document: string;
  proposedFromManifest: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  /** How many keys point here — i.e. what deleting this would break. */
  keyCount: number;
}

/** Mirrors `publicKeyDto`. Never carries `tokenHash` or `tokenEncrypted`. */
export interface PublicKeyDto {
  id: string;
  name: string;
  /** Display fragment, e.g. `adm_pub_4f2a91cd`. */
  prefix: string;
  scopeId: string;
  side: PublicSide;
  origins: string[];
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicKeyCreateBody {
  name: string;
  scopeId: string;
  origins?: string[] | undefined;
  expiresAt?: number | undefined;
}

export interface PublicKeyWithToken {
  key: PublicKeyDto;
  token: string;
}

/** One compile failure, as `compileScope` reported it. */
export interface ScopeIssue {
  code: string;
  message: string;
  ref?: string;
  column?: string;
}

export const PUBLIC_API_QUERY_KEY = ['public-api'] as const;
export const PUBLIC_SCOPES_QUERY_KEY = ['public-api', 'scopes'] as const;
export const PUBLIC_KEYS_QUERY_KEY = ['public-api', 'keys'] as const;

export function publicApiStateQuery() {
  return queryOptions({
    queryKey: PUBLIC_API_QUERY_KEY,
    queryFn: () => api.get<PublicApiState>('/api/v1/public-api'),
  });
}

export function publicScopesQuery() {
  return queryOptions({
    queryKey: PUBLIC_SCOPES_QUERY_KEY,
    queryFn: async () =>
      (await api.get<{ scopes: PublicScopeDto[] }>('/api/v1/public-scopes')).scopes,
  });
}

export function publicKeysQuery() {
  return queryOptions({
    queryKey: PUBLIC_KEYS_QUERY_KEY,
    queryFn: async () => (await api.get<{ keys: PublicKeyDto[] }>('/api/v1/public-keys')).keys,
  });
}

export function setPublicApiEnabled(enabled: boolean): Promise<PublicApiState> {
  return api.put<PublicApiState>('/api/v1/public-api', { enabled });
}

export function createPublicScope(body: {
  connectionId: string;
  side: PublicSide;
  name: string;
  document: string;
}): Promise<{ scopes: PublicScopeDto[] }> {
  return api.post<{ scopes: PublicScopeDto[] }>('/api/v1/public-scopes', body);
}

export function updatePublicScope(
  id: string,
  patch: { name?: string; document?: string },
): Promise<{ scopes: PublicScopeDto[] }> {
  return api.patch<{ scopes: PublicScopeDto[] }>(`/api/v1/public-scopes/${id}`, patch);
}

export function deletePublicScope(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/v1/public-scopes/${id}`);
}

export function createPublicKey(body: PublicKeyCreateBody): Promise<PublicKeyWithToken> {
  return api.post<PublicKeyWithToken>('/api/v1/public-keys', body);
}

/** A fresh, audited read every time — see the header on why this is not cached. */
export function revealPublicKey(id: string): Promise<{ token: string }> {
  return api.get<{ token: string }>(`/api/v1/public-keys/${id}/reveal`);
}

export function rotatePublicKey(id: string): Promise<PublicKeyWithToken> {
  return api.post<PublicKeyWithToken>(`/api/v1/public-keys/${id}/rotate`);
}

export function revokePublicKey(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/v1/public-keys/${id}`);
}

/* --- derived state (pure — unit-tested without a DOM) ---------------------- */

export type PublicKeyStatus = 'active' | 'revoked' | 'expired';

export function keyStatusOf(key: PublicKeyDto, now: number): PublicKeyStatus {
  if (key.revokedAt !== null) return 'revoked';
  if (key.expiresAt !== null && key.expiresAt <= now) return 'expired';
  return 'active';
}

/** Active keys first, then newest — a revoked key is history, not the point. */
export function sortKeys(keys: readonly PublicKeyDto[], now: number): PublicKeyDto[] {
  return [...keys].sort((a, b) => {
    const active = Number(keyStatusOf(b, now) === 'active') - Number(keyStatusOf(a, now) === 'active');
    return active !== 0 ? active : b.createdAt - a.createdAt;
  });
}

/**
 * Is the surface actually reachable right now?
 *
 * BOTH switches must be on, and the page must be able to say WHICH one is off —
 * "not registered" needs an env var and a restart, while "not enabled" is one
 * click. Collapsing them into a boolean is what would produce a toggle that
 * looks broken on an instance that never opted in.
 */
export type SurfaceState = 'live' | 'disabled' | 'not-registered';

export function surfaceStateOf(state: PublicApiState): SurfaceState {
  if (!state.registered) return 'not-registered';
  return state.enabled ? 'live' : 'disabled';
}

/** Keys grouped under the scope they use, so the page can show what a delete costs. */
export function keysByScope(keys: readonly PublicKeyDto[]): Map<string, PublicKeyDto[]> {
  const out = new Map<string, PublicKeyDto[]>();
  for (const key of keys) {
    const list = out.get(key.scopeId);
    if (list === undefined) out.set(key.scopeId, [key]);
    else list.push(key);
  }
  return out;
}

/**
 * Pull `details.issues` out of a failed scope write.
 *
 * The server answers a bad document with `422 VALIDATION_FAILED` carrying every
 * issue `compileScope` found, and this page is the ONLY place they are shown:
 * the operator wrote the document and is the only person who can fix it. The
 * anonymous surface still says nothing at all (28 §3.2).
 */
export function scopeIssuesFrom(error: unknown): ScopeIssue[] {
  const details = (error as { details?: unknown } | null)?.details;
  const issues = (details as { issues?: unknown } | undefined)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter(
    (i): i is ScopeIssue =>
      typeof i === 'object' && i !== null && typeof (i as ScopeIssue).code === 'string',
  );
}
