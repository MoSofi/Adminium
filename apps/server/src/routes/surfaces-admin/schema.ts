// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `routes/surfaces-admin` (29-app-surfaces.md §3.1, 29-T17).
 * Mirrored client-side by `studio/apps/hostedAppsApi.ts` — the copied-mirror
 * convention: change both together.
 */
import { z } from 'zod';

export const surfaceSide = z.enum(['staff', 'customer']);
export type SurfaceSideDto = z.infer<typeof surfaceSide>;

export const staffPlacement = z.enum(['internal', 'external']);
export type StaffPlacementDto = z.infer<typeof staffPlacement>;

/**
 * A mapped host's target. The APP KEY vocabulary is the surfaces directory's
 * (`clients`, `clinic`, …) — the same shape the mint flow binds keys with.
 */
export const surfaceDomainTarget = z.object({
  appKey: z.string().min(1).max(64),
  side: surfaceSide,
  /** Which instance this host serves; absent is the app's own mount (29 D9). */
  instance: z.string().min(1).max(32).optional(),
});
export type SurfaceDomainTargetDto = z.infer<typeof surfaceDomainTarget>;

export const surfaceSummary = z.object({
  appKey: z.string(),
  side: surfaceSide,
  /** URL prefix the surface serves under, e.g. `/apps/clients/staff`. */
  prefix: z.string(),
  /**
   * Whether the build emitted a usable `surface.json` nav contract (29 D7).
   * False means "this surface predates the toolkit; internal placement
   * unavailable" — Studio says exactly that, never an empty section.
   */
  navAvailable: z.boolean(),
  /** Items in the emitted nav, 0 when unavailable. */
  navItems: z.number().int().nonnegative(),
  /** Staff surfaces only: where the surface appears (29 D9). Null on customer. */
  staffPlacement: staffPlacement.nullable(),
  /**
   * Customer surfaces only: the newest LIVE key bound to this app — what
   * `surface-config.json` would serve right now. Null on staff surfaces (no
   * key by design) and on customer surfaces with nothing bound.
   */
  boundKey: z
    .object({ id: z.string(), name: z.string(), prefix: z.string() })
    .nullable(),
  /**
   * Staff surfaces only: which connection this surface reads (29 D9). Null
   * means unbound — the app infers "the only connection serving", which is
   * right on a single-connection instance and a guess on any other.
   */
  connectionId: z.string().nullable(),
  /** Hosts currently mapped to this surface, normalized. */
  domains: z.array(z.string()),
});
export type SurfaceSummaryDto = z.infer<typeof surfaceSummary>;

export const surfaceInstance = z.object({
  /** URL segment naming this tenant: `/apps/<appKey>/<slug>/<side>/`. */
  slug: z.string(),
  connectionId: z.string(),
});
export type SurfaceInstanceDto = z.infer<typeof surfaceInstance>;

export const surfacesListReply = z.object({
  surfaces: z.array(surfaceSummary),
  /** The full `surfaces.domains` map — what the domains editor round-trips. */
  domains: z.record(z.string(), surfaceDomainTarget),
  /** Per app, its extra instances — what the instances editor round-trips. */
  instances: z.record(z.string(), z.array(surfaceInstance)),
});

/**
 * Full-map write, like the domains editor and for the same reasons: the screen
 * shows every instance and saves every instance, so REMOVING one needs no
 * second verb, and the audit entry carries a whole before/after rather than a
 * diff to reassemble.
 */
export const surfaceInstancesBody = z.object({
  instances: z
    .record(
      z.string().min(1).max(64),
      z.array(z.object({ slug: z.string().min(1).max(32), connectionId: z.string().min(1) })).max(32),
    )
    .refine((map) => Object.values(map).flat().length <= 128, {
      message: 'at most 128 instances in total',
    }),
});

export const surfaceInstancesReply = z.object({
  instances: z.record(z.string(), z.array(surfaceInstance)),
});

export const surfacePlacementParams = z.object({
  appKey: z.string().min(1).max(64),
});

export const surfacePlacementBody = z.object({
  staff: staffPlacement,
});

export const surfacePlacementReply = z.object({
  appKey: z.string(),
  staff: staffPlacement,
});

/**
 * Full-map write, not a patch: the editor shows the whole map and saves the
 * whole map, so removing a row is expressible without a second verb — and the
 * audit entry carries a complete before/after instead of a diff to reassemble.
 */
export const surfaceDomainsBody = z.object({
  domains: z
    .record(z.string().min(1).max(255), surfaceDomainTarget)
    .refine((map) => Object.keys(map).length <= 64, {
      message: 'at most 64 mapped hosts',
    }),
});

export const surfaceDomainsReply = z.object({
  domains: z.record(z.string(), surfaceDomainTarget),
});

export const surfaceConnectionBody = z.object({
  /** `null` clears the binding and restores the single-connection inference. */
  connectionId: z.string().min(1).nullable(),
});

export const surfaceConnectionReply = z.object({
  appKey: z.string(),
  connectionId: z.string().nullable(),
});
