// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0099 — what each source of a lead source add-on was asked today.
 *
 * One row per install, source, UTC day and spender: a staff member's id, the
 * automation step (`step`), or the day's total over everybody (`*`). Each
 * holds the calls made and the calls running now. A call reserves on the
 * total and on its spender before it is made and settles after, so calls at
 * once never pass a cap together; paging counts every page, as each page is
 * a call.
 *
 * Written only by the engine's call to a source. No settings route, config
 * import, export or archive reads or writes it, so nobody sets a day's count
 * back.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The longest install id (an add-on install's id). */
export const SOURCE_DAY_INSTALL_WIDTH = 64;
/** The longest source id, as the manifest word allows it. */
export const SOURCE_DAY_SOURCE_WIDTH = 32;
/** A UTC day, `YYYY-MM-DD`. */
export const SOURCE_DAY_DAY_WIDTH = 10;
/** The longest spender: a staff member's id, `step` or `*`. */
export const SOURCE_DAY_SPENDER_WIDTH = 64;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('source_days'))
    .ifNotExists()
    .addColumn('install_id', c.str(SOURCE_DAY_INSTALL_WIDTH), (col) => col.notNull())
    .addColumn('source', c.str(SOURCE_DAY_SOURCE_WIDTH), (col) => col.notNull())
    .addColumn('day', c.str(SOURCE_DAY_DAY_WIDTH), (col) => col.notNull())
    .addColumn('spender', c.str(SOURCE_DAY_SPENDER_WIDTH), (col) => col.notNull())
    .addColumn('calls', c.bigint, (col) => col.notNull())
    .addColumn('held', c.bigint, (col) => col.notNull())
    .addColumn('changed_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_source_days', ['install_id', 'source', 'day', 'spender'])
    .execute();
}
