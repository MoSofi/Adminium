// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `geo` family (annex §7, TRACK COMM-GEO): the `geo-points` reader, the bubble
 * scale, and render/behaviour tests for map-bubble + map-choropleth-grid.
 *
 * TWO SUITES CARRY REAL WEIGHT HERE:
 *
 *  1. THE DEGRADATION CONTRACT (acceptance #3). Leaflet builds FINE under
 *     happy-dom — it reaches `data-map-status="ready"` with a real
 *     `.leaflet-container`, and left alone these tests would quietly construct
 *     live maps pointed at a tile CDN. So the environment is not the test: the
 *     `unavailable` suite MOCKS the dynamic `import('leaflet')` into a rejection,
 *     which is the only way to actually enter the catch blocks that back
 *     MapBubble's "DEGRADES, NEVER CRASHES" header (a blocked tile CDN, an
 *     offline build, a failed chunk fetch). Delete those catches and that suite
 *     goes red — which is the point. The static-import/graph half of acceptance
 *     #3 is asserted in qa/chunk-budget.test.ts, which can see the module graph;
 *     this half asserts the runtime consequence.
 *
 *  2. THE LTR ISLAND (04 §7.4). Geography does not mirror: the map canvas must
 *     stay `dir="ltr"` under an RTL host, while the chrome around it mirrors
 *     through logical properties. As elsewhere in the repo, "does it mirror" is
 *     asserted on WHICH utilities express the layout (happy-dom computes no
 *     geometry), plus a hard ban on physical-direction utilities.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
  THE LEAFLET STUB — the load-bearing fixture of this file.

  `MapBubble` reaches Leaflet through a dynamic `import('leaflet')` inside its
  mount effect, and happy-dom is perfectly capable of building a real map from
  it: without this mock the suite constructs live maps against
  basemaps.cartocdn.com AFTER each test body returns, and every `try/catch` in
  the widget stays unexecuted — the whole `unavailable` contract could be deleted
  with the suite still green.

  Rejecting the import is precisely the production failure the widget promises to
  survive (blocked tile CDN, offline desktop build, failed chunk fetch), so it is
  what the map tests below run against.
*/
vi.mock('leaflet', () => {
  throw new Error('leaflet chunk unavailable');
});

import { MapBubble, MapBubbleWidget } from './MapBubble.js';
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
  CARTO_TILES,
  bubbleRadius,
  geoPointsOf,
  localeOf,
  maxMetric,
  metricKeysOf,
  plottablePoints,
  sourceOf,
} from './geo-lib.js';
import { mapBubbleDefinition, mapChoroplethGridDefinition } from './geo-track.definitions.js';

afterEach(cleanup);

/** Every physical-direction Tailwind utility the RTL policy bans (10 §5.2). */
const PHYSICAL =
  /(^|\s)-?(ml|mr|pl|pr)-|(^|\s)-?(left|right)-|(^|\s)border-(l|r)(-|\s|$)|(^|\s)rounded-(l|r|tl|tr|bl|br)(-|\s|$)|(^|\s)text-(left|right)(\s|$)/;

function allClassNames(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[class]')].map((node) => node.className);
}

const FIELDS = { nameField: 'name', codeField: 'code', latField: 'lat', lngField: 'lng', metricFields: [] };

// ── geo-lib: the geo-points reader ──────────────────────────────────────────

describe('geoPointsOf — envelope handling', () => {
  it('reads the canonical §3 { points } envelope with an explicit values map', () => {
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
  it('sourceOf reads binding.source.name (04 §5.1 — not binding.table)', () => {
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

  it('serves theme-matched Carto basemaps (annex §7 "theme-following tiles")', () => {
    expect(CARTO_TILES.light).toContain('light_all');
    expect(CARTO_TILES.dark).toContain('dark_all');
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

  /**
   * The load-bearing degradation test. The Leaflet import is stubbed into a
   * rejection (see the mock at the top), standing in for every real-world way
   * the map can fail: a blocked tile CDN, an offline desktop build, a failed
   * chunk fetch. The widget must still be USEFUL — hence a real ranked list, not
   * a spinner — and must never throw into the WidgetFrame error boundary.
   */
  it('renders the ranked list and does not crash when Leaflet cannot build a map', () => {
    const { container } = render(<MapBubble points={CITY_POINTS} format={(v) => `${v}`} />);
    expect(container.querySelector('[data-widget="map-bubble"]')).not.toBeNull();
    const rows = [...container.querySelectorAll('[data-part="geo-ranking-row"]')];
    // Ranked by the active metric (`users`), descending.
    expect(rows.map((row) => row.textContent)).toEqual(['1.Tokyo900', '2.Lagos200', '3.Oslo50']);
  });

  /**
   * The assertion the header's "DEGRADES, NEVER CRASHES" guarantee actually
   * rests on, and the reason the mock exists: the handshake fails, the widget
   * flips to `unavailable`, and it SAYS SO — pointing the reader at the ranked
   * list that carries the same data. Deleting the catch blocks in MapBubble.tsx
   * turns this red (the status would stay `idle` and the notice never render).
   *
   * `await`ed, not synchronous: the status flips a microtask later, when the
   * rejected `import('leaflet')` settles — a synchronous assertion here would
   * pass whether or not the widget handled anything at all.
   */
  it('flips to data-map-status="unavailable" and shows the notice when the Leaflet chunk fails', async () => {
    const { container } = render(<MapBubble points={CITY_POINTS} mapUnavailableLabel="Map unavailable." />);
    await waitFor(() =>
      expect(container.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status')).toBe('unavailable'),
    );
    expect(container.querySelector('[data-part="map-unavailable"]')?.textContent).toBe('Map unavailable.');
    // Still useful with no map: the same data, as real focusable text.
    expect(container.querySelectorAll('[data-part="geo-ranking-row"]')).toHaveLength(3);
    expect(container.querySelector('.leaflet-container')).toBeNull();
  });

  /**
   * The empty→populated path. The mount effect early-returns when the container
   * is absent, and the empty branch renders `EmptyState` INSTEAD of the canvas —
   * so a mount-only effect would never see the container appear and the widget
   * would sit at `idle` forever: a silent blank box next to a populated ranked
   * list, with not even the `unavailable` notice to explain it.
   */
  it('builds the map when points arrive after an empty first render', async () => {
    const { container, rerender } = render(<MapBubble points={[]} />);
    expect(container.querySelector('[data-part="map-canvas"]')).toBeNull();
    rerender(<MapBubble points={CITY_POINTS} />);
    // Reaches a RESOLVED status (here `unavailable`, since the chunk is stubbed
    // as failing) rather than being stuck at the initial `idle`.
    await waitFor(() =>
      expect(container.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status')).toBe('unavailable'),
    );
  });

  it('keeps the map canvas a fixed-LTR island — geography never mirrors (04 §7.4)', () => {
    const { container } = render(<MapBubble points={CITY_POINTS} />);
    const canvasWrap = container.querySelector('[data-part="map-canvas"]')?.parentElement;
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
      const { container } = render(
        <div dir={dir}>
          <MapBubble points={CITY_POINTS} />
        </div>,
      );
      const html = (container.querySelector('[data-widget="map-bubble"]') as HTMLElement).outerHTML;
      cleanup();
      return html;
    };
    expect(widgetHtml('rtl')).toBe(widgetHtml('ltr'));
  });

  it('uses no physical-direction utility anywhere in the tree (10 §5.2)', () => {
    const { container } = render(<MapBubble points={CITY_POINTS} />);
    const offenders = allClassNames(container).filter((name) => PHYSICAL.test(name));
    expect(offenders).toEqual([]);
  });

  it('switches the ranking when the metric tabs change (annex §7 "metric tabs")', () => {
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
    // A full, schema-valid query descriptor (04 §5.1) — the table/view lives at
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
   * annex §7 `linkedList`. The config field is only meaningful if it REACHES the
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
   * The DEFAULT desktop case, not an edge case: 11-electron.md §7 resolves every
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

  it('uses no physical-direction utility anywhere in the tree (10 §5.2)', () => {
    const { container } = render(<MapChoroplethGrid points={REGION_POINTS} metric="sales" />);
    expect(allClassNames(container).filter((name) => PHYSICAL.test(name))).toEqual([]);
  });
});

// ── registry metadata ───────────────────────────────────────────────────────

describe('geo registry metadata (annex §7)', () => {
  it('registers the exact annex ids in the geo family', () => {
    expect(mapBubbleDefinition.id).toBe('map-bubble');
    expect(mapChoroplethGridDefinition.id).toBe('map-choropleth-grid');
    expect(mapBubbleDefinition.family).toBe('geo');
    expect(mapChoroplethGridDefinition.family).toBe('geo');
  });

  it('declares the §3 geo-points contract for both', () => {
    expect(mapBubbleDefinition.dataContract).toBe('geo-points');
    expect(mapChoroplethGridDefinition.dataContract).toBe('geo-points');
  });

  it('sizes map-bubble per the annex (min 6×4, default 8×5 → half-units)', () => {
    // 04 §6.1: annex rows R ⇒ h = round(R × 2).
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

  it('both components are React.lazy refs (one chunk per family, 04 §2.3)', () => {
    const LAZY = Symbol.for('react.lazy');
    expect((mapBubbleDefinition.component as { $$typeof?: symbol }).$$typeof).toBe(LAZY);
    expect((mapChoroplethGridDefinition.component as { $$typeof?: symbol }).$$typeof).toBe(LAZY);
  });
});

// ── demoData (04 §7.7) ──────────────────────────────────────────────────────

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
