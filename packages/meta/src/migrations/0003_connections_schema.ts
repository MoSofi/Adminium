// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0003 — connections & schema: adminium_files, adminium_connections,
 * adminium_schema_snapshots, adminium_schema_overrides
 * (07-meta-store.md §3.13–§3.15, §3.27).
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema
    .createTable(metaTable('files'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('storage', c.str(10), (col) => col.notNull().defaultTo('local'))
    .addColumn('storage_key', c.str(300), (col) => col.notNull())
    .addColumn('filename', c.str(260), (col) => col.notNull())
    .addColumn('mime', c.str(120), (col) => col.notNull())
    .addColumn('size_bytes', c.bigint, (col) => col.notNull())
    .addColumn('sha256', c.str(64), (col) => col.notNull())
    .addColumn('kind', c.str(12), (col) => col.notNull())
    .addColumn('entity', c.json)
    .addColumn('uploaded_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('deleted_at', c.ts)
    .addForeignKeyConstraint('fk_adminium_files_uploaded_by', ['uploaded_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_files_sha256')
    .on(metaTable('files'))
    .columns(['sha256'])
    .execute();

  await db.schema
    .createTable(metaTable('connections'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(80), (col) => col.notNull())
    .addColumn('engine', c.str(12), (col) => col.notNull())
    .addColumn('source_kind', c.str(12), (col) => col.notNull())
    .addColumn('introspect_dsn_encrypted', c.text)
    .addColumn('data_dsn_encrypted', c.text)
    .addColumn('schema_file_id', c.id)
    .addColumn('read_only', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('ssl', c.json)
    .addColumn('settings', c.json, (col) => col.notNull())
    .addColumn('status', c.str(14), (col) => col.notNull().defaultTo('unconfigured'))
    .addColumn('last_tested_at', c.ts)
    .addColumn('last_latency_ms', c.int)
    .addColumn('last_error', c.text)
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint('fk_adminium_connections_schema_file_id', ['schema_file_id'], metaTable('files'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .addForeignKeyConstraint('fk_adminium_connections_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();

  await db.schema
    .createTable(metaTable('schema_snapshots'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('source', c.str(14), (col) => col.notNull())
    .addColumn('import_format', c.str(12))
    .addColumn('engine_version', c.str(40))
    .addColumn('schema', c.json, (col) => col.notNull())
    .addColumn('stats', c.json)
    .addColumn('checksum', c.str(64), (col) => col.notNull())
    .addColumn('is_active', c.bool, (col) => col.notNull().defaultTo(c.boolDefault(false)))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_schema_snapshots_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_schema_snapshots_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_schema_snapshots_conn_created')
    .on(metaTable('schema_snapshots'))
    .columns(['connection_id', 'created_at'])
    .execute();

  await db.schema
    .createTable(metaTable('schema_overrides'))
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('connection_id', c.id, (col) => col.notNull())
    .addColumn('op', c.str(30), (col) => col.notNull())
    .addColumn('table_name', c.str(200), (col) => col.notNull())
    .addColumn('column_name', c.str(200))
    .addColumn('value', c.json, (col) => col.notNull())
    .addColumn('origin', c.str(6), (col) => col.notNull())
    // Soft ref → adminium_llm_runs (wave 0006; SQLite cannot ALTER TABLE ADD FK, so no FK).
    .addColumn('llm_run_id', c.id)
    .addColumn('status', c.str(10), (col) => col.notNull().defaultTo('active'))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addForeignKeyConstraint(
      'fk_adminium_schema_overrides_connection_id',
      ['connection_id'],
      metaTable('connections'),
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .addForeignKeyConstraint('fk_adminium_schema_overrides_created_by', ['created_by'], metaTable('users'), ['id'], (cb) =>
      cb.onDelete('set null'),
    )
    .execute();
  await db.schema
    .createIndex('idx_adminium_schema_overrides_conn_table')
    .on(metaTable('schema_overrides'))
    .columns(['connection_id', 'table_name'])
    .execute();
}
