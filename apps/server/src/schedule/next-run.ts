// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CALENDAR TIME MATH — "daily at 09:00 in Europe/Berlin", as an instant.
 *
 * The stored payload is a FIELD vocabulary (`frequency`/`dayOfWeek`/
 * `dayOfMonth`/`time`/`timezone`), never a cron string, and this module is
 * the single place that morphs those fields into a cron expression and asks
 * croner (BRIEF: croner, no Redis) for the next occurrence. Repos persist
 * whatever timestamp they are handed and never parse cron.
 *
 * Timezone-correctness rides croner's own IANA handling: `09:00` in
 * `America/New_York` is 13:00/14:00 UTC depending on DST, and a `dayOfMonth`
 * of 31 simply skips short months (croner semantics — the run happens on the
 * next month that has a 31st, matching "monthly on the 31st" intent).
 *
 * LIFTED OUT OF `reports/` IN 42. Scheduled reports were the first caller;
 * automation rules on a calendar schedule are the second, and they store the
 * same five fields under a different discriminator name. Two copies of
 * DST-correct cron arithmetic is one copy too many, so the input is stated
 * structurally here and each caller maps its own payload onto it.
 */
import { Cron } from 'croner';

/** The five fields both callers store, whatever they call the discriminator. */
export interface CalendarSchedule {
  frequency: 'daily' | 'weekly' | 'monthly';
  /** `HH:mm`, 24-hour. */
  time: string;
  /** 0 = Sunday; weekly only. */
  dayOfWeek?: number | null | undefined;
  dayOfMonth?: number | null | undefined;
  /** IANA zone. */
  timezone: string;
}

/** Thrown for schedule payloads croner cannot evaluate (bad time/timezone). */
export class ScheduleError extends Error {
  override readonly name = 'ScheduleError';
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** `daily|weekly|monthly` + fields → a 5-part cron expression. */
export function cronExprFor(schedule: CalendarSchedule): string {
  const match = TIME_RE.exec(schedule.time);
  if (match === null) {
    throw new ScheduleError(
      `schedule.time must be HH:mm (24h), got ${JSON.stringify(schedule.time)}`,
    );
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  switch (schedule.frequency) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      // dayOfWeek is 0–6 (Sunday = 0), cron's native vocabulary.
      return `${minute} ${hour} * * ${schedule.dayOfWeek ?? 1}`;
    case 'monthly':
      return `${minute} ${hour} ${schedule.dayOfMonth ?? 1} * *`;
  }
}

/**
 * Next occurrence strictly after `from`, as epoch ms; `null` when croner can
 * find none. Invalid timezones surface as {@link ScheduleError} so the
 * route layer can 422 instead of leaking a croner internal.
 */
export function nextRunAtOf(schedule: CalendarSchedule, from: number = Date.now()): number | null {
  const expr = cronExprFor(schedule);
  let cron: Cron | null = null;
  try {
    // croner defers some timezone validation to evaluation time (the
    // Intl.DateTimeFormat inside nextRun throws the RangeError), so BOTH the
    // construction and the evaluation live under the same translation.
    cron = new Cron(expr, { paused: true, timezone: schedule.timezone });
    const next = cron.nextRun(new Date(from));
    return next === null ? null : next.getTime();
  } catch (error) {
    throw new ScheduleError(
      `schedule is not evaluatable (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    cron?.stop();
  }
}
