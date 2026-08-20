// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public namespace (28-public-surface.md §3.1, 28-T07/T08).
 *
 * Registered as a SIBLING of the `/api/v1` block, with its own prefix, its own
 * CORS posture and its own limiter (D8). It must not move inside that block:
 * the admin CORS list is credentialed and this one must never be, and the
 * limiter here keys on things `principalKey` cannot see.
 *
 * ── THREE INDEPENDENT SWITCHES, ALL OF WHICH MUST BE ON ────────────────────
 *  1. `ADMINIUM_PUBLIC_API_ORIGINS` unset ⇒ `compose.ts` never calls this
 *     function. No door to probe, rather than a door that refuses.
 *  2. `ADMINIUM_TRUST_PROXY` off AND a non-loopback bind ⇒ refuses to register,
 *     loudly (D18/D21). See `publicApiRegistrationBlocked`.
 *  3. `publicApi.enabled` false ⇒ every route 503s, at runtime, reversibly.
 *
 * ── WHAT THIS FILE DOES NOT HAVE TO DO ─────────────────────────────────────
 * There is no check anywhere that a publishable key is being used on the right
 * route, because it CANNOT be used on a wrong one: `parseBearerApiKey` gates on
 * `adm_sk_`, so an `adm_pub_` token never becomes an rbac principal and
 * `request.can()` is false for it everywhere in the server (D3). That property
 * is asserted by `public-api-isolation.test.ts` (28-T09) rather than restated
 * here as a runtime guard that could rot.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { MetaDb } from '@adminium/meta';
import {
  auditRepo,
  overridesRepo,
  publicKeysRepo,
  publicScopesRepo,
  publicSessionsRepo,
  snapshotsRepo,
} from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';

import type { Env } from '../../config/env.js';
import { applyOverrides } from '../../connections/effective-schema.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { SnapshotView } from '../../crud/identifiers.js';
import { runList } from '../../crud/list.js';
import { compileFilter, parseWhereParam } from '../../crud/filters.js';
import { createPublicKeyResolver, type ResolvedKey } from '../../public-api/resolve.js';
import { publicConfigOf, type CompiledResource } from '../../public-api/scope.js';
import {
  CLAIM_SESSION_TTL_MS,
  claimPredicateFor,
  combinePredicates,
  parseGrant,
  resolveClaim,
  type PublicSessionContext,
} from '../../public-api/claim.js';
import { generatePublicSessionToken, hashPublishableKey } from '../../public-api/keys.js';
// `insertRow` lives in the data route because that is where it was written;
// it is a row primitive, not a route concern. Imported rather than moved:
// relocating a 50-line mysql-quirk function during a feature wave is a
// refactor with its own risk, and `check-deps` is the arbiter of whether this
// import is allowed (it is — routes may share exported helpers).
import { insertRow } from '../data/index.js';
import { fetchByPk, parseRecordId } from '../../crud/records.js';
import { audited } from '../../audit/coverage.js';
import {
  PUBLIC_ERROR_CODES,
  publicClaimBody,
  publicClaimReply,
  publicConfigReply,
  publicErrorReply,
  publicListQuery,
  publicListReply,
  publicRecordParams,
  publicRecordReply,
  publicRefParams,
  publicWriteBody,
} from './schema.js';
import type { PublicErrorCode } from './schema.js';
import { createPublicRateLimiter, type PublicLimit, type PublicRateLimiter } from '../../public-api/limiter.js';
import { parseBearerPublishableKey, parsePublicSessionToken } from '../../public-api/keys.js';

export interface PublicRoutesDeps {
  env: Env;
  meta: MetaDb;
  manager: ConnectionManager;
  /** Reads `publicApi.enabled` through a short-TTL cache — see `enabled.ts`. */
  isEnabled: () => Promise<boolean>;
  /** Injectable for tests; a fresh limiter otherwise. */
  limiter?: PublicRateLimiter | undefined;
}

/**
 * Is a bind address loopback-only?
 *
 * D21 exempts loopback binds from the `ADMINIUM_TRUST_PROXY` hard requirement.
 * On loopback there is no proxy in front, so `remoteAddress` is already the true
 * peer and the requirement would be protecting nothing while blocking local
 * development of this very surface. `0.0.0.0`/`::` are NOT loopback — that is
 * the shipped Docker default and exactly the case D18 was written for.
 */
/**
 * The anonymous namespace's path prefix — the ONE definition of it.
 *
 * ── A NAMING HAZARD, FOUND THE HARD WAY ────────────────────────────────────
 * The admin routes that MANAGE this surface live at `/api/v1/public-api`,
 * `/api/v1/public-scopes` and `/api/v1/public-keys`, and every one of those
 * strings starts with `/api/v1/public`. So a naive
 * `url.startsWith('/api/v1/public')` matches them too.
 *
 * That is not cosmetic. The isolation test (28-T09) skips this namespace when
 * sweeping the route tree, and with a loose prefix it would have skipped the
 * management routes as well — silently stopping the check that a publishable
 * key cannot mint ANOTHER publishable key. The trailing slash is what separates
 * them, and it is load-bearing enough to deserve a named export rather than a
 * literal repeated at each call site.
 */
export const PUBLIC_NAMESPACE_PREFIX = '/api/v1/public/';

/** Is `url` inside the anonymous public namespace (and not merely near it)? */
export function isPublicNamespacePath(url: string): boolean {
  return url.startsWith(PUBLIC_NAMESPACE_PREFIX);
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

/**
 * Why registration is refused, or `null` when it may proceed.
 *
 * Returns a SENTENCE rather than a boolean because this is the one failure an
 * operator meets before anything works, and "the public API did not start" with
 * no reason is the shape of bug that gets filed as "it is broken".
 */
export function publicApiRegistrationBlocked(env: Env): string | null {
  if (env.ADMINIUM_PUBLIC_API_ORIGINS === undefined) {
    return 'ADMINIUM_PUBLIC_API_ORIGINS is unset';
  }
  if (!env.ADMINIUM_TRUST_PROXY && !isLoopbackHost(env.HOST)) {
    return (
      `the public API needs ADMINIUM_TRUST_PROXY=1 when HOST is ${env.HOST}. ` +
      'Without it every anonymous caller behind a reverse proxy shares one rate-limit bucket, ' +
      'so one scraper starves every customer while the limiter appears to work. ' +
      'Set ADMINIUM_TRUST_PROXY=1 (you are behind a proxy), or bind to 127.0.0.1 for local use.'
    );
  }
  return null;
}

/** Every column a parsed filter names, including nested and/or branches. */
function collectFilterColumns(filter: unknown, out: string[] = []): string[] {
  if (filter === null || typeof filter !== 'object') return out;
  const node = filter as Record<string, unknown>;
  if (typeof node['column'] === 'string') out.push(node['column']);
  for (const branch of ['and', 'or']) {
    const arr = node[branch];
    if (Array.isArray(arr)) for (const child of arr) collectFilterColumns(child, out);
  }
  return out;
}

function fail(reply: FastifyReply, status: number, code: PublicErrorCode, message: string): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}

export function publicRoutes(deps: PublicRoutesDeps): FastifyPluginAsyncZod {
  const { env, meta, manager, isEnabled } = deps;
  const limiter = deps.limiter ?? createPublicRateLimiter();
  const allowed = new Set(env.ADMINIUM_PUBLIC_API_ORIGINS ?? []);
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);
  const keys = publicKeysRepo(meta);
  const scopes = publicScopesRepo(meta);
  const sessions = publicSessionsRepo(meta);
  const audit = auditRepo(meta);

  const viewCache = new Map<string, { stamp: string; view: SnapshotView }>();

  /** The effective schema for a connection — same stamping as `routes/data`. */
  async function viewFor(connectionId: string): Promise<SnapshotView | null> {
    const snapshot = await snapshots.latest(connectionId);
    if (snapshot === null) return null;
    const active = await overrides.listForConnection(connectionId, { status: 'active' });
    const last = active.at(-1);
    const stamp = `${snapshot.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}`;
    const cached = viewCache.get(connectionId);
    if (cached !== undefined && cached.stamp === stamp) return cached.view;
    const view = new SnapshotView(connectionId, applyOverrides(snapshot.schema as DatabaseModel, active));
    viewCache.set(connectionId, { stamp, view });
    return view;
  }

  const resolver = createPublicKeyResolver({
    findKeysByPrefix: (prefix) => keys.findByPrefix(prefix),
    findScopeById: (id) => scopes.findById(id),
    /*
     * Column existence, so `compileScope` refuses a scope naming a column the
     * table no longer has. Resolved from the same snapshot the query will run
     * against, which is what makes the refusal meaningful rather than advisory.
     */
    columnsOf: async (connectionId) => {
      const view = await viewFor(connectionId);
      if (view === null) return undefined;
      return (table: string) => {
        try {
          return new Set(view.table(table).columns.keys());
        } catch {
          return null;
        }
      };
    },
  });

  /**
   * Echo the caller's origin when it is allow-listed, and NEVER emit
   * `Access-Control-Allow-Credentials` (§3.6). A browser therefore strips
   * cookies from anything sent here, which is what keeps an admin session from
   * riding along on a storefront's request.
   */
  const applyCors = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = request.headers.origin;
    reply.header('Vary', 'Origin');
    if (typeof origin !== 'string' || !allowed.has(origin)) return false;
    reply.header('Access-Control-Allow-Origin', origin);
    return true;
  };

  const preflight = async (request: FastifyRequest, reply: FastifyReply): Promise<null> => {
    if (!applyCors(request, reply)) return reply.code(403).send();
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'authorization, content-type, x-adminium-public-session');
    reply.header('Access-Control-Max-Age', '600');
    return reply.code(204).send();
  };

  /**
   * The gate every public route runs first: off switch, origin, key, limit.
   *
   * Ordered cheapest-refusal-first, and deliberately so that the OFF SWITCH is
   * checked before anything touches a key: a disabled instance must not spend a
   * meta-store read to say no.
   */
  const gate = async (
    request: FastifyRequest,
    reply: FastifyReply,
    limit: PublicLimit,
  ): Promise<{ key: ResolvedKey; session: PublicSessionContext | null } | null> => {
    /*
     * CORS HEADERS FIRST, REFUSALS AFTER — and the order is load-bearing.
     *
     * The off-switch check used to run before this, so a `503
     * PUBLIC_API_DISABLED` went out with no `Access-Control-Allow-Origin` and
     * the BROWSER blocked it. The page never saw the code; it saw a CORS error
     * and a red console — which is exactly what acceptance criterion 16.4
     * forbids, and what the criterion-3 amendment promised would not happen.
     * Found by running the acceptance test in a real browser, not by any unit
     * test: `inject` has no same-origin policy to violate.
     *
     * Applying the headers first costs nothing — an allow-list Set lookup, no
     * I/O — so the "a disabled instance must not spend a meta-store read to say
     * no" property below is untouched.
     */
    const originAllowed = applyCors(request, reply);

    if (!(await isEnabled())) {
      fail(reply, 503, 'PUBLIC_API_DISABLED', 'The public API is turned off for this instance.');
      return null;
    }
    if (!originAllowed) {
      fail(reply, 403, 'PUBLIC_ORIGIN_REFUSED', 'This origin is not allowed to call the public API.');
      return null;
    }
    const token = parseBearerPublishableKey(request.headers.authorization);
    if (token === null) {
      fail(reply, 401, 'PUBLIC_KEY_INVALID', 'A publishable key is required.');
      return null;
    }
    const sessionToken = parsePublicSessionToken(
      request.headers['x-adminium-public-session'] as string | undefined,
    );

    /*
     * Limited on the KEY PREFIX before the key is resolved. Counting only
     * verified keys would make an invalid-key flood free, which is the cheapest
     * possible attack on a surface whose whole job is to answer strangers.
     */
    const decision = limiter.hit(limit, {
      keyId: token.slice(0, 16),
      ip: request.ip,
      sessionId: sessionToken ?? undefined,
    });
    if (!decision.allowed) {
      reply.header('Retry-After', String(decision.retryAfterSeconds));
      fail(reply, 429, 'PUBLIC_RATE_LIMITED', 'Too many requests.');
      return null;
    }

    /*
     * Resolution is LAST, after the limiter, so an invalid-key flood cannot make
     * the meta store do work: an attacker with no key must not be able to spend
     * a database round trip per request.
     */
    const key = await resolver.resolve(token);
    if (key === null) {
      // One code for unknown, wrong, revoked, expired and uncompilable (§3.2).
      fail(reply, 401, 'PUBLIC_KEY_INVALID', 'A publishable key is required.');
      return null;
    }

    /*
     * Per-key origin narrowing, applied on top of the instance allow-list. An
     * empty list means "not narrowed further" — never "any origin", because the
     * env list is always the outer bound and was already checked above.
     */
    if (key.origins.length > 0) {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !key.origins.includes(origin)) {
        fail(reply, 403, 'PUBLIC_ORIGIN_REFUSED', 'This origin is not allowed to use this key.');
        return null;
      }
    }

    /*
     * The session, if one was presented. A bad or expired token is simply NO
     * session — never an error. Saying "your session expired" to an anonymous
     * caller distinguishes "this token was once real" from "this token is
     * nonsense", and the practical effect is identical: claim-gated resources
     * 404 either way.
     */
    let session: PublicSessionContext | null = null;
    if (sessionToken !== null) {
      const row = await sessions.findValid(hashPublishableKey(sessionToken));
      // A session is bound to the key that minted it. Presenting one alongside
      // a DIFFERENT key must not carry its grants across.
      if (row !== null && row.keyId === key.keyId) {
        const grant = parseGrant(row.grants);
        if (grant !== null) {
          session = { id: row.id, keyId: row.keyId, grant };
          void sessions.touch(row.id);
        }
      }
    }

    return { key, session };
  };

  /**
   * Everything a record route needs, or a `FastifyReply` that has already
   * answered. One function so the read and the two write paths cannot drift on
   * which check they skip.
   */
  const resolveResource = async (
    request: FastifyRequest,
    reply: FastifyReply,
    ok: { key: ResolvedKey; session: PublicSessionContext | null },
    ref: string,
    action: 'read' | 'create' | 'update',
    /*
     * The CLAIM endpoint sets this. It has to read the claim resource in order
     * to mint the session that would make that resource reachable — without the
     * bypass the two conditions are circular and `POST /claim` can only ever
     * 404, which is exactly what a live probe showed before this existed.
     *
     * It is not a hole: the caller gets no rows back either way. `resolveClaim`
     * runs its own equality-only query against exactly the declared columns and
     * returns a grant or null, never a row.
     */
    opts: { bypassClaimGate?: boolean } = {},
  ) => {
    const resource = ok.key.scope.byRef.get(ref);
    /*
     * ONE answer for: no such ref, a ref this scope has but not for this
     * action, and a claim-gated ref with no session. `routes/data`
     * distinguishes its equivalents — 404 for an unknown connection, 403 for a
     * real one — which together are a status-code oracle this surface must not
     * inherit.
     */
    if (resource === undefined || !resource.actions.has(action)) {
      fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
      return null;
    }
    const claim = claimPredicateFor(resource, ok.session);
    if (!claim.reachable && opts.bypassClaimGate !== true) {
      fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
      return null;
    }

    const view = await viewFor(ok.key.connectionId);
    if (view === null) {
      fail(reply, 503, 'PUBLIC_UPSTREAM_UNAVAILABLE', 'The connection has no schema snapshot.');
      return null;
    }
    let table;
    try {
      table = view.table(resource.table);
    } catch {
      fail(reply, 503, 'PUBLIC_UPSTREAM_UNAVAILABLE', 'The resource is unavailable.');
      return null;
    }
    const { db, dialect } = await manager.data(ok.key.connectionId);
    return {
      resource,
      view,
      table,
      db,
      dialect,
      predicate: combinePredicates(resource.mandatory, claim.reachable ? claim.predicate : null),
    };
  };

  /**
   * Caller values → the row that will actually be written.
   *
   * Two rules, and the second is the one that is easy to get wrong. Only
   * `writable` columns survive — anything else is a refusal, not a silent drop,
   * because silently ignoring a field the caller sent produces a row that is
   * not what they asked for and no way to tell. And `defaults` are applied
   * AFTER, overwriting whatever arrived, which is what makes them immutable
   * rather than merely suggested.
   */
  const prepareValues = (
    resource: CompiledResource,
    values: Record<string, unknown>,
    session: PublicSessionContext | null,
  ): Record<string, unknown> | null => {
    for (const column of Object.keys(values)) {
      if (!resource.writable.has(column)) return null;
    }
    const out: Record<string, unknown> = { ...values, ...resource.defaults };

    /*
     * THE CLAIM WRITES ITSELF IN.
     *
     * A claim-gated resource almost always owns its rows through a NOT NULL
     * column — `enquiries.patient_id`, `orders.customer_id`. Without this, a
     * claimed create can never satisfy that column: the caller must not be
     * allowed to set it (they would write rows as somebody else) and `defaults`
     * cannot carry it (it differs per session). So the grant supplies it,
     * LAST, after `defaults`, and therefore unoverridable by either.
     *
     * Found by a live probe: the write failed on a not-null violation and the
     * only honest fix was for the session to provide the value it already
     * proves.
     */
    if (session !== null && resource.claim?.column !== undefined) {
      out[resource.claim.column] = session.grant.value;
    }
    return out;
  };

  /**
   * Audit a public write.
   *
   * There is no principal to stamp — that is the whole point of D3 — so the
   * actor is the KEY, by prefix. `actorKind: 'api-key'` is the closest true
   * member of a closed vocabulary; widening that enum is a migration and this
   * wave does not need one. `routes/bridge` set the precedent of auditing an
   * actor that is not a user.
   */
  const auditWrite = async (
    request: FastifyRequest,
    ok: { key: ResolvedKey; session: PublicSessionContext | null },
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> => {
    const userAgent = request.headers['user-agent'];
    await audit.append({
      actorKind: 'api-key',
      actorId: null,
      actorLabel: `public:${ok.key.keyId}`,
      category: 'data',
      action,
      connectionId: ok.key.connectionId,
      changes: { after: { ...changes, claimed: ok.session !== null } },
      ip: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
      requestId: request.id,
    });
  };

  return async (app) => {
    /*
     * A SCOPED ERROR HANDLER, and it is not optional.
     *
     * Without it any Zod rejection — `limit=500` against the 200 ceiling is the
     * easy one — falls through to the global handler in `plugins/core.ts` and
     * answers with the DASHBOARD's envelope: `VALIDATION_FAILED`, a
     * `requestId`, and a `details.issues` list naming the offending field. That
     * breaks both of this surface's contracts at once. It is prose and internal
     * structure on a wire that is supposed to carry only codes (§3.6), and it
     * is a distinguishable shape, which is exactly the oracle §3.2 refuses —
     * "this field exists but you sent the wrong value" is information.
     *
     * Found by probing a live instance, not by a test: every unit test built a
     * request that was already valid.
     *
     * Encapsulated to this plugin, so the dashboard's envelope is untouched.
     */
    app.setErrorHandler(async (error, request, reply) => {
      const status = typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
      // Logged in full server-side; the caller gets a code and nothing else.
      request.log.warn({ err: error, url: request.url }, 'public API request failed');
      const code: PublicErrorCode =
        status === 400 || status === 422 ? 'PUBLIC_QUERY_REFUSED' : 'PUBLIC_UPSTREAM_UNAVAILABLE';
      const outward = status === 400 || status === 422 ? 400 : 503;
      return reply.code(outward).send({
        error: {
          code,
          message:
            code === 'PUBLIC_QUERY_REFUSED'
              ? 'That request is not permitted here.'
              : 'The resource is unavailable.',
        },
      });
    });

    app.options('/public/config', { schema: { hide: true } }, preflight);
    app.options('/public/records/:ref', { schema: { hide: true } }, preflight);

    app.get(
      '/public/config',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          response: { 200: publicConfigReply, 401: publicErrorReply, 503: publicErrorReply },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-read');
        if (ok === null) return reply;
        /*
         * `publicConfigOf` is what strips the scope down to what a browser may
         * know: no physical table names, no mandatory predicate, no claim
         * column, no `sensitive` flag. The predicate in particular is an
         * authorization rule — publishing it would tell a caller exactly which
         * rows they are being kept away from.
         */
        return reply.send({ data: publicConfigOf(ok.key.scope) });
      },
    );

    app.get(
      '/public/records/:ref',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          params: publicRefParams,
          querystring: publicListQuery,
          response: {
            200: publicListReply,
            401: publicErrorReply,
            404: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-read');
        if (ok === null) return reply;

        const found = await resolveResource(request, reply, ok, request.params.ref, 'read');
        if (found === null) return reply;
        const { resource, view, table, db, dialect, predicate } = found;

        const q = request.query;

        /*
         * `q=` and `where=` are checked against the scope BEFORE the query is
         * built, so a refusal costs nothing and names nothing. `runList` also
         * bounds both (D5 b/c) — this is the outer of two gates, and the point
         * of the pair is that neither is the only one.
         */
        if (q.q !== undefined && q.q.length > 0 && resource.searchable.length === 0) {
          return fail(reply, 400, 'PUBLIC_QUERY_REFUSED', 'Search is not enabled for this resource.');
        }
        let where: string | undefined;
        if (q.where !== undefined) {
          try {
            const parsed = parseWhereParam(q.where);
            const named = collectFilterColumns(parsed);
            const outside = named.filter((c) => !resource.filterable.has(c));
            if (outside.length > 0) {
              return fail(reply, 400, 'PUBLIC_QUERY_REFUSED', 'That filter is not permitted here.');
            }
            where = q.where;
          } catch {
            return fail(reply, 400, 'PUBLIC_QUERY_REFUSED', 'That filter is not permitted here.');
          }
        }
        if (q.order !== undefined) {
          const named = q.order
            .split(',')
            .map((part) => (part.split('.')[0] ?? '').trim())
            .filter((c) => c.length > 0);
          const outside = named.filter((c) => !resource.orderable.has(c));
          if (outside.length > 0) {
            return fail(reply, 400, 'PUBLIC_QUERY_REFUSED', 'That sort is not permitted here.');
          }
        }

        const result = await runList({
          db,
          view,
          table,
          params: {
            ...(where === undefined ? {} : { where }),
            ...(q.q === undefined ? {} : { q: q.q }),
            ...(q.order === undefined ? {} : { order: q.order }),
            limit: Math.min(q.limit ?? resource.limit, resource.limit),
            ...(q.offset === undefined ? {} : { offset: q.offset }),
            ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
            count: 'none',
          },
          // Anonymous callers never see PII-masked columns, whatever the scope
          // says: masking is a second line and the allow-list is the boundary.
          canReadPii: false,
          dialect,
          // Scope predicate AND session predicate, both mandatory, neither
          // removable by any combination of query parameters.
          ...(predicate === null ? {} : { mandatory: predicate }),
          exposeColumns: resource.expose,
          searchColumns: resource.searchable,
        });

        await keys.touchLastUsed(ok.key.keyId);
        return reply.send(result);
      },
    );

    /* --------------------------------------------------------------- writes */

    app.options('/public/records/:ref/:id', { schema: { hide: true } }, preflight);
    app.options('/public/claim', { schema: { hide: true } }, preflight);

    app.post(
      '/public/records/:ref',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          params: publicRefParams,
          body: publicWriteBody,
          response: {
            201: publicRecordReply,
            400: publicErrorReply,
            401: publicErrorReply,
            404: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-write');
        if (ok === null) return reply;
        const found = await resolveResource(request, reply, ok, request.params.ref, 'create');
        if (found === null) return reply;

        const values = prepareValues(found.resource, request.body.values, ok.session);
        if (values === null) {
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That column is not writable here.');
        }

        let inserted;
        try {
          inserted = await insertRow(found.db, found.dialect, found.table, values);
        } catch {
          /*
           * A constraint violation is not spelled out. `routes/data` maps
           * unique/FK failures to friendly shapes naming the constraint and the
           * columns — exactly the detail that tells an anonymous caller which
           * values already exist, which is a membership oracle.
           */
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
        }

        await auditWrite(request, ok, 'public.record.create', {
          ref: request.params.ref,
          table: found.resource.table,
        });
        await keys.touchLastUsed(ok.key.keyId);

        // Only the exposed columns come back — a create must not return more
        // than a read of the same row would.
        const projected: Record<string, unknown> = {};
        for (const column of found.resource.expose) projected[column] = inserted[column];
        return reply.status(201).send({ data: projected });
      },
    );

    app.patch(
      '/public/records/:ref/:id',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          params: publicRecordParams,
          body: publicWriteBody,
          response: {
            200: publicRecordReply,
            400: publicErrorReply,
            401: publicErrorReply,
            404: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-write');
        if (ok === null) return reply;
        const found = await resolveResource(request, reply, ok, request.params.ref, 'update');
        if (found === null) return reply;

        const values = prepareValues(found.resource, request.body.values, ok.session);
        if (values === null) {
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That column is not writable here.');
        }

        let pk;
        try {
          pk = parseRecordId(found.table, request.params.id);
        } catch {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
        }

        /*
         * THE PREDICATE APPLIES TO THE UPDATE ITSELF, not to a lookup before it.
         * Checking first and then updating is a TOCTOU window, and worse, an
         * update whose WHERE lacks the predicate can move a row the caller was
         * never allowed to touch. So both go into one statement.
         */
        let updated = 0;
        try {
          let qb = found.db.updateTable(found.table.id).set(values as never);
          for (const [column, value] of Object.entries(pk)) {
            qb = qb.where(found.db.dynamic.ref(column), '=', value as never);
          }
          const predicate = found.predicate;
          if (predicate !== null) {
            qb = qb.where((eb) =>
              compileFilter(
                eb as never,
                {
                  view: found.view,
                  table: found.table,
                  canReadPii: false,
                  dynamic: found.db.dynamic,
                  dialect: found.dialect,
                },
                predicate,
              ),
            );
          }
          const res = await qb.executeTakeFirst();
          updated = Number(res.numUpdatedRows);
        } catch {
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
        }

        // Zero rows means "no such record" whether it does not exist, is out of
        // scope, or belongs to somebody else. One answer for all three.
        if (updated === 0) {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
        }

        await auditWrite(request, ok, 'public.record.update', {
          ref: request.params.ref,
          table: found.resource.table,
        });
        await keys.touchLastUsed(ok.key.keyId);

        const after = await fetchByPk(found.db, found.table, pk);
        const projected: Record<string, unknown> = {};
        for (const column of found.resource.expose) projected[column] = after?.[column];
        return reply.send({ data: projected });
      },
    );

    /* ---------------------------------------------------------------- claim */

    app.post(
      '/public/claim',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          body: publicClaimBody,
          response: {
            200: publicClaimReply,
            401: publicErrorReply,
            403: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-claim');
        if (ok === null) return reply;

        const claim = ok.key.scope.claim;
        if (claim === null || claim === undefined) {
          return fail(reply, 403, 'PUBLIC_CLAIM_UNAVAILABLE', 'This key does not support claims.');
        }
        /*
         * Only `lookup` is implemented. `email-code` needs SMTP and `external`
         * is declared-and-unimplemented so the durable path is additive — both
         * answer the SAME code as an unsupported key rather than advertising
         * which tier the operator configured.
         */
        if (claim.strategy !== 'lookup') {
          return fail(reply, 403, 'PUBLIC_CLAIM_UNAVAILABLE', 'This key does not support claims.');
        }

        const found = await resolveResource(request, reply, ok, claim.ref, 'read', {
          bypassClaimGate: true,
        });
        if (found === null) return reply;

        const grant = await resolveClaim({
          db: found.db,
          table: found.table,
          resource: found.resource,
          scope: ok.key.scope,
          match: request.body.match,
        });
        // ONE code for no match, several matches, a missing factor and an extra
        // one. Anything finer turns a two-factor check into two one-factor ones.
        if (grant === null) {
          return fail(reply, 403, 'PUBLIC_CLAIM_NO_MATCH', 'That did not match.');
        }

        const minted = generatePublicSessionToken();
        const expiresAt = Date.now() + CLAIM_SESSION_TTL_MS;
        await sessions.create({
          keyId: ok.key.keyId,
          tokenHash: minted.tokenHash,
          grants: JSON.stringify(grant),
          expiresAt,
        });
        await auditWrite(request, ok, 'public.claim', { ref: claim.ref });
        return reply.send({ data: { session: minted.token, expiresAt } });
      },
    );

    app.delete(
      '/public/session',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: { response: { 200: publicRecordReply, 401: publicErrorReply, 503: publicErrorReply } },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-read');
        if (ok === null) return reply;
        const token = parsePublicSessionToken(
          request.headers['x-adminium-public-session'] as string | undefined,
        );
        // Always `{}`. Whether a session existed is not the caller's business
        // and saying so would confirm a token was real.
        if (token !== null) await sessions.remove(hashPublishableKey(token));
        return reply.send({ data: {} });
      },
    );
  };
}

/** Re-exported so the isolation test and the client can share one list. */
export { PUBLIC_ERROR_CODES };
