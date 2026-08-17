// SPDX-License-Identifier: AGPL-3.0-only
import type { DataShape } from '../page-config/index.js';

/**
 * Per-shape emptiness predicates (04 §3: "Per-shape isEmpty() predicates live
 * beside the schemas — WidgetFrame uses these to switch to the empty state").
 *
 * `record-list` empty ⇔ total === 0 && no cursor; `timeseries` empty ⇔ no
 * points; scalar shapes (`single-metric`, `metric+delta`) and `form-state` /
 * `static` are never "empty" — a zero metric is data. Predicates are lenient
 * about payload shape (unknown in, boolean out) because they run before the
 * widget component narrows the payload.
 */
type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null ? (value as Rec) : null;
}

function emptyArrayAt(value: unknown, key: string): boolean {
  const r = rec(value);
  if (r === null) return true;
  const arr = r[key];
  return !Array.isArray(arr) || arr.length === 0;
}

export const isEmptyByShape: Record<DataShape, (data: unknown) => boolean> = {
  'single-metric': () => false,
  'metric+delta': () => false,
  timeseries: (d) => emptyArrayAt(d, 'points'),
  'multi-timeseries': (d) =>
    emptyArrayAt(d, 'series') ||
    (rec(d)?.series as Rec[]).every((s) => emptyArrayAt(s, 'points')),
  categorical: (d) => emptyArrayAt(d, 'items'),
  'record-list': (d) => {
    const r = rec(d);
    if (r === null) return true;
    return r.total === 0 && (r.cursor === undefined || r.cursor === null);
  },
  record: (d) => rec(d)?.row == null,
  matrix: (d) => emptyArrayAt(d, 'rowKeys') || emptyArrayAt(d, 'colKeys'),
  'hierarchy/tree': (d) => emptyArrayAt(d, 'roots'),
  'calendar-events': (d) => emptyArrayAt(d, 'events'),
  'geo-points': (d) => emptyArrayAt(d, 'points'),
  flows: (d) => emptyArrayAt(d, 'nodes') || emptyArrayAt(d, 'links'),
  ohlc: (d) => emptyArrayAt(d, 'candles'),
  distribution: (d) => emptyArrayAt(d, 'groups'),
  'boolean-map': (d) => {
    const entries = rec(rec(d)?.entries);
    return entries === null || Object.keys(entries).length === 0;
  },
  stream: (d) => emptyArrayAt(d, 'snapshot'),
  'form-state': () => false,
  static: () => false,
};

/**
 * Emptiness check for a widget's declared contract. `null`/`undefined` is
 * always empty; with multiple accepted shapes the payload is empty only if
 * every accepted shape reads it as empty (the true shape of a live payload is
 * whichever the server compiled — 04 §3 envelopes).
 */
export function isEmptyData(data: unknown, contract: DataShape | DataShape[]): boolean {
  if (data === null || data === undefined) return true;
  const shapes = Array.isArray(contract) ? contract : [contract];
  return shapes.every((shape) => isEmptyByShape[shape](data));
}
