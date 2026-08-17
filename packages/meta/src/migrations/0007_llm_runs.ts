// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0007 — LLM run lifecycle (06-llm-assist.md §7.4).
 *
 * 0006 shipped `adminium_llm_runs` but only carried a `validation_status` field,
 * not the full run-storage contract §7.4 requires. This migration ADDS the
 * missing columns (never edits 0006):
 *
 *   status          — the authoritative §7.4 run-lifecycle machine
 *                     (draft → running|awaiting_response → validated →
 *                      applied|partially_applied, or → failed|discarded)
 *   sections        — requested decision groups (§4.4), json string array
 *   locales         — requested output locales (§4.1), json string array
 *   sampling        — sampling opt-in (§4.2): null | { maxValuesPerColumn }
 *   chunks_total    — map-reduce chunk count (1 when unchunked)
 *   chunks_received — chunk responses received so far
 *   prompt_text     — full flattened prompt(s); enables BYO re-download
 *   review          — accepted/rejected suggestion-id lists (§8.3)
 *
 * Reconciliation: 0006's `mode` ('provider'|'byo') stays as the doc's `path`
 * discriminator, and `validation_status` is KEPT as a secondary
 * last-validation-outcome signal (orthogonal to the lifecycle `status`) — see
 * json-payloads.ts. `tokens_in`/`tokens_out` cover the doc's
 * `input_tokens`/`output_tokens`; `prompt_hash` covers `prompt_sha256`.
 *
 * Each column is added in its own `ALTER TABLE … ADD COLUMN` statement: SQLite
 * accepts only one added column per statement. NOT NULL columns carry a DEFAULT
 * (portable across PG/MySQL/SQLite); the json/text columns are nullable (MySQL
 * forbids DEFAULT on TEXT/JSON) and are always written by the run-service.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const table = metaTable('llm_runs');

  // Run-lifecycle machine (§7.4) — authoritative state; new rows start `draft`.
  await db.schema
    .alterTable(table)
    .addColumn('status', c.str(20), (col) => col.notNull().defaultTo('draft'))
    .execute();

  // Builder inputs (§4.1/§4.4) — opaque json, always set by the run-service.
  await db.schema.alterTable(table).addColumn('sections', c.json).execute();
  await db.schema.alterTable(table).addColumn('locales', c.json).execute();
  await db.schema.alterTable(table).addColumn('sampling', c.json).execute();

  // Map-reduce chunk progress (§4.5) — 1/0 when unchunked.
  await db.schema
    .alterTable(table)
    .addColumn('chunks_total', c.int, (col) => col.notNull().defaultTo(1))
    .execute();
  await db.schema
    .alterTable(table)
    .addColumn('chunks_received', c.int, (col) => col.notNull().defaultTo(0))
    .execute();

  // Full flattened prompt(s) — enables re-download of BYO prompts (§7.4).
  await db.schema.alterTable(table).addColumn('prompt_text', c.text).execute();

  // Accepted/rejected suggestion-id lists persisted across re-review (§8.3).
  await db.schema.alterTable(table).addColumn('review', c.json).execute();

  // Run history is listed per connection, newest first (§10.1).
  await db.schema
    .createIndex('idx_adminium_llm_runs_conn_created')
    .on(table)
    .columns(['connection_id', 'created_at'])
    .execute();
}
