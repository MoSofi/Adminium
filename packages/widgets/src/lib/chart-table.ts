// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A chart's figures as a table: the text alternative every chart carries
 * (WCAG 1.1.1) and what its "Show data" toggle shows. Built from the answer
 * the chart draws — the canonical envelopes — so one table serves every
 * chart family: a period and its value (a timeseries, with the period
 * before), a category and its value and share (a ranking, a donut; a pair's
 * two figures), a series per column (several lines), a matrix's cells, a
 * distribution's five figures, a flow's links, a candle's four prices, a
 * tree's leaves by their path, a map's places. An answer in no known shape
 * has no table (the toggle is not offered).
 *
 * Pure: the words (headings) and the formatters come from the caller.
 */
import { asCategorical, asTimeseries } from './shapes.js';

export interface ChartTable {
  /** Column headings. */
  headers: string[];
  /** Rows of cells, as text. */
  rows: string[][];
  /** Which columns hold figures (aligned to the end). */
  numeric: boolean[];
}

/** The headings a table uses, in the reader's language. */
export interface ChartTableWords {
  period: string;
  value: string;
  prior: string;
  category: string;
  share: string;
  row: string;
  from: string;
  to: string;
  min: string;
  q1: string;
  median: string;
  q3: string;
  max: string;
  open: string;
  high: string;
  low: string;
  close: string;
  place: string;
}

export interface ChartTableOptions {
  words: ChartTableWords;
  /** A figure as the reader reads it. */
  number: (value: number) => string;
  /** A share (0.25 → "25%"). */
  percent: (fraction: number) => string;
  /** An instant (a bucket's start) as the reader reads it. */
  period: (iso: string) => string;
  /** What each of a pair's figures is called, by position; else its alias. */
  seriesNames?: readonly string[] | undefined;
}

/** More rows than a person reads in a card's table: the rest are left out. */
export const CHART_TABLE_MAX_ROWS = 500;

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null);
const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

export function chartTableOf(data: unknown, opts: ChartTableOptions): ChartTable | null {
  const { words, number } = opts;
  const figure = (value: unknown) => {
    const n = num(value);
    return n === null ? '' : number(n);
  };
  const table = (headers: string[], rows: string[][], numeric: boolean[]): ChartTable | null =>
    rows.length === 0 ? null : { headers, rows: rows.slice(0, CHART_TABLE_MAX_ROWS), numeric };
  const r = rec(data);
  if (r === null) return null;

  const ts = asTimeseries(data);
  if (ts !== null) {
    const prior = ts.compare;
    return table(
      prior === undefined ? [words.period, words.value] : [words.period, words.value, words.prior],
      ts.points.map((point, i) => [opts.period(point.t), number(point.v), ...(prior === undefined ? [] : [figure(prior[i]?.v)])]),
      prior === undefined ? [false, true] : [false, true, true],
    );
  }

  const cat = asCategorical(data);
  if (cat !== null) {
    if (cat.aggregates !== undefined) {
      const names = cat.aggregates.map((alias, i) => opts.seriesNames?.[i] ?? alias);
      return table(
        [words.category, ...names],
        cat.items.map((item) => [item.label, ...cat.aggregates!.map((alias) => figure(item.values?.[alias]))]),
        [false, ...names.map(() => true)],
      );
    }
    const total = cat.items.reduce((sum, item) => sum + item.value, 0);
    const shared = total > 0 && cat.items.every((item) => item.value >= 0);
    return table(
      shared ? [words.category, words.value, words.share] : [words.category, words.value],
      cat.items.map((item) => [item.label, number(item.value), ...(shared ? [opts.percent(item.value / total)] : [])]),
      shared ? [false, true, true] : [false, true],
    );
  }

  // Several series over time: a period per row, a series per column.
  if (Array.isArray(r['series'])) {
    const series = (r['series'] as unknown[]).map(rec).filter((s): s is Rec => s !== null && Array.isArray(s['points']));
    if (series.length > 0) {
      const periods = [...new Set(series.flatMap((s) => (s['points'] as unknown[]).map((p) => text(rec(p)?.['t']))))].filter((t) => t !== '').sort();
      const at = series.map((s) => new Map((s['points'] as unknown[]).map((p) => [text(rec(p)?.['t']), rec(p)?.['v']])));
      return table(
        [words.period, ...series.map((s) => text(s['label'] ?? s['key']))],
        periods.map((t) => [opts.period(t), ...at.map((points) => figure(points.get(t)))]),
        [false, ...series.map(() => true)],
      );
    }
  }

  if (Array.isArray(r['rowKeys']) && Array.isArray(r['colKeys']) && Array.isArray(r['cells'])) {
    const cols = (r['colKeys'] as unknown[]).map(text);
    const cells = r['cells'] as unknown[];
    return table(
      [words.row, ...cols],
      (r['rowKeys'] as unknown[]).map((key, i) => [text(key), ...cols.map((_, j) => figure((cells[i] as unknown[] | undefined)?.[j]))]),
      [false, ...cols.map(() => true)],
    );
  }

  if (Array.isArray(r['groups'])) {
    const groups = (r['groups'] as unknown[]).map(rec).filter((g): g is Rec => g !== null);
    return table(
      [words.category, words.min, words.q1, words.median, words.q3, words.max],
      groups.map((g) => [text(g['label'] ?? g['key']), figure(g['min']), figure(g['q1']), figure(g['med']), figure(g['q3']), figure(g['max'])]),
      [false, true, true, true, true, true],
    );
  }

  if (Array.isArray(r['links']) && Array.isArray(r['nodes'])) {
    const names = new Map((r['nodes'] as unknown[]).map(rec).filter((n): n is Rec => n !== null).map((n) => [text(n['id']), text(n['label'] ?? n['id'])]));
    return table(
      [words.from, words.to, words.value],
      (r['links'] as unknown[]).map(rec).filter((l): l is Rec => l !== null).map((l) => [names.get(text(l['from'])) ?? text(l['from']), names.get(text(l['to'])) ?? text(l['to']), figure(l['weight'])]),
      [false, false, true],
    );
  }

  if (Array.isArray(r['candles'])) {
    return table(
      [words.period, words.open, words.high, words.low, words.close],
      (r['candles'] as unknown[]).map(rec).filter((c): c is Rec => c !== null).map((c) => [opts.period(text(c['t'])), figure(c['o']), figure(c['h']), figure(c['l']), figure(c['c'])]),
      [false, true, true, true, true],
    );
  }

  if (Array.isArray(r['roots'])) {
    const rows: string[][] = [];
    const walk = (node: Rec, path: string[]) => {
      const here = [...path, text(node['label'] ?? node['id'])];
      const children = Array.isArray(node['children']) ? (node['children'] as unknown[]).map(rec).filter((c): c is Rec => c !== null) : [];
      if (children.length === 0) rows.push([here.join(' › '), figure(node['value'])]);
      for (const child of children) if (rows.length < CHART_TABLE_MAX_ROWS) walk(child, here);
    };
    for (const root of (r['roots'] as unknown[]).map(rec)) if (root !== null) walk(root, []);
    return table([words.category, words.value], rows, [false, true]);
  }

  if (Array.isArray(r['points'])) {
    const points = (r['points'] as unknown[]).map(rec).filter((p): p is Rec => p !== null && rec(p['values']) !== null);
    const keys = [...new Set(points.flatMap((p) => Object.keys(rec(p['values'])!)))];
    if (points.length > 0) {
      return table(
        [words.place, ...keys],
        points.map((p) => [text(p['name'] ?? p['code']), ...keys.map((k) => figure(rec(p['values'])![k]))]),
        [false, ...keys.map(() => true)],
      );
    }
  }
  return null;
}
