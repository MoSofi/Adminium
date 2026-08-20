// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminiumjs/public-client` — the browser client for Adminium's scoped public
 * API (28-public-surface.md §3, 28-T12).
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
  'PUBLIC_UPSTREAM_UNAVAILABLE',
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
  readonly retryAfterSeconds: number | null;

  constructor(code: PublicErrorCode, status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'PublicApiError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds ?? null;
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
export type PublicAction = 'read' | 'create' | 'update';

export interface PublicRefConfig {
  actions: PublicAction[];
  expose: string[];
  filterable: string[];
  searchable: string[];
  orderable: string[];
  writable: string[];
  limit: number;
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
  claim: { strategy: 'lookup' | 'email-code' | 'external'; ref: string; match: string[] } | null;
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
}

/* --------------------------------------------------------------- client */

const SESSION_HEADER = 'x-adminium-public-session';

export interface PublicClient {
  /** The scope, fetched once and cached. */
  config: () => Promise<PublicConfig>;
  list: <T = Row>(ref: string, options?: ListOptions) => Promise<ListResult<T>>;
  get: <T = Row>(ref: string, id: string, signal?: AbortSignal) => Promise<T>;
  create: <T = Row>(ref: string, values: Row) => Promise<T>;
  update: <T = Row>(ref: string, id: string, values: Row) => Promise<T>;
  /** Identify the visitor. Returns false when the details did not match. */
  claim: (match: Record<string, unknown>) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Is a claim session currently held? */
  isClaimed: () => boolean;
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
  let session: string | null = null;
  let cachedConfig: Promise<PublicConfig> | null = null;

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers: Record<string, string> = {
      authorization: `Bearer ${key}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session === null ? {} : { [SESSION_HEADER]: session }),
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
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        const got = body.error?.code;
        if (typeof got === 'string' && (PUBLIC_ERROR_CODES as readonly string[]).includes(got)) {
          code = got as PublicErrorCode;
        }
        if (typeof body.error?.message === 'string') message = body.error.message;
      } catch {
        /* a non-JSON error body — the status is all there is */
      }
      const retry = res.headers.get('retry-after');
      throw new PublicApiError(
        code,
        res.status,
        message,
        retry === null ? undefined : Number(retry),
      );
    }
    return (await res.json()) as T;
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
      return request<ListResult<T>>(`/api/v1/public/records/${ref}${encode(options)}`, init);
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
      const out = await request<{ data: T }>(`/api/v1/public/records/${ref}`, {
        method: 'POST',
        body: JSON.stringify({ values }),
      });
      return out.data;
    },

    async update<T = Row>(ref: string, id: string, values: Row) {
      const out = await request<{ data: T }>(
        `/api/v1/public/records/${ref}/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify({ values }) },
      );
      return out.data;
    },

    async claim(match: Record<string, unknown>) {
      try {
        const out = await request<{ data: { session: string; expiresAt: number } }>(
          '/api/v1/public/claim',
          { method: 'POST', body: JSON.stringify({ match }) },
        );
        session = out.data.session;
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

    async signOut() {
      if (session === null) return;
      try {
        await request('/api/v1/public/session', { method: 'DELETE' });
      } finally {
        // Dropped locally whatever the server said: a visitor who clicked sign
        // out must not still be holding a session because a request failed.
        session = null;
      }
    },

    isClaimed() {
      return session !== null;
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
