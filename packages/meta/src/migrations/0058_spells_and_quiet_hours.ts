// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0058 — a rule's spells, and a person's quiet hours.
 *
 * ─── `adminium_automation_spells` ──────────────────────────────────────────
 * A rule that runs by the clock may visit a row "once per spell": once for
 * each stretch of time the row matches. A run's own key cannot remember that
 * (a row that stops matching leaves no trace, and finished runs are swept),
 * so each rule keeps, per row, the number of the spell it is in and whether
 * that spell is still open. A tick that finds the row matching while its
 * spell is closed opens the next one and starts a run; a tick that no longer
 * finds it closes the spell. Rows go with their rule.
 *
 * ─── `adminium_notification_schedules` ─────────────────────────────────────
 * One row a person, and only for a person who set something: their time
 * zone (used for when a notice reaches them, and for nothing else), the
 * hours of each weekday in which they are not to be disturbed, and the day
 * and time their summaries are sent. No row means none of it: every notice
 * at once, and a summary when its rule runs.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('automation_spells'))
    .ifNotExists()
    .addColumn('automation_id', c.id, (col) => col.notNull())
    // The row's key as a run's own key spells it: at most 160 characters, a longer one hashed.
    .addColumn('row_key', c.str(160), (col) => col.notNull())
    .addColumn('spell', c.int, (col) => col.notNull())
    .addColumn('open', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('last_tick', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_automation_spells', ['automation_id', 'row_key'])
    .addForeignKeyConstraint('fk_adminium_automation_spells_automation_id', ['automation_id'], metaTable('automations'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();

  await db.schema
    .createTable(metaTable('notification_schedules'))
    .ifNotExists()
    .addColumn('user_id', c.id, (col) => col.primaryKey())
    .addColumn('timezone', c.str(64))
    .addColumn('quiet', c.json)
    .addColumn('digest_day', c.int)
    .addColumn('digest_time', c.str(5))
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_notification_schedules_user_id', ['user_id'], metaTable('users'), ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
}
