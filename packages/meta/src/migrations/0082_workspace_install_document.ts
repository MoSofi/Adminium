// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0082 — the workspace file a workspace install came from.
 *
 * `workspace_installs.document` keeps the file's `workspace.json` as it was
 * uploaded: its name, where and when it was saved, on which Adminium, and the
 * database each app came from. The review reads it back after a reload, so an
 * install that stopped can be finished with "Install the rest" from the same
 * screen. Null on a row made before this wave (there are none in a release).
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('workspace_installs')).addColumn('document', c.text).execute();
}
