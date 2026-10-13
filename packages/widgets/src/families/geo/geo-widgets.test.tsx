// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `geo` family (annex, TRACK COMM-GEO): the `geo-points` reader, the bubble
 * scale, and render/behaviour tests for map-bubble + map-choropleth-grid.
 *
 * TWO SUITES CARRY REAL WEIGHT HERE:
 *
 *  1. THE THREE STATES (acceptance #3, and the map's own header). MapLibre is
 *     MOCKED, because the environment is not the test: happy-dom has no WebGL,
 *     so a real import would only ever prove "the constructor throws". The
 *     mock is a fake library whose map the test drives — its style arrives,
 *     or its first request fails. With maps off the mock must never
 *     be touched at all: no import, no map built. The static-import/graph half
 *     of acceptance #3 is asserted in qa/chunk-budget.test.ts, which can see
 *     the module graph; this half asserts the runtime consequence.
 *
 * 2. THE LTR ISLAND. Geography does not mirror: the map canvas must stay
 *  `dir="ltr"` under an RTL host, while the chrome around it mirrors through
 *  logical properties. As elsewhere in the repo, "does it mirror" is asserted
 *  on WHICH utilities express the layout (happy-dom computes no geometry), plus
 *  a hard ban on physical-direction utilities.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  THE MAPLIBRE STUB — the load-bearing fixture of this file.

  `MapBubble` reaches MapLibre through a dynamic `import('maplibre-gl')` inside
  its mount effect, and only while the runtime names a map server. `fake.mode`
  hands over a library just big enough to drive. `fake.imports` and `fake.maps`
  count every touch, which is how "maps off asks for nothing" is a test and not
  a hope. (The chunk that cannot be fetched at all — the import itself
  rejecting — is `map-bubble-chunk.test.tsx`: a module once imported stays
  imported, so one file cannot hold both.)
*/
const fake = vi.hoisted(() => {
  type Handler = (event: Record<string, unknown>) => void;
  class FakeMap {
    handlers = new Map<string, Handler[]>();
    sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
    layers: string[] = [];
    removed = false;
    fitted: unknown[] = [];
    styles: string[] = [];
    touchZoomRotate = { disableRotation: (): void => undefined };
    constructor(public options: { container: HTMLElement; style: string; locale?: Record<string, string> }) {
      state.maps.push(this);
      this.styles.push(options.style);
    }
    on(type: string, handler: Handler): this {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
      return this;
    }
    fire(type: string, event: Record<string, unknown> = {}): void {
      for (const handler of this.handlers.get(type) ?? []) handler(event);
    }
    addControl(): this {
      return this;
    }
    getSource(id: string): unknown {
      return this.sources.get(id);
    }
    addSource(id: string, source: { data: unknown }): void {
      const held = { data: source.data, setData: (data: unknown): void => void (held.data = data) };
      this.sources.set(id, held);
    }
    addLayer(layer: { id: string }): void {
      this.layers.push(layer.id);
    }
    getLayer(id: string): unknown {
      return this.layers.includes(id) ? { id } : undefined;
    }
    setPaintProperty(): void {}
    getCanvas(): { style: Record<string, string> } {
      return { style: {} };
    }
    // One pixel is a hundredth of a degree, y growing south.
    project(at: { lng: number; lat: number }): { x: number; y: number } {
      return { x: at.lng * 100, y: -at.lat * 100 };
    }
    unproject(point: [number, number]): { lng: number; lat: number } {
      return { lng: point[0] / 100 || 0, lat: -point[1] / 100 || 0 };
    }
    fitBounds(bounds: unknown): void {
      this.fitted.push(bounds);
    }
    jumpTo(view: unknown): void {
      this.fitted.push(view);
    }
    flyTo(): void {}
    getZoom(): number {
      return 3;
    }
    getCenter(): { lng: number; lat: number } {
      return { lng: 10, lat: 20 };
    }
    setStyle(style: string): void {
      this.styles.push(style);
    }
    queryRenderedFeatures(): unknown[] {
      return [];
    }
    remove(): void {
      this.removed = true;
    }
  }
  class FakeMarker {
    at = { lng: 0, lat: 0 };
    element: HTMLElement;
    constructor(public options: { element: HTMLElement; offset?: [number, number]; draggable?: boolean }) {
      this.element = options.element;
    }
    setLngLat(at: [number, number] | { lng: number; lat: number }): this {
      this.at = Array.isArray(at) ? { lng: at[0], lat: at[1] } : at;
      return this;
    }
    getLngLat(): { lng: number; lat: number } {
      return this.at;
    }
    addTo(map: FakeMap): this {
      map.options.container.append(this.element);
      (this.element as HTMLElement & { marker?: FakeMarker }).marker = this;
      return this;
    }
    getElement(): HTMLElement {
      return this.element;
    }
    handlers = new Map<string, (() => void)[]>();
    on(type: string, handler: () => void): this {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
      return this;
    }
    /** What the library does when a drag starts or ends. */
    fire(type: string): void {
      for (const handler of this.handlers.get(type) ?? []) handler();
    }
    remove(): void {
      this.element.remove();
    }
  }
  const state = {
    imports: 0,
    maps: [] as FakeMap[],
    library: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, setWorkerUrl: (): void => undefined },
  };
  return state;
});

vi.mock('maplibre-gl', () => {
  fake.imports += 1;
  return fake.library;
});
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/maplibre-worker.js' }));

import { MapBubble } from './MapBubble.js';
import { MapBubbleWidget } from './MapBubbleWidget.js';
import { MapChoroplethGrid } from './MapChoroplethGrid.js';
import {
  mapBubbleConfigSchema,
  mapBubbleDemoData,
  mapChoroplethGridConfigSchema,
  mapChoroplethGridDemoData,
} from './geo-config.js';
import {
  BUBBLE_MAX_RADIUS,
  BUBBLE_MIN_RADIUS,
  bubbleRadius,
  geoPointsOf,
  localeOf,
  mapStyleUrl,
  maxMetric,
  metricKeysOf,
  plottablePoints,
  sourceOf,
} from './geo-lib.js';
import { mapBubbleDefinition, mapChoroplethGridDefinition } from './geo-track.definitions.js';
import { WidgetRuntimeProvider } from '../../frame/WidgetRuntimeContext.js';
import type { WidgetRuntimeEnv } from '../../registry/offline.js';

afterEach(cleanup);
beforeEach(() => {
  fake.imports = 0;
  fake.maps.length = 0;
});

const MAP_SERVER = 'https://maps.example.test';
const MAPS_ON: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: false, maps: { server: MAP_SERVER, routing: false } };

/** A runtime whose session names a map server: maps are on. */
function withMaps(node: ReactNode, env: WidgetRuntimeEnv = MAPS_ON) {
  return <WidgetRuntimeProvider env={env}>{node}</WidgetRuntimeProvider>;
}

const statusOf = (container: HTMLElement): string | null | undefined => container.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status');

/** The one fake map a test built, once the mount effect's imports have settled. */
async function builtMap(): Promise<(typeof fake.maps)[number]> {
  await waitFor(() => expect(fake.maps).toHaveLength(1));
  return fake.maps[0]!;
}

/** Every physical-direction Tailwind utility the RTL policy bans. */
const PHYSICAL =
  /(^|\s)-?(ml|mr|pl|pr)-|(^|\s)-?(left|right)-|(^|\s)border-(l|r)(-|\s|$)|(^|\s)rounded-(l|r|tl|tr|bl|br)(-|\s|$)|(^|\s)text-(left|right)(\s|$)/;

function allClassNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[class]')].map((node) => node.className);
}

const FIELDS = { nameField: 'name', codeField: 'code', latField: 'lat', lngField: 'lng', metricFields: [] };

// ── geo-lib: the geo-points reader ──────────────────────────────────────────

describe('geoPointsOf — envelope handling', () => {
  it('reads the canonical { points } envelope with an explicit values map', () => {
    const points = geoPointsOf({ points: [{ name: 'Tokyo', lat: 35.7, lng: 139.7, values: { users: 10 } }] }, FIELDS);
    expect(points).toEqual([{ name: 'Tokyo', lat: 35.7, lng: 139.7, values: { users: 10 } }]);
  });

  /**
   * The bug this reader exists to avoid. `registry/candidates.ts`'s
   * `geo.lat-lng-pair` rule binds `map-bubble` to a PLAIN SELECT over the source
   * table, so a live generated map receives `{ rows: [...] }` of raw columns —
   * not the `{ points }` envelope demoData emits. A reader that only understood
   * `points` would render "No locations" against a perfectly good payload, and
   * every test would pass because every fixture was demoData. (Precisely the bug
   * `chatRowsOf` was fixed for in the communication family.)
   */
  it('reads the raw { rows } select the geo.lat-lng-pair candidate rule actually binds', () => {
    const serverPayload = { rows: [{ id: 1, name: 'Lagos', lat: 6.5, lng: 3.4, users: 900 }], total: 1 };
    expect(geoPointsOf(serverPayload, FIELDS)).toEqual([
      { name: 'Lagos', lat: 6.5, lng: 3.4, values: { users: 900 } },
    ]);
  });

  it('prefers the canonical points key when an envelope carries both', () => {
    const both = { points: [{ name: 'canonical', lat: 1, lng: 1, values: {} }], rows: [{ name: 'shorthand', lat: 2, lng: 2 }] };
    expect(geoPointsOf(both, FIELDS).map((p) => p.name)).toEqual(['canonical']);
  });

  it('maps config-named lat/lng columns (the classifier passes latColumn/lngColumn)', () => {
    const rows = [{ city: 'Berlin', latitude: 52.5, longitude: 13.4, signups: 40 }];
    const points = geoPointsOf(
      { rows },
      { nameField: 'city', codeField: 'code', latField: 'latitude', lngField: 'longitude', metricFields: [] },
    );
    expect(points).toEqual([{ name: 'Berlin', lat: 52.5, lng: 13.4, values: { signups: 40 } }]);
  });

  it('lifts only the configured metric columns when metricFields is set', () => {
    const rows = [{ name: 'Oslo', lat: 59.9, lng: 10.7, users: 5, internal_rank: 99 }];
    const points = geoPointsOf({ rows }, { ...FIELDS, metricFields: ['users'] });
    expect(points[0]?.values).toEqual({ users: 5 });
  });

  it('never infers coordinate or identity columns as metrics', () => {
    const rows = [{ id: 7, name: 'Oslo', lat: 59.9, lng: 10.7, users: 5 }];
    // A lat-tinted choropleth is the failure mode here: `lat`/`lng`/`id` are
    // numbers, but they are not measurements.
    expect(geoPointsOf({ rows }, FIELDS)[0]?.values).toEqual({ users: 5 });
  });

  it('drops points that can be placed by neither widget (no coords, no code)', () => {
    const rows = [{ name: 'Nowhere', users: 5 }, { name: 'Tokyo', lat: 35.7, lng: 139.7 }];
    // Plotting a coordinate-less row would put it at (0,0), in the Atlantic.
    expect(geoPointsOf({ rows }, FIELDS).map((p) => p.name)).toEqual(['Tokyo']);
  });

  it('keeps region-coded points that have no coordinates (the choropleth case)', () => {
    const points = geoPointsOf({ points: [{ code: 'CA', name: 'California', values: { sales: 1 } }] }, FIELDS);
    expect(points).toEqual([{ name: 'California', code: 'CA', values: { sales: 1 } }]);
  });

  it('tolerates junk payloads', () => {
    expect(geoPointsOf(null, FIELDS)).toEqual([]);
    expect(geoPointsOf('nope', FIELDS)).toEqual([]);
    expect(geoPointsOf({}, FIELDS)).toEqual([]);
    expect(geoPointsOf([{ name: 'bare-array', lat: 1, lng: 2 }], FIELDS)).toHaveLength(1);
  });

  it('plottablePoints rejects out-of-domain coordinates', () => {
    const points = [
      { name: 'ok', lat: 10, lng: 10, values: {} },
      { name: 'bad-lat', lat: 91, lng: 10, values: {} },
      { name: 'bad-lng', lat: 10, lng: 181, values: {} },
      { name: 'code-only', code: 'CA', values: {} },
    ];
    expect(plottablePoints(points).map((p) => p.name)).toEqual(['ok']);
  });

  it('metricKeysOf collects every key across the payload in first-seen order', () => {
    const points = [
      { name: 'a', values: { users: 1 } },
      { name: 'b', values: { revenue: 2, users: 3 } },
    ];
    expect(metricKeysOf(points)).toEqual(['users', 'revenue']);
  });
});

// ── geo-lib: the bubble scale ───────────────────────────────────────────────

describe('bubbleRadius', () => {
  /**
   * A circle's visual weight is its AREA (πr²). Scaling the radius linearly
   * would make a 4× value read as 16× — the classic bubble-map lie — so the
   * scale is sqrt, and this pins it numerically rather than trusting the name.
   */
  it('scales by sqrt so AREA is proportional to value, not radius', () => {
    const max = 100;
    const quarter = bubbleRadius(25, max);
    const full = bubbleRadius(100, max);
    const span = BUBBLE_MAX_RADIUS - BUBBLE_MIN_RADIUS;
    // value 25/100 → sqrt(0.25) = 0.5 → exactly half the span above the min.
    expect(quarter).toBeCloseTo(BUBBLE_MIN_RADIUS + 0.5 * span, 6);
    expect(full).toBeCloseTo(BUBBLE_MAX_RADIUS, 6);
  });

  it('collapses degenerate inputs to the min radius instead of dividing by zero', () => {
    // A single-point payload, an all-zero metric, and an all-equal metric all
    // have max === min: there is no honest relative size to draw.
    expect(bubbleRadius(0, 0)).toBe(BUBBLE_MIN_RADIUS);
    expect(bubbleRadius(5, 0)).toBe(BUBBLE_MIN_RADIUS);
    expect(bubbleRadius(-5, 100)).toBe(BUBBLE_MIN_RADIUS);
    expect(bubbleRadius(Number.NaN, 100)).toBe(BUBBLE_MIN_RADIUS);
    expect(bubbleRadius(5, Number.POSITIVE_INFINITY)).toBe(BUBBLE_MIN_RADIUS);
  });

  it('clamps a value above the max rather than overflowing the scale', () => {
    expect(bubbleRadius(500, 100)).toBeCloseTo(BUBBLE_MAX_RADIUS, 6);
  });

  it('maxMetric reads the largest value of the active metric', () => {
    const points = [
      { name: 'a', values: { users: 5, revenue: 900 } },
      { name: 'b', values: { users: 12 } },
    ];
    expect(maxMetric(points, 'users')).toBe(12);
    expect(maxMetric(points, 'missing')).toBe(0);
  });
});

describe('geo-lib misc', () => {
  it('sourceOf reads binding.source.name (not binding.table)', () => {
    expect(sourceOf({ connectionId: 'c1', source: { name: 'stores' } })).toEqual({
      connectionId: 'c1',
      table: 'stores',
    });
    expect(sourceOf(undefined)).toEqual({ connectionId: undefined, table: 'records' });
  });

  it('localeOf coalesces the schema-valid empty/invalid tags that make Intl throw', () => {
    expect(localeOf('')).toBe('en-US');
    expect(localeOf('   ')).toBe('en-US');
    expect(localeOf('x-1')).toBe('en-US');
    expect(localeOf('ar-EG')).toBe('ar-EG');
  });

  it('names the map server\'s light or dark style, by the theme', () => {
    expect(mapStyleUrl('https://maps.example.test', 'light')).toBe('https://maps.example.test/styles/positron');
    expect(mapStyleUrl('https://maps.example.test/', 'dark')).toBe('https://maps.example.test/styles/dark');
  });

  it('reads a place column: the pair, and how the position is known', () => {
    const rows = [
      { name: 'Ana', where: { lat: -22.9, lng: -47.06, by: 'town', placeId: 3467865 } },
      { name: 'Omar', where: JSON.stringify({ lat: 30.1, lng: 31.3, by: 'exact' }) },
      { name: 'Nobody', where: null },
    ];
    const points = geoPointsOf({ rows }, { ...FIELDS, placeField: 'where' });
    expect(points).toEqual([
      { name: 'Ana', lat: -22.9, lng: -47.06, by: 'town', values: {} },
      { name: 'Omar', lat: 30.1, lng: 31.3, by: 'exact', values: {} },
    ]);
  });

  it('keeps `by` from the server\'s own points envelope', () => {
    const points = geoPointsOf({ points: [{ name: 'Ana', lat: 1, lng: 2, by: 'town', placeId: 7, values: { n: 1 } }] }, FIELDS);
    expect(points).toEqual([{ name: 'Ana', lat: 1, lng: 2, by: 'town', placeId: 7, values: { n: 1 } }]);
  });
});

// ── map-bubble ──────────────────────────────────────────────────────────────

const CITY_POINTS = [
  { name: 'Tokyo', lat: 35.7, lng: 139.7, values: { users: 900, revenue: 40 } },
  { name: 'Lagos', lat: 6.5, lng: 3.4, values: { users: 200, revenue: 80 } },
  { name: 'Oslo', lat: 59.9, lng: 10.7, values: { users: 50, revenue: 10 } },
];

describe('map-bubble', () => {
  it('renders the empty state when there is nothing to plot', () => {
    render(<MapBubble points={[]} emptyTitle="No locations" emptyBody="Add coordinates." />);
    expect(screen.getByText('No locations')).toBeTruthy();
  });

  it('renders the ranked list whatever becomes of the map', () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} format={(v) => `${v}`} />));
    expect(container.querySelector('[data-widget="map-bubble"]')).not.toBeNull();
    const rows = [...container.querySelectorAll('[data-part="geo-ranking-row"]')];
    // Ranked by the active metric (`users`), descending.
    expect(rows.map((row) => row.textContent)).toEqual(['1.Tokyo900', '2.Lagos200', '3.Oslo50']);
  });

  // ── state (a): maps on, the server answers ────────────────────────────────

  it('draws the map from the session\'s server in the theme\'s style, a pin for each point', async () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} />));
    const map = await builtMap();
    expect(map.options.style).toBe(`${MAP_SERVER}/styles/positron`);
    expect(statusOf(container)).toBe('idle');
    act(() => map.fire('style.load'));
    expect(statusOf(container)).toBe('ready');
    expect(container.querySelectorAll('[data-part="map-pin"]')).toHaveLength(3);
    expect(container.querySelector('[data-part="map-unavailable"]')).toBeNull();
    // No start was given: the view fits the points.
    expect(map.fitted).toEqual([[[3.4, 6.5], [139.7, 59.9]]]);
  });

  // ── state (b): maps on, the server cannot be reached ──────────────────────

  it('shows the list and the notice when the style cannot be fetched', async () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} mapUnavailableLabel="Map unavailable." />));
    const map = await builtMap();
    act(() => map.fire('error', { error: new Error('Failed to fetch') }));
    expect(statusOf(container)).toBe('unavailable');
    expect(container.querySelector('[data-part="map-unavailable"]')?.textContent).toBe('Map unavailable.');
    expect(container.querySelector('[data-part="map-canvas"]')).toBeNull();
    expect(map.removed).toBe(true);
  });

  it('gives up when the style arrived and every map picture fails', async () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    act(() => map.fire('error', { tile: {}, sourceId: 'openmaptiles' }));
    expect(statusOf(container)).toBe('ready');
    act(() => map.fire('error', { tile: {}, sourceId: 'openmaptiles' }));
    expect(statusOf(container)).toBe('unavailable');
  });

  it('keeps the map when one picture fails after others arrived', async () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    act(() => map.fire('data', { dataType: 'source', tile: {} }));
    act(() => map.fire('error', { tile: {} }));
    act(() => map.fire('error', { tile: {} }));
    expect(statusOf(container)).toBe('ready');
  });

  // ── state (c): maps off ───────────────────────────────────────────────────

  /**
   * No provider is the same as "the session names no server". The mock counts
   * every import and every map built; both stay at zero, after the effects
   * have had their turn — the map code is not even asked for.
   */
  it('maps off: the list and "switched off", and the map library is never touched', async () => {
    const { container } = render(<MapBubble points={CITY_POINTS} />);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(statusOf(container)).toBe('off');
    expect(container.querySelector('[data-part="map-off"]')?.textContent).toBe('Maps are switched off. Here is the list.');
    expect(container.querySelector('[data-part="map-off-link"]')).toBeNull();
    expect(container.querySelector('[data-part="map-canvas"]')).toBeNull();
    expect(container.querySelectorAll('[data-part="geo-ranking-row"]')).toHaveLength(3);
    expect(fake.imports).toBe(0);
    expect(fake.maps).toHaveLength(0);
  });

  it('maps off: somebody who may change it gets the way to Settings → Maps', () => {
    const env: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: false, maps: { server: null, routing: false, settingsHref: '/settings/maps' } };
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} />, env));
    expect(container.querySelector('[data-part="map-off-link"]')?.getAttribute('href')).toBe('/settings/maps');
  });

  it('the desktop app draws no map even when the session names a server', async () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} />, { ...MAPS_ON, runtime: 'desktop' }));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(statusOf(container)).toBe('off');
    expect(fake.imports).toBe(0);
    expect(fake.maps).toHaveLength(0);
  });

  it('follows the switch: a server that goes away takes the map with it', async () => {
    const { container, rerender } = render(withMaps(<MapBubble points={CITY_POINTS} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    rerender(withMaps(<MapBubble points={CITY_POINTS} />, { runtime: 'browser', offlineAssets: false, maps: { server: null, routing: false } }));
    expect(statusOf(container)).toBe('off');
    expect(map.removed).toBe(true);
  });

  // ── what the map draws ────────────────────────────────────────────────────

  const TOWN_POINTS = [
    { name: 'Ana', lat: -22.9, lng: -47.06, by: 'town' as const, values: { n: 1 } },
    { name: 'Bia', lat: -22.9, lng: -47.06, by: 'town' as const, values: { n: 1 } },
    { name: 'Caio', lat: -23.5, lng: -46.6, by: 'exact' as const, values: { n: 1 } },
  ];

  it('marks pins known by their town, spreads those that share it, and says so in the list', async () => {
    const { container } = render(withMaps(<MapBubble points={TOWN_POINTS} listOrder="given" showValues={false} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pins = [...container.querySelectorAll<HTMLElement & { marker?: { options: { offset?: [number, number] } } }>('[data-part="map-pin"]')];
    expect(pins.map((pin) => pin.dataset['by'])).toEqual(['town', 'town', undefined]);
    expect(pins[0]?.getAttribute('aria-label')).toBe('Ana · by town');
    // Two on one position: drawn apart, on opposite sides of it.
    const [first, second, third] = pins.map((pin) => pin.marker?.options.offset);
    expect(first).toEqual([0, -16]);
    expect(second).toEqual([0, 16]);
    expect(third).toEqual([0, 0]);
    const rows = [...container.querySelectorAll('[data-part="geo-ranking"] > li')];
    expect(rows.map((row) => row.querySelector('[data-part="geo-by-town"]')?.textContent)).toEqual(['by town', 'by town', undefined]);
    expect(rows[0]?.querySelector('[data-part="geo-row-note"]')?.textContent).toBe('2 places are known only by this town');
    expect(rows[2]?.querySelector('[data-part="geo-row-note"]')).toBeNull();
  });

  it('a pin picked up, moved with the arrow keys and kept with Enter is handed over as an exact spot', async () => {
    const onPlace = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[TOWN_POINTS[2]!]} onPlace={onPlace} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pin = container.querySelector<HTMLElement>('[data-part="map-pin"]')!;
    // Enter picks the pin up; until then the arrow keys are for going from pin to pin.
    fireEvent.keyDown(pin, { key: 'Enter' });
    fireEvent.keyDown(pin, { key: 'ArrowRight' });
    fireEvent.keyDown(pin, { key: 'ArrowUp' });
    expect(onPlace).not.toHaveBeenCalled();
    fireEvent.keyDown(pin, { key: 'Enter' });
    expect(onPlace).toHaveBeenCalledTimes(1);
    const [point, at] = onPlace.mock.calls[0] as [{ name: string }, { lat: number; lng: number }];
    expect(point.name).toBe('Caio');
    // Four pixels east and four north, at a hundredth of a degree a pixel.
    expect(at.lng).toBeCloseTo(-46.56, 6);
    expect(at.lat).toBeCloseTo(-23.46, 6);
  });

  it('a pin cannot be moved unless the caller takes the new spot', async () => {
    const onSelect = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[TOWN_POINTS[2]!]} onSelect={onSelect} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pin = container.querySelector<HTMLElement & { marker?: { options: { draggable?: boolean } } }>('[data-part="map-pin"]')!;
    expect(pin.marker?.options.draggable).toBe(false);
    fireEvent.click(pin);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Caio' }));
  });

  it('numbers a route\'s stops and words each leg: about, exact, unknown — never 0', async () => {
    const stops = [
      { name: 'Depot', lat: -23.5, lng: -46.6, values: {} },
      { name: 'Ana', lat: -22.9, lng: -47.06, by: 'town' as const, values: {} },
      { name: 'Bia', lat: -22.9, lng: -47.06, by: 'town' as const, values: {} },
      { name: 'Caio', lat: -22.7, lng: -47.6, values: {} },
    ];
    const route = {
      legs: [
        { distanceM: 81_240, durationS: null, estimate: true },
        { distanceM: null, durationS: null, estimate: true, unknown: true as const },
        { distanceM: 61_900, durationS: 3_100, estimate: false },
      ],
    };
    const { container } = render(<MapBubble points={stops} route={route} />);
    const rows = [...container.querySelectorAll('[data-part="geo-ranking"] > li')];
    expect(rows.map((row) => row.querySelector('[data-part="geo-ranking-row"]')?.textContent)).toEqual(['1.Depot', '2.Anaby town', '3.Biaby town', '4.Caio']);
    const notes = rows.map((row) => row.querySelector('[data-part="geo-row-note"]')?.textContent ?? null);
    expect(notes[0]).toBeNull();
    expect(notes[1]).toBe('about 81.2 km from the stop before · 2 places are known only by this town');
    expect(notes[2]).toBe('distance from the stop before unknown · 2 places are known only by this town');
    expect(notes[3]).toBe('61.9 km from the stop before');
    expect(container.querySelector('[data-part="geo-ranking"]')?.getAttribute('aria-label')).toBe('Stops');
  });

  it('says a route\'s legs in miles when asked', () => {
    const stops = [
      { name: 'A', lat: 1, lng: 1, values: {} },
      { name: 'B', lat: 2, lng: 2, values: {} },
    ];
    const { container } = render(<MapBubble points={stops} units="mi" route={{ legs: [{ distanceM: 16_093.44, durationS: null, estimate: false }] }} />);
    expect(container.querySelectorAll('[data-part="geo-row-note"]')[0]?.textContent).toBe('10 mi from the stop before');
  });

  it('draws a route without a line of its own as straight dashed legs', async () => {
    const stops = [
      { name: 'A', lat: 1, lng: 2, values: {} },
      { name: 'B', lat: 3, lng: 4, values: {} },
    ];
    const { container } = render(withMaps(<MapBubble points={stops} route={{ legs: [{ distanceM: 10, durationS: null, estimate: true }] }} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    expect(map.sources.get('adminium-route')?.data).toMatchObject({
      features: [{ geometry: { type: 'LineString', coordinates: [[2, 1], [4, 3]] }, properties: { dashed: true } }],
    });
    expect([...container.querySelectorAll('[data-part="map-pin"]')].map((pin) => pin.textContent)).toEqual(['1', '2']);
  });

  const SQUARE = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

  it('names the areas in the list when there is no map', () => {
    const { container } = render(<MapBubble points={[]} areas={[{ id: 'north', name: 'North round', geometry: SQUARE }, { id: 'x', geometry: SQUARE }]} />);
    const rows = [...container.querySelectorAll('[data-part="geo-areas"] > li')];
    expect(rows.map((row) => row.textContent)).toEqual(['North round4 points', 'Area 24 points']);
    expect(container.querySelector('[data-part="area-tools"]')).toBeNull();
  });

  it('draws an area: clicks add corners, closing hands the polygon over', async () => {
    const onAreaChange = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[]} areas={[]} onAreaChange={onAreaChange} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const close = container.querySelector<HTMLButtonElement>('[data-part="area-close"]')!;
    expect(close.disabled).toBe(true);
    act(() => map.fire('click', { lngLat: { lng: 0, lat: 0 }, point: { x: 0, y: 0 } }));
    act(() => map.fire('click', { lngLat: { lng: 1, lat: 0 }, point: { x: 0, y: 0 } }));
    expect(close.disabled).toBe(true);
    act(() => map.fire('click', { lngLat: { lng: 1, lat: 1 }, point: { x: 0, y: 0 } }));
    expect(container.querySelectorAll('[data-part="map-corner"]')).toHaveLength(3);
    expect(onAreaChange).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-part="area-close"]')!);
    expect(onAreaChange).toHaveBeenCalledWith(null, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
  });

  it('a new area the caller keeps is the one the next change is made to; one it takes away takes the drawing with it', async () => {
    const changes: [string | null, number][] = [];
    function Host() {
      const [areas, setAreas] = useState<{ id: string; geometry: typeof SQUARE }[]>([]);
      return withMaps(
        <>
          <MapBubble
            points={[]}
            areas={areas}
            onAreaChange={(id, geometry) => {
              changes.push([id, geometry.coordinates[0]!.length - 1]);
              setAreas([{ id: 'kept', geometry: geometry as typeof SQUARE }]);
            }}
          />
          <button type="button" onClick={() => setAreas([])}>
            clear
          </button>
        </>,
      );
    }
    const { container } = render(<Host />);
    const map = await builtMap();
    act(() => map.fire('style.load'));
    for (const [lng, lat] of [[0, 0], [1, 0], [1, 1]]) act(() => map.fire('click', { lngLat: { lng, lat }, point: { x: 0, y: 0 } }));
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-part="area-close"]')!);
    expect(changes).toEqual([[null, 3]]);
    // The caller gave it an id: moving a corner now changes that area, and makes no second one.
    fireEvent.keyDown(container.querySelectorAll<HTMLElement>('[data-part="map-corner"]')[0]!, { key: 'ArrowRight' });
    expect(changes).toEqual([[null, 3], ['kept', 3]]);
    // The caller cleared it: the corners go, and drawing starts afresh.
    fireEvent.click(screen.getByText('clear'));
    expect(container.querySelectorAll('[data-part="map-corner"]')).toHaveLength(0);
    expect(container.querySelector('[data-part="area-close"]')).not.toBeNull();
  });

  it('changes an area: a corner moved or removed hands the new polygon over; three corners stay', async () => {
    const onAreaChange = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[]} areas={[{ id: 'north', geometry: SQUARE }]} onAreaChange={onAreaChange} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const corners = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-part="map-corner"]')];
    expect(corners()).toHaveLength(4);
    fireEvent.keyDown(corners()[1]!, { key: 'ArrowRight' });
    expect(onAreaChange).toHaveBeenLastCalledWith('north', { type: 'Polygon', coordinates: [[[0, 0], [1.04, 0], [1, 1], [0, 1], [0, 0]]] });
    fireEvent.keyDown(corners()[3]!, { key: 'Delete' });
    expect(corners()).toHaveLength(3);
    expect(onAreaChange).toHaveBeenLastCalledWith('north', { type: 'Polygon', coordinates: [[[0, 0], [1.04, 0], [1, 1], [0, 0]]] });
    // A shape keeps three corners.
    fireEvent.keyDown(corners()[0]!, { key: 'Delete' });
    expect(corners()).toHaveLength(3);
    expect(onAreaChange).toHaveBeenCalledTimes(2);
    // "Start again" clears the drawing and tells the caller nothing until a new shape is closed.
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-part="area-restart"]')!);
    expect(corners()).toHaveLength(0);
    expect(onAreaChange).toHaveBeenCalledTimes(2);
  });

  it('keeps the map canvas a fixed-LTR island — geography never mirrors', () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} />));
    const canvasWrap = container.querySelector('[data-part="map-canvas"]')?.closest('[dir]');
    // A mirrored world map is a WRONG map, not a localized one: flipping it puts
    // Japan west of Portugal. So the island is pinned regardless of host dir.
    expect(canvasWrap?.getAttribute('dir')).toBe('ltr');
  });

  it('renders identical markup under dir=ltr and dir=rtl (the mirror is CSS, never a JS branch)', () => {
    // Compares the WIDGET subtree, not the harness wrapper (whose own `dir` is
    // the variable under test). Byte-identical output either way is the proof
    // that the chrome mirrors by CSS resolving logical properties — and that the
    // LTR island is pinned structurally, not re-derived per direction.
    const widgetHtml = (dir: 'ltr' | 'rtl'): string => {
      const { container } = render(withMaps(
        <div dir={dir}>
          <MapBubble points={CITY_POINTS} />
        </div>,
      ));
      const html = (container.querySelector('[data-widget="map-bubble"]') as HTMLElement).outerHTML;
      cleanup();
      return html;
    };
    expect(widgetHtml('rtl')).toBe(widgetHtml('ltr'));
  });

  it('uses no physical-direction utility anywhere in the tree', () => {
    const { container } = render(withMaps(<MapBubble points={TOWN_POINTS} areas={[{ id: 'a', geometry: SQUARE }]} onAreaChange={() => undefined} />));
    const offenders = allClassNames(container).filter((name) => PHYSICAL.test(name));
    expect(offenders).toEqual([]);
  });

  it('switches the ranking when the metric tabs change ("metric tabs")', () => {
    const { container } = render(<MapBubble points={CITY_POINTS} format={(v) => `${v}`} />);
    expect(container.querySelector('[data-part="metric-tabs"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'revenue' }));
    const rows = [...container.querySelectorAll('[data-part="geo-ranking-row"]')];
    // `revenue` reorders: Lagos (80) now outranks Tokyo (40).
    expect(rows.map((row) => row.textContent)).toEqual(['1.Lagos80', '2.Tokyo40', '3.Oslo10']);
  });

  it('hides the metric tabs when there is only one metric to switch between', () => {
    const single = [{ name: 'Tokyo', lat: 35.7, lng: 139.7, values: { users: 1 } }];
    const { container } = render(<MapBubble points={single} />);
    expect(container.querySelector('[data-part="metric-tabs"]')).toBeNull();
  });

  it('honours topN=0 (the companion list is optional)', () => {
    const { container } = render(<MapBubble points={CITY_POINTS} topN={0} />);
    expect(container.querySelector('[data-part="geo-ranking"]')).toBeNull();
  });

  // ── what a host that is not the dashboard asks for (the kit's map part): all optional ──

  it('draws the picked point filled and marks its row, and picking another repaints the buttons there are', async () => {
    const { container, rerender } = render(withMaps(<MapBubble points={CITY_POINTS} listOrder="given" selected={1} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pins = [...container.querySelectorAll<HTMLElement>('[data-part="map-pin"]')];
    expect(pins.map((pin) => pin.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    expect(pins[1]!.dataset['selected']).toBe('');
    expect(pins[1]!.style.boxShadow).not.toBe('');
    expect(container.querySelector('[data-part="geo-ranking-row"][aria-current="true"]')?.textContent).toContain(CITY_POINTS[1]!.name);
    // Another pick: the same three buttons, so a pin in the middle of a drag keeps its own.
    rerender(withMaps(<MapBubble points={CITY_POINTS} listOrder="given" selected={2} />));
    const after = [...container.querySelectorAll<HTMLElement>('[data-part="map-pin"]')];
    expect(after).toEqual(pins);
    expect(after.map((pin) => pin.getAttribute('aria-current'))).toEqual([null, null, 'true']);
    expect(pins[1]!.style.boxShadow).toBe('');
    // None picked: no pin and no row says so.
    rerender(withMaps(<MapBubble points={CITY_POINTS} listOrder="given" />));
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('draws a pin in the tone its point names, and in the accent without one', async () => {
    const { container } = render(withMaps(<MapBubble points={[{ ...CITY_POINTS[0]!, tone: 'danger' }, CITY_POINTS[1]!]} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pins = [...container.querySelectorAll<HTMLElement>('[data-part="map-pin"]')];
    expect(pins.map((pin) => pin.style.color)).toEqual(['var(--danger)', 'var(--accent)']);
  });

  it('takes light or dark from a host that says it, and changes the style of the map that is there', async () => {
    const { rerender } = render(withMaps(<MapBubble points={CITY_POINTS} theme="dark" />));
    const map = await builtMap();
    expect(map.options.style).toBe(`${MAP_SERVER}/styles/dark`);
    act(() => map.fire('style.load'));
    rerender(withMaps(<MapBubble points={CITY_POINTS} theme="light" />));
    expect(map.styles).toEqual([`${MAP_SERVER}/styles/dark`, `${MAP_SERVER}/styles/positron`]);
    expect(fake.maps).toHaveLength(1);
  });

  it('holdView: once the person has moved the map, new places are not fitted; without it they are', async () => {
    const more = [...CITY_POINTS, { name: 'Lima', lat: -12.05, lng: -77.04, values: { users: 5 } }];
    const held = render(withMaps(<MapBubble points={CITY_POINTS} holdView />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    // A move the map made itself carries no event of a hand: the view still follows the places.
    act(() => map.fire('movestart', {}));
    held.rerender(withMaps(<MapBubble points={more} holdView />));
    expect(map.fitted).toHaveLength(2);
    act(() => map.fire('movestart', { originalEvent: new Event('mousedown') }));
    held.rerender(withMaps(<MapBubble points={CITY_POINTS} holdView />));
    expect(map.fitted).toHaveLength(2);
    held.unmount();

    fake.maps.length = 0;
    const free = render(withMaps(<MapBubble points={CITY_POINTS} />));
    const second = await builtMap();
    act(() => second.fire('style.load'));
    act(() => second.fire('movestart', { originalEvent: new Event('mousedown') }));
    free.rerender(withMaps(<MapBubble points={more} />));
    expect(second.fitted).toHaveLength(2);
  });

  it('emits the selected place from the ranked list (the map’s keyboard-reachable twin)', () => {
    const onSelect = vi.fn();
    render(<MapBubble points={CITY_POINTS} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tokyo' }));
  });
});

describe('map-bubble widget wrapper', () => {
  it('emits record-open against binding.source.name for the selected place', () => {
    const onEvent = vi.fn();
    // A full, schema-valid query descriptor — the table/view lives at
    // `binding.source.name`, NOT `binding.table`.
    const config = mapBubbleConfigSchema.parse({
      binding: { connectionId: 'conn-1', source: { name: 'stores' }, shape: 'geo-points' },
    });
    render(
      <MapBubbleWidget
        config={config}
        data={{ points: CITY_POINTS }}
        instanceId="mb"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'record-open',
      connectionId: 'conn-1',
      table: 'stores',
      recordId: 'Tokyo',
    });
  });

  /**
   * annex `linkedList`. The config field is only meaningful if it REACHES the
   * host: widgets never talk to each other, so the pairing has to ride on the
   * event or the host can never focus the list the user configured.
   */
  it('carries config.linkedList onto record-open as linkedInstanceId', () => {
    const onEvent = vi.fn();
    const config = mapBubbleConfigSchema.parse({
      binding: { connectionId: 'conn-1', source: { name: 'stores' }, shape: 'geo-points' },
      linkedList: 'my-ranked-list',
    });
    render(<MapBubbleWidget config={config} data={{ points: CITY_POINTS }} instanceId="mb4" onEvent={onEvent} />);
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ linkedInstanceId: 'my-ranked-list' }));
  });

  it('omits the pairing entirely when no linkedList is configured (an unpaired open)', () => {
    const onEvent = vi.fn();
    const config = mapBubbleConfigSchema.parse({ binding: { connectionId: 'c', source: { name: 't' }, shape: 'geo-points' } });
    render(<MapBubbleWidget config={config} data={{ points: CITY_POINTS }} instanceId="mb5" onEvent={onEvent} />);
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    expect(onEvent.mock.calls[0]?.[0]).not.toHaveProperty('linkedInstanceId');
  });

  it('emits drill-through instead when config names a route', () => {
    const onEvent = vi.fn();
    const config = mapBubbleConfigSchema.parse({ href: '/stores' });
    render(<MapBubbleWidget config={config} data={{ points: CITY_POINTS }} instanceId="mb2" onEvent={onEvent} />);
    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/stores' });
  });

  it('renders a live { rows } payload through the config-named lat/lng columns', () => {
    const config = mapBubbleConfigSchema.parse({ latColumn: 'latitude', lngColumn: 'longitude', nameField: 'city' });
    const { container } = render(
      <MapBubbleWidget
        config={config}
        data={{ rows: [{ city: 'Berlin', latitude: 52.5, longitude: 13.4, users: 40 }], total: 1 }}
        instanceId="mb3"
        onEvent={() => {}}
      />,
    );
    expect(container.textContent).toContain('Berlin');
  });
});

// ── map-choropleth-grid ─────────────────────────────────────────────────────

const REGION_POINTS = [
  { code: 'CA', name: 'California', values: { sales: 400 } },
  { code: 'TX', name: 'Texas', values: { sales: 250 } },
  { code: 'NY', name: 'New York', values: { sales: 100 } },
];

describe('map-choropleth-grid', () => {
  it('renders the empty state when there are no regions', () => {
    render(<MapChoroplethGrid points={[]} metric="sales" emptyTitle="No regions" />);
    expect(screen.getByText('No regions')).toBeTruthy();
  });

  it('renders the shared ChoroplethGridChart tilegram + the ranked companion', () => {
    const { container } = render(<MapChoroplethGrid points={REGION_POINTS} metric="sales" format={(v) => `${v}`} />);
    // The tiles come from @adminium/charts' primitive — the same one
    // `chart-choropleth-grid` renders (the annex cross-lists ONE visual).
    expect(container.querySelector('[data-region-tile="CA"]')).not.toBeNull();
    const ranked = [...container.querySelectorAll('[data-part="region-ranking"] li')];
    expect(ranked.map((row) => row.textContent?.replace(/\s+/g, ''))).toEqual([
      '1.California400',
      '2.Texas250',
      '3.NewYork100',
    ]);
  });

  /**
   * The empty-tilegram trap. `us-tilegram` (the default layout) plots only the
   * USPS tiles it knows, so a payload of non-US country codes places ZERO tiles
   * and — because the legend renders unconditionally — leaves just the low→high
   * swatches: a legend for a map that is not on the page. The widget must degrade
   * to the code-agnostic `grid` layout so the data stays visible as tiles.
   */
  it('falls back to the grid layout so non-US region codes still tile, never a bare legend', () => {
    // Codes chosen to NOT collide with USPS: `DE` would be Delaware, `LA`
    // Louisiana — the ISO-country/USPS-state overlap the tilegram can't tell apart.
    const worldPoints = [
      { code: 'FR', name: 'France', values: { sales: 300 } },
      { code: 'JP', name: 'Japan', values: { sales: 220 } },
      { code: 'BR', name: 'Brazil', values: { sales: 140 } },
    ];
    const { container } = render(<MapChoroplethGrid points={worldPoints} metric="sales" />);
    // On `us-tilegram` this is 0; the `grid` fallback tiles every point.
    expect(container.querySelectorAll('[data-region-tile]')).toHaveLength(3);
  });

  /**
   * The DEFAULT desktop case, not an edge case: the offline contract resolves every
   * `map-*` id to this widget offline, so a page whose data is coordinate points
   * (name + values, NO region code — the `map-bubble` shape) now renders here. The
   * tilegram can place none of them; the grid fallback tiles them all.
   */
  it('tiles a code-less payload — the offline map-bubble fallback (lat/lng data, no codes)', () => {
    const cityPoints = [
      { name: 'Tokyo', values: { users: 900 } },
      { name: 'London', values: { users: 500 } },
      { name: 'Lagos', values: { users: 200 } },
    ];
    const { container } = render(<MapChoroplethGrid points={cityPoints} metric="users" />);
    expect(container.querySelectorAll('[data-region-tile]')).toHaveLength(3);
  });

  /**
   * The degrade is data-driven, not a blanket override: as soon as ONE code lands
   * on a known tile the tilegram is kept (the geographic island), and the foreign
   * codes are dropped as before. Only an all-non-US payload falls back.
   */
  it('keeps the us-tilegram when any code is a known US tile (mixed payload)', () => {
    const mixed = [
      { code: 'CA', name: 'California', values: { sales: 400 } },
      { code: 'JP', name: 'Japan', values: { sales: 300 } },
    ];
    const { container } = render(<MapChoroplethGrid points={mixed} metric="sales" />);
    // The island plots the state it knows and silently drops the country code.
    expect(container.querySelector('[data-region-tile="CA"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-region-tile]')).toHaveLength(1);
  });

  it('uses no physical-direction utility anywhere in the tree', () => {
    const { container } = render(<MapChoroplethGrid points={REGION_POINTS} metric="sales" />);
    expect(allClassNames(container).filter((name) => PHYSICAL.test(name))).toEqual([]);
  });
});

// ── registry metadata ───────────────────────────────────────────────────────

describe('geo registry metadata (annex)', () => {
  it('registers the exact annex ids in the geo family', () => {
    expect(mapBubbleDefinition.id).toBe('map-bubble');
    expect(mapChoroplethGridDefinition.id).toBe('map-choropleth-grid');
    expect(mapBubbleDefinition.family).toBe('geo');
    expect(mapChoroplethGridDefinition.family).toBe('geo');
  });

  it('declares the geo-points contract for both', () => {
    expect(mapBubbleDefinition.dataContract).toBe('geo-points');
    expect(mapChoroplethGridDefinition.dataContract).toBe('geo-points');
  });

  it('sizes map-bubble per the annex (min 6×4, default 8×5 → half-units)', () => {
    // Annex rows R ⇒ h = round(R × 2).
    expect(mapBubbleDefinition.sizing).toEqual({ minW: 6, minH: 8, defaultW: 8, defaultH: 10 });
  });

  /**
   * The annex cross-lists map-choropleth-grid AS chart-choropleth-grid ("See
   * `chart-choropleth-grid` … cross-listed here"). One visual under two ids, so
   * the two registrations must not drift apart in footprint.
   */
  it('sizes map-choropleth-grid identically to its cross-listed charts twin', () => {
    expect(mapChoroplethGridDefinition.sizing).toEqual({ minW: 4, minH: 6, defaultW: 6, defaultH: 6 });
  });

  it('both components are React.lazy refs (one chunk per family)', () => {
    const LAZY = Symbol.for('react.lazy');
    expect((mapBubbleDefinition.component as { $$typeof?: symbol }).$$typeof).toBe(LAZY);
    expect((mapChoroplethGridDefinition.component as { $$typeof?: symbol }).$$typeof).toBe(LAZY);
  });
});

// ── demoData ────────────────────────────────────────────────────────────────

describe('geo demoData determinism', () => {
  it('map-bubble: same seed → identical payload; different seeds → different', () => {
    expect(JSON.stringify(mapBubbleDemoData(7))).toBe(JSON.stringify(mapBubbleDemoData(7)));
    expect(JSON.stringify(mapBubbleDemoData(7))).not.toBe(JSON.stringify(mapBubbleDemoData(8)));
  });

  it('map-choropleth-grid: same seed → identical payload; different seeds → different', () => {
    expect(JSON.stringify(mapChoroplethGridDemoData(7))).toBe(JSON.stringify(mapChoroplethGridDemoData(7)));
    expect(JSON.stringify(mapChoroplethGridDemoData(7))).not.toBe(JSON.stringify(mapChoroplethGridDemoData(8)));
  });

  it('map-bubble demo points all land on real, plottable coordinates', () => {
    const points = mapBubbleDemoData(3).points;
    expect(plottablePoints(points)).toHaveLength(points.length);
  });

  it('map-bubble demo carries two metrics, so the metric switcher has something to switch', () => {
    expect(metricKeysOf(mapBubbleDemoData(1).points)).toEqual(['users', 'revenue']);
  });

  it('map-choropleth-grid demo codes are real USPS tiles the tilegram can place', () => {
    const { container } = render(
      <MapChoroplethGrid points={mapChoroplethGridDemoData(5).points} metric="sales" />,
    );
    // An unknown code is silently dropped by `choroplethLayout` (a geographic
    // island only plots tiles it knows), so a typo'd demo would render blank.
    expect(container.querySelectorAll('[data-region-tile]')).toHaveLength(16);
  });

  it('config schemas parse their own demo-shaped defaults', () => {
    expect(mapBubbleConfigSchema.safeParse({}).success).toBe(true);
    expect(mapChoroplethGridConfigSchema.safeParse({}).success).toBe(true);
    // The classifier's `geo.lat-lng-pair` rule emits exactly this config shape —
    // renaming these keys silently breaks every auto-generated map.
    const parsed = mapBubbleConfigSchema.parse({ title: 'Stores', latColumn: 'lat', lngColumn: 'lng' });
    expect(parsed.latColumn).toBe('lat');
    expect(parsed.lngColumn).toBe('lng');
  });

  it('rejects out-of-domain initialCenter coordinates', () => {
    expect(mapBubbleConfigSchema.safeParse({ initialCenter: [91, 0] }).success).toBe(false);
    expect(mapBubbleConfigSchema.safeParse({ initialCenter: [45, -120] }).success).toBe(true);
  });
});

// ── chrome localization ─────────────────────────────────────────────────────

describe('geo chrome localization (ui:widgets.geo.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { widgets: { geo: { mapBubble: { emptyTitle: 'Keine Orte', emptyBody: 'Koordinaten wählen.' } } } }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <MapBubble points={[]} />
      </I18nProvider>,
    );
    expect(screen.getByText('Keine Orte')).toBeTruthy();

    cleanup();
    render(<MapBubble points={[]} />);
    expect(screen.getByText('No locations')).toBeTruthy();
  });
});

// ── the map, after its review ───────────────────────────────────────────────

describe('map-bubble — shapes of several pieces, late areas, numbering, the list, a save that fails, the keyboard', () => {
  const SQUARE = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  const OUTER = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const HOLE = [[1, 1], [2, 1], [2, 2], [1, 1]];
  const ISLAND = [[[10, 10], [11, 10], [11, 11], [10, 10]]];
  const PIECES = { type: 'MultiPolygon' as const, coordinates: [[OUTER, HOLE], ISLAND] };
  const CAIO = { name: 'Caio', lat: -23.5, lng: -46.6, by: 'exact' as const, values: { n: 1 } };

  type PinElement = HTMLElement & { marker?: { at: { lng: number; lat: number }; fire: (type: string) => void; setLngLat: (at: [number, number]) => unknown } };
  const pinsOf = (container: HTMLElement): PinElement[] => [...container.querySelectorAll<PinElement>('[data-part="map-pin"]')];
  const cornersOf = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-part="map-corner"]')];
  const saidOf = (container: HTMLElement): string | null | undefined => container.querySelector('[data-part="map-said"]')?.textContent;
  const draftOf = (map: (typeof fake.maps)[number]): unknown => (map.sources.get('adminium-draft')?.data as { features: { geometry: unknown }[] }).features[0]?.geometry;

  // ── 1: a hole and a second piece are kept, and drawn ──────────────────────

  it('a corner moved in a shape with a hole and a second piece keeps both, and draws them while it is changed', async () => {
    const onAreaChange = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[]} areas={[{ id: 'a', geometry: PIECES }]} onAreaChange={onAreaChange} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    expect(cornersOf(container)).toHaveLength(4);
    // The whole shape is on the map while it is changed, not its first ring alone.
    expect(draftOf(map)).toEqual(PIECES);
    expect(container.querySelector('[data-part="area-pieces-hint"]')).not.toBeNull();
    fireEvent.keyDown(cornersOf(container)[1]!, { key: 'ArrowRight' });
    const changed = { type: 'MultiPolygon', coordinates: [[[[0, 0], [4.04, 0], [4, 4], [0, 4], [0, 0]], HOLE], ISLAND] };
    expect(onAreaChange).toHaveBeenLastCalledWith('a', changed);
    expect(draftOf(map)).toEqual(changed);
  });

  it('"Start again" replaces the whole shape with one new polygon', async () => {
    const onAreaChange = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[]} areas={[{ id: 'a', geometry: PIECES }]} onAreaChange={onAreaChange} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-part="area-restart"]')!);
    for (const [lng, lat] of [[0, 0], [1, 0], [1, 1]]) act(() => map.fire('click', { lngLat: { lng, lat }, point: { x: 0, y: 0 } }));
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-part="area-close"]')!);
    expect(onAreaChange).toHaveBeenLastCalledWith('a', { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
  });

  // ── 3: one area that arrives after the first render ───────────────────────

  it('the one area that arrives late is the one that is changed, not the start of a second', async () => {
    const onAreaChange = vi.fn();
    const { container, rerender } = render(withMaps(<MapBubble points={[]} areas={[]} onAreaChange={onAreaChange} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    expect(cornersOf(container)).toHaveLength(0);
    rerender(withMaps(<MapBubble points={[]} areas={[{ id: 'late', geometry: SQUARE }]} onAreaChange={onAreaChange} />));
    expect(cornersOf(container)).toHaveLength(4);
    fireEvent.keyDown(cornersOf(container)[1]!, { key: 'ArrowRight' });
    expect(onAreaChange).toHaveBeenLastCalledWith('late', { type: 'Polygon', coordinates: [[[0, 0], [1.04, 0], [1, 1], [0, 1], [0, 0]]] });
  });

  it('one area that is not being changed has a "Change" of its own', async () => {
    const two = [{ id: 'a', geometry: SQUARE }, { id: 'b', geometry: SQUARE }];
    const { container, rerender } = render(withMaps(<MapBubble points={[]} areas={two} onAreaChange={() => undefined} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    rerender(withMaps(<MapBubble points={[]} areas={[two[0]!]} onAreaChange={() => undefined} />));
    expect(cornersOf(container)).toHaveLength(0);
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-part="area-change"]')!);
    expect(cornersOf(container)).toHaveLength(4);
  });

  // ── 6: a stop keeps its number, with or without a position ────────────────

  it('numbers a pin as its row in the list is numbered, when a stop before it has no position', async () => {
    const stops = [
      { name: 'Depot', lat: 1, lng: 1, values: {} },
      { name: 'Nowhere yet', values: {} },
      { name: 'Last', lat: 3, lng: 3, values: {} },
    ];
    const legs = [{ distanceM: null, durationS: null, estimate: true, unknown: true as const }, { distanceM: null, durationS: null, estimate: true, unknown: true as const }];
    const { container } = render(withMaps(<MapBubble points={stops} route={{ legs }} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    expect(pinsOf(container).map((pin) => pin.textContent)).toEqual(['1', '3']);
    expect(pinsOf(container).map((pin) => pin.getAttribute('aria-label'))).toEqual(['1. Depot', '3. Last']);
    expect([...container.querySelectorAll('[data-part="geo-ranking-row"]')].map((row) => row.textContent)).toEqual(['1.Depot', '2.Nowhere yet', '3.Last']);
  });

  // ── 7: distances in the reader's language ─────────────────────────────────

  it('writes a distance as the reader’s language does, with no locale handed to it', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({ locale: 'de_DE', loadBundle: async () => null });
    const stops = [
      { name: 'A', lat: 1, lng: 1, values: {} },
      { name: 'B', lat: 2, lng: 2, values: {} },
    ];
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <MapBubble points={stops} route={{ legs: [{ distanceM: 81_240, durationS: null, estimate: false }] }} />
      </I18nProvider>,
    );
    // German writes the decimal with a comma.
    expect(container.querySelector('[data-part="geo-row-note"]')?.textContent).toContain('81,2 km');
  });

  // ── 8: a long list in its given order ─────────────────────────────────────

  it('lists the first 200 of the points it was given and says how many more there are, with a pin for every one', async () => {
    const many = Array.from({ length: 205 }, (_, index) => ({ name: `P${String(index)}`, lat: index / 10, lng: index / 10, values: {} }));
    const { container } = render(withMaps(<MapBubble points={many} listOrder="given" showValues={false} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    expect(container.querySelectorAll('[data-part="geo-ranking-row"]')).toHaveLength(200);
    expect(container.querySelector('[data-part="geo-list-more"]')?.textContent).toBe('and 5 more');
    expect(pinsOf(container)).toHaveLength(205);
  });

  it('says nothing of more when the list holds every point', () => {
    const { container } = render(<MapBubble points={[CAIO]} listOrder="given" />);
    expect(container.querySelector('[data-part="geo-list-more"]')).toBeNull();
  });

  // ── 10: a pin whose new spot is not kept goes back ────────────────────────

  /** Pick the pin up, move it one step east, and keep it. */
  function moveWithKeys(pin: HTMLElement): void {
    fireEvent.keyDown(pin, { key: 'Enter' });
    fireEvent.keyDown(pin, { key: 'ArrowRight' });
    fireEvent.keyDown(pin, { key: 'Enter' });
  }

  it('a pin goes back when the save is refused', async () => {
    const onPlace = vi.fn(() => Promise.reject(new Error('no')));
    const { container } = render(withMaps(<MapBubble points={[CAIO]} onPlace={onPlace} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pin = pinsOf(container)[0]!;
    moveWithKeys(pin);
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(pin.marker?.at.lng).toBeCloseTo(-46.56, 6);
    await waitFor(() => expect(pin.marker?.at).toEqual({ lng: -46.6, lat: -23.5 }));
    await waitFor(() => expect(saidOf(container)).toBe('The new spot was not kept. The pin is back where it was.'));
  });

  it('a dragged pin goes back when the caller changes nothing', async () => {
    const onPlace = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[CAIO]} onPlace={onPlace} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pin = pinsOf(container)[0]!;
    pin.marker?.setLngLat([-40, -20]);
    act(() => pin.marker?.fire('dragend'));
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Caio' }), { lat: -20, lng: -40 });
    await waitFor(() => expect(pin.marker?.at).toEqual({ lng: -46.6, lat: -23.5 }));
  });

  it('a pin whose new spot the caller keeps stays there, and the view does not jump to it', async () => {
    function Host() {
      const [at, setAt] = useState({ lat: CAIO.lat, lng: CAIO.lng });
      return withMaps(<MapBubble points={[{ ...CAIO, ...at }]} onPlace={async (_point, next) => setAt(next)} />);
    }
    const { container } = render(<Host />);
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const fits = map.fitted.length;
    await act(async () => moveWithKeys(pinsOf(container)[0]!));
    await waitFor(() => expect(pinsOf(container)[0]?.marker?.at.lng).toBeCloseTo(-46.56, 6));
    await act(async () => {
      await new Promise((done) => setTimeout(done, 400));
    });
    expect(pinsOf(container)[0]?.marker?.at.lng).toBeCloseTo(-46.56, 6);
    expect(map.fitted).toHaveLength(fits);
    expect(saidOf(container)).toBe('Pin kept at -23.50000, -46.56000.');
  });

  it('after a save that fails, the next real change to the places is fitted again', async () => {
    const onPlace = vi.fn(() => Promise.reject(new Error('no')));
    const { container, rerender } = render(withMaps(<MapBubble points={[CAIO]} onPlace={onPlace} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pin = pinsOf(container)[0]!;
    moveWithKeys(pin);
    await waitFor(() => expect(pin.marker?.at).toEqual({ lng: -46.6, lat: -23.5 }));
    const fits = map.fitted.length;
    rerender(withMaps(<MapBubble points={[CAIO, { name: 'Dora', lat: 10, lng: 10, values: { n: 1 } }]} onPlace={onPlace} />));
    expect(map.fitted).toHaveLength(fits + 1);
  });

  // ── 17: the keyboard, and what is said ────────────────────────────────────

  it('the pins are one tab stop: the arrow keys go from pin to pin in the list’s order', async () => {
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pins = pinsOf(container);
    expect(pins.map((pin) => pin.tabIndex)).toEqual([0, -1, -1]);
    pins[0]!.focus();
    fireEvent.keyDown(pins[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(pins[1]);
    expect(pins.map((pin) => pin.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(pins[1]!, { key: 'End' });
    expect(document.activeElement).toBe(pins[2]);
    fireEvent.keyDown(pins[2]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(pins[0]);
    fireEvent.keyDown(pins[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(pins[2]);
  });

  it('a pin is moved only once it is picked up: Enter picks it up, the arrows move it, Escape puts it back — each said', async () => {
    const onPlace = vi.fn();
    const { container } = render(withMaps(<MapBubble points={[CAIO]} onPlace={onPlace} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    const pin = pinsOf(container)[0]!;
    // Not picked up: an arrow key moves nothing.
    fireEvent.keyDown(pin, { key: 'ArrowRight' });
    expect(pin.marker?.at).toEqual({ lng: -46.6, lat: -23.5 });
    fireEvent.keyDown(pin, { key: ' ' });
    expect(saidOf(container)).toBe('Pin picked up. Move it with the arrow keys, then press Enter to keep the spot or Escape to put it back.');
    fireEvent.keyDown(pin, { key: 'ArrowRight' });
    expect(pin.marker?.at.lng).toBeCloseTo(-46.56, 6);
    fireEvent.keyDown(pin, { key: 'Escape' });
    expect(pin.marker?.at).toEqual({ lng: -46.6, lat: -23.5 });
    expect(saidOf(container)).toBe('The pin is back where it was.');
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('says each corner as it is added, and that the shape is closed', async () => {
    const { container } = render(withMaps(<MapBubble points={[]} areas={[]} onAreaChange={() => undefined} />));
    const map = await builtMap();
    act(() => map.fire('style.load'));
    expect(saidOf(container)).toBe('');
    act(() => map.fire('click', { lngLat: { lng: 0, lat: 0 }, point: { x: 0, y: 0 } }));
    expect(saidOf(container)).toBe('Corner added. 1 corner.');
    act(() => map.fire('click', { lngLat: { lng: 1, lat: 0 }, point: { x: 0, y: 0 } }));
    act(() => map.fire('click', { lngLat: { lng: 1, lat: 1 }, point: { x: 0, y: 0 } }));
    expect(saidOf(container)).toBe('Corner added. 3 corners.');
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-part="area-close"]')!);
    expect(saidOf(container)).toBe('Shape closed.');
    expect(container.querySelector('[data-part="map-said"]')?.getAttribute('role')).toBe('status');
  });

  it('a notice that is read aloud is in the page before its words are', async () => {
    const { renderToString } = await import('react-dom/server');
    // As first drawn, before any effect: the notice is there and says nothing yet.
    const first = document.createElement('div');
    first.append(document.createRange().createContextualFragment(renderToString(<MapBubble points={CITY_POINTS} />)));
    expect(first.querySelector('[data-part="map-off"]')).not.toBeNull();
    expect(first.querySelector('[data-part="map-off"]')?.textContent).toBe('');
    const { container } = render(<MapBubble points={CITY_POINTS} />);
    expect(container.querySelector('[data-part="map-off"]')?.textContent).toBe('Maps are switched off. Here is the list.');
  });

  it('the way to Settings goes through the host when it gives one, and is a plain link otherwise', () => {
    const env: WidgetRuntimeEnv = { runtime: 'browser', offlineAssets: false, maps: { server: null, routing: false, settingsHref: '/settings/maps' } };
    const onSettingsOpen = vi.fn();
    const { container } = render(withMaps(<MapBubble points={CITY_POINTS} onSettingsOpen={onSettingsOpen} />, env));
    const link = container.querySelector<HTMLAnchorElement>('[data-part="map-off-link"]')!;
    expect(link.getAttribute('href')).toBe('/settings/maps');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => void link.dispatchEvent(click));
    expect(onSettingsOpen).toHaveBeenCalledWith('/settings/maps');
    expect(click.defaultPrevented).toBe(true);
    // A click meant for a new tab is the browser's.
    const held = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    act(() => void link.dispatchEvent(held));
    expect(onSettingsOpen).toHaveBeenCalledTimes(1);
  });
});
