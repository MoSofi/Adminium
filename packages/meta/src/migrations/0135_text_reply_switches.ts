// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0135 — whether each app's replies are read, and the "not read" answer's
 * one-per-number limit.
 *
 * `text_reply_switches`: one row per app whose switch a person changed. An app
 * with no row follows its manifest's `textReplies`, on unless it says off.
 *
 * `text_auto_answers`: when a number last got the fixed "this number is not
 * read" answer, by its keyed hash under `key_version` (unique together). The
 * limit is one update of this row, so two replies at once get one answer.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('text_reply_switches'))
    .ifNotExists()
    .addColumn('app_key', c.str(64), (col) => col.primaryKey())
    .addColumn('replies', c.str(4), (col) => col.notNull())
    .addColumn('changed_by_id', c.id)
    .addColumn('changed_by_label', c.str(255))
    .addColumn('changed_at', c.ts, (col) => col.notNull())
    .execute();

  const answers = metaTable('text_auto_answers');
  await db.schema
    .createTable(answers)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('phone_hash', c.str(64), (col) => col.notNull())
    .addColumn('key_version', c.int, (col) => col.notNull())
    .addColumn('answered_at', c.ts, (col) => col.notNull())
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ux_adminium_text_auto_answers_phone', answers, ['phone_hash', 'key_version'], { unique: true });
}
