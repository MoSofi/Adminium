// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The count `addWorkingDays` makes, on its own: the received day (a working
 * day, before the cut-off), the days after it, the closures skipped, and how
 * a week and a cut-off are read from a setting.
 */
import { describe, expect, it } from 'vitest';

import { cutoffMinutes, workingDayAfter, workingWeek, type WorkingCalendar } from '../src/crud/working-days.js';

const MON_FRI = new Set([1, 2, 3, 4, 5]);
const calendar = (more: Partial<WorkingCalendar> = {}): WorkingCalendar => ({ weekdays: MON_FRI, cutoff: 14 * 60, closed: new Set(), ...more });
const LAST = '2027-12-31';
const due = (day: string, minute: number | null, days: number, more: Partial<WorkingCalendar> = {}) => workingDayAfter(day, minute, days, calendar(more), LAST)?.due ?? null;

describe('working days', () => {
  it('receives an order on its day before the cut-off, and on the next working day after it', () => {
    // Friday 7 August 2026.
    expect(workingDayAfter('2026-08-07', 13 * 60 + 59, 3, calendar(), LAST)).toEqual({ received: '2026-08-07', due: '2026-08-12' });
    expect(workingDayAfter('2026-08-07', 14 * 60, 3, calendar(), LAST)).toEqual({ received: '2026-08-10', due: '2026-08-13' });
    expect(workingDayAfter('2026-08-07', 14 * 60 + 1, 3, calendar(), LAST)).toEqual({ received: '2026-08-10', due: '2026-08-13' });
    // A Saturday morning: received Monday.
    expect(due('2026-08-08', 10 * 60, 3)).toBe('2026-08-13');
  });

  it('counts zero days as the received day, and a date with no time as before the cut-off', () => {
    expect(due('2026-08-05', 10 * 60, 0)).toBe('2026-08-05');
    expect(due('2026-08-07', 15 * 60, 0)).toBe('2026-08-10');
    expect(due('2026-08-07', null, 1)).toBe('2026-08-10');
    // No cut-off at all: any time that day.
    expect(due('2026-08-07', 23 * 60 + 59, 1, { cutoff: null })).toBe('2026-08-10');
  });

  it('skips a closed day, and a closure on the day itself moves the received day', () => {
    expect(due('2026-08-07', 13 * 60, 3, { closed: new Set(['2026-08-10']) })).toBe('2026-08-13');
    expect(workingDayAfter('2026-08-05', 10 * 60, 3, calendar({ closed: new Set(['2026-08-05']) }), LAST)).toEqual({ received: '2026-08-06', due: '2026-08-11' });
  });

  it('takes the week it is given: Monday to Saturday', () => {
    expect(due('2026-08-07', 14 * 60 + 1, 3, { weekdays: new Set([1, 2, 3, 4, 5, 6]) })).toBe('2026-08-12');
  });

  it('gives no date when the count walks past the last day it read closures to', () => {
    expect(workingDayAfter('2026-08-07', 9 * 60, 3, calendar(), '2026-08-11')).toBeNull();
    expect(workingDayAfter('2026-08-07', 9 * 60, 2, calendar(), '2026-08-11')).toEqual({ received: '2026-08-07', due: '2026-08-11' });
  });

  it('reads a week and a cut-off the way a setting spells them, and nothing else', () => {
    expect(workingWeek('mon,tue,wed,thu,fri')).toEqual(MON_FRI);
    expect(workingWeek('Mon Tue Wed Thu Fri Sat')).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(workingWeek(['sat', 'sun'])).toEqual(new Set([0, 6]));
    expect(workingWeek('')).toBeNull();
    expect(workingWeek('someday')).toBeNull();
    expect(workingWeek(null)).toBeNull();
    expect(cutoffMinutes('14:00')).toBe(840);
    expect(cutoffMinutes('00:00')).toBe(0);
    expect(cutoffMinutes('9:30')).toBeNull();
    expect(cutoffMinutes('24:00')).toBeNull();
    expect(cutoffMinutes(1400)).toBeNull();
  });
});
