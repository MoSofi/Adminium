// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `GET /api/v1/bootstrap`: the one-round-trip boot payload
 * — session user + roles, server-resolved preference axes, the
 * permission-filtered nav tree derived from `adminium_pages`, and
 * version/configVersion stamps.
 *
 * SYNC NOTE: the client-side mirror of these shapes lives in
 * `apps/dashboard/src/app/bootstrap.ts` (type-only copy — the dashboard may
 * not import server runtime code per the matrix). Change both together.
 */
import { BUILTIN_NAV_GROUP_KEYS } from '@adminium/add-on-contracts';
import { z } from 'zod';

import { authUserView } from '../auth/schema.js';
import { mePrefsResolvedView } from '../me/schema.js';

/**
 * The five built-in sidebar groups, in rail order.
 *
 * RE-EXPORTED, NOT RE-TYPED (51b). The list is `BUILTIN_NAV_GROUP_KEYS` in
 * `@adminium/add-on-contracts`, because an add-on manifest is validated against
 * it there and the rail is rendered from it here: a key in one and not the
 * other would be a page that installs cleanly and never appears. The name
 * stays `NAV_GROUP_KEYS` so nothing downstream moves.
 *
 * It is still a CLOSED set for GENERATED pages — a page a person builds in
 * Studio goes in one of these five and nowhere else. What opens here is a
 * separate axis: an add-on may bring a group of its own, and those ride
 * `addOnNav.groups` below rather than widening this enum.
 */
export const NAV_GROUP_KEYS = BUILTIN_NAV_GROUP_KEYS;


export const navGroupKey = z.enum(NAV_GROUP_KEYS);
export type NavGroupKey = z.infer<typeof navGroupKey>;

/** One sidebar entry (NavTree item). */
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
  /** Owning connection: with 2+ connections the sidebar groups
   *  generated items under the connection's display name. Null = shared. */
  connectionId: z.string().nullable(),
  connectionName: z.string().nullable(),
  /**
   * The owning connection's ISO-4217 currency: money cells on this page's grid
   * and record view format with it instead of the `USD` fallback every money
   * cell in the product has been using. Null = unset, and unset renders
   * exactly what it renders today.
   *
   * It rides the NAV ITEM rather than a separate connections payload because
   * that is the object the client already resolves a page through — a page is
   * looked up by slug here and rendered from what this row carries.
   */
  currency: z.string().nullable(),
  /** The page envelope's `source.table`: feeds the
   *  client's (connectionId, table) → slug map so record pages can cross-link
   *  related rows. Null for source-less pages. */
  sourceTable: z.string().nullable(),
  /** The installed app whose page this is; null for everyone else's pages. */
  appKey: z.string().nullable(),
});
export type BootstrapNavItem = z.infer<typeof bootstrapNavItem>;

export const bootstrapNavTree = z.object({
  groups: z.array(z.object({ key: navGroupKey, items: z.array(bootstrapNavItem) })),
});
export type BootstrapNavTree = z.infer<typeof bootstrapNavTree>;

/**
 * An add-on's rail rows and the groups it brings for them (51b).
 *
 * WHY A SEPARATE BRANCH AND NOT `nav.groups`. `nav` is the permission-filtered
 * tree derived from `adminium_pages`; every item there has a `pageId`, a slug
 * and a connection. An add-on page has none of those — it is a module in a
 * package — and stuffing it into the same array would mean a nav item whose
 * `pageId` is a lie and whose `slug` resolves to nothing.
 *
 * LABELS ARE NOT RESOLVED HERE, unlike `bootstrapHostedApp`. A hosted app's
 * label comes from a `surface.json` this server reads at boot; an add-on's
 * comes from a catalogue that ships INSIDE the add-on's bundle, which the
 * server does not render (the same sentence the add-on list route already
 * carries). So the wire carries `labelKey` + `fallback`, exactly as a generated
 * nav item does, and the rail calls `t()`. The consequence, stated rather than
 * discovered: until the add-on's catalogue is merged into the client's i18n,
 * a non-English rail shows the English fallback for these rows. 51d's O4 ruling
 * decides when that merge happens.
 */
const addOnNavGroupKey = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'a nav group key must be kebab-case, 1\u201340 characters');

export const bootstrapAddOnPage = z.object({
  /** The add-on that owns it; `/add-ons/<addOnKey>/<ref>`. */
  addOnKey: z.string(),
  ref: z.string(),
  labelKey: z.string(),
  fallback: z.string(),
  icon: z.string(),
  /**
   * The module path inside the add-on's package — the manifest's
   * `pages[].client`. The host pairs it with the add-on list reply's `bundles`
   * to get the URL and the integrity to pin; it is here because the rail
   * already carries everything else about the page, and a second round trip to
   * learn one string would be a round trip on every mount.
   */
  client: z.string(),
  /** Built-in or add-on-declared; already resolved (`library` when omitted). */
  group: addOnNavGroupKey,
  order: z.number(),
  adminOnly: z.boolean(),
  /** The page owns `/add-ons/<key>/<ref>/*` as well as its own path. */
  detail: z.boolean(),
});
export type BootstrapAddOnPage = z.infer<typeof bootstrapAddOnPage>;

export const bootstrapAddOnGroup = z.object({
  key: addOnNavGroupKey,
  labelKey: z.string(),
  fallback: z.string(),
  order: z.number(),
  /** The add-on that declared it, for a support answer about a stray heading. */
  addOnKey: z.string(),
});
export type BootstrapAddOnGroup = z.infer<typeof bootstrapAddOnGroup>;

export const bootstrapAddOnNav = z.object({
  groups: z.array(bootstrapAddOnGroup),
  pages: z.array(bootstrapAddOnPage),
});
export type BootstrapAddOnNav = z.infer<typeof bootstrapAddOnNav>;


/**
 * One blended app section in the sidebar.
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
  /** A lens within the surface — its own row, not a permission. */
  persona: z.string().optional(),
});
export type BootstrapHostedNavItem = z.infer<typeof bootstrapHostedNavItem>;

export const bootstrapHostedApp = z.object({
  appKey: z.string(),
  /**
   * The instance slug, when this section is an extra tenant of the app. Absent
   * on the app's own section — the unslugged mount — so an instance is additive
   * and nothing about the existing section changes.
   */
  instance: z.string().optional(),
  label: z.string(),
  items: z.array(bootstrapHostedNavItem),
});
export type BootstrapHostedApp = z.infer<typeof bootstrapHostedApp>;

/**
 * An installed app's own sidebar section: its pages, under the groups its
 * manifest names, and its staff screens — inside the dashboard, or a link to
 * where they open on their own. Labels arrive resolved to the reader's
 * language, like the hosted sections'.
 */
export const bootstrapAppSection = z.object({
  appKey: z.string(),
  label: z.string(),
  version: z.string(),
  /** The first group has no heading when it holds the app's ungrouped pages (its Overview). */
  groups: z.array(z.object({ key: z.string(), label: z.string().nullable(), items: z.array(bootstrapNavItem) })),
  staff: z
    .union([
      z.object({ placement: z.literal('internal'), items: z.array(bootstrapHostedNavItem) }),
      z.object({
        placement: z.literal('external'),
        url: z.string(),
        /** The screens, each opened at `url` + its path — for the palette. */
        items: z.array(bootstrapHostedNavItem),
        /** Each extra instance's own address: its mapped host, else its slugged mount. */
        instances: z.array(z.object({ slug: z.string(), url: z.string() })),
      }),
    ])
    .nullable(),
});
export type BootstrapAppSection = z.infer<typeof bootstrapAppSection>;

/**
 * An installed app whose staff screens this dashboard does not carry right
 * now, and why: the app is switched off, its staff side is, or the operator
 * placed it on its own address (`href`). The app's own URL then shows this
 * reason instead of a page that does not exist.
 */
export const bootstrapUnavailableApp = z.object({
  appKey: z.string(),
  label: z.string(),
  reason: z.enum(['app-disabled', 'side-off', 'external']),
  /** Where it opens on its own, for `external`. */
  href: z.string().optional(),
});
export type BootstrapUnavailableApp = z.infer<typeof bootstrapUnavailableApp>;

/** One built project file. */
const projectClientFile = z.object({
  url: z.string(),
  /** Subresource integrity, `sha384-…`. */
  integrity: z.string(),
});

const projectClientEntry = {
  module: projectClientFile,
  /** Every chunk the module imports, directly or not. */
  imports: z.array(projectClientFile),
  styles: z.array(projectClientFile),
};

/**
 * The project folder a server runs. The dashboard reads database keys here
 * (the UI kit's hooks name databases by key), and imports the project's pages
 * and widgets from these URLs.
 */
export const bootstrapProject = z.object({
  /** Database key from `adminium.config.ts` → connection id. */
  databases: z.record(z.string(), z.string()),
  /** Null where project code never loads (the desktop app). */
  client: z
    .object({
      digest: z.string(),
      pages: z.array(z.object({ slug: z.string(), ...projectClientEntry })),
      widgets: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['cell', 'card']),
          title: z.string().nullable(),
          ...projectClientEntry,
        }),
      ),
    })
    .nullable(),
});

export const bootstrapReply = z.object({
  data: z.object({
    user: authUserView,
    /** Role slugs for the session user (RBAC grants resolve server-side). */
    roles: z.array(z.string()),
    /**
     * The `system:` actions this session holds, as meta's dotted keys
     * (`users.manage`, `api-keys.manage`, …). Every key for a super-admin.
     *
     * A role slug cannot answer "may this person open Roles?" — a built-in role
     * can have its grants moved, and a custom role has a slug nothing knows —
     * so the dashboard decides what to OFFER (rail rows, delete buttons) from
     * this list rather than from `roles`. It is discovery only: every route
     * still checks the grant itself. Read at sign-in, so a changed grant shows
     * after a reload, like `assistant.allowed` below.
     */
    systemActions: z.array(z.string()),
    /**
     * True when enabled pages exist that this session may not view — so an
     * empty rail can say "nothing has been shared with you" instead of "connect
     * a database", which is false once one is connected and sends the reader
     * looking for a setup step that is not theirs to take. A boolean, not a
     * count: how many pages someone cannot see is not theirs to know.
     */
    pagesWithheld: z.boolean(),
    /** Resolved axes (system → global → user) + provenance. */
    prefs: mePrefsResolvedView,
    nav: bootstrapNavTree,
    /** Server build version (package.json). */
    version: z.string(),
    /** Monotonic config stamp — max(updatedAt) over adminium_pages; 0 when none. */
    configVersion: z.number(),
    /** `llm.enabled` gates the ⌘K "Ask AI" affordance. */
    llm: z.object({ enabled: z.boolean() }),
    /**
     * Whether this session may open the page assistant — the ONLY thing a
     * host page knows before the modal's own chunk loads, and therefore what
     * decides whether its button renders at all.
     *
     * It is here rather than derived in the browser because the dashboard
     * holds no permission list: bootstrap carries role slugs, and a role slug
     * cannot answer a question about a grant an operator may have moved. Like
     * every other role fact here, it is read at sign-in: a changed grant shows
     * after a reload.
     */
    assistant: z.object({
      allowed: z.boolean(),
      /**
       * What the assistant is called here. The button's LABEL is *Ask
       * {name}*, and a host page has to render it before the modal's chunk
       * — let alone its availability call — exists, so the name travels
       * with the permission rather than behind it. Settings → AI
       * invalidates this reply when it changes the name.
       */
      name: z.string(),
    }),
    /**
     * The session-bound CSRF token every mutating call echoes in
     * `x-adminium-csrf` (security/csrf.ts). Issued here because this is the
     * one round trip the SPA is guaranteed to make before it can mutate
     * anything, and because it is session-bound — an anonymous surface has no
     * session to bind to, and `/bootstrap` already 401s for those visitors.
     */
    csrfToken: z.string(),
    /**
     * Hosted apps blended into this dashboard.
     *
     * Only STAFF surfaces, only those whose placement is `internal`, and only
     * those whose build emitted a readable `surface.json`. Empty on every
     * instance that hosts no surfaces, which is nearly all of them — the
     * sidebar renders nothing extra and the five fixed groups are untouched.
     */
    hostedApps: z.array(bootstrapHostedApp),
    /**
     * Rail rows contributed by INSTALLED, ENABLED add-ons (51b), and the groups
     * they brought with them. Empty on an instance with no add-on that
     * declares a page, which is every instance until one is installed.
     */
    addOnNav: bootstrapAddOnNav,
    /**
     * Pages hidden from the sidebar but very much alive (follow-up): same item
     * shape as the nav, no group. The dashboard resolves `/p/<slug>` URLs,
     * palette landings, and record-page related-tab specs and cross-links
     * through these exactly as through nav items — "hidden" is a sidebar fact,
     * not an existence fact. Cascade-owned child tables (invoice items, …)
     * generate straight into this list; Studio's "Hide from sidebar" moves a
     * page here; per-page view permission still filters it, so a viewer
     * without the grant sees the page nowhere at all.
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
    /** See {@link bootstrapUnavailableApp}. */
    unavailableApps: z.array(bootstrapUnavailableApp),
    /** One section per installed, switched-on app with pages or staff screens. */
    appSections: z.array(bootstrapAppSection),
    /**
     * Pages of an app that is switched off. Like `pausedPages`: in no sidebar
     * and enumerable by nothing, listed only so a bookmark lands on "this app
     * is switched off" rather than on a 404.
     */
    disabledAppPages: z.array(bootstrapNavItem),
    /** Only on a server that runs a project folder (`adminium start` in a project, `adminium dev`). */
    project: bootstrapProject.optional(),
  }),
});
export type BootstrapReply = z.infer<typeof bootstrapReply>;
