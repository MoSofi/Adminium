// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for MANAGING the public surface.
 *
 * These are the ADMIN routes — `/public-scopes`, `/public-keys`, and the off
 * switch — served under the ordinary `/api/v1` block behind
 * `system:api-keys:manage`. They are a different namespace from `routes/public`
 * on purpose: that one is answered anonymously and returns codes, this one is
 * session-authenticated and returns the dashboard's envelope like every other
 * admin route.
 */
import { z } from 'zod';

export const publicScopeDto = z.object({
  id: z.string(),
  connectionId: z.string(),
  side: z.enum(['staff', 'customer']),
  name: z.string(),
  timezone: z.string(),
  /** The scope document, verbatim. The operator authored it; they may read it. */
  document: z.string(),
  proposedFromManifest: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** How many keys point at this scope — what a delete would break. */
  keyCount: z.number().int(),
});
export type PublicScopeDto = z.infer<typeof publicScopeDto>;

export const publicScopeListReply = z.object({ scopes: z.array(publicScopeDto) });

export const publicScopeCreateBody = z.object({
  connectionId: z.string().min(1),
  side: z.enum(['staff', 'customer']),
  name: z.string().min(1).max(80),
  /**
   * The document as JSON text, not as a parsed object.
   *
   * `compileScope` is the only thing allowed to interpret it, and it runs
   * server-side against the live snapshot. Accepting a parsed object here would
   * mean two validators — Zod's and the compiler's — and the one that matters
   * is the compiler.
   */
  document: z.string().min(2).max(256_000),
});

export const publicScopeUpdateBody = z.object({
  name: z.string().min(1).max(80).optional(),
  document: z.string().min(2).max(256_000).optional(),
});

export const publicScopeIdParams = z.object({ id: z.string().min(1) });

/**
 * A compile failure, rendered for the author.
 *
 * This is the one place scope issues are shown in full: the operator is the
 * person who wrote the document and must be able to fix it. The anonymous
 * surface still says nothing — that asymmetry is deliberate and is the whole
 * reason the two namespaces are separate.
 */
export const publicScopeIssuesReply = z.object({
  issues: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      ref: z.string().optional(),
      column: z.string().optional(),
    }),
  ),
});

const issueDto = z.object({
  code: z.string(),
  message: z.string(),
  ref: z.string().optional(),
  column: z.string().optional(),
});

/** A key's grant on one endpoint, as the Access cell reads it. */
export const publicKeyAccessDto = z.object({
  /** Null for a key on a hand-written scope, and for an endpoint that is gone. */
  endpointId: z.string().nullable(),
  ref: z.string().nullable(),
  path: z.string().nullable(),
  /** What the key can do on it NOW. */
  methods: z.array(z.string()),
  /** Granted, but the endpoint no longer offers them — struck in the UI. */
  suspended: z.array(z.string()),
});

export const publicKeyDto = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopeId: z.string(),
  /** The connection the key's scope reads. */
  connectionId: z.string().nullable(),
  /** `browser` | `server`. */
  kind: z.enum(['browser', 'server']),
  access: z.array(publicKeyAccessDto),
  /**
   * The key's stored document compiled against the schema as it is now.
   * Non-empty means the key is DARK — every request is refused —
   * although it is neither revoked nor expired.
   */
  issues: z.array(issueDto),
  side: z.enum(['staff', 'customer']),
  /** Hosted app surface this key is bound to, or null. */
  appKey: z.string().nullable(),
  /** Which of an app's browser keys: `customer`, or a name the app gave a second one (`kiosk`). */
  purpose: z.string(),
  /** A second key answers only alongside a signed-in staff member holding this app role. */
  requiresStaff: z.object({ appKey: z.string(), roleSlug: z.string() }).nullable(),
  origins: z.array(z.string()),
  expiresAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PublicKeyDto = z.infer<typeof publicKeyDto>;

export const publicKeyListReply = z.object({ keys: z.array(publicKeyDto) });

const methodSchema = z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'BATCH']);

/**
 * Two ways to make a key. One names a connection and the
 * endpoints × methods it may call (`access`), and Adminium derives the scope.
 * The original way names a hand-written `scopeId`, which keeps working.
 * Exactly one of the two is required; the handler says which is missing.
 */
export const publicKeyCreateBody = z.object({
  name: z.string().min(1).max(80),
  scopeId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
  /** `browser` (default): `adm_pub_`, revealable. `server`: `adm_srv_`, shown once. */
  kind: z.enum(['browser', 'server']).optional(),
  access: z
    .array(
      z.object({
        ref: z.string().min(1).max(64),
        methods: z.array(methodSchema).max(6),
        /** A generated endpoint's source and column fingerprint, as the sheet showed them. */
        source: z.string().min(1).max(256).optional(),
        selectHash: z.string().min(1).max(64).optional(),
      }),
    )
    .max(500)
    .optional(),
  /**
   * Bind the key to a hosted app surface: the app's manifest key, the same
   * vocabulary as the surfaces directory. Optional — a key for a standalone
   * build or an integration is bound to nothing.
   */
  appKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'an app key is lowercase: letters, digits, - and _')
    .optional(),
  origins: z.array(z.string().min(1).max(256)).max(32).optional(),
  expiresAt: z.number().int().positive().optional(),
});

/**
 * Create and reveal.
 *
 * `token` is here AND on `GET /public-keys/:id/reveal`, which is the difference
 * from `adm_sk_`: a publishable secret lives in a public bundle and has to be
 * recoverable months later for a rebuild. See `public-api/keys.ts` for why that
 * is a bounded weakening rather than a hole.
 */
export const publicKeyCreateReply = z.object({ key: publicKeyDto, token: z.string() });
export const publicKeyRevealReply = z.object({ token: z.string() });
export const publicKeyIdParams = z.object({ id: z.string().min(1) });
export const publicKeyOkReply = z.object({ ok: z.literal(true) });

/** The runtime off switch (level 2). */
export const publicApiStateReply = z.object({
  /** Level 2 — the settings boolean the operator controls. */
  enabled: z.boolean(),
  /**
   * Level 1 — whether `ADMINIUM_PUBLIC_API_ORIGINS` opted this instance in at
   * all. Read-only here: it is an env var and a restart, and the page has to
   * say so rather than offering a toggle that silently does nothing.
   */
  registered: z.boolean(),
  origins: z.array(z.string()),
  /**
   * Whether `/api-docs` and `GET /api/v1/api-docs` are served.
   * Independent of `enabled`: an operator may publish the page before the API
   * is on, and the page then says the API is off.
   */
  docsEnabled: z.boolean(),
});

/**
 * Either switch, or both. A body naming neither is refused rather
 * than read as "change nothing", which would audit a toggle that did not
 * happen.
 */
export const publicApiStateBody = z
  .object({ enabled: z.boolean().optional(), docsEnabled: z.boolean().optional() })
  .refine((body) => body.enabled !== undefined || body.docsEnabled !== undefined, {
    message: 'Name at least one of "enabled" and "docsEnabled".',
  });

/** `GET /public-api/stats` — the keys page's third tile. */
export const publicApiStatsQuery = z.object({ connectionId: z.string().min(1).optional() });
export const publicApiStatsReply = z.object({
  /** Approximate: counted in memory and flushed each minute. */
  requests24h: z.number().int(),
  errors24h: z.number().int(),
});

/* ------------------------------------------------------------ endpoints */

export const publicEndpointsQuery = z.object({ connectionId: z.string().min(1) });

export const publicEndpointParams = z.object({
  connectionId: z.string().min(1),
  ref: z.string().min(1).max(64),
});

export const publicEndpointDto = z.object({
  /** Null for a generated default nobody has stored yet. */
  id: z.string().nullable(),
  ref: z.string(),
  path: z.string(),
  origin: z.enum(['generated', 'custom']),
  stored: z.boolean(),
  /** The definition as stored (or, for a virtual default, as it would be) — what the pane shows. */
  definition: z.string(),
  /** The source table's id, or null when the definition does not parse. */
  source: z.string().nullable(),
  /** The methods the definition offers. */
  methods: z.array(z.string()),
  /** Send back with a key create that grants a virtual default. */
  selectHash: z.string().nullable(),
  /** Every issue against the current schema; empty when the endpoint is sound. */
  issues: z.array(issueDto),
});

export const publicEndpointSourceDto = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['table', 'view', 'materialized-view']),
  /** Null when unknown (SQLite, or never estimated) — the segment is dropped. */
  rowCountEstimate: z.number().nullable(),
  icon: z.string().nullable(),
  /** Secret columns are never listed. */
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      primaryKey: z.boolean(),
      /** Marked personal data; off by default and refused on an `anon` endpoint. */
      pii: z.boolean(),
    }),
  ),
});

export const publicEndpointListReply = z.object({
  /** False when the connection has never been introspected: stored rows only, nothing generated. */
  snapshot: z.boolean(),
  endpoints: z.array(publicEndpointDto),
  methods: z.array(z.string()),
  sources: z.array(publicEndpointSourceDto),
  /** Tables with no generated endpoint, and why — so the builder can say so. */
  unaddressable: z.array(
    z.object({
      tableId: z.string(),
      reason: z.enum(['no-slug', 'slug-collision', 'ref-taken', 'nothing-selectable']),
      ref: z.string().nullable(),
      collidesWith: z.array(z.string()),
    }),
  ),
});

const keyRefDto = z.object({ id: z.string(), name: z.string(), prefix: z.string(), scopeId: z.string() });

const wideningDto = keyRefDto.extend({
  gains: z.array(
    z.object({ ref: z.string(), methods: z.array(z.string()), columns: z.array(z.string()), rows: z.boolean() }),
  ),
});

export const publicEndpointCheckBody = z.object({
  connectionId: z.string().min(1),
  ref: z.string().min(1).max(64),
  /** The definition as JSON text — the pane's own words, compiled server-side. */
  definition: z.string().min(2).max(64_000),
});

export const publicEndpointCheckReply = z.object({
  issues: z.array(issueDto),
  /** Live keys the save would break. */
  keys: z.array(keyRefDto),
  keysStillBroken: z.array(keyRefDto),
  /** Live browser keys that would gain methods, columns or rows. */
  widened: z.array(wideningDto),
});

export const publicEndpointSaveBody = z.object({ definition: z.string().min(2).max(64_000) });

export const publicEndpointSaveReply = z.object({
  endpoint: publicEndpointDto,
  keysStillBroken: z.array(keyRefDto),
  widened: z.array(wideningDto),
});

export const publicEndpointRenameBody = z.object({ ref: z.string().min(1).max(64) });

export const publicEndpointDeleteReply = z.object({
  ok: z.literal(true),
  /** A generated endpoint is switched off rather than deleted. */
  outcome: z.enum(['deleted', 'switched-off']),
});
