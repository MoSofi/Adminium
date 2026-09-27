// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WRITE'S CLOCK — which "now" a rule reads, and when it is read.
 *
 * A write reads the time twice, for two different jobs:
 *
 *  - while it PREPARES the row, before any lock: a fill of `now`, a stamp, a
 *    hold's end ten minutes on. These are values the write puts in, and a
 *    few milliseconds either way changes nothing anybody relies on.
 *  - while it JUDGES, holding its locks: whether a hold has ended, whether a
 *    window is open, whether a move comes too early. These decide what
 *    another writer may have. A "now" read before a lock wait of up to ten
 *    seconds could let a guest confirm a hold that ended while they waited,
 *    after another guest was sold the same seats — both would have them.
 *
 * So a write has one clock with two readings: `startedAt`, read once when the
 * write begins, and `locked`, read once INSIDE the transaction, after the
 * locks are held — the first call fixes it, every later call answers the
 * same instant, so every rule of one write judges against one moment.
 *
 * `occurredAt` is the time the writer's device says the thing happened (a
 * door scan made offline and sent later). It stands in for both readings of
 * the row's OWN rules — its stamps, its moves' time windows — and never for a
 * limit shared with other writers: others' holds end on the real clock.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { inTransaction } from './capacity/locks.js';
import type { WriteContext } from './write-context.js';

export interface WriteClock {
  /** The real instant the write began: what the prepare steps read. */
  readonly startedAt: Date;
  /** The device's own time for what the write records, or null (see the header). */
  readonly occurredAt: Date | null;
  /**
   * The real instant the write judges by, fixed by the first call — made
   * inside the transaction, after the write's locks. Refuses a call on a
   * handle outside a transaction: a judge there would hold nothing.
   */
  locked(db: Kysely<SourceDatabase>): Date;
}

/** How to let go of each clock's locked instant, for {@link lockAgain}. */
const UNFIX = new WeakMap<WriteClock, () => void>();

/** A clock for one write. `now` is for tests that fix the time without faking the whole process clock. */
export function writeClock(context?: Pick<WriteContext, 'occurredAt'> | null, now: () => Date = () => new Date()): WriteClock {
  const startedAt = now();
  let fixed: Date | null = null;
  const clock: WriteClock = {
    startedAt,
    occurredAt: context?.occurredAt ?? null,
    locked(db) {
      if (fixed === null) {
        if (!inTransaction(db)) throw new Error('A write judges by its clock inside its transaction, after its locks.');
        fixed = now();
      }
      return fixed;
    },
  };
  UNFIX.set(clock, () => (fixed = null));
  return clock;
}

/**
 * A write that starts its transaction over (its locks named again after a
 * row moved) judges by a new locked instant, read after the new locks: the
 * first attempt's instant is from before a wait of up to ten seconds, and a
 * sale may have closed, or a hold ended, meanwhile.
 */
export function lockAgain(clock: WriteClock): void {
  UNFIX.get(clock)?.();
}

/** "Now" for the row's own stamps: the device's time, else when the write began. */
export function stampNow(clock: WriteClock): Date {
  return clock.occurredAt ?? clock.startedAt;
}

/** "Now" for the row's own conditions (a move's time window), judged under the locks: the device's time, else the locked instant. */
export function ruleNow(clock: WriteClock, db: Kysely<SourceDatabase>): Date {
  return clock.occurredAt ?? clock.locked(db);
}
