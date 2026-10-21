// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rows held for a payment on its way, on an outbox with no column to write
 * the wait into (no due column, no error column). This process keeps them
 * until their wait is up and leaves them out of each batch meanwhile, so a
 * held row never takes the place of rows that may go. Another process does
 * not know them: it holds the same rows again on its own first read.
 */
export interface MemoryHolds {
  /** Keep this row out of the batch until `until`. */
  hold(outboxId: string, pk: unknown, until: number): void;
  /** The keys still waiting on this outbox at `now`, at most `limit`; a wait that is up is forgotten. */
  waiting(outboxId: string, now: number, limit?: number): unknown[];
}

export function createMemoryHolds(): MemoryHolds {
  const held = new Map<string, Map<string, { until: number; pk: unknown }>>();
  return {
    hold(outboxId, pk, until) {
      const mine = held.get(outboxId) ?? new Map<string, { until: number; pk: unknown }>();
      mine.set(String(pk), { until, pk });
      held.set(outboxId, mine);
    },
    waiting(outboxId, now, limit = 500) {
      const mine = held.get(outboxId);
      if (mine === undefined) return [];
      const out: unknown[] = [];
      for (const [key, entry] of mine) {
        if (entry.until <= now) mine.delete(key);
        else if (out.length < limit) out.push(entry.pk);
      }
      if (mine.size === 0) held.delete(outboxId);
      return out;
    },
  };
}
