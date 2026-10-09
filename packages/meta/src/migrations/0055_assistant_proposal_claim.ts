// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0055 — a proposal is confirmed once.
 *
 * ─── `adminium_assistant_turns.proposal_claimed_at`, `.proposal_done_at` ───
 * What the assistant proposes is carried out when the person confirms it,
 * and only once. The claim is one guarded update of the first column
 * (`… WHERE proposal_claimed_at IS NULL`), so a second click, a retry or a
 * second window finds it taken on every engine; a guard inside the turn's
 * JSON answer could not be one statement on all three.
 *
 * The second column is set when the run has written its outcome. Claimed and
 * never done is a run that died with its process: found, and ended, at the
 * next start.
 *
 * Both NULL on every turn written before this wave: none of them proposed
 * anything.
 *
 * One `alterTable` a column: MySQL takes several in one statement and SQLite
 * does not.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('assistant_turns')).addColumn('proposal_claimed_at', c.ts).execute();
  await db.schema.alterTable(metaTable('assistant_turns')).addColumn('proposal_done_at', c.ts).execute();
}
