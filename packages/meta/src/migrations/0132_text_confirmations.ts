// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0132 — a marketing yes waiting to be confirmed (double opt-in).
 *
 * One row per request sent: which yes of the text consent log it confirms, the
 * number's keyed hash and a mask (never the number), the row the person is,
 * and, once they press Confirm, when and from what browser. The link in the
 * mail names the row and nothing else. The confirmation itself is a row of the
 * consent log, with `confirmed_at`.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

const PERSON_KEY_MAX = 200;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const confirmations = metaTable('text_confirmations');
  await db.schema
    .createTable(confirmations)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('consent_event_id', c.id, (col) => col.notNull())
    .addColumn('phone_hash', c.str(64), (col) => col.notNull())
    .addColumn('key_version', c.int, (col) => col.notNull())
    .addColumn('phone_masked', c.str(32))
    .addColumn('connection_id', c.id)
    .addColumn('person_table', c.str(PERSON_KEY_MAX))
    .addColumn('person_key', c.str(PERSON_KEY_MAX))
    .addColumn('language', c.str(35))
    .addColumn('state', c.str(12), (col) => col.notNull())
    .addColumn('requested_at', c.ts, (col) => col.notNull())
    .addColumn('requested_by', c.id)
    .addColumn('confirmed_at', c.ts)
    .addColumn('ip', c.str(64))
    .addColumn('user_agent', c.str(512))
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_confirmations_phone', confirmations, ['phone_hash', 'key_version']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_confirmations_person', confirmations, ['connection_id', 'person_table', 'person_key']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_confirmations_event', confirmations, ['consent_event_id']);
}
