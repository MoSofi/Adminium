// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0091 — refunds an app keeps as rows of its own.
 *
 * Plan 70 wrote a running refunded total onto the payment row (the column
 * model). Tickets, Ordering, Hotel and the till keep a refund as a row of
 * their own refund table instead: staff write that row as they always did,
 * and the engine sends the money back for it (the rows model). A free
 * cancellation's refund row is written by the engine itself, as the system.
 *
 * ─── The columns ──────────────────────────────────────────────────────────
 * - `app_connection`, `app_table`, `app_row_key` on `refunds`: the app's
 *   refund row a refund was asked for, NULL for a refund asked in Adminium
 *   (the column model), made at the provider, or a lost dispute. One refund
 *   per app row: its idempotency key is `app:<hash of the three>`, under the
 *   key's own unique index.
 * - `source` gains `app` (an app's refund row) and `auto` (a free
 *   cancellation the engine refunded); the column is wide enough already.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('refunds')).addColumn('app_connection', c.id).execute();
  await db.schema.alterTable(metaTable('refunds')).addColumn('app_table', c.str(255)).execute();
  await db.schema.alterTable(metaTable('refunds')).addColumn('app_row_key', c.str(512)).execute();
}
