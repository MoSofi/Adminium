// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/v1/bootstrap` handler — deliberately thin: one query per
 * concern, no fan-out beyond what the shell needs on a cold load.
 *
 * - session user + role slugs via the existing auth plumbing;
 * - preference axes resolved server-side (`userPrefsRepo.resolve`);
 * - nav tree from enabled `adminium_pages` rows bucketed into the five fixed
 *   groups (rows land in M4 Wave B generation — an empty tree is valid);
 * - `version` (server build) + `configVersion` (max page `updatedAt`) so the
 *   client can drop stale caches on WS `config-changed`.
 * - nav rows are permission-filtered server-side: non-super-admins only see
 * pages their roles hold a `page:<id>:view` grant for — the same grant `GET
 * /pages/:pageId` enforces, so the nav never links to a 403.
 * - `llm.enabled` mirrors the provider config: true once an admin has set
 * `llm.provider` in Settings → AI, the same check `resolveProviderClient`
 * makes before a direct run.
 */
import type { FastifyRequest } from 'fastify';
import {
  pagesRepo,
  readBool,
  readJson,
  rolesRepo,
  settingsRepo,
  userPrefsRepo,
  type PageNavRow,
  type User,
} from '@adminium/meta';
import { DEFAULT_NAV_GROUP } from '@adminium/add-on-contracts';
import { addOnManifestSchema } from '@adminium/manifest';

import { UnauthorizedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import type { AuthContext } from '../../plugins/auth.js';
import { csrfSigningKey, issueCsrfToken } from '../../security/csrf.js';
import { toUserView } from '../auth/handlers.js';
import { APP_VERSION } from '../../version.js';
import { resolveLabel, type HostedSurface } from '../../cli/surfaces-root.js';
import {
  instancesOf,
  staffPlacementOf,
  type SurfaceSettings,
} from '../../surfaces/settings.js';
import {
  NAV_GROUP_KEYS,
  type BootstrapAddOnGroup,
  type BootstrapAddOnNav,
  type BootstrapAddOnPage,
  type BootstrapHostedApp,
  type BootstrapNavItem,
  type BootstrapNavTree,
  type BootstrapReply,
  type NavGroupKey,
} from './schema.js';

function principal(request: FastifyRequest): User {
  if (request.user === null) throw new UnauthorizedError('UNAUTHENTICATED');
  return request.user;
}

/**
 * The -item-4 token for this request's session. `requireAuth` guarantees a
 * session here — an API-key principal never reaches this handler — so there is
 * no null case to model on the wire. The key is derived per call rather than
 * cached on `AuthContext`: HKDF is microseconds and this runs once per cold
 * load, which is cheaper than another field to keep in sync.
 */
function csrfTokenFor(ctx: AuthContext, request: FastifyRequest): string {
  const sessionId = request.session?.id;
  if (sessionId === undefined) throw new UnauthorizedError('UNAUTHENTICATED');
  return issueCsrfToken(csrfSigningKey(ctx.env.ADMINIUM_SECRET), sessionId);
}

/**
 * Buckets page rows into the five fixed groups; empty groups are omitted.
 * `connections` (id → name + currency) annotates every item with its owning
 * connection so multi-connection sidebars can label generated groups
 * unambiguously and money cells format in the connection's own currency;
 * with zero/one connection clients render flat.
 *
 * `hidden` carries the enabled rows with NO group (follow-up): Studio's
 * "Hide from sidebar" and the generated cascade-child default both project
 * to a null `nav_group`, and the client still needs these pages — for
 * `/p/<slug>` URLs, palette landings, and record-page related-tab specs
 * and cross-links. Disabled rows appear in neither list.
 *
 * `paused` is the THIRD bucket (meta wave 0019): every page of a connection an
 * operator paused, whatever its group. It is separate from `hidden` rather
 * than folded into it because the two lists answer different questions and
 * only one of them is a listing.
 *
 *   nav     — what the sidebar draws.
 *   hidden  — not drawn, but still ENUMERABLE: the palette skips it, yet
 *             record-page related tabs read its column specs and cross-link
 *             to its slugs. A hidden page is a live page you cannot see.
 *   paused  — enumerable by NOTHING. A paused source is off, so its pages
 *             must not appear in the rail, be offered by the palette, or be
 *             linked to from another page's related tab.
 *
 * They still travel to the client, and that is the point of the bucket: a
 * bookmark or an already-open tab pointed at `/p/<slug>` resolves through this
 * list alone and lands on "This connection is paused" instead of a 404, which
 * is the difference between an explanation and a mystery.
 *
 * `pausedConnectionIds` is passed in rather than read here because this
 * function takes rows, not a database.
 */
/** What a nav item needs from its owning connection row. */
export interface NavConnection {
  name: string;
  currency: string | null;
}

export function buildNavTree(
  rows: readonly PageNavRow[],
  connections: ReadonlyMap<string, NavConnection> = new Map(),
  pausedConnectionIds: ReadonlySet<string> = new Set(),
): {
  nav: BootstrapNavTree;
  hidden: BootstrapNavItem[];
  paused: BootstrapNavItem[];
  configVersion: number;
} {
  let configVersion = 0;
  const buckets = new Map<NavGroupKey, BootstrapNavItem[]>();
  const hidden: BootstrapNavItem[] = [];
  const paused: BootstrapNavItem[] = [];

  for (const row of rows) {
    // Every page row advances the config stamp, nav-visible or not.
    if (row.updatedAt > configVersion) configVersion = row.updatedAt;
    if (!readBool(row.isEnabled)) continue;
    const item: BootstrapNavItem = {
      pageId: row.id,
      slug: row.slug,
      labelKey: `nav.${row.slug}`,
      fallback: row.title,
      icon: row.icon ?? 'file',
      order: row.navOrder,
      connectionId: row.connectionId,
      connectionName:
        row.connectionId === null ? null : (connections.get(row.connectionId)?.name ?? null),
      currency: row.connectionId === null ? null : (connections.get(row.connectionId)?.currency ?? null),
      sourceTable: row.sourceTable,
    };
    // The pause outranks the group: a paused page is not hidden, it is off.
    if (row.connectionId !== null && pausedConnectionIds.has(row.connectionId)) {
      paused.push(item);
      continue;
    }
    const group = (NAV_GROUP_KEYS as readonly string[]).includes(row.navGroup ?? '')
      ? (row.navGroup as NavGroupKey)
      : null;
    if (group === null) {
      hidden.push(item);
      continue;
    }
    const items = buckets.get(group) ?? [];
    items.push(item);
    buckets.set(group, items);
  }

  const groups = NAV_GROUP_KEYS.flatMap((key) => {
    const items = buckets.get(key);
    if (items === undefined || items.length === 0) return [];
    items.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
    return [{ key, items }];
  });
  hidden.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  paused.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

  return { nav: { groups }, hidden, paused, configVersion };
}

/**
 * The sidebar sections a blended app contributes.
 *
 * Three filters, each of which drops a surface for a different reason worth
 * distinguishing when something does not appear:
 *
 *   side !== 'staff'   a customer surface is for a customer. It is never in
 *                      the operator's sidebar, whatever its placement.
 *   placement external the operator chose to keep the app on its own. Studio
 *                      shows it as attached; the dashboard does not carry it.
 *   manifest === null  the build predates the toolkit (or wrote nothing this
 *                      server can read). NOT an error — the surface still
 *                      serves at `/apps/<key>/staff/`; only the blend is
 *                      unavailable, and Studio says exactly that rather than
 *                      rendering an empty section here.
 *
 * An app with a manifest but ZERO nav entries is also dropped: a labelled
 * heading with nothing under it is a dead end in the rail, and the surface is
 * still reachable at its own URL.
 */
export function buildHostedApps(
  surfaces: readonly HostedSurface[],
  settings: SurfaceSettings,
  locale: string,
): BootstrapHostedApp[] {
  const out: BootstrapHostedApp[] = [];
  for (const surface of surfaces) {
    if (surface.side !== 'staff') continue;
    if (staffPlacementOf(settings, surface.appKey) !== 'internal') continue;
    const manifest = surface.manifest;
    if (manifest === null || manifest.nav.length === 0) continue;
    const items = manifest.nav.map((item) => ({
      id: item.id,
      path: item.path,
      label: resolveLabel(item.labels, locale),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      ...(item.persona === undefined ? {} : { persona: item.persona }),
    }));
    const label = resolveLabel(manifest.appLabels, locale);
    out.push({ appKey: surface.appKey, label, items });
    /*
     * ONE SECTION PER INSTANCE — the shape the dashboard's own pages
     * have always had, where two connections simply make two sets. The nav
     * ITEMS are identical because it is the same app; only the database behind
     * them differs, so the slug is what the heading has to carry.
     */
    for (const instance of instancesOf(settings, surface.appKey)) {
      out.push({
        appKey: surface.appKey,
        instance: instance.slug,
        label: `${label} · ${instance.slug}`,
        items,
      });
    }
  }
  return out;
}

/**
 * The rail rows an installed add-on contributes (51b).
 *
 * PURE, over the rows the caller read, for the same reason `buildNavTree` is:
 * what goes wrong here is ordering and grouping, and neither needs a database
 * to reproduce.
 *
 * Three rules worth stating, because each is a decision rather than a detail:
 *
 *  - **A manifest that does not parse contributes NOTHING, and does not throw.**
 *    An add-on can be installed, then upgraded past this server, then rolled
 *    back; a rail that 500s on one bad row takes the whole dashboard with it.
 *    The add-on is still listed in Studio, where its version is the answer.
 *  - **Rows sort by `order`, then by add-on key**, so two add-ons landing in
 *    Library at the same order do not swap places between boots.
 *  - **Nothing here drops an "empty" group, and that is deliberate.** A filter
 *    for it was written and removed: the manifest schema refuses a declared
 *    group no page uses, and the page that justifies one necessarily has `nav`
 *    (the rule keys on `p.nav?.group`), so a parsed manifest can never reach
 *    this function with an orphaned group. The empty-heading case IS reachable,
 *    but one layer up — a group whose every page is `adminOnly` renders a
 *    heading with no rows for a viewer who is not an admin — so the rail is
 *    where it is handled, over the rows it is actually about to draw.
 */
export function buildAddOnNav(installed: readonly { document: unknown }[]): BootstrapAddOnNav {
  const pages: BootstrapAddOnPage[] = [];
  const declared: BootstrapAddOnGroup[] = [];

  for (const row of installed) {
    const parsed = addOnManifestSchema.safeParse(row.document);
    if (!parsed.success) continue;
    const manifest = parsed.data;
    const addOnKey = manifest.key;

    for (const page of manifest.addOn.pages ?? []) {
      if (page.nav === undefined) continue;
      pages.push({
        addOnKey,
        ref: page.ref,
        labelKey: page.title.key,
        fallback: page.title.fallback,
        icon: page.icon,
        client: page.client,
        group: page.nav.group ?? DEFAULT_NAV_GROUP,
        order: page.nav.order,
        adminOnly: page.nav.adminOnly ?? false,
        detail: page.detail ?? false,
      });
    }

    for (const group of manifest.addOn.navGroups ?? []) {
      declared.push({
        key: group.key,
        labelKey: group.label.key,
        fallback: group.label.fallback,
        order: group.order,
        addOnKey,
      });
    }
  }

  pages.sort((a, b) => a.order - b.order || a.addOnKey.localeCompare(b.addOnKey) || a.ref.localeCompare(b.ref));

  const groups = declared
    // First declarer owns the label: two add-ons may ask for one group, which
    // is the feature working. `enabledForHost` orders by key, so the winner is
    // stable rather than whichever row the database returned first.
    .filter((group, i, all) => all.findIndex((other) => other.key === group.key) === i)
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

  return { groups, pages };
}

export async function bootstrapHandler(
  ctx: AuthContext,
  request: FastifyRequest,
): Promise<BootstrapReply> {
  const user = principal(request);

  /*
   * The blended-app sections (D7). Read through `request.server` rather than
   * `AuthContext` because they are a property of what this INSTANCE serves, not
   * of the session — and `hasDecorator` because minimal test harnesses mount
   * this route without the surfaces plugin, where the answer is simply "none".
   */
  const hasSurfaces = request.server.hasDecorator('surfaces');
  const surfaceSettings = hasSurfaces ? request.server.surfaceSettings : null;
  // The project folder, when the server runs one. Same request-time read, for
  // the same reason: this route is registered before it exists.
  const projectClient = request.server.hasDecorator('projectClient') ? request.server.projectClient : null;

  const [roles, prefs, pageRows, connectionRows, llmProvider, assistantName, placements, project, addOns] =
    await Promise.all([
    rolesRepo(ctx.meta).rolesForUser(user.id),
    userPrefsRepo(ctx.meta).resolve(user.id),
    // Shared query path with the generator wave (pagesRepo).
    pagesRepo(ctx.meta).navRows(),
    // Display names, the pause flag and the display currency — no DSN material
    // , so no crypto needed. `disabledAt` decides whether this
    // connection's pages reach the sidebar at all (meta wave 0019);
    // `currency` is what money cells format with.
    ctx.meta.db
      .selectFrom('adminium_connections')
      .select(['id', 'name', 'disabledAt', 'currency'])
      .execute(),
    // `llm.enabled` = a provider is configured — the same
    // `llm.provider` row `resolveProviderClient` gates direct runs
    // on.
    settingsRepo(ctx.meta).get('llm.provider'),
    // What the assistant is called. Read for every session, not only one
    // that may open it: the value is an instance's own naming, and the
    // branch would save one settings read out of the eight above.
    settingsRepo(ctx.meta).get('assistant.name'),
    surfaceSettings?.read() ?? Promise.resolve({ apps: {}, domains: {} } as SurfaceSettings),
    projectClient?.bootstrap() ?? Promise.resolve(null),
    /*
     * Read straight off the tables rather than through `manifestsRepo`, which
     * takes a `CredentialCrypto` this route has no business holding: the rail
     * needs manifest DOCUMENTS, never a credential. `adminium_connections`
     * above is read the same way, for the same reason.
     */
    ctx.meta.db
      .selectFrom('adminium_manifest_attachments as a')
      .innerJoin('adminium_manifests as m', 'm.id', 'a.manifestId')
      .select(['m.manifest as manifest'])
      .where('a.attachedTo', '=', 'dashboard')
      .where('a.disabledAt', 'is', null)
      .where('m.kind', '=', 'add-on')
      .where('m.status', '=', 'installed')
      .orderBy('m.manifestKey', 'asc')
      .execute(),
  ]);

  // Permission filter: drop rows the caller may not view. The
  // per-request `request.can` cache resolves the permission set once;
  // super-admins bypass inside it. The `typeof` guard mirrors routes/pages —
  // minimal harnesses mount this route without the rbac plugin.
  const visibleRows =
    typeof request.can === 'function'
      ? await (async () => {
          const rows: PageNavRow[] = [];
          for (const row of pageRows) {
            if (await request.can(`page:${row.id}:view`)) rows.push(row);
          }
          return rows;
        })()
      : [...pageRows];

  const pausedConnectionIds = new Set(
    connectionRows.filter((row) => row.disabledAt !== null).map((row) => row.id),
  );

  // configVersion must track ALL rows (a permission change is not a config
  // change, and a hidden page's regeneration still bumps the stamp).
  const { configVersion } = buildNavTree(pageRows);
  const { nav, hidden, paused } = buildNavTree(
    visibleRows,
    new Map(connectionRows.map((row) => [row.id, { name: row.name, currency: row.currency }])),
    pausedConnectionIds,
  );

  return {
    data: {
      user: toUserView(user),
      roles: roles.map((role) => role.slug),
      prefs,
      nav,
      version: APP_VERSION,
      configVersion,
      llm: { enabled: typeof llmProvider === 'string' && llmProvider.length > 0 },
      // The same `typeof` guard the page filter above uses: a minimal harness
      // mounts this route without the rbac plugin, and "no assistant" is the
      // honest answer there rather than a crash.
      assistant: {
        allowed: typeof request.can === 'function' ? await request.can(PERMISSIONS.assistantUse) : false,
        name: assistantName,
      },
      csrfToken: csrfTokenFor(ctx, request),
      hostedApps: hasSurfaces
        ? buildHostedApps(request.server.surfaces, placements, prefs.locale)
        : [],
      addOnNav: buildAddOnNav(addOns.map((row) => ({ document: readJson(row.manifest) }))),
      hiddenPages: hidden,
      pausedPages: paused,
      ...(project === null ? {} : { project }),
    },
  };
}
