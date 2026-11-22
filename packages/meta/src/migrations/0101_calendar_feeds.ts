// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0101 — the private calendar feeds of a booking table's people.
 *
 * One row per person with a feed: the app, the booked table, the person's row
 * and a random nonce the feed's link carries. "Renew" replaces the nonce, so
 * the old link stops at once. It is random rather than a counter so that a
 * table emptied by a restore can never bring a renewed link back to life: with
 * no row, every link is dead and the person is given a new one.
 *
 * Holds no person's details. No archive carries it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export const CALENDAR_FEED_CONNECTION_WIDTH = 64;
export const CALENDAR_FEED_APP_WIDTH = 80;
export const CALENDAR_FEED_TABLE_WIDTH = 200;
export const CALENDAR_FEED_ROW_WIDTH = 200;
export const CALENDAR_FEED_NONCE_WIDTH = 32;
export const CALENDAR_FEED_BY_WIDTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('calendar_feeds'))
    .ifNotExists()
    .addColumn('connection_id', c.str(CALENDAR_FEED_CONNECTION_WIDTH), (col) => col.notNull())
    .addColumn('app_key', c.str(CALENDAR_FEED_APP_WIDTH), (col) => col.notNull())
    .addColumn('table_name', c.str(CALENDAR_FEED_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', c.str(CALENDAR_FEED_ROW_WIDTH), (col) => col.notNull())
    .addColumn('nonce', c.str(CALENDAR_FEED_NONCE_WIDTH), (col) => col.notNull())
    .addColumn('changed_at', c.ts, (col) => col.notNull())
    .addColumn('changed_by', c.str(CALENDAR_FEED_BY_WIDTH))
    .addPrimaryKeyConstraint('pk_adminium_calendar_feeds', ['connection_id', 'app_key', 'table_name', 'row_key'])
    .execute();
}
