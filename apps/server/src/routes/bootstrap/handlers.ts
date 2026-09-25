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
import { bcp47, pickLabel } from '../../i18n/bcp47.js';
import type { FastifyRequest } from 'fastify';
import {
  pagesRepo,
  readBool,
  readJson,
  rolesRepo,
  settingsRepo,
  SYSTEM_ACTION_KEYS,
  userPrefsRepo,
  type MetaDb,
  type PageNavRow,
  type SystemActionKey,
  type User,
} from '@adminium/meta';
import { DEFAULT_NAV_GROUP } from '@adminium/add-on-contracts';
import { addOnManifestSchema } from '@adminium/manifest';

import { screensOnlyError } from '../../apps/screens-only.js';
import { UnauthorizedError } from '../../errors.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import type { AuthContext } from '../../plugins/auth.js';
import { csrfSigningKey, issueCsrfToken } from '../../security/csrf.js';
import { toUserView } from '../auth/handlers.js';
import { APP_VERSION } from '../../version.js';
import { resolveLabel, SURFACES_URL_ROOT, type HostedSurface } from '../../cli/surfaces-root.js';
import {
  appNameOf,
  availabilityOf,
  instancesOf,
  staffPlacementOf,
  type SurfaceSettings,
  NO_SURFACE_SETTINGS,
} from '../../surfaces/settings.js';
import {
  NAV_GROUP_KEYS,
  type BootstrapAddOnGroup,
  type BootstrapAddOnNav,
  type BootstrapAddOnPage,
  type BootstrapAppSection,
  type BootstrapHostedApp,
  type BootstrapNavItem,
  type BootstrapNavTree,
  type BootstrapReply,
  type BootstrapUnavailableApp,
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
 * Every `system:` action the session holds, as meta's dotted keys — through
 * `request.can`, so the answer is the one the route guards will give
 * (super-admin bypass included) rather than a second reading of the matrix.
 * The set is resolved once per request, so this is N set lookups, not N
 * queries. Empty on a harness mounted without the rbac plugin, the same honest
 * default `assistant.allowed` takes.
 */
async function heldSystemActions(request: FastifyRequest): Promise<SystemActionKey[]> {
  if (typeof request.can !== 'function') return [];
  const held: SystemActionKey[] = [];
  for (const key of SYSTEM_ACTION_KEYS) {
    const [area, verb] = key.split('.') as [string, string];
    if (await request.can(`system:${area}:${verb}`)) held.push(key);
  }
  return held;
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

/**
 * The title a page is listed under: a manifest page's translation into the
 * reader's language while the operator has not renamed it, else
 * the stored title.
 */
export function navTitleOf(row: Pick<PageNavRow, 'title' | 'manifestTitle'>, locale: string): string {
  const manifest = row.manifestTitle;
  if (manifest === null || manifest === undefined || row.title !== manifest.from) return row.title;
  return manifest.titles[bcp47(locale)] ?? languageMatch(manifest.titles, locale) ?? row.title;
}

/** Another region of the reader's language, when their exact tag is absent. */
function languageMatch(titles: Readonly<Record<string, string>>, locale: string): string | undefined {
  const language = bcp47(locale).split('-')[0]!.toLowerCase();
  for (const [tag, text] of Object.entries(titles)) {
    if (tag.split('-')[0]!.toLowerCase() === language) return text;
  }
  return undefined;
}

export function buildNavTree(
  rows: readonly PageNavRow[],
  connections: ReadonlyMap<string, NavConnection> = new Map(),
  pausedConnectionIds: ReadonlySet<string> = new Set(),
  /** The reader's locale, either spelling; picks a manifest page's translated title. */
  locale: string = 'en-US',
  /** Keys of apps an operator switched off. */
  disabledApps: ReadonlySet<string> = new Set(),
  /** Keys of the installed, switched-on apps: their pages go to their own sections. */
  sectionApps: ReadonlySet<string> = new Set(),
): {
  nav: BootstrapNavTree;
  hidden: BootstrapNavItem[];
  paused: BootstrapNavItem[];
  disabledApp: BootstrapNavItem[];
  /** App key → its pages, each with the group its manifest named (null: none). */
  appItems: Map<string, { group: string | null; item: BootstrapNavItem }[]>;
  configVersion: number;
} {
  let configVersion = 0;
  const buckets = new Map<NavGroupKey, BootstrapNavItem[]>();
  const hidden: BootstrapNavItem[] = [];
  const paused: BootstrapNavItem[] = [];
  const disabledApp: BootstrapNavItem[] = [];
  const appItems = new Map<string, { group: string | null; item: BootstrapNavItem }[]>();

  for (const row of rows) {
    // Every page row advances the config stamp, nav-visible or not.
    if (row.updatedAt > configVersion) configVersion = row.updatedAt;
    if (!readBool(row.isEnabled)) continue;
    const item: BootstrapNavItem = {
      pageId: row.id,
      slug: row.slug,
      labelKey: `nav.${row.slug}`,
      fallback: navTitleOf(row, locale),
      icon: row.icon ?? 'file',
      order: row.navOrder,
      connectionId: row.connectionId,
      connectionName:
        row.connectionId === null ? null : (connections.get(row.connectionId)?.name ?? null),
      currency: row.connectionId === null ? null : (connections.get(row.connectionId)?.currency ?? null),
      sourceTable: row.sourceTable,
      appKey: row.appKey ?? null,
    };
    // A switched-off app's pages are off too, whatever their connection.
    if (row.appKey != null && disabledApps.has(row.appKey)) {
      disabledApp.push(item);
      continue;
    }
    // The pause outranks the group: a paused page is not hidden, it is off.
    if (row.connectionId !== null && pausedConnectionIds.has(row.connectionId)) {
      paused.push(item);
      continue;
    }
    // An installed app's page lives in the app's own section, wherever its
    // row was filed — an operator's edit included.
    if (row.appKey != null && sectionApps.has(row.appKey)) {
      const list = appItems.get(row.appKey) ?? [];
      list.push({ group: row.appGroup ?? null, item });
      appItems.set(row.appKey, list);
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
  disabledApp.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

  return { nav: { groups }, hidden, paused, disabledApp, appItems, configVersion };
}

/**
 * App key → the slugs of its pages whose feature is unmet here, each with the
 * feature and the add-ons it still needs. A feature is met when every add-on
 * it requires is installed, attached to the app and switched on there.
 */
export async function unmetFeaturePages(
  ctx: { meta: MetaDb },
  apps: readonly { manifestKey: string; manifest: unknown }[],
): Promise<Map<string, Map<string, { feature: string; needs: string[] }>>> {
  const out = new Map<string, Map<string, { feature: string; needs: string[] }>>();
  for (const app of apps) {
    const document = readJson<{
      addOns?: { features?: { id?: unknown; requires?: unknown }[] };
      pages?: { ref?: unknown; feature?: unknown }[];
    } | null>(app.manifest);
    const pages = (document?.pages ?? []).filter(
      (page): page is { ref: string; feature: string } => typeof page.ref === 'string' && typeof page.feature === 'string',
    );
    if (pages.length === 0) continue;
    const attached = new Set(
      (
        await ctx.meta.db
          .selectFrom('adminium_manifest_attachments as a')
          .innerJoin('adminium_manifests as m', 'm.id', 'a.manifestId')
          .select('m.manifestKey as key')
          .where('a.attachedTo', '=', app.manifestKey)
          .where('a.disabledAt', 'is', null)
          .where('m.kind', '=', 'add-on')
          .where('m.status', '=', 'installed')
          .execute()
      ).map((row: { key: string }) => row.key),
    );
    const slugs = new Map<string, { feature: string; needs: string[] }>();
    for (const page of pages) {
      const feature = (document?.addOns?.features ?? []).find((candidate) => candidate.id === page.feature);
      const requires = Array.isArray(feature?.requires) ? feature.requires.filter((key): key is string => typeof key === 'string') : [];
      // A feature the manifest does not describe is not one this server can
      // judge met; the page is withheld rather than shown working.
      const needs = feature === undefined ? [page.feature] : requires.filter((key) => !attached.has(key));
      if (needs.length > 0) slugs.set(page.ref, { feature: page.feature, needs });
    }
    if (slugs.size > 0) out.set(app.manifestKey, slugs);
  }
  return out;
}

/** An installed app, as its section needs it. */
export interface SectionApp {
  key: string;
  version: string;
  /** The manifest's own name. */
  name: string;
  navGroups: readonly { key: string; label: Readonly<Record<string, string>>; order: number }[];
}

/**
 * Each installed app's own section: its pages under its manifest's groups
 * (the ungrouped ones — its Overview — first, with no heading), and its staff
 * screens. Those are the hosted section's rows when the staff side lives in
 * the dashboard, or a link to where it opens on its own. An app with neither
 * pages nor staff screens has no section.
 */
export function buildAppSections(input: {
  apps: readonly SectionApp[];
  appItems: ReadonlyMap<string, readonly { group: string | null; item: BootstrapNavItem }[]>;
  hosted: readonly BootstrapHostedApp[];
  surfaces: readonly HostedSurface[];
  settings: SurfaceSettings;
  locale: string;
  /** `https:` or `http:`, for a mapped staff domain. */
  protocol: string;
  /** The apps whose staff screens this reader may open (`app:<key>:staff`); absent, all. */
  mayOpenStaff?: ReadonlySet<string> | undefined;
}): BootstrapAppSection[] {
  const out: BootstrapAppSection[] = [];
  for (const app of input.apps) {
    const pages = [...(input.appItems.get(app.key) ?? [])].sort(
      (a, b) => a.item.order - b.item.order || a.item.slug.localeCompare(b.item.slug),
    );
    const declared = [...app.navGroups].sort((a, b) => a.order - b.order);
    const known = new Set(declared.map((group) => group.key));
    const groups: BootstrapAppSection['groups'] = [];
    const loose = pages.filter((page) => page.group === null || !known.has(page.group)).map((page) => page.item);
    if (loose.length > 0) groups.push({ key: '', label: null, items: loose });
    for (const group of declared) {
      const items = pages.filter((page) => page.group === group.key).map((page) => page.item);
      if (items.length > 0) groups.push({ key: group.key, label: pickLabel(group.label, input.locale) ?? group.key, items });
    }

    const hosted = input.hosted.find((entry) => entry.appKey === app.key && entry.instance === undefined);
    let staff: BootstrapAppSection['staff'] = null;
    const mayOpen = input.mayOpenStaff === undefined || input.mayOpenStaff.has(app.key);
    if (!mayOpen) {
      // No staff entry for someone who may not open the screens.
    } else if (hosted !== undefined) {
      staff = { placement: 'internal', items: hosted.items };
    } else {
      const surface = input.surfaces.find((entry) => entry.appKey === app.key && entry.side === 'staff');
      if (
        surface !== undefined &&
        staffPlacementOf(input.settings, app.key) === 'external' &&
        availabilityOf(input.settings, app.key, 'staff') === 'ok'
      ) {
        const hostOf = (instance: string | undefined): string | undefined =>
          Object.entries(input.settings.domains).find(
            ([, target]) => target.appKey === app.key && target.side === 'staff' && target.instance === instance,
          )?.[0];
        const host = hostOf(undefined);
        staff = {
          placement: 'external',
          url: host === undefined ? `${surface.prefix}/` : `${input.protocol}://${host}/`,
          // Named for the palette, which opens each one at the app's address.
          items: (surface.manifest?.nav ?? []).map((item) => ({
            id: item.id,
            path: item.path,
            label: resolveLabel(item.labels, input.locale),
            ...(item.icon === undefined ? {} : { icon: item.icon }),
            ...(item.persona === undefined ? {} : { persona: item.persona }),
          })),
          // An extra instance opens on its own address too: its host, else
          // the slugged mount `parseInstancePath` reads.
          instances: instancesOf(input.settings, app.key).map((instance) => {
            const own = hostOf(instance.slug);
            return {
              slug: instance.slug,
              url: own === undefined ? `${SURFACES_URL_ROOT}/${app.key}/${instance.slug}/staff/` : `${input.protocol}://${own}/`,
            };
          }),
        };
      }
    }
    if (groups.length === 0 && staff === null) continue;
    out.push({
      appKey: app.key,
      label: hosted?.label ?? appNameOf(input.settings, app.key, app.name),
      version: app.version,
      groups,
      staff,
    });
  }
  return out;
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
    // Switched off, whole or staff side: no section. `unavailableApps` says why.
    if (availabilityOf(settings, surface.appKey, 'staff') !== 'ok') continue;
    const manifest = surface.manifest;
    if (manifest === null || manifest.nav.length === 0) continue;
    const items = manifest.nav.map((item) => ({
      id: item.id,
      path: item.path,
      label: resolveLabel(item.labels, locale),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      ...(item.persona === undefined ? {} : { persona: item.persona }),
    }));
    // The operator's name for the app beats the one it was built with, and the
    // sidebar is the most visible place that has to agree with the app's own
    // chrome — both resolve through `appNameOf`.
    const label = appNameOf(settings, surface.appKey, resolveLabel(manifest.appLabels, locale));
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
 * The installed apps whose staff screens the dashboard does not carry, and
 * why — so `/a/<key>` can say "switched off" or "opens on its own" instead of
 * a 404 that explains nothing. A staff surface only: a customer side is never
 * in the operator's dashboard.
 */
export function buildUnavailableApps(
  surfaces: readonly HostedSurface[],
  settings: SurfaceSettings,
  locale: string,
): BootstrapUnavailableApp[] {
  const out: BootstrapUnavailableApp[] = [];
  for (const surface of surfaces) {
    if (surface.side !== 'staff') continue;
    const availability = availabilityOf(settings, surface.appKey, 'staff');
    const external = staffPlacementOf(settings, surface.appKey) === 'external';
    if (availability === 'ok' && !external) continue;
    const own = surface.manifest === null ? '' : resolveLabel(surface.manifest.appLabels, locale);
    const label = appNameOf(settings, surface.appKey, own === '' ? null : own);
    out.push(
      availability === 'ok'
        ? { appKey: surface.appKey, label, reason: 'external', href: `${surface.prefix}/` }
        : { appKey: surface.appKey, label, reason: availability },
    );
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

  // Someone whose every role opens only an app's screens is sent there instead.
  if (request.server.hasDecorator('rbac') && request.apiKeyPrincipal == null) {
    const set = await request.server.rbac.resolve(request);
    if (set.screensOnly !== null) {
      throw screensOnlyError((await surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS, set.screensOnly, request);
    }
  }
  // The project folder, when the server runs one. Same request-time read, for
  // the same reason: this route is registered before it exists.
  const projectClient = request.server.hasDecorator('projectClient') ? request.server.projectClient : null;

  const [roles, prefs, pageRows, connectionRows, llmProvider, assistantName, placements, project, addOns, appRows] =
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
    surfaceSettings?.read() ?? Promise.resolve(NO_SURFACE_SETTINGS),
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
    // The installed apps, switched on: each gets its own section.
    ctx.meta.db
      .selectFrom('adminium_manifests')
      .select(['manifestKey', 'version', 'manifest'])
      .where('kind', '=', 'app')
      .where('status', '=', 'installed')
      .orderBy('manifestKey', 'asc')
      .execute(),
  ]);

  /*
   * PAGES OF A FEATURE THAT IS NOT THERE. An app's page may name a `feature`
   * that works only with certain add-ons; while any of them is not attached
   * to the app (and switched on for it), the page leaves the sidebar and is
   * listed apart, saying which add-ons it needs.
   */
  const unmet = await unmetFeaturePages(ctx, appRows);

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
  const disabledApps = new Set(
    Object.entries(placements.statuses)
      .filter(([, status]) => status === 'disabled')
      .map(([key]) => key),
  );
  const sectionApps: SectionApp[] = appRows.map((row) => {
    const document = readJson<{ name?: unknown; navGroups?: unknown }>(row.manifest) ?? {};
    const navGroups = Array.isArray(document.navGroups)
      ? (document.navGroups as SectionApp['navGroups'][number][]).filter(
          (group) => typeof group?.key === 'string' && typeof group.label === 'object' && group.label !== null,
        )
      : [];
    return {
      key: row.manifestKey,
      version: row.version,
      name: typeof document.name === 'string' ? document.name : row.manifestKey,
      navGroups,
    };
  });
  const withheld = visibleRows.filter((row) => row.appKey != null && unmet.get(row.appKey)?.has(row.slug) === true);
  const { nav, hidden, paused, disabledApp, appItems } = buildNavTree(
    visibleRows.filter((row) => !withheld.includes(row)),
    new Map(connectionRows.map((row) => [row.id, { name: row.name, currency: row.currency }])),
    pausedConnectionIds,
    prefs.locale,
    disabledApps,
    new Set(sectionApps.map((app) => app.key)),
  );
  /*
   * Whose staff screens this reader may open: without `app:<key>:staff`, an
   * app contributes no staff rows and no "open" link, only its pages.
   */
  const everyHosted = hasSurfaces ? buildHostedApps(request.server.surfaces, placements, prefs.locale) : [];
  const mayOpenStaff = new Set<string>();
  for (const key of new Set([...everyHosted.map((entry) => entry.appKey), ...sectionApps.map((entry) => entry.key)])) {
    if (typeof request.can !== 'function' || (await request.can(`app:${key}:staff`))) mayOpenStaff.add(key);
  }
  const hostedApps = everyHosted.filter((entry) => mayOpenStaff.has(entry.appKey));

  return {
    data: {
      user: toUserView(user),
      roles: roles.map((role) => role.slug),
      systemActions: await heldSystemActions(request),
      pagesWithheld: pageRows.some(
        (row) => readBool(row.isEnabled) && !visibleRows.some((visible) => visible.id === row.id),
      ),
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
      hostedApps,
      addOnNav: buildAddOnNav(addOns.map((row) => ({ document: readJson(row.manifest) }))),
      hiddenPages: hidden,
      pausedPages: paused,
      unavailableApps: hasSurfaces
        ? buildUnavailableApps(request.server.surfaces, placements, prefs.locale)
        : [],
      disabledAppPages: disabledApp,
      ...(withheld.length === 0
        ? {}
        : {
            featurePages: [
              ...buildNavTree(withheld, new Map(), new Set(), prefs.locale, new Set(), new Set(withheld.map((row) => row.appKey!))).appItems.values(),
            ]
              .flat()
              .map(({ item }) => ({ ...item, ...unmet.get(item.appKey!)!.get(item.slug)! })),
          }),
      appSections: buildAppSections({
        apps: sectionApps,
        appItems,
        hosted: hostedApps,
        surfaces: hasSurfaces ? request.server.surfaces : [],
        settings: placements,
        locale: prefs.locale,
        protocol: request.protocol,
        mayOpenStaff,
      }),
      ...(project === null ? {} : { project }),
    },
  };
}
