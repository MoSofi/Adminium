// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bootstrap query + types (09-generated-app.md §2.1–§2.2): the one round trip
 * that primes the shell — session user, resolved preference axes, the nav
 * tree, and version/configVersion stamps. Held under `['bootstrap']` with
 * `staleTime: Infinity`; WS `config-changed` invalidates it (app/ws.ts).
 *
 * SYNC NOTE: these shapes mirror the Zod reply schema in
 * `apps/server/src/routes/bootstrap/schema.ts` (the dashboard imports server
 * types type-only-or-copied per the 01-architecture.md §2.3 matrix — until an
 * `@adminium/server/api-types` subpath ships, this is the copied mirror).
 * Change both together.
 */
import { queryOptions } from '@tanstack/react-query';
import type { Accent, Density, Dir, ThemePref } from '@adminium/tokens';
import type { Locale } from '@adminium/ui';

import { api, ApiError, setCsrfToken } from './api.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  status: 'active' | 'invited' | 'suspended';
  totpEnabled: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** The five fixed sidebar groups, in order (research/ia-mapping.md §2A). */
export const NAV_GROUP_KEYS = ['workspace', 'library', 'planning', 'people', 'account'] as const;
export type NavGroupKey = (typeof NAV_GROUP_KEYS)[number];

export interface NavItem {
  pageId: string;
  slug: string;
  labelKey: string;
  fallback: string;
  /** lucide icon name (kebab-case). */
  icon: string;
  badge?: 'unread-count' | 'pending-count';
  order: number;
  /**
   * Owning connection (M5-T05): with 2+ connections the sidebar sub-labels
   * items by connection display name. Optional — older fixtures omit it.
   */
  connectionId?: string | null;
  connectionName?: string | null;
}

export interface NavTree {
  groups: Array<{ key: NavGroupKey; items: NavItem[] }>;
}

type PrefSource = 'system' | 'global' | 'user';

/** §7.2 server-resolved axes + per-axis provenance. */
export interface ResolvedPrefs {
  theme: ThemePref;
  accent: Accent;
  density: Density;
  locale: Locale;
  dir: Dir;
  source: { theme: PrefSource; accent: PrefSource; density: PrefSource; locale: PrefSource; dir: PrefSource };
}

export interface BootstrapData {
  user: SessionUser;
  roles: string[];
  prefs: ResolvedPrefs;
  nav: NavTree;
  version: string;
  configVersion: number;
  llm: { enabled: boolean };
  /**
   * §7 item 4 — the session-bound CSRF token every mutating call echoes in
   * `x-adminium-csrf`. Optional here only so fixtures predating it keep
   * typechecking; the server always sends it (the field is required in the
   * Zod reply schema).
   */
  csrfToken?: string;
}

/** Never retry auth failures — they mean "go to /login", not "try harder". */
function retryBootstrap(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function bootstrapQuery() {
  return queryOptions({
    queryKey: ['bootstrap'] as const,
    staleTime: Infinity,
    retry: retryBootstrap,
    queryFn: async () => {
      const { data } = await api.get<{ data: BootstrapData }>('/api/v1/bootstrap');
      // The single writer of the CSRF holder every mutating call site reads
      // (app/api.ts). Here rather than in a component because the four call
      // sites that bypass `api` are not inside the React tree's data flow,
      // and because this query is the one thing guaranteed to run before the
      // shell can mutate anything.
      setCsrfToken(data.csrfToken ?? null);
      return data;
    },
  });
}

/** All nav items in group order — palette/Navigate, G-chords, 404 chips. */
export function flattenNav(nav: NavTree): NavItem[] {
  return nav.groups.flatMap((group) => group.items);
}

export function findNavItemBySlug(nav: NavTree, slug: string): NavItem | null {
  return flattenNav(nav).find((item) => item.slug === slug) ?? null;
}

/**
 * `/` redirect target (09 §2.3): the first Workspace nav item, else the first
 * item anywhere; `null` when the nav is empty (zero connections → the
 * `empty-no-sources` home state until `/welcome` lands in Wave B).
 */
export function defaultPageSlug(nav: NavTree): string | null {
  const workspace = nav.groups.find((group) => group.key === 'workspace');
  const first = workspace?.items[0] ?? flattenNav(nav)[0];
  return first?.slug ?? null;
}
