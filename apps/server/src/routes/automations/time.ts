// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "TODAY" IS THE VIEWER'S, NOT THE SERVER'S (42-automations-and-workflow-
 * logs.md D22).
 *
 * Both KPI strips read "Runs today" and "Success rate", and an operator in
 * Auckland looking at a server in Frankfurt must not see yesterday's numbers.
 * The client sends its IANA zone; the server computes the bounds. A zone the
 * server cannot evaluate falls back to UTC rather than throwing — a wrong day
 * boundary is a bad number, a 500 is a blank page.
 */

const DAY = 86_400_000;
export { DAY as DAY_MS };

export interface DayBounds {
  todayStart: number;
  yesterdayStart: number;
}

/** Midnight in `timeZone`, as an epoch instant. */
export function startOfDayIn(at: number, timeZone: string | undefined): number {
  if (timeZone === undefined || timeZone === '') return startOfUtcDay(at);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(at));
    const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
    // The zone's wall clock, read back as if it were UTC, gives the offset —
    // and subtracting the elapsed part of that day gives its midnight.
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const offset = asUtc - Math.floor(at / 1000) * 1000;
    return asUtc - ((get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000) - offset;
  } catch {
    return startOfUtcDay(at);
  }
}

function startOfUtcDay(at: number): number {
  return Math.floor(at / DAY) * DAY;
}

export function dayBoundsFor(at: number, timeZone: string | undefined): DayBounds {
  const todayStart = startOfDayIn(at, timeZone);
  return { todayStart, yesterdayStart: todayStart - DAY };
}
