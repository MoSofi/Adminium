// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0048 — a browser key's own budget at its app's peak.
 *
 * ─── `adminium_public_keys.peak_reads`, `.peak_writes` ─────────────────────
 * Every browser key reads 3,000 and writes 300 a minute, each visitor a
 * twelfth of that. An app whose guests arrive all at once (a show going on
 * sale) says its own, up to five times as much, in its manifest's
 * `publicKeys.<key>.peak`; the install writes it here, and the limiter reads
 * it with the key. Empty for every key made before this wave, and for any key
 * an operator made: Adminium's own budget.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('public_keys')).addColumn('peak_reads', c.int).execute();
  await db.schema.alterTable(metaTable('public_keys')).addColumn('peak_writes', c.int).execute();
}
