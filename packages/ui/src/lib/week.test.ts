// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { dayKey, firstDayOfWeek, monthGrid, weekdayInitials } from './week.js';

describe('where the week starts', () => {
  it('answers the locale, not the machine', () => {
    // A product that always started weeks on Monday would be wrong in the US
    // and in Egypt in two different directions.
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('de-DE')).toBe(1);
    expect(firstDayOfWeek(undefined)).toBe(0);
  });

  it('names the days in the reader’s own language, starting on their day', () => {
    expect(weekdayInitials('en-US')).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    expect(weekdayInitials('de-DE')[0]).toBe('M');
    // Two days sharing a letter is the locale's answer, not a defect: the
    // column position is what tells Tuesday from Thursday.
    expect(new Set(weekdayInitials('en-US')).size).toBe(5);
  });
});

describe('the month grid', () => {
  it('leads with blanks up to the first of the month', () => {
    // 1 September 2026 is a TUESDAY — the comp puts it on a Wednesday, which
    // is the defect DP6 refuses to copy.
    const cells = monthGrid(2026, 8, 'de-DE');
    expect(cells[0]).toBeNull();
    expect(cells[1]).not.toBeNull();
    expect(dayKey(cells[1] as Date)).toBe('2026-09-01');
  });

  it('shifts those blanks when the week starts on Sunday', () => {
    const cells = monthGrid(2026, 8, 'en-US');
    expect(cells.slice(0, 2).every((cell) => cell === null)).toBe(true);
    expect(dayKey(cells[2] as Date)).toBe('2026-09-01');
  });

  it('is always a rectangle, so nothing below it jumps', () => {
    for (const month of [0, 1, 5, 11]) {
      expect(monthGrid(2026, month, 'en-US').length % 7).toBe(0);
    }
    // February 2027 starts on a Monday and has 28 days: in a Monday locale it
    // is exactly four rows, which is the case a hardcoded 35 gets wrong.
    expect(monthGrid(2027, 1, 'de-DE')).toHaveLength(28);
  });

  it('holds every day of the month, once', () => {
    const days = monthGrid(2026, 8, 'en-US').filter((cell): cell is Date => cell !== null);
    expect(days).toHaveLength(30);
    expect(new Set(days.map(dayKey)).size).toBe(30);
  });

  it('keys a day in the reader’s zone, never through UTC', () => {
    // `toISOString` on a local midnight west of Greenwich is the PREVIOUS day.
    expect(dayKey(new Date(2026, 8, 17))).toBe('2026-09-17');
  });
});
