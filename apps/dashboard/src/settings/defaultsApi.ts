/**
 * Global-defaults API client (10-i18n-theming.md §7.2): GET/PUT
 * /api/v1/settings/defaults. Shapes mirror apps/server
 * src/routes/settings/schema.ts (copied per the 01-architecture.md §2.3
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

/** Full-object write (§7.2) — never a partial patch. */
export async function putSettingsDefaults(values: SettingsDefaultsValues): Promise<SettingsDefaultsData> {
  return (await api.put<{ data: SettingsDefaultsData }>('/api/v1/settings/defaults', values)).data;
}
