/**
 * About API client (M10-T04): GET /api/v1/about and /api/v1/about/update-check.
 * Shapes mirror apps/server src/routes/about/schema.ts (type-only copy per the
 * 01-architecture.md §2.3 matrix). Change both together.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

export type MetaEngine = 'postgres' | 'mysql' | 'sqlite';

export interface AboutData {
  version: string;
  license: string;
  sourceUrl: string;
  licenseUrl: string;
  metaEngine: MetaEngine;
  node: string;
  telemetry: { enabled: boolean };
  updates: { checkEnabled: boolean };
}

export type UpdateCheck =
  | { status: 'disabled' }
  | { status: 'current'; current: string }
  | { status: 'unknown'; current: string }
  | { status: 'update-available'; current: string; latest: string; url: string };

export const ABOUT_QUERY_KEY = ['about'] as const;
export const ABOUT_UPDATE_QUERY_KEY = ['about', 'update-check'] as const;

export function aboutQuery() {
  return queryOptions({
    queryKey: ABOUT_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: AboutData }>('/api/v1/about')).data,
  });
}

/**
 * The update check is a SEPARATE query from `aboutQuery` because it may make an
 * outbound call (only when `updates.checkEnabled` — the server returns
 * `disabled` and stays silent otherwise). Keeping it separate lets About paint
 * from local state immediately and lets the caller decide whether to run it at
 * all. `enabled` is threaded by the caller off `about.updates.checkEnabled`, so
 * an opted-out instance does not even issue the request.
 */
export function updateCheckQuery() {
  return queryOptions({
    queryKey: ABOUT_UPDATE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: UpdateCheck }>('/api/v1/about/update-check')).data,
    // The server caches for an hour; don't re-ask on every remount.
    staleTime: 3_600_000,
    retry: false,
  });
}
