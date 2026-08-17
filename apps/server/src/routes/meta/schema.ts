// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the meta-placement resource (naming per 08-server-api.md §1.5:
 * `<resource><Action><Part>` consts, `z.infer` PascalCase types).
 */
import { z } from 'zod';

/**
 * `GET /meta/placement` — where Adminium's own tables currently live, and
 * whether this instance is able to move them.
 *
 * The DSN is NOT returned, only the engine and the §7.2 rung it came from. A
 * meta DSN is a credential, and the wizard's question ("are you still on the
 * embedded store?") is answerable without one.
 */
export const metaPlacementReply = z.object({
  data: z.object({
    /** Which §7.2 rung answered: `env`, `bootstrap`, or `embedded`. */
    source: z.enum(['env', 'bootstrap', 'embedded']),
    engine: z.enum(['postgres', 'mysql', 'sqlite']),
    /** True when the store is the §3.1 OD-1 embedded SQLite fallback. */
    embedded: z.boolean(),
    /**
     * False when relocation cannot work here, with `reason` saying why — an
     * `ADMINIUM_META_URL` that would override the setup file, or a topology
     * whose host cannot restart itself. The wizard uses this to decide whether
     * to offer the move or explain its absence.
     */
    canRelocate: z.boolean(),
    reason: z.string().nullable(),
  }),
});
export type MetaPlacementReply = z.infer<typeof metaPlacementReply>;

export const metaRelocateBody = z
  .object({
    /**
     * Where the `adminium_*` tables should live. Bounded but not parsed here,
     * for the reason `bridge/schema.ts` gives: the connection-string grammar
     * has one owner (`meta/store.ts`'s `metaEngineFromUrl`, reached inside the
     * service), and a second, looser copy at the door would be a second thing
     * to keep in sync.
     */
    dsn: z.string().min(1).max(4096),
  })
  // `.strict()` like the other credential-bearing bodies: an unknown key beside
  // a DSN should be a rejection, not something silently dropped.
  .strict();
export type MetaRelocateBody = z.infer<typeof metaRelocateBody>;

/**
 * `POST /meta/relocate` — the copy has committed and the server is about to
 * restart against the new store.
 *
 * `restarting: true` is the point of the reply. The connection carrying it is
 * about to be closed on purpose, so the client is told to expect that and to
 * wait for `/api/v1/healthz` rather than treat the dropped socket as an error.
 */
export const metaRelocateReply = z.object({
  data: z.object({
    engine: z.enum(['postgres', 'mysql', 'sqlite']),
    /** Rows copied, summed across every table. */
    rowsCopied: z.number().int().nonnegative(),
    restarting: z.boolean(),
    /** Poll this until it answers; the server is back when it does. */
    healthPath: z.string(),
  }),
});
export type MetaRelocateReply = z.infer<typeof metaRelocateReply>;
