// SPDX-License-Identifier: AGPL-3.0-only
/** The sync's small decisions: a name in someone's calendar, which busy times count, and what a clash is. */
import { describe, expect, it } from 'vitest';

import { busyHash, countedBusy, deriveClashes, detailWithin, eventKey, eventTitle, lastReadDay, mergeSpans, nextPollDelay, shortName, withoutOwnEvents } from '../src/calendar-sync/rules.js';

const ZONE = 'America/Los_Angeles';
const at = (iso: string) => Date.parse(iso);

describe('a name in a staff calendar', () => {
  it.each([
    ['Ava Reyes', 'Ava R.'],
    ['Cher', 'Cher'],
    ['María José de la Cruz', 'María C.'],
    ['  Ivy   Chen  ', 'Ivy C.'],
    ['Élodie Ångström', 'Élodie Å.'],
    ['', null],
    [null, null],
  ])('%s', (full, short) => {
    expect(shortName(full)).toBe(short);
  });

  it('writes the service alone when the detail is none, and says whether it holds a name', () => {
    expect(eventTitle('Gel Manicure', 'Ava Reyes', 'first-name+initial')).toEqual({ title: 'Gel Manicure — Ava R.', named: true });
    expect(eventTitle('Gel Manicure', 'Ava Reyes', 'none')).toEqual({ title: 'Gel Manicure', named: false });
    expect(eventTitle('Gel Manicure', null, 'first-name+initial')).toEqual({ title: 'Gel Manicure', named: false });
    expect(eventTitle(null, null, 'none')).toEqual({ title: 'Booking', named: false });
  });

  it('never lets a person choose more than the rule allows', () => {
    expect(detailWithin('first-name+initial', 'none')).toBe('none');
    expect(detailWithin('none', 'first-name+initial')).toBe('none');
    expect(detailWithin('first-name+initial', 'first-name+initial')).toBe('first-name+initial');
  });

  it('mints a key only a calendar id alphabet can hold, new for each generation', () => {
    const one = eventKey({ connectionId: 'c', tableName: 't', rowKey: '1', accountId: 'a', generation: 1 });
    expect(one).toMatch(/^[0-9a-f]{40}$/);
    expect(eventKey({ connectionId: 'c', tableName: 't', rowKey: '1', accountId: 'a', generation: 2 })).not.toBe(one);
    expect(eventKey({ connectionId: 'c', tableName: 't', rowKey: '1', accountId: 'b', generation: 1 })).not.toBe(one);
  });
});

describe('which busy times count', () => {
  const window = { from: at('2026-10-31T07:00:00Z'), to: at('2026-11-03T08:00:00Z') };

  it('counts busy and away, and nothing else', () => {
    const spans = countedBusy(
      (['busy', 'away', 'tentative', 'free', 'elsewhere'] as const).map((kind, i) => ({ allDay: false as const, start: `2026-11-02T1${String(i)}:00:00Z`, end: `2026-11-02T1${String(i)}:30:00Z`, kind })),
      { countAllDay: false, zone: ZONE, ...window },
    );
    expect(spans).toEqual([{ start: at('2026-11-02T10:00:00Z'), end: at('2026-11-02T10:30:00Z') }, { start: at('2026-11-02T11:00:00Z'), end: at('2026-11-02T11:30:00Z') }]);
  });

  it('skips an all-day time unless it is ticked, and makes it the venue\'s day, 25 hours on the day the clocks go back', () => {
    const interval = [{ allDay: true as const, date: '2026-11-01', endDate: '2026-11-02', kind: 'busy' as const }];
    expect(countedBusy(interval, { countAllDay: false, zone: ZONE, ...window })).toEqual([]);
    const [day] = countedBusy(interval, { countAllDay: true, zone: ZONE, ...window });
    expect(day).toEqual({ start: at('2026-11-01T07:00:00Z'), end: at('2026-11-02T08:00:00Z') });
    expect(day!.end - day!.start).toBe(25 * 3_600_000);
  });

  it('counts a time whose all-day mark is unknown, whatever the tick says', () => {
    const interval = [{ allDay: 'unknown' as const, start: '2026-11-02T08:00:00Z', end: '2026-11-03T08:00:00Z', kind: 'busy' as const }];
    expect(countedBusy(interval, { countAllDay: false, zone: ZONE, ...window })).toHaveLength(1);
  });

  it('cuts to the window, merges what touches, and drops nonsense', () => {
    const spans = countedBusy(
      [
        { allDay: false, start: '2026-10-30T00:00:00Z', end: '2026-10-31T08:00:00Z', kind: 'busy' },
        { allDay: false, start: '2026-10-31T08:00:00Z', end: '2026-10-31T09:00:00Z', kind: 'busy' },
        { allDay: false, start: '2026-11-02T12:00:00Z', end: '2026-11-02T11:00:00Z', kind: 'busy' },
      ],
      { countAllDay: false, zone: ZONE, ...window },
    );
    expect(spans).toEqual([{ start: window.from, end: at('2026-10-31T09:00:00Z') }]);
  });

  it('merges and hashes the same whichever order they came in', () => {
    const a = { start: 1, end: 3 };
    const b = { start: 2, end: 5 };
    const c = { start: 9, end: 10 };
    expect(mergeSpans([c, b, a])).toEqual([{ start: 1, end: 5 }, c]);
    expect(busyHash(mergeSpans([a, b, c]))).toBe(busyHash(mergeSpans([c, b, a])));
  });

  it('spreads polls over ten minutes, give or take a quarter', () => {
    expect(nextPollDelay(() => 0)).toBe(450_000);
    expect(nextPollDelay(() => 1)).toBe(750_000);
  });
});

describe('a clash', () => {
  const booking = { rowKey: '1', resource: '7', start: 100, end: 200 };

  it('is the overlap, clipped to the booking', () => {
    expect(deriveClashes([booking], new Map([['7', [{ start: 50, end: 150 }]]]))).toEqual([{ rowKey: '1', resource: '7', overlapStart: 100, overlapEnd: 150 }]);
  });

  it('keeps its key when a busy block grows outside the booking', () => {
    const before = deriveClashes([booking], new Map([['7', [{ start: 50, end: 150 }]]]));
    const after = deriveClashes([booking], new Map([['7', [{ start: 10, end: 150 }]]]));
    expect(after).toEqual(before);
  });

  it('changes its key when the overlap inside the booking changes', () => {
    const before = deriveClashes([booking], new Map([['7', [{ start: 50, end: 150 }]]]));
    const after = deriveClashes([booking], new Map([['7', [{ start: 50, end: 160 }]]]));
    expect(after[0]!.overlapEnd).not.toBe(before[0]!.overlapEnd);
  });

  it('is one clash for two blocks that touch inside the booking', () => {
    expect(deriveClashes([booking], new Map([['7', [{ start: 110, end: 130 }, { start: 130, end: 140 }]]]))).toHaveLength(1);
  });

  it('ignores another person\'s time', () => {
    expect(deriveClashes([booking], new Map([['8', [{ start: 100, end: 200 }]]]))).toEqual([]);
  });

  it('a meeting that covers the whole booking is a clash', () => {
    expect(deriveClashes([booking], new Map([['7', [{ start: 50, end: 300 }]]]))).toEqual([{ rowKey: '1', resource: '7', overlapStart: 100, overlapEnd: 200 }]);
  });
});

describe('what a read leaves out, and how far it goes', () => {
  const timed = (start: string, end: string) => ({ allDay: false as const, start, end, kind: 'busy' as const });

  it('leaves out only a time that is exactly one of the person\'s own events', () => {
    const own = [{ start: at('2026-10-05T17:00:00Z'), end: at('2026-10-05T18:00:00Z') }];
    const echo = timed('2026-10-05T17:00:00Z', '2026-10-05T18:00:00Z');
    const longer = timed('2026-10-05T16:00:00Z', '2026-10-05T19:00:00Z');
    expect(withoutOwnEvents([echo, longer], own)).toEqual([longer]);
    const allDay = { allDay: true as const, date: '2026-10-05', endDate: '2026-10-06', kind: 'busy' as const };
    expect(withoutOwnEvents([allDay], own)).toEqual([allDay]);
  });

  it('reads two days past the last bookable day, inside the longest window one swap holds', () => {
    expect(lastReadDay('2026-09-15', '2026-10-19', 400)).toBe('2026-10-21');
    expect(lastReadDay('2026-09-15', '2027-10-20', 400)).toBe('2027-10-19');
  });
});
