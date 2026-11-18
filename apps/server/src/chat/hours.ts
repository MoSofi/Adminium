// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CHAT'S HOURS: whether someone is in now, and when they are next.
 *
 * The owner writes the weekly hours in the business's own time zone:
 *
 * ```json
 * { "mon": [["09:00", "17:30"]], "fri": [["09:00", "12:00"], ["13:00", "16:00"]], "sat": [["22:00", "02:00"]] }
 * ```
 *
 * - A day may have several spans, or none (a day not named is closed).
 * - A span whose end is not after its start runs past midnight into the next
 *   day (`22:00`–`02:00`); `24:00` is the end of the day.
 * - "Closed until" a day: no span that starts on an earlier day counts. On
 *   that day itself the week's hours hold again (the closure is over).
 * - No hours at all: always outside hours.
 *
 * Wall times are turned into instants in the zone, so a span keeps its clock
 * across a change to or from summer time.
 *
 * Pure: no I/O. The zone is the chat's own, else the business's, else UTC
 * (the fleet's rule; the caller decides which).
 */
import { z } from 'zod';

/** The days, as the hours name them, Sunday first (as `Date.getUTCDay` counts). */
export const WEEK_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const span = z.tuple([z.string().regex(TIME), z.string().regex(TIME)]);

/** The weekly hours as stored; a day not named is closed. */
export const weeklyHoursSchema = z.object(Object.fromEntries(WEEK_DAYS.map((day) => [day, z.array(span).max(8).optional()])) as Record<WeekDay, z.ZodOptional<z.ZodArray<typeof span>>>).strict();
export type WeeklyHours = Partial<Record<WeekDay, [string, string][]>>;

/** When a chat opens next, as the window says it: the instant, and the business's own day and clock. */
export interface NextOpen {
  /** The instant, ISO. */
  at: string;
  /** The business's day (`yyyy-mm-dd`) and clock (`HH:MM`) then. */
  date: string;
  time: string;
  /**
   * How the window names the day: `today`, `tomorrow`, the weekday within the
   * coming week ("Opens Monday at 9:00"), else `date` ("Opens on 3 August at 9:00").
   */
  day: 'today' | 'tomorrow' | WeekDay | 'date';
}

/** Whether a chat is in hours now, and the edge either way. */
export interface HoursNow {
  open: boolean;
  /** While open: when this span ends (ISO). */
  closesAt: string | null;
  /** While closed: when it opens next; null when it never does (no hours, or no day with any). */
  nextOpen: NextOpen | null;
}

/** The chat's hours, as the settings row holds them. */
export interface HoursInput {
  hours: WeeklyHours | null;
  /** `yyyy-mm-dd`: closed on every day before this one. */
  closedUntil: string | null;
  timeZone: string;
}

/** A zone this runtime knows, else UTC. */
export function knownZone(zone: string | null | undefined): string {
  if (zone === null || zone === undefined || zone === '') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return zone;
  } catch {
    return 'UTC';
  }
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, found);
  }
  return found;
}

/** The wall clock in `zone` at an instant. */
function wallAt(at: number, zone: string): Wall & { second: number } {
  const parts = Object.fromEntries(formatterFor(zone).formatToParts(at).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second) };
}

/** How far `zone` is ahead of UTC at an instant, in ms. */
function offsetAt(at: number, zone: string): number {
  const wall = wallAt(at, zone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a wall time in `zone` names. A wall time the clocks skip (02:30
 * as summer time starts) is read by the offset before the jump, so it lands
 * the gap later (03:30), as calendars read it.
 */
export function instantOfWall(wall: Wall, zone: string): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Two rounds settle any zone: the offset at a first guess, then at the answer it gives.
  const first = naive - offsetAt(naive, zone);
  return naive - offsetAt(first, zone);
}

/** `yyyy-mm-dd` of a calendar day. */
const dayText = (year: number, month: number, day: number): string => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** A calendar day moved by `days`. */
function shiftDay(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

interface Span {
  start: number;
  end: number;
  /** The business's day it starts on. */
  date: string;
}

/** The spans that start on one calendar day, as instants (none on a day before "closed until"). */
function spansOn(input: HoursInput, date: { year: number; month: number; day: number }): Span[] {
  const text = dayText(date.year, date.month, date.day);
  if (input.closedUntil !== null && text < input.closedUntil) return [];
  const weekday = WEEK_DAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]!;
  const out: Span[] = [];
  for (const [from, to] of input.hours?.[weekday] ?? []) {
    const startMinutes = minutesOf(from);
    const endMinutes = minutesOf(to);
    // An end not after the start runs past midnight; 24:00 is the next day's 00:00.
    const endDate = endMinutes <= startMinutes || endMinutes === 24 * 60 ? shiftDay(date, 1) : date;
    const endWall = endMinutes === 24 * 60 ? 0 : endMinutes;
    const start = instantOfWall({ ...date, hour: Math.floor(startMinutes / 60), minute: startMinutes % 60 }, input.timeZone);
    const end = instantOfWall({ ...endDate, hour: Math.floor(endWall / 60), minute: endWall % 60 }, input.timeZone);
    if (end > start) out.push({ start, end, date: text });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** How many days ahead the next opening is looked for, past "closed until". */
const LOOK_AHEAD_DAYS = 8;
/** The furthest "closed until" is read: a year and a little more. */
const LOOK_AHEAD_MAX = 400;

/** Whether the chat is in hours at `now`, and when that changes. */
export function hoursAt(input: HoursInput, now: number): HoursNow {
  if (input.hours === null) return { open: false, closesAt: null, nextOpen: null };
  const zone = input.timeZone;
  const wall = wallAt(now, zone);
  const today = { year: wall.year, month: wall.month, day: wall.day };
  const todayText = dayText(today.year, today.month, today.day);

  // Open now: a span that started yesterday (past midnight) or today and has not ended.
  const current = [...spansOn(input, shiftDay(today, -1)), ...spansOn(input, today)].filter((one) => one.start <= now && now < one.end);
  if (current.length > 0) {
    // Spans that touch (17:00 on one, 17:00 on the next) close at the last one's end.
    let end = Math.max(...current.map((one) => one.end));
    for (let ahead = 0; ahead <= 1; ahead += 1) {
      for (const next of spansOn(input, shiftDay(today, ahead))) if (next.start <= end && next.end > end) end = next.end;
    }
    return { open: true, closesAt: new Date(end).toISOString(), nextOpen: null };
  }

  // Closed: the first span that starts after now, looked for past "closed until".
  const until = input.closedUntil !== null && input.closedUntil > todayText ? input.closedUntil : todayText;
  const untilDays = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000);
  const horizon = Math.min(LOOK_AHEAD_MAX, untilDays + LOOK_AHEAD_DAYS);
  for (let ahead = 0; ahead <= horizon; ahead += 1) {
    const next = spansOn(input, shiftDay(today, ahead)).find((one) => one.start > now);
    if (next === undefined) continue;
    const opens = wallAt(next.start, zone);
    const date = dayText(opens.year, opens.month, opens.day);
    const days = Math.round((Date.UTC(opens.year, opens.month - 1, opens.day) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000);
    const day: NextOpen['day'] = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? WEEK_DAYS[new Date(Date.UTC(opens.year, opens.month - 1, opens.day)).getUTCDay()]! : 'date';
    return {
      open: false,
      closesAt: null,
      nextOpen: { at: new Date(next.start).toISOString(), date, time: `${String(opens.hour).padStart(2, '0')}:${String(opens.minute).padStart(2, '0')}`, day },
    };
  }
  return { open: false, closesAt: null, nextOpen: null };
}
