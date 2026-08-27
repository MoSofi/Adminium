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
  /**
   * The page envelope's `source.table` (30-record-pages.md D5) — feeds
   * {@link slugForTable} so record pages can cross-link related rows to the
   * page that shows their table. Optional for fixtures predating it; the
   * server always sends it (null for source-less pages).
   */
  sourceTable?: string | null;
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

/**
 * One row of a blended app's sidebar section (29-app-surfaces.md D7).
 *
 * `label` arrives already resolved to this session's locale — the build emits
 * all eight into `surface.json` and the server picks one, so nothing here has
 * to know about the app's own i18n.
 */
export interface HostedNavItem {
  id: string;
  /** Path under `/a/<appKey>/`, no leading slash. May be empty (the root). */
  path: string;
  label: string;
  /** lucide icon name; absent means the sidebar's neutral glyph. */
  icon?: string;
  /** A lens within the surface — its own row, not a permission (28-T44). */
  persona?: string;
}

/** A hosted app blended into this dashboard's sidebar (29-app-surfaces.md D9). */
export interface HostedApp {
  appKey: string;
  /** Instance slug when this section is an extra tenant (29 D9); absent on the app's own. */
  instance?: string;
  label: string;
  items: HostedNavItem[];
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
  /**
   * Hosted apps blended into the sidebar (29-app-surfaces.md D7).
   *
   * Optional here only so fixtures predating the field keep typechecking; the
   * server always sends it, as `[]` on the overwhelming majority of instances.
   * Read through {@link hostedAppsOf} rather than directly, so no call site has
   * to repeat the `?? []`.
   */
  hostedApps?: HostedApp[];
  /**
   * Pages hidden from the sidebar but alive (30-record-pages.md follow-up):
   * Studio's "Hide from sidebar" and the generated cascade-child default both
   * land pages here. Same shape as nav items, no group. Everything that
   * RESOLVES pages — the `/p/$slug` loader, topbar titles, record-page
   * related tabs — reads {@link findPageBySlug} / {@link slugForTable}, which
   * consult this list too; everything that LISTS pages (sidebar, palette
   * Navigate, G-chords) stays on the nav tree, which is the entire point of
   * hiding. Optional only so fixtures predating it keep typechecking; the
   * server always sends it.
   */
  hiddenPages?: NavItem[];
  /**
   * Pages whose connection an operator PAUSED (meta wave 0019).
   *
   * Not a third flavour of `hiddenPages`, and the difference is the whole
   * reason it is its own field: a hidden page is still ENUMERABLE — related
   * tabs read its column specs, cross-links resolve its slug — while a paused
   * page must be enumerable by nothing, because the source behind it is off.
   *
   * So exactly one caller reads it: {@link findPageBySlug}, which answers a
   * URL somebody already has. A bookmark or a tab left open when the pause
   * landed resolves through here and renders the `connection-paused` state
   * instead of a 404 — the page has not gone, its database has. Nothing that
   * OFFERS a page (sidebar, palette, related tabs, {@link slugForTable}) may
   * consult it.
   */
  pausedPages?: NavItem[];
}

/** The blended apps, never undefined — see the field's note. */
export function hostedAppsOf(bootstrap: BootstrapData): HostedApp[] {
  return bootstrap.hostedApps ?? [];
}

/** The hidden pages, never undefined — see the field's note. */
export function hiddenPagesOf(bootstrap: BootstrapData): NavItem[] {
  return bootstrap.hiddenPages ?? [];
}

/** The paused-connection pages, never undefined — see the field's note. */
export function pausedPagesOf(bootstrap: BootstrapData): NavItem[] {
  return bootstrap.pausedPages ?? [];
}

/** A blended app by key, or null — the `/a/$appKey` route's resolver. */
export function hostedAppByKey(bootstrap: BootstrapData, appKey: string): HostedApp | null {
  return hostedAppsOf(bootstrap).find((app) => app.appKey === appKey) ?? null;
}

/**
 * Which nav item a path is inside — longest match, the same rule the app's own
 * router uses, so the sidebar highlight and the framed screen never disagree.
 *
 * Lives HERE, not beside the frame that also uses it, for one measured reason:
 * `SidebarNav` is in the entry chunk and `AppSurfacePage` is lazy, so importing
 * this from there would drag the page, the frame and everything they import
 * back into the synchronous set — silently undoing the laziness the
 * entry-budget gate exists to enforce. A pure function over the bootstrap shape
 * belongs in the bootstrap module anyway.
 *
 * A path under NO item resolves to null. That is normal: the nav is what the
 * sidebar offers, not an allow-list of what the app may show, and a detail
 * screen the app does not list still renders.
 */
export function activeHostedItem(app: HostedApp, path: string): HostedNavItem | null {
  let best: HostedNavItem | null = null;
  for (const item of app.items) {
    if (item.path !== path && !path.startsWith(`${item.path}/`)) continue;
    if (best === null || item.path.length > best.path.length) best = item;
  }
  return best;
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
 * A page by slug — nav items first, then hidden pages. This is the RESOLUTION
 * helper (the `/p/$slug` loader, topbar titles, record bindings): a page
 * hidden from the sidebar still answers its URL, still titles its tab, and
 * still lends its column specs to a parent's related tab. Listing surfaces
 * keep using {@link findNavItemBySlug} — offering hidden pages in the rail or
 * the palette would un-hide them.
 *
 * Paused pages resolve here too, and LAST. Nothing offers them any more, so
 * the only way to arrive at one is to already hold its URL — a bookmark, or a
 * tab that was open when the pause landed. Refusing to resolve it would turn
 * "your admin switched this database off" into "no such page", which sends the
 * reader looking for a page that is sitting right where they left it.
 */
export function findPageBySlug(bootstrap: BootstrapData, slug: string): NavItem | null {
  return (
    findNavItemBySlug(bootstrap.nav, slug) ??
    hiddenPagesOf(bootstrap).find((item) => item.slug === slug) ??
    pausedPagesOf(bootstrap).find((item) => item.slug === slug) ??
    null
  );
}

/**
 * The slug of the page showing `table` on `connectionId`, or null
 * (30-record-pages.md D5): record pages link related-tab rows to the page
 * that shows their table; a table with no page renders un-linked (honest
 * degradation, no dead affordance). Hidden pages count — a cascade-owned
 * child's page IS its rows' record-page home even though the sidebar does not
 * list it. First match wins on the (rare) duplicate — nav order is the
 * user-facing precedence, and nav beats hidden.
 */
export function slugForTable(
  bootstrap: BootstrapData,
  connectionId: string | null,
  table: string,
): string | null {
  // A linear scan, deliberately: the nav holds tens of items, callers fire on
  // clicks and tab activations, and this module is in the ENTRY set — map
  // machinery and a WeakMap cache cost real ratcheted bytes to save nothing
  // measurable (check-entry-budget, 30 D8).
  for (const item of [...flattenNav(bootstrap.nav), ...hiddenPagesOf(bootstrap)]) {
    if ((item.sourceTable ?? null) === table && (item.connectionId ?? null) === connectionId) {
      return item.slug;
    }
  }
  return null;
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
