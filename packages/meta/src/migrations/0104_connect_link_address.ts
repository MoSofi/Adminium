// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0103 — the address a connect link was made for, as a digest.
 *
 * A link names a row by its key, and a key can come to mean someone else: an
 * address corrected on the row, or a deleted row's key used again. A link whose
 * row no longer holds that address opens nothing. Empty for a row with no
 * address when the link was made.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('connect_links')).addColumn('address_digest', c.str(64)).execute();
}
