// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0129 — how many of an inbound event's claims died with the process.
 *
 * `attempts` cannot say: it also counts ordinary errors, which come back and
 * are retried. An event that takes the process down never reaches the code that
 * would count it, so the next claim counts the one before it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { columnExists } from './probe.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const table = metaTable('inbound_events');
  if (await columnExists(db, c.dialect, table, 'lost_claims')) return;
  await db.schema.alterTable(table).addColumn('lost_claims', c.int, (col) => col.notNull().defaultTo(0)).execute();
}
