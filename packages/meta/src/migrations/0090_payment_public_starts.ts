// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0090 — payments a stranger starts from an app's own screens.
 *
 * Card testers no longer need a link the shop sent: an app's checkout starts
 * a payment for whoever made an order. So a public start is kept apart from
 * what staff send, and its declines are counted by the address they came from.
 *
 * ─── The columns ──────────────────────────────────────────────────────────
 * - `audience` on `payment_links`: `public` for a link a public start made
 *   (it is current beside the shop's own link, never in its place, so a
 *   tester's declines lock only it), NULL for every link staff or the system
 *   made, and for every row before this wave.
 * - `start_address` on `payment_attempts`: a keyed hash of the address a
 *   public checkout started from (an IPv6 address by its /64), so declines
 *   can be counted per address. Never the address itself; cleared once the
 *   breakers' window is over. NULL for every other checkout.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('payment_links')).addColumn('audience', c.str(8)).execute();
  await db.schema.alterTable(metaTable('payment_attempts')).addColumn('start_address', c.str(64)).execute();
}
