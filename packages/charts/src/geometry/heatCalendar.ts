/**
 * Pure GitHub-style contribution-calendar geometry (research/widget-registry.md
 * §2 `chart-heatmap-calendar`): up to 53 week columns × 7 day rows of per-day
 * counts, discrete intensity levels, a less→more legend. DOM-free and
 * deterministic (04 §7.1) — UTC-only date math, no `Date.now()`.
 *
 * RTL policy (04 §7.4, explicit): the week columns run right→left under `rtl`
 * (newest week on the inline-start edge); the day rows never move.
 */
import { heatLevel } from './heat.js';

const DAY_MS = 86_400_000;

export interface HeatDay {
  weekIndex: number;
  dayIndex: number;
  x: number;
  y: number;
  size: number;
  /** UTC midnight of the day. */
  date: Date;
  /** ISO date key (YYYY-MM-DD). */
  key: string;
  value: number;
  level: number;
}

export interface HeatCalendarLayout {
  days: HeatDay[];
  weeks: number;
  /** Day-of-week row order actually used (0=Sun..6=Sat), rotated by startWeekday. */
  weekdayRows: number[];
  maxValue: number;
  width: number;
  height: number;
}

export interface HeatCalendarOptions {
  /** Number of week columns (default 53). */
  weeks?: number;
  /** First weekday of the column, 0=Sun..6=Sat (locale-aware). Default 0. */
  startWeekday?: number;
  cellSize?: number;
  gap?: number;
  /** Intensity levels incl. 0 (default 5). */
  levels?: number;
  rtl?: boolean;
}

/** UTC midnight for an ISO/date input; invalid → null. */
function utcMidnight(input: string | number | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface HeatPoint {
  t: string | number | Date;
  v: number;
}

/**
 * Lay out daily counts into a week×day grid ending at the latest point's week.
 * Days after the latest point (future cells in the final week) are omitted.
 */
export function heatCalendarLayout(
  points: readonly HeatPoint[],
  options: HeatCalendarOptions = {},
): HeatCalendarLayout {
  const { weeks = 53, startWeekday = 0, cellSize = 12, gap = 3, levels = 5, rtl = false } = options;
  const step = cellSize + gap;

  const counts = new Map<string, number>();
  let end: Date | null = null;
  let maxValue = 0;
  for (const point of points) {
    const date = utcMidnight(point.t);
    if (date === null) continue;
    const key = isoKey(date);
    const v = Number.isFinite(point.v) ? point.v : 0;
    counts.set(key, v);
    if (v > maxValue) maxValue = v;
    if (end === null || date.getTime() > end.getTime()) end = date;
  }
  const endDate = end ?? new Date(Date.UTC(1970, 0, 1));

  // Row index of a date within a column that starts on `startWeekday`.
  const rowOf = (date: Date): number => (date.getUTCDay() - startWeekday + 7) % 7;
  const endRow = rowOf(endDate);

  const days: HeatDay[] = [];
  for (let col = 0; col < weeks; col += 1) {
    for (let row = 0; row < 7; row += 1) {
      // Days back from the end date: whole weeks + within-week row delta.
      const daysFromEnd = (weeks - 1 - col) * 7 + (endRow - row);
      if (daysFromEnd < 0) continue; // future cell in the final week
      const date = new Date(endDate.getTime() - daysFromEnd * DAY_MS);
      const key = isoKey(date);
      const value = counts.get(key) ?? 0;
      days.push({
        weekIndex: col,
        dayIndex: row,
        x: (rtl ? weeks - 1 - col : col) * step,
        y: row * step,
        size: cellSize,
        date,
        key,
        value,
        level: heatLevel(value, maxValue, levels),
      });
    }
  }

  const weekdayRows = Array.from({ length: 7 }, (_, i) => (startWeekday + i) % 7);

  return {
    days,
    weeks,
    weekdayRows,
    maxValue,
    width: weeks > 0 ? weeks * step - gap : 0,
    height: 7 * step - gap,
  };
}
