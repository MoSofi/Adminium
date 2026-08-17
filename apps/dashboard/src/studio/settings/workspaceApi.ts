// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspace-settings API client (M5-T05) — mirrors the Zod reply schemas in
 * `apps/server/src/routes/settings/schema.ts` (copied-mirror convention from
 * app/bootstrap.ts: change both together).
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

/** The fields an admin TYPES — exactly what `PUT /settings/branding` takes. */
export interface WorkspaceBrandingInput {
  appName: string;
  showVersion: boolean;
}

/** What the form READS back: the typed fields plus the resolved logo. */
export interface WorkspaceBranding extends WorkspaceBrandingInput {
  logoUrl: string | null;
}

export interface WorkspaceSettingsData {
  branding: WorkspaceBranding;
}

export const WORKSPACE_SETTINGS_QUERY_KEY = ['settings', 'workspace'] as const;

export function workspaceSettingsQuery() {
  return queryOptions({
    queryKey: WORKSPACE_SETTINGS_QUERY_KEY,
    queryFn: async () =>
      (await api.get<{ data: WorkspaceSettingsData }>('/api/v1/settings/workspace')).data,
  });
}

export async function putWorkspaceBranding(
  body: WorkspaceBrandingInput,
): Promise<WorkspaceSettingsData> {
  return (await api.put<{ data: WorkspaceSettingsData }>('/api/v1/settings/branding', body)).data;
}
