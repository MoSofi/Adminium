// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A chat's hours (`chat/hours.ts`), pure: in hours or not, when it closes,
 * when it opens next and how the window names that day; across a change to
 * and from summer time, a span past midnight, a day with no hours, "closed
 * until" today and later, and no hours at all.
 */
import { describe, expect, it } from 'vitest';

import { hoursAt, instantOfWall, knownZone, type WeeklyHours } from '../src/chat/hours.js';

const WEEKDAYS: WeeklyHours = { mon: [['09:00', '17:30']], tue: [['09:00', '17:30']], wed: [['09:00', '17:30']], thu: [['09:00', '17:30']], fri: [['09:00', '17:30']] };
const at = (iso: string) => Date.parse(iso);

describe("a chat's hours", () => {
  it('is open inside a span, and says when the span ends', () => {
    // Wednesday 18 November 2026, 10:00 in London (UTC in winter).
    const now = hoursAt({ hours: WEEKDAYS, closedUntil: null, timeZone: 'Europe/London' }, at('2026-11-18T10:00:00Z'));
    expect(now).toEqual({ open: true, closesAt: '2026-11-18T17:30:00.000Z', nextOpen: null });
  });

  it('after hours opens tomorrow; on Friday evening it opens Monday; a weekday is named within the week', () => {
    const zone = 'Europe/London';
    expect(hoursAt({ hours: WEEKDAYS, closedUntil: null, timeZone: zone }, at('2026-11-18T18:00:00Z')).nextOpen).toEqual({ at: '2026-11-19T09:00:00.000Z', date: '2026-11-19', time: '09:00', day: 'tomorrow' });
    expect(hoursAt({ hours: WEEKDAYS, closedUntil: null, timeZone: zone }, at('2026-11-20T18:00:00Z')).nextOpen).toEqual({ at: '2026-11-23T09:00:00.000Z', date: '2026-11-23', time: '09:00', day: 'mon' });
    // Before opening on a weekday: today.
    expect(hoursAt({ hours: WEEKDAYS, closedUntil: null, timeZone: zone }, at('2026-11-18T07:00:00Z')).nextOpen?.day).toBe('today');
  });

  it('reads the hours in the business zone: 09:00 in Berlin is 08:00 UTC in winter and 07:00 in summer', () => {
    const hours: WeeklyHours = { mon: [['09:00', '17:00']] };
    expect(hoursAt({ hours, closedUntil: null, timeZone: 'Europe/Berlin' }, at('2026-11-16T08:30:00Z')).open).toBe(true);
    expect(hoursAt({ hours, closedUntil: null, timeZone: 'Europe/Berlin' }, at('2026-11-16T07:30:00Z')).open).toBe(false);
    expect(hoursAt({ hours, closedUntil: null, timeZone: 'Europe/Berlin' }, at('2026-07-13T07:30:00Z')).open).toBe(true);
  });

  it('keeps its clock across the change to summer time and back', () => {
    // Clocks go forward in Berlin on Sunday 29 March 2026 at 02:00: a Monday span still opens at 09:00 local.
    const hours: WeeklyHours = { sun: [['10:00', '12:00']], mon: [['09:00', '17:00']] };
    const zone = 'Europe/Berlin';
    // Saturday evening before the change: next is Sunday 10:00 CEST = 08:00 UTC.
    expect(hoursAt({ hours, closedUntil: null, timeZone: zone }, at('2026-03-28T20:00:00Z')).nextOpen).toMatchObject({ at: '2026-03-29T08:00:00.000Z', time: '10:00', day: 'tomorrow' });
    // Back to winter time on Sunday 25 October 2026: Sunday 10:00 CET = 09:00 UTC.
    expect(hoursAt({ hours, closedUntil: null, timeZone: zone }, at('2026-10-24T20:00:00Z')).nextOpen).toMatchObject({ at: '2026-10-25T09:00:00.000Z', time: '10:00' });
    // A wall time the clocks skip lands the gap later, as calendars read it.
    expect(new Date(instantOfWall({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, zone)).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('a span past midnight is open after midnight, and closes the next morning', () => {
    const hours: WeeklyHours = { sat: [['22:00', '02:00']] };
    const zone = 'UTC';
    // Sunday 01:00, inside Saturday's span.
    expect(hoursAt({ hours, closedUntil: null, timeZone: zone }, at('2026-11-22T01:00:00Z'))).toEqual({ open: true, closesAt: '2026-11-22T02:00:00.000Z', nextOpen: null });
    expect(hoursAt({ hours, closedUntil: null, timeZone: zone }, at('2026-11-22T02:00:00Z')).open).toBe(false);
    // 24:00 is the end of the day, and a span that touches the next one runs on.
    const touching: WeeklyHours = { mon: [['20:00', '24:00']], tue: [['00:00', '03:00']] };
    expect(hoursAt({ hours: touching, closedUntil: null, timeZone: zone }, at('2026-11-16T23:00:00Z')).closesAt).toBe('2026-11-17T03:00:00.000Z');
  });

  it('a day with no hours is closed all day, and an empty week never opens', () => {
    const hours: WeeklyHours = { mon: [['09:00', '17:00']], tue: [] };
    expect(hoursAt({ hours, closedUntil: null, timeZone: 'UTC' }, at('2026-11-17T10:00:00Z')).open).toBe(false);
    expect(hoursAt({ hours: {}, closedUntil: null, timeZone: 'UTC' }, at('2026-11-17T10:00:00Z'))).toEqual({ open: false, closesAt: null, nextOpen: null });
  });

  it('no hours at all: always outside hours', () => {
    expect(hoursAt({ hours: null, closedUntil: null, timeZone: 'UTC' }, at('2026-11-18T10:00:00Z'))).toEqual({ open: false, closesAt: null, nextOpen: null });
  });

  it('"closed until" a day closes every day before it; on that day itself the week holds again', () => {
    const zone = 'Europe/London';
    // Closed until today: today's hours hold.
    expect(hoursAt({ hours: WEEKDAYS, closedUntil: '2026-11-18', timeZone: zone }, at('2026-11-18T10:00:00Z')).open).toBe(true);
    // Closed until tomorrow: shut today, and opening tomorrow.
    const tomorrow = hoursAt({ hours: WEEKDAYS, closedUntil: '2026-11-19', timeZone: zone }, at('2026-11-18T10:00:00Z'));
    expect(tomorrow.open).toBe(false);
    expect(tomorrow.nextOpen).toMatchObject({ date: '2026-11-19', day: 'tomorrow' });
    // Closed until a day weeks away: named by its date.
    const later = hoursAt({ hours: WEEKDAYS, closedUntil: '2027-01-04', timeZone: zone }, at('2026-11-18T10:00:00Z'));
    expect(later.nextOpen).toEqual({ at: '2027-01-04T09:00:00.000Z', date: '2027-01-04', time: '09:00', day: 'date' });
  });

  it('a zone this runtime does not know is UTC', () => {
    expect(knownZone('Mars/Olympus')).toBe('UTC');
    expect(knownZone(null)).toBe('UTC');
    expect(knownZone('Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});
