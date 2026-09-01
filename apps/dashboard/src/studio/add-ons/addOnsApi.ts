// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add-on data layer (26-T14, 32 §4.4) over `/api/v1/add-ons`
 * (`apps/server/src/routes/add-ons/`).
 *
 * Shapes mirror the server's Zod replies (`routes/add-ons/schema.ts`) — the
 * copied-mirror convention: change both together.
 *
 * ── NOTHING HERE HOLDS A SECRET ────────────────────────────────────────────
 * By construction rather than by care: the server's replies carry no credential
 * value at all (24 D15), only `connected`, `connectionExpiresAt` and the granted
 * scopes. So there is no cache rule to get right, unlike `apiKeysApi` and
 * `publicSurfaceApi` which both had to reason about a plaintext. What the
 * connect forms send goes straight out and is never put in a query.
 *
 * ── BROWSING IS NOT FETCHING ───────────────────────────────────────────────
 * `GET /add-ons/catalog` reads what is already on disk plus whatever the last
 * refresh cached; it never reaches the network on its own (32 §4.3). Refresh is
 * a separate, explicit action that enqueues a job — which is why this file has
 * both, and why the page presents them as different things rather than as a
 * list that silently updates itself.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, csrfHeaders } from '../../app/api.js';

export const ADD_ONS_QUERY_KEY = ['add-ons'] as const;
export const ADD_ON_CATALOG_QUERY_KEY = ['add-ons', 'catalog'] as const;

export type ConnectKind = 'none' | 'api-key' | 'oauth2';

/** Mirrors `addOnAttachmentDto`. */
export interface AddOnAttachment {
  attachedTo: string;
  enabled: boolean;
}

/** Mirrors `addOnDto`. */
export interface AddOnDto {
  key: string;
  name: string;
  version: string;
  connectKind: ConnectKind;
  /** Whether a credential is stored. Never the credential (24 D15). */
  connected: boolean;
  connectionExpiresAt: number | null;
  attachments: AddOnAttachment[];
  slots: { slot: string; client: string; order: number }[];
  provides: { contract: string; version: number }[];
  networkAllow: string[];
  bundles: { path: string; url: string; integrity: string }[];
}

/** Mirrors `catalogEntryDto`. */
export interface CatalogEntry {
  key: string;
  name: string;
  version: string;
  source: 'bundled' | 'catalog';
  state: 'installed' | 'staged' | 'available';
  upgradeTo: string | null;
}

/** Mirrors `catalogBrowseReply`. */
export interface CatalogBrowse {
  addOns: CatalogEntry[];
  catalogFetchedAt: number | null;
  onlineEnabled: boolean;
}

/** Mirrors `installPlanDto` — the consent dialog's document (26 §7). */
export interface InstallPlan {
  addOnKey: string;
  version: string;
  installable: boolean;
  touchesData: boolean;
  create: { ref: string; columns: { ref: string; type: string }[] }[];
  reuse: { ref: string; missingColumns: string[] }[];
  references: {
    fromTable: string;
    fromColumn: string;
    to: string;
    resolution: 'internal' | 'host' | 'unresolved';
  }[];
  problems: { code: string; message: string; table: string; column?: string }[];
  requiresSchemaChange: boolean;
}

export const addOnsQuery = queryOptions({
  queryKey: ADD_ONS_QUERY_KEY,
  queryFn: async () => (await api.get<{ addOns: AddOnDto[] }>('/api/v1/add-ons')).addOns,
});

export const addOnCatalogQuery = queryOptions({
  queryKey: ADD_ON_CATALOG_QUERY_KEY,
  queryFn: () => api.get<CatalogBrowse>('/api/v1/add-ons/catalog'),
});

/** The plan for a staged package, BEFORE anything is installed. */
export async function fetchInstallPlan(key: string): Promise<InstallPlan> {
  return (await api.get<{ plan: InstallPlan }>(`/api/v1/add-ons/${key}/plan`)).plan;
}

export async function refreshCatalog(): Promise<{ jobId: string }> {
  return api.post<{ jobId: string }>('/api/v1/add-ons/catalog/refresh');
}

export async function downloadAddOn(key: string, version: string): Promise<{ jobId: string }> {
  return api.post<{ jobId: string }>('/api/v1/add-ons/download', { key, version });
}

export async function installAddOn(input: {
  key: string;
  version: string;
  attachTo: string[];
}): Promise<{ addOn: AddOnDto; plan: InstallPlan }> {
  return api.post('/api/v1/add-ons', input);
}

export async function setAddOnEnabled(
  key: string,
  attachedTo: string,
  enabled: boolean,
): Promise<{ addOn: AddOnDto }> {
  return api.patch(`/api/v1/add-ons/${key}`, { attachedTo, enabled });
}

export async function uninstallAddOn(
  key: string,
): Promise<{ key: string; tablesKept: boolean; packageRemoved: boolean }> {
  return api.delete(`/api/v1/add-ons/${key}`);
}

export async function upgradeAddOn(
  key: string,
): Promise<{ addOn: AddOnDto; from: string; to: string; pruned: string[] }> {
  return api.post(`/api/v1/add-ons/${key}/upgrade`);
}

export async function discardStaged(key: string, version: string): Promise<void> {
  await api.delete(`/api/v1/add-ons/staged/${key}/${version}`);
}

/**
 * The online-catalog switch (32 §4.4, D8, O1).
 *
 * Returns the EFFECTIVE state, which is not always what was asked for:
 * `ADMINIUM_NETWORK_FEATURES=off` and desktop air-gap mode veto the setting, so
 * `vetoed` is how the page explains a switch that did not move.
 */
export async function setCatalogEnabled(
  enabled: boolean,
): Promise<{ onlineEnabled: boolean; vetoed: boolean }> {
  return api.put('/api/v1/add-ons/catalog', { enabled });
}

/** Mirrors `stagedPackageReply` — the receipt for an unpack. */
export interface StagedPackage {
  key: string;
  version: string;
  files: number;
  integrity: string;
}

/**
 * Sideload: upload a `.tgz` the operator obtained themselves (D4).
 *
 * ── THE HASH IS REQUIRED, AND THAT IS THE POINT ────────────────────────────
 *
 * `expectedSha512` is not a convenience. Sideload runs the IDENTICAL
 * verify-then-hardened-unpack path a download does — one code path for
 * bundled, npm and upload — so an air-gapped operator gets the same guarantees
 * rather than a softer set. The value is the `integrity` field
 * `npm pack --json` prints, which is a plain sha512 of the tarball, so the
 * person doing the sideloading can produce it without trusting this page.
 *
 * Not routed through `api`, which is JSON-only: the route takes the package as
 * a raw body. A hand-rolled `fetch` means a hand-rolled CSRF header — without
 * it every upload 403s.
 */
export async function uploadAddOn(
  file: File | Blob,
  input: { key: string; version: string; expectedSha512: string },
): Promise<StagedPackage> {
  const query = new URLSearchParams({
    key: input.key,
    version: input.version,
    expectedSha512: input.expectedSha512,
  });
  const response = await fetch(`/api/v1/add-ons/upload?${query.toString()}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/octet-stream',
      ...csrfHeaders(),
    },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as
    | (StagedPackage & { error?: { message?: unknown } })
    | null;
  if (!response.ok) {
    throw new Error(
      typeof body?.error?.message === 'string'
        ? body.error.message
        : `Upload failed with status ${String(response.status)}.`,
    );
  }
  if (body === null) throw new Error('The server returned nothing.');
  return body;
}

/** Mirrors the jobs route's view — what a download's progress looks like. */
export interface AddOnJobView {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: { pct: number; step?: string | null; message?: string | null } | null;
  lastError: string | null;
}

/**
 * Read one job's progress (D10).
 *
 * A download is a JOB, not a request — it runs on the worker with its retries,
 * its cancellation and its `jobs:<jobId>` topic. This is the same read the
 * connect wizard's introspection step uses, which keeps the surface testable
 * without a socket: the page polls it while a download is in flight.
 */
export async function getAddOnJob(jobId: string): Promise<AddOnJobView> {
  return (await api.get<{ data: AddOnJobView }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`)).data;
}

/**
 * Connect with an API key.
 *
 * `credentials` maps the add-on's own `secret: true` setting keys to values.
 * It goes straight out and is never cached — not because the cache would leak
 * it to anyone new, but because a secret with a lifetime longer than the
 * request that carried it is a secret nobody decided to keep.
 */
export async function connectAddOn(
  key: string,
  credentials: Record<string, string>,
): Promise<{ addOn: AddOnDto }> {
  return api.post(`/api/v1/add-ons/${key}/connect`, { credentials });
}

export async function disconnectAddOn(
  key: string,
): Promise<{ key: string; credentialsDeleted: boolean; tablesKept: boolean }> {
  return api.delete(`/api/v1/add-ons/${key}/connect`);
}

export async function startOAuth(
  key: string,
  input: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<{ authorizeUrl: string; state: string }> {
  return api.post(`/api/v1/add-ons/${key}/connect/oauth/start`, input);
}

export async function completeOAuth(
  key: string,
  input: { state: string; code: string },
): Promise<{ addOn: AddOnDto }> {
  return api.post(`/api/v1/add-ons/${key}/connect/oauth/complete`, input);
}
