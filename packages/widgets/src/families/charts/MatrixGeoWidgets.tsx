/**
 * `charts` family — matrix, calendar & geo-grid widgets (annex §2, 04-T09):
 * registry wrappers that map stored instance config + §3 envelopes onto the
 * @adminium/charts matrix/heat/geo/sankey primitives. Accessible names come
 * from `config.title` (the primitives render them as the SVG aria-label).
 * Components render only the loaded state; a malformed payload falls back to a
 * local-safe notice rather than throwing into the WidgetFrame error boundary.
 *
 * Numbers/dates route through the @adminium/i18n Intl layer (getFormatters);
 * chart micro-labels (weekday/month/legend) use English defaults consistent
 * with the shipped @adminium/charts primitives (locale wiring lands with the
 * i18n extraction pass, 04-T17 / 10-T06).
 */

import {
  ChoroplethGridChart,
  CohortMatrixChart,
  HeatCalendarChart,
  HeatMonthChart,
  SankeyChart,
} from '@adminium/charts';
import { getFormatters, weekInfo } from '@adminium/i18n';
import { z } from 'zod';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asTimeseries } from '../../lib/shapes.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';
import type { WidgetProps } from '../../registry/types.js';

function BadShape() {
  return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
}

type Rec = Record<string, unknown>;
function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}
function finiteNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** ISO weekday (1=Mon..7=Sun) → JS weekday (0=Sun..6=Sat). */
function isoToJsWeekday(isoDay: number): number {
  return isoDay % 7;
}

// --- §3 envelope narrowers ---------------------------------------------------

export interface MatrixData {
  rowKeys: string[];
  colKeys: string[];
  cells: (number | null)[][];
}
export function asMatrix(data: unknown): MatrixData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.rowKeys) || !Array.isArray(r.colKeys) || !Array.isArray(r.cells)) {
    return null;
  }
  const rowKeys = r.rowKeys.map(String);
  const colKeys = r.colKeys.map(String);
  const cells = r.cells.map((row) =>
    Array.isArray(row) ? row.map((v) => finiteNum(v) ?? null) : [],
  );
  return { rowKeys, colKeys, cells };
}

export interface GeoPointData {
  code?: string | undefined;
  name?: string | undefined;
  values: Record<string, number>;
}
export function asGeoPoints(data: unknown): { points: GeoPointData[] } | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.points)) return null;
  const points: GeoPointData[] = [];
  for (const entry of r.points) {
    const p = rec(entry);
    if (p === null) continue;
    const values: Record<string, number> = {};
    const vr = rec(p.values);
    if (vr !== null) {
      for (const [key, val] of Object.entries(vr)) {
        const n = finiteNum(val);
        if (n !== undefined) values[key] = n;
      }
    }
    points.push({
      code: typeof p.code === 'string' ? p.code : undefined,
      name: typeof p.name === 'string' ? p.name : undefined,
      values,
    });
  }
  return { points };
}

export interface FlowsData {
  nodes: { id: string; label: string; layer?: number }[];
  links: { from: string; to: string; weight: number }[];
}
export function asFlows(data: unknown): FlowsData | null {
  const r = rec(data);
  if (r === null || !Array.isArray(r.nodes) || !Array.isArray(r.links)) return null;
  const nodes: FlowsData['nodes'] = [];
  for (const entry of r.nodes) {
    const n = rec(entry);
    if (n === null || typeof n.id !== 'string') continue;
    const layer = finiteNum(n.layer);
    nodes.push({
      id: n.id,
      label: typeof n.label === 'string' ? n.label : n.id,
      ...(layer !== undefined ? { layer } : {}),
    });
  }
  const links: FlowsData['links'] = [];
  for (const entry of r.links) {
    const l = rec(entry);
    const weight = finiteNum(l?.weight);
    if (l === null || typeof l.from !== 'string' || typeof l.to !== 'string' || weight === undefined) continue;
    links.push({ from: l.from, to: l.to, weight });
  }
  return { nodes, links };
}

// --- chart-cohort-matrix -----------------------------------------------------

export const chartCohortMatrixConfigSchema = widgetSharedConfigSchema.extend({
  metric: z.enum(['retention', 'revenue']).default('retention'),
  /** Period label style (M0.. vs Wk0..); labels themselves come from the payload. */
  periodStyle: z.enum(['month', 'week']).default('month'),
  /** Value at/above which the cell label flips to the on-accent color. */
  flipThreshold: z.number().min(0).max(100).default(55),
  valueFormat: z.enum(['percent', 'compact', 'plain', 'currency']).default('percent'),
  cellSize: z.number().int().min(24).max(64).default(40),
});
export type ChartCohortMatrixConfig = z.infer<typeof chartCohortMatrixConfigSchema>;

export function ChartCohortMatrixWidget({ config, data }: WidgetProps<ChartCohortMatrixConfig>) {
  const matrix = asMatrix(data);
  if (matrix === null || matrix.rowKeys.length === 0 || matrix.colKeys.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  const values = matrix.cells.flat().filter((v): v is number => v !== null);
  const maxValue = config.metric === 'revenue' ? Math.max(1, ...values) : 100;
  const format = (value: number): string =>
    config.valueFormat === 'percent'
      ? `${Math.round(value)}%`
      : formatMetricValue(value, config.valueFormat, opts);
  return (
    <div className="overflow-x-auto px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-cohort-matrix">
      <CohortMatrixChart
        rowKeys={matrix.rowKeys}
        colKeys={matrix.colKeys}
        cells={matrix.cells}
        labels={{ label: config.title ?? 'Cohort retention' }}
        cellSize={config.cellSize}
        flipThreshold={config.flipThreshold}
        maxValue={maxValue}
        format={format}
      />
    </div>
  );
}

// --- chart-heatmap-calendar --------------------------------------------------

export const chartHeatmapCalendarConfigSchema = widgetSharedConfigSchema.extend({
  weeks: z.number().int().min(4).max(53).default(53),
  levels: z.number().int().min(4).max(5).default(5),
  /** Override the locale's first weekday (0=Sun..6=Sat). */
  firstDayOfWeek: z.number().int().min(0).max(6).optional(),
  cellSize: z.number().int().min(8).max(20).default(12),
  valueFormat: z.enum(['plain', 'compact']).default('plain'),
});
export type ChartHeatmapCalendarConfig = z.infer<typeof chartHeatmapCalendarConfigSchema>;

function startWeekdayOf(config: { firstDayOfWeek?: number | undefined; format?: { locale?: string | undefined } | undefined }): number {
  if (config.firstDayOfWeek !== undefined) return config.firstDayOfWeek;
  return isoToJsWeekday(weekInfo(config.format?.locale ?? 'en-US').firstDay);
}

export function ChartHeatmapCalendarWidget({ config, data }: WidgetProps<ChartHeatmapCalendarConfig>) {
  const series = asTimeseries(data);
  if (series === null || series.points.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  const fmt = getFormatters(opts.locale ?? 'en-US');
  return (
    <div className="overflow-x-auto px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-heatmap-calendar">
      <HeatCalendarChart
        points={series.points}
        labels={{ label: config.title ?? 'Activity calendar' }}
        weeks={config.weeks}
        levels={config.levels}
        startWeekday={startWeekdayOf(config)}
        cellSize={config.cellSize}
        format={(value) => formatMetricValue(value, config.valueFormat, opts)}
        formatDate={(date) => fmt.date(date, 'medium')}
      />
    </div>
  );
}

// --- chart-heat-month --------------------------------------------------------

export const chartHeatMonthConfigSchema = widgetSharedConfigSchema.extend({
  /** ISO month 'YYYY-MM'; defaults to the latest point's month. */
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  levels: z.number().int().min(4).max(5).default(5),
  firstDayOfWeek: z.number().int().min(0).max(6).optional(),
  cellSize: z.number().int().min(28).max(56).default(40),
  valueFormat: z.enum(['plain', 'compact']).default('plain'),
});
export type ChartHeatMonthConfig = z.infer<typeof chartHeatMonthConfigSchema>;

export function ChartHeatMonthWidget({ config, data }: WidgetProps<ChartHeatMonthConfig>) {
  const series = asTimeseries(data);
  if (series === null || series.points.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);

  let year: number;
  let month: number; // 0-based
  if (config.month !== undefined) {
    const [y, m] = config.month.split('-');
    year = Number(y);
    month = Number(m) - 1;
  } else {
    const last = new Date(series.points[series.points.length - 1]?.t ?? 0);
    year = last.getUTCFullYear();
    month = last.getUTCMonth();
  }

  return (
    <div className="overflow-x-auto px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-heat-month">
      <HeatMonthChart
        year={year}
        month={month}
        points={series.points}
        labels={{ label: config.title ?? 'Monthly activity' }}
        levels={config.levels}
        startWeekday={startWeekdayOf(config)}
        cellSize={config.cellSize}
        format={(value) => formatMetricValue(value, config.valueFormat, opts)}
      />
    </div>
  );
}

// --- chart-choropleth-grid ---------------------------------------------------

export const chartChoroplethGridConfigSchema = widgetSharedConfigSchema.extend({
  layout: z.enum(['us-tilegram', 'grid']).default('us-tilegram'),
  /** Metric key read from each region's `values` map; defaults to the first key. */
  metric: z.string().optional(),
  columns: z.number().int().min(2).max(12).default(6),
  levels: z.number().int().min(4).max(6).default(5),
  /** Top-N ranked companion list (0 = off). */
  topN: z.number().int().min(0).max(10).default(5),
  valueFormat: z.enum(['plain', 'compact', 'currency', 'percent']).default('compact'),
});
export type ChartChoroplethGridConfig = z.infer<typeof chartChoroplethGridConfigSchema>;

export function ChartChoroplethGridWidget({ config, data }: WidgetProps<ChartChoroplethGridConfig>) {
  const geo = asGeoPoints(data);
  if (geo === null || geo.points.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  const metric = config.metric ?? Object.keys(geo.points[0]?.values ?? {})[0] ?? 'value';
  const format = (value: number): string => formatMetricValue(value, config.valueFormat, opts);

  const ranked =
    config.topN > 0
      ? [...geo.points]
          .map((p) => ({ name: p.name ?? p.code ?? '', value: p.values[metric] ?? 0 }))
          .sort((a, b) => b.value - a.value)
          .slice(0, config.topN)
      : [];

  return (
    <div className="flex flex-wrap items-start gap-4 px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-choropleth-grid">
      <div className="overflow-x-auto">
        <ChoroplethGridChart
          points={geo.points}
          metric={metric}
          labels={{ label: config.title ?? 'Regional breakdown' }}
          layout={config.layout}
          columns={config.columns}
          levels={config.levels}
          format={format}
        />
      </div>
      {ranked.length > 0 && (
        <ol className="min-w-40 flex-1 space-y-1.5" data-region-ranking>
          {ranked.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex items-center justify-between gap-3 text-body-sm">
              <span className="truncate text-fg-muted">
                <span className="text-fg-subtle tabular-nums">{i + 1}.</span> {row.name}
              </span>
              <span className="tabular-nums font-medium text-fg">{format(row.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// --- chart-sankey ------------------------------------------------------------

export const chartSankeyConfigSchema = widgetSharedConfigSchema.extend({
  height: z.number().int().min(160).max(600).default(300),
  nodeWidth: z.number().int().min(8).max(28).default(14),
  showLabels: z.boolean().default(true),
  /** Optional summary pill caption (annex §2 `summaryPill`). */
  summaryLabel: z.string().optional(),
  valueFormat: z.enum(['plain', 'compact', 'currency', 'percent']).default('compact'),
});
export type ChartSankeyConfig = z.infer<typeof chartSankeyConfigSchema>;

export function ChartSankeyWidget({ config, data }: WidgetProps<ChartSankeyConfig>) {
  const flows = asFlows(data);
  if (flows === null || flows.nodes.length === 0 || flows.links.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-sankey">
      {config.summaryLabel !== undefined && (
        <div className="mb-2 flex justify-end">
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-caption font-medium text-fg-muted">
            {config.summaryLabel}
          </span>
        </div>
      )}
      <SankeyChart
        nodes={flows.nodes}
        links={flows.links}
        labels={{ label: config.title ?? 'Flow' }}
        height={config.height}
        nodeWidth={config.nodeWidth}
        showLabels={config.showLabels}
        format={(weight) => formatMetricValue(weight, config.valueFormat, opts)}
      />
    </div>
  );
}
