// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When a text may go.
 *
 *   service    the business's hours on its own clock, 08:00 to 21:00 unless edited.
 *              With no clock set (or one that cannot be read), the hours must
 *              be open in EVERY time zone of the destination country, as
 *              marketing's are: never UTC, which puts a Seattle reminder at
 *              midnight
 *   waiting    any time: the customer is waiting for this message now
 *   marketing  09:00 to 20:00, Monday to Saturday, in EVERY time zone of the
 *              destination country at once
 *
 * The maths is the staff quiet-hours maths: a window is the quiet stretch
 * between its close and its next open, so midnight and both daylight-saving
 * changes are handled in one place.
 *
 * A text about a moment (a reminder of a visit) is never held past it. When
 * the window would open only at or after that moment, the text is skipped.
 */
import type { NotificationQuiet } from '@adminium/meta';

import { quietUntil, usableZone } from '../../notifications/quiet.js';
import type { TextTiming } from './types.js';

export interface DailyHours {
  /** `HH:mm`. */
  from: string;
  to: string;
}

export const MARKETING_HOURS: Readonly<DailyHours> = { from: '09:00', to: '20:00' };

/** How far ahead a window is looked for. */
const SEARCH_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_STEPS = 64;
/** The longest a clock change can repeat, with room to spare. */
const MAX_REPEATED_MINUTES = 180;

const WEEKDAYS = ['0', '1', '2', '3', '4', '5', '6'] as const;

function quietOf(hours: DailyHours): NotificationQuiet {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, { from: hours.to, to: hours.from }]));
}

/** Monday to Saturday: Saturday's close runs to Sunday's open hour, and Sunday stays quiet from there to Monday's. */
function marketingQuiet(): NotificationQuiet {
  return { ...quietOf(MARKETING_HOURS), '0': { from: MARKETING_HOURS.from, to: MARKETING_HOURS.from } };
}

/** The IANA zones of a country; empty when this runtime cannot say. */
export function zonesOfCountry(country: string): string[] {
  try {
    const locale = new Intl.Locale(`und-${country}`) as Intl.Locale & { getTimeZones?: () => string[]; timeZones?: string[] };
    const zones = locale.getTimeZones?.() ?? locale.timeZones ?? [];
    return zones.filter((zone) => usableZone(zone) !== null);
  } catch {
    return [];
  }
}

/**
 * Out of a quiet stretch whose end the maths names in the past. When the clock
 * goes back, a repeated hour can read as quiet while the "next" end is the one
 * the first pass already reached, so the clock itself is read, minute by minute.
 */
function pastRepeatedHour(zone: string, quiet: NotificationQuiet, moment: number): number {
  let next = moment - (moment % 60_000) + 60_000;
  for (let minute = 0; minute < MAX_REPEATED_MINUTES; minute += 1, next += 60_000) {
    const end = quietUntil({ timezone: zone, quiet }, zone, next);
    if (end === null) return next;
    if (end > next) return end;
  }
  return next;
}

/** The first moment at or after `at` when every zone is out of its quiet stretch; null when none comes soon. */
function firstOpen(zones: readonly string[], quiet: NotificationQuiet, at: number): number | null {
  let moment = at;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    let moved = false;
    for (const zone of zones) {
      const end = quietUntil({ timezone: zone, quiet }, zone, moment);
      if (end === null) continue;
      moment = end > moment ? end : pastRepeatedHour(zone, quiet, moment);
      moved = true;
    }
    if (!moved) return moment;
    if (moment - at > SEARCH_MS) return null;
  }
  return null;
}

export interface WindowQuestion {
  timing: TextTiming;
  at: number;
  /** The business's clock. None, or one that cannot be read: the destination country's zones. */
  zone: string | null;
  /** The destination's country: its zones for marketing, and for service when the business has no clock. */
  country: string;
  serviceHours: DailyHours;
  /** The moment this text is about, if any. */
  notAfter: number | null;
}

export type WindowVerdict = { go: true } | { go: false; until: number } | { go: false; skip: 'past-its-moment' | 'no-send-window' };

export function judgeWindow(question: WindowQuestion): WindowVerdict {
  const { timing, at, notAfter } = question;
  if (notAfter !== null && at >= notAfter) return { go: false, skip: 'past-its-moment' };
  if (timing === 'waiting') return { go: true };

  const own = question.zone === null ? null : usableZone(question.zone);
  const zones = timing === 'marketing' || own === null ? zonesOfCountry(question.country) : [own];
  if (zones.length === 0) return { go: false, skip: 'no-send-window' };
  const opens = firstOpen(zones, timing === 'marketing' ? marketingQuiet() : quietOf(question.serviceHours), at);
  if (opens === null) return { go: false, skip: 'no-send-window' };
  if (opens === at) return { go: true };
  if (notAfter !== null && opens >= notAfter) return { go: false, skip: 'past-its-moment' };
  return { go: false, until: opens };
}
