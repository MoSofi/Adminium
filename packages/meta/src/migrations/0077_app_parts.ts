// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0077 — what an install made of the parts only a file made on an
 * Adminium carries: its report documents, invoice layouts and scheduled
 * reports.
 *
 * Those rows have no owner column of their own (a person makes them by hand),
 * so an install records each one here: which install, which entry of its file
 * (`kind` and `part_key`), the row it made (`target_id`), and a fingerprint of
 * what it wrote. An update rewrites a row whose fingerprint still matches and
 * leaves one somebody changed; an uninstall takes back the unchanged ones.
 *
 * Keyed by the install's own row, never by an app key: the same app may one
 * day be installed once per database. The row goes with the install
 * (ON DELETE CASCADE); the made rows themselves are let go by the uninstall
 * before that.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export const APP_PART_KIND_WIDTH = 24;
export const APP_PART_KEY_WIDTH = 80;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('app_parts'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    .addColumn('kind', c.str(APP_PART_KIND_WIDTH), (col) => col.notNull())
    .addColumn('part_key', c.str(APP_PART_KEY_WIDTH), (col) => col.notNull())
    .addColumn('target_id', c.id, (col) => col.notNull())
    .addColumn('content_hash', c.str(64), (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_app_parts_manifest', ['manifest_id'], metaTable('manifests'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  // One row per entry of one install's file: every column of the key is NOT NULL.
  await db.schema
    .createIndex('uq_adminium_app_parts_entry')
    .on(metaTable('app_parts'))
    .columns(['manifest_id', 'kind', 'part_key'])
    .unique()
    .execute();
}
