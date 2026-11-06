// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspace files: saving a workspace as one file of its apps, and
 * installing one, as the server's routes speak them.
 *
 *  - `POST /workspaces/:id/save/plan` and `POST /workspaces/:id/save`, and
 *    `GET /workspaces/save/:id/file` for "Download again";
 *  - `GET /apps/saves` (`workspaces[]`) for the saves made here;
 *  - `POST /apps/upload-workspace`, `GET /apps/workspace-files`,
 *    `GET|POST|DELETE /apps/workspace/:id/install`.
 */
import { queryOptions } from '@tanstack/react-query';

import { ApiError, api, csrfHeaders } from '../../../app/api.js';
import type { InstallAnswers, UpdateAnswers } from '../appsApi.js';

/** One Check item of an app's save, as Save as app's plan gives it. */
export interface SaveCheckItem {
  group: 'choice' | 'after' | 'info';
  code: string;
  kind: string;
  item: string;
  field?: string;
  message: string;
  answer?: { choices: readonly string[]; target: string };
  afterKind?: string;
}

export interface SavePlan {
  key: string;
  version: string;
  lineage: 'new' | 'kept';
  label: string;
  minAdminiumVersion: string;
  ready: boolean;
  check: SaveCheckItem[];
  problems: { code: string; message: string; path?: string }[];
  counts: Record<string, number>;
}

/** One app of a workspace file, as the dialog sends it: Save as app's body without the label. */
export interface WorkspaceAppRequest {
  connectionId: string;
  key: string;
  name: string;
  version?: string;
  /** Save as app's About step, when "More choices" set them. */
  description?: string;
  icon?: string;
  include?: Record<string, unknown>;
  rows?: Record<string, { mode: 'none' | 'starting' | 'sample'; viewId?: string }>;
  answers?: Record<string, string[]>;
}

export interface WorkspaceSaveRequest {
  label?: string;
  /** The database whose server settings travel with its app; none when null. */
  instanceFrom?: string | null;
  apps?: WorkspaceAppRequest[];
}

export interface WorkspaceAppPlan {
  connectionId: string;
  database: { name: string; engine: string };
  key: string;
  name: string;
  /** The version this database's app was last saved at; null for a first save. */
  lastSaved: string | null;
  plan: SavePlan;
}

export interface WorkspaceSavePlan {
  workspaceId: string;
  name: string;
  label: string;
  filename: string;
  minAdminiumVersion: string;
  ready: boolean;
  instanceFrom: string | null;
  apps: WorkspaceAppPlan[];
  workspaces: string[];
}

export interface SavedWorkspaceFile {
  id: string;
  name: string;
  filename: string;
  integrity: string;
  bytes: number;
  savedAt: number;
  apps: { key: string; version: string; integrity: string; bytes: number }[];
}

export function planWorkspaceSave(workspaceId: string, body: WorkspaceSaveRequest): Promise<{ plan: WorkspaceSavePlan }> {
  return api.post<{ plan: WorkspaceSavePlan }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/save/plan`, body);
}

export function saveWorkspace(workspaceId: string, body: WorkspaceSaveRequest): Promise<{ save: SavedWorkspaceFile }> {
  return api.post<{ save: SavedWorkspaceFile }>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/save`, body);
}

/** Where "Download again" fetches a saved workspace file: a plain link, the session cookie goes with it. */
export function workspaceSaveFileHref(id: string): string {
  return `/api/v1/workspaces/save/${encodeURIComponent(id)}/file`;
}

/** A workspace file saved here, as the saves list names it. */
export interface WorkspaceSaveRow {
  id: string;
  workspaceId: string | null;
  name: string;
  label: string;
  savedBy: string | null;
  savedAt: number;
  integrity: string;
  bytes: number;
  appSaveIds: string[];
  /** The file's name, as "Download again" gives it. */
  filename: string;
}

/** The saves made here. `saves` is Save as app's; `workspaces` is this module's. */
export interface AppSavesReply {
  saves: { id: string; key: string; version: string; connectionId: string | null; label: string; savedBy: string | null; savedAt: number; integrity: string; bytes: number; downloadable: boolean }[];
  workspaces?: WorkspaceSaveRow[];
}

export const APP_SAVES_QUERY_KEY = ['app-saves'] as const;

export function appSavesQuery() {
  return queryOptions({ queryKey: APP_SAVES_QUERY_KEY, queryFn: () => api.get<AppSavesReply>('/api/v1/apps/saves') });
}

// ── Installing ─────────────────────────────────────────────────────────────

export type WorkspaceAppState = 'pending' | 'installed' | 'updated' | 'refused' | 'stopped';

export interface WorkspaceFileApp {
  key: string;
  name: string;
  version: string;
  integrity: string;
  database: { name: string; engine: string } | null;
  suggested: string | null;
  sides: string[];
  target: string | null;
  state: WorkspaceAppState;
  refusal: { reason: string; message: string } | null;
  route: 'install' | 'update' | 'install-another';
  installs: { installId: string; connectionId: string | null; connectionName: string; version: string }[];
}

export interface WorkspaceFile {
  id: string;
  name: string;
  label: string | null;
  savedAt: string | null;
  adminiumVersion: string | null;
  minAdminiumVersion: string;
  integrity: string;
  state: 'staged' | 'running' | 'stopped' | 'done' | 'discarded';
  workspace: { mode: 'create' | 'existing' | 'none'; workspaceId?: string; name?: string } | null;
  apps: WorkspaceFileApp[];
  createdAt: number;
  updatedAt: number;
}

export type WorkspaceChoice = { mode: 'create'; name: string } | { mode: 'existing'; workspaceId: string } | { mode: 'none' };

export interface WorkspaceInstallBody {
  workspace?: WorkspaceChoice;
  apps: { key: string; connectionId: string | null; install?: InstallAnswers & { planChecksum?: string; publicAccess?: boolean }; update?: UpdateAnswers }[];
}

export const WORKSPACE_FILES_QUERY_KEY = ['workspace-files'] as const;

/** The workspace files staged here and not finished: what "Install the rest" comes back to after a reload. */
export function workspaceFilesQuery() {
  return queryOptions({
    queryKey: WORKSPACE_FILES_QUERY_KEY,
    queryFn: async () => (await api.get<{ workspaceFiles: WorkspaceFile[] }>('/api/v1/apps/workspace-files')).workspaceFiles,
  });
}

export async function readWorkspaceFile(id: string): Promise<WorkspaceFile> {
  return (await api.get<{ workspaceFile: WorkspaceFile }>(`/api/v1/apps/workspace/${encodeURIComponent(id)}/install`)).workspaceFile;
}

export async function installWorkspaceFile(id: string, body: WorkspaceInstallBody): Promise<WorkspaceFile> {
  return (await api.post<{ workspaceFile: WorkspaceFile }>(`/api/v1/apps/workspace/${encodeURIComponent(id)}/install`, body)).workspaceFile;
}

export async function discardWorkspaceFile(id: string): Promise<WorkspaceFile> {
  return (await api.delete<{ workspaceFile: WorkspaceFile }>(`/api/v1/apps/workspace/${encodeURIComponent(id)}/install`)).workspaceFile;
}

/**
 * Send a workspace file. Not routed through `api`, which is JSON-only: the
 * route takes the file as a raw body, so the CSRF header is set by hand.
 */
export async function uploadWorkspaceFile(file: Blob, expectedSha512: string): Promise<WorkspaceFile> {
  const response = await fetch(`/api/v1/apps/upload-workspace?${new URLSearchParams({ expectedSha512 }).toString()}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/octet-stream', ...csrfHeaders() },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as ({ workspaceFile?: WorkspaceFile } & { error?: { code?: unknown; message?: unknown; details?: unknown } }) | null;
  if (!response.ok || body?.workspaceFile === undefined) {
    throw new ApiError(
      response.status,
      typeof body?.error?.code === 'string' ? body.error.code : 'UPLOAD_FAILED',
      typeof body?.error?.message === 'string' ? body.error.message : `Upload failed with status ${String(response.status)}.`,
      null,
      body?.error?.details,
    );
  }
  return body.workspaceFile;
}

/** The reason code an error carries in its details, for a refusal that is said in words. */
export function reasonOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const reason = (error.details as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' ? reason : null;
}

/** Whether `/apps/upload` said the file is a workspace file, to be sent again to its own route. */
export function isWorkspaceFileRefusal(error: unknown): boolean {
  return reasonOf(error) === 'IS_WORKSPACE_FILE';
}
