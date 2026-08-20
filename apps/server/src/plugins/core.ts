// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `core` plugin (08-server-api.md §1.2): cookie support (signed with
 * ADMINIUM_SECRET), the same-origin CORS default — no CORS headers are emitted
 * unless ADMINIUM_CORS_ORIGINS opts specific origins in (§7 item 4) — plus the
 * §7-item-5 security headers (@fastify/helmet) and the §6 rate limiter
 * (@fastify/rate-limit). Request-id, redaction, and the error envelope live in
 * `app.ts` because they attach at instance creation.
 *
 * ─── Rate limiting (§6) ───────────────────────────────────────────────────────
 *
 * The limiter is registered `global: false` and attached per route by an
 * `onRoute` hook added HERE, before @fastify/rate-limit registers its own, so
 * this table stays the single owner of the limits (08 §6: "Limits are
 * constants in `apps/server/src/plugins/core.ts` (`RATE_BUCKETS`)").
 *
 * A route lands in a bucket one of two ways:
 *
 *  1. It DECLARES one — `config.rateLimitBucket`, the marker the
 *     credential-facing routes already carry (routes/auth, routes/setup,
 *     routes/auth/desktop-session, routes/search). A declaration always wins.
 *  2. {@link AUTO_BUCKETS} matches its method + url, and everything else under
 *     `/api/` falls back to the general `api` bucket.
 *
 * Rule 2 exists because the buckets §6 asks for beyond the auth doors —
 * widget-data, exports/imports, LLM, file bytes, and the general default —
 * span eleven route groups that are CONDITIONALLY registered (LLM needs a
 * provider, imports need storage, desktop needs `ADMINIUM_RUNTIME=desktop`).
 * The declaration gate only fires for routes registered in THAT boot, so a
 * marker typo in a feature nobody enabled locally is invisible until a
 * customer enables it. A url table in this file is checked on every boot of
 * every shape, and keeps the limits readable as one list.
 *
 * `global: false` stays: turning it on would bucket the `@fastify/static`
 * wildcard and every SPA asset, so the general default is applied by the same
 * `onRoute` hook, gated on `route.url.startsWith('/api/')`.
 *
 * TWO ROUTES ARE EXEMPT ON PURPOSE — `GET /api/v1/events` (SSE) and `GET /ws`.
 * The limiter is an `onRequest` hook, so it fires on the UPGRADE, not on
 * traffic: a network flap or a laptop wake reconnects every open tab at once
 * and would 429 a client out of realtime entirely, for the whole window, for
 * doing nothing wrong.
 *
 * Buckets are FIXED-WINDOW counters in one shared in-memory map (§6: "the
 * in-memory store — single-process: droplet, self-host, and Electron all run
 * one instance"). The store is shared across ROUTES, not just requests, and
 * keys are `<bucket>:<subject>`: `/auth/login`, `/auth/2fa/verify`,
 * `/setup/super-admin` and `/auth/desktop-session` all draw down the same five
 * tries per minute per address — per-route counters would hand an attacker one
 * budget per door.
 *
 * The SUBJECT is per bucket (`keyBy`). The auth doors key by ip and must keep
 * doing so: they are unauthenticated by nature, and per-ip keying is what
 * guarantees a LAN peer hammering `/auth/desktop-session` (11-electron.md
 * §8.3) can never lock the loopback exchange out. Everything else keys by
 * PRINCIPAL — api key, else session user, else ip — because those routes are
 * authenticated and one shared office NAT should not be one budget.
 *
 * THE IP FALLBACK IS A REAL BEHAVIOUR CHANGE and worth stating: `GET /branding`,
 * `GET /branding/logo`, pre-login `/auth/*` and `/setup/*` are deliberately
 * public, so every signed-out visitor behind one NAT now shares one `api`
 * budget for the sign-in screen. 300/min is picked with that in mind: a cold
 * sign-in page costs a handful of requests, so 300 leaves room for a large
 * office to sign in simultaneously while still bounding an anonymous flood.
 *
 * NOT DONE, deliberately: the `adminium_settings.security` override §6
 * mentions. There is no `security.*` settings namespace — `PUT /settings/security`
 * is a route name whose fields map to `auth.*` — so an override would mean
 * inventing new registry keys, and `corePlugin` composes before any meta store
 * exists and has no meta handle to read them with. The buckets are the value;
 * making them editable is a separate wave with a settings surface behind it.
 *
 * A limit hit throws the SAME `RateLimitedError` handlers would throw, so the
 * 429 rides the one §1.4 envelope (`details: { bucket, limit, resetAt }`) and
 * the plugin's own `retry-after` / `x-ratelimit-*` headers survive on the
 * reply the global error handler sends.
 *
 * ─── CSRF (§7 item 4) ─────────────────────────────────────────────────────────
 *
 * The verifier is a `preValidation` hook installed here; the decision itself
 * lives in `security/csrf.ts`, which is where the reasoning is written down.
 *
 * `preValidation` and NOT `onRequest`: this plugin registers FIRST (app.ts),
 * before `authPlugin`, so at `onRequest` time `request.user`, `request.session`
 * and `request.apiKey` are all still null — an `onRequest` hook here would see
 * every request as anonymous and check nothing. Instance-level `preValidation`
 * runs after every `onRequest` hook and before the route's own, which is
 * exactly the window the check needs. Registering here (rather than in a
 * later plugin) is also what makes it universal: Fastify 5 snapshots the
 * parent's hook arrays with `.slice()` when a child scope is created, so a
 * hook added after `buildServer`'s scopes exist would never be seen by them.
 *
 * ─── Security headers (§7 item 5) ─────────────────────────────────────────────
 *
 * CSP is `default-src 'self'` with exactly one script allowance: sha256 hashes
 * of the inline scripts in the SERVED dashboard `index.html` — in practice the
 * theme pre-hydration flash guard (02-design-system.md §4.3), hashed from the
 * build at boot so the allowance tracks the artifact rather than a constant
 * that can drift. No `upgrade-insecure-requests` and no HSTS unless
 * `ADMINIUM_TRUST_PROXY` (behind Caddy/TLS): the desktop shell and §8.3 LAN
 * share serve plain `http://` loopback/LAN origins by design, and either
 * directive would quietly break them. `connect-src` adds `ws://<host>
 * wss://<host>` derived from each request's Host header, because CSP's
 * `'self'` does not reliably cover same-host WebSocket upgrades (`/ws`, §4)
 * across engines — but bare `ws:`/`wss:` scheme sources would allow a socket
 * to ANY origin, which defeats the exfiltration boundary `'self'` sets.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join, resolve } from 'node:path';

import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../config/env.js';
import { ForbiddenError, RateLimitedError } from '../errors.js';
import {
  allowedOriginHosts,
  checkCsrf,
  csrfSigningKey,
  type CsrfDeps,
} from '../security/csrf.js';

/** One §6 bucket: a fixed window of `max` requests per `timeWindowMs`. */
export interface RateBucket {
  max: number;
  timeWindowMs: number;
  /**
   * What the counter is keyed on. `ip` for the unauthenticated doors (see the
   * module header — this is load-bearing for §8.3 loopback); `principal` =
   * api key → session user → ip, in that order.
   */
  keyBy: 'ip' | 'principal';
}

/**
 * The §6 bucket table (08-server-api.md §6). Keys are the
 * `config.rateLimitBucket` markers routes declare; a route declaring a bucket
 * that is not in this table fails AT BOOT (the onRoute hook throws), so the
 * two spellings cannot drift apart silently.
 *
 *  - `auth-login`      — `/auth/login`, `/auth/2fa/verify`, `/setup/super-admin`,
 *                        `/auth/desktop-session` (5/min, §6 row 1; §7 item 7
 *                        "TOTP … verify rate-limited").
 *  - `auth-password-forgot` — `/auth/password/forgot` (3/hour, §6 row 2).
 *  - `auth-password-reset`  — `/auth/password/reset`: the token CONSUME side.
 *                        Not in the §6 table by name, but §7 item 7's
 *                        single-use + 30-min-TTL reset tokens are only as
 *                        strong as the guess rate this cap sets.
 *  - `search`          — `GET /search` (60/min, §6 row 5): each request fans
 *                        out parallel ILIKE queries over up to 20 tables, the
 *                        cheapest DoS lever of the unbucketed routes.
 *
 *  - `api`             — the §6 row-1 general default, 300/min, applied to every
 *                        other `/api/` route that does not match a narrower
 *                        rule. Read the ip-fallback paragraph in the module
 *                        header before changing the number.
 *  - `widget-data`     — `POST /widget-data/{query,batch}` (120/min, §6): a
 *                        dashboard paints many widgets at once, so this sits
 *                        well above the general per-minute feel while still
 *                        bounding a scripted fan-out.
 *  - `data-io`         — export/import CREATION (10/hour, §6 "exports/imports"):
 *                        `POST /exports` and `POST /imports`. Each one leads to
 *                        a job that reads or writes a whole table. `run` is
 *                        deliberately not charged — see {@link AUTO_BUCKETS}.
 *  - `llm`             — the provider-calling LLM routes (20/hour, §6). Per
 *                        principal, so it is 20 assists per person per hour,
 *                        not per install. `apply`/`undo`/`diff` are NOT in it:
 *                        they replay a run that was already paid for.
 *  - `file-bytes`      — the §6 "files" row (30/hour). There is no `files`
 *                        route group, so the budget lands on the four surfaces
 *                        that actually move file bytes: `POST /branding/logo`,
 *                        `POST /imports/upload`, `GET /imports/:id/error-report`
 *                        and `GET /exports/:id/download`.
 *  - `app-shell`       — the SPA's COLD-START payload (900/min): the six routes
 *                        a browser must GET to render the shell at all, before
 *                        the user has asked for anything — nine requests, since
 *                        the i18n bundle is fetched per namespace. Not a §6 row;
 *                        see the deviation note below for why it had to exist.
 *
 * DELIBERATE §6 DEVIATIONS (documented here so the table can't drift
 * silently):
 *  - The auth buckets key per-IP, not the spec'd "IP + email": per-IP keying
 *    is what guarantees a LAN flood can never lock the loopback
 *    `/auth/desktop-session` exchange out (tested in rate-limit.test.ts). A
 *    per-account counter for distributed credential sprays is a possible
 *    additive follow-up, not a replacement.
 *  - A route in a narrow bucket does NOT also draw down `api`. Keys embed the
 *    bucket name, so the budgets are independent by construction; making them
 *    nest would mean two `incr` calls per request and a much less predictable
 *    429. The narrow limits are all well under 300/min anyway.
 *  - `app-shell` is an EXTRA bucket §6 does not list. §6 row 1 reads as a
 *    budget for what a USER DOES, but the general bucket as built also charges
 *    what the APP COSTS TO BOOT, and those are different sizes. Every cold
 *    document load spends nine `/api/` GETs before the user has asked for
 *    anything: `/bootstrap`, `/branding`, `/system/info`, `/i18n/manifest`,
 *    three `/i18n/bundle/:locale/:namespace` namespaces and
 *    `/me/notifications`. At 300/min
 *    that leaves one principal ~30 page loads a minute, floor to ceiling —
 *    which the e2e suite (41 `page.goto`s, 428 requests in its worst 60s
 *    window) blows straight through, and which a tab-heavy admin or anyone
 *    holding reload can reach as well. The consequence is out of proportion to
 *    the cause: a 429 on `/bootstrap` or on a bundle does not degrade a
 *    feature, it replaces the entire app with the rate-limited state page.
 *
 *    So the line this bucket draws is: `app-shell` is what the browser must
 *    fetch to render the shell AT ALL, `api` is what the user's actions cost.
 *    The moved routes are fetched once per DOCUMENT, never per interaction,
 *    are cheap (settings reads, build-time bundles, one meta-store round trip)
 *    and are conditional-GET cacheable, so most hits are 304 revalidations
 *    doing no work at all. They are the API-side half of the payload
 *    `/assets/*` is — and that half is unlimited (`global: false`), so bucketing
 *    these at all is already stricter than their static twin.
 *
 *    900/min is nine requests × 100 cold loads a minute: sized so a client
 *    reloading every 600ms for a solid minute — faster than a human, about
 *    what a headless test runner does — still works, while a scripted flood is
 *    still bounded to 15/s of cached reads per principal. It is deliberately
 *    NOT a licence for chattiness: adding a tenth per-load request to the
 *    shell should move this number, not hide inside it.
 *  - The `adminium_settings.security` override §6 mentions is not built — see
 *    the module header for why (there is no `security.*` namespace to read).
 */
export const RATE_BUCKETS = {
  'auth-login': { max: 5, timeWindowMs: 60_000, keyBy: 'ip' },
  'auth-password-forgot': { max: 3, timeWindowMs: 3_600_000, keyBy: 'ip' },
  'auth-password-reset': { max: 5, timeWindowMs: 60_000, keyBy: 'ip' },
  search: { max: 60, timeWindowMs: 60_000, keyBy: 'principal' },
  api: { max: 300, timeWindowMs: 60_000, keyBy: 'principal' },
  'app-shell': { max: 900, timeWindowMs: 60_000, keyBy: 'principal' },
  'widget-data': { max: 120, timeWindowMs: 60_000, keyBy: 'principal' },
  'data-io': { max: 10, timeWindowMs: 3_600_000, keyBy: 'principal' },
  llm: { max: 20, timeWindowMs: 3_600_000, keyBy: 'principal' },
  'file-bytes': { max: 30, timeWindowMs: 3_600_000, keyBy: 'principal' },
  /*
   * A BACKSTOP, not the real limit (28-public-surface.md D9).
   *
   * The public namespace runs its own counters — per session, then per key,
   * then per IP — because `principalKey` below cannot see a publishable key:
   * its own comment forbids reading a decoration that `plugins/rbac.ts`
   * registers later, and an `adm_pub_` token never becomes an rbac principal at
   * all. A `keyBy: 'public'` branch here would silently fall through to
   * `ip:`, which behind the shipped Caddy is ONE bucket for every anonymous
   * caller on earth.
   *
   * This entry exists so the boot-time bucket check accepts the marker, and it
   * is deliberately looser than any per-route limit the public plugin applies.
   */
  public: { max: 600, timeWindowMs: 60_000, keyBy: 'ip' },
} as const satisfies Readonly<Record<string, RateBucket>>;

/**
 * The marker vocabulary. Tightened from `string` so a typo in a route's
 * `config.rateLimitBucket` is a TYPECHECK failure rather than a boot failure
 * only the deployments that enable that feature ever see.
 */
export type RateLimitBucket = keyof typeof RATE_BUCKETS;

/**
 * Method + url rules for routes that do not declare a marker (see the module
 * header for why these live here and not on the routes). First match wins, so
 * the narrow patterns come before the ones they would otherwise shadow. Urls
 * are matched as Fastify registered them — with the `/api/v1` prefix and with
 * `:param` placeholders intact — anchored at the end so a prefix change or a
 * future `/v2` cannot silently drop a route out of its bucket.
 */
const AUTO_BUCKETS: readonly {
  methods: readonly string[];
  pattern: RegExp;
  bucket: RateLimitBucket;
}[] = [
  { methods: ['POST'], pattern: /\/widget-data\/(?:query|batch)$/, bucket: 'widget-data' },
  // The cold-start payload — see the `app-shell` deviation note above. GET
  // only, and anchored: `POST /branding/logo` must keep falling through to
  // `file-bytes` below, and `/branding` must not swallow it.
  {
    methods: ['GET'],
    pattern:
      /\/(?:bootstrap|branding|system\/info|i18n\/manifest|i18n\/bundle\/:locale\/:namespace|me\/notifications)$/,
    bucket: 'app-shell',
  },
  { methods: ['POST'], pattern: /\/(?:branding\/logo|imports\/upload)$/, bucket: 'file-bytes' },
  {
    methods: ['GET'],
    pattern: /\/(?:imports\/:id\/error-report|exports\/:id\/download)$/,
    bucket: 'file-bytes',
  },
  // The CREATE side only. `POST /imports/:id/run` is not double-charged: it
  // can only fire on an import this bucket already paid for, and only while
  // that import is `ready` (the route 409s otherwise), so charging it too
  // would halve the documented 10/hour rather than enforce it.
  { methods: ['POST'], pattern: /\/(?:exports|imports)$/, bucket: 'data-io' },
  {
    methods: ['POST'],
    pattern: /\/(?:llm\/config\/test|llm\/runs|llm\/runs\/:id\/execute)$/,
    bucket: 'llm',
  },
  { methods: ['GET'], pattern: /\/llm\/models$/, bucket: 'llm' },
];

/**
 * The long-lived streams. `/ws` is matched exactly — it hangs off the ROOT
 * app, not `/api/v1`, so a prefix-scoped list would miss it. SSE is matched by
 * suffix because `registerJobsAndRealtime` takes a configurable api prefix.
 *
 * TRAP: a future route whose url ends in `/events` would be swept in here and
 * silently lose its limit. There is exactly one such route today; add a new
 * one and this pattern needs to become an exact list.
 */
const STREAM_ROUTES = /^\/ws$|\/events$/;

/**
 * The bucket a route lands in when it declares none. `undefined` = unlimited:
 * everything outside `/api/` (SPA assets, the static wildcard) and the two
 * long-lived streams.
 */
function autoBucket(method: string | string[], url: string): RateLimitBucket | undefined {
  if (STREAM_ROUTES.test(url)) return undefined;
  if (!url.startsWith('/api/')) return undefined;
  const methods = Array.isArray(method) ? method : [method];
  for (const rule of AUTO_BUCKETS) {
    if (methods.some((m) => rule.methods.includes(m)) && rule.pattern.test(url)) return rule.bucket;
  }
  return 'api';
}

/**
 * Who the counter belongs to. The decorations are all populated by the time a
 * route-level limiter hook runs: `authPlugin`'s resolver is an INSTANCE
 * `onRequest` hook, and instance hooks run before route-level ones.
 *
 * Deliberately not `request.apiKeyPrincipal` — that decoration comes from
 * `plugins/rbac.ts`, which registers after `buildServer`'s scopes are
 * snapshotted and is therefore absent on several bucketed routes.
 */
function principalKey(request: FastifyRequest): string {
  const apiKeyId = request.apiKey?.id;
  if (apiKeyId !== undefined) return `key:${apiKeyId}`;
  const userId = request.user?.id;
  if (userId !== undefined) return `user:${userId}`;
  return `ip:${request.ip}`;
}

interface BucketHit {
  current: number;
  resetAt: number;
}

/** Expired-entry sweep trigger — keeps the map bounded under key churn. */
const SWEEP_SIZE = 5_000;

/**
 * The §6 in-memory store, as a @fastify/rate-limit custom-store class whose
 * instances (the per-route `child()`ren the plugin creates) all share ONE
 * `Map` captured per server instance. Sharing is the point — see the module
 * header — and is safe because keys embed the bucket name, so two buckets
 * can never collide even though they share the map. Fixed-window: the first
 * hit opens a window of the route's `timeWindow`, and the counter resets when
 * it lapses (`incr` receives the window per call, per the store contract).
 */
function createBucketStoreClass() {
  const hits = new Map<string, BucketHit>();
  return class BucketStore {
    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number,
    ): void {
      const now = Date.now();
      if (hits.size >= SWEEP_SIZE) {
        for (const [staleKey, hit] of hits) {
          if (hit.resetAt <= now) hits.delete(staleKey);
        }
      }
      let hit = hits.get(key);
      if (hit === undefined || hit.resetAt <= now) {
        hit = { current: 0, resetAt: now + timeWindow };
        hits.set(key, hit);
      }
      hit.current += 1;
      callback(null, { current: hit.current, ttl: hit.resetAt - now });
    }

    child(): BucketStore {
      return new BucketStore();
    }
  };
}

/** Matches inline `<script>` blocks (no `src=`) in the dashboard index.html. */
const INLINE_SCRIPT_PATTERN = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * CSP `'sha256-…'` allowances for the inline scripts the served SPA actually
 * carries. Read from the same `index.html` the static plugin will serve, so a
 * rebuilt pre-hydration script never turns into a white screen behind a stale
 * hash. Absent or unreadable build ⇒ no allowances (API-only boot).
 */
async function inlineScriptHashes(staticRoot: string | undefined): Promise<string[]> {
  if (staticRoot === undefined || staticRoot === '') return [];
  let html: string;
  try {
    html = await readFile(join(resolve(staticRoot), 'index.html'), 'utf8');
  } catch {
    return [];
  }
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT_PATTERN)) {
    const body = match[1] ?? '';
    if (body.trim() === '') continue;
    // CSP hashes cover the EXACT bytes between the tags — no trimming.
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

export interface CorePluginOptions {
  env: Env;
  /**
   * The dashboard build directory `app.ts` hands the static plugin — read here
   * (never served) to compute the CSP inline-script hash allowance.
   */
  staticRoot?: string | undefined;
}

export const corePlugin = fp<CorePluginOptions>(
  async (app, { env, staticRoot }) => {
    await app.register(fastifyCookie, {
      secret: env.ADMINIUM_SECRET,
      hook: 'onRequest',
    });

    const origins = env.ADMINIUM_CORS_ORIGINS;
    if (origins !== undefined && origins.length > 0) {
      await app.register(fastifyCors, {
        origin: [...origins],
        credentials: true,
      });
    }

    // §7 item 5. Helmet's hook is global, so API replies, static assets and
    // the SPA fallback all carry the same headers.
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'script-src': ["'self'", ...(await inlineScriptHashes(staticRoot))],
          // Runtime style injection (chart/table libraries set style attrs).
          'style-src': ["'self'", "'unsafe-inline'"],
          // The map widgets' basemap tiles load from the Carto CDN
          // (packages/widgets geo-lib.ts CARTO_TILES) — without this
          // allowance every deployed MapBubble renders over a blank basemap.
          'img-src': ["'self'", 'data:', 'blob:', 'https://*.basemaps.cartocdn.com'],
          'font-src': ["'self'", 'data:'],
          // Same-HOST WebSocket only. Bare `ws:`/`wss:` scheme sources would
          // authorize a socket to ANY origin — an XSS foothold could
          // exfiltrate through `new WebSocket('wss://attacker/…')` — so the
          // allowance is derived per request from the Host header the page
          // itself was served on (loopback, LAN ip, or proxied domain alike).
          'connect-src': [
            "'self'",
            (req: IncomingMessage) => {
              const host = req.headers.host;
              return host === undefined || host === ''
                ? "'self'"
                : `ws://${host} wss://${host}`;
            },
          ],
          'worker-src': ["'self'", 'blob:'],
          'manifest-src': ["'self'"],
        },
      },
      // frame-ancestors 'none' is the modern half; X-Frame-Options must agree.
      frameguard: { action: 'deny' },
      // HSTS only behind TLS (§7 item 5); on the desktop shell's loopback and
      // §8.3's LAN origins it would pin browsers to an https that isn't there.
      ...(env.ADMINIUM_TRUST_PROXY ? {} : { hsts: false }),
    });

    // §6 bucket assignment. Added BEFORE @fastify/rate-limit registers so its
    // own onRoute hook (which reads `config.rateLimit`) runs after this one.
    app.addHook('onRoute', (route) => {
      const declared = route.config?.rateLimitBucket;
      const bucket = declared ?? autoBucket(route.method, route.url);
      if (bucket === undefined) return;
      // The declared spelling is still validated at boot: `RateLimitBucket`
      // stops the typo at compile time, but a route registered from JS or
      // through a cast would otherwise get silently no limit at all.
      const spec = (RATE_BUCKETS as Readonly<Record<string, RateBucket | undefined>>)[bucket];
      if (spec === undefined) {
        const methods = Array.isArray(route.method) ? route.method.join(',') : route.method;
        throw new Error(
          `route ${methods} ${route.url} declares unknown rate-limit bucket "${bucket}" — add it to RATE_BUCKETS (plugins/core.ts, 08-server-api.md §6)`,
        );
      }
      route.config = {
        ...route.config,
        rateLimit: {
          max: spec.max,
          timeWindow: spec.timeWindowMs,
          keyGenerator: (request: FastifyRequest) =>
            `${bucket}:${spec.keyBy === 'ip' ? request.ip : principalKey(request)}`,
        },
      };
    });

    // §7 item 4. `preValidation`, not `onRequest` — see the module header.
    const csrf: CsrfDeps = {
      key: csrfSigningKey(env.ADMINIUM_SECRET),
      allowedOrigins: allowedOriginHosts(origins),
    };
    app.decorate('csrfOrigins', csrf.allowedOrigins);
    app.addHook('preValidation', async (request) => {
      const failure = checkCsrf(request, csrf);
      if (failure === null) return;
      // The reason is logged, never returned: telling a caller WHICH leg it
      // failed is a free oracle for probing the check.
      request.log.warn(
        { csrf: failure, method: request.method, url: request.url },
        'csrf check refused a mutation',
      );
      throw new ForbiddenError(
        'This request could not be verified as coming from Adminium. Reload the page and try again.',
        'CSRF_FAILED',
      );
    });

    await app.register(fastifyRateLimit, {
      global: false,
      store: createBucketStoreClass(),
      // Thrown by the plugin, serialized by the global §1.4 error handler; the
      // plugin has already set `retry-after` + `x-ratelimit-*` on the reply.
      errorResponseBuilder: (request, context) =>
        new RateLimitedError(`Too many requests. Try again in ${context.after}.`, {
          bucket: request.routeOptions.config?.rateLimitBucket ?? 'unknown',
          limit: context.max,
          resetAt: new Date(Date.now() + context.ttl).toISOString(),
        }),
    });
  },
  { name: 'adminium-core', fastify: '5.x' },
);
