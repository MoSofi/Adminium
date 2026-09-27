// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A MOVE WAITS FOR — beyond its own row.
 *
 * A move may wait for the row one of its links points at (a ticket is let in
 * only for a paid order), for a value of the settings row (door sales switched
 * on), and for a window on the clock (from half an hour before the doors, and
 * before the ticket's day ends). A new row may wait for the same things
 * before it is created at all (`states.create`). A guest's change through the
 * public API may be open only inside a window read from moments too (a refund
 * until seven days before the show), and only while the linked row allows it.
 *
 * ─── Held, then judged ─────────────────────────────────────────────────────
 *
 * Everything is read inside the write's transaction, in the one order every
 * writer takes rows in: named locks, then the parents whose totals or states
 * the row is tied to, then the rows its links point at — FOR SHARE, or FOR
 * UPDATE for a row the write will move too (an effect) — then its own rows.
 * The linked row's own writer holds it FOR UPDATE, so the two wait for each
 * other one way only: an order being paid and its ticket being scanned never
 * deadlock, and the scan sees the order as it committed.
 *
 * Which row a link points at is learnt before anything is held, from the row
 * as it was read. Holding its own row later, the write reads the link again:
 * another writer that moved it in between makes this one refuse, to be made
 * again (`WRITE_CONFLICT`, retry), rather than judge the wrong row.
 *
 * The clock a window is judged by is the write's, read under its locks
 * (`write-clock.ts`), or the time a device says a scan was made
 * (`occurredAt`), never a `now` read before the write waited.
 *
 * A condition that cannot be read — a link that is empty, a linked row that is
 * gone, a link the database no longer has, a moment with no value — refuses:
 * a move waiting for something is never let through on nothing.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import type { Moment, StateCondition } from '@adminium/manifest';

import type { ColumnStampRule, StateLink, TableStatesRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { AppError, ConflictError } from '../errors.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { momentOf, type MomentContext } from './moments.js';
import { sameValue } from './write-values.js';

type Db = Kysely<SourceDatabase>;

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Whether a condition holds for a row. */
export function holds(condition: Pick<StateCondition, 'column' | 'eq' | 'in' | 'isNull' | 'gt' | 'gte' | 'lt' | 'lte'>, row: Row): boolean {
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

// ─── the public window, carried to the statement ──────────────────────────

/**
 * A public entry's window read from moments (`writable_when`), resolved for
 * the statement: keyed by the row's own date or time (`column`), or by a link
 * (`link`, the moments then read the linked row's columns), with conditions
 * on the linked row.
 */
export interface StateWindow {
  column: string;
  link?: StateLink | undefined;
  after?: Moment | undefined;
  before?: Moment | undefined;
  where?: readonly StateCondition[] | undefined;
  /** The venue's zone the entry reads its wall times in. */
  zone?: string | undefined;
  /** Keyed by a link the database no longer has: nothing can be read, so the window is shut. */
  unresolved?: true | undefined;
}

const WINDOWS = Symbol('adminium.write-windows');

type Windowed = Row & { [WINDOWS]?: readonly StateWindow[] };

/** The values with the windows the write must fall inside attached (they survive every spread on the way to the statement). */
export function attachWindows<T extends Row>(row: T, windows: readonly StateWindow[]): T {
  if (windows.length === 0) return row;
  const out = { ...row } as T & Windowed;
  out[WINDOWS] = windows;
  return out;
}

export function windowsOf(row: Row): readonly StateWindow[] {
  return (row as Windowed)[WINDOWS] ?? [];
}

// ─── refusals ──────────────────────────────────────────────────────────────

/** A public change outside its window: `bound` says which end, `at` the moment. */
export class WriteWindowClosed extends ConflictError {
  constructor(message: string, details: { bound: 'after' | 'before'; at: string | null; column: string; reason?: string }) {
    super(message, 'WRITE_WINDOW_CLOSED', details);
  }
}

/** A write naming the state a strict row already holds. */
export class StateUnchanged extends ConflictError {
  constructor(message: string, details: Record<string, unknown>) {
    super(message, 'STATE_UNCHANGED', details);
  }
}

/** A move a late rule turns away. */
export class StateTooLate extends ConflictError {
  constructor(message: string, details: { column: string; at: string | null }) {
    super(message, 'STATE_TOO_LATE', details);
  }
}

/** The linked row moved its link between the read that named it and the hold. */
export function linkMoved(via: string): ConflictError {
  return new ConflictError('Someone else changed this row at the same moment. Try again.', 'WRITE_CONFLICT', { retry: true, column: via });
}

// ─── holding the linked rows ───────────────────────────────────────────────

/** One row a link points at that a write reads: held for share, or for update when the write moves it too. */
export interface LinkedHold {
  link: StateLink;
  value: unknown;
  forUpdate: boolean;
}

const holdKey = (link: Pick<StateLink, 'table' | 'key'>, value: unknown) => `${link.table}\u0000${link.key}\u0000${String(value)}`;

/** The rows a write's links point at, as held: by table, key and value (null for a row that is gone). */
export class HeldLinks {
  constructor(private readonly rows: ReadonlyMap<string, Row | null>) {}

  /** The row one link of `row` points at, or null (an empty link, a row gone, or a link not held). */
  of(link: StateLink, row: Row): Row | null {
    const value = row[link.via];
    if (value === null || value === undefined) return null;
    return this.rows.get(holdKey(link, value)) ?? null;
  }

  /** The rows every link of `links` points at from `row`, by the link column, as a moment reads them. */
  byVia(links: readonly StateLink[], row: Row): Map<string, Row | null> {
    return new Map(links.map((link) => [link.via, this.of(link, row)]));
  }
}

/**
 * Hold the rows a write's links point at, in one order by table, key and
 * value: FOR UPDATE when any hold of the row asks for it (never for share and
 * then again for update — two writers upgrading one row would deadlock), FOR
 * SHARE otherwise. SQLite writes one transaction at a time and holds nothing.
 * `also` runs inside the same order for the holds another rule adds (the
 * columns a link keeps, `lockLinked`), so every linked row is taken in one
 * pass.
 */
export async function holdLinkedRows(db: Db, dialect: Dialect, holds: readonly LinkedHold[]): Promise<HeldLinks> {
  const wanted = new Map<string, LinkedHold>();
  for (const hold of holds) {
    if (hold.value === null || hold.value === undefined) continue;
    const key = holdKey(hold.link, hold.value);
    const found = wanted.get(key);
    wanted.set(key, found === undefined ? hold : { ...found, forUpdate: found.forUpdate || hold.forUpdate });
  }
  const rows = new Map<string, Row | null>();
  for (const key of [...wanted.keys()].sort()) {
    const hold = wanted.get(key)!;
    let query = db
      .selectFrom(hold.link.table)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(hold.link.key), '=', hold.value));
    if (dialect !== 'sqlite') query = hold.forUpdate ? query.forUpdate() : query.forShare();
    rows.set(key, ((await query.executeTakeFirst()) as Row | undefined) ?? null);
  }
  return new HeldLinks(rows);
}

/** The table's link for a column, or undefined (not resolved: see `unresolvedStateLinks`). */
export function stateLinkOf(table: ResolvedTable, via: string): StateLink | undefined {
  return (table.table?.stateLinks ?? []).find((link) => link.via === via);
}

// ─── judging what a move waits for ────────────────────────────────────────

/** What a move or a create waits for, beyond its own row's `where`. */
export interface Waits {
  where?: readonly StateCondition[] | undefined;
  linked?: readonly { via: string; where: readonly StateCondition[] }[] | undefined;
  time?: { after?: Moment | undefined; before?: Moment | undefined } | undefined;
  setting?: readonly { table: string; column: string; eq: string | number | boolean }[] | undefined;
}

/** Every link what a move waits for reads through. */
export function waitVias(waits: Waits | undefined): string[] {
  if (waits === undefined) return [];
  const moments = (m: Moment | undefined) => (m === undefined ? [] : [m, ...(m.or ?? [])].flatMap((one) => (one.via === undefined ? [] : [one.via])));
  return [...new Set([...(waits.linked ?? []).map((l) => l.via), ...moments(waits.time?.after), ...moments(waits.time?.before)])];
}

/**
 * Judge what a move (or a create) waits for, on the row as it will stand, the
 * rows its links point at as held, the settings row and the write's clock.
 * `refuse` throws the move's own refusal with the details added.
 */
export async function judgeWaits(
  waits: Waits,
  table: ResolvedTable,
  input: { moments: MomentContext; now: Date },
  refuse: (message: string, details: Record<string, unknown>) => never,
): Promise<void> {
  const { moments, now } = input;
  const unresolved = table.table?.unresolvedStateLinks ?? [];
  for (const condition of waits.where ?? []) {
    if (!holds(condition, moments.row)) refuse(`only when ${condition.column} allows it`, { requires: condition.column });
  }
  for (const linked of waits.linked ?? []) {
    if (unresolved.includes(linked.via)) {
      refuse(`only through ${linked.via}, which the database no longer links`, { requires: 'linked', via: linked.via, unresolved: true });
    }
    const row = moments.linked.get(linked.via) ?? null;
    if (row === null) refuse(`only with a row at ${linked.via}`, { requires: 'linked', via: linked.via });
    for (const condition of linked.where) {
      if (!holds(condition, row!)) refuse(`only when its ${linked.via} row's ${condition.column} allows it`, { requires: 'linked', via: linked.via, column: condition.column });
    }
  }
  for (const setting of waits.setting ?? []) {
    const value = await moments.settings(setting);
    if (!sameValue(setting.eq, value)) refuse(`only while the settings allow it (${setting.column})`, { requires: 'setting', column: setting.column });
  }
  const time = waits.time;
  for (const vias of [time?.after, time?.before].map((m) => (m === undefined ? [] : [m, ...(m.or ?? [])]))) {
    for (const via of vias.flatMap((m) => (m.via === undefined ? [] : [m.via]))) {
      if (unresolved.includes(via)) refuse(`only through ${via}, which the database no longer links`, { requires: 'time', via, unresolved: true });
    }
  }
  if (time?.after !== undefined) {
    const at = await momentOf(time.after, moments);
    if (at === null) refuse('only once a time it reads is set', { requires: 'time', bound: 'after', reason: 'no-moment' });
    if (now.getTime() < at!.getTime()) refuse(`only from ${at!.toISOString()}`, { requires: 'time', bound: 'after', at: at!.toISOString() });
  }
  if (time?.before !== undefined) {
    const at = await momentOf(time.before, moments);
    if (at === null) refuse('only once a time it reads is set', { requires: 'time', bound: 'before', reason: 'no-moment' });
    if (now.getTime() >= at!.getTime()) refuse(`only before ${at!.toISOString()}`, { requires: 'time', bound: 'before', at: at!.toISOString() });
  }
}

/**
 * Judge a public window read from moments on the row as held: conditions on
 * the linked row, then after and before. A window that cannot be read (a
 * link that is empty, a moment with no value) is closed.
 */
export async function judgeWindow(window: StateWindow, input: { moments: MomentContext; now: Date }): Promise<void> {
  const { moments, now } = input;
  const close = (bound: 'after' | 'before', at: Date | null, reason?: string): never => {
    throw new WriteWindowClosed(
      bound === 'after' ? 'This change is not open yet.' : 'It is too late to make this change.',
      { bound, at: at === null ? null : at.toISOString(), column: window.column, ...(reason === undefined ? {} : { reason }) },
    );
  };
  if (window.unresolved === true) close('before', null, 'linked');
  if (window.link !== undefined) {
    const linked = moments.linked.get(window.link.via) ?? null;
    if (linked === null || (window.where ?? []).some((condition) => !holds(condition, linked))) close('before', null, 'linked');
  }
  const read = (end: Moment): Moment => (window.link === undefined ? { ...end, column: window.column } : { ...end, via: window.link.via });
  if (window.after !== undefined) {
    const at = await momentOf(read(window.after), moments);
    if (at === null) close('after', null, 'no-moment');
    if (now.getTime() < at!.getTime()) close('after', at);
  }
  if (window.before !== undefined) {
    const at = await momentOf(read(window.before), moments);
    if (at === null) close('before', null, 'no-moment');
    if (now.getTime() >= at!.getTime()) close('before', at);
  }
}

// ─── once means once ───────────────────────────────────────────────────────

/** A value as a refusal repeats it: a moment as its ISO instant. */
const echoed = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value);

/**
 * What a refusal of a strict row repeats: when and by whom it moved INTO the
 * state it holds — read from the stamps that fire on a move to that state (a
 * time for `at`, a person or a word for `by`), which never fire again while
 * it stays there — and the columns `strict.show` names. A column the reader
 * could not be shown (personal, secret) is never repeated.
 */
export function strictEcho(table: ResolvedTable, states: TableStatesRule, stored: Row, state: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const readable = (column: string) => {
    const found = table.columns.get(column);
    return found !== undefined && !found.masked && !found.secret;
  };
  for (const column of table.table?.columns ?? []) {
    const stamp = column.stamp;
    if (stamp === undefined || !readable(column.name)) continue;
    const triggers = Array.isArray(stamp.on) ? stamp.on : [stamp.on];
    const intoState = triggers.some(
      (t) => typeof t === 'object' && 'values' in t && t.column === states.column && t.values.some((value) => sameValue(value, state)),
    );
    if (!intoState) continue;
    const set = stamp.set;
    const when = set === 'now' || set === 'today';
    const who = set === 'user-name' || set === 'user-id' || (typeof set === 'object' && ('byOrigin' in set || 'claim' in set));
    if (when && out['at'] === undefined) out['at'] = echoed(stored[column.name] ?? null);
    if (who && out['by'] === undefined) out['by'] = echoed(stored[column.name] ?? null);
  }
  if (typeof states.strict === 'object') {
    for (const column of states.strict.show) if (readable(column)) out[column] = echoed(stored[column] ?? null);
  }
  return out;
}

/** Whether an error is one of the refusals a state judge makes (a guest's scope may then hide it as "no such row"). */
export function isStateRefusal(error: unknown): boolean {
  return error instanceof AppError && ['STATE_UNCHANGED', 'STATE_TOO_LATE', 'WRITE_WINDOW_CLOSED', 'STATE_MOVE_REFUSED', 'RECORD_LOCKED'].includes(error.code);
}

/**
 * Whether a table's states or stamps read the venue's clock: a move waiting
 * for a time, a new row waiting for one, a late or a timed move, a stamp
 * worked out from minutes, a deadline or a moment. Such a write needs the
 * venue's zone, never UTC by default.
 */
export function statesReadClock(states: TableStatesRule | undefined, stamps: readonly Pick<ColumnStampRule, 'set'>[] | undefined): boolean {
  const moves = Object.values(states?.moves ?? {}).some((list) => list.some((move) => typeof move === 'object' && move.requires?.time !== undefined));
  const stamped = (stamps ?? []).some((stamp) => typeof stamp.set === 'object' && ('addMinutes' in stamp.set || 'deadline' in stamp.set || 'moment' in stamp.set));
  return moves || stamped || states?.create?.requires.time !== undefined || (states?.late?.length ?? 0) > 0 || (states?.timed?.length ?? 0) > 0;
}
