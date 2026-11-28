// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SETTINGS ROW: the one row of a table an app keeps to one row (its
 * outbox's `settings.table`, an add-on's `settingsTable`, a table a setting
 * is read from), as every reader of it reads it.
 *
 * Such a table holds one row: a create there is refused while it holds one
 * (`oneRow` in `crud/write-service.ts`). A table that holds more anyway (rows
 * made before that refusal, or written outside Adminium) is read here by its
 * FIRST row by primary key, ascending: the row the dashboard's Settings page
 * edits (a list with no sort of its own is ordered by the key, `crud/list.ts`)
 * and the one every rule, email and text reads. Without an order each reader
 * took whichever row the database returned first, and two readers of the same
 * table could disagree.
 *
 * The key is read from the database's own catalog, so a reader that holds only
 * a handle (most do: a rule's fill, a moment, a booking limit) orders the same
 * way as one that holds the model. It is read once per table per database pool
 * — a transaction shares its pool's adapter — and never through a statement
 * that can fail: inside a Postgres transaction a failed statement would undo
 * the write it serves. A table with no primary key, or a database whose
 * dialect is not one of the three, is read in the database's order, as before.
 */
import { MysqlAdapter, PostgresAdapter, SqliteAdapter, sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { Row } from './mask.js';

type Db = Kysely<SourceDatabase>;

/** Each pool's settings keys, by table id: the adapter is made once per pool and shared by its transactions. */
const keys = new WeakMap<object, Map<string, Promise<readonly string[]>>>();

/** A table id (`public.settings`, `main.settings`, `shop.settings`) as its schema and its name. */
function partsOf(table: string): { schema: string | null; name: string } {
  const cut = table.indexOf('.');
  return cut <= 0 ? { schema: null, name: table } : { schema: table.slice(0, cut), name: table.slice(cut + 1) };
}

async function readKey(db: Db, adapter: object, table: string): Promise<readonly string[]> {
  const { schema, name } = partsOf(table);
  let rows: { name: unknown }[] = [];
  if (adapter instanceof PostgresAdapter) {
    // `to_regclass` answers null for a table that is not there: the statement never fails.
    const relation = schema === null ? sql`to_regclass(quote_ident(${name}))` : sql`to_regclass(quote_ident(${schema}) || '.' || quote_ident(${name}))`;
    rows = (
      await sql<{ name: unknown }>`select a.attname as name from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indisprimary and i.indrelid = ${relation} order by array_position(i.indkey::int2[], a.attnum)`.execute(db)
    ).rows;
  } else if (adapter instanceof MysqlAdapter) {
    const where = schema === null ? sql`table_schema = database()` : sql`table_schema = ${schema}`;
    rows = (
      await sql<{ name: unknown }>`select column_name as name from information_schema.key_column_usage where constraint_name = 'PRIMARY' and ${where} and table_name = ${name} order by ordinal_position`.execute(db)
    ).rows;
  } else if (adapter instanceof SqliteAdapter) {
    rows = (await sql<{ name: unknown }>`select name from pragma_table_info(${name}, ${schema ?? 'main'}) where pk > 0 order by pk`.execute(db)).rows;
  }
  return rows.map((row) => String(row.name));
}

/**
 * The primary key a settings table's rows are ordered by, in key order; empty
 * when it has none or cannot be told. Kept once found; a table that showed
 * none is asked again next time (it may have been made since).
 */
export async function settingsKey(db: Db, table: string): Promise<readonly string[]> {
  const adapter = db.getExecutor().adapter as object;
  let tables = keys.get(adapter);
  if (tables === undefined) keys.set(adapter, (tables = new Map()));
  const kept = tables.get(table);
  if (kept !== undefined) return kept;
  const found = readKey(db, adapter, table).catch(() => [] as readonly string[]);
  tables.set(table, found);
  const key = await found;
  if (key.length === 0) tables.delete(table);
  return key;
}

/**
 * The settings row: the table's first row by primary key, with every column
 * or only `columns`; undefined when the table holds none.
 */
export async function settingsRow(db: Db, table: string, columns?: readonly string[]): Promise<Row | undefined> {
  const key = await settingsKey(db, table);
  const from = db.selectFrom(table);
  let query = columns === undefined ? from.selectAll() : from.select(columns.map((column) => db.dynamic.ref(column)));
  for (const column of key) query = query.orderBy(db.dynamic.ref(column), 'asc');
  return (await query.limit(1).executeTakeFirst()) as Row | undefined;
}

/** One column of the settings row; undefined when the table holds no row (or the column holds nothing). */
export async function settingsColumn(db: Db, table: string, column: string): Promise<unknown> {
  const key = await settingsKey(db, table);
  let query = db.selectFrom(table).select(sql<unknown>`${sql.ref(column)}`.as('value'));
  for (const part of key) query = query.orderBy(db.dynamic.ref(part), 'asc');
  const row = (await query.limit(1).executeTakeFirst()) as { value?: unknown } | undefined;
  return row?.value ?? undefined;
}
