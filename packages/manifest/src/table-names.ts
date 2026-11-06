// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A TABLE'S REAL NAME, AND THE SCHEMA IT LIVES IN.
 *
 * A table's `ref` is the app's own short name for it, lower snake_case. Its
 * real name is the ref, or `<prefix><ref>` for a prefixed app. A self-made app
 * (`publisher: local`) is saved from tables a person made by hand, so it may
 * give a table its real `name` beside the ref (`Order Lines`), and on Postgres
 * the `schema` it is in (`sales`).
 *
 * Everywhere the server speaks of a real table it uses one string: the bare
 * name, or `<schema>.<name>` when the manifest names a schema — the id the
 * engine's snapshot gives the table, so a page bound to it finds it. Neither
 * part may hold a dot, which is what keeps that string read one way only.
 */

/** The longest table or schema name, in bytes: Postgres cuts anything longer short. */
export const TABLE_NAME_MAX_BYTES = 63;

/** Adminium's own namespace: no table or schema of an app is named into it. */
const RESERVED_PREFIX = 'adminium_';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** What is wrong with a name shared by tables and schemas, or null. */
function identifierIssue(what: 'table' | 'schema', name: string): string | null {
  if (name.length === 0 || byteLength(name) > TABLE_NAME_MAX_BYTES) return `a ${what} name is 1 to ${String(TABLE_NAME_MAX_BYTES)} bytes`;
  if (name.includes('\u0000')) return `a ${what} name holds no NUL character`;
  if (name.trim() !== name) return `a ${what} name neither starts nor ends with a space`;
  // A dot would read as `<schema>.<name>`, and " as " as an alias, wherever a table is named by one string.
  if (name.includes('.')) return `a ${what} name holds no dot`;
  if (/ as /i.test(name)) return `a ${what} name holds no " as " between words`;
  if (name.toLowerCase().startsWith(RESERVED_PREFIX)) return `"${name}" is in Adminium's own namespace ("${RESERVED_PREFIX}")`;
  return null;
}

/** What is wrong with a table's real name, or null. */
export function tableNameIssue(name: string): string | null {
  return identifierIssue('table', name);
}

/**
 * What is wrong with a table's schema, or null: the database's own schemas
 * (`pg_catalog`, `information_schema`, `pg_toast`, any temporary one —
 * Postgres keeps every `pg_` name for itself) and Adminium's are never an
 * app's. Which engine may have a schema at all is the planner's to say.
 */
export function tableSchemaIssue(schema: string): string | null {
  const issue = identifierIssue('schema', schema);
  if (issue !== null) return issue;
  const lower = schema.toLowerCase();
  if (lower === 'information_schema' || lower.startsWith('pg_')) return `"${schema}" is the database's own schema`;
  return null;
}

/** `<schema>.<name>`, or the bare name without a schema. */
export function qualifyTableName(schema: string | null | undefined, name: string): string {
  return schema === null || schema === undefined ? name : `${schema}.${name}`;
}

/** A real table string read back into its schema (null without one) and its name. */
export function splitTableName(real: string): { schema: string | null; name: string } {
  const dot = real.indexOf('.');
  return dot < 0 ? { schema: null, name: real } : { schema: real.slice(0, dot), name: real.slice(dot + 1) };
}

/**
 * The real table a declared table is made under: its own name (in its
 * schema), else the prefixed or plain ref. A table that gives either is never
 * prefixed: the manifest refuses the two together.
 */
export function realTableName(table: { ref: string; name?: string | undefined; schema?: string | undefined }, prefix: string | null): string {
  if (table.name !== undefined || table.schema !== undefined) return qualifyTableName(table.schema, table.name ?? table.ref);
  return prefix === null ? table.ref : `${prefix}${table.ref}`;
}

/** Whether a declared table gives its own real name or schema. */
export function namesItsTable(table: { name?: string | undefined; schema?: string | undefined }): boolean {
  return table.name !== undefined || table.schema !== undefined;
}
