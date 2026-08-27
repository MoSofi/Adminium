// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for MANAGING the public surface (28-public-surface.md §3.3).
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
 * surface still says nothing (§3.2) — that asymmetry is deliberate and is the
 * whole reason the two namespaces are separate.
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

export const publicKeyDto = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopeId: z.string(),
  side: z.enum(['staff', 'customer']),
  /** Hosted app surface this key is bound to (29 D10), or null. */
  appKey: z.string().nullable(),
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

export const publicKeyCreateBody = z.object({
  name: z.string().min(1).max(80),
  scopeId: z.string().min(1),
  /**
   * Bind the key to a hosted app surface (29 D10): the app's manifest key, the
   * same vocabulary as the surfaces directory. Optional — a key for a
   * standalone build or an integration is bound to nothing.
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

/** The runtime off switch (§3.5 level 2). */
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
});

export const publicApiStateBody = z.object({ enabled: z.boolean() });
