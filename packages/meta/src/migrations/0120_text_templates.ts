// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0120 — the store of text-message templates.
 *
 * A text is a template of its own, one row per key and language, and never a
 * row of `adminium_email_templates`: that store requires a subject and blocks,
 * and a row hashed there reads as edited the moment its shape changes. So this
 * wave touches no installed email.
 *
 * As with an email, `managed_by` and `install_id` name the app that shipped a
 * row, and `content_hash` what it shipped: a row that no longer hashes to it
 * was edited by the operator, and an update leaves it alone.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { createIndexUnlessMade } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('text_templates'))
    .ifNotExists()
    .addColumn('key', c.str(80), (col) => col.notNull())
    .addColumn('locale', c.str(35), (col) => col.notNull())
    .addColumn('name', c.text, (col) => col.notNull())
    .addColumn('body', c.text, (col) => col.notNull())
    .addColumn('enabled', c.bool, (col) => col.notNull())
    .addColumn('managed_by', c.str(80))
    .addColumn('install_id', c.id)
    .addColumn('content_hash', c.str(64))
    .addColumn('updated_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_text_templates', ['key', 'locale'])
    .execute();
  await createIndexUnlessMade(db, c.dialect, 'ix_adminium_text_templates_managed', metaTable('text_templates'), ['managed_by', 'install_id']);
}
