/**
 * Pure single-month heat-grid geometry (research/widget-registry.md §2
 * `chart-heat-month`): a 7-column month calendar with day numbers and up to 5
 * intensity levels + a day-of-week header. DOM-free and deterministic
 * (workplan/04 §7.1) — UTC-only date math.
 *
 * RTL policy (04 §7.4): the day-of-week columns are a horizontal categorical
 * scale and mirror under `rtl`; the week rows never move.
 */
import { heatLevel } from './heat.js';

export interface HeatMonthCell {
  row: number;
  col: number;
  x: number;
  y: number;
  size: number;
  /** Day of month (1..31) or null for padding cells outside the month. */
  day: number | null;
  /** ISO date key for in-month cells. */
  key: string | null;
  value: number;
  level: number;
}

export interface HeatMonthLayout {
  cells: HeatMonthCell[];
  /** Header column order (0=Sun..6=Sat) rotated by startWeekday, in draw order. */
  headerCols: { col: number; weekday: number; x: number }[];
  rows: number;
  maxValue: number;
  headerHeight: number;
  width: number;
  height: number;
}

export interface HeatMonthOptions {
  /** First weekday of the row, 0=Sun..6=Sat (locale-aware). Default 0. */
  startWeekday?: number;
  cellSize?: number;
  gap?: number;
  headerHeight?: number;
  /** Intensity levels incl. 0 (default 5). */
  levels?: number;
  rtl?: boolean;
}

export interface HeatMonthPoint {
  t: string | number | Date;
  v: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Lay out one calendar month (0-based `month`) of daily counts. Padding cells
 * before the 1st and after the last day carry `day: null`.
 */
export function heatMonthLayout(
  year: number,
  month: number,
  points: readonly HeatMonthPoint[],
  options: HeatMonthOptions = {},
): HeatMonthLayout {
  const {
    startWeekday = 0,
    cellSize = 40,
    gap = 4,
    headerHeight = 20,
    levels = 5,
    rtl = false,
  } = options;
  const step = cellSize + gap;

  const counts = new Map<string, number>();
  let maxValue = 0;
  for (const point of points) {
    const d = point.t instanceof Date ? point.t : new Date(point.t);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const v = Number.isFinite(point.v) ? point.v : 0;
    counts.set(key, v);
    if (v > maxValue) maxValue = v;
  }

  const firstDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() - startWeekday + 7) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rows = Math.ceil((firstDow + daysInMonth) / 7);

  const colX = (col: number): number => (rtl ? 6 - col : col) * step;

  const cells: HeatMonthCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const day = row * 7 + col - firstDow + 1;
      const inMonth = day >= 1 && day <= daysInMonth;
      const key = inMonth ? `${year}-${pad2(month + 1)}-${pad2(day)}` : null;
      const value = key !== null ? (counts.get(key) ?? 0) : 0;
      cells.push({
        row,
        col,
        x: colX(col),
        y: headerHeight + row * step,
        size: cellSize,
        day: inMonth ? day : null,
        key,
        value,
        level: inMonth ? heatLevel(value, maxValue, levels) : 0,
      });
    }
  }

  const headerCols = Array.from({ length: 7 }, (_, col) => ({
    col,
    weekday: (startWeekday + col) % 7,
    x: colX(col) + cellSize / 2,
  }));

  return {
    cells,
    headerCols,
    rows,
    maxValue,
    headerHeight,
    width: 7 * step - gap,
    height: headerHeight + rows * step - gap,
  };
}
