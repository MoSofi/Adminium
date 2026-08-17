// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0008 — LLM apply overrides (06-llm-assist.md §8.3, T10b).
 *
 * The apply-EXECUTOR persists each accepted suggestion as an
 * `adminium_schema_overrides` row (`origin: 'llm'`, `llm_run_id`) whose §8.3
 * shape also carries a per-suggestion `confidence`. The base table (0003) has no
 * confidence column, so this migration ADDS one (never edits a shipped
 * migration).
 *
 * The column is NULLABLE and additive: existing user-remap rows keep `confidence
 * = NULL` (a human edit has no model confidence), and `overridesRepo` — which
 * omits the column on insert — is unaffected. `real` is portable (PG real /
 * MySQL real≡double / SQLite REAL) and stores a 0..1 score with room to spare.
 */

import { sql, type Kysely } from 'kysely';

import { metaTable } from '../prefix.js';

/** No {@link ColumnHelpers} needed — `real` is portable and added via raw SQL. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable(metaTable('schema_overrides'))
    .addColumn('confidence', sql`real`)
    .execute();
}
