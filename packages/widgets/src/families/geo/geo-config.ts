// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { DEFAULT_CENTER, DEFAULT_ZOOM, mulberry32 } from './geo-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `geo` family config schemas + deterministic demo generators — PURE module
 * (zod + geo-lib + shared-config only; no React component code, **no Leaflet**).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `geo-track.definitions.ts`, which imports these schemas and `demoData`
 * generators. If they lived in the component files, the definitions module would
 * statically import a `.tsx` — and `registry/index.ts` statically imports every
 * definitions module, so Leaflet, @adminium/ui and the map markup would all land
 * in the EAGER registry chunk, on every page, whether or not a map is placed.
 * That is exactly what acceptance #3 forbids ("Leaflet code is absent unless
 * map-bubble is placed"). The components load only through
 * `lazy(() => import('./geo-track-components.js'))`; the component files
 * re-export these symbols so barrel/story/test import points stay one-per-widget.
 *
 * FIELD-NAMING CONFIG (04 §5, annex §7): the auto-instantiation rule
 * (`geo.lat-lng-pair`, registry/candidates.ts) binds a real table and passes
 * `latColumn`/`lngColumn` for the classifier's `geo-point` pair, so those two
 * names are FIXED BY THAT RULE — renaming them here silently breaks every
 * generated map. The rest follow the family's `*Field` convention.
 */

// ── map-bubble (annex §7) ───────────────────────────────────────────────────

/** A `[lat, lng]` pair, validated to the real coordinate domain. */
const latLngSchema = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const mapBubbleConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * The classifier's lat/lng pair. NAMED `latColumn`/`lngColumn` (not the
   * family's `*Field` convention) because `registry/candidates.ts`'s
   * `geo.lat-lng-pair` rule emits exactly these keys — see the module header.
   */
  latColumn: z.string().default('lat'),
  lngColumn: z.string().default('lng'),
  nameField: z.string().default('name'),
  codeField: z.string().default('code'),
  /**
   * Switchable metrics (annex §7 config `metrics`) — the tabs above the map, and
   * what sizes the circle markers. Empty → every numeric column is inferred as a
   * metric, so an unconfigured instance still plots something sensible.
   */
  metrics: z.array(z.string()).default([]),
  /** Already-translated tab labels, keyed by metric name (host resolves i18n). */
  metricLabels: z.record(z.string(), z.string()).default({}),
  valueFormat: z.enum(['plain', 'compact', 'currency', 'percent']).default('compact'),
  /** annex §7 config `initialZoom/center`. */
  initialCenter: latLngSchema.optional(),
  initialZoom: z.number().int().min(1).max(18).default(DEFAULT_ZOOM),
  /** Clicking a marker flies the map to it (annex §7 "flyTo on click"). */
  flyToOnClick: z.boolean().default(true),
  /**
   * annex §7 config `linkedList` — the INSTANCE id of a sibling
   * `ranked-entity-list` this map pairs with. The widget doesn't reach for it
   * (widgets never talk to each other); it rides along on the `record-open`
   * event as `linkedInstanceId` so the PAGE HOST can focus the paired list.
   * Absent → the event is still emitted, just with no pairing on it.
   */
  linkedList: z.string().optional(),
  /** The built-in top-N companion list (0 = off) — the map's a11y fallback too. */
  topN: z.number().int().min(0).max(10).default(5),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
  /** Already-translated copy for the "map couldn't load" notice. */
  mapUnavailableLabel: z.string().optional(),
  regionsLabel: z.string().optional(),
});
export type MapBubbleConfig = z.infer<typeof mapBubbleConfigSchema>;

/**
 * Real cities with real coordinates — a demo map whose markers land on land.
 * `[name, lat, lng, weight]`; `weight` biases the seeded metrics so the picture
 * reads like plausible traffic (Tokyo outweighs Auckland) instead of noise.
 */
const DEMO_CITIES: readonly (readonly [string, number, number, number])[] = [
  ['Tokyo', 35.6762, 139.6503, 1],
  ['New York', 40.7128, -74.006, 0.92],
  ['London', 51.5072, -0.1276, 0.86],
  ['São Paulo', -23.5505, -46.6333, 0.7],
  ['Berlin', 52.52, 13.405, 0.58],
  ['Cairo', 30.0444, 31.2357, 0.52],
  ['Mumbai', 19.076, 72.8777, 0.66],
  ['Sydney', -33.8688, 151.2093, 0.44],
  ['Lagos', 6.5244, 3.3792, 0.4],
  ['Toronto', 43.6532, -79.3832, 0.48],
  ['Singapore', 1.3521, 103.8198, 0.5],
  ['Auckland', -36.8485, 174.7633, 0.22],
];

/**
 * Deterministic `geo-points` payload (04 §7.7) in the canonical §3 `{ points }`
 * envelope. Two metrics so the annex's metric switcher has something to switch.
 */
export function mapBubbleDemoData(seed: number): {
  points: { name: string; lat: number; lng: number; values: { users: number; revenue: number } }[];
} {
  const random = mulberry32(seed || 1);
  const points = DEMO_CITIES.map(([name, lat, lng, weight]) => {
    // Draw both jitters unconditionally and in a fixed order, so a point's
    // values depend only on the seed + its index — never on a branch above it.
    const usersJitter = 0.6 + random() * 0.8;
    const revenueJitter = 0.6 + random() * 0.8;
    return {
      name,
      lat,
      lng,
      values: {
        users: Math.round(400 + weight * 24_000 * usersJitter),
        revenue: Math.round(2_000 + weight * 180_000 * revenueJitter),
      },
    };
  });
  return { points };
}

// ── map-choropleth-grid (annex §7) ──────────────────────────────────────────

/**
 * annex §7: "See `chart-choropleth-grid` (registered in Charts; cross-listed
 * here). Region-coded tiles when only region codes exist, no coordinates."
 *
 * CROSS-LISTED, SO IT SHARES THE GEOMETRY, NOT A COPY OF IT: the component
 * renders @adminium/charts' `ChoroplethGridChart` — the same primitive
 * `chart-choropleth-grid` renders, over the same `choroplethLayout` tilegram. The
 * two registry ids differ only in FAMILY and in the entry point the generator
 * reaches them by: the charts id is the analytics-dashboard tile, this one is
 * what the annex §7 auto-instantiation rule ("country/state/region code column +
 * numeric → `map-choropleth-grid`") emits when a table has region codes but no
 * coordinates, i.e. when `map-bubble` cannot be built.
 *
 * The schema mirrors `chartChoroplethGridConfigSchema` field-for-field for the
 * shared knobs. It is declared here rather than imported from the charts family
 * because that schema lives in a `.tsx` (`MatrixGeoWidgets.tsx`) — importing it
 * would pull a component module into this family's metadata graph and defeat the
 * split the chunk-budget gate protects. The `*Field` names below are this
 * family's own reader config and have no counterpart there.
 */
export const mapChoroplethGridConfigSchema = widgetSharedConfigSchema.extend({
  layout: z.enum(['us-tilegram', 'grid']).default('us-tilegram'),
  /** Metric key read from each region's `values` map; defaults to the first. */
  metric: z.string().optional(),
  nameField: z.string().default('name'),
  codeField: z.string().default('code'),
  columns: z.number().int().min(2).max(12).default(6),
  levels: z.number().int().min(4).max(6).default(5),
  /** Top-N ranked companion list (0 = off). */
  topN: z.number().int().min(0).max(10).default(5),
  valueFormat: z.enum(['plain', 'compact', 'currency', 'percent']).default('compact'),
  /** Already-translated low/high legend copy. */
  legendLowLabel: z.string().optional(),
  legendHighLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type MapChoroplethGridConfig = z.infer<typeof mapChoroplethGridConfigSchema>;

/** USPS code + name for the tilegram demo (a spread of real states). */
const DEMO_STATES: readonly (readonly [string, string])[] = [
  ['CA', 'California'], ['TX', 'Texas'], ['NY', 'New York'], ['FL', 'Florida'],
  ['IL', 'Illinois'], ['PA', 'Pennsylvania'], ['OH', 'Ohio'], ['GA', 'Georgia'],
  ['NC', 'North Carolina'], ['MI', 'Michigan'], ['WA', 'Washington'], ['AZ', 'Arizona'],
  ['MA', 'Massachusetts'], ['CO', 'Colorado'], ['OR', 'Oregon'], ['MN', 'Minnesota'],
];

/**
 * Deterministic `geo-points` payload keyed by region code (04 §7.7) — the same
 * `{ points: [{code, name, values}] }` envelope `chart-choropleth-grid`'s
 * generator emits, since the two ids share a data contract by the annex's
 * cross-listing.
 */
export function mapChoroplethGridDemoData(seed: number): {
  points: { code: string; name: string; values: { sales: number; orders: number } }[];
} {
  const random = mulberry32(seed || 1);
  const points = DEMO_STATES.map(([code, name]) => ({
    code,
    name,
    values: {
      sales: Math.round(20_000 + random() * 480_000),
      orders: Math.round(120 + random() * 4200),
    },
  }));
  return { points };
}

/** The map's opening view: config's center/zoom, else the whole world. */
export function initialView(config: Pick<MapBubbleConfig, 'initialCenter' | 'initialZoom'>): {
  center: readonly [number, number];
  zoom: number;
} {
  return { center: config.initialCenter ?? DEFAULT_CENTER, zoom: config.initialZoom };
}
