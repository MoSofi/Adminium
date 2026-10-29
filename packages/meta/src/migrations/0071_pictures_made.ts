// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0071 — pictures made with AI, counted a UTC day at a time.
 *
 * Each picture made in the Designer is charged to the account of the key it
 * was made with, so a workspace holds it to two allowances: one per person
 * and one for everybody. The person's is a column beside the assistant's own
 * counts (`adminium_assistant_use.pictures_made`); everybody's is its own
 * table, one row a day, because a use row belongs to a person (its user id is
 * a foreign key) and the workspace is nobody.
 *
 * Both are added to by ONE conditional statement that checks and adds at
 * once (`made + n <= limit`), never a read and a write, so thirty requests at
 * the same moment cannot all pass a check none of them has paid into.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('assistant_use'))
    .addColumn('pictures_made', c.int, (col) => col.notNull().defaultTo(0))
    .execute();
  await db.schema
    .createTable(metaTable('picture_use'))
    .ifNotExists()
    /** The UTC day, `YYYY-MM-DD`. */
    .addColumn('day', c.str(10), (col) => col.primaryKey())
    .addColumn('made', c.int, (col) => col.notNull().defaultTo(0))
    .execute();
}
