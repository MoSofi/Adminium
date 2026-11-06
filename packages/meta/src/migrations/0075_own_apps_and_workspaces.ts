// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0075 — apps a person saves, and workspaces.
 *
 *  - `app_saves`: one row per Save as app. The key, the version (one version
 *    is saved once: unique on key + version), the lineage drawn on the first
 *    save, the database it came from, the label for where it was made, who
 *    saved it, when, and the fingerprint (`sha512-<base64>`) of the file.
 *    `file_id` is the copy kept for "Download again".
 *  - `app_after_install`: what an install still needs from a person (a key,
 *    a webhook address, a sender), one row per item and field, ticked off
 *    when done. Keyed by the install (`manifest_id`), cascading with it.
 *  - `workspaces`: a named group of databases (name unique, at most 80),
 *    ordered by `position`, with an optional sender of its own.
 *  - `workspace_connections`: which databases a workspace holds. A database
 *    may sit in several workspaces or in none; both foreign keys cascade.
 *  - `user_prefs.workspace_id`: the last workspace a person chose, the start
 *    for a new tab; SET NULL when the workspace goes.
 *  - `shown_in` on email templates, report layouts and invoice layouts
 *    (`all` | `chosen`, default `all`), and `item_workspaces`, the chosen
 *    workspaces of an item. The item is named by kind and id (no foreign
 *    key: it is one of three tables), so its rows are deleted with it.
 *  - `workspace_saves` and `workspace_installs`: a whole workspace saved as
 *    one file, and the install of one, which survives a reload.
 *
 * No workspace is created here: a server with none shows the menu it showed
 * before.
 */
import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

/** `sha512-` + 88 base64 characters, with room. */
const FINGERPRINT = 100;

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const users = metaTable('users');
  const connections = metaTable('connections');
  const files = metaTable('files');
  const manifests = metaTable('manifests');
  const workspaces = metaTable('workspaces');

  // ── saves ─────────────────────────────────────────────────────────────────
  await db.schema
    .createTable(metaTable('app_saves'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('app_key', c.str(80), (col) => col.notNull())
    .addColumn('version', c.str(20), (col) => col.notNull())
    .addColumn('lineage', c.str(36), (col) => col.notNull())
    .addColumn('connection_id', c.id)
    .addColumn('label', c.str(120), (col) => col.notNull())
    .addColumn('saved_by', c.id)
    .addColumn('saved_at', c.ts, (col) => col.notNull())
    .addColumn('integrity', c.str(FINGERPRINT), (col) => col.notNull())
    .addColumn('bytes', c.bigint, (col) => col.notNull())
    .addColumn('file_id', c.id)
    .addForeignKeyConstraint('fk_adminium_app_saves_connection_id', ['connection_id'], connections, ['id'], (cb) => cb.onDelete('set null'))
    .addForeignKeyConstraint('fk_adminium_app_saves_saved_by', ['saved_by'], users, ['id'], (cb) => cb.onDelete('set null'))
    .addForeignKeyConstraint('fk_adminium_app_saves_file_id', ['file_id'], files, ['id'], (cb) => cb.onDelete('set null'))
    .execute();
  await db.schema.createIndex('uq_adminium_app_saves_key_version').on(metaTable('app_saves')).columns(['app_key', 'version']).unique().execute();
  await db.schema.createIndex('ix_adminium_app_saves_connection').on(metaTable('app_saves')).columns(['connection_id', 'saved_at']).execute();

  // ── after you install ─────────────────────────────────────────────────────
  await db.schema
    .createTable(metaTable('app_after_install'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('manifest_id', c.id, (col) => col.notNull())
    .addColumn('app_key', c.str(80), (col) => col.notNull())
    /** `secret-setting` | `webhook` | `address` | `sender` | `payment-key` | `system-grant` | … */
    .addColumn('kind', c.str(40), (col) => col.notNull())
    .addColumn('item', c.str(200), (col) => col.notNull())
    .addColumn('field', c.str(200), (col) => col.notNull())
    .addColumn('done', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('done_by', c.id)
    .addColumn('done_at', c.ts)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_app_after_install_manifest_id', ['manifest_id'], manifests, ['id'], (cb) => cb.onDelete('cascade'))
    .addForeignKeyConstraint('fk_adminium_app_after_install_done_by', ['done_by'], users, ['id'], (cb) => cb.onDelete('set null'))
    .execute();
  await db.schema
    .createIndex('uq_adminium_app_after_install_item')
    .on(metaTable('app_after_install'))
    .columns(['manifest_id', 'kind', 'item', 'field'])
    .unique()
    .execute();

  // ── workspaces ────────────────────────────────────────────────────────────
  await db.schema
    .createTable(workspaces)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(80), (col) => col.notNull())
    .addColumn('position', c.int, (col) => col.notNull())
    .addColumn('sender_name', c.str(120))
    .addColumn('sender_from', c.str(320))
    .addColumn('sender_reply_to', c.str(320))
    .addColumn('sender_postal', c.text)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_workspaces_created_by', ['created_by'], users, ['id'], (cb) => cb.onDelete('set null'))
    .execute();
  await db.schema.createIndex('uq_adminium_workspaces_name').on(workspaces).columns(['name']).unique().execute();

  await db.schema
    .createTable(metaTable('workspace_connections'))
    .ifNotExists()
    .addColumn('workspace_id', c.id, (col) => col.notNull())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_workspace_connections', ['workspace_id', 'connection_id'])
    .addForeignKeyConstraint('fk_adminium_workspace_connections_workspace', ['workspace_id'], workspaces, ['id'], (cb) => cb.onDelete('cascade'))
    .addForeignKeyConstraint('fk_adminium_workspace_connections_connection', ['connection_id'], connections, ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await db.schema
    .createIndex('ix_adminium_workspace_connections_connection')
    .on(metaTable('workspace_connections'))
    .columns(['connection_id'])
    .execute();

  // The person's last choice: the start for a new tab, never a filter.
  const prefs = metaTable('user_prefs');
  if (c.dialect === 'sqlite') {
    await sql`ALTER TABLE ${sql.table(prefs)} ADD COLUMN workspace_id char(36) REFERENCES ${sql.table(workspaces)}(id) ON DELETE SET NULL`.execute(db);
  } else {
    await db.schema.alterTable(prefs).addColumn('workspace_id', c.id).execute();
    await db.schema
      .alterTable(prefs)
      .addForeignKeyConstraint('fk_adminium_user_prefs_workspace_id', ['workspace_id'], workspaces, ['id'], (cb) => cb.onDelete('set null'))
      .execute();
  }

  // ── "Shown in" ────────────────────────────────────────────────────────────
  for (const table of ['email_templates', 'report_documents', 'invoice_documents']) {
    await db.schema
      .alterTable(metaTable(table))
      .addColumn('shown_in', c.str(8), (col) => col.notNull().defaultTo('all'))
      .execute();
  }
  await db.schema
    .createTable(metaTable('item_workspaces'))
    .ifNotExists()
    /** `email-template` | `report` | `invoice` */
    .addColumn('kind', c.str(20), (col) => col.notNull())
    .addColumn('item_id', c.id, (col) => col.notNull())
    .addColumn('workspace_id', c.id, (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_adminium_item_workspaces', ['kind', 'item_id', 'workspace_id'])
    .addForeignKeyConstraint('fk_adminium_item_workspaces_workspace', ['workspace_id'], workspaces, ['id'], (cb) => cb.onDelete('cascade'))
    .execute();
  await db.schema
    .createIndex('ix_adminium_item_workspaces_workspace')
    .on(metaTable('item_workspaces'))
    .columns(['workspace_id'])
    .execute();

  // ── workspace files ───────────────────────────────────────────────────────
  await db.schema
    .createTable(metaTable('workspace_saves'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('workspace_id', c.id)
    .addColumn('name', c.str(80), (col) => col.notNull())
    .addColumn('label', c.str(120), (col) => col.notNull())
    .addColumn('saved_by', c.id)
    .addColumn('saved_at', c.ts, (col) => col.notNull())
    .addColumn('integrity', c.str(FINGERPRINT), (col) => col.notNull())
    .addColumn('bytes', c.bigint, (col) => col.notNull())
    /** The app saves inside, in the file's order: JSON array of `app_saves.id`. */
    .addColumn('app_save_ids', c.json, (col) => col.notNull())
    /** The `workspace.json` as written, so "Download again" re-packs the same bytes. */
    .addColumn('document', c.text, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_workspace_saves_workspace', ['workspace_id'], workspaces, ['id'], (cb) => cb.onDelete('set null'))
    .addForeignKeyConstraint('fk_adminium_workspace_saves_saved_by', ['saved_by'], users, ['id'], (cb) => cb.onDelete('set null'))
    .execute();

  await db.schema
    .createTable(metaTable('workspace_installs'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('integrity', c.str(FINGERPRINT), (col) => col.notNull())
    /** The staged outer file (the store's staging id). */
    .addColumn('staged', c.str(200), (col) => col.notNull())
    .addColumn('name', c.str(80), (col) => col.notNull())
    /** `[{key, version, integrity, target, state, error?}]` in install order. */
    .addColumn('apps', c.json, (col) => col.notNull())
    /** `{mode: 'create'|'existing'|'none', workspaceId?, name?}`. */
    .addColumn('workspace_choice', c.json)
    /** `staged` | `running` | `stopped` | `done` | `discarded` */
    .addColumn('state', c.str(12), (col) => col.notNull())
    /** The run holding the row: one at a time. */
    .addColumn('run_lock', c.str(36))
    .addColumn('locked_at', c.ts)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_workspace_installs_created_by', ['created_by'], users, ['id'], (cb) => cb.onDelete('set null'))
    .execute();
}
