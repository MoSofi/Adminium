// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings → Maps, on the wire: `GET|PUT /api/v1/settings/maps` — mirrors
 * `settingsMapsReply` in `apps/server/src/routes/settings/schema.ts`
 * (copied-mirror convention from app/bootstrap.ts: change both together).
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

export interface MapsSettings {
  /** The "Show maps" switch as it is stored. On until somebody says no. */
  enabled: boolean;
  /** The "Routes along roads" switch. Off until somebody says yes. */
  routing: boolean;
  /** `ADMINIUM_MAP_SERVER`; null when it is `off`. */
  mapServer: string | null;
  /** The operator switched maps off for this install: the switch does nothing. */
  mapServerOff: boolean;
  /** `ADMINIUM_ROUTING_SERVER`; null when it is `off` or outside calls are off. */
  routingServer: string | null;
  routingServerOff: boolean;
  /** `desktop` shows no outside map whatever the switches say. */
  runtime: 'self-host' | 'desktop';
}

export const MAPS_SETTINGS_QUERY_KEY = ['settings', 'maps'] as const;

export function mapsSettingsQuery() {
  return queryOptions({
    queryKey: MAPS_SETTINGS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: MapsSettings }>('/api/v1/settings/maps')).data,
  });
}

export async function putMapsSettings(body: { enabled?: boolean; routing?: boolean }): Promise<MapsSettings> {
  return (await api.put<{ data: MapsSettings }>('/api/v1/settings/maps', body)).data;
}

/** Whether a map is really drawn: the switch, and nothing above it saying no. */
export function mapsShown(settings: MapsSettings): boolean {
  return settings.enabled && !settings.mapServerOff && settings.runtime !== 'desktop';
}
