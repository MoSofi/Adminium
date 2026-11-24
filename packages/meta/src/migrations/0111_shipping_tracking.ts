// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0111 — where a parcel is, and how Adminium heard.
 *
 *  - `adminium_shipping_track_installs`: one row per carrier install. The
 *    webhook token as a keyed hash (the address is shown once), the health of
 *    that webhook, the pace of "Refresh open parcels", and the polling switch
 *    and its monthly count, which nothing can use while the code lock is off.
 *  - `adminium_shipping_parcels`: one row per tracked booking. Kept apart from
 *    the booking so the purchase's state machine never shares a write with a
 *    carrier's claim about a parcel.
 *  - `adminium_shipping_track_events`: what a webhook said, stored once and
 *    followed by a job. Only the fields that are used: Shippo's payload also
 *    carries both addresses, and those are never written down.
 *
 * No foreign key, as with the bookings: MySQL drops an inline REFERENCES, and
 * a booking outlives the install that made it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { SHIPPING_HASH_WIDTH, SHIPPING_ID_WIDTH } from './0107_shipping.js';
import { SHIPPING_CARRIER_TEXT_WIDTH, SHIPPING_URL_WIDTH } from './0109_shipping_bookings.js';
import { createIndexUnlessMade } from './probe.js';

/** A carrier's status, or a transaction's, as one stable word. */
export const SHIPPING_TRACK_WORD_WIDTH = 16;
/** `YYYY-MM`. */
export const SHIPPING_MONTH_WIDTH = 7;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('shipping_track_installs'))
    .ifNotExists()
    .addColumn('carrier_install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.primaryKey())
    .addColumn('token_hash', c.str(SHIPPING_HASH_WIDTH))
    .addColumn('token_hint', c.str(4))
    .addColumn('token_made_at', c.ts)
    // The first and last webhook accepted. A person's Refresh never writes these.
    .addColumn('first_at', c.ts)
    .addColumn('last_at', c.ts)
    .addColumn('last_bad_at', c.ts)
    .addColumn('refreshed_at', c.ts)
    .addColumn('poll_on_at', c.ts)
    .addColumn('poll_month', c.str(SHIPPING_MONTH_WIDTH))
    .addColumn('poll_calls', c.int, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();

  await db.schema
    .createTable(metaTable('shipping_parcels'))
    .ifNotExists()
    .addColumn('booking_id', c.str(SHIPPING_ID_WIDTH), (col) => col.primaryKey())
    .addColumn('carrier_install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('status', c.str(SHIPPING_TRACK_WORD_WIDTH))
    // How far along that status is: -1 until one is known. The forward-only rule is one guarded UPDATE on it.
    .addColumn('status_rank', c.int, (col) => col.notNull())
    .addColumn('status_at', c.ts)
    .addColumn('tried_at', c.ts)
    .addColumn('checked_at', c.ts)
    .addColumn('polled_at', c.ts)
    .addColumn('flag', c.str(SHIPPING_TRACK_WORD_WIDTH))
    .addColumn('number_changed_at', c.ts)
    // The carrier's own time for that change, so a late copy of an earlier number cannot put it back.
    .addColumn('number_at', c.ts)
    // Numbers this label had before, as a JSON list: the order may still show one.
    .addColumn('old_numbers', c.text)
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();

  await db.schema
    .createTable(metaTable('shipping_track_events'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('carrier_install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('dedupe_hash', c.str(SHIPPING_HASH_WIDTH), (col) => col.notNull())
    .addColumn('kind', c.str(SHIPPING_TRACK_WORD_WIDTH), (col) => col.notNull())
    .addColumn('tracking', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('transaction_id', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('rate_ref', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('status', c.str(SHIPPING_TRACK_WORD_WIDTH), (col) => col.notNull())
    .addColumn('status_at', c.ts)
    .addColumn('tracking_url', c.str(SHIPPING_URL_WIDTH))
    .addColumn('state', c.str(SHIPPING_TRACK_WORD_WIDTH), (col) => col.notNull())
    .addColumn('outcome', c.str(SHIPPING_TRACK_WORD_WIDTH))
    .addColumn('received_at', c.ts, (col) => col.notNull())
    .addColumn('processed_at', c.ts)
    // Made with the table, so a run stopped part way on MySQL cannot leave a table that stores an event twice.
    .addUniqueConstraint('uq_adminium_shipping_track_events_dedupe', ['dedupe_hash'])
    .execute();

  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_parcels_install', metaTable('shipping_parcels'), ['carrier_install_id']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_track_events_state', metaTable('shipping_track_events'), ['state', 'received_at']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_track_events_install', metaTable('shipping_track_events'), ['carrier_install_id', 'state']);
  // How a claim finds its booking, inside one carrier install.
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_bookings_tracking', metaTable('shipping_bookings'), ['carrier_install_id', 'tracking']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_bookings_shipment', metaTable('shipping_bookings'), ['carrier_install_id', 'carrier_shipment_id']);
}
