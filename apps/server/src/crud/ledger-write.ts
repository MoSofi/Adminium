// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ADD-ON'S PLAN MAY WRITE — judged before the first row goes in.
 *
 * An add-on's code never writes. It answers a plan: rows to insert into the
 * ledger's own tables, rows of them to change, amounts it was asked to
 * decide. Adminium writes the plan itself — after four checks, each of which
 * fails the whole save with nothing written:
 *
 *  1. TABLE — every row is for a table the ledger declares it writes (and
 *     the action, when it narrows that list), with only the columns listed
 *     for an insert or an update, an update named by the declared key.
 *  2. ROW — every link a row carries, and every row an update names, is one
 *     this call was shown: a row one of its reads returned, a row this same
 *     plan inserts earlier, a link the host's row handed in, a link of a
 *     returned row to that same table, or a row its own round wrote. A plan
 *     cannot reach a row it was never given.
 *  3. OPERATION — no column Adminium decides (a total, a balance, a formula),
 *     never the receipt's own link, never a delete.
 *  4. DECIDES — an amount is given only for an input the action declares as
 *     decided and the host's rule maps, for a line of this call, between
 *     zero and the ceiling Adminium reads itself.
 *
 * Which check failed is written to the audit log and never told to the
 * person saving: to them the add-on's plan failed.
 */
import type { LedgerAction } from '@adminium/manifest';

import type { LineInputs, ScalarRow } from './ledger-reads.js';
import { sameValue } from './write-values.js';

type Scalar = string | number | boolean;

/** One row of a plan, as the contract shapes it. */
export type PlannedRow =
  | { op: 'insert'; table: string; label?: string | undefined; line: string; values: Record<string, Scalar | { '@row': string } | null> }
  | { op: 'update'; table: string; line: string; key: Record<string, Scalar>; set: Record<string, Scalar | null> };

export interface PlannedOutput {
  rows: PlannedRow[];
  decides?: { line: string; input: string; value: string }[] | undefined;
}

/** What the checks read of one of the ledger's tables, by the add-on's own name for it. */
export interface LedgerTableFacts {
  /** Its key columns. */
  key: readonly string[];
  /** Each column that links to another of the add-on's tables, and which. */
  links: Readonly<Record<string, string>>;
  /** The columns Adminium decides on it: a plan gives none of them. */
  decided: ReadonlySet<string>;
}

export interface WriteScopeByRef {
  insert?: readonly string[] | undefined;
  update?: { by: readonly string[]; set: readonly string[] } | undefined;
}

export interface CheckInput {
  /** The ledger's `writes`, by the add-on's own table names. */
  writes: Readonly<Record<string, WriteScopeByRef>>;
  action: Pick<LedgerAction, 'inputs' | 'reads' | 'decides' | 'writes'>;
  tables: Readonly<Record<string, LedgerTableFacts>>;
  /** What the action's reads returned in this call, by read name. */
  reads: Readonly<Record<string, readonly ScalarRow[]>>;
  /** The lines of this call, with the inputs the host's rule mapped. */
  lines: readonly { line: string; inputs: LineInputs }[];
  /** What this round has written, by table. */
  written: Readonly<Record<string, readonly ScalarRow[]>>;
  /** The inputs the host's rule maps: a decision is taken only for one of them. */
  mapped: ReadonlySet<string>;
}

/** The four words the audit log knows a failed plan by. */
export type ScopeCause = 'scope-table' | 'scope-row' | 'scope-op' | 'scope-decides';
export type CheckResult = { ok: true } | { ok: false; cause: ScopeCause; detail: string };

/** The link a plan's rows carry back to their receipt: Adminium's own to write. */
export const RECEIPT_LINK = 'receipt_id';

const fail = (cause: ScopeCause, detail: string): CheckResult => ({ ok: false, cause, detail });
const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== '';

/** Decimal text compared as a number, with no float in between. */
export function compareDecimalText(a: string, b: string): -1 | 0 | 1 {
  const parts = (text: string): { negative: boolean; whole: string; fraction: string } => {
    const negative = text.startsWith('-');
    const [whole = '0', fraction = ''] = (negative ? text.slice(1) : text).split('.');
    return { negative, whole: whole.replace(/^0+(?=\d)/, ''), fraction };
  };
  const x = parts(a);
  const y = parts(b);
  const width = Math.max(x.fraction.length, y.fraction.length);
  const scaled = (p: { negative: boolean; whole: string; fraction: string }): bigint => BigInt(`${p.whole}${p.fraction.padEnd(width, '0')}` || '0') * (p.negative ? -1n : 1n);
  const left = scaled(x);
  const right = scaled(y);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Every row of a table this call was shown: by a read, or as what its round wrote. */
function shownRows(input: CheckInput, table: string): ScalarRow[] {
  const out: ScalarRow[] = [];
  for (const read of input.action.reads) if (read.table === table) out.push(...(input.reads[read.as] ?? []));
  out.push(...(input.written[table] ?? []));
  return out;
}

/** Every key of a table a plan's row may point at. */
function knownKeys(input: CheckInput, table: string): unknown[] {
  const facts = input.tables[table];
  const keyColumn = facts?.key.length === 1 ? facts.key[0]! : null;
  const keys: unknown[] = [];
  if (keyColumn !== null) for (const row of shownRows(input, table)) keys.push(row[keyColumn]);
  // A link the host's row handed in.
  for (const line of input.lines) {
    for (const [name, type] of Object.entries(input.action.inputs)) {
      const value = line.inputs[name];
      if ((type === 'link' || type === 'link?') && filled(value) && typeof value !== 'object') keys.push(value);
    }
  }
  // A link of a row it was shown, to this same table.
  for (const [other, otherFacts] of Object.entries(input.tables)) {
    for (const [column, target] of Object.entries(otherFacts.links)) {
      if (target !== table) continue;
      for (const row of shownRows(input, other)) if (filled(row[column])) keys.push(row[column]);
    }
  }
  return keys;
}

/** The four checks, in order, over one call's plan. */
export function checkOutput(input: CheckInput, output: PlannedOutput): CheckResult {
  const allowed = input.action.writes === undefined ? null : new Set(input.action.writes);
  const labels = new Map<string, string>();
  const known = new Map<string, unknown[]>();
  const keysOf = (table: string): unknown[] => {
    const hit = known.get(table);
    if (hit !== undefined) return hit;
    const found = knownKeys(input, table);
    known.set(table, found);
    return found;
  };

  for (const [i, row] of output.rows.entries()) {
    const at = `rows.${String(i)}`;
    // 1. The table, the operation it takes, the columns it lists.
    const scope = input.writes[row.table];
    if (scope === undefined || (allowed !== null && !allowed.has(row.table))) return fail('scope-table', `${at}: "${row.table}" is not a table this action writes`);
    const facts = input.tables[row.table];
    if (facts === undefined) return fail('scope-table', `${at}: "${row.table}" is not a table of the add-on here`);
    const given = row.op === 'insert' ? Object.keys(row.values) : Object.keys(row.set);
    if (row.op === 'insert') {
      if (scope.insert === undefined) return fail('scope-table', `${at}: "${row.table}" takes no insert`);
      for (const column of given) if (!scope.insert.includes(column)) return fail('scope-table', `${at}: "${row.table}.${column}" is not a column an insert may give`);
    } else {
      if (scope.update === undefined) return fail('scope-table', `${at}: "${row.table}" takes no update`);
      if (Object.keys(row.key).sort().join(',') !== [...scope.update.by].sort().join(',')) return fail('scope-table', `${at}: a row of "${row.table}" is named by ${scope.update.by.join(', ')}`);
      for (const column of given) if (!scope.update.set.includes(column)) return fail('scope-table', `${at}: "${row.table}.${column}" is not a column an update may set`);
    }

    // 3. Nothing Adminium decides, and never the receipt's own link.
    for (const column of given) {
      if (column === RECEIPT_LINK) return fail('scope-op', `${at}: "${RECEIPT_LINK}" is written by Adminium`);
      if (facts.decided.has(column)) return fail('scope-op', `${at}: "${row.table}.${column}" is a column Adminium decides`);
    }

    // 2. Every row it points at, or names, is one this call was shown.
    const values: Record<string, unknown> = row.op === 'insert' ? row.values : row.set;
    for (const [column, target] of Object.entries(facts.links)) {
      const value = values[column];
      if (!filled(value)) continue;
      if (typeof value === 'object' && value !== null) {
        const label = (value as { '@row': string })['@row'];
        // A row this same plan inserts EARLIER, into the table the link names.
        if (labels.get(label) !== target) return fail('scope-row', `${at}: "${column}" names "${label}", which no earlier row of "${target}" carries`);
        continue;
      }
      if (!keysOf(target).some((key) => sameValue(key, value))) return fail('scope-row', `${at}: "${row.table}.${column}" names a row of "${target}" this call was not shown`);
    }
    // A `{'@row'}` anywhere but in a link names nothing.
    for (const [column, value] of Object.entries(values)) {
      if (typeof value === 'object' && value !== null && facts.links[column] === undefined) return fail('scope-row', `${at}: "${row.table}.${column}" is no link, so it takes no "@row"`);
    }
    if (row.op === 'update') {
      const named = shownRows(input, row.table).some((shown) => Object.entries(row.key).every(([column, value]) => sameValue(shown[column], value)));
      if (!named) return fail('scope-row', `${at}: the row of "${row.table}" it changes is not one this call was shown`);
    } else if (row.label !== undefined) {
      if (labels.has(row.label)) return fail('scope-row', `${at}: the label "${row.label}" is given twice`);
      labels.set(row.label, row.table);
    }
  }

  // 4. What it was asked to decide, within the bounds Adminium reads itself.
  const lines = new Map(input.lines.map((line) => [line.line, line]));
  for (const [i, decided] of (output.decides ?? []).entries()) {
    const at = `decides.${String(i)}`;
    const bounds = (input.action.decides ?? []).filter((entry) => entry.input === decided.input);
    if (bounds.length === 0) return fail('scope-decides', `${at}: "${decided.input}" is not an input this action decides`);
    if (!input.mapped.has(decided.input)) return fail('scope-decides', `${at}: the rule maps no column to "${decided.input}"`);
    const line = lines.get(decided.line);
    if (line === undefined) return fail('scope-decides', `${at}: "${decided.line}" is not a line of this call`);
    if (!/^-?\d+(\.\d+)?$/.test(decided.value)) return fail('scope-decides', `${at}: the value is not a decimal`);
    if (compareDecimalText(decided.value, '0') < 0) return fail('scope-decides', `${at}: below zero`);
    // Every entry for the input must hold.
    for (const bound of bounds) {
      const ceilings: unknown[] = 'input' in bound.max ? [line.inputs[bound.max.input]] : (input.reads[bound.max.read] ?? []).map((row) => row[(bound.max as { column: string }).column]);
      if (ceilings.length === 0) return fail('scope-decides', `${at}: there is no ceiling to read for "${decided.input}"`);
      for (const ceiling of ceilings) {
        if (!filled(ceiling) || typeof ceiling === 'object' || !/^-?\d+(\.\d+)?$/.test(String(ceiling))) return fail('scope-decides', `${at}: the ceiling of "${decided.input}" is not a number`);
        if (compareDecimalText(decided.value, String(ceiling)) > 0) return fail('scope-decides', `${at}: above its ceiling`);
      }
    }
  }
  return { ok: true };
}
