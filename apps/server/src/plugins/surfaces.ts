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
 * ─── Domain attachment (29-app-surfaces.md D3/D4, 29-T06) ────────────────────
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

import { publicKeysRepo, type DsnCrypto, type MetaDb } from '@adminium/meta';

import type { HostedSurface, SurfaceSide } from '../cli/surfaces-root.js';
import { NotFoundError } from '../errors.js';
import { openPublishableKey } from '../public-api/keys.js';
import { normalizeHost } from '../security/csrf.js';
import {
  connectionForMount,
  type SurfaceSettings,
  staffConnectionOf,
  createSurfaceSettings,
  domainMappingFor,
  type SurfaceSettingsCache,
} from '../surfaces/settings.js';

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
     * The surface a request's `Host` is mapped to (29 D3), or null — null for
     * every request on an instance with no `surfaces.domains` entries, which is
     * what keeps unmapped hosts byte-identical to the pre-domain behaviour.
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
     * Cached `surfaces.apps` / `surfaces.domains` (29-app-surfaces.md D9), or
     * null on a boot with no meta store.
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
  /** Absent ⇒ no placement settings; every surface stays where it is mounted. */
  metaDb?: MetaDb | undefined;
  /**
   * Opens `token_encrypted` for the `surface-config.json` route (29 D10).
   * Absent ⇒ the route is not registered and a hosted customer surface can
   * only be configured by baked `VITE_` vars.
   */
  crypto?: DsnCrypto | undefined;
}

/**
 * The paths a MAPPED host still serves from the dashboard (29 D4) — what makes
 * a mapped staff domain sign-in-able at all: the gate's `302 /login?next=…`
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
export function isHostReservedPath(path: string): boolean {
  if (path === '/api' || path.startsWith('/api/')) return true;
  if (path === '/apps' || path.startsWith('/apps/')) return true;
  if (path === '/assets' || path.startsWith('/assets/')) return true;
  for (const reserved of RESERVED_AUTH_PATHS) {
    if (path === reserved || path.startsWith(`${reserved}/`)) return true;
  }
  return false;
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

export const surfacesPlugin = fp<SurfacesPluginOptions>(
  async (app, opts) => {
    const surfaces = opts.surfaces ?? [];
    app.decorate('surfaces', surfaces);
    app.decorate(
      'surfaceSettings',
      opts.metaDb === undefined ? null : createSurfaceSettings({ meta: opts.metaDb }),
    );
    app.decorate('surfaceForUrl', (url: string): HostedSurface | null => {
      const path = pathOf(url);
      for (const surface of surfaces) {
        if (path === surface.prefix || path.startsWith(`${surface.prefix}/`)) return surface;
      }
      return null;
    });

    app.decorate(
      'surfaceForHost',
      async (request: FastifyRequest): Promise<HostedSurface | null> => {
        // Both short-circuits are the unmapped-host fast path: an instance with
        // no surfaces or no meta store never pays the (cached) settings read.
        if (surfaces.length === 0) return null;
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
          surfaces.find(
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
        if (surface.side !== 'staff') return false;
        if (request.user !== null && request.session !== null) return false;
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
     * The mapped-host serve (29 D3), as a ROOT-LEVEL hook rather than a route:
     * the dashboard's static wildcard owns `/` and every real dashboard file,
     * so by the time the router has matched, a mapped host would already be
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
    ): Promise<Record<string, unknown> | null> {
      const connectionId = connectionForMount(settings, appKey, slug);
      if (side === 'staff') return { connectionId };
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
      return { baseUrl: '', publishableKey: openPublishableKey(crypto, key.tokenEncrypted) };
    }

    app.addHook('onRequest', async (request, reply) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return;
      const path = pathOf(request.url);
      if (isHostReservedPath(path)) return;
      const surface = await app.surfaceForHost(request);
      if (surface === null) return;
      if (await app.surfaceGate(surface, request, reply)) return reply;
      /*
       * A mapped host serves the app at `/`, so its config lives at `/` too.
       * The app cannot work out which INSTANCE a host is for — it never sees
       * the mapping — so this is the only place that answer can come from.
       */
      if (path === '/surface-config.json') {
        const settings = (await app.surfaceSettings?.read()) ?? { apps: {}, domains: {} };
        const mapping = domainMappingFor(settings, request.host, normalizeHost);
        const doc = await configFor(
          settings,
          surface.appKey,
          surface.side,
          mapping?.instance ?? null,
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
     * EXTRA INSTANCES of an app, at `/apps/<appKey>/<slug>/<side>/…` (29 D9).
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
      const surface = surfaces.find(
        (s) => s.appKey === parsed.appKey && s.side === parsed.side,
      );
      if (surface === undefined) return;

      const settings = (await app.surfaceSettings?.read()) ?? { apps: {}, domains: {} };
      const connectionId = connectionForMount(settings, parsed.appKey, parsed.slug);
      // An unknown slug is NOT this hook's request. Falling through leaves the
      // dashboard's own 404 to answer, which is what any other unknown path gets.
      if (connectionId === null) return;

      if (await app.surfaceGate(surface, request, reply)) return reply;

      if (parsed.rest === 'surface-config.json') {
        void reply.header('cache-control', 'no-store');
        const doc = await configFor(settings, parsed.appKey, parsed.side, parsed.slug);
        if (doc !== null) return reply.send(doc);
        return;
      }
      const file = surfaceFileFor(surface.root, `/${parsed.rest}`);
      if (file !== null) return reply.sendFile(file, surface.root);
      return reply.sendFile('index.html', surface.root);
    });

    for (const surface of surfaces) {
      await app.register(async (scope) => {
        scope.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
          if (await app.surfaceGate(surface, request, reply)) return reply;
        });

        /*
         * Served-not-baked customer configuration (29 D10, 29-T16). An EXACT
         * route in the same scope as the static mount: exact beats wildcard in
         * the router, so it shadows any `surface-config.json` a build might
         * have left on disk.
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
         * standalone build (28 §3.3 made it re-readable in Studio for that
         * reason). Serving it here is the same exposure with rotation made
         * cheap — rotate in Studio, reload the page, no rebuild — which is why
         * the reply is `no-store`.
         */
        const metaDb = opts.metaDb;
        const crypto = opts.crypto;
        if (surface.side === 'staff') {
          scope.get(`${surface.prefix}/surface-config.json`, async (_request, reply) => {
            const settings = (await app.surfaceSettings?.read()) ?? { apps: {}, domains: {} };
            void reply.header('cache-control', 'no-store');
            /*
             * `null` is a complete answer, not a missing one: it means nobody
             * has bound this surface and the app should keep inferring. So this
             * never 404s the way the customer variant does over a missing key —
             * there is nothing here that has to exist for the app to work.
             */
            return { connectionId: staffConnectionOf(settings, surface.appKey) };
          });
        }

        if (surface.side === 'customer' && metaDb !== undefined && crypto !== undefined) {
          scope.get(`${surface.prefix}/surface-config.json`, async (_request, reply) => {
            const key = await publicKeysRepo(metaDb).newestLiveByApp(surface.appKey, 'customer');
            if (key === null) {
              // The standard coded envelope; the app's hard-stop renders it as
              // the legible "not connected" screen (28 D24's failure surface).
              throw new NotFoundError('No live publishable key is bound to this surface.', {
                appKey: surface.appKey,
              });
            }
            void reply.header('cache-control', 'no-store');
            return { baseUrl: '', publishableKey: openPublishableKey(crypto, key.tokenEncrypted) };
          });
        }

        await scope.register(fastifyStatic, {
          root: surface.root,
          prefix: `${surface.prefix}/`,
          // Only ONE registration may decorate `reply.sendFile`; the dashboard's
          // has it. These serve through the route handler instead.
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
