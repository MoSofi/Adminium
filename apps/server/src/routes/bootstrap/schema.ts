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
});
export type BootstrapNavItem = z.infer<typeof bootstrapNavItem>;

export const bootstrapNavTree = z.object({
  groups: z.array(z.object({ key: navGroupKey, items: z.array(bootstrapNavItem) })),
});
export type BootstrapNavTree = z.infer<typeof bootstrapNavTree>;

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
  }),
});
export type BootstrapReply = z.infer<typeof bootstrapReply>;
