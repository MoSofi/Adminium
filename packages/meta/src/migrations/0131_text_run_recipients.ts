// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0131 — who a marketing text run reaches, one row per person.
 *
 * Holds no number and no word of the message: the number's keyed hash (the
 * stop list's), a mask for the console, and the row the person is. Each person
 * the run judged is written down, those it leaves out with their reason, so the
 * run's arithmetic is never hidden. A row handed to the send path names its
 * delivery, which says how the text ended.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

const PERSON_KEY_MAX = 200;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const recipients = metaTable('text_run_recipients');
  await db.schema
    .createTable(recipients)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('run_id', c.id, (col) => col.notNull())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('person_table', c.str(PERSON_KEY_MAX), (col) => col.notNull())
    .addColumn('person_key', c.str(PERSON_KEY_MAX), (col) => col.notNull())
    .addColumn('name', c.str(120))
    .addColumn('phone_hash', c.str(64))
    .addColumn('key_version', c.int)
    .addColumn('phone_masked', c.str(32))
    .addColumn('country', c.str(2))
    .addColumn('locale', c.str(35))
    .addColumn('state', c.str(12), (col) => col.notNull())
    .addColumn('reason', c.str(40))
    .addColumn('delivery_id', c.id)
    .addColumn('tries', c.int, (col) => col.notNull())
    .addColumn('claim', c.str(36))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_run_recipients_run', recipients, ['run_id', 'state', 'id']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_run_recipients_phone', recipients, ['phone_hash', 'key_version']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_run_recipients_person', recipients, ['connection_id', 'person_table', 'person_key']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_run_recipients_delivery', recipients, ['delivery_id']);
}
