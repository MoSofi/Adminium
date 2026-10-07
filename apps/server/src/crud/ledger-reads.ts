// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A POSTING READS — before an add-on's code is asked anything.
 *
 * The code that plans a posting's rows never touches the database. Adminium
 * reads for it, exactly what its action declares and nothing else: the lines
 * of the row whose point fired, the inputs the host's rule maps for each
 * line, the add-on's one settings row, and the action's own reads in order —
 * each a plain select of the add-on's own table by up to three keys. The
 * rows of the reads a lock names give the names a save takes before it
 * writes.
 *
 * Every function here only reads, on whatever handle it is given: the pool
 * before a transaction, the transaction inside one. Values are handed the
 * same on every engine: a decimal as text, a json column as text, a date as
 * text, a yes/no as a boolean.
 */
import type { LedgerAction as ManifestAction, LedgerRead } from '@adminium/manifest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedLedger } from '../ledgers/registry.js';
import type { ResolvedColumn, ResolvedTable } from './identifiers.js';
import type { DeclaredPosting } from './ledger-points.js';
import type { Row } from './mask.js';
import { booleanOf } from './write-values.js';

type Db = Kysely<SourceDatabase>;
export type Scalar = string | number | boolean;
export type ScalarRow = Record<string, Scalar | null>;
export type LineInputs = Record<string, Scalar | { table: string; row: string } | null>;

/** The most lines one source row hands over. */
export const LEDGER_LINES_MAX = 500;
/** The most rows one read returns, and all the reads of one call together. */
export const LEDGER_READ_ROWS = 1000;
export const LEDGER_READ_ROWS_ALL = 3000;

/** More than a posting may read or hand over: the save is refused `too-large`, whichever limit it was. */
export class LedgerTooLarge extends Error {
  override readonly name = 'LedgerTooLarge';
  constructor(readonly what: string) {
    super(`a posting reads at most so many rows, and "${what}" has more`);
  }
}

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';

/** JSON with every object's keys sorted: Postgres and MySQL keep a json object's keys in their own order, SQLite as written. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

/** A stored value as an add-on is handed one: the same on every engine. */
export function scalarOf(column: Pick<ResolvedColumn, 'logicalType'> | undefined, value: unknown): Scalar | null {
  if (value === null || value === undefined) return null;
  const type = column?.logicalType;
  if (type === 'json') {
    // As text, whatever the driver gave: the parsed value printed again with its keys in order, so the three engines agree to the byte.
    if (typeof value !== 'string') return stableJson(value);
    try {
      return stableJson(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (type === 'boolean') return booleanOf(value);
  if (value instanceof Date) return type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
  // A date kept as text with a time after it (SQLite) is its day.
  if (type === 'date' && typeof value === 'string') return value.slice(0, 10);
  // Money is never a float on its way to a planner.
  if (type === 'decimal' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/** A row of a table, every column as an add-on is handed it. `declared`: what the add-on's manifest says a column is, where this engine may not. */
export function rowOut(table: ResolvedTable, row: Row, declared?: ReadonlyMap<string, 'json' | 'decimal' | 'boolean' | 'date'>): ScalarRow {
  const out: ScalarRow = {};
  for (const [name, value] of Object.entries(row)) {
    const hint = declared?.get(name);
    out[name] = scalarOf(hint === undefined ? table.columns.get(name) : { logicalType: hint }, value);
  }
  return out;
}

/** The lines under a source row: the child's rows whose `via` names it, oldest key first. Plain — never a locking read. */
export async function linesOf(db: Db, child: ResolvedTable, via: string, parentKey: unknown): Promise<Row[]> {
  let query = db.selectFrom(child.id as never).selectAll().where(sql.ref(via), '=', parentKey as never);
  for (const column of child.primaryKey) query = query.orderBy(sql.ref(column));
  const rows = (await query.limit(LEDGER_LINES_MAX + 1).execute()) as Row[];
  if (rows.length > LEDGER_LINES_MAX) throw new LedgerTooLarge('lines');
  return rows;
}

/** The add-on's one settings row, or `{}` when it declares no settings table (or the row is not there). */
export async function ledgerSettings(ledger: Pick<ResolvedLedger, 'settings'> & Partial<Pick<ResolvedLedger, 'typesOf'>>, db: Db): Promise<ScalarRow> {
  const table = ledger.settings;
  if (table === null) return {};
  let query = db.selectFrom(table.id as never).selectAll();
  for (const column of table.primaryKey) query = query.orderBy(sql.ref(column));
  const row = (await query.limit(1).executeTakeFirst()) as Row | undefined;
  return row === undefined ? {} : rowOut(table, row, ledger.typesOf?.(table.id));
}

type InputType = ManifestAction['inputs'][string];
const optional = (type: InputType): boolean => type.endsWith('?');

/** A mapped value as the input's type takes it: a decimal and a text as text, a number as a number. */
function asInput(type: InputType, value: Scalar | null): Scalar | null {
  if (value === null || value === '') return null;
  const base = type.replace('?', '');
  if (base === 'decimal' || base === 'text' || base === 'date' || base === 'tableRef') return String(value);
  if (base === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (base === 'bool') return booleanOf(value);
  return value;
}

export interface MappedLine {
  inputs: LineInputs;
  multipliers: Record<string, number>;
  /** The inputs the action needs that this line leaves empty, each with the column that should hold it (when a column is mapped). */
  missing: { input: string; column: string | null }[];
}

/**
 * The inputs of one line, as the host's rule maps them: a column of the row,
 * the row itself, a column of the `via` parent, a column of the add-on's
 * settings row, or a fixed value. An optional input left empty is handed
 * empty; a needed one left empty is named in `missing`, and the caller
 * refuses the save on that column.
 */
export function mapInputs(input: {
  posting: Pick<DeclaredPosting, 'map' | 'multipliers'>;
  action: Pick<ManifestAction, 'inputs'>;
  /** The line (or the source row itself, for a rule with no `via`), its table, and that table's stored name. */
  table: ResolvedTable;
  tableRef: string;
  row: Row;
  /** The `via` parent and its table, for a `{parent}` mapping. */
  parent?: { table: ResolvedTable; row: Row } | null;
  settings: ScalarRow;
}): MappedLine {
  const { posting, table, row } = input;
  const keyOf = (): string => table.primaryKey.map((column) => String(row[column])).join('/');
  const read = (mapping: DeclaredPosting['map'][string]): { value: Scalar | { table: string; row: string } | null; column: string | null } => {
    if (typeof mapping === 'string') return { value: scalarOf(table.columns.get(mapping), row[mapping]), column: mapping };
    if ('row' in mapping) return { value: { table: input.tableRef, row: keyOf() }, column: null };
    if ('parent' in mapping) return { value: input.parent == null ? null : scalarOf(input.parent.table.columns.get(mapping.parent), input.parent.row[mapping.parent]), column: null };
    if ('setting' in mapping) return { value: input.settings[mapping.setting] ?? null, column: null };
    return { value: mapping.value, column: null };
  };
  const inputs: LineInputs = {};
  const missing: MappedLine['missing'] = [];
  for (const [name, type] of Object.entries(input.action.inputs)) {
    const mapping = posting.map[name];
    const found = mapping === undefined ? { value: null, column: null } : read(mapping);
    let value: LineInputs[string];
    if (type === 'rowRef') {
      value = found.value !== null && typeof found.value === 'object' ? found.value : null;
    } else if (found.value !== null && typeof found.value === 'object') {
      // The row itself, mapped to a plain input: its key.
      value = asInput(type, found.value.row);
    } else {
      value = asInput(type, found.value);
    }
    inputs[name] = value;
    if (value === null && !optional(type)) missing.push({ input: name, column: found.column });
  }
  const multipliers: Record<string, number> = {};
  for (const [name, mapping] of Object.entries(posting.multipliers ?? {})) {
    const found = read(mapping).value;
    const n = found === null || typeof found === 'object' ? Number.NaN : Number(found);
    // A line with no pack size is one of the thing it is.
    multipliers[name] = Number.isFinite(n) ? n : 1;
  }
  return { inputs, multipliers, missing };
}

export interface ReadContext {
  ledger: Pick<ResolvedLedger, 'table'> & Partial<Pick<ResolvedLedger, 'typesOf'>>;
  action: Pick<ManifestAction, 'reads'>;
  /** The lines of this call, each with its mapped inputs and its key. */
  lines: readonly { line: string; inputs: LineInputs }[];
  source: { table: string; row: string };
  /** The ids of this round's receipts, for a read keyed by `receipt.id`. */
  receiptIds?: readonly (string | number)[];
  settings: ScalarRow;
  /** What a price question recorded, for a read keyed by `uses.*`. */
  uses?: readonly { offer: string | null; code: string | null; voucher: string | null }[];
}

/** The values one `from` names, over every line of the call and every row read so far. */
function sourceValues(from: string, context: ReadContext, done: Readonly<Record<string, ScalarRow[]>>): unknown[] {
  const [head, name, part] = from.split('.') as [string, string, string | undefined];
  if (head === 'input') {
    return context.lines.map((line) => {
      const value = line.inputs[name];
      if (value !== null && typeof value === 'object') return part === 'table' ? value.table : part === 'row' ? value.row : null;
      return part === undefined ? (value ?? null) : null;
    });
  }
  if (head === 'source') return name === 'table' ? [context.source.table] : name === 'row' ? [context.source.row] : context.lines.map((line) => line.line);
  if (head === 'receipt') return [...(context.receiptIds ?? [])];
  if (head === 'setting') return [context.settings[name] ?? null];
  if (head === 'uses') return (context.uses ?? []).map((use) => use[name as 'offer' | 'code' | 'voucher']);
  // A column of an earlier read.
  return (done[head] ?? []).map((row) => row[name] ?? null);
}

/**
 * A value a read's condition asks for, as the statement carries it. A yes or
 * a no is written into the statement as `true` / `false`, which every engine
 * reads the same — SQLite as 1 and 0 — where a bound boolean is refused by
 * SQLite's driver outright.
 */
const asked = (value: unknown): unknown => (typeof value === 'boolean' ? sql.lit(value) : value);

/**
 * The action's reads, in the order it declares them, each a plain select of
 * one of the add-on's own tables: `where <key> in (…)` for each key (a key
 * with several sources reads them together), the read's own conditions, by
 * the table's key, one row more than its limit. A key with no value to look
 * for answers no row without asking the database.
 */
export async function runReads(db: Db, context: ReadContext): Promise<Record<string, ScalarRow[]>> {
  const out: Record<string, ScalarRow[]> = {};
  let total = 0;
  for (const read of context.action.reads as readonly LedgerRead[]) {
    const table = context.ledger.table(read.table);
    if (table === null) throw new Error(`the ledger reads "${read.table}", which is not one of its tables here`);
    const limit = read.limit ?? LEDGER_READ_ROWS;
    let query = db.selectFrom(table.id as never).selectAll();
    let nothing = false;
    for (const by of read.by) {
      const values = [...new Set((Array.isArray(by.from) ? by.from : [by.from]).flatMap((from) => sourceValues(from, context, out)).filter((value) => !empty(value)))];
      if (values.length === 0) nothing = true;
      else query = query.where(sql.ref(by.column), 'in', values as never);
    }
    for (const where of read.where ?? []) {
      query = where.eq !== undefined ? query.where(sql.ref(where.column), '=', asked(where.eq) as never) : query.where(sql.ref(where.column), 'in', (where.in ?? []).map(asked) as never);
    }
    for (const column of table.primaryKey) query = query.orderBy(sql.ref(column));
    const rows = nothing ? [] : ((await query.limit(limit + 1).execute()) as Row[]);
    if (rows.length > limit) throw new LedgerTooLarge(read.as);
    total += rows.length;
    if (total > LEDGER_READ_ROWS_ALL) throw new LedgerTooLarge('reads');
    const declared = context.ledger.typesOf?.(table.id);
    out[read.as] = rows.map((row) => rowOut(table, row, declared));
  }
  return out;
}

/**
 * The names a save takes before it writes: one for every row a lock of the
 * action stands for — the add-on's item, its card — so two saves that touch
 * the same one wait for each other, and two that do not never do. Sorted, so
 * every save takes them in the same order.
 */
export function lockNames(connectionId: string, ledger: Pick<ResolvedLedger, 'addOn'>, action: Pick<ManifestAction, 'locks'>, reads: Readonly<Record<string, ScalarRow[]>>): string[] {
  const names = new Set<string>();
  for (const lock of action.locks) {
    for (const row of reads[lock.read] ?? []) {
      const value = row[lock.column];
      if (!empty(value)) names.add(`${connectionId}|led|${ledger.addOn}|${lock.table}|${String(value)}`);
    }
  }
  return [...names].sort();
}
