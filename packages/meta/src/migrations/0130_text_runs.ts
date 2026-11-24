// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0130 — marketing text runs: one text template sent to the people of one
 * table who agreed to marketing texts.
 *
 * `content` is the template as it was when the run was made, every language
 * of it, as JSON. A template edited afterwards changes the next run, not this
 * one. The audience is the table, and a saved view of it, read again as the
 * person who made the run when it starts.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

/** A table's id as the snapshot names it, as the consent log keeps it. */
const TABLE_MAX = 200;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const runs = metaTable('text_runs');
  await db.schema
    .createTable(runs)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(120), (col) => col.notNull())
    .addColumn('template_key', c.str(80), (col) => col.notNull())
    .addColumn('content', c.text, (col) => col.notNull())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('person_table', c.str(TABLE_MAX), (col) => col.notNull())
    .addColumn('view_id', c.id)
    .addColumn('status', c.str(16), (col) => col.notNull())
    .addColumn('reason', c.str(40))
    .addColumn('scheduled_at', c.ts, (col) => col.notNull())
    .addColumn('started_at', c.ts)
    .addColumn('finished_at', c.ts)
    .addColumn('waiting_until', c.ts)
    .addColumn('job_id', c.id)
    .addColumn('created_by', c.id, (col) => col.notNull())
    .addColumn('cancelled_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_runs_created', runs, ['created_at', 'id']);
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_runs_status', runs, ['status']);
}
