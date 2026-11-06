// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0087 — what a saved app carried that needs the saver's own rights.
 *
 * "Download again" hands out the same file to whoever asks, so it asks of them
 * what the save asked of the saver: reading and exporting each table whose
 * rows travel (every column of those rows within their reach), reading the
 * personal columns that travel, managing files when a Files library file
 * travels, and managing settings when the deployment-wide part does. A JSON
 * record per save; null on a save from before this wave, which only its saver
 * may download again.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('app_saves')).addColumn('carried', c.json).execute();
}
