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
import { publicDocumentRequestSchema } from '@adminium/add-on-contracts';
import { z } from 'zod';

import { PUBLIC_ACTIONS, PUBLIC_RESPONSE_SHAPES } from '../../public-api/scope.js';

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
});
export type PublicListQuery = z.infer<typeof publicListQuery>;

/** A day on the venue's calendar and the party asking. */
export const publicAvailabilityQuery = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    party: z.coerce.number().int().min(1).max(1000),
  })
  .strict();

/** Each slot of the day, free or full, and nothing more. */
export const publicAvailabilityReply = z.object({
  data: z.array(z.object({ time: z.string(), state: z.enum(['free', 'full']) })),
});

export const publicRefParams = z.object({
  ref: z.string().min(1).max(64),
});

export const publicRecordParams = z.object({
  ref: z.string().min(1).max(64),
  id: z.string().min(1).max(512),
});

/** `GET /public/config` — what this key may do. Carries no rows. */
export const publicConfigReply = z.object({
  data: z.object({
    version: z.literal(1),
    side: z.enum(['staff', 'customer']),
    /** IANA zone. The client builds every day/minute conversion from this. */
    timezone: z.string(),
    /** ISO-4217, or null when this scope serves no money. */
    currency: z.string().nullable(),
    claim: z
      .object({
        strategy: z.enum(['lookup', 'email-code', 'external']),
        ref: z.string(),
        match: z.array(z.string()),
      })
      .nullable(),
    /**
     * Whether this key may ask for a document to be drawn. Declared because
     * the serializer parses through this schema and drops what it does not
     * name — `publicConfigOf` returning a field is not enough to send it.
     */
    documents: z.object({ create: z.boolean() }),
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
   * rather than merely suggested.
   */
  values: z.record(z.string(), z.unknown()),
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
  /** A guest cancelling closer to the time than the venue allows online (409). */
  'PUBLIC_TOO_LATE',
  'PUBLIC_UPSTREAM_UNAVAILABLE',
  /**
   * The app that made this key at install is switched off (503), or its
   * customer side is. Nothing is wrong with the key or the request; it
   * answers again once the app is switched back on.
   */
  'APP_DISABLED',
  'SURFACE_OFF',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

// --- documents --------------------------

/**
 * `POST /public/documents/render`.
 *
 * Two shapes, one route. `{profileId, ref, id}` draws from a PERSISTED row the
 * caller's claim already reaches; the inline form draws from values it sends.
 * Both refuse anything the server stamps itself — `business`, `now`,
 * `currency`, `entity`, `number` — which is what stops the door being a way to
 * put a stranger's text under the operator's letterhead.
 */
export const publicDocumentRenderBody = z.union([
  z
    .object({
      profileId: z.string().min(1).max(40),
      /** The resource the row lives on, so the claim can be checked. */
      ref: z.string().min(1).max(80),
      id: z.union([z.string().max(200), z.number()]),
      locale: z.string().min(2).max(35).optional(),
    })
    .strict(),
  publicDocumentRequestSchema,
]);

export const publicDocumentsQuery = z.object({
  ref: z.string().min(1).max(80).optional(),
  id: z.union([z.string().max(200), z.number()]).optional(),
});

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
  rows: z.array(z.record(z.string(), z.unknown())).max(PUBLIC_BATCH_MAX * 4),
});
