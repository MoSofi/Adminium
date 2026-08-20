// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the public namespace (28-public-surface.md §3.1).
 *
 * Every `/api/` route must declare a schema or `buildServer` throws at boot
 * (`app.ts`), so these are load-bearing rather than documentation.
 *
 * ── THE WIRE CARRIES CODES, NOT PROSE (§3.6) ───────────────────────────────
 * The error envelope here is `{ code, params }` with a developer-facing
 * `message` that is explicitly NOT for display. The frontend renders from its
 * own catalogue keyed by the code. That is what makes the localization
 * constraint free on this surface instead of deferred — there is no English on
 * the wire to translate later — and it avoids serving translation bundles to
 * anonymous callers, which `routes/i18n/index.ts` refuses in writing.
 */
import { z } from 'zod';

/** Mirrors `recordListQuery` (routes/data/schema.ts), narrowed per D5. */
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
  // No `count`: the vocabulary is `none` and nothing else (D5 d).
});
export type PublicListQuery = z.infer<typeof publicListQuery>;

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
    refs: z.record(
      z.string(),
      z.object({
        actions: z.array(z.enum(['read', 'create', 'update'])),
        expose: z.array(z.string()),
        filterable: z.array(z.string()),
        searchable: z.array(z.string()),
        orderable: z.array(z.string()),
        writable: z.array(z.string()),
        limit: z.number().int(),
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
      /** Always null on this surface — see D5(d). */
      total: z.number().int().nullable(),
    })
    .optional(),
  cursor: z.object({ next: z.string().nullable() }).optional(),
});

export const publicRecordReply = z.object({
  data: z.record(z.string(), z.unknown()),
});

/**
 * The error envelope. `code` is the contract and never translates.
 *
 * Kept structurally identical for every failure so that a 404 for an unknown
 * ref and a 404 for a forbidden one are byte-identical (§3.2's enumeration
 * rule) — the dashboard's envelope carries `details` and a `requestId`, both of
 * which would distinguish them.
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

/** `POST /public/records/:ref` and `PATCH …/:id` — writes (28-T18). */
export const publicWriteBody = z.object({
  /**
   * Column → value. Allow-listed against the scope's `writable` set, and any
   * column the scope declares a `default` for is OVERWRITTEN server-side
   * regardless of what arrives here — that is what makes a default immutable
   * rather than merely suggested.
   */
  values: z.record(z.string(), z.unknown()),
});

/** `POST /public/claim` — the end-customer identity check (28-T19). */
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
  'PUBLIC_UPSTREAM_UNAVAILABLE',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];
