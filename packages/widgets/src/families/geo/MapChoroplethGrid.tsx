import { ChoroplethGridChart, hasUsTilegramTiles } from '@adminium/charts';
import { EmptyState } from '@adminium/ui';

import { geoPointsOf, localeOf, metricKeysOf } from './geo-lib.js';
import type { MapChoroplethGridConfig } from './geo-config.js';
import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `geo-config`
// module so the registry metadata graph never eagerly pulls this component's
// @adminium/ui + @adminium/charts deps (acceptance #3); re-exported here so the
// family barrel, stories, and tests keep one import point per widget.
export { mapChoroplethGridConfigSchema, mapChoroplethGridDemoData } from './geo-config.js';
export type { MapChoroplethGridConfig };

/**
 * `map-choropleth-grid` (annex §7) — "See `chart-choropleth-grid` (registered in
 * Charts; cross-listed here). Region-coded tiles when only region codes exist,
 * no coordinates."
 *
 * SHARES THE GEOMETRY, DOES NOT REDRAW IT: this renders @adminium/charts'
 * `ChoroplethGridChart` — the very primitive `chart-choropleth-grid` renders,
 * over the same `choroplethLayout` US tilegram, the same heat ramp, the same
 * legend and the same "geographic tilegram never mirrors, the compact grid does"
 * RTL policy. The annex cross-lists one visual under two ids on purpose, so a
 * second implementation would be a bug waiting to diverge.
 *
 * WHY A SECOND REGISTRY ID AT ALL: the two are reached by different
 * auto-instantiation rules. The charts id is the analytics-dashboard tile; this
 * one is what the annex §7 rule emits ("country/state/region code column +
 * numeric → `map-choropleth-grid`") when a table has region codes but NO
 * coordinates — i.e. precisely when `map-bubble` cannot be built. Families are
 * how the builder palette and the chunk split are organised (04 §2.4), so the
 * geo entry point has to live in the geo family. Notably, this id costs the page
 * no Leaflet: it never touches `MapBubble.tsx`, the only module that imports it.
 *
 * `points` here is the region-coded `geo-points` variant ({code, name, values}) —
 * no lat/lng, by the annex's definition of when this widget is chosen.
 */

export interface MapChoroplethGridProps {
  points: readonly { code?: string | undefined; name?: string | undefined; values: Record<string, number> }[];
  metric: string;
  layout?: 'us-tilegram' | 'grid';
  columns?: number | undefined;
  levels?: number | undefined;
  topN?: number | undefined;
  label?: string | undefined;
  legendLabels?: { low: string; high: string } | undefined;
  format?: ((value: number) => string) | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

export function MapChoroplethGrid({
  points,
  metric,
  layout = 'us-tilegram',
  columns = 6,
  levels = 5,
  topN = 5,
  label,
  legendLabels,
  format = String,
  emptyTitle,
  emptyBody,
  locale: localeProp,
  testId,
}: MapChoroplethGridProps) {
  const locale = localeOf(localeProp);

  if (points.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? 'No regions'}
        body={emptyBody ?? 'Rows with a region code and a numeric value appear here as tinted tiles.'}
      />
    );
  }

  // `us-tilegram` plots only the USPS tiles it knows (a geographic island), so a
  // payload of non-US region codes — or of coordinate-only points with no `code`
  // at all, which is the DEFAULT desktop case now that 11-electron.md §7 resolves
  // every `map-*` id to this widget — would place ZERO tiles and render only the
  // low→high legend: a legend for a map that isn't there. Degrade to the
  // code-agnostic `grid` layout (same component, laid out in reading order) so the
  // data stays a map. Only when the tilegram would be EMPTY: a real or mixed US
  // payload keeps the island and plots the states it recognises.
  const effectiveLayout = layout === 'us-tilegram' && !hasUsTilegramTiles(points) ? 'grid' : layout;

  const ranked =
    topN > 0
      ? [...points]
          .map((point) => ({ name: point.name ?? point.code ?? '', value: point.values[metric] ?? 0 }))
          .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, locale))
          .slice(0, topN)
      : [];

  return (
    <div
      data-widget="map-choropleth-grid"
      data-testid={testId}
      className="flex flex-wrap items-start gap-4 px-4 pb-4 compact:px-3 compact:pb-3"
    >
      <div className="overflow-x-auto">
        <ChoroplethGridChart
          points={points}
          metric={metric}
          labels={{ label: label ?? 'Regional breakdown' }}
          layout={effectiveLayout}
          columns={columns}
          levels={levels}
          format={format}
          {...(legendLabels === undefined ? {} : { legendLabels })}
        />
      </div>
      {/* The annex's "optional Top-5 ranked bars companion", and the tilegram's
          accessible equivalent — tinted <rect>s carry no value to a reader. */}
      {ranked.length > 0 && (
        <ol data-part="region-ranking" className="min-w-40 flex-1 space-y-1.5">
          {ranked.map((row, index) => (
            <li key={`${row.name}-${index}`} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="truncate text-fg-muted">
                <span className="text-fg-subtle tabular-nums">{index + 1}.</span> {row.name}
              </span>
              <span className="font-medium tabular-nums text-fg">{format(row.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function MapChoroplethGridWidget({ config, data }: WidgetProps<MapChoroplethGridConfig>) {
  const points = geoPointsOf(data, {
    nameField: config.nameField,
    codeField: config.codeField,
    // A region-coded payload has no coordinates by definition (annex §7), but
    // naming the canonical columns keeps a lat/lng-carrying table from having
    // them silently inferred as metrics and tinting tiles by latitude.
    latField: 'lat',
    lngField: 'lng',
    metricFields: config.metric === undefined ? [] : [config.metric],
  });
  const opts = formatOptionsOf(config);
  const metric = config.metric ?? metricKeysOf(points)[0] ?? 'value';
  const format = (value: number): string => formatMetricValue(value, config.valueFormat, opts);

  return (
    <MapChoroplethGrid
      points={points}
      metric={metric}
      layout={config.layout}
      columns={config.columns}
      levels={config.levels}
      topN={config.topN}
      format={format}
      {...(config.title === undefined ? {} : { label: config.title })}
      {...(config.legendLowLabel === undefined && config.legendHighLabel === undefined
        ? {}
        : { legendLabels: { low: config.legendLowLabel ?? 'Low', high: config.legendHighLabel ?? 'High' } })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
    />
  );
}
