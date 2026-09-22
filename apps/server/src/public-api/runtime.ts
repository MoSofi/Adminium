// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public surface's shared runtime: the schema-view cache, the key
 * resolver, and the throttle on the two `touch` writes.
 *
 * ── WHY THIS IS NOT INSIDE `routes/public` ─────────────────────────────────
 * The resolver caches a compiled scope per token for 30 s. It used to be built
 * inside the public plugin, so nothing else could reach it. The admin routes
 * called `invalidateResolver` on revoke, rotate and scope edit, and compose had
 * no resolver to hand them, so each call did nothing. A revoked key kept
 * working until its cache entry expired. `compose.ts` now builds
 * ONE runtime and hands the same resolver to both plugins. The plugin still
 * builds its own when none is passed, for route tests that mount it alone.
 *
 * ── PER PROCESS ────────────────────────────────────────────────────────────
 * Every cache here lives in this process. With several replicas, an
 * invalidation reaches the replica that served the admin request, and the
 * others catch up when their entries expire (≤ 30 s for keys). The revision
 * watch below bounds the key-cache lag with a shared counter; the view cache
 * above still relies on its own TTL, which is the documented cost
 * (the same one the rate limiter already carries).
 */

import {
  connectionTenantConfig,
  overridesRepo,
  publicKeysRepo,
  publicScopesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';
import type { DatabaseModel } from '@adminium/engine';

import { applyOverrides } from '../connections/effective-schema.js';
import { SnapshotView } from '../crud/identifiers.js';
import { createPublicKeyResolver, type PublicKeyResolver, type ResolveFailure } from './resolve.js';

export interface PublicViews {
  /** The effective schema for a connection — same stamping as `routes/data`. */
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
}

/**
 * The view cache.
 *
 * The stamp is read from the snapshot's METADATA row, never the schema
 * payload. The whole model is fetched and decoded only when the stamp moves.
 * Before, every public request read and parsed the full snapshot just to learn
 * that nothing had changed.
 */
export function createPublicViews(meta: MetaDb): PublicViews {
  const snapshots = snapshotsRepo(meta);
  const overrides = overridesRepo(meta);
  const cache = new Map<string, { stamp: string; view: SnapshotView }>();

  return {
    async viewFor(connectionId) {
      const head = await snapshots.latestMeta(connectionId);
      if (head === null) return null;
      const active = await overrides.listForConnection(connectionId, { status: 'active' });
      const last = active.at(-1);
      const stamp = `${head.id}:${String(active.length)}:${last?.id ?? ''}:${String(last?.updatedAt ?? 0)}`;
      const cached = cache.get(connectionId);
      if (cached !== undefined && cached.stamp === stamp) return cached.view;
      const snapshot = await snapshots.findById(head.id);
      // Deleted between the two reads: answer as if there were none, and let
      // the next request stamp again.
      if (snapshot === null) return null;
      const view = new SnapshotView(connectionId, applyOverrides(snapshot.schema as DatabaseModel, active));
      cache.set(connectionId, { stamp, view });
      return view;
    },
  };
}

export interface PublicResolverOptions {
  /** Server-side only; see `resolve.ts`. */
  onFailure?: (reason: ResolveFailure, detail: Record<string, unknown>) => void;
  now?: () => number;
}

export function createPublicResolver(
  meta: MetaDb,
  views: PublicViews,
  opts: PublicResolverOptions = {},
): PublicKeyResolver {
  const keys = publicKeysRepo(meta);
  const scopes = publicScopesRepo(meta);
  return createPublicKeyResolver({
    findKeysByPrefix: (prefix) => keys.findByPrefix(prefix),
    findScopeById: (id) => scopes.findById(id),
    /*
     * Column existence, so `compileScope` refuses a scope naming a column the
     * table no longer has. Resolved from the same snapshot the query will run
     * against, which is what makes the refusal meaningful rather than advisory.
     */
    columnsOf: async (connectionId) => {
      const view = await views.viewFor(connectionId);
      if (view === null) return undefined;
      return (table: string) => {
        try {
          return new Set(view.table(table).columns.keys());
        } catch {
          return null;
        }
      };
    },
    /*
     * The tenant's zone and currency live on the CONNECTION, and a scope
     * inherits them when it does not state its own. Read here rather than
     * baked into the scope document so that changing a business's zone is one
     * edit, not one edit per scope — and so a surface with no scope at all
     * (one Adminium hosts itself) can reach the same value.
     */
    tenantConfigOf: async (connectionId) => {
      const row = await connectionTenantConfig(meta, connectionId);
      return row === null ? undefined : row;
    },
    ...(opts.onFailure === undefined ? {} : { onFailure: opts.onFailure }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });
}

/** One `last_used_at` / `last_seen_at` write per row per minute, per process. */
export const PUBLIC_TOUCH_INTERVAL_MS = 60_000;

/** Past this many remembered rows, entries older than the interval are dropped. */
const TOUCH_PRUNE_AT = 10_000;

export interface TouchThrottle {
  /** True when `id` has not been written in the last interval. Records the write. */
  due: (id: string) => boolean;
}

/**
 * Every successful public request used to issue an UPDATE for its key, and
 * every claimed request one more for its session. On the one surface that
 * answers strangers, that is a write per read.
 *
 * The throttle is per process. The repo's write is also monotonic, so a
 * replica holding an older time never moves the column backwards.
 */
export function createTouchThrottle(
  intervalMs: number = PUBLIC_TOUCH_INTERVAL_MS,
  now: () => number = Date.now,
): TouchThrottle {
  const last = new Map<string, number>();
  return {
    due(id) {
      const at = now();
      const previous = last.get(id);
      if (previous !== undefined && at - previous < intervalMs) return false;
      if (last.size >= TOUCH_PRUNE_AT) {
        for (const [seen, t] of last) if (at - t >= intervalMs) last.delete(seen);
      }
      last.set(id, at);
      return true;
    },
  };
}

/**
 * Notices when another process changed what keys may do.
 *
 * Every revoke, rotate, key create, scope edit and endpoint save advances one
 * shared revision in the meta store. The process that served the change
 * empties its own caches at once; every OTHER process learns of it here, on
 * the on/off gate's refresh — at most every 5 s, and in a query the gate was
 * making anyway — and drops its cached keys. That bounds cross-replica lag at
 * the gate's TTL with no per-request cost.
 *
 * A failed read changes nothing: the gate fails closed on its own read, and a
 * revision that could not be read has not moved.
 */
export function createRevisionWatch(read: () => Promise<number>, onMove: () => void): () => Promise<void> {
  let seen: number | null = null;
  return async () => {
    let revision: number;
    try {
      revision = await read();
    } catch {
      return;
    }
    if (seen !== null && revision !== seen) onMove();
    seen = revision;
  };
}
