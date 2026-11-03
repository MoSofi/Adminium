// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DATE SO MANY WORKING DAYS ON (`addWorkingDays`, a stamp) — a print job's
 * ready-by, a made-to-order item's dispatch day — on the venue's clock.
 *
 *  - RECEIVED: the venue's day of `from` (`now`, or a date or moment of the
 *    row) when it is a working day and `from` is before the cut-off (or has
 *    no time of day, or there is no cut-off); otherwise the next working day.
 *    An order at 13:59 on a Friday with a 14:00 cut-off is received that
 *    Friday; at 14:01, on Monday.
 *  - The stamp is the `days`-th working day AFTER the received day; `0` is
 *    the received day itself.
 *  - A WORKING DAY is a weekday of the working week that no active closure
 *    covers (`from ≤ day ≤ to`). The days are the venue's: across a clock
 *    change the day an order lands on is the one on the shop's wall.
 *
 * The week and the cut-off are stated, or read from one of the app's own
 * settings (a shop changes its days and its cut-off itself). A setting that
 * cannot be read as a week or a time falls back to the default the app
 * declares for it; with no readable default the write is refused, never
 * counted in calendar days. The closures are read in the write, on its own
 * handle — a quote reads what the save reads — over a bounded window: a date
 * further on than that is refused as `out-of-range`, as `addDays` refuses a
 * date past its bound.
 */
import { weekdaysOf } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { WorkingDaysRule } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ValidationFailedError } from '../errors.js';
import type { Row } from './mask.js';
import { dayPlus, readDay, readInstant } from './moments.js';
import { settingValue, type RuleSettingsReader } from './rule-settings.js';
import { venueClock } from './venue-time.js';

type Db = Kysely<SourceDatabase>;

/** The most working days a stamp counts: more is refused (`out-of-range`). */
export const WORKING_DAYS_MAX = 400;
/** The calendar days the closures are read over, from the day of `from`: a date further on is refused. */
export const WORKING_WINDOW_DAYS = 800;

/** The week (0 = Sunday), the cut-off as minutes of the day (none: no cut-off), and the closed days. */
export interface WorkingCalendar {
  weekdays: ReadonlySet<number>;
  cutoff: number | null;
  closed: ReadonlySet<string>;
}

/** The weekday of a `YYYY-MM-DD` day, 0 being Sunday. */
const weekdayOf = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

/** A working week as the setting or the rule spells it (`mon,tue,wed,thu,fri`), or null when it is not one: an empty week is none. */
export function workingWeek(value: unknown): Set<number> | null {
  const text = Array.isArray(value) ? value.join(',') : value;
  if (typeof text !== 'string') return null;
  const days = weekdaysOf(text);
  return days === null || days.size === 0 ? null : days;
}

/** A cut-off (`HH:MM`, 24-hour) as minutes of the day, or null when it is not one. */
export function cutoffMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The received day and the stamp's day, counted on `calendar` from the
 * venue's day of `from` and its minute (null for a date with no time). Null
 * when the count walks past `last`, the last day the closures were read to.
 */
export function workingDayAfter(fromDay: string, fromMinute: number | null, days: number, calendar: WorkingCalendar, last: string): { received: string; due: string } | null {
  const working = (day: string) => calendar.weekdays.has(weekdayOf(day)) && !calendar.closed.has(day);
  const next = (day: string): string | null => {
    for (let d = dayPlus(day, 1); d <= last; d = dayPlus(d, 1)) if (working(d)) return d;
    return null;
  };
  const inTime = calendar.cutoff === null || fromMinute === null || fromMinute < calendar.cutoff;
  const received = working(fromDay) && inTime ? fromDay : next(fromDay);
  if (received === null) return null;
  let due: string | null = received;
  for (let n = 0; n < days && due !== null; n += 1) due = next(due);
  return due === null ? null : { received, due };
}

/** The refusal of a date further on than the stamp counts, on the column it reads its days from (or its own). */
function tooFar(column: string): ValidationFailedError {
  return new ValidationFailedError('Some values were refused.', { fields: { [column]: { code: 'out-of-range' } }, column });
}

/** The refusal of a working week or a cut-off that neither the setting nor its default spells. */
function unreadable(column: string, what: string): ValidationFailedError {
  return new ValidationFailedError(`${column} counts working days, and the ${what} it reads is not one Adminium can read; set it in the app's settings.`, {
    fields: { [column]: { code: 'unreadable-setting' } },
    column,
  });
}

/** A setting's value as a week or a time: the saved value, else the declared default (`settingValue` gives that), read once. */
async function settingOr<T>(db: Db, source: string[] | string | { addOn: string; setting: string }, read: (value: unknown) => T | null, reader: RuleSettingsReader | undefined): Promise<T | null> {
  if (typeof source !== 'object' || Array.isArray(source)) return read(source);
  const saved = await settingValue(db, source, reader);
  const parsed = read(saved);
  if (parsed !== null) return parsed;
  // A value saved that is no week or time: the default the app declares, read on its own.
  return read(await reader?.defaultSetting?.(source.addOn, source.setting));
}

/** What the count reads beside the row: the write's handle, the venue's zone and the moment, the settings reader. */
export interface WorkingDaysContext {
  db: Db;
  zone: string;
  now: Date;
  settings?: RuleSettingsReader | undefined;
  /** Whether `from` is a date column (a day with no time of day), as the table keeps it. */
  fromIsDate?: boolean | undefined;
}

/**
 * The date an `addWorkingDays` stamp writes into `column` for `row` (the row
 * as the write leaves it), as `YYYY-MM-DD`; null when `from` is empty (the
 * date is emptied), undefined when the number of days is (nothing is
 * written), as `addDays` does. Throws `out-of-range` past the bound, and a
 * refusal when the week or the cut-off cannot be read.
 */
export async function workingDaysValue(rule: WorkingDaysRule, column: string, row: Row, context: WorkingDaysContext): Promise<string | null | undefined> {
  // The day and minute of `from` on the venue's clock: a date has no minute.
  let fromDay: string | null;
  let fromMinute: number | null = null;
  if (rule.from === 'now') {
    const clock = venueClock(context.now, context.zone);
    fromDay = clock.day;
    fromMinute = clock.minute;
  } else {
    // A date is a day with no time (a driver's Date at local midnight, read by its local parts); a moment is read on the venue's clock.
    const value = row[rule.from];
    const day = context.fromIsDate === true || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) ? readDay(value) : null;
    const instant = day === null ? readInstant(value) : null;
    if (instant !== null) {
      const clock = venueClock(instant, context.zone);
      fromDay = clock.day;
      fromMinute = clock.minute;
    } else {
      fromDay = day;
    }
  }
  if (fromDay === null) return null;
  const { days, map } = rule;
  const count = typeof days === 'number' ? days : map !== undefined ? map[String(row[days])] : row[days] === null || row[days] === undefined || row[days] === '' ? undefined : Number(row[days]);
  if (count === undefined || !Number.isFinite(count)) return undefined;
  const daysColumn = typeof days === 'string' ? days : column;
  if (count < 0 || count > WORKING_DAYS_MAX) throw tooFar(daysColumn);
  const weekdays = await settingOr(context.db, rule.weekdays, workingWeek, context.settings);
  if (weekdays === null) throw unreadable(column, 'working week');
  const cutoff = rule.cutoff === undefined ? null : await settingOr(context.db, rule.cutoff, cutoffMinutes, context.settings);
  if (rule.cutoff !== undefined && cutoff === null) throw unreadable(column, 'cut-off');
  const last = dayPlus(fromDay, WORKING_WINDOW_DAYS);
  const closed = rule.closures === undefined ? new Set<string>() : await closedDays(context.db, rule.closures, fromDay, last);
  const counted = workingDayAfter(fromDay, fromMinute, Math.trunc(count), { weekdays, cutoff, closed }, last);
  if (counted === null) throw tooFar(daysColumn);
  return counted.due;
}

const off = (value: unknown) => value === false || value === 0 || value === '0' || value === 'false' || value === 'f';

/**
 * The days the closures table closes between `from` and `to`, both kept: its
 * rows that overlap them, a row switched off left out. Read on the write's
 * own handle.
 */
export async function closedDays(db: Db, closures: NonNullable<WorkingDaysRule['closures']>, from: string, to: string): Promise<Set<string>> {
  const rows = (await db
    .selectFrom(closures.table as never)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(closures.from), '<=', to as never))
    .where((eb) => eb(db.dynamic.ref(closures.to), '>=', from as never))
    .execute()) as Row[];
  const out = new Set<string>();
  for (const row of rows) {
    // A row switched off closes nothing; one with no answer counts, as booking's closures do.
    if (closures.active !== undefined && off(row[closures.active])) continue;
    const start = readDay(row[closures.from]);
    const end = readDay(row[closures.to]);
    if (start === null || end === null) continue;
    for (let d = start < from ? from : start; d <= end && d <= to; d = dayPlus(d, 1)) out.add(d);
  }
  return out;
}
