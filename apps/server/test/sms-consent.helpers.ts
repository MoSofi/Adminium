// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two text consent tables, as the migration will make them.
 *
 * No migration makes them yet. This body is what moves into
 * `packages/meta/src/migrations/` when one does, under the next free number.
 */
import { columnHelpers, metaTable, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

const PERSON_KEY_MAX = 200;
const HASH_LENGTH = 64;

export async function makeTextConsentTables(meta: MetaDb): Promise<void> {
  const db = meta.db as unknown as Kysely<unknown>;
  const c = columnHelpers(meta.dialect);

  await db.schema
    .createTable(metaTable('text_stop_list'))
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
  await db.schema.createIndex('ux_adminium_text_stop_list_phone').on(metaTable('text_stop_list')).columns(['phone_hash', 'key_version']).unique().execute();
  await db.schema.createIndex('ix_adminium_text_stop_list_added').on(metaTable('text_stop_list')).columns(['added_at', 'id']).execute();

  await db.schema
    .createTable(metaTable('text_consent_log'))
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
  await db.schema.createIndex('ix_adminium_text_consent_person').on(metaTable('text_consent_log')).columns(['connection_id', 'person_table', 'person_key', 'purpose', 'at']).execute();
  await db.schema.createIndex('ix_adminium_text_consent_phone').on(metaTable('text_consent_log')).columns(['phone_hash', 'key_version', 'purpose', 'at']).execute();
}
