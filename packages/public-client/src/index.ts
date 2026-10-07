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
  /**
   * What a line asks for is sold out: tickets of a type, today's portions of
   * a dish (409). `error.params.column` names the line's column; on a create
   * with child rows, `error.soldOut` says which line.
   */
  'PUBLIC_SOLD_OUT',
  /** No room of the type asked for is free on one of the nights (409). */
  'PUBLIC_NO_ROOM',
  /**
   * What a line asks for is out of stock (409). On a create with child rows,
   * `error.params.child`, `index` and `path` name the line; `left` says how
   * much there is only where the venue shows it.
   */
  'PUBLIC_OUT_OF_STOCK',
  /**
   * A gift card or a voucher code was refused (409). `error.params.reason`
   * is always `not-valid`; `error.params.column` names where it was typed.
   */
  'PUBLIC_CARD_REFUSED',
  /**
   * Too late for this change online — a cancellation, a refund, a check-in
   * past its window (409); the venue still can. `error.params.at`, when
   * present, is when the window closed.
   */
  'PUBLIC_TOO_LATE',
  /**
   * The order came to another price than the one shown (409): nothing was
   * saved; `error.priceChanged` holds the new total and each line's figures.
   */
  'PUBLIC_PRICE_CHANGED',
  /**
   * Too early for this change — a kiosk check-in more than an hour before the
   * visit, a door scan before the doors open (409). `error.tooEarly` holds the
   * time the window is counted from (the visit, the doors) and when it opens;
   * say them in the venue's zone (`toTenantMinutes`).
   */
  'PUBLIC_TOO_EARLY',
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
  /**
   * A sign-in link (or a shared link) that cannot open anything any more: used,
   * expired, stopped or taken back (410). Offer "Email me a new link".
   */
  'LINK_EXPIRED',
  /** Not from the server: the network never answered. */
  'PUBLIC_NETWORK_UNAVAILABLE',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

/**
 * What a `PUBLIC_TOO_EARLY` refusal carries, as instants (ISO strings): the
 * row's own time, and the moment the change will be taken.
 */
export interface PublicTooEarly {
  at: string;
  from: string;
}

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

  /**
   * True when the session found the person but this needs them VERIFIED: ask
   * for the emailed code (`requestCode`), or — on an app that signs people in
   * by link — sign in again by link.
   */
  get needsVerifiedSession(): boolean {
    return this.code === 'PUBLIC_CLAIM_LEVEL';
  }

  /** On a `PUBLIC_SOLD_OUT` refusal, which line it names; null on any other. */
  /**
   * What a line asked for is out of stock: which line of a create with child
   * rows (`child`, `index`, `path`), and how many are left — only where the
   * venue chose to show it. Null for any other refusal.
   */
  get outOfStock(): { child?: string; index?: number; path?: (string | number)[]; left?: string } | null {
    if (this.code !== 'PUBLIC_OUT_OF_STOCK') return null;
    const { child, index, path, left } = this.params;
    return {
      ...(typeof child === 'string' ? { child } : {}),
      ...(typeof index === 'number' ? { index } : {}),
      ...(Array.isArray(path) ? { path: path as (string | number)[] } : {}),
      ...(typeof left === 'string' ? { left } : {}),
    };
  }

  /**
   * A gift card or a voucher code was refused: `column` names where it was
   * typed, when the server says. Never why — the answer is the same for a
   * card that does not exist and one that is empty. Null for any other refusal.
   */
  get cardRefused(): { column?: string } | null {
    if (this.code !== 'PUBLIC_CARD_REFUSED') return null;
    const { column } = this.params;
    return typeof column === 'string' ? { column } : {};
  }

  get soldOut(): PublicSoldOut | null {
    if (this.code !== 'PUBLIC_SOLD_OUT') return null;
    const { child, index, path, column } = this.params;
    return {
      ...(typeof child === 'string' ? { child } : {}),
      ...(typeof index === 'number' ? { index } : {}),
      ...(Array.isArray(path) ? { path: path as (string | number)[] } : {}),
      ...(typeof column === 'string' ? { column } : {}),
    };
  }

  /** On a `PUBLIC_TOO_EARLY` refusal, the times it carries; null on any other. */
  get tooEarly(): PublicTooEarly | null {
    if (this.code !== 'PUBLIC_TOO_EARLY') return null;
    const { at, from } = this.params;
    return typeof at === 'string' && typeof from === 'string' ? { at, from } : null;
  }

  /*
   * ── A create with its child rows ────────────────────────────────────────
   */

  /**
   * On a `PUBLIC_WRITE_REFUSED`, which row and why, as far as the server
   * says: `child` and `index` name the row (the deepest list), `path` its
   * whole place (`['order_items', 3, 'order_item_modifiers', 1]`), `column`
   * and `reason` the value. Null on any other code.
   */
  get refused(): TreeRefusal | null {
    if (this.code !== 'PUBLIC_WRITE_REFUSED') return null;
    return treeRefusalOf(this.params);
  }

  /** On a `PUBLIC_PRICE_CHANGED`, the total it would have saved and each line's figures; null on any other. */
  get priceChanged(): PriceChanged | null {
    if (this.code !== 'PUBLIC_PRICE_CHANGED') return null;
    const { total, lines, applied } = this.params;
    return {
      total: typeof total === 'string' ? total : null,
      lines: typeof lines === 'object' && lines !== null ? (lines as Record<string, TreeReplyRow[]>) : {},
      applied: Array.isArray(applied) ? (applied as AppliedReduction[]) : [],
    };
  }

}

/** Where in a create with child rows a refusal is about, and why. */
export interface TreeRefusal {
  child: string | null;
  index: number | null;
  path: (string | number)[] | null;
  column: string | null;
  reason: string | null;
  /** A group of choices out of bounds (a size left out): the group row's key. */
  group: string | number | null;
  /** For a code under its minimum (`needs-minimum`): the minimum, as text. Null otherwise. */
  amount: string | null;
}

function treeRefusalOf(params: Readonly<Record<string, unknown>>): TreeRefusal {
  const { child, index, path, column, reason, group, amount } = params;
  return {
    child: typeof child === 'string' ? child : null,
    index: typeof index === 'number' ? index : null,
    path: Array.isArray(path) ? (path as (string | number)[]) : null,
    column: typeof column === 'string' ? column : null,
    reason: typeof reason === 'string' ? reason : null,
    group: typeof group === 'string' || typeof group === 'number' ? group : null,
    amount: typeof amount === 'string' ? amount : null,
  };
}

/** What a `PUBLIC_PRICE_CHANGED` says: the total the order came to, its lines' figures, and the reductions that total has. */
export interface PriceChanged {
  total: string | null;
  lines: Record<string, TreeReplyRow[]>;
  /** Empty when the order asks no price of an offers add-on. */
  applied: AppliedReduction[];
}

/**
 * One reduction of an order, as a quote and a save answer it: what it is
 * called (in the language the request asked for), what kind it is, how much
 * it takes off, and whether the customer typed it. `line` is the reduced
 * line's place in the request (`order_lines/2`); null for a reduction spread
 * over several lines. `codeLast4`: for a voucher, the last four characters
 * of the code as typed. `name` is empty for a reduction staff gave by hand
 * (`kind: 'staff'`): the page says its own word for one.
 */
export interface AppliedReduction {
  line: string | null;
  name: string;
  kind: 'offer' | 'code' | 'voucher' | 'pack' | 'staff';
  amount: string;
  typed: boolean;
  codeLast4?: string;
}

/** Said beside a typed code that was not needed: another offer took more off. `column` is where the code was typed (`order_codes/0/typed`). */
export interface ToldOfCode {
  column: string;
  note: 'better-offer-applied';
  name: string;
}

/** The rows a create carries below it, by the list name the entry declares; one more level below each. */
export type TreeRows = Record<string, { values: Row; children?: Record<string, { values: Row }[]> }[]>;

/** One row of a create's reply below the created one: its shown columns, and its own rows. */
export interface TreeReplyRow<T = Row> {
  data: T;
  children?: Record<string, { data: Row }[]>;
}

/**
 * A new row's own link, answered once by the create that made it: the key
 * (by the purpose the app names it) that opens it, the code the page keeps in
 * its URL fragment (`/o#<token>`), and a session already open on the row
 * through that key — hand it to a client of that key with `adoptSession`, so
 * the confirmation page needs no claim. Keep the session: sent back as
 * `replaces` with the next hold, it lets this one go.
 */
export interface CreatedLink {
  key: string;
  token: string;
  session: string | null;
  expiresAt: number | null;
}

/** A created row with the rows written below it. */
export interface TreeCreated<T = Row> {
  data: T;
  children: Record<string, TreeReplyRow[]>;
  /** Null when the endpoint does not rank. */
  rank: number | null;
  /** A retry of an order already made (the same retry key): nothing new was written. */
  replayed: boolean;
  /** The new row's own link; null on a replay (the email carries it) and where the entry answers none. */
  link: CreatedLink | null;
  /** The reductions the order was saved with. Empty when it asks no price of an offers add-on. */
  applied: AppliedReduction[];
  told: ToldOfCode[];
  /** What a gift card (or any payment whose amount the server decides) took, and what is still to pay; null when the order had none. */
  payment: DecidedPayment | null;
}

/** A payment whose amount the server decided: a gift card pays what is due as far as it goes. Nothing else of the card is ever answered. */
export interface DecidedPayment {
  amount: string;
  due: string;
}

/**
 * What a quote says of one add-on ledger the rows would hand something to
 * (stock, a gift card): whether the save would go through. Refused, only
 * what the save itself would say: `out-of-stock` (with the line, and how many
 * are left where the venue shows it) or `not-valid` for a card or a code.
 */
export interface QuotePosting {
  ledger: string;
  state: 'ok' | 'refused' | 'unavailable';
  reason?: 'out-of-stock' | 'not-valid';
  path?: (string | number)[];
  line?: number;
  left?: string;
}

/** What a dry run answers: every figure the save would write, and how the places it takes stand. Nothing is kept. */
export interface Quote<T = Row> {
  /** What each add-on ledger would say of the order. Empty when it hands nothing to any. */
  postings: QuotePosting[];
  data: T;
  children: Record<string, TreeReplyRow[]>;
  capacity: { pool: string; state: 'available' | 'full'; at?: string }[];
  /** False when the app runs its own code on a table of the order: the save may come out otherwise. */
  exact: boolean;
  /** A row priced by the night (a stay): each night, its rate, and the names of what was added to it. Empty otherwise. */
  nights: QuoteNight[];
  /** The reductions the order would be saved with. Empty when it asks no price of an offers add-on. */
  applied: AppliedReduction[];
  told: ToldOfCode[];
  /** What a gift card would take, and what would still be to pay; null when the order has none. */
  payment: DecidedPayment | null;
}

/** One night of a row priced by the night, as a quote answers it. */
export interface QuoteNight {
  date: string;
  rate: string;
  /** The night's rate before what was added to it (a weekend's raise): "was" beside a raised night. */
  base: string;
  tags: string[];
}

/** What a dry run of a change answers: the row as the change would leave it. Nothing is kept. */
export interface ChangeQuote<T = Row> {
  /** What each add-on ledger would say of the change. Empty when it hands nothing to any. */
  postings: QuotePosting[];
  data: T;
  /** False when the app runs its own code on the change: the save may come out otherwise. */
  exact: boolean;
  /** A row priced by the night: the nights the change would leave it with. Empty otherwise. */
  nights: QuoteNight[];
  /** The rows below it the change moves (extras that follow a stay's nights), as it would leave them, by the ref each is read through. Empty otherwise. */
  children: Record<string, { data: Row }[]>;
  /** The reductions the row's order would then have. Empty when it asks no price of an offers add-on. */
  applied: AppliedReduction[];
  told: ToldOfCode[];
}

/**
 * A retry key for one order — mint one per cart and keep it until the order
 * is made: a save sent again with it (a reply lost to the network) answers
 * the order already made. 32 random bytes, base64url; never a cart id.
 */
export function newClientKey(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  /**
   * On an availability ref over a limit, which kind it answers: `slot` (ask
   * `availability` or `slotDays`), `parent` (`parentAvailability`) or `night`
   * (`nightAvailability`). Absent on a booking ref, and from an older server.
   */
  capacity?: 'slot' | 'parent' | 'night';
  /** Rows listed only with the code that unlocks them: pass `code` to `list`, `get` or `parentAvailability`. */
  unlock?: true;
  /** Image columns any visitor may see: `pictureUrl` builds each one's address. */
  pictures?: string[];
}

export interface PublicConfig {
  version: 1;
  side: PublicSide;
  /** IANA zone. Build every day and time from this, never from the browser. */
  timezone: string;
  /**
   * The server's clock when the config was answered (ISO). The config is
   * fetched once, so read the time now with `now()`, which keeps the
   * difference. Absent from servers up to 0.3.4.
   */
  now?: string;
  /**
   * ISO-4217, or null when this scope serves no money.
   *
   * A `money` column arrives as a bare decimal string (`"45.00"`) with no
   * currency attached, so formatting one without this is a guess.
   */
  currency: string | null;
  /** Where this key's pictures are asked for (`pictureUrl` builds each one's address); absent when it shows none. */
  pictures?: string;
  claim: {
    /**
     * `email-link`: the person asks for a link by address (`requestLink`), and
     * nothing else signs them in. `token`: a shared link opens one row
     * (`openShared`). `lookup` finds a person by their details (`claim`).
     */
    strategy: 'lookup' | 'email-code' | 'external' | 'email-link' | 'token';
    ref: string;
    match: string[];
    /**
     * `email-code`: a found session can be raised to `verified` by a code
     * emailed to the person. `email-link`: sessions come only from a link.
     */
    verify?: 'email-code' | 'email-link';
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
  /**
   * A code the guest typed, for a ref shown only with one (`unlock` in its
   * config): sent in a header, never the URL. A code that unlocks nothing
   * lists nothing, and counts as one of the visitor's few guesses a minute.
   */
  code?: string;
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
  /**
   * Called when the server says the session held was ended — signed out on
   * another device (`elsewhere`), or the person's details deleted
   * (`forgotten`). The client has already dropped it; the page says so.
   */
  onSessionEnded?: (reason: SessionEnded) => void;
  /**
   * A session this page kept from before a reload (what `session()` handed
   * it), held from the start as if it had just been opened. One already past
   * its `expiresAt` is not held. `signOut()` ends it on the server too.
   */
  session?: HeldSession;
  /**
   * Called whenever the session held changes — opened, adopted, raised,
   * ended or dropped (then with null) — so a page can keep it across a
   * reload (in `sessionStorage`, say) and hand it back as `session`.
   */
  onSessionChange?: (session: HeldSession | null) => void;
}

/** How far a claim session reaches: `lookup` found the person, `verified` proved their mailbox. */
export type ClaimLevel = 'lookup' | 'verified';

/** The claim session a client holds, without its token. */
export interface PublicSession {
  level: ClaimLevel;
  /** Epoch ms. */
  expiresAt: number;
}

/** The claim session a client holds, with the token that carries it: what a page keeps across a reload. */
export interface HeldSession extends PublicSession {
  token: string;
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
  /** The new row's own link, when the entry answers one. */
  link: CreatedLink | null;
}

/** Why a session was ended before it lapsed: signed out from another device, or the person's details deleted. */
export type SessionEnded = 'elsewhere' | 'forgotten';

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

/** Which documents to list, newest first: one row's, one kind, a page at a time. */
export interface DocumentListOptions {
  /** With `id`: only the documents of that row of that ref. */
  ref?: string;
  id?: string | number;
  kind?: string;
  /** 1–100; the server's 50 when absent. */
  limit?: number;
  /** The `next` of the page before. */
  cursor?: string;
  signal?: AbortSignal;
}

/** A page of documents, and the cursor to the next — null on the last. */
export interface DocumentPage {
  data: PublicDocument[];
  next: string | null;
}

/**
 * A document drawn from a row the claim reaches, named by the KIND the key's
 * entry declares (an app's key). A statement names its period in one of three
 * words — never dates, which the server works out.
 */
export interface RenderForRow {
  kind: string;
  ref: string;
  id: string | number;
  period?: 'all' | 'year' | '12m';
  locale?: string;
}

export interface PublicDocuments {
  /**
   * The documents this claim reaches. With no argument (or a signal), the
   * first page as an array — as before; with options, a {@link DocumentPage}
   * whose `next` asks for the following one. Empty without a claim, never an
   * error.
   */
  list: {
    (signal?: AbortSignal): Promise<PublicDocument[]>;
    (options: DocumentListOptions): Promise<DocumentPage>;
  };
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
      | RenderForRow
      | {
          kind: string;
          locale?: string;
          fields: Record<string, unknown>;
          collections: Record<string, Record<string, unknown>[]>;
        },
  ) => Promise<PublicDocument & { reused: boolean }>;
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
/** The reply header that says the session sent was ended, and why. */
const SESSION_ENDED_HEADER = 'x-adminium-session-ended';
/** The header a typed code travels in: a URL is kept by every log and proxy on its way. */
const CODE_HEADER = 'x-adminium-code';
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
  /** `paused`: the venue paused the slot (a busy kitchen). A released slot limit never says it. */
  state: 'free' | 'full' | 'paused';
}

/** One row a parent limit is held on (a ticket type, a dish), as its availability ref answers it. */
export interface ParentAvailability {
  id: string;
  /** `soon` before its sales open, `ended` after they close, `soldout` when fewer are left than asked. */
  state: 'on' | 'soon' | 'ended' | 'soldout';
  /** How many are left — only when few are, and the ref says so. */
  left?: number;
}

/** What a parent limit's availability asks. */
export interface ParentQuery {
  /**
   * The value of the ref's `under` column the rows share (an event's id) — or
   * several, to read a page of events' rows in one request (a server from
   * 0.3.9; an older one answers an empty list for more than one).
   */
  under?: string | readonly string[];
  /** `YYYY-MM-DD`: the venue day asked (a dish's portions); today when absent. */
  date?: string;
  /** How many the page wants; answered sold out when fewer are left. */
  qty?: number;
  /** A row of this session's own (its held order), left out of the count. */
  exclude?: string;
  /** A code the guest typed: the rows it unlocks are counted too (sent in a header, never the URL). */
  code?: string;
}

/** One pool of a night limit (a room type), over the nights asked. */
export interface NightPoolAvailability {
  pool: string;
  /** `closed`: the dates are not a stay the venue sells; `full`: a night has no room left. */
  state: 'open' | 'full' | 'closed';
  left?: number;
  /** The first arrival after `from`, of the same length, when this pool is open (asked with `earliest`). */
  earliest?: string | null;
}

/** What a night limit's availability asks. */
export interface NightQuery {
  from: string;
  to: string;
  /** Leaves out the pools that sleep fewer. */
  guests?: number;
  /** Search this many days after `from` for the first arrival of the same length with room. */
  earliest?: number;
  exclude?: string;
}

export interface NightAvailability {
  pools: NightPoolAvailability[];
  /** With `earliest`: the first arrival of the same length where any fitting pool is open, or null. */
  earliest: string | null;
}

/** Which line of a create was sold out: `column`, and — on a create with child rows — its child, index and path. */
export interface PublicSoldOut {
  child?: string;
  index?: number;
  path?: (string | number)[];
  column?: string;
}

/** A sign-in link's email is on its way — to the address typed, if it is anyone's. */
export interface LinkRequested {
  /** The address as typed, masked (`l•••@e•••.com`). The same answer for any address. */
  sentTo: string;
}

/**
 * What a sign-in link's page reads from `location.hash`: the token, and where
 * to go once signed in — a path under the app, never a URL.
 */
export interface LinkFragment {
  token: string;
  to: string | null;
}

/** A file of a row this session reaches, as downloaded. */
export interface PrivateFile {
  blob: Blob;
  filename: string | null;
  /** An image or a PDF the page may draw; anything else is a download. */
  inline: boolean;
}

export interface PublicClient {
  /** The scope, fetched once and cached. */
  config: () => Promise<PublicConfig>;
  list: <T = Row>(ref: string, options?: ListOptions) => Promise<ListResult<T>>;
  get: <T = Row>(ref: string, id: string, signal?: AbortSignal, options?: { code?: string }) => Promise<T>;
  /**
   * One record with the reductions its order took, as its save said them. `applied` is null where nothing is told of
   * them (a record no price rule reads, a rule that is off, an entry that does not show what the order was reduced by)
   * — which is not the same as an order that took none (`[]`).
   */
  getPriced: <T = Row>(ref: string, id: string, signal?: AbortSignal, options?: { code?: string }) => Promise<{ data: T; applied: AppliedReduction[] | null }>;
  create: <T = Row>(ref: string, values: Row) => Promise<T>;
  /**
   * `create`, with where the new row stands. Its own verb so that `create`
   * keeps answering the bare row every app already reads.
   */
  createWithRank: <T = Row>(ref: string, values: Row) => Promise<Created<T>>;
  /**
   * Change a row. With `expect`, the change is saved only at that price: a
   * different one is refused (`PUBLIC_PRICE_CHANGED`) and nothing changes.
   */
  update: <T = Row>(ref: string, id: string, values: Row, options?: { expect?: { total: string } }) => Promise<T>;
  /**
   * A create with the rows below it — an order, its lines, each line's
   * options — as one write: every row or none. With `expect`, only at that
   * total. Proves a person is there when the entry asks, as `create` does.
   */
  createTree: <T = Row>(ref: string, write: { values: Row; children?: TreeRows; expect?: { total: string }; replaces?: string }) => Promise<TreeCreated<T>>;
  /** The same create tried without writing: every figure it would come to. Costs a read; no human check. */
  quote: <T = Row>(ref: string, write: { values: Row; children?: TreeRows }) => Promise<Quote<T>>;
  /** A change to a row tried without writing: the row as the change would leave it. */
  quoteChange: <T = Row>(ref: string, id: string, values: Row) => Promise<ChangeQuote<T>>;
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
  /** A strip of up to 31 days from `from` under a slot limit: each open, full or closed, and how many times are free. */
  slotDays: (ref: string, query: { from: string; days: number; party?: number }, signal?: AbortSignal) => Promise<DayAvailability[]>;
  /** The rows a parent limit is held on (ticket types of an event), each on sale, sold out, soon or ended. */
  parentAvailability: (ref: string, query?: ParentQuery, signal?: AbortSignal) => Promise<ParentAvailability[]>;
  /** The pools of a night limit (room types) over a stay's nights, and the earliest arrival with room. */
  nightAvailability: (ref: string, query: NightQuery, signal?: AbortSignal) => Promise<NightAvailability>;
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
  /**
   * Email a sign-in link (and a code for another device) to an address.
   * Answers the same for every address — whether it is a client's is never
   * said. Throws `PUBLIC_CODE_UNAVAILABLE` when this server cannot send mail.
   */
  requestLink: (input: { email: string; lang?: string }) => Promise<LinkRequested>;
  /**
   * The first name a link's page greets its person by, spending nothing; null
   * for a link used, expired or taken back. Reading it signs nobody in.
   */
  peekLink: (token: string) => Promise<string | null>;
  /**
   * Continue: use the link, once, and hold a VERIFIED session. False for a
   * link used, expired or taken back — offer "Email me a new link".
   */
  openLink: (token: string) => Promise<boolean>;
  /**
   * The code from the email, typed on another device. A wrong code is an
   * ordinary result, with the tries left; a code path locked for the day
   * throws `PUBLIC_CLAIM_LOCKED` (the link in the email still works).
   */
  verifyLinkCode: (input: { email: string; code: string }) => Promise<VerifyCodeResult>;
  /** "Email me a new link", from an old one: to that link's own address, always the same answer. */
  resendLink: (token: string) => Promise<void>;
  /**
   * Open a row shared by link with the code from its fragment: `opened` holds
   * a session on it, `unknown` is a code that opens nothing, `closed` a link
   * stopped or expired.
   */
  openShared: (token: string) => Promise<'opened' | 'unknown' | 'closed'>;
  /**
   * A file a row of this session names, by the ref, the row's id and the
   * column the key offers for download. Fetched with the session, so it is
   * handed back as a Blob — a plain link would carry neither the key nor the
   * session.
   */
  file: (ref: string, id: string | number, column: string, signal?: AbortSignal) => Promise<PrivateFile>;
  /**
   * The settings an add-on the app needs marks for a browser (payment
   * instructions), for a VERIFIED session; `PUBLIC_REF_NOT_FOUND` otherwise.
   */
  addOnSettings: (key: string, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  signOut: () => Promise<void>;
  /**
   * Sign the person out on every device, this one too, and take back any
   * sign-in link still open to their address. Needs a verified session of
   * the person (not a row's own link).
   */
  signOutEverywhere: () => Promise<void>;
  /**
   * Delete the person's details: their own row is emptied (their bookings
   * and tickets stay, and still open by their links), every session ends and
   * the old address gets one last email. Needs a mailbox proved minutes ago:
   * `PUBLIC_CODE_STEP_UP` asks for a fresh sign-in link first.
   */
  forgetMe: () => Promise<void>;
  /**
   * "Make a new link" for one of the signed-in person's rows (a verified
   * session, never a row's own link): the row's own link stops opening it —
   * every session it opened too — and the new link is emailed to the person.
   * The new link never comes back here. `PUBLIC_LIMIT_REACHED` after so many
   * a day for one row.
   */
  newLink: (ref: string, id: string | number) => Promise<void>;
  /** Take a session a reply handed over — a new row's own link (`link.session`), for a client of that link's key. */
  adoptSession: (session: { token: string; expiresAt: number; level?: ClaimLevel }) => void;
  /** Why the server last ended the session this client held, or null. */
  sessionEnded: () => SessionEnded | null;
  /** Is a claim session currently held? */
  isClaimed: () => boolean;
  /**
   * The claim session held, or null — with its token, so a page can keep it
   * across a reload and hand it back as the `session` option.
   */
  session: () => HeldSession | null;
  /**
   * The server's clock now: the device's clock set right by the difference
   * `config()` saw (the config says the server's time). The device's own clock
   * when the server did not say.
   */
  now: () => Promise<Date>;
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

/** A create's `link` as the wire carries it. */
interface WireLink {
  key: string;
  token: string;
  session?: string;
  expiresAt?: number;
}

function linkOf(link: WireLink | undefined): CreatedLink | null {
  if (link === undefined || typeof link.token !== 'string') return null;
  return { key: link.key, token: link.token, session: link.session ?? null, expiresAt: link.expiresAt ?? null };
}

/** An AbortSignal rather than options — the older form of `documents.list`. */
function isSignal(value: AbortSignal | DocumentListOptions): value is AbortSignal {
  return typeof (value as AbortSignal).aborted === 'boolean' && typeof (value as AbortSignal).addEventListener === 'function';
}

/**
 * A sign-in link's (or a shared link's) fragment — `#<token>` or
 * `#<token>&to=<path>` — as its page reads `location.hash`. `to` is kept only
 * when it is a plain path under the app (letters, digits, `-._~/`), never a
 * URL: a page must not send a person off-site from a link it did not make.
 * Null when the fragment holds no token.
 */
/** The Adminium file a column's value names: a bare id, or a content address from any origin. */
const PICTURE_FILE = /^(?:file_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$|.*\/api\/v1\/files\/(file_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26})\/content\/?(?:\?.*)?$)/;


/** An address with the slashes at its end taken off, read from the end: no pattern to back-track over a long run of them. */
function withoutTrailingSlashes(address: string): string {
  let end = address.length;
  while (end > 0 && address.charCodeAt(end - 1) === 47) end -= 1;
  return address.slice(0, end);
}
/**
 * The address of a picture anyone may see — for an `<img src>`, with no key
 * and no session — or null when the ref shows no picture in that column, or
 * the value names no file Adminium keeps (a link elsewhere, nothing): show
 * the page's own tile then.
 */
export function pictureUrl(baseUrl: string, config: Pick<PublicConfig, 'pictures' | 'refs'>, ref: string, rowId: string | number, column: string, value: unknown): string | null {
  if (config.pictures === undefined || !(config.refs[ref]?.pictures ?? []).includes(column) || typeof value !== 'string') return null;
  const match = PICTURE_FILE.exec(value.trim());
  if (match === null) return null;
  const fileId = match[1] ?? value.trim();
  return `${withoutTrailingSlashes(baseUrl)}${config.pictures}/${encodeURIComponent(ref)}/${encodeURIComponent(String(rowId))}/${encodeURIComponent(column)}/${fileId}`;
}

export function linkFromFragment(hash: string): LinkFragment | null {
  const [token = '', ...rest] = hash.replace(/^#/, '').split('&');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;
  const raw = rest.find((part) => part.startsWith('to='))?.slice(3);
  const to = raw === undefined ? null : raw.replace(/^\//, '');
  const safe = to !== null && /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9][A-Za-z0-9._~-]*)*$/.test(to);
  return { token, to: safe ? to : null };
}

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
  const baseUrl = options?.baseUrl === undefined ? undefined : withoutTrailingSlashes(options.baseUrl);
  const key = options?.publishableKey;
  if (baseUrl === undefined || baseUrl === '' || key === undefined || key === '') return null;

  const doFetch = options?.fetch ?? globalThis.fetch.bind(globalThis);
  const humanCheck = options?.humanCheck;
  const csrfToken = options?.csrfToken;
  const onSessionEnded = options?.onSessionEnded;
  const onSessionChange = options?.onSessionChange;
  const seeded = options?.session;
  let session: HeldSession | null =
    seeded !== undefined && typeof seeded.token === 'string' && seeded.token !== '' && Number(seeded.expiresAt) > Date.now()
      ? { token: seeded.token, level: seeded.level === 'lookup' ? 'lookup' : 'verified', expiresAt: Number(seeded.expiresAt) }
      : null;
  /** How far the server's clock is ahead of this device's, in ms, as the config said; 0 until then. */
  let clockSkew = 0;
  let ended: SessionEnded | null = null;
  let cachedConfig: Promise<PublicConfig> | null = null;
  /** Refs that asked for a proof under the session held now, and {@link CLAIM} when a claim did. */
  const asked = new Set<string | typeof CLAIM>();

  /**
   * The only way the session changes. What asked for a proof is forgotten
   * with it: a signed-in person is excused the proof on a ref that caps what
   * they hold, so what asked of a stranger need not ask of them.
   */
  const holdSession = (next: HeldSession | null): void => {
    const changed = session !== next;
    session = next;
    asked.clear();
    if (changed) onSessionChange?.(next === null ? null : { ...next });
  };

  /** The error a refused reply carries, as the client throws it. */
  const errorOf = async (res: Response): Promise<PublicApiError> => {
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
    return new PublicApiError(code, res.status, message, retry === null ? undefined : Number(retry), params);
  };

  /** One request, with the reply's headers — `list()` reads `X-Next-Cursor`. */
  const send = async <T>(
    path: string,
    init: RequestInit = {},
    extra: Record<string, string> = {},
  ): Promise<{ body: T; headers: Headers; status: number }> => {
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

    // The session this client held was ended elsewhere: dropped, and the page told why — on any reply.
    const why = res.headers.get(SESSION_ENDED_HEADER);
    if ((why === 'elsewhere' || why === 'forgotten') && session !== null) {
      holdSession(null);
      ended = why;
      onSessionEnded?.(why);
    }
    if (!res.ok) throw await errorOf(res);
    return { body: (await res.json()) as T, headers: res.headers, status: res.status };
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

  const insert = <T>(ref: string, values: Row): Promise<{ data: T; rank?: number; link?: WireLink }> =>
    withProof('write', ref, (proof) =>
      request<{ data: T; rank?: number; link?: WireLink }>(
        `/api/v1/public/records/${ref}`,
        { method: 'POST', body: JSON.stringify({ values }) },
        proof,
      ),
    );

  /** A booking availability read, in either form. */
  const booking = async <T>(ref: string, query: Record<string, string | number | undefined>, signal?: AbortSignal, code?: string) => {
    const init: RequestInit = {};
    if (signal !== undefined) init.signal = signal;
    const p = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (value !== undefined) p.set(name, String(value));
    const out = await request<{ data: T[] }>(`/api/v1/public/availability/${ref}?${p.toString()}`, init, codeHeader(code));
    return out.data;
  };

  /** A code a guest typed, as the header that carries it; nothing when there is none. */
  const codeHeader = (code: string | undefined): Record<string, string> => (code === undefined || code.trim() === '' ? {} : { [CODE_HEADER]: code.trim() });

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
      cachedConfig ??= (async () => {
        const sentAt = Date.now();
        const out = await request<{ data: PublicConfig }>('/api/v1/public/config');
        const told = typeof out.data.now === 'string' ? Date.parse(out.data.now) : Number.NaN;
        // Measured against the middle of the round trip: the server answered somewhere inside it.
        if (Number.isFinite(told)) clockSkew = told - (sentAt + Date.now()) / 2;
        return out.data;
      })();
      // A failed fetch is not kept: the next caller asks again.
      cachedConfig.catch(() => {
        cachedConfig = null;
      });
      return cachedConfig;
    },

    async now() {
      await client.config().catch(() => undefined);
      return new Date(Date.now() + clockSkew);
    },

    async list<T = Row>(ref: string, options?: ListOptions) {
      const init: RequestInit = {};
      if (options?.signal !== undefined) init.signal = options.signal;
      const reply = await send<unknown>(`/api/v1/public/records/${ref}${encode(options)}`, init, codeHeader(options?.code));
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

    slotDays(ref, query, signal) {
      const { from, days, party } = query;
      return booking<DayAvailability>(ref, { from, days, party }, signal);
    },

    parentAvailability(ref, query = {}, signal) {
      const { under, date, qty, exclude, code } = query;
      return booking<ParentAvailability>(ref, { under: typeof under === 'string' || under === undefined ? under : under.join(','), date, qty, exclude }, signal, code);
    },

    async nightAvailability(ref, query, signal) {
      const init: RequestInit = {};
      if (signal !== undefined) init.signal = signal;
      const p = new URLSearchParams();
      const { from, to, guests, earliest, exclude } = query;
      for (const [name, value] of Object.entries({ from, to, guests, earliest, exclude })) if (value !== undefined) p.set(name, String(value));
      // The whole answer: the pools, and the earliest arrival beside them.
      const out = await request<{ data: NightPoolAvailability[]; earliest?: string | null }>(`/api/v1/public/availability/${ref}?${p.toString()}`, init);
      return { pools: out.data, earliest: out.earliest ?? null };
    },

    async get<T = Row>(ref: string, id: string, signal?: AbortSignal, options?: { code?: string }) {
      const init: RequestInit = {};
      if (signal !== undefined) init.signal = signal;
      const out = await request<{ data: T }>(
        `/api/v1/public/records/${ref}/${encodeURIComponent(id)}`,
        init,
        codeHeader(options?.code),
      );
      return out.data;
    },

    /**
     * One record with the reductions its order took, as the save that priced
     * it said them: for an order whose price an add-on lowers (a receipt page
     * opened again). `applied` is null where nothing is told of them.
     */
    async getPriced<T = Row>(ref: string, id: string, signal?: AbortSignal, options?: { code?: string }): Promise<{ data: T; applied: AppliedReduction[] | null }> {
      const init: RequestInit = {};
      if (signal !== undefined) init.signal = signal;
      const out = await request<{ data: T; applied?: AppliedReduction[] }>(`/api/v1/public/records/${ref}/${encodeURIComponent(id)}`, init, codeHeader(options?.code));
      return { data: out.data, applied: out.applied ?? null };
    },

    async create<T = Row>(ref: string, values: Row) {
      return (await insert<T>(ref, values)).data;
    },

    async createWithRank<T = Row>(ref: string, values: Row) {
      const out = await insert<T>(ref, values);
      return { data: out.data, rank: typeof out.rank === 'number' ? out.rank : null, link: linkOf(out.link) };
    },

    async update<T = Row>(ref: string, id: string, values: Row, options?: { expect?: { total: string } }) {
      const out = await request<{ data: T }>(
        `/api/v1/public/records/${ref}/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(options?.expect === undefined ? { values } : { values, expect: options.expect }) },
      );
      return out.data;
    },

    async createTree<T = Row>(ref: string, write: { values: Row; children?: TreeRows; expect?: { total: string }; replaces?: string }) {
      const out = await withProof('write', ref, (proof) =>
        request<{ data: T; children?: Record<string, TreeReplyRow[]>; rank?: number; replayed?: true; link?: WireLink; applied?: AppliedReduction[]; told?: ToldOfCode[]; payment?: DecidedPayment }>(
          `/api/v1/public/records/${ref}`,
          { method: 'POST', body: JSON.stringify(write) },
          proof,
        ),
      );
      return {
        data: out.data,
        children: out.children ?? {},
        rank: typeof out.rank === 'number' ? out.rank : null,
        replayed: out.replayed === true,
        link: linkOf(out.link),
        applied: out.applied ?? [],
        told: out.told ?? [],
        payment: out.payment ?? null,
      };
    },

    async quote<T = Row>(ref: string, write: { values: Row; children?: TreeRows }) {
      const out = await request<Partial<Quote<T>> & { data: T }>(`/api/v1/public/records/${ref}/dry-run`, { method: 'POST', body: JSON.stringify(write) });
      return { data: out.data, children: out.children ?? {}, capacity: out.capacity ?? [], exact: out.exact !== false, nights: out.nights ?? [], postings: out.postings ?? [], applied: out.applied ?? [], told: out.told ?? [], payment: out.payment ?? null };
    },

    async quoteChange<T = Row>(ref: string, id: string, values: Row) {
      const out = await request<{ data: T; exact?: boolean; nights?: QuoteNight[]; children?: Record<string, { data: Row }[]>; postings?: QuotePosting[]; applied?: AppliedReduction[]; told?: ToldOfCode[] }>(
        `/api/v1/public/records/${ref}/${encodeURIComponent(id)}/dry-run`,
        { method: 'POST', body: JSON.stringify({ values }) },
      );
      return { data: out.data, exact: out.exact !== false, nights: out.nights ?? [], children: out.children ?? {}, postings: out.postings ?? [], applied: out.applied ?? [], told: out.told ?? [] };
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

    async requestLink(input) {
      const out = await withProof('claim', null, (proof) =>
        request<{ data: LinkRequested }>(
          '/api/v1/public/claim/link',
          { method: 'POST', body: JSON.stringify(input.lang === undefined ? { email: input.email } : { email: input.email, lang: input.lang }) },
          proof,
        ),
      );
      return out.data;
    },

    async peekLink(token) {
      try {
        const out = await request<{ data: { firstName: string } }>('/api/v1/public/claim/link/peek', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        return out.data.firstName;
      } catch (error) {
        if (error instanceof PublicApiError && error.code === 'LINK_EXPIRED') return null;
        throw error;
      }
    },

    async openLink(token) {
      try {
        const out = await request<{ data: { session: string; expiresAt: number } }>('/api/v1/public/claim/link/verify', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        holdSession({ token: out.data.session, level: 'verified', expiresAt: out.data.expiresAt });
        return true;
      } catch (error) {
        if (error instanceof PublicApiError && error.code === 'LINK_EXPIRED') return false;
        throw error;
      }
    },

    async verifyLinkCode(input) {
      let out: { data: { session: string; expiresAt: number } };
      try {
        out = await request('/api/v1/public/claim/link/verify', {
          method: 'POST',
          body: JSON.stringify({ email: input.email, code: input.code }),
        });
      } catch (error) {
        if (error instanceof PublicApiError && error.code === 'PUBLIC_CODE_WRONG') {
          const left = error.params['triesLeft'];
          return { ok: false, triesLeft: typeof left === 'number' ? left : 0 };
        }
        throw error;
      }
      holdSession({ token: out.data.session, level: 'verified', expiresAt: out.data.expiresAt });
      return { ok: true, level: 'verified', expiresAt: out.data.expiresAt, ended: false };
    },

    async resendLink(token) {
      await withProof('claim', null, (proof) =>
        request<{ data: Record<string, never> }>('/api/v1/public/claim/link/resend', { method: 'POST', body: JSON.stringify({ token }) }, proof),
      );
    },

    async openShared(token) {
      try {
        const out = await request<{ data: { session: string; expiresAt: number; level?: ClaimLevel } }>('/api/v1/public/claim/token', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
        // A row's own link opens a verified session; a shared one a lookup.
        holdSession({ token: out.data.session, level: out.data.level === 'verified' ? 'verified' : 'lookup', expiresAt: out.data.expiresAt });
        return 'opened';
      } catch (error) {
        if (error instanceof PublicApiError && error.code === 'PUBLIC_REF_NOT_FOUND') return 'unknown';
        if (error instanceof PublicApiError && error.code === 'LINK_EXPIRED') return 'closed';
        throw error;
      }
    },

    async file(ref, id, column, signal) {
      const path = `/api/v1/public/files/${encodeURIComponent(ref)}/${encodeURIComponent(String(id))}/${encodeURIComponent(column)}`;
      const headers: Record<string, string> = {
        authorization: `Bearer ${key}`,
        ...(session === null ? {} : { [SESSION_HEADER]: session.token }),
      };
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}${path}`, { headers, ...(signal === undefined ? {} : { signal }) });
      } catch (cause) {
        throw new PublicApiError('PUBLIC_NETWORK_UNAVAILABLE', 0, `could not reach ${baseUrl}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      if (!res.ok) throw await errorOf(res);
      const disposition = res.headers.get('content-disposition') ?? '';
      const named = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
      return {
        blob: await res.blob(),
        filename: named === undefined ? null : decodeURIComponent(named),
        inline: disposition.startsWith('inline'),
      };
    },

    async addOnSettings(addOnKey, signal) {
      const init: RequestInit = {};
      if (signal !== undefined) init.signal = signal;
      const out = await request<{ data: { settings: Record<string, unknown> } }>(`/api/v1/public/add-ons/${encodeURIComponent(addOnKey)}/settings`, init);
      return out.data.settings;
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

    async signOutEverywhere() {
      await request('/api/v1/public/session/revoke-all', { method: 'POST', body: JSON.stringify({}) });
      holdSession(null);
    },

    async forgetMe() {
      await request('/api/v1/public/account', { method: 'DELETE' });
      holdSession(null);
    },

    async newLink(ref, id) {
      await request(`/api/v1/public/records/${ref}/${encodeURIComponent(String(id))}/new-link`, { method: 'POST', body: JSON.stringify({}) });
    },

    adoptSession(next) {
      ended = null;
      holdSession({ token: next.token, level: next.level ?? 'verified', expiresAt: next.expiresAt });
    },

    sessionEnded() {
      return ended;
    },

    isClaimed() {
      return session !== null;
    },

    session() {
      return session === null ? null : { token: session.token, level: session.level, expiresAt: session.expiresAt };
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
      list: (async (options?: AbortSignal | DocumentListOptions) => {
        const paged = options !== undefined && !isSignal(options);
        const signal = paged ? options.signal : options;
        const init: RequestInit = {};
        if (signal !== undefined) init.signal = signal;
        const p = new URLSearchParams();
        if (paged) {
          if (options.ref !== undefined) p.set('ref', options.ref);
          if (options.id !== undefined) p.set('id', String(options.id));
          if (options.kind !== undefined) p.set('kind', options.kind);
          if (options.limit !== undefined) p.set('limit', String(options.limit));
          if (options.cursor !== undefined) p.set('cursor', options.cursor);
        }
        const query = p.toString();
        const out = await send<{ data: PublicDocument[] }>(`/api/v1/public/documents${query === '' ? '' : `?${query}`}`, init);
        return paged ? { data: out.body.data, next: out.headers.get('x-next-cursor') } : out.body.data;
      }) as PublicDocuments['list'],

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
        // 201 is a new document; 200 the one already drawn for this row, unchanged since.
        const out = await send<{ data: PublicDocument }>('/api/v1/public/documents/render', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        return { ...out.body.data, reused: out.status === 200 };
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
