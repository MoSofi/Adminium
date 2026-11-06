// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0086 — what a saved app was called, and its icon.
 *
 * "Saved from here" names each save by the app's name, and "Save a newer
 * version" starts from the name, description and icon the last save gave.
 * They were only inside the file. A save made before this wave has neither: the
 * card falls back to its key.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export const APP_SAVE_NAME_WIDTH = 80;
export const APP_SAVE_DESCRIPTION_WIDTH = 500;
export const APP_SAVE_ICON_WIDTH = 60;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('app_saves')).addColumn('name', c.str(APP_SAVE_NAME_WIDTH)).execute();
  await db.schema.alterTable(metaTable('app_saves')).addColumn('description', c.str(APP_SAVE_DESCRIPTION_WIDTH)).execute();
  await db.schema.alterTable(metaTable('app_saves')).addColumn('icon', c.str(APP_SAVE_ICON_WIDTH)).execute();
}
