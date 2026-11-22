// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A day someone may ask a booking calendar about: a real date, in years a
 * calendar can mean. The guard counts days from today, so a date in year 9999
 * is work and not a question.
 */
import { z } from 'zod';

const FIRST_YEAR = 1970;
const LAST_YEAR = 2200;

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < FIRST_YEAR || year > LAST_YEAR) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export const calendarDay = z.string().refine(isCalendarDay, 'Not a date.');
