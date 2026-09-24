// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminiumjs/public-client` — the browser client for Adminium's scoped public
 * API.
 *
 * ── ZERO DEPENDENCIES, ON PURPOSE ──────────────────────────────────────────
 * This ships inside fifteen separate app bundles, every one of them a static
 * SPA with its own budget. A validation library here would be paid for fifteen
 * times over to re-check a shape the server already guarantees. `fetch`, and
 * nothing else.
 *
 * ── IT RETURNS null RATHER THAN THROWING WHEN THERE IS NO SERVER ───────────
 * `createPublicClient` returns `null` when the base URL or key is absent, so a
 * demo build takes the fallback branch STRUCTURALLY rather than through a
 * catch. The hosted marketplace demos are static clones with nothing behind
 * them and must keep working byte-identically; a client that throws on a
 * missing env var would break every one of them.
 *
 * ── TIME IS THE TENANT'S, NEVER THE READER'S ───────────────────────────────
 * `toTenantDay` and `toTenantMinutes` exist because the alternative — the
 * obvious `new Date(value).getHours()` — reads the VISITOR's clock. A booking
 * made at 15:00 in London renders at 16:00 for a visitor in Berlin, silently.
 * That bug was found in a real browser, not in a test, which is why these are
 * the only supported way to turn an API timestamp into a day and a time.
 */

/* --------------------------------------------------------------- errors */

/**
 * Every code the surface can emit. Mirrors the server's own list, so an
 * unhandled code is a TypeScript error in the app rather than a surprise at
 * runtime.
 *
 * Several are deliberately indistinguishable from one another — an unknown
 * resource and a forbidden one answer identically — so do not build UI that
 * tries to tell those apart.
 */
export const PUBLIC_ERROR_CODES = [
  'PUBLIC_API_DISABLED',
  'PUBLIC_KEY_INVALID',
  'PUBLIC_REF_NOT_FOUND',
  'PUBLIC_ACTION_NOT_ALLOWED',
  'PUBLIC_QUERY_REFUSED',
  'PUBLIC_RATE_LIMITED',
  'PUBLIC_ORIGIN_REFUSED',
  'PUBLIC_CLAIM_NO_MATCH',
  'PUBLIC_CLAIM_UNAVAILABLE',
  'PUBLIC_WRITE_REFUSED',
  /**
   * The Adminium project's own code refused the write. Unlike every other
   * code, `message` here is meant for people: it is the project's own text.
   */
  'PUBLIC_WRITE_REJECTED',
  /**
   * The time a booking asks for has no room left, or another guest is booking
   * it this instant (`BUSY`: try again in a moment).
   */
  'PUBLIC_SLOT_FULL',
  'PUBLIC_SLOT_BUSY',
  /** Too close to the time to cancel online; the venue still can. */
  'PUBLIC_TOO_LATE',
  /**
   * The resource needs a VERIFIED session and this one only found the person
   * (403): ask for the emailed code with `requestCode`, then `verifyCode`.
   */
  'PUBLIC_CLAIM_LEVEL',
  /** The signed-in person already holds as many open rows here as the app allows (409). */
  'PUBLIC_LIMIT_REACHED',
  /** The app switched this off in its own settings — online booking, say (403). */
  'PUBLIC_SWITCHED_OFF',
  /**
   * A kiosk's key used without its staff member signed in on this screen
   * (403). One code for every reason, so do not try to tell them apart.
   */
  'PUBLIC_STAFF_REQUIRED',
  /** The app switched this key off — the kiosk switch (503). */
  'PUBLIC_KEY_OFF',
  /** The person has no address a code could go to (409): send them to the desk. */
  'PUBLIC_CLAIM_NO_EMAIL',
  /** Too many wrong codes for this person today (403); the desk can lift it. */
  'PUBLIC_CLAIM_LOCKED',
  /** A code was sent a moment ago (429); `retryAfterSeconds` says how long to wait. */
  'PUBLIC_CODE_TOO_SOON',
  /** This session has asked for as many codes as it may (429). */
  'PUBLIC_CODE_LIMIT',
  /** The last code died of wrong tries and this session waits (429, `retryAfterSeconds`). */
  'PUBLIC_CODE_LOCKED',
  /** That code is not right (403). `verifyCode` answers it as a result, with the tries left. */
  'PUBLIC_CODE_WRONG',
  /** No code is open for this session: it expired, was used or was replaced (410). */
  'PUBLIC_CODE_EXPIRED',
  /** No code can be sent from this server right now (503). */
  'PUBLIC_CODE_UNAVAILABLE',
  /** Changing the address needs a code confirmed in the last few minutes (403). */
  'PUBLIC_CODE_STEP_UP',
  /** The address was changed today already (429). */
  'PUBLIC_EMAIL_CHANGE_LIMIT',
  /**
   * The human check is missing, wrong, expired or already used (403). The
   * client answers it itself on `create` and `claim` — once — so a page only
   * sees it when a fresh proof was refused too.
   */
  'PUBLIC_PROOF_REQUIRED',
  'PUBLIC_UPSTREAM_UNAVAILABLE',
  /**
   * The app that made this key at install is switched off (503), or its
   * customer side is. Nothing is wrong with the key or the request; it
   * answers again once the app is switched back on.
   */
  'APP_DISABLED',
  'SURFACE_OFF',
  /** Not from the server: the network never answered. */
  'PUBLIC_NETWORK_UNAVAILABLE',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

/**
 * A failed request.
 *
 * `code` is the contract; render your own copy from it. `message` is a
 * developer string from the server and is explicitly NOT for display — the wire
 * carries no translatable prose, which is what keeps the localization story
 * free rather than deferred.
 */
export class PublicApiError extends Error {
  readonly code: PublicErrorCode;
  readonly status: number;
  /**
   * How long to wait before asking again: the `Retry-After` header on a rate
   * limit, or the reply's own `retryAfter` on a code asked for too soon.
   */
  readonly retryAfterSeconds: number | null;
  /** What the server said beside the code — `triesLeft`, `retryAfter`. Empty when it said nothing. */
  readonly params: Readonly<Record<string, unknown>>;

  constructor(
    code: PublicErrorCode,
    status: number,
    message: string,
    retryAfterSeconds?: number,
    params?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PublicApiError';
    this.code = code;
    this.status = status;
    this.params = params ?? {};
    const told = this.params['retryAfter'];
    this.retryAfterSeconds = retryAfterSeconds ?? (typeof told === 'number' ? told : null);
  }

  /**
   * True when retrying later could plausibly work.
   *
   * `PUBLIC_API_DISABLED` is deliberately NOT here. The operator turned the
   * surface off; the server is answering correctly and a retry loop just
   * hammers it. Use `isDisabled` and fall back to demo content instead.
   */
  get isTransient(): boolean {
    return (
      this.code === 'PUBLIC_RATE_LIMITED' ||
      this.code === 'PUBLIC_SLOT_BUSY' ||
      this.code === 'PUBLIC_UPSTREAM_UNAVAILABLE' ||
      this.code === 'PUBLIC_NETWORK_UNAVAILABLE'
    );
  }

  /** True when the surface is off — the signal to fall back to demo content. */
  get isDisabled(): boolean {
    return this.code === 'PUBLIC_API_DISABLED';
  }
}

/* ---------------------------------------------------------------- types */

export type PublicSide = 'staff' | 'customer';
/**
 * What a key may do to a ref. `replace`, `delete` and `batch` arrived with
 * PUT, DELETE and `POST …/batch`; an older server never sends
 * them.
 */
export type PublicAction = 'read' | 'create' | 'update' | 'replace' | 'delete' | 'batch';

/**
 * How the LIST route answers for a ref. `wrapped` is the
 * original `{ data, page, cursor }`; `array` is the bare rows with the next
 * cursor in `X-Next-Cursor`; `single` is exactly one row. `list()` hands every
 * one of them back as a {@link ListResult}, so an app never branches on it.
 */
export type PublicResponseShape = 'wrapped' | 'array' | 'single';

export interface PublicRefConfig {
  actions: PublicAction[];
  expose: string[];
  filterable: string[];
  searchable: string[];
  orderable: string[];
  writable: string[];
  limit: number;
  /** Absent from a server that predates response shapes: read it as `wrapped`. */
  response?: { shape: PublicResponseShape };
  /** Present on an availability ref: ask `availability` or `bookingTimes`, never `list`. */
  kind?: 'availability';
}

export interface PublicConfig {
  version: 1;
  side: PublicSide;
  /** IANA zone. Build every day and time from this, never from the browser. */
  timezone: string;
  /**
   * ISO-4217, or null when this scope serves no money.
   *
   * A `money` column arrives as a bare decimal string (`"45.00"`) with no
   * currency attached, so formatting one without this is a guess.
   */
  currency: string | null;
  claim: {
    strategy: 'lookup' | 'email-code' | 'external';
    ref: string;
    match: string[];
    /** A found session can be raised to `verified` by a code emailed to the person. */
    verify?: 'email-code';
  } | null;
  /**
   * Whether this key may ask for a document to be drawn.
   *
   * A capability, so a page can decide whether to OFFER "email me a copy"
   * rather than discovering the refusal by being refused. Optional on the type
   * because no server up to and including 0.3.0-rc.2 sends it — the reply
   * schema did not declare it, so the serializer stripped it even on servers
   * that computed it — and an app compiled against this client must keep
   * working against one. Treat absent as "not offered".
   */
  documents?: { create: boolean };
  refs: Record<string, PublicRefConfig>;
}

export type Row = Record<string, unknown>;

export interface ListResult<T = Row> {
  data: T[];
  page?: { limit: number; offset: number; total: number | null };
  cursor?: { next: string | null };
}

/** The filter grammar, narrowed to what the public surface accepts. */
export type FilterOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'like' | 'ilike' | 'is_null' | 'not_null' | 'between';

export type PublicFilter =
  | { column: string; op: FilterOp; value?: unknown }
  | { and: PublicFilter[] }
  | { or: PublicFilter[] };

export interface ListOptions {
  where?: PublicFilter;
  q?: string;
  order?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface PublicClientOptions {
  baseUrl: string;
  publishableKey: string;
  /** Injectable for tests; `globalThis.fetch` otherwise. */
  fetch?: typeof fetch;
  /**
   * The human check on `create` and `claim`.
   *
   * Absent, the client answers the server: it sends without a proof and, when
   * refused for want of one, solves a challenge and sends again. `true` solves
   * one before every create and claim — a page that knows its refs ask saves
   * the refused round trip. `false` never solves one, and the refusal reaches
   * the page as `PUBLIC_PROOF_REQUIRED`. The object form names what is known
   * to ask, and answers the server for the rest.
   */
  humanCheck?: boolean | { refs?: readonly string[]; claim?: boolean };
  /**
   * The signed-in staff member's CSRF token, for a key bound to staff (a
   * kiosk). Sent on every write, never on a read.
   *
   * A kiosk page reads both halves from its staff `surface-config.json`: the
   * token from `csrfToken`, and the key from `publicKeys[purpose]` as
   * `publishableKey`. A getter is read on each request, so a token that
   * changes with a new sign-in is picked up without a new client.
   *
   * The key's other condition is the staff cookie, which a same-origin fetch
   * sends by default: this client never sets `credentials`, and must not.
   */
  csrfToken?: string | (() => string | null | undefined);
}

/** How far a claim session reaches: `lookup` found the person, `verified` proved their mailbox. */
export type ClaimLevel = 'lookup' | 'verified';

/** The claim session a client holds, without its token. */
export interface PublicSession {
  level: ClaimLevel;
  /** Epoch ms. */
  expiresAt: number;
}

/** A day of a strip of days, as a booking availability ref answers it. */
export interface DayAvailability {
  /** `YYYY-MM-DD` on the tenant's calendar. */
  date: string;
  /** How many of the day's times are free. */
  open: number;
  state: 'open' | 'full' | 'closed';
}

/** What a booking availability read asks, whichever form. */
export interface BookingQuery {
  /** The kind of visit — its key, as the table knows it. */
  kind: string;
  /** One person's key, or `any` (the default). */
  resource?: string;
  /**
   * The id of a row this session reaches — the visit being moved — so its
   * own time is not counted against it. Ignored for a row the session cannot
   * read, so it tells a stranger nothing.
   */
  exclude?: string;
}

/**
 * What `requestCode` asks for. `verify` goes to the address the person
 * already has; `email-change` goes to the NEW address, and needs a verified
 * session that confirmed a code in the last few minutes.
 */
export type CodeRequest = { purpose: 'verify' } | { purpose: 'email-change'; email: string };

/** A code is on its way. */
export interface CodeSent {
  /** The address, masked (`l•••@e•••.com`): show it so the person knows where to look. */
  sentTo: string;
  /** Seconds before another code may be asked for. */
  resendAfter: number;
  /** Epoch ms after which this code no longer works. */
  expiresAt: number;
}

/**
 * The answer to a typed-back code.
 *
 * A wrong code is an ordinary outcome, like a claim that does not match, so it
 * is a result rather than an exception. `ended` is true after an address
 * change: every session of that person ends, this one too, and the client has
 * already dropped it — the page asks them to find themselves again.
 */
export type VerifyCodeResult =
  | { ok: true; level: ClaimLevel; expiresAt: number; ended: boolean; email?: string }
  | { ok: false; triesLeft: number };

/** A created row, and where it stands when the endpoint ranks ("you are 3rd on the list"). */
export interface Created<T = Row> {
  data: T;
  /** Null when the endpoint does not rank. */
  rank: number | null;
}

/** One drawn document, as a claimed visitor may see it. */
export interface PublicDocument {
  id: string;
  kind: string;
  number: string | null;
  status: string;
  /**
   * `pending-review` on an intent the visitor asked for: nothing is emailed
   * unattended, so a page should say "we will send this shortly" rather than
   * "sent".
   */
  delivery: string | null;
  format: string;
  locale: string;
  createdAt: number;
  hasContent: boolean;
}

export interface PublicDocuments {
  /** Every document this claim reaches. Empty without a claim, never an error. */
  list: (signal?: AbortSignal) => Promise<PublicDocument[]>;
  get: (id: string, signal?: AbortSignal) => Promise<PublicDocument>;
  /**
   * Ask for one to be drawn — from a row this claim reaches, or from values.
   *
   * The VALUES form never sets the letterhead, the clock, the currency or the
   * number: the server stamps all four, which is what stops the door being a
   * way to put a stranger's text under the operator's name.
   */
  render: (
    input:
      | { profileId: string; ref: string; id: string | number; locale?: string }
      | {
          kind: string;
          locale?: string;
          fields: Record<string, unknown>;
          collections: Record<string, Record<string, unknown>[]>;
        },
  ) => Promise<PublicDocument>;
  /**
   * Send a copy to the address this session was claimed with.
   *
   * Takes NO address, and that is the point: the visitor decides whether, never
   * where. An address in the request would make this a way to send somebody
   * else's document anywhere.
   */
  email: (id: string) => Promise<PublicDocument>;
  /** The same-origin bytes URL — an `<a download>`, never an `<iframe>`. */
  contentUrl: (id: string) => string;
}

/* --------------------------------------------------------------- client */

const SESSION_HEADER = 'x-adminium-public-session';
const PROOF_HEADER = 'x-adminium-proof';
/** The staff member's token on a kiosk's writes — the dashboard's own CSRF header. */
const CSRF_HEADER = 'x-adminium-csrf';
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Where a claim that asked for a proof is remembered — a symbol, so no ref name can be it. */
const CLAIM = Symbol('claim');

/** One time of a day, as an availability ref answers it. */
export interface SlotAvailability {
  /** `HH:mm` on the tenant's clock; {@link fromTenantLocal} turns it into the instant to book. */
  time: string;
  state: 'free' | 'full';
}

export interface PublicClient {
  /** The scope, fetched once and cached. */
  config: () => Promise<PublicConfig>;
  list: <T = Row>(ref: string, options?: ListOptions) => Promise<ListResult<T>>;
  get: <T = Row>(ref: string, id: string, signal?: AbortSignal) => Promise<T>;
  create: <T = Row>(ref: string, values: Row) => Promise<T>;
  /**
   * `create`, with where the new row stands. Its own verb so that `create`
   * keeps answering the bare row every app already reads.
   */
  createWithRank: <T = Row>(ref: string, values: Row) => Promise<Created<T>>;
  update: <T = Row>(ref: string, id: string, values: Row) => Promise<T>;
  /**
   * Replace the row's writable columns — every one of them must be present (a
   * nullable one may be `null`). PUT, where `update` is PATCH.
   */
  replace: <T = Row>(ref: string, id: string, values: Row) => Promise<T>;
  /** Delete the row with this primary key. A row outside the scope is the same 404 as a missing one. */
  remove: (ref: string, id: string) => Promise<void>;
  /**
   * Write 1–500 rows in one transaction: all of them, or none. A row without
   * its primary key is inserted; a row with its whole key updates that row.
   */
  batch: (ref: string, rows: Row[]) => Promise<{ count: number }>;
  /**
   * Which of a day's times have room for a party, from an availability ref:
   * `HH:mm` on the tenant's clock, free or full, and nothing more. A claimed
   * visitor's own booking is not counted against them.
   */
  availability: (ref: string, day: string, party: number, signal?: AbortSignal) => Promise<SlotAvailability[]>;
  /**
   * The times of one day, from an availability ref on a BOOKING table (a
   * clinic): a kind of visit, with one person or anyone.
   */
  bookingTimes: (ref: string, query: BookingQuery & { date: string }, signal?: AbortSignal) => Promise<SlotAvailability[]>;
  /** A strip of up to 31 days from `from`, each open, full or closed, from the same ref. */
  bookingDays: (
    ref: string,
    query: BookingQuery & { from: string; days: number },
    signal?: AbortSignal,
  ) => Promise<DayAvailability[]>;
  /** Identify the visitor. Returns false when the details did not match. */
  claim: (match: Record<string, unknown>) => Promise<boolean>;
  /** Email the claimed person a code — to raise the session, or to confirm a new address. */
  requestCode: (request: CodeRequest) => Promise<CodeSent>;
  /**
   * Type the code back. On success the session the client holds takes the new
   * level and expiry; after an address change it is dropped (see
   * {@link VerifyCodeResult}).
   */
  verifyCode: (input: { purpose?: CodeRequest['purpose']; code: string }) => Promise<VerifyCodeResult>;
  signOut: () => Promise<void>;
  /** Is a claim session currently held? */
  isClaimed: () => boolean;
  /** The claim session held, or null. */
  session: () => PublicSession | null;
  /**
   * The documents this visitor may see and ask for.
   *
   * Every verb here needs a CLAIM: a document belongs either to the intent the
   * visitor asked for or to a row their claim reaches, and an unclaimed caller
   * sees an empty list rather than a refusal. `render` additionally needs the
   * key's `documents.create` flag, which `config()` reports.
   */
  documents: PublicDocuments;
  /**
   * Assert the live scope carries what this app needs.
   *
   * Call it at boot. An operator can narrow a scope at any time, and the
   * failure that produces is a 403 in production on a page nobody was looking
   * at. This turns it into a legible startup error naming exactly what is
   * missing.
   */
  assertRefs: (required: Record<string, string[]>) => Promise<void>;
}

const WRAPPED_KEYS = new Set(['data', 'page', 'cursor']);

/**
 * Every list shape as one {@link ListResult}, read off the
 * reply itself so that it costs no `/config` request and works against a
 * server that predates shapes:
 * - a bare array is `array`, its next cursor in `X-Next-Cursor`;
 * - `{ data: [...] }` with nothing beyond `page` / `cursor` is `wrapped`;
 * - any other object is the one row of a `single` endpoint.
 */
function asListResult<T>(body: unknown, headers: Headers): ListResult<T> {
  if (Array.isArray(body)) return { data: body as T[], cursor: { next: headers.get('x-next-cursor') } };
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record['data']) && Object.keys(record).every((k) => WRAPPED_KEYS.has(k))) {
      return body as ListResult<T>;
    }
    return { data: [body as T] };
  }
  return { data: [] };
}

/**
 * Build a client, or `null` when this build has no server to talk to.
 *
 * The `null` is the demo-mode branch and it is deliberate — see the header.
 */
export function createPublicClient(
  options: Partial<PublicClientOptions> | undefined,
): PublicClient | null {
  const baseUrl = options?.baseUrl?.replace(/\/+$/, '');
  const key = options?.publishableKey;
  if (baseUrl === undefined || baseUrl === '' || key === undefined || key === '') return null;

  const doFetch = options?.fetch ?? globalThis.fetch.bind(globalThis);
  const humanCheck = options?.humanCheck;
  const csrfToken = options?.csrfToken;
  let session: (PublicSession & { token: string }) | null = null;
  let cachedConfig: Promise<PublicConfig> | null = null;
  /** Refs that asked for a proof under the session held now, and {@link CLAIM} when a claim did. */
  const asked = new Set<string | typeof CLAIM>();

  /**
   * The only way the session changes. What asked for a proof is forgotten
   * with it: a signed-in person is excused the proof on a ref that caps what
   * they hold, so what asked of a stranger need not ask of them.
   */
  const holdSession = (next: (PublicSession & { token: string }) | null): void => {
    session = next;
    asked.clear();
  };

  /** One request, with the reply's headers — `list()` reads `X-Next-Cursor`. */
  const send = async <T>(
    path: string,
    init: RequestInit = {},
    extra: Record<string, string> = {},
  ): Promise<{ body: T; headers: Headers }> => {
    const csrf = typeof csrfToken === 'function' ? csrfToken() : csrfToken;
    const writes = init.method !== undefined && !SAFE_METHODS.has(init.method.toUpperCase());
    const headers: Record<string, string> = {
      authorization: `Bearer ${key}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session === null ? {} : { [SESSION_HEADER]: session.token }),
      // Only on a write: the server checks it only there, and a token in every
      // read is one more place for it to be logged.
      ...(writes && typeof csrf === 'string' && csrf !== '' ? { [CSRF_HEADER]: csrf } : {}),
      ...extra,
    };

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, { ...init, headers });
    } catch (cause) {
      // A refused connection, a CORS rejection, an offline device. The server
      // said nothing, so there is no code to read — supply one.
      throw new PublicApiError(
        'PUBLIC_NETWORK_UNAVAILABLE',
        0,
        `could not reach ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (!res.ok) {
      let code: PublicErrorCode = 'PUBLIC_UPSTREAM_UNAVAILABLE';
      let message = `HTTP ${String(res.status)}`;
      let params: Record<string, unknown> | undefined;
      try {
        const body = (await res.json()) as {
          error?: { code?: string; message?: string; params?: Record<string, unknown> };
        };
        const got = body.error?.code;
        if (typeof got === 'string' && (PUBLIC_ERROR_CODES as readonly string[]).includes(got)) {
          code = got as PublicErrorCode;
        }
        if (typeof body.error?.message === 'string') message = body.error.message;
        if (typeof body.error?.params === 'object' && body.error.params !== null) params = body.error.params;
      } catch {
        /* a non-JSON error body — the status is all there is */
      }
      const retry = res.headers.get('retry-after');
      throw new PublicApiError(
        code,
        res.status,
        message,
        retry === null ? undefined : Number(retry),
        params,
      );
    }
    return { body: (await res.json()) as T, headers: res.headers };
  };

  const request = async <T>(path: string, init: RequestInit = {}, extra?: Record<string, string>): Promise<T> =>
    (await send<T>(path, init, extra)).body;

  /** A challenge fetched and solved, as the header value that carries it. */
  const prove = async (purpose: ProofPurpose): Promise<string> => {
    const out = await request<{ data: ProofChallenge }>(`/api/v1/public/challenge?purpose=${purpose}`);
    return `${out.data.id}.${await solveChallenge(out.data)}`;
  };

  /** Is this create (a ref) or the claim (null) known to ask for a proof before it is sent? */
  const knownToAsk = (ref: string | null): boolean => {
    if (humanCheck === true || asked.has(ref ?? CLAIM)) return true;
    if (typeof humanCheck !== 'object') return false;
    return ref === null ? humanCheck.claim === true : (humanCheck.refs ?? []).includes(ref);
  };

  /**
   * A create or a claim, with the human check it may owe.
   *
   * Unless it is known to ask, it goes WITHOUT a proof first and answers the
   * server. That is the one choice right on every key: the config does not
   * say which refs ask, a kiosk's key is never asked, and a signed-in person
   * is excused on a ref that caps what they hold. It costs a refused round
   * trip where a proof was owed, against a second of a cheap phone's time on
   * every write where it was not. A ref that asked once solves first after
   * that, until the session changes.
   *
   * The challenge is fetched here, at the moment of sending, and never
   * earlier: it lives two minutes, and one fetched when the form opened can be
   * dead by the time the visitor presses the button.
   *
   * A refusal is retried ONCE with a fresh proof, never in a loop: a second
   * refusal is a real one — a key whose clock or secret disagrees — and
   * solving again would only spend the visitor's battery on it.
   */
  const withProof = async <T>(
    purpose: ProofPurpose,
    ref: string | null,
    attempt: (proof: Record<string, string>) => Promise<T>,
  ): Promise<T> => {
    if (humanCheck === false) return attempt({});
    const first = knownToAsk(ref) ? { [PROOF_HEADER]: await prove(purpose) } : {};
    try {
      return await attempt(first);
    } catch (error) {
      if (!(error instanceof PublicApiError) || error.code !== 'PUBLIC_PROOF_REQUIRED') throw error;
      asked.add(ref ?? CLAIM);
      return attempt({ [PROOF_HEADER]: await prove(purpose) });
    }
  };

  const insert = <T>(ref: string, values: Row): Promise<{ data: T; rank?: number }> =>
    withProof('write', ref, (proof) =>
      request<{ data: T; rank?: number }>(
        `/api/v1/public/records/${ref}`,
        { method: 'POST', body: JSON.stringify({ values }) },
        proof,
      ),
    );

  /** A booking availability read, in either form. */
  const booking = async <T>(ref: string, query: Record<string, string | number | undefined>, signal?: AbortSignal) => {
    const init: RequestInit = {};
    if (signal !== undefined) init.signal = signal;
    const p = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (value !== undefined) p.set(name, String(value));
    const out = await request<{ data: T[] }>(`/api/v1/public/availability/${ref}?${p.toString()}`, init);
    return out.data;
  };

  /**
   * Query-string encoder.
   *
   * `where` is JSON, because the server parses it as JSON. Building it by
   * hand in each app is how a filter ends up subtly wrong in one of fifteen
   * places — and the server would refuse it anyway, opaquely.
   */
  const encode = (options: ListOptions | undefined): string => {
    if (options === undefined) return '';
    const p = new URLSearchParams();
    if (options.where !== undefined) p.set('where', JSON.stringify(options.where));
    if (options.q !== undefined && options.q !== '') p.set('q', options.q);
    if (options.order !== undefined) p.set('order', options.order);
    if (options.limit !== undefined) p.set('limit', String(options.limit));
    if (options.offset !== undefined) p.set('offset', String(options.offset));
    if (options.cursor !== undefined) p.set('cursor', options.cursor);
    const s = p.toString();
    return s === '' ? '' : `?${s}`;
  };

  const client: PublicClient = {
    config() {
      // One fetch per client, shared by every concurrent caller — a boot that
      // renders six components must not make six identical requests.
      cachedConfig ??= request<{ data: PublicConfig }>('/api/v1/public/config').then((r) => r.data);
      return cachedConfig;
    },

    async list<T = Row>(ref: string, options?: ListOptions) {
      const init: RequestInit = {};
      if (options?.signal !== undefined) init.signal = options.signal;
      const reply = await send<unknown>(`/api/v1/public/records/${ref}${encode(options)}`, init);
      return asListResult<T>(reply.body, reply.headers);
    },

    async availability(ref: string, day: string, party: number, signal?: AbortSignal) {
      const init: RequestInit = {};
      if (signal !== undefined) init.signal = signal;
      const query = new URLSearchParams({ date: day, party: String(party) });
      const out = await request<{ data: SlotAvailability[] }>(`/api/v1/public/availability/${ref}?${query.toString()}`, init);
      return out.data;
    },

    bookingTimes(ref, query, signal) {
      // Named one by one rather than spread: the server refuses a mixture of
      // the two forms, and a caller's stray `from` would be one.
      const { kind, resource, exclude, date } = query;
      return booking<SlotAvailability>(ref, { kind, resource, date, exclude }, signal);
    },

    bookingDays(ref, query, signal) {
      const { kind, resource, exclude, from, days } = query;
      return booking<DayAvailability>(ref, { kind, resource, from, days, exclude }, signal);
    },

    async get<T = Row>(ref: string, id: string, signal?: AbortSignal) {
      const init: RequestInit = {};
      if (signal !== undefined) init.signal = signal;
      const out = await request<{ data: T }>(
        `/api/v1/public/records/${ref}/${encodeURIComponent(id)}`,
        init,
      );
      return out.data;
    },

    async create<T = Row>(ref: string, values: Row) {
      return (await insert<T>(ref, values)).data;
    },

    async createWithRank<T = Row>(ref: string, values: Row) {
      const out = await insert<T>(ref, values);
      return { data: out.data, rank: typeof out.rank === 'number' ? out.rank : null };
    },

    async update<T = Row>(ref: string, id: string, values: Row) {
      const out = await request<{ data: T }>(
        `/api/v1/public/records/${ref}/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify({ values }) },
      );
      return out.data;
    },

    async replace<T = Row>(ref: string, id: string, values: Row) {
      const out = await request<{ data: T }>(
        `/api/v1/public/records/${ref}/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify({ values }) },
      );
      return out.data;
    },

    async remove(ref: string, id: string) {
      await request<{ data: Record<string, never> }>(`/api/v1/public/records/${ref}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },

    async batch(ref: string, rows: Row[]) {
      const out = await request<{ data: { count: number } }>(`/api/v1/public/records/${ref}/batch`, {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      return { count: out.data.count };
    },

    async claim(match: Record<string, unknown>) {
      try {
        const out = await withProof('claim', null, (proof) =>
          request<{ data: { session: string; expiresAt: number } }>(
            '/api/v1/public/claim',
            { method: 'POST', body: JSON.stringify({ match }) },
            proof,
          ),
        );
        // A claim finds the person; only a code raises it to `verified`.
        holdSession({ token: out.data.session, level: 'lookup', expiresAt: out.data.expiresAt });
        return true;
      } catch (error) {
        /*
         * A failed claim is an ORDINARY outcome, not an exception — the visitor
         * mistyped something. Anything else still throws.
         *
         * The server cannot tell you WHICH factor was wrong and neither can
         * this: one code covers no match, several matches, a missing field and
         * an extra one, because anything finer turns a two-factor check into
         * two one-factor ones.
         */
        if (error instanceof PublicApiError && error.code === 'PUBLIC_CLAIM_NO_MATCH') return false;
        throw error;
      }
    },

    async requestCode(input: CodeRequest) {
      // Exactly the two shapes the server takes; it refuses any other key.
      const body = input.purpose === 'verify' ? { purpose: 'verify' } : { purpose: input.purpose, email: input.email };
      const out = await request<{ data: CodeSent }>('/api/v1/public/claim/code', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return out.data;
    },

    async verifyCode(input) {
      const purpose = input.purpose ?? 'verify';
      let out: { data: { level: ClaimLevel; expiresAt: number; email?: string } };
      try {
        out = await request('/api/v1/public/claim/verify', {
          method: 'POST',
          body: JSON.stringify({ purpose, code: input.code }),
        });
      } catch (error) {
        // A mistyped code is an ordinary outcome, like a claim that does not
        // match; everything else — expired, locked — still throws.
        if (error instanceof PublicApiError && error.code === 'PUBLIC_CODE_WRONG') {
          const left = error.params['triesLeft'];
          return { ok: false, triesLeft: typeof left === 'number' ? left : 0 };
        }
        throw error;
      }
      const { level, expiresAt, email } = out.data;
      /*
       * An address change ends every session of the person, this one too, and
       * its reply's `expiresAt` is the moment it ended. Holding on to the
       * token would only turn the next request into a puzzling 401.
       */
      const ended = purpose === 'email-change' || expiresAt <= Date.now();
      if (ended) holdSession(null);
      else if (session !== null) holdSession({ token: session.token, level, expiresAt });
      return { ok: true, level, expiresAt, ended, ...(email === undefined ? {} : { email }) };
    },

    async signOut() {
      if (session === null) return;
      try {
        await request('/api/v1/public/session', { method: 'DELETE' });
      } finally {
        // Dropped locally whatever the server said: a visitor who clicked sign
        // out must not still be holding a session because a request failed.
        holdSession(null);
      }
    },

    isClaimed() {
      return session !== null;
    },

    session() {
      return session === null ? null : { level: session.level, expiresAt: session.expiresAt };
    },

    async assertRefs(required) {
      const config = await client.config();
      const missing: string[] = [];
      for (const [ref, columns] of Object.entries(required)) {
        const found = config.refs[ref];
        if (found === undefined) {
          missing.push(`${ref} (no such resource in the scope)`);
          continue;
        }
        for (const column of columns) {
          if (!found.expose.includes(column)) missing.push(`${ref}.${column}`);
        }
      }
      if (missing.length > 0) {
        throw new PublicApiError(
          'PUBLIC_REF_NOT_FOUND',
          404,
          `the live scope does not expose: ${missing.join(', ')}. ` +
            'Widen it in Studio → Public API, or stop reading these.',
        );
      }
    },

    documents: {
      async list(signal?: AbortSignal) {
        const init: RequestInit = {};
        if (signal !== undefined) init.signal = signal;
        const out = await request<{ data: PublicDocument[] }>('/api/v1/public/documents', init);
        return out.data;
      },

      async get(id: string, signal?: AbortSignal) {
        const init: RequestInit = {};
        if (signal !== undefined) init.signal = signal;
        const out = await request<{ data: PublicDocument }>(
          `/api/v1/public/documents/${encodeURIComponent(id)}`,
          init,
        );
        return out.data;
      },

      async render(input) {
        const out = await request<{ data: PublicDocument }>('/api/v1/public/documents/render', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        return out.data;
      },

      async email(id: string) {
        // No body. The address is the session's, and there is nothing else to
        // decide — see the interface.
        const out = await request<{ data: PublicDocument }>(
          `/api/v1/public/documents/${encodeURIComponent(id)}/email`,
          { method: 'POST' },
        );
        return out.data;
      },

      contentUrl(id: string) {
        /*
         * A URL rather than the bytes, because the browser fetches this one:
         * the response is `attachment` + `nosniff` and belongs in a link, not
         * in memory. It carries no key — the route reads the session header,
         * which a plain navigation does NOT send, so this is for a fetch or a
         * download the app makes itself.
         */
        return `${baseUrl}/api/v1/public/documents/${encodeURIComponent(id)}/content`;
      },
    },
  };

  return client;
}

/* ------------------------------------------------------------------ time */

/**
 * The tenant's calendar day for an API timestamp, as `YYYY-MM-DD`.
 *
 * Uses `Intl` with an explicit `timeZone`, which is the only way to get this
 * right without a date library. `en-CA` because its short date format is
 * already ISO order — a small trick, and the alternative is assembling parts by
 * hand for no benefit.
 */
export function toTenantDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Minutes since midnight in the tenant's zone. */
export function toTenantMinutes(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // `en-GB` renders midnight as 24 in some ICU versions; normalise it.
  return (hour % 24) * 60 + minute;
}

/**
 * The instant a tenant-local wall time names, as an ISO string — the inverse
 * of {@link toTenantDay} and {@link toTenantMinutes}. A guest picks "7 pm on
 * Friday" on the venue's calendar; this is what the API is sent, whatever
 * zone the guest's own device is in.
 *
 * A time the clocks skip in spring reads as the hour after; one they pass
 * twice in autumn, as the first.
 */
export function fromTenantLocal(day: string, minutes: number, timezone: string): string {
  const naive = Date.parse(`${day}T00:00:00Z`) + Math.round(minutes) * 60_000;
  const offsetAt = (instant: number): number => {
    const localDay = toTenantDay(new Date(instant).toISOString(), timezone);
    const localMinutes = toTenantMinutes(new Date(instant).toISOString(), timezone);
    return (Date.parse(`${localDay}T00:00:00Z`) + localMinutes * 60_000 - Math.floor(instant / 60_000) * 60_000) / 60_000;
  };
  // The offsets either side of the day: equal on most days; across a clock
  // change, each names one reading of the wall time.
  const readings = [naive - offsetAt(naive - 43_200_000) * 60_000, naive - offsetAt(naive + 43_200_000) * 60_000];
  const exact = readings.filter(
    (instant) =>
      toTenantDay(new Date(instant).toISOString(), timezone) === day &&
      toTenantMinutes(new Date(instant).toISOString(), timezone) === Math.round(minutes),
  );
  // Twice in autumn: the first. Never in spring: the earlier offset, an hour on.
  return new Date(exact.length > 0 ? Math.min(...exact) : readings[0]!).toISOString();
}

/**
 * Is a zone a real, canonical IANA name?
 *
 * `new Intl.DateTimeFormat({ timeZone })` does NOT throw for legacy aliases —
 * it remaps them. `BST` resolves to `Asia/Dhaka`, six hours from the British
 * Summer Time somebody meant; `EST` resolves to a zone that never observes
 * daylight saving. So membership in the canonical list is the test, and the
 * server refuses a scope that fails it.
 */
/**
 * Format a money value the API returned, in the tenant's currency.
 *
 * The value is a STRING because `numeric` serializes as one — parsing it to a
 * float here would reintroduce the rounding the string exists to avoid, so it
 * is parsed once, at the last moment, for display only. Never do arithmetic on
 * the result.
 */
export function formatTenantMoney(
  value: string | number,
  currency: string | null,
  locale?: string,
): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);
  if (currency === null) {
    // No currency in the scope: render the number and let the caller decide.
    return new Intl.NumberFormat(locale).format(amount);
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

export function isCanonicalTimeZone(timezone: string): boolean {
  if (timezone.toUpperCase() === 'UTC') return true;
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  if (supported.length === 0) return timezone.includes('/');
  return supported.includes(timezone);
}

/* ----------------------------------------------------------- human check */

/** What a proof is asked for: a create, or a claim. */
export type ProofPurpose = 'write' | 'claim';

/** A challenge, as `GET /public/challenge` hands it out. */
export interface ProofChallenge {
  /** Sent back as `x-adminium-proof: <id>.<nonce>`. */
  id: string;
  salt: string;
  /** Leading zero bits `sha256(salt + nonce)` must start with. */
  difficulty: number;
  /** Epoch ms. Two minutes after it was handed out. */
  expiresAt: number;
}

interface ProofKernel {
  sha256: (input: string | Uint8Array) => Uint8Array;
  leadingZeroBits: (bytes: Uint8Array) => number;
  search: (salt: string, difficulty: number, start: number, count: number) => string | null;
}

/**
 * The work, as one function that reaches for nothing outside itself.
 *
 * Self-contained because it is shipped twice: called here, and turned back
 * into source text for the worker. A helper it named from outside would be
 * missing in the worker, which has only what the text carries. That is also
 * why the SHA-256 is written out rather than taken from `crypto.subtle`: that
 * one is async, and a promise per attempt makes the ~65,000 attempts of a
 * sixteen-bit proof many times slower than hashing them straight through.
 *
 * A bundler told to keep function names (esbuild's `keepNames`) wraps each
 * inner function in a helper of its own, which the worker's text does not
 * carry. That worker then fails to start and the search runs on the page
 * instead — slower, never wrong.
 */
function proofKernel(): ProofKernel {
  const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const W = new Int32Array(64);
  const encoder = new TextEncoder();

  const sha256 = (input: string | Uint8Array): Uint8Array => {
    const bytes = typeof input === 'string' ? encoder.encode(input) : input;
    // The message, a 1 bit, zeros, and its length in bits as 64 big-endian
    // bits, filling a whole number of 64-byte blocks.
    const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
    view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);

    const H = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let i = 0; i < 16; i += 1) W[i] = view.getInt32(offset + i * 4);
      for (let i = 16; i < 64; i += 1) {
        const w15 = W[i - 15]!;
        const w2 = W[i - 2]!;
        const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
      }
      let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
      for (let i = 0; i < 64; i += 1) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      H[0] = (H[0]! + a) | 0;
      H[1] = (H[1]! + b) | 0;
      H[2] = (H[2]! + c) | 0;
      H[3] = (H[3]! + d) | 0;
      H[4] = (H[4]! + e) | 0;
      H[5] = (H[5]! + f) | 0;
      H[6] = (H[6]! + g) | 0;
      H[7] = (H[7]! + h) | 0;
    }
    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i += 1) outView.setInt32(i * 4, H[i]!);
    return out;
  };

  const leadingZeroBits = (bytes: Uint8Array): number => {
    let bits = 0;
    for (const byte of bytes) {
      if (byte !== 0) return bits + Math.clz32(byte) - 24;
      bits += 8;
    }
    return bits;
  };

  // The nonce is the counter in lowercase base 36 — the only spelling the
  // server's header pattern accepts.
  const search = (salt: string, difficulty: number, start: number, count: number): string | null => {
    for (let n = start; n < start + count; n += 1) {
      const nonce = n.toString(36);
      if (leadingZeroBits(sha256(salt + nonce)) >= difficulty) return nonce;
    }
    return null;
  };

  return { sha256, leadingZeroBits, search };
}

const kernel = /* @__PURE__ */ proofKernel();

/** SHA-256 of a string (as UTF-8) or of bytes, synchronously. */
export const sha256: (input: string | Uint8Array) => Uint8Array = kernel.sha256;

/** How many zero bits a hash starts with. */
export const leadingZeroBits: (bytes: Uint8Array) => number = kernel.leadingZeroBits;

/**
 * What the worker runs: the kernel, rebuilt from its own text, searching from
 * zero until it finds a nonce. Built as a string so that no bundler has to be
 * told about a worker file.
 */
export function proofWorkerSource(): string {
  return (
    `const kernel = (${proofKernel.toString()})();\n` +
    'self.onmessage = (event) => {\n' +
    '  const { salt, difficulty } = event.data;\n' +
    '  self.postMessage(kernel.search(salt, difficulty, 0, Number.MAX_SAFE_INTEGER));\n' +
    '};\n'
  );
}

/** Attempts between yields on the main thread: a few milliseconds of work on a phone. */
const CHUNK = 2_000;

/** The search off the main thread, or null where there is no worker to be had. */
function solveInWorker(challenge: ProofChallenge): Promise<string> | null {
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') {
    return null;
  }
  let url: string | null = null;
  let worker: Worker;
  try {
    url = URL.createObjectURL(new Blob([proofWorkerSource()], { type: 'text/javascript' }));
    worker = new Worker(url);
  } catch {
    // A page whose CSP refuses `blob:` workers throws here, in some browsers.
    if (url !== null) URL.revokeObjectURL(url);
    return null;
  }
  const done = (): void => {
    worker.terminate();
    if (url !== null) URL.revokeObjectURL(url);
  };
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<unknown>) => {
      done();
      resolve(String(event.data));
    };
    // …and fires this instead, in others.
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      done();
      reject(new Error('the proof worker could not run'));
    };
    worker.postMessage({ salt: challenge.salt, difficulty: challenge.difficulty });
  });
}

/**
 * Find the nonce a challenge asks for.
 *
 * In a Web Worker where there is one, so the page stays responsive through
 * the second a cheap phone spends on it. Where there is none — a test, a
 * server render, a CSP that refuses `blob:` workers — on this thread, in
 * small chunks that yield between them, so a click still lands meanwhile.
 */
export async function solveChallenge(challenge: ProofChallenge): Promise<string> {
  const offThread = solveInWorker(challenge);
  if (offThread !== null) {
    try {
      return await offThread;
    } catch {
      /* the worker would not run — do the work here instead */
    }
  }
  for (let start = 0; ; start += CHUNK) {
    const found = kernel.search(challenge.salt, challenge.difficulty, start, CHUNK);
    if (found !== null) return found;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
