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
 * "ANYONE". A create with no person gets the first free eligible one, in the
 * resources' own order (then by key), active — and, for a guest, bookable
 * online. The guard RETURNS its pick; the write service writes it and reports
 * it. The browser never learns who is free until the booking is saved.
 */
import { sql, type Kysely } from 'kysely';

import type { TableBookingRule, BookingHoursTable } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ConflictError, ValidationFailedError } from '../errors.js';
import { minutesOf, numberOf, slotInstant, withNamedLock, type GuardTarget } from './capacity-guard.js';
import type { Row } from './mask.js';
import { venueClock, wallTimeToInstant } from './venue-time.js';

type Db = Kysely<SourceDatabase>;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_MS = 86_400_000;

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);
const empty = (value: unknown) => value === null || value === undefined || value === '';
/** A stored bool, as each engine hands it back: false, 0 and '0' are off. */
const off = (value: unknown) => value === false || value === 0 || value === '0' || value === 'false';
const keyOf = (value: unknown) => (empty(value) ? '' : String(value));

/** Whether a row, as it will be, takes time. An absent status is the default's, unknown here: counting it never double-books. */
export function bookingCounts(rule: TableBookingRule, row: Row): boolean {
  if (!has(row, rule.countWhere.column)) return true;
  return rule.countWhere.values.includes(String(row[rule.countWhere.column]));
}

/** What a write asks of the guard: the placement checks, the overlap, or nothing. */
export interface BookingNeed {
  /** Where the row sits moved (or it is new): hours, closures, window, overlap. */
  placement: boolean;
}

/** Whether a column's new value differs from the stored one (a start compared as an instant). */
function moved(rule: TableBookingRule, column: string, values: Row, before: Row): boolean {
  if (!has(values, column)) return false;
  if (column === rule.start) return slotInstant(values[column])?.getTime() !== slotInstant(before[column])?.getTime();
  return keyOf(values[column]) !== keyOf(before[column]);
}

/**
 * What this write needs checked, or null when nothing: a row that will not
 * count holds no time, and a counted row that stays where it is and stays
 * counted (a status step) is not re-judged.
 */
export function bookingNeed(rule: TableBookingRule, values: Row, before: Row | null): BookingNeed | null {
  const row = before === null ? values : { ...before, ...values };
  if (!bookingCounts(rule, row)) return null;
  if (before === null) return { placement: true };
  const placement = [rule.start, rule.minutes, rule.resource, rule.kind].some((column) => moved(rule, column, values, before));
  if (placement) return { placement: true };
  // Counted again (a cancelled visit re-booked): only the overlap is asked.
  return bookingCounts(rule, before) ? null : { placement: false };
}

/** Whether a write could need the guard at all, before the stored row is read. */
export function touchesBooking(rule: TableBookingRule, values: Row): boolean {
  return [rule.start, rule.minutes, rule.resource, rule.kind, rule.countWhere.column].some((column) => has(values, column));
}

/** The venue day a row will hold, or null when its start is not a time. */
export function bookingDay(rule: TableBookingRule, row: Row, zone: string): string | null {
  const instant = slotInstant(row[rule.start]);
  return instant === null ? null : venueClock(instant, zone).day;
}

/** Run `write` holding the venue day, inside one transaction. */
export function withBookingLock<T>(
  target: GuardTarget,
  day: string,
  write: (db: Db) => Promise<T>,
): Promise<T> {
  return withNamedLock(target, `${target.connectionId}|${target.table.id}|booking|${day}`, 'BOOKING_BUSY', write);
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

/** The error a refusal is thrown as: a 409 for what another row or day holds, a 422 for a time never offered. */
export function bookingRefusal(reason: Refusal, column: string): Error {
  if (reason === 'BOOKING_TAKEN') return new ConflictError('That time has just gone.', 'BOOKING_TAKEN', { column });
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

interface Hours {
  opens: number;
  closes: number;
  breakStart: number | null;
  breakEnd: number | null;
}

/** One hours row as minutes, or null for a closed day (no row, switched off, or closing before it opens). */
function hoursOf(spec: BookingHoursTable & { open?: string }, row: Row | undefined): Hours | null {
  if (row === undefined) return null;
  if (spec.open !== undefined && off(row[spec.open])) return null;
  const opens = minutesOf(row[spec.opens]);
  const closes = minutesOf(row[spec.closes]);
  // A booking never crosses midnight: hours that do are refused as closed.
  if (opens === null || closes === null || closes <= opens) return null;
  const breakStart = spec.breakStart === undefined ? null : minutesOf(row[spec.breakStart]);
  const breakEnd = spec.breakEnd === undefined ? null : minutesOf(row[spec.breakEnd]);
  return { opens, closes, ...(breakStart !== null && breakEnd !== null && breakEnd > breakStart ? { breakStart, breakEnd } : { breakStart: null, breakEnd: null }) };
}

/** The counted rows of one day, per resource, as `[start, end)` in epoch ms. */
interface Booked {
  resource: string;
  start: number;
  end: number;
  pk: string;
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
const weekdayOf = (day: string) => WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Every closure row that covers any day in `[from, to]`, active ones only. */
async function closureRows(rule: TableBookingRule, db: Db, from: string, to: string): Promise<Row[]> {
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
function dateOf(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value ?? '').slice(0, 10);
}

/**
 * Read one venue day for `kind`: who does it and in what order, the
 * practice's week and each eligible person's own hours, the closures from
 * today to the day, and the day's counted rows. Shared with availability, so
 * a time offered is a time the guard would take.
 */
export async function loadBookingDay(
  rule: TableBookingRule,
  target: GuardTarget,
  day: string,
  kind: unknown,
  now: Date,
): Promise<BookingDayContext> {
  const { db } = target;
  const zone = target.timezone ?? 'UTC';
  const weekday = weekdayOf(day);

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

  // The practice's week (the window counts working days), and today's row.
  const practiceSpec = rule.hours.practice;
  const week = (await db.selectFrom(practiceSpec.table).selectAll().execute()) as Row[];
  const practiceFor = (wd: string) => hoursOf(practiceSpec, week.find((row) => String(row[practiceSpec.weekday]) === wd));
  const practice = practiceFor(weekday);

  // Resources with hours of their own follow them, every day.
  const own = new Map<string, Hours | null>();
  const ownSpec = rule.hours.own;
  if (ownSpec !== undefined && eligibleKeys.length > 0) {
    const rows = (await db
      .selectFrom(ownSpec.table)
      .selectAll()
      .where((eb) => eb(db.dynamic.ref(ownSpec.resource), 'in', eligibleRows.map((row) => row.resource) as never[]))
      .execute()) as Row[];
    for (const key of eligibleKeys) {
      const mine = rows.filter((row) => keyOf(row[ownSpec.resource]) === key);
      if (mine.length > 0) own.set(key, hoursOf(ownSpec, mine.find((row) => String(row[ownSpec.weekday]) === weekday)));
    }
  }

  const today = venueClock(now, zone).day;
  const from = today < day ? today : day;
  const closures = await closureRows(rule, db, from, day > today ? day : today);
  const closed = new Set<string>();
  const practiceClosed = new Set<string>();
  const spec = rule.closures;
  for (const row of closures) {
    if (spec === undefined) break;
    const who = spec.resource === undefined ? '' : keyOf(row[spec.resource]);
    const start = dateOf(row[spec.from]);
    const end = dateOf(row[spec.to]);
    if (start <= day && day <= end) closed.add(who);
    if (who === '') for (let d = start < from ? from : start; d <= end && d <= (day > today ? day : today); d = addDays(d, 1)) practiceClosed.add(d);
  }

  // Working days from today to the day, both counted: a day with hours the
  // practice has not closed.
  let workingDaysTo = 0;
  for (let d = today; d <= day && workingDaysTo <= 400; d = addDays(d, 1)) {
    if (practiceFor(weekdayOf(d)) !== null && !practiceClosed.has(d)) workingDaysTo += 1;
  }

  const booked = await bookedOn(rule, target, day, zone);
  return {
    day,
    weekday,
    zone,
    practice,
    own,
    closed,
    booked,
    eligible,
    grid: Math.max(1, (await numberOf(db, rule.grid)) ?? 15),
    windowDays: await numberOf(db, rule.windowDays),
    noticeMinutes: await numberOf(db, rule.noticeMinutes),
    today,
    workingDaysTo,
  };
}

/** Keys that are numbers sort as numbers. */
function compareKeys(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A day's counted rows. Read over the days either side and kept only when the
 * start falls on the venue day: a start written by a till (this server's
 * wall clock) and one written by a guest (an ISO instant) compare as text on
 * SQLite, so the SQL bound is wide and the day is decided here.
 */
async function bookedOn(rule: TableBookingRule, target: GuardTarget, day: string, zone: string): Promise<Booked[]> {
  const { db } = target;
  const keys = target.table.primaryKey;
  const rows = (await db
    .selectFrom(target.table.id)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(rule.start), '>=', addDays(day, -1)))
    .where((eb) => eb(db.dynamic.ref(rule.start), '<', addDays(day, 2)))
    .where((eb) => eb(db.dynamic.ref(rule.countWhere.column), 'in', rule.countWhere.values))
    .execute()) as Row[];
  const out: Booked[] = [];
  for (const row of rows) {
    const start = slotInstant(row[rule.start]);
    if (start === null || venueClock(start, zone).day !== day) continue;
    const minutes = Number(row[rule.minutes] ?? 0);
    out.push({ resource: keyOf(row[rule.resource]), start: start.getTime(), end: start.getTime() + Math.max(0, minutes) * 60_000, pk: pkOf(keys, row) });
  }
  return out;
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
}

/**
 * Whether one resource can take the row, or the refusal. `placement` false
 * asks only the overlap.
 */
function judge(rule: TableBookingRule, ctx: BookingDayContext, resource: string, input: Judged, start: Date, minutes: number): Refusal | null {
  const end = start.getTime() + minutes * 60_000;
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
      (hours.breakStart !== null && hours.breakEnd !== null && minute < hours.breakEnd && minute + minutes > hours.breakStart)
    ) {
      return 'BOOKING_OUT_OF_HOURS';
    }
    if (ctx.closed.has('') || ctx.closed.has(resource)) return 'BOOKING_CLOSED';
  }
  for (const other of ctx.booked) {
    if (other.resource !== resource || other.pk === input.ownPk) continue;
    if (other.start < end && other.end > start.getTime()) return 'BOOKING_TAKEN';
  }
  return null;
}

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
  if (ctx.windowDays !== null && ctx.workingDaysTo > ctx.windowDays) return 'BOOKING_OUT_OF_RANGE';
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
  rule: TableBookingRule,
  target: GuardTarget,
  input: Omit<BookingCheck, 'isPublic'>,
): Promise<Row> {
  const check: Judged = {
    ...input,
    isPublic: target.origin === 'public',
    ownPk: input.before === null ? null : pkOf(target.table.primaryKey, input.before),
  };
  const zone = target.timezone ?? 'UTC';
  const start = slotInstant(input.row[rule.start]);
  if (start === null) throw bookingRefusal('BOOKING_OUT_OF_RANGE', rule.start);
  const minutes = Number(input.row[rule.minutes]);
  if (!Number.isInteger(minutes) || minutes <= 0) throw bookingRefusal('BOOKING_OUT_OF_HOURS', rule.minutes);
  const ctx = await loadBookingDay(rule, target, venueClock(start, zone).day, input.row[rule.kind], input.now);

  const dayIssue = judgeDay(rule, ctx, check, start);
  if (dayIssue !== null) throw bookingRefusal(dayIssue, rule.start);

  const asked = keyOf(input.row[rule.resource]);
  if (asked !== '') {
    const issue = judge(rule, ctx, asked, check, start, minutes);
    if (issue !== null) throw bookingRefusal(issue, issue === 'BOOKING_NOT_OFFERED' ? rule.resource : rule.start);
    return {};
  }

  // "Anyone": the first eligible person the time suits.
  let nearest: Refusal = 'BOOKING_NOT_OFFERED';
  for (const candidate of ctx.eligible) {
    if (!candidate.active || (check.isPublic && !candidate.bookableOnline)) continue;
    const issue = judge(rule, ctx, candidate.resource, { ...check, need: { placement: true } }, start, minutes);
    if (issue === null) return { [rule.resource]: pickValue(candidate.resource) };
    if (NEARNESS[issue] > NEARNESS[nearest]) nearest = issue;
  }
  throw bookingRefusal(nearest, nearest === 'BOOKING_NOT_OFFERED' ? rule.resource : rule.start);
}

/** A picked key, as a number when it is one (an int foreign key). */
function pickValue(key: string): string | number {
  return /^-?\d+$/.test(key) && Number.isSafeInteger(Number(key)) ? Number(key) : key;
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
  const columns = target.table.table?.columns ?? [];
  const copy = columns.find((c) => c.name === rule.minutes)?.copy;
  const link = columns.find((c) => c.name === rule.kind)?.references;
  if (copy === undefined || copy.via !== rule.kind || link === undefined || link === null || empty(kind)) return null;
  const row = (await target.db
    .selectFrom(link.tableId)
    .select(sql<unknown>`${sql.ref(copy.from)}`.as('minutes'))
    .where((eb) => eb(target.db.dynamic.ref(link.column), '=', kind))
    .executeTakeFirst()) as { minutes?: unknown } | undefined;
  const minutes = Number(row?.minutes);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
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
  const people = ctx.eligible.filter(
    (e) => (input.resource === 'any' || e.resource === input.resource) && e.active && (!input.isPublic || e.bookableOnline),
  );
  const judged: Judged = { row: {}, before: null, need: { placement: true }, isPublic: input.isPublic, now: input.now, ownPk: input.excludePk };
  const zone = target.timezone ?? 'UTC';
  const offered = new Map<number, { free: string | null }>();
  for (const person of people) {
    const hours = ctx.own.has(person.resource) ? ctx.own.get(person.resource)! : ctx.practice;
    if (hours === null) continue;
    for (let minute = hours.opens; minute + minutes <= hours.closes; minute += ctx.grid) {
      const start = wallTimeToInstant(`${day} ${clockOf(minute)}`, zone);
      if (start === null) continue;
      const issue = judge(rule, ctx, person.resource, judged, start, minutes);
      // Outside this person's hours, on their break, or on a day they are away: not a time of theirs.
      if (issue === 'BOOKING_OUT_OF_HOURS' || issue === 'BOOKING_CLOSED' || issue === 'BOOKING_NOT_OFFERED') continue;
      const free = issue === null && judgeDay(rule, ctx, judged, start) === null;
      const seen = offered.get(minute);
      if (seen === undefined) offered.set(minute, { free: free ? person.resource : null });
      else if (seen.free === null && free) seen.free = person.resource;
    }
  }
  const slots = [...offered.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minute, { free }]) => ({
      time: clockOf(minute),
      state: free === null ? ('full' as const) : ('free' as const),
      // Staff asking about anyone see who would be booked; a guest never does.
      ...(!input.isPublic && input.resource === 'any' && free !== null ? { resource: pickValue(free) } : {}),
    }));
  return { slots, ctx };
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
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i);
    const { slots, ctx } = await bookingSlots(rule, target, date, minutes, input);
    const open = slots.filter((slot) => slot.state === 'free').length;
    const bookable = date >= ctx.today && (ctx.windowDays === null || ctx.workingDaysTo <= ctx.windowDays);
    out.push({ date, open, state: open > 0 ? 'open' : slots.length > 0 && bookable ? 'full' : 'closed' });
  }
  return out;
}
