/**
 * Workspace-settings API client (M5-T05) — mirrors the Zod reply schemas in
 * `apps/server/src/routes/settings/schema.ts` (copied-mirror convention from
 * app/bootstrap.ts: change both together).
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

export interface WorkspaceBranding {
  appName: string;
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

export async function putWorkspaceBranding(body: WorkspaceBranding): Promise<WorkspaceSettingsData> {
  return (await api.put<{ data: WorkspaceSettingsData }>('/api/v1/settings/branding', body)).data;
}
