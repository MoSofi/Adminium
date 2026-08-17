// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Formatter layer tests (10-i18n-theming.md §4): per-locale separators, the
 * §4.2 numeral policy (latn digits in data context everywhere incl. ar_EG;
 * Arabic-Indic digits in ar_EG prose), currency-from-data, relative-time
 * thresholds, lists, and weekInfo fallbacks.
 */
import { describe, expect, it } from 'vitest';

import { getFormatters, weekInfo } from './index.js';

/** Normalizes NBSP / narrow NBSP so assertions are readable. */
function plain(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, ' ');
}

const ARABIC_DIGITS = /[٠-٩]/;

describe('number formatting', () => {
  it('localizes group/decimal separators per locale', () => {
    expect(getFormatters('en-US').number(1234567.89)).toBe('1,234,567.89');
    expect(getFormatters('de-DE').number(1234567.89)).toBe('1.234.567,89');
    expect(plain(getFormatters('fr-FR').number(1234567.89))).toBe('1 234 567,89');
    expect(plain(getFormatters('cs-CZ').number(1234567.89))).toBe('1 234 567,89');
  });

  it('data context forces Latin digits in ar-EG (mono cells stay aligned)', () => {
    const value = getFormatters('ar-EG').number(1234.5);
    expect(ARABIC_DIGITS.test(value)).toBe(false);
    expect(value).toContain('1');
  });

  it('prose context renders Arabic-Indic digits in ar-EG', () => {
    const value = getFormatters('ar-EG').number(1234.5, { ctx: 'prose' });
    expect(ARABIC_DIGITS.test(value)).toBe(true);
  });

  it('compact and percent honor the context default (data)', () => {
    expect(getFormatters('en-US').compact(24500)).toBe('24.5K');
    expect(getFormatters('en-US').percent(0.42)).toBe('42%');
    expect(ARABIC_DIGITS.test(getFormatters('ar-EG').percent(0.42))).toBe(false);
  });
});

describe('currency (§4.4: code from data, format from viewer locale)', () => {
  it('formats USD with German separators for a de-DE viewer', () => {
    const value = plain(getFormatters('de-DE').currency(4120, 'USD'));
    expect(value).toContain('4.120,00');
    expect(value).toMatch(/\$/);
  });

  it('formats USD conventionally for en-US', () => {
    expect(getFormatters('en-US').currency(4120, 'USD')).toBe('$4,120.00');
  });
});

describe('bytes', () => {
  it('renders Intl unit style', () => {
    expect(getFormatters('en-US').bytes(1_200_000)).toBe('1.2 MB');
    expect(getFormatters('en-US').bytes(532)).toBe('532 byte');
  });
});

describe('dates', () => {
  const d = new Date(Date.UTC(2026, 6, 12, 12, 0, 0));

  it('localizes date styles', () => {
    expect(getFormatters('de-DE').date(d, 'short', { timeZone: 'UTC' })).toBe('12.07.26');
    expect(getFormatters('en-US').date(d, 'short', { timeZone: 'UTC' })).toBe('7/12/26');
  });

  it('pins latn digits + gregorian calendar for ar-EG data context', () => {
    const value = getFormatters('ar-EG').date(d, 'short', { timeZone: 'UTC' });
    expect(ARABIC_DIGITS.test(value)).toBe(false);
  });

  it('formats ranges collapsing shared parts', () => {
    const range = getFormatters('en-US').dateRange(
      new Date(Date.UTC(2026, 6, 1)),
      new Date(Date.UTC(2026, 6, 12)),
    );
    expect(plain(range)).toContain('Jul 1');
    expect(plain(range)).toContain('12');
  });
});

describe('relative time (§4.5 thresholds)', () => {
  const now = Date.UTC(2026, 6, 12, 12, 0, 0);
  const fmt = getFormatters('en-US');

  it('collapses <45s to "now"', () => {
    expect(fmt.relative(now - 20_000, { now })).toBe('now');
  });

  it('uses minutes below 90 min and hours below 22 h', () => {
    expect(fmt.relative(now - 5 * 60_000, { now })).toBe('5 minutes ago');
    expect(fmt.relative(now - 3 * 3_600_000, { now })).toBe('3 hours ago');
  });

  it('falls back to an absolute date past ~26 days', () => {
    const value = fmt.relative(now - 40 * 86_400_000, { now });
    expect(value).toMatch(/2026/);
  });
});

describe('lists and collation', () => {
  it('joins per locale conventions', () => {
    expect(getFormatters('en-US').list(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(getFormatters('de-DE').list(['a', 'b', 'c'])).toBe('a, b und c');
  });

  it('collator sorts numerically', () => {
    const c = getFormatters('en-US').collator();
    expect(['item10', 'item2'].sort(c.compare)).toEqual(['item2', 'item10']);
  });
});

describe('weekInfo', () => {
  it('returns locale week starts (Intl or static fallback)', () => {
    expect(weekInfo('en-US').firstDay).toBe(7);
    expect(weekInfo('de-DE').firstDay).toBe(1);
    expect(weekInfo('ar-EG').firstDay).toBe(6);
  });

  it('falls back to Monday for unknown tags', () => {
    expect(weekInfo('xx-XX').firstDay).toBe(1);
  });
});

describe('memoization', () => {
  it('returns the same Formatters object per tag', () => {
    expect(getFormatters('da-DK')).toBe(getFormatters('da-DK'));
  });
});

describe('empty / invalid tag coalescing', () => {
  it('never throws for an empty, whitespace, or malformed tag (falls back to en-US)', () => {
    for (const tag of ['', '   ', 'not a tag', '@@']) {
      expect(() => getFormatters(tag).number(1234)).not.toThrow();
      expect(getFormatters(tag).number(1234)).toBe(getFormatters('en-US').number(1234));
    }
  });
});
