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

// --- security (auth.*) ----------------------------------------------------------

/**
 * `GET|PUT /settings/security` — the enforced `auth.*` policy. Symmetric, like
 * branding: the GET returns exactly what the PUT takes, so the form binds the
 * reply directly.
 *
 * `auth.allowSignup` is absent on purpose and not an oversight: the route does
 * not accept it (there is no self-signup path to gate), so a fourth field here
 * would be a control that saves nothing.
 */
export interface SecuritySettings {
  sessionTtlHours: number;
  require2fa: boolean;
  passwordMinLength: number;
}

export const SECURITY_SETTINGS_QUERY_KEY = ['settings', 'security'] as const;

export function securitySettingsQuery() {
  return queryOptions({
    queryKey: SECURITY_SETTINGS_QUERY_KEY,
    queryFn: async () =>
      (await api.get<{ data: SecuritySettings }>('/api/v1/settings/security')).data,
  });
}

export async function putSecuritySettings(body: SecuritySettings): Promise<SecuritySettings> {
  return (await api.put<{ data: SecuritySettings }>('/api/v1/settings/security', body)).data;
}
