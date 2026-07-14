/**
 * `charts` family M4 widgets (annex §2): registry wrappers that map stored
 * instance config + §3 envelopes onto the @adminium/charts primitives.
 * Accessible names come from `config.title` (ChartSurface renders them as
 * the SVG aria-label). Components render only the loaded state.
 */

import { BarChart, DonutChart, LineAreaChart, Sparkline, formatShortDate } from '@adminium/charts';
import type { BarSeries, LineAreaPoint, SparklineTone } from '@adminium/charts';
import { z } from 'zod';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asCategorical, asTimeseries, timeseriesValues } from '../../lib/shapes.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';
import type { WidgetProps } from '../../registry/types.js';

function BadShape() {
  return <p className="px-4 pb-4 text-body-sm text-fg-muted">Unexpected data shape.</p>;
}

function toXY(points: { t: string; v: number }[]): LineAreaPoint[] {
  return points.map((point) => ({ x: new Date(point.t), y: point.v }));
}

// --- chart-line-area ---------------------------------------------------------

export const chartLineAreaConfigSchema = widgetSharedConfigSchema.extend({
  smooth: z.boolean().default(true),
  /** Axis labels on/off (annex §2 `axis`). */
  axis: z.boolean().default(true),
  /** Dashed prior-period comparison line when the payload carries `compare`. */
  compareToPrior: z.boolean().default(true),
  height: z.number().int().min(80).max(600).default(240),
});

export type ChartLineAreaConfig = z.infer<typeof chartLineAreaConfigSchema>;

export function ChartLineAreaWidget({ config, data }: WidgetProps<ChartLineAreaConfig>) {
  const series = asTimeseries(data);
  if (series === null || series.points.length === 0) return <BadShape />;
  const comparison =
    config.compareToPrior && series.compare !== undefined ? toXY(series.compare) : undefined;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-line-area">
      <LineAreaChart
        data={toXY(series.points)}
        {...(comparison !== undefined ? { comparison } : {})}
        labels={{ label: config.title ?? 'Line chart' }}
        smooth={config.smooth}
        showAxis={config.axis}
        height={config.height}
      />
    </div>
  );
}

// --- chart-bar ---------------------------------------------------------------

export const chartBarConfigSchema = widgetSharedConfigSchema.extend({
  highlight: z.enum(['max', 'current', 'none']).default('max'),
  /** Category labels under the columns (annex §2 `labels`). */
  labels: z.boolean().default(true),
  axis: z.boolean().default(true),
  barRadius: z.number().int().min(0).max(12).default(3),
  height: z.number().int().min(80).max(600).default(220),
});

export type ChartBarConfig = z.infer<typeof chartBarConfigSchema>;

/** `timeseries` or `categorical` → BarChart categories + one series. */
export function barInputsOf(
  data: unknown,
  seriesName: string,
): { categories: string[]; series: BarSeries[] } | null {
  const ts = asTimeseries(data);
  if (ts !== null && ts.points.length > 0) {
    return {
      categories: ts.points.map((point) => formatShortDate(new Date(point.t))),
      series: [{ name: seriesName, values: timeseriesValues(ts) }],
    };
  }
  const cat = asCategorical(data);
  if (cat !== null && cat.items.length > 0) {
    return {
      categories: cat.items.map((item) => item.label),
      series: [{ name: seriesName, values: cat.items.map((item) => item.value) }],
    };
  }
  return null;
}

export function ChartBarWidget({ config, data }: WidgetProps<ChartBarConfig>) {
  const inputs = barInputsOf(data, config.title ?? 'Value');
  if (inputs === null) return <BadShape />;
  return (
    <div className="px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-bar">
      <BarChart
        categories={inputs.categories}
        series={inputs.series}
        labels={{ label: config.title ?? 'Bar chart' }}
        highlight={config.highlight}
        showAxis={config.axis}
        showCategoryLabels={config.labels}
        barRadius={config.barRadius}
        height={config.height}
      />
    </div>
  );
}

// --- chart-donut ---------------------------------------------------------------

export const chartDonutConfigSchema = widgetSharedConfigSchema.extend({
  centerMetric: z.enum(['total', 'none']).default('total'),
  centerLabel: z.string().optional(),
  showLegend: z.boolean().default(true),
  /** Slices beyond this fold into a trailing "Other" bucket. */
  maxSlices: z.number().int().min(2).max(8).default(5),
  metricFormat: z.enum(['plain', 'compact', 'currency', 'percent', 'duration']).default('compact'),
  size: z.number().int().min(96).max(320).default(160),
});

export type ChartDonutConfig = z.infer<typeof chartDonutConfigSchema>;

export function ChartDonutWidget({ config, data }: WidgetProps<ChartDonutConfig>) {
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className="flex justify-center px-4 pb-4 compact:px-3 compact:pb-3" data-widget="chart-donut">
      <DonutChart
        data={categorical.items.map((item) => ({ label: item.label, value: item.value }))}
        labels={{ label: config.title ?? 'Donut chart' }}
        maxSlices={config.maxSlices}
        showLegend={config.showLegend}
        size={config.size}
        format={(value) => formatMetricValue(value, config.metricFormat, opts)}
        {...(config.centerLabel !== undefined ? { centerLabel: config.centerLabel } : {})}
        {...(config.centerMetric === 'none' ? { centerValue: '' } : {})}
      />
    </div>
  );
}

// --- chart-sparkline ------------------------------------------------------------

export const chartSparklineConfigSchema = widgetSharedConfigSchema.extend({
  variant: z.enum(['bar', 'line']).default('bar'),
  emphasisLast: z.boolean().default(true),
  width: z.number().int().min(24).max(320).default(96),
  height: z.number().int().min(12).max(80).default(28),
});

export type ChartSparklineConfig = z.infer<typeof chartSparklineConfigSchema>;

/** Shared `tone` → sparkline stroke tone. */
export function sparklineToneOf(tone: string | undefined): SparklineTone {
  switch (tone) {
    case 'pos':
      return 'positive';
    case 'danger':
      return 'danger';
    case 'muted':
      return 'muted';
    default:
      return 'accent';
  }
}

export function ChartSparklineWidget({ config, data }: WidgetProps<ChartSparklineConfig>) {
  const series = asTimeseries(data);
  if (series === null || series.points.length === 0) return <BadShape />;
  return (
    <Sparkline
      data={timeseriesValues(series)}
      variant={config.variant}
      emphasisLast={config.emphasisLast}
      tone={sparklineToneOf(config.tone)}
      width={config.width}
      height={config.height}
      {...(config.title !== undefined ? { label: config.title } : {})}
    />
  );
}
