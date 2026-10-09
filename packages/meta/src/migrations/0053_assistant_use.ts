// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0053 — what a person has used of the assistant today.
 *
 * ─── `adminium_assistant_use` ──────────────────────────────────────────────
 * One row a person a day: the tokens the assistant spent for them and the
 * questions they asked. A workspace sets how much a person may use in a day;
 * this is what that number is held against.
 *
 * WHY A TABLE AND NOT A SUM OVER THE TURNS. A turn's tokens reach its row
 * only when it ENDS, so a check made while it runs never sees it, and thirty
 * turns opened at once all pass a sum. This row is added to after every
 * round, by one statement that adds (never a read and a write), so what has
 * been spent is known while it is being spent.
 *
 * THE DAY IS THE UTC DAY, as text (`2026-10-09`). A workspace has no clock of
 * its own (a time zone belongs to a connection), and a day everybody's
 * allowance turns over on must be one day.
 *
 * `voice_seconds` is here for dictation's own allowance; nothing writes it yet.
 *
 * Rows go with the person: deleting a user deletes what they used.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('assistant_use'))
    .ifNotExists()
    .addColumn('user_id', c.id, (col) => col.notNull())
    /** The UTC day, `YYYY-MM-DD`. */
    .addColumn('day', c.str(10), (col) => col.notNull())
    .addColumn('tokens', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('turns', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('voice_seconds', c.int, (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('pk_adminium_assistant_use', ['user_id', 'day'])
    .addForeignKeyConstraint('fk_adminium_assistant_use_user_id', ['user_id'], metaTable('users'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  // "Today, by person": every row of one day.
  await db.schema.createIndex('ix_adminium_assistant_use_day').on(metaTable('assistant_use')).columns(['day']).execute();
}
