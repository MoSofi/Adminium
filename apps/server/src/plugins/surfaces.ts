// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `surfaces` plugin — serving an app's own frontends from Adminium itself.
 *
 * Each hosted surface is one static root mounted under
 * `/apps/<appKey>/<side>/`, alongside the dashboard rather than instead of it.
 * Discovery lives in `cli/surfaces-root.ts`; this module only serves what it is
 * handed, so an empty list is a clean no-op and the server boots unchanged.
 *
 * ─── Why the two sides are not symmetric ─────────────────────────────────────
 *
 * A STAFF surface is internal. Hosting it here is the whole point of the
 * exercise: at the same origin it can ride the operator's existing session
 * cookie and RBAC, so it needs no publishable key, no CORS allowance and no
 * second deployment. It is therefore gated on `requireAuth` — an anonymous
 * request never reaches the bundle, let alone the data.
 *
 * A CUSTOMER surface is public by definition. It stays on the public API with
 * a publishable key and the claim/session model, and is served here only as a
 * convenience — one origin instead of two.
 *
 * ─── The redirect, and why it is not a 401 ───────────────────────────────────
 *
 * `requireAuth` throws `UNAUTHENTICATED`, which the error handler renders as a
 * JSON envelope. That is right for `fetch` and wrong for a person typing the
 * URL: a browser would paint the raw envelope. A *document navigation* is
 * therefore redirected to the dashboard's own login page with `next` set, and
 * everything else still gets the envelope. The test asserts both, because
 * getting this backwards is invisible until someone opens the link.
 *
 * ─── Domain attachment ───────────────────────────────────────────────────────
 *
 * A mapping in `surfaces.domains` is `host → {appKey, side}`. On a request
 * whose `Host` matches one, this instance answers AS that surface: the path is
 * a real file under the surface's root or it SPA-falls-back to the surface's
 * `index.html` — except for the reserved set below, which keeps serving what
 * it always served. The proxy's only jobs are TLS and `Host` pass-through;
 * no rewrite, no second dist, no base change (the bundles reference their
 * assets by absolute `/apps/…` paths, which stay mounted host-agnostically).
 *
 * A spoofed `Host` header is NOT a threat model here: host-routing selects
 * which PUBLIC STATIC BUNDLE is served — never a principal, never a scope,
 * never data. A forged `Host` gets an attacker a bundle they could fetch
 * anyway at `/apps/<key>/<side>/`; the staff gate still runs on the session.
 */
import { statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import fastifyStatic from '@fastify/static';
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { BUILTIN_LOCALE_IDS, type LocaleId } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';
import {
  CUSTOMER_KEY_PURPOSE,
  addOnSettingsRepo,
  appTablesRepo,
  connectionTenantConfig,
  keyStaffBinding,
  publicKeysRepo,
  readJson,
  rolesRepo,
  sessionsRepo,
  settingsRepo,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';

import type { Manifest } from '@adminium/manifest';

import type { InstalledApps } from '../apps/installed.js';
import { settingValuesWithDefaults } from '../apps/settings-values.js';
import { auditAuth } from '../auth/audit.js';
import { clearSessionCookie } from '../auth/sessions.js';
import { resolveLabel, type HostedSurface, type SurfaceSide } from '../cli/surfaces-root.js';
import { AppError, AppUnavailableError, ForbiddenError, NotFoundError } from '../errors.js';
import { bcp47 } from '../i18n/bcp47.js';
import { loadOverrideMap, recipientLocale } from '../i18n/server-i18n.js';
import { openPublishableKey } from '../public-api/keys.js';
import { CSRF_FORM_FIELD, normalizeHost } from '../security/csrf.js';
import {
  appNameOf,
  appNameOverrideOf,
  availabilityOf,
  connectionForMount,
  type SurfaceSettings,
  createSurfaceSettings,
  domainMappingFor,
  type SurfaceSettingsCache,
  NO_SURFACE_SETTINGS,
} from '../surfaces/settings.js';
import { renderNotFoundPage, renderUnavailablePage } from '../surfaces/unavailable-page.js';

/** Where the script-free "not available" page's Sign out posts. */
export const SURFACE_SIGN_OUT_PATH = '/surface-sign-out';

/** The registry default for `branding.appName`: a workspace that never named itself. */
const DEFAULT_WORKSPACE_NAME = 'Adminium';

/**
 * The best of the built-in locales for an `Accept-Language` header: an exact
 * tag, then the same language in another region, in the reader's order of
 * preference. Null when none fits.
 */
export function negotiateLocale(header: string | undefined): LocaleId | null {
  const wanted = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q.slice(2)) };
    })
    .filter((entry) => entry.tag !== '' && entry.tag !== '*' && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    const exact = BUILTIN_LOCALE_IDS.find((id) => bcp47(id).toLowerCase() === tag);
    if (exact !== undefined) return exact;
    const language = tag.split('-')[0];
    const near = BUILTIN_LOCALE_IDS.find((id) => bcp47(id).toLowerCase().split('-')[0] === language);
    if (near !== undefined) return near;
  }
  return null;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Hosted app surfaces being served, in discovery order. Never null. */
    surfaces: readonly HostedSurface[];
    /**
     * The surface a URL belongs to, or null. Used by the not-found handler to
     * apply the right SPA fallback — a deep link into a surface must land on
     * that surface's `index.html`, not on the dashboard's.
     */
    surfaceForUrl: (url: string) => HostedSurface | null;
    /**
     * The surface a request's `Host` is mapped to, or null — null for every
     * request on an instance with no `surfaces.domains` entries, which is what
     * keeps unmapped hosts byte-identical to the pre-domain behaviour.
     */
    surfaceForHost: (request: FastifyRequest) => Promise<HostedSurface | null>;
    /**
     * Apply a surface's access rule. Resolves `true` when it has ANSWERED the
     * request (redirected or refused) and the caller must stop.
     *
     * Shared deliberately: the static route, the SPA fallback and the
     * mapped-host serve are three different code paths into the same bundle,
     * and a gate on only the first is no gate at all — `/apps/<key>/staff`
     * with no trailing slash matches no static route and lands straight in the
     * not-found handler; a mapped staff domain reaches the bundle through a
     * root-level hook instead.
     */
    surfaceGate: (
      surface: HostedSurface,
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<boolean>;
    /**
     * Cached `surfaces.apps` / `surfaces.domains`, or null on a boot with no
     * meta store.
     *
     * Decorated here rather than created per consumer because three of them
     * need the SAME cache: Host routing reads it per request, `/bootstrap`
     * reads it per cold load, and the admin write path invalidates it. Three
     * caches would mean an operator's save taking effect in one place and not
     * the others.
     */
    surfaceSettings: SurfaceSettingsCache | null;
  }
}

export interface SurfacesPluginOptions {
  surfaces?: readonly HostedSurface[] | undefined;
  /**
   * Installed apps, re-read on install and uninstall. Absent ⇒ this
   * composition serves only what boot discovered.
   */
  installed?: InstalledApps | undefined;
  /** Absent ⇒ no placement settings; every surface stays where it is mounted. */
  metaDb?: MetaDb | undefined;
  /**
   * Opens `token_encrypted` for the `surface-config.json` route. Absent ⇒
   * the route is not registered and a hosted customer surface can only be
   * configured by baked `VITE_` vars.
   */
  crypto?: DsnCrypto | undefined;
}

/**
 * The paths a MAPPED host still serves from the dashboard — what makes a
 * mapped staff domain sign-in-able at all: the gate's `302 /login?next=…`
 * lands on the dashboard's login screen ON that host, `POST
 * /api/v1/auth/login` sets the session cookie FOR that host (CSRF leg A
 * already derives its expectation from `Host`), and the redirect back to
 * `next` re-enters the gated surface with the cookie present.
 *
 * Deliberately NOT here: `/state`, `/account`, and every other dashboard
 * surface — an operator managing the workspace does that on the admin host.
 * The set is uniform across mapped customer and staff hosts: carving it
 * per-side would make the two mapped kinds behave differently for no one's
 * benefit.
 */
export const RESERVED_AUTH_PATHS = ['/login', '/otp', '/forgot', '/reset'] as const;

/**
 * Should this path keep its normal (host-agnostic) meaning on a mapped host?
 *
 * `/api` and `/apps` were never surface-owned. `/assets` is the dashboard
 * BUILD's own directory — the reserved pages above are the dashboard SPA, and
 * its `index.html` loads `/assets/index-*.js`; without this the login page on
 * a mapped host would fetch its bundle and be handed the surface's
 * `index.html` as JavaScript. No surface ever references root `/assets/`
 * (surface builds use an absolute `/apps/<key>/<side>/` base), so the
 * pass-through shadows nothing.
 */
export function isHostReservedPath(path: string, side: SurfaceSide = 'staff'): boolean {
  if (path === '/api' || path.startsWith('/api/')) return true;
  if (path === '/apps' || path.startsWith('/apps/')) return true;
  // A CUSTOMER host serves no part of the dashboard: not its
  // sign-in pages, not its bundle, not its WebSocket. Those paths are refused
  // outright by the lockdown hook below rather than passed through.
  if (side === 'customer') return false;
  if (path === '/assets' || path.startsWith('/assets/')) return true;
  // The dashboard's WebSocket. Unreserved, the serve hook answered the
  // upgrade GET with the surface's index.html.
  if (path === '/ws' || path.startsWith('/ws/')) return true;
  for (const reserved of RESERVED_AUTH_PATHS) {
    if (path === reserved || path.startsWith(`${reserved}/`)) return true;
  }
  return false;
}

/** Dashboard paths a customer host refuses, whatever the method. */
const CUSTOMER_REFUSED_PATHS = [...RESERVED_AUTH_PATHS, '/assets', '/ws'] as const;

/** The anonymous public API — the one part of `/api` a customer host serves. */
const PUBLIC_API_PREFIX = '/api/v1/public/';

/**
 * What a CUSTOMER-mapped host may serve beyond its own root-served surface:
 * the public API, and that app's own customer mount
 * (`/apps/<key>/customer/…` or an instance's `/apps/<key>/<slug>/customer/…`),
 * which is where its bundle's absolute asset URLs point. Everything else under
 * `/api` or `/apps` is another app's or the admin panel's, and answers 404.
 */
export function customerHostAllows(path: string, appKey: string): boolean {
  if (path.startsWith(PUBLIC_API_PREFIX)) return true;
  if (path === '/api' || path.startsWith('/api/')) return false;
  if (path === '/apps' || path.startsWith('/apps/')) {
    const own = parseSurfacePath(path);
    if (own !== null) return own.appKey === appKey && own.side === 'customer';
    const instance = parseInstancePath(path);
    return instance !== null && instance.appKey === appKey && instance.side === 'customer';
  }
  for (const refused of CUSTOMER_REFUSED_PATHS) {
    if (path === refused || path.startsWith(`${refused}/`)) return false;
  }
  return true;
}

/**
 * A request that would paint in a browser tab, as opposed to one issued by
 * `fetch`. `Sec-Fetch-Mode` is authoritative where it exists; the `Accept`
 * sniff is the fallback for the handful of agents that omit it.
 */
function isDocumentNavigation(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const mode = request.headers['sec-fetch-mode'];
  if (typeof mode === 'string') return mode === 'navigate';
  const accept = request.headers.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

/** Row 15, "Address not found": the reader's language, else the workspace's. */
async function sendNotFoundPage(meta: MetaDb, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const locale: LocaleId =
    negotiateLocale(request.headers['accept-language']) ?? ((await recipientLocale(meta, null)) as LocaleId);
  const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
  const html = renderNotFoundPage({
    lang: bcp47(locale),
    t: (key, fallback, args) => i18n.t(key, { defaultValue: fallback, ...args }),
  });
  await reply
    .code(404)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-robots-tag', 'noindex')
    .send(html);
}

/**
 * The "not available" page, in the reader's language: a signed-in person's
 * own (their choice, else the workspace's — what their dashboard shows them);
 * a signed-out reader's browser's, else the workspace's.
 */
async function sendUnavailablePage(
  meta: MetaDb,
  surface: HostedSurface,
  reason: 'app-disabled' | 'side-off' | 'no-access',
  settings: SurfaceSettings,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = request.user;
  const session = request.session;
  const signedIn = surface.side === 'staff' && user !== null && session !== null;
  const locale: LocaleId = signedIn
    ? ((await recipientLocale(meta, user.id)) as LocaleId)
    : (negotiateLocale(request.headers['accept-language']) ??
      ((await recipientLocale(meta, null)) as LocaleId));
  const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
  const workspace = await settingsRepo(meta).get('branding.appName');
  const ownLabel = surface.manifest === null ? '' : resolveLabel(surface.manifest.appLabels, locale);
  const html = renderUnavailablePage({
    side: surface.side,
    reason,
    appName: appNameOf(settings, surface.appKey, ownLabel === '' ? null : ownLabel),
    venueName: workspace === DEFAULT_WORKSPACE_NAME ? null : workspace,
    user: signedIn ? { name: user.name, email: user.email } : null,
    // Without the core plugin (a bare harness) there is no token to mint, and
    // a form that would be refused is worse than none.
    signOut:
      signedIn && request.server.hasDecorator('csrfTokenFor')
        ? { action: SURFACE_SIGN_OUT_PATH, field: CSRF_FORM_FIELD, token: request.server.csrfTokenFor(session.id) }
        : null,
    lang: bcp47(locale),
    t: (key, fallback, args) => i18n.t(key, { defaultValue: fallback, ...args }),
  });
  await reply
    // Switched off is the app's state (503); no access is this person's (403).
    .code(reason === 'no-access' ? 403 : 503)
    .header('cache-control', 'no-store')
    .header('x-robots-tag', 'noindex')
    .type('text/html; charset=utf-8')
    .send(html);
}

/** The path half of a request URL — a query string must not defeat matching. */
function pathOf(url: string): string {
  return url.split('?')[0] ?? url;
}

/**
 * `/apps/<appKey>/<slug>/<side>/<rest…>` → its parts, or null when the path is
 * not an instance mount.
 *
 * Returns null for the UNSLUGGED form (`/apps/<appKey>/<side>/…`) by refusing a
 * slug that names a side — that form is served by the registered routes below
 * and must keep being, so that no existing URL changes hands.
 */
export function parseInstancePath(
  path: string,
): { appKey: string; slug: string; side: SurfaceSide; rest: string } | null {
  const parts = path.split('/').filter((p) => p !== '');
  if (parts.length < 4 || parts[0] !== 'apps') return null;
  const [, appKey, slug, side, ...rest] = parts;
  if (appKey === undefined || slug === undefined || side === undefined) return null;
  if (slug === 'staff' || slug === 'customer') return null;
  if (side !== 'staff' && side !== 'customer') return null;
  return { appKey, slug, side, rest: rest.join('/') };
}

/**
 * `/apps/<appKey>/<side>/<rest…>` → its parts, or null.
 *
 * The mirror image of {@link parseInstancePath}: this is the app's OWN mount,
 * the form that parser deliberately refuses. Boot-discovered surfaces are
 * served here by registered routes; an INSTALLED app has no route to be
 * matched, so its mount is parsed out of the path by the hook below.
 */
export function parseSurfacePath(
  path: string,
): { appKey: string; side: SurfaceSide; rest: string } | null {
  const parts = path.split('/').filter((p) => p !== '');
  if (parts.length < 3 || parts[0] !== 'apps') return null;
  const [, appKey, side, ...rest] = parts;
  if (appKey === undefined || side === undefined) return null;
  if (side !== 'staff' && side !== 'customer') return null;
  return { appKey, side, rest: rest.join('/') };
}

/**
 * The relative file path a mapped-host request names under the surface root,
 * or null when it names none (junk encoding, traversal, no such file). The
 * containment check is belt-and-braces on top of `send()`'s own — `statSync`
 * runs before `sendFile`, and a check that trusts the later layer to catch
 * what this one passed is two half-checks.
 */
function surfaceFileFor(root: string, path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const rel = decoded.replace(/^\/+/, '');
  if (rel === '' || rel === 'index.html') return null;
  const absolute = resolve(join(root, rel));
  if (absolute !== root && !absolute.startsWith(root + sep)) return null;
  try {
    return statSync(absolute).isFile() ? rel : null;
  } catch {
    return null;
  }
}

/** The connection an installed app's manifest row records, or null. */
async function installConnectionOf(meta: MetaDb, appKey: string): Promise<string | null> {
  const row = await meta.db
    .selectFrom('adminium_manifests')
    .select('connectionId')
    .where('manifestKey', '=', appKey)
    .where('kind', '=', 'app')
    .executeTakeFirst();
  return row?.connectionId ?? null;
}

export const surfacesPlugin = fp<SurfacesPluginOptions>(
  async (app, opts) => {
    const surfaces = opts.surfaces ?? [];
    const installed = opts.installed ?? null;

    /*
     * THE TWO SOURCES, AS ONE LIST.
     *
     * Boot-discovered surfaces come from a directory the operator points at and
     * cannot change while the process runs; installed surfaces come from a
     * store this server owns and change the moment an install finishes. Every
     * consumer downstream — the SPA fallback, Host routing, the staff gate,
     * `/bootstrap`'s nav, Studio's list — wants "every surface being served",
     * and a decorator that answered with only half of them would be the kind of
     * bug that shows up as one feature working and its neighbour not.
     *
     * A GETTER rather than an array, because `app.surfaces` is read after an
     * install has already changed the answer.
     *
     * BOOT WINS on a key collision: those surfaces own registered routes, which
     * an installed app's hook must not shadow. The install route refuses the
     * collision up front, so this ordering is the second line of that rule
     * rather than the statement of it.
     */
    const allSurfaces = (): readonly HostedSurface[] =>
      installed === null ? surfaces : [...surfaces, ...installed.current()];
    app.decorate('surfaces', { getter: allSurfaces });
    app.decorate(
      'surfaceSettings',
      opts.metaDb === undefined ? null : createSurfaceSettings({ meta: opts.metaDb }),
    );
    /*
     * Sign out from the script-free "not available" page: a plain form post,
     * so its token rides in the body (`config.csrf: 'form'` — both CSRF legs
     * still apply). Then to the sign-in page, which is where anyone on a shared
     * tablet wants to be next.
     */
    const meta = opts.metaDb;
    if (meta !== undefined) {
      app.post(
        SURFACE_SIGN_OUT_PATH,
        // A form target, not an API: nothing to describe in the OpenAPI document.
        { config: { csrf: 'form' }, schema: { hide: true } },
        async (request, reply) => {
          const { user, session } = request;
          if (user !== null && session !== null) {
            await sessionsRepo(meta).revoke(session.id);
            clearSessionCookie(reply, request);
            await auditAuth(meta, request, { action: 'logout', actorId: user.id, actorLabel: user.name });
          }
          return reply.redirect('/login', 303);
        },
      );
    }

    app.decorate('surfaceForUrl', (url: string): HostedSurface | null => {
      const path = pathOf(url);
      for (const surface of allSurfaces()) {
        if (path === surface.prefix || path.startsWith(`${surface.prefix}/`)) return surface;
      }
      return null;
    });

    app.decorate(
      'surfaceForHost',
      async (request: FastifyRequest): Promise<HostedSurface | null> => {
        // Both short-circuits are the unmapped-host fast path: an instance with
        // no surfaces or no meta store never pays the (cached) settings read.
        const known = allSurfaces();
        if (known.length === 0) return null;
        const cache = app.surfaceSettings;
        if (cache === null) return null;
        const settings = await cache.read();
        const mapping = domainMappingFor(settings, request.host, normalizeHost);
        if (mapping === null) return null;
        // A mapping to a surface that is not discovered (deleted dist, renamed
        // app) is inert rather than an error — the host serves the dashboard,
        // exactly as it did before the mapping existed, and Studio shows the
        // dangling entry for the operator to fix.
        return (
          known.find(
            (surface) => surface.appKey === mapping.appKey && surface.side === mapping.side,
          ) ?? null
        );
      },
    );

    app.decorate(
      'surfaceGate',
      async (
        surface: HostedSurface,
        request: FastifyRequest,
        reply: FastifyReply,
      ): Promise<boolean> => {
        /*
         * SWITCHED OFF comes first, for both sides and before sign-in: an app
         * the operator disabled, or a side they switched off, is not served to
         * anyone. A page load gets the script-free "not available" page; any
         * other request the coded 503.
         */
        const cache = app.surfaceSettings;
        if (cache !== null) {
          const settings = await cache.read();
          const availability = availabilityOf(settings, surface.appKey, surface.side);
          if (availability !== 'ok') {
            if (isDocumentNavigation(request) && opts.metaDb !== undefined) {
              await sendUnavailablePage(opts.metaDb, surface, availability, settings, request, reply);
              return true;
            }
            throw new AppUnavailableError(surface.appKey, availability, surface.side);
          }
        }
        if (surface.side !== 'staff') return false;
        if (request.user !== null && request.session !== null) {
          /*
           * Signed in is not enough: opening an app's staff screens is a
           * grant of its own (`app:<key>:staff`), which every role that could
           * open them before the grant existed was given.
           */
          if (typeof request.can === 'function' && !(await request.can(`app:${surface.appKey}:staff`))) {
            // A page load gets the card that says so, with who is signed in
            // and a way to sign out; anything else the coded answer.
            if (isDocumentNavigation(request) && opts.metaDb !== undefined) {
              const settings = (await app.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;
              await sendUnavailablePage(opts.metaDb, surface, 'no-access', settings, request, reply);
              return true;
            }
            throw new ForbiddenError('This account cannot open this app’s staff screens.', 'FORBIDDEN', {
              reason: 'NO_STAFF_ACCESS',
              appKey: surface.appKey,
            });
          }
          return false;
        }
        if (isDocumentNavigation(request)) {
          await reply.redirect(`/login?next=${encodeURIComponent(request.url)}`, 302);
          return true;
        }
        // Non-navigation: the coded envelope, same as any API route.
        await app.requireAuth(request, reply);
        return true;
      },
    );

    /*
     * The mapped-host serve, as a ROOT-LEVEL hook rather than a route: the
     * dashboard's static wildcard owns `/` and every real dashboard file, so
     * by the time the router has matched, a mapped host would already be
     * getting dashboard bytes. Running before dispatch is the only place the
     * Host decision can override that — and because the hook is registered
     * AFTER the auth plugin's, `request.user` is populated when the staff gate
     * reads it.
     *
     * GET/HEAD only: no other method serves static bytes on an unmapped host
     * either, so a POST to a mapped root falls through to normal routing and
     * gets the same 404 envelope it always got.
     */
    /**
     * The `surface-config.json` document for one mount, or null when this
     * server cannot answer (no meta store wired).
     *
     * ONE function for all three ways a mount is addressed — path, instance
     * path, and mapped host — because the answer must not depend on how the
     * caller arrived. Three copies of this is how a host ends up serving a
     * different database than the same instance's own URL.
     */
    async function configFor(
      settings: SurfaceSettings,
      appKey: string,
      side: SurfaceSide,
      slug: string | null,
      request: FastifyRequest,
    ): Promise<Record<string, unknown> | null> {
      const connectionId = connectionForMount(settings, appKey, slug);
      /*
       * WHAT THIS APP IS CALLED, served to the app itself.
       *
       * Every app ships its own name baked into its bundle, which made the one
       * thing an operator most wants to change the one thing they could not:
       * "Outline" sat in the sidebar of a real business's portal because that
       * is what the sample was called. The override travels here so the app's
       * OWN chrome agrees with the sidebar Adminium draws around it.
       *
       * Null when the operator has set nothing — the app then keeps the name it
       * was built with, which it already has and does not need to be told.
       * Sending the app's own label back to it would be a round trip to learn
       * something it knows, and would make an old bundle's name outrank its
       * new one after an upgrade.
       */
      const appName = appNameOverrideOf(settings, appKey);
      if (side === 'staff') {
        /*
         * The install's own connection when the operator never chose one. An
         * app installed from Studio records the database it was installed
         * into on its manifest row, but the staff config read only the surface
         * settings, so a fresh install's till booted with no connection and
         * asked the operator to pick the one it had just been installed into.
         */
        const fallback =
          connectionId === null && slug === null && opts.metaDb !== undefined
            ? await installConnectionOf(opts.metaDb, appKey)
            : null;
        const tables = await tablesOf(connectionId ?? fallback, appKey);
        const values = await settingsOf(appKey);
        /*
         * WHO IS SIGNED IN, and the token their writes carry: with these and
         * the tables above, the staff screens need neither the dashboard's
         * bootstrap nor its connections list — which a screens-only person may
         * not read, and which needs a permission a cashier does not hold.
         */
        const user = request.user;
        const session = request.session;
        const signedIn =
          user === null || session === null
            ? {}
            : {
                user: { id: user.id, name: user.name, email: user.email },
                ...(request.server.hasDecorator('csrfTokenFor') ? { csrfToken: request.server.csrfTokenFor(session.id) } : {}),
              };
        /*
         * THE VENUE'S CLOCK AND MONEY, which the screens used to learn from
         * the dashboard's connections list — a list a screens-only cashier may
         * not read. The same four facts that list carries, nothing more.
         */
        const bound = connectionId ?? fallback;
        const venue = bound === null || opts.metaDb === undefined ? null : await connectionTenantConfig(opts.metaDb, bound);
        const staffKeys = user === null || bound === null ? {} : await staffKeysFor(appKey, bound, user.id);
        return {
          connectionId: bound,
          appName,
          ...(Object.keys(staffKeys).length === 0 ? {} : { publicKeys: staffKeys }),
          ...(tables === null ? {} : { tables }),
          ...(values === null ? {} : { settings: values }),
          ...(venue === null
            ? {}
            : { timezone: venue.timezone, timezoneSource: venue.timezoneSource, currency: venue.currency }),
          serverTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...signedIn,
        };
      }
      const metaDb = opts.metaDb;
      const crypto = opts.crypto;
      if (metaDb === undefined || crypto === undefined) return null;
      const keys = publicKeysRepo(metaDb);
      // A bound instance narrows the lookup to its own database; the app's own
      // mount keeps the "newest key for this app" rule it has always had.
      const key =
        connectionId === null
          ? await keys.newestLiveByApp(appKey, 'customer')
          : await keys.newestLiveByAppAndConnection(appKey, 'customer', connectionId);
      if (key === null) {
        throw new NotFoundError('No live publishable key is bound to this surface.', {
          appKey,
          ...(slug === null ? {} : { instance: slug }),
        });
      }
      const tables = await tablesOf(
        connectionId ?? (slug === null ? await installConnectionOf(metaDb, appKey) : null),
        appKey,
      );
      const values = await settingsOf(appKey);
      return {
        baseUrl: '',
        publishableKey: openPublishableKey(crypto, key.tokenEncrypted),
        appName,
        ...(tables === null ? {} : { tables }),
        ...(values === null ? {} : { settings: values }),
      };
    }

    /**
     * The app's staff-bound keys (a kiosk's) this person may use, by purpose:
     * only the ones bound to an app role they hold, of this app, on this
     * database. The key opens nothing without that same person's sign-in
     * alongside it (the public gate checks), so the token here is a handle,
     * not a credential on its own.
     */
    async function staffKeysFor(appKey: string, connectionId: string, userId: string): Promise<Record<string, string>> {
      const metaDb = opts.metaDb;
      const crypto = opts.crypto;
      if (metaDb === undefined || crypto === undefined) return {};
      const roles = await rolesRepo(metaDb).rolesForUser(userId);
      const held = new Set(roles.filter((role) => role.appKey === appKey).map((role) => role.slug));
      if (held.size === 0) return {};
      const keys = publicKeysRepo(metaDb);
      const out: Record<string, string> = {};
      for (const purpose of await keys.purposesByApp(appKey)) {
        if (purpose === CUSTOMER_KEY_PURPOSE) continue;
        const key = await keys.newestLiveByAppAndConnection(appKey, 'customer', connectionId, Date.now(), purpose);
        const binding = key === null ? null : keyStaffBinding(key);
        if (key === null || key.managedBy !== appKey || binding === null || binding.appKey !== appKey || !held.has(binding.roleSlug)) continue;
        out[purpose] = openPublishableKey(crypto, key.tokenEncrypted);
      }
      return out;
    }

    /**
     * The app's own declared settings (a business type), with their defaults,
     * for both sides — the same values the settings page shows. Null for an
     * app that declares none, so its document is exactly what it always was.
     * A secret is never here: it is never stored in this table at all.
     */
    async function settingsOf(appKey: string): Promise<Record<string, unknown> | null> {
      if (opts.metaDb === undefined) return null;
      const row = await opts.metaDb.db
        .selectFrom('adminium_manifests')
        .select('manifest')
        .where('manifestKey', '=', appKey)
        .where('kind', '=', 'app')
        .executeTakeFirst();
      if (row === undefined) return null;
      const declared = (readJson<Manifest | null>(row.manifest)?.settings ?? []).filter((s) => s.secret !== true);
      if (declared.length === 0) return null;
      return settingValuesWithDefaults(declared, await addOnSettingsRepo(opts.metaDb).valuesFor(appKey));
    }

    /**
     * Short name → real table, for an app whose tables Adminium named (a
     * prefix, or a rename). The app reads it at boot instead of the names it
     * was built with. Null when nothing is recorded, so an app installed
     * before the record gets exactly the document it always got.
     */
    async function tablesOf(connectionId: string | null, appKey: string): Promise<Record<string, string> | null> {
      if (connectionId === null || opts.metaDb === undefined) return null;
      const names = await appTablesRepo(opts.metaDb).realNames(connectionId, appKey);
      return Object.keys(names).length === 0 ? null : names;
    }

    /*
     * THE MAPPED-HOST LOCKDOWN, for every method and ahead of
     * the serve hook below.
     *
     * A customer's domain is the shop's own address. It used to serve the
     * admin sign-in pages and pass all of `/api/*`, so a customer could reach
     * the admin panel's login — and every admin route — on the shop's domain.
     * Now it serves the public API and that app's customer surface, and every
     * other path is a 404.
     *
     * A mapping to a surface this server does not serve (a deleted app, a
     * renamed one) used to fall back to the dashboard; it now answers 503, so
     * an operator's shop domain never shows the admin panel by accident.
     *
     * A mapped STAFF host keeps the dashboard's sign-in pages (that is how the
     * till signs in), and a bare `/login` there carries `next=/` so signing in
     * lands back on the till, not on a dashboard route painted over its URL.
     */
    app.addHook('onRequest', async (request, reply) => {
      const cache = app.surfaceSettings;
      if (cache === null) return;
      const known = allSurfaces();
      const settings = await cache.read();
      const mapping = domainMappingFor(settings, request.host, normalizeHost);
      if (mapping === null) {
        // The address of an app that was uninstalled: its DNS still points here.
        const host = request.host === undefined ? '' : normalizeHost(request.host);
        const retired = Object.entries(settings.retired ?? {}).find(([mapped]) => normalizeHost(mapped) === host)?.[1];
        if (retired !== undefined) {
          throw new AppError(503, 'SURFACE_UNAVAILABLE', 'This address is set up for an app this server does not serve right now.', {
            appKey: retired.appKey,
            side: retired.side,
          });
        }
        return;
      }
      const surface = known.find((s) => s.appKey === mapping.appKey && s.side === mapping.side);
      const path = pathOf(request.url);
      if (surface === undefined) {
        throw new AppError(
          503,
          'SURFACE_UNAVAILABLE',
          'This address is set up for an app this server does not serve right now.',
          { appKey: mapping.appKey, side: mapping.side },
        );
      }
      if (mapping.side === 'customer') {
        if (!customerHostAllows(path, mapping.appKey)) {
          // A guest's browser gets the venue's plain page; an API call, the JSON envelope.
          if (isDocumentNavigation(request) && !path.startsWith('/api/') && opts.metaDb !== undefined) {
            return sendNotFoundPage(opts.metaDb, request, reply);
          }
          throw new NotFoundError('Nothing is served at this address.');
        }
        return;
      }
      if (path === '/login' && request.method === 'GET') {
        const query = new URLSearchParams(request.url.split('?')[1] ?? '');
        if (!query.has('next') && !query.has('returnTo')) {
          return reply.redirect('/login?next=%2F', 302);
        }
      }
    });

    app.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return;
      const path = pathOf(request.url);
      const hostSurface = await app.surfaceForHost(request);
      if (isHostReservedPath(path, hostSurface?.side ?? 'staff')) return;
      const surface = hostSurface;
      if (surface === null) return;
      if (await app.surfaceGate(surface, request, reply)) return reply;
      /*
       * A mapped host serves the app at `/`, so its config lives at `/` too.
       * The app cannot work out which INSTANCE a host is for — it never sees
       * the mapping — so this is the only place that answer can come from.
       */
      if (path === '/surface-config.json') {
        const settings = (await app.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;
        const mapping = domainMappingFor(settings, request.host, normalizeHost);
        const doc = await configFor(
          settings,
          surface.appKey,
          surface.side,
          mapping?.instance ?? null,
          request,
        );
        if (doc !== null) {
          void reply.header('cache-control', 'no-store');
          return reply.send(doc);
        }
      }
      const file = surfaceFileFor(surface.root, path);
      if (file !== null) return reply.sendFile(file, surface.root);
      return reply.sendFile('index.html', surface.root);
    });

    /*
     * EXTRA INSTANCES of an app, at `/apps/<appKey>/<slug>/<side>/…`.
     *
     * A HOOK, not registered routes, and for the same reason Host routing is a
     * hook: instances live in settings and an operator adds one in Studio. Routes
     * are fixed at boot, so registering them would make every new instance need a
     * restart — a setting that only takes effect after a deploy is one people
     * stop trusting.
     *
     * The slug sits BEFORE the side so it cannot collide with the app's own
     * routes; `staff` and `customer` are refused as slugs, which is what makes
     * this parse unambiguous rather than merely lucky.
     *
     * Assets are NOT re-served here. `index.html` references them absolutely
     * under the root mount (`/apps/<appKey>/<side>/assets/…`), which is already
     * served, so every instance shares one copy of the bundle — the whole point
     * of instances being a setting rather than a second build.
     */
    app.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return;
      const path = pathOf(request.url);
      const parsed = parseInstancePath(path);
      if (parsed === null) return;
      const surface = allSurfaces().find(
        (s) => s.appKey === parsed.appKey && s.side === parsed.side,
      );
      if (surface === undefined) return;

      const settings = (await app.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;
      const connectionId = connectionForMount(settings, parsed.appKey, parsed.slug);
      // An unknown slug is NOT this hook's request. Falling through leaves the
      // dashboard's own 404 to answer, which is what any other unknown path gets.
      if (connectionId === null) return;

      if (await app.surfaceGate(surface, request, reply)) return reply;

      if (parsed.rest === 'surface-config.json') {
        void reply.header('cache-control', 'no-store');
        const doc = await configFor(settings, parsed.appKey, parsed.side, parsed.slug, request);
        if (doc !== null) return reply.send(doc);
        return;
      }
      const file = surfaceFileFor(surface.root, `/${parsed.rest}`);
      if (file !== null) return reply.sendFile(file, surface.root);
      return reply.sendFile('index.html', surface.root);
    });

    /*
     * INSTALLED APPS, at their own mount
     * `/apps/<appKey>/<side>/…`.
     *
     * A HOOK for the same reason the instance mount above is one, and here the
     * reason is sharper: routes are fixed at boot, and an install happens while
     * the server is running. Registered routes would make every install end in
     * "now restart your server", which is not an install.
     *
     * It runs AFTER the instance hook, so a slugged path has already been
     * claimed, and it yields to any boot-discovered surface holding the same
     * key — those own real routes, and a hook that answered first would shadow
     * them silently.
     *
     * Bytes are served with `sendFile` out of the pinned tree, not re-hashed
     * per request. The pin's job is the TOCTOU window between unpack and
     * install — `verifyTree` closes that before a single byte is parsed — and
     * re-hashing every asset on every request would put a full digest on the
     * hot path that the directory-backed source does not pay either. What is
     * served is what install verified.
     */
    if (installed !== null) {
      app.addHook('onRequest', async (request, reply) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return;
        const parsed = parseSurfacePath(pathOf(request.url));
        if (parsed === null) return;
        // A boot-discovered surface owns this mount: leave it to its routes.
        if (surfaces.some((s) => s.appKey === parsed.appKey && s.side === parsed.side)) return;
        const surface = installed
          .current()
          .find((s) => s.appKey === parsed.appKey && s.side === parsed.side);
        /*
         * INSTALLED, BUT NOTHING OF IT IS HERE. Falling through here
         * hands the request to the dashboard's SPA wildcard, which answers
         * `index.html` with **200** — so a wiped data volume looked exactly
         * like a working app that had navigated to its own 404, and the URL
         * appeared to succeed. `missing()` is the meta store's account of what
         * was installed, which is the only witness left once the files are
         * gone.
         *
         * 503, not 404: 404 says "no such app", and this app exists. The coded
         * envelope is deliberate and this hook invents no HTML fault page —
         * the server renders none anywhere else, and a page a person can read
         * belongs in the dashboard, where it can be localized. What is fixed
         * here is the lie in the status code.
         */
        if (surface === undefined) {
          if (installed.missing().some((ref) => ref.key === parsed.appKey)) {
            throw new AppError(
              503,
              'APP_FILES_MISSING',
              `The app "${parsed.appKey}" is installed but its files are not on this server, so it ` +
                'cannot be served. Install the same version again, or uninstall it.',
            );
          }
          // Not installed either: the dashboard's own 404 answers, exactly as
          // it does for any other unknown path.
          return;
        }

        if (await app.surfaceGate(surface, request, reply)) return reply;

        if (parsed.rest === 'surface-config.json') {
          void reply.header('cache-control', 'no-store');
          const settings = (await app.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;
          const doc = await configFor(settings, parsed.appKey, parsed.side, null, request);
          if (doc !== null) return reply.send(doc);
          return;
        }

        const file = surfaceFileFor(surface.root, `/${parsed.rest}`);
        if (file !== null) return reply.sendFile(file, surface.root);
        return reply.sendFile('index.html', surface.root);
      });
    }

    for (const surface of surfaces) {
      await app.register(async (scope) => {
        scope.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
          if (await app.surfaceGate(surface, request, reply)) return reply;
        });

        /*
         * Served-not-baked customer configuration. An EXACT route in the same
         * scope as the static mount: exact beats wildcard in the router, so it
         * shadows any `surface-config.json` a build might have left on disk.
         *
         * BOTH SIDES ARE SERVED, for opposite reasons. The customer document
         * carries a publishable key. The STAFF document carries no key — staff
         * reads through the operator's session by design — and exists to answer
         * the question that key was also silently answering: WHICH CONNECTION
         * this app reads. Unbound, a staff app infers "the only one serving",
         * which stops being true the moment an instance has two.
         *
         * The document is exactly as public as the bundle it configures: the
         * publishable key already ships inside a public JS file on every
         * standalone build (made it re-readable in Studio for that reason).
         * Serving it here is the same exposure with rotation made cheap —
         * rotate in Studio, reload the page, no rebuild — which is why the
         * reply is `no-store`.
         */
        const metaDb = opts.metaDb;
        const crypto = opts.crypto;
        /*
         * THROUGH `configFor`, like the other two mounts.
         *
         * This used to be a second implementation of the same document, and it
         * drifted the first time the document grew a field: the instance and
         * mapped-host paths served the app's name while this one — the plain
         * `/apps/<key>/<side>/` URL, the one almost every install actually uses
         * — did not. That is precisely the failure `configFor`'s own comment
         * describes, so there is now one builder and three callers.
         *
         * `null` from it means this server cannot answer (no meta store); the
         * missing-key case throws from inside, as it always did.
         */
        if (surface.side === 'staff' || (metaDb !== undefined && crypto !== undefined)) {
          scope.get(`${surface.prefix}/surface-config.json`, async (request, reply) => {
            const settings = (await app.surfaceSettings?.read()) ?? NO_SURFACE_SETTINGS;
            const doc = await configFor(settings, surface.appKey, surface.side, null, request);
            if (doc === null) throw new NotFoundError('This surface has no configuration.', {
              appKey: surface.appKey,
            });
            void reply.header('cache-control', 'no-store');
            return doc;
          });
        }

        await scope.register(fastifyStatic, {
          root: surface.root,
          prefix: `${surface.prefix}/`,
          // Only ONE registration may decorate `reply.sendFile`, and
          // plugins/static.ts owns it, dashboard or not. These serve through
          // the route handler instead.
          decorateReply: false,
          wildcard: true,
        });
      });

      app.log.info(
        { appKey: surface.appKey, side: surface.side, prefix: surface.prefix },
        'serving hosted app surface',
      );
    }
  },
  { name: 'adminium-surfaces', fastify: '5.x', dependencies: ['adminium-auth'] },
);
