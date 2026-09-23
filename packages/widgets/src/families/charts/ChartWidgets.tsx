// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` family M4 widgets (annex): registry wrappers that map stored
 * instance config + envelopes onto the @adminium/charts primitives.
 * Accessible names come from `config.title` (ChartSurface renders them as
 * the SVG aria-label). Components render only the loaded state.
 */

import { BarChart, DonutChart, LineAreaChart, Sparkline, formatShortDate } from '@adminium/charts';
import type { BarSeries, LineAreaPoint, SparklineTone } from '@adminium/charts';
import { useMaybeT } from '@adminium/i18n/react';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asCategorical, asTimeseries, timeseriesValues } from '../../lib/shapes.js';
import type {
  ChartBarConfig,
  ChartDonutConfig,
  ChartLineAreaConfig,
  ChartSparklineConfig,
} from './charts-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schemas live in the pure `charts-config` module so the registry
// metadata graph never reaches this component file. Re-exported here
// to keep existing import points stable.
export {
  chartBarConfigSchema,
  chartDonutConfigSchema,
  chartLineAreaConfigSchema,
  chartSparklineConfigSchema,
} from './charts-config.js';
export type {
  ChartBarConfig,
  ChartDonutConfig,
  ChartLineAreaConfig,
  ChartSparklineConfig,
} from './charts-config.js';

function BadShape() {
  const t = useMaybeT();
  return <p className="px-[var(--widget-pad)] pb-[var(--widget-pad)] text-body-sm text-fg-muted">{t('ui:widgets.charts.unexpectedShape', 'Unexpected data shape.')}</p>;
}

function toXY(points: { t: string; v: number }[]): LineAreaPoint[] {
  return points.map((point) => ({ x: new Date(point.t), y: point.v }));
}

// --- chart-line-area ---------------------------------------------------------

export function ChartLineAreaWidget({ config, data }: WidgetProps<ChartLineAreaConfig>) {
  const t = useMaybeT();
  const series = asTimeseries(data);
  if (series === null || series.points.length === 0) return <BadShape />;
  const comparison =
    config.compareToPrior && series.compare !== undefined ? toXY(series.compare) : undefined;
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-line-area">
      <LineAreaChart
        data={toXY(series.points)}
        {...(comparison !== undefined ? { comparison } : {})}
        labels={{ label: config.title ?? t('ui:widgets.charts.lineArea.chartLabel', 'Line chart') }}
        smooth={config.smooth}
        showAxis={config.axis}
        height={config.height}
      />
    </div>
  );
}

// --- chart-bar ---------------------------------------------------------------

/** `timeseries` or `categorical` → BarChart categories + one series. */
/**
 * Hour buckets are labelled by their hour ("10 AM"), with the day when they
 * span more than one; everything else by its day. Labelled by day, a day's
 * hourly bars all read "Sep 22" and the chart drew them as ONE bar.
 *
 * On this device's clock: a widget is given no zone. The server cuts the
 * buckets on the venue's clock (widget-data), so at the venue the two agree.
 */
function bucketLabels(points: readonly { t: string }[], unit: string | undefined, locale: string | undefined): string[] {
  const at = points.map((point) => Date.parse(point.t));
  const hourly = unit === 'hour' && at.every((t, i) => i === 0 || t - at[i - 1]! < 86_400_000);
  if (!hourly) return points.map((point) => formatShortDate(new Date(point.t)));
  const spansDays = at.length > 1 && at[at.length - 1]! - at[0]! >= 86_400_000;
  const format = new Intl.DateTimeFormat(locale, spansDays ? { month: 'short', day: 'numeric', hour: 'numeric' } : { hour: 'numeric' });
  return at.map((t) => format.format(new Date(t)));
}

export function barInputsOf(
  data: unknown,
  seriesName: string,
  /** The binding's bucket unit and the page's locale, when the card has them. */
  opts: { unit?: string | undefined; locale?: string | undefined } = {},
): { categories: string[]; series: BarSeries[] } | null {
  const ts = asTimeseries(data);
  if (ts !== null && ts.points.length > 0) {
    return {
      categories: bucketLabels(ts.points, opts.unit, opts.locale),
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
  const t = useMaybeT();
  const inputs = barInputsOf(data, config.title ?? 'Value', {
    unit: (config as { binding?: { bucket?: { unit?: string } } }).binding?.bucket?.unit,
    locale: config.format?.locale,
  });
  if (inputs === null) return <BadShape />;
  return (
    <div className="px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-bar">
      <BarChart
        categories={inputs.categories}
        series={inputs.series}
        labels={{ label: config.title ?? t('ui:widgets.charts.bar.chartLabel', 'Bar chart') }}
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

export function ChartDonutWidget({ config, data }: WidgetProps<ChartDonutConfig>) {
  const t = useMaybeT();
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className="flex justify-center px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="chart-donut">
      <DonutChart
        data={categorical.items.map((item) => ({ label: item.label, value: item.value }))}
        labels={{ label: config.title ?? t('ui:widgets.charts.donut.chartLabel', 'Donut chart') }}
        otherLabel={t('ui:widgets.charts.donut.otherLabel', 'Other')}
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
