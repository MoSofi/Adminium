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
 *
 * ─── A released line, and the row a line bills ────────────────────────────
 *
 * A locked child may be RELEASED in some of its parent's states: a void
 * invoice's line may empty its link to the time it billed, and nothing else,
 * so the time can go on another invoice. And a child's link may LOCK columns
 * of the row it points at (`lockLinked`): the hours of time on an invoice do
 * not change while the invoice stands — unless it is in a state that
 * releases that link, which is what lets void, release and bill again follow
 * each other.
 *
 * The locked row's writer holds its row, then reads the lines pointing at it
 * and their parents; a line's writer that sets a link holds the linked row
 * FIRST — before its parent and before itself. So the two meet on the linked
 * row, in one order: the line waits for the change of hours to commit (and
 * bills the hours as changed), or the change of hours waits for the line to
 * commit (and is refused). A link lock is judged on every update, an undo's
 * included: an undo may not change the hours of time billed since.
 */
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { StateMoveRule, StateParent, TableStatesRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { AppError, ConflictError, ValidationFailedError } from '../errors.js';
import { inTransaction } from './capacity-guard.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { copiedOf } from './decided-columns.js';
import { sameValue } from './write-values.js';

type Db = Kysely<SourceDatabase>;

/** What a prepared row carries to its statement. */
export interface StateGuard {
  /**
   * An import or an app's sample data: history. A NEW row of history may
   * start in any state — it says what happened then. Nothing else is
   * exempt: an update of a row already there is judged like anyone's, and a
   * child row is held to its parent unless the same history brought that
   * parent in (`created`).
   */
  history: boolean;
  /** The rows this same history write has created so far (`<table>\u0000<key>`). */
  created?: Set<string>;
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

/**
 * The rows one history write (an import run, a sample load) creates, kept
 * per context object: each is one run, and nothing else holds it.
 */
const CREATED = new WeakMap<object, Set<string>>();

export function createdBy(context: object): Set<string> {
  let out = CREATED.get(context);
  if (out === undefined) CREATED.set(context, (out = new Set()));
  return out;
}

const rowKey = (table: string, key: unknown) => `${table}\u0000${String(key)}`;

/** Whether a table's writes are judged here at all: it keeps states, or is tied to a parent that does. */
export function tiedToStates(table: ResolvedTable): boolean {
  const effective = table.table;
  return effective?.states !== undefined || (effective?.stateParents?.length ?? 0) > 0;
}

/** Whether rows of other tables keep columns of this one while they link to it (`lockLinked`). */
export function lockedByLinks(table: ResolvedTable): boolean {
  return (table.table?.linkLocks?.length ?? 0) > 0;
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

/**
 * The rows a write of this table links to that keep columns while it does
 * (`StateParent.links`), held for share BEFORE the write's parents and its
 * own rows: the linked row's own writer holds it first too, so the two never
 * wait on each other crosswise. Only a link the write sets to a row is held —
 * emptying one locks nothing new.
 *
 * What the write copied from that row (a `copy` through the link, of a column
 * the link keeps) was read before anything was held. It is read again here,
 * holding the row: another writer changed it in between, and the write is
 * refused, to be made again, rather than keep what the row no longer says.
 */
async function holdLinkedFirst(db: Db, dialect: Dialect, table: ResolvedTable, row: Row): Promise<void> {
  const read = copiedOf(row) ?? {};
  const targets = new Map<string, { table: string; key: string; value: unknown; copied: [string, unknown][] }>();
  for (const parent of table.table?.stateParents ?? []) {
    for (const link of parent.links ?? []) {
      const value = row[link.via];
      if (value === null || value === undefined) continue;
      const copied = Object.entries(read[link.via] ?? {}).filter(([from]) => link.columns.includes(from));
      targets.set(`${link.table}\u0000${link.key}\u0000${String(value)}`, { table: link.table, key: link.key, value, copied });
    }
  }
  for (const name of [...targets.keys()].sort()) {
    const target = targets.get(name)!;
    let query = db
      .selectFrom(target.table)
      .select([sql<number>`1`.as('adm_one'), ...target.copied.map(([from], i) => sql<unknown>`${sql.ref(from)}`.as(`adm_${String(i)}`))])
      .where((eb) => eb(db.dynamic.ref(target.key), '=', target.value));
    if (dialect !== 'sqlite') query = query.forShare();
    const found = (await query.executeTakeFirst()) as Row | undefined;
    if (found === undefined) continue;
    target.copied.forEach(([from, was], i) => {
      if (!sameValue(found[`adm_${String(i)}`], was)) {
        throw new ConflictError('Someone else changed what this row copies at the same moment. Try again.', 'WRITE_CONFLICT', { retry: true, column: from });
      }
    });
  }
}

/**
 * A write that sets a link a `lockLinked` names but the model can no longer
 * follow (`unresolvedLinks`) is refused: the row it would link could not be
 * kept from changing. Emptying the link, or leaving it as it is, is not.
 */
function refuseUnresolvedLink(table: ResolvedTable, row: Row, changed?: readonly string[]): void {
  for (const parent of table.table?.stateParents ?? []) {
    for (const link of parent.unresolvedLinks ?? []) {
      const value = row[link];
      if (value === null || value === undefined || (changed !== undefined && !changed.includes(link))) continue;
      throw new RecordLocked(
        `${table.name}.${link} cannot be linked now: the rows it points at are to be kept as they are, and the table or a column that rule names is not in the database's schema. Put the link back, or change the ${parent.name} states in Studio.`,
        { table: table.name, column: link, unresolved: true },
      );
    }
  }
}

/**
 * The first column of `changed` a row linking to this one keeps (`lockLinked`),
 * with the linking table, or null. Read after the row itself is held, so a
 * line's writer that links to it has committed (and is seen: MySQL reads it
 * with a share lock, past its snapshot) or waits for this write.
 *
 * A link locks unless its row's parent is in a state that releases the link.
 * A linking row whose parent is gone, or has no state, locks.
 */
async function linkLockedColumn(db: Db, dialect: Dialect, table: ResolvedTable, stored: Row, changed: readonly string[]): Promise<{ column: string; by: string } | null> {
  for (const lock of table.table?.linkLocks ?? []) {
    const column = changed.find((name) => lock.columns.includes(name));
    const key = stored[lock.key];
    if (column === undefined || key === null || key === undefined) continue;
    const state = sql.ref(`adm_parent.${lock.parent.column}`);
    const join =
      lock.releasedIn.length === 0
        ? sql``
        : sql` left join ${sql.table(lock.parent.table)} as adm_parent on ${sql.ref(`adm_parent.${lock.parent.key}`)} = ${sql.ref(`adm_link.${lock.parent.via}`)}`;
    const unreleased = lock.releasedIn.length === 0 ? sql`` : sql` and (${state} is null or ${state} not in (${sql.join(lock.releasedIn)}))`;
    // MySQL reads past its snapshot only with a lock (Postgres's statement already sees what committed).
    const shared = dialect === 'mysql' ? sql` for share` : sql``;
    const found = await sql<{ one: number }>`select 1 as one from ${sql.table(lock.table)} as adm_link${join} where ${sql.ref(`adm_link.${lock.via}`)} = ${key}${unreleased} limit 1${shared}`.execute(db);
    if (found.rows.length > 0) return { column, by: lock.name };
  }
  return null;
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
  /** An update's changed columns: what a release is judged on. */
  changed?: readonly string[],
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
      // A parent the same history brought in takes its own past children.
      if (guard.history && guard.created?.has(rowKey(parent.table, key)) === true) continue;
      if (parent.lock === true && found.locked && !released(parent, found.state, sides, changed)) {
        throw new RecordLocked(`${table.name} rows cannot change while their ${parent.name} is ${found.state ?? 'locked'}.`, {
          table: table.name,
          parent: parent.name,
          state: found.state,
        });
      }
      if (parent.parentIn !== undefined && (found.state === null || !parent.parentIn.includes(found.state))) {
        throw new RecordLocked(`${table.name} rows can change only while their ${parent.name} is ${parent.parentIn.join(' or ')}.`, {
          table: table.name,
          parent: parent.name,
          state: found.state,
          parentIn: parent.parentIn,
        });
      }
    }
  }
  return out;
}

/**
 * Whether a change to a locked child is one its parent's state releases: an
 * update, under the same parent, that only EMPTIES columns the release lists.
 * Setting one to a value, changing any other column, moving the row to
 * another parent, creating and deleting stay locked.
 */
function released(parent: StateParent, state: string | null, sides: { now: Row | null; was: Row | null }, changed: readonly string[] | undefined): boolean {
  const release = parent.release;
  if (release === undefined || state === null || !release.when.includes(state)) return false;
  if (changed === undefined || changed.length === 0 || sides.now === null || sides.was === null) return false;
  if (!sameValue(sides.now[parent.via], sides.was[parent.via])) return false;
  return changed.every((column) => release.columns.includes(column) && (sides.now![column] === null || sides.now![column] === undefined));
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

/**
 * A moment as milliseconds: a driver's Date, an ISO spelling with its offset,
 * or SQLite's zone-less wall clock (this server's, as it was written).
 */
export function instantOf(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const at = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2} \d/.test(String(value)) ? String(value).replace(' ', 'T') : String(value));
  const ms = at.getTime();
  return Number.isNaN(ms) ? null : ms;
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
  if (changed.includes(states.column)) {
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
  for (const column of states.onlyLater ?? []) {
    if (!changed.includes(column)) continue;
    // A moment is compared as a moment, a date as a day.
    const moment = ['timestamp', 'timestamptz'].includes(table.columns.get(column)?.logicalType ?? '');
    const was = moment ? instantOf(stored[column]) : dayOf(stored[column]);
    const next = moment ? instantOf(values[column]) : dayOf(values[column]);
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
    refuseUnresolvedLink(table, row);
    await holdLinkedFirst(tx, dialect, table, row);
    const states = table.table?.states;
    if (states !== undefined && !guard.history) {
      const state = text(row[states.column]);
      if (state !== null && state !== states.initial) {
        throw new StateMoveRefused(`A new ${table.name} row starts as ${states.initial}.`, { column: states.column, from: null, to: state });
      }
    }
    const parents = await judgeParents(tx, dialect, table, { now: row, was: null }, guard);
    const out = await run(tx);
    // What this history brought in: its own children may follow it, in its past state.
    const key = table.primaryKey.length === 1 ? (out as Row | null)?.[table.primaryKey[0]!] : undefined;
    if (guard.history && guard.created !== undefined && key !== null && key !== undefined) guard.created.add(rowKey(table.id, key));
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
/**
 * The parents rows of this table are tied to, held BEFORE the rows
 * themselves: every writer takes a document before its lines, so a send and
 * a line edit never wait on each other crosswise (a deadlock on MySQL).
 * The rows are read as they are, without a lock, only to learn their parents.
 */
export async function holdParentsFirst(db: Db, dialect: Dialect, table: ResolvedTable, match: Row, values?: Row): Promise<void> {
  const parents = table.table?.stateParents ?? [];
  if (parents.length === 0 || dialect === 'sqlite') return;
  const peek = await heldRows(db, 'sqlite', table.id, match);
  for (const parent of [...parents].sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0))) {
    const keys = new Map<string, unknown>();
    for (const side of [...peek, ...(values === undefined ? [] : [values])]) {
      const key = side[parent.via];
      if (key !== null && key !== undefined) keys.set(String(key), key);
    }
    for (const key of [...keys.keys()].sort()) await heldRows(db, dialect, parent.table, { [parent.key]: keys.get(key) });
  }
}

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
  // The states judge a write that carries a guard; a link lock judges every update, an undo's too.
  const tied = guard !== undefined && tiedToStates(table);
  const linked = lockedByLinks(table);
  if (!tied && !linked) return run(db);
  return within(db, async (tx) => {
    if (tied) {
      await holdLinkedFirst(tx, dialect, table, values);
      await holdParentsFirst(tx, dialect, table, match, values);
    }
    for (const stored of await heldRows(tx, dialect, table.id, match)) {
      const changed = Object.keys(values).filter((column) => !sameValue(values[column], stored[column]));
      if (changed.length === 0) continue;
      try {
        const states = table.table?.states;
        if (tied) refuseUnresolvedLink(table, values, changed);
        if (tied && states !== undefined) await judgeOwnUpdate(tx, dialect, table, states, stored, values, changed, guard);
        if (tied) await judgeParents(tx, dialect, table, { now: { ...stored, ...values }, was: stored }, guard, changed);
        const kept = linked ? await linkLockedColumn(tx, dialect, table, stored, changed) : null;
        if (kept !== null) {
          throw new RecordLocked(`This ${table.name} row is linked from ${kept.by}: ${kept.column} can no longer change.`, { column: kept.column, linkedFrom: kept.by });
        }
      } catch (refusal) {
        if (visible !== undefined && !(await visible(tx))) return 0;
        throw refusal;
      }
    }
    return run(tx);
  });
}

/**
 * Whether a row of this table may be deleted: a numbered row, one in a
 * `noDelete` state, or a locked one never is — it is voided instead — and a
 * child row's parent is judged (a sent invoice keeps its lines). Throws the
 * refusal. `dialect` says how rows are read: holding them inside the delete's
 * own transaction, or as they are (`deleteRefusal`), before anyone is asked
 * to confirm a delete that would only be refused.
 */
async function judgeDelete(db: Db, dialect: Dialect, table: ResolvedTable, stored: Row, guard: StateGuard): Promise<void> {
  const states = table.table?.states;
  if (states !== undefined) {
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
    if (await lockedNow(db, dialect, table, stored)) {
      throw new DeleteRefused(`This ${table.name} row is ${state}, so it cannot be deleted.`, { state, numbered: false });
    }
  }
  await judgeParents(db, dialect, table, { now: null, was: stored }, guard);
}

/**
 * A DELETE of rows tied to states, each judged holding it (`judgeDelete`).
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
    await holdParentsFirst(tx, dialect, table, match);
    for (const stored of await heldRows(tx, dialect, table.id, match)) await judgeDelete(tx, dialect, table, stored, guard);
    return run(tx);
  });
}

/**
 * The refusal a delete of this row would meet, or null — read as the row is
 * now, holding nothing: what a person is told before they are asked to
 * confirm anything. The delete itself judges again, holding the row.
 */
export async function deleteRefusal(db: Db, table: ResolvedTable, stored: Row, guard: StateGuard | undefined): Promise<AppError | null> {
  if (guard === undefined || !tiedToStates(table)) return null;
  try {
    // Read without locks: SQLite's reading takes none.
    await judgeDelete(db, 'sqlite', table, stored, guard);
    return null;
  } catch (error) {
    if (error instanceof DeleteRefused || error instanceof RecordLocked) return error;
    throw error;
  }
}
