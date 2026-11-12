// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0089 — what the server's operator counts on this instance.
 *
 * One row per tally, by name, with a whole number. The first two: the tokens
 * the operator's own AI connection has spent over the instance's life (the
 * operator's budget is held against it), and whether the Designer's start
 * prompt has run. Only the server writes them; no settings route, config
 * import or export, and no archive carries or restores them, which is why
 * they are a table of their own and not settings a super admin could write.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The longest tally name. */
export const OPERATOR_TALLY_NAME_WIDTH = 40;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('operator_tallies'))
    .ifNotExists()
    .addColumn('name', c.str(OPERATOR_TALLY_NAME_WIDTH), (col) => col.primaryKey())
    .addColumn('amount', c.bigint, (col) => col.notNull())
    .addColumn('changed_at', c.ts, (col) => col.notNull())
    .execute();
}
