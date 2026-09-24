// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sender below its database: which addresses are never mailed, and how a
 * time reads in a person's language on the venue's clock.
 */
import { describe, expect, it } from 'vitest';

import { reservedAddress, valueForms } from '../src/outbox/sender.js';

describe('reserved addresses', () => {
  it('are the ones kept for examples and tests', () => {
    for (const address of ['sam@example.com', 'a@example.org', 'a@EXAMPLE.co.uk', 'a@x.test', 'a@shop.invalid', 'a@host.localhost', 'a@site.example', 'a@example.com.']) {
      expect(reservedAddress(address)).toBe(true);
    }
    for (const address of ['ada@hill.dev', 'a@myexample.com', 'a@example-clinic.com', 'a@tests.org', 'a@mail.example-mail.net']) {
      expect(reservedAddress(address)).toBe(false);
    }
  });
});

describe('a time in a person’s language, on the venue’s clock', () => {
  // Tuesday 28 July 2026, 23:30 in London (22:30 UTC): the venue's "today" is the 28th.
  const now = Date.UTC(2026, 6, 28, 22, 30);
  const forms = valueForms({ locale: 'en_GB', zone: 'Europe/London', currency: 'GBP', now });

  it('says today and tomorrow by the venue’s day, not UTC’s', () => {
    // 23:45 London is still today there, though it is the same UTC day; 00:15 is tomorrow.
    expect(forms.instant('v', new Date(Date.UTC(2026, 6, 28, 22, 45)))['v.relative_day']).toBe('today');
    expect(forms.instant('v', new Date(Date.UTC(2026, 6, 28, 23, 15)))['v.relative_day']).toBe('tomorrow');
    // Within the week, a weekday; further, the day and month.
    expect(forms.instant('v', new Date(Date.UTC(2026, 6, 31, 9, 0)))['v.relative_day']).toBe('Friday');
    expect(forms.instant('v', new Date(Date.UTC(2026, 7, 12, 9, 0)))['v.relative_day']).toBe('12 August');
  });

  it('gives every form of a time, and a range', () => {
    const at = new Date(Date.UTC(2026, 6, 29, 9, 0));
    expect(forms.instant('a.starts_at', at)).toEqual({
      'a.starts_at': new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' }).format(at),
      'a.starts_at.date': new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'Europe/London' }).format(at),
      'a.starts_at.time': '10:00',
      'a.starts_at.day_month': '29 July',
      'a.starts_at.relative_day': 'tomorrow',
    });
    expect(forms.range(at, new Date(at.getTime() + 15 * 60_000))).toBe(new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: 'Europe/London' }).formatRange(at, new Date(at.getTime() + 15 * 60_000)));
    // A driver's spelling of a stored time reads the same.
    expect(forms.instant('b', '2026-07-29T09:00:00.000Z')['b.time']).toBe('10:00');
  });

  it('keeps a calendar day on its day whatever the clock, and money in the currency', () => {
    const day = forms.day('r.due_on', '2026-08-01');
    expect(day['r.due_on']).toMatch(/^Saturday,? 1 August 2026$/);
    expect(day['r.due_on.day_month']).toBe('1 August');
    // A driver's midnight Date is the same calendar day.
    expect(forms.day('r.due_on', new Date(2026, 7, 1))['r.due_on.day_month']).toBe('1 August');
    expect(forms.day('r.due_on', 'not a day')).toEqual({});
    expect(forms.money('40')).toBe('£40.00');
    expect(valueForms({ locale: 'de_DE', zone: 'UTC', currency: null, now }).money(40)).toBe('40,00');
  });
});
