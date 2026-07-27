/**
 * Wave 0011 — `adminium_connections.last_error_hint` (07-meta-store.md §3.13).
 *
 * `last_error` persists the driver message; the adapter's remediation `hint`
 * (05 §3) was dropped on the floor, so a failure that is only actionable
 * through its hint — "that host is a transaction pooler, use the unpooled
 * one" — degraded to the bare SQLSTATE text as soon as the Hub was reloaded.
 * Storing the two side by side keeps `last_error` exactly what it has always
 * been (0003 is applied and checksummed; never edited).
 *
 * Nullable with no default: existing rows have no recorded hint, and `null`
 * already means "nothing to add" everywhere it is read.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .alterTable(metaTable('connections'))
    .addColumn('last_error_hint', c.text)
    .execute();
}
