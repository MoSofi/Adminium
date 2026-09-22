// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public namespace.
 *
 * Registered as a SIBLING of the `/api/v1` block, with its own prefix, its own
 * CORS posture and its own limiter. It must not move inside that block:
 * the admin CORS list is credentialed and this one must never be, and the
 * limiter here keys on things `principalKey` cannot see.
 *
 * ── THREE INDEPENDENT SWITCHES, ALL OF WHICH MUST BE ON ────────────────────
 *  1. `ADMINIUM_PUBLIC_API_ORIGINS` unset ⇒ `compose.ts` never calls this
 *     function. No door to probe, rather than a door that refuses.
 *  2. `ADMINIUM_TRUST_PROXY` off AND a non-loopback bind ⇒ refuses to register,
 *     loudly. See `publicApiRegistrationBlocked`.
 *  3. `publicApi.enabled` false ⇒ every route 503s, at runtime, reversibly.
 *
 * ── WHAT THIS FILE DOES NOT HAVE TO DO ─────────────────────────────────────
 * There is no check anywhere that a publishable key is being used on the right
 * route, because it CANNOT be used on a wrong one: `parseBearerApiKey` gates on
 * `adm_sk_`, so an `adm_pub_` token never becomes an rbac principal and
 * `request.can()` is false for it everywhere in the server. That property
 * is asserted by `public-api-isolation.test.ts` rather than restated here as a
 * runtime guard that could rot.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { DocumentRow, MetaDb, RecordRef } from '@adminium/meta';
import {
  documentProfilesRepo,
  filesRepo,
  documentsRepo,
  auditRepo,
  publicKeysRepo,
  publicSessionsRepo,
} from '@adminium/meta';

import { SELF_ORIGIN_SENTINEL, type Env } from '../../config/env.js';
import { ConnectionDisabledError } from '../../errors.js';
import { isSameOriginRequest } from '../../security/csrf.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { runList } from '../../crud/list.js';
import { compileFilter, parseWhereParam, type RecordFilter } from '../../crud/filters.js';
import type { PublicKeyResolver, ResolvedKey } from '../../public-api/resolve.js';
import {
  createPublicResolver,
  createPublicViews,
  createTouchThrottle,
  type PublicViews,
} from '../../public-api/runtime.js';
import { publicConfigOf, type CompiledResource, type PublicAction } from '../../public-api/scope.js';
import { prepareValues } from '../../public-api/values.js';
import { publishPublicWrite } from '../../public-api/publish.js';
import {
  CLAIM_SESSION_TTL_MS,
  claimPredicateFor,
  combinePredicates,
  parseGrant,
  resolveClaim,
  type PublicSessionContext,
} from '../../public-api/claim.js';
import { generatePublicSessionToken, hashPublishableKey, keyKindOf } from '../../public-api/keys.js';
import type { RequestStats } from '../../public-api/stats.js';
import { fetchByPk, parseRecordId, pkLabel } from '../../crud/records.js';
import { maskRows, type Row } from '../../crud/mask.js';
import { emitRecordEvent, invalidateWidgetData } from '../../crud/after-record-write.js';
import {
  HookRejectedError,
  createWriteService,
  insertRow,
  updateRows,
  type PlannedRow,
  type RecordWriteService,
  type WriteContext,
  type WriteTarget,
} from '../../crud/write-service.js';
import { audited } from '../../audit/coverage.js';
import { emailDocument } from '../../documents/deliver.js';
import { renderDocument, renderIntent, type RenderDeps } from '../../documents/render.js';
import type { FileStore } from '../../files/store.js';
import {
  PUBLIC_ERROR_CODES,
  publicClaimBody,
  publicClaimReply,
  publicConfigReply,
  publicErrorReply,
  publicListQuery,
  publicListShapes,
  publicRecordParams,
  publicBatchBody,
  PUBLIC_BATCH_MAX,
  publicRecordReply,
  publicRefParams,
  publicWriteBody,
  publicDocumentParams,
  publicDocumentReply,
  publicDocumentRenderBody,
  publicDocumentsQuery,
  publicDocumentsReply,
} from './schema.js';
import type { PublicErrorCode } from './schema.js';
import {
  createPublicRateLimiter,
  type PublicLimit,
  type PublicRateLimiter,
  type RateDecision,
} from '../../public-api/limiter.js';
import { parseBearerPublishableKey, parsePublicSessionToken } from '../../public-api/keys.js';

export interface PublicRoutesDeps {
  env: Env;
  meta: MetaDb;
  manager: ConnectionManager;
  /** Reads `publicApi.enabled` through a short-TTL cache — see `enabled.ts`. */
  isEnabled: () => Promise<boolean>;
  /** Injectable for tests; a fresh limiter otherwise. */
  limiter?: PublicRateLimiter | undefined;
  /**
   * The document pipeline. Absent = this build cannot draw documents, and
   * every `/public/documents*` route says so with the same refusal a key
   * without the flag gets — a deployment's capabilities are not a stranger's
   * business.
   */
  documents?: RenderDeps | undefined;
  /** Where a document's bytes are read from, for the content route. */
  storage?: FileStore | undefined;
  /** Where every write goes, with the project's hooks. A service with no hooks otherwise. */
  writes?: RecordWriteService | undefined;
  /**
   * The key resolver. `compose.ts` passes the one it also hands the admin
   * routes, so a revoke there empties THIS cache. A plugin mounted
   * alone builds its own.
   */
  resolver?: PublicKeyResolver | undefined;
  /** The schema-view cache the resolver reads through; built alongside it. */
  views?: PublicViews | undefined;
  /** "Requests · 24h". Absent = nothing is counted. */
  stats?: RequestStats | undefined;
}

/** A failed statement on this surface; answered without naming the constraint. */
class PublicWriteRefused extends Error {}

const refuseWrite = (): never => {
  throw new PublicWriteRefused();
};

/**
 * Is a bind address loopback-only?
 *
 * Loopback binds are exempt from the `ADMINIUM_TRUST_PROXY` hard requirement.
 * On loopback there is no proxy in front, so `remoteAddress` is already the true
 * peer and the requirement would be protecting nothing while blocking local
 * development of this very surface. `0.0.0.0`/`::` are NOT loopback — that is
 * the shipped Docker default and exactly the case this guards against.
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
 * That is not cosmetic. The isolation test skips this namespace when sweeping
 * the route tree, and with a loose prefix it would have skipped the management
 * routes as well — silently stopping the check that a publishable key cannot
 * mint ANOTHER publishable key. The trailing slash is what separates them, and
 * it is load-bearing enough to deserve a named export rather than a literal
 * repeated at each call site.
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

function fail(
  reply: FastifyReply,
  status: number,
  code: PublicErrorCode,
  message: string,
  params?: Record<string, unknown>,
): FastifyReply {
  return reply.code(status).send({ error: params === undefined ? { code, message } : { code, params, message } });
}

export function publicRoutes(deps: PublicRoutesDeps): FastifyPluginAsyncZod {
  const { env, meta, manager, isEnabled } = deps;
  const limiter = deps.limiter ?? createPublicRateLimiter();
  /** Requests that got as far as a resolved key and a ref: what `stats` counts. */
  const chargeable = new WeakMap<FastifyRequest, { keyId: string; ref: string }>();
  const configured = env.ADMINIUM_PUBLIC_API_ORIGINS ?? [];
  /*
   * The sentinel is NOT in this set. It is not an origin, nothing is ever
   * compared against it, and leaving it in would mean a caller sending the
   * literal header `Origin: self` matched the allow-list.
   */
  const allowed = new Set(configured.filter((origin) => origin !== SELF_ORIGIN_SENTINEL));
  /** Does `self` appear in the list? — whether same-origin callers are allowed. */
  const sameOriginAllowed = configured.includes(SELF_ORIGIN_SENTINEL);
  const keys = publicKeysRepo(meta);
  const sessions = publicSessionsRepo(meta);
  const audit = auditRepo(meta);
  const writes = deps.writes ?? createWriteService();

  /** A public write is anonymous: the key is the only name it has. */
  const publicWriteContext = (request: FastifyRequest, keyId: string): WriteContext => ({
    origin: 'public',
    hops: 0,
    actor: { kind: 'public', id: null, label: `public:${keyId}` },
    request,
  });

  const views = deps.views ?? createPublicViews(meta);
  const viewFor = views.viewFor;
  const resolver = deps.resolver ?? createPublicResolver(meta, views);
  const keyTouches = createTouchThrottle();
  const sessionTouches = createTouchThrottle();
  /** `last_used_at`, at most once a minute per key. */
  const touchKey = async (keyId: string): Promise<void> => {
    if (keyTouches.due(keyId)) await keys.touchLastUsed(keyId);
  };

  /**
   * Echo the caller's origin when it is allow-listed, and NEVER emit
   * `Access-Control-Allow-Credentials`. A browser therefore strips cookies
   * from anything sent here, which is what keeps an admin session from riding
   * along on a storefront's request.
   *
   * Returns whether CORS headers were emitted — i.e. whether this is an
   * allow-listed CROSS-ORIGIN caller. Same-origin callers are decided
   * separately in {@link originVerdict} and get no headers at all.
   */
  const applyCors = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = request.headers.origin;
    reply.header('Vary', 'Origin');
    if (typeof origin !== 'string' || !allowed.has(origin)) return false;
    reply.header('Access-Control-Allow-Origin', origin);
    return true;
  };

  /**
   * May this caller reach the namespace at all? — level 1, both halves.
   *
   * Emits CORS headers as a side effect for the cross-origin half, which is why
   * it takes the reply and why the gate calls it BEFORE any refusal (see the
   * ordering note there).
   *
   * The same-origin half is what makes a surface Adminium hosts itself able to
   * call this API — see {@link isSameOriginRequest}. It emits nothing:
   * a same-origin response needs no `Access-Control-Allow-Origin`, and adding
   * one would mean echoing a header the request never sent.
   */
  const originVerdict = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (applyCors(request, reply)) {
      /*
       * `Retry-After` is not a CORS-safelisted response header, so without
       * this a cross-origin page reads the 429 but `headers.get('retry-after')`
       * answers null, and the client's `retryAfterSeconds` is always null
       * there. Not on a preflight: a preflight response has nothing to
       * expose.
       */
      reply.header('Access-Control-Expose-Headers', 'Retry-After, X-Next-Cursor');
      return true;
    }
    return sameOriginAllowed && isSameOriginRequest(request);
  };

  const preflight = async (request: FastifyRequest, reply: FastifyReply): Promise<null> => {
    if (!applyCors(request, reply)) return reply.code(403).send();
    // DELETE is `signOut()`'s method (`DELETE /public/session`) and a record
    // delete's; PUT replaces a record. A browser refuses to send
    // any method this list does not name.
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'authorization, content-type, x-adminium-public-session');
    reply.header('Access-Control-Max-Age', '600');
    return reply.code(204).send();
  };

  /** Answers a refused count, and says whether the request may go on. */
  const admit = (reply: FastifyReply, decision: RateDecision): boolean => {
    if (decision.allowed) return true;
    reply.header('Retry-After', String(decision.retryAfterSeconds));
    fail(reply, 429, 'PUBLIC_RATE_LIMITED', 'Too many requests.');
    return false;
  };

  /**
   * The gate every public route runs first: off switch, origin, flood guard,
   * key, session, class limit.
   *
   * Ordered cheapest-refusal-first, and deliberately so that the OFF SWITCH is
   * checked before anything touches a key: a disabled instance must not spend a
   * meta-store read to say no.
   */
  const gate = async (
    request: FastifyRequest,
    reply: FastifyReply,
    limit: PublicLimit,
    /** What this request spends of an endpoint's own limit: a batch spends its rows. */
    opts: { cost?: number } = {},
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
    const originAllowed = originVerdict(request, reply);
    /*
     * WHICH KIND OF KEY decides whether an Origin is needed at all, and it is
     * read from the token's PREFIX, before anything is looked up:
     * a server key is valid with no Origin, a browser key is not. The resolver
     * then insists the stored row is the same kind.
     */
    const token = parseBearerPublishableKey(request.headers.authorization);
    const tokenKind = token === null ? null : keyKindOf(token);

    if (!(await isEnabled())) {
      fail(reply, 503, 'PUBLIC_API_DISABLED', 'The public API is turned off for this instance.');
      return null;
    }
    if (tokenKind === 'server') {
      /*
       * A server key presented with ANY browser provenance is refused, even
       * from a listed origin. A server key in a page bundle is a server key
       * published; refusing it from a browser is what keeps one from being
       * shipped there by mistake. Every browser sends `Sec-Fetch-*` (the same
       * signal `plugins/csrf.ts` reads) or an `Origin` on a cross-origin call.
       */
      const h = request.headers;
      if (h.origin !== undefined || h['sec-fetch-site'] !== undefined || h['sec-fetch-mode'] !== undefined) {
        fail(reply, 403, 'PUBLIC_ORIGIN_REFUSED', 'A server key cannot be used from a browser.');
        return null;
      }
    } else if (!originAllowed) {
      fail(reply, 403, 'PUBLIC_ORIGIN_REFUSED', 'This origin is not allowed to call the public API.');
      return null;
    }
    if (token === null) {
      fail(reply, 401, 'PUBLIC_KEY_INVALID', 'A publishable key is required.');
      return null;
    }
    const sessionToken = parsePublicSessionToken(
      request.headers['x-adminium-public-session'] as string | undefined,
    );

    /*
     * Counted before the key is resolved. Counting only verified keys would
     * make an invalid-key flood free, which is the cheapest possible attack on
     * a surface whose whole job is to answer strangers.
     *
     * On the ADDRESS, and on nothing else in the request: the token and the
     * session header are both the caller's to vary, and a bucket keyed on
     * either was a fresh bucket per random value. The class
     * limits come after resolution, below.
     */
    if (!admit(reply, limiter.hitUnverified(request.ip))) return null;

    /*
     * Resolution comes AFTER the flood guard, so an invalid-key flood buys at
     * most the guard's ceiling in meta-store round trips per address, not one
     * per request it can send.
     */
    // An address that keeps presenting keys that resolve to nothing is
    // refused before the lookup it would cost.
    const blocked = limiter.resolutionBlocked(request.ip);
    if (blocked !== null && !admit(reply, blocked)) return null;
    const key = await resolver.resolve(token);
    if (key === null) {
      limiter.failedResolution(request.ip);
      // One code for unknown, wrong, revoked, expired and uncompilable.
      fail(reply, 401, 'PUBLIC_KEY_INVALID', 'A publishable key is required.');
      return null;
    }

    /*
     * Per-key origin narrowing, applied on top of the instance allow-list. An
     * empty list means "not narrowed further" — never "any origin", because the
     * env list is always the outer bound and was already checked above.
     *
     * NOT sentinel-aware, and deliberately: a key narrowed to origins refuses a
     * same-origin call, because a same-origin GET carries no `Origin` header to
     * match. A key bound to a surface Adminium hosts
     * itself is minted with NO origins — the instance-level `self` is its
     * bound — which is what mint flow does. Teaching this list the sentinel
     * would mean teaching the mint schema and Studio to accept a non-URL, and
     * that belongs with the binding work, not here.
     */
    if (key.kind === 'browser' && key.origins.length > 0) {
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
        if (grant !== null) session = { id: row.id, keyId: row.keyId, grant };
      }
    }

    /*
     * The class limit, on the ladder in `limiter.ts`. Only NOW, with the key
     * resolved and the session verified, and keyed by their row ids: a
     * session header that verified nothing counts where an anonymous caller
     * counts. `public-claim` ignores the session whatever it is.
     */
    const counted = { keyId: key.keyId, ip: request.ip, sessionId: session?.id };
    const ref = (request.params as { ref?: unknown } | undefined)?.ref;
    // Charged to the resolved key and the ref it named, whatever it answers
    // from here on; a 401 above has no key to charge.
    if (typeof ref === 'string') chargeable.set(request, { keyId: key.keyId, ref });
    /*
     * A resource with its own `rate` is limited by it instead; one
     * without — every scope written before endpoints existed — by its class, as always.
     * The claim bucket is never replaced: it is the brute-force guard.
     */
    const rated = typeof ref === 'string' && limit !== 'public-claim' ? key.scope.byRef.get(ref)?.rate ?? null : null;
    if (rated !== null && typeof ref === 'string') {
      const cost = opts.cost ?? 1;
      // A request that could never fit is a refusal, not a wait: answered
      // 429 it would be retried forever.
      if (cost > rated.max) {
        fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'This request is larger than the endpoint allows in one window.', {
          max: rated.max,
        });
        return null;
      }
      if (!admit(reply, limiter.hitEndpoint({ ...counted, ref, kind: key.kind }, rated, cost))) return null;
    } else if (!admit(reply, limiter.hit(limit, counted))) {
      return null;
    }
    if (session !== null && sessionTouches.due(session.id)) void sessions.touch(session.id);

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
    action: PublicAction,
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
    /*
     * A paused connection answers this surface the same way an unreachable one
     * does. The refusal `manager.data` throws is written for an OPERATOR
     * ("resume it in Studio"), and this surface's callers are the tenant's own
     * customers — they cannot resume anything, and telling them the source was
     * switched off deliberately hands them a fact about the operator's
     * infrastructure that no other failure here leaks.
     */
    let handle;
    try {
      handle = await manager.data(ok.key.connectionId);
    } catch (error) {
      if (!(error instanceof ConnectionDisabledError)) throw error;
      fail(reply, 503, 'PUBLIC_UPSTREAM_UNAVAILABLE', 'The resource is unavailable.');
      return null;
    }
    const { db, dialect } = handle;
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
   * Audit a public write.
   *
   * There is no principal to stamp — that is the whole point of this surface — so the
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
    /**
     * WHICH ROW, when there is one. Without it a public write left an audit
     * entry naming the table and nothing else, so the per-record history a
     * record page shows (WS-A) had a hole exactly where an anonymous
     * caller had been — the writes an operator most wants to trace.
     */
    entity: RecordRef | null = null,
  ): Promise<void> => {
    const userAgent = request.headers['user-agent'];
    await audit.append({
      actorKind: 'api-key',
      actorId: null,
      actorLabel: `public:${ok.key.keyId}`,
      category: 'data',
      action,
      connectionId: ok.key.connectionId,
      entity,
      changes: { after: { ...changes, claimed: ok.session !== null } },
      ip: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
      requestId: request.id,
    });
  };

  return async (app) => {
    if (deps.stats !== undefined) {
      const stats = deps.stats;
      app.addHook('onResponse', async (request, reply) => {
        const charged = chargeable.get(request);
        if (charged !== undefined) stats.record(charged.keyId, charged.ref, reply.statusCode >= 400);
      });
    }
    /*
     * A SCOPED ERROR HANDLER, and it is not optional.
     *
     * Without it any Zod rejection — `limit=500` against the 200 ceiling is the
     * easy one — falls through to the global handler in `plugins/core.ts` and
     * answers with the DASHBOARD's envelope: `VALIDATION_FAILED`, a
     * `requestId`, and a `details.issues` list naming the offending field. That
     * breaks both of this surface's contracts at once. It is prose and internal
     * structure on a wire that is supposed to carry only codes, and it is a
     * distinguishable shape, which is exactly the oracle refuses — "this field
     * exists but you sent the wrong value" is information.
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
      /*
       * The CORS headers, again, because most of what lands here never reached
       * the gate: a Zod rejection fails validation before the handler runs,
       * and the core `public` bucket refuses in `onRequest`. Without them a
       * cross-origin page saw a CORS error in place of the code. The verdict
       * itself is not needed: whoever this caller is, the answer is a code.
       */
      originVerdict(request, reply);
      /*
       * A 429 here is the core `public` bucket (600 a minute per address,
       * `plugins/core.ts`) refusing in `onRequest`. It gets the gate's own
       * answer, word for word, so a caller cannot tell the two limits apart.
       * It used to fall to the 503 below, which told a caller the server was
       * down, not to slow down. `@fastify/rate-limit` has already set
       * `Retry-After` on the reply.
       *
       * Not logged, as the gate's own 429s are not: it is the limit working,
       * not a failure, and a flood would write one warn per refused request.
       * Fastify's `request completed` line still records each one at info.
       */
      if (status === 429) return fail(reply, 429, 'PUBLIC_RATE_LIMITED', 'Too many requests.');
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
          response: {
            200: publicConfigReply,
            401: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
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
            200: publicListShapes,
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
        const single = resource.response.shape === 'single';

        const q = request.query;

        /*
         * `q=` and `where=` are checked against the scope BEFORE the query is
         * built, so a refusal costs nothing and names nothing. `runList` also
         * bounds both — this is the outer of two gates, and the point
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
            // The caller's order, else the endpoint's. The default needs no
            // `orderable` entry: it is the server's choice, and the compiler
            // already refused one that sorts by a column the ref hides.
            ...(q.order !== undefined
              ? { order: q.order }
              : resource.defaultOrder === null
                ? {}
                : { order: resource.defaultOrder }),
            // `defaultLimit` is `limit` for a scope that states none, so a
            // scope written before 54 pages exactly as it did. A `single`
            // endpoint reads two rows: one is the answer, two is a refusal.
            limit: single ? 2 : Math.min(q.limit ?? resource.defaultLimit, resource.limit),
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

        await touchKey(ok.key.keyId);
        /*
         * THE RESPONSE SHAPE — the list route only. `wrapped`
         * is what every published client reads. `array` is the bare rows, the
         * next cursor moved to a header. `single` is exactly one row: none is
         * the ref's one 404, and more than one is a refusal rather than the
         * first of several — a "single" endpoint whose filter matches two rows
         * is a definition the operator must fix, not a coin toss.
         */
        if (single) {
          if (result.data.length === 0) return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
          if (result.data.length > 1) {
            return fail(reply, 400, 'PUBLIC_QUERY_REFUSED', 'This endpoint answers one row, and more than one matched.');
          }
          return reply.send(result.data[0] as Row);
        }
        if (resource.response.shape === 'array') {
          const next = result.cursor?.next ?? null;
          if (next !== null) reply.header('X-Next-Cursor', next);
          return reply.send(result.data);
        }
        return reply.send(result);
      },
    );

    app.options('/public/records/:ref/:id', { schema: { hide: true } }, preflight);

    /*
     * ONE ROW BY KEY. `GET` grants it together with the list, and it
     * is built ON the list rather than beside it: `runList` with the key as one
     * more mandatory condition and a page of one. So the projection, the PII
     * masking, the scope predicate and the claim are the list's by
     * construction — a second projection written here would be the one that
     * drifts, and the PK of a resource that does not expose it would be the
     * first thing it leaked.
     *
     * Unknown ref, no `read`, an unparseable id, a row outside the predicate or
     * the claim, and no such row are one 404 — indistinguishable, so a caller
     * fishing for what exists learns nothing from the difference.
     */
    app.get(
      '/public/records/:ref/:id',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          params: publicRecordParams,
          response: {
            200: publicRecordReply,
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

        let pk;
        try {
          pk = parseRecordId(found.table, request.params.id);
        } catch {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
        }
        const byKey: RecordFilter[] = Object.entries(pk).map(
          ([column, value]) => ({ column, op: 'eq', value }) as RecordFilter,
        );
        const keyFilter: RecordFilter = byKey.length === 1 ? (byKey[0] as RecordFilter) : { and: byKey };

        const result = await runList({
          db: found.db,
          view: found.view,
          table: found.table,
          params: { limit: 1, count: 'none' },
          canReadPii: false,
          dialect: found.dialect,
          // Never null: the key condition is always there.
          mandatory: combinePredicates(found.predicate, keyFilter) ?? keyFilter,
          exposeColumns: found.resource.expose,
          searchColumns: found.resource.searchable,
        });
        const row = result.data[0];
        if (row === undefined) return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');

        await touchKey(ok.key.keyId);
        return reply.send({ data: row });
      },
    );

    /* --------------------------------------------------------------- writes */

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

        const values = prepareValues(
          found.resource,
          request.body.values,
          ok.session,
          'create',
          found.dialect,
        );
        if (values === null) {
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That column is not writable here.');
        }

        const target: WriteTarget = {
          connectionId: ok.key.connectionId,
          view: found.view,
          table: found.table,
          db: found.db,
          dialect: found.dialect,
        };
        let inserted: Row;
        try {
          inserted = await writes.create({
            target,
            values,
            context: publicWriteContext(request, ok.key.keyId),
            /*
             * A constraint violation is not spelled out. `routes/data` maps
             * unique/FK failures to friendly shapes naming the constraint and
             * the columns — exactly the detail that tells an anonymous caller
             * which values already exist, which is a membership oracle.
             */
            mapError: refuseWrite,
            announce: async (row) => {
              const createdPk = Object.fromEntries(found.table.primaryKey.map((c) => [c, row[c]]));
              const createdRef: RecordRef = {
                connectionId: ok.key.connectionId,
                table: found.table.id,
                pk: createdPk,
                label: pkLabel(found.table, createdPk),
              };
              await auditWrite(
                request,
                ok,
                'public.record.create',
                { ref: request.params.ref, table: found.resource.table },
                createdRef,
              );
              await touchKey(ok.key.keyId);
              /*
               * The UNPROJECTED row, deliberately. What comes back to the
               * anonymous caller is narrowed to `expose`, because a create must
               * not return more than a read of the same row would — but the
               * stream's subscribers are signed-in staff holding a table-read
               * grant, and narrowing THEIR frame to a customer scope's `expose`
               * would hand the dashboard a half-row it would have to refetch to
               * complete. The publisher masks it for PII and secrets on the way
               * out, which is the check that applies here.
               */
              invalidateWidgetData(app, ok.key.connectionId, found.table.id);
              publishPublicWrite(app.hasDecorator('realtime') ? app.realtime : null, {
                connectionId: ok.key.connectionId,
                table: found.table,
                action: 'create',
                pk: createdPk,
                row,
              });
              /*
               * The sign-ups a rule most needs to see. A public create never
               * reached `routes/data`, so before this a "when a record is
               * created in users" rule was blind to exactly the rows 28's public
               * surface and 33's live-chat make. No undo window: nobody can take
               * an anonymous caller's write back.
               */
              await emitRecordEvent(app, {
                connectionId: ok.key.connectionId,
                table: found.table,
                action: 'create',
                entity: createdRef,
                before: null,
                after: row,
                origin: 'public',
              });
            },
          });
        } catch (error) {
          if (error instanceof PublicWriteRefused) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
          }
          if (error instanceof HookRejectedError) return fail(reply, 400, 'PUBLIC_WRITE_REJECTED', error.message);
          throw error;
        }

        // Only the exposed columns come back — a create must not return more
        // than a read of the same row would.
        const projected: Record<string, unknown> = {};
        for (const column of found.resource.expose) projected[column] = inserted[column];
        return reply.status(201).send({ data: projected });
      },
    );

    /*
     * PATCH (update) and PUT (replace) are one write: the same service call,
     * the same predicate in the UPDATE's own WHERE, the same audit verb. PUT
     * only adds that the body must be complete.
     */
    const updateHandler =
      (mode: 'update' | 'replace') =>
      async (
        request: FastifyRequest<{ Params: { ref: string; id: string }; Body: { values: Record<string, unknown> } }>,
        reply: FastifyReply,
      ) => {
        const ok = await gate(request, reply, 'public-write');
        if (ok === null) return reply;
        const found = await resolveResource(request, reply, ok, request.params.ref, mode);
        if (found === null) return reply;

        const values = prepareValues(
          found.resource,
          request.body.values,
          ok.session,
          'update',
          found.dialect,
        );
        if (values === null) {
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That column is not writable here.');
        }
        /*
         * PUT REPLACES THE WRITABLE SET: the body names every column
         * this caller may write — a nullable one may be null — and a missing
         * one is refused before anything runs. "Full" means what the caller
         * may write; the key, the scope's columns and server defaults are
         * never the caller's to replace.
         */
        if (mode === 'replace') {
          const sent = request.body.values;
          const missing = [...found.resource.writable].filter((c) => !Object.prototype.hasOwnProperty.call(sent, c));
          if (missing.length > 0) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'A replace names every writable column.');
          }
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
        const predicate = found.predicate;
        const inScope = <Q extends { where: (...args: never[]) => Q }>(query: Q): Q =>
          predicate === null
            ? query
            : (query.where as (factory: (eb: never) => unknown) => Q)((eb) =>
                compileFilter(
                  eb,
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
        const target: WriteTarget = {
          connectionId: ok.key.connectionId,
          view: found.view,
          table: found.table,
          db: found.db,
          dialect: found.dialect,
        };
        const updatedRef: RecordRef = {
          connectionId: ok.key.connectionId,
          table: found.table.id,
          pk,
          label: pkLabel(found.table, pk),
        };
        let outcome;
        try {
          outcome = await writes.update({
            target,
            pk,
            values,
            context: publicWriteContext(request, ok.key.keyId),
            refine: inScope,
            // Only a hook reads the row first, and it reads it inside the
            // scope, so a hook never sees (and a refusal never reveals) a row
            // this caller could not update.
            load: async () => {
              let query = found.db.selectFrom(found.table.id).selectAll();
              for (const [column, value] of Object.entries(pk)) {
                query = query.where(found.db.dynamic.ref(column), '=', value as never);
              }
              return ((await inScope(query).executeTakeFirst()) as Row | undefined) ?? null;
            },
            skipIfNone: true,
            mapError: refuseWrite,
            announce: async ({ after }) => {
              await auditWrite(
                request,
                ok,
                'public.record.update',
                {
                  ref: request.params.ref,
                  table: found.resource.table,
                  ...(mode === 'replace' ? { replace: true } : {}),
                },
                updatedRef,
              );
              await touchKey(ok.key.keyId);
              invalidateWidgetData(app, ok.key.connectionId, found.table.id);
              publishPublicWrite(app.hasDecorator('realtime') ? app.realtime : null, {
                connectionId: ok.key.connectionId,
                table: found.table,
                action: 'update',
                pk,
                row: after,
              });
              await emitRecordEvent(app, {
                connectionId: ok.key.connectionId,
                table: found.table,
                action: 'update',
                entity: updatedRef,
                // The before-image is not read on this path — the predicate goes
                // into the UPDATE itself rather than a lookup before it (see
                // above), and adding a SELECT to recover it would reopen the
                // TOCTOU window that design closed. A rule's `when` therefore
                // evaluates on the after image, which is what it evaluates on
                // for every other origin too.
                before: null,
                after,
                origin: 'public',
              });
            },
          });
        } catch (error) {
          if (error instanceof PublicWriteRefused) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
          }
          if (error instanceof HookRejectedError) return fail(reply, 400, 'PUBLIC_WRITE_REJECTED', error.message);
          throw error;
        }

        // Zero rows means "no such record" whether it does not exist, is out of
        // scope, or belongs to somebody else. One answer for all three.
        if (outcome.count === 0) {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
        }

        const projected: Record<string, unknown> = {};
        for (const column of found.resource.expose) projected[column] = outcome.after?.[column];
        return reply.send({ data: projected });
      };

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
      updateHandler('update'),
    );

    app.put(
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
      updateHandler('replace'),
    );

    /*
     * DELETE ONE ROW BY KEY.
     *
     * The scope goes into the DELETE's own WHERE — never a lookup first and a
     * bare delete after (the TOCTOU window 28 phase 2 closed for updates). The
     * row IS read first, but through the same scope, and only so a before hook
     * sees an in-scope row and the audit row can carry what was removed.
     * Nothing a caller could not read is ever handed to a hook, so a hook's
     * refusal cannot become an existence oracle.
     *
     * Zero rows — absent, outside the predicate, somebody else's — is the one
     * 404, with no audit row and nothing announced. A foreign key the database
     * enforces is the one opaque `PUBLIC_WRITE_REFUSED`, no constraint name.
     * The reply is `{ data: {} }`, as `DELETE /public/session` answers.
     */
    app.delete(
      '/public/records/:ref/:id',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          params: publicRecordParams,
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
        const found = await resolveResource(request, reply, ok, request.params.ref, 'delete');
        if (found === null) return reply;

        let pk;
        try {
          pk = parseRecordId(found.table, request.params.id);
        } catch {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
        }

        const predicate = found.predicate;
        const inScope = <Q extends { where: (...args: never[]) => Q }>(query: Q): Q =>
          predicate === null
            ? query
            : (query.where as (factory: (eb: never) => unknown) => Q)((eb) =>
                compileFilter(
                  eb,
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
        const target: WriteTarget = {
          connectionId: ok.key.connectionId,
          view: found.view,
          table: found.table,
          db: found.db,
          dialect: found.dialect,
        };
        const deletedRef: RecordRef = {
          connectionId: ok.key.connectionId,
          table: found.table.id,
          pk,
          label: pkLabel(found.table, pk),
        };
        let count;
        try {
          count = await writes.delete({
            target,
            pk,
            context: publicWriteContext(request, ok.key.keyId),
            refine: inScope,
            load: async () => {
              let query = found.db.selectFrom(found.table.id).selectAll();
              for (const [column, value] of Object.entries(pk)) {
                query = query.where(found.db.dynamic.ref(column), '=', value as never);
              }
              return ((await inScope(query).executeTakeFirst()) as Row | undefined) ?? null;
            },
            skipIfNone: true,
            mapError: refuseWrite,
            announce: async (_count, before) => {
              await auditWrite(
                request,
                ok,
                'public.record.delete',
                {
                  ref: request.params.ref,
                  table: found.resource.table,
                  // What was removed, masked as any staff reader without the
                  // PII grant would see it.
                  before: before === null ? null : (maskRows([before], found.table, false)[0] ?? null),
                },
                deletedRef,
              );
              await touchKey(ok.key.keyId);
              invalidateWidgetData(app, ok.key.connectionId, found.table.id);
              publishPublicWrite(app.hasDecorator('realtime') ? app.realtime : null, {
                connectionId: ok.key.connectionId,
                table: found.table,
                action: 'delete',
                pk,
                row: null,
              });
              await emitRecordEvent(app, {
                connectionId: ok.key.connectionId,
                table: found.table,
                action: 'delete',
                entity: deletedRef,
                before,
                after: null,
                origin: 'public',
              });
            },
          });
        } catch (error) {
          if (error instanceof PublicWriteRefused) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
          }
          if (error instanceof HookRejectedError) return fail(reply, 400, 'PUBLIC_WRITE_REJECTED', error.message);
          throw error;
        }
        if (count === 0) return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
        return reply.send({ data: {} });
      },
    );

    /*
     * BATCH: insert rows, and update rows by key, in
     * ONE transaction — all of them or none.
     *
     * - A row with no primary key is an INSERT, keyed by the server. A caller
     *   never inserts a key it chose, so there is no `ON CONFLICT` anywhere and
     *   no dialect gets a different answer.
     * - A row carrying its WHOLE primary key is an UPDATE of that row, with
     *   update-mode values and the scope predicate in the statement's own
     *   WHERE — PATCH by another door, so it needs `update` on the ref too.
     *   Unless every keyed row matches exactly one row, the whole batch rolls
     *   back with one opaque refusal: a row outside the scope and a row that
     *   does not exist must not be told apart (the membership oracle).
     *
     * A row refused BEFORE anything runs (a column it may not write, half a
     * key) is named by `params.index` — the caller's own data, no oracle. A
     * refusal from the database names nothing.
     */
    app.options('/public/records/:ref/batch', { schema: { hide: true } }, preflight);
    app.post(
      '/public/records/:ref/batch',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          params: publicRefParams,
          body: publicBatchBody,
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
        const rows = request.body.rows;
        if (rows.length === 0 || rows.length > PUBLIC_BATCH_MAX) {
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', `A batch is 1 to ${String(PUBLIC_BATCH_MAX)} rows.`, {
            max: PUBLIC_BATCH_MAX,
          });
        }
        // A batch spends its row count against the endpoint's limit.
        const ok = await gate(request, reply, 'public-write', { cost: rows.length });
        if (ok === null) return reply;
        const found = await resolveResource(request, reply, ok, request.params.ref, 'batch');
        if (found === null) return reply;
        const { resource, table } = found;

        const refuseRow = (index: number, message: string) =>
          fail(reply, 400, 'PUBLIC_WRITE_REFUSED', message, { index });
        const keyColumns = table.primaryKey;
        const inserts: { index: number; values: Row }[] = [];
        const updates: { index: number; pk: Row; values: Row }[] = [];
        for (const [index, raw] of rows.entries()) {
          const named = keyColumns.filter((c) => Object.prototype.hasOwnProperty.call(raw, c));
          if (named.length === 0) {
            const values = prepareValues(resource, raw, ok.session, 'create', found.dialect);
            if (values === null) return refuseRow(index, 'That column is not writable here.');
            inserts.push({ index, values });
            continue;
          }
          if (named.length !== keyColumns.length || !resource.actions.has('update')) {
            return refuseRow(index, 'A row may carry its whole key only to update it.');
          }
          const pk: Row = {};
          const rest: Row = {};
          for (const [column, value] of Object.entries(raw)) {
            if (keyColumns.includes(column)) pk[column] = value;
            else rest[column] = value;
          }
          const values = prepareValues(resource, rest, ok.session, 'update', found.dialect);
          if (values === null) return refuseRow(index, 'That column is not writable here.');
          updates.push({ index, pk, values });
        }

        const predicate = found.predicate;
        const inScope = <Q extends { where: (...args: never[]) => Q }>(query: Q): Q =>
          predicate === null
            ? query
            : (query.where as (factory: (eb: never) => unknown) => Q)((eb) =>
                compileFilter(
                  eb,
                  { view: found.view, table, canReadPii: false, dynamic: found.db.dynamic, dialect: found.dialect },
                  predicate,
                ),
              );
        const target: WriteTarget = {
          connectionId: ok.key.connectionId,
          view: found.view,
          table,
          db: found.db,
          dialect: found.dialect,
        };
        const context = publicWriteContext(request, ok.key.keyId);

        /*
         * Fill, before hooks and column rules, per row, before the transaction.
         * A hook sees an update's row only as this caller's scope shows it; a
         * keyed row the scope cannot see refuses the batch like any other.
         */
        const loadInScope = async (pk: Row): Promise<Row | null> => {
          let query = found.db.selectFrom(table.id).selectAll();
          for (const [column, value] of Object.entries(pk)) {
            query = query.where(found.db.dynamic.ref(column), '=', value as never);
          }
          return ((await inScope(query).executeTakeFirst()) as Row | undefined) ?? null;
        };
        let preparedInserts;
        let preparedUpdates;
        try {
          preparedInserts = await writes.beforeEach('create', target, context, inserts.map((r) => ({ values: r.values })));
          const planned: PlannedRow[] = [];
          const hooked = await writes.wants('before', 'update', target, context);
          for (const u of updates) {
            const record = hooked ? await loadInScope(u.pk) : undefined;
            if (record === null) return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
            planned.push({ match: u.pk, values: u.values, record });
          }
          preparedUpdates = await writes.beforeEach('update', target, context, planned);
        } catch (error) {
          if (error instanceof HookRejectedError) return fail(reply, 400, 'PUBLIC_WRITE_REJECTED', error.message);
          throw error;
        }
        for (const [i, row] of preparedInserts.entries()) {
          if (row.issues !== null) return refuseRow((inserts[i] as { index: number }).index, 'A value was refused.');
        }
        for (const [i, row] of preparedUpdates.entries()) {
          if (row.issues !== null) return refuseRow((updates[i] as { index: number }).index, 'A value was refused.');
        }

        let written: { created: Row[]; updated: { pk: Row; after: Row | null }[] };
        try {
          written = await found.db.transaction().execute(async (trx) => {
            const tdb = trx as unknown as typeof found.db;
            const created: Row[] = [];
            for (const row of preparedInserts) {
              created.push(await insertRow(tdb, found.dialect, table, row.values));
            }
            const updated: { pk: Row; after: Row | null }[] = [];
            for (const [i, row] of preparedUpdates.entries()) {
              const pk = (updates[i] as { pk: Row }).pk;
              const count = await updateRows(tdb, table, row.values, pk, inScope);
              if (count !== 1) throw new PublicWriteRefused();
              updated.push({ pk, after: null });
            }
            return { created, updated };
          });
        } catch {
          // A keyed row that matched nothing, or a constraint the database
          // enforced: one opaque answer, no index, no name.
          return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
        }
        for (const u of written.updated) u.after = (await fetchByPk(found.db, table, u.pk)) ?? null;

        const pkOf = (row: Row): Row => Object.fromEntries(keyColumns.map((c) => [c, row[c]]));
        await auditWrite(request, ok, 'public.record.batch', {
          ref: request.params.ref,
          table: resource.table,
          created: written.created.length,
          updated: written.updated.length,
          pks: [...written.created.map(pkOf), ...written.updated.map((u) => u.pk)],
        });
        await touchKey(ok.key.keyId);
        invalidateWidgetData(app, ok.key.connectionId, table.id);
        const hub = app.hasDecorator('realtime') ? app.realtime : null;
        for (const row of written.created) {
          const pk = pkOf(row);
          publishPublicWrite(hub, { connectionId: ok.key.connectionId, table, action: 'create', pk, row });
          await emitRecordEvent(app, {
            connectionId: ok.key.connectionId,
            table,
            action: 'create',
            entity: { connectionId: ok.key.connectionId, table: table.id, pk, label: pkLabel(table, pk) },
            before: null,
            after: row,
            origin: 'public',
          });
        }
        for (const u of written.updated) {
          publishPublicWrite(hub, { connectionId: ok.key.connectionId, table, action: 'update', pk: u.pk, row: u.after });
          await emitRecordEvent(app, {
            connectionId: ok.key.connectionId,
            table,
            action: 'update',
            entity: { connectionId: ok.key.connectionId, table: table.id, pk: u.pk, label: pkLabel(table, u.pk) },
            before: null,
            after: u.after,
            origin: 'public',
          });
        }
        await writes.afterEach('create', target, context, written.created.map((record) => ({ record, before: null })));
        await writes.afterEach(
          'update',
          target,
          context,
          written.updated.filter((u) => u.after !== null).map((u) => ({ record: u.after as Row, before: null })),
        );
        return reply.send({
          data: { count: rows.length, created: written.created.length, updated: written.updated.length },
        });
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


    /* ------------------------------------------------------------ documents */
    /*
     * Five routes, and every one of them names a gate — the route-table test
     * asserts exactly that, because this server has no ambient auth hook and a
     * `/public/*` route without a gate serves the operator's data to anybody who
     * asks.
     *
     * ─── WHAT A CLAIM REACHES ─────────────────────────────────────────────
     *
     * Two ways a document is the caller's: its own `claim` matches the session
     * (an intent they asked for), or its ENTITY is a row their claim reaches (an
     * invoice the operator drew for their order). Both are checked against the
     * session, never against anything in the request — and a document that is
     * neither answers 404, the same answer as one that does not exist.
     */
    app.options('/public/documents', { schema: { hide: true } }, preflight);
    app.options('/public/documents/render', { schema: { hide: true } }, preflight);
    app.options('/public/documents/:id', { schema: { hide: true } }, preflight);
    app.options('/public/documents/:id/content', { schema: { hide: true } }, preflight);
    app.options('/public/documents/:id/email', { schema: { hide: true } }, preflight);

    /** The register row, if this session may see it. Null is the 404. */
    const visibleDocument = async (
      ok: { key: ResolvedKey; session: PublicSessionContext | null },
      id: string,
    ): Promise<DocumentRow | null> => {
      const session = ok.session;
      if (session === null) return null;
      const row = await documentsRepo(meta).findById(id);
      if (row === null) return null;

      // Its own claim: the intent this caller asked for.
      if (
        row.claim !== null &&
        row.claim.column === session.grant.column &&
        String(row.claim.value) === String(session.grant.value)
      ) {
        return row;
      }

      /*
       * Or a row their claim reaches. The document names a TABLE; the scope
       * names refs. Finding the ref for that table is what lets the EXISTING
       * predicate do the deciding — the scope's mandatory narrowing AND the
       * session's claim, exactly as `GET /public/records/:ref` composes them.
       * A second, weaker rule about who owns a row, written here, is how the
       * two would come to disagree.
       */
      if (row.entityTable === null || row.entity === null) return null;
      let resource: CompiledResource | undefined;
      for (const candidate of ok.key.scope.byRef.values()) {
        if (candidate.table === row.entityTable) resource = candidate;
      }
      if (resource === undefined || !resource.actions.has('read')) return null;
      const claim = claimPredicateFor(resource, session);
      if (!claim.reachable) return null;

      const view = await viewFor(ok.key.connectionId);
      if (view === null) return null;
      let table;
      try {
        table = view.table(resource.table);
      } catch {
        return null;
      }
      let handle;
      try {
        handle = await manager.data(ok.key.connectionId);
      } catch {
        return null;
      }

      /*
       * The row's own key ANDed into the mandatory predicate rather than into
       * `where`: `where` is the caller's half and is checked against the
       * scope's `filterable` set, and a primary key need not be filterable for
       * the server to ask about it.
       */
      const pk = row.entity.pk;
      const byPk = table.primaryKey.map((column) => ({
        column,
        op: 'eq' as const,
        value: pk[column],
      }));
      const result = await runList({
        db: handle.db,
        view,
        table,
        params: { limit: 1, offset: 0, count: 'none' },
        canReadPii: false,
        dialect: handle.dialect,
        mandatory:
          combinePredicates(
            combinePredicates(resource.mandatory, claim.predicate),
            byPk.length === 1 ? byPk[0]! : { and: byPk },
          ) ?? undefined,
        exposeColumns: [...table.primaryKey],
        searchColumns: [],
      });
      return result.data.length > 0 ? row : null;
    };

    const documentView = (row: DocumentRow) => ({
      id: row.id,
      kind: row.kind,
      number: row.number,
      status: row.status,
      delivery: row.delivery,
      format: row.format,
      locale: row.locale,
      createdAt: row.createdAt,
      hasContent: row.fileId !== null || row.htmlFileId !== null,
    });


    /**
     * The door. Two shapes: draw from a row this claim reaches, or draw
     * from values the caller sends.
     *
     * The flag is checked BEFORE the shape, and its refusal is the same
     * `PUBLIC_REF_NOT_FOUND` an unknown resource gets: whether a deployment
     * can draw documents at all is not something a stranger holding a
     * publishable key gets to enumerate.
     */
    app.post(
      '/public/documents/render',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          body: publicDocumentRenderBody,
          response: {
            201: publicDocumentReply,
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
        if (!ok.key.scope.documents.create || deps.documents === undefined) {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        }

        const body = request.body;
        if ('profileId' in body) {
          /*
           * The PERSISTED shape. The claim must reach the row before anything
           * is drawn — a caller who cannot read a row must not be able to make
           * a document out of it, which would be a read through a side door.
           */
          const found = await resolveResource(request, reply, ok, body.ref, 'read');
          if (found === null) return reply;
          const profile = await documentProfilesRepo(meta).findById(body.profileId);
          if (profile === null || profile.table !== found.resource.table || !profile.enabled) {
            return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
          }
          const recordId = parseRecordId(found.table, String(body.id));
          const row = await runList({
            db: found.db,
            view: found.view,
            table: found.table,
            params: { limit: 1, offset: 0, count: 'none' },
            canReadPii: false,
            dialect: found.dialect,
            mandatory:
              combinePredicates(
                found.predicate,
                found.table.primaryKey.length === 1
                  ? { column: found.table.primaryKey[0]!, op: 'eq', value: recordId[found.table.primaryKey[0]!] }
                  : { and: found.table.primaryKey.map((c) => ({ column: c, op: 'eq' as const, value: recordId[c] })) },
              ) ?? undefined,
            exposeColumns: [...found.table.primaryKey],
            searchColumns: [],
          });
          if (row.data.length === 0) {
            return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
          }

          /*
           * NO DELAY. The 60-second window exists so a person can take back a
           * write they made in the dashboard; a public caller pressing "send me
           * a copy" is asking for the thing itself, and waiting a minute to
           * start would be inexplicable, and an e2e case holds that.
           */
          const outcome = await renderDocument(deps.documents, {
            profileId: profile.id,
            pk: recordId,
            actorKind: 'api-key',
            ...(body.locale === undefined ? {} : { locale: body.locale }),
          });
          if (outcome.status !== 'rendered') {
            return fail(reply, 503, 'PUBLIC_UPSTREAM_UNAVAILABLE', 'The document could not be drawn.');
          }
          return reply.code(201).send({ data: documentView(outcome.document) });
        }

        /*
         * The INLINE shape. Everything the caller sends is a value; everything
         * that makes the document the OPERATOR's — the letterhead, the clock,
         * the currency, the number — is stamped by `renderIntent`, and the row
         * comes out `pending-review` so nothing is emailed unattended.
         */
        const claim =
          ok.session === null
            ? undefined
            : { column: ok.session.grant.column, value: String(ok.session.grant.value) };
        const outcome = await renderIntent(deps.documents, {
          kind: body.kind,
          ...(body.locale === undefined ? {} : { locale: body.locale }),
          fields: body.fields,
          collections: body.collections,
          connectionId: ok.key.connectionId,
          ...(claim === undefined ? {} : { claim }),
          actorKind: 'api-key',
        });
        if (outcome.status !== 'rendered') {
          return fail(reply, 503, 'PUBLIC_UPSTREAM_UNAVAILABLE', 'The document could not be drawn.');
        }
        return reply.code(201).send({ data: documentView(outcome.document) });
      },
    );

    app.get(
      '/public/documents',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          querystring: publicDocumentsQuery,
          response: {
            200: publicDocumentsReply,
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
        if (ok.session === null) {
          // No session, no claim, nothing visible. Same answer as absence.
          return reply.send({ data: [] });
        }
        const rows = await documentsRepo(meta).list({ limit: 50 });
        const visible = [];
        for (const row of rows) {
          const seen = await visibleDocument(ok, row.id);
          if (seen !== null) visible.push(documentView(seen));
        }
        return reply.send({ data: visible });
      },
    );

    app.get(
      '/public/documents/:id',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          params: publicDocumentParams,
          response: {
            200: publicDocumentReply,
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
        const row = await visibleDocument(ok, request.params.id);
        if (row === null) return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        return reply.send({ data: documentView(row) });
      },
    );

    app.get(
      '/public/documents/:id/content',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          params: publicDocumentParams,
          response: {
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
        const row = await visibleDocument(ok, request.params.id);
        const fileId = row === null ? null : (row.fileId ?? row.htmlFileId);
        if (row === null || fileId === null || deps.storage === undefined) {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        }
        const file = await filesRepo(meta).findById(fileId);
        if (file === null || file.deletedAt !== null) {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        }
        const stream = await deps.storage.read(file);
        /*
         * ATTACHMENT and nosniff, always. The bytes are HTML an add-on drew; a
         * browser that rendered them inline on this origin would be running a
         * third party's markup with the operator's cookies in scope.
         */
        reply.header('Content-Type', file.mime);
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
        reply.header('X-Content-Type-Options', 'nosniff');
        // The typed reply describes the ERROR shapes only; bytes leave through
        // the raw send, the way the staff content route does it.
        return reply.send(stream as unknown as never);
      },
    );

    app.post(
      '/public/documents/:id/email',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          params: publicDocumentParams,
          response: {
            200: publicDocumentReply,
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
        if (!ok.key.scope.documents.create) {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        }
        const row = await visibleDocument(ok, request.params.id);
        if (row === null || row.status !== 'rendered') {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        }
        /*
         * TO THE CLAIM'S OWN ADDRESS, never to one in the request. This route
         * is a caller asking for their own copy — the ONLY thing it can decide
         * is whether, and the address is whatever the session was bound to
         * when it was claimed.
         */
        const to = String(ok.session!.grant.value);
        if (!to.includes('@')) {
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        }
        const delivery = await emailDocument(
          { meta, runtime: deps.documents?.runtime ?? (() => null), logger: request.log },
          { document: row, profile: null, to },
        );
        return reply.send({ data: { ...documentView(row), delivery } });
      },
    );

    // A cross-origin `signOut()` is preflighted twice over: DELETE is not a
    // simple method, and it carries the session header.
    app.options('/public/session', { schema: { hide: true } }, preflight);

    app.delete(
      '/public/session',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          response: {
            200: publicRecordReply,
            401: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
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
