// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0113 — parcels that leave the shop's country.
 *
 *  - `adminium_shipping_settings.international`: the countries this shop
 *    delivers to and its customs defaults. Empty until its owner sets them, so
 *    every shop stays inside its own country until then.
 *  - `adminium_shipping_quotes.customs`: what the person who ticked the customs
 *    declaration chose for this quote. It holds no address and no value: those
 *    are read from the order again at purchase.
 *  - `adminium_shipping_bookings.customs_due`: the carrier said this label has a
 *    customs invoice, so a missing file is owed and not simply absent.
 *
 * Each column is asked for first: MySQL commits each DDL, so a run stopped part
 * way comes back to the columns it already made.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { columnExists } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const columns = [
    [metaTable('shipping_settings'), 'international', c.json],
    [metaTable('shipping_quotes'), 'customs', c.json],
    [metaTable('shipping_bookings'), 'customs_due', c.bool],
  ] as const;
  for (const [table, name, type] of columns) {
    if (!(await columnExists(db, c.dialect, table, name))) await db.schema.alterTable(table).addColumn(name, type).execute();
  }
}
