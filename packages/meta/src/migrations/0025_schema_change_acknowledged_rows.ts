// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium_schema_changes.acknowledged_rows` — 35-schema-authoring.md §3.5,
 * D18, §10 criterion 16… criterion 18.
 *
 * §3.5's migration spec listed this column and `0023_schema_authoring` did not
 * ship it, so D18's acknowledgement — the operator confirming they saw the row
 * count before a rewrite ran — was collected on the wire and then forgotten.
 * The ledger is the record of what an operator authorised; "they were shown
 * 1.4 million rows and said yes" is exactly the kind of fact it exists to hold,
 * and the kind nobody can reconstruct afterwards.
 *
 * Its own migration rather than an edit to 0023: 0023 has already run on real
 * meta stores, and a migration that has run is a historical fact.
 */
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('adminium_schema_changes')
    // NULL is meaningful and is the common case: most plans warn about no rows
    // at all, and 0 would claim an acknowledgement of zero rows was given.
    .addColumn('acknowledged_rows', 'integer')
    .execute();
}
