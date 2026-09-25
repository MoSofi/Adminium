// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0044 — what an invoicing app needs the store to remember: which of an
 * app's tables are built on an add-on's shape, sign-in links, document
 * profiles an app owns, and a rendered document worth reusing.
 *
 * ─── `adminium_app_tables.built_on`, `.shape_columns` ──────────────────────
 * A table built on an add-on's shape (`invoices/invoice@1`, part `document`)
 * records the shape and part it was checked against at install, and which of
 * its columns the shape owns (a JSON array of names). Not `shape`, which
 * already means "apps declaring this may share one table" and is only 48
 * characters: two apps built on one shape get a table each.
 *
 * ─── `adminium_public_challenges.token_hash` ───────────────────────────────
 * A sign-in link carries a 32-byte token as well as the six-digit code, so
 * the challenge row holds two secrets. The token is stored as its SHA-256,
 * never plain, and looked up by that hash when the link is opened — hence the
 * index. `purpose` is already a free 16-character word, so `link` needs no
 * widening.
 *
 * ─── `adminium_document_profiles.owner_app`, `.order_by` ───────────────────
 * A profile made at an app's install (from an add-on's shape, or one the app
 * ships for its own tables) belongs to the app: `owner_app` is its key, and
 * the app's uninstall removes the profiles it made and nothing else. An
 * operator's hand-made profile keeps it NULL. `order_by` is the column a
 * document's lines are listed by (a line's `position`), so a printed invoice
 * lists them as the studio wrote them rather than in whatever order the
 * database returns.
 *
 * ─── `adminium_documents.reuse_key` ────────────────────────────────────────
 * A document rendered for a row is kept, and a second request for the same
 * row, unchanged, gets the same file back instead of drawing and storing
 * another: the key is the profile, the row, a hash of its values and (for a
 * statement) the period. Indexed with the connection, which every lookup
 * names, so one install's rows never answer another's.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('app_tables')).addColumn('built_on', c.str(160)).execute();
  await db.schema.alterTable(metaTable('app_tables')).addColumn('shape_columns', c.text).execute();

  await db.schema.alterTable(metaTable('public_challenges')).addColumn('token_hash', c.str(64)).execute();
  await db.schema
    .createIndex('ix_adminium_public_challenges_token')
    .on(metaTable('public_challenges'))
    .column('token_hash')
    .execute();

  await db.schema.alterTable(metaTable('document_profiles')).addColumn('owner_app', c.str(80)).execute();
  await db.schema.alterTable(metaTable('document_profiles')).addColumn('order_by', c.str(128)).execute();
  await db.schema
    .createIndex('ix_adminium_document_profiles_owner')
    .on(metaTable('document_profiles'))
    .columns(['connection_id', 'owner_app'])
    .execute();

  await db.schema.alterTable(metaTable('documents')).addColumn('reuse_key', c.str(191)).execute();
  await db.schema
    .createIndex('ix_adminium_documents_reuse')
    .on(metaTable('documents'))
    .columns(['connection_id', 'reuse_key'])
    .execute();
}
