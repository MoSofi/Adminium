/**
 * Wave 0004 — pages & views: adminium_pages, adminium_views
 * (07-meta-store.md §3.16–§3.18).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('pages'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id)
    .addColumn('slug', c.str(120), (col) => col.notNull())
    .addColumn('type', c.str(30), (col) => col.notNull())
    .addColumn('title', c.str(120), (col) => col.notNull())
    .addColumn('icon', c.str(40))
    .addColumn('nav_group', c.str(12))
    .addColumn('nav_order', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('config', c.json, (col) => col.notNull())
    .addColumn('origin', c.str(10), (col) => col.notNull())
    // Soft ref → adminium_manifests (wave 0006; SQLite cannot ALTER TABLE ADD FK, so no FK).
    .addColumn('manifest_id', c.id)
    .addColumn('generated_from_snapshot_id', c.id)
    .addColumn('revision', c.int, (col) => col.notNull().defaultTo(1))
    .addColumn('is_enabled', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(true)))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_pages_connection_id', ['connection_id'], metaTable('connections'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint(
      'fk_adminium_pages_generated_from_snapshot_id',
      ['generated_from_snapshot_id'],
      metaTable('schema_snapshots'),
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .addForeignKeyConstraint('fk_adminium_pages_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_pages_conn_slug')
    .on(metaTable('pages'))
    .columns(['connection_id', 'slug'])
    .unique()
    .execute();

  await db.schema
    .createTable(metaTable('views'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('page_id', c.id, (col) => col.notNull())
    .addColumn('user_id', c.id)
    .addColumn('name', c.str(80), (col) => col.notNull())
    .addColumn('config', c.json, (col) => col.notNull())
    .addColumn('is_default', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_views_page_id', ['page_id'], metaTable('pages'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_views_user_id', ['user_id'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('uq_adminium_views_page_user_name')
    .on(metaTable('views'))
    .columns(['page_id', 'user_id', 'name'])
    .unique()
    .execute();
}
