// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0092 — payments taken on a card reader at the counter (`card-terminal@1`).
 *
 * ─── The columns on `payment_attempts` ────────────────────────────────────
 * - `channel`: `online` (a pay page, every row before this wave: NULL reads as
 *   it), `reader` (a card reader the engine drives).
 * - `reader_id`: the paired reader it was sent to (`payment_readers.id`).
 * - `reader_busy_key`: the reader's id while its charge is on its way, NULL
 *   after, under a unique index: one charge on a reader at a time, whichever
 *   till sent it.
 * - `asked_amount`, `tip_amount`: what the till asked, and the tip the
 *   customer added on the reader (the amount taken is the two together).
 * - `approval_code`, `card_last4`: the bank's approval code and the card's last
 *   four, as the reader said them (never a card number).
 * - `interac`: an Interac card (Canada), refunded only on the reader.
 *
 * ─── `payment_readers` ────────────────────────────────────────────────────
 * One paired reader: its service, mode, the service's own id, the name staff
 * gave it, its location, model, and when it was last seen.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const attempts = metaTable('payment_attempts');
  await db.schema.alterTable(attempts).addColumn('channel', c.str(8)).execute();
  await db.schema.alterTable(attempts).addColumn('reader_id', c.id).execute();
  await db.schema.alterTable(attempts).addColumn('reader_busy_key', c.id).execute();
  await db.schema.alterTable(attempts).addColumn('asked_amount', c.str(40)).execute();
  await db.schema.alterTable(attempts).addColumn('tip_amount', c.str(40)).execute();
  await db.schema.alterTable(attempts).addColumn('approval_code', c.str(32)).execute();
  await db.schema.alterTable(attempts).addColumn('card_last4', c.str(4)).execute();
  await db.schema.alterTable(attempts).addColumn('interac', c.bool).execute();
  await db.schema.createIndex('uq_adminium_payment_attempts_reader_busy').on(attempts).columns(['reader_busy_key']).unique().execute();

  await db.schema
    .createTable(metaTable('payment_readers'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('provider', c.str(80), (col) => col.notNull())
    .addColumn('mode', c.str(8), (col) => col.notNull())
    .addColumn('reader_ref', c.str(255), (col) => col.notNull())
    .addColumn('label', c.str(120), (col) => col.notNull())
    .addColumn('location_id', c.str(255))
    .addColumn('location_name', c.str(255))
    .addColumn('model', c.str(120))
    .addColumn('online', c.bool, (col) => col.notNull())
    .addColumn('last_seen_at', c.ts)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await db.schema.createIndex('uq_adminium_payment_readers_ref').on(metaTable('payment_readers')).columns(['provider', 'mode', 'reader_ref']).unique().execute();
}
