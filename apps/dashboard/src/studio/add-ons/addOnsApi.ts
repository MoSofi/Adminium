// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Add-on data layer over `/api/v1/add-ons`
 * (`apps/server/src/routes/add-ons/`).
 *
 * Shapes mirror the server's Zod replies (`routes/add-ons/schema.ts`) — the
 * copied-mirror convention: change both together.
 *
 * ── NOTHING HERE HOLDS A SECRET ────────────────────────────────────────────
 * By construction rather than by care: the server's replies carry no credential
 * value at all, only `connected`, `connectionExpiresAt` and the granted scopes.
 * So there is no cache rule to get right, unlike `apiKeysApi` and
 * `publicSurfaceApi` which both had to reason about a plaintext. What the
 * connect forms send goes straight out and is never put in a query.
 *
 * ── BROWSING IS NOT FETCHING ───────────────────────────────────────────────
 * `GET /add-ons/catalog` reads what is already on disk plus whatever the last
 * refresh cached; it never reaches the network on its own. Refresh is a
 * separate, explicit action that enqueues a job — which is why this file has
 * both, and why the page presents them as different things rather than as a
 * list that silently updates itself.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError, csrfHeaders } from '../../app/api.js';

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
  /** Whether a credential is stored. Never the credential. */
  connected: boolean;
  /**
   * Installed, but its files are not on this server. Everything else
   * on this row is the meta store's memory of what WAS installed — including
   * `connected`, because the credential row outlives the volume.
   */
  missing: boolean;
  connectionExpiresAt: number | null;
  attachments: AddOnAttachment[];
  slots: { slot: string; client: string; order: number }[];
  provides: { contract: string; version: number }[];
  networkAllow: string[];
  /**
   * The manifest's own `settings[]`, so the panel can GENERATE its form
   * instead of hard-coding one. That hard-coded form was a single `api_key`
   * input, and `shipping-dhl` has declared two secrets since wave 4 — its
   * connect could not be completed from this page at all.
   */
  settings: AddOnSettingDeclaration[];
  /** The stored NON-SECRET values. A credential is never read back. */
  settingValues: Record<string, unknown>;
  /** `ref`: the one page this address serves the code of, when that page is kept behind its own permission. */
  bundles: { path: string; url: string; integrity: string; ref?: string }[];
  /**
   * The installed apps that name it, and how — read before any click, so a
   * refusal or a feature that stops can be said first. Absent from an older
   * server.
   */
  usedBy?: AddOnUse[];
}

/** One installed app's need of an add-on. Mirrors `appNeedDto`. */
export interface AddOnUse {
  app: string;
  appName: string;
  /** `installed`, `disabled` or `installing` — a switched-off app still holds its need. */
  status: string;
  need: 'requires' | 'feature' | 'suggests';
  range: string | null;
  features: { id: string; label: Record<string, string> }[];
}

export interface AddOnSettingDeclaration {
  key: string;
  /** `string` | `number` | `boolean` | `enum` | `file` | `json`. */
  type: string;
  required: boolean;
  /** A secret is written through CONNECT, never through the settings PUT. */
  secret: boolean;
  label: { key: string; fallback: string } | null;
  help: { key: string; fallback: string } | null;
  /** For `enum`; empty otherwise. */
  options: string[];
}

/** Mirrors `catalogEntryDto`. */
export interface CatalogEntry {
  key: string;
  /**
   * Already resolved to the caller's locale by the server — the feed carries
   * eight and the reply carries one. Never a key: the route that used to
   * answer `entry.name['en_US']` against a feed keyed `en`/`zh-cn` labelled
   * every catalogue row with its own slug.
   */
  name: string;
  version: string;
  source: 'bundled' | 'catalog';
  state: 'installed' | 'staged' | 'available' | 'missing';
  /** Never a release the server is too old for — see `needsNewerAdminium`. */
  upgradeTo: string | null;
  /**
   * A catalogue release this server cannot take, and the version it needs.
   * The row is still listed: an add-on that simply vanished would leave an
   * operator with no way to learn that the answer is an Adminium upgrade.
   */
  needsNewerAdminium: { version: string; minAdminiumVersion: string } | null;
  /** One line, localized where the feed has it; null when nothing has one. */
  tagline: string | null;
  /** Category slugs, verbatim — an unknown one renders as itself. */
  categories: string[];
  /** Whether installing will ask for a credential. */
  connectKind: ConnectKind;
  /** `coming-soon`: listed by the site, nothing to download yet. */
  availability?: 'installable' | 'coming-soon' | undefined;
  /** From the cached catalogue; null when only the disk knows the row. */
  author?: string | null | undefined;
  monogram?: string | null | undefined;
  lastUpdatedAt?: string | null | undefined;
}

/** Mirrors `catalogBrowseReply`. */
export interface CatalogBrowse {
  addOns: CatalogEntry[];
  catalogFetchedAt: number | null;
  onlineEnabled: boolean;
  /** The list is being fetched right now: the page reads again until it is not. */
  refreshing?: boolean;
}

/** Mirrors `installPlanDto` — the consent dialog's document. */
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

/** What an install makes beside tables: named before anyone agrees to it. Only for an add-on with tables of its own. */
export interface InstallMakes {
  pages: { ref: string; title: string }[];
  roles: { key: string; name: string }[];
  lists: string[];
  documents: number;
  seeds: boolean;
}

/** What an add-on would open to the public, said on the check: nothing of it is opened unless the person says so. */
export interface PublicAccessCheck {
  endpoints: { ref: string; table: string; methods: string[]; key: string }[];
  /** By app: the entries its public key would gain, and the ones it holds already. */
  byApp: Record<string, { adds: string[]; held: string[] }>;
  /** The add-on's one key of its own: a link that opens one record and only reads. */
  linkKey?: string;
  /** Whether the person asking may allow it. */
  canGrant: boolean;
}

/** What an app's public key gained, lost and was not given when an add-on it uses moved. */
export interface SettledAccess {
  granted: string[];
  withdrawn: string[];
  skipped: { ref: string; reason: string }[];
}

/** A check of a staged package: the plan, and — for an add-on with tables of its own — where they go and what else is made. */
export interface InstallCheck {
  plan: InstallPlan;
  connectionId?: string | null;
  connectionName?: string | null;
  /** The plan's identity: handed back at the install, so a database that moved in between is said, not built on. */
  checksum?: string;
  makes?: InstallMakes;
  publicAccess?: PublicAccessCheck;
}

/** A database an add-on's tables may go in, as the server lists them when there is a choice. */
export interface ConnectionChoice {
  id: string;
  name: string;
}

/**
 * The check for a staged package, BEFORE anything is installed. With several
 * databases and none named, the server answers 409 `ADD_ON_SCHEMA_CONNECTION`
 * with the list: {@link connectionChoices} reads it.
 */
export async function checkInstall(key: string, connectionId?: string): Promise<InstallCheck> {
  if (connectionId === undefined) return api.get<InstallCheck>(`/api/v1/add-ons/${key}/plan`);
  return api.post<InstallCheck>('/api/v1/add-ons/plan', { key, attachTo: [], connectionId });
}

/** The databases to choose from, when a check or an install was refused for want of a choice; null for any other failure. */
export function connectionChoices(caught: unknown): ConnectionChoice[] | null {
  if (!(caught instanceof ApiError) || caught.code !== 'ADD_ON_SCHEMA_CONNECTION') return null;
  const listed = (caught.details as { connections?: unknown } | undefined)?.connections;
  if (!Array.isArray(listed)) return [];
  return listed.flatMap((entry) => {
    const { id, name } = (entry ?? {}) as { id?: unknown; name?: unknown };
    return typeof id === 'string' ? [{ id, name: typeof name === 'string' && name !== '' ? name : id }] : [];
  });
}

/** The plan for a staged package, BEFORE anything is installed. */
export async function fetchInstallPlan(key: string): Promise<InstallPlan> {
  return (await checkInstall(key)).plan;
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
  /** The database its tables go in, when there was a choice. */
  connectionId?: string;
  /** The identity of the plan the person agreed to. */
  planChecksum?: string;
  /** The person ticked "Allow public access". */
  publicAccess?: boolean;
}): Promise<{ addOn: AddOnDto; plan: InstallPlan }> {
  return api.post('/api/v1/add-ons', input);
}

/**
 * Mount an installed add-on on one more app (`POST /add-ons/:key/attachments`),
 * or switch it back on there. `change` is null when it already was.
 */
export async function attachAddOn(
  key: string,
  app: string,
  /** Also put the add-on's public entries on the app's public key. */
  publicAccess?: boolean,
): Promise<{ addOn: AddOnDto; change: 'attached' | 'enabled' | null; publicAccess?: SettledAccess }> {
  return api.post(`/api/v1/add-ons/${encodeURIComponent(key)}/attachments`, { app, ...(publicAccess === true ? { publicAccess: true } : {}) });
}

export async function setAddOnEnabled(
  key: string,
  attachedTo: string,
  enabled: boolean,
): Promise<{ addOn: AddOnDto; publicAccess?: SettledAccess }> {
  return api.patch(`/api/v1/add-ons/${key}`, { attachedTo, enabled });
}

/** `drop`: also delete the tables it made, with the add-on's key typed — a Super Admin's deliberate act. */
export async function uninstallAddOn(
  key: string,
  drop?: { confirmKey: string },
): Promise<{ key: string; tablesKept: boolean; packageRemoved: boolean }> {
  return drop === undefined ? api.delete(`/api/v1/add-ons/${key}`) : api.delete(`/api/v1/add-ons/${key}`, { dropTables: true, confirmKey: drop.confirmKey });
}

/** What removing an add-on would take, keep and may drop, and what stands in its way. */
export interface UninstallPlan {
  key: string;
  version: string;
  /** It keeps tables of its own: the lists below say what goes with it. False for an add-on that only ever had its files. */
  likeApp: boolean;
  pages: { removed: string[]; kept: string[] };
  roles: { slug: string; members: number }[];
  tables: { table: string; droppable: boolean }[];
  inUse: { postings: { table: string; posting: string }[]; features: { app: string; name: string; feature: string }[] };
  requiredBy: { app: string; name: string }[];
}

export async function fetchUninstallPlan(key: string): Promise<UninstallPlan> {
  return api.get<UninstallPlan>(`/api/v1/add-ons/${key}/uninstall-plan`);
}

/** What an update would change in the add-on's own tables, before it does. */
export interface UpdatePlan {
  plan: InstallPlan;
  from: string;
  to: string;
  connectionId: string | null;
  checksum?: string;
  publicAccess?: PublicAccessCheck;
}

/** Whether a check asks for something the public does not reach yet: a new entry on an app's key. */
export function asksNewPublicAccess(access: PublicAccessCheck | undefined): boolean {
  return access !== undefined && Object.values(access.byApp).some((app) => app.adds.length > 0);
}

export async function fetchUpdatePlan(key: string): Promise<UpdatePlan> {
  return api.post<UpdatePlan>(`/api/v1/add-ons/${key}/update/plan`, {});
}

/** Update to the newest staged version; `planChecksum` is the identity of the plan that was read. */
export async function updateAddOn(
  key: string,
  planChecksum?: string,
  /** The person ticked "Allow public access": what the version adds is opened. What it dropped goes either way. */
  publicAccess?: boolean,
): Promise<{ addOn: AddOnDto; from: string; to: string; pruned: string[] }> {
  return api.post(`/api/v1/add-ons/${key}/update`, { ...(planChecksum === undefined ? {} : { planChecksum }), ...(publicAccess === true ? { publicAccess: true } : {}) });
}

export async function discardStaged(key: string, version: string): Promise<void> {
  await api.delete(`/api/v1/add-ons/staged/${key}/${version}`);
}

/**
 * The online-catalog switch.
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
  /** Read from the package's own manifest, never supplied by the operator. */
  key: string;
  version: string;
  /** The manifest's display name. */
  name: string;
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
 * bundled, downloaded and uploaded packages — so an air-gapped operator gets the
 * same guarantees rather than a softer set. The value is the sha512 fingerprint
 * every release publishes beside its Download link, a plain sha512 of the
 * tarball, so the person doing the sideloading can carry it without trusting
 * this page.
 *
 * Which add-on the bytes are — its key and version — is not sent. The server
 * reads it from the package's own `manifest.json` and returns it.
 *
 * Not routed through `api`, which is JSON-only: the route takes the package as
 * a raw body. A hand-rolled `fetch` means a hand-rolled CSRF header — without
 * it every upload 403s.
 */
export async function uploadAddOn(
  file: File | Blob,
  input: { expectedSha512: string },
): Promise<StagedPackage> {
  const query = new URLSearchParams({ expectedSha512: input.expectedSha512 });
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
    | (StagedPackage & { error?: { message?: unknown; code?: unknown; details?: unknown } })
    | null;
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : `Upload failed with status ${String(response.status)}.`;
    // With the server's code when it gave one: a package stored but not trusted is said in the page's own words.
    throw typeof body?.error?.code === 'string' ? new ApiError(response.status, body.error.code, message, null, body.error.details) : new Error(message);
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

/**
 * Save the non-secret half of an add-on's settings.
 *
 * A PARTIAL patch: the panel edits one field at a time, and sending the whole
 * object back is how one tab's stale copy silently reverts another's save.
 */
export async function saveAddOnSettings(
  key: string,
  values: Record<string, unknown>,
): Promise<{ key: string; values: Record<string, unknown>; updatedAt: number }> {
  return await api.put(`/api/v1/add-ons/${encodeURIComponent(key)}/settings`, { values });
}
