// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BOOKING PEOPLE — a row takes a person (a clinician) for its own length, and
 * two counted rows of one person never overlap.
 *
 * `capacity-guard.ts` adds up a party per start time; this forbids overlap
 * per resource, inside that resource's weekly hours and outside its
 * closures. A write that places a row runs, inside one transaction:
 *
 *     lock the venue day → who does what → hours and breaks → closures
 *       → past, window, notice → overlap → write
 *
 * ONE LOCK PER WRITE, named by connection, table and the VENUE DAY the row
 * will hold — no resource in the name. Choosing "anyone" means trying one
 * person after another, and a lock per person would have to be taken in an
 * order that a manager reordering the list could break; one lock per day
 * needs no order and never nests. Two bookings the same day for different
 * people wait for each other for milliseconds, which at a practice's write
 * rate costs nothing.
 *
 * WHEN IT RUNS. On a create; on an update that moves the row (its start,
 * length, person or kind); and on one that makes it count again (a cancelled
 * visit re-booked) — then only the overlap matters. A move between two
 * counted statuses (booked → checked in → … → seen) runs nothing and takes no
 * lock: checking someone in at 09:05 for their 09:00 visit, or on a day a
 * closure was added since, must never be refused.
 *
 * EVERYTHING ON THE VENUE'S CLOCK. Weekly hours are wall times (`HH:MM`
 * text), so a start is read as the venue's wall time on its own day, and a
 * 09:00 opening stays 09:00 across a clock change.
 *
 * "ANYONE". A write with no person gets a free eligible one, active — and,
 * for a guest, bookable online: the first in the resources' own order (then by
 * key), or with `anyone`, the one with the fewest rows that day, then the one
 * whose last row was made longest ago, then that order. A booking moved with
 * its person emptied keeps them when they are free. The guard RETURNS its pick;
 * the write service writes it and reports it. The browser never learns who is
 * free until the booking is saved.
 *
 * WHAT A TIME HOLDS. `[start, start + minutes + buffer)`: a row's clean-up is
 * its own, so two rows' spans never touch, while the hours ask of `minutes`
 * alone. A busy time (`busy`: time off, a calendar) is read by overlap with the
 * day, since one may run for days, and blocks new times only: a booking that
 * keeps its start and person is held only to what it newly takes.
 */
import { sql, type Kysely } from 'kysely';

import type { BookingBusySource, TableBookingRule, TableOccupiesRule, BookingHoursTable } from '../connections/effective-schema.js';
import type { PlainBooking } from './column-rules.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError, ValidationFailedError } from '../errors.js';
import { minutesOf, numberOf, slotInstant, withNamedLock, type GuardTarget } from './capacity-guard.js';
import type { Row } from './mask.js';
import { venueClock, wallTimeToInstant } from './venue-time.js';

type Db = Kysely<SourceDatabase>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_MS = 86_400_000;

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);
const empty = (value: unknown) => value === null || value === undefined || value === '';
/** A stored bool, as each engine hands it back: false, 0 and '0' are off. */
export const off = (value: unknown) => value === false || value === 0 || value === '0' || value === 'false';
export const keyOf = (value: unknown) => (empty(value) ? '' : String(value));

/** Whether a row, as it will be, takes time. An absent status is the default's, unknown here: counting it never double-books. */
export function bookingCounts(rule: TableBookingRule | PlainRule, row: Row): boolean {
  const counted = isPlain(rule) ? rule.plain.countWhere : rule.countWhere;
  if (counted === undefined || !has(row, counted.column)) return true;
  return counted.values.includes(String(row[counted.column]));
}

/**
 * THE PLAIN RULE (`table.occupies`): a row takes a resource for a time, with
 * none of what booking people asks — no kind, nobody eligible, no grid, no
 * window. It is carried where a booking rule would be and run by the same
 * lock and the same steps; only the checks differ (`checkPlain`).
 */
export type PlainRule = PlainBooking;
export const isPlain = (rule: TableBookingRule | PlainRule): rule is PlainRule => 'plain' in rule;

/** The columns that place a row: where it sits and whose time it takes. */
const placing = (rule: TableBookingRule | PlainRule): string[] =>
  isPlain(rule) ? [rule.plain.start, rule.plain.minutes, rule.plain.end, rule.plain.day, rule.plain.until, rule.plain.resource].filter((column): column is string => column !== undefined) : [rule.start, rule.minutes, ...(rule.buffer === undefined ? [] : [rule.buffer]), rule.resource, rule.kind];

/** The column a refusal about the row's time is told against. */
export const bookingColumn = (rule: TableBookingRule | PlainRule): string => (isPlain(rule) ? (rule.plain.start ?? rule.plain.day ?? rule.plain.resource) : rule.start);

/** What a write asks of the guard: the placement checks, the overlap, or nothing. */
export interface BookingNeed {
  /** Where the row sits moved (or it is new): hours, closures, window, overlap. */
  placement: boolean;
}

/** Whether a column's new value differs from the stored one (a start compared as an instant). */
function moved(rule: TableBookingRule | PlainRule, column: string, values: Row, before: Row): boolean {
  if (!has(values, column)) return false;
  const instants = isPlain(rule) ? [rule.plain.start, rule.plain.end] : [rule.start];
  if (instants.includes(column)) return slotInstant(values[column])?.getTime() !== slotInstant(before[column])?.getTime();
  if (isPlain(rule) && (column === rule.plain.day || column === rule.plain.until)) return dateOf(values[column]) !== dateOf(before[column]);
  return keyOf(values[column]) !== keyOf(before[column]);
}

/**
 * What this write needs checked, or null when nothing: a row that will not
 * count holds no time, and a counted row that stays where it is and stays
 * counted (a status step) is not re-judged.
 */
export function bookingNeed(rule: TableBookingRule | PlainRule, values: Row, before: Row | null): BookingNeed | null {
  const row = before === null ? values : { ...before, ...values };
  if (!bookingCounts(rule, row)) return null;
  // A plain row with no resource, or no time yet, takes nothing: a visit waiting for its day.
  if (isPlain(rule) && (empty(row[rule.plain.resource]) || empty(row[rule.plain.start ?? rule.plain.day ?? '']))) return null;
  if (before === null) return { placement: true };
  const placement = placing(rule).some((column) => moved(rule, column, values, before));
  if (placement) return { placement: true };
  if (bookingCounts(rule, before)) return null;
  // Moved in from a state the rule places from (an offer taken): judged as a new booking.
  if (!isPlain(rule) && (rule.placedFrom ?? []).includes(String(before[rule.countWhere.column]))) return { placement: true };
  // Counted again (a cancelled visit re-booked): only the overlap is asked.
  return { placement: false };
}

/** Whether a write could need the guard at all, before the stored row is read. */
export function touchesBooking(rule: TableBookingRule | PlainRule, values: Row): boolean {
  const counted = isPlain(rule) ? rule.plain.countWhere?.column : rule.countWhere.column;
  return [...placing(rule), ...(counted === undefined ? [] : [counted])].some((column) => has(values, column));
}

/** The venue day a row will hold, or null when its start is not a time. */
export function bookingDay(rule: TableBookingRule | PlainRule, row: Row, zone: string): string | null {
  // A plain rule's rows may run past midnight, so its lock is the resource's, not a day's: every writer of that resource takes turns.
  if (isPlain(rule)) return empty(row[rule.plain.resource]) ? null : `of|${keyOf(row[rule.plain.resource])}`;
  const instant = slotInstant(row[rule.start]);
  return instant === null ? null : venueClock(instant, zone).day;
}

/** Run `write` holding the venue day, inside one transaction. */
export function withBookingLock<T>(
  target: GuardTarget,
  day: string,
  write: (db: Db) => Promise<T>,
): Promise<T> {
  return withNamedLock(target, bookingLockName(target, day), 'BOOKING_BUSY', write);
}

/** The name of a table's lock for one day's bookings: one writer at a time places a row on that day. */
export function bookingLockName(target: { connectionId: string; table: { id: string } }, day: string): string {
  return `${target.connectionId}|${target.table.id}|booking|${day}`;
}

/* ----------------------------------------------------------------- refusals */

type Refusal = 'BOOKING_NOT_OFFERED' | 'BOOKING_OUT_OF_HOURS' | 'BOOKING_CLOSED' | 'BOOKING_OUT_OF_RANGE' | 'BOOKING_TAKEN';

/** How far a refusal is from a yes: when "anyone" finds nobody, the answer is the nearest. */
const NEARNESS: Record<Refusal, number> = {
  BOOKING_TAKEN: 4,
  BOOKING_CLOSED: 3,
  BOOKING_OUT_OF_HOURS: 2,
  BOOKING_OUT_OF_RANGE: 1,
  BOOKING_NOT_OFFERED: 0,
};

const FIELD_CODES: Record<Refusal, string> = {
  BOOKING_NOT_OFFERED: 'not-offered',
  BOOKING_OUT_OF_HOURS: 'out-of-hours',
  BOOKING_CLOSED: 'closed',
  BOOKING_OUT_OF_RANGE: 'out-of-range',
  BOOKING_TAKEN: 'taken',
};

/**
 * The error a refusal is thrown as: a 409 for what another row or day holds, a 422 for a time never offered.
 * `days`: the row is a span of whole days, and the sentence says so. Nothing of the row in the way is told —
 * not its key, not its days: the caller may not be able to read it. `by`, for
 * staff only: whether a booking, its buffer or a busy time is in the way.
 */
export function bookingRefusal(reason: Refusal, column: string, days = false, by?: TakenBy): Error {
  if (reason === 'BOOKING_TAKEN') return new ConflictError(days ? 'Those days overlap another entry.' : 'That time has just gone.', 'BOOKING_TAKEN', { column, ...by });
  if (reason === 'BOOKING_CLOSED') return new ConflictError('That day is closed.', 'BOOKING_CLOSED', { column });
  const message =
    reason === 'BOOKING_NOT_OFFERED'
      ? 'That visit is not offered with that person.'
      : reason === 'BOOKING_OUT_OF_HOURS'
        ? 'That time is outside the hours.'
        : 'That time cannot be booked.';
  return new ValidationFailedError(message, { reason, fields: { [column]: { code: FIELD_CODES[reason] } } });
}

/* ------------------------------------------------------------- the day read */

export interface Hours {
  opens: number;
  closes: number;
  breaks: { start: number; end: number }[];
}

/** One hours row as minutes, or null for a closed day (no row, switched off, or closing before it opens). */
export function hoursOf(spec: BookingHoursTable & { open?: string }, row: Row | undefined): Hours | null {
  if (row === undefined) return null;
  if (spec.open !== undefined && off(row[spec.open])) return null;
  const opens = minutesOf(row[spec.opens]);
  const closes = minutesOf(row[spec.closes]);
  // A booking never crosses midnight: hours that do are refused as closed.
  if (opens === null || closes === null || closes <= opens) return null;
  const breakStart = spec.breakStart === undefined ? null : minutesOf(row[spec.breakStart]);
  const breakEnd = spec.breakEnd === undefined ? null : minutesOf(row[spec.breakEnd]);
  return { opens, closes, breaks: breakStart !== null && breakEnd !== null && breakEnd > breakStart ? [{ start: breakStart, end: breakEnd }] : [] };
}

/** A person's hours inside the practice's: the later opening, the earlier closing, both breaks; a day either is shut is shut. */
export function cappedBy(own: Hours | null, practice: Hours | null): Hours | null {
  if (own === null || practice === null) return null;
  const opens = Math.max(own.opens, practice.opens);
  const closes = Math.min(own.closes, practice.closes);
  return closes <= opens ? null : { opens, closes, breaks: [...own.breaks, ...practice.breaks] };
}

/** The counted rows of one day, per resource, as `[start, end)` in epoch ms; `held` is the end with its buffer. */
interface Booked {
  resource: string;
  start: number;
  end: number;
  held: number;
  pk: string;
}

/** A time a person is away, as `[start, end)` in epoch ms; `source` is its place in the rule's `busy`. */
interface Busy {
  resource: string;
  start: number;
  end: number;
  source: number;
}

/** Why a time is taken: told to staff, never to a guest. */
export interface TakenBy {
  reason: 'booking' | 'buffer' | 'busy';
  source?: number;
}

const pkOf = (keys: readonly string[], row: Row) => keys.map((key) => keyOf(row[key])).join('|');

/**
 * Everything one venue day's checks read, loaded once per write under the
 * lock: the hours tables, the closures, the day's counted rows, who does the
 * kind, and the settings numbers.
 */
export interface BookingDayContext {
  day: string;
  weekday: (typeof WEEKDAYS)[number];
  zone: string;
  practice: Hours | null;
  /** A resource's own hours for the day; absent key = it follows the practice; null = its own say it is off. */
  own: Map<string, Hours | null>;
  /** Active closures that cover the day: '' for the whole practice, or a resource. */
  closed: Set<string>;
  booked: Booked[];
  /** The busy times that touch the day. */
  busy: Busy[];
  /** The moment the day ends: a buffer is cut there. */
  dayEnd: number;
  /** Resources that do the kind, in booking order, with their switches. */
  eligible: { resource: string; active: boolean; bookableOnline: boolean }[];
  grid: number;
  windowDays: number | null;
  noticeMinutes: number | null;
  /** Today on the venue's clock, and how many working days lie from today to `day` (inclusive). */
  today: string;
  workingDaysTo: number;
}

/** The weekday of a `YYYY-MM-DD` day. */
export const weekdayOf = (day: string) => WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
export const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Every closure row that covers any day in `[from, to]`, active ones only. */
export async function closureRows(rule: TableBookingRule, db: Db, from: string, to: string): Promise<Row[]> {
  const spec = rule.closures;
  if (spec === undefined) return [];
  const rows = (await db
    .selectFrom(spec.table)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(spec.from), '<=', to))
    .where((eb) => eb(db.dynamic.ref(spec.to), '>=', from))
    .execute()) as Row[];
  return rows.filter((row) => spec.active === undefined || !off(row[spec.active]));
}

/**
 * A date column's value as `YYYY-MM-DD`, however the driver hands it back.
 * Postgres and MySQL drivers build a date-only value as a Date at LOCAL
 * midnight, so it is read by its local parts: its UTC day is the day before
 * anywhere east of Greenwich.
 */
export function dateOf(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
}

/**
 * What a run of days shares, read once whatever its length: who does the kind
 * and in what order, the practice's week, each person's own week, the settings,
 * and the closures and counted rows of the whole run. A strip of days is then
 * a handful of statements, not a day's reads again for every day.
 */
interface BookingRange {
  zone: string;
  today: string;
  eligible: BookingDayContext['eligible'];
  practiceFor: (weekday: string) => Hours | null;
  /** A resource's own hours rows; no entry = it follows the practice. */
  ownRows: Map<string, Row[]>;
  closures: { who: string; start: string; end: string }[];
  /** The counted rows of each venue day of the run. */
  booked: Map<string, Booked[]>;
  /** The busy times that touch the run. */
  busy: Busy[];
  grid: number;
  windowDays: number | null;
  noticeMinutes: number | null;
  /** Working days from today to a day, both counted: a day with hours the practice has not closed. */
  workingDaysTo: (day: string) => number;
}

/**
 * Read the days `[from, to]` for `kind`. Shared with availability, so a time
 * offered is a time the guard would take.
 */
async function loadBookingRange(rule: TableBookingRule, target: GuardTarget, from: string, to: string, kind: unknown, now: Date, also?: unknown): Promise<BookingRange> {
  const { db } = target;
  const zone = target.timezone ?? 'UTC';

  // Who does this kind, in the resources' order.
  const eligibleRows = empty(kind)
    ? []
    : ((await db
        .selectFrom(rule.eligible.table)
        .select(sql<unknown>`${sql.ref(rule.eligible.resource)}`.as('resource'))
        .where((eb) => eb(db.dynamic.ref(rule.eligible.kind), '=', kind))
        .execute()) as { resource: unknown }[]);
  const eligibleKeys = [...new Set(eligibleRows.map((row) => keyOf(row.resource)).filter((key) => key !== ''))];
  let eligible = eligibleKeys.map((resource) => ({ resource, active: true, bookableOnline: true, position: 0 }));
  const order = rule.eligible.order;
  if (order !== undefined && eligibleKeys.length > 0) {
    // The order table is the one the resource column points at, keyed by what it points at.
    const idColumn = target.table.table?.columns.find((c) => c.name === rule.resource)?.references?.column ?? 'id';
    const rows = (await db
      .selectFrom(order.table)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(idColumn), 'in', eligibleRows.map((row) => row.resource) as never[]))
      .execute()) as Row[];
    const byKey = new Map(rows.map((row) => [keyOf(row[idColumn]), row]));
    eligible = eligibleKeys
      .filter((key) => byKey.has(key))
      .map((key) => {
        const row = byKey.get(key)!;
        return {
          resource: key,
          active: order.active === undefined || !off(row[order.active]),
          bookableOnline: order.public === undefined || !off(row[order.public]),
          position: Number(row[order.column] ?? 0),
        };
      });
  }
  eligible.sort((a, b) => a.position - b.position || compareKeys(a.resource, b.resource));

  // The practice's week: each day's hours, and what the window counts as a working day.
  const practiceSpec = rule.hours.practice;
  const week = (await db.selectFrom(practiceSpec.table).selectAll().execute()) as Row[];
  const practiceFor = (wd: string) => hoursOf(practiceSpec, week.find((row) => String(row[practiceSpec.weekday]) === wd));

  // Resources with hours of their own follow them, every day.
  const ownRows = new Map<string, Row[]>();
  const ownSpec = rule.hours.own;
  if (ownSpec !== undefined && eligibleKeys.length > 0) {
    const rows = (await db
      .selectFrom(ownSpec.table)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(ownSpec.resource), 'in', eligibleRows.map((row) => row.resource) as never[]))
      .execute()) as Row[];
    for (const key of eligibleKeys) {
      const mine = rows.filter((row) => keyOf(row[ownSpec.resource]) === key);
      if (mine.length > 0) ownRows.set(key, mine);
    }
  }

  const today = venueClock(now, zone).day;
  const first = today < from ? today : from;
  // One day past the run: whether the window ends on its last day depends on the day after.
  const after = addDays(to, 1);
  const last = after > today ? after : today;
  const spec = rule.closures;
  const closures = (await closureRows(rule, db, first, last)).map((row) => ({
    who: spec?.resource === undefined ? '' : keyOf(row[spec.resource]),
    start: dateOf(row[spec!.from]),
    end: dateOf(row[spec!.to]),
  }));
  const practiceClosed = new Set<string>();
  for (const closure of closures) {
    if (closure.who !== '') continue;
    for (let d = closure.start < first ? first : closure.start; d <= closure.end && d <= last; d = addDays(d, 1)) practiceClosed.add(d);
  }

  // Counted once, from today up: a far day stops at the cap the window could ever ask about.
  const counted = new Map<string, number>();
  let working = 0;
  for (let d = today; d <= after && working <= 400; d = addDays(d, 1)) {
    if (practiceFor(weekdayOf(d)) !== null && !practiceClosed.has(d)) working += 1;
    counted.set(d, working);
  }

  return {
    zone,
    today,
    eligible,
    practiceFor,
    ownRows,
    closures,
    booked: await bookedIn(rule, target, from, to, zone),
    busy: await busyIn(rule, target, from, to, [...eligibleRows.map((row) => row.resource), ...(empty(also) ? [] : [also])]),
    grid: Math.max(1, (await numberOf(db, rule.grid)) ?? 15),
    windowDays: await numberOf(db, rule.windowDays),
    noticeMinutes: await numberOf(db, rule.noticeMinutes),
    workingDaysTo: (day) => (day < today ? 0 : (counted.get(day) ?? working)),
  };
}

/** How far a calendar is read when the rule names no window, or holds only guests to it. */
const SYNC_READ_DAYS = 92;

/**
 * The last day anyone can book, on the venue's calendar: what a connected
 * calendar's read has to cover. With no window, or one that binds guests alone
 * (staff may book past it), at least {@link SYNC_READ_DAYS} days.
 */
export async function lastBookableDay(rule: TableBookingRule, target: GuardTarget, now: Date): Promise<string> {
  const { db } = target;
  const zone = target.timezone ?? 'UTC';
  const today = venueClock(now, zone).day;
  const floor = addDays(today, SYNC_READ_DAYS);
  const windowDays = await numberOf(db, rule.windowDays);
  if (windowDays === null) return floor;
  const spec = rule.hours.practice;
  const week = (await db.selectFrom(spec.table).selectAll().execute()) as Row[];
  const far = addDays(today, 400);
  const closed = new Set<string>();
  for (const row of await closureRows(rule, db, today, far)) {
    if (rule.closures?.resource !== undefined && keyOf(row[rule.closures.resource]) !== '') continue;
    const end = dateOf(row[rule.closures!.to]);
    for (let d = dateOf(row[rule.closures!.from]); d <= end && d <= far; d = addDays(d, 1)) closed.add(d);
  }
  let last = far;
  let working = 0;
  for (let d = today; d <= far; d = addDays(d, 1)) {
    if (hoursOf(spec, week.find((row) => String(row[spec.weekday]) === weekdayOf(d))) === null || closed.has(d)) continue;
    working += 1;
    if (working >= windowDays) {
      last = d;
      break;
    }
  }
  return rule.windowFor === 'guests' && last < floor ? floor : last;
}

/** One day of a range, as the checks read it. */
function dayOfRange(rule: TableBookingRule, range: BookingRange, day: string): BookingDayContext {
  const weekday = weekdayOf(day);
  const own = new Map<string, Hours | null>();
  const ownSpec = rule.hours.own;
  if (ownSpec !== undefined) {
    const practice = range.practiceFor(weekday);
    for (const [key, mine] of range.ownRows) {
      const hours = hoursOf(ownSpec, mine.find((row) => String(row[ownSpec.weekday]) === weekday));
      own.set(key, ownSpec.within === 'practice' ? cappedBy(hours, practice) : hours);
    }
  }
  const closed = new Set<string>();
  for (const closure of range.closures) if (closure.start <= day && day <= closure.end) closed.add(closure.who);
  const dayStart = wallTimeToInstant(`${day} 00:00`, range.zone)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const dayEnd = wallTimeToInstant(`${addDays(day, 1)} 00:00`, range.zone)?.getTime() ?? Number.POSITIVE_INFINITY;
  return {
    day,
    weekday,
    zone: range.zone,
    practice: range.practiceFor(weekday),
    own,
    closed,
    booked: range.booked.get(day) ?? [],
    busy: range.busy.filter((one) => one.start < dayEnd && one.end > dayStart),
    dayEnd,
    eligible: range.eligible,
    grid: range.grid,
    windowDays: range.windowDays,
    noticeMinutes: range.noticeMinutes,
    today: range.today,
    workingDaysTo: range.workingDaysTo(day),
  };
}

/**
 * Read one venue day for `kind`: the guard's own read, under the day's lock.
 * `also`: a person whose busy times are read though they no longer offer the
 * kind (a cancelled visit of theirs taken up again is judged for overlap only).
 */
export async function loadBookingDay(rule: TableBookingRule, target: GuardTarget, day: string, kind: unknown, now: Date, also?: unknown): Promise<BookingDayContext> {
  return dayOfRange(rule, await loadBookingRange(rule, target, day, day, kind, now, also), day);
}

/** Keys that are numbers sort as numbers. */
export function compareKeys(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The counted rows of a run of days, per venue day. Read over the days either
 * side and kept only when the start falls on a day of the run: a start written
 * by a till (this server's wall clock) and one written by a guest (an ISO
 * instant) compare as text on SQLite, so the SQL bound is wide and the day is
 * decided here.
 */
async function bookedIn(rule: TableBookingRule, target: GuardTarget, from: string, to: string, zone: string): Promise<Map<string, Booked[]>> {
  const { db } = target;
  const keys = target.table.primaryKey;
  const rows = (await db
    .selectFrom(target.table.id)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(rule.start), '>=', addDays(from, -1)))
    .where((eb) => eb(db.dynamic.ref(rule.start), '<', addDays(to, 2)))
    .where((eb) => eb(db.dynamic.ref(rule.countWhere.column), 'in', rule.countWhere.values))
    .execute()) as Row[];
  const out = new Map<string, Booked[]>();
  for (const row of rows) {
    const start = slotInstant(row[rule.start]);
    if (start === null) continue;
    const day = venueClock(start, zone).day;
    if (day < from || day > to) continue;
    const minutes = Number(row[rule.minutes] ?? 0);
    const end = start.getTime() + Math.max(0, minutes) * 60_000;
    const list = out.get(day) ?? [];
    list.push({ resource: keyOf(row[rule.resource]), start: start.getTime(), end, held: end + bufferOf(rule, row) * 60_000, pk: pkOf(keys, row) });
    out.set(day, list);
  }
  return out;
}

/** A row's buffer in minutes: none without the word, or for a value that is no length. */
function bufferOf(rule: TableBookingRule, row: Row): number {
  if (rule.buffer === undefined) return 0;
  const minutes = Number(row[rule.buffer] ?? 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/**
 * The busy times of these people that touch a run of days. By overlap, not by
 * start: a conference or a week away starts on another day. The SQL bounds are
 * as wide as `bookedIn`'s, for the same reason, and the moments are read here.
 */
export async function busyIn(rule: TableBookingRule, target: GuardTarget, from: string, to: string, resources: readonly unknown[], only?: (source: BookingBusySource) => boolean): Promise<Busy[]> {
  const sources = rule.busy ?? [];
  if (sources.length === 0 || resources.length === 0) return [];
  const { db } = target;
  const out: Busy[] = [];
  for (const [index, source] of sources.entries()) {
    if (only !== undefined && !only(source)) continue;
    let query = db
      .selectFrom(source.table)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(source.resource), 'in', resources as never[]))
      .where((eb) => eb(db.dynamic.ref(source.start), '<', addDays(to, 2)))
      .where((eb) => eb(db.dynamic.ref(source.end), '>=', addDays(from, -1)));
    const counted = source.countWhere;
    if (counted !== undefined) query = query.where((eb) => eb(db.dynamic.ref(counted.column), 'in', counted.values));
    for (const row of (await query.execute()) as Row[]) {
      const start = slotInstant(row[source.start])?.getTime();
      const end = slotInstant(row[source.end])?.getTime();
      if (start === undefined || end === undefined || end <= start) continue;
      out.push({ resource: keyOf(row[source.resource]), start, end, source: index });
    }
  }
  return out;
}

/** What a kind asks of "anyone": `order` unless the rule, or the kind's own row, says `even`. */
async function pickOf(rule: TableBookingRule, target: GuardTarget, kind: unknown): Promise<'order' | 'even'> {
  const word = rule.anyone?.pick;
  if (word === undefined || word === 'order') return 'order';
  if (word === 'even') return 'even';
  const link = target.table.table?.columns.find((c) => c.name === rule.kind)?.references;
  if (link === undefined || link === null || empty(kind)) return 'order';
  const row = (await target.db
    .selectFrom(link.tableId)
    .select(sql<unknown>`${sql.ref(word.column)}`.as('pick'))
    .where((eb) => eb(target.db.dynamic.ref(link.column), '=', kind))
    .executeTakeFirst()) as { pick?: unknown } | undefined;
  return row?.pick === 'even' ? 'even' : 'order';
}

/**
 * When each person's last counted row was made, the row being moved left out.
 * Asked only to break a tie. SQLite compares a stored moment as text, and a
 * key of several columns cannot be left out in one comparison: those read the
 * rows and decide here.
 */
async function lastMade(rule: TableBookingRule, target: GuardTarget, resources: readonly string[], ownPk: string | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const made = rule.anyone?.made;
  if (made === undefined || resources.length === 0) return out;
  const { db } = target;
  const keys = target.table.primaryKey;
  const later = (resource: string, value: unknown) => {
    const at = slotInstant(value)?.getTime();
    if (at !== undefined && at > (out.get(resource) ?? Number.NEGATIVE_INFINITY)) out.set(resource, at);
  };
  const base = db
    .selectFrom(target.table.id)
    .where((eb) => eb(db.dynamic.ref(rule.resource), 'in', resources.map(pickValue) as never[]))
    .where((eb) => eb(db.dynamic.ref(rule.countWhere.column), 'in', rule.countWhere.values));
  if (target.dialect === 'sqlite' || keys.length !== 1) {
    for (const row of (await base.selectAll().execute()) as Row[]) {
      if (pkOf(keys, row) !== ownPk) later(keyOf(row[rule.resource]), row[made]);
    }
    return out;
  }
  const others = ownPk === null ? base : base.where((eb) => eb(db.dynamic.ref(keys[0]!), '<>', ownPk));
  const rows = (await others
    .select([sql<unknown>`${sql.ref(rule.resource)}`.as('resource'), sql<unknown>`max(${sql.ref(made)})`.as('made')])
    .groupBy(sql.ref(rule.resource) as never)
    .execute()) as { resource: unknown; made: unknown }[];
  for (const row of rows) later(keyOf(row.resource), row.made);
  return out;
}

/** Of these free people, in order, those with the fewest counted rows that day, the row being moved left out. */
function fewestThatDay(ctx: BookingDayContext, free: readonly string[], ownPk: string | null): string[] {
  const count = (resource: string) => ctx.booked.filter((one) => one.resource === resource && one.pk !== ownPk).length;
  const least = Math.min(...free.map(count));
  return free.filter((resource) => count(resource) === least);
}

/** Of people level on the day, the one whose last row was made longest ago; someone with none first; then the order. */
function longestAgo(tied: readonly string[], made: ReadonlyMap<string, number>): string {
  let best = tied[0]!;
  for (const resource of tied) {
    if ((made.get(resource) ?? Number.NEGATIVE_INFINITY) < (made.get(best) ?? Number.NEGATIVE_INFINITY)) best = resource;
  }
  return best;
}

/* --------------------------------------------------------------- the checks */

export interface BookingCheck {
  /** The row as it will be. */
  row: Row;
  /** The stored row on an update: its own time is not an overlap with itself. */
  before: Row | null;
  need: BookingNeed;
  /** A guest: held to the notice, offered only people bookable online. */
  isPublic: boolean;
  now: Date;
}

/** What `judge` compares: the row's own key, so it never overlaps itself. */
interface Judged extends BookingCheck {
  ownPk: string | null;
  /**
   * A counted row keeping its start: the person it holds and the moment it
   * already holds them to. Busy times that arrived since are not held against
   * that time (a clash the desk chose to keep), only against what it adds.
   */
  kept: { resource: string; until: number } | null;
}

/** What holds a person at this time, or null: their other rows first, then the times they are away. */
function clashOf(ctx: BookingDayContext, resource: string, input: Judged, start: number, minutes: number, buffer: number): TakenBy | null {
  const end = start + minutes * 60_000;
  const held = end + buffer * 60_000;
  let buffered = false;
  for (const other of ctx.booked) {
    if (other.resource !== resource || other.pk === input.ownPk) continue;
    if (other.start < held && other.held > start) {
      if (other.start < end && other.end > start) return { reason: 'booking' };
      buffered = true;
    }
  }
  if (buffered) return { reason: 'buffer' };
  const edge = Math.min(held, ctx.dayEnd);
  const from = input.kept?.resource === resource ? Math.max(start, input.kept.until) : start;
  if (from >= edge) return null;
  for (const away of ctx.busy) {
    if (away.resource === resource && away.start < edge && away.end > from) return { reason: 'busy', source: away.source };
  }
  return null;
}

/**
 * Whether one resource can take the row, or the refusal. `placement` false
 * asks only the overlap.
 */
function judge(rule: TableBookingRule, ctx: BookingDayContext, resource: string, input: Judged, start: Date, minutes: number, buffer: number): Refusal | null {
  if (input.need.placement) {
    const offered = ctx.eligible.find((e) => e.resource === resource);
    if (offered === undefined || !offered.active || (input.isPublic && !offered.bookableOnline)) return 'BOOKING_NOT_OFFERED';
    const hours = ctx.own.has(resource) ? ctx.own.get(resource)! : ctx.practice;
    const clock = venueClock(start, ctx.zone);
    const minute = clock.minute;
    if (
      hours === null ||
      clock.second !== 0 ||
      start.getUTCMilliseconds() !== 0 ||
      minute < hours.opens ||
      minute + minutes > hours.closes ||
      (minute - hours.opens) % ctx.grid !== 0 ||
      hours.breaks.some((one) => minute < one.end && minute + minutes > one.start)
    ) {
      return 'BOOKING_OUT_OF_HOURS';
    }
    if (ctx.closed.has('') || ctx.closed.has(resource)) return 'BOOKING_CLOSED';
  }
  return clashOf(ctx, resource, input, start.getTime(), minutes, buffer) === null ? null : 'BOOKING_TAKEN';
}

/** Whether the booking window holds this asker. */
const windowHolds = (rule: TableBookingRule, ctx: Pick<BookingDayContext, 'windowDays'>, isPublic: boolean) => ctx.windowDays !== null && (isPublic || rule.windowFor !== 'guests');

/**
 * The day-wide checks, the same whoever is booked: not in the past (bar a
 * walk-in's current slot), inside the window of working days, and — for a
 * guest — far enough ahead.
 */
function judgeDay(rule: TableBookingRule, ctx: BookingDayContext, input: BookingCheck, start: Date): Refusal | null {
  if (!input.need.placement) return null;
  const now = input.now.getTime();
  if (start.getTime() < now) {
    // A walk-in: the desk writing someone already in the building books the
    // grid slot that holds now — "Now · 09:35" is the 09:30 slot.
    const walkIn =
      !input.isPublic &&
      input.before === null &&
      rule.countWhere.values.indexOf(String(input.row[rule.countWhere.column])) > 0 &&
      now < start.getTime() + ctx.grid * 60_000;
    if (!walkIn) return 'BOOKING_OUT_OF_RANGE';
  }
  if (windowHolds(rule, ctx, input.isPublic) && ctx.workingDaysTo > ctx.windowDays!) return 'BOOKING_OUT_OF_RANGE';
  if (input.isPublic && ctx.noticeMinutes !== null && start.getTime() - now < ctx.noticeMinutes * 60_000) {
    return 'BOOKING_OUT_OF_RANGE';
  }
  return null;
}

/**
 * Refuse the row unless it can be booked, and return what the write must add
 * to it: the person "anyone" was given. Run under the day's lock, inside the
 * write's transaction.
 */
export async function checkBooking(
  rule: TableBookingRule | PlainRule,
  target: GuardTarget,
  input: Omit<BookingCheck, 'isPublic'>,
): Promise<Row> {
  if (isPlain(rule)) {
    await checkPlain(rule.plain, target, input);
    return {};
  }
  const zone = target.timezone ?? 'UTC';
  const start = slotInstant(input.row[rule.start]);
  if (start === null) throw bookingRefusal('BOOKING_OUT_OF_RANGE', rule.start);
  const minutes = Number(input.row[rule.minutes]);
  if (!Number.isInteger(minutes) || minutes <= 0) throw bookingRefusal('BOOKING_OUT_OF_HOURS', rule.minutes);
  const buffer = bufferOf(rule, input.row);
  const before = input.before;
  const keeps = before !== null && bookingCounts(rule, before) && slotInstant(before[rule.start])?.getTime() === start.getTime();
  const check: Judged = {
    ...input,
    isPublic: target.origin === 'public',
    ownPk: before === null ? null : pkOf(target.table.primaryKey, before),
    kept: keeps ? { resource: keyOf(before[rule.resource]), until: start.getTime() + (Math.max(0, Number(before[rule.minutes] ?? 0)) + bufferOf(rule, before)) * 60_000 } : null,
  };
  const ctx = await loadBookingDay(rule, target, venueClock(start, zone).day, input.row[rule.kind], input.now, input.row[rule.resource]);

  const dayIssue = judgeDay(rule, ctx, check, start);
  if (dayIssue !== null) throw bookingRefusal(dayIssue, rule.start);

  const asked = keyOf(input.row[rule.resource]);
  if (asked !== '') {
    const issue = judge(rule, ctx, asked, check, start, minutes, buffer);
    if (issue !== null) {
      // Staff are told what is in the way; a guest hears only that the time has gone.
      const by = issue === 'BOOKING_TAKEN' && !check.isPublic ? clashOf(ctx, asked, check, start.getTime(), minutes, buffer) : null;
      throw bookingRefusal(issue, issue === 'BOOKING_NOT_OFFERED' ? rule.resource : rule.start, false, by ?? undefined);
    }
    // A person named: no longer one Adminium picked.
    const flag = rule.anyone?.flag;
    return flag !== undefined && (before === null || keyOf(before[rule.resource]) !== asked) ? { [flag]: flagValue(target, flag, false) } : {};
  }

  // "Anyone": everyone eligible the time suits, then one of them.
  let nearest: Refusal = 'BOOKING_NOT_OFFERED';
  const free: string[] = [];
  for (const candidate of ctx.eligible) {
    if (!candidate.active || (check.isPublic && !candidate.bookableOnline)) continue;
    const issue = judge(rule, ctx, candidate.resource, { ...check, need: { placement: true } }, start, minutes, buffer);
    if (issue === null) free.push(candidate.resource);
    else if (NEARNESS[issue] > NEARNESS[nearest]) nearest = issue;
  }
  if (free.length === 0) throw bookingRefusal(nearest, nearest === 'BOOKING_NOT_OFFERED' ? rule.resource : rule.start);
  const chosen = await chooseAnyone(rule, target, ctx, free, before === null ? '' : keyOf(before[rule.resource]), input.row[rule.kind], check.ownPk);
  const flag = rule.anyone?.flag;
  return { [rule.resource]: pickValue(chosen), ...(flag === undefined ? {} : { [flag]: flagValue(target, flag, true) }) };
}

/** Which of the free people "anyone" gets: the person a moved booking already has, when free; else by the kind's pick. */
async function chooseAnyone(rule: TableBookingRule, target: GuardTarget, ctx: BookingDayContext, free: readonly string[], current: string, kind: unknown, ownPk: string | null): Promise<string> {
  if (rule.anyone !== undefined && current !== '' && free.includes(current)) return current;
  if (free.length === 1 || (await pickOf(rule, target, kind)) === 'order') return free[0]!;
  const tied = fewestThatDay(ctx, free, ownPk);
  return tied.length === 1 ? tied[0]! : longestAgo(tied, await lastMade(rule, target, tied, ownPk));
}

/** A flag's value as its column stores it. */
function flagValue(target: GuardTarget, column: string, on: boolean): boolean | number {
  const type = target.table.columns.get(column)?.logicalType;
  const numeric = type === 'integer' || type === 'bigint' || type === 'decimal' || type === 'float';
  return numeric ? (on ? 1 : 0) : on;
}

/** A picked key, as a number when it is one (an int foreign key). */
function pickValue(key: string): string | number {
  return /^-?\d+$/.test(key) && Number.isSafeInteger(Number(key)) ? Number(key) : key;
}


/* ---------------------------------------------------------- the plain rule */

/** The longest a plain row may last, in days; its neighbours are read that far either side, and a day more for the clocks. */
const PLAIN_LONGEST_DAYS = 30;
const PLAIN_REACH_DAYS = PLAIN_LONGEST_DAYS + 1;

/**
 * The plain rule's two questions, under the day's lock and inside the
 * write's transaction: the resource works that weekday (and, for a timed
 * row, at that time), and no other counted row of it overlaps — unless the
 * rule says rows share the time. Neighbours are read a little wide and
 * compared here, as a booking's are: text times do not sort on every engine.
 */
async function checkPlain(rule: TableOccupiesRule, target: GuardTarget, input: Omit<BookingCheck, 'isPublic'>): Promise<void> {
  const { db } = target;
  const zone = target.timezone ?? 'UTC';
  const row = input.row;
  const resource = row[rule.resource];
  if (empty(resource)) return;
  const column = rule.start ?? rule.day ?? rule.resource;
  let day: string;
  let span: { start: number; end: number } | null = null;
  // A span of whole days: its last day, or null while it has no end.
  let last: string | null = null;
  if (rule.day !== undefined) {
    day = dateOf(row[rule.day]);
    if (!DAY.test(day)) throw bookingRefusal('BOOKING_OUT_OF_RANGE', column);
    if (rule.until !== undefined && !empty(row[rule.until])) {
      last = dateOf(row[rule.until]);
      // It ends on the day it starts, or later.
      if (!DAY.test(last) || last < day) throw bookingRefusal('BOOKING_OUT_OF_RANGE', rule.until);
    }
  } else {
    const start = slotInstant(row[rule.start as string]);
    if (start === null) throw bookingRefusal('BOOKING_OUT_OF_RANGE', column);
    const end = rule.end !== undefined ? (slotInstant(row[rule.end])?.getTime() ?? Number.NaN) : start.getTime() + Number(row[rule.minutes as string]) * 60_000;
    // It ends after it starts, and within the reach its neighbours are read over: a longer row could overlap one that is never read.
    if (!Number.isFinite(end) || end <= start.getTime() || end - start.getTime() > PLAIN_LONGEST_DAYS * DAY_MS) throw bookingRefusal('BOOKING_OUT_OF_RANGE', rule.end ?? (rule.minutes as string));
    span = { start: start.getTime(), end };
    day = venueClock(start, zone).day;
  }

  // The resource's own week: a weekday it has no row for is a day it does not work. Asked of every row that
  // starts to count, a re-booked one too: a visit left waiting on a Sunday is not booked there.
  const hours = rule.hours;
  if (hours !== undefined) {
    const rows = (await db
      .selectFrom(hours.table)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(hours.resource), '=', resource as never))
      .where((eb) => eb(db.dynamic.ref(hours.weekday), '=', weekdayOf(day)))
      .execute()) as Row[];
    if (rows.length === 0) {
      // A resource with no week written down at all keeps none, and is held to none: a crew made a minute ago can be booked.
      const any = await db.selectFrom(hours.table).select(db.dynamic.ref(hours.weekday)).where((eb) => eb(db.dynamic.ref(hours.resource), '=', resource as never)).limit(1).execute();
      if (any.length > 0) throw bookingRefusal('BOOKING_CLOSED', column);
    } else if (span !== null && hours.opens !== undefined && hours.closes !== undefined) {
      const clock = venueClock(new Date(span.start), zone);
      const minutes = (span.end - span.start) / 60_000;
      const fits = rows.some((one) => {
        const opens = minutesOf(one[hours.opens as string]);
        const closes = minutesOf(one[hours.closes as string]);
        return opens !== null && closes !== null && clock.minute >= opens && clock.minute + minutes <= closes;
      });
      if (!fits) throw bookingRefusal('BOOKING_OUT_OF_HOURS', column);
    }
  }
  if (rule.shared === true) return;

  // No other counted row of the resource in that time.
  const ownPk = input.before === null ? null : pkOf(target.table.primaryKey, input.before);
  const where = rule.day !== undefined ? rule.day : (rule.start as string);
  let query = db.selectFrom(target.table.id).selectAll().where((eb) => eb(db.dynamic.ref(rule.resource), '=', resource as never));
  const until = rule.until;
  if (until !== undefined) {
    // Every row of the resource that starts on or before this one's last day and has not ended before its first.
    if (last !== null) query = query.where((eb) => eb(db.dynamic.ref(where), '<=', last));
    query = query.where((eb) => eb.or([eb(db.dynamic.ref(until), 'is', null), eb(db.dynamic.ref(until), '>=', day)]));
  } else if (rule.day !== undefined) query = query.where((eb) => eb(db.dynamic.ref(where), '=', day));
  else query = query.where((eb) => eb(db.dynamic.ref(where), '>=', addDays(day, -PLAIN_REACH_DAYS))).where((eb) => eb(db.dynamic.ref(where), '<', addDays(day, PLAIN_REACH_DAYS + 1)));
  const counted = rule.countWhere;
  if (counted !== undefined) query = query.where((eb) => eb(db.dynamic.ref(counted.column), 'in', counted.values));
  for (const other of (await query.execute()) as Row[]) {
    if (pkOf(target.table.primaryKey, other) === ownPk) continue;
    if (until !== undefined) {
      // Compared again here, as the days the driver hands back: both ends are counted, and no end is open for good.
      const from = dateOf(other[rule.day as string]);
      const to = empty(other[until]) ? null : dateOf(other[until]);
      if ((last === null || from <= last) && (to === null || to >= day)) throw bookingRefusal('BOOKING_TAKEN', column, true);
      continue;
    }
    if (span === null) throw bookingRefusal('BOOKING_TAKEN', column);
    const theirs = slotInstant(other[rule.start as string]);
    if (theirs === null) continue;
    const ends = rule.end !== undefined ? (slotInstant(other[rule.end])?.getTime() ?? theirs.getTime()) : theirs.getTime() + Math.max(0, Number(other[rule.minutes as string] ?? 0)) * 60_000;
    if (theirs.getTime() < span.end && ends > span.start) throw bookingRefusal('BOOKING_TAKEN', column);
  }
}

/* ------------------------------------------------------------ availability */

/** One time of a day: free or full. Staff asking about "anyone" also learn who is free first. */
export interface BookingSlot {
  /** `HH:mm` on the venue's clock. */
  time: string;
  state: 'free' | 'full';
  resource?: string | number;
}

/** One day of a strip: how many times are free, and whether it is open, full or closed. */
export interface BookingDayState {
  date: string;
  open: number;
  state: 'open' | 'full' | 'closed';
  /** The last day the window reaches for this asker (itself closed, if the window ends on a weekend): "later" stops here. */
  lastBookable?: true;
}

export interface BookingAvailabilityInput {
  /** The kind (visit type) asked about. */
  kind: unknown;
  /** One person's key, or `any`. */
  resource: string;
  /** A guest: held to the notice, offered only people bookable online, never told who. */
  isPublic: boolean;
  /** A row whose own time is not counted against itself (the asker's visit, being moved). */
  excludePk: string | null;
  now: Date;
}

const clockOf = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/**
 * How long the kind lasts: what the booking table's length column copies from
 * the kind's row, or null when there is no such rule to read.
 */
export async function kindMinutes(rule: TableBookingRule, target: GuardTarget, kind: unknown): Promise<number | null> {
  const minutes = await copiedFromKind(rule, target, rule.minutes, kind);
  return minutes !== null && Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

/** The kind's buffer, read through the row's copy rule as its length is: none without the word. */
async function kindBuffer(rule: TableBookingRule, target: GuardTarget, kind: unknown): Promise<number> {
  if (rule.buffer === undefined) return 0;
  const minutes = await copiedFromKind(rule, target, rule.buffer, kind);
  return minutes !== null && Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/** What a column of the row copies from the kind's row, as a number; null when it has no such rule. */
async function copiedFromKind(rule: TableBookingRule, target: GuardTarget, column: string, kind: unknown): Promise<number | null> {
  const columns = target.table.table?.columns ?? [];
  const copy = columns.find((c) => c.name === column)?.copy;
  const link = columns.find((c) => c.name === rule.kind)?.references;
  if (copy === undefined || copy.via !== rule.kind || link === undefined || link === null || empty(kind)) return null;
  const row = (await target.db
    .selectFrom(link.tableId)
    .select(sql<unknown>`${sql.ref(copy.from)}`.as('value'))
    .where((eb) => eb(target.db.dynamic.ref(link.column), '=', kind))
    .executeTakeFirst()) as { value?: unknown } | undefined;
  return row === undefined || row.value === null || row.value === undefined ? null : Number(row.value);
}

/**
 * Every time one venue day offers for `kind`, free or full — the same checks
 * the guard runs, on the same day-read, so a time shown free is a time the
 * write will take (unless someone takes it first). A time is listed when at
 * least one person in question works then; it is free when one of them could
 * be booked for it. Nothing about who booked, or how many, leaves here.
 */
export async function bookingSlots(
  rule: TableBookingRule,
  target: GuardTarget,
  day: string,
  minutes: number,
  input: BookingAvailabilityInput,
): Promise<{ slots: BookingSlot[]; ctx: BookingDayContext }> {
  const ctx = await loadBookingDay(rule, target, day, input.kind, input.now);
  const buffer = await kindBuffer(rule, target, input.kind);
  // Staff asking about anyone are told who the save would give them, by the same pick.
  const even = !input.isPublic && input.resource === 'any' && (await pickOf(rule, target, input.kind)) === 'even';
  const made = even ? await lastMade(rule, target, ctx.eligible.map((e) => e.resource), input.excludePk) : null;
  return { slots: slotsOf(rule, ctx, target.timezone ?? 'UTC', minutes, buffer, input, made), ctx };
}

/** The times of one loaded day. `made`: share evenly when naming who is free. */
function slotsOf(rule: TableBookingRule, ctx: BookingDayContext, zone: string, minutes: number, buffer: number, input: BookingAvailabilityInput, made: ReadonlyMap<string, number> | null): BookingSlot[] {
  const day = ctx.day;
  const people = ctx.eligible.filter(
    (e) => (input.resource === 'any' || e.resource === input.resource) && e.active && (!input.isPublic || e.bookableOnline),
  );
  const judged: Judged = { row: {}, before: null, need: { placement: true }, isPublic: input.isPublic, now: input.now, ownPk: input.excludePk, kept: null };
  const offered = new Map<number, { free: string[] }>();
  for (const person of people) {
    const hours = ctx.own.has(person.resource) ? ctx.own.get(person.resource)! : ctx.practice;
    if (hours === null) continue;
    for (let minute = hours.opens; minute + minutes <= hours.closes; minute += ctx.grid) {
      const start = wallTimeToInstant(`${day} ${clockOf(minute)}`, zone);
      if (start === null) continue;
      const issue = judge(rule, ctx, person.resource, judged, start, minutes, buffer);
      // Outside this person's hours, on their break, or on a day they are away: not a time of theirs.
      if (issue === 'BOOKING_OUT_OF_HOURS' || issue === 'BOOKING_CLOSED' || issue === 'BOOKING_NOT_OFFERED') continue;
      const free = issue === null && judgeDay(rule, ctx, judged, start) === null;
      const seen = offered.get(minute) ?? { free: [] };
      if (free) seen.free.push(person.resource);
      offered.set(minute, seen);
    }
  }
  const whoIsFree = (free: readonly string[]) => (made === null ? free[0]! : longestAgo(fewestThatDay(ctx, free, input.excludePk), made));
  return [...offered.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minute, { free }]) => ({
      time: clockOf(minute),
      state: free.length === 0 ? ('full' as const) : ('free' as const),
      // Staff asking about anyone see who would be booked; a guest never does.
      ...(!input.isPublic && input.resource === 'any' && free.length > 0 ? { resource: pickValue(whoIsFree(free)) } : {}),
    }));
}

/**
 * A strip of days: how many times each offers, and whether it is open, full
 * (people work that day, and every time is taken or too soon) or closed (no
 * one in question works it, it is shut, or it is past or beyond the window).
 */
export async function bookingDays(
  rule: TableBookingRule,
  target: GuardTarget,
  from: string,
  days: number,
  minutes: number,
  input: BookingAvailabilityInput,
): Promise<BookingDayState[]> {
  const out: BookingDayState[] = [];
  const range = await loadBookingRange(rule, target, from, addDays(from, days - 1), input.kind, input.now);
  const buffer = await kindBuffer(rule, target, input.kind);
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i);
    const ctx = dayOfRange(rule, range, date);
    const slots = slotsOf(rule, ctx, range.zone, minutes, buffer, input, null);
    const open = slots.filter((slot) => slot.state === 'free').length;
    const holds = windowHolds(rule, ctx, input.isPublic);
    const bookable = date >= ctx.today && (!holds || ctx.workingDaysTo <= ctx.windowDays!);
    // The last day the window reaches: the count is at the window, and the next day takes it past.
    const last = holds && date >= ctx.today && ctx.workingDaysTo === ctx.windowDays && range.workingDaysTo(addDays(date, 1)) > ctx.windowDays!;
    out.push({ date, open, state: open > 0 ? 'open' : slots.length > 0 && bookable ? 'full' : 'closed', ...(last ? { lastBookable: true as const } : {}) });
  }
  return out;
}
