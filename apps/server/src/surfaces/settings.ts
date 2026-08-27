// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two placement settings, cached (29-app-surfaces.md D9).
 *
 * ── WHY THESE ARE CACHED AND `settingsRepo.get()` IS NOT ───────────────────
 * There is no settings cache in this server; `get()` is a bare SELECT. That is
 * fine for a settings page and wrong for these two, because `surfaces.domains`
 * is consulted on EVERY REQUEST — Host routing has to decide, before anything
 * else, whether this request belongs to a mapped surface or to the dashboard.
 * A meta-store round trip per request to answer "no, as usual" would make the
 * feature cost something on instances that never use it.
 *
 * Same shape as `public-api/enabled.ts` and for the same reasons: short TTL,
 * explicit invalidation from the write path so a Studio save is immediate, and
 * in-flight de-duplication so a cold cache under load issues one query rather
 * than one per concurrent request.
 *
 * ── FAIL OPEN, NOT CLOSED — the opposite of the public gate ────────────────
 * When the read throws, this answers "no mappings, no placements". That reads
 * like failing closed and is worth naming as the deliberate opposite of
 * `enabled.ts`: there, guessing wrong publishes a database; here, guessing
 * wrong takes the DASHBOARD away from an operator on a host they can still
 * reach. Empty means the dashboard serves everywhere, which is the state the
 * instance was in before anyone attached a domain, and is always recoverable.
 */

import { settingsRepo, type MetaDb } from '@adminium/meta';

import type { SurfaceSide } from '../cli/surfaces-root.js';

export type StaffPlacement = 'internal' | 'external';

export interface DomainMapping {
  appKey: string;
  side: SurfaceSide;
  /** The instance this host serves; absent is the app's own mount. */
  instance?: string | undefined;
}

export interface SurfaceSettings {
  apps: Record<
    string,
    {
      staff?: StaffPlacement | undefined;
      connectionId?: string | undefined;
      /** Extra tenants of the same app, each at `/apps/<key>/<slug>/<side>/`. */
      instances?: { slug: string; connectionId: string }[] | undefined;
    }
  >;
  domains: Record<string, DomainMapping>;
}

const EMPTY: SurfaceSettings = { apps: {}, domains: {} };

export interface SurfaceSettingsCache {
  read: () => Promise<SurfaceSettings>;
  /** Called by the write path so an operator's save takes effect at once. */
  invalidate: () => void;
}

/** Same five seconds as the public-API gate — one TTL to reason about. */
export const SURFACE_SETTINGS_TTL_MS = 5_000;

export interface SurfaceSettingsOptions {
  meta: MetaDb;
  ttlMs?: number;
  now?: () => number;
}

export function createSurfaceSettings(opts: SurfaceSettingsOptions): SurfaceSettingsCache {
  const ttl = opts.ttlMs ?? SURFACE_SETTINGS_TTL_MS;
  const now = opts.now ?? Date.now;
  const settings = settingsRepo(opts.meta);

  let value: SurfaceSettings | null = null;
  let expiresAt = 0;
  let inFlight: Promise<SurfaceSettings> | null = null;

  const refresh = async (): Promise<SurfaceSettings> => {
    try {
      // Both keys in one refresh: they are read together by every consumer and
      // two independent TTLs would let the placement and the domain map
      // disagree for a few seconds after a save that changed both.
      const [apps, domains] = await Promise.all([
        settings.get('surfaces.apps'),
        settings.get('surfaces.domains'),
      ]);
      const next: SurfaceSettings = {
        apps: apps ?? {},
        domains: domains ?? {},
      };
      value = next;
      expiresAt = now() + ttl;
      return next;
    } catch {
      // Do not cache the failure: a transient blip must not keep a mapped
      // domain dark for the whole TTL after the store recovers.
      value = null;
      expiresAt = 0;
      return EMPTY;
    } finally {
      inFlight = null;
    }
  };

  return {
    async read() {
      if (value !== null && now() < expiresAt) return value;
      inFlight ??= refresh();
      return inFlight;
    },
    invalidate() {
      value = null;
      expiresAt = 0;
    },
  };
}

/**
 * Is this app's staff surface blended into the dashboard?
 *
 * DEFAULT INTERNAL. Hosted is the normal case (28 D25), the whole point of this
 * wave is that an operator should not need a second place to go, and an
 * operator who wants the app on its own is opting OUT — a decision they make
 * once, in Studio, and which is therefore worth storing. The inverse default
 * would leave every freshly installed app invisible until someone found a
 * toggle they had no reason to look for.
 */
export function staffPlacementOf(settings: SurfaceSettings, appKey: string): StaffPlacement {
  return settings.apps[appKey]?.staff ?? 'internal';
}

/**
 * Which connection an app's STAFF surface reads, or null to keep inferring.
 *
 * Null is the pre-binding behaviour and stays the default: the app falls back
 * to "the only connection serving", which is correct on the single-connection
 * instance nearly every install is. It only becomes a guess once a second
 * connection exists, which is exactly when an operator has a reason to come
 * here and answer.
 */
export function staffConnectionOf(settings: SurfaceSettings, appKey: string): string | null {
  return settings.apps[appKey]?.connectionId ?? null;
}

/** Extra instances declared for an app, in declaration order. Never null. */
export function instancesOf(
  settings: SurfaceSettings,
  appKey: string,
): { slug: string; connectionId: string }[] {
  return settings.apps[appKey]?.instances ?? [];
}

/**
 * The connection ONE mount reads: an instance's own, or the app's root binding.
 *
 * `slug === null` is the unslugged mount that has always existed. Keeping both
 * cases in one function is what stops the two from drifting into different
 * answers for the same app.
 */
export function connectionForMount(
  settings: SurfaceSettings,
  appKey: string,
  slug: string | null,
): string | null {
  if (slug === null) return staffConnectionOf(settings, appKey);
  return instancesOf(settings, appKey).find((i) => i.slug === slug)?.connectionId ?? null;
}

/**
 * Compare hosts the way `Host` and a stored mapping can differ but still mean
 * the same machine: case, and an explicit default port.
 *
 * Shared with `security/csrf.ts`'s `normalizeHost` rather than re-derived —
 * two host comparisons that disagree by a colon is exactly the bug that would
 * present as "the domain works on http but not behind the proxy".
 */
export function domainMappingFor(
  settings: SurfaceSettings,
  host: string | undefined,
  normalize: (host: string) => string,
): DomainMapping | null {
  if (host === undefined || host === '') return null;
  const wanted = normalize(host);
  for (const [mapped, target] of Object.entries(settings.domains)) {
    if (normalize(mapped) === wanted) return target;
  }
  return null;
}
