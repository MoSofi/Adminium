// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0063 — how a dispute ended.
 *
 * 0062 kept a dispute as `open`, then `closed`, its outcome left to the
 * provider's own dashboard. A lost dispute is money that went back to the
 * customer, so the balance and what may still be refunded must follow it;
 * a won one is said as such.
 *
 * ─── The column ───────────────────────────────────────────────────────────
 * - `dispute_outcome` on `payment_attempts`: `won` or `lost` once the
 *   provider said so with the dispute's close, NULL while it is open, when it
 *   closed with no outcome said, and on every row before this wave.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('payment_attempts')).addColumn('dispute_outcome', c.str(8)).execute();
}
