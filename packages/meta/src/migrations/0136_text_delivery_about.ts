// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0136 — which app sent a text, and with which template.
 *
 * A conversation shows the texts an app sent the number, by template, without
 * keeping their words: these two columns are what it reads. A reply that
 * arrives later goes to the app that texted the number last. Both are null for
 * a text no app sent, such as a STOP's confirmation.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { columnExists } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const table = metaTable('text_deliveries');
  if (!(await columnExists(db, c.dialect, table, 'about_app'))) await db.schema.alterTable(table).addColumn('about_app', c.str(64)).execute();
  if (!(await columnExists(db, c.dialect, table, 'about_template'))) await db.schema.alterTable(table).addColumn('about_template', c.str(80)).execute();
}
