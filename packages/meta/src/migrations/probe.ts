// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A MIGRATION STEP ALREADY DID, ASKED OF THE DATABASE.
 *
 * MySQL has no transactional DDL: a migration that stops part way keeps every
 * statement before the stop, and running it again repeats them. A step that
 * asks first ("is the column there?") makes the rerun finish the migration
 * instead of failing on its first statement. Postgres and SQLite run each
 * migration in one transaction, so there the answers are always "not yet",
 * and asking costs one small read.
 *
 * Names are compared as the engine keeps them: lower case, as every meta
 * table, column and index is written.
 */
import { sql, type Kysely } from 'kysely';

import type { MetaDialect } from '../columns.js';

export async function columnExists(db: Kysely<unknown>, dialect: MetaDialect, table: string, column: string): Promise<boolean> {
  if (dialect === 'sqlite') {
    const rows = await sql<{ name: string }>`select name from pragma_table_info(${table})`.execute(db);
    return rows.rows.some((row) => row.name === column);
  }
  const schema = dialect === 'mysql' ? sql`database()` : sql`current_schema()`;
  const rows = await sql<{ n: number }>`
    select 1 as n from information_schema.columns
    where table_schema = ${schema} and table_name = ${table} and column_name = ${column}
  `.execute(db);
  return rows.rows.length > 0;
}

export async function tableExists(db: Kysely<unknown>, dialect: MetaDialect, table: string): Promise<boolean> {
  if (dialect === 'sqlite') {
    const rows = await sql<{ n: number }>`select 1 as n from sqlite_master where type = 'table' and name = ${table}`.execute(db);
    return rows.rows.length > 0;
  }
  const schema = dialect === 'mysql' ? sql`database()` : sql`current_schema()`;
  const rows = await sql<{ n: number }>`
    select 1 as n from information_schema.tables where table_schema = ${schema} and table_name = ${table}
  `.execute(db);
  return rows.rows.length > 0;
}

/** An index by its name. On Postgres a unique or primary-key constraint is an index of the same name too. */
export async function indexExists(db: Kysely<unknown>, dialect: MetaDialect, table: string, index: string): Promise<boolean> {
  if (dialect === 'sqlite') {
    const rows = await sql<{ n: number }>`select 1 as n from sqlite_master where type = 'index' and tbl_name = ${table} and name = ${index}`.execute(db);
    return rows.rows.length > 0;
  }
  if (dialect === 'postgres') {
    const rows = await sql<{ n: number }>`
      select 1 as n from pg_indexes where schemaname = current_schema() and tablename = ${table} and indexname = ${index}
    `.execute(db);
    return rows.rows.length > 0;
  }
  const rows = await sql<{ n: number }>`
    select 1 as n from information_schema.statistics
    where table_schema = database() and table_name = ${table} and index_name = ${index}
  `.execute(db);
  return rows.rows.length > 0;
}

/** A named constraint (a foreign key, a unique key, a primary key) on Postgres or MySQL. SQLite names none it can be asked for. */
export async function constraintExists(db: Kysely<unknown>, dialect: MetaDialect, table: string, constraint: string): Promise<boolean> {
  if (dialect === 'sqlite') return false;
  const schema = dialect === 'mysql' ? sql`database()` : sql`current_schema()`;
  const rows = await sql<{ n: number }>`
    select 1 as n from information_schema.table_constraints
    where constraint_schema = ${schema} and table_name = ${table} and constraint_name = ${constraint}
  `.execute(db);
  return rows.rows.length > 0;
}

/** The columns of a table's primary key, in order (Postgres and MySQL). */
export async function primaryKeyColumns(db: Kysely<unknown>, dialect: MetaDialect, table: string): Promise<string[]> {
  if (dialect === 'sqlite') {
    const rows = await sql<{ name: string; pk: number }>`select name, pk from pragma_table_info(${table})`.execute(db);
    return rows.rows.filter((row) => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((row) => row.name);
  }
  const schema = dialect === 'mysql' ? sql`database()` : sql`current_schema()`;
  // One-word aliases: the meta store's camel-case plugin renames result keys.
  const rows = await sql<{ col: string }>`
    select k.column_name as col
    from information_schema.table_constraints t
    join information_schema.key_column_usage k
      on k.constraint_name = t.constraint_name and k.table_schema = t.table_schema and k.table_name = t.table_name
    where t.table_schema = ${schema} and t.table_name = ${table} and t.constraint_type = 'PRIMARY KEY'
    order by k.ordinal_position
  `.execute(db);
  return rows.rows.map((row) => row.col);
}
