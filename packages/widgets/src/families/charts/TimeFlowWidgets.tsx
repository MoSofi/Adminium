// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `charts` family "time, forecast & flow" widgets (04-T09; annex §2 ids
 * chart-multiline, chart-stream, chart-forecast, chart-anomaly,
 * chart-candlestick, chart-bump, chart-timeline-lanes): registry wrappers
 * mapping stored instance config + §3 envelopes onto the @adminium/charts
 * primitives via the pure `time-flow-adapters` narrowers. Accessible names come
 * from `config.title` (ChartSurface renders them as the SVG aria-label).
 * Components render only the loaded state — WidgetFrame owns skeleton/empty/
 * error (04 §4); a malformed payload renders an inline fallback rather than
 * throwing into the error boundary. RTL mirroring is read from
 * ChartDirectionContext by the primitives, so no `dir` prop is threaded here.
 */
import { useMaybeT } from '@adminium/i18n/react';
import {
  AnomalyChart,
  BumpChart,
  CandlestickChart,
  ForecastChart,
  MultiLineChart,
  StreamChart,
  TimelineLanesChart,
} from '@adminium/charts';

import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import type { WidgetProps } from '../../registry/types.js';
import {
  toAnomalyPoints,
  toBumpInputs,
  toCandles,
  toForecastInputs,
  toLaneInputs,
  toTimeSeriesGroup,
} from './time-flow-adapters.js';
import type {
  ChartAnomalyConfig,
  ChartBumpConfig,
  ChartCandlestickConfig,
  ChartForecastConfig,
  ChartMultilineConfig,
  ChartStreamConfig,
  ChartTimelineLanesConfig,
} from './time-flow-config.js';

function BadShape() {
  const t = useMaybeT();
  return <p className="px-[var(--widget-pad)] pb-[var(--widget-pad)] text-body-sm text-fg-muted">{t('ui:widgets.charts.unexpectedShape', 'Unexpected data shape.')}</p>;
}

const wrap = 'px-[var(--widget-pad)] pb-[var(--widget-pad)]';

// --- chart-multiline ---------------------------------------------------------

export function ChartMultilineWidget({ config, data }: WidgetProps<ChartMultilineConfig>) {
  const t = useMaybeT();
  const series = toTimeSeriesGroup(data);
  if (series === null) return <BadShape />;
  return (
    <div className={wrap} data-widget="chart-multiline">
      <MultiLineChart
        series={series}
        labels={{ label: config.title ?? t('ui:widgets.charts.multiline.chartLabel', 'Multi-line chart') }}
        height={config.height}
        smooth={config.smooth}
        showAxis={config.axis}
        showEndLabels={config.seriesLabels}
      />
    </div>
  );
}

// --- chart-stream ------------------------------------------------------------

export function ChartStreamWidget({ config, data }: WidgetProps<ChartStreamConfig>) {
  const t = useMaybeT();
  const series = toTimeSeriesGroup(data);
  if (series === null) return <BadShape />;
  return (
    <div className={wrap} data-widget="chart-stream">
      <StreamChart
        series={series}
        labels={{ label: config.title ?? t('ui:widgets.charts.stream.chartLabel', 'Stream chart') }}
        height={config.height}
        smooth={config.curve === 'smooth'}
        showLegend={config.legend}
      />
    </div>
  );
}

// --- chart-forecast ----------------------------------------------------------

export function ChartForecastWidget({ config, data }: WidgetProps<ChartForecastConfig>) {
  const t = useMaybeT();
  const inputs = toForecastInputs(data);
  if (inputs === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-forecast">
      <ForecastChart
        history={inputs.history}
        forecast={inputs.forecast}
        band={inputs.band}
        labels={{ label: config.title ?? t('ui:widgets.charts.forecast.chartLabel', 'Forecast chart') }}
        nowLabel={t('ui:widgets.charts.forecast.nowLabel', 'Now')}
        forecastLabel={t('ui:widgets.charts.forecast.forecastLabel', 'Forecast')}
        actualLabel={t('ui:widgets.charts.forecast.actualLabel', 'Actual')}
        height={config.height}
        showAxis={config.axis}
        formatY={(value) => formatMetricValue(value, 'compact', opts)}
      />
    </div>
  );
}

// --- chart-anomaly -----------------------------------------------------------

export function ChartAnomalyWidget({ config, data }: WidgetProps<ChartAnomalyConfig>) {
  const t = useMaybeT();
  const points = toAnomalyPoints(data);
  if (points === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-anomaly">
      <AnomalyChart
        points={points}
        labels={{ label: config.title ?? t('ui:widgets.charts.anomaly.chartLabel', 'Anomaly chart') }}
        height={config.height}
        sensitivity={config.sensitivity}
        window={config.window}
        showAxis={config.axis}
        formatY={(value) => formatMetricValue(value, 'compact', opts)}
      />
    </div>
  );
}

// --- chart-candlestick -------------------------------------------------------

export function ChartCandlestickWidget({ config, data }: WidgetProps<ChartCandlestickConfig>) {
  const t = useMaybeT();
  const candles = toCandles(data, config.candleCount);
  if (candles === null) return <BadShape />;
  const opts = formatOptionsOf(config);
  return (
    <div className={wrap} data-widget="chart-candlestick">
      <CandlestickChart
        candles={candles}
        labels={{ label: config.title ?? t('ui:widgets.charts.candlestick.chartLabel', 'Candlestick chart') }}
        height={config.height}
        showAxis={config.axis}
        livePill={config.livePill}
        livePillLabel={t('ui:widgets.charts.candlestick.livePillLabel', 'Live')}
        formatPrice={(value) => formatMetricValue(value, config.priceFormat, opts)}
      />
    </div>
  );
}

// --- chart-bump --------------------------------------------------------------

export function ChartBumpWidget({ config, data }: WidgetProps<ChartBumpConfig>) {
  const t = useMaybeT();
  const inputs = toBumpInputs(data, config.periods, config.maxRank);
  if (inputs === null) return <BadShape />;
  return (
    <div className={wrap} data-widget="chart-bump">
      <BumpChart
        series={inputs.series}
        labels={{ label: config.title ?? t('ui:widgets.charts.bump.chartLabel', 'Bump chart') }}
        periods={inputs.periods}
        maxRank={inputs.maxRank}
        periodLabels={inputs.periodLabels}
        height={config.height}
        showEndLabels={config.endLabels}
      />
    </div>
  );
}

// --- chart-timeline-lanes ----------------------------------------------------

export function ChartTimelineLanesWidget({ config, data }: WidgetProps<ChartTimelineLanesConfig>) {
  const t = useMaybeT();
  const inputs = toLaneInputs(data, config.lanes, config.axisBuckets, t('ui:widgets.charts.timelineLanes.laneLabel', 'Events'));
  if (inputs === null) return <BadShape />;
  return (
    <div className={wrap} data-widget="chart-timeline-lanes">
      <TimelineLanesChart
        lanes={inputs.lanes}
        events={inputs.events}
        labels={{ label: config.title ?? t('ui:widgets.charts.timelineLanes.chartLabel', 'Timeline lanes') }}
        axisLabels={inputs.axisLabels}
        height={config.height}
      />
    </div>
  );
}
