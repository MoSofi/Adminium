// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's quiet hours and the time their summaries are sent.
 *
 * Quiet hours are a window a weekday, in the person's own time zone: it
 * starts that day at `from` and ends at `to` — the same day, or the next when
 * `to` is not after `from` (19:00 to 08:00). A notice that arrives inside a
 * window still shows in the app, without a sound; its email is held to the
 * moment the window ends. Something urgent, and a kind of notice the person
 * marked "always tell me", is never held.
 *
 * The zone is the person's when they chose one, else the business's (the
 * database's own), else UTC. It decides WHEN a person is told and nothing
 * else: what a rule counts as "today" stays the business's.
 */
import type { NotificationQuiet, NotificationSchedule } from '@adminium/meta';

import { nextRunAtOf } from '../schedule/next-run.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
type Day = keyof NotificationQuiet;

/** The weekday (0 = Sunday) and the minutes past midnight of a moment, on a zone's clock. */
export function clockIn(at: number, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const of = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return { day: Math.max(0, WEEKDAYS.indexOf(of('weekday') as (typeof WEEKDAYS)[number])), minutes: Number(of('hour')) * 60 + Number(of('minute')) };
}

const minutesOf = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** A zone a clock can be read in, or null: a name this server does not know is as good as none. */
export function usableZone(timeZone: string | null | undefined): string | null {
  if (timeZone === null || timeZone === undefined || timeZone === '') return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

/** The zone a person is told in: theirs, else the business's, else UTC. */
export function zoneFor(schedule: Pick<NotificationSchedule, 'timezone'> | null, fallback: string | null | undefined): string {
  return usableZone(schedule?.timezone) ?? usableZone(fallback) ?? 'UTC';
}

/**
 * The moment a person's quiet hours end, for somebody in them at `at`; null
 * when they are in none. Where one window ends as the next begins (Friday
 * evening into a Saturday that is quiet all day), the end is the end of the
 * last of them: what is held is not sent into another quiet hour. Followed
 * through at most eight windows, so a week that is quiet throughout still
 * has an end.
 */
export function quietUntil(schedule: Pick<NotificationSchedule, 'timezone' | 'quiet'> | null, fallbackZone: string | null | undefined, at: number): number | null {
  let end = windowEnd(schedule, fallbackZone, at);
  for (let turn = 0; end !== null && turn < 8; turn += 1) {
    const next = windowEnd(schedule, fallbackZone, end);
    if (next === null || next <= end) break;
    end = next;
  }
  return end;
}

/** The end of the one window a person is in at `at`: today's, or the one that started yesterday and runs past midnight. */
function windowEnd(schedule: Pick<NotificationSchedule, 'timezone' | 'quiet'> | null, fallbackZone: string | null | undefined, at: number): number | null {
  const quiet = schedule?.quiet ?? null;
  if (quiet === null) return null;
  const timezone = zoneFor(schedule, fallbackZone);
  const { day, minutes } = clockIn(at, timezone);
  const today = quiet[String(day) as Day];
  const yesterday = quiet[String((day + 6) % 7) as Day];
  let endsAt: string | null = null;
  if (today !== undefined) {
    const from = minutesOf(today.from);
    const to = minutesOf(today.to);
    if (to > from ? minutes >= from && minutes < to : minutes >= from) endsAt = today.to;
  }
  if (endsAt === null && yesterday !== undefined) {
    const from = minutesOf(yesterday.from);
    const to = minutesOf(yesterday.to);
    if (to <= from && minutes < to) endsAt = yesterday.to;
  }
  if (endsAt === null) return null;
  // The next time that clock shows the window's end: today, or tomorrow for one that runs past midnight.
  return nextRunAtOf({ frequency: 'daily', time: endsAt, dayOfWeek: null, dayOfMonth: null, timezone }, at);
}

/**
 * When a summary made at `at` is sent to a person: the next time their
 * chosen weekday and time come round on their own clock — or now, for a
 * person who chose none.
 */
export function digestAt(schedule: Pick<NotificationSchedule, 'timezone' | 'digestDay' | 'digestTime'> | null, fallbackZone: string | null | undefined, at: number): number {
  if (schedule === null || schedule.digestTime === null) return at;
  const timezone = zoneFor(schedule, fallbackZone);
  const next =
    schedule.digestDay === null
      ? nextRunAtOf({ frequency: 'daily', time: schedule.digestTime, dayOfWeek: null, dayOfMonth: null, timezone }, at - 60_000)
      : nextRunAtOf({ frequency: 'weekly', time: schedule.digestTime, dayOfWeek: schedule.digestDay, dayOfMonth: null, timezone }, at - 60_000);
  return next === null || next < at ? at : next;
}
