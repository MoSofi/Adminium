// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which table of the database a real table string means.
 *
 * An app's table record keeps the table's bare name and, for a self-made
 * app's table in a schema of its own, that schema apart. The server speaks of
 * it as ONE string, `realTableOf(record)`: the bare name in the database's
 * default schema, else `<schema>.<name>`. The engine's model gives every table
 * an id `<schema>.<name>`, the default schema's included (`public.x`, SQLite
 * `main.x`, MySQL `<db>.x`).
 *
 * The rule is the same everywhere: a qualified string is the table of that
 * schema and that name, exactly; a bare name is the table of that name in the
 * DEFAULT schema, never one of the same name in another schema. A lookup
 * that took "any table so named" would hand `sales.orders`'s rules, grants or
 * drop to `public.orders`, or the other way round.
 *
 * Here and not under `apps/`, so the add-on installer may use it too.
 */
import { splitTableName } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

/** The part of a model (or of a table index) a real table string is read against. */
export interface TableIdModel<T extends TableIdEntry = TableIdEntry> {
  readonly tables: readonly T[];
  readonly defaultSchema: string;
}

/** What a table needs for that: its id, its schema and its bare name. */
export interface TableIdEntry {
  readonly id: string;
  readonly schema: string;
  readonly name: string;
}

/** The model's table a real table string means, or undefined when there is none. */
export function tableOfReal<T extends TableIdEntry>(model: TableIdModel<T>, real: string): T | undefined {
  const { schema, name } = splitTableName(real);
  const wanted = schema ?? model.defaultSchema;
  return model.tables.find((table) => table.schema === wanted && table.name === name);
}

/** The model's id of a real table, or null when the model has no such table. */
export function tableIdOrNull(model: TableIdModel, real: string): string | null {
  return tableOfReal(model, real)?.id ?? null;
}

/**
 * The model's id of a real table; the string itself when the model has none
 * (a self-made app's `sales.x` is its own id already, and a table not made
 * yet is named as the plan names it).
 */
export function tableIdIn(model: TableIdModel, real: string): string {
  return tableIdOrNull(model, real) ?? real;
}

/**
 * A model table as a record names it: the bare name in the default schema,
 * else `<schema>.<name>`. The other way from {@link tableOfReal}: comparing
 * this with `realTableOf(record)` says whether the record is of this table.
 */
export function realOfTable(model: Pick<TableIdModel, 'defaultSchema'>, table: Pick<TableIdEntry, 'schema' | 'name'>): string {
  return table.schema === model.defaultSchema ? table.name : `${table.schema}.${table.name}`;
}

/**
 * A model id as a record names its table: the default schema's prefix taken
 * off, any other kept. `public.orders` is `orders`; `sales.orders` stays.
 */
export function realOfTableId(model: Pick<TableIdModel, 'defaultSchema'>, id: string): string {
  const prefix = `${model.defaultSchema}.`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** A model whose tables may have been read without their schema, and which may not say its default schema. */
export interface LooseTableIdModel {
  readonly tables: readonly { readonly id: string; readonly name: string; readonly schema?: string | undefined }[];
  readonly defaultSchema?: string | undefined;
}

/**
 * A model as {@link tableOfReal} reads it. A table without its schema has it
 * in its id (`<schema>.<name>`); a model that does not say its default schema
 * is read as Postgres's (`public`), which is what one built by hand means.
 */
export function tableIdModelOf(model: LooseTableIdModel | null | undefined): TableIdModel {
  return {
    tables: (model?.tables ?? []).map((table) => ({
      id: table.id,
      name: table.name,
      schema: table.schema ?? (table.id.endsWith(`.${table.name}`) ? table.id.slice(0, table.id.length - table.name.length - 1) : ''),
    })),
    defaultSchema: model?.defaultSchema ?? 'public',
  };
}

/**
 * Whether an app's record is of this model table, where only the table is at
 * hand (a `ResolvedTable`). A record with no schema is the default schema's;
 * `defaultSchema` null reads any schema as that one (MySQL, whose connection
 * reads the one database it names).
 */
export function recordIsTable(record: { tableName: string; schemaName: string | null }, table: { schema: string; name: string }, defaultSchema: string | null): boolean {
  if (record.tableName !== table.name) return false;
  if (record.schemaName !== null) return record.schemaName === table.schema;
  return defaultSchema === null || table.schema === defaultSchema;
}

/**
 * The schema a table recorded with none is in, from the connection's engine
 * (what each introspector names it: Postgres `public`, SQLite `main`). Null on
 * MySQL, and for a connection not found: there the one database it reads is
 * the only schema, whatever it is called.
 */
export async function defaultSchemaOf(meta: MetaDb, connectionId: string): Promise<string | null> {
  const row = await meta.db.selectFrom('adminium_connections').select('engine').where('id', '=', connectionId).executeTakeFirst();
  return row?.engine === 'postgres' ? 'public' : row?.engine === 'sqlite' ? 'main' : null;
}
