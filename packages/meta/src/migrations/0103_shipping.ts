// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0103 — real shipping: what one app install has chosen, and the quotes
 * it was given.
 *
 * `adminium_shipping_settings`, one row per app install: the carrier the shop
 * chose (installing a second one never changes it) and its Ship from address,
 * which may be half filled while the owner finds the rest.
 *
 * `adminium_shipping_quotes`, one row per order slot (table, row, purpose and
 * parcel number): the rates a carrier gave and a keyed hash of what they were
 * given for. A new quote for the slot replaces the old one, so a rate from
 * before an edit cannot be bought after it. It holds **no name, address or
 * phone**: the order is read again when a rate is bought, and the hash says
 * whether it still matches.
 *
 * No foreign key: MySQL drops an inline REFERENCES, and the rows of an install
 * are deleted by the code that removes it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

/** The longest install or connection id. */
export const SHIPPING_ID_WIDTH = 64;
/** The longest add-on key, as a manifest allows it. */
export const SHIPPING_CARRIER_WIDTH = 80;
/** The longest table ref the quote slot keeps. */
export const SHIPPING_TABLE_WIDTH = 64;
/** The longest row key: a slot's unique index has to fit MySQL's limit with this in it. */
export const SHIPPING_ROW_WIDTH = 191;
/** `outbound`, `return` or `replacement`. */
export const SHIPPING_PURPOSE_WIDTH = 16;
/** An HMAC-SHA256, as hex. */
export const SHIPPING_HASH_WIDTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('shipping_settings'))
    .ifNotExists()
    .addColumn('install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.primaryKey())
    .addColumn('active_carrier', c.str(SHIPPING_CARRIER_WIDTH))
    .addColumn('ship_from', c.json)
    .addColumn('updated_by', c.str(SHIPPING_ID_WIDTH))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();

  await db.schema
    .createTable(metaTable('shipping_quotes'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('install_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('connection_id', c.str(SHIPPING_ID_WIDTH), (col) => col.notNull())
    .addColumn('table_ref', c.str(SHIPPING_TABLE_WIDTH), (col) => col.notNull())
    .addColumn('row_key', c.str(SHIPPING_ROW_WIDTH), (col) => col.notNull())
    .addColumn('purpose', c.str(SHIPPING_PURPOSE_WIDTH), (col) => col.notNull())
    .addColumn('parcel_number', c.int, (col) => col.notNull())
    .addColumn('carrier_key', c.str(SHIPPING_CARRIER_WIDTH), (col) => col.notNull())
    .addColumn('details_hash', c.str(SHIPPING_HASH_WIDTH), (col) => col.notNull())
    .addColumn('rates', c.json, (col) => col.notNull())
    .addColumn('created_by', c.str(SHIPPING_ID_WIDTH))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('expires_at', c.ts, (col) => col.notNull())
    // Made with the table, so a run stopped part way on MySQL cannot leave a table that takes two quotes for one slot.
    .addUniqueConstraint('uq_adminium_shipping_quotes_slot', ['install_id', 'connection_id', 'table_ref', 'row_key', 'purpose', 'parcel_number'])
    .execute();
  // The prune on every new quote.
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_shipping_quotes_expires', metaTable('shipping_quotes'), ['expires_at']);
}
