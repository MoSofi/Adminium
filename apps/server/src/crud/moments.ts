// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MOMENTS ON THE SERVER — the one place a rule turns a stored value, or a
 * manifest `Moment`, into an instant.
 *
 * A hold ends at a moment (an order's own `held_until`, or a waitlist offer's
 * end on the row it links to); a move may be allowed only after one moment
 * and before another; a timed move fires when one has passed; a stamp may
 * write one; a guest's change may be open only until one. Every reader of a
 * moment goes through here, so a hold's end, a window and a timed move agree
 * to the second, on the venue's clock, whatever zone the server runs in.
 *
 * Two readers are plain and built: {@link readInstant} (a stored time as the
 * instant it denotes — a zone-less value is this server's wall clock, which
 * is what the write path stores and the drivers read back) and
 * {@link readDay} (a stored date as `YYYY-MM-DD`). {@link momentOf} reads a
 * whole `Moment` — a linked row, a venue wall time, a shift, a fallback.
 *
 * What a moment is compared WITH is the write's clock (`write-clock.ts`), read
 * inside the transaction after the locks.
 */
import { sql, type Kysely } from 'kysely';
import type { HoursEdge, Moment, MomentAmount, MomentOffset, PlainMoment, WallTime } from '@adminium/manifest';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from './identifiers.js';
import type { Row } from './mask.js';
import { venueClock, wallTimeToInstant } from './venue-time.js';

/*
 * A leaf: the guard, the states and the jobs all read moments, so this
 * module reads none of them.
 */

/**
 * A stored time as the instant it denotes, or null (empty, or not a time).
 * A zone-less value is this server's wall clock — how the write path stores
 * one and how the drivers read one back (`crud/write-values.ts`).
 */
export function readInstant(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const instant = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** A stored date as `YYYY-MM-DD`: a driver's Date at local midnight, or the text's first ten characters; null when empty. */
export function readDay(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? null;
}

/** Reads a one-row setting a moment names (`{table, column}`) through the write's own handle, once per write. */
export type MomentSettings = (setting: { table: string; column: string }) => Promise<unknown>;

/** Everything a moment may read, as the write holds it. */
export interface MomentContext {
  /** The table of the row the moment is read from (its column types say date or time). */
  table: ResolvedTable;
  /** The row as it stands (stored values with the write's over them). */
  row: Row;
  /**
   * The rows the row's links point at, by the link column: held for share
   * inside the transaction by the reader that asks (null when the link is
   * empty or the row is gone). A moment through a link not here reads nothing.
   */
  linked: ReadonlyMap<string, Row | null>;
  /** The venue's time zone. */
  zone: string;
  settings: MomentSettings;
  /** The write's handle (inside its transaction when judging). */
  db: Kysely<SourceDatabase>;
}

/**
 * A setting reader over a handle, each setting read once: the ONE row of the
 * settings table, as the write's own handle sees it. What cannot be read is
 * undefined — a moment then has none, and a move waiting for a setting is
 * refused. A table holding more than one row has no setting to read: which
 * row would be "the" settings is anybody's guess (another guest's arrival
 * time, say), so none of them is read.
 */
export function momentSettings(db: Kysely<SourceDatabase>): MomentSettings {
  const memo = new Map<string, Promise<unknown>>();
  return (setting) => {
    const key = `${setting.table}\u0000${setting.column}`;
    let found = memo.get(key);
    if (found === undefined) {
      found = db
        .selectFrom(setting.table)
        .select(sql<unknown>`${sql.ref(setting.column)}`.as('value'))
        .limit(2)
        .execute()
        .then((rows) => (rows.length === 1 ? ((rows[0] as { value?: unknown }).value ?? undefined) : undefined))
        .catch(() => undefined);
      memo.set(key, found);
    }
    return found;
  };
}

/** A day so many days after `day` (`YYYY-MM-DD`), on the calendar. */
export function dayPlus(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The instant so many calendar days after `instant` on the venue's clock, at
 * the same wall time: seven days before 20:00 is 20:00, whatever the clocks
 * did in between. A wall time the clocks skip is read as the hour after; one
 * they pass twice, as the first (`wallTimeToInstant`).
 */
export function addVenueDays(instant: Date, days: number, zone: string): Date {
  const clock = venueClock(instant, zone);
  const text = `${dayPlus(clock.day, days)} ${pad(Math.floor(clock.minute / 60))}:${pad(clock.minute % 60)}:${pad(clock.second)}`;
  return wallTimeToInstant(text, zone) ?? new Date(instant.getTime() + days * 86_400_000);
}

/** The instant a venue day's wall time names (`HH:MM`), or null when it is no time of day. */
export function wallOn(day: string, time: string, zone: string): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (match === null) return null;
  return wallTimeToInstant(`${day} ${match[1]}:${match[2]}`, zone);
}

/** The weekday a venue day falls on, as a weekly hours table names it. */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export function weekdayOf(day: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** The whole number an amount says (stated, or read from its setting), or null. */
async function amountOf(amount: MomentAmount | undefined, context: MomentContext): Promise<number | null> {
  if (amount === undefined) return null;
  const read = typeof amount === 'number' ? amount : await context.settings(amount);
  if (read === null || read === undefined || read === '' || typeof read === 'boolean') return null;
  const n = Number(read);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** An instant moved by a shift: minutes and hours as elapsed time, days on the venue's calendar. */
export async function shifted(at: Date, shift: MomentOffset | undefined, sign: 1 | -1, context: Pick<MomentContext, 'settings' | 'zone'> & Partial<MomentContext>): Promise<Date | null> {
  if (shift === undefined) return at;
  const ctx = context as MomentContext;
  if (shift.minutes !== undefined) {
    const n = await amountOf(shift.minutes, ctx);
    return n === null ? null : new Date(at.getTime() + sign * n * 60_000);
  }
  if (shift.hours !== undefined) {
    const n = await amountOf(shift.hours, ctx);
    return n === null ? null : new Date(at.getTime() + sign * n * 3_600_000);
  }
  if (shift.days !== undefined) {
    const n = await amountOf(shift.days, ctx);
    return n === null ? null : addVenueDays(at, sign * n, context.zone);
  }
  return at;
}

/** A venue day's opening or closing hour from a weekly hours table; a closed day, or one with no row, ends at midnight. */
async function hoursEdgeOn(day: string, time: HoursEdge, context: MomentContext): Promise<Date | null> {
  const { hours, edge } = time;
  const dayEnd = wallOn(dayPlus(day, 1), '00:00', context.zone);
  let row: Row | undefined;
  try {
    const rows = (await context.db
      .selectFrom(hours.table)
      .selectAll()
      .where((eb) => eb(context.db.dynamic.ref(hours.weekday), '=', weekdayOf(day)))
      .limit(2)
      .execute()) as Row[];
    // Two rows for one weekday say two things: neither is read as the day's hours.
    if (rows.length > 1) return null;
    row = rows[0];
  } catch {
    return null;
  }
  const closed = row === undefined || (hours.open !== undefined && !yes(row[hours.open]));
  if (closed) return dayEnd;
  const text = (column: string | undefined) => (column === undefined ? null : typeof row![column] === 'string' ? (row![column] as string) : null);
  const closes = text(hours.closes);
  const opens = text(hours.opens);
  if (edge === 'opens') return opens === null ? dayEnd : wallOn(day, opens, context.zone);
  if (closes === null) return dayEnd;
  // A venue open past midnight closes on the next day's clock.
  const overnight = opens !== null && closes <= opens;
  return wallOn(overnight ? dayPlus(day, 1) : day, closes, context.zone);
}

const yes = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 't' || value === 'true';

/** A time of day as a column keeps it (`HH:MM`, or a database time `HH:MM:SS`) as `HH:MM`, or null. */
export function clockOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d(\.\d+)?)?$/.exec(value.trim());
  return match === null ? null : `${match[1]}:${match[2]}`;
}

/** The instant a wall time names on a venue day, or null. `row` is the row the moment's column was read from. */
async function wallTimeOn(day: string, time: WallTime, context: MomentContext, row: Row): Promise<Date | null> {
  if (typeof time === 'string') return wallOn(day, time, context.zone);
  if ('edge' in time) return hoursEdgeOn(day, time, context);
  // A time kept on the row itself: empty, or no time of day, is no moment.
  if (!('table' in time)) {
    const clock = clockOf(row[time.column]);
    return clock === null ? null : wallOn(day, clock, context.zone);
  }
  const read = await context.settings(time);
  return typeof read === 'string' ? wallOn(day, read, context.zone) : null;
}

/** Whether a stored value is a calendar day rather than a moment: by the column's type when known, else by its spelling. */
function isDay(value: unknown, logicalType: string | undefined): boolean {
  if (logicalType !== undefined) return logicalType === 'date';
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/** One moment with no fallback. */
async function plainMomentOf(moment: PlainMoment, context: MomentContext): Promise<Date | null> {
  let row: Row | null | undefined = context.row;
  let type: string | undefined = context.table.columns.get(moment.column)?.logicalType;
  if (moment.via !== undefined) {
    row = context.linked.get(moment.via);
    type = undefined;
  }
  if (row === null || row === undefined) return null;
  const value = row[moment.column];
  let base: Date | null;
  if (isDay(value, type)) {
    const day = readDay(value);
    base = day === null || moment.time === undefined ? null : await wallTimeOn(day, moment.time, context, row);
  } else {
    const at = readInstant(value);
    base = at === null ? null : moment.time === undefined ? at : await wallTimeOn(venueClock(at, context.zone).day, moment.time, context, row);
  }
  if (base === null) return null;
  if (moment.plus !== undefined) return shifted(base, moment.plus, 1, context);
  if (moment.minus !== undefined) return shifted(base, moment.minus, -1, context);
  return base;
}

/**
 * The instant a moment names for this row, or null when there is none (an
 * empty column, a missing linked row, an unreadable setting — the first of
 * `or` that answers stands in). What null means is the reader's rule: a
 * condition refuses, a timed move never fires, a late rule is not late, a
 * stamp writes empty.
 */
export async function momentOf(moment: Moment | PlainMoment, context: MomentContext): Promise<Date | null> {
  const first = await plainMomentOf(moment, context);
  if (first !== null) return first;
  for (const fallback of ('or' in moment ? moment.or : undefined) ?? []) {
    const found = await plainMomentOf(fallback, context);
    if (found !== null) return found;
  }
  return null;
}

/** The links a moment (and its fallbacks) reads through. */
export function momentVias(moment: Moment | PlainMoment | undefined): string[] {
  if (moment === undefined) return [];
  const all = [moment, ...(('or' in moment ? moment.or : undefined) ?? [])];
  return [...new Set(all.flatMap((m) => (m.via === undefined ? [] : [m.via])))];
}
