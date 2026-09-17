// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host a link in an outbound email points at (`system.publicOrigin`), and
 * the two ways the server learns it.
 *
 * ─── Why the request cannot choose ───────────────────────────────────────────
 *
 * Links in email used to be built from the request that caused the mail: its
 * `Origin` header when it had one, otherwise its scheme and `Host`. The helper
 * said a page cannot forge `Origin` cross-origin. That is true of browsers and
 * of nothing else. `POST /auth/password/forgot` is unauthenticated, and the
 * CSRF check only looks at requests that carry a session, so a script could
 * send `Origin: https://evil.example` with someone's address. That person then
 * received a genuine reset mail whose link carried a real token to the
 * attacker's host (password-reset poisoning).
 *
 * ─── Resolution ──────────────────────────────────────────────────────────────
 *
 * {@link linkOrigin}:
 *
 *  1. the stored `system.publicOrigin`, when there is one. Nothing the request
 *     carries is read;
 *  2. otherwise the request's own scheme and host (`request.protocol`,
 *     `request.host`), and NEVER `Origin`. `request.host` honours
 *     `X-Forwarded-Host` only from a trusted proxy (security/trust-proxy.ts).
 *
 * Step 2 is the owner's call (2026-09-17) for the time before an origin is
 * known, and it is not a boundary: a client that reaches the port directly
 * writes its own `Host`. Behind a proxy that routes by hostname it holds, and
 * it is what every instance did before this module. Step 1 closes the gap, and
 * the capture below gets most instances there without anyone opening Studio.
 *
 * ─── How the stored value is written ─────────────────────────────────────────
 *
 *  - by an admin in Studio (`PUT /settings/email`, `publicOrigin`);
 *  - by the server, ONCE, while the key is unset ({@link capturePublicOrigin}),
 *    from a request that passes every one of these:
 *      · it is a mutation. A browser attaches `Origin` to every non-GET, and
 *        only a browser's `Origin` carries the real scheme behind a proxy that
 *        terminates TLS, where `request.protocol` may still say `http`;
 *      · its `Origin` is an http(s) origin on a host other machines can reach.
 *        A `localhost` link works for nobody else, and the desktop app's port
 *        changes every launch;
 *      · the CSRF verdict is `trusted`: `Origin` matches `Host`, or it is an
 *        origin the operator listed in `ADMINIUM_CORS_ORIGINS`;
 *      · it acts as a SESSION user (never an API key) who holds
 *        `system:settings:manage`, the people who could type the value into
 *        Studio anyway. The capture gives nobody a power they lacked.
 *
 * It is called from first-run setup, from sign-in (password and 2FA), and on
 * every session-authenticated write (plugins/public-origin.ts). The last one is
 * for upgraded instances: sessions last up to 30 days, so an admin who stays
 * signed in would otherwise not teach the server anything for weeks.
 *
 * Setup is unauthenticated, and capturing there is still sound: whoever
 * completes setup owns the instance.
 */
import { auditRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { classifyOrigin, type OriginProbe } from './csrf.js';

/** The registry key (packages/meta settings-registry.ts). */
export const PUBLIC_ORIGIN_SETTING = 'system.publicOrigin';

/** The registry's own bound on the stored value. */
export const PUBLIC_ORIGIN_MAX_LENGTH = 255;

/** Never a capture: nothing to learn from a read. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `scheme://authority` with an optional trailing slash, and nothing in the
 * authority that `URL` would quietly reinterpret: no whitespace, no path, query
 * or fragment, no userinfo, and no backslash (which `URL` reads as a path
 * separator, so `http://evil.example\@admin.example.com` parses as `evil.example`).
 */
const ORIGIN_SHAPE = /^https?:\/\/[^\s/?#@\\]+\/?$/i;

/** One DNS label as a browser accepts it (underscores included: compose service names). */
const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/**
 * The http(s) origin `value` names, normalized the way `URL#origin` writes it
 * (lower case, punycode, no default port, no trailing slash), or `null` when
 * `value` is anything more or less than an origin.
 */
export function normalizePublicOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > PUBLIC_ORIGIN_MAX_LENGTH) return null;
  if (!ORIGIN_SHAPE.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!isPlausibleHost(url.hostname)) return null;
  return url.origin.length <= PUBLIC_ORIGIN_MAX_LENGTH ? url.origin : null;
}

/** An IP literal, or dot-separated DNS labels (one trailing dot allowed). */
function isPlausibleHost(hostname: string): boolean {
  if (hostname.startsWith('[')) return true;
  const labels = (hostname.endsWith('.') ? hostname.slice(0, -1) : hostname).split('.');
  return labels.every((label) => HOST_LABEL.test(label));
}

/**
 * True for a host only this machine can reach. Expects the hostname as `URL`
 * serializes it, which is what {@link normalizePublicOrigin} produces: lower
 * case, IPv4 dotted (`127.1` is already `127.0.0.1`), IPv6 bracketed and
 * compressed (an IPv4-mapped loopback is already `[::ffff:7f00:1]`).
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host) || host === '0.0.0.0') return true;
  // `::1`, the unspecified `::`, and the IPv4-mapped forms of the two above.
  return host === '[::1]' || host === '[::]' || /^\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/.test(host);
}

/** The slice of a request {@link linkOrigin} reads; a Fastify request satisfies it. */
export interface LinkOriginRequest {
  protocol: string;
  host?: string | undefined;
  hostname: string;
}

/**
 * The origin every absolute link in an outbound email starts with. See the
 * module header for the order, and why `Origin` is not in it.
 */
export async function linkOrigin(meta: MetaDb, request: LinkOriginRequest): Promise<string> {
  const stored = await settingsRepo(meta).get(PUBLIC_ORIGIN_SETTING);
  return stored ?? requestHostOrigin(request);
}

/**
 * Step 2: the request's own scheme and host. Validated, so a malformed `Host`
 * cannot put a path, a second host or markup into a link. No browser sends one,
 * so the refusal only ever reaches a hand-written request.
 */
export function requestHostOrigin(request: LinkOriginRequest): string {
  const origin = normalizePublicOrigin(`${request.protocol}://${request.host ?? request.hostname}`);
  if (origin === null) {
    throw new ValidationFailedError('The Host header is not a host Adminium can link to.', {
      in: 'headers',
      issues: [{ path: 'host', message: 'not a valid host', code: 'invalid_host' }],
    });
  }
  return origin;
}

/**
 * Metas whose key is known to be set, so a busy instance stops reading the
 * setting on every admin write once it has one. Only ever a shortcut: a miss
 * reads the row. Studio's write updates it through {@link notePublicOrigin}.
 * Another process clearing the key is not seen here, which only delays a
 * re-capture until this process restarts.
 */
const known = new WeakMap<MetaDb, true>();

/** Tell the capture what Studio just stored (`null` = cleared). */
export function notePublicOrigin(meta: MetaDb, value: string | null): void {
  if (value === null) known.delete(meta);
  else known.set(meta, true);
}

/** Structured logger — satisfied by `request.log`. */
export interface OriginLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface CaptureContext {
  meta: MetaDb;
  /** Hosts `ADMINIUM_CORS_ORIGINS` lists (`app.csrfOrigins`). */
  allowedOrigins: ReadonlySet<string>;
  /** The session user the request acts as, or just signed in as. */
  user: { id: string; name: string };
  log?: OriginLogger | undefined;
  at?: number | undefined;
}

/** The slice of a request {@link capturePublicOrigin} reads. */
export interface CaptureRequest extends OriginProbe {
  method: string;
  ip?: string | undefined;
  id?: string | undefined;
}

/**
 * Record the request's `Origin` as `system.publicOrigin` if it is still unset
 * and every condition in the module header holds. Returns the stored origin,
 * or `null` when nothing was written.
 *
 * The cheap checks run first and the database is read last, so a write on an
 * instance that already knows its origin costs nothing but a map lookup.
 *
 * Two admins' first writes can race, and the later one wins. Both origins
 * reached this instance from a settings admin's browser, so either is right.
 */
export async function capturePublicOrigin(
  ctx: CaptureContext,
  request: CaptureRequest,
): Promise<string | null> {
  if (SAFE_METHODS.has(request.method)) return null;
  const raw = request.headers.origin;
  if (typeof raw !== 'string') return null;
  const origin = normalizePublicOrigin(raw);
  if (origin === null || isLoopbackHost(new URL(origin).hostname)) return null;
  if (classifyOrigin(request, ctx.allowedOrigins) !== 'trusted') return null;
  if (known.has(ctx.meta)) return null;

  const settings = settingsRepo(ctx.meta);
  if ((await settings.get(PUBLIC_ORIGIN_SETTING)) !== null) {
    known.set(ctx.meta, true);
    return null;
  }
  const permissions = await resolvePermissionSet(ctx.meta, {
    kind: 'user',
    id: ctx.user.id,
    label: ctx.user.name,
  });
  if (!permissionSetAllows(permissions, PERMISSIONS.settingsManage)) return null;

  const at = ctx.at ?? Date.now();
  await settings.set(PUBLIC_ORIGIN_SETTING, origin, { updatedBy: ctx.user.id, at });
  known.set(ctx.meta, true);
  const userAgent = request.headers['user-agent'];
  // Nobody pressed Save, so the audit row is the only place this shows up.
  await auditRepo(ctx.meta).append(
    {
      actorKind: 'user',
      actorId: ctx.user.id,
      actorLabel: ctx.user.name,
      category: 'settings',
      action: 'settings.public-origin.captured',
      changes: { before: { publicOrigin: null }, after: { publicOrigin: origin } },
      ip: request.ip ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
      requestId: request.id ?? null,
    },
    at,
  );
  ctx.log?.info({ publicOrigin: origin }, 'learned the address links in email point at');
  return origin;
}

/**
 * {@link capturePublicOrigin} for callers whose own work must not fail because
 * of it: sign-in, setup, and the write hook. A failure is logged and dropped.
 */
export async function capturePublicOriginQuietly(
  ctx: CaptureContext & { log: OriginLogger },
  request: CaptureRequest,
): Promise<void> {
  try {
    await capturePublicOrigin(ctx, request);
  } catch (error) {
    ctx.log.warn({ err: error }, 'could not record the address links in email point at');
  }
}
