// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0061 — a person's own Figma token, on their own row.
 *
 * The Designer reads a frame from Figma with the token of the person who asked: one token per
 * person, since a shared one would let anyone import anything its owner can open.
 *
 * ─── The columns ──────────────────────────────────────────────────────────
 * - `figma_token_encrypted`: the token in the server's AES-GCM envelope, under a key of its own
 *   purpose (not the one two-factor secrets use). `text`, not a short varchar: the envelope's length
 *   is not fixed, and MySQL refuses or cuts what a varchar cannot hold.
 * - `figma_handle`: the name Figma's `/v1/me` gave when the token was saved, shown back to the person.
 * - `figma_user_id`: whose Figma account the token is. Figma counts a personal token's reads per
 *   Figma user, so the pause below is kept by this id: two people (or a person and the project's own
 *   token) on one Figma account share it.
 * - `figma_paused_until` (epoch ms) and `figma_pause_dated`: after Figma said a seat's reads are used
 *   up, the Designer's own reads stop until then (at most 31 days). Dated when Figma said when;
 *   otherwise they stop until the person's own import succeeds.
 *
 * Every column is nullable or defaulted: a row before this wave has no Figma token.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  // One column a statement: SQLite adds a single column per ALTER TABLE.
  await db.schema.alterTable(metaTable('users')).addColumn('figma_token_encrypted', c.text).execute();
  await db.schema.alterTable(metaTable('users')).addColumn('figma_handle', c.str(120)).execute();
  await db.schema.alterTable(metaTable('users')).addColumn('figma_user_id', c.str(200)).execute();
  await db.schema.alterTable(metaTable('users')).addColumn('figma_paused_until', c.ts).execute();
  await db.schema
    .alterTable(metaTable('users'))
    .addColumn('figma_pause_dated', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .execute();
}
