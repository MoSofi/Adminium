// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0060 — two switches a person keeps on `adminium_notification_schedules`.
 *
 * ─── `quiet_off` ───────────────────────────────────────────────────────────
 * Quiet hours switched off for now. The hours of each weekday stay where they
 * are, so switching them back on brings back the very same hours; while it is
 * set nothing is held. Before this wave "off" could only mean deleting the
 * hours, and "on" could not bring them back.
 *
 * ─── `summaries_off` ───────────────────────────────────────────────────────
 * "Not me": no rule's summary is made for this person, whichever of the
 * step's roles they hold. The day and time they chose stay for when they
 * switch summaries back on. A summary they ask for themselves is still sent.
 *
 * ─── Backfill ──────────────────────────────────────────────────────────────
 * The defaults do it: every row before this wave had its hours on and its
 * summaries sent, which is exactly what `false` means for both.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  // One column a statement: SQLite adds a single column per ALTER TABLE.
  await db.schema
    .alterTable(metaTable('notification_schedules'))
    .addColumn('quiet_off', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .execute();
  await db.schema
    .alterTable(metaTable('notification_schedules'))
    .addColumn('summaries_off', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .execute();
}
