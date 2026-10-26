// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calls already taken, kept in memory for as long as each could still be
 * replayed.
 *
 * ─── Why in memory, and not a table ────────────────────────────────────────
 * A signed call carries its own time, and a call older than the window is
 * refused as stale (`stale`). So a replay only has to be caught INSIDE the
 * window, and nothing kept here needs to outlive a few minutes. A table would
 * keep it across a restart, which buys little and costs a real loss: a server
 * that crashed after taking a call but before writing its events would refuse
 * the service's retry as a replay, and the bounce would be lost. In memory,
 * the retry after a restart passes.
 *
 * What a replay that slips through (a restart inside the window, or another
 * server process) can do: put the same addresses on the list again, which
 * changes nothing. Mailgun is the one service whose signature does not cover
 * the body, so a replayed signature with a new body is the real threat there;
 * the window bounds it.
 *
 * Bounded: only calls whose signature verified are claimed, so only a real
 * service fills it; past the bound the oldest keys go first.
 */
import type { ReplayGuard } from './types.js';

const DEFAULT_MAX = 10_000;

export function createReplayGuard(options: { max?: number; now?: () => number } = {}): ReplayGuard {
  const max = options.max ?? DEFAULT_MAX;
  const now = options.now ?? Date.now;
  // Insertion order is age order: the first key is the oldest.
  const kept = new Map<string, number>();

  const prune = (): void => {
    const at = now();
    for (const [key, until] of kept) if (until <= at) kept.delete(key);
    while (kept.size >= max) {
      const oldest = kept.keys().next();
      if (oldest.done === true) break;
      kept.delete(oldest.value);
    }
  };

  return {
    claim(key, until) {
      const held = kept.get(key);
      if (held !== undefined && held > now()) return false;
      if (kept.size >= max) prune();
      kept.delete(key);
      kept.set(key, until);
      return true;
    },
    release(key) {
      kept.delete(key);
    },
  };
}
