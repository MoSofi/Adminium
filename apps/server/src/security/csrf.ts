// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CSRF defence — the ACTIVE half.
 *
 * ─── Why this exists at all ──────────────────────────────────────────────────
 *
 * Three PASSIVE legs already shipped: the session cookie is `SameSite=Lax`
 * (auth/sessions.ts), CORS emits nothing unless `ADMINIUM_CORS_ORIGINS` opts an
 * origin in (plugins/core.ts), and the bridge deliberately omits
 * `Access-Control-Allow-Credentials` (routes/bridge/index.ts). Until this
 * module there were ZERO active legs: `CSRF_FAILED` existed in errors.ts and
 * was never thrown, and `sec-fetch-*` appeared nowhere in the repo.
 *
 * That is thinner than it looks. Fastify ships a default `text/plain` body
 * parser and this app registers no formbody plugin, so a cross-site
 * `<form enctype="text/plain">` POST is PARSEABLE today — and every route with
 * no `body` schema runs regardless of the garbage it carries:
 * `POST /auth/logout`, `POST /auth/2fa/enroll`, `POST /users/:id/invite/resend`,
 * and every DELETE that takes only params. `SameSite=Lax` is the only thing
 * standing between those routes and an attacker's page.
 *
 * And `Lax` has a hole this deployment lands squarely in: it is same-SITE, not
 * same-ORIGIN. Tenants are `*.adminium.app` (adminium-domain-strategy), so
 * `evil.adminium.app` is same-site with `acme.adminium.app` and the browser
 * WILL attach the cookie. The Origin leg below is what closes that.
 *
 * ─── The two legs, and exactly what each one buys ────────────────────────────
 *
 * LEG A — Origin / `Sec-Fetch-Site`. Enforced on every session-authenticated
 * mutation. The expected origin is derived from the request's own `Host`,
 * exactly as the CSP `connect-src` allowance already is (plugins/core.ts).
 * There is no `ADMINIUM_BASE_URL`, and this check deliberately ignores
 * `system.publicOrigin` (security/public-origin.ts): that setting says where
 * links in email point, it is unset until it is learned, and an instance that
 * answers under two names must accept writes on both. A browser cannot forge
 * the `Host` it sends, which is all this leg needs. Origins listed
 * in `ADMINIUM_CORS_ORIGINS` are trusted too — an operator who opted a
 * cross-origin dashboard into CORS did not also mean to have it 403'd here.
 *
 * LEG B — a session-bound token. `GET /api/v1/bootstrap` hands the SPA
 * `csrfToken`; mutating calls echo it in `{@link CSRF_HEADER}`. It is
 * `HMAC-SHA256(hkdf(ADMINIUM_SECRET, "adminium:csrf"), session.id)` — nothing
 * is stored, nothing expires separately from the session it is bound to, and a
 * token minted for one session cannot be replayed on another.
 *
 * ─── The one carve-out, stated plainly ───────────────────────────────────────
 *
 * Leg B is required only of callers that present BROWSER PROVENANCE — an
 * `Origin`, a `Referer`, or any `Sec-Fetch-*` header. A request carrying none
 * of them was not made by a browser, and CSRF is definitionally a
 * browser-ambient-credential attack: the whole premise is that the victim's
 * user agent attaches the cookie without the attacker seeing it. Every browser
 * path that can reach a mutating endpoint — `fetch`, `XMLHttpRequest`, a form
 * submit, `sendBeacon` — attaches `Origin` on non-GET and has for years, and
 * an attacker cannot strip it. A caller that sends none of those is a
 * script/CLI/desktop process that had to obtain the cookie by other means, at
 * which point it can forge a token too and CSRF is not the control that saved
 * anyone. Narrowing leg B here is what keeps loopback and server-side cookie
 * callers working without punching a hole in the browser threat model.
 *
 * Also never checked, for reasons that are not carve-outs but categories:
 *  - safe methods (GET/HEAD/OPTIONS) — nothing to forge;
 *  - bearer API keys (`adm_`/`adm_sk_`) — a browser never attaches an
 *    `Authorization` header ambiently, so a key-authenticated request cannot
 *    be ridden. Tested on the HEADER, not on `request.apiKeyPrincipal`: that
 *    decoration comes from `plugins/rbac.ts`, which registers in `compose.ts`
 *    AFTER `buildServer`'s scopes are snapshotted, so it is `undefined` on
 *    bootstrap/auth/me/setup/about (see the rbac plugin's own note);
 *  - requests with no session — `request.session` is the cookie-borne ambient
 *    credential and the only thing CSRF can ride. Pre-login `/auth/*` and
 *    `/setup/*` fall out of this for free: they cannot carry a session-bound
 *    token because there is no session yet;
 *  - routes marked `config.csrf: 'exempt'` (see below).
 *
 * ─── The declarative exemption ───────────────────────────────────────────────
 *
 * `config.csrf: 'exempt'` follows the `config.rateLimitBucket` idiom already in
 * the codebase: the route declares its own posture and this module stays the
 * single reader. Exactly one route needs it — `POST /api/v1/desktop/backup`.
 * The Electron MAIN process is a cookie-authenticated non-GET caller that can
 * carry neither a token nor an Origin: it lifts `adminium_session` out of
 * Electron's cookie jar and POSTs by hand through Node's `fetch`
 * (apps/desktop/src/main/index.ts). Both the File-menu backup and the nightly
 * schedule break without the marker. Its substitute control is stronger than a
 * token anyway — the route requires a LOOPBACK SOCKET PEER plus
 * `system:settings:manage` (routes/desktop/index.ts gates 2 and 3).
 *
 * `config.csrf: 'form'` is NOT an exemption: both legs still run, and only
 * where leg B's token is read from changes — the body's `csrf` field instead
 * of the header. It is for the script-free pages the server renders itself
 * (an app switched off), whose Sign out is a plain form post that cannot set
 * a header. The page carries the same session-bound token the bootstrap hands
 * the dashboard.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { deriveKey } from '../config/secrets.js';
import { parseBearerApiKey } from '../rbac/api-keys.js';

/** Header the dashboard echoes the bootstrap `csrfToken` in. */
export const CSRF_HEADER = 'x-adminium-csrf';

/** HKDF `info` — scopes this key away from the DSN/meta-URL/LLM/TOTP keys. */
const CSRF_KEY_INFO = 'adminium:csrf';

/** HKDF salt. Fixed: the token must survive a restart, so it cannot be random. */
const CSRF_KEY_SALT = 'adminium:csrf:v1';

/** Never checked — by definition they change nothing. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Headers that prove a browser built the request. See the module header. */
const PROVENANCE_HEADERS = ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode'] as const;

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Lower-cased hosts a cross-origin caller may present, from
     * `ADMINIUM_CORS_ORIGINS`. Decorated by `corePlugin`; the realtime gateway
     * reads it so the WS upgrade and the HTTP hook agree on one allowlist.
     */
    csrfOrigins: ReadonlySet<string>;
    /**
     * The session-bound token for one session id, for a page the SERVER
     * renders with a form in it (a `config.csrf: 'form'` target). Decorated by
     * `corePlugin`, from the same key the check uses.
     */
    csrfTokenFor: (sessionId: string) => string;
  }
}

/** The signing key for {@link issueCsrfToken}. Derive once per server. */
export function csrfSigningKey(secret: string): Buffer {
  return deriveKey(secret, CSRF_KEY_SALT, CSRF_KEY_INFO);
}

/**
 * The session's token. Deterministic, so `GET /bootstrap` can re-issue the
 * same value on every cold load without storing anything — and so a token
 * dies exactly when its session does, with no second expiry to reason about.
 */
export function issueCsrfToken(key: Uint8Array, sessionId: string): string {
  return createHmac('sha256', key).update(sessionId, 'utf8').digest('base64url');
}

/** Lower-cased hosts of the configured CORS origins; unparseable ones drop. */
export function allowedOriginHosts(origins: readonly string[] | undefined): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const origin of origins ?? []) {
    const host = hostOf(origin);
    if (host !== null) hosts.add(host);
  }
  return hosts;
}

/** `https://acme.adminium.app:8443` → `acme.adminium.app:8443`; null if unparseable. */
function hostOf(value: string): string | null {
  try {
    const { host } = new URL(value);
    return host === '' ? null : normalizeHost(host);
  } catch {
    return null;
  }
}

/**
 * Drops a default port so the two sides of the comparison agree. `Origin` is
 * serialized by the URL spec, which omits `:80`/`:443`, while `Host` is
 * whatever the client or the proxy wrote — and a proxy that appends the
 * explicit port would otherwise 403 the whole product.
 */
export function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith(':80') || lower.endsWith(':443')
    ? lower.slice(0, lower.lastIndexOf(':'))
    : lower;
}

/**
 * What the request says about where it came from.
 *
 *  - `trusted` — same origin as the `Host` it was sent to, or an explicitly
 *    allowlisted CORS origin;
 *  - `foreign` — a different origin, an opaque one (`Origin: null`, i.e. a
 *    sandboxed iframe or a `data:` document), or fetch metadata that says
 *    cross-site/same-site. `same-site` is FOREIGN on purpose: that is the
 *    sibling-subdomain case `SameSite=Lax` waves through;
 *  - `absent` — no browser provenance at all (see the module header).
 */
export type OriginVerdict = 'trusted' | 'foreign' | 'absent';

/** The slice of a request the origin checks read — also what `/ws` passes in. */
export interface OriginProbe {
  headers: Record<string, string | string[] | undefined>;
}

function header(probe: OriginProbe, name: string): string | undefined {
  const raw = probe.headers[name];
  return typeof raw === 'string' ? raw : undefined;
}

export function classifyOrigin(probe: OriginProbe, allowed: ReadonlySet<string>): OriginVerdict {
  const host = normalizeHost(header(probe, 'host') ?? '');
  const fetchSite = header(probe, 'sec-fetch-site');
  const origin = header(probe, 'origin');

  if (origin !== undefined) {
    const originHost = hostOf(origin);
    // `Origin: null` and anything unparseable land here.
    if (originHost === null) return 'foreign';
    // An operator who opted this origin into CORS meant it.
    if (allowed.has(originHost)) return 'trusted';
    if (originHost !== host) return 'foreign';
    // Same host — fetch metadata still gets a veto, because it compares
    // scheme and port too (http://host attacking https://host).
    return isSameOriginFetch(fetchSite) ? 'trusted' : 'foreign';
  }

  if (fetchSite !== undefined) return isSameOriginFetch(fetchSite) ? 'trusted' : 'foreign';

  // No `Origin` on a navigation-initiated request is normal; `Referer` is the
  // last provenance a browser gives us and it is worth honouring.
  const referer = header(probe, 'referer');
  if (referer !== undefined) {
    const refererHost = hostOf(referer);
    if (refererHost === null) return 'foreign';
    return refererHost === host || allowed.has(refererHost) ? 'trusted' : 'foreign';
  }

  return 'absent';
}

/** `undefined` (header not sent) passes — the Origin comparison is the gate. */
function isSameOriginFetch(fetchSite: string | undefined): boolean {
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
}

/**
 * Did this request come from a page THIS instance served? — the public API's
 * same-origin test.
 *
 * Deliberately NOT `classifyOrigin(probe, new Set())`, though it reuses the
 * same comparison, and the two differences are the point:
 *
 *  - no allow-list. A CORS-allowed cross-origin caller is trusted for CSRF
 *    (the operator opted it in, credentialed); it is not "same-origin" here.
 *    The public gate's own allow-list is checked separately, beside this.
 *  - no `Referer` fallback, and `Sec-Fetch-Site` is REQUIRED when `Origin` is
 *    absent. `classifyOrigin` honours `Referer` because a session cookie is
 *    already riding along and any provenance is better than none; here there is
 *    no cookie, and widening the same-origin path to a header servers have
 *    sent wrong for twenty years buys nothing.
 *
 * The two branches, and why both are needed:
 *
 *  (a) `Origin` PRESENT and its host equals `Host`. This is the same-origin
 *      POST/PATCH case — the Fetch spec appends `Origin` to every non-GET/HEAD
 *      request, same-origin included. The fetch-metadata veto still applies, so
 *      `http://host` cannot pose as `https://host`.
 *  (b) `Origin` ABSENT and `Sec-Fetch-Site: same-origin`. This is the case that
 *      no allow-list could ever express and the reason the sentinel exists: a
 *      same-origin `GET` sends no `Origin` header at all.
 *
 * HONESTY CLAUSE (restated because someone will read this as a boundary): both
 * headers are trivially forged by a non-browser. This is POLICY — it keeps
 * other people's PAGES out — and the publishable KEY remains the credential.
 * Hardening this into a boundary is not possible and attempting it would only
 * break real browsers.
 */
export function isSameOriginRequest(probe: OriginProbe): boolean {
  const host = normalizeHost(header(probe, 'host') ?? '');
  if (host === '') return false;
  const fetchSite = header(probe, 'sec-fetch-site');
  const origin = header(probe, 'origin');

  if (origin !== undefined) {
    const originHost = hostOf(origin);
    if (originHost === null || originHost !== host) return false;
    return isSameOriginFetch(fetchSite);
  }
  return fetchSite === 'same-origin';
}

/** True when any header proves a browser built this request. */
export function hasBrowserProvenance(probe: OriginProbe): boolean {
  return PROVENANCE_HEADERS.some((name) => probe.headers[name] !== undefined);
}

export interface CsrfDeps {
  /** From {@link csrfSigningKey}. */
  key: Uint8Array;
  /** From {@link allowedOriginHosts}. */
  allowedOrigins: ReadonlySet<string>;
}

/** Why a request was refused — logged, never sent to the client. */
export type CsrfFailure = 'foreign-origin' | 'token-missing' | 'token-mismatch';

/**
 * The whole decision, as a pure function so the hook in `plugins/core.ts` is
 * three lines and the reasoning is testable without a server.
 * `null` ⇒ the request may proceed.
 */
export function checkCsrf(request: FastifyRequest, deps: CsrfDeps): CsrfFailure | null {
  if (SAFE_METHODS.has(request.method)) return null;
  if (request.routeOptions.config?.csrf === 'exempt') return null;

  // Bearer credentials are never ambient. `request.apiKey` covers the `adm_`
  // principals the auth plugin resolves; the header parse covers `adm_sk_`
  // keys on routes the rbac plugin never reached (see the module header).
  if (request.apiKey?.id !== undefined) return null;
  if (parseBearerApiKey(request.headers.authorization) !== null) return null;

  const sessionId = request.session?.id;
  if (sessionId === undefined) return null;

  const verdict = classifyOrigin(request, deps.allowedOrigins);
  if (verdict === 'foreign') return 'foreign-origin';
  if (!hasBrowserProvenance(request)) return null;

  const presented =
    request.routeOptions.config?.csrf === 'form' ? formToken(request.body) : request.headers[CSRF_HEADER];
  if (typeof presented !== 'string' || presented.length === 0) return 'token-missing';
  return tokensMatch(presented, issueCsrfToken(deps.key, sessionId)) ? null : 'token-mismatch';
}

/** The form field a script-free page posts its token in. */
export const CSRF_FORM_FIELD = 'csrf';

/**
 * The token from a `config.csrf: 'form'` route's body.
 *
 * A page that runs no script cannot set a header, so the SAME session-bound
 * token rides in the body instead — both legs still apply, only where leg B
 * is read from changes. `text/plain` is the one form encoding this server
 * parses (no formbody plugin), so the body is `csrf=<token>` plus a line end.
 */
function formToken(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined;
  const match = new RegExp(`^${CSRF_FORM_FIELD}=([A-Za-z0-9_-]+)\\s*$`).exec(body);
  return match?.[1];
}

/** Length-safe constant-time compare (`timingSafeEqual` throws on a mismatch). */
function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
