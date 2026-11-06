// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Global-defaults API client: GET/PUT /api/v1/settings/defaults. Shapes
 * mirror apps/server src/routes/settings/schema.ts (copied per the
 * matrix). The query key is invalidated by the realtime mapping on
 * `settings.defaults.updated` (src/api/realtime.ts).
 */
import { queryOptions } from '@tanstack/react-query';
import type { LocaleId } from '@adminium/i18n/registry';
import type { Accent, Density, ThemePref } from '@adminium/tokens';

import { api } from '../app/api.js';

export interface SettingsDefaultsValues {
  theme: ThemePref;
  accent: Accent;
  density: Density;
  locale: LocaleId;
}

export interface SettingsDefaultsData extends SettingsDefaultsValues {
  /** How the menu shows workspaces, for everyone. Absent from an older server. */
  workspaceView?: 'one' | 'all';
  adoption: {
    totalUsers: number;
    following: { theme: number; accent: number; density: number; locale: number };
  };
}

export const SETTINGS_DEFAULTS_QUERY_KEY = ['settings', 'defaults'] as const;

export function settingsDefaultsQuery() {
  return queryOptions({
    queryKey: SETTINGS_DEFAULTS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: SettingsDefaultsData }>('/api/v1/settings/defaults')).data,
  });
}

/** Full-object write — never a partial patch. The view of workspaces rides along only when given. */
export async function putSettingsDefaults(values: SettingsDefaultsValues & { workspaceView?: 'one' | 'all' }): Promise<SettingsDefaultsData> {
  return (await api.put<{ data: SettingsDefaultsData }>('/api/v1/settings/defaults', values)).data;
}

/**
 * The menu's view of workspaces, from the rail's switcher: the same server
 * setting as the Global defaults row. The route writes every axis at once, so
 * the four defaults are read first and sent back as they are.
 */
export async function putWorkspaceView(workspaceView: 'one' | 'all'): Promise<SettingsDefaultsData> {
  const current = (await api.get<{ data: SettingsDefaultsData }>('/api/v1/settings/defaults')).data;
  return putSettingsDefaults({ theme: current.theme, accent: current.accent, density: current.density, locale: current.locale, workspaceView });
}
