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
  CUSTOMER_KEY_PURPOSE,
  documentProfilesRepo,
  filesRepo,
  documentsRepo,
  auditRepo,
  publicKeysRepo,
  publicChallengesRepo,
  publicProofsRepo,
  publicSessionsRepo,
  rolesRepo,
  settingsRepo,
} from '@adminium/meta';

import { SELF_ORIGIN_SENTINEL, type Env } from '../../config/env.js';
import { AppError, ConnectionDisabledError } from '../../errors.js';
import { csrfHeaderMatches, csrfSigningKey, isSameOriginRequest } from '../../security/csrf.js';
import { availabilityOf } from '../../surfaces/settings.js';
import type { ConnectionManager, SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Dialect } from '@adminium/engine';
import { sql, type Kysely } from 'kysely';
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
import { afterNow, aheadWithin, isTimeWindow, mandatoryAt } from '../../public-api/relative-filters.js';
import { prepareValues } from '../../public-api/values.js';
import { publishPublicWrite } from '../../public-api/publish.js';
import {
  CLAIM_SESSION_TTL_MS,
  KIOSK_SESSION_TTL_MS,
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
import { wallTimesAsInstants } from '../../crud/instants.js';
import { slotAvailability, slotInstant } from '../../crud/capacity-guard.js';
import { bookingDays, bookingSlots, kindMinutes } from '../../crud/booking-guard.js';
import { sendConfirmation } from '../../public-api/confirm.js';
import {
  CODE_LOCK_MS,
  CODE_RESEND_MS,
  CODE_TRIES,
  CODE_TTL_MS,
  CODES_PER_SESSION,
  DAY_MS,
  EMAIL_CHANGES_DAY,
  PERSON_CODES_15M,
  PERSON_CODES_DAY,
  PERSON_FAILURES_DAY,
  STEP_UP_MS,
  VERIFIED_TTL_MS,
  addressKey,
  codeBinding,
  codeKey,
  hashAddress,
  hashCode,
  maskAddress,
  newCode,
  plausibleAddress,
  subjectOf,
  tryCode,
} from '../../public-api/claim-code.js';
import { capKey, chargeAnonymous, notPlain } from '../../public-api/anonymous-caps.js';
import { appContact } from '../../outbox/sender.js';
import { createSwitches } from '../../public-api/switches.js';
import { dsnCryptoFromSecret } from '../../connections/crypto.js';
import { checkProof, issueChallenge, proofKey, type ProofPurpose } from '../../public-api/proof.js';
import { emailChangedLines, translatorForLocale } from '../../email/builtins.js';
import { EMAIL_CHANGED_TEMPLATE_KEY, SIGN_IN_CODE_TEMPLATE_KEY, enqueueEmail, isEmailConfigured } from '../../email/send.js';
import { recipientLocale } from '../../i18n/server-i18n.js';
import { negotiateLocale } from '../../plugins/surfaces.js';
import { publicConfirmSchema } from '../../public-api/endpoint.js';
import { emitRecordEvent, invalidateWidgetData } from '../../crud/after-record-write.js';
import {
  GuardedBatchError,
  HookRejectedError,
  bindValue,
  createWriteService,
  insertRow,
  updateRows,
  type PlannedRow,
  type RecordWriteService,
  type WriteContext,
  type WriteTarget,
} from '../../crud/write-service.js';
import { writeStores } from '../../crud/write-stores.js';
import { audited } from '../../audit/coverage.js';
import { emailDocument } from '../../documents/deliver.js';
import { renderDocument, renderIntent, type RenderDeps } from '../../documents/render.js';
import type { FileStore } from '../../files/store.js';
import {
  PUBLIC_ERROR_CODES,
  publicClaimBody,
  publicClaimReply,
  publicChallengeQuery,
  publicChallengeReply,
  publicCodeBody,
  publicCodeReply,
  publicVerifyBody,
  publicVerifyReply,
  publicConfigReply,
  publicErrorReply,
  publicAvailabilityQuery,
  publicAvailabilityReply,
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

/**
 * A failed statement on this surface; answered without naming the
 * constraint. A booking refusal names its column and why (`closed`,
 * `out-of-hours`, …) — nothing the day's availability does not already say.
 */
class PublicWriteRefused extends Error {
  constructor(readonly params?: { column: string; reason: string }) {
    super('That write was refused.');
  }
}

/**
 * The one refusal a guest is told apart: the time they picked has no room
 * (or is held by another writer this instant). It says no more than the
 * availability of that time already does.
 */
class PublicSlotRefused extends Error {
  constructor(readonly code: 'PUBLIC_SLOT_FULL' | 'PUBLIC_SLOT_BUSY' | 'PUBLIC_TOO_LATE') {
    super(
      code === 'PUBLIC_SLOT_BUSY'
        ? 'That time is busy. Try again in a moment.'
        : code === 'PUBLIC_TOO_LATE'
          ? 'It is too late to cancel online.'
          : 'That time is full.',
    );
  }
}

/**
 * The state a row must be in for an update to touch it (`writable_when`), as
 * conditions for the UPDATE's own WHERE — never a read's — or null. `without`
 * leaves the time window out: only the question "was it the window that
 * refused this row?" asks that.
 */
function updatableState(
  resource: CompiledResource,
  table: ResolvedTable,
  now: Date = new Date(),
  windows: 'with' | 'without' = 'with',
): RecordFilter | null {
  const conditions: RecordFilter[] = Object.entries(resource.writableWhen).flatMap(([column, when]): RecordFilter[] => {
    if (when === 'from-now') return [afterNow(table, column, now)];
    if (isTimeWindow(when)) return windows === 'with' ? [aheadWithin(table, column, when.within, now)] : [];
    return [{ column, op: 'in', value: [...when] }];
  });
  return conditions.length === 0 ? null : conditions.length === 1 ? (conditions[0] as RecordFilter) : { and: conditions };
}

/**
 * Whether a proved create's writer is excused the proof: a session claimed
 * through the resource's own identity, on a resource that caps what one
 * person may hold. Any other session — or none — still proves.
 */
function proofExcused(resource: CompiledResource, session: PublicSessionContext | null): boolean {
  return session !== null && resource.claim?.ref !== undefined && session.grant.ref === resource.claim.ref && resource.maxOpen !== null;
}

/**
 * The proof a request owes, or null: a create on a resource that asks one
 * (unless excused), a claim through an identity that asks one. A server key
 * is one backend, never asked; nor is anything else.
 */
function proofOwed(
  key: ResolvedKey,
  session: PublicSessionContext | null,
  kind: 'create' | 'claim' | undefined,
  ref: unknown,
): ProofPurpose | null {
  // A staff-bound key is a signed-in staff member's screen: no proof asked.
  if (kind === undefined || key.kind !== 'browser' || key.requiresStaff !== null) return null;
  if (kind === 'claim') return key.scope.claim?.humanCheck === true ? 'claim' : null;
  const resource = typeof ref === 'string' ? key.scope.byRef.get(ref) : undefined;
  return resource?.humanCheck === true && !proofExcused(resource, session) ? 'write' : null;
}

/**
 * Whether a read may show PII-masked columns: only a person's own rows (a
 * claim-gated resource), only at the `verified` level — they proved the
 * mailbox — and only to a verified session. Every other public read keeps
 * the mask.
 */
function readsOwnPii(resource: CompiledResource, session: PublicSessionContext | null): boolean {
  return resource.claim !== null && resource.claim.optional !== true && resource.level === 'verified' && session?.level === 'verified';
}

/** The booking guard's refusals a guest is told, by the code they are told. */
const SLOT_REFUSALS: Readonly<Record<string, PublicSlotRefused['code']>> = {
  CAPACITY_FULL: 'PUBLIC_SLOT_FULL',
  CAPACITY_BUSY: 'PUBLIC_SLOT_BUSY',
  CAPACITY_TOO_LATE: 'PUBLIC_TOO_LATE',
  // Booking people: the time went while the guest was typing (the page offers the nearest).
  BOOKING_TAKEN: 'PUBLIC_SLOT_FULL',
  BOOKING_BUSY: 'PUBLIC_SLOT_BUSY',
  BOOKING_TOO_LATE: 'PUBLIC_TOO_LATE',
};

/** The booking refusals a guest is told as a refused write, by why. */
const BOOKING_REASONS: Readonly<Record<string, string>> = {
  BOOKING_CLOSED: 'closed',
  BOOKING_OUT_OF_HOURS: 'out-of-hours',
  BOOKING_OUT_OF_RANGE: 'out-of-range',
  BOOKING_NOT_OFFERED: 'not-offered',
};

const refuseWrite = (error?: unknown): never => {
  const told = error instanceof AppError ? SLOT_REFUSALS[error.code] : undefined;
  if (told !== undefined) throw new PublicSlotRefused(told);
  if (error instanceof AppError) {
    const details = (error.details ?? {}) as { reason?: unknown; column?: unknown; fields?: Record<string, unknown> };
    const code = error.code === 'BOOKING_CLOSED' ? 'BOOKING_CLOSED' : typeof details.reason === 'string' ? details.reason : '';
    const reason = BOOKING_REASONS[code];
    const column = typeof details.column === 'string' ? details.column : Object.keys(details.fields ?? {})[0];
    if (reason !== undefined && column !== undefined) throw new PublicWriteRefused({ column, reason });
  }
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

/** `days` after a `YYYY-MM-DD` day. */
function addCalendarDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The key of a row the session reaches in `table`, when `id` names one — the
 * asker's own visit — or null. Looked up through each claimed resource on the
 * same table, with that resource's claim predicate, so an id outside the
 * session answers the same as one that does not exist.
 */
async function claimedRowKey(
  ok: { key: ResolvedKey; session: PublicSessionContext | null },
  db: Kysely<SourceDatabase>,
  table: ResolvedTable,
  id: string,
): Promise<string | null> {
  const [keyColumn, ...rest] = table.primaryKey;
  if (keyColumn === undefined || rest.length > 0 || ok.session === null) return null;
  for (const resource of ok.key.scope.byRef.values()) {
    if (resource.table !== table.id || resource.claim === null) continue;
    const claim = claimPredicateFor(resource, ok.session);
    if (!claim.reachable || claim.predicate === null || !('column' in claim.predicate)) continue;
    const predicate = claim.predicate as { column: string; value: unknown };
    const row = await db
      .selectFrom(table.id)
      .select(sql<unknown>`${sql.ref(keyColumn)}`.as('key'))
      .where((eb) => eb(db.dynamic.ref(keyColumn), '=', id as never))
      .where((eb) => eb(db.dynamic.ref(predicate.column), '=', predicate.value as never))
      .executeTakeFirst();
    if (row !== undefined) return String((row as { key: unknown }).key);
  }
  return null;
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
  const challenges = publicChallengesRepo(meta);
  const proofs = publicProofsRepo(meta);
  const proofSecret = proofKey(env.ADMINIUM_SECRET);
  // The emailed code's keys, each derived for its own use from the server's secret.
  const codeSecret = codeKey(env.ADMINIUM_SECRET);
  const addressSecret = addressKey(env.ADMINIUM_SECRET);
  const capSecret = capKey(env.ADMINIUM_SECRET);
  // An app's settings switches, trusted for fifteen seconds.
  const switches = createSwitches(async (connectionId) => (await manager.data(connectionId)).db);
  const csrfKey = csrfSigningKey(env.ADMINIUM_SECRET);
  const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
  /**
   * Whether this request comes from a staff member the key is bound to: a
   * live staff sign-in whose person holds the app role the key names (that
   * app's own role — never a super-admin, never another app's role of the same
   * slug); from this origin, with the CSRF token on a write (the cookie is the
   * credential here, so it is held to what the dashboard holds it to); and on
   * the app's own staff host when the operator mapped one.
   */
  const staffPresent = async (request: FastifyRequest, key: ResolvedKey): Promise<boolean> => {
    const binding = key.requiresStaff;
    const user = request.user;
    if (binding === null || user === null || request.session === null) return false;
    if (binding.appKey === '' || binding.appKey !== key.managedBy) return false;
    if (!isSameOriginRequest(request)) return false;
    if (!SAFE_METHODS.has(request.method) && !csrfHeaderMatches(request, csrfKey)) return false;
    if (request.server.surfaceSettings != null) {
      const settings = await request.server.surfaceSettings.read();
      const hosts = Object.entries(settings.domains)
        .filter(([, target]) => target.appKey === binding.appKey && target.side === 'staff')
        .map(([host]) => host.toLowerCase());
      if (hosts.length > 0 && !hosts.includes(request.hostname.toLowerCase())) return false;
    }
    const roles = await rolesRepo(meta).rolesForUser(user.id);
    return roles.some((role) => role.slug === binding.roleSlug && role.appKey === binding.appKey);
  };
  /**
   * Who a person's code emails come from: through an app's own key, the app's
   * name and phone from its settings row; else the workspace's name and no
   * phone (the notices then say "contact us", as they always did).
   */
  const senderOf = async (key: { managedBy: string | null; connectionId: string }): Promise<{ appName: string; phone: string | null }> => {
    const contact = key.managedBy === null ? null : await appContact(meta, manager, key.managedBy, key.connectionId);
    return {
      appName: contact?.name ?? String((await settingsRepo(meta).get('branding.appName')) ?? 'Adminium'),
      phone: contact?.phone ?? null,
    };
  };
  const addressCrypto = dsnCryptoFromSecret(env.ADMINIUM_SECRET);
  const audit = auditRepo(meta);
  const writes = deps.writes ?? createWriteService(writeStores(meta));

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
    reply.header('Access-Control-Allow-Headers', 'authorization, content-type, x-adminium-public-session, x-adminium-proof');
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
    opts: {
      cost?: number;
      /**
       * The human check this request may owe: a create on a proved resource,
       * or a claim through a proved identity. Checked after the visitor's own
       * limit and before the whole key's, so bad proofs cost the key nothing.
       */
      proof?: 'create' | 'claim';
      /** Counted per visitor only: a challenge costs nothing to hand out. */
      keyWide?: false;
    } = {},
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
     * AN APP'S OWN KEY STOPS WITH THE APP. A key an app made at install
     * answers only while that app is on and its customer side is not switched
     * off. Checked per request against the placement cache, not in the key
     * cache: switching the app off takes effect in seconds, not at the key's
     * TTL. An operator's own key is never touched by this.
     */
    if (key.managedBy !== null && request.server.surfaceSettings != null) {
      const settings = await request.server.surfaceSettings.read();
      // The public side's key stops with the public side; another (a kiosk's)
      // with the staff side its screen is served from.
      const availability = availabilityOf(settings, key.managedBy, key.purpose === CUSTOMER_KEY_PURPOSE ? 'customer' : 'staff');
      if (availability !== 'ok') {
        fail(
          reply,
          503,
          availability === 'app-disabled' ? 'APP_DISABLED' : 'SURFACE_OFF',
          'This app is switched off right now.',
        );
        return null;
      }
    }

    /*
     * A STAFF-BOUND KEY (a kiosk's) opens nothing alone: every request also
     * comes from a staff member signed in on this server, holding the app role
     * the key names, from the page itself — checked before any limit is
     * spent, so a token copied out of the page cannot even drain a bucket.
     */
    if (key.requiresStaff !== null && !(await staffPresent(request, key))) {
      fail(reply, 403, 'PUBLIC_STAFF_REQUIRED', 'Sign in on this screen to use it.');
      return null;
    }
    // A key the app switches in its settings row (the kiosk switch), read at most every 15 s.
    if (key.enabledBy !== null && !(await switches.isOn(key.connectionId, key.enabledBy.table, key.enabledBy.column))) {
      fail(reply, 503, 'PUBLIC_KEY_OFF', 'This is switched off right now.');
      return null;
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
        if (grant !== null) session = { id: row.id, keyId: row.keyId, grant, level: row.level === 'verified' ? 'verified' : 'lookup' };
      }
    }

    /*
     * The class limit, on the ladder in `limiter.ts`. Only NOW, with the key
     * resolved and the session verified, and keyed by their row ids: a
     * session header that verified nothing counts where an anonymous caller
     * counts. `public-claim` ignores the session whatever it is.
     */
    const counted = {
      keyId: key.keyId,
      ip: request.ip,
      sessionId: session?.id,
      // A kiosk counts per staff sign-in: every waiting patient shares its address.
      ...(key.requiresStaff !== null && request.session !== null ? { staffSessionId: request.session.id } : {}),
    };
    const counts: PublicLimit = key.requiresStaff !== null && limit === 'public-claim' ? 'public-staff-claim' : limit;
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
    } else if (!admit(reply, limiter.hit(counts, counted))) {
      return null;
    }
    // Every visitor together, on a key anyone can copy out of a page. By
    // request: a batch's rows are the endpoint's own limit to count.
    // The human check, before the whole key is charged: a flood of bad proofs spends nobody's allowance.
    const owed = proofOwed(key, session, opts.proof, ref);
    const proved = owed === null ? null : checkProof(proofSecret, request.headers['x-adminium-proof'], { keyId: key.keyId, purpose: owed, now: Date.now() });
    if (proved !== null && !proved.ok) {
      fail(reply, 403, 'PUBLIC_PROOF_REQUIRED', 'Prove this is a person first.');
      return null;
    }
    const rung = opts.keyWide === false ? null : limit === 'public-read' ? 'read' : limit === 'public-claim' ? 'claim' : limit === 'public-write' ? 'write' : null;
    if (key.kind === 'browser' && rung !== null && !admit(reply, limiter.hitKey(key.keyId, rung))) {
      return null;
    }
    // Spent once, on every instance: a replay finds the row already there.
    if (proved?.ok === true && !(await proofs.spend({ id: proved.spendId, keyId: key.keyId, purpose: owed!, expiresAt: proved.expiresAt }))) {
      fail(reply, 403, 'PUBLIC_PROOF_REQUIRED', 'Prove this is a person first.');
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
  /** How many rows match a filter, read as the server (never shown as rows). */
  const countOf = async (found: { db: Kysely<SourceDatabase>; view: SnapshotView; table: ResolvedTable; dialect: Dialect }, filter: RecordFilter): Promise<number> => {
    const ctx = { view: found.view, table: found.table, canReadPii: true, dynamic: found.db.dynamic, dialect: found.dialect };
    const row = (await found.db
      .selectFrom(found.table.id)
      .select(sql<number>`count(*)`.as('n'))
      .where((eb) => compileFilter(eb as never, ctx, filter))
      .executeTakeFirst()) as { n: unknown } | undefined;
    return Number(row?.n ?? 0);
  };

  /**
   * Why an update touched nothing, when the answer is "too early": the row,
   * by its key, is the caller's own — inside the resource's read predicate
   * and its claim — every other state the update asks of it holds, and its
   * time is beyond the window. Then that time, and the moment the window
   * opens, as instants. Otherwise null: every other miss keeps the one "no
   * such record", so the time is never said about a row the caller could
   * not change later. Asked with the update's own `now`, so the two agree.
   */
  const tooEarlyFor = async (
    found: { resource: CompiledResource; db: Kysely<SourceDatabase>; view: SnapshotView; table: ResolvedTable; dialect: Dialect; predicate: RecordFilter | null },
    pk: Record<string, unknown>,
    now: Date,
  ): Promise<{ at: string; from: string } | null> => {
    const [window, ...more] = Object.entries(found.resource.writableWhen).flatMap(([column, when]) =>
      isTimeWindow(when) ? [{ column, within: when.within }] : [],
    );
    if (window === undefined || more.length > 0) return null;
    const conditions: RecordFilter[] = [
      ...Object.entries(pk).map(([column, value]) => ({ column, op: 'eq', value }) as RecordFilter),
      ...[found.predicate, updatableState(found.resource, found.table, now, 'without')].filter((c): c is RecordFilter => c !== null),
      aheadWithin(found.table, window.column, window.within, now, 'beyond'),
    ];
    const ctx = { view: found.view, table: found.table, canReadPii: false, dynamic: found.db.dynamic, dialect: found.dialect };
    const row = (await found.db
      .selectFrom(found.table.id)
      .select(sql<unknown>`${sql.ref(window.column)}`.as('at'))
      .where((eb) => compileFilter(eb as never, ctx, { and: conditions }))
      .limit(1)
      .executeTakeFirst()) as { at?: unknown } | undefined;
    if (row === undefined) return null;
    // As a read of the row would show it: SQLite keeps a wall time, the others an instant.
    const at = slotInstant(wallTimesAsInstants({ [window.column]: row.at }, found.table.columns, found.dialect)[window.column]);
    if (at === null) return null;
    return { at: at.toISOString(), from: new Date(at.getTime() - window.within * 60_000).toISOString() };
  };

  /**
   * Whether a signed-in person already holds as many open rows as the
   * endpoint's `maxOpen` allows: rows of theirs whose column is one of the
   * values (and, with `upcoming`, still ahead). Not asked without a session.
   */
  const openRowsFull = async (
    found: { resource: CompiledResource; db: Kysely<SourceDatabase>; view: SnapshotView; table: ResolvedTable; dialect: Dialect },
    session: PublicSessionContext | null,
  ): Promise<boolean> => {
    const max = found.resource.maxOpen;
    const column = found.resource.claim?.column;
    if (max === null || session === null || column === undefined) return false;
    const conditions: RecordFilter[] = [
      { column, op: 'eq', value: session.grant.value },
      { column: max.column, op: 'in', value: [...max.values] },
      ...(max.upcoming === undefined ? [] : [afterNow(found.table, max.upcoming)]),
    ];
    return (await countOf(found, { and: conditions })) >= max.n;
  };

  /**
   * Where a new row stands among the matching rows, by the endpoint's `rank`;
   * null when it does not rank. The new row's own order value is read in SQL,
   * as the database keeps it: Postgres keeps microseconds a JavaScript date
   * does not, and a comparison with the date would leave the row out of its
   * own count.
   */
  const rankOf = async (
    found: { resource: CompiledResource; db: Kysely<SourceDatabase>; table: ResolvedTable; dialect: Dialect },
    row: Row,
  ): Promise<number | null> => {
    const rank = found.resource.rank;
    const key = found.table.primaryKey[0];
    if (rank === null || key === undefined || row[key] === null || row[key] === undefined) return null;
    const table = sql.table(found.table.id);
    const order = sql.ref(rank.orderBy);
    const own = sql`(select ${order} from ${table} where ${sql.ref(key)} = ${row[key]})`;
    const matching =
      rank.where === undefined ? sql`` : sql`${sql.ref(rank.where.column)} = ${bindValue(found.dialect, rank.where.eq)} and `;
    // Rows ordered before it, and those at the same moment made no later than it.
    const counted = await sql<{ n: unknown }>`select count(*) as n from ${table} where ${matching}(${order} < ${own} or (${order} = ${own} and ${sql.ref(key)} <= ${row[key]}))`.execute(found.db);
    return Number(counted.rows[0]?.n ?? 0);
  };

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
    opts: { bypassClaimGate?: boolean; kind?: 'records' | 'availability' } = {},
  ) => {
    const resource = ok.key.scope.byRef.get(ref);
    /*
     * ONE answer for: no such ref, a ref this scope has but not for this
     * action, and a claim-gated ref with no session. `routes/data`
     * distinguishes its equivalents — 404 for an unknown connection, 403 for a
     * real one — which together are a status-code oracle this surface must not
     * inherit.
     */
    // An availability endpoint answers free or full at its own route and is
    // no resource of rows anywhere else — its table's bookings stay put.
    if (resource === undefined || !resource.actions.has(action) || resource.kind !== (opts.kind ?? 'records')) {
      fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
      return null;
    }
    const claim = claimPredicateFor(resource, ok.session);
    if (!claim.reachable && opts.bypassClaimGate !== true) {
      fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
      return null;
    }
    /*
     * A session that found the person but has not confirmed the emailed code
     * is told so, and only once it holds a session this resource would take:
     * the page then starts the code step. Nothing about any row is said.
     */
    if (resource.level === 'verified' && ok.session !== null && ok.session.level !== 'verified' && opts.bypassClaimGate !== true) {
      fail(reply, 403, 'PUBLIC_CLAIM_LEVEL', 'Confirm the code we emailed you first.');
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
    /*
     * A write the app switched off in its settings row (online booking off;
     * new patients online off, for a create nobody signed in for). Said
     * plainly: the page shows it and offers the phone.
     */
    if (action !== 'read') {
      const unsigned = ok.session === null || resource.claim === null;
      for (const setting of resource.requireSetting) {
        if (setting.when === 'anonymous' && !(unsigned && (action === 'create' || action === 'batch'))) continue;
        if (!(await switches.isOn(ok.key.connectionId, setting.table, setting.column))) {
          fail(reply, 403, 'PUBLIC_SWITCHED_OFF', 'This is not open online right now.');
          return null;
        }
      }
    }
    const { db, dialect } = handle;
    return {
      resource,
      view,
      table,
      db,
      dialect,
      // A calendar filter (`today`) is worked out now, on the venue's clock.
      predicate: combinePredicates(mandatoryAt(resource.where, table, ok.key.scope.timezone), claim.reachable ? claim.predicate : null),
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
            // A staff-bound key without its staff member on this screen.
            403: publicErrorReply,
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
          // A person who proved their mailbox reads their OWN row as it is.
          canReadPii: readsOwnPii(resource, ok.session),
          dialect,
          // Scope predicate AND session predicate, both mandatory, neither
          // removable by any combination of query parameters.
          ...(predicate === null ? {} : { mandatory: predicate }),
          exposeColumns: resource.expose,
          searchColumns: resource.searchable,
        });

        await touchKey(ok.key.keyId);
        // Instants a caller elsewhere can read (SQLite keeps the server's wall clock).
        result.data = result.data.map((row) => wallTimesAsInstants(row, table.columns, dialect));
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
    app.options('/public/availability/:ref', { schema: { hide: true } }, preflight);

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
    /*
     * Free or full, per slot of a day, for a party — the booking page's one
     * question. Computed from the table's booking limit, with the same sum
     * the write path adds up; no row, name or count is in the answer. A
     * claimed guest's own booking is not counted against them.
     */
    app.get(
      '/public/availability/:ref',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          params: publicRefParams,
          querystring: publicAvailabilityQuery,
          response: {
            200: publicAvailabilityReply,
            400: publicErrorReply,
            401: publicErrorReply,
            // A staff-bound key without its staff member, a switched-off side.
            403: publicErrorReply,
            404: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-read');
        if (ok === null) return reply;
        const found = await resolveResource(request, reply, ok, request.params.ref, 'read', { kind: 'availability' });
        if (found === null) return reply;
        const query = request.query;
        const target = {
          connectionId: ok.key.connectionId,
          table: found.table,
          db: found.db,
          dialect: found.dialect,
          timezone: ok.key.scope.timezone,
          origin: 'public' as const,
        };
        const rule = found.table.table.capacity;
        if (rule !== undefined) {
          if (query.date === undefined || query.party === undefined || query.kind !== undefined || query.from !== undefined) {
            return fail(reply, 400, 'PUBLIC_QUERY_REFUSED', 'Ask for one date and the party.');
          }
          // The booking this guest has claimed, when it is in the same table.
          let own: Row | null = null;
          const grant = ok.session?.grant;
          if (grant !== undefined && ok.key.scope.byRef.get(grant.ref)?.table === found.table.id) {
            own =
              ((await found.db
                .selectFrom(found.table.id)
                .selectAll()
                .where((eb) => eb(found.db.dynamic.ref(grant.column), '=', grant.value))
                .executeTakeFirst()) as Row | undefined) ?? null;
          }
          const slots = await slotAvailability(rule, target, query.date, query.party, own);
          return reply.send({ data: slots });
        }

        /*
         * BOOKING PEOPLE: a kind of visit, one person or anyone, one day or a
         * strip. The asker's own visit, when they are moving it, is left out
         * — but only a row their session can read: `exclude` is looked up
         * through the claim, so it cannot be used to probe another's visit.
         */
        const booking = found.table.table.booking;
        if (booking === undefined) return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        const oneDay = query.date !== undefined;
        if (
          query.party !== undefined ||
          query.kind === undefined ||
          oneDay === (query.from !== undefined) ||
          (query.from !== undefined) !== (query.days !== undefined)
        ) {
          return fail(reply, 400, 'PUBLIC_QUERY_REFUSED', 'Ask for a kind, and one date or a from date with a number of days.');
        }
        const input = {
          kind: query.kind,
          resource: query.resource ?? 'any',
          isPublic: true,
          excludePk: query.exclude === undefined ? null : await claimedRowKey(ok, found.db, found.table, query.exclude),
          now: new Date(),
        };
        const minutes = await kindMinutes(booking, target, query.kind);
        if (oneDay) {
          const slots = minutes === null ? [] : (await bookingSlots(booking, target, query.date!, minutes, input)).slots;
          return reply.send({ data: slots });
        }
        const days =
          minutes === null
            ? Array.from({ length: query.days! }, (_, i) => ({ date: addCalendarDays(query.from!, i), open: 0, state: 'closed' as const }))
            : await bookingDays(booking, target, query.from!, query.days!, minutes, input);
        return reply.send({ data: days });
      },
    );

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
          canReadPii: readsOwnPii(found.resource, ok.session),
          dialect: found.dialect,
          // Never null: the key condition is always there.
          mandatory: combinePredicates(found.predicate, keyFilter) ?? keyFilter,
          exposeColumns: found.resource.expose,
          searchColumns: found.resource.searchable,
        });
        const row = result.data[0];
        if (row === undefined) return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');

        await touchKey(ok.key.keyId);
        return reply.send({ data: wallTimesAsInstants(row, found.table.columns, found.dialect) });
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
            403: publicErrorReply,
            404: publicErrorReply,
            409: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-write', { proof: 'create' });
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
        // A signed-in person may hold only so many open rows: a found session
        // cannot fill someone's diary in their name.
        if ((await openRowsFull(found, ok.session)) === true) {
          return fail(reply, 409, 'PUBLIC_LIMIT_REACHED', 'You already have as many of these as can be made online.');
        }
        // A create nobody signed in for: a name that is only a name, and so
        // many a day per phone number or address and an hour per key.
        const caps = found.resource.anonymous;
        let release: (() => Promise<void>) | null = null;
        if (caps !== null && (ok.session === null || found.resource.claim === null)) {
          const column = notPlain(caps, values);
          if (column !== null) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That can hold letters, spaces and ordinary punctuation only.', { column });
          }
          const charge = await chargeAnonymous(challenges, {
            caps,
            key: capSecret,
            keyId: ok.key.keyId,
            connectionId: ok.key.connectionId,
            table: found.table.id,
            ref: request.params.ref,
            values,
            now: Date.now(),
          });
          if (!charge.ok) return fail(reply, 409, 'PUBLIC_LIMIT_REACHED', 'As many of these as can be made online have been made. Please get in touch instead.');
          release = charge.release;
        }

        const target: WriteTarget = {
          connectionId: ok.key.connectionId,
          view: found.view,
          table: found.table,
          db: found.db,
          dialect: found.dialect,
          // The venue's clock is the key's scope's, as for every public date.
          timezone: ok.key.scope.timezone,
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
          // Nothing was made: what the caps counted for it is taken back.
          await release?.();
          if (error instanceof PublicWriteRefused) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.', error.params);
          }
          if (error instanceof PublicSlotRefused) return fail(reply, 409, error.code, error.message);
          if (error instanceof HookRejectedError) return fail(reply, 400, 'PUBLIC_WRITE_REJECTED', error.message);
          throw error;
        }

        // The guest's confirmation, when the endpoint sends one. Queued, never
        // awaited on SMTP, and never a reason to fail the booking just made.
        const confirm = found.resource.confirm === null ? null : publicConfirmSchema.safeParse(found.resource.confirm);
        if (confirm?.success === true) {
          await sendConfirmation({
            meta,
            request,
            confirm: confirm.data,
            row: inserted,
            db: found.db,
            table: found.table,
            timezone: ok.key.scope.timezone,
            appKey: ok.key.managedBy,
          });
        }

        // Only the exposed columns come back — a create must not return more
        // than a read of the same row would.
        const projected: Record<string, unknown> = {};
        for (const column of found.resource.expose) projected[column] = inserted[column];
        const rank = await rankOf(found, inserted);
        return reply
          .status(201)
          .send({ data: wallTimesAsInstants(projected, found.table.columns, found.dialect), ...(rank === null ? {} : { rank }) });
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
         * never allowed to touch. So both go into one statement — and so does
         * the state the row must be in (`writable_when`): a visit already seen
         * matches nothing, and is not changed.
         */
        const now = new Date();
        const predicate = combinePredicates(found.predicate, updatableState(found.resource, found.table, now));
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
          // The venue's clock is the key's scope's, as for every public date.
          timezone: ok.key.scope.timezone,
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
            announce: async ({ before, after }) => {
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
                // The before-image is read only when something needs it (a hook,
                // a decided column, a table an app's email watches for a change),
                // and then inside the scope; the UPDATE still carries the
                // predicate itself. A rule's `when` evaluates on the after
                // image, which is what it evaluates on for every other origin.
                before,
                after,
                origin: 'public',
              });
            },
          });
        } catch (error) {
          if (error instanceof PublicWriteRefused) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.', error.params);
          }
          if (error instanceof PublicSlotRefused) return fail(reply, 409, error.code, error.message);
          if (error instanceof HookRejectedError) return fail(reply, 400, 'PUBLIC_WRITE_REJECTED', error.message);
          throw error;
        }

        // Zero rows means "no such record" whether it does not exist, is out of
        // scope, or belongs to somebody else. One answer for all three — and
        // for a row in any other state. The one exception is the caller's own
        // row that only its time window refused: that is told when it opens.
        if (outcome.count === 0) {
          const early = await tooEarlyFor(found, pk, now);
          if (early !== null) return fail(reply, 409, 'PUBLIC_TOO_EARLY', 'Too early for this change; `at` is the time it waits for.', early);
          return fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such record.');
        }

        const projected: Record<string, unknown> = {};
        for (const column of found.resource.expose) projected[column] = outcome.after?.[column];
        return reply.send({ data: wallTimesAsInstants(projected, found.table.columns, found.dialect) });
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
            409: publicErrorReply,
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
            409: publicErrorReply,
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
          // The venue's clock is the key's scope's, as for every public date.
          timezone: ok.key.scope.timezone,
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
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.', error.params);
          }
          if (error instanceof PublicSlotRefused) return fail(reply, 409, error.code, error.message);
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
            403: publicErrorReply,
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
        // A proved resource takes its creates one at a time, each with its proof:
        // one proof must not buy a batch of rows.
        if (resource.humanCheck && ok.key.kind === 'browser' && !proofExcused(resource, ok.session) && rows.some((raw) => table.primaryKey.every((c) => !Object.prototype.hasOwnProperty.call(raw, c)))) {
          return fail(reply, 403, 'PUBLIC_PROOF_REQUIRED', 'Rows here are created one at a time.');
        }
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

        // Only updates are in this batch's WHERE: the state a row must be in joins the scope there.
        const predicate = combinePredicates(found.predicate, updatableState(resource, table));
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
          timezone: ok.key.scope.timezone,
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
          // A table whose rows each hold a time slot takes them one at a time.
          if (error instanceof GuardedBatchError) return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That write was refused.');
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
              const count = await updateRows(tdb, found.dialect, table, row.values, pk, inScope);
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
        const ok = await gate(request, reply, 'public-claim', { proof: 'claim' });
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
          view: found.view,
          dialect: found.dialect,
        });
        // ONE code for no match, several matches, a missing factor and an extra
        // one. Anything finer turns a two-factor check into two one-factor ones.
        if (grant === null) {
          return fail(reply, 403, 'PUBLIC_CLAIM_NO_MATCH', 'That did not match.');
        }

        const minted = generatePublicSessionToken();
        // At a kiosk, one patient after another: a found session lasts minutes, not half an hour.
        const expiresAt = Date.now() + (ok.key.requiresStaff !== null ? KIOSK_SESSION_TTL_MS : CLAIM_SESSION_TTL_MS);
        await sessions.create({
          keyId: ok.key.keyId,
          tokenHash: minted.tokenHash,
          grants: JSON.stringify(grant),
          expiresAt,
          // The person, by their row: what ends every session of theirs when their address changes.
          subject: subjectOf(ok.key.connectionId, found.table.id, grant.column, grant.value),
        });
        await auditWrite(request, ok, 'public.claim', { ref: claim.ref });
        return reply.send({ data: { session: minted.token, expiresAt } });
      },
    );

    /* ------------------------------------------------------ the emailed code */

    /**
     * The found person's own row, read through the identity: exactly one, or
     * a refusal already sent. Only for a key whose claim sends a code, and a
     * session claimed through that identity.
     */
    const claimedPerson = async (
      request: FastifyRequest,
      reply: FastifyReply,
      ok: { key: ResolvedKey; session: PublicSessionContext | null },
    ) => {
      const claim = ok.key.scope.claim;
      const session = ok.session;
      if (claim === null || claim === undefined || claim.verify === undefined || claim.email === undefined) {
        fail(reply, 403, 'PUBLIC_CLAIM_UNAVAILABLE', 'This key does not support claims.');
        return null;
      }
      if (session === null || session.grant.ref !== claim.ref) {
        fail(reply, 404, 'PUBLIC_REF_NOT_FOUND', 'No such resource.');
        return null;
      }
      const found = await resolveResource(request, reply, ok, claim.ref, 'read', { bypassClaimGate: true });
      if (found === null) return null;
      // Two rows under one value would let one mailbox open another person's record.
      const rows = (await found.db
        .selectFrom(found.table.id)
        .selectAll()
        .where((eb) => eb(found.db.dynamic.ref(session.grant.column), '=', session.grant.value))
        .limit(2)
        .execute()) as Row[];
      const row = rows.length === 1 ? (rows[0] as Row) : null;
      return {
        found,
        session,
        claim: { ...claim, email: claim.email },
        row,
        subject: subjectOf(ok.key.connectionId, found.table.id, session.grant.column, session.grant.value),
      };
    };

    app.options('/public/claim/code', { schema: { hide: true } }, preflight);
    app.options('/public/claim/verify', { schema: { hide: true } }, preflight);

    app.post(
      '/public/claim/code',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          body: publicCodeBody,
          response: {
            200: publicCodeReply,
            400: publicErrorReply,
            401: publicErrorReply,
            403: publicErrorReply,
            404: publicErrorReply,
            409: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-code');
        if (ok === null) return reply;
        const person = await claimedPerson(request, reply, ok);
        if (person === null) return reply;
        const { session, subject, row } = person;
        const now = Date.now();
        const body = request.body;
        const current = row === null ? null : row[person.claim.email];

        if (body.purpose === 'email-change') {
          if (session.level !== 'verified') return fail(reply, 403, 'PUBLIC_CLAIM_LEVEL', 'Confirm the code we emailed you first.');
          // A session lifted by someone else must not move the address: a code confirmed minutes ago, or none of this.
          if (!(await challenges.markedSince(session.id, 'verified', now - STEP_UP_MS))) {
            return fail(reply, 403, 'PUBLIC_CODE_STEP_UP', 'Confirm a new code first.');
          }
          if (!plausibleAddress(body.email) || (typeof current === 'string' && current.trim().toLowerCase() === body.email.trim().toLowerCase())) {
            return fail(reply, 400, 'PUBLIC_WRITE_REFUSED', 'That address cannot be used.');
          }
          if ((await challenges.sentSince(subject, now - DAY_MS, 'email-changed')) >= EMAIL_CHANGES_DAY) {
            return fail(reply, 429, 'PUBLIC_EMAIL_CHANGE_LIMIT', 'The address was changed today already.');
          }
        }
        const address = body.purpose === 'verify' ? current : body.email;
        if (row === null || !plausibleAddress(address)) return fail(reply, 409, 'PUBLIC_CLAIM_NO_EMAIL', 'There is no address to send a code to.');

        // The person's own lock first: too many wrong codes today.
        if ((await challenges.failuresSince(subject, now - DAY_MS)) >= PERSON_FAILURES_DAY) {
          return fail(reply, 403, 'PUBLIC_CLAIM_LOCKED', 'Too many tries today. Ring the desk.');
        }
        const newest = await challenges.newestFor(session.id, body.purpose);
        if (newest !== null && newest.attempts >= CODE_TRIES && now - (newest.consumedAt ?? newest.createdAt) < CODE_LOCK_MS) {
          const retryAfter = Math.ceil((CODE_LOCK_MS - (now - (newest.consumedAt ?? newest.createdAt))) / 1000);
          return fail(reply, 429, 'PUBLIC_CODE_LOCKED', 'Too many tries. Wait a little, or ring the desk.', { retryAfter });
        }
        if (newest !== null && now - newest.createdAt < CODE_RESEND_MS) {
          return fail(reply, 429, 'PUBLIC_CODE_TOO_SOON', 'A code was sent a moment ago.', {
            retryAfter: Math.ceil((CODE_RESEND_MS - (now - newest.createdAt)) / 1000),
          });
        }
        if ((await challenges.countForSession(session.id)) >= CODES_PER_SESSION) {
          return fail(reply, 429, 'PUBLIC_CODE_LIMIT', 'No more codes can be sent here. Ring the desk.');
        }
        const sessionRow = await sessions.findById(session.id);
        const expiresAt = Math.min(now + CODE_TTL_MS, sessionRow?.expiresAt ?? now + CODE_TTL_MS);
        const answer = { data: { sentTo: maskAddress(address), resendAfter: CODE_RESEND_MS / 1000, expiresAt } };

        // Per person, across every session and key: over the cap the answer is
        // the same and nothing is sent, so a stranger learns nothing from it.
        const sent = async (since: number) =>
          (await challenges.sentSince(subject, since, 'verify')) + (await challenges.sentSince(subject, since, 'email-change'));
        if ((await sent(now - 15 * 60_000)) >= PERSON_CODES_15M || (await sent(now - DAY_MS)) >= PERSON_CODES_DAY) {
          await auditWrite(request, ok, 'public.claim.code.held', { ref: person.claim.ref, purpose: body.purpose });
          return reply.send(answer);
        }

        const code = newCode();
        const created = await challenges.create(
          {
            keyId: ok.key.keyId,
            ref: person.claim.ref,
            destinationHash: hashAddress(addressSecret, address),
            codeHash: hashCode(codeSecret, codeBinding({ sessionId: session.id, purpose: body.purpose, createdAt: now }), code),
            expiresAt,
            sessionId: session.id,
            purpose: body.purpose,
            newDestinationEnc: body.purpose === 'email-change' ? addressCrypto.encrypt(body.email.trim()) : null,
            subject,
          },
          now,
        );
        const locale = negotiateLocale(request.headers['accept-language']) ?? (await recipientLocale(meta, null));
        const queued = await enqueueEmail(
          { meta, logger: request.log },
          {
            to: address.trim(),
            templateKey: SIGN_IN_CODE_TEMPLATE_KEY,
            locale,
            vars: { appName: (await senderOf(ok.key)).appName, code, minutes: String(CODE_TTL_MS / 60_000) },
          },
        );
        // Nothing can be sent (no mail set up, the template switched off): the
        // code dies here rather than leaving someone typing at nothing.
        if (queued === null) {
          await challenges.consume(created.id);
          return fail(reply, 503, 'PUBLIC_CODE_UNAVAILABLE', 'A code cannot be sent right now. Ring the desk.');
        }
        await auditWrite(request, ok, 'public.claim.code', { ref: person.claim.ref, purpose: body.purpose });
        return reply.send(answer);
      },
    );

    app.post(
      '/public/claim/verify',
      {
        config: { rateLimitBucket: 'public', audit: audited('rbac') },
        schema: {
          body: publicVerifyBody,
          response: {
            200: publicVerifyReply,
            401: publicErrorReply,
            403: publicErrorReply,
            404: publicErrorReply,
            410: publicErrorReply,
            429: publicErrorReply,
            503: publicErrorReply,
          },
        },
      },
      async (request, reply) => {
        const ok = await gate(request, reply, 'public-code');
        if (ok === null) return reply;
        const person = await claimedPerson(request, reply, ok);
        if (person === null) return reply;
        const { session, subject, row, found } = person;
        const now = Date.now();
        const purpose = request.body.purpose;
        if ((await challenges.failuresSince(subject, now - DAY_MS)) >= PERSON_FAILURES_DAY) {
          return fail(reply, 403, 'PUBLIC_CLAIM_LOCKED', 'Too many tries today. Ring the desk.');
        }
        const open = await challenges.findOpen(session.id, purpose, now);
        if (open === null) return fail(reply, 410, 'PUBLIC_CODE_EXPIRED', 'That code has expired. Ask for a new one.');
        // Charged before it is compared (`tryCode`): guesses in flight together get five compares between them.
        const tried = await tryCode(challenges, open, request.body.code, codeSecret, now);
        if (tried.outcome === 'expired') return fail(reply, 410, 'PUBLIC_CODE_EXPIRED', 'That code has expired. Ask for a new one.');
        if (tried.outcome === 'wrong') return fail(reply, 403, 'PUBLIC_CODE_WRONG', 'That code isn’t right.', { triesLeft: tried.triesLeft });

        if (purpose === 'verify') {
          const expiresAt = now + VERIFIED_TTL_MS;
          if (!(await sessions.raise(session.id, 'verified', expiresAt, now))) {
            return fail(reply, 410, 'PUBLIC_CODE_EXPIRED', 'This session has ended. Start again.');
          }
          await challenges.mark({ keyId: ok.key.keyId, ref: person.claim.ref, sessionId: session.id, subject, purpose: 'verified' }, now);
          await auditWrite(request, ok, 'public.claim.verified', { ref: person.claim.ref });
          return reply.send({ data: { level: 'verified' as const, expiresAt } });
        }

        // An address change: once a day, and the old address always hears of it.
        if (row === null || session.level !== 'verified' || open.newDestinationEnc === null) {
          return fail(reply, 410, 'PUBLIC_CODE_EXPIRED', 'That code has expired. Ask for a new one.');
        }
        if ((await challenges.sentSince(subject, now - DAY_MS, 'email-changed')) >= EMAIL_CHANGES_DAY) {
          return fail(reply, 429, 'PUBLIC_EMAIL_CHANGE_LIMIT', 'The address was changed today already.');
        }
        if (!(await isEmailConfigured(meta, null))) {
          return fail(reply, 503, 'PUBLIC_CODE_UNAVAILABLE', 'The address cannot be changed right now. Ring the desk.');
        }
        const oldAddress = row[person.claim.email];
        const newAddress = addressCrypto.decrypt(open.newDestinationEnc);
        const pk = Object.fromEntries(found.table.primaryKey.map((column) => [column, row[column]]));
        const target: WriteTarget = {
          connectionId: ok.key.connectionId,
          view: found.view,
          table: found.table,
          db: found.db,
          dialect: found.dialect,
          timezone: ok.key.scope.timezone,
        };
        await writes.update({
          target,
          pk,
          values: { [person.claim.email]: newAddress },
          context: publicWriteContext(request, ok.key.keyId),
          mapError: refuseWrite,
          announce: async () => {
            // Named by the row, never by the address.
            await auditWrite(request, ok, 'public.claim.email-changed', { ref: person.claim.ref }, {
              connectionId: ok.key.connectionId,
              table: found.table.id,
              pk,
              label: pkLabel(found.table, pk),
            });
            invalidateWidgetData(app, ok.key.connectionId, found.table.id);
          },
        });
        await challenges.mark({ keyId: ok.key.keyId, ref: person.claim.ref, sessionId: session.id, subject, purpose: 'email-changed' }, now);
        const locale = negotiateLocale(request.headers['accept-language']) ?? (await recipientLocale(meta, null));
        if (plausibleAddress(oldAddress)) {
          const from = await senderOf(ok.key);
          // The closing line in the recipient's language: the practice's number when it has one.
          const lines = emailChangedLines((await translatorForLocale(meta, locale)).t, from.phone);
          await enqueueEmail(
            { meta, logger: request.log },
            {
              to: oldAddress.trim(),
              templateKey: EMAIL_CHANGED_TEMPLATE_KEY,
              locale,
              always: true,
              vars: {
                appName: from.appName,
                // The identity shows its person by its first column (a name).
                name: String(row[found.resource.expose[0] ?? ''] ?? ''),
                newEmail: maskAddress(newAddress),
                ...lines,
              },
            },
          );
        }
        // Every session of theirs ends, this one too: whoever else held one
        // must find them again, and so does the page (the reply says it ended).
        await sessions.removeBySubject(subject);
        return reply.send({ data: { level: 'lookup' as const, expiresAt: now, email: maskAddress(newAddress) } });
      },
    );


    /* ------------------------------------------------------------ human check */

    app.options('/public/challenge', { schema: { hide: true } }, preflight);

    app.get(
      '/public/challenge',
      {
        config: { rateLimitBucket: 'public' },
        schema: {
          querystring: publicChallengeQuery,
          response: { 200: publicChallengeReply, 400: publicErrorReply, 401: publicErrorReply, 429: publicErrorReply, 503: publicErrorReply },
        },
      },
      async (request, reply) => {
        // Handed out for nothing: counted per visitor, never against the whole key.
        const ok = await gate(request, reply, 'public-read', { keyWide: false });
        if (ok === null) return reply;
        return reply.send({ data: issueChallenge(proofSecret, ok.key.keyId, request.query.purpose, Date.now()) });
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
            combinePredicates(mandatoryAt(resource.where, table, ok.key.scope.timezone), claim.predicate),
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
