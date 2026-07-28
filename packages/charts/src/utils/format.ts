/** Compact numeral formatting for axis/legend labels ("1.2k", "3.4M"). */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}k`;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(1)));
}

function trim(scaled: number): string {
  const fixed = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

// Intl.DateTimeFormat construction is expensive; axes/calendars call these in
// per-point loops, so formatters and derived name arrays are cached per locale.
const shortDateFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayNameCache = new Map<string, readonly string[]>();
const monthNameCache = new Map<string, readonly string[]>();

/**
 * Short month-day label for time axes. Derived via `Intl.DateTimeFormat` in the
 * given locale (default `en-US`, whose output is byte-identical to the previous
 * hardcoded English: "Mar 4"). UTC-pinned like the rest of the chart math.
 */
export function formatShortDate(date: Date, locale = 'en-US'): string {
  let formatter = shortDateFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    shortDateFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}

/**
 * Short weekday names indexed 0=Sun..6=Sat for the given locale — the
 * calendar-grid label default (NOT bundle keys; 10 §4 date names come from
 * Intl). `en-US` output is byte-identical to the previous hardcoded arrays:
 * Sun, Mon, Tue, Wed, Thu, Fri, Sat.
 */
export function shortWeekdayNames(locale = 'en-US'): readonly string[] {
  let names = weekdayNameCache.get(locale);
  if (names === undefined) {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    // 2023-01-01 was a Sunday; day i of that week has weekday index i.
    names = Array.from({ length: 7 }, (_, i) => formatter.format(new Date(Date.UTC(2023, 0, 1 + i))));
    weekdayNameCache.set(locale, names);
  }
  return names;
}

/**
 * Short month names indexed 0=Jan..11=Dec for the given locale — same Intl
 * derivation contract as {@link shortWeekdayNames}; `en-US` output is
 * byte-identical to the previous hardcoded arrays: Jan..Dec.
 */
export function shortMonthNames(locale = 'en-US'): readonly string[] {
  let names = monthNameCache.get(locale);
  if (names === undefined) {
    const formatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    names = Array.from({ length: 12 }, (_, month) => formatter.format(new Date(Date.UTC(2023, month, 1))));
    monthNameCache.set(locale, names);
  }
  return names;
}
