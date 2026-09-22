// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Requests · 24h" — the public API's request counts.
 *
 * ── APPROXIMATE, ON PURPOSE ────────────────────────────────────────────────
 * Each request adds one to an in-process counter keyed by (key, ref, hour).
 * A minute timer and the server's shutdown flush the counters into
 * `adminium_public_request_stats` by ADDING to the stored bucket, so several
 * processes flushing into the same hour sum correctly. A crash loses under a
 * minute of counts. It is a display figure, and the page says "approximate".
 *
 * ── WHAT A FLUSH NEVER DOES ────────────────────────────────────────────────
 * It never retries. The counters are swapped out BEFORE the writes, so a
 * request counted during a flush lands in the next one, and a write that
 * fails is logged once and dropped: a failed batch kept for the next minute
 * would fail again with the next minute's counts on top, and a stuck meta
 * store would grow this map without bound.
 *
 * Only a RESOLVED key and ref is counted. A 401 has no key to charge, and a
 * flood of them would otherwise be the cheapest way to fill this table.
 */

import type { PublicRequestCount } from '@adminium/meta';

export const HOUR_MS = 3_600_000;

export interface RequestStats {
  /** One request by a resolved key on a ref; `error` when it answered ≥ 400. */
  record: (keyId: string, ref: string, error: boolean, at?: number) => void;
  /** Write everything counted so far. Safe to call concurrently. */
  flush: () => Promise<void>;
  /** Counters not yet flushed (test seam). */
  pending: () => number;
}

export interface RequestStatsDeps {
  add: (count: PublicRequestCount) => Promise<void>;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export function createRequestStats(deps: RequestStatsDeps): RequestStats {
  const now = deps.now ?? Date.now;
  let counts = new Map<string, PublicRequestCount>();

  return {
    record(keyId, ref, error, at = now()) {
      const bucket = Math.floor(at / HOUR_MS) * HOUR_MS;
      const id = JSON.stringify([keyId, ref, bucket]);
      const existing = counts.get(id);
      if (existing === undefined) {
        counts.set(id, { keyId, ref, bucket, requests: 1, errors: error ? 1 : 0 });
      } else {
        existing.requests += 1;
        if (error) existing.errors += 1;
      }
    },
    async flush() {
      if (counts.size === 0) return;
      const batch = counts;
      counts = new Map();
      let failed = false;
      for (const count of batch.values()) {
        try {
          await deps.add(count);
        } catch (error) {
          if (!failed) deps.onError?.(error);
          failed = true;
        }
      }
    },
    pending() {
      return counts.size;
    },
  };
}
