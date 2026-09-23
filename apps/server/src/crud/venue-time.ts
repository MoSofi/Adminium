// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE VENUE'S CLOCK — a wall time where the venue is, not where the server is.
 *
 * A guest books "7 pm on Friday" and a till shows "19:00": both mean the
 * venue's evening, whatever zone the server runs in. A column a rule marks
 * `venueLocal` accepts such a wall time with no zone and stores the instant it
 * names there; the booking guard reads its hours and window on the same clock.
 * Nothing here applies to a column that does not ask for it.
 */
import type { ResolvedColumn } from './identifiers.js';
import { normalizeWriteValue } from './write-values.js';

/** A day and a minute of the day on the venue's clock. */
export function venueClock(instant: Date, timezone: string): { day: string; minute: number; second: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts['year']}-${parts['month']}-${parts['day']}`,
    minute: Number(parts['hour']) * 60 + Number(parts['minute']),
    second: Number(parts['second']),
  };
}

/** How far the venue's clock is ahead of UTC at `instant`, in minutes. */
function offsetAt(instant: number, timezone: string): number {
  const clock = venueClock(new Date(instant), timezone);
  const asUtc = Date.parse(`${clock.day}T00:00:00Z`) + (clock.minute * 60 + clock.second) * 1000;
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

const WALL_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * The instant a zone-less wall time names on the venue's clock, or null when
 * the value is not one (it carries a zone, or is not a time at all). A time
 * the clocks skip in spring is read as the hour after; one they pass twice in
 * autumn, as the first.
 */
export function wallTimeToInstant(text: string, timezone: string): Date | null {
  const match = WALL_TIME.exec(text.trim());
  if (match === null) return null;
  const naive = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4] ?? '00'}Z`);
  if (Number.isNaN(naive)) return null;
  // The offsets either side of the day: equal on most days; across a clock
  // change, each names one reading of the wall time.
  const readings = [naive - offsetAt(naive - 43_200_000, timezone) * 60_000, naive - offsetAt(naive + 43_200_000, timezone) * 60_000];
  const wanted = venueClockOfNaive(naive);
  const exact = readings.filter((instant) => {
    const clock = venueClock(new Date(instant), timezone);
    return clock.day === wanted.day && clock.minute === wanted.minute;
  });
  // Twice in autumn: the first. Never in spring: the earlier offset, an hour on.
  return new Date(exact.length > 0 ? Math.min(...exact) : readings[0]!);
}

/** The day and minute a naive UTC-parsed wall time spells. */
function venueClockOfNaive(naive: number): { day: string; minute: number } {
  const date = new Date(naive);
  return { day: date.toISOString().slice(0, 10), minute: date.getUTCHours() * 60 + date.getUTCMinutes() };
}

/**
 * The value a venue-local column stores for a wall time: the instant, spelled
 * the way the write path spells any zoned value for this column.
 */
export function venueLocalValue(column: ResolvedColumn, value: unknown, timezone: string): unknown {
  if (typeof value !== 'string') return value;
  const instant = wallTimeToInstant(value, timezone);
  return instant === null ? value : normalizeWriteValue(column, instant.toISOString());
}
