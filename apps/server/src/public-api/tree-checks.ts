// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A CREATE WITH ITS CHILD ROWS IS CHECKED BY — beyond each row's own
 * column rules, which the write service keeps.
 *
 *  - READABLE: every row a guest's value points at (a dish, a room type, an
 *    option) is a row some read of the same key shows them — its filters (on
 *    the menu, active, public) and, signed in, their claim. A dish that is
 *    off today or a ticket type sold only at the box office cannot be
 *    ordered by typing its key. A miss is `not-offered`: hidden and wrong
 *    answer alike.
 *  - AGREES: a row's value agrees with its parent's, through foreign keys
 *    (an option belongs to the chosen dish: `modifier → group → item` equals
 *    the line's dish), or is within a bound read through one (guests no more
 *    than the room type sleeps).
 *  - COUNTS: the rows of one list, grouped (options by their group), each
 *    group between its own least and most — an empty required group too.
 *  - SUM MAX: what one column of a list's rows adds up to, at most a number
 *    or a setting (no more than twelve items in one order).
 *
 * Staff forms are held to the agreements, counts and sums an app declares
 * for its guests (a desk cannot put three guests in a room that sleeps two);
 * the readable rule is a guest's alone. Every read runs on the write's own
 * transaction handle; the rows a guest points at are held for share where the
 * engine can, so one withdrawn meanwhile waits for the write.
 */
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import { rollupValue, toRatio } from '@adminium/manifest';

import { ValidationFailedError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { compileFilter } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { sameValue } from '../crud/write-values.js';
import { claimPredicateFor, combinePredicates, type PublicSessionContext } from './claim.js';
import { mandatoryAt } from './relative-filters.js';
import type { CompiledScope, ScopeAgree, ScopeChild } from './scope.js';
import { visibilityOf, visibleCondition } from './visible-with.js';

type Db = Kysely<SourceDatabase>;

/** What a check refused: the column, why, and — for a count — the group; a sum over a list names the list. */
export interface TreeRefusalParams {
  column?: string | undefined;
  reason: 'not-offered' | 'too-many' | 'too-few';
  group?: string | number | undefined;
  /** The list a refusal over a whole list is about (a sum of its rows). */
  child?: string | undefined;
}

/** A tree check's refusal: 422 with the column named, as a CHECK refusal is. */
export class TreeCheckRefused extends ValidationFailedError {
  constructor(readonly refused: TreeRefusalParams) {
    super('Some values were refused.', {
      fields: refused.column === undefined ? {} : { [refused.column]: { code: refused.reason } },
      ...refused,
    });
  }
}

/** The table a single-column foreign key points at, and the column it matches, or null. */
export function foreignKeyOf(view: SnapshotView, table: string, column: string): { table: ResolvedTable; key: string } | null {
  const relation = view.model.relations.find(
    (r) => r.through === null && r.from.tableId === table && r.from.columns.length === 1 && r.from.columns[0] === column && r.to.columns.length === 1,
  );
  const target = relation === undefined ? null : view.linkTable(relation.to.tableId);
  return target === null || relation === undefined ? null : { table: target, key: relation.to.columns[0]! };
}

/**
 * Follow a foreign key through further ones: from `table.column = value`,
 * read `path[0]` on the row it points at, and so on; the last column's value
 * (or the value itself with no path). `undefined` when a step finds no row.
 */
async function follow(db: Db, view: SnapshotView, table: string, column: string, path: readonly string[], value: unknown): Promise<unknown> {
  let current = value;
  let from = table;
  let via = column;
  for (const next of path) {
    if (current === null || current === undefined) return current;
    const target = foreignKeyOf(view, from, via);
    if (target === null) return undefined;
    const row = (await db
      .selectFrom(target.table.id)
      .select(sql<unknown>`${sql.ref(next)}`.as('value'))
      .where((eb) => eb(db.dynamic.ref(target.key), '=', current as never))
      .executeTakeFirst()) as { value?: unknown } | undefined;
    if (row === undefined) return undefined;
    current = row.value;
    from = target.table.id;
    via = next;
  }
  return current;
}

/** Two values compared as numbers, exactly: `-1`, `0`, `1`, or null when either is not one. */
function compare(a: unknown, b: unknown): number | null {
  const left = toRatio(a);
  const right = toRatio(b);
  if (left === null || right === null) return null;
  const l = left.n * right.d;
  const r = right.n * left.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * A row's `agrees` rules, on the transaction's handle: `row` on `table`, its
 * parent row (on `parentTable`) for a `parent` target.
 */
export async function judgeAgrees(
  db: Db,
  view: SnapshotView,
  table: ResolvedTable,
  agrees: readonly ScopeAgree[],
  row: Row,
  parent: { table: ResolvedTable; row: Row } | null,
): Promise<void> {
  for (const agree of agrees) {
    const own = row[agree.column];
    if (own === null || own === undefined) continue;
    if (agree.when !== undefined) {
      const at = await follow(db, view, table.id, agree.column, agree.when.path ?? [], own);
      if (!agree.when.in.some((listed) => sameValue(listed, at))) continue;
    }
    const mine = await follow(db, view, table.id, agree.column, agree.path ?? [], own);
    for (const [op, target] of [['eq', agree.eq], ['lte', agree.lte], ['gte', agree.gte]] as const) {
      if (target === undefined) continue;
      let theirs: unknown;
      if ('value' in target) theirs = target.value;
      else if ('via' in target) theirs = await follow(db, view, table.id, target.via, [target.column], row[target.via]);
      else {
        if (parent === null) continue;
        theirs = await follow(db, view, parent.table.id, target.parent, target.path ?? [], parent.row[target.parent]);
      }
      if (op === 'eq') {
        if (mine === undefined || theirs === undefined || !(sameValue(mine, theirs) || String(mine) === String(theirs))) {
          throw new TreeCheckRefused({ column: agree.column, reason: 'not-offered' });
        }
        continue;
      }
      // No bound where the row read has none.
      if (theirs === null || theirs === undefined) continue;
      const order = compare(mine, theirs);
      if (order === null || (op === 'lte' && order > 0)) throw new TreeCheckRefused({ column: agree.column, reason: op === 'lte' ? 'too-many' : 'too-few' });
      if (op === 'gte' && order < 0) throw new TreeCheckRefused({ column: agree.column, reason: 'too-few' });
    }
  }
}

/**
 * The rows of one list against its `counts`: each row's group, read through
 * the `by` path; every group the rule says must be judged (`every`, from the
 * parent's value) and every group a row falls in, between its least and its
 * most. The refusal names the first group out of bounds.
 */
export async function judgeCounts(
  db: Db,
  view: SnapshotView,
  child: Pick<ScopeChild, 'counts'> & { table: ResolvedTable },
  rows: readonly Row[],
  parent: Row,
): Promise<void> {
  for (const rule of child.counts ?? []) {
    const [first, ...rest] = rule.by;
    if (first === undefined) continue;
    // The table the last foreign key of the path points at: the groups.
    let from = child.table.id;
    let via = first;
    for (const next of rest) {
      const target = foreignKeyOf(view, from, via);
      if (target === null) break;
      from = target.table.id;
      via = next;
    }
    const groups = foreignKeyOf(view, from, via);
    if (groups === null) continue;
    const counted = new Map<string, number>();
    for (const row of rows) {
      const group = await follow(db, view, child.table.id, first, rest, row[first]);
      if (group === null || group === undefined) continue;
      counted.set(String(group), (counted.get(String(group)) ?? 0) + 1);
    }
    const judged = new Set(counted.keys());
    if (rule.every !== undefined) {
      const value = parent[rule.every.eq.parent];
      if (value !== null && value !== undefined) {
        const every = await db
          .selectFrom(groups.table.id)
          .select(sql<unknown>`${sql.ref(groups.key)}`.as('key'))
          .where((eb) => eb(db.dynamic.ref(rule.every!.column), '=', value as never))
          .execute();
        for (const row of every as { key: unknown }[]) judged.add(String(row.key));
      }
    }
    if (judged.size === 0) continue;
    const bounds = (await db
      .selectFrom(groups.table.id)
      .select([sql<unknown>`${sql.ref(groups.key)}`.as('key'), sql<unknown>`${sql.ref(rule.min)}`.as('least'), sql<unknown>`${sql.ref(rule.max)}`.as('most')])
      .where((eb) => eb(db.dynamic.ref(groups.key), 'in', [...judged] as never))
      .execute()) as { key: unknown; least: unknown; most: unknown }[];
    for (const group of [...bounds].sort((a, b) => String(a.key).localeCompare(String(b.key), 'en', { numeric: true }))) {
      const n = counted.get(String(group.key)) ?? 0;
      const least = group.least === null || group.least === undefined ? null : Number(group.least);
      const most = group.most === null || group.most === undefined ? null : Number(group.most);
      const key = typeof group.key === 'number' || typeof group.key === 'string' ? group.key : String(group.key);
      if (least !== null && n < least) throw new TreeCheckRefused({ reason: 'too-few', group: key });
      if (most !== null && n > most) throw new TreeCheckRefused({ reason: 'too-many', group: key });
    }
  }
}

/** What one column of a list's rows may add up to at most, and whether they do. */
export async function judgeSumMax(db: Db, name: string, sumMax: NonNullable<ScopeChild['sumMax']>, rows: readonly Row[]): Promise<void> {
  let limit: unknown = sumMax.max;
  if (typeof sumMax.max !== 'number') {
    const found = (await db
      .selectFrom(sumMax.max.table)
      .select(sql<unknown>`${sql.ref(sumMax.max.column)}`.as('value'))
      .limit(1)
      .executeTakeFirst()) as { value?: unknown } | undefined;
    limit = found?.value;
  }
  if (limit === null || limit === undefined) return;
  // Added up exactly, at more places than any amount a guest types.
  const total = rollupValue(rows, { sum: sumMax.column }, 6);
  if ((compare(total, limit) ?? 0) > 0) throw new TreeCheckRefused({ child: name, column: sumMax.column, reason: 'too-many' });
}

/**
 * Every row a guest's values point at is one a read of the key shows them:
 * each foreign key of `columns` with a value, against the key's read
 * resources on its table — their mandatory filters, their claim for this
 * session (or none), the parents they are visible with. Held for share where
 * the engine can: a dish withdrawn meanwhile waits for this write.
 */
export async function judgeReadable(input: {
  db: Db;
  dialect: Dialect;
  view: SnapshotView;
  scope: CompiledScope;
  session: PublicSessionContext | null;
  table: ResolvedTable;
  values: Row;
  /** The columns the guest wrote: only their references are the guest's. */
  columns: ReadonlySet<string>;
  now?: Date | undefined;
}): Promise<void> {
  const { db, dialect, view, scope, session } = input;
  for (const column of [...input.columns].sort()) {
    const value = input.values[column];
    if (value === null || value === undefined) continue;
    const target = foreignKeyOf(view, input.table.id, column);
    if (target === null) continue;
    const readers = [...scope.byRef.values()].filter((reader) => {
      if (reader.kind !== 'records' || !reader.actions.has('read')) return false;
      try {
        return view.table(reader.table).id === target.table.id;
      } catch {
        return false;
      }
    });
    let reached = false;
    for (const reader of readers) {
      const visibility = visibilityOf({ scope, resource: reader, session, view, ...(input.now === undefined ? {} : { now: input.now }) });
      if (!visibility.reachable) continue;
      if (reader.level === 'verified' && session?.level !== 'verified') continue;
      const claim = claimPredicateFor(reader, session);
      if (!claim.reachable) continue;
      const predicate = combinePredicates(mandatoryAt(reader.where, target.table, scope.timezone, input.now), claim.predicate);
      const alias = 'adm_ref';
      let query = db
        .selectFrom(`${target.table.id} as ${alias}` as never)
        .select(sql.lit(1).as('one'))
        .where(sql.ref(`${alias}.${target.key}`), '=', value as never);
      if (predicate !== null) {
        const filterCtx = { view, table: target.table, canReadPii: true, dynamic: db.dynamic, dialect };
        query = query.where((eb) => compileFilter(eb as never, filterCtx, predicate));
      }
      if (visibility.steps.length > 0) query = query.where(visibleCondition({ db, dialect, view }, alias, visibility.steps));
      const held = dialect === 'sqlite' ? query.limit(1) : query.limit(1).forShare();
      if ((await held.executeTakeFirst()) !== undefined) {
        reached = true;
        break;
      }
    }
    if (!reached) throw new TreeCheckRefused({ column, reason: 'not-offered' });
  }
}
