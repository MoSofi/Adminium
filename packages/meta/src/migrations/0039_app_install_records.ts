// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0039 — what an installed app made, and who manages what.
 *
 * Nothing here is destructive: one new table, and every column added to an
 * existing table is nullable or has a default.
 *
 * ─── `adminium_app_tables` ─────────────────────────────────────────────────
 * One row per table an installed app uses on one connection: the manifest's
 * short name (`ref`), the real table it resolved to (`table_name`, e.g.
 * `pos_menu_items`), whether this install created it (`owned`), and where it is
 * in its life (`state`: pending, created, adopted, shared, released, dropped).
 * Until now nothing recorded which tables an app created, so an uninstall could
 * not tell the app's own tables from an operator's, and a reinstall could not
 * recognise its leftovers.
 *
 * - `manifest_id` is SET NULL on delete, not CASCADE. Uninstalling removes the
 *   manifest row but keeps the tables (and so their records, as `released`),
 *   and a reinstall re-attaches them by `app_key`.
 * - `connection_id` CASCADEs: a table record for a connection that no longer
 *   exists describes nothing.
 * - `rules` lists the column rules the installer wrote, each with the hash of
 *   the value it wrote, so update and uninstall touch only rules nobody has
 *   changed since. It is an array of small objects that are parsed, never
 *   byte-compared, so the key reordering `jsonb` and MySQL's `json` do is
 *   harmless here.
 * - `table_name` is `str(64)`: MySQL's identifier limit; Postgres allows 63
 *   bytes, and the planner refuses a longer real name before any DDL runs.
 * - Unique on (connection, app, ref): one real table per short name per
 *   install. Indexed on (connection, table name), the lookup "who uses this
 *   table", which sharing and uninstall both make.
 *
 * ─── `adminium_roles.app_key`, `.screens_only` ─────────────────────────────
 * A role an app's manifest created carries the app's key, so disabling the app
 * can suspend it and uninstalling can remove it. `screens_only` marks a role
 * that opens the app's own screens and never the dashboard (a till cashier).
 * Every existing role is neither.
 *
 * ─── `managed_by` on public endpoints and keys ─────────────────────────────
 * The app key that created the row at install. A managed key may hold only
 * safe methods, and an endpoint edit that would widen one is refused; uninstall
 * removes exactly the rows it names. NULL for everything an operator made.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('app_tables'))
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('app_key', c.str(80), (col) => col.notNull())
    .addColumn('manifest_id', c.id)
    .addColumn('connection_id', c.id, (col) => col.notNull())
    /** The manifest's short name. */
    .addColumn('ref', c.str(64), (col) => col.notNull())
    /** The real table, prefixed or not. */
    .addColumn('table_name', c.str(64), (col) => col.notNull())
    .addColumn('schema_name', c.str(64))
    .addColumn('owned', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    /** `pending | created | adopted | shared | released | dropped`. */
    .addColumn('state', c.str(12), (col) => col.notNull())
    /** `app | sample-ledger` — a bookkeeping table is hidden from pages and endpoints. */
    .addColumn('role', c.str(16), (col) => col.notNull().defaultTo('app'))
    /** The prefix in force when the table was recorded (an alternative one, if chosen). */
    .addColumn('prefix', c.str(96))
    /** e.g. `menu@1`, for tables two apps may share. */
    .addColumn('shape', c.str(48))
    .addColumn('rules', c.json)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addColumn('released_at', c.ts)
    .addForeignKeyConstraint(
      'fk_adminium_app_tables_manifest',
      ['manifest_id'],
      metaTable('manifests'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_app_tables_connection',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  await db.schema
    .createIndex('uq_adminium_app_tables_connection_app_ref')
    .on(metaTable('app_tables'))
    .columns(['connection_id', 'app_key', 'ref'])
    .unique()
    .execute();

  await db.schema
    .createIndex('ix_adminium_app_tables_connection_table')
    .on(metaTable('app_tables'))
    .columns(['connection_id', 'table_name'])
    .execute();

  // One ALTER per column: SQLite takes exactly one ADD COLUMN per statement.
  await db.schema.alterTable(metaTable('roles')).addColumn('app_key', c.str(80)).execute();
  await db.schema
    .alterTable(metaTable('roles'))
    .addColumn('screens_only', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .execute();

  await db.schema.alterTable(metaTable('public_endpoints')).addColumn('managed_by', c.str(80)).execute();
  await db.schema.alterTable(metaTable('public_keys')).addColumn('managed_by', c.str(80)).execute();
}
