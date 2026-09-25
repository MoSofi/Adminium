// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installed-app data layer over `/api/v1/apps`
 * (`apps/server/src/routes/apps/`).
 *
 * Shapes mirror the server's Zod replies (`routes/apps/schema.ts`) — the
 * copied-mirror convention: change both together.
 *
 * ── BROWSING IS NOT FETCHING (b G8-D3) ──────────────────────────────── `GET
 * /apps/catalog` reads the app store plus whatever the last refresh of the
 * online app catalog cached; it never reaches the network on its own. Refresh,
 * download and update are separate, explicit actions, and the two that fetch
 * are JOBS the page follows to the end.
 */
import { queryOptions } from '@tanstack/react-query';

import type { DesiredColumn, SchemaPlan } from '../remap/design/types.js';
import { api, csrfHeaders } from '../../app/api.js';
import type { SurfaceSide } from './hostedAppsApi.js';

export interface InstalledAppSide {
  side: SurfaceSide;
  prefix: string;
  /** False = the bundle predates the toolkit; blended placement unavailable. */
  navAvailable: boolean;
  /** Its mapped host when it has one, else its prefix. Absent from an older server. */
  openUrl?: string;
  /** `on`, switched `off`, or the whole app `disabled`. Absent from an older server. */
  state?: 'on' | 'off' | 'disabled';
}

export interface InstalledApp {
  key: string;
  version: string;
  source: string;
  installedAt: number;
  connectionId: string | null;
  sides: InstalledAppSide[];
  /**
   * Installed, but nothing of it is on this server, so none of it is served: a
   * redeploy on a host with no disk keeps the row and loses the files. `sides`
   * is empty then too, but an empty list reads as "no frontends".
   */
  missing: boolean;
  /** `installing` is an install that stopped part way. Absent from an older server. */
  status?: 'installing' | 'installed' | 'disabled' | 'error';
  /**
   * Set when the app is prefixed now and this install's tables still carry
   * their plain names: the prefix they would get, and how many. Absent
   * otherwise, and from an older server.
   */
  oldTableNames?: { prefix: string; count: number };
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
  /** The version on disk, or for a catalog-only row the version it offers. */
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
  /** `disk`: in the app store. `catalog`: offered online only, so installing downloads first. */
  source: 'disk' | 'catalog';
  state: 'installed' | 'staged' | 'available' | 'missing';
  /** For an installed app: the newest version above it this server can take. */
  updateTo: string | null;
  /** True when `updateTo` is already on disk, so updating needs no download. */
  updateStaged: boolean;
  /** A catalog release this server is too old for, and the version it needs (G8-D2). */
  needsNewerAdminium: { version: string; minAdminiumVersion: string } | null;
  /** A newer release on disk that cannot update the installed version in place (its `updatesFrom` leaves it out). */
  cannotUpdate?: { version: string; updatesFrom: string } | null;
}

export interface AppCatalogReply {
  apps: CatalogApp[];
  /** When the online app catalog was last cached; null when never. */
  catalogFetchedAt: number | null;
  /** Network features AND the app catalog switch. */
  onlineEnabled: boolean;
}

export const APP_CATALOG_QUERY_KEY = ['app-catalog'] as const;

export function appCatalogQuery() {
  return queryOptions({
    queryKey: APP_CATALOG_QUERY_KEY,
    queryFn: () => api.get<AppCatalogReply>('/api/v1/apps/catalog'),
  });
}

/**
 * The online app catalog's switch — its own, never the add-on one (48 R2).
 *
 * Returns the EFFECTIVE state: `ADMINIUM_NETWORK_FEATURES=off` vetoes the
 * setting, and `vetoed` is how the page explains a switch that did not move.
 */
export function setAppCatalogEnabled(
  enabled: boolean,
): Promise<{ onlineEnabled: boolean; vetoed: boolean }> {
  return api.put<{ onlineEnabled: boolean; vetoed: boolean }>('/api/v1/apps/catalog', { enabled });
}

/** Fetch the online app catalog again. A job; follow it with {@link followAppJob}. */
export function refreshAppCatalog(): Promise<{ jobId: string }> {
  return api.post<{ jobId: string }>('/api/v1/apps/catalog/refresh');
}

/**
 * Download one catalog release into the app store. A job; follow it with
 * {@link followAppJob}. The server checks the bytes against the catalog's own
 * fingerprint, and refuses at once a release this server is too old for.
 */
export function downloadApp(key: string, version: string): Promise<{ jobId: string }> {
  return api.post<{ jobId: string }>('/api/v1/apps/download', { key, version });
}

/**
 * Move an installed app to the newest version already on disk (G8-D6). Same
 * row, same connection; new tables are created and a table short of columns
 * refuses the update.
 */
export function updateApp(
  key: string,
  /** The check the operator saw for the new version: its checksum, and what they chose. */
  checked?: { planChecksum?: string; choices?: InstallAnswers['choices'] },
): Promise<{ app: InstalledAppResult; from: string; to: string; pruned: string[] }> {
  return api.post<{ app: InstalledAppResult; from: string; to: string; pruned: string[] }>(
    `/api/v1/apps/${encodeURIComponent(key)}/update`,
    checked,
  );
}

/** One table the rename to the app's prefix moves. */
export interface PrefixRename {
  ref: string;
  from: string;
  to: string;
}

/** Every table an old install would rename, and the schema editor's plan for it. */
export interface RenameTablesPreview {
  prefix: string;
  connectionId: string;
  tables: PrefixRename[];
  plan: SchemaPlan;
}

/** What renaming to the prefix would do. Writes nothing. */
export function planRenameTables(key: string): Promise<RenameTablesPreview> {
  return api.post<RenameTablesPreview>(`/api/v1/apps/${encodeURIComponent(key)}/rename-tables/plan`);
}

/** Run the reviewed rename. A database that changed since answers 409 `SCHEMA_DRIFT`. */
export function renameTables(
  key: string,
  checksum: string,
): Promise<{ prefix: string; renamed: PrefixRename[]; changeId: string }> {
  return api.post<{ prefix: string; renamed: PrefixRename[]; changeId: string }>(
    `/api/v1/apps/${encodeURIComponent(key)}/rename-tables`,
    { checksum },
  );
}

// ── One app's own settings page ─────────────────────────────────────────────

/** Mirrors `appSettingsReply`. */
export interface AppSettingsView {
  key: string;
  /** The operator's own name, or null for the app's. */
  name: string | null;
  placement: 'internal' | 'external';
  connectionId: string | null;
  off: SurfaceSide[];
  values: Record<string, unknown>;
  /** This app's mapped hosts. */
  domains: Record<string, { side: SurfaceSide; instance?: string }>;
  declared: {
    key: string;
    type: 'string' | 'number' | 'boolean' | 'enum' | 'file' | 'json';
    enum?: string[];
    min?: number;
    max?: number;
    label?: string;
    help?: string;
  }[];
  /** The add-ons the app names, each with its state and source. Absent for an app that names none. */
  addOns?: AppAddOnRow[];
}

// ── The add-ons an app names ────────────────────────────────────────────────

/** A text in every language the app speaks, keyed by tag (`en-US`). */
export type ManifestWords = Record<string, string>;

/** One app that uses an add-on, and how. Mirrors the server's `appNeedWire`. */
export interface AppNeed {
  app: string;
  appName: string;
  /** `installed`, `disabled` or `installing` — a switched-off app still holds its need. */
  status: string;
  need: 'requires' | 'feature' | 'suggests';
  range: string | null;
  features: { id: string; label: ManifestWords }[];
}

/**
 * One add-on the app names, resolved against this server. Mirrors
 * `appAddOnRow` (`apps/server/src/routes/apps/schema.ts`). `state` and
 * `source` are apart because the screen shows both: "Installed · v1.1.0 ·
 * Comes with Adminium".
 */
export interface AppAddOnRow {
  key: string;
  name: string;
  need: 'requires' | 'feature' | 'suggests';
  range: string;
  reason: ManifestWords;
  /** Ticked on the check: always when required, as the manifest says when suggested. */
  checked: boolean;
  features: { id: string; label: ManifestWords }[];
  state: 'attached' | 'installed' | 'outdated' | 'absent' | 'unavailable';
  source: 'bundled' | 'catalog' | 'upload' | null;
  installedVersion: string | null;
  offeredVersion: string | null;
  satisfiesRange: boolean;
  /** Whether the offered version's bytes are on this server; false means "download it first". */
  staged: boolean;
  enabled: boolean;
  /** What installing the app does to it: null (nothing), attach, install or update. */
  action: 'attach' | 'install' | 'update' | null;
  /** The other apps that use it. */
  usedBy: AppNeed[];
  /** Its own install plan (install or update). Absent from the settings read. */
  plan?: AppAddOnPlan | null;
  problems: { code: string; message: string }[];
}

/** An add-on's own install plan, as its consent reads it. */
export interface AppAddOnPlan {
  addOnKey: string;
  version: string;
  installable: boolean;
  touchesData: boolean;
  create: { ref: string; columns: { ref: string; type: string }[] }[];
  reuse: { ref: string; missingColumns: string[] }[];
  problems: { code: string; message: string; table: string; column?: string }[];
  requiresSchemaChange: boolean;
}

/** What the install did to the add-ons — the done line. */
export interface AddOnsDone {
  installed: { key: string; name: string; version: string }[];
  updated: { key: string; name: string; from: string; to: string }[];
  attached: { key: string; name: string; version: string }[];
}

/** What the install body says about one add-on: install or connect it at `version`, and update it when ticked. */
export interface AddOnChoice {
  key: string;
  version: string;
  update?: boolean;
}

/** Mirrors `appOverviewReply`. */
export interface AppOverview {
  key: string;
  connection: { id: string; name: string; engine: string } | null;
  /** `sample-ledger`: Adminium's list of the sample rows it added (listed last). */
  tables: { ref: string; table: string; state: string; role?: 'app' | 'sample-ledger'; rows: number | null }[];
  activity: { action: string; at: number; actor: string }[];
}

export const appSettingsKey = (key: string) => ['app-settings', key] as const;
export const appOverviewKey = (key: string) => ['app-overview', key] as const;

export function appSettingsQuery(key: string) {
  return queryOptions({
    queryKey: appSettingsKey(key),
    queryFn: () => api.get<AppSettingsView>(`/api/v1/apps/${encodeURIComponent(key)}/settings`),
  });
}

export function appOverviewQuery(key: string) {
  return queryOptions({
    queryKey: appOverviewKey(key),
    queryFn: () => api.get<AppOverview>(`/api/v1/apps/${encodeURIComponent(key)}/overview`),
  });
}

// ── Sample data ─────────────────────────────────────────────────────────────

export interface SampleCount {
  /** The table's short name in the app. */
  ref: string;
  count: number;
}

export interface SampleDataStatus {
  /** The app ships sample data. */
  offered: boolean;
  loaded: boolean;
  total: number;
  /** When it was added (epoch ms). */
  addedAt: number | null;
  tables: SampleCount[];
  /** What an add would write, while none is loaded. */
  available: { total: number; tables: SampleCount[]; assets: number } | null;
}

export interface SampleRemovePlan {
  tables: SampleCount[];
  /** Sample records your own records use: they stay. */
  kept: { ref: string; label: string | null; title: string | null; usedBy: number }[];
  /** Sample records you changed since they were added. */
  changed: { ref: string; label: string | null; title: string | null; columns: string[] }[];
  total: number;
}

export const sampleDataKey = (key: string) => ['app-sample-data', key] as const;

export function sampleDataQuery(key: string) {
  return queryOptions({
    queryKey: sampleDataKey(key),
    queryFn: () => api.get<SampleDataStatus>(`/api/v1/apps/${encodeURIComponent(key)}/sample-data`),
  });
}

/** Queue the add; the job writes every record or none. */
export function addSampleData(key: string): Promise<{ jobId: string }> {
  return api.post<{ jobId: string }>(`/api/v1/apps/${encodeURIComponent(key)}/sample-data`);
}

/** What a removal would take and keep, read fresh each time the dialog opens. */
export function sampleRemovePlanQuery(key: string) {
  return queryOptions({
    queryKey: ['app-sample-remove-plan', key] as const,
    queryFn: () => api.post<SampleRemovePlan>(`/api/v1/apps/${encodeURIComponent(key)}/sample-data/remove-plan`),
    staleTime: 0,
    gcTime: 0,
  });
}

export function removeSampleData(
  key: string,
  keepChanged: boolean,
): Promise<{ removed: number; kept: number; byTable: Record<string, number> }> {
  return api.post(`/api/v1/apps/${encodeURIComponent(key)}/sample-data/remove`, { keepChanged });
}

/** Change only what is sent. */
export function patchAppSettings(
  key: string,
  change: Partial<Pick<AppSettingsView, 'name' | 'placement' | 'connectionId' | 'off' | 'values'>>,
): Promise<AppSettingsView> {
  return api.patch<AppSettingsView>(`/api/v1/apps/${encodeURIComponent(key)}/settings`, change);
}

/** Switch the whole app off, or back on. Nothing is deleted either way. */
export function setAppEnabled(
  key: string,
  enabled: boolean,
): Promise<{ key: string; status: 'installing' | 'installed' | 'disabled' | 'error' }> {
  return api.post(`/api/v1/apps/${encodeURIComponent(key)}/${enabled ? 'enable' : 'disable'}`);
}

/** This app's hosts, all of them. Other apps' hosts are untouched. */
export function putAppDomains(
  key: string,
  domains: Record<string, { side: SurfaceSide; instance?: string }>,
): Promise<{ domains: Record<string, { side: SurfaceSide; instance?: string }> }> {
  return api.put(`/api/v1/apps/${encodeURIComponent(key)}/domains`, { domains });
}

/** Mirrors the jobs route's view of a download or refresh. */
export interface AppJobView {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: { pct: number; step?: string | null; message?: string | null } | null;
  lastError: string | null;
}

/** Poll cadence while a job runs. Exported so a suite can shorten it. */
export const APP_JOB_POLL_MS = 400;

/**
 * Follow a job to the end, reporting progress; resolves on success and throws
 * the job's own error otherwise.
 *
 * Polled rather than socket-subscribed, as the add-ons page does it: nothing to
 * tear down when the page unmounts mid-download, and testable without a socket.
 * Without following it, the page said "done" the moment a download was merely
 * QUEUED.
 */
export async function followAppJob(
  jobId: string,
  options: {
    onProgress: (progress: { pct: number; message: string | null }) => void;
    /** The sentence to throw when the job failed without saying why. */
    failed: string;
    pollMs?: number;
  },
): Promise<void> {
  for (;;) {
    const { data: job } = await api.get<{ data: AppJobView }>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}`,
    );
    options.onProgress({ pct: job.progress?.pct ?? 0, message: job.progress?.message ?? null });
    if (job.status === 'succeeded') return;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(job.lastError ?? options.failed);
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? APP_JOB_POLL_MS));
  }
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
 * The sha512 of a file, in Subresource-Integrity spelling (`sha512-<base64>`).
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
 * disk. An operator who HAS an independent one — every release publishes it —
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
  /**
   * The columns reused tables are missing, as plan 35's `addColumns` edit —
   * offered to the operator instead of a dead-end `COLUMNS_REQUIRED`. Absent
   * from a server older than the offer.
   */
  missingColumnsEdit?: MissingColumnsEdit;
  /**
   * The manifest's pages that will arrive without a table, or with one that
   * cannot back them. Never a refusal. Absent from an older server.
   */
  pageWarnings?: { page: string; code: string; message: string; table?: string }[];
  /**
   * The manifest's rules the install skips because they would show a column
   * a table it reuses keeps from readers. Never a refusal. Absent when none.
   */
  ruleWarnings?: { table: string; column: string; message: string }[];
  /** The app ships sample data, added once it is installed. Absent from an older server. */
  sampleData?: boolean;
  /**
   * What the app's customer screens may do through the public API, made at
   * install unless declined. Absent when the app asks for none.
   */
  publicAccess?: {
    endpoints: {
      ref: string;
      table: string;
      methods: string[];
      select: string[];
      writable: string[];
      claim: string[] | null;
      /** `availability` answers free or full per slot, never a row. Absent from an older server. */
      kind?: 'records' | 'availability';
      /** A guest's create here is confirmed by email. Absent from an older server. */
      confirms?: boolean;
      /** Answered by a later release: listed, not made now. */
      pending: boolean;
      issues: string[];
    }[];
    warnings: { code: string; message: string }[];
    /** Making the app's key needs the API keys permission. */
    canGrant: boolean;
  };
  /**
   * The plan's identity, read from the live database. Sent back with the
   * install, which refuses with 409 `SCHEMA_DRIFT` when the database changed
   * in between. Absent from an older server.
   */
  checksum?: string;
  /**
   * Each table's class, what installing does with it, what the check step
   * offers, and the safe edits a table the app uses as it is needs. Absent
   * from an older server.
   */
  tables?: PlannedAppTable[];
  /** Short name → real table. Absent from an older server. */
  names?: Record<string, string>;
  /** The add-ons the app names, each with its state, source and own plan. Absent for an app that names none. */
  addOns?: AppAddOnRow[];
  /**
   * The add-on settings the app's roles would be given (`addOn:<key>:settings`),
   * shown before anyone agrees: those settings are shared by every app the
   * add-on serves. Absent when none, and from an older server.
   */
  addOnGrants?: { role: string; roleName: string; addOn: string; grant: 'settings' }[];
}

export type TableClass = 'new' | 'own-leftover' | 'shared' | 'taken';
export type TableAction = 'create' | 'reuse' | 'share' | 'rename-existing' | 'undecided';
export type TableOffer = 'reuse' | 'share' | 'rename-existing' | 'alt-prefix';

/** Mirrors one entry of the server's plan `tables`. */
export interface PlannedAppTable {
  /** The manifest's short name. */
  ref: string;
  /** The real table: prefixed, recorded, or the short name itself. */
  table: string;
  class: TableClass;
  action: TableAction;
  offers: TableOffer[];
  /** Why using a taken table as it is would not work, for a person. */
  reuseRefusal?: string;
  renameExistingTo?: string;
  sharedWith?: string;
  /** From an earlier install that used the table it found rather than making it. */
  adopted?: true;
  edits: {
    kind: 'add-column' | 'widen' | 'set-identity' | 'enum-values';
    column: string;
    from?: string;
    to?: string;
    values?: string[];
  }[];
  blocked: { column: string; reason: string }[];
  columns: { ref: string; type: string }[];
}

/** What the operator decided on the check step. Sent with the plan and the install. */
export interface InstallAnswers {
  /** By short name: what to do with a table whose name is taken. */
  choices?: Record<string, { action: 'reuse' } | { action: 'share' } | { action: 'rename-existing'; to: string }>;
  /** A different prefix for all of the app's tables. */
  altPrefix?: string;
}

/** Mirrors the server's `MissingColumnsEdit` (`apps/server/src/apps/missing-columns.ts`). */
export interface MissingColumnsEdit {
  addColumns: { table: string; column: DesiredColumn }[];
  values: { table: string; column: string; values: string[] }[];
  blocked: { table: string; column: string; reason: 'foreign-key' | 'primary-key' | 'unsupported-type' }[];
}

/** What installing would do. Writes nothing — safe to call on every step-in. */
export function planApp(
  input: {
    key: string;
    version: string;
    connectionId: string;
  } & InstallAnswers,
): Promise<{ plan: AppInstallPlan }> {
  return api.post<{ plan: AppInstallPlan }>('/api/v1/apps/plan', input);
}

export interface InstalledAppResult extends InstalledApp {
  schema?: { created: string[]; reused: string[] };
  /** The manifest's pages, as the install wrote them. Absent from an older server. */
  pages?: { created: string[]; recomposed: string[]; kept: string[] };
  /** The public endpoints saved, and the guests' key if one was made. */
  publicAccess?: { endpoints: string[]; keyId: string | null; skipped: { ref: string; reason: string }[] };
  /** The add-ons installed, updated or connected with the app. Absent for an app that names none. */
  addOns?: AddOnsDone;
}

/**
 * The details of a 409 `APP_INSTALL_INCOMPLETE`: the step the install stopped
 * at, the tables it made before that, and the database's own words. Sending
 * the same install again finishes from there.
 */
export interface InstallStoppedDetails {
  stage: 'tables' | 'introspect' | 'pages' | 'finish' | string;
  table: string | null;
  created: string[];
  pending: string[];
  cause: string;
  /** What the add-on steps did before the stop: kept, and not redone by "Try again". */
  addOns?: AddOnsDone;
}

export function installApp(
  input: {
    key: string;
    version: string;
    connectionId?: string;
    /** The `checksum` of the plan the operator reviewed. */
    planChecksum?: string;
    /** False declines the public access the app asks for. */
    publicAccess?: boolean;
    /** The add-ons to install, connect or update with the app. */
    addOns?: AddOnChoice[];
  } & InstallAnswers,
): Promise<InstalledAppResult> {
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

/** Mirrors `uninstallPlanReply`: what an uninstall removes and keeps. */
export interface UninstallPlan {
  key: string;
  pages: { removed: { slug: string; title: string }[]; kept: { slug: string; title: string }[] };
  keys: number;
  endpoints: number;
  /** Deleting a role takes its members' membership and hard-deletes its `adm_sk_` keys. */
  roles: { slug: string; name: string; members: number; apiKeys: number }[];
  tables: { table: string; droppable: boolean }[];
  hosts: string[];
  /** Column rules the app wrote that are still as it wrote them. Absent from an older server. */
  rules?: number;
  /** Discarding data is Super Admin's alone. */
  canDropTables: boolean;
  /** The add-ons connected to the app: they stay installed, only their link to it goes. */
  addOns?: { key: string; name: string; version: string }[];
}

export function uninstallPlanQuery(key: string) {
  return queryOptions({
    queryKey: ['app-uninstall-plan', key] as const,
    queryFn: () => api.get<UninstallPlan>(`/api/v1/apps/${encodeURIComponent(key)}/uninstall-plan`),
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Uninstall. `dropTables` deletes the tables the app made (nothing it found
 * or shares), and needs the app's key typed back as `confirmKey`.
 */
export function uninstallApp(
  key: string,
  options: { dropTables?: boolean; confirmKey?: string } = {},
): Promise<{ key: string; uninstalled: boolean; dropped?: string[] }> {
  return api.delete<{ key: string; uninstalled: boolean; dropped?: string[] }>(
    `/api/v1/apps/${encodeURIComponent(key)}`,
    options.dropTables === true ? options : undefined,
  );
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
