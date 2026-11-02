// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0073 — what a form's answers are counted by.
 *
 * One row per thing a stranger's answer to a form counts against: an answer
 * from a network address, an answer to a form, an answer naming an e-mail
 * address, a confirmation mail sent to an address, a cap's alert sent to the
 * owner. `subject` says what is counted, always a keyed hash or an id, never
 * an address in clear; `purpose` says which count it is. A cap reads how many
 * rows of a subject and purpose were made since a moment, the way the public
 * door's markers are read (`adminium_public_challenges`, 0014) — but with no
 * key behind it: a form answers nobody's key, so it cannot keep its markers
 * there (that table's `key_id` links to a key).
 *
 * The rows are kept two days and swept: no cap looks back further than one.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** The longest subject: a prefix and a keyed hash, or a form's id. */
export const FORM_MARK_SUBJECT_WIDTH = 191;
/** The longest purpose name. */
export const FORM_MARK_PURPOSE_WIDTH = 16;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('form_marks'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('subject', c.str(FORM_MARK_SUBJECT_WIDTH), (col) => col.notNull())
    .addColumn('purpose', c.str(FORM_MARK_PURPOSE_WIDTH), (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .execute();
  // A cap's count: one subject's rows of one purpose since a moment.
  await db.schema
    .createIndex('ix_adminium_form_marks_subject')
    .on(metaTable('form_marks'))
    .columns(['subject', 'purpose', 'created_at'])
    .execute();
  // The sweep: what is older than any cap reads.
  await db.schema
    .createIndex('ix_adminium_form_marks_created')
    .on(metaTable('form_marks'))
    .columns(['created_at'])
    .execute();
}
