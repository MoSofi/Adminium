// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The keys page's data layer over `/api/v1/public-api`, `/api/v1/public-keys`
 * and `/api/v1/public-endpoints` (`apps/server/src/routes/public-admin/`).
 *
 * Shapes mirror the server's Zod replies (`routes/public-admin/schema.ts`) —
 * the copied-mirror convention: change both together.
 *
 * ── A SECRET NEVER ENTERS THE QUERY CACHE ──────────────────────────────────
 * The token a create returns, and the token a reveal returns, are held in
 * component state and nowhere else (`ApiKeysPage.tsx`). A cached secret
 * outlives the render that showed it; and a reveal must be a fresh, audited
 * read every time, never a silent cache hit that leaves no trail.
 */
import { queryOptions } from '@tanstack/react-query';

import { ApiError, api } from '../../app/api.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'BATCH';
export type KeyKind = 'browser' | 'server';

/** One compile issue, as the server reports it. */
export interface Issue {
  code: string;
  message: string;
  ref?: string;
  column?: string;
}

/** Mirrors `publicApiStateReply`. */
export interface PublicApiState {
  enabled: boolean;
  /** Whether `ADMINIUM_PUBLIC_API_ORIGINS` opted this server in (an env var, not a control). */
  registered: boolean;
  origins: string[];
  /** The API documentation page switch. */
  docsEnabled: boolean;
}

/** Mirrors `publicKeyAccessDto`. */
export interface KeyAccess {
  endpointId: string | null;
  ref: string | null;
  path: string | null;
  methods: Method[];
  suspended: Method[];
}

/** Mirrors `publicKeyDto`. Never carries a secret. */
export interface KeyDto {
  id: string;
  name: string;
  prefix: string;
  scopeId: string;
  connectionId: string | null;
  kind: KeyKind;
  access: KeyAccess[];
  issues: Issue[];
  side: 'staff' | 'customer';
  appKey: string | null;
  /** Which of an app's browser keys (`customer`, or `kiosk`). Absent from an older server. */
  purpose?: string;
  /** Answers only alongside a signed-in staff member holding this app role. */
  requiresStaff?: { appKey: string; roleSlug: string } | null;
  origins: string[];
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors `publicEndpointDto`. */
export interface EndpointDto {
  id: string | null;
  ref: string;
  path: string;
  origin: 'generated' | 'custom';
  stored: boolean;
  /** The definition text — what the builder's pane shows. */
  definition: string;
  source: string | null;
  methods: Method[];
  selectHash: string | null;
  issues: Issue[];
}

export interface SourceColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  pii: boolean;
}

/** Mirrors `publicEndpointSourceDto`. */
export interface SourceDto {
  id: string;
  label: string;
  kind: 'table' | 'view' | 'materialized-view';
  rowCountEstimate: number | null;
  icon: string | null;
  columns: SourceColumn[];
}

export interface EndpointList {
  snapshot: boolean;
  endpoints: EndpointDto[];
  methods: Method[];
  sources: SourceDto[];
  unaddressable: { tableId: string; reason: string; ref: string | null; collidesWith: string[] }[];
}

export interface KeyRef {
  id: string;
  name: string;
  prefix: string;
  scopeId: string;
}

export interface Widening extends KeyRef {
  gains: { ref: string; methods: string[]; columns: string[]; rows: boolean }[];
}

export interface CheckReply {
  issues: Issue[];
  keys: KeyRef[];
  keysStillBroken: KeyRef[];
  widened: Widening[];
}

export interface SaveReply {
  endpoint: EndpointDto;
  keysStillBroken: KeyRef[];
  widened: Widening[];
}

export interface CreateKeyBody {
  name: string;
  connectionId: string;
  kind: KeyKind;
  access: { ref: string; methods: Method[]; source?: string; selectHash?: string }[];
  expiresAt?: number;
  appKey?: string;
}

export interface KeyWithToken {
  key: KeyDto;
  token: string;
}

export const PUBLIC_API_QUERY_KEY = ['public-api'] as const;
export const KEYS_QUERY_KEY = ['public-api', 'keys'] as const;
export const ENDPOINTS_QUERY_KEY = ['public-api', 'endpoints'] as const;
export const STATS_QUERY_KEY = ['public-api', 'stats'] as const;

export function publicApiStateQuery() {
  return queryOptions({
    queryKey: PUBLIC_API_QUERY_KEY,
    queryFn: () => api.get<PublicApiState>('/api/v1/public-api'),
  });
}

/**
 * Either switch, applied on the request. The reply is the whole new state,
 * which the caller writes straight into the cache.
 */
export function setPublicApiState(body: { enabled?: boolean; docsEnabled?: boolean }): Promise<PublicApiState> {
  return api.put<PublicApiState>('/api/v1/public-api', body);
}

export function keysQuery() {
  return queryOptions({
    queryKey: KEYS_QUERY_KEY,
    queryFn: async () => (await api.get<{ keys: KeyDto[] }>('/api/v1/public-keys')).keys,
  });
}

export function endpointsQuery(connectionId: string) {
  return queryOptions({
    queryKey: [...ENDPOINTS_QUERY_KEY, connectionId],
    queryFn: () => api.get<EndpointList>(`/api/v1/public-endpoints?connectionId=${encodeURIComponent(connectionId)}`),
  });
}

export function statsQuery(connectionId: string) {
  return queryOptions({
    queryKey: [...STATS_QUERY_KEY, connectionId],
    queryFn: () =>
      api.get<{ requests24h: number; errors24h: number }>(
        `/api/v1/public-api/stats?connectionId=${encodeURIComponent(connectionId)}`,
      ),
  });
}

export function createKey(body: CreateKeyBody): Promise<KeyWithToken> {
  return api.post<KeyWithToken>('/api/v1/public-keys', body);
}

/** A fresh, audited read every time — see the header. */
export function revealKey(id: string): Promise<{ token: string }> {
  return api.get<{ token: string }>(`/api/v1/public-keys/${id}/reveal`);
}

export function revokeKey(id: string): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/v1/public-keys/${id}`);
}

export function checkEndpoint(body: { connectionId: string; ref: string; definition: string }): Promise<CheckReply> {
  return api.post<CheckReply>('/api/v1/public-endpoints/check', body);
}

export function saveEndpoint(connectionId: string, ref: string, definition: string): Promise<SaveReply> {
  return api.put<SaveReply>(`/api/v1/public-endpoints/${encodeURIComponent(connectionId)}/${encodeURIComponent(ref)}`, {
    definition,
  });
}

export function renameEndpoint(connectionId: string, ref: string, to: string): Promise<SaveReply> {
  return api.post<SaveReply>(
    `/api/v1/public-endpoints/${encodeURIComponent(connectionId)}/${encodeURIComponent(ref)}/rename`,
    { ref: to },
  );
}

export function deleteEndpoint(connectionId: string, ref: string): Promise<{ ok: true; outcome: 'deleted' | 'switched-off' }> {
  return api.delete<{ ok: true; outcome: 'deleted' | 'switched-off' }>(
    `/api/v1/public-endpoints/${encodeURIComponent(connectionId)}/${encodeURIComponent(ref)}`,
  );
}

/* --- refusals, as the page reads them ------------------------------------ */

function detailsOf(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  return typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : null;
}

/** The compile issues a 422 carried, or none. */
export function issuesFrom(error: unknown): Issue[] {
  const issues = detailsOf(error)?.['issues'];
  return Array.isArray(issues) ? (issues as Issue[]) : [];
}

/** The live keys a refusal named (a save that would break them, a delete they block). */
export function keysFrom(error: unknown): KeyRef[] {
  const keys = detailsOf(error)?.['keys'];
  return Array.isArray(keys) ? (keys as KeyRef[]) : [];
}

/** The generated endpoints a create found changed since the sheet loaded (409 `PUBLIC_ENDPOINT_CHANGED`). */
export function changedRefsFrom(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || error.code !== 'PUBLIC_ENDPOINT_CHANGED') return null;
  const refs = detailsOf(error)?.['refs'];
  return Array.isArray(refs) ? (refs as string[]) : [];
}
