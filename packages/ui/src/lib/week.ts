// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE THE WEEK STARTS, and what the days are called.
 *
 * Two products in this repo need the same answer — the quick-create date pills
 * and the month calendar — and two copies of it is how one screen puts Monday
 * first while the screen beside it puts Sunday there. It lives here, in the
 * package both of them already depend on.
 */

/**
 * The reader's first day of the week, as `Date#getDay` counts (Sunday = 0).
 *
 * `Intl.Locale`'s week info answers it where the runtime has it; Monday is the
 * fallback, because it is what the ISO calendar says and what most of the
 * world's locales use.
 */
export function firstDayOfWeek(locale: string | undefined): number {
  try {
    const info = new Intl.Locale(locale ?? 'en-US') as unknown as {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    // `Intl` counts Monday as 1 … Sunday as 7; `Date#getDay` counts Sunday as 0.
    if (typeof first === 'number') return first % 7;
  } catch {
    /* an older runtime, or a locale it does not know */
  }
  return 1;
}

/**
 * The seven weekday initials, starting where this reader's week does.
 *
 * `narrow` is the one-letter form every locale defines — and in several of
 * them two days share a letter (English's T and S, the comp's own `M T W T F S
 * S`), which is correct rather than a bug: the column position is what
 * disambiguates, and inventing a second letter would be inventing a locale.
 */
export function weekdayInitials(locale: string | undefined): string[] {
  const first = firstDayOfWeek(locale);
  const format = new Intl.DateTimeFormat(locale ?? 'en-US', { weekday: 'narrow' });
  // 2026-02-01 is a Sunday, so `getDay()` and the offset line up with no
  // arithmetic about which epoch day was which.
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(Date.UTC(2026, 1, 1 + ((first + index) % 7)))),
  );
}

/**
 * The cells of a month grid: leading blanks for the days before the 1st, then
 * every day of the month.
 *
 * Returned as `null` for a blank rather than as a Date outside the month,
 * because the comp draws those cells empty (634–652) and a caller that had a
 * date in hand would sooner or later render it.
 */
export function monthGrid(year: number, month: number, locale: string | undefined): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - firstDayOfWeek(locale) + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(new Date(year, month, day));
  // Fill the last row, so the grid is a rectangle and the legend below it does
  // not jump a line between a 28-day month and a 31-day one.
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** `YYYY-MM-DD` for a Date, in the reader's own zone — never `toISOString`. */
export function dayKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
