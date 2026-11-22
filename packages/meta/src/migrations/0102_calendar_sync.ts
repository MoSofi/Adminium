// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0102 — calendar sync: what the engine keeps about a connected calendar.
 *
 * The busy times themselves are NOT here: they are rows of an engine-written
 * table in the app's own database, so the booking guard reads them under its
 * own lock. Here are the accounts' sync state, the event mirror and the rest.
 *
 *  - `calendar_sync`: one row per connected account. Which calendars count,
 *    when it was last read whole, and when it is next due.
 *  - `calendar_events`: the mirror. One row per (account, booking row): the
 *    provider's id for the event and a hash of what it holds. Never a title,
 *    so a person's name is not kept here.
 *  - `calendar_dirty`: rows whose events may be out of date. Written by the
 *    write path's listener, cleared by the job that made them right.
 *  - `calendar_channels`: push channels. The channel id is minted here and is
 *    in the address the service calls; the secret is sealed.
 *  - `calendar_clashes`: a clash, keyed on the clipped overlap, once it was told
 *    or kept. A clash itself is derived, so most have no row here.
 */
import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';
import { CONNECTED_ROW_WIDTH, CONNECTED_TABLE_WIDTH } from './0100_connected_accounts.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  /** A row's key, compared exactly on every engine (see wave 0100). */
  const exact = (width: number) => (c.dialect === 'mysql' ? sql.raw(`varchar(${String(width)}) character set utf8mb4 collate utf8mb4_bin`) : c.str(width));

  await db.schema
    .createTable(metaTable('calendar_sync'))
    .ifNotExists()
    .addColumn('account_id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.str(36), (col) => col.notNull())
    /** The table of the bookings this account's events come from. */
    .addColumn('booking_table', exact(CONNECTED_TABLE_WIDTH), (col) => col.notNull())
    /** The calendar Adminium made, and the name it was last given. */
    .addColumn('calendar_id', c.str(512))
    .addColumn('calendar_name', c.str(256))
    /** The calendars read for busy times. NULL: the main one. */
    .addColumn('read_calendars', c.json)
    .addColumn('count_all_day', c.bool, (col) => col.notNull())
    /** The most of a name this person's events carry. */
    .addColumn('detail', c.str(20), (col) => col.notNull())
    .addColumn('own_cursor', c.text)
    /** A read started, and the last read that finished whole. */
    .addColumn('read_started_at', c.ts)
    .addColumn('last_synced_at', c.ts)
    .addColumn('next_poll_at', c.ts, (col) => col.notNull())
    /** The last genuine push notice. */
    .addColumn('notice_at', c.ts)
    /** Since when the first read has been running. NULL once it is done. */
    .addColumn('connecting_since', c.ts)
    /** Since when the service asked to be left alone, for calls going out. */
    .addColumn('hold_until', c.ts)
    /** The busy rows were dropped as too old, and the desk was told. */
    .addColumn('stale_dropped_at', c.ts)
    /** When the calendar Adminium made was found deleted, and how many times in a row. */
    .addColumn('calendar_lost_at', c.ts)
    .addColumn('calendar_lost_count', c.int, (col) => col.notNull())
    /** `calendar-removed`: stopped until the person says otherwise. */
    .addColumn('paused', c.str(24))
    /** Until when one job holds the right to make or remake the calendar at the provider. */
    .addColumn('calendar_lease_until', c.ts)
    /** A hash of the last busy times read: a poll that finds them changed while push stayed silent says push has stopped. */
    .addColumn('busy_hash', c.str(64))
    .addColumn('silent_told_at', c.ts)
    /** A fixed word: never what a service said. */
    .addColumn('last_error', c.str(32))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_calendar_sync_account', ['account_id'], metaTable('connected_accounts'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_calendar_sync_due', metaTable('calendar_sync'), ['next_poll_at']);

  await db.schema
    .createTable(metaTable('calendar_events'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('account_id', c.id, (col) => col.notNull())
    .addColumn('connection_id', c.str(36), (col) => col.notNull())
    .addColumn('table_name', exact(CONNECTED_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', exact(CONNECTED_ROW_WIDTH), (col) => col.notNull())
    /** Bumped when an event has to be made again: the key is built from it. */
    .addColumn('generation', c.int, (col) => col.notNull())
    .addColumn('remote_id', c.str(1024))
    .addColumn('etag', c.str(256))
    /** A hash of the event as written. NULL: nothing has been written yet. */
    .addColumn('applied_hash', c.str(64))
    .addColumn('start_at', c.ts)
    .addColumn('end_at', c.ts)
    /** What the event says of the person: `name` or `none`. */
    .addColumn('detail', c.str(8))
    .addColumn('tries', c.int, (col) => col.notNull())
    .addColumn('last_error', c.str(32))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_calendar_events_account', ['account_id'], metaTable('connected_accounts'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'uq_adminium_calendar_events_row', metaTable('calendar_events'), ['account_id', 'connection_id', 'table_name', 'row_key'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_calendar_events_of_row', metaTable('calendar_events'), ['connection_id', 'table_name', 'row_key']);

  await db.schema
    .createTable(metaTable('calendar_dirty'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.str(36), (col) => col.notNull())
    .addColumn('table_name', exact(CONNECTED_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', exact(CONNECTED_ROW_WIDTH), (col) => col.notNull())
    .addColumn('marked_at', c.ts, (col) => col.notNull())
    /** Bumped on every mark, so a job clears only what it read. */
    .addColumn('mark', c.int, (col) => col.notNull())
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'uq_adminium_calendar_dirty_row', metaTable('calendar_dirty'), ['connection_id', 'table_name', 'row_key'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_calendar_dirty_marked', metaTable('calendar_dirty'), ['marked_at']);

  await db.schema
    .createTable(metaTable('calendar_channels'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('account_id', c.id, (col) => col.notNull())
    .addColumn('provider', c.str(80), (col) => col.notNull())
    /** `own` or `busy`. */
    .addColumn('target', c.str(8), (col) => col.notNull())
    /** `creating` (only then is a handshake echoed), `live`. */
    .addColumn('state', c.str(10), (col) => col.notNull())
    .addColumn('secret_sealed', c.text, (col) => col.notNull())
    .addColumn('remote_channel_id', c.str(512))
    .addColumn('resource_id', c.str(1024))
    .addColumn('address', c.str(2048), (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    .addColumn('last_notice_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_calendar_channels_account', ['account_id'], metaTable('connected_accounts'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_calendar_channels_account', metaTable('calendar_channels'), ['account_id']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_calendar_channels_expiry', metaTable('calendar_channels'), ['expires_at']);

  await db.schema
    .createTable(metaTable('calendar_clashes'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.str(36), (col) => col.notNull())
    .addColumn('table_name', exact(CONNECTED_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', exact(CONNECTED_ROW_WIDTH), (col) => col.notNull())
    /** The overlap, clipped to the booking: what "that busy time" means once a pass has replaced every row. */
    .addColumn('overlap_start', c.ts, (col) => col.notNull())
    .addColumn('overlap_end', c.ts, (col) => col.notNull())
    .addColumn('told_at', c.ts)
    .addColumn('kept_at', c.ts)
    .addColumn('kept_by', c.str(64))
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'uq_adminium_calendar_clashes_key', metaTable('calendar_clashes'), ['connection_id', 'table_name', 'row_key', 'overlap_start', 'overlap_end'], { unique: true });
}
