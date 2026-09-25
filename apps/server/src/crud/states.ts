// SPDX-License-Identifier: AGPL-3.0-only
/**
 * STATES — a document's life, kept for every writer (`table.states`).
 *
 * A row moves only along the table's moves (draft → sent → void), a move may
 * ask for something first (at least one line, nothing paid) and may be kept
 * for some roles; once the row is in a locked state only the columns the lock
 * leaves open change; child rows tied to it (lines, payments) follow it; a
 * numbered or locked row is never deleted; and some dates only ever move
 * later.
 *
 * ─── Judged where the statement runs ───────────────────────────────────────
 *
 * Every door that writes a row reaches a statement through `insertRow`,
 * `updateRows` or a guarded `deleteRows` — a form, a bulk edit, an import, a
 * parent form's child rows, the public API, an automation, the outbox. So the
 * judgement lives there, inside the statement's own transaction, against rows
 * read holding them (`FOR UPDATE`; SQLite writes one transaction at a time):
 *
 *  - an update or a delete holds its own row, and judges the move and the
 *    lock on the row as it is NOW — a writer who moved it meanwhile has
 *    committed, or waits for this one;
 *  - a child row holds its parent first, so a move of the parent and a write
 *    to its lines never interleave: a line added to an invoice being sent
 *    either lands before the send, or is refused because it is sent;
 *  - a move's requirements are read inside the same transaction, the child
 *    rows it counts under the parent's lock (MySQL reads them with a share
 *    lock, past its snapshot).
 *
 * That is the compare-and-set: a decision taken on the row a writer read
 * earlier can never be applied to a row that has moved since.
 *
 * ─── What a write carries ──────────────────────────────────────────────────
 *
 * The write service attaches a guard to each row it prepares (`attachGuard`):
 * whether the write brings in history, the roles of the writer, and the
 * columns its own rules decided. A row with no guard is judged by nothing —
 * that is only an undo, which is refused outright on a table tied to states,
 * and the outbox's own writes, which keep their own moves.
 *
 * History — an import, an app's sample data — may write rows in any state and
 * add child rows to a sent document: those rows say what happened then. The
 * lock still holds for an import's update of a row already locked.
 */
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { StateMoveRule, StateParent, TableStatesRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { AppError, ValidationFailedError } from '../errors.js';
import { inTransaction } from './capacity-guard.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { sameValue } from './write-values.js';

type Db = Kysely<SourceDatabase>;

/** What a prepared row carries to its statement. */
export interface StateGuard {
  /** An import or an app's sample data: history, which may be in any state. */
  history: boolean;
  /** The role slugs the writer holds, or `any` (Super Admin). */
  roles: ReadonlySet<string> | 'any';
  /** Columns this write's own rules decided — a stamp a move writes, a formula: the lock never refuses them. */
  decided: readonly string[];
}

const GUARD = Symbol('adminium.state-guard');

type Carrier = Row & { [GUARD]?: StateGuard };

/** The row with its guard attached (a copy; the symbol survives every spread on the way to the statement). */
export function attachGuard<T extends Row>(row: T, guard: StateGuard): T {
  const out = { ...row } as T & Carrier;
  out[GUARD] = guard;
  return out;
}

export function guardOf(row: Row): StateGuard | undefined {
  return (row as Carrier)[GUARD];
}

const EXPECT = Symbol('adminium.expect');

type Expecting = Row & { [EXPECT]?: Row };

/** The values with what a before hook judged the write on attached (see `BeforeWriteEvent.expect`). */
export function attachExpect<T extends Row>(row: T, expect: Row): T {
  const out = { ...row } as T & Expecting;
  out[EXPECT] = { ...(out[EXPECT] ?? {}), ...expect };
  return out;
}

export function expectOf(row: Row): Row | undefined {
  return (row as Expecting)[EXPECT];
}

/** An update that matched nothing because the row moved since it was judged. */
export function rowMoved(expect: Row): StateMoveRefused {
  return new StateMoveRefused('The row changed while you were changing it; look again.', { expected: expect, retry: true });
}

/** Whether a table's writes are judged here at all: it keeps states, or is tied to a parent that does. */
export function tiedToStates(table: ResolvedTable): boolean {
  const effective = table.table;
  return effective?.states !== undefined || (effective?.stateParents?.length ?? 0) > 0;
}

// ─── refusals ──────────────────────────────────────────────────────────────

export class StateMoveRefused extends AppError {
  override readonly name = 'StateMoveRefused';
  constructor(message: string, details: Record<string, unknown>) {
    super(409, 'STATE_MOVE_REFUSED', message, details);
  }
}

export class RecordLocked extends AppError {
  override readonly name = 'RecordLocked';
  constructor(message: string, details: Record<string, unknown>) {
    super(409, 'RECORD_LOCKED', message, details);
  }
}

export class DeleteRefused extends AppError {
  override readonly name = 'DeleteRefused';
  constructor(message: string, details: Record<string, unknown>) {
    super(409, 'DELETE_REFUSED', message, details);
  }
}

// ─── reading, holding ─────────────────────────────────────────────────────

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/** Run `run` in the caller's transaction, or in one of its own. */
function within<T>(db: Db, run: (db: Db) => Promise<T>): Promise<T> {
  return inTransaction(db) ? run(db) : db.transaction().execute(run);
}

/** The rows matching `match`, held for this transaction. */
async function heldRows(db: Db, dialect: Dialect, table: string, match: Row): Promise<Row[]> {
  let query = db.selectFrom(table).selectAll();
  for (const [column, value] of Object.entries(match)) query = query.where((eb) => eb(db.dynamic.ref(column), '=', value));
  if (dialect !== 'sqlite') query = query.forUpdate();
  return (await query.execute()) as Row[];
}

/** Whether a row of another table, in one of its states, points at this one — which locks it. */
async function referenced(db: Db, dialect: Dialect, table: ResolvedTable, row: Row): Promise<boolean> {
  const key = table.primaryKey[0];
  if (key === undefined || table.primaryKey.length !== 1) return false;
  for (const ref of table.table?.lockedBy ?? []) {
    let query = db
      .selectFrom(ref.table)
      .select(sql<number>`1`.as('one'))
      .where((eb) => eb(db.dynamic.ref(ref.via), '=', row[key]))
      .where((eb) => eb(db.dynamic.ref(ref.column), 'in', ref.in as never))
      .limit(1);
    if (dialect === 'mysql') query = query.forShare();
    if ((await query.executeTakeFirst()) !== undefined) return true;
  }
  return false;
}

/** Whether a row of this table is locked right now: in one of the lock's states, or pointed at by a row that locks it. */
async function lockedNow(db: Db, dialect: Dialect, table: ResolvedTable, row: Row): Promise<boolean> {
  const states = table.table?.states;
  if (states?.lock === undefined) return false;
  const state = text(row[states.column]) ?? states.initial;
  return states.lock.when.includes(state) || (await referenced(db, dialect, table, row));
}

/** A parent's state, and whether it is locked, read holding it. */
async function heldParent(db: Db, dialect: Dialect, parent: StateParent, key: unknown): Promise<{ state: string | null; locked: boolean } | null> {
  const [row] = await heldRows(db, dialect, parent.table, { [parent.key]: key });
  if (row === undefined) return null;
  const state = text(row[parent.column]);
  let locked = state !== null && parent.lockedIn.includes(state);
  for (const ref of locked ? [] : parent.lockedBy) {
    let query = db
      .selectFrom(ref.table)
      .select(sql<number>`1`.as('one'))
      .where((eb) => eb(db.dynamic.ref(ref.via), '=', key))
      .where((eb) => eb(db.dynamic.ref(ref.column), 'in', ref.in as never))
      .limit(1);
    if (dialect === 'mysql') query = query.forShare();
    if ((await query.executeTakeFirst()) !== undefined) locked = true;
  }
  return { state, locked };
}

// ─── the judgements ────────────────────────────────────────────────────────

/**
 * The parents a child row is tied to — before and after a move to another
 * parent — each held and judged: a locked parent takes no change to its
 * lines, and a parent outside `parentIn` takes no payment. Returns the parents
 * a new row empties columns of (`clearOnCreate`).
 */
async function judgeParents(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  sides: { now: Row | null; was: Row | null },
  guard: StateGuard,
): Promise<{ parent: StateParent; key: unknown }[]> {
  const out: { parent: StateParent; key: unknown }[] = [];
  for (const parent of table.table?.stateParents ?? []) {
    const keys = new Map<string, unknown>();
    for (const side of [sides.now, sides.was]) {
      const key = side?.[parent.via];
      if (key !== null && key !== undefined) keys.set(String(key), key);
    }
    for (const key of keys.values()) {
      const found = await heldParent(db, dialect, parent, key);
      // A parent that is not there is the foreign key's to refuse.
      if (found === null) continue;
      out.push({ parent, key });
      if (guard.history) continue;
      if (parent.lock === true && found.locked) {
        throw new RecordLocked(`${table.name} rows cannot change while their ${parent.table} is ${found.state ?? 'locked'}.`, {
          table: table.name,
          parent: parent.table,
          state: found.state,
        });
      }
      if (parent.parentIn !== undefined && (found.state === null || !parent.parentIn.includes(found.state))) {
        throw new RecordLocked(`${table.name} rows can change only while their ${parent.table} is ${parent.parentIn.join(' or ')}.`, {
          table: table.name,
          parent: parent.table,
          state: found.state,
          parentIn: parent.parentIn,
        });
      }
    }
  }
  return out;
}

/** The target of a move written either way. */
function targetOf(move: string | StateMoveRule): string {
  return typeof move === 'string' ? move : move.to;
}

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Whether a move's condition holds for the row as it will be. */
function holds(condition: NonNullable<NonNullable<StateMoveRule['requires']>['where']>[number], row: Row): boolean {
  const value = row[condition.column];
  if (condition.isNull !== undefined) return (value === null || value === undefined || value === '') === condition.isNull;
  if (condition.eq !== undefined) return sameValue(condition.eq, value);
  if (condition.in !== undefined) return condition.in.some((candidate) => sameValue(candidate, value));
  const n = numeric(value);
  if (n === null) return false;
  if (condition.gt !== undefined) return n > condition.gt;
  if (condition.gte !== undefined) return n >= condition.gte;
  if (condition.lt !== undefined) return n < condition.lt;
  return condition.lte !== undefined && n <= condition.lte;
}

/** A date as `YYYY-MM-DD`: a driver's Date at local midnight, or the text's first ten characters. */
export function dayOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? null;
}

/** An update of a row of a table that keeps states: the move, then the lock, then the dates that only move later. */
async function judgeOwnUpdate(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  states: TableStatesRule,
  stored: Row,
  values: Row,
  changed: readonly string[],
  guard: StateGuard,
): Promise<void> {
  const from = text(stored[states.column]) ?? states.initial;
  if (changed.includes(states.column) && !guard.history) {
    const to = text(values[states.column]);
    const move = (states.moves[from] ?? []).find((candidate) => targetOf(candidate) === to);
    const refuse = (message: string, extra: Record<string, unknown> = {}): never => {
      throw new StateMoveRefused(message, { column: states.column, from, to, ...extra });
    };
    if (move === undefined) refuse(`A ${table.name} row cannot go from ${from} to ${String(to)}.`);
    if (typeof move === 'object') {
      if (move.roles !== undefined && guard.roles !== 'any' && !move.roles.some((role) => (guard.roles as ReadonlySet<string>).has(role))) {
        refuse(`Only some roles may move a ${table.name} row from ${from} to ${String(to)}.`, { roles: move.roles });
      }
      const key = table.primaryKey[0];
      for (const [child, min] of Object.entries(move.requires?.children ?? {})) {
        const via = states.children?.[child]?.via;
        if (via === undefined || key === undefined) continue;
        let query = db
          .selectFrom(child)
          .select((eb) => eb.fn.countAll().as('n'))
          .where((eb) => eb(db.dynamic.ref(via), '=', stored[key]));
        // MySQL reads past its snapshot only with a lock; the parent row, held, keeps new ones waiting.
        if (dialect === 'mysql') query = query.forShare();
        const found = Number(((await query.executeTakeFirst()) as { n?: unknown } | undefined)?.n ?? 0);
        if (found < min) refuse(`A ${table.name} row goes from ${from} to ${String(to)} only with at least ${String(min)} ${child} row(s).`, { requires: child, min });
      }
      const next = { ...stored, ...values };
      for (const condition of move.requires?.where ?? []) {
        if (!holds(condition, next)) refuse(`A ${table.name} row goes from ${from} to ${String(to)} only when ${condition.column} allows it.`, { requires: condition.column });
      }
    }
  }
  if (await lockedNow(db, dialect, table, stored)) {
    const open = new Set([states.column, ...(states.lock?.except ?? []), ...guard.decided]);
    const column = changed.find((name) => !open.has(name));
    if (column !== undefined) {
      throw new RecordLocked(`This ${table.name} row is ${from}: ${column} can no longer change.`, { column, state: from });
    }
  }
  if (guard.history) return;
  for (const column of states.onlyLater ?? []) {
    if (!changed.includes(column)) continue;
    const was = dayOf(stored[column]);
    const next = dayOf(values[column]);
    if (was !== null && (next === null || next < was)) {
      throw new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'out-of-range' } }, reason: 'ONLY_LATER' });
    }
  }
}

// ─── the statements ────────────────────────────────────────────────────────

/**
 * An INSERT of a row tied to states. A new row of a table that keeps states
 * starts in its first state; a child row's parent is held and judged; a
 * child created empties the parent's `clearOnCreate` columns in the same
 * transaction.
 */
/** Empties columns of one row: the statement lives in the write service, the one place a source row is written. */
export type ClearColumns = (db: Db, table: string, keyColumn: string, key: unknown, columns: readonly string[]) => Promise<void>;

export async function guardedInsert<T>(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  row: Row,
  run: (db: Db) => Promise<T>,
  clear: ClearColumns,
): Promise<T> {
  const guard = guardOf(row);
  if (guard === undefined || !tiedToStates(table)) return run(db);
  return within(db, async (tx) => {
    const states = table.table?.states;
    if (states !== undefined && !guard.history) {
      const state = text(row[states.column]);
      if (state !== null && state !== states.initial) {
        throw new StateMoveRefused(`A new ${table.name} row starts as ${states.initial}.`, { column: states.column, from: null, to: state });
      }
    }
    const parents = await judgeParents(tx, dialect, table, { now: row, was: null }, guard);
    const out = await run(tx);
    if (!guard.history) {
      for (const { parent, key } of parents) {
        if ((parent.clearOnCreate?.length ?? 0) === 0) continue;
        await clear(tx, parent.table, parent.key, key, parent.clearOnCreate!);
      }
    }
    return out;
  });
}

/**
 * An UPDATE of rows tied to states: each row matched is held and judged
 * against what it holds NOW. A row the write does not really change (a form
 * sending a locked line back as it was) is judged by nothing.
 *
 * `visible` answers whether the caller's own scope reaches the row (the
 * public API's): a refusal about a row the caller could not see would tell
 * them it exists, so the write then simply matches nothing.
 */
export async function guardedUpdate(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  values: Row,
  match: Row,
  run: (db: Db) => Promise<number>,
  visible?: (db: Db) => Promise<boolean>,
): Promise<number> {
  const guard = guardOf(values);
  if (guard === undefined || !tiedToStates(table)) return run(db);
  return within(db, async (tx) => {
    for (const stored of await heldRows(tx, dialect, table.id, match)) {
      const changed = Object.keys(values).filter((column) => !sameValue(values[column], stored[column]));
      if (changed.length === 0) continue;
      try {
        const states = table.table?.states;
        if (states !== undefined) await judgeOwnUpdate(tx, dialect, table, states, stored, values, changed, guard);
        await judgeParents(tx, dialect, table, { now: { ...stored, ...values }, was: stored }, guard);
      } catch (refusal) {
        if (visible !== undefined && !(await visible(tx))) return 0;
        throw refusal;
      }
    }
    return run(tx);
  });
}

/**
 * A DELETE of rows tied to states. A numbered row, or one in a `noDelete`
 * state, is never deleted, nor a locked one — it is voided instead; a child
 * row's parent is held and judged.
 */
export async function guardedDelete(
  db: Db,
  dialect: Dialect,
  table: ResolvedTable,
  match: Row,
  guard: StateGuard | undefined,
  run: (db: Db) => Promise<number>,
): Promise<number> {
  if (guard === undefined || !tiedToStates(table)) return run(db);
  return within(db, async (tx) => {
    for (const stored of await heldRows(tx, dialect, table.id, match)) {
      const states = table.table?.states;
      if (states !== undefined && !guard.history) {
        const state = text(stored[states.column]) ?? states.initial;
        const when = states.noDelete?.when;
        const numbered =
          when === 'numbered' && (table.table?.columns ?? []).some((column) => column.sequence?.gapless === true && stored[column.name] !== null && stored[column.name] !== undefined);
        if (numbered || (Array.isArray(when) && when.includes(state))) {
          throw new DeleteRefused(`This ${table.name} row cannot be deleted${numbered ? ': it has a number' : ` while it is ${state}`}. Void it instead.`, {
            state,
            numbered,
          });
        }
        if (await lockedNow(tx, dialect, table, stored)) {
          throw new DeleteRefused(`This ${table.name} row is ${state}, so it cannot be deleted.`, { state, numbered: false });
        }
      }
      await judgeParents(tx, dialect, table, { now: null, was: stored }, guard);
    }
    return run(tx);
  });
}
