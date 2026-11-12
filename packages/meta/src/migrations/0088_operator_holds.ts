// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0088 — what the server's operator holds back on this instance.
 *
 * One row per hold, by name. The first is `public-pages`: the operator hid
 * every public page (customer sides, forms, the mail door, the public API and
 * the other doors a stranger reaches), with the reason Studio shows the
 * instance's owner. Only the operator endpoint writes it; no settings route,
 * config import or export, and no archive carries or restores it, which is
 * why it is a table of its own and not a setting.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The longest hold name. */
export const OPERATOR_HOLD_NAME_WIDTH = 40;
/** The longest reason the operator may give. */
export const OPERATOR_HOLD_REASON_WIDTH = 500;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('operator_holds'))
    .ifNotExists()
    .addColumn('name', c.str(OPERATOR_HOLD_NAME_WIDTH), (col) => col.primaryKey())
    .addColumn('held', c.bool, (col) => col.notNull())
    .addColumn('reason', c.str(OPERATOR_HOLD_REASON_WIDTH))
    .addColumn('changed_at', c.ts, (col) => col.notNull())
    .execute();
}
