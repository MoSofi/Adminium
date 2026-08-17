// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared helpers for the `geo` family (annex §7) — the seeded PRNG the demo
 * generators use, the `geo-points` envelope reader, the bubble radius scale, the
 * theme-following Carto tile URLs, and the binding → event-source read.
 *
 * PURE AND FRAMEWORK-LIGHT: no React, no DOM, and — load-bearing — **no
 * Leaflet**. `geo-config.ts` imports this module and `geo-track.definitions.ts`
 * imports that, so anything reachable from here lands in the registry's EAGER
 * metadata graph. Leaflet is reachable from exactly one module in this package
 * (`MapBubble.tsx`, through a dynamic `import()` inside an effect); see the map
 * dependency tests in `qa/chunk-budget.test.ts`, which walk the transitive
 * static-import graph from every definitions module to prove it.
 */

/** Mulberry32 — the repo's deterministic seeded PRNG (see feeds/feed-lib.tsx). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fixed demo epoch so `demoData(seed)` is byte-identical across runs and
 * platforms (04 §7.7). Matches the communication family's `CHAT_DEMO_EPOCH`.
 * No `Date.now()` / `Math.random()` may appear anywhere in this family.
 */
export const GEO_DEMO_EPOCH = Date.UTC(2026, 6, 14, 12, 0, 0);

// ── the §3 `geo-points` envelope ────────────────────────────────────────────

/**
 * One plotted place. `lat`/`lng` are present for `map-bubble` (the annex's
 * "lat/lng columns"); `code` is present for `map-choropleth-grid` (the annex's
 * "region codes, no coordinates"). Both carry a `values` metric map, which is
 * what the metric switcher tabs through.
 */
export interface GeoPoint {
  name: string;
  code?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  values: Record<string, number>;
}

/** Column names the reader maps a raw `record-list` row through (04 §5). */
export interface GeoFieldConfig {
  nameField: string;
  codeField: string;
  latField: string;
  lngField: string;
  /** Metric columns to lift into `values`; empty → every other finite number. */
  metricFields: readonly string[];
}

function finite(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Lift a `{ values: {...} }` cell, keeping finite numbers only. */
function valuesOf(cell: unknown): Record<string, number> {
  if (typeof cell !== 'object' || cell === null || Array.isArray(cell)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(cell as Record<string, unknown>)) {
    const n = finite(value);
    if (n !== undefined) out[key] = n;
  }
  return out;
}

/** Field names that are never metrics, however numeric the column looks. */
const NEVER_METRIC = new Set(['id', 'lat', 'lng', 'latitude', 'longitude', 'code', 'name', 'values']);

/**
 * Read a `geo-points` payload.
 *
 * TWO ENVELOPES, DELIBERATELY. The canonical §3 shape is `{ points: [...] }`
 * with a per-point `values` map — the same shape `chart-choropleth-grid`
 * consumes, and the one `isEmptyByShape['geo-points']` tests. But the annex §7
 * auto-instantiation rule (`geo.lat-lng-pair` in registry/candidates.ts) binds
 * `map-bubble` to a plain `select` over the source table, so a LIVE instance
 * receives raw `{ rows: [...] }` whose lat/lng/metric columns are named by
 * config. Reading only `points` would render "no locations" against a perfectly
 * good payload — the exact bug `chatRowsOf` was fixed for in the communication
 * family. So both are read, `points` first (it is the declared contract).
 */
export function geoPointsOf(data: unknown, fields: GeoFieldConfig): GeoPoint[] {
  const rows = rawRowsOf(data);
  return rows.flatMap((row): GeoPoint[] => {
    const explicit = valuesOf(row['values']);
    const lat = finite(row[fields.latField]);
    const lng = finite(row[fields.lngField]);
    const code = str(row[fields.codeField]);
    const name = str(row[fields.nameField]) ?? code ?? '';

    const values =
      Object.keys(explicit).length > 0
        ? explicit
        : fields.metricFields.length > 0
          ? pickMetrics(row, fields.metricFields)
          : inferMetrics(row, fields);

    // A point with neither coordinates nor a region code cannot be placed by
    // either widget; drop it rather than plot it at (0,0) off West Africa.
    if (lat === undefined && lng === undefined && code === undefined) return [];
    return [
      {
        name,
        ...(code === undefined ? {} : { code }),
        ...(lat === undefined ? {} : { lat }),
        ...(lng === undefined ? {} : { lng }),
        values,
      },
    ];
  });
}

/** Rows from either envelope: the §3 `{ points }`, or a raw `{ rows }` select. */
function rawRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data !== 'object' || data === null) return [];
  const envelope = data as { points?: unknown; rows?: unknown; data?: unknown };
  if (Array.isArray(envelope.points)) return envelope.points as Record<string, unknown>[];
  if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
  if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
  return [];
}

function pickMetrics(row: Record<string, unknown>, metricFields: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of metricFields) {
    const n = finite(row[field]);
    if (n !== undefined) out[field] = n;
  }
  return out;
}

/** Every finite numeric column that isn't a coordinate/identity column. */
function inferMetrics(row: Record<string, unknown>, fields: GeoFieldConfig): Record<string, number> {
  const skip = new Set([...NEVER_METRIC, fields.nameField, fields.codeField, fields.latField, fields.lngField]);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (skip.has(key)) continue;
    // Only a real number counts here — a numeric-looking STRING column is far
    // more often an id/postcode than a metric, so inference stays strict even
    // though the explicit `metricFields` path coerces.
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Points that can actually be plotted on a coordinate map. */
export function plottablePoints(points: readonly GeoPoint[]): GeoPoint[] {
  return points.filter(
    (point) =>
      point.lat !== undefined &&
      point.lng !== undefined &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lng) <= 180,
  );
}

/** Every metric key present across the payload, in first-seen order. */
export function metricKeysOf(points: readonly GeoPoint[]): string[] {
  const keys: string[] = [];
  for (const point of points) {
    for (const key of Object.keys(point.values)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** A point's value for the active metric (0 when absent). */
export function metricValue(point: GeoPoint, metric: string): number {
  return point.values[metric] ?? 0;
}

// ── bubble scale ────────────────────────────────────────────────────────────

export const BUBBLE_MIN_RADIUS = 6;
export const BUBBLE_MAX_RADIUS = 28;

/**
 * Marker radius for a value, on a SQRT scale between the min/max radii.
 *
 * Sqrt, not linear: a circle's visual weight is its AREA, so scaling the radius
 * linearly makes a 4× value look 16× bigger and misreads the data. This is the
 * same perceptual rule the `chart-scatter-bubble` primitive follows.
 *
 * Degenerate inputs collapse to the min radius rather than dividing by zero: a
 * single-point payload, an all-zero metric, and an all-equal metric all have
 * `max === min`, and there is no honest "relative size" to draw.
 */
export function bubbleRadius(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return BUBBLE_MIN_RADIUS;
  const fraction = Math.sqrt(Math.min(value, max) / max);
  return BUBBLE_MIN_RADIUS + fraction * (BUBBLE_MAX_RADIUS - BUBBLE_MIN_RADIUS);
}

/** The largest value of the active metric across the payload (0 when empty). */
export function maxMetric(points: readonly GeoPoint[], metric: string): number {
  return points.reduce((max, point) => Math.max(max, metricValue(point, metric)), 0);
}

// ── map chrome ──────────────────────────────────────────────────────────────

/**
 * Carto Positron / Dark Matter raster tiles — the annex's "theme-following Carto
 * light/dark tiles". Swapped live through @adminium/ui's `subscribeTheme`, whose
 * own docblock names this exact case ("for Leaflet tile swaps").
 */
export const CARTO_TILES: Readonly<Record<'light' | 'dark', string>> = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

/** Carto's required attribution (their tiles, OSM's data). Rendered in the map. */
export const CARTO_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

/** Default view when config names no center: the whole world, roughly framed. */
export const DEFAULT_CENTER: readonly [number, number] = [20, 0];
export const DEFAULT_ZOOM = 2;

// ── binding → event source ──────────────────────────────────────────────────

/**
 * The `{connectionId, table}` pair a `record-open` / `drill-through` event
 * carries, read off the widget's query descriptor (04 §5.1: `binding.source.name`
 * is the table/view — NOT `binding.table`). Tolerant of a `table`-spelled source
 * and of an absent binding, so a demoData-backed instance still emits sensibly.
 */
export function sourceOf(binding: unknown): { connectionId?: string | undefined; table: string } {
  const descriptor = binding as
    | { connectionId?: string; source?: { name?: string; table?: string } }
    | undefined;
  return {
    connectionId: descriptor?.connectionId,
    table: descriptor?.source?.name ?? descriptor?.source?.table ?? 'records',
  };
}

/**
 * Coerce an untrusted locale tag to one `Intl` accepts. `format.locale` is an
 * optional free-string in the shared widget config, so `''` is SCHEMA-VALID and
 * reaches us — and every `Intl` constructor throws `RangeError` on an empty tag.
 * Mirrors `chat-lib.localeOf`.
 */
export function localeOf(tag: string | undefined): string {
  const trimmed = (tag ?? '').trim();
  if (trimmed === '') return 'en-US';
  try {
    return Intl.getCanonicalLocales(trimmed).length > 0 ? trimmed : 'en-US';
  } catch {
    return 'en-US';
  }
}
