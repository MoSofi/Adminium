// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `GET /api/v1/bootstrap` (09-generated-app.md §2.1,
 * 01-architecture.md §5): the one-round-trip boot payload — session user +
 * roles, server-resolved preference axes, the permission-filtered nav tree
 * derived from `adminium_pages`, and version/configVersion stamps.
 *
 * SYNC NOTE: the client-side mirror of these shapes lives in
 * `apps/dashboard/src/app/bootstrap.ts` (type-only copy — the dashboard may
 * not import server runtime code per the 01-architecture.md §2.3 matrix).
 * Change both together.
 */
import { z } from 'zod';

import { authUserView } from '../auth/schema.js';
import { mePrefsResolvedView } from '../me/schema.js';

/** The five fixed sidebar groups, in order (research/ia-mapping.md §2A). */
export const NAV_GROUP_KEYS = ['workspace', 'library', 'planning', 'people', 'account'] as const;

export const navGroupKey = z.enum(NAV_GROUP_KEYS);
export type NavGroupKey = z.infer<typeof navGroupKey>;

/** One sidebar entry (09-generated-app.md §2.2 NavTree item). */
export const bootstrapNavItem = z.object({
  pageId: z.string(),
  /** Unique kebab-case URL segment — the `/p/$slug` param. */
  slug: z.string(),
  /** i18n key (`nav.<slug>`); clients fall back to `fallback` until M8. */
  labelKey: z.string(),
  fallback: z.string(),
  /** lucide icon name. */
  icon: z.string(),
  /** Live badge source, resolved over WS (client concern). */
  badge: z.enum(['unread-count', 'pending-count']).optional(),
  order: z.number(),
  /** Owning connection (M5-T05): with 2+ connections the sidebar groups
   *  generated items under the connection's display name. Null = shared. */
  connectionId: z.string().nullable(),
  connectionName: z.string().nullable(),
  /** The page envelope's `source.table` (30-record-pages.md D5): feeds the
   *  client's (connectionId, table) → slug map so record pages can cross-link
   *  related rows. Null for source-less pages. */
  sourceTable: z.string().nullable(),
});
export type BootstrapNavItem = z.infer<typeof bootstrapNavItem>;

export const bootstrapNavTree = z.object({
  groups: z.array(z.object({ key: navGroupKey, items: z.array(bootstrapNavItem) })),
});
export type BootstrapNavTree = z.infer<typeof bootstrapNavTree>;

/**
 * One blended app section in the sidebar (29-app-surfaces.md D7).
 *
 * Labels arrive RESOLVED to the session's locale. The build emits all eight
 * (`surface.json` on disk), and resolving here rather than shipping the map is
 * the difference between a few hundred bytes and a few kilobytes on every cold
 * load, for seven languages the reader will never see.
 */
export const bootstrapHostedNavItem = z.object({
  id: z.string(),
  /** Path under `/a/<appKey>/`, no leading slash. May be empty (the root). */
  path: z.string(),
  label: z.string(),
  /** lucide icon name; absent means the sidebar's neutral glyph. */
  icon: z.string().optional(),
  /** A lens within the surface (28-T44) — its own row, not a permission. */
  persona: z.string().optional(),
});
export type BootstrapHostedNavItem = z.infer<typeof bootstrapHostedNavItem>;

export const bootstrapHostedApp = z.object({
  appKey: z.string(),
  /**
   * The instance slug, when this section is an extra tenant of the app (29 D9).
   * Absent on the app's own section — the unslugged mount — so an instance is
   * additive and nothing about the existing section changes.
   */
  instance: z.string().optional(),
  label: z.string(),
  items: z.array(bootstrapHostedNavItem),
});
export type BootstrapHostedApp = z.infer<typeof bootstrapHostedApp>;

export const bootstrapReply = z.object({
  data: z.object({
    user: authUserView,
    /** Role slugs for the session user (RBAC grants resolve server-side). */
    roles: z.array(z.string()),
    /** §7.2 resolved axes (system → global → user) + provenance. */
    prefs: mePrefsResolvedView,
    nav: bootstrapNavTree,
    /** Server build version (package.json). */
    version: z.string(),
    /** Monotonic config stamp — max(updatedAt) over adminium_pages; 0 when none. */
    configVersion: z.number(),
    /** `llm.enabled` gates the ⌘K "Ask AI" affordance (06-llm-assist.md). */
    llm: z.object({ enabled: z.boolean() }),
    /**
     * §7 item 4: the session-bound CSRF token every mutating call echoes in
     * `x-adminium-csrf` (security/csrf.ts). Issued here because this is the
     * one round trip the SPA is guaranteed to make before it can mutate
     * anything, and because it is session-bound — an anonymous surface has no
     * session to bind to, and `/bootstrap` already 401s for those visitors.
     */
    csrfToken: z.string(),
    /**
     * Hosted apps blended into this dashboard (29-app-surfaces.md D7/D9).
     *
     * Only STAFF surfaces, only those whose placement is `internal`, and only
     * those whose build emitted a readable `surface.json`. Empty on every
     * instance that hosts no surfaces, which is nearly all of them — the
     * sidebar renders nothing extra and the five fixed groups are untouched.
     */
    hostedApps: z.array(bootstrapHostedApp),
    /**
     * Pages hidden from the sidebar but very much alive (30-record-pages.md
     * follow-up): same item shape as the nav, no group. The dashboard resolves
     * `/p/<slug>` URLs, palette landings, and record-page related-tab specs
     * and cross-links through these exactly as through nav items — "hidden"
     * is a sidebar fact, not an existence fact. Cascade-owned child tables
     * (invoice items, …) generate straight into this list; Studio's "Hide
     * from sidebar" moves a page here; per-page view permission still filters
     * it, so a viewer without the grant sees the page nowhere at all.
     */
    hiddenPages: z.array(bootstrapNavItem),
    /**
     * Pages whose connection an operator PAUSED (meta wave 0019).
     *
     * Deliberately not merged into `hiddenPages`: that list is still
     * enumerable (record-page related tabs read its column specs and link to
     * its slugs), and a paused source must be enumerable by nothing. This list
     * exists for exactly one caller — the `/p/<slug>` URL resolver — so a
     * bookmark or an open tab lands on "This connection is paused" rather than
     * on a 404 that explains nothing.
     */
    pausedPages: z.array(bootstrapNavItem),
  }),
});
export type BootstrapReply = z.infer<typeof bootstrapReply>;
