// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0074 — files a stranger uploads (a form's file question first; an
 * app's public write later).
 *
 * One row per file taken from a stranger's browser. The bytes are an
 * `adminium_files` row of kind `stranger` (`file_id`), which no staff route
 * serves; this row says what the file is for and whose it became:
 *
 *  - `id`: 32 random url-safe characters, the handle the stranger's page
 *    holds and sends with its answer;
 *  - the binding: what it was taken for (`binding_kind` + `binding_key`,
 *    e.g. `form` + `<add-on>/<form id>`) and from where (`address_key`, a
 *    keyed hash of the network address's /64, never the address). Only a
 *    write with the same binding may attach it;
 *  - `name` (cleaned), `size`, `kind` (the closed list's word: jpg, png,
 *    pdf, text…);
 *  - `expires_at` while it is unattached (two hours after it came);
 *    `attached_at` and the owner (the row it became part of, by connection,
 *    table and key) once a write took it, when the expiry is cleared;
 *  - `removed_at`: the sweep took an unattached file's bytes and its name; the
 *    row stays, empty, until a day after it came, so the per-address daily
 *    count still sees it.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('public_uploads'))
    .ifNotExists()
    .addColumn('id', c.str(32), (col) => col.primaryKey())
    .addColumn('binding_kind', c.str(20), (col) => col.notNull())
    .addColumn('binding_key', c.str(200), (col) => col.notNull())
    .addColumn('address_key', c.str(64), (col) => col.notNull())
    .addColumn('name', c.str(255))
    .addColumn('size', c.bigint, (col) => col.notNull())
    .addColumn('kind', c.str(20), (col) => col.notNull())
    .addColumn('file_id', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('expires_at', c.ts)
    .addColumn('attached_at', c.ts)
    .addColumn('owner_connection_id', c.id)
    .addColumn('owner_table', c.str(200))
    .addColumn('owner_key', c.str(200))
    .addColumn('removed_at', c.ts)
    .addForeignKeyConstraint('fk_adminium_public_uploads_file_id', ['file_id'], metaTable('files'), ['id'], (cb) => cb.onDelete('set null'))
    .execute();
  // Everything taken for one form (its removal takes them all).
  await db.schema
    .createIndex('ix_adminium_public_uploads_binding')
    .on(metaTable('public_uploads'))
    .columns(['binding_kind', 'binding_key'])
    .execute();
  // One address's uploads of the last day (the daily cap).
  await db.schema
    .createIndex('ix_adminium_public_uploads_address')
    .on(metaTable('public_uploads'))
    .columns(['address_key', 'created_at'])
    .execute();
  // The sweep: what has expired unattached.
  await db.schema
    .createIndex('ix_adminium_public_uploads_expires')
    .on(metaTable('public_uploads'))
    .columns(['expires_at'])
    .execute();
  // The files of a row (its removal takes them).
  await db.schema
    .createIndex('ix_adminium_public_uploads_owner')
    .on(metaTable('public_uploads'))
    .columns(['owner_connection_id', 'owner_table', 'owner_key'])
    .execute();
}
