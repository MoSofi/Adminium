/**
 * `charts` family "bars & ranking" widgets (04-T09; annex §2): registry
 * wrappers mapping stored instance config + §3 envelopes onto the
 * @adminium/charts primitives. Accessible names come from `config.title`
 * (ChartSurface renders them as the SVG aria-label). Components render only the
 * loaded state — WidgetFrame owns skeleton/empty/error (04 §4).
 */
import { useMaybeT } from '@adminium/i18n/react';
import {
  BulletChart,
  MarimekkoChart,
  ParetoChart,
  RankingBars,
  SlopeChart,
  StackedBar100,
  WaterfallChart,
} from '@adminium/charts';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import { asCategorical } from '../../lib/shapes.js';
import type { WidgetProps } from '../../registry/types.js';
import {
  asBulletRows,
  asMatrix,
  asSlopeRecords,
  asWaterfallSteps,
} from './bars-ranking-shapes.js';
import type {
  ChartBulletConfig,
  ChartMarimekkoConfig,
  ChartParetoConfig,
  ChartRankingBarsConfig,
  ChartSlopeConfig,
  ChartStackedBar100Config,
  ChartWaterfallConfig,
} from './bars-ranking-config.js';

function BadShape() {
  const t = useMaybeT();
  return <p className="px-4 pb-4 text-body-sm text-fg-muted">{t('ui:widgets.charts.unexpectedShape', 'Unexpected data shape.')}</p>;
}

const wrap = 'px-4 pb-4 compact:px-3 compact:pb-3';

// --- chart-bullet ------------------------------------------------------------

export function ChartBulletWidget({ config, data }: WidgetProps<ChartBulletConfig>) {
  const t = useMaybeT();
  const rows = asBulletRows(data);
  if (rows === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-bullet">
      <BulletChart
        data={rows}
        labels={{ label: config.title ?? t('ui:widgets.charts.bullet.chartLabel', 'Bullet chart') }}
        height={config.height}
        formatValue={(value) => formatMetricValue(value, config.metricFormat, opts)}
      />
    </div>
  );
}

// --- chart-ranking-bars ------------------------------------------------------

export function ChartRankingBarsWidget({ config, data }: WidgetProps<ChartRankingBarsConfig>) {
  const t = useMaybeT();
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-ranking-bars">
      <RankingBars
        data={categorical.items.map((item) => ({ label: item.label, value: item.value }))}
        labels={{ label: config.title ?? t('ui:widgets.charts.rankingBars.chartLabel', 'Ranking') }}
        max={config.n}
        formatValue={(value) => formatMetricValue(value, config.metricFormat, opts)}
      />
    </div>
  );
}

// --- chart-pareto ------------------------------------------------------------

export function ChartParetoWidget({ config, data }: WidgetProps<ChartParetoConfig>) {
  const t = useMaybeT();
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-pareto">
      <ParetoChart
        data={categorical.items.map((item) => ({ label: item.label, value: item.value }))}
        labels={{ label: config.title ?? t('ui:widgets.charts.pareto.chartLabel', 'Pareto chart') }}
        cutline={config.cutline}
        smooth={config.smooth}
        showAxis={config.axis}
        height={config.height}
        formatValue={(value) => formatMetricValue(value, config.metricFormat, opts)}
      />
    </div>
  );
}

// --- chart-waterfall ---------------------------------------------------------

export function ChartWaterfallWidget({ config, data }: WidgetProps<ChartWaterfallConfig>) {
  const t = useMaybeT();
  const steps = asWaterfallSteps(data);
  if (steps === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-waterfall">
      <WaterfallChart
        data={steps}
        labels={{ label: config.title ?? t('ui:widgets.charts.waterfall.chartLabel', 'Waterfall chart') }}
        showAxis={config.axis}
        height={config.height}
        formatValue={(value) => formatMetricValue(value, config.metricFormat, opts)}
      />
    </div>
  );
}

// --- chart-marimekko ---------------------------------------------------------

export function ChartMarimekkoWidget({ config, data }: WidgetProps<ChartMarimekkoConfig>) {
  const t = useMaybeT();
  const matrix = asMatrix(data);
  if (matrix === null) return <BadShape />;
  return (
    <div className={wrap} data-widget="chart-marimekko">
      <MarimekkoChart
        rowKeys={matrix.rowKeys}
        colKeys={matrix.colKeys}
        cells={matrix.cells}
        labels={{ label: config.title ?? t('ui:widgets.charts.marimekko.chartLabel', 'Marimekko chart') }}
        labelThreshold={config.labelThreshold}
        height={config.height}
      />
    </div>
  );
}

// --- chart-stacked-bar-100 ---------------------------------------------------

export function ChartStackedBar100Widget({ config, data }: WidgetProps<ChartStackedBar100Config>) {
  const t = useMaybeT();
  const categorical = asCategorical(data);
  if (categorical === null || categorical.items.length === 0) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-stacked-bar-100">
      <StackedBar100
        data={categorical.items.map((item) => ({ key: item.key, label: item.label, value: item.value }))}
        labels={{ label: config.title ?? t('ui:widgets.charts.stackedBar100.chartLabel', '100% stacked bar') }}
        showLegend={config.showLegend}
        legendColumns={config.legendColumns}
        gapPx={config.gapPx}
        showSegmentLabels={config.showTotal}
        {...(config.metricFormat !== 'percent'
          ? { formatValue: (value: number) => formatMetricValue(value, config.metricFormat, opts) }
          : {})}
      />
    </div>
  );
}

// --- chart-slope -------------------------------------------------------------

export function ChartSlopeWidget({ config, data }: WidgetProps<ChartSlopeConfig>) {
  const t = useMaybeT();
  const records = asSlopeRecords(data);
  if (records === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-slope">
      <SlopeChart
        data={records}
        labels={{ label: config.title ?? t('ui:widgets.charts.slope.chartLabel', 'Slope chart') }}
        height={config.height}
        {...(config.periodLabels !== undefined ? { periodLabels: config.periodLabels } : {})}
        formatValue={(value) => formatMetricValue(value, config.metricFormat, opts)}
      />
    </div>
  );
}
