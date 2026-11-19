// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether an app's (or an add-on's) sample data is loaded: the one read the
 * banner on its pages needs.
 *
 * A module of its own, apart from `appsApi.ts`, because the page route's
 * loader starts this read beside the page document (`app/router.tsx`), and
 * the loader is in the entry chunk: this file is all of the Studio's apps API
 * the entry carries. Started there, the answer is in the cache before the
 * page's template draws, so the banner takes its place above the cards from
 * the first frame instead of arriving after them and pushing them down.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, installOptions } from '../../app/api.js';
import { holdsSystemAction, type BootstrapData, type NavItem } from '../../app/bootstrap.js';

export interface SampleCount {
  /** The table's short name in the app. */
  ref: string;
  count: number;
}

export interface SampleDataStatus {
  /** The app ships sample data. */
  offered: boolean;
  loaded: boolean;
  total: number;
  /** When it was added (epoch ms). */
  addedAt: number | null;
  tables: SampleCount[];
  /** What an add would write, while none is loaded. */
  available: { total: number; tables: SampleCount[]; assets: number } | null;
}

/** Whose sample data: an app's, or an add-on's that keeps tables of its own. The same four routes, under each one's own address. */
export type SampleOwnerKind = 'app' | 'add-on';

export const sampleDataUrl = (key: string, kind: SampleOwnerKind): string => `/api/v1/${kind === 'add-on' ? 'add-ons' : 'apps'}/${encodeURIComponent(key)}/sample-data`;

export const sampleDataKey = (key: string, kind: SampleOwnerKind = 'app', install: string | null = null) => [kind === 'add-on' ? 'add-on-sample-data' : 'app-sample-data', key, install] as const;

/**
 * Fresh for half a minute: the loader's answer is the one the banner then
 * mounts with, not a second request made as it mounts. An add or a remove
 * marks it stale at once (`refreshSampleData`), so this only spares the reads
 * between one page of the app and the next.
 */
export function sampleDataQuery(key: string, kind: SampleOwnerKind = 'app', install: string | null = null) {
  return queryOptions({
    queryKey: sampleDataKey(key, kind, install),
    queryFn: () => api.get<SampleDataStatus>(sampleDataUrl(key, kind), installOptions(install)),
    staleTime: 30_000,
  });
}

/**
 * Whose banner a page shows: an add-on's generated page names its add-on (and
 * no app), an app's page names its app. Null for a page of neither, and for
 * anyone who cannot manage apps, who is never shown the banner and never asks.
 */
export function sampleBannerOwner(bootstrap: BootstrapData, item: NavItem | null): { kind: SampleOwnerKind; key: string } | null {
  if (item === null || !holdsSystemAction(bootstrap, 'manifests.manage')) return null;
  if (item.addOnKey != null) return { kind: 'add-on', key: item.addOnKey };
  if (item.appKey != null) return { kind: 'app', key: item.appKey };
  return null;
}
