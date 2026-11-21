// SPDX-License-Identifier: AGPL-3.0-only
/**
 * calendarFeedsRepo — adminium_calendar_feeds (0101): the nonce each person's
 * private calendar link carries. Replacing it ends the old link.
 */
import { randomBytes } from 'node:crypto';

import type { MetaDb } from '../connect.js';
import { CALENDAR_FEED_APP_WIDTH, CALENDAR_FEED_CONNECTION_WIDTH, CALENDAR_FEED_ROW_WIDTH, CALENDAR_FEED_TABLE_WIDTH } from '../migrations/0101_calendar_feeds.js';
import { isDuplicateKeyError } from './util.js';

export { CALENDAR_FEED_APP_WIDTH, CALENDAR_FEED_CONNECTION_WIDTH, CALENDAR_FEED_ROW_WIDTH, CALENDAR_FEED_TABLE_WIDTH };

/** One person's feed: the database, the app, the booked table and the person's row. */
export interface CalendarFeedKey {
  connectionId: string;
  appKey: string;
  tableName: string;
  rowKey: string;
}

const newNonce = (): string => randomBytes(16).toString('hex');

function fits(key: CalendarFeedKey): boolean {
  return (
    key.connectionId.length <= CALENDAR_FEED_CONNECTION_WIDTH &&
    key.appKey.length <= CALENDAR_FEED_APP_WIDTH &&
    key.tableName.length <= CALENDAR_FEED_TABLE_WIDTH &&
    key.rowKey.length > 0 &&
    key.rowKey.length <= CALENDAR_FEED_ROW_WIDTH
  );
}

export function calendarFeedsRepo(meta: MetaDb) {
  const { db } = meta;
  const table = 'adminium_calendar_feeds' as const;
  const where = (key: CalendarFeedKey) =>
    db
      .selectFrom(table)
      .select('nonce')
      .where('connectionId', '=', key.connectionId)
      .where('appKey', '=', key.appKey)
      .where('tableName', '=', key.tableName)
      .where('rowKey', '=', key.rowKey);

  return {
    /** The nonce of a person's live link, or null when they have none. */
    async nonceOf(key: CalendarFeedKey): Promise<string | null> {
      if (!fits(key)) return null;
      return (await where(key).executeTakeFirst())?.nonce ?? null;
    },

    /** The nonce of a person's link, made the first time it is asked for. Null for a key no column can hold. */
    async ensure(key: CalendarFeedKey, at: number): Promise<string | null> {
      if (!fits(key)) return null;
      const held = await where(key).executeTakeFirst();
      if (held !== undefined) return held.nonce;
      const nonce = newNonce();
      try {
        await db.insertInto(table).values({ ...key, nonce, changedAt: at, changedBy: null }).execute();
        return nonce;
      } catch (error) {
        // Two first looks at once: the one that landed is the link.
        if (!isDuplicateKeyError(error)) throw error;
        return (await where(key).executeTakeFirst())?.nonce ?? null;
      }
    },

    /** A new nonce: the old link stops now. Null for a key no column can hold. */
    async renew(key: CalendarFeedKey, by: string | null, at: number): Promise<string | null> {
      if (!fits(key)) return null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const nonce = newNonce();
        const updated = await db
          .updateTable(table)
          .set({ nonce, changedAt: at, changedBy: by })
          .where('connectionId', '=', key.connectionId)
          .where('appKey', '=', key.appKey)
          .where('tableName', '=', key.tableName)
          .where('rowKey', '=', key.rowKey)
          .executeTakeFirst();
        if (Number(updated.numUpdatedRows) > 0) return nonce;
        try {
          await db.insertInto(table).values({ ...key, nonce, changedAt: at, changedBy: by }).execute();
          return nonce;
        } catch (error) {
          // Made by someone else in the moment between: replaced on the next pass.
          if (!isDuplicateKeyError(error)) throw error;
        }
      }
      throw new Error('A calendar feed could not be renewed.');
    },
  };
}
