// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0128 — what became of each text, and the day's count.
 *
 * `text_deliveries` holds no message body and no number, only the number's
 * keyed hash and a mask. `open_message_hash` holds `message_hash` while a
 * delivery is prepared, retrying, being handed over or unknown, and is NULL
 * once it ends. Every engine allows many NULLs in a unique index, so this index
 * is what makes "one open delivery per message" a database fact. It must stay
 * unique.
 *
 * `text_send_days` is the daily limit's counter, one row per business day.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const deliveries = metaTable('text_deliveries');
  await db.schema
    .createTable(deliveries)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('claim_hash', c.str(64), (col) => col.notNull())
    .addColumn('message_hash', c.str(64), (col) => col.notNull())
    .addColumn('open_message_hash', c.str(64))
    .addColumn('phone_hash', c.str(64))
    .addColumn('key_version', c.int)
    .addColumn('phone_masked', c.str(32))
    .addColumn('text_class', c.str(12), (col) => col.notNull())
    .addColumn('state', c.str(20), (col) => col.notNull())
    .addColumn('reason', c.str(40))
    .addColumn('provider', c.str(16))
    .addColumn('provider_message_id', c.str(64))
    .addColumn('provider_status', c.str(32))
    .addColumn('provider_error_code', c.str(8))
    .addColumn('segments', c.int)
    .addColumn('price_amount', c.str(32))
    .addColumn('price_currency', c.str(8))
    .addColumn('estimated_segments', c.int, (col) => col.notNull())
    .addColumn('encoding', c.str(8), (col) => col.notNull())
    .addColumn('version', c.int, (col) => col.notNull())
    .addColumn('attempts', c.int, (col) => col.notNull())
    .addColumn('attempt_started_at', c.ts)
    .addColumn('attempt_account', c.str(32))
    .addColumn('may_have_gone_at', c.ts)
    .addColumn('may_have_gone_account', c.str(32))
    .addColumn('slot_day', c.str(10))
    .addColumn('stop_owed_at', c.ts)
    .addColumn('report_target', c.text)
    .addColumn('settle_owed_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_text_deliveries_claim', deliveries, ['claim_hash'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_text_deliveries_open_message', deliveries, ['open_message_hash'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_deliveries_settle', deliveries, ['settle_owed_at']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_deliveries_message', deliveries, ['message_hash', 'state']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_deliveries_provider', deliveries, ['provider', 'provider_message_id']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_deliveries_phone', deliveries, ['phone_hash', 'key_version']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_deliveries_marker', deliveries, ['state', 'attempt_started_at']);

  await db.schema
    .createTable(metaTable('text_send_days'))
    .ifNotExists()
    .addColumn('day', c.str(10), (col) => col.primaryKey())
    .addColumn('used', c.int, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
}
