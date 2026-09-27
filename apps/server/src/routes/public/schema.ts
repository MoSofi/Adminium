// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the public namespace.
 *
 * Every `/api/` route must declare a schema or `buildServer` throws at boot
 * (`app.ts`), so these are load-bearing rather than documentation.
 *
 * ── THE WIRE CARRIES CODES, NOT PROSE ─────────────────────────────── The
 * error envelope here is `{ code, params }` with a developer-facing `message`
 * that is explicitly NOT for display. The frontend renders from its own
 * catalogue keyed by the code. That is what makes the localization constraint
 * free on this surface instead of deferred — there is no English on the wire
 * to translate later — and it avoids serving translation bundles to anonymous
 * callers, which `routes/i18n/index.ts` refuses in writing.
 */
import { z } from 'zod';

import { PUBLIC_ACTIONS, PUBLIC_RESPONSE_SHAPES } from '../../public-api/scope.js';
import { rowValues } from '../../security/nul-bytes.js';

/** Mirrors `recordListQuery` (routes/data/schema.ts), narrowed for this surface. */
export const publicListQuery = z.object({
  /**
   * Present for shape-compatibility with the dashboard's list DSL and IGNORED:
   * the scope's `expose` set is the complete column list and a request cannot
   * widen it. Accepted rather than rejected so a generated client can share one
   * query builder across both surfaces.
   */
  select: z.string().max(2048).optional(),
  where: z.string().max(4096).optional(),
  q: z.string().max(256).optional(),
  order: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  cursor: z.string().max(2048).optional(),
  // No `count`: the vocabulary is `none` and nothing else.
  /** Named only to be refused: a code a guest types is sent in the `x-adminium-code` header, never in a URL. */
  code: z.string().max(64).optional(),
});
export type PublicListQuery = z.infer<typeof publicListQuery>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * What an availability read asks, in one of two forms, told apart by the
 * table's rule:
 *
 *  - a CAPACITY table (a restaurant): `date` and the `party` asking;
 *  - a BOOKING table (a clinic): the `kind` of visit, the `resource` — one
 *    person's key, or `any` — and either one `date` (every time of that day)
 *    or `from` + `days` (a strip of days, up to 31). `exclude` names a row the
 *    asker's own session reaches, so moving their visit is not blocked by it.
 *
 * One object rather than a union, because a querystring schema is one object;
 * the route refuses a mixture.
 */
export const publicAvailabilityQuery = z
  .object({
    date: day.optional(),
    party: z.coerce.number().int().min(1).max(1000).optional(),
    kind: z.string().min(1).max(200).optional(),
    resource: z.string().min(1).max(200).optional(),
    from: day.optional(),
    days: z.coerce.number().int().min(1).max(31).optional(),
    exclude: z.string().min(1).max(400).optional(),
    /** A limit's pools: the last day of a stay's nights (exclusive), the guests a room must sleep, how far to look for the earliest arrival. */
    to: day.optional(),
    guests: z.coerce.number().int().min(1).max(50).optional(),
    earliest: z.coerce.number().int().min(1).max(90).optional(),
    /** A parent limit: the rows under this value of the entry's `under` column, and how many a page wants. */
    under: z.string().min(1).max(200).optional(),
    qty: z.coerce.number().int().min(1).max(50).optional(),
    /** A typed code that unlocks rows only it shows. */
    code: z.string().min(1).max(64).optional(),
  })
  .strict();
export type PublicAvailabilityQuery = z.infer<typeof publicAvailabilityQuery>;

/**
 * Each time of the day, free or full — or, for a strip of days, how many
 * times each day has free and whether it is open, full or closed. Nothing
 * more: no row, no name, no count per person.
 */
export const publicAvailabilityReply = z.object({
  data: z.union([
    // A paused time is a slot limit's with pauses; a released one says free or full only.
    z.array(z.object({ time: z.string(), state: z.enum(['free', 'full', 'paused']) })),
    z.array(z.object({ date: z.string(), open: z.number().int(), state: z.enum(['open', 'full', 'closed']) })),
    // A parent limit's rows (ticket types), and a night limit's pools (room types): `left` only when the entry shows it.
    z.array(z.object({ id: z.string(), state: z.enum(['on', 'soon', 'ended', 'soldout']), left: z.number().int().optional() })),
    z.array(
      z.object({ pool: z.string(), state: z.enum(['open', 'full', 'closed']), left: z.number().int().optional(), earliest: z.string().nullable().optional() }),
    ),
  ]),
  /** A night limit asked with `earliest`: the first arrival of the same length where any fitting pool is open. */
  earliest: z.string().nullable().optional(),
});

export const publicRefParams = z.object({
  ref: z.string().min(1).max(64),
});

export const publicRecordParams = z.object({
  ref: z.string().min(1).max(64),
  id: z.string().min(1).max(512),
});

/** One child table in `/public/config`, and the one level below it. */
const publicConfigGrandchild = z.object({ writable: z.array(z.string()), select: z.array(z.string()), max: z.number().int() });
const publicConfigChild = publicConfigGrandchild.extend({ children: z.record(z.string(), publicConfigGrandchild).optional() });

/** `GET /public/config` — what this key may do. Carries no rows. */
export const publicConfigReply = z.object({
  data: z.object({
    version: z.literal(1),
    side: z.enum(['staff', 'customer']),
    /** IANA zone. The client builds every day/minute conversion from this. */
    timezone: z.string(),
    /** The server's clock when this was answered (ISO): a page whose device clock is wrong still asks for the venue's today. */
    now: z.string(),
    /** ISO-4217, or null when this scope serves no money. */
    currency: z.string().nullable(),
    claim: z
      .object({
        /**
         * `email-link`: the person asks for a link by address and nothing
         * else opens a session. `token`: a shared link opens one row
         * (`POST /public/claim/token`).
         */
        strategy: z.enum(['lookup', 'email-code', 'external', 'email-link', 'token']),
        ref: z.string(),
        match: z.array(z.string()),
        /**
         * `email-code`: a found session can be raised to `verified` by a code
         * emailed to the person. `email-link`: sessions come only from a link.
         */
        verify: z.enum(['email-code', 'email-link']).optional(),
      })
      .nullable(),
    /**
     * Whether this key may ask for a document to be drawn. Declared because
     * the serializer parses through this schema and drops what it does not
     * name — `publicConfigOf` returning a field is not enough to send it.
     */
    documents: z.object({ create: z.boolean() }),
    /** Where this key's pictures are asked for (`<base>/<ref>/<rowId>/<column>/<fileId>`); absent when it shows none. */
    pictures: z.string().optional(),
    refs: z.record(
      z.string(),
      z.object({
        actions: z.array(z.enum(PUBLIC_ACTIONS)),
        expose: z.array(z.string()),
        filterable: z.array(z.string()),
        searchable: z.array(z.string()),
        orderable: z.array(z.string()),
        writable: z.array(z.string()),
        limit: z.number().int(),
        /** How a list of this ref answers. */
        response: z.object({ shape: z.enum(PUBLIC_RESPONSE_SHAPES) }),
        /** Present on an availability ref: ask `/availability/<ref>`, never `/records`. */
        kind: z.literal('availability').optional(),
        /** On an availability ref: the kind of limit it answers — a slot, a parent's pool, or nights. */
        capacity: z.enum(['slot', 'parent', 'night']).optional(),
        /** The child rows a create may carry, by name: what each writes and shows, and how many at most. */
        children: z.record(z.string(), publicConfigChild).optional(),
        /** The create (or change) may be tried without writing (`…/dry-run`). */
        dryRun: z.literal(true).optional(),
        /** Rows listed only with the code that unlocks them, sent in the `x-adminium-code` header; none without one. */
        unlock: z.literal(true).optional(),
        /** Image columns any visitor may see, at `/public/pictures`. */
        pictures: z.array(z.string()).optional(),
      }),
    ),
  }),
});

export const publicListReply = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  page: z
    .object({
      limit: z.number().int(),
      offset: z.number().int(),
      /** Always null on this surface. */
      total: z.number().int().nullable(),
    })
    .optional(),
  cursor: z.object({ next: z.string().nullable() }).optional(),
});

/**
 * A list's three shapes: `wrapped` above, the bare rows, or one
 * bare row. Which one a ref answers is on `/public/config`.
 */
export const publicListShapes = z.union([
  // Strict, so a single row that happens to hold a `data` column is not read
  // as the wrapped shape and stripped of its other columns.
  publicListReply.strict(),
  z.array(z.record(z.string(), z.unknown())),
  z.record(z.string(), z.unknown()),
]);

export const publicRecordReply = z.object({
  data: z.record(z.string(), z.unknown()),
  /**
   * A create on an endpoint that ranks: how many matching rows are ordered at
   * or before the new one ("you are 3rd on the list"). No other row is told.
   */
  rank: z.number().int().optional(),
});

/**
 * The error envelope. `code` is the contract and never translates.
 *
 * Kept structurally identical for every failure so that a 404 for an unknown
 * ref and a 404 for a forbidden one are byte-identical (enumeration rule) — the
 * dashboard's envelope carries `details` and a `requestId`, both of which would
 * distinguish them.
 */
export const publicErrorReply = z.object({
  error: z.object({
    code: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
    /** For a developer reading a network tab. Never rendered to an end user. */
    message: z.string(),
  }),
});

export type PublicErrorReply = z.infer<typeof publicErrorReply>;

/** `POST /public/records/:ref` and `PATCH …/:id` — writes. */
export const publicWriteBody = z.object({
  /**
   * Column → value. Allow-listed against the scope's `writable` set, and any
   * column the scope declares a `default` for is OVERWRITTEN server-side
   * regardless of what arrives here — that is what makes a default immutable
   * rather than merely suggested. Left to the write service for U+0000,
   * which names the column (`security/nul-bytes.ts`).
   */
  values: rowValues(z.record(z.string(), z.unknown())),
});

/*
 * ── A CREATE WITH ITS CHILD ROWS ─────────────────────────────────────────
 * The rows below the created one, by the name the wire uses, two levels at
 * most (spelled out, so the schema has no recursion); two hundred rows per
 * list here, and two hundred in all where the write is judged.
 */
const treeValues = rowValues(z.record(z.string(), z.unknown()));
const publicTreeGrandchildren = z.record(z.string().min(1).max(64), z.array(z.object({ values: treeValues }).strict()).max(200));
export const publicTreeChildren = z.record(
  z.string().min(1).max(64),
  z.array(z.object({ values: treeValues, children: publicTreeGrandchildren.optional() }).strict()).max(200),
);
export type PublicTreeChildren = z.infer<typeof publicTreeChildren>;

/** The price a guest was shown, as a decimal string: the save refuses a different one. */
const publicExpect = z.object({ total: z.string().regex(/^-?\d{1,15}(?:\.\d{1,6})?$/) }).strict();

/** `POST /public/records/:ref` — a create, with the rows below it and the price expected. */
export const publicCreateBody = publicWriteBody.extend({
  children: publicTreeChildren.optional(),
  expect: publicExpect.optional(),
  /**
   * The page's own-link session for the hold the new one replaces (a
   * checkout changed before it was confirmed): that hold is let go in the
   * same write, and the session moves to the new hold. Only a session opens
   * it — never a typed address.
   */
  replaces: z.string().min(8).max(128).optional(),
});

/** `POST /public/records/:ref/dry-run` — the same create, tried without writing. */
export const publicDryRunBody = publicWriteBody.extend({
  children: publicTreeChildren.optional(),
  /** The page's own-link session for the hold the create would replace: judged as let go, never moved. */
  replaces: z.string().min(8).max(128).optional(),
});

/** `PATCH …/:id` — a change, and the price expected after it. */
export const publicUpdateBody = publicWriteBody.extend({ expect: publicExpect.optional() });

/** One written row of a tree as a reply carries it: its shown columns, and its own rows below. */
const publicTreeReplyGrandchildren = z.record(z.string(), z.array(z.object({ data: z.record(z.string(), z.unknown()) })));
export const publicTreeReplyChildren = z.record(
  z.string(),
  z.array(z.object({ data: z.record(z.string(), z.unknown()), children: publicTreeReplyGrandchildren.optional() })),
);

/** A create's reply: the row, the rows written below it, and — for a retry of one already made — `replayed`. */
/**
 * The new row's own link, answered once by the create that made it: the key
 * that opens it, its code, and a session already open on it for this page (so
 * a confirmation page opens the row without claiming the code first).
 */
export const publicCreatedLink = z.object({
  key: z.string(),
  token: z.string(),
  session: z.string().optional(),
  expiresAt: z.number().int().optional(),
});

export const publicCreateReply = publicRecordReply.extend({
  children: publicTreeReplyChildren.optional(),
  replayed: z.literal(true).optional(),
  link: publicCreatedLink.optional(),
});

/** A dry run's reply: every figure a save would write, and how the limits it takes from stand. */
export const publicDryRunReply = z.object({
  data: z.record(z.string(), z.unknown()),
  children: publicTreeReplyChildren.optional(),
  capacity: z.array(z.object({ pool: z.string(), state: z.enum(['available', 'full']), at: z.string().optional() })),
  /** False when a before hook runs on a table of the write: a dry run runs none, so a save may differ. */
  exact: z.boolean(),
  /** A row priced by the night: each night, its rate and the names of what was added to it. */
  nights: z.array(z.object({ date: z.string(), rate: z.string(), tags: z.array(z.string()) })).optional(),
});

/** A dry run of a change: the row as the change would leave it. */
export const publicChangeQuoteReply = z.object({
  data: z.record(z.string(), z.unknown()),
  /** False when a before hook runs on the change: a dry run runs none, so the save may differ. */
  exact: z.boolean(),
  /** A row priced by the night: the nights the change would leave it with. */
  nights: z.array(z.object({ date: z.string(), rate: z.string(), tags: z.array(z.string()) })).optional(),
  /** The rows below it a change moves (extras that follow a stay's nights), as it would leave them: by the ref each is read through. */
  children: z.record(z.string(), z.array(z.object({ data: z.record(z.string(), z.unknown()) }))).optional(),
});

/** `POST /public/claim` — the end-customer identity check. */
export const publicClaimBody = z.object({
  /**
   * Exactly the columns the scope's `claim.match` declares, no more and no
   * fewer. Compared with equality only; `resolveClaim` refuses anything else.
   */
  match: z.record(z.string(), z.unknown()),
});

export const publicClaimReply = z.object({
  data: z.object({
    /** `adm_pubs_…`. The client sends it back in `x-adminium-public-session`. */
    session: z.string(),
    expiresAt: z.number().int(),
    /** A row's own link opens its session `verified`; said so the page knows what it may read. */
    level: z.enum(['lookup', 'verified']).optional(),
  }),
});

/**
 * `POST /public/claim/code`: a code to the claimed person's address (`verify`)
 * or to a new one (`email-change`, from a verified session).
 */
export const publicCodeBody = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('verify') }).strict(),
  z.object({ purpose: z.literal('email-change'), email: z.string().min(3).max(254) }).strict(),
]);

export const publicCodeReply = z.object({
  data: z.object({
    /** The address, masked: `l•••@e•••.com`, the whole domain only for the big mail providers. */
    sentTo: z.string(),
    /** Seconds before another code may be asked for. */
    resendAfter: z.number().int(),
    expiresAt: z.number().int(),
  }),
});

/** `GET /public/challenge`: a proof of work for a write or a claim. */
export const publicChallengeQuery = z.object({ purpose: z.enum(['write', 'claim']) }).strict();

export const publicChallengeReply = z.object({
  data: z.object({
    /** Sent back as `x-adminium-proof: <id>.<nonce>`. */
    id: z.string(),
    salt: z.string(),
    /** Leading zero bits `sha256(salt + nonce)` must start with. */
    difficulty: z.number().int(),
    expiresAt: z.number().int(),
  }),
});

/** `POST /public/claim/verify`: the code typed back. */
export const publicVerifyBody = z
  .object({ purpose: z.enum(['verify', 'email-change']).default('verify'), code: z.string().min(1).max(12) })
  .strict();

export const publicVerifyReply = z.object({
  data: z.object({
    level: z.enum(['lookup', 'verified']),
    expiresAt: z.number().int(),
    /** An address change: the new address, masked. */
    email: z.string().optional(),
  }),
});

/** Every code this surface can emit. Exported so the client can mirror it. */
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
   * A project hook refused the write. The one code whose `message` is meant
   * for people: it is the project's own text, passed through unchanged.
   */
  'PUBLIC_WRITE_REJECTED',
  /**
   * The time a booking asks for has no room left (409), or another guest is
   * booking it this instant (`BUSY`, try again). Says no more than that
   * time's availability does.
   */
  'PUBLIC_SLOT_FULL',
  'PUBLIC_SLOT_BUSY',
  /**
   * What a line asks for is sold out (409): tickets of a type, today's
   * portions of a dish. `params.column` names the line's column; on a create
   * with child rows, `child`, `index` and `path` name the row. Never how many
   * are left.
   */
  'PUBLIC_SOLD_OUT',
  /** No room of the type asked for is free on one of the nights (409). `params.column` names it. */
  'PUBLIC_NO_ROOM',
  /** A guest cancelling closer to the time than the venue allows online (409). */
  'PUBLIC_TOO_LATE',
  /**
   * The write came to a different price than the one the guest was shown
   * (409): `params.total` is what it would have saved, `params.lines` its
   * rows' figures. Nothing was written.
   */
  'PUBLIC_PRICE_CHANGED',
  /**
   * The caller's own row is not yet inside the endpoint's time window (409):
   * `params.at` is the row's time and `params.from` when the window opens,
   * both instants. Said only when nothing but the window stood in the way.
   */
  'PUBLIC_TOO_EARLY',
  /**
   * The resource needs a VERIFIED session and this one only found the person
   * (403): confirm the emailed code first. Said only to a session the resource
   * would otherwise take.
   */
  'PUBLIC_CLAIM_LEVEL',
  /** A signed-in person already holds as many open rows here as the endpoint allows (409). */
  'PUBLIC_LIMIT_REACHED',
  /** The app has switched this off in its settings (online booking, new patients online) (403). */
  'PUBLIC_SWITCHED_OFF',
  /**
   * A staff-bound key (a kiosk's) used without its staff member signed in on
   * this screen, from this page, holding the key's role (403). One code for
   * every reason.
   */
  'PUBLIC_STAFF_REQUIRED',
  /** A key the app switched off in its settings row (the kiosk switch) (503). */
  'PUBLIC_KEY_OFF',
  /** The claimed person has no address a code could go to (409): ring the desk. */
  'PUBLIC_CLAIM_NO_EMAIL',
  /** Too many wrong codes for this person today (403): the desk can lift it. */
  'PUBLIC_CLAIM_LOCKED',
  /** Another code was sent a moment ago (429, `retryAfter` seconds). */
  'PUBLIC_CODE_TOO_SOON',
  /** This session has asked for as many codes as it may (429). */
  'PUBLIC_CODE_LIMIT',
  /** The last code died of wrong tries; this session waits (429, `retryAfter`). */
  'PUBLIC_CODE_LOCKED',
  /** That code is not right (403, `triesLeft`). */
  'PUBLIC_CODE_WRONG',
  /** No code is open for this session: expired, used or replaced (410). */
  'PUBLIC_CODE_EXPIRED',
  /** No code can be sent from this server right now (503). */
  'PUBLIC_CODE_UNAVAILABLE',
  /** Changing the address needs a code confirmed in the last few minutes (403). */
  'PUBLIC_CODE_STEP_UP',
  /** The address was changed today already (429). */
  'PUBLIC_EMAIL_CHANGE_LIMIT',
  /** A proof of work is missing, wrong, expired or already used (403): ask for a challenge. */
  'PUBLIC_PROOF_REQUIRED',
  'PUBLIC_UPSTREAM_UNAVAILABLE',
  /**
   * The app that made this key at install is switched off (503), or its
   * customer side is. Nothing is wrong with the key or the request; it
   * answers again once the app is switched back on.
   */
  'APP_DISABLED',
  'SURFACE_OFF',
  /** A sign-in or shared link that opens nothing any more: used, expired, stopped or taken back (410). */
  'LINK_EXPIRED',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

// --- documents --------------------------

export const publicDocumentParams = z.object({ id: z.string().min(1).max(40) });

/**
 * What a claimed caller may see of their own document.
 *
 * NOT the subject. A document's frozen subject carries every mapped table's
 * values, including ones the operator never meant a customer to read — the
 * staff route redacts it per grant and there is no equivalent grant here.
 * What a customer needs is what it is, when, and where the bytes are.
 */
export const publicDocumentReply = z.object({
  data: z.object({
    id: z.string(),
    kind: z.string(),
    number: z.string().nullable(),
    status: z.string(),
    delivery: z.string().nullable(),
    format: z.string(),
    locale: z.string(),
    createdAt: z.number(),
    hasContent: z.boolean(),
  }),
});

export const publicDocumentsReply = z.object({
  data: z.array(publicDocumentReply.shape.data),
});

/** The most rows one batch may carry (the comp's number). */
export const PUBLIC_BATCH_MAX = 500;

/**
 * `POST /public/records/:ref/batch`. The array's own bound is loose on
 * purpose: 0 or more than {@link PUBLIC_BATCH_MAX} rows is the write refusal
 * the caller's code handles, not the query refusal a malformed body gets.
 */
export const publicBatchBody = z.object({
  /** Each row's values, left to the write service for U+0000; a row's key is judged by the route. */
  rows: z.array(rowValues(z.record(z.string(), z.unknown()))).max(PUBLIC_BATCH_MAX * 4),
});

// --- signing in by an emailed link, and a row shared by link --------------

/** A link's token as the page read it from the fragment: 32 bytes, base64url. */
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'a sign-in link token');

/** `POST /public/claim/link` — the address, and the language the email is written in. */
export const linkStartBody = z
  .object({
    email: z.string().min(3).max(254),
    /** A language tag (`fr`, `pt-BR`); the browser's own when absent. */
    lang: z.string().min(2).max(35).optional(),
  })
  .strict();

/** The same answer for any address: where it went, masked as the caller typed it. */
export const linkStartReply = z.object({ data: z.object({ sentTo: z.string() }) });

/** `POST /public/claim/link/peek` and `/resend`: the token alone. */
export const linkTokenBody = z.object({ token: tokenSchema }).strict();

/** `POST /public/claim/link/verify`: the link's token, or the address and the code on another device. */
export const linkVerifyBody = z.union([
  z.object({ token: tokenSchema }).strict(),
  z.object({ email: z.string().min(3).max(254), code: z.string().min(1).max(12) }).strict(),
]);

/** The name the link's page greets its person by — the first name, and nothing else. */
export const linkPeekReply = z.object({ data: z.object({ firstName: z.string() }) });

export const linkVerifyReply = z.object({
  data: z.object({
    /** `adm_pubs_…`, sent back in `x-adminium-public-session`. */
    session: z.string(),
    expiresAt: z.number().int(),
    level: z.literal('verified'),
  }),
});

/** `POST /public/claim/token`: the code from a shared link's fragment, as typed or pasted. */
export const tokenClaimBody = z.object({ token: z.string().min(8).max(40) }).strict();

/** A resend always answers the same: nothing about the link or its person. */
export const linkResendReply = z.object({ data: z.object({}) });
