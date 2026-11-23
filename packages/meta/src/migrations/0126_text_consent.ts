// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0126 — who said yes or no to texts, and who must never get one.
 *
 * Two tables of their own rather than a `channel` column on the e-mail ones:
 * every e-mail stop-list path reads its whole table, and with separate tables
 * an e-mail yes physically cannot be read as a text yes.
 *
 * `text_stop_list`: one row per stopped number, found by its keyed hash under
 * `key_version` (unique together). `phone_encrypted` is the display copy,
 * sealed under a key taken from the address keys. An erased person's row keeps
 * the hash alone, so the objection outlives them.
 *
 * `text_consent_log`: every yes, no and START, with the words the person was
 * shown. A row names a person, a number's hash, or both.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

const PERSON_KEY_MAX = 200;
/** A keyed hash: HMAC-SHA256 as hex. */
const HASH_LENGTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('text_stop_list'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('phone_hash', c.str(HASH_LENGTH), (col) => col.notNull())
    .addColumn('key_version', c.int, (col) => col.notNull())
    .addColumn('phone_encrypted', c.text)
    .addColumn('reason', c.str(20), (col) => col.notNull())
    .addColumn('origin', c.str(255))
    .addColumn('added_at', c.ts, (col) => col.notNull())
    .addColumn('added_by_id', c.id)
    .addColumn('added_by_label', c.str(255))
    .addColumn('erased_at', c.ts)
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_text_stop_list_phone', metaTable('text_stop_list'), ['phone_hash', 'key_version'], { unique: true });
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_stop_list_added', metaTable('text_stop_list'), ['added_at', 'id']);

  await db.schema
    .createTable(metaTable('text_consent_log'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id)
    .addColumn('person_table', c.str(PERSON_KEY_MAX))
    .addColumn('person_key', c.str(PERSON_KEY_MAX))
    .addColumn('phone_hash', c.str(HASH_LENGTH))
    .addColumn('key_version', c.int)
    .addColumn('purpose', c.str(40))
    .addColumn('state', c.str(12), (col) => col.notNull())
    .addColumn('source', c.str(20), (col) => col.notNull())
    .addColumn('detail', c.str(255))
    .addColumn('how', c.str(20))
    .addColumn('note', c.text)
    .addColumn('staff_id', c.id)
    .addColumn('staff_label', c.str(255))
    .addColumn('wording', c.text)
    .addColumn('wording_version', c.str(40))
    .addColumn('ip', c.str(64))
    .addColumn('user_agent', c.str(512))
    .addColumn('at', c.ts, (col) => col.notNull())
    .addColumn('confirmed_at', c.ts)
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_consent_person', metaTable('text_consent_log'), ['connection_id', 'person_table', 'person_key', 'purpose', 'at']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_consent_phone', metaTable('text_consent_log'), ['phone_hash', 'key_version', 'purpose', 'at']);
}
