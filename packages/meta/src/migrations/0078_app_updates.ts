// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0078 — an app update that has moved its version and not finished.
 *
 * An update records the new version before it writes the app's pages,
 * rules, roles, mails, documents and keys, because those are written for the
 * new version. When one of them fails, the update stops and says so; the row
 * here says which version it came from and which tables that version had, so
 * the same update run again finishes the work instead of finding "no newer
 * version". The row goes when the update finishes, and with the install
 * (ON DELETE CASCADE).
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export const APP_UPDATE_VERSION_WIDTH = 64;
export const APP_UPDATE_STAGE_WIDTH = 32;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('app_updates'))
    .ifNotExists()
    .addColumn('manifest_id', c.id, (col) => col.primaryKey())
    .addColumn('from_version', c.str(APP_UPDATE_VERSION_WIDTH), (col) => col.notNull())
    .addColumn('to_version', c.str(APP_UPDATE_VERSION_WIDTH), (col) => col.notNull())
    // The table refs the version before had: what the new version brings is told from them.
    .addColumn('from_tables', c.json, (col) => col.notNull())
    // The step it stopped at, for the reply and the log; null while it runs.
    .addColumn('stopped_at', c.str(APP_UPDATE_STAGE_WIDTH))
    .addColumn('started_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_app_updates_manifest', ['manifest_id'], metaTable('manifests'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
}
