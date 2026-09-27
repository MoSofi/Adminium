// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FOLLOW — copies that keep in step with the row they copy from
 * (`copy {mode: 'always', follow: true}`): when a stay's nights or guests
 * change, each of its extras takes the new value, works its formulas out
 * again (breakfast = each × guests × nights), and its totals are settled
 * into the stay — in the same write, so the stay's total, tax and balance
 * are right when the change commits, or nothing is.
 *
 * It runs after the changed row's own statement, holding that row (every
 * writer takes a stay before its extras: the same order as a write to an
 * extra, which holds its stay first). The child rows are held too, read,
 * and each changed one written directly, like a settle's statements: the
 * columns it writes are Adminium's own (a copy and the formulas over it), so
 * the states guard and the seals do not judge them.
 *
 * One level only, and never a loop: the manifest refuses a copy that follows
 * a copy, and a parent column worked out from the child's own totals; the
 * settle after it writes totals, formulas and balances, which are never a
 * followed column. More than {@link FOLLOW_MAX} child rows refuse the whole
 * write (409 `FOLLOW_TOO_MANY`) rather than leave some behind.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import { ConflictError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { tableRulesFor, type FollowOut, type TableRules } from './column-rules.js';
import { evaluateAll, touchedFormulas } from './formulas.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';
import { sameValue } from './write-values.js';

type Db = Kysely<SourceDatabase>;

/** The most child rows one change moves: a stay's extras, a list's lines. */
export const FOLLOW_MAX = 500;

/** Whether a change of these values can move a column a copy follows. */
export function followsFrom(rules: TableRules | null, values: Row): boolean {
  return (rules?.followReads ?? []).some((column) => Object.prototype.hasOwnProperty.call(values, column));
}

/** One child table a change moved: its rules, and each row written, before and after. */
export interface Followed {
  table: ResolvedTable;
  rules: TableRules | null;
  rows: { record: Row; before: Row }[];
}

/** The follows of `rules`, by child table. */
function byChild(rules: TableRules): Map<string, FollowOut[]> {
  const out = new Map<string, FollowOut[]>();
  for (const follow of rules.follows ?? []) out.set(follow.child, [...(out.get(follow.child) ?? []), follow]);
  return out;
}

/**
 * The columns a change of this table's rows may write in the child rows
 * that follow them, per child table: each followed copy, and the formulas
 * that read one. What the connection's role must be granted before the
 * write's first statement.
 */
export function followColumns(view: SnapshotView, rules: TableRules | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (rules === null) return out;
  for (const [child, follows] of byChild(rules)) {
    const childRules = rulesOf(view, child);
    const copied = follows.map((follow) => follow.column);
    const formulas = touchedFormulas(childRules?.formulas ?? [], copied).map((formula) => formula.column);
    out.set(child, [...new Set([...copied, ...formulas])]);
  }
  return out;
}

function rulesOf(view: SnapshotView, tableId: string): TableRules | null {
  try {
    return tableRulesFor({ view, table: view.table(tableId) });
  } catch {
    return null;
  }
}

/**
 * The child rows that follow a changed row, brought into step with it: held,
 * read, and each one whose followed columns (or the formulas over them) move
 * written by its key. `before` and `after` are the changed row as it was and
 * as it now is, read holding it. Returns what was written, per child table,
 * for the caller to settle into the row's totals. Nothing is written when no
 * followed column changed.
 */
export async function followChanged(input: {
  db: Db;
  dialect: Dialect;
  view: SnapshotView;
  rules: TableRules | null;
  before: Row;
  after: Row;
  /** The connection's currency, for a formula at a currency's places. */
  currency: () => Promise<string | null>;
  /** False for a quote: it reads the rows as they are, holding none it does not write. */
  hold?: boolean;
}): Promise<Followed[]> {
  const { db, dialect, view, rules, before, after } = input;
  if (rules?.follows === undefined) return [];
  const out: Followed[] = [];
  // In table order: two writers moving two parents with the same child tables take them alike.
  const children = [...byChild(rules)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [child, follows] of children) {
    const moved = follows.filter((follow) => !sameValue(before[follow.from], after[follow.from]));
    if (moved.length === 0) continue;
    const key = after[moved[0]!.key];
    if (key === null || key === undefined) continue;
    const table = view.table(child);
    const childRules = rulesOf(view, child);
    const via = moved[0]!.via;
    let query = db
      .selectFrom(table.id)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(via), '=', key));
    for (const column of table.primaryKey) query = query.orderBy(column as never);
    query = query.limit(FOLLOW_MAX + 1);
    // Held as every row a write changes is (FOR NO KEY UPDATE on Postgres); SQLite has one writer.
    if (dialect !== 'sqlite' && input.hold !== false) query = dialect === 'postgres' ? query.forNoKeyUpdate() : query.forUpdate();
    const rows = (await query.execute()) as Row[];
    if (rows.length > FOLLOW_MAX) {
      const counted = (await db
        .selectFrom(table.id)
        .select((eb) => eb.fn.countAll().as('n'))
        .where((eb) => eb(db.dynamic.ref(via), '=', key))
        .executeTakeFirst()) as { n?: unknown } | undefined;
      throw new ConflictError(`More ${table.name} rows follow this row than one change moves; change them in smaller steps.`, 'FOLLOW_TOO_MANY', {
        table: table.id,
        count: Number(counted?.n ?? rows.length),
      });
    }
    const written: Followed['rows'] = [];
    let currency: string | null | undefined;
    for (const row of rows) {
      const next: Row = {};
      for (const follow of follows) {
        if (!sameValue(row[follow.column], after[follow.from])) next[follow.column] = after[follow.from] ?? null;
      }
      if (Object.keys(next).length === 0) continue;
      const formulas = touchedFormulas(childRules?.formulas ?? [], Object.keys(next));
      if (formulas.length > 0) {
        if (currency === undefined) currency = formulas.some((formula) => formula.scale === 'currency') ? await input.currency() : null;
        Object.assign(next, evaluateAll(formulas, { ...row, ...next }, childRules?.currencyColumn, currency));
      }
      // better-sqlite3 binds no boolean: a yes or no goes in as SQLite keeps one.
      const bound = dialect === 'sqlite' ? Object.fromEntries(Object.entries(next).map(([column, value]) => [column, typeof value === 'boolean' ? (value ? 1 : 0) : value])) : next;
      let update = db.updateTable(table.id).set(bound as never);
      for (const column of table.primaryKey) update = update.where((eb) => eb(db.dynamic.ref(column), '=', row[column]));
      await update.execute();
      written.push({ record: { ...row, ...next }, before: row });
    }
    if (written.length > 0) out.push({ table, rules: childRules, rows: written });
  }
  return out;
}
