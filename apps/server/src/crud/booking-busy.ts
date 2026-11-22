// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BUSY TIMES ADMINIUM KEEPS — a connected calendar's, in a table of the
 * app's own database (`table.booking.busy[].engine`), so the booking guard
 * reads them inside its own transaction and under its own lock.
 *
 * Only Adminium writes the table: a person's create, change, delete or import
 * is refused by the write path (`isKeptBusyTable`), and the table is `private`,
 * so no role, rule, public entry or export reads it.
 *
 * ONE STEP PER ACCOUNT AND WINDOW. A pass over a calendar reads the whole
 * window and swaps it in here: the account's rows that touch the window go and
 * the new ones arrive in one transaction, so a guard never sees half a pass.
 * The swap holds the venue-day lock of every day a new row touches, the lock a
 * booking's write holds: either the booking commits first and the pass can see
 * it, or the pass commits first and the booking is refused. New rows are cut
 * to the window, which keeps the number of locks bounded; what a stored row
 * holds outside the window stays.
 */
import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';

import type { BookingBusySource, TableBookingRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ValidationFailedError } from '../errors.js';
import { bookingLockName } from './booking-guard.js';
import { slotInstant, type GuardTarget } from './capacity-guard.js';
import { withNamedLocks } from './capacity/locks.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import type { Row } from './mask.js';
import { venueClock } from './venue-time.js';
import { bindWriteValue } from './write-values.js';

const DAY_MS = 86_400_000;
/** The longest window one pass may swap, in days. */
export const BUSY_WINDOW_DAYS = 400;
/** The most busy times one pass may hold for one account. */
export const BUSY_ROWS_MAX = 5_000;
const INSERT_BATCH = 200;

/** The busy source a rule keeps itself, if any. */
export const keptBusySource = (rule: Pick<TableBookingRule, 'busy'>): BookingBusySource | undefined => rule.busy?.find((source) => source.engine !== undefined);

/** Whether a table is one only Adminium writes because a booking rule keeps its busy times there. */
export function isKeptBusyTable(view: Pick<SnapshotView, 'model'> | undefined, tableId: string): boolean {
  return (view?.model?.tables ?? []).some((table) => table.booking?.busy?.some((source) => source.engine !== undefined && source.table === tableId) === true);
}

export interface BusyInterval {
  resource: string | number;
  start: Date;
  end: Date;
}

export interface ReplaceBusyInput {
  account: string;
  /** The window this pass read: `[from, to)`. */
  from: Date;
  to: Date;
  rows: readonly BusyInterval[];
  /** Whatever ended by this moment goes too: it blocks nothing, and would be read on every pass. */
  forgetBefore?: Date;
}

/** Every venue day a time touches, its last moment excluded. */
function daysOf(start: number, end: number, zone: string): string[] {
  const first = venueClock(new Date(start), zone).day;
  const last = venueClock(new Date(end - 1), zone).day;
  const out: string[] = [];
  for (let at = Date.parse(`${first}T00:00:00Z`); ; at += DAY_MS) {
    const day = new Date(at).toISOString().slice(0, 10);
    out.push(day);
    if (day >= last) return out;
  }
}

/**
 * Swap in one account's busy times for a window, in one step. `busyTable` is
 * the rule's kept source, resolved; `target` is the booking table, whose locks
 * are the ones held.
 */
export async function replaceBusyRows(rule: TableBookingRule, target: GuardTarget, busyTable: ResolvedTable, input: ReplaceBusyInput): Promise<{ written: number }> {
  const source = keptBusySource(rule);
  if (source === undefined || source.table !== busyTable.id) throw new ValidationFailedError('This table keeps no busy times.', { table: busyTable.id });
  const from = input.from.getTime();
  const to = input.to.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > BUSY_WINDOW_DAYS * DAY_MS) {
    throw new ValidationFailedError('A pass covers a window of at most 400 days.', {});
  }
  if (input.rows.length > BUSY_ROWS_MAX) throw new ValidationFailedError('Too many busy times for one pass.', { max: BUSY_ROWS_MAX });

  const zone = target.timezone ?? 'UTC';
  const cut = input.rows.flatMap((row) => {
    const start = Math.max(row.start.getTime(), from);
    const end = Math.min(row.end.getTime(), to);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ resource: row.resource, start, end }] : [];
  });
  const days = new Set(cut.flatMap((row) => daysOf(row.start, row.end, zone)));
  const locks = [...days].map((day) => ({ name: bookingLockName(target, day), busy: 'BOOKING_BUSY' as const }));

  const column = (name: string) => {
    const found = busyTable.columns.get(name);
    if (found === undefined) throw new ValidationFailedError('The busy table has lost a column.', { column: name });
    return found;
  };
  const moment = (name: string, at: number) => bindWriteValue(column(name), new Date(at).toISOString(), target.dialect);
  const account = source.engine!.account;
  // A whole-number key numbers itself; a text or uuid key is the writer's to make.
  const keyName = busyTable.primaryKey.length === 1 ? busyTable.primaryKey[0]! : null;
  const keyType = keyName === null ? null : column(keyName).logicalType;
  const minted = keyName !== null && keyType !== 'integer' && keyType !== 'bigint';
  const rowOf = (row: { resource: unknown; start: number; end: number }) => ({
    ...(minted ? { [keyName]: randomUUID() } : {}),
    [source.resource]: row.resource,
    [source.start]: moment(source.start, row.start),
    [source.end]: moment(source.end, row.end),
    [account]: input.account,
  });

  await withNamedLocks(target, locks, async (db: Kysely<SourceDatabase>) => {
    // Read and judged here, not in SQL: SQLite compares a stored moment as text, and a seeded row may be spelled otherwise.
    const held = (await db.selectFrom(busyTable.id).selectAll().where((eb) => eb(db.dynamic.ref(account), '=', input.account)).execute()) as Row[];
    const forget = input.forgetBefore?.getTime();
    const gone = held.filter((row) => {
      const start = slotInstant(row[source.start])?.getTime();
      const end = slotInstant(row[source.end])?.getTime();
      return start === undefined || end === undefined || (start < to && end > from) || (forget !== undefined && end <= forget);
    });
    // What a stored row holds outside this window is not this pass's to say: those parts stay.
    const outside = gone.flatMap((row) => {
      const start = slotInstant(row[source.start])?.getTime();
      const end = slotInstant(row[source.end])?.getTime();
      if (start === undefined || end === undefined) return [];
      return [
        ...(start < from && (forget === undefined || Math.min(end, from) > forget) ? [{ resource: row[source.resource], start, end: Math.min(end, from) }] : []),
        ...(end > to ? [{ resource: row[source.resource], start: Math.max(start, to), end }] : []),
      ];
    });
    for (const row of gone) {
      let query = db.deleteFrom(busyTable.id);
      for (const key of busyTable.primaryKey) query = query.where((eb) => eb(db.dynamic.ref(key), '=', row[key] as never));
      await query.execute();
    }
    const fresh = [...outside, ...cut];
    for (let i = 0; i < fresh.length; i += INSERT_BATCH) {
      await db.insertInto(busyTable.id).values(fresh.slice(i, i + INSERT_BATCH).map(rowOf) as never).execute();
    }
  });
  return { written: cut.length };
}

/**
 * Every busy time of an account goes: a disconnect, a row that went away, or
 * times too old to trust. It takes no lock: it only ever frees time.
 */
export async function dropBusyRows(rule: TableBookingRule, target: Pick<GuardTarget, 'db'>, busyTable: ResolvedTable, account: string): Promise<{ removed: number }> {
  const source = keptBusySource(rule);
  if (source === undefined || source.table !== busyTable.id) return { removed: 0 };
  const { db } = target;
  const done = await db.deleteFrom(busyTable.id).where((eb) => eb(db.dynamic.ref(source.engine!.account), '=', account)).executeTakeFirst();
  return { removed: Number(done.numDeletedRows ?? 0) };
}
