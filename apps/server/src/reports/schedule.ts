// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scheduled-report time math (07-meta-store.md §3.24, M7 reports track).
 *
 * The stored `schedule` payload is the §3.24 field vocabulary
 * (`frequency`/`dayOfWeek`/`dayOfMonth`/`time`/`timezone`), NOT a cron
 * string — this module is the single place that morphs those fields into a
 * cron expression and asks croner (BRIEF §3: croner, no Redis) for the next
 * occurrence. The meta repo persists whatever timestamp it is handed and
 * never parses cron (see packages/meta/src/repos/scheduled-reports.ts).
 *
 * Timezone-correctness rides croner's own IANA handling: `09:00` in
 * `America/New_York` is 13:00/14:00 UTC depending on DST, and a `dayOfMonth`
 * of 31 simply skips short months (croner semantics — the run happens on the
 * next month that has a 31st, matching "monthly on the 31st" intent).
 */
import { Cron } from 'croner';
import type { ReportSchedule } from '@adminium/meta';

/** Thrown for schedule payloads croner cannot evaluate (bad time/timezone). */
export class ReportScheduleError extends Error {
  override readonly name = 'ReportScheduleError';
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** `daily|weekly|monthly` + fields → a 5-part cron expression. */
export function cronExprFor(schedule: ReportSchedule): string {
  const match = TIME_RE.exec(schedule.time);
  if (match === null) {
    throw new ReportScheduleError(
      `schedule.time must be HH:mm (24h), got ${JSON.stringify(schedule.time)}`,
    );
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  switch (schedule.frequency) {
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      // §3.24 dayOfWeek is 0–6 (Sunday = 0), cron's native vocabulary.
      return `${minute} ${hour} * * ${schedule.dayOfWeek ?? 1}`;
    case 'monthly':
      return `${minute} ${hour} ${schedule.dayOfMonth ?? 1} * *`;
  }
}

/**
 * Next occurrence strictly after `from`, as epoch ms; `null` when croner can
 * find none. Invalid timezones surface as {@link ReportScheduleError} so the
 * route layer can 422 instead of leaking a croner internal.
 */
export function nextRunAtOf(schedule: ReportSchedule, from: number = Date.now()): number | null {
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
    throw new ReportScheduleError(
      `schedule is not evaluatable (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    cron?.stop();
  }
}
