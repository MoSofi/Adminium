// SPDX-License-Identifier: AGPL-3.0-only
/**
 * viewDaysRepo — adminium_view_days (0096): how many times strangers saw a
 * page or a form on one of the business's days.
 *
 * Written only by the server's counter, which adds counts up in memory and
 * flushes them once a minute: {@link ViewDaysRepo.add} ADDS to the day's row,
 * never replaces it, so several processes flushing into one day sum
 * correctly. The add is the meta store's portable upsert (UPDATE, then
 * INSERT, then on a duplicate key UPDATE again), never `onConflict`, and not
 * for use inside a transaction (a duplicate key aborts a Postgres one). A
 * zero is refused: on MySQL an UPDATE that changes nothing reports no row,
 * and the INSERT after it would meet the key.
 *
 * Read by the staff views route, a day range at a time, and swept daily by
 * the keeping setting.
 */
import type { MetaDb } from '../connect.js';
import { VIEW_DAY_WIDTH, VIEW_INSTALL_WIDTH, VIEW_KIND_WIDTH, VIEW_PLACE_WIDTH, VIEW_THING_WIDTH } from '../migrations/0096_view_days.js';
import { affected, isDuplicateKeyError } from './util.js';

export { VIEW_DAY_WIDTH, VIEW_INSTALL_WIDTH, VIEW_KIND_WIDTH, VIEW_PLACE_WIDTH, VIEW_THING_WIDTH };

/** One (install, kind, thing, place, day) and the views to add to it. */
export interface ViewDayCount {
  installId: string;
  kind: string;
  thing: string;
  /** `''` for none. */
  place: string;
  /** `YYYY-MM-DD`. */
  day: string;
  views: number;
}

/** One stored day of one thing. */
export type ViewDayRow = ViewDayCount;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Refuses what the table cannot hold: an empty or too-long key, a malformed day, a count that is no whole number of 1 or more. */
export function checkViewDay(count: ViewDayCount): void {
  if (count.installId.length === 0 || count.installId.length > VIEW_INSTALL_WIDTH) throw new Error('A view count\'s install id is empty or longer than its column.');
  if (count.kind.length === 0 || count.kind.length > VIEW_KIND_WIDTH) throw new Error('A view count\'s kind is empty or longer than its column.');
  if (count.thing.length === 0 || count.thing.length > VIEW_THING_WIDTH) throw new Error('A view count\'s thing is empty or longer than its column.');
  if (count.place.length > VIEW_PLACE_WIDTH) throw new Error('A view count\'s place is longer than its column.');
  if (count.day.length !== VIEW_DAY_WIDTH || !DAY_RE.test(count.day)) throw new Error('A view count\'s day is written YYYY-MM-DD.');
  if (!Number.isSafeInteger(count.views) || count.views < 1) throw new Error('A view count adds a whole number of 1 or more; a zero is never written.');
}

export function viewDaysRepo(meta: MetaDb) {
  const { db } = meta;
  const table = 'adminium_view_days' as const;

  /** Add to an existing row; answers whether one was there. */
  const addTo = async (count: ViewDayCount): Promise<boolean> => {
    const res = await db
      .updateTable(table)
      .set((eb) => ({ views: eb('views', '+', count.views) }))
      .where('installId', '=', count.installId)
      .where('kind', '=', count.kind)
      .where('thing', '=', count.thing)
      .where('place', '=', count.place)
      .where('day', '=', count.day)
      .executeTakeFirst();
    return affected(res.numUpdatedRows) === 1;
  };

  return {
    /**
     * ADD these views to the day's row (made when there is none). Two
     * processes may both find the day empty and both INSERT: the loser's
     * duplicate is answered by adding to the winner's row.
     */
    async add(count: ViewDayCount): Promise<void> {
      checkViewDay(count);
      if (await addTo(count)) return;
      try {
        await db.insertInto(table).values({ installId: count.installId, kind: count.kind, thing: count.thing, place: count.place, day: count.day, views: count.views }).execute();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        await addTo(count);
      }
    },

    /**
     * The stored days of some things of one install and kind, from `from` to
     * `to` (days, both included), oldest first; `place` narrows to one place.
     */
    async read(opts: { installId: string; kind: string; things: readonly string[]; from: string; to: string; place?: string | undefined }): Promise<ViewDayRow[]> {
      if (opts.things.length === 0) return [];
      let query = db
        .selectFrom(table)
        .select(['installId', 'kind', 'thing', 'place', 'day', 'views'])
        .where('installId', '=', opts.installId)
        .where('kind', '=', opts.kind)
        .where('thing', 'in', [...opts.things])
        .where('day', '>=', opts.from)
        .where('day', '<=', opts.to);
      if (opts.place !== undefined) query = query.where('place', '=', opts.place);
      const rows = await query.orderBy('day').orderBy('thing').orderBy('place').execute();
      // A bigint comes back as text on Postgres.
      return rows.map((row) => ({ ...row, views: Number(row.views) }));
    },

    /** The daily sweep: every day before `day` (`YYYY-MM-DD`). Answers how many rows went. */
    async purgeBefore(day: string): Promise<number> {
      if (!DAY_RE.test(day)) throw new Error('A view count\'s day is written YYYY-MM-DD.');
      const res = await db.deleteFrom(table).where('day', '<', day).executeTakeFirst();
      return affected(res.numDeletedRows);
    },
  };
}

export type ViewDaysRepo = ReturnType<typeof viewDaysRepo>;
