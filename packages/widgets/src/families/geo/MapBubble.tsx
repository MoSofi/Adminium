// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { EmptyState, SegmentedControl, subscribeTheme } from '@adminium/ui';
import { MapPin } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CARTO_ATTRIBUTION,
  CARTO_TILES,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  bubbleRadius,
  localeOf,
  maxMetric,
  metricKeysOf,
  metricValue,
  plottablePoints,
  sourceOf,
} from './geo-lib.js';
import type { GeoPoint } from './geo-lib.js';
import { geoPointsOf } from './geo-lib.js';
import type { MapBubbleConfig } from './geo-config.js';
import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `geo-config`
// module so the registry metadata graph never eagerly pulls this component (or
// Leaflet) into the eager chunk (acceptance #3); re-exported here so the family
// barrel, stories, and tests keep one import point per widget.
export { mapBubbleConfigSchema, mapBubbleDemoData } from './geo-config.js';
export type { MapBubbleConfig };

/**
 * `map-bubble` (annex §7) — a Leaflet map with theme-following Carto light/dark
 * tiles, circle markers sized by the active metric, tooltips, flyTo on click,
 * and metric tabs. Pairs with `ranked-entity-list`; the built-in top-N companion
 * is the same ranking, rendered inline.
 *
 * ── THIS FILE IS THE ONLY PLACE LEAFLET EXISTS (acceptance #3) ──────────────
 * "Leaflet code is absent unless `map-bubble` is placed." Two boundaries enforce
 * it, and `qa/chunk-budget.test.ts` asserts both:
 *
 *   1. This module is reachable ONLY through `geo-track-components.ts`, which
 *      `geo-track.definitions.ts` reaches by `lazy(() => import(...))`. So no
 *      static-import path runs from the registry metadata to here.
 *   2. Leaflet itself is loaded by a dynamic `import()` INSIDE the mount effect
 *      — not a static import of this module. So Leaflet is not even in the geo
 *      family's own chunk: it is fetched when a MapBubble actually mounts, which
 *      is what the acceptance criterion literally asks for. (A static import
 *      here would satisfy "not in the eager chunk" but would still ship Leaflet
 *      to a page that placed only `map-choropleth-grid`, its familymate.)
 *
 * That same dynamic import is what makes the widget SSR-safe: effects never run
 * on the server, so Leaflet — which touches `window`/`document` at module scope —
 * is never evaluated there. The render path below is pure JSX and renders the
 * chrome + the ranked list with no map at all.
 *
 * ── DEGRADES, NEVER CRASHES ────────────────────────────────────────────────
 * Every step of the Leaflet handshake is inside a try/catch that flips the map
 * to `unavailable`: an offline/blocked CDN, a jsdom-class environment with no
 * layout, a failed chunk fetch. The ranked list is rendered from the same data
 * either way, so the widget is still USEFUL (and still accessible) with no map —
 * this is why the list is not merely a screen-reader fallback.
 *
 * ── RTL ────────────────────────────────────────────────────────────────────
 * The map canvas is a fixed-LTR island (04 §7.4; the same policy as the gantt
 * timeline and the choropleth tilegram): geography does not mirror — flipping it
 * would put Japan west of Portugal. The chrome around it (metric tabs, ranked
 * list, legend) is logical-property flow and mirrors normally.
 */

/** The Leaflet surface this widget uses — structural, so no `any` leaks in. */
type LeafletModule = typeof import('leaflet');
type LeafletMap = import('leaflet').Map;
type LeafletLayerGroup = import('leaflet').LayerGroup;
type LeafletTileLayer = import('leaflet').TileLayer;

export interface MapBubbleProps {
  points: readonly GeoPoint[];
  /** Metric keys for the tabs; the first is the initial selection. */
  metrics?: readonly string[] | undefined;
  /** Already-translated tab labels, keyed by metric name. */
  metricLabels?: Readonly<Record<string, string>> | undefined;
  center?: readonly [number, number] | undefined;
  zoom?: number | undefined;
  flyToOnClick?: boolean | undefined;
  topN?: number | undefined;
  format?: ((value: number) => string) | undefined;
  onSelect?: ((point: GeoPoint) => void) | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  mapUnavailableLabel?: string | undefined;
  regionsLabel?: string | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

/** The resolved theme right now, read off the attribute ThemeProvider stamps. */
function currentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function MapBubble({
  points,
  metrics,
  metricLabels,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  flyToOnClick = true,
  topN = 5,
  format = String,
  onSelect,
  emptyTitle,
  emptyBody,
  mapUnavailableLabel,
  regionsLabel,
  locale: localeProp,
  testId,
}: MapBubbleProps) {
  const t = useMaybeT();
  const locale = localeOf(localeProp);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LeafletLayerGroup | null>(null);
  const tilesRef = useRef<LeafletTileLayer | null>(null);
  const [mapStatus, setMapStatus] = useState<'idle' | 'ready' | 'unavailable'>('idle');

  const keys = metrics !== undefined && metrics.length > 0 ? metrics : metricKeysOf(points);
  const [metric, setMetric] = useState<string | undefined>(undefined);
  const activeMetric = metric !== undefined && keys.includes(metric) ? metric : keys[0];

  // Latest render inputs, readable from the Leaflet callbacks without making
  // them a dependency of the mount effect (which must run exactly once — a
  // re-created map loses pan/zoom and refetches every tile).
  const drawRef = useRef({ points, activeMetric, flyToOnClick, format, onSelect });
  drawRef.current = { points, activeMetric, flyToOnClick, format, onSelect };

  /** (Re)draw the circle markers for the current points + metric. */
  const drawMarkers = useCallback(() => {
    const L = leafletRef.current;
    const layer = markersRef.current;
    const map = mapRef.current;
    if (L === null || layer === null || map === null) return;
    const { points: current, activeMetric: active, flyToOnClick: fly, format: fmt, onSelect: select } = drawRef.current;

    layer.clearLayers();
    if (active === undefined) return;
    const plottable = plottablePoints(current);
    const max = maxMetric(plottable, active);

    for (const point of plottable) {
      const value = metricValue(point, active);
      const marker = L.circleMarker([point.lat as number, point.lng as number], {
        radius: bubbleRadius(value, max),
        // Token-driven, not raw hex: the SVG marker inherits `--accent` through
        // the CSS custom property, so it re-tints with the theme/accent axes
        // exactly like every other surface (02 §7).
        color: 'var(--accent)',
        fillColor: 'var(--accent)',
        fillOpacity: 0.35,
        weight: 1.5,
      });
      marker.bindTooltip(`${point.name}: ${fmt(value)}`, { direction: 'top' });
      marker.on('click', () => {
        if (fly) map.flyTo([point.lat as number, point.lng as number], Math.max(map.getZoom(), 5));
        select?.(point);
      });
      marker.addTo(layer);
    }
  }, []);

  // Build the map once the canvas exists. `hasPoints` is in the deps because the
  // empty branch below returns an `EmptyState` INSTEAD of the container div, so
  // on a first render with no points `containerRef.current` is null and this
  // bails; without the dep it would never re-run when the data arrived, and the
  // widget would sit at `idle` — a silent blank box, not even the `unavailable`
  // notice — beside a populated ranked list.
  const hasPoints = points.length > 0;
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (container === null || typeof window === 'undefined') return undefined;

    let unsubscribe: (() => void) | undefined;

    void (async () => {
      let L: LeafletModule;
      try {
        // THE Leaflet boundary — see the file header. Nothing else in this
        // package may name 'leaflet'.
        L = await import('leaflet');
        // Leaflet's stylesheet positions the tile panes; without it the map is a
        // pile of stacked images. Separately guarded: a bundler/test runner that
        // stubs CSS must not take the map down with it.
        try {
          await import('leaflet/dist/leaflet.css');
        } catch {
          /* CSS stubbed (vitest) or inlined by the host — the map still works. */
        }
      } catch {
        if (!cancelled) setMapStatus('unavailable');
        return;
      }
      if (cancelled) return;

      try {
        const map = L.map(container, {
          center: [center[0], center[1]],
          zoom,
          // The widget lives in a scrolling dashboard grid: grabbing the page
          // scroll to zoom a map the user only scrolled PAST is hostile, so
          // zoom is on the +/- control and ⌘/ctrl+wheel, not the raw wheel.
          scrollWheelZoom: false,
          attributionControl: true,
        });
        const tiles = L.tileLayer(CARTO_TILES[currentTheme()], { attribution: CARTO_ATTRIBUTION, maxZoom: 18 });
        tiles.addTo(map);
        const markers = L.layerGroup().addTo(map);

        leafletRef.current = L;
        mapRef.current = map;
        tilesRef.current = tiles;
        markersRef.current = markers;

        // The annex's "theme-following Carto light/dark tiles". `subscribeTheme`
        // fires AFTER ThemeProvider stamps <html> (so `currentTheme()` above and
        // this agree), and its own docblock names this exact case ("for Leaflet
        // tile swaps"). It hands over the whole resolved axis set; only the
        // light/dark mode changes the basemap.
        unsubscribe = subscribeTheme((resolved) => {
          tilesRef.current?.setUrl(CARTO_TILES[resolved.theme === 'dark' ? 'dark' : 'light']);
        });

        setMapStatus('ready');
        drawMarkers();
      } catch {
        if (!cancelled) setMapStatus('unavailable');
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      try {
        mapRef.current?.remove();
      } catch {
        /* Already torn down. */
      }
      mapRef.current = null;
      markersRef.current = null;
      tilesRef.current = null;
      leafletRef.current = null;
    };
    // MOUNT-ONLY EXCEPT FOR `hasPoints`, ON PURPOSE. `center`/`zoom` are the
    // INITIAL view (annex config `initialZoom/center`): re-running this on a
    // config change would tear the map down and rebuild it, yanking the view out
    // from under a user who has panned and refetching every tile. Live inputs
    // reach Leaflet through `drawRef` + the redraw effect below instead, which
    // is why they are deliberately absent here. `hasPoints` is the one exception
    // — it gates whether the container is in the tree at all (see above), and it
    // flips at most once from false, so it can never re-create a live map.
  }, [hasPoints]);

  // Redraw when the data or the active metric changes (annex: "metric tabs" —
  // switching re-sizes every bubble). No-ops until the map is ready.
  useEffect(() => {
    if (mapStatus === 'ready') drawMarkers();
  }, [points, activeMetric, mapStatus, drawMarkers]);

  if (points.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.geo.mapBubble.emptyTitle', 'No locations')}
        body={emptyBody ?? t('ui:widgets.geo.mapBubble.emptyBody', 'Rows with latitude and longitude values appear here as map markers.')}
      />
    );
  }

  const ranked =
    topN > 0 && activeMetric !== undefined
      ? [...points]
          .map((point) => ({ point, value: metricValue(point, activeMetric) }))
          .sort((a, b) => b.value - a.value || a.point.name.localeCompare(b.point.name, locale))
          .slice(0, topN)
      : [];

  return (
    <div
      data-widget="map-bubble"
      data-testid={testId}
      data-map-status={mapStatus}
      className="flex h-full flex-col gap-3 px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      {keys.length > 1 && (
        <SegmentedControl
          data-part="metric-tabs"
          aria-label={regionsLabel ?? t('ui:widgets.geo.mapBubble.metricLabel', 'Metric')}
          options={keys.map((key) => ({ value: key, label: metricLabels?.[key] ?? key }))}
          value={activeMetric}
          onValueChange={setMetric}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-wrap items-stretch gap-3">
        {/* THE LTR ISLAND (04 §7.4). Geography never mirrors — a flipped world
            map is a wrong map, not a localized one. */}
        <div dir="ltr" className="relative min-h-[12rem] min-w-[16rem] flex-[2] overflow-hidden rounded-lg border border-border">
          <div ref={containerRef} data-part="map-canvas" className="size-full" />
          {mapStatus === 'unavailable' && (
            <p
              data-part="map-unavailable"
              className="absolute inset-0 flex items-center justify-center bg-surface-2 p-4 text-center text-caption text-fg-muted"
            >
              {mapUnavailableLabel ??
                t('ui:widgets.geo.mapBubble.mapUnavailableLabel', 'The map could not be loaded. The ranked list below shows the same data.')}
            </p>
          )}
        </div>

        {/* The annex's ranked companion ("pairs with ranked-entity-list"), and
            the map's accessible equivalent: an SVG of circles is unreadable to a
            screen reader, so the same ranking is real, focusable text. */}
        {ranked.length > 0 && (
          <ol
            data-part="geo-ranking"
            aria-label={regionsLabel ?? t('ui:widgets.geo.mapBubble.regionsLabel', 'Top regions')}
            className="min-w-40 flex-1 space-y-1.5"
          >
            {ranked.map(({ point, value }, index) => (
              <li key={point.name}>
                <button
                  type="button"
                  data-part="geo-ranking-row"
                  onClick={() => onSelect?.(point)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-start text-body-sm hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPin aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
                    <span className="text-fg-subtle tabular-nums">{index + 1}.</span>
                    <span className="truncate text-fg-muted">{point.name}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-fg">{format(value)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function MapBubbleWidget({ config, data, onEvent }: WidgetProps<MapBubbleConfig>) {
  const points = geoPointsOf(data, {
    nameField: config.nameField,
    codeField: config.codeField,
    latField: config.latColumn,
    lngField: config.lngColumn,
    metricFields: config.metrics,
  });
  const opts = formatOptionsOf(config);
  const source = sourceOf(config.binding);

  return (
    <MapBubble
      points={points}
      metrics={config.metrics}
      metricLabels={config.metricLabels}
      flyToOnClick={config.flyToOnClick}
      topN={config.topN}
      zoom={config.initialZoom}
      format={(value) => formatMetricValue(value, config.valueFormat, opts)}
      {...(config.initialCenter === undefined ? {} : { center: config.initialCenter })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.mapUnavailableLabel === undefined ? {} : { mapUnavailableLabel: config.mapUnavailableLabel })}
      {...(config.regionsLabel === undefined ? {} : { regionsLabel: config.regionsLabel })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      onSelect={(point) => {
        // Selecting a place is a drill-through when config names a route, else a
        // record-open the page host routes (annex §7 `linkedList`: the host
        // focuses the paired ranked-entity-list — widgets never talk to each
        // other directly).
        if (config.href !== undefined) {
          onEvent({ type: 'drill-through', href: config.href });
          return;
        }
        onEvent({
          type: 'record-open',
          ...(source.connectionId === undefined ? {} : { connectionId: source.connectionId }),
          table: source.table,
          recordId: point.code ?? point.name,
          // annex §7 `linkedList` — carried on the event so the host can focus
          // the paired list. Omitted when unset, so the event stays exactly what
          // it was for an unpaired map.
          ...(config.linkedList === undefined ? {} : { linkedInstanceId: config.linkedList }),
        });
      }}
    />
  );
}
