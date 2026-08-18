// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Row → data-contract envelope shapers (04-widget-registry.md §5.2 step 5).
 *
 * The server returns payloads in exactly the §3 canonical envelopes, with a
 * `shape` discriminant so client narrowing is a tagged union: single-metric
 * `{ value }`, metric+delta `{ value, prior?, deltaPct? }`, timeseries
 * `{ points: [{ t, v }], compare? }`, multi-timeseries `{ series }`,
 * categorical `{ items, total }`, matrix `{ rowKeys, colKeys, cells }`,
 * hierarchy/tree `{ roots }`, distribution `{ groups }`, calendar-events
 * `{ events }`, geo-points `{ points }`, flows `{ nodes, links }`, ohlc
 * `{ candles }`, boolean-map `{ entries }`, record `{ row, columns }` and
 * record-list `{ rows, columns, total }`.
 *
 * PII lives HERE, not in SQL: the compiler refuses a masked column the caller
 * named explicitly, but a row-bearing descriptor without `select` falls back
 * to every selectable column — masked ones included. Every row-bearing shape
 * therefore routes its rows through {@link maskedRowsOf} before they reach an
 * envelope, and `compiled.rowShape` — not a list re-derived here — is what says
 * which those are. A row branch that reads `input.rows` directly leaks masked
 * columns to callers without the unmask grant.
 */

import type { ResolvedColumn } from '../crud/identifiers.js';
import { maskRows, type Row } from '../crud/mask.js';
import { widgetDataChannel } from '../realtime/hub.js';
import {
  COL_ALIAS,
  DISTRIBUTION_QUANTILES,
  GROUP_ALIAS,
  GROUP_BUCKET_CAP,
  type CompiledWidgetQuery,
  type PercentileScan,
} from './compiler.js';

export interface TsPoint {
  /** ISO 8601 bucket start. */
  t: string;
  v: number;
}

export interface ShapedSingleMetric {
  shape: 'single-metric';
  value: number;
}

export interface ShapedMetricDelta {
  shape: 'metric+delta';
  value: number;
  prior?: number;
  deltaPct?: number;
}

export interface ShapedTimeseries {
  shape: 'timeseries';
  points: TsPoint[];
  compare?: TsPoint[];
}

export interface ShapedMultiTimeseries {
  shape: 'multi-timeseries';
  series: { key: string; label: string; points: TsPoint[] }[];
}

export interface ShapedCategorical {
  shape: 'categorical';
  items: { key: string; label: string; value: number }[];
  total: number;
}

export interface ShapedMatrix {
  shape: 'matrix';
  rowKeys: string[];
  colKeys: string[];
  /** `cells[row][col]`; `null` where the group-by produced no pair. */
  cells: (number | null)[][];
}

/** One `hierarchy/tree` node (04 §3 `TreeNode { id, label, meta?, children[] }`). */
export interface TreeNode {
  id: string;
  label: string;
  /** Present on a rolled-up tree — the leaf/branch measure `chart-sunburst` sizes by. */
  value?: number;
  /** Remaining projected columns of an adjacency row, masked. */
  meta?: Record<string, unknown>;
  children: TreeNode[];
}

export interface ShapedTree {
  shape: 'hierarchy/tree';
  roots: TreeNode[];
}

/** One `geo-points` place (04 §3) — coordinates, a region code, or both. */
export interface GeoPoint {
  name: string;
  code?: string;
  lat?: number;
  lng?: number;
  /** Metric name → value; the map's metric switcher tabs through these. */
  values: Record<string, number>;
}

export interface ShapedGeoPoints {
  shape: 'geo-points';
  points: GeoPoint[];
}

export interface ShapedFlows {
  shape: 'flows';
  nodes: { id: string; label: string; layer: number }[];
  links: { from: string; to: string; weight: number }[];
}

export interface Candle {
  /** ISO 8601 bucket start (derived form) or the row's own timestamp. */
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface ShapedOhlc {
  shape: 'ohlc';
  candles: Candle[];
}

export interface ShapedBooleanMap {
  shape: 'boolean-map';
  entries: Record<string, boolean>;
}

export interface DistributionGroup {
  key: string;
  label: string;
  min: number;
  q1: number;
  med: number;
  q3: number;
  max: number;
}

export interface ShapedDistribution {
  shape: 'distribution';
  groups: DistributionGroup[];
}

/** One `calendar-events` entry (04 §3 `{date, title, category?, time?, end?}`). */
export interface CalendarEvent {
  id?: string | number;
  /** `YYYY-MM-DD`, or the full ISO instant when the column carries a time. */
  date: string;
  title: string;
  category?: string;
  /** 24-hour `HH:MM` start, present only when the date column has a time. */
  time?: string;
  end?: string;
}

export interface ShapedCalendarEvents {
  shape: 'calendar-events';
  events: CalendarEvent[];
}

export interface ColumnMeta {
  name: string;
  logicalType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ShapedRecordList {
  shape: 'record-list';
  rows: Row[];
  columns: ColumnMeta[];
  total: number;
}

export interface ShapedRecord {
  shape: 'record';
  /** The single (PII-masked) row, or `null` when the filters matched nothing. */
  row: Row | null;
  columns: ColumnMeta[];
}

export interface ShapedStream {
  shape: 'stream';
  /** Authoritative WS channel the client subscribes to (04 §5.3). */
  channel: string;
  /** Initial (PII-masked) rows, newest-first. */
  snapshot: Row[];
  columns: ColumnMeta[];
}

export type ShapedPayload =
  | ShapedSingleMetric
  | ShapedMetricDelta
  | ShapedTimeseries
  | ShapedMultiTimeseries
  | ShapedCategorical
  | ShapedMatrix
  | ShapedTree
  | ShapedDistribution
  | ShapedCalendarEvents
  | ShapedGeoPoints
  | ShapedFlows
  | ShapedOhlc
  | ShapedBooleanMap
  | ShapedRecord
  | ShapedRecordList
  | ShapedStream;

/**
 * Per-axis key cap for `matrix`. The compiled query is already bounded by the
 * row LIMIT, but 1000 rows of unique pairs would inflate into a million-cell
 * dense grid; no matrix chart is readable past ~100 keys an axis, so the tail
 * of the (deterministically ordered) keys is dropped rather than materialised.
 */
export const MATRIX_AXIS_CAP = 100;

/** PG returns numerics/bigints as strings — coerce every metric to number. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

/**
 * Truthiness as the four supported engines store it: Postgres returns a real
 * boolean, MySQL a `TINYINT(1)` 0/1, SQLite an integer, and a text column may
 * carry `'t'`/`'true'`/`'yes'`/`'on'`. Anything else is false — a `boolean-map`
 * entry is a switch position, and an unrecognised value must read as "off"
 * rather than as "on" by accident.
 */
export function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 't' || normalized === 'yes' || normalized === 'y' || normalized === 'on' || normalized === '1';
  }
  return false;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return value;
  }
  return String(value);
}

function firstAlias(compiled: CompiledWidgetQuery): string {
  const alias = compiled.aggregationAliases[0];
  if (alias === undefined) throw new Error('shaper: no aggregation alias (compiler bug)');
  return alias;
}

function metricOf(rows: Row[], alias: string): number {
  return toNumber(rows[0]?.[alias]);
}

function pointsOf(rows: Row[], bucketAlias: string, valueAlias: string): TsPoint[] {
  return rows.map((row) => ({ t: toIso(row[bucketAlias]), v: toNumber(row[valueAlias]) }));
}

/** Group-key normalization shared by every keyed envelope (`null` ⇒ `__null`). */
function keyOf(value: unknown): { key: string; label: string } {
  return value === null || value === undefined
    ? { key: '__null', label: '—' }
    : { key: String(value), label: String(value) };
}

/**
 * Linear-interpolation quantile over a SORTED array — the same definition
 * Postgres `percentile_cont` uses, so the in-process fallback and the native
 * SQL path agree to floating-point rounding.
 */
export function quantile(sorted: readonly number[], p: number): number {
  const first = sorted[0];
  if (first === undefined) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const low = sorted[lo] ?? first;
  if (lo === hi) return low;
  return low + ((sorted[hi] ?? low) - low) * (pos - lo);
}

/**
 * Fold a raw quantile scan into aggregate-shaped rows (see `PercentileScan`):
 * one row per key, carrying exactly the aliases the native SQL path would have
 * selected. Every downstream case therefore reads the same row layout whether
 * the engine had `percentile_cont` or not. NULL values are skipped, as SQL
 * aggregates skip them.
 */
function foldPercentileScan(scan: PercentileScan, rows: Row[]): Row[] {
  const { keyAlias, valueAlias } = scan;
  const groups = new Map<string, { key: unknown; values: number[] }>();
  for (const row of rows) {
    const rawKey = keyAlias === null ? null : row[keyAlias];
    const id = keyAlias === null ? '' : keyOf(rawKey).key;
    let group = groups.get(id);
    if (group === undefined) {
      group = { key: rawKey, values: [] };
      groups.set(id, group);
    }
    const value = row[valueAlias];
    if (value === null || value === undefined) continue;
    group.values.push(toNumber(value));
  }
  const folded = [...groups.values()].map((group) => {
    group.values.sort((a, b) => a - b);
    const out: Row = {};
    if (keyAlias !== null) out[keyAlias] = group.key;
    for (const { alias, p } of scan.quantiles) out[alias] = quantile(group.values, p);
    return out;
  });
  if (keyAlias === null) return folded;
  if (scan.order === 'key-asc') {
    folded.sort((a, b) => keyOf(a[keyAlias]).key.localeCompare(keyOf(b[keyAlias]).key, 'en'));
  } else {
    const first = scan.quantiles[0]?.alias;
    if (first !== undefined) folded.sort((a, b) => toNumber(b[first]) - toNumber(a[first]));
  }
  return folded;
}

/**
 * Split a date/timestamp cell into the calendar day and, when the column
 * carries a time of day, its `HH:MM`. A DATE column lands on midnight and gets
 * no `time`, which is exactly what the calendar widgets want (they place on
 * the day and prefix the chip only when there is a clock time).
 */
function dayAndTime(value: unknown): { date: string; time?: string } {
  const iso = toIso(value);
  const parts = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  if (parts === null) return { date: iso };
  const [, day, time] = parts as unknown as [string, string, string];
  return time === '00:00' ? { date: day } : { date: day, time };
}

/**
 * The ONE place a row-bearing envelope reads its rows. Everything that reaches
 * a payload as a table row goes through here, so the PII rule in the module
 * header is a single call site rather than a convention every new branch has to
 * remember (see the `every row-bearing shape masks` test).
 */
function maskedRowsOf(compiled: CompiledWidgetQuery, rows: Row[], canReadPii: boolean): Row[] {
  if (!compiled.rowShape) {
    throw new Error(`shaper: ${String(compiled.shape)} read rows on a non-row descriptor (compiler bug)`);
  }
  return maskRows(rows, compiled.table, canReadPii);
}

/** Logical types a coordinate can be stored in — never an id or a region code. */
const REAL_TYPES: ReadonlySet<string> = new Set(['decimal', 'float']);

export interface GeoColumnRoles {
  name: ResolvedColumn;
  code: ResolvedColumn | null;
  lat: ResolvedColumn | null;
  lng: ResolvedColumn | null;
  metrics: ResolvedColumn[];
}

/**
 * Positional roles of a `geo-points` projection. Position 1 is always the
 * place name; the rest split two ways because the two map widgets want
 * different things — `map-bubble` plots `lat`/`lng`, `chart-choropleth-grid`
 * fills regions by `code`.
 *
 * The split is decided by LOGICAL TYPE, not by column count: a coordinate pair
 * is two REAL columns (`decimal`/`float`), which is what every introspected
 * latitude/longitude is and what no region code ever is (`text`, `varchar`, or
 * an integer FIPS/ISO number). Consequences worth knowing: coordinates stored
 * as integers read as a region code (select a real-typed view column instead),
 * and `[name, someInt, someFloat]`-style projections are read code-first.
 */
export function geoColumnRoles(columns: readonly ResolvedColumn[]): GeoColumnRoles | null {
  const [name, ...rest] = columns;
  if (name === undefined) return null;
  const first = rest[0];
  const second = rest[1];
  const coordinate =
    first !== undefined &&
    second !== undefined &&
    REAL_TYPES.has(first.logicalType) &&
    REAL_TYPES.has(second.logicalType);
  return coordinate
    ? { name, code: null, lat: first, lng: second, metrics: rest.slice(2) }
    : { name, code: first ?? null, lat: null, lng: null, metrics: rest.slice(1) };
}

function finiteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Sankey layers: a node's layer is the longest inbound path to it, so sources
 * sit at 0 and every link points strictly rightwards on an acyclic graph. A
 * cycle (A → B → A is perfectly legal in a `from`/`to` rollup over real data)
 * is broken at the node the walk re-enters, which pins the layer instead of
 * recursing forever. Chord ignores `layer` entirely.
 */
function flowLayers(nodes: readonly string[], links: readonly { from: string; to: string }[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const node of nodes) incoming.set(node, []);
  for (const link of links) {
    if (link.from !== link.to) incoming.get(link.to)?.push(link.from);
  }
  const layers = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle — stop here rather than recurse
    visiting.add(id);
    let depth = 0;
    for (const source of incoming.get(id) ?? []) depth = Math.max(depth, depthOf(source) + 1);
    visiting.delete(id);
    layers.set(id, depth);
    return depth;
  };
  for (const node of nodes) depthOf(node);
  return layers;
}

/**
 * Would attaching `id` to its recorded parent close a loop? Real self-
 * referencing tables do contain them (a re-parented org row, a corrupted
 * import), and a tree built from one would recurse until the JSON serializer
 * blew the stack. Every node whose ancestor chain repeats is promoted to a root
 * instead — the data still renders, just flattened at the loop.
 */
function ancestryLoops(id: string, parents: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>([id]);
  let cursor = parents.get(id);
  while (cursor !== undefined) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parents.get(cursor);
  }
  return false;
}

export interface ShapeInput {
  compiled: CompiledWidgetQuery;
  rows: Row[];
  priorRows?: Row[] | undefined;
  /** `record-list` exact count (from the compiled `count` twin). */
  total?: number | undefined;
  canReadPii: boolean;
  /** Connection id — needed to build the `stream` channel name. */
  connectionId?: string | undefined;
}

function columnMetaOf(compiled: CompiledWidgetQuery): ColumnMeta[] {
  return compiled.selectedColumns.map((column) => ({
    name: column.name,
    logicalType: column.logicalType,
    nullable: column.nullable,
    isPrimaryKey: column.isPrimaryKey,
  }));
}

export function shapeRows(input: ShapeInput): ShapedPayload {
  const { compiled, canReadPii } = input;
  // Engines without a percentile function return the raw value column instead
  // of aggregates; folding here means every case below is dialect-blind.
  const scan = compiled.percentileScan ?? null;
  const rows = scan === null ? input.rows : foldPercentileScan(scan, input.rows);
  const priorRows =
    input.priorRows === undefined || scan === null
      ? input.priorRows
      : foldPercentileScan(scan, input.priorRows);

  switch (compiled.shape) {
    case 'single-metric':
      return { shape: 'single-metric', value: metricOf(rows, firstAlias(compiled)) };

    case 'metric+delta': {
      const alias = firstAlias(compiled);
      const value = metricOf(rows, alias);
      if (priorRows === undefined) return { shape: 'metric+delta', value };
      const prior = metricOf(priorRows, alias);
      return prior === 0
        ? { shape: 'metric+delta', value, prior }
        : { shape: 'metric+delta', value, prior, deltaPct: (value - prior) / Math.abs(prior) };
    }

    case 'timeseries': {
      const alias = firstAlias(compiled);
      const bucketAlias = compiled.bucketAlias ?? '__bucket';
      const points = pointsOf(rows, bucketAlias, alias);
      return priorRows === undefined
        ? { shape: 'timeseries', points }
        : { shape: 'timeseries', points, compare: pointsOf(priorRows, bucketAlias, alias) };
    }

    case 'multi-timeseries': {
      const alias = firstAlias(compiled);
      const bucketAlias = compiled.bucketAlias ?? '__bucket';
      const groupAlias = compiled.groupAlias ?? '__group';
      // Rows arrive bucket-major (compiler ORDER BY), so appending in row order
      // keeps each series chronological without a second sort.
      const series = new Map<string, ShapedMultiTimeseries['series'][number]>();
      for (const row of rows) {
        const { key, label } = keyOf(row[groupAlias]);
        let entry = series.get(key);
        if (entry === undefined) {
          entry = { key, label, points: [] };
          series.set(key, entry);
        }
        entry.points.push({ t: toIso(row[bucketAlias]), v: toNumber(row[alias]) });
      }
      return { shape: 'multi-timeseries', series: [...series.values()] };
    }

    case 'matrix': {
      const alias = firstAlias(compiled);
      const groupAlias = compiled.groupAlias ?? '__group';
      const colAlias = compiled.colAlias ?? '__col';
      const rowKeys: string[] = [];
      const colKeys: string[] = [];
      const values = new Map<string, number>();
      for (const row of rows) {
        const r = keyOf(row[groupAlias]).key;
        const c = keyOf(row[colAlias]).key;
        if (!rowKeys.includes(r)) {
          if (rowKeys.length >= MATRIX_AXIS_CAP) continue;
          rowKeys.push(r);
        }
        if (!colKeys.includes(c)) {
          if (colKeys.length >= MATRIX_AXIS_CAP) continue;
          colKeys.push(c);
        }
        values.set(`${r}\u0000${c}`, toNumber(row[alias]));
      }
      // NUL joins the pair key: it cannot appear in a value that arrived as
      // text, so `a|b × c` can never collide with `a × b|c`.
      const cells = rowKeys.map((r) => colKeys.map((c) => values.get(`${r}\u0000${c}`) ?? null));
      return { shape: 'matrix', rowKeys, colKeys, cells };
    }

    case 'hierarchy/tree': {
      if (!compiled.rowShape) {
        // Rollup form: `__group` is the branch key, `__col` the leaf key, and
        // the first aggregate is the leaf value (what `chart-sunburst` sizes
        // rings by). Branch values are the sum of their leaves, so the ring
        // widths add up.
        const alias = firstAlias(compiled);
        const groupAlias = compiled.groupAlias ?? GROUP_ALIAS;
        const colAlias = compiled.colAlias ?? COL_ALIAS;
        const branches = new Map<string, TreeNode>();
        for (const row of rows) {
          const branch = keyOf(row[groupAlias]);
          const leaf = keyOf(row[colAlias]);
          let node = branches.get(branch.key);
          if (node === undefined) {
            node = { id: branch.key, label: branch.label, value: 0, children: [] };
            branches.set(branch.key, node);
          }
          const value = toNumber(row[alias]);
          node.value = (node.value ?? 0) + value;
          node.children.push({
            // Leaf keys repeat across branches ("open" under every team), so the
            // id is the PAIR — a bare leaf key would collide as a React key.
            id: `${branch.key}/${leaf.key}`,
            label: leaf.label,
            value,
            children: [],
          });
        }
        return { shape: 'hierarchy/tree', roots: [...branches.values()] };
      }

      // Adjacency form: positional `select` = [id, label, parent, ...meta].
      const [idColumn, labelColumn, parentColumn, ...metaColumns] = compiled.selectedColumns;
      if (idColumn === undefined || labelColumn === undefined || parentColumn === undefined) {
        throw new Error('shaper: hierarchy/tree needs [id, label, parent] columns (compiler bug)');
      }
      const nodes = new Map<string, TreeNode>();
      const parents = new Map<string, string>();
      const order: string[] = [];
      for (const row of maskedRowsOf(compiled, rows, canReadPii)) {
        const rawId = row[idColumn.name];
        if (rawId === null || rawId === undefined) continue;
        const id = String(rawId);
        if (nodes.has(id)) continue; // first row wins; a dup id cannot be two nodes
        const node: TreeNode = { id, label: String(row[labelColumn.name] ?? id), children: [] };
        if (metaColumns.length > 0) {
          // `Object.fromEntries`, not a literal: a column literally named
          // `__proto__` would otherwise set the prototype instead of a key.
          node.meta = Object.fromEntries(metaColumns.map((column) => [column.name, row[column.name]]));
        }
        nodes.set(id, node);
        order.push(id);
        const rawParent = row[parentColumn.name];
        if (rawParent !== null && rawParent !== undefined) {
          const parentId = String(rawParent);
          if (parentId !== id) parents.set(id, parentId);
        }
      }
      const roots: TreeNode[] = [];
      for (const id of order) {
        const node = nodes.get(id);
        if (node === undefined) continue;
        const parentId = parents.get(id);
        const parent = parentId === undefined ? undefined : nodes.get(parentId);
        // A parent outside the fetched page is not an error — the row cap cut
        // it off — so the orphan surfaces as a root rather than disappearing.
        if (parent === undefined || ancestryLoops(id, parents)) roots.push(node);
        else parent.children.push(node);
      }
      return { shape: 'hierarchy/tree', roots };
    }

    case 'geo-points': {
      if (!compiled.rowShape) {
        // Rollup form: one region per group key, every aggregate a switchable
        // metric — the shape `chart-choropleth-grid` fills regions from.
        const groupAlias = compiled.groupAlias ?? GROUP_ALIAS;
        const points = rows.map((row): GeoPoint => {
          const { key, label } = keyOf(row[groupAlias]);
          const values = Object.fromEntries(
            compiled.aggregationAliases.map((alias) => [alias, toNumber(row[alias])]),
          );
          return { name: label, code: key, values };
        });
        return { shape: 'geo-points', points };
      }

      const roles = geoColumnRoles(compiled.selectedColumns);
      if (roles === null) throw new Error('shaper: geo-points needs a name column (compiler bug)');
      const points = maskedRowsOf(compiled, rows, canReadPii).flatMap((row): GeoPoint[] => {
        const lat = roles.lat === null ? undefined : finiteNumber(row[roles.lat.name]);
        const lng = roles.lng === null ? undefined : finiteNumber(row[roles.lng.name]);
        const rawCode = roles.code === null ? null : row[roles.code.name];
        const code = rawCode === null || rawCode === undefined ? undefined : String(rawCode);
        // A row with neither coordinates nor a region code cannot be placed by
        // either map widget; drop it rather than plot it at (0, 0).
        if (lat === undefined && lng === undefined && code === undefined) return [];
        const rawName = row[roles.name.name];
        const values: Record<string, number> = {};
        for (const column of roles.metrics) {
          const metric = finiteNumber(row[column.name]);
          if (metric !== undefined) values[column.name] = metric;
        }
        return [
          {
            name: rawName === null || rawName === undefined ? (code ?? '') : String(rawName),
            ...(code === undefined ? {} : { code }),
            ...(lat === undefined ? {} : { lat }),
            ...(lng === undefined ? {} : { lng }),
            values,
          },
        ];
      });
      return { shape: 'geo-points', points };
    }

    case 'flows': {
      const alias = firstAlias(compiled);
      const groupAlias = compiled.groupAlias ?? GROUP_ALIAS;
      const colAlias = compiled.colAlias ?? COL_ALIAS;
      // Node set is the union of both key columns, in first-seen order — the
      // compiler orders rows by key, so it is stable across requests.
      const labels = new Map<string, string>();
      const links: ShapedFlows['links'] = [];
      for (const row of rows) {
        const from = keyOf(row[groupAlias]);
        const to = keyOf(row[colAlias]);
        if (!labels.has(from.key)) labels.set(from.key, from.label);
        if (!labels.has(to.key)) labels.set(to.key, to.label);
        links.push({ from: from.key, to: to.key, weight: toNumber(row[alias]) });
      }
      const layers = flowLayers([...labels.keys()], links);
      return {
        shape: 'flows',
        nodes: [...labels].map(([id, label]) => ({ id, label, layer: layers.get(id) ?? 0 })),
        links,
      };
    }

    case 'ohlc': {
      const scanned = compiled.ohlcScan;
      if (scanned !== null) {
        // Derived form: rows arrive in raw time order (compiler ORDER BY), so
        // one pass per bucket run gives open = first, close = last.
        const candles: Candle[] = [];
        let current: Candle | null = null;
        for (const row of rows) {
          const value = finiteNumber(row[scanned.valueAlias]);
          if (value === undefined) continue; // NULL ticks, as SQL aggregates skip them
          const t = toIso(row[scanned.bucketAlias]);
          if (current === null || current.t !== t) {
            current = { t, o: value, h: value, l: value, c: value };
            candles.push(current);
            continue;
          }
          current.h = Math.max(current.h, value);
          current.l = Math.min(current.l, value);
          current.c = value;
        }
        return { shape: 'ohlc', candles };
      }

      // Stored-candle form: positional `select` = [t, o, h, l, c].
      const [tColumn, oColumn, hColumn, lColumn, cColumn] = compiled.selectedColumns;
      if (
        tColumn === undefined ||
        oColumn === undefined ||
        hColumn === undefined ||
        lColumn === undefined ||
        cColumn === undefined
      ) {
        throw new Error('shaper: ohlc needs [t, o, h, l, c] columns (compiler bug)');
      }
      const candles = maskedRowsOf(compiled, rows, canReadPii).map(
        (row): Candle => ({
          t: toIso(row[tColumn.name]),
          o: toNumber(row[oColumn.name]),
          h: toNumber(row[hColumn.name]),
          l: toNumber(row[lColumn.name]),
          c: toNumber(row[cColumn.name]),
        }),
      );
      return { shape: 'ohlc', candles };
    }

    case 'boolean-map': {
      const [keyColumn, flagColumn] = compiled.selectedColumns;
      if (keyColumn === undefined || flagColumn === undefined) {
        throw new Error('shaper: boolean-map needs [key, flag] columns (compiler bug)');
      }
      const entries = new Map<string, boolean>();
      for (const row of maskedRowsOf(compiled, rows, canReadPii)) {
        const rawKey = row[keyColumn.name];
        if (rawKey === null || rawKey === undefined) continue;
        entries.set(String(rawKey), toBoolean(row[flagColumn.name]));
      }
      // `Object.fromEntries` defines own properties, so a row keyed
      // `__proto__` becomes an entry rather than reassigning the prototype.
      return { shape: 'boolean-map', entries: Object.fromEntries(entries) };
    }

    case 'distribution': {
      const groupAlias = compiled.groupAlias;
      const groups = rows.map((row) => {
        const { key, label } = groupAlias === null ? { key: 'all', label: 'All' } : keyOf(row[groupAlias]);
        const quantiles = Object.fromEntries(
          DISTRIBUTION_QUANTILES.map(({ alias, key: name }) => [name, toNumber(row[alias])]),
        ) as Record<'min' | 'q1' | 'med' | 'q3' | 'max', number>;
        return { key, label, ...quantiles };
      });
      return { shape: 'distribution', groups };
    }

    case 'calendar-events': {
      // Positional `select` = the event field map (compiler `assertShapeRules`
      // guarantees 2–4 columns): date, title, category?, end?.
      const [dateColumn, titleColumn, categoryColumn, endColumn] = compiled.selectedColumns;
      if (dateColumn === undefined || titleColumn === undefined) {
        throw new Error('shaper: calendar-events needs [date, title] columns (compiler bug)');
      }
      const [pk] = compiled.table.primaryKey;
      const events = maskedRowsOf(compiled, rows, canReadPii).map((row) => {
        const { date, time } = dayAndTime(row[dateColumn.name]);
        const event: CalendarEvent = { date, title: String(row[titleColumn.name] ?? '') };
        const id = pk === undefined ? undefined : row[pk];
        if (typeof id === 'string' || typeof id === 'number') event.id = id;
        if (time !== undefined) event.time = time;
        const category = categoryColumn === undefined ? null : row[categoryColumn.name];
        if (category !== null && category !== undefined) event.category = String(category);
        const end = endColumn === undefined ? undefined : dayAndTime(row[endColumn.name]).time;
        if (end !== undefined) event.end = end;
        return event;
      });
      return { shape: 'calendar-events', events };
    }

    case 'categorical': {
      const alias = firstAlias(compiled);
      const groupAlias = compiled.groupAlias ?? '__group';
      const items = rows.map((row) => ({ ...keyOf(row[groupAlias]), value: toNumber(row[alias]) }));
      // Cardinality cap: rows arrive ordered by value desc (compiler); fold
      // the tail into `__other` (04 §5.2 guardrails — fold is over fetched
      // rows, themselves bounded by the hard LIMIT).
      let capped = items;
      if (items.length > GROUP_BUCKET_CAP) {
        const head = items.slice(0, GROUP_BUCKET_CAP);
        const otherValue = items.slice(GROUP_BUCKET_CAP).reduce((sum, item) => sum + item.value, 0);
        capped = [...head, { key: '__other', label: 'Other', value: otherValue }];
      }
      const total = capped.reduce((sum, item) => sum + item.value, 0);
      return { shape: 'categorical', items: capped, total };
    }

    case 'record': {
      // Compiled with LIMIT 1; no match is `row: null`, which is exactly what
      // `isEmptyByShape.record` reads as the empty state.
      return {
        shape: 'record',
        row: maskedRowsOf(compiled, rows, canReadPii)[0] ?? null,
        columns: columnMetaOf(compiled),
      };
    }

    case 'record-list': {
      return {
        shape: 'record-list',
        rows: maskedRowsOf(compiled, rows, canReadPii),
        columns: columnMetaOf(compiled),
        total: input.total ?? rows.length,
      };
    }

    case 'stream': {
      // Server-authoritative channel from the RESOLVED table id — the client
      // subscribes to exactly what the CRUD/job publisher fans out on (04 §5.3).
      if (input.connectionId === undefined) {
        throw new Error('shaper: stream shape requires connectionId (route bug)');
      }
      return {
        shape: 'stream',
        channel: widgetDataChannel(input.connectionId, compiled.table.id),
        snapshot: maskedRowsOf(compiled, rows, canReadPii),
        columns: columnMetaOf(compiled),
      };
    }

    default:
      throw new Error(`shaper: unsupported shape ${String(compiled.shape)} (compiler bug)`);
  }
}
