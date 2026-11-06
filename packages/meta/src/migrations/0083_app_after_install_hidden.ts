// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0083 — an install's "After you install" list, put away.
 *
 * Once every item an install still needed is done, its owner may hide the
 * list. One row per install that did; it goes with the install (ON DELETE
 * CASCADE). It counts only while everything is done: an update that brings a
 * new item shows the list again without anyone clearing the row.
 *
 * A table of its own rather than a column on `adminium_manifests`, which is
 * read everywhere and never rebuilt.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('app_after_install_hidden'))
    .ifNotExists()
    .addColumn('manifest_id', c.id, (col) => col.primaryKey())
    .addColumn('hidden_by', c.id)
    .addColumn('hidden_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_app_after_install_hidden_manifest', ['manifest_id'], metaTable('manifests'), ['id'], (cb) => cb.onDelete('cascade'))
    .addForeignKeyConstraint('fk_adminium_app_after_install_hidden_by', ['hidden_by'], metaTable('users'), ['id'], (cb) => cb.onDelete('set null'))
    .execute();
}
