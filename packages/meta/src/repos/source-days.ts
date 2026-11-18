// SPDX-License-Identifier: AGPL-3.0-only
/**
 * sourceDaysRepo — adminium_source_days (0099): the calls each source of a
 * lead source add-on was asked on a UTC day, per spender (a staff member's
 * id, the automation step `step`, or the day's total `*`), and the calls
 * running now.
 *
 * Written only by the engine's call to a source. Every change a cap guards
 * is ONE statement, so two calls at once cannot both pass a cap: a
 * reservation adds to what is held only where what was made and what is held
 * still leave room for it.
 */
import type { MetaDb } from '../connect.js';
import { SOURCE_DAY_DAY_WIDTH, SOURCE_DAY_INSTALL_WIDTH, SOURCE_DAY_SOURCE_WIDTH, SOURCE_DAY_SPENDER_WIDTH } from '../migrations/0099_source_days.js';
import { affected, isDuplicateKeyError } from './util.js';

export { SOURCE_DAY_DAY_WIDTH, SOURCE_DAY_INSTALL_WIDTH, SOURCE_DAY_SOURCE_WIDTH, SOURCE_DAY_SPENDER_WIDTH };

/** The spender that is the day's total over everybody. */
export const SOURCE_DAY_TOTAL = '*';
/** The spender that is the automation step. */
export const SOURCE_DAY_STEP = 'step';

/** One spender's day on one source of one install. */
export interface SourceDayKey {
  installId: string;
  source: string;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  spender: string;
}

export interface SourceDay {
  calls: number;
  held: number;
  changedAt: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC day a moment falls on, as the count keys it. */
export function sourceDayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

const whole = (n: number, what: string): void => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`A source day's ${what} is a whole number, 0 or more.`);
};

function checkKey(key: SourceDayKey): void {
  if (key.installId.length === 0 || key.installId.length > SOURCE_DAY_INSTALL_WIDTH) throw new Error('A source day install id is empty or longer than its column.');
  if (key.source.length === 0 || key.source.length > SOURCE_DAY_SOURCE_WIDTH) throw new Error('A source day source id is empty or longer than its column.');
  if (key.spender.length === 0 || key.spender.length > SOURCE_DAY_SPENDER_WIDTH) throw new Error('A source day spender is empty or longer than its column.');
  if (key.day.length !== SOURCE_DAY_DAY_WIDTH || !DAY_RE.test(key.day)) throw new Error('A source day is written YYYY-MM-DD.');
}

export function sourceDaysRepo(meta: MetaDb) {
  const { db } = meta;
  const table = 'adminium_source_days' as const;
  const insert = async (key: SourceDayKey, calls: number, held: number, at: number): Promise<boolean> => {
    try {
      await db.insertInto(table).values({ installId: key.installId, source: key.source, day: key.day, spender: key.spender, calls, held, changedAt: at }).execute();
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  };
  return {
    /** One spender's day, or null when nothing was reserved or made on it. */
    async day(key: SourceDayKey): Promise<SourceDay | null> {
      checkKey(key);
      const row = await db
        .selectFrom(table)
        .select(['calls', 'held', 'changedAt'])
        .where('installId', '=', key.installId)
        .where('source', '=', key.source)
        .where('day', '=', key.day)
        .where('spender', '=', key.spender)
        .executeTakeFirst();
      return row === undefined ? null : { calls: Number(row.calls), held: Number(row.held), changedAt: Number(row.changedAt) };
    },

    /**
     * Hold one call of the day's `limit` (null: no limit, held all the same so
     * the day's count is right), in one statement: held only when what was
     * made and what is held leave room for one more. Answers whether it was.
     */
    async reserve(key: SourceDayKey, limit: number | null, at: number): Promise<boolean> {
      checkKey(key);
      if (limit !== null) whole(limit, 'limit');
      if (limit !== null && limit < 1) return false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let update = db
          .updateTable(table)
          .set((eb) => ({ held: eb('held', '+', 1), changedAt: at }))
          .where('installId', '=', key.installId)
          .where('source', '=', key.source)
          .where('day', '=', key.day)
          .where('spender', '=', key.spender);
        if (limit !== null) update = update.where((eb) => eb(eb('calls', '+', eb.ref('held')), '<=', limit - 1));
        const updated = await update.executeTakeFirst();
        if (affected(updated.numUpdatedRows) > 0) return true;
        const there = await db
          .selectFrom(table)
          .select('day')
          .where('installId', '=', key.installId)
          .where('source', '=', key.source)
          .where('day', '=', key.day)
          .where('spender', '=', key.spender)
          .executeTakeFirst();
        if (there !== undefined) return false;
        // A day with no row starts with this hold (made at most once: two first calls at once meet the key).
        if (await insert(key, 0, 1, at)) return true;
      }
      return false;
    },

    /**
     * A call ended: count `counted` calls (0 for a call never made) and let
     * go of the one it held, in one statement.
     */
    async settle(key: SourceDayKey, counted: number, at: number): Promise<void> {
      checkKey(key);
      whole(counted, 'count');
      const updated = await db
        .updateTable(table)
        .set((eb) => ({ calls: eb('calls', '+', counted), held: eb('held', '-', 1), changedAt: at }))
        .where('installId', '=', key.installId)
        .where('source', '=', key.source)
        .where('day', '=', key.day)
        .where('spender', '=', key.spender)
        .where('held', '>=', 1)
        .executeTakeFirst();
      if (affected(updated.numUpdatedRows) > 0) return;
      // Nothing held (no call settles twice; a day that turned over, say): the count is kept all the same.
      if (counted === 0) return;
      const counting = await db
        .updateTable(table)
        .set((eb) => ({ calls: eb('calls', '+', counted), changedAt: at }))
        .where('installId', '=', key.installId)
        .where('source', '=', key.source)
        .where('day', '=', key.day)
        .where('spender', '=', key.spender)
        .executeTakeFirst();
      if (affected(counting.numUpdatedRows) > 0) return;
      if (!(await insert(key, counted, 0, at))) {
        await db
          .updateTable(table)
          .set((eb) => ({ calls: eb('calls', '+', counted), changedAt: at }))
          .where('installId', '=', key.installId)
          .where('source', '=', key.source)
          .where('day', '=', key.day)
          .where('spender', '=', key.spender)
          .execute();
      }
    },

    /** An install is gone: every day of every source of it goes too. Answers how many rows went. */
    async forgetInstall(installId: string): Promise<number> {
      const deleted = await db.deleteFrom(table).where('installId', '=', installId).executeTakeFirst();
      return affected(deleted.numDeletedRows);
    },

    /** The sweep: every day before `day` (`YYYY-MM-DD`). Answers how many rows went. */
    async pruneBefore(day: string): Promise<number> {
      if (!DAY_RE.test(day)) throw new Error('A source day is written YYYY-MM-DD.');
      const deleted = await db.deleteFrom(table).where('day', '<', day).executeTakeFirst();
      return affected(deleted.numDeletedRows);
    },
  };
}

export type SourceDaysRepo = ReturnType<typeof sourceDaysRepo>;
