/**
 * Per-user preference API client (10-i18n-theming.md §7.2):
 * `GET /api/v1/me/prefs` → raw nullable overrides + server-resolved axes;
 * `PATCH /api/v1/me/prefs` with explicit `null` clearing an axis back to
 * "inherit the workspace default". Shapes mirror apps/server
 * src/routes/me/schema.ts (copied per the 01-architecture.md §2.3 matrix).
 */
import { queryOptions } from '@tanstack/react-query';
import type { Accent, Density, Dir, ThemePref } from '@adminium/tokens';
import type { Locale } from '@adminium/ui';

import { api } from '../app/api.js';
import type { ResolvedPrefs } from '../app/bootstrap.js';

/** Raw per-user row: `null` = inherit the workspace/system default. */
export interface RawUserPrefs {
  theme: ThemePref | null;
  accent: Accent | null;
  density: Density | null;
  locale: Locale | null;
  dir: Dir | null;
}

export interface MePrefsData {
  prefs: RawUserPrefs;
  resolved: ResolvedPrefs;
}

/** Absent = unchanged; explicit `null` = reset to workspace default (§7.2). */
export type MePrefsPatch = Partial<{
  theme: ThemePref | null;
  accent: Accent | null;
  density: Density | null;
  locale: Locale | null;
}>;

export const ME_PREFS_QUERY_KEY = ['me', 'prefs'] as const;

export function mePrefsQuery() {
  return queryOptions({
    queryKey: ME_PREFS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: MePrefsData }>('/api/v1/me/prefs')).data,
  });
}

export async function patchMePrefs(patch: MePrefsPatch): Promise<MePrefsData> {
  return (await api.patch<{ data: MePrefsData }>('/api/v1/me/prefs', patch)).data;
}
