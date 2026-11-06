// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app of the project folder as a file (`/api/v1/project/apps/:key/pack`),
 * for Hosted apps and the Designer's Home alike.
 */
import { api } from '../app/api.js';

/** Mirrors `packAppReply`. */
export interface PackedAppFile {
  key: string;
  version: string;
  fileName: string;
  bytes: number;
  integrity: string;
  fileCount: number;
}

/** Check, build and pack a project app at `version` (never below its manifest's; a higher one is written back first). */
export function packProjectApp(key: string, version: string): Promise<PackedAppFile> {
  return api.post<PackedAppFile>(`/api/v1/project/apps/${encodeURIComponent(key)}/pack`, { version });
}

/** Where the packed file downloads from. */
export function packedFileUrl(key: string, version: string): string {
  return `/api/v1/project/apps/${encodeURIComponent(key)}/pack/${encodeURIComponent(version)}`;
}

/** The version the folder's app is at, read off the installed list (a folder app is installed from its folder). Null when it is not installed yet. */
export async function folderAppVersion(key: string): Promise<string | null> {
  const reply = await api.get<{ apps: { key: string; version: string; folder?: unknown }[] }>('/api/v1/apps');
  return reply.apps.find((app) => app.key === key && app.folder !== undefined)?.version ?? null;
}
