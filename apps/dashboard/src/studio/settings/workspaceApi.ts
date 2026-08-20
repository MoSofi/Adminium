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

// --- email / SMTP (email.smtp) --------------------------------------------------

/**
 * `GET|PUT /settings/email` — the transport password resets, user invites, the
 * notification `email` channel and scheduled reports all dial. The ONE
 * asymmetric pair in this file: the GET never returns a password in any form
 * (not masked, not a last-4), so the read shape and the write shape are
 * different types rather than one reused interface.
 */
export interface EmailSettings {
  /** `email.smtp` is set. The other fields are null exactly when this is false. */
  configured: boolean;
  host: string | null;
  port: number | null;
  user: string | null;
  from: string | null;
  secure: boolean | null;
}

/**
 * What `PUT /settings/email` takes as `{ smtp }`. `pass` is OPTIONAL and that
 * is the feature: absent keeps the stored password, so changing a port does not
 * make an admin retype a production secret; an empty string clears it.
 */
export interface EmailSettingsInput {
  host: string;
  port: number;
  user: string;
  pass?: string;
  from: string;
  secure: boolean;
}

export const EMAIL_SETTINGS_QUERY_KEY = ['settings', 'email'] as const;

export function emailSettingsQuery() {
  return queryOptions({
    queryKey: EMAIL_SETTINGS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: EmailSettings }>('/api/v1/settings/email')).data,
  });
}

/** `null` clears the configuration — the route's own way of spelling "no relay". */
export async function putEmailSettings(smtp: EmailSettingsInput | null): Promise<EmailSettings> {
  return (await api.put<{ data: EmailSettings }>('/api/v1/settings/email', { smtp })).data;
}
