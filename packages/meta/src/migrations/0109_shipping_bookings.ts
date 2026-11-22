// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0109 — the truth about every label a shop has tried to buy.
 *
 * `adminium_shipping_bookings`, one row per attempt, written BEFORE the carrier
 * is called, so a crash at any point leaves a row that says what may have
 * happened. It holds every carrier's bookings: a carrier's own `shipments`
 * table is a copy, written after the carrier answers.
 *
 * `open_key` is a hash of the order's slot (database, real table, row,
 * purpose, parcel number and test or live) and is NULL once the attempt is
 * refused or released. Its unique index is what makes one live booking per
 * slot true on all three databases, which share no partial index. The carrier
 * is not in it, so a second carrier cannot book the same parcel. Test and live
 * are, so a sample label never holds the real one's place.
 *
 * It holds **no name, address or phone**: the order is read again, and a keyed
 * hash says whether it is still what was quoted.
 *
 * `adminium_shipping_quotes.parcel`: what was weighed and measured, so a
 * purchase names only a quote and a rate.
 *
 * No foreign key: MySQL drops an inline REFERENCES, and a booking must outlive
 * the install that made it (an unresolved one still blocks a second purchase).
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { SHIPPING_CARRIER_WIDTH, SHIPPING_HASH_WIDTH, SHIPPING_ID_WIDTH, SHIPPING_PURPOSE_WIDTH, SHIPPING_ROW_WIDTH, SHIPPING_TABLE_WIDTH } from './0107_shipping.js';
import { SHIPPING_CURRENCY_WIDTH, SHIPPING_DAY_WIDTH, SHIPPING_MODE_WIDTH, SHIPPING_MONEY_WIDTH } from './0108_shipping_keys.js';
import { columnExists, createIndexUnlessMade } from './probe.js';

/** `reserved`, `calling`, `booked`, `refused`, `unknown` or `released`. */
export const SHIPPING_BOOKING_STATE_WIDTH = 12;
/** A carrier's id, tracking number, service or reference. */
export const SHIPPING_CARRIER_TEXT_WIDTH = 191;
/** The carrier's own tracking page. */
export const SHIPPING_URL_WIDTH = 512;
/** Why a booking is unknown, as a stable word. */
export const SHIPPING_REASON_WIDTH = 32;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('shipping_bookings'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('carrier_install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('carrier_key', c.str(SHIPPING_CARRIER_WIDTH), (col) => col.notNull())
    .addColumn('connection_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('table_ref', c.str(SHIPPING_TABLE_WIDTH), (col) => col.notNull())
    // The real table: two apps on one database may both call theirs `orders`, and a reinstall keeps this.
    .addColumn('table_name', c.str(SHIPPING_ROW_WIDTH), (col) => col.notNull())
    .addColumn('row_key', c.str(SHIPPING_ROW_WIDTH), (col) => col.notNull())
    .addColumn('purpose', c.str(SHIPPING_PURPOSE_WIDTH), (col) => col.notNull())
    .addColumn('parcel_number', c.int, (col) => col.notNull())
    .addColumn('reference', c.str(SHIPPING_CARRIER_TEXT_WIDTH), (col) => col.notNull())
    .addColumn('open_key', c.str(SHIPPING_HASH_WIDTH))
    .addColumn('state', c.str(SHIPPING_BOOKING_STATE_WIDTH), (col) => col.notNull())
    .addColumn('mode', c.str(SHIPPING_MODE_WIDTH), (col) => col.notNull())
    .addColumn('account_fingerprint', c.str(SHIPPING_HASH_WIDTH), (col) => col.notNull())
    .addColumn('details_hash', c.str(SHIPPING_HASH_WIDTH), (col) => col.notNull())
    .addColumn('service', c.str(SHIPPING_CARRIER_TEXT_WIDTH), (col) => col.notNull())
    .addColumn('rate_code', c.str(SHIPPING_CARRIER_TEXT_WIDTH), (col) => col.notNull())
    // The carrier's handle for the rate, sealed: what a look-up after a lost answer asks about.
    .addColumn('handle_sealed', c.text)
    .addColumn('quoted_amount', c.str(SHIPPING_MONEY_WIDTH), (col) => col.notNull())
    .addColumn('quoted_currency', c.str(SHIPPING_CURRENCY_WIDTH), (col) => col.notNull())
    .addColumn('amount', c.str(SHIPPING_MONEY_WIDTH))
    .addColumn('currency', c.str(SHIPPING_CURRENCY_WIDTH))
    .addColumn('charge_differs', c.bool, (col) => col.notNull())
    .addColumn('carrier_shipment_id', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('tracking', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('carrier_name', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('carrier_token', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('tracking_url', c.str(SHIPPING_URL_WIDTH))
    .addColumn('label_ref', c.str(SHIPPING_CARRIER_TEXT_WIDTH))
    .addColumn('counted_day', c.str(SHIPPING_DAY_WIDTH))
    // Whether it counts against that day now: a refusal gives it back, and a label that turns up late takes it again.
    .addColumn('count_held', c.bool, (col) => col.notNull())
    .addColumn('reason', c.str(SHIPPING_REASON_WIDTH))
    .addColumn('duplicates', c.int, (col) => col.notNull())
    .addColumn('created_by', c.str(SHIPPING_ID_WIDTH))
    .addColumn('released_by', c.str(SHIPPING_ID_WIDTH))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('called_at', c.ts)
    .addColumn('answered_at', c.ts)
    .addColumn('released_at', c.ts)
    .addColumn('checked_at', c.ts)
    .addColumn('copied_at', c.ts)
    .addColumn('applied_at', c.ts)
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    // Made with the table, so a run stopped part way on MySQL cannot leave a table that takes two bookings for one slot.
    .addUniqueConstraint('uq_adminium_shipping_bookings_open', ['open_key'])
    .execute();

  const table = metaTable('shipping_bookings');
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_bookings_row', table, ['connection_id', 'table_name', 'row_key']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_bookings_carrier', table, ['carrier_install_id', 'state']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_bookings_apply', table, ['state', 'applied_at']);

  // Asked first: MySQL commits each DDL, so a run stopped part way comes back to a column already there.
  if (!(await columnExists(db, c.dialect, metaTable('shipping_quotes'), 'parcel'))) {
    await db.schema.alterTable(metaTable('shipping_quotes')).addColumn('parcel', c.json).execute();
  }
}
