// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installed-app data layer (47-app-installation.md step 3) over `/api/v1/apps`
 * (`apps/server/src/routes/apps/`).
 *
 * Shapes mirror the server's Zod replies (`routes/apps/schema.ts`) — the
 * copied-mirror convention: change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, csrfHeaders } from '../../app/api.js';
import type { SurfaceSide } from './hostedAppsApi.js';

export interface InstalledAppSide {
  side: SurfaceSide;
  prefix: string;
  /** False = the bundle predates the toolkit; blended placement unavailable. */
  navAvailable: boolean;
}

export interface InstalledApp {
  key: string;
  version: string;
  source: string;
  installedAt: number;
  connectionId: string | null;
  sides: InstalledAppSide[];
}

export interface AppListReply {
  apps: InstalledApp[];
  /** Uploaded but never installed — an interrupted install, resumable. */
  staged: { key: string; version: string }[];
}

export const APPS_QUERY_KEY = ['installed-apps'] as const;

export function installedAppsQuery() {
  return queryOptions({
    queryKey: APPS_QUERY_KEY,
    queryFn: () => api.get<AppListReply>('/api/v1/apps'),
  });
}

export interface CatalogApp {
  key: string;
  version: string;
  name: string;
  description: string;
  categories: string[];
  publisher: string;
  capabilities: string[];
  sides: SurfaceSide[];
  installed: boolean;
  /** Set when a DIFFERENT version is installed than the one on disk. */
  installedVersion: string | null;
  /** False = the package's manifest could not be read; shown so it can be discarded. */
  readable: boolean;
}

export const APP_CATALOG_QUERY_KEY = ['app-catalog'] as const;

export function appCatalogQuery() {
  return queryOptions({
    queryKey: APP_CATALOG_QUERY_KEY,
    queryFn: () => api.get<{ apps: CatalogApp[] }>('/api/v1/apps/catalog'),
  });
}

export interface StagedApp {
  /** Read from the bundle's own manifest, never supplied by the operator. */
  key: string;
  version: string;
  /** The manifest's display name. */
  name: string;
  files: number;
  integrity: string;
  sides: SurfaceSide[];
}

/**
 * The sha512 of a file, in npm's SRI spelling.
 *
 * ── WHAT THIS HASH IS AND IS NOT WORTH ─────────────────────────────────────
 *
 * Computed here, it is SELF-REFERENTIAL: the same bytes produce the hash and
 * the upload, so it proves nothing about where the file came from. The server
 * says as much, and it is exactly why the hardened unpack runs unconditionally
 * rather than being skippable for a trusted source.
 *
 * It is still the right default, because the alternative is asking every
 * operator to paste a hash by hand for a file they just picked off their own
 * disk. An operator who HAS an independent one — `npm pack --json` prints it —
 * can paste it, and then the check is real end to end: their value is what
 * gets sent, and the server's constant-time compare is what fails.
 */
export async function sha512Of(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-512', await file.arrayBuffer());
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha512-${btoa(binary)}`;
}

/**
 * Upload a built surface bundle.
 *
 * Only the bytes and their hash go up. Which app they are — its key and
 * version — is read by the server from the bundle's own `manifest.json` and
 * comes back in the reply, which is what every later step addresses.
 *
 * Not routed through `api`, which is JSON-only: the route takes the bundle as a
 * raw body. A hand-rolled `fetch` means a hand-rolled CSRF header — without it
 * every upload 403s.
 */
export async function uploadApp(
  file: File | Blob,
  input: { expectedSha512: string },
): Promise<StagedApp> {
  const query = new URLSearchParams(input);
  const response = await fetch(`/api/v1/apps/upload?${query.toString()}`, {
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
    | (StagedApp & { error?: { message?: unknown } })
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

export interface PlannedTable {
  ref: string;
  columns: { ref: string; type: string }[];
}

export interface AppInstallPlan {
  key: string;
  version: string;
  installable: boolean;
  touchesData: boolean;
  create: PlannedTable[];
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

/** What installing would do. Writes nothing — safe to call on every step-in. */
export function planApp(input: {
  key: string;
  version: string;
  connectionId: string;
}): Promise<{ plan: AppInstallPlan }> {
  return api.post<{ plan: AppInstallPlan }>('/api/v1/apps/plan', input);
}

export interface InstalledAppResult extends InstalledApp {
  schema?: { created: string[]; reused: string[] };
}

export function installApp(input: {
  key: string;
  version: string;
  connectionId?: string;
}): Promise<InstalledAppResult> {
  return api.post<InstalledAppResult>('/api/v1/apps/install', input);
}

/**
 * Remove bytes that were uploaded and never installed.
 *
 * Refused for the version that IS installed — that path is uninstall, which
 * stops surfaces answering and asks for the key back first.
 */
export function discardStagedApp(
  key: string,
  version: string,
): Promise<{ key: string; version: string; discarded: boolean }> {
  return api.delete<{ key: string; version: string; discarded: boolean }>(
    `/api/v1/apps/staged/${key}/${version}`,
  );
}

export function uninstallApp(key: string): Promise<{ key: string; uninstalled: boolean }> {
  return api.delete<{ key: string; uninstalled: boolean }>(`/api/v1/apps/${key}`);
}

/**
 * The `CREATE TABLE` a planned table would produce, for the preview
 * (`Marketplace.dc.html`'s DDL block).
 *
 * ILLUSTRATIVE, AND SAID SO IN THE UI. The server emits the real DDL through
 * `install-ddl.ts`, per dialect, with foreign keys and enum checks this does
 * not reproduce. Rendering the server's own statement would mean shipping the
 * emitter to the browser or adding a route that returns SQL strings; the comp
 * asks for a shape an operator can read before consenting, and this is that
 * shape built from the plan the server actually returned.
 */
export function ddlPreview(table: PlannedTable): string {
  const width = Math.max(...table.columns.map((column) => column.ref.length), 0);
  const body = table.columns
    .map((column) => `  ${column.ref.padEnd(width)}  ${column.type}`)
    .join(',\n');
  return `CREATE TABLE ${table.ref} (\n${body}\n);`;
}
