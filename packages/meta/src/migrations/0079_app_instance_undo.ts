// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0079 — what an app's deployment-wide part replaced.
 *
 * A self-made app may carry the look, the languages, changed wording, edited
 * system emails and a few plain settings of the server it was made on. When
 * the person installing ticks it, the install writes them over what this
 * server had. Each value it writes is one row here: what was there before
 * (`before`, null when nothing was set) and what the install wrote
 * (`applied`). The uninstall puts `before` back; an update writes over the
 * value again and keeps the first `before`, so an undo after any number of
 * updates still lands on what this server had.
 *
 * `kind` says which store the value is in (`setting`, `word`, `email`,
 * `locale`); `item` names it there (a setting's key, `<locale>:<namespace>:<key>`
 * of a word, `<key>/<locale>` of an email, a language id). The row goes with
 * the install (ON DELETE CASCADE), after the uninstall has used it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export const APP_INSTANCE_UNDO_KIND_WIDTH = 16;
export const APP_INSTANCE_UNDO_ITEM_WIDTH = 320;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('app_instance_undo'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    .addColumn('kind', c.str(APP_INSTANCE_UNDO_KIND_WIDTH), (col) => col.notNull())
    .addColumn('item', c.str(APP_INSTANCE_UNDO_ITEM_WIDTH), (col) => col.notNull())
    // `{ "v": <value> }` as it was before the first install wrote it; null when nothing was set.
    .addColumn('before', c.json)
    // `{ "v": <value> }` as the install last wrote it.
    .addColumn('applied', c.json, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_app_instance_undo_manifest', ['manifest_id'], metaTable('manifests'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  // One row per value of one install: every column of the key is NOT NULL.
  await db.schema
    .createIndex('uq_adminium_app_instance_undo_item')
    .on(metaTable('app_instance_undo'))
    .columns(['manifest_id', 'kind', 'item'])
    .unique()
    .execute();
}
