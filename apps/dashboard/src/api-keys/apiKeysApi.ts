/**
 * API-keys data layer (M10-T06) over the existing `/api/v1/api-keys` routes
 * (08-server-api.md §2.16) — no new server surface.
 *
 * THE ONE-TIME SECRET. `POST /api-keys` is the only endpoint in the product
 * that ever serialises a plaintext key: the server stores a SHA-256 hash plus a
 * short display `prefix` and the list reply carries neither hash nor secret
 * (`apps/server/src/routes/api-keys/index.ts` `toDto`). So the plaintext lives
 * exactly as long as the mutation result does — it is deliberately NOT written
 * into the react-query cache, because a cached secret is a secret that outlives
 * its one render and rides along with every devtools dump.
 *
 * Scopes are a ROLE's grant set, not a per-key field: a key acts with its
 * role's permissions (07 §3.7). `GET /roles/:id/permissions` is gated on
 * `system:roles:manage` while this page is gated on `system:api-keys:manage`,
 * so every role-derived query here is failure-tolerant by design — a principal
 * holding only the latter still gets a working page, minus the scope chips.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

/** Mirrors `apiKeyDto` (routes/api-keys/schema.ts) — never carries secret material. */
export interface ApiKeyDto {
  id: string;
  name: string;
  /** Display fragment only, e.g. `adm_sk_4f2a91cd`. The rest is unrecoverable. */
  prefix: string;
  roleId: string;
  createdBy: string | null;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface RoleListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  memberCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ApiKeyCreateBody {
  name: string;
  roleId: string;
  expiresAt?: number | undefined;
}

/** The create reply — `key` is the one-time plaintext. */
export interface ApiKeyCreateReply {
  apiKey: ApiKeyDto;
  key: string;
  scopes: string[];
}

export const API_KEYS_QUERY_KEY = ['api-keys'] as const;

export function apiKeysQuery() {
  return queryOptions({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: async () => (await api.get<{ apiKeys: ApiKeyDto[] }>('/api/v1/api-keys')).apiKeys,
  });
}

/**
 * Roles for the create form's picker and the per-key role badge. Tolerant:
 * `GET /roles` needs `system:roles:manage`, which an api-keys-only admin may
 * lack — a 403 must degrade the page, not break it (the page falls back to
 * raw role ids and disables creation with an explanation).
 */
export function rolesQuery() {
  return queryOptions({
    queryKey: ['api-keys', 'roles'] as const,
    retry: false,
    queryFn: async () => (await api.get<{ roles: RoleListItem[] }>('/api/v1/roles')).roles,
  });
}

/**
 * A role's §5.1 grant strings → the key's scope chips.
 *
 * The `super-admin` special-case mirrors the server's own create-reply logic
 * (routes/api-keys/index.ts): that role's authority is implicit, not a matrix
 * of rows, so `listForRole` returns nothing and only `['*']` tells the truth.
 * Without this the most dangerous key on the page would show the emptiest
 * scope list.
 */
export function roleGrantsQuery(role: { id: string; slug: string }) {
  return queryOptions({
    queryKey: ['api-keys', 'grants', role.id] as const,
    retry: false,
    queryFn: async (): Promise<string[]> => {
      if (role.slug === 'super-admin') return ['*'];
      return (await api.get<{ roleId: string; grants: string[] }>(`/api/v1/roles/${role.id}/permissions`))
        .grants;
    },
  });
}

export function createApiKey(body: ApiKeyCreateBody): Promise<ApiKeyCreateReply> {
  return api.post<ApiKeyCreateReply>('/api/v1/api-keys', body);
}

export function revokeApiKey(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/v1/api-keys/${id}`);
}

// --- derived state (pure — unit-tested without a DOM) ------------------------

/** A key is live only while it is neither revoked nor past its expiry. */
export function isActive(key: ApiKeyDto, now: number): boolean {
  if (key.revokedAt !== null) return false;
  return key.expiresAt === null || key.expiresAt > now;
}

export type KeyStatus = 'active' | 'revoked' | 'expired';

export function statusOf(key: ApiKeyDto, now: number): KeyStatus {
  if (key.revokedAt !== null) return 'revoked';
  if (key.expiresAt !== null && key.expiresAt <= now) return 'expired';
  return 'active';
}

/** Active keys first, then newest — a revoked key is history, not the point. */
export function sortKeys(keys: readonly ApiKeyDto[], now: number): ApiKeyDto[] {
  return [...keys].sort((a, b) => {
    const activeDelta = Number(isActive(b, now)) - Number(isActive(a, now));
    return activeDelta !== 0 ? activeDelta : b.createdAt - a.createdAt;
  });
}
