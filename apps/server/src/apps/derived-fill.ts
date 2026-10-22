// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COLUMNS AN UPDATE ADDS THAT ADMINIUM WORKS OUT, FILLED FOR THE ROWS
 * ALREADY THERE.
 *
 * An update adds a missing column nullable, or with the manifest's literal
 * default (`missing-columns.ts`), and copies nothing in. For a plain column
 * that is right: nobody has said yet what an older row holds. For a column
 * Adminium decides — a `copy` of the linked row's value, a `formula` over the
 * row, a `rollup` over its child rows, a rollup's `balance` — it is not: every
 * row written from now on gets its value, and every row already there would
 * keep reading empty (a quote's copied deal state, a line's amount, a deal's
 * total), with no write to put it right short of touching each row.
 *
 * So the update works them out, for every row, as the write path would:
 *
 *  - WHICH COLUMNS: each the new version derives that the version before did
 *    not (a new column, or one now derived another way), and each that reads
 *    one of them (a formula over the new copy, a total over the new formula),
 *    however many steps away. A table this version brings is in it too: it is
 *    empty, or holds only its seeds, which were written with the rules.
 *  - IN WHAT ORDER: each after what it reads, so a total adds up the line
 *    amounts the formula has just worked out, and the formula reads the copy
 *    already made.
 *  - BY WHAT RULE: the rule as it stands on the connection (the manifest's,
 *    written a moment earlier, or the operator's own where they keep one), read
 *    through the write path's own pieces (`tableRulesFor`, `settleParent`,
 *    `evaluateAll`): a value filled here is the value the next save of the row
 *    would write. A rule that is not there (switched off by the operator) is
 *    left alone, and said.
 *  - A `copy` that always wins is taken from the linked row as it is now for
 *    every row; one that only fills a blank fills only the rows still blank.
 *
 * In ONE transaction of the source database: filled whole, or not at all. The
 * caller runs it as a stage of the update, before the version is recorded, so
 * a failure is an update to finish ("update it again"), and doing it again
 * finds the same columns (the previous version is still the recorded one) and
 * works them out again — the result is the same however often it runs.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import { formulaColumns, type Manifest, type RequiredColumn, type RequiredTable } from '@adminium/manifest';

import type { SourceDatabase } from '../connections/manager.js';
import { tableRulesFor, type RollupInto, type TableRules } from '../crud/column-rules.js';
import { evaluateAll } from '../crud/formulas.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { settleBalances, settleParent, storableValues } from '../crud/write-service.js';
import { sameValue } from '../crud/write-values.js';
import { canonicalJson } from './sample-data.js';

type Db = Kysely<SourceDatabase>;
type Row = Record<string, unknown>;

/** How Adminium works a column out. */
export type DerivedKind = 'copy' | 'formula' | 'rollup' | 'balance';

/** A column of the app's (by the manifest's short table name) Adminium works out. */
export interface DerivedColumn {
  table: string;
  column: string;
  kind: DerivedKind;
}

/** What a fill did: the columns worked out, with the rows each wrote; and the ones left alone, with why. */
export interface DerivedFillResult {
  filled: (DerivedColumn & { rows: number })[];
  skipped: (DerivedColumn & { reason: string })[];
}

/** How many rows one read takes. */
const CHUNK = 500;

interface Derivation {
  kind: DerivedKind;
  /** The rule, spelled one way: two versions derive a column alike when these match. */
  rule: string;
  /** What it reads, as `table.column` by the manifest's short names. */
  reads: string[];
}

const at = (table: string, column: string): string => `${table}.${column}`;

/** The columns of each table a manifest derives, with what each reads. */
function derivations(manifest: unknown): Map<string, Derivation> {
  const out = new Map<string, Derivation>();
  const tables = ((manifest as { requiredSchema?: { tables?: unknown } } | null)?.requiredSchema?.tables ?? []) as RequiredTable[];
  if (!Array.isArray(tables)) return out;
  for (const table of tables) {
    for (const column of (table.columns ?? []) as RequiredColumn[]) {
      const rules = column.rules;
      if (rules === undefined) continue;
      if (rules.copy !== undefined) {
        const parent = table.columns.find((c) => c.ref === rules.copy!.via)?.references;
        out.set(at(table.ref, column.ref), {
          kind: 'copy',
          rule: canonicalJson({ copy: rules.copy }),
          reads: [at(table.ref, rules.copy.via), ...(parent === undefined ? [] : [at(parent, rules.copy.from)])],
        });
      }
      if (rules.formula !== undefined) {
        out.set(at(table.ref, column.ref), {
          kind: 'formula',
          rule: canonicalJson({ formula: rules.formula }),
          reads: formulaColumns(rules.formula).map((name) => at(table.ref, name)),
        });
      }
      const rollup = rules.rollup;
      if (rollup !== undefined) {
        const child = rollup.from;
        const childReads = [rollup.via, rollup.sum, rollup.times, rollup.unlessSet, rollup.where?.column, rollup.latest?.of, rollup.latest?.by]
          .filter((name): name is string => name !== undefined)
          .map((name) => at(child, name));
        const { balance, ...total } = rollup;
        out.set(at(table.ref, column.ref), { kind: 'rollup', rule: canonicalJson({ rollup: total }), reads: childReads });
        if (rollup.latest?.row !== undefined) {
          out.set(at(table.ref, rollup.latest.row), { kind: 'rollup', rule: canonicalJson({ rollup: total, row: true }), reads: childReads });
        }
        if (balance !== undefined) {
          out.set(at(table.ref, balance.column), {
            kind: 'balance',
            rule: canonicalJson({ balance, total: column.ref }),
            reads: [column.ref, balance.of, ...(balance.minus ?? [])].map((name) => at(table.ref, name)),
          });
        }
      }
    }
  }
  return out;
}

/**
 * The derived columns of `after` to work out for the rows already there,
 * each after what it reads: those `before` did not derive, or derived another
 * way, and every one of `after` that reads one of them.
 */
export function addedDerivedColumns(before: unknown, after: Manifest): DerivedColumn[] {
  const was = derivations(before);
  const now = derivations(after);
  const due = new Set<string>();
  for (const [id, derivation] of now) if (was.get(id)?.rule !== derivation.rule) due.add(id);
  if (due.size === 0) return [];
  // Whatever reads a column worked out again is worked out again too.
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, derivation] of now) {
      if (due.has(id) || !derivation.reads.some((read) => due.has(read))) continue;
      due.add(id);
      grew = true;
    }
  }
  // Each after what it reads; a circle (the manifest refuses one) in the order declared.
  const ordered: string[] = [];
  const left = [...now.keys()].filter((id) => due.has(id));
  while (left.length > 0) {
    const ready = left.findIndex((id) => !now.get(id)!.reads.some((read) => read !== id && left.includes(read)));
    const [next] = left.splice(ready === -1 ? 0 : ready, 1);
    ordered.push(next!);
  }
  return ordered.map((id) => {
    const dot = id.indexOf('.');
    return { table: id.slice(0, dot), column: id.slice(dot + 1), kind: now.get(id)!.kind };
  });
}

/** Every row of a table, a chunk at a time, in key order. */
async function* chunks(db: Db, table: ResolvedTable, columns: readonly string[]): AsyncGenerator<Row[]> {
  const wanted = [...new Set([...table.primaryKey, ...columns])];
  for (let offset = 0; ; offset += CHUNK) {
    let query = db.selectFrom(table.id).select(wanted as never);
    for (const key of table.primaryKey) query = query.orderBy(key as never);
    const rows = (await query.limit(CHUNK).offset(offset).execute()) as Row[];
    if (rows.length > 0) yield rows;
    if (rows.length < CHUNK) return;
  }
}

/** A row's own columns, written by its key, as a settle writes them: Adminium's own columns, judged by no rule. */
async function writeRow(db: Db, dialect: Dialect, table: ResolvedTable, row: Row, set: Row): Promise<void> {
  let update = db.updateTable(table.id).set(storableValues(table, set, dialect) as never);
  for (const key of table.primaryKey) update = update.where((eb) => eb(db.dynamic.ref(key), '=', row[key]));
  await update.execute();
}

async function fillCopy(db: Db, dialect: Dialect, table: ResolvedTable, rules: TableRules, column: string): Promise<number | string> {
  const copy = rules.copies?.find((c) => c.column === column);
  if (copy === undefined) return 'no copy rule on the column now';
  let written = 0;
  for await (const rows of chunks(db, table, [copy.via, column])) {
    const keys = [...new Set(rows.map((row) => row[copy.via]).filter((key) => key !== null && key !== undefined))];
    if (keys.length === 0) continue;
    const parents = (await db
      .selectFrom(copy.toTable)
      .select([...new Set([copy.toColumn, copy.from])] as never)
      .where((eb) => eb(db.dynamic.ref(copy.toColumn), 'in', keys as never))
      .execute()) as Row[];
    const byKey = new Map(parents.map((parent) => [String(parent[copy.toColumn]), parent[copy.from] ?? null]));
    for (const row of rows) {
      const key = row[copy.via];
      if (key === null || key === undefined) continue;
      // A copy that only fills a blank leaves a value somebody wrote.
      if (copy.mode === 'default' && row[column] !== null && row[column] !== undefined) continue;
      const value = byKey.has(String(key)) ? byKey.get(String(key)) : null;
      if (sameValue(row[column], value)) continue;
      await writeRow(db, dialect, table, row, { [column]: value });
      written += 1;
    }
  }
  return written;
}

async function fillFormula(db: Db, dialect: Dialect, table: ResolvedTable, rules: TableRules, column: string, currency: () => Promise<string | null>): Promise<number | string> {
  const formula = rules.formulas?.find((f) => f.column === column);
  if (formula === undefined) return 'no formula on the column now';
  const connection = formula.scale === 'currency' ? await currency() : null;
  let written = 0;
  for await (const rows of chunks(db, table, [...table.columns.keys()])) {
    for (const row of rows) {
      const worked = evaluateAll([formula], row, rules.currencyColumn, connection);
      if (sameValue(row[column], worked[column])) continue;
      await writeRow(db, dialect, table, row, { [column]: worked[column] ?? null });
      written += 1;
    }
  }
  return written;
}

async function fillRollup(db: Db, dialect: Dialect, table: ResolvedTable, rules: TableRules, column: string, kind: 'rollup' | 'balance', currency: () => Promise<string | null>): Promise<number | string> {
  const key = table.primaryKey.length === 1 ? table.primaryKey[0]! : null;
  if (key === null) return 'the table has no key of one column';
  if (kind === 'balance') {
    const balance = rules.balances?.find((b) => b.column === column);
    if (balance === undefined) return 'no balance on the column now';
    let written = 0;
    for await (const rows of chunks(db, table, [])) {
      for (const row of rows) {
        await settleBalances(db, dialect, table.id, key, [balance], row[key], { currencyColumn: rules.currencyColumn, currency });
        written += 1;
      }
    }
    return written;
  }
  const rollup: RollupInto | undefined = (rules.ownRollups ?? []).find((r) => r.column === column || r.latest?.row === column);
  if (rollup === undefined) return 'no total on the column now';
  let written = 0;
  for await (const rows of chunks(db, table, [])) {
    for (const row of rows) {
      // The total, the formulas over it and the balances beside it, as a write to a child row settles them.
      await settleParent(db, dialect, [rollup], row[key], rollup.balances, currency);
      written += 1;
    }
  }
  return written;
}

/**
 * Work `columns` out for every row their tables hold, in the order given
 * (see {@link addedDerivedColumns}), through `db` — the caller's transaction.
 * `realName` turns a manifest's short table name into the table's name here.
 */
export async function fillDerivedColumns(input: {
  db: Db;
  dialect: Dialect;
  view: SnapshotView;
  columns: readonly DerivedColumn[];
  realName: (ref: string) => string;
  /** The connection's currency, for a value kept at a currency's places. */
  currency: () => Promise<string | null>;
}): Promise<DerivedFillResult> {
  const { db, dialect, view } = input;
  const result: DerivedFillResult = { filled: [], skipped: [] };
  for (const derived of input.columns) {
    const name = input.realName(derived.table);
    const found = view.model.tables.find((table) => table.name === name);
    if (found === undefined) {
      result.skipped.push({ ...derived, reason: `there is no table ${name}` });
      continue;
    }
    const table = view.table(found.id);
    if (!table.columns.has(derived.column)) {
      result.skipped.push({ ...derived, reason: `${table.id} has no column ${derived.column}` });
      continue;
    }
    const rules = tableRulesFor({ view, table });
    if (rules === null) {
      result.skipped.push({ ...derived, reason: 'no rule on the table now' });
      continue;
    }
    const done =
      derived.kind === 'copy'
        ? await fillCopy(db, dialect, table, rules, derived.column)
        : derived.kind === 'formula'
          ? await fillFormula(db, dialect, table, rules, derived.column, input.currency)
          : await fillRollup(db, dialect, table, rules, derived.column, derived.kind, input.currency);
    if (typeof done === 'string') result.skipped.push({ ...derived, reason: done });
    else result.filled.push({ ...derived, rows: done });
  }
  return result;
}
