// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0112 — a refund on a bought label, which is a request and not an undo.
 *
 * A carrier can take weeks to answer and can say no, so a booking gains two
 * states (`voiding`, `voided`) and these columns say how the request stands:
 *
 *  - `void_state`: the carrier's last word: `requested`, `pending`, `refunded`
 *    or `refused`. A refused refund puts the booking back to `booked`, with
 *    this column saying so, because the label is live again.
 *  - `void_asked_at` is written BEFORE the carrier is called, `void_heard_at`
 *    once it answered at all. Asked and not heard means the request may never
 *    have arrived, so the next check sends it again.
 *  - `void_amount` and `void_currency` are only what the carrier reported.
 *
 * Added one column at a time, each asked about first: MySQL commits every DDL,
 * so a run stopped part way comes back to some columns already there.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { SHIPPING_ID_WIDTH } from './0107_shipping.js';
import { SHIPPING_CURRENCY_WIDTH, SHIPPING_MONEY_WIDTH } from './0108_shipping_keys.js';
import { SHIPPING_CARRIER_TEXT_WIDTH } from './0109_shipping_bookings.js';
import { columnExists } from './probe.js';

/** `requested`, `pending`, `refunded` or `refused`. */
export const SHIPPING_VOID_STATE_WIDTH = 12;
/** A carrier's reason, cleaned, as staff read it. */
export const SHIPPING_VOID_MESSAGE_WIDTH = 300;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const table = metaTable('shipping_bookings');
  const columns = [
    ['void_state', c.str(SHIPPING_VOID_STATE_WIDTH)],
    ['void_by', c.str(SHIPPING_ID_WIDTH)],
    ['void_asked_at', c.ts],
    ['void_heard_at', c.ts],
    ['void_settled_at', c.ts],
    ['void_reference', c.str(SHIPPING_CARRIER_TEXT_WIDTH)],
    ['void_amount', c.str(SHIPPING_MONEY_WIDTH)],
    ['void_currency', c.str(SHIPPING_CURRENCY_WIDTH)],
    ['void_message', c.str(SHIPPING_VOID_MESSAGE_WIDTH)],
  ] as const;
  for (const [name, type] of columns) {
    if (!(await columnExists(db, c.dialect, table, name))) await db.schema.alterTable(table).addColumn(name, type).execute();
  }
}
